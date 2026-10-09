import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyCounters, liveTip, observe, summarize, type FrameObservation } from './aggregator.ts';

const frame = (o: Partial<FrameObservation> = {}): FrameObservation => ({
  faces: 1, offsetX: 0, offsetY: 0, widthFrac: 0.3, yawRatio: 0, luminance: 120, ...o,
});
const run = (frames: FrameObservation[]) => summarize(frames.reduce(observe, emptyCounters()));

test('face presence is a share of sampled frames', () => {
  const s = run([frame(), frame(), frame({ faces: 0 }), frame({ faces: 0 })]);
  assert.equal(s.sampledFrames, 4);
  assert.equal(s.facePresentPct, 50);
});

test('head-turn share only counts frames that have a face', () => {
  const s = run([frame(), frame({ yawRatio: 0.9 }), frame({ faces: 0 })]);
  assert.equal(s.facingScreenPct, 50);
});

test('framing and lighting buckets', () => {
  const s = run([frame({ widthFrac: 0.05 }), frame({ offsetX: 0.4 }), frame({ luminance: 20 }), frame({ luminance: 250 })]);
  assert.equal(s.framing.smallPct, 25);
  assert.equal(s.framing.offCenterPct, 25);
  assert.equal(s.framing.darkPct, 25);
  assert.equal(s.framing.brightPct, 25);
});

test('empty session summarizes to zeros without dividing by zero', () => {
  const s = summarize(emptyCounters());
  assert.deepEqual([s.sampledFrames, s.facePresentPct, s.facingScreenPct], [0, 0, 0]);
});

test('a still face is steadier than a moving one', () => {
  const still = run([frame(), frame(), frame()]);
  const moving = run([frame({ offsetX: -0.2 }), frame({ offsetX: 0.2 }), frame({ offsetX: -0.2 })]);
  assert.ok(still.steadiness > moving.steadiness);
});

test('summary contains only the closed set of numeric fields', () => {
  const keys = Object.keys(run([frame()])).sort();
  assert.deepEqual(keys, ['facePresentPct', 'facingScreenPct', 'framing', 'sampledFrames', 'steadiness']);
});

test('tips never describe emotion or personality', () => {
  const tips = [frame({ luminance: 10 }), frame({ faces: 0 }), frame({ widthFrac: 0.05 }), frame({ offsetX: 0.4 })].map(liveTip).join(' ');
  assert.doesNotMatch(tips, /confiden|nervous|engag|honest|emotion|stress/i);
});
