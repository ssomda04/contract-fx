export interface HandConnection {
  start: number;
  end: number;
}

/**
 * Mirrors the topology of MediaPipe's `HandLandmarker.HAND_CONNECTIONS`
 * (21-point hand skeleton). Defined as a plain data array instead of reading
 * it off the class so this module never needs to import the browser-only
 * "@mediapipe/tasks-vision" package — safe to import from anywhere, SSR included.
 */
export const HAND_CONNECTIONS: HandConnection[] = [
  { start: 0, end: 1 },
  { start: 1, end: 2 },
  { start: 2, end: 3 },
  { start: 3, end: 4 },
  { start: 0, end: 5 },
  { start: 5, end: 6 },
  { start: 6, end: 7 },
  { start: 7, end: 8 },
  { start: 5, end: 9 },
  { start: 9, end: 10 },
  { start: 10, end: 11 },
  { start: 11, end: 12 },
  { start: 9, end: 13 },
  { start: 13, end: 14 },
  { start: 14, end: 15 },
  { start: 15, end: 16 },
  { start: 13, end: 17 },
  { start: 17, end: 18 },
  { start: 18, end: 19 },
  { start: 19, end: 20 },
  { start: 0, end: 17 },
];
