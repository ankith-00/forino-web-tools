/**
 * Browser-side image analysis primitives, in plain TypeScript.
 *
 * Why this file exists
 * --------------------
 * The ScanJet document scanner was first written for React Native against
 * `react-native-fast-opencv`, a native JSI module. That module is a JSI binding
 * to a native OpenCV build: it cannot run in a browser, and this project has no
 * image-processing dependency to replace it with (checked: no `opencv`,
 * `sharp`, `jimp` or `pngjs` anywhere in any workspace manifest).
 *
 * So the OpenCV prelude is reimplemented here on `ImageData` buffers:
 *
 *   OpenCV call                        replaced by
 *   ---------------------------------  ------------------------------------
 *   cvtColor(COLOR_BGR2GRAY)           toGrayscale
 *   GaussianBlur(5, 5, sigma 1.4)      blurGaussian (3x separable box blur)
 *   Canny(lo, hi)                     canny (Sobel + NMS + hysteresis)
 *   dilate(3x3, 2 iterations)         dilate (separable max filter)
 *   findContours(RETR_EXTERNAL)       connectedComponents + convexHull
 *   approxPolyDP(0.02 * arcLength)    maxAreaQuad + refineQuadCorners
 *
 * The last row is a deliberate substitution rather than a transliteration.
 * `findContours` + `approxPolyDP` is the standard way to turn a Canny map into
 * a four-corner page candidate, but a faithful port needs Suzuki border
 * following and then a tolerance-dependent vertex count that lands on 4 only
 * for clean rectangles. A page on a desk *is* convex, so the convex hull of the
 * closed edge component is a strictly better-conditioned estimate, and
 * max-area-inscribed-quad finds the corners without a magic epsilon. The RN
 * detector's tuned `0.02 * arcLen` epsilon disappears, which is the point.
 *
 * Everything here is synchronous and allocation-light, and every function is
 * pure: same input, same output, no shared state, no canvas access. That makes
 * the whole pipeline testable against synthetic images, which is how
 * `__tests__/vision.test.ts` exercises it.
 *
 * @see geometry.ts for the quad/line math shared with the native detector.
 */

/** Points are plain objects so this module stays independent of geometry.ts. */
export type Pt = { x: number; y: number };

/** Single-channel image, one byte per pixel, row-major. */
export type Gray = { data: Uint8Array; width: number; height: number };

/** Binary image: 0 = background, 255 = foreground. Same layout as `Gray`. */
export type Binary = Gray;

/**
 * RGBA → luminance using the Rec. 601 weights that OpenCV's `COLOR_BGR2GRAY`
 * applies. Integer approximation, matching OpenCV's own fixed-point form so the
 * blur and Canny thresholds below mean the same thing in both implementations.
 */
export function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Gray {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // 4899 + 9617 + 1868 === 16384, so the sum below divides by 16 to normalise.
    out[i] = (rgba[p] * 4899 + rgba[p + 1] * 9617 + rgba[p + 2] * 1868) >> 14;
  }
  return { data: out, width, height };
}

/**
 * Separable box blur, run three times to approximate a Gaussian.
 *
 * Three box passes converge on a Gaussian of the same variance, and each pass
 * is O(n) regardless of radius — so this is O(1) per pixel where a true
 * Gaussian is O(r²). It is a different kernel, not the same one: the corners
 * are very slightly boxier. For edge detection that is a non-issue, since the
 * point of the blur is to suppress single-pixel noise before differencing.
 */
export function blurGaussian(src: Gray, radius = 2, passes = 3): Gray {
  let cur = src;
  const r = Math.max(0, Math.round(radius));
  for (let i = 0; i < passes && r > 0; i++) {
    cur = boxBlurH(boxBlurV(cur, r), r);
  }
  return cur;
}

/** Horizontal box blur with a `(2r+1)` window, edge-clamped. */
export function boxBlurH(src: Gray, r: number): Gray {
  const { data, width: w, height: h } = src;
  const out = new Uint8Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += data[row + clampInt(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      out[row + x] = (sum / win) | 0;
      sum -= data[row + clampInt(x - r, 0, w - 1)];
      sum += data[row + clampInt(x + r + 1, 0, w - 1)];
    }
  }
  return { data: out, width: w, height: h };
}

/** Vertical box blur with a `(2r+1)` window, edge-clamped. */
export function boxBlurV(src: Gray, r: number): Gray {
  const { data, width: w, height: h } = src;
  const out = new Uint8Array(w * h);
  const win = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += data[clampInt(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = (sum / win) | 0;
      sum -= data[clampInt(y - r, 0, h - 1) * w + x];
      sum += data[clampInt(y + r + 1, 0, h - 1) * w + x];
    }
  }
  return { data: out, width: w, height: h };
}

/** L1-normalised Sobel gradient magnitude (0..255) and quantised direction. */
export type Gradient = {
  mag: Uint8Array;
  /** 0..3 for (+, +) diagonal down-right, (-, +) down-left, and both axes. */
  dir: Uint8Array;
  width: number;
  height: number;
};

export function sobel(gray: Gray): Gradient {
  const { data, width: w, height: h } = gray;
  const mag = new Uint8Array(w * h);
  const dir = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = data[i - w - 1];
      const tc = data[i - w];
      const tr = data[i - w + 1];
      const ml = data[i - 1];
      const mr = data[i + 1];
      const bl = data[i + w - 1];
      const bc = data[i + w];
      const br = data[i + w + 1];

      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      const absX = Math.abs(gx);
      const absY = Math.abs(gy);

      // No `/4` here, deliberately. OpenCV's `Canny` runs its internal Sobel
      // into a CV_32F buffer with no scaling, so its gradient is 4x a
      // normalised Sobel. Dividing here would put a hard page edge at ~39 and
      // make the (50, 150) threshold pair inherited from the native detector
      // find nothing at all. Keeping raw scale is what makes those two numbers
      // mean the same thing in both implementations.
      const m = Math.min(255, (absX + absY) | 0);
      mag[i] = m;
      dir[i] = absX > absY ? (gy > 0 ? 1 : 3) : gy > 0 ? 0 : 2;
    }
  }
  return { mag, dir, width: w, height: h };
}

/**
 * Canny edge detector: Sobel gradients, non-maximum suppression, then
 * hysteresis between `lo` and `hi`.
 *
 * Pixels whose neighbours along the gradient direction are both stronger are
 * zeroed, which thins each edge to one pixel — the step that makes the
 * downstream dilation close a page outline into a single loop rather than a
 * pair of parallel lines. Hysteresis then keeps a weak edge pixel only if it
 * touches a strong one, so a faint continuation of a real page border survives
 * while isolated noise does not.
 */
export function canny(gray: Gray, lo: number, hi: number): Binary {
  const { mag, dir, width: w, height: h } = sobel(gray);

  // Non-maximum suppression: compare along the rounded gradient direction.
  const thin = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m === 0) continue;
      const [ax, ay] = dirOffset(dir[i]);
      const a = mag[i + ay * w + ax];
      const b = mag[i - ay * w - ax];
      if (m >= a && m >= b) thin[i] = m;
    }
  }

  // Hysteresis: flood strong pixels, pulling in weak ones that touch them.
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < thin.length; i++) {
    if (thin[i] >= hi) {
      out[i] = 255;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (out[j] === 0 && thin[j] >= lo) {
          out[j] = 255;
          stack.push(j);
        }
      }
    }
  }
  return { data: out, width: w, height: h };
}

/** One of four step offsets matching `Gradient.dir`'s 0..3 encoding. */
function dirOffset(dir: number): [number, number] {
  switch (dir) {
    case 0:
      return [1, 1];
    case 1:
      return [1, 0];
    case 2:
      return [0, 1];
    default:
      return [1, 1];
  }
}

/**
 * Binary dilation with a square structuring element, separable into a
 * horizontal then vertical max pass.
 *
 * This is what closes the gaps Canny leaves along a page border. A paper edge
 * under uneven light rarely yields a continuous 1-pixel line, and without a
 * closing step the "outline" fragments into pieces too small to be a page.
 */
export function dilate(src: Binary, radius = 1, iterations = 1): Binary {
  let cur = src;
  const r = Math.max(0, Math.round(radius));
  for (let i = 0; i < iterations && r > 0; i++) {
    cur = maxV(maxH(cur, r), r);
  }
  return cur;
}

function maxH(src: Binary, r: number): Binary {
  const { data, width: w, height: h } = src;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -r; k <= r; k++) {
        const v = data[row + clampInt(x + k, 0, w - 1)];
        if (v > m) m = v;
      }
      out[row + x] = m;
    }
  }
  return { data: out, width: w, height: h };
}

function maxV(src: Binary, r: number): Binary {
  const { data, width: w, height: h } = src;
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let k = -r; k <= r; k++) {
        const v = data[clampInt(y + k, 0, h - 1) * w + x];
        if (v > m) m = v;
      }
      out[y * w + x] = m;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * 4-connected components of a binary image, by iterative flood fill.
 *
 * An explicit stack rather than recursion: a closed page outline that has been
 * dilated can easily be 20k pixels, which would blow the JS call stack.
 *
 * Returns pixel indices grouped per component, largest first, already filtered
 * to components of at least `minArea` so callers do not walk specks.
 */
export function connectedComponents(
  bin: Binary,
  minArea: number
): { pixels: number[]; area: number }[] {
  const { data, width: w, height: h } = bin;
  const seen = new Uint8Array(w * h);
  const found: { pixels: number[]; area: number }[] = [];
  const stack: number[] = [];

  for (let start = 0; start < data.length; start++) {
    if (data[start] === 0 || seen[start] === 1) continue;
    const pixels: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      pixels.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
    if (pixels.length >= minArea) found.push({ pixels, area: pixels.length });
  }

  function push(j: number) {
    if (seen[j] === 0 && data[j] !== 0) {
      seen[j] = 1;
      stack.push(j);
    }
  }

  found.sort((a, b) => b.area - a.area);
  return found;
}

/**
 * Andrew's monotone-chain convex hull. Points may arrive in any order.
 *
 * This stands in for `findContours` + `approxPolyDP`: a page is convex, so the
 * hull of its closed edge component is the page, and the hull is exact rather
 * than tolerance-dependent.
 */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return [...points];
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  // Drop duplicates, which otherwise produce zero-length edges in the chains.
  const uniq: Pt[] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) uniq.push(p);
  }
  if (uniq.length < 3) return uniq;

  const turn = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Shoelace area; the hull built above is counter-clockwise in image coords. */
export function hullArea(hull: Pt[]): number {
  let a = 0;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * The maximum-area quadrilateral inscribed in a convex polygon, as four
 * indices into `hull` in hull order.
 *
 * Chosen over Douglas-Peucker because "keep the 4 points that best explain the
 * shape" is exactly the question, and for a convex hull the answer is
 * unambiguous: the corners. `approxPolyDP` instead returns however many
 * vertices survive a tolerance, which is 4 only when the page is perfectly
 * rectangular and 5 or 6 otherwise.
 *
 * Cost is O(h^4) over hull size `h`. That is only safe because callers run this
 * on the downscaled detection copy, where a page outline yields a hull of
 * roughly 10-40 points (≈2.3M worst-case comparisons at h=40, a few ms) — see
 * `page-detect.ts`, which caps the hull size first.
 */
export function maxAreaQuad(hull: Pt[]): number[] {
  const n = hull.length;
  if (n < 4) return hull.map((_, i) => i);
  const area = (a: number, b: number, c: number, d: number) => {
    // Quad area is half the cross product of its two *diagonals* (a->c, b->d).
    // Crossing two opposite *sides* instead — the intuitive-looking mistake —
    // does not give the area at all, and silently rewards thin slivers: on a
    // skewed page it picked a quad a third the size of the real one.
    const p1 = hull[a];
    const p2 = hull[b];
    const p3 = hull[c];
    const p4 = hull[d];
    const acx = p3.x - p1.x;
    const acy = p3.y - p1.y;
    const bdx = p4.x - p2.x;
    const bdy = p4.y - p2.y;
    return Math.abs(acx * bdy - acy * bdx) / 2;
  };
  let best: number[] = [0, 1, 2, 3];
  let bestArea = -1;
  for (let a = 0; a < n - 3; a++) {
    for (let b = a + 1; b < n - 2; b++) {
      for (let c = b + 1; c < n - 1; c++) {
        for (let d = c + 1; d < n; d++) {
          const v = area(a, b, c, d);
          if (v > bestArea) {
            bestArea = v;
            best = [a, b, c, d];
          }
        }
      }
    }
  }
  return best;
}

/**
 * Least-squares line fit `x = a + b*y` through points, or null if degenerate.
 * Used to snap quad corners onto the page's true straight edges.
 */
export function fitLineX(pts: Pt[]): { a: number; b: number } | null {
  return fitLine(pts.map((p) => ({ x: p.y, y: p.x })));
}

/** Least-squares line fit `y = a + b*x` through points, or null if degenerate. */
export function fitLineY(pts: Pt[]): { a: number; b: number } | null {
  return fitLine(pts);
}

function fitLine(pts: Pt[]): { a: number; b: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const b = (n * sxy - sx * sy) / denom;
  return { a: (sy - b * sx) / n, b };
}

/** Intersection of the infinite lines through (p1,p2) and (p3,p4), or null when
 * they are parallel. Mirrors the same helper in `geometry.ts`; kept local
 * because `vision.ts` must not import that module and stay standalone. */
export function lineIntersection(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d1 = p2.x - p1.x;
  const d2 = p2.y - p1.y;
  const d3 = p4.x - p3.x;
  const d4 = p4.y - p3.y;
  const denom = d1 * d4 - d2 * d3;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d4 - (p3.y - p1.y) * d3) / denom;
  return { x: p1.x + t * d1, y: p1.y + t * d2 };
}

/** A line as an anchor point plus a direction, so vertical sides work too. */
export type Line = { p: Pt; d: Pt };

/**
 * Fit a line to one side of a page, choosing the axis it varies along.
 *
 * A page side is often exactly vertical, and a least-squares `y = a + b*x` fit
 * through a vertical side is degenerate — the solver's denominator goes to zero
 * and the fit is meaningless. So pick the axis with the larger spread and fit
 * against the other, which keeps both axis-aligned and skewed sides stable.
 */
function fitSide(pts: Pt[]): Line | null {
  if (pts.length < 2) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (maxX - minX >= maxY - minY) {
    const f = fitLineY(pts);
    return f ? { p: { x: 0, y: f.a }, d: { x: 1, y: f.b } } : null;
  }
  const f = fitLineX(pts);
  return f ? { p: { x: f.a, y: 0 }, d: { x: f.b, y: 1 } } : null;
}

function intersectLines(l1: Line, l2: Line): Pt | null {
  const denom = l1.d.x * l2.d.y - l2.d.x * l1.d.y;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / denom;
  return { x: l1.p.x + t * l1.d.x, y: l1.p.y + t * l1.d.y };
}

/** Shortest distance from a point to a segment, used to band side samples. */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Re-snap quad corners to the page's real straight edges.
 *
 * `maxAreaQuad` can only return points that lie *on the hull*, so a corner
 * lands wherever the outermost detected pixel happened to be — a few pixels
 * proud of the true corner even when the overall fit is good. A page's sides are
 * straight, so fitting a line to each side and intersecting adjacent fits
 * recovers the real corner.
 *
 * `samples` must be the **component's own pixels**, not hull vertices. That
 * distinction is the whole ballgame: a convex hull discards the points lying
 * along a side's interior, so a side arrives as a cluster near one corner plus
 * a single far vertex, and a least-squares fit through that is dominated by the
 * lone point — measured at 35px of corner error, far worse than not refining at
 * all. The raw ring is dense and evenly spread along every side, which is
 * exactly what a line fit wants.
 *
 * Refinement is also bounded: each side's samples must reach a minimum count,
 * and a corner is never allowed to move more than `maxShift` of the page's own
 * size. So a bad fit degrades to the unrefined corner instead of inventing one.
 */
export function refineQuadCorners(quad: Pt[], samples: Pt[], maxShift = 0.15): Pt[] {
  if (quad.length !== 4 || samples.length < 12) return quad;

  const meanSide =
    (Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y) +
      Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y) +
      Math.hypot(quad[3].x - quad[2].x, quad[3].y - quad[2].y) +
      Math.hypot(quad[0].x - quad[1].x, quad[0].y - quad[1].y)) /
    2;

  const lines: (Line | null)[] = [];
  for (let k = 0; k < 4; k++) {
    const a = quad[k];
    const b = quad[(k + 1) % 4];
    const band = Math.max(3, distToSegmentCenter(a, b) * 0.12);
    const near = samples.filter((p) => distToSegment(p, a, b) <= band);
    lines.push(near.length >= 3 ? fitSide(near) : null);
  }

  return quad.map((raw, k) => {
    const prev = lines[(k + 3) % 4];
    const cur = lines[k];
    if (!prev || !cur) return raw;
    const hit = intersectLines(prev, cur);
    if (!hit) return raw;
    if (Math.hypot(hit.x - raw.x, hit.y - raw.y) > maxShift * meanSide) return raw;
    return hit;
  });
}

/** Half the length of a segment; the unit for the sampling band width. */
function distToSegmentCenter(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y) / 2;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
