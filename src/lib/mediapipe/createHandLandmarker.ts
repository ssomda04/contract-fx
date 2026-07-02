import type { HandLandmarker, HandLandmarkerOptions } from "@mediapipe/tasks-vision";

// Keep in sync with the installed "@mediapipe/tasks-vision" version in package.json.
const MEDIAPIPE_WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

const HAND_LANDMARKER_MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export const HAND_LANDMARKER_RUNNING_MODE = "VIDEO" as const;

const MAX_NUM_HANDS = 2;

const HAND_LANDMARKER_OPTIONS: HandLandmarkerOptions = {
  baseOptions: {
    modelAssetPath: HAND_LANDMARKER_MODEL_ASSET_PATH,
    delegate: "GPU",
  },
  runningMode: HAND_LANDMARKER_RUNNING_MODE,
  numHands: MAX_NUM_HANDS,
};

/**
 * Loads the MediaPipe Wasm runtime and the hand landmark model. Dynamically
 * imports "@mediapipe/tasks-vision" so the (browser-only) module is never
 * evaluated during SSR — only call this from client-side code.
 */
export async function createHandLandmarker(): Promise<HandLandmarker> {
  const { FilesetResolver, HandLandmarker: HandLandmarkerCtor } = await import(
    "@mediapipe/tasks-vision"
  );

  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE_URL);

  return HandLandmarkerCtor.createFromOptions(vision, HAND_LANDMARKER_OPTIONS);
}
