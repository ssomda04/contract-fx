import type { HandLandmark, Point2D } from "./types";

export function distance2D(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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

export function centroid(points: Point2D[]): Point2D {
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export function vectorBetween(from: Point2D, to: Point2D): Point2D {
  return { x: to.x - from.x, y: to.y - from.y };
}

export function vectorBetween3D(from: HandLandmark, to: HandLandmark): {
  x: number;
  y: number;
  z: number;
} {
  return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
}

/**
 * Angle between two 3D direction vectors, in radians [0, PI]. Unlike the 2D
 * variant, this stays accurate when the motion being measured happens partly
 * along the camera axis (z) instead of purely in the image plane — a 2D-only
 * angle foreshortens and reads smaller than reality as the hand rotates
 * toward the camera.
 */
export function angleBetweenVectors3D(
  v1: { x: number; y: number; z: number },
  v2: { x: number; y: number; z: number }
): number {
  const magnitude1 = Math.hypot(v1.x, v1.y, v1.z);
  const magnitude2 = Math.hypot(v2.x, v2.y, v2.z);
  if (magnitude1 === 0 || magnitude2 === 0) return 0;

  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const cosine = Math.min(1, Math.max(-1, dot / (magnitude1 * magnitude2)));
  return Math.acos(cosine);
}

const FINGER_EXTENSION_PIP_MARGIN = 0.15;
const FINGER_EXTENSION_MCP_RATIO = 1.15;
const FINGER_EXTENSION_MCP_MARGIN = 0.2;

/**
 * 0..1: how far `tip` reaches outward from `wrist` past both `pip` and a
 * margin beyond `mcp`, scaled by hand size. Used as the base "is this finger
 * extended" score; `1 - fingerExtensionScore(...)` reads as "folded".
 */
export function fingerExtensionScore(
  wrist: Point2D,
  mcp: Point2D,
  pip: Point2D,
  tip: Point2D,
  handScale: number
): number {
  const tipFromWrist = distance2D(wrist, tip);
  const pipFromWrist = distance2D(wrist, pip);
  const mcpFromWrist = distance2D(wrist, mcp);

  const beyondPip = smoothScore(
    tipFromWrist - pipFromWrist,
    0,
    handScale * FINGER_EXTENSION_PIP_MARGIN
  );
  const beyondMcp = smoothScore(
    tipFromWrist - mcpFromWrist * FINGER_EXTENSION_MCP_RATIO,
    0,
    handScale * FINGER_EXTENSION_MCP_MARGIN
  );

  return Math.min(beyondPip, beyondMcp);
}

/** 0..1: how close `a` is to `b` relative to hand size (1 = touching, 0 = at/beyond `maxNormalizedDistance`). */
export function closenessScore(
  a: Point2D,
  b: Point2D,
  handScale: number,
  maxNormalizedDistance: number
): number {
  const normalizedDistance = distance2D(a, b) / handScale;
  return smoothScore(maxNormalizedDistance - normalizedDistance, 0, maxNormalizedDistance * 0.6);
}
