import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FrameObservation } from './aggregator';

/**
 * The TFLite wasm runtime reports its startup notice ("INFO: Created TensorFlow Lite XNNPACK delegate")
 * through console.error, which dev overlays show as an error. Drop only that line.
 */
let infoFiltered = false;
function silenceTfliteInfo() {
  if (infoFiltered) return;
  infoFiltered = true;
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('INFO: Created TensorFlow Lite')) return;
    original.apply(console, args);
  };
}

/** Assets are self-hosted under /vision so no video or request leaves the origin. */
export async function createDetector() {
  silenceTfliteInfo();
  const fileset = await FilesetResolver.forVisionTasks('/vision/wasm');
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/vision/models/blaze_face_short_range.tflite' },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.6,
  });

  const probe = document.createElement('canvas');
  probe.width = 32;
  probe.height = 24;
  const ctx = probe.getContext('2d', { willReadFrequently: true });

  const luminance = (v: HTMLVideoElement) => {
    if (!ctx) return 128;
    ctx.drawImage(v, 0, 0, probe.width, probe.height);
    const d = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  };

  return {
    observe(v: HTMLVideoElement): FrameObservation {
      const lum = luminance(v);
      const found = detector.detectForVideo(v, performance.now()).detections;
      const w = v.videoWidth || 1;
      const h = v.videoHeight || 1;
      const best = found.reduce<(typeof found)[number] | null>(
        (a, d) => ((d.boundingBox?.width ?? 0) > (a?.boundingBox?.width ?? 0) ? d : a), null);
      const box = best?.boundingBox;
      if (!best || !box) return { faces: 0, offsetX: 0, offsetY: 0, widthFrac: 0, yawRatio: null, luminance: lum };

      // BlazeFace keypoint order: right eye, left eye, nose tip, mouth, right ear, left ear.
      const [re, le, nose] = best.keypoints ?? [];
      const eyeDist = re && le ? Math.abs(le.x - re.x) : 0;
      const yawRatio = re && le && nose && eyeDist > 0.01 ? (nose.x - (re.x + le.x) / 2) / eyeDist : null;
      return {
        faces: found.length,
        offsetX: (box.originX + box.width / 2) / w - 0.5,
        offsetY: (box.originY + box.height / 2) / h - 0.5,
        widthFrac: box.width / w,
        yawRatio,
        luminance: lum,
      };
    },
    close: () => detector.close(),
  };
}
