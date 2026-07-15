import {
  stepFrame,
  WobblePhysics,
} from "./physics";
import type {
  FrameState,
  PhysicsInput,
  PhysicsInputEvent,
  PhysicsSnapshot,
} from "./physics";
import type {
  ExportFormat,
  ExportProgress,
  LoadedImage,
  MaskState,
  RecordingView,
} from "./types";
import { WobbleRenderer } from "./webgl-renderer";

type ExportOptions = {
  image: LoadedImage;
  mask: MaskState;
  initialSnapshot: PhysicsSnapshot;
  events: PhysicsInputEvent[];
  format: ExportFormat;
  durationSeconds: number;
  recordingView: RecordingView;
  shouldStop: () => boolean;
  onProgress: (progress: ExportProgress) => void;
};

export type ExportedMedia = {
  blob: Blob;
  width: number;
  height: number;
  durationSeconds: number;
  frameCount: number;
};

export class ExportCancelledError extends Error {
  constructor() {
    super("Export canceled");
    this.name = "ExportCancelledError";
  }
}

const maximumOutputBytes = 64 * 1024 * 1024;
const fullRecordArea = { x: 0, y: 0, width: 1, height: 1 };

function calculateOutputSize(image: LoadedImage, maximumSide: number) {
  const scale = Math.min(1, maximumSide / Math.max(image.width, image.height));
  const roundDimension = (dimension: number) =>
    Math.max(2, Math.round(dimension * scale / 2) * 2);
  return {
    width: roundDimension(image.width),
    height: roundDimension(image.height),
  };
}

function cloneFrame(frame: FrameState): FrameState {
  return {
    position: { ...frame.position },
    velocity: { ...frame.velocity },
    acceleration: { ...frame.acceleration },
  };
}

function getInputAtTick(
  events: PhysicsInputEvent[],
  eventCursor: { value: number },
  tick: number,
  currentInput: PhysicsInput,
) {
  let input = currentInput;
  while (eventCursor.value < events.length) {
    const event = events[eventCursor.value];
    if (!event || event.tick !== tick) break;
    input = event.payload;
    eventCursor.value += 1;
  }
  return input;
}

function calculateCropScale(options: ExportOptions) {
  if (options.recordingView !== "crop") return 1;
  const frame = cloneFrame(options.initialSnapshot.frame);
  const bounds = {
    minX: frame.position.x,
    maxX: frame.position.x,
    minY: frame.position.y,
    maxY: frame.position.y,
  };
  const eventCursor = { value: 0 };
  const fixedDeltaTime = 1 / options.initialSnapshot.quality.tickRate;
  const totalTicks = Math.ceil(options.durationSeconds / fixedDeltaTime);
  let currentInput: PhysicsInput = {};
  for (let tick = 0; tick < totalTicks; tick += 1) {
    currentInput = getInputAtTick(options.events, eventCursor, tick, currentInput);
    stepFrame(frame, currentInput, fixedDeltaTime);
    bounds.minX = Math.min(bounds.minX, frame.position.x);
    bounds.maxX = Math.max(bounds.maxX, frame.position.x);
    bounds.minY = Math.min(bounds.minY, frame.position.y);
    bounds.maxY = Math.max(bounds.maxY, frame.position.y);
  }
  const shortestSide = Math.min(options.image.width, options.image.height);
  const normalizedWidth = options.image.width / shortestSide;
  const normalizedHeight = options.image.height / shortestSide;
  const horizontalMotion = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX)) /
    normalizedWidth;
  const verticalMotion = Math.max(Math.abs(bounds.minY), Math.abs(bounds.maxY)) /
    normalizedHeight;
  const motion = Math.min(0.49, Math.max(0, horizontalMotion, verticalMotion));
  return 1 / (1 - motion * 2);
}

function createReplayRenderer(
  options: ExportOptions,
  canvas: HTMLCanvasElement,
) {
  const physics = new WobblePhysics(
    options.image.width,
    options.image.height,
    options.mask,
    options.initialSnapshot.parameters,
  );
  physics.restoreSnapshot(options.initialSnapshot);
  const renderer = new WobbleRenderer(canvas, options.image, physics);
  const eventCursor = { value: 0 };
  const foregroundScale = calculateCropScale(options);
  let currentInput: PhysicsInput = {};
  let replayTick = 0;

  const renderFrame = (frameIndex: number, fps: number) => {
    const frameTime = frameIndex / fps;
    const targetTick = Math.round(frameTime / physics.fixedDeltaTime);
    while (replayTick < targetTick) {
      currentInput = getInputAtTick(
        options.events,
        eventCursor,
        replayTick,
        currentInput,
      );
      physics.step(currentInput);
      replayTick += 1;
    }
    if (!physics.isFinite()) throw new Error("Physics replay produced a non-finite state");
    renderer.render({
      frameOffset: options.recordingView === "camera-follow"
        ? { x: 0, y: 0 }
        : physics.frame.position,
      recordArea: fullRecordArea,
      foregroundScale,
    });
  };

  return { renderer, renderFrame };
}

function validateEncodedSize(blob: Blob) {
  if (blob.size > maximumOutputBytes) {
    throw new Error("Encoded output exceeded the 64 MiB hard limit");
  }
}

async function exportGif(options: ExportOptions): Promise<ExportedMedia> {
  const { applyPalette, GIFEncoder, quantize } = await import("gifenc");
  const fps = 16;
  const size = calculateOutputSize(options.image, 480);
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = size.width;
  outputCanvas.height = size.height;
  const replay = createReplayRenderer(options, outputCanvas);
  const encoder = GIFEncoder();
  const frameCount = Math.max(1, Math.round(Math.min(5, options.durationSeconds) * fps));
  const rgba = new Uint8Array(size.width * size.height * 4);
  let palette: ReturnType<typeof quantize> | null = null;
  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (options.shouldStop()) throw new ExportCancelledError();
      replay.renderFrame(frameIndex, fps);
      replay.renderer.readRgba(rgba);
      palette ??= quantize(rgba, 256, { format: "rgb565" });
      const indexedPixels = applyPalette(rgba, palette, "rgb565");
      encoder.writeFrame(indexedPixels, size.width, size.height, {
        palette,
        delay: 1000 / fps,
        repeat: 0,
      });
      options.onProgress({ phase: "rendering", ratio: (frameIndex + 1) / frameCount });
      await new Promise(requestAnimationFrame);
    }
    options.onProgress({ phase: "encoding", ratio: 0.96 });
    encoder.finish();
    if (options.shouldStop()) throw new ExportCancelledError();
    const gifBytes = new Uint8Array(encoder.bytes());
    const blob = new Blob([gifBytes.buffer], { type: "image/gif" });
    validateEncodedSize(blob);
    return {
      blob,
      width: size.width,
      height: size.height,
      durationSeconds: frameCount / fps,
      frameCount,
    };
  } finally {
    replay.renderer.dispose();
    rgba.fill(0);
  }
}

async function selectWebMCodec(
  canEncodeVideo: typeof import("mediabunny")["canEncodeVideo"],
) {
  if (await canEncodeVideo("vp9", { width: 720, height: 720, bitrate: 4_000_000 })) {
    return "vp9" as const;
  }
  return "vp8" as const;
}

async function exportVideo(options: ExportOptions): Promise<ExportedMedia> {
  const {
    BufferTarget,
    canEncodeVideo,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    QUALITY_MEDIUM,
    WebMOutputFormat,
  } = await import("./mediabunny-video");
  const fps = 30;
  const size = calculateOutputSize(options.image, 720);
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = size.width;
  outputCanvas.height = size.height;
  const replay = createReplayRenderer(options, outputCanvas);
  const target = new BufferTarget();
  const format = options.format === "mp4"
    ? new Mp4OutputFormat({ fastStart: false })
    : new WebMOutputFormat();
  const output = new Output({ format, target });
  const codec = options.format === "mp4" ? "avc" : await selectWebMCodec(canEncodeVideo);
  const source = new CanvasSource(outputCanvas, {
    codec,
    bitrate: QUALITY_MEDIUM,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source);
  await output.start();
  const frameCount = Math.max(1, Math.round(Math.min(10, options.durationSeconds) * fps));
  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (options.shouldStop()) throw new ExportCancelledError();
      replay.renderFrame(frameIndex, fps);
      await source.add(frameIndex / fps, 1 / fps, {
        keyFrame: frameIndex % (fps * 2) === 0,
      });
      options.onProgress({ phase: "rendering", ratio: (frameIndex + 1) / frameCount });
    }
    options.onProgress({ phase: "encoding", ratio: 0.96 });
    await output.finalize();
    if (options.shouldStop()) throw new ExportCancelledError();
  } catch (caughtError) {
    if (output.state !== "finalized" && output.state !== "canceled") {
      await output.cancel();
    }
    throw caughtError;
  } finally {
    replay.renderer.dispose();
  }
  if (!target.buffer) throw new Error("Video encoder returned no data");
  const blob = new Blob([target.buffer], {
    type: options.format === "mp4" ? "video/mp4" : "video/webm",
  });
  validateEncodedSize(blob);
  return {
    blob,
    width: size.width,
    height: size.height,
    durationSeconds: frameCount / fps,
    frameCount,
  };
}

export async function exportMedia(options: ExportOptions) {
  return options.format === "gif" ? exportGif(options) : exportVideo(options);
}
