/**
 * Perspective-correct a detected page out of a camera frame.
 *
 * The native scanner used OpenCV's `getPerspectiveTransform` + `warpPerspective`
 * (recoverable at `reactnative/src/lib/warp.ts`, commit 2c9f797). OpenCV does
 * not run in a browser, so the homography solve and the resampling are done here
 * directly. The approach is the same as OpenCV's `INTER_LINEAR` with
 * `BORDER_REPLICATE`, minus the native acceleration:
 *
 *   1. Solve the 3x3 homography mapping the output rectangle onto the page's
 *      quad, by 8x8 Gaussian elimination with partial pivoting.
 *   2. Resample by *inverse* mapping: for each output pixel, ask where it came
 *      from. Forward mapping (push source pixels to the destination) leaves
 *      holes wherever the source is sparser than the destination, which on a
 *      magnified page is most of the image.
 *
 * Output size comes from the quad's own averaged edge lengths, so a page shot at
 * an angle still comes out rectangular, and is capped at `maxDim` because the
 * source is a camera frame, not a scan.
 *
 * This module is pure and canvas-free: it returns an `ImageData`, so it is
 * testable in Node and the caller decides how to display or encode it.
 */

import { dist, type GeoPoint, type Quad } from "./geometry.ts";

/** Output cap, matching the native scanner's `PAGE_MAX_DIM`. */
export const PAGE_MAX_DIM = 3200;

/**
 * A plain pixel buffer.
 *
 * Deliberately *not* the DOM `ImageData`: this module is documented as
 * canvas-free so it can be unit-tested in Node, and `new ImageData(...)` throws
 * there. The shape is identical, so a caller in the browser passes the result
 * straight to `putImageData` (see `rasterToImageData`) or encodes it with
 * `rasterToJpeg`.
 */
export type Raster = {
  // Pinned to `ArrayBuffer` (not the default `ArrayBufferLike`) so a `Raster` can
  // be handed straight to `new ImageData(...)`, whose signature rejects a buffer
  // that might be a SharedArrayBuffer.
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
};

export type WarpOptions = {
  /** Page corners in *source pixel* coordinates, TL, TR, BR, BL. */
  quad: Quad;
  srcWidth: number;
  srcHeight: number;
  /** Cap on the largest output edge; aspect ratio is preserved. */
  maxDim?: number;
};

/**
 * Straighten the page described by `opts.quad` out of the RGBA buffer.
 *
 * Returns null only for a degenerate quad (zero area), which is the one case
 * where no homography exists.
 */
export function warpPage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: WarpOptions
): Raster | null {
  const { quad } = opts;
  const maxDim = opts.maxDim ?? PAGE_MAX_DIM;

  // Output geometry from the quad's own edges: the average of opposite sides is
  // robust to a corner being a pixel or two out, which a single edge is not.
  const top = dist(quad[0], quad[1]);
  const bottom = dist(quad[3], quad[2]);
  const left = dist(quad[0], quad[3]);
  const right = dist(quad[1], quad[2]);
  let outW = Math.max(1, Math.round((top + bottom) / 2));
  let outH = Math.max(1, Math.round((left + right) / 2));

  const scale = Math.min(1, maxDim / Math.max(outW, outH));
  outW = Math.max(1, Math.round(outW * scale));
  outH = Math.max(1, Math.round(outH * scale));

  // Destination rect -> source quad.
  const h = solveHomography(
    [
      { x: 0, y: 0 },
      { x: outW - 1, y: 0 },
      { x: outW - 1, y: outH - 1 },
      { x: 0, y: outH - 1 },
    ],
    [quad[0], quad[1], quad[2], quad[3]]
  );
  if (!h) return null;

  const out = new Uint8ClampedArray(outW * outH * 4);

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = h[6] * x + h[7] * y + 1;
      if (Math.abs(denom) < 1e-12) continue;
      const u = (h[0] * x + h[1] * y + h[2]) / denom;
      const v = (h[3] * x + h[4] * y + h[5]) / denom;
      sampleBilinear(rgba, width, height, u, v, out, (y * outW + x) * 4);
    }
  }

  return { data: out, width: outW, height: outH };
}

/**
 * Bilinear sample with edge clamping, matching OpenCV's `BORDER_REPLICATE`.
 *
 * Clamping rather than leaving out-of-range pixels black matters here: a
 * detected corner is always a little outside the true page, so the border ring
 * is sampled constantly and would otherwise show as a black frame.
 */
function sampleBilinear(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  u: number,
  v: number,
  out: Uint8ClampedArray,
  q: number
) {
  const x = u < 0 ? 0 : u > w - 1 ? w - 1 : u;
  const y = v < 0 ? 0 : v > h - 1 ? h - 1 : v;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;

  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;

  for (let c = 0; c < 3; c++) {
    const top = rgba[i00 + c] * (1 - fx) + rgba[i10 + c] * fx;
    const bottom = rgba[i01 + c] * (1 - fx) + rgba[i11 + c] * fx;
    out[q + c] = top * (1 - fy) + bottom * fy;
  }
  out[q + 3] = 255;
}

/**
 * Solve the 3x3 homography taking each point in `from` to its counterpart in
 * `to`, as `[h00..h22]` in row-major order with `h22` normalised to 1.
 *
 * Each correspondence gives two linear equations in the eight unknowns, with the
 * bottom-right term pinned to 1 to fix the matrix's scale. The 8x8 system is
 * then solved by Gaussian elimination with partial pivoting — without pivoting,
 * a plausible camera geometry can produce a zero leading pivot and a NaN page.
 *
 * Returns null if the system is singular, i.e. the quad is degenerate.
 */
function solveHomography(from: GeoPoint[], to: GeoPoint[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting. Null when singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[pivot];
      m[pivot] = m[col];
      m[col] = tmp;
    }

    const p = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= p;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }

  return m.map((row) => row[n]);
}

/** Wrap a `Raster` as a DOM `ImageData`, for `putImageData`. */
export function rasterToImageData(raster: Raster): ImageData {
  return new ImageData(raster.data, raster.width, raster.height);
}

/** A `Raster` to a JPEG blob, for thumbnails and upload. */
export async function rasterToJpeg(raster: Raster, quality = 0.85): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(rasterToImageData(raster), 0, 0);
  return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** A `Raster` to a data URL, for cheap preview thumbnails. */
export function rasterToDataUrl(raster: Raster, quality = 0.7): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(rasterToImageData(raster), 0, 0);
  return canvas.toDataURL("image/jpeg", quality);
}
