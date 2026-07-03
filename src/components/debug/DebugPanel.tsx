import { Fragment } from "react";
import type { UseHandLandmarkerResult } from "@/hooks/useHandLandmarker";
import type { UsePoseLandmarkerResult } from "@/hooks/usePoseLandmarker";
import type { GestureState } from "@/lib/gestures/types";
import {
  estimateChestAnchor,
  estimateNeckAnchor,
  estimateShoulderWidth,
} from "@/lib/gestures/bodyAnchors";

interface DebugPanelProps extends UseHandLandmarkerResult {
  gesture: GestureState;
  pose: UsePoseLandmarkerResult;
}

const STATUS_LABEL: Record<UseHandLandmarkerResult["status"], string> = {
  loading: "모델 로딩 중",
  ready: "감지 중",
  error: "오류",
};

const GESTURE_PHASE_LABEL: Record<GestureState["phase"], string> = {
  idle: "idle",
  detecting: "detecting",
  holding: "holding",
  armed: "armed",
  pulling: "pulling",
  triggered: "triggered",
  cooldown: "cooldown",
};

export function DebugPanel({
  status,
  error,
  result,
  timestampMs,
  runningMode,
  gesture,
  pose,
}: DebugPanelProps) {
  const handDetected = (result?.landmarks.length ?? 0) > 0;

  const poseLandmarks = pose.result?.landmarks[0] ?? null;
  const poseDetected = poseLandmarks !== null;
  const shoulderWidth = poseLandmarks ? estimateShoulderWidth(poseLandmarks) : null;
  const neckAnchor = poseLandmarks ? estimateNeckAnchor(poseLandmarks) : null;
  const chestAnchor = poseLandmarks ? estimateChestAnchor(poseLandmarks) : null;

  return (
    <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-300">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-zinc-500">status</dt>
        <dd>{STATUS_LABEL[status]}</dd>

        <dt className="text-zinc-500">running mode</dt>
        <dd>{runningMode}</dd>

        <dt className="text-zinc-500">hand detected</dt>
        <dd>{handDetected ? "true" : "false"}</dd>

        <dt className="text-zinc-500">timestamp</dt>
        <dd>{timestampMs !== null ? `${timestampMs.toFixed(1)} ms` : "-"}</dd>
      </dl>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-zinc-800 pt-2">
        <dt className="text-zinc-500">gesture</dt>
        <dd>{gesture.currentGestureName ?? "-"}</dd>

        <dt className="text-zinc-500">phase</dt>
        <dd>{GESTURE_PHASE_LABEL[gesture.phase]}</dd>

        <dt className="text-zinc-500">confidence</dt>
        <dd>{gesture.confidence.toFixed(2)}</dd>

        <dt className="text-zinc-500">hold duration</dt>
        <dd>{gesture.holdDurationMs.toFixed(0)} ms</dd>
      </dl>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-zinc-800 pt-2">
        <dt className="text-zinc-500">pose detected</dt>
        <dd>{poseDetected ? "true" : "false"}</dd>

        <dt className="text-zinc-500">pose landmark count</dt>
        <dd>{poseLandmarks?.length ?? 0}</dd>

        <dt className="text-zinc-500">shoulderWidth</dt>
        <dd>{shoulderWidth !== null ? shoulderWidth.toFixed(3) : "-"}</dd>

        <dt className="text-zinc-500">neckApprox</dt>
        <dd>{neckAnchor ? `${neckAnchor.x.toFixed(3)}, ${neckAnchor.y.toFixed(3)}` : "-"}</dd>

        <dt className="text-zinc-500">chestApprox</dt>
        <dd>{chestAnchor ? `${chestAnchor.x.toFixed(3)}, ${chestAnchor.y.toFixed(3)}` : "-"}</dd>
      </dl>

      {gesture.debug && Object.keys(gesture.debug).length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-zinc-800 pt-2 text-zinc-400">
          {Object.entries(gesture.debug).map(([key, value]) => (
            <Fragment key={key}>
              <dt className="text-zinc-600">{key}</dt>
              <dd>{value.toFixed(3)}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      {error && <p className="mt-2 text-red-400">{error}</p>}

      {result && result.landmarks.length > 0 && (
        <ul className="mt-3 space-y-1">
          {result.landmarks.map((landmarks, index) => {
            const topHandedness = result.handedness[index]?.[0];
            return (
              <li
                key={index}
                className="flex justify-between gap-2 border-t border-zinc-800 pt-1"
              >
                <span>hand[{index}]</span>
                <span>
                  {topHandedness
                    ? `${topHandedness.categoryName} (${(topHandedness.score * 100).toFixed(0)}%)`
                    : "-"}
                </span>
                <span>{landmarks.length} landmarks</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
