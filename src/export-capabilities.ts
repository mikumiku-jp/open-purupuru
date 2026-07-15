import type { ExportFormat } from "./types";

export type ExportCapabilities = Record<
  ExportFormat,
  { supported: boolean; reason?: string }
>;

const capabilityWidth = 720;
const capabilityHeight = 720;
const capabilityBitrate = 4_000_000;
const capabilityFramerate = 30;

function createFallbackCapabilities(): ExportCapabilities {
  return {
    mp4: { supported: false, reason: "WebCodecs" },
    webm: { supported: false, reason: "WebCodecs" },
    gif: { supported: true },
  };
}

async function canEncodeCodec(codec: string) {
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width: capabilityWidth,
      height: capabilityHeight,
      bitrate: capabilityBitrate,
      framerate: capabilityFramerate,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

export async function inspectExportCapabilities(): Promise<ExportCapabilities> {
  const fallbackCapabilities = createFallbackCapabilities();
  if (!isSecureContext || typeof VideoEncoder === "undefined") {
    return fallbackCapabilities;
  }

  const [canEncodeMp4, canEncodeVp9, canEncodeVp8] = await Promise.all([
    canEncodeCodec("avc1.42001f"),
    canEncodeCodec("vp09.00.10.08"),
    canEncodeCodec("vp8"),
  ]);
  const canEncodeWebm = canEncodeVp9 || canEncodeVp8;
  return {
    mp4: {
      supported: canEncodeMp4,
      reason: canEncodeMp4 ? undefined : "H.264",
    },
    webm: {
      supported: canEncodeWebm,
      reason: canEncodeWebm ? undefined : "VP9 / VP8",
    },
    gif: { supported: true },
  };
}
