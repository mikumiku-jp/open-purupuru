declare module "gifenc" {
  type Palette = number[][];

  type QuantizeOptions = {
    format?: "rgb565" | "rgb444" | "rgba4444";
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
  };

  type WriteFrameOptions = {
    palette: Palette;
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    colorDepth?: number;
    dispose?: number;
  };

  type Encoder = {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options: WriteFrameOptions,
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };

  export function GIFEncoder(): Encoder;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maximumColors: number,
    options?: QuantizeOptions,
  ): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}
