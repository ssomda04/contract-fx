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
  "finger-gun": FingerGunVisual,
  "pin-pull-transform": PinPullTransformVisual,
  "chain-recoil-transform": ChainRecoilTransformVisual,
};

const CHAIN_SLASH_ANGLES_DEG = [-20, 0, 20];

const MUZZLE_BURST_ANGLES_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

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

function FingerGunVisual() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative flex h-40 w-40 items-center justify-center sm:h-56 sm:w-56">
        {/* muzzle flash */}
        <span className="absolute h-6 w-6 animate-[finger-gun-flash_0.35s_ease-out_forwards] rounded-full bg-amber-200 [box-shadow:0_0_50px_18px_rgba(253,230,138,0.85)]" />
        {/* radiating line burst */}
        {MUZZLE_BURST_ANGLES_DEG.map((deg) => (
          <span
            key={deg}
            className="absolute left-1/2 top-1/2 h-px w-0"
            style={{ transform: `translate(-50%, -50%) rotate(${deg}deg)` }}
          >
            <span className="absolute left-0 top-0 h-px w-16 origin-left animate-[finger-gun-line_0.45s_ease-out_forwards] bg-amber-200/90 sm:w-24" />
          </span>
        ))}
        {/* impact wave */}
        <span className="absolute inset-0 animate-[finger-gun-impact_0.6s_ease-out_forwards] rounded-full border-2 border-amber-100/70" />
      </div>
    </div>
  );
}

function PinPullTransformVisual() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative flex h-48 w-48 items-center justify-center sm:h-64 sm:w-64">
        {/* pull spark */}
        <span className="absolute h-3 w-3 animate-[pin-pull-spark_0.5s_ease-out_forwards] rounded-full bg-fuchsia-200 [box-shadow:0_0_30px_10px_rgba(232,121,249,0.8)]" />
        {/* shock rings */}
        <span className="absolute inset-0 animate-[pin-pull-ring_0.7s_ease-out_forwards] rounded-full border-2 border-fuchsia-300/70" />
        <span className="absolute inset-8 animate-[pin-pull-ring_0.7s_ease-out_forwards] rounded-full border border-fuchsia-200/50 [animation-delay:100ms]" />
      </div>
      <p className="absolute animate-[pin-pull-text_1.2s_ease-out_forwards] text-lg font-bold tracking-[0.3em] text-fuchsia-100 [text-shadow:0_0_16px_rgba(232,121,249,0.9)] sm:text-xl">
        PIN PULL
      </p>
    </div>
  );
}

function ChainRecoilTransformVisual() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative flex h-56 w-56 items-center justify-center sm:h-72 sm:w-72">
        {/* recoil burst */}
        <span className="absolute h-8 w-8 animate-[chain-recoil-burst_0.35s_ease-out_forwards] rounded-full bg-orange-200 [box-shadow:0_0_60px_20px_rgba(254,215,170,0.8)]" />
        {/* chain slashes */}
        {CHAIN_SLASH_ANGLES_DEG.map((deg) => (
          <span
            key={deg}
            className="absolute left-1/2 top-1/2 h-1 w-0"
            style={{ transform: `translate(-50%, -50%) rotate(${deg}deg)` }}
          >
            <span className="absolute left-0 top-0 h-1 w-32 origin-left animate-[chain-recoil-slash_0.4s_ease-out_forwards] rounded-full bg-orange-100/90 sm:w-44" />
          </span>
        ))}
        {/* impact shock */}
        <span className="absolute inset-0 animate-[chain-recoil-shock_0.65s_ease-out_forwards] rounded-full border-4 border-orange-200/70" />
      </div>
      <p className="absolute animate-[chain-recoil-text_1.2s_ease-out_forwards] text-lg font-bold tracking-[0.3em] text-orange-100 [text-shadow:0_0_16px_rgba(254,215,170,0.9)] sm:text-xl">
        CHAIN RECOIL
      </p>
    </div>
  );
}
