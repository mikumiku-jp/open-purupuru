import type { PresetId, WobbleParameters } from "./types";

export const presets: Record<PresetId, WobbleParameters> = {
  purupuru: {
    inputStrength: 82,
    stretch: 90,
    bounce: 28,
    damping: 8,
    cohesion: 8,
    gravityDirection: "down",
    gravityStrength: 1,
    variation: 5,
    maxStretch: 100,
  },
  sloshing: {
    inputStrength: 72,
    stretch: 55,
    bounce: 95,
    damping: 20,
    cohesion: 50,
    gravityDirection: "down",
    gravityStrength: 0.8,
    variation: 0,
    maxStretch: 85,
  },
  trembling: {
    inputStrength: 55,
    stretch: 70,
    bounce: 88,
    damping: 30,
    cohesion: 50,
    gravityDirection: "down",
    gravityStrength: 0.9,
    variation: 30,
    maxStretch: 40,
  },
  floating: {
    inputStrength: 46,
    stretch: 100,
    bounce: 15,
    damping: 0,
    cohesion: 0,
    gravityDirection: "none",
    gravityStrength: 0,
    variation: 50,
    maxStretch: 100,
  },
};

export const presetOrder = Object.keys(presets) as PresetId[];
