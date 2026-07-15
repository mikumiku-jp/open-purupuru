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

function readChunkType(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) return null;
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function hasPngAnimationChunk(bytes: Uint8Array) {
  const byteView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const payloadLength = byteView.getUint32(offset);
    const chunkEnd = offset + 12 + payloadLength;
    if (chunkEnd > bytes.length) return false;
    if (readChunkType(bytes, offset + 4) === "acTL") return true;
    offset = chunkEnd;
  }
  return false;
}

function hasWebpAnimationChunk(bytes: Uint8Array) {
  const byteView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const payloadLength = byteView.getUint32(offset + 4, true);
    const paddedLength = payloadLength + (payloadLength % 2);
    const chunkEnd = offset + 8 + paddedLength;
    if (chunkEnd > bytes.length) return false;
    if (readChunkType(bytes, offset) === "ANIM") return true;
    offset = chunkEnd;
  }
  return false;
}

export function hasAnimatedContent(bytes: Uint8Array, format: ImageFormat) {
  if (format === "PNG") return hasPngAnimationChunk(bytes);
  if (format === "WebP") return hasWebpAnimationChunk(bytes);
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
  const extensionSeparator = file.name.lastIndexOf(".");
  const extension = extensionSeparator >= 0 && extensionSeparator < file.name.length - 1
    ? file.name.slice(extensionSeparator + 1).toLowerCase()
    : null;
  const validMimes = format === "PNG"
    ? ["image/png"]
    : format === "JPEG"
    ? ["image/jpeg", "image/jpg"]
    : ["image/webp"];
  const validExtensions = format === "JPEG"
    ? ["jpg", "jpeg"]
    : [format.toLowerCase()];
  const normalizedMime = file.type.toLowerCase();
  if (normalizedMime && !validMimes.includes(normalizedMime)) {
    throw new ImageLoadError("type");
  }
  if (extension && !validExtensions.includes(extension)) {
    throw new ImageLoadError("type");
  }
}

async function createWorkingFile(
  file: File,
  sourceBitmap: ImageBitmap,
  width: number,
  height: number,
) {
  let blob: Blob;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new ImageLoadError("decode");
    context.drawImage(sourceBitmap, 0, 0, width, height);
    blob = await canvas.convertToBlob({ type: "image/png" });
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new ImageLoadError("decode");
    context.drawImage(sourceBitmap, 0, 0, width, height);
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((createdBlob) => {
        if (createdBlob) resolve(createdBlob);
        else reject(new ImageLoadError("decode"));
      }, "image/png");
    });
  }
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
