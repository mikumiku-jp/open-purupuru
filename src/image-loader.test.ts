import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedImage, hasAnimatedContent, loadImage } from "./image-loader";

function createPngChunk(type: string, payload: Uint8Array) {
  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(payload, 8);
  return chunk;
}

function createPng(chunks: Uint8Array[]) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const byteLength = signature.length + chunks.reduce(
    (total, chunk) => total + chunk.length,
    0,
  );
  const bytes = new Uint8Array(byteLength);
  bytes.set(signature);
  let offset = signature.length;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function createWebpChunk(type: string, payload: Uint8Array) {
  const paddedLength = payload.length + (payload.length % 2);
  const chunk = new Uint8Array(8 + paddedLength);
  const view = new DataView(chunk.buffer);
  chunk.set(new TextEncoder().encode(type), 0);
  view.setUint32(4, payload.length, true);
  chunk.set(payload, 8);
  return chunk;
}

function createWebp(chunks: Uint8Array[]) {
  const byteLength = 12 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  let offset = 12;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

describe("image animation detection", () => {
  it("does not treat marker text inside a static PNG chunk as animation", () => {
    const bytes = createPng([
      createPngChunk("tEXt", new TextEncoder().encode("note\0acTL")),
      createPngChunk("IEND", new Uint8Array()),
    ]);

    expect(hasAnimatedContent(bytes, "PNG")).toBe(false);
  });

  it("detects an actual PNG animation chunk", () => {
    const bytes = createPng([
      createPngChunk("acTL", new Uint8Array(8)),
      createPngChunk("IEND", new Uint8Array()),
    ]);

    expect(hasAnimatedContent(bytes, "PNG")).toBe(true);
  });

  it("only detects WebP animation markers used as chunk types", () => {
    const staticBytes = createWebp([
      createWebpChunk("EXIF", new TextEncoder().encode("note ANIM")),
    ]);
    const animatedBytes = createWebp([
      createWebpChunk("ANIM", new Uint8Array(6)),
    ]);

    expect(hasAnimatedContent(staticBytes, "WebP")).toBe(false);
    expect(hasAnimatedContent(animatedBytes, "WebP")).toBe(true);
  });
});

describe("image metadata validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a valid PNG when the browser omits its MIME type", async () => {
    const bytes = createPng([createPngChunk("IEND", new Uint8Array())]);
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      width: 32,
      height: 32,
      close,
    })));
    const file = new File([bytes], "image.png");

    const loadedImage = await loadImage([file]);

    expect(loadedImage.format).toBe("PNG");
    disposeLoadedImage(loadedImage);
    expect(close).toHaveBeenCalledOnce();
  });

  it("resizes large images without OffscreenCanvas support", async () => {
    const bytes = createPng([createPngChunk("IEND", new Uint8Array())]);
    const closeSource = vi.fn();
    const closeWorking = vi.fn();
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob([bytes], { type: "image/png" }));
    });
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage })),
        toBlob,
      })),
    });
    vi.stubGlobal("createImageBitmap", vi.fn()
      .mockResolvedValueOnce({ width: 2000, height: 1200, close: closeSource })
      .mockResolvedValueOnce({ width: 1859, height: 1115, close: closeWorking }));
    const file = new File([bytes], "large.png", { type: "image/png" });

    const loadedImage = await loadImage([file]);

    expect(loadedImage.optimized).toBe(true);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(closeSource).toHaveBeenCalledOnce();
    disposeLoadedImage(loadedImage);
    expect(closeWorking).toHaveBeenCalledOnce();
  });
});
