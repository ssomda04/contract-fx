import type { UseHandLandmarkerResult } from "@/hooks/useHandLandmarker";

type DebugPanelProps = UseHandLandmarkerResult;

const STATUS_LABEL: Record<UseHandLandmarkerResult["status"], string> = {
  loading: "모델 로딩 중",
  ready: "감지 중",
  error: "오류",
};

export function DebugPanel({
  status,
  error,
  result,
  timestampMs,
  runningMode,
}: DebugPanelProps) {
  const handDetected = (result?.landmarks.length ?? 0) > 0;

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
