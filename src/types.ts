export const languages = [
  "ja",
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "ru",
  "uk",
  "ko",
  "th",
  "id",
  "vi",
  "zh-CN",
  "zh-TW",
  "zh-HK",
] as const;

export type Language = (typeof languages)[number];

export type AppMode = "region-edit" | "play";

export type Point = {
  x: number;
  y: number;
};

export type BrushMode = "paint" | "erase";

export type MaskOperation = "add" | "subtract" | "replace";

export type MaskStroke = {
  id: number;
  mode: BrushMode;
  operation: MaskOperation;
  points: Point[];
  size: number;
  strength: number;
  target?: number;
};

export type MaskState = {
  baseFill: number;
  inverted: boolean;
  strokes: MaskStroke[];
};

export type ImageFormat = "PNG" | "JPEG" | "WebP";

export type LoadedImage = {
  file: File;
  sourceName: string;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  format: ImageFormat;
  optimized: boolean;
  url: string;
  bitmap: ImageBitmap;
};

export type GravityDirection = "none" | "down" | "up" | "left" | "right";

export type WobbleParameters = {
  inputStrength: number;
  stretch: number;
  bounce: number;
  damping: number;
  cohesion: number;
  gravityDirection: GravityDirection;
  gravityStrength: number;
  variation: number;
  maxStretch: number;
};

export type PresetId = "purupuru" | "sloshing" | "trembling" | "floating";

export type AutoMotion = "sway" | "hop" | "orbit" | null;

export type ExportFormat = "mp4" | "webm" | "gif";

export type RecordingView = "original" | "crop" | "camera-follow";

export type ExportProgress = {
  phase: "rendering" | "encoding";
  ratio: number;
};

export type ExportResult = {
  blob: Blob;
  url: string;
  format: ExportFormat;
  width: number;
  height: number;
  durationSeconds: number;
};

export type WobbleSurfaceHandle = {
  getCanvas: () => HTMLCanvasElement;
  getFrameOffset: () => Point;
  startCapture: () => import("./physics").PhysicsSnapshot;
  stopCapture: () => import("./physics").PhysicsInputEvent[];
};
