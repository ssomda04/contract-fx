import type { Point2D } from "./types";
import { distance2D } from "./geometry";

/**
 * Shared pure helpers for motion-sequence gestures (pin pull, and later
 * chain recoil) — detectors that need a short "arm near an anchor, then
 * move" shape instead of a single held pose. Framework-free, same as
 * geometry.ts.
 */

/** A 2D point captured at a specific moment, for tracking a short motion. */
export interface TimedPoint extends Point2D {
  timestampMs: number;
}

const DEFAULT_MAX_HISTORY_LENGTH = 8;

/** Appends a point to a bounded history buffer, dropping the oldest entry once `maxLength` is exceeded. */
export function trackPointHistory(
  history: TimedPoint[],
  point: Point2D,
  timestampMs: number,
  maxLength: number = DEFAULT_MAX_HISTORY_LENGTH
): TimedPoint[] {
  const next = [...history, { x: point.x, y: point.y, timestampMs }];
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}

export function calculateDisplacement(from: Point2D, to: Point2D): number {
  return distance2D(from, to);
}

/** Straight-line speed between two timed points, in normalized-distance units per second. */
export function calculateVelocity(from: TimedPoint, to: TimedPoint): number {
  const elapsedSeconds = (to.timestampMs - from.timestampMs) / 1000;
  if (elapsedSeconds <= 0) return 0;
  return calculateDisplacement(from, to) / elapsedSeconds;
}

/** Whether `currentPoint` sits farther from `anchor` than `previousPoint` did. */
export function isMovingAwayFromAnchor(
  anchor: Point2D,
  previousPoint: Point2D,
  currentPoint: Point2D
): boolean {
  return distance2D(anchor, currentPoint) > distance2D(anchor, previousPoint);
}
