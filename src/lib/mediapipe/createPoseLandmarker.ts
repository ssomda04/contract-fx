import type { PoseLandmarker, PoseLandmarkerOptions } from "@mediapipe/tasks-vision";

// Keep in sync with the installed "@mediapipe/tasks-vision" version in package.json.
const MEDIAPIPE_WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

// "lite" variant: pin pull / chain recoil only need coarse torso anchors
// (shoulders, hips), not the full-precision model's extra accuracy.
const POSE_LANDMARKER_MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export const POSE_LANDMARKER_RUNNING_MODE = "VIDEO" as const;

const MAX_NUM_POSES = 1;

const POSE_LANDMARKER_OPTIONS: PoseLandmarkerOptions = {
  baseOptions: {
    modelAssetPath: POSE_LANDMARKER_MODEL_ASSET_PATH,
    delegate: "GPU",
  },
  runningMode: POSE_LANDMARKER_RUNNING_MODE,
  numPoses: MAX_NUM_POSES,
};

/**
 * Loads the MediaPipe Wasm runtime and the pose landmark model. Dynamically
 * imports "@mediapipe/tasks-vision" so the (browser-only) module is never
 * evaluated during SSR — only call this from client-side code.
 */
export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const { FilesetResolver, PoseLandmarker: PoseLandmarkerCtor } = await import(
    "@mediapipe/tasks-vision"
  );

  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE_URL);

  return PoseLandmarkerCtor.createFromOptions(vision, POSE_LANDMARKER_OPTIONS);
}
