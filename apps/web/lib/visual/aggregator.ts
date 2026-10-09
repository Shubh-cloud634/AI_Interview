/** One observation from a single processed frame. Nothing here identifies a person or keeps pixels. */
export type FrameObservation = {
  faces: number;
  /** Face box as fractions of the frame: center offset from frame center and width. */
  offsetX: number;
  offsetY: number;
  widthFrac: number;
  /** Nose offset from the eye midpoint, in eye-distances. A coarse head-turn proxy. */
  yawRatio: number | null;
  luminance: number;
};

export type VisualSummary = {
  sampledFrames: number;
  facePresentPct: number;
  facingScreenPct: number;
  framing: { smallPct: number; offCenterPct: number; darkPct: number; brightPct: number };
  steadiness: number;
};

export const THRESHOLDS = {
  yawRatioMax: 0.45,
  smallWidth: 0.14,
  offCenter: 0.3,
  dark: 55,
  bright: 215,
} as const;

export type Counters = {
  frames: number;
  withFace: number;
  facing: number;
  small: number;
  offCenter: number;
  dark: number;
  bright: number;
  moveSum: number;
  moveN: number;
  last: { x: number; y: number } | null;
};

export const emptyCounters = (): Counters => ({
  frames: 0, withFace: 0, facing: 0, small: 0, offCenter: 0, dark: 0, bright: 0, moveSum: 0, moveN: 0, last: null,
});

export function observe(c: Counters, o: FrameObservation): Counters {
  const n: Counters = { ...c, frames: c.frames + 1 };
  if (o.luminance < THRESHOLDS.dark) n.dark++;
  if (o.luminance > THRESHOLDS.bright) n.bright++;
  if (o.faces === 0) return { ...n, last: null };

  n.withFace++;
  if (o.yawRatio !== null && Math.abs(o.yawRatio) <= THRESHOLDS.yawRatioMax) n.facing++;
  if (o.widthFrac < THRESHOLDS.smallWidth) n.small++;
  if (Math.hypot(o.offsetX, o.offsetY) > THRESHOLDS.offCenter) n.offCenter++;
  if (c.last) {
    n.moveSum += Math.hypot(o.offsetX - c.last.x, o.offsetY - c.last.y);
    n.moveN++;
  }
  n.last = { x: o.offsetX, y: o.offsetY };
  return n;
}

const share = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

export function summarize(c: Counters): VisualSummary {
  const avgMove = c.moveN ? c.moveSum / c.moveN : 0;
  return {
    sampledFrames: c.frames,
    facePresentPct: share(c.withFace, c.frames),
    facingScreenPct: share(c.facing, c.withFace),
    framing: {
      smallPct: share(c.small, c.withFace),
      offCenterPct: share(c.offCenter, c.withFace),
      darkPct: share(c.dark, c.frames),
      brightPct: share(c.bright, c.frames),
    },
    steadiness: Math.max(0, Math.round((1 - Math.min(1, avgMove * 8)) * 100)),
  };
}

export function liveTip(o: FrameObservation | null): string | null {
  if (!o) return null;
  if (o.luminance < THRESHOLDS.dark) return 'The image is dark. Face a light source if you can.';
  if (o.luminance > THRESHOLDS.bright) return 'The image is very bright. Reduce light behind or in front of you.';
  if (o.faces === 0) return 'No face is in view of the camera.';
  if (o.widthFrac < THRESHOLDS.smallWidth) return 'Your face is small in the frame. Move a little closer.';
  if (Math.hypot(o.offsetX, o.offsetY) > THRESHOLDS.offCenter) return 'You are off to one side of the frame.';
  return null;
}
