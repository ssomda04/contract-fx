export interface Point2D {
  x: number;
  y: number;
}

/** A single detected hand's normalized landmarks, indexed as in MediaPipe HandLandmarker. */
export type HandLandmarks = Point2D[];

export type GesturePhase = "idle" | "detecting" | "holding" | "triggered" | "cooldown";

export interface GestureState {
  currentGestureName: string | null;
  confidence: number;
  phase: GesturePhase;
  holdDurationMs: number;
  lastTriggeredAt: number | null;
}
