export interface Point2D {
  x: number;
  y: number;
}

/**
 * A single hand landmark, including MediaPipe's normalized depth (`z`,
 * smaller/more negative = closer to the camera). Extends `Point2D` so
 * anything that only needs x/y (most geometry helpers) still accepts these
 * directly.
 */
export interface HandLandmark extends Point2D {
  z: number;
}

/** A single detected hand's normalized landmarks, indexed as in MediaPipe HandLandmarker. */
export type HandLandmarks = HandLandmark[];

/**
 * Static-pose detectors (fox summon, finger gun) use idle/detecting/holding;
 * motion-sequence detectors (pin pull, chain recoil) use idle/armed/pulling
 * instead, since their precondition (e.g. pinch near neck) and their pull
 * motion are meaningfully different stages, not a single held shape.
 */
export type GesturePhase =
  | "idle"
  | "detecting"
  | "holding"
  | "armed"
  | "pulling"
  | "triggered"
  | "cooldown";

export interface GestureState {
  currentGestureName: string | null;
  confidence: number;
  phase: GesturePhase;
  holdDurationMs: number;
  lastTriggeredAt: number | null;
  /** Optional per-detector score breakdown, for tuning against real camera data. Not every detector populates this. */
  debug?: Record<string, number>;
}

/** MediaPipe HandLandmarker's 21-point index layout, shared across detectors. */
export const HAND_LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;
