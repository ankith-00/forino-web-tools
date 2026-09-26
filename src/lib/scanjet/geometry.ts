/**
 * Pure JS geometry helpers for quad detection / splitting / warping.
 * All point coordinates are plain `{ x, y }` — the values are unit-agnostic
 * (normalized 0..1, or pixels). Keep this module dependency-free.
 */

export type GeoPoint = { x: number; y: number };

/** Four corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [GeoPoint, GeoPoint, GeoPoint, GeoPoint];

export const dist = (a: GeoPoint, b: GeoPoint): number =>
  Math.hypot(b.x - a.x, b.y - a.y);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpPoint = (a: GeoPoint, b: GeoPoint, t: number): GeoPoint => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});

export const vecLen = (v: GeoPoint): number => Math.hypot(v.x, v.y);

export const cross = (o: GeoPoint, a: GeoPoint, b: GeoPoint): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

export const dot = (p: GeoPoint, q: GeoPoint): number => p.x * q.x + p.y * q.y;

/** Shoelace area of a polygon (absolute value). */
export function polygonArea(points: GeoPoint[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

/** True when the polygon is convex (all cross products share the same sign). */
export function isConvex(points: GeoPoint[]): boolean {
  const n = points.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = cross(points[i], points[(i + 1) % n], points[(i + 2) % n]);
    if (c === 0) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Sort scattered corners into TL, TR, BR, BL order (image coords, y-down). */
export function orderQuad(points: GeoPoint[]): Quad {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  return [sorted[0], sorted[1], sorted[2], sorted[3]];
}

export function quadEdgeLengths(q: Quad): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  return {
    top: dist(q[0], q[1]),
    right: dist(q[1], q[2]),
    bottom: dist(q[2], q[3]),
    left: dist(q[3], q[0]),
  };
}

/** Width / height of a quad based on average edge lengths. */
export function quadAspect(q: Quad): number {
  const { top, right, bottom, left } = quadEdgeLengths(q);
  const w = (top + bottom) / 2;
  const h = (right + left) / 2;
  return h === 0 ? 1 : w / h;
}

export function quadArea(q: Quad): number {
  return polygonArea(q);
}

/**
 * Intersection of segments (p1->p2) and (p3->p4), or null when parallel /
 * collinear. Segments are treated as infinite lines for gutter math, but we
 * also verify the intersection lies within both bounding boxes.
 */
export function lineIntersection(
  p1: GeoPoint,
  p2: GeoPoint,
  p3: GeoPoint,
  p4: GeoPoint
): GeoPoint | null {
  const d1 = p2.x - p1.x;
  const d2 = p2.y - p1.y;
  const d3 = p4.x - p3.x;
  const d4 = p4.y - p3.y;
  const denom = d1 * d4 - d2 * d3;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d4 - (p3.y - p1.y) * d3) / denom;
  return { x: p1.x + t * d1, y: p1.y + t * d2 };
}

/** Point on segment (a->b) at parameter t, clamped to the segment. */
export function pointOnSegment(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  const tc = Math.min(1, Math.max(0, t));
  return { x: lerp(a.x, b.x, tc), y: lerp(a.y, b.y, tc) };
}

/** Least-squares fit of `y = a + b*x` through (x, y) points. */
export function fitLineY(
  pts: GeoPoint[]
): { a: number; b: number } | null {
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
  const a = (sy - b * sx) / n;
  return { a, b };
}

/** Least-squares fit of `x = a + b*y` through (x, y) points. */
export function fitLineX(
  pts: GeoPoint[]
): { a: number; b: number } | null {
  return fitLineY(
    pts.map((p) => ({ x: p.y, y: p.x }))
  );
}