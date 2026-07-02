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

export function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Mean of all pairwise distances between the given points (2+ points). */
export function averagePairwiseDistance(points: Point2D[]): number {
  let total = 0;
  let pairCount = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      total += distance2D(points[i], points[j]);
      pairCount++;
    }
  }
  return pairCount === 0 ? 0 : total / pairCount;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Smoothstep-remaps `value` from [edge0, edge1] to a 0..1 score (clamped
 * outside the range). Used to turn a raw geometric measurement into a
 * graduated confidence contribution instead of a hard boolean cutoff.
 */
export function smoothScore(value: number, edge0: number, edge1: number): number {
  if (edge0 === edge1) return value >= edge0 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
