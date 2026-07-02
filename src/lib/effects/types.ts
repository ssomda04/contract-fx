export type EffectName = "fox-summon";

export interface ActiveEffect {
  name: EffectName;
  /** Same clock as HandLandmarker's `timestampMs` (ms), captured when the effect started. */
  triggeredAt: number;
}
