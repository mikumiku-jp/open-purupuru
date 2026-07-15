import type { ImageFormat, LoadedImage } from "./types";

const maximumFileBytes = 80 * 1024 * 1024;
const maximumWorkingSide = 1920;
const maximumWorkingPixels = 1920 * 1080;
const maximumSourceSide = 16384;
const maximumSourcePixels = 32_000_000;

export type ImageErrorCode =
  | "multiple"
  | "type"
  | "fileSize"
  | "animated"
  | "decode"
  | "dimensions";

export class ImageLoadError extends Error {
  readonly code: ImageErrorCode;

  constructor(code: ImageErrorCode) {
    super(code);
    this.name = "ImageLoadError";
    this.code = code;
  }
}

function matchesBytes(
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (matchesBytes(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return "PNG";
  if (matchesBytes(bytes, [255, 216, 255])) return "JPEG";
  if (
    matchesBytes(bytes, [82, 73, 70, 70]) &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) return "WebP";
  return null;
}

function hasAnimatedContent(bytes: Uint8Array, format: ImageFormat) {
  const marker = format === "PNG" ? "acTL" : format === "WebP" ? "ANIM" : null;
  if (!marker) return false;
  const markerBytes = Array.from(
    marker,
    (character) => character.charCodeAt(0),
  );
  for (
    let offset = 0;
    offset <= bytes.length - markerBytes.length;
    offset += 1
  ) {
    if (
      markerBytes.every((byte, index) => bytes[offset + index] === byte)
    ) return true;
  }
  return false;
}

function calculateWorkingSize(width: number, height: number) {
  const sideScale = Math.min(1, maximumWorkingSide / Math.max(width, height));
  const pixelScale = Math.min(
    1,
    Math.sqrt(maximumWorkingPixels / (width * height)),
  );
  const scale = Math.min(sideScale, pixelScale);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    optimized: scale < 1,
  };
}

function validateFileMetadata(file: File, format: ImageFormat) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const expectedMime = format === "PNG"
    ? "image/png"
    : format === "JPEG"
    ? "image/jpeg"
    : "image/webp";
  const validExtensions = format === "JPEG"
    ? ["jpg", "jpeg"]
    : [format.toLowerCase()];
  if (
    file.type !== expectedMime || !extension ||
    !validExtensions.includes(extension)
  ) throw new ImageLoadError("type");
}

async function createWorkingFile(
  file: File,
  sourceBitmap: ImageBitmap,
  width: number,
  height: number,
) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new ImageLoadError("decode");
  context.drawImage(sourceBitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${baseName}.purupuru-work.png`, {
    type: "image/png",
    lastModified: file.lastModified,
  });
}

export async function loadImage(
  files: FileList | File[],
): Promise<LoadedImage> {
  if (files.length !== 1) throw new ImageLoadError("multiple");
  const sourceFile = files[0];
  if (!sourceFile) throw new ImageLoadError("multiple");
  if (sourceFile.size > maximumFileBytes) throw new ImageLoadError("fileSize");

  const bytes = new Uint8Array(await sourceFile.arrayBuffer());
  const format = detectFormat(bytes);
  if (!format) throw new ImageLoadError("type");
  validateFileMetadata(sourceFile, format);
  if (hasAnimatedContent(bytes, format)) throw new ImageLoadError("animated");

  let sourceBitmap: ImageBitmap;
  try {
    sourceBitmap = await createImageBitmap(sourceFile, {
      imageOrientation: "from-image",
    });
  } catch {
    throw new ImageLoadError("decode");
  }

  const sourceWidth = sourceBitmap.width;
  const sourceHeight = sourceBitmap.height;
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    sourceWidth > maximumSourceSide ||
    sourceHeight > maximumSourceSide ||
    sourceWidth * sourceHeight > maximumSourcePixels
  ) {
    sourceBitmap.close();
    throw new ImageLoadError("dimensions");
  }

  const workingSize = calculateWorkingSize(sourceWidth, sourceHeight);
  let workingFile = sourceFile;
  let workingBitmap = sourceBitmap;
  if (workingSize.optimized) {
    try {
      workingFile = await createWorkingFile(
        sourceFile,
        sourceBitmap,
        workingSize.width,
        workingSize.height,
      );
      workingBitmap = await createImageBitmap(workingFile);
      sourceBitmap.close();
    } catch {
      sourceBitmap.close();
      throw new ImageLoadError("dimensions");
    }
  }

  return {
    file: workingFile,
    sourceName: sourceFile.name,
    sourceWidth,
    sourceHeight,
    width: workingBitmap.width,
    height: workingBitmap.height,
    format,
    optimized: workingSize.optimized,
    url: URL.createObjectURL(workingFile),
    bitmap: workingBitmap,
  };
}

export function disposeLoadedImage(image: LoadedImage | null) {
  if (!image) return;
  URL.revokeObjectURL(image.url);
  image.bitmap.close();
}
