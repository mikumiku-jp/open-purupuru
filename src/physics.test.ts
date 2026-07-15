import { describe, expect, it } from "vitest";
import {
  getAutomaticMotionTarget,
  getManualDragTarget,
  resolveAutomaticAmplitude,
} from "./automatic-motion";
import {
  emptyMask,
  getBrushStrengthColor,
  getMaskStrengthColor,
  sampleMask,
} from "./mask";
import { WobblePhysics } from "./physics";
import { presets } from "./presets";
import type { PhysicsInput } from "./physics";
import type { MaskState } from "./types";

const fullMask: MaskState = {
  baseFill: 1,
  inverted: false,
  strokes: [],
};

function getInput(tick: number): PhysicsInput {
  if (tick < 20) {
    return {
      frameDragging: true,
      frameTarget: { x: 0.06, y: -0.025 },
      localAcceleration: { x: 0, y: 0 },
      automaticAcceleration: { x: 0, y: 0 },
    };
  }
  if (tick < 45) {
    return {
      frameDragging: true,
      frameTarget: { x: -0.035, y: 0.04 },
      localAcceleration: { x: 0.2, y: -0.1 },
      automaticAcceleration: { x: 0, y: 0 },
    };
  }
  return {
    frameDragging: false,
    frameTarget: { x: 0, y: 0 },
    localAcceleration: { x: 0, y: 0 },
    automaticAcceleration: { x: 0, y: 0 },
  };
}

describe("automatic motion", () => {
  it("maps strength through the original amplitude curve", () => {
    expect(resolveAutomaticAmplitude(0)).toBe(0);
    expect(resolveAutomaticAmplitude(25)).toBe(0.3);
    expect(resolveAutomaticAmplitude(50)).toBe(0.6);
    expect(resolveAutomaticAmplitude(80)).toBe(0.84);
    expect(resolveAutomaticAmplitude(100)).toBe(1);
  });

  it("keeps every automatic mode deterministic", () => {
    expect(getAutomaticMotionTarget("sway", 0, 50, 1000)).toEqual({
      x: -0.6,
      y: 0,
    });
    expect(getAutomaticMotionTarget("orbit", 0, 50, 1000)).toEqual({
      x: 0.534,
      y: 0,
    });
    expect(getAutomaticMotionTarget("hop", 0, 50, 1000)).toEqual(
      getAutomaticMotionTarget("hop", 0, 50, 1000),
    );
  });

  it("caps manual travel at the original limit", () => {
    const target = getManualDragTarget(
      { x: 0, y: 0 },
      { x: 500, y: 500 },
      100,
    );
    expect(Math.hypot(target.x, target.y)).toBeCloseTo(0.08, 12);
  });
});

describe("mask", () => {
  it("applies paint, erase, and inversion in order", () => {
    const paintedMask: MaskState = {
      ...emptyMask,
      strokes: [{
        id: 1,
        mode: "paint",
        operation: "replace",
        target: 0.75,
        strength: 0.75,
        size: 0.5,
        points: [{ x: 0.5, y: 0.5 }],
      }],
    };
    expect(sampleMask(paintedMask, 0.5, 0.5)).toBe(0.75);
    expect(sampleMask({ ...paintedMask, inverted: true }, 0.5, 0.5)).toBe(0.25);
    expect(sampleMask(paintedMask, 0, 0)).toBe(0);
  });

  it("uses the original thermography color stops", () => {
    expect(getMaskStrengthColor(0)).toEqual([0, 0, 0, 0]);
    expect(getMaskStrengthColor(0.55).slice(0, 3)).toEqual([255, 216, 64]);
    expect(getMaskStrengthColor(1).slice(0, 3)).toEqual([239, 54, 72]);
    expect(getBrushStrengthColor(1)).toBe("rgb(239 54 72)");
  });
});

describe("physics replay", () => {
  it("restores every solver state needed for an identical continuation", () => {
    const source = new WobblePhysics(320, 240, fullMask, presets.purupuru);
    for (let tick = 0; tick < 5; tick += 1) source.step(getInput(tick));
    const snapshot = source.createSnapshot();
    for (let tick = 5; tick < 15; tick += 1) source.step(getInput(tick));

    const replay = new WobblePhysics(320, 240, fullMask, presets.purupuru);
    replay.restoreSnapshot(snapshot);
    for (let tick = 5; tick < 15; tick += 1) replay.step(getInput(tick));

    expect(replay.createSnapshot()).toEqual(source.createSnapshot());
    expect(replay.isFinite()).toBe(true);
  });

  it("preserves the established solver output", () => {
    const physics = new WobblePhysics(320, 240, fullMask, presets.purupuru);
    for (let tick = 0; tick < 15; tick += 1) physics.step(getInput(tick));
    const snapshot = physics.createSnapshot();
    const sum = (values: number[]) =>
      values.reduce((total, value) => total + value, 0);
    const sumSquares = (values: number[]) =>
      values.reduce((total, value) => total + value * value, 0);

    expect(snapshot.tick).toBe(15);
    expect(snapshot.randomState).toBe(428790955);
    expect(sum(snapshot.positions)).toBeCloseTo(324.8518946604567, 10);
    expect(sumSquares(snapshot.positions)).toBeCloseTo(878.4053114933693, 10);
    expect(sum(snapshot.velocities)).toBeCloseTo(1395.462960073129, 10);
    expect(sumSquares(snapshot.velocities)).toBeCloseTo(9485.792149834508, 10);
    expect(sum(snapshot.secondaryOffsets)).toBeCloseTo(-47.00401622629108, 10);
    expect(snapshot.frame.position.x).toBeCloseTo(0.059990492320493055, 12);
    expect(snapshot.frame.position.y).toBeCloseTo(-0.02499603846687211, 12);
    expect(snapshot.frame.velocity.x).toBeCloseTo(0.0009036119432703771, 12);
    expect(snapshot.frame.velocity.y).toBeCloseTo(-0.0003765049763626571, 12);
    expect(snapshot.frame.acceleration.x).toBeCloseTo(-0.08587947705044341, 12);
    expect(snapshot.frame.acceleration.y).toBeCloseTo(0.03578311543772639, 12);
  });
});
