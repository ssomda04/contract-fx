export type EffectName =
  | "fox-summon"
  | "finger-gun"
  | "pin-pull-transform"
  | "chain-recoil-transform";

export interface ActiveEffect {
  name: EffectName;
  /** Same clock as HandLandmarker's `timestampMs` (ms), captured when the effect started. */
  triggeredAt: number;
}
