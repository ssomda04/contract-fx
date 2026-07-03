import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Point2D } from "./types";

/** MediaPipe PoseLandmarker's 33-point index layout, the subset used here. */
const POSE_LANDMARK = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

// PoseLandmarker has no dedicated neck/chest landmark, so both are estimated
// from the shoulder/hip anchors that do exist.
const NECK_ABOVE_SHOULDER_RATIO = 0.35;
const CHEST_LERP_TOWARD_HIP = 0.25;

export function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function lerp(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function estimateShoulderCenter(poseLandmarks: NormalizedLandmark[]): Point2D | null {
  const left = poseLandmarks[POSE_LANDMARK.LEFT_SHOULDER];
  const right = poseLandmarks[POSE_LANDMARK.RIGHT_SHOULDER];
  if (!left || !right) return null;
  return midpoint(left, right);
}

export function estimateHipCenter(poseLandmarks: NormalizedLandmark[]): Point2D | null {
  const left = poseLandmarks[POSE_LANDMARK.LEFT_HIP];
  const right = poseLandmarks[POSE_LANDMARK.RIGHT_HIP];
  if (!left || !right) return null;
  return midpoint(left, right);
}

export function estimateShoulderWidth(poseLandmarks: NormalizedLandmark[]): number | null {
  const left = poseLandmarks[POSE_LANDMARK.LEFT_SHOULDER];
  const right = poseLandmarks[POSE_LANDMARK.RIGHT_SHOULDER];
  if (!left || !right) return null;
  return Math.hypot(left.x - right.x, left.y - right.y);
}

/**
 * Approximates the neck as the point directly above the shoulder midpoint
 * (smaller y = higher on screen), offset by a fraction of shoulder width so
 * the estimate scales with how close/far the person is from the camera.
 */
export function estimateNeckAnchor(poseLandmarks: NormalizedLandmark[]): Point2D | null {
  const shoulderCenter = estimateShoulderCenter(poseLandmarks);
  const shoulderWidth = estimateShoulderWidth(poseLandmarks);
  if (!shoulderCenter || shoulderWidth === null) return null;
  return {
    x: shoulderCenter.x,
    y: shoulderCenter.y - shoulderWidth * NECK_ABOVE_SHOULDER_RATIO,
  };
}

/**
 * Approximates the chest/sternum as a point a quarter of the way from the
 * shoulder midpoint toward the hip midpoint.
 */
export function estimateChestAnchor(poseLandmarks: NormalizedLandmark[]): Point2D | null {
  const shoulderCenter = estimateShoulderCenter(poseLandmarks);
  const hipCenter = estimateHipCenter(poseLandmarks);
  if (!shoulderCenter || !hipCenter) return null;
  return lerp(shoulderCenter, hipCenter, CHEST_LERP_TOWARD_HIP);
}
