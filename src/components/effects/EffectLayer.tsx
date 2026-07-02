import type { ActiveEffect, EffectName } from "@/lib/effects/types";

interface EffectLayerProps {
  effect: ActiveEffect | null;
}

/**
 * Maps each effect name to the component that renders it. Today these are
 * pure-CSS placeholders; swapping one for a 3D model or image/video asset
 * later only means changing its entry here, not the dispatch logic below.
 */
const EFFECT_VISUALS: Record<EffectName, () => React.ReactNode> = {
  "fox-summon": FoxSummonVisual,
};

export function EffectLayer({ effect }: EffectLayerProps) {
  if (!effect) return null;

  const Visual = EFFECT_VISUALS[effect.name];

  return (
    // Keyed on trigger time so CSS animations restart on back-to-back
    // triggers even though this sibling tree never touches the video/canvas.
    <div key={effect.triggeredAt} className="pointer-events-none absolute inset-0 overflow-hidden">
      <Visual />
    </div>
  );
}

function FoxSummonVisual() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative flex h-56 w-56 items-center justify-center sm:h-72 sm:w-72">
        <span className="absolute inset-0 animate-[fox-summon-ring_1.5s_ease-out_forwards] rounded-full border-4 border-cyan-300/80 [box-shadow:0_0_40px_12px_rgba(34,211,238,0.35)]" />
        <span className="absolute inset-6 animate-[fox-summon-ring_1.5s_ease-out_forwards] rounded-full border-2 border-cyan-200/60 [animation-delay:120ms]" />
        <span className="absolute inset-12 animate-[fox-summon-ring_1.5s_ease-out_forwards] rounded-full border border-cyan-100/50 [animation-delay:240ms]" />
      </div>
      <p className="absolute animate-[fox-summon-text_1.5s_ease-out_forwards] text-xl font-bold tracking-[0.3em] text-cyan-100 [text-shadow:0_0_16px_rgba(34,211,238,0.9)] sm:text-2xl">
        FOX SUMMON
      </p>
    </div>
  );
}
