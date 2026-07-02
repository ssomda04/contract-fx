import type { Point2D } from "./types";

export function distance2D(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Angle at `center` between rays to `a` and `b`, in radians [0, PI]. */
export function angle(center: Point2D, a: Point2D, b: Point2D): number {
  const v1x = a.x - center.x;
  const v1y = a.y - center.y;
  const v2x = b.x - center.x;
  const v2y = b.y - center.y;

  const magnitude1 = Math.hypot(v1x, v1y);
  const magnitude2 = Math.hypot(v2x, v2y);
  if (magnitude1 === 0 || magnitude2 === 0) return 0;

  const dot = v1x * v2x + v1y * v2y;
  const cosine = Math.min(1, Math.max(-1, dot / (magnitude1 * magnitude2)));
  return Math.acos(cosine);
}
