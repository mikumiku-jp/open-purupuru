import { sampleMask } from "./mask";
import type { GravityDirection, MaskState, Point, WobbleParameters } from "./types";

export type Mesh = {
  columns: number;
  rows: number;
  restPositions: Float64Array;
  positions: Float64Array;
  previousPositions: Float64Array;
  velocities: Float64Array;
  weights: Float64Array;
  inverseMasses: Float64Array;
  uvs: Float32Array;
  indices: Uint32Array;
};

export type PhysicsInput = {
  frameDragging?: boolean;
  frameTarget?: Point;
  frameTravelLimit?: number;
  localAcceleration?: Point;
  automaticAcceleration?: Point;
};

export type PhysicsInputEvent = {
  tick: number;
  type: "physics-input";
  payload: PhysicsInput;
};

export type PhysicsSnapshot = {
  version: 1;
  seed: number;
  tick: number;
  accumulator: number;
  randomState: number;
  gravityElapsedSeconds: number;
  parameters: WobbleParameters;
  quality: { tickRate: number; iterations: number; maxCatchUpSteps: number };
  positions: number[];
  previousPositions: number[];
  velocities: number[];
  secondaryOffsets: number[];
  secondaryVelocities: number[];
  frame: FrameState;
  constraintLambdas: {
    tetherX: number[];
    tetherY: number[];
    distance: number[];
    maximumDistance: number[];
    area: number[];
  };
  clusterRotations: number[];
};

type DistanceConstraints = {
  verticesA: Uint16Array;
  verticesB: Uint16Array;
  restLengths: Float64Array;
};
type AreaConstraints = {
  verticesA: Uint16Array;
  verticesB: Uint16Array;
  verticesC: Uint16Array;
  minimumAreas: Float64Array;
};
type Constraints = {
  distances: DistanceConstraints;
  areas: AreaConstraints;
  tetherX: Float64Array;
  tetherY: Float64Array;
  distanceLambdas: Float64Array;
  maximumDistanceLambdas: Float64Array;
  areaLambdas: Float64Array;
};
type Cluster = {
  vertices: Uint32Array;
  restCenterX: number;
  restCenterY: number;
  previousRotation: number;
};
type ResolvedParameters = {
  inputGain: number;
  distanceCompliance: number;
  tetherCompliance: number;
  shapeStrength: number;
  dampingRate: number;
  gravityAcceleration: number;
  gravityTargetDisplacement: number;
  floatingAcceleration: number;
  fluctuationAcceleration: number;
  maximumStretchRatio: number;
  maximumDisplacement: number;
  maximumSpeed: number;
  secondaryMotionStrength: number;
  secondaryFrequency: number;
  secondaryDampingRatio: number;
  secondaryVerticalBias: number;
  secondaryPhaseSpread: number;
  elongationStrength: number;
  tremorStrength: number;
  tremorFrequency: number;
};
export type FrameState = { position: Point; velocity: Point; acceleration: Point };

const epsilon = 1e-9;
const fixedDeltaTime = 1 / 120;
const solverIterations = 4;
const maximumCatchUpSteps = 4;
const defaultFrameTravel = 0.08;
const extendedFrameTravel = 0.16;
const inputAccelerationScale = 1.6;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampVector(point: Point, maximumLength: number) {
  const length = Math.sqrt(point.x * point.x + point.y * point.y);
  if (length <= maximumLength || length < epsilon) return point;
  const scale = maximumLength / length;
  return { x: point.x * scale, y: point.y * scale };
}

function calculateTriangleArea(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) {
  return 0.5 * ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
}

function getVertexDistance(positions: Float64Array, a: number, b: number) {
  return Math.hypot(
    (positions[a * 2] ?? 0) - (positions[b * 2] ?? 0),
    (positions[a * 2 + 1] ?? 0) - (positions[b * 2 + 1] ?? 0),
  );
}

function getGridDimensions(width: number, height: number, resolution = 64) {
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError("Image dimensions must be positive");
  }
  return width >= height
    ? { columns: resolution, rows: Math.max(4, Math.round(resolution * height / width)) }
    : { columns: Math.max(4, Math.round(resolution * width / height)), rows: resolution };
}

function createMesh(width: number, height: number, mask: MaskState): Mesh {
  const { columns, rows } = getGridDimensions(width, height);
  const stride = columns + 1;
  const vertexCount = stride * (rows + 1);
  const restPositions = new Float64Array(vertexCount * 2);
  const uvs = new Float32Array(vertexCount * 2);
  const weights = new Float64Array(vertexCount);
  const shortestSide = Math.min(width, height);
  const normalizedWidth = width / shortestSide;
  const normalizedHeight = height / shortestSide;

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const vertexIndex = row * stride + column;
      restPositions[vertexIndex * 2] = (u - 0.5) * normalizedWidth;
      restPositions[vertexIndex * 2 + 1] = (v - 0.5) * normalizedHeight;
      uvs[vertexIndex * 2] = u;
      uvs[vertexIndex * 2 + 1] = v;
      weights[vertexIndex] = clamp(sampleMask(mask, u, v), 0, 1);
    }
  }

  const indices = new Uint32Array(columns * rows * 6);
  let indexOffset = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;
      indices[indexOffset] = topLeft;
      indices[indexOffset + 1] = topRight;
      indices[indexOffset + 2] = bottomRight;
      indices[indexOffset + 3] = topLeft;
      indices[indexOffset + 4] = bottomRight;
      indices[indexOffset + 5] = bottomLeft;
      indexOffset += 6;
    }
  }

  return {
    columns,
    rows,
    restPositions,
    positions: restPositions.slice(),
    previousPositions: restPositions.slice(),
    velocities: new Float64Array(vertexCount * 2),
    uvs,
    indices,
    weights,
    inverseMasses: Float64Array.from(weights, (weight) => Number(weight > 0)),
  };
}

function createConstraints(mesh: Mesh, minimumAreaRatio = 0.08): Constraints {
  const distanceVerticesA: number[] = [];
  const distanceVerticesB: number[] = [];
  const distanceRestLengths: number[] = [];
  const areaVerticesA: number[] = [];
  const areaVerticesB: number[] = [];
  const areaVerticesC: number[] = [];
  const minimumAreas: number[] = [];
  const stride = mesh.columns + 1;
  const addDistance = (a: number, b: number) => {
    if ((mesh.inverseMasses[a] ?? 0) <= 0 && (mesh.inverseMasses[b] ?? 0) <= 0) return;
    distanceVerticesA.push(a);
    distanceVerticesB.push(b);
    distanceRestLengths.push(getVertexDistance(mesh.restPositions, a, b));
  };
  const addArea = (a: number, b: number, c: number) => {
    if (
      (mesh.inverseMasses[a] ?? 0) <= 0 &&
      (mesh.inverseMasses[b] ?? 0) <= 0 &&
      (mesh.inverseMasses[c] ?? 0) <= 0
    ) return;
    const area = calculateTriangleArea(
      mesh.restPositions[a * 2] ?? 0,
      mesh.restPositions[a * 2 + 1] ?? 0,
      mesh.restPositions[b * 2] ?? 0,
      mesh.restPositions[b * 2 + 1] ?? 0,
      mesh.restPositions[c * 2] ?? 0,
      mesh.restPositions[c * 2 + 1] ?? 0,
    );
    areaVerticesA.push(a);
    areaVerticesB.push(b);
    areaVerticesC.push(c);
    minimumAreas.push(area * minimumAreaRatio);
  };

  for (let row = 0; row <= mesh.rows; row += 1) {
    for (let column = 0; column <= mesh.columns; column += 1) {
      const vertexIndex = row * stride + column;
      if (column < mesh.columns) addDistance(vertexIndex, vertexIndex + 1);
      if (row < mesh.rows) addDistance(vertexIndex, vertexIndex + stride);
      if (column < mesh.columns && row < mesh.rows) {
        addDistance(vertexIndex, vertexIndex + stride + 1);
        addDistance(vertexIndex + 1, vertexIndex + stride);
        const topRight = vertexIndex + 1;
        const bottomLeft = vertexIndex + stride;
        const bottomRight = bottomLeft + 1;
        addArea(vertexIndex, topRight, bottomRight);
        addArea(vertexIndex, bottomRight, bottomLeft);
      }
    }
  }

  return {
    distances: {
      verticesA: Uint16Array.from(distanceVerticesA),
      verticesB: Uint16Array.from(distanceVerticesB),
      restLengths: Float64Array.from(distanceRestLengths),
    },
    areas: {
      verticesA: Uint16Array.from(areaVerticesA),
      verticesB: Uint16Array.from(areaVerticesB),
      verticesC: Uint16Array.from(areaVerticesC),
      minimumAreas: Float64Array.from(minimumAreas),
    },
    tetherX: new Float64Array(mesh.weights.length),
    tetherY: new Float64Array(mesh.weights.length),
    distanceLambdas: new Float64Array(distanceRestLengths.length),
    maximumDistanceLambdas: new Float64Array(distanceRestLengths.length),
    areaLambdas: new Float64Array(minimumAreas.length),
  };
}

function resetConstraintLambdas(constraints: Constraints) {
  constraints.tetherX.fill(0);
  constraints.tetherY.fill(0);
  constraints.distanceLambdas.fill(0);
  constraints.maximumDistanceLambdas.fill(0);
  constraints.areaLambdas.fill(0);
}

function solveTetherConstraints(
  mesh: Mesh,
  constraints: Constraints,
  compliance: number,
  deltaSeconds: number,
  targetOffsets: Float64Array,
) {
  const alpha = compliance / (deltaSeconds * deltaSeconds);
  for (let vertexIndex = 0; vertexIndex < mesh.weights.length; vertexIndex += 1) {
    const inverseMass = mesh.inverseMasses[vertexIndex] ?? 0;
    if (inverseMass <= 0) continue;
    const positionOffset = vertexIndex * 2;
    const denominator = inverseMass + alpha;
    const targetX = (mesh.restPositions[positionOffset] ?? 0) +
      (targetOffsets[positionOffset] ?? 0);
    const previousLambdaX = constraints.tetherX[vertexIndex] ?? 0;
    const lambdaDeltaX = (
      -((mesh.positions[positionOffset] ?? 0) - targetX) - alpha * previousLambdaX
    ) / denominator;
    constraints.tetherX[vertexIndex] = previousLambdaX + lambdaDeltaX;
    mesh.positions[positionOffset] = (mesh.positions[positionOffset] ?? 0) +
      inverseMass * lambdaDeltaX;
    const targetY = (mesh.restPositions[positionOffset + 1] ?? 0) +
      (targetOffsets[positionOffset + 1] ?? 0);
    const previousLambdaY = constraints.tetherY[vertexIndex] ?? 0;
    const lambdaDeltaY = (
      -((mesh.positions[positionOffset + 1] ?? 0) - targetY) -
      alpha * previousLambdaY
    ) / denominator;
    constraints.tetherY[vertexIndex] = previousLambdaY + lambdaDeltaY;
    mesh.positions[positionOffset + 1] = (mesh.positions[positionOffset + 1] ?? 0) +
      inverseMass * lambdaDeltaY;
  }
}

function solveDistanceConstraints(
  mesh: Mesh,
  constraints: Constraints,
  compliance: number,
  deltaSeconds: number,
) {
  const alpha = compliance / (deltaSeconds * deltaSeconds);
  const positions = mesh.positions;
  const inverseMasses = mesh.inverseMasses;
  const { verticesA, verticesB, restLengths } = constraints.distances;
  const lambdas = constraints.distanceLambdas;
  for (
    let constraintIndex = 0;
    constraintIndex < restLengths.length;
    constraintIndex += 1
  ) {
    const a = verticesA[constraintIndex] ?? 0;
    const b = verticesB[constraintIndex] ?? 0;
    const restLength = restLengths[constraintIndex] ?? 0;
    const positionOffsetA = a * 2;
    const positionOffsetB = b * 2;
    const ax = positions[positionOffsetA] ?? 0;
    const ay = positions[positionOffsetA + 1] ?? 0;
    const bx = positions[positionOffsetB] ?? 0;
    const by = positions[positionOffsetB + 1] ?? 0;
    const deltaX = ax - bx;
    const deltaY = ay - by;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (distance < epsilon) continue;
    const inverseMassA = inverseMasses[a] ?? 0;
    const inverseMassB = inverseMasses[b] ?? 0;
    const denominator = inverseMassA + inverseMassB + alpha;
    if (denominator < epsilon) continue;
    const previousLambda = lambdas[constraintIndex] ?? 0;
    const lambdaDelta = (-(distance - restLength) - alpha * previousLambda) /
      denominator;
    lambdas[constraintIndex] = previousLambda + lambdaDelta;
    const directionX = deltaX / distance;
    const directionY = deltaY / distance;
    positions[positionOffsetA] = ax + inverseMassA * directionX * lambdaDelta;
    positions[positionOffsetA + 1] = ay + inverseMassA * directionY * lambdaDelta;
    positions[positionOffsetB] = bx - inverseMassB * directionX * lambdaDelta;
    positions[positionOffsetB + 1] = by - inverseMassB * directionY * lambdaDelta;
  }
}

function solveMaximumDistanceConstraints(
  mesh: Mesh,
  constraints: Constraints,
  maximumStretchRatio: number,
  compliance: number,
  deltaSeconds: number,
) {
  const alpha = compliance / (deltaSeconds * deltaSeconds);
  const positions = mesh.positions;
  const inverseMasses = mesh.inverseMasses;
  const { verticesA, verticesB, restLengths } = constraints.distances;
  const lambdas = constraints.maximumDistanceLambdas;
  const squaredEpsilon = epsilon * epsilon;
  for (
    let constraintIndex = 0;
    constraintIndex < restLengths.length;
    constraintIndex += 1
  ) {
    const a = verticesA[constraintIndex] ?? 0;
    const b = verticesB[constraintIndex] ?? 0;
    const restLength = restLengths[constraintIndex] ?? 0;
    const positionOffsetA = a * 2;
    const positionOffsetB = b * 2;
    const ax = positions[positionOffsetA] ?? 0;
    const ay = positions[positionOffsetA + 1] ?? 0;
    const bx = positions[positionOffsetB] ?? 0;
    const by = positions[positionOffsetB + 1] ?? 0;
    const deltaX = ax - bx;
    const deltaY = ay - by;
    const squaredDistance = deltaX * deltaX + deltaY * deltaY;
    if (squaredDistance < squaredEpsilon) continue;
    const maximumDistance = restLength * maximumStretchRatio;
    const previousLambda = lambdas[constraintIndex] ?? 0;
    if (previousLambda <= 0 && squaredDistance <= maximumDistance * maximumDistance) continue;
    const distance = Math.sqrt(squaredDistance);
    const constraintValue = maximumDistance - distance;
    const inverseMassA = inverseMasses[a] ?? 0;
    const inverseMassB = inverseMasses[b] ?? 0;
    const denominator = inverseMassA + inverseMassB + alpha;
    const nextLambda = Math.max(
      0,
      previousLambda + (-constraintValue - alpha * previousLambda) / denominator,
    );
    const lambdaDelta = nextLambda - previousLambda;
    lambdas[constraintIndex] = nextLambda;
    const directionX = -deltaX / distance;
    const directionY = -deltaY / distance;
    positions[positionOffsetA] = ax + inverseMassA * directionX * lambdaDelta;
    positions[positionOffsetA + 1] = ay + inverseMassA * directionY * lambdaDelta;
    positions[positionOffsetB] = bx - inverseMassB * directionX * lambdaDelta;
    positions[positionOffsetB + 1] = by - inverseMassB * directionY * lambdaDelta;
  }
}

function solveAreaConstraints(
  mesh: Mesh,
  constraints: Constraints,
  compliance: number,
  deltaSeconds: number,
) {
  const alpha = compliance / (deltaSeconds * deltaSeconds);
  const positions = mesh.positions;
  const inverseMasses = mesh.inverseMasses;
  const { verticesA, verticesB, verticesC, minimumAreas } = constraints.areas;
  const lambdas = constraints.areaLambdas;
  for (
    let constraintIndex = 0;
    constraintIndex < minimumAreas.length;
    constraintIndex += 1
  ) {
    const a = verticesA[constraintIndex] ?? 0;
    const b = verticesB[constraintIndex] ?? 0;
    const c = verticesC[constraintIndex] ?? 0;
    const positionOffsetA = a * 2;
    const positionOffsetB = b * 2;
    const positionOffsetC = c * 2;
    const ax = positions[positionOffsetA] ?? 0;
    const ay = positions[positionOffsetA + 1] ?? 0;
    const bx = positions[positionOffsetB] ?? 0;
    const by = positions[positionOffsetB + 1] ?? 0;
    const cx = positions[positionOffsetC] ?? 0;
    const cy = positions[positionOffsetC + 1] ?? 0;
    const minimumArea = minimumAreas[constraintIndex] ?? 0;
    const constraintValue = calculateTriangleArea(ax, ay, bx, by, cx, cy) - minimumArea;
    const previousLambda = lambdas[constraintIndex] ?? 0;
    if (constraintValue >= 0 && previousLambda <= 0) continue;
    const gradientAX = 0.5 * (by - cy);
    const gradientAY = 0.5 * (cx - bx);
    const gradientBX = 0.5 * (cy - ay);
    const gradientBY = 0.5 * (ax - cx);
    const gradientCX = 0.5 * (ay - by);
    const gradientCY = 0.5 * (bx - ax);
    const inverseMassA = inverseMasses[a] ?? 0;
    const inverseMassB = inverseMasses[b] ?? 0;
    const inverseMassC = inverseMasses[c] ?? 0;
    let denominator = alpha;
    denominator += inverseMassA * (gradientAX ** 2 + gradientAY ** 2);
    denominator += inverseMassB * (gradientBX ** 2 + gradientBY ** 2);
    denominator += inverseMassC * (gradientCX ** 2 + gradientCY ** 2);
    if (denominator < epsilon) continue;
    const nextLambda = Math.max(
      0,
      previousLambda + (-constraintValue - alpha * previousLambda) / denominator,
    );
    const lambdaDelta = nextLambda - previousLambda;
    lambdas[constraintIndex] = nextLambda;
    positions[positionOffsetA] = ax + inverseMassA * gradientAX * lambdaDelta;
    positions[positionOffsetA + 1] = ay + inverseMassA * gradientAY * lambdaDelta;
    positions[positionOffsetB] = bx + inverseMassB * gradientBX * lambdaDelta;
    positions[positionOffsetB + 1] = by + inverseMassB * gradientBY * lambdaDelta;
    positions[positionOffsetC] = cx + inverseMassC * gradientCX * lambdaDelta;
    positions[positionOffsetC + 1] = cy + inverseMassC * gradientCY * lambdaDelta;
  }
}

function createClusters(mesh: Mesh, threshold = 0.05) {
  const stride = mesh.columns + 1;
  const visited = new Uint8Array(mesh.weights.length);
  const clusters: Cluster[] = [];
  const getNeighbors = (vertexIndex: number) => {
    const row = Math.floor(vertexIndex / stride);
    const column = vertexIndex % stride;
    const neighbors: number[] = [];
    if (column > 0) neighbors.push(vertexIndex - 1);
    if (column < mesh.columns) neighbors.push(vertexIndex + 1);
    if (row > 0) neighbors.push(vertexIndex - stride);
    if (row < mesh.rows) neighbors.push(vertexIndex + stride);
    return neighbors;
  };

  for (let vertexIndex = 0; vertexIndex < mesh.weights.length; vertexIndex += 1) {
    if ((visited[vertexIndex] ?? 0) !== 0 || (mesh.weights[vertexIndex] ?? 0) <= threshold) continue;
    const pending = [vertexIndex];
    const vertices: number[] = [];
    visited[vertexIndex] = 1;
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) break;
      vertices.push(current);
      for (const neighbor of getNeighbors(current)) {
        if ((visited[neighbor] ?? 0) !== 0 || (mesh.weights[neighbor] ?? 0) <= threshold) continue;
        visited[neighbor] = 1;
        pending.push(neighbor);
      }
    }
    let weightSum = 0;
    let centerX = 0;
    let centerY = 0;
    for (const current of vertices) {
      const weight = mesh.weights[current] ?? 0;
      weightSum += weight;
      centerX += (mesh.restPositions[current * 2] ?? 0) * weight;
      centerY += (mesh.restPositions[current * 2 + 1] ?? 0) * weight;
    }
    clusters.push({
      vertices: Uint32Array.from(vertices),
      restCenterX: centerX / Math.max(weightSum, epsilon),
      restCenterY: centerY / Math.max(weightSum, epsilon),
      previousRotation: 0,
    });
  }
  return clusters;
}

function solveShapeMatching(mesh: Mesh, clusters: Cluster[], shapeStrength: number) {
  for (const cluster of clusters) {
    let weightSum = 0;
    let centerX = 0;
    let centerY = 0;
    for (const vertexIndex of cluster.vertices) {
      const weight = mesh.weights[vertexIndex] ?? 0;
      weightSum += weight;
      centerX += (mesh.positions[vertexIndex * 2] ?? 0) * weight;
      centerY += (mesh.positions[vertexIndex * 2 + 1] ?? 0) * weight;
    }
    if (weightSum < epsilon) continue;
    centerX /= weightSum;
    centerY /= weightSum;
    let m00 = 0;
    let m01 = 0;
    let m10 = 0;
    let m11 = 0;
    for (const vertexIndex of cluster.vertices) {
      const weight = mesh.weights[vertexIndex] ?? 0;
      const currentX = (mesh.positions[vertexIndex * 2] ?? 0) - centerX;
      const currentY = (mesh.positions[vertexIndex * 2 + 1] ?? 0) - centerY;
      const restX = (mesh.restPositions[vertexIndex * 2] ?? 0) - cluster.restCenterX;
      const restY = (mesh.restPositions[vertexIndex * 2 + 1] ?? 0) - cluster.restCenterY;
      m00 += weight * currentX * restX;
      m01 += weight * currentX * restY;
      m10 += weight * currentY * restX;
      m11 += weight * currentY * restY;
    }
    const rotationNumerator = m10 - m01;
    const rotationDenominator = m00 + m11;
    const rotation = Math.abs(rotationNumerator) + Math.abs(rotationDenominator) > epsilon
      ? Math.atan2(rotationNumerator, rotationDenominator)
      : cluster.previousRotation;
    cluster.previousRotation = rotation;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    for (const vertexIndex of cluster.vertices) {
      const weight = mesh.weights[vertexIndex] ?? 0;
      const restX = (mesh.restPositions[vertexIndex * 2] ?? 0) - cluster.restCenterX;
      const restY = (mesh.restPositions[vertexIndex * 2 + 1] ?? 0) - cluster.restCenterY;
      const targetX = centerX + cosine * restX - sine * restY;
      const targetY = centerY + sine * restX + cosine * restY;
      const blend = shapeStrength * weight;
      mesh.positions[vertexIndex * 2] = (mesh.positions[vertexIndex * 2] ?? 0) +
        (targetX - (mesh.positions[vertexIndex * 2] ?? 0)) * blend;
      mesh.positions[vertexIndex * 2 + 1] = (mesh.positions[vertexIndex * 2 + 1] ?? 0) +
        (targetY - (mesh.positions[vertexIndex * 2 + 1] ?? 0)) * blend;
    }
  }
}

function normalizePercent(value: number) {
  return clamp(value, 0, 100) / 100;
}

function resolveParameters(parameters: WobbleParameters): ResolvedParameters {
  const stretch = normalizePercent(parameters.stretch);
  const bounce = normalizePercent(parameters.bounce);
  const damping = normalizePercent(parameters.damping);
  const cohesion = normalizePercent(parameters.cohesion);
  const inputStrength = normalizePercent(parameters.inputStrength);
  const fluctuation = normalizePercent(parameters.variation);
  const maximumStretchRatio = parameters.maxStretch === undefined
    ? 1.12 + stretch * 0.68
    : 1.02 + normalizePercent(parameters.maxStretch) * 0.98;
  const secondaryMotionStrength = clamp(
    (
      bounce * bounce * (1 - damping) * (0.25 + stretch) +
      (1 - cohesion) ** 4 * (1 - damping) - 0.08
    ) * 2.1,
    0,
    1,
  );
  const elongationStrength = stretch * stretch * (1 - cohesion) ** 1.2 *
    (0.65 + stretch * 1.8) * (1 + bounce * 1.4) * 1.33;
  const tremorStrength = clamp(
    fluctuation * fluctuation * (1 - stretch) * (0.4 + bounce * 0.6) * 20,
    0,
    1,
  );
  return {
    inputGain: 0.6 + inputStrength * 4.8,
    distanceCompliance: 2e-7 + stretch * stretch * 9e-4,
    tetherCompliance: 1e-6 + (1 - bounce) ** 2 * 0.0032 +
      secondaryMotionStrength * 7e-4,
    shapeStrength: 0.01 + cohesion ** 4 * 0.6,
    dampingRate: (0.25 + damping * damping * 18) * (0.04 + cohesion ** 3 * 0.96),
    gravityAcceleration: clamp(parameters.gravityStrength, 0, 2) * 0.6,
    gravityTargetDisplacement: clamp(parameters.gravityStrength, 0, 2) * 0.035,
    floatingAcceleration: (3.5 + stretch * 5) * (1 - damping * 0.45),
    fluctuationAcceleration: fluctuation * 0.08,
    maximumStretchRatio,
    maximumDisplacement: 0.16 + stretch * 0.6,
    maximumSpeed: 3.5 + stretch * 7,
    secondaryMotionStrength,
    secondaryFrequency: 1.7 + bounce * 1.1,
    secondaryDampingRatio: 0.025 + damping * 0.18 + cohesion * 0.18,
    secondaryVerticalBias: 0.65 + secondaryMotionStrength * 0.25,
    secondaryPhaseSpread: 0.025 + secondaryMotionStrength * 0.13 + fluctuation * 0.025,
    elongationStrength,
    tremorStrength,
    tremorFrequency: 8 + cohesion * 2 + bounce * 1.5,
  };
}

class DeterministicRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextSigned() {
    this.state = this.state + 1831565813 >>> 0;
    let mixed = this.state;
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296 * 2 - 1;
  }

  getState() {
    return this.state;
  }

  setState(state: number) {
    this.state = state >>> 0;
  }
}

function createFrameState(): FrameState {
  return {
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
  };
}

export function stepFrame(frame: FrameState, input: PhysicsInput, deltaSeconds: number) {
  const travelLimit = input.frameTravelLimit === undefined
    ? defaultFrameTravel
    : Math.max(defaultFrameTravel, Math.min(extendedFrameTravel, input.frameTravelLimit));
  const target = input.frameDragging && input.frameTarget
    ? clampVector(input.frameTarget, travelLimit)
    : { x: 0, y: 0 };
  if (input.frameDragging) {
    const previousVelocity = { ...frame.velocity };
    const interpolation = 1 - Math.exp(-(travelLimit > defaultFrameTravel ? 35 : 70) * deltaSeconds);
    const nextPosition = {
      x: frame.position.x + (target.x - frame.position.x) * interpolation,
      y: frame.position.y + (target.y - frame.position.y) * interpolation,
    };
    frame.velocity = clampVector({
      x: (nextPosition.x - frame.position.x) / deltaSeconds,
      y: (nextPosition.y - frame.position.y) / deltaSeconds,
    }, 3);
    frame.acceleration = clampVector({
      x: (frame.velocity.x - previousVelocity.x) / deltaSeconds,
      y: (frame.velocity.y - previousVelocity.y) / deltaSeconds,
    }, 55);
    frame.position = clampVector(nextPosition, travelLimit);
    return;
  }
  frame.acceleration = clampVector({
    x: (target.x - frame.position.x) * 68 - frame.velocity.x * 8.5,
    y: (target.y - frame.position.y) * 68 - frame.velocity.y * 8.5,
  }, 22);
  frame.velocity.x += frame.acceleration.x * deltaSeconds;
  frame.velocity.y += frame.acceleration.y * deltaSeconds;
  frame.velocity = clampVector(frame.velocity, 1.8);
  frame.position.x += frame.velocity.x * deltaSeconds;
  frame.position.y += frame.velocity.y * deltaSeconds;
  const maximumTravel = Math.hypot(frame.position.x, frame.position.y) > 0.080000001
    ? extendedFrameTravel
    : defaultFrameTravel;
  const clampedPosition = clampVector(frame.position, maximumTravel);
  if (clampedPosition.x !== frame.position.x || clampedPosition.y !== frame.position.y) {
    const outwardVelocity = frame.velocity.x * clampedPosition.x +
      frame.velocity.y * clampedPosition.y;
    if (outwardVelocity > 0) {
      const squaredLength = clampedPosition.x ** 2 + clampedPosition.y ** 2;
      if (squaredLength > 0) {
        frame.velocity.x -= outwardVelocity / squaredLength * clampedPosition.x;
        frame.velocity.y -= outwardVelocity / squaredLength * clampedPosition.y;
      }
    }
    frame.position = clampedPosition;
  }
}

function getGravityVector(direction: GravityDirection, magnitude: number): Point {
  if (direction === "down") return { x: 0, y: magnitude };
  if (direction === "up") return { x: 0, y: -magnitude };
  if (direction === "left") return { x: -magnitude, y: 0 };
  if (direction === "right") return { x: magnitude, y: 0 };
  return { x: 0, y: 0 };
}

function getGravityRamp(elapsedSeconds: number) {
  return 1 + 22 * Math.exp(-Math.max(0, elapsedSeconds) * 5);
}

function resolveWeight(weight: number) {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  if (weight >= 0.8) return Math.min(1, weight);
  const normalized = weight / 0.8;
  return weight * (0.35 + 0.65 * (normalized * normalized * (3 - 2 * normalized)));
}

export function getEffectiveMaskCoverage(weights: Float64Array) {
  let weightedTotal = 0;
  let activeVertices = 0;
  for (const weight of weights) {
    if (weight <= 0) continue;
    weightedTotal += resolveWeight(weight);
    activeVertices += 1;
  }
  return activeVertices > 0 ? weightedTotal / activeVertices : 0;
}

export class WobblePhysics {
  readonly mesh: Mesh;
  readonly frame = createFrameState();
  readonly seed = 1347768917;
  readonly quality = {
    tickRate: 120,
    iterations: solverIterations,
    maxCatchUpSteps: maximumCatchUpSteps,
  };
  private parameters: WobbleParameters;
  private resolved: ResolvedParameters;
  private readonly constraints: Constraints;
  private readonly clusters: Cluster[];
  private readonly random = new DeterministicRandom(1347768917);
  private readonly secondaryOffsets: Float64Array;
  private readonly secondaryVelocities: Float64Array;
  private readonly vertexClusterIndices: Int32Array;
  private readonly automaticSpatialFactors: Float64Array;
  private readonly elongationXFactors: Float64Array;
  private readonly elongationYFactors: Float64Array;
  private readonly tetherTargetOffsets: Float64Array;
  private gravityElapsedSeconds = 0;
  private accumulator = 0;
  private tickValue = 0;

  constructor(
    imageWidth: number,
    imageHeight: number,
    mask: MaskState,
    parameters: WobbleParameters,
  ) {
    this.mesh = createMesh(imageWidth, imageHeight, mask);
    this.parameters = { ...parameters };
    this.resolved = resolveParameters(parameters);
    this.constraints = createConstraints(this.mesh);
    this.clusters = createClusters(this.mesh);
    this.secondaryOffsets = new Float64Array(this.mesh.positions.length);
    this.secondaryVelocities = new Float64Array(this.mesh.positions.length);
    this.vertexClusterIndices = new Int32Array(this.mesh.weights.length);
    this.vertexClusterIndices.fill(-1);
    this.automaticSpatialFactors = new Float64Array(this.mesh.weights.length);
    this.elongationXFactors = new Float64Array(this.mesh.weights.length);
    this.elongationYFactors = new Float64Array(this.mesh.weights.length);
    this.tetherTargetOffsets = new Float64Array(this.mesh.positions.length);
    this.initializeSpatialFields();
  }

  get tick() {
    return this.tickValue;
  }

  get fixedDeltaTime() {
    return fixedDeltaTime;
  }

  setParameters(parameters: WobbleParameters) {
    if (parameters.gravityDirection !== this.parameters.gravityDirection) {
      this.gravityElapsedSeconds = 0;
    }
    this.parameters = { ...parameters };
    this.resolved = resolveParameters(parameters);
  }

  getFrameOffset(): Point {
    return { ...this.frame.position };
  }

  createSnapshot(): PhysicsSnapshot {
    return {
      version: 1,
      seed: this.seed,
      tick: this.tickValue,
      accumulator: this.accumulator,
      randomState: this.random.getState(),
      gravityElapsedSeconds: this.gravityElapsedSeconds,
      parameters: { ...this.parameters },
      quality: { ...this.quality },
      positions: Array.from(this.mesh.positions),
      previousPositions: Array.from(this.mesh.previousPositions),
      velocities: Array.from(this.mesh.velocities),
      secondaryOffsets: Array.from(this.secondaryOffsets),
      secondaryVelocities: Array.from(this.secondaryVelocities),
      frame: {
        position: { ...this.frame.position },
        velocity: { ...this.frame.velocity },
        acceleration: { ...this.frame.acceleration },
      },
      constraintLambdas: {
        tetherX: Array.from(this.constraints.tetherX),
        tetherY: Array.from(this.constraints.tetherY),
        distance: Array.from(this.constraints.distanceLambdas),
        maximumDistance: Array.from(this.constraints.maximumDistanceLambdas),
        area: Array.from(this.constraints.areaLambdas),
      },
      clusterRotations: this.clusters.map((cluster) => cluster.previousRotation),
    };
  }

  restoreSnapshot(snapshot: PhysicsSnapshot) {
    if (snapshot.version !== 1) throw new Error("Unsupported physics snapshot version");
    if (
      snapshot.quality.tickRate !== this.quality.tickRate ||
      snapshot.quality.iterations !== this.quality.iterations ||
      snapshot.quality.maxCatchUpSteps !== this.quality.maxCatchUpSteps
    ) {
      throw new Error("Physics snapshot solver quality does not match the simulator");
    }
    const restoreArray = (
      values: number[],
      target: Float64Array,
      label: string,
    ) => {
      if (values.length !== target.length || values.some((value) => !Number.isFinite(value))) {
        throw new Error(`Invalid ${label} snapshot data`);
      }
      target.set(values);
    };
    restoreArray(snapshot.positions, this.mesh.positions, "position");
    restoreArray(snapshot.previousPositions, this.mesh.previousPositions, "previous position");
    restoreArray(snapshot.velocities, this.mesh.velocities, "velocity");
    restoreArray(snapshot.secondaryOffsets, this.secondaryOffsets, "secondary offset");
    restoreArray(snapshot.secondaryVelocities, this.secondaryVelocities, "secondary velocity");
    restoreArray(snapshot.constraintLambdas.tetherX, this.constraints.tetherX, "tether X");
    restoreArray(snapshot.constraintLambdas.tetherY, this.constraints.tetherY, "tether Y");
    restoreArray(
      snapshot.constraintLambdas.distance,
      this.constraints.distanceLambdas,
      "distance lambda",
    );
    restoreArray(
      snapshot.constraintLambdas.maximumDistance,
      this.constraints.maximumDistanceLambdas,
      "maximum-distance lambda",
    );
    restoreArray(snapshot.constraintLambdas.area, this.constraints.areaLambdas, "area lambda");
    if (
      snapshot.clusterRotations.length !== this.clusters.length ||
      snapshot.clusterRotations.some((rotation) => !Number.isFinite(rotation))
    ) {
      throw new Error("Invalid cluster rotation snapshot data");
    }
    snapshot.clusterRotations.forEach((rotation, clusterIndex) => {
      const cluster = this.clusters[clusterIndex];
      if (cluster) cluster.previousRotation = rotation;
    });
    if (
      !Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0 ||
      !Number.isFinite(snapshot.accumulator) || snapshot.accumulator < 0 ||
      !Number.isFinite(snapshot.gravityElapsedSeconds) || snapshot.gravityElapsedSeconds < 0
    ) {
      throw new Error("Invalid physics snapshot timing data");
    }
    this.tickValue = snapshot.tick;
    this.accumulator = snapshot.accumulator;
    this.random.setState(snapshot.randomState);
    this.setParameters(snapshot.parameters);
    this.gravityElapsedSeconds = snapshot.gravityElapsedSeconds;
    this.frame.position = { ...snapshot.frame.position };
    this.frame.velocity = { ...snapshot.frame.velocity };
    this.frame.acceleration = { ...snapshot.frame.acceleration };
  }

  isFinite() {
    const arrays = [
      this.mesh.positions,
      this.mesh.velocities,
      this.secondaryOffsets,
      this.secondaryVelocities,
    ];
    return arrays.every((values) => values.every((value) => Number.isFinite(value))) &&
      Number.isFinite(this.gravityElapsedSeconds) &&
      Number.isFinite(this.frame.position.x) &&
      Number.isFinite(this.frame.position.y);
  }

  advance(
    deltaSeconds: number,
    resolveInput: PhysicsInput | ((tick: number) => PhysicsInput),
  ) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Elapsed time must be finite and non-negative");
    }
    this.accumulator += Math.min(deltaSeconds, 0.25);
    let steps = 0;
    while (
      this.accumulator + 1e-12 >= fixedDeltaTime &&
      steps < maximumCatchUpSteps
    ) {
      const input = typeof resolveInput === "function"
        ? resolveInput(this.tickValue)
        : resolveInput;
      this.step(input);
      this.accumulator -= fixedDeltaTime;
      steps += 1;
    }
    if (steps === maximumCatchUpSteps && this.accumulator >= fixedDeltaTime) {
      this.accumulator %= fixedDeltaTime;
    }
    return steps;
  }

  step(input: PhysicsInput) {
    stepFrame(this.frame, input, fixedDeltaTime);
    resetConstraintLambdas(this.constraints);
    const gravity = getGravityVector(
      this.parameters.gravityDirection,
      this.resolved.gravityAcceleration * getGravityRamp(this.gravityElapsedSeconds),
    );
    const gravityTarget = getGravityVector(
      this.parameters.gravityDirection,
      this.resolved.gravityTargetDisplacement,
    );
    const localAcceleration = clampVector(input.localAcceleration ?? { x: 0, y: 0 }, 8);
    const automaticAcceleration = clampVector(
      input.automaticAcceleration ?? { x: 0, y: 0 },
      1,
    );
    const inertialAcceleration = {
      x: -this.frame.acceleration.x * this.resolved.inputGain,
      y: -this.frame.acceleration.y * this.resolved.inputGain,
    };
    const inputAcceleration = clampVector({
      x: localAcceleration.x * this.resolved.inputGain + inertialAcceleration.x,
      y: localAcceleration.y * this.resolved.inputGain + inertialAcceleration.y,
    }, 24);
    const directMotionRatio = 1 - this.resolved.secondaryMotionStrength * 0.52;
    const automaticGain = this.resolved.inputGain * inputAccelerationScale;

    for (let vertexIndex = 0; vertexIndex < this.mesh.weights.length; vertexIndex += 1) {
      const positionOffset = vertexIndex * 2;
      const inverseMass = this.mesh.inverseMasses[vertexIndex] ?? 0;
      this.mesh.previousPositions[positionOffset] = this.mesh.positions[positionOffset] ?? 0;
      this.mesh.previousPositions[positionOffset + 1] = this.mesh.positions[positionOffset + 1] ?? 0;
      if (inverseMass <= 0) {
        this.mesh.positions[positionOffset] = this.mesh.restPositions[positionOffset] ?? 0;
        this.mesh.positions[positionOffset + 1] = this.mesh.restPositions[positionOffset + 1] ?? 0;
        this.mesh.velocities[positionOffset] = 0;
        this.mesh.velocities[positionOffset + 1] = 0;
        continue;
      }
      const noiseSuppression = (1 - this.resolved.tremorStrength) ** 2;
      const fluctuationX = this.random.nextSigned() *
        this.resolved.fluctuationAcceleration * noiseSuppression;
      const fluctuationY = this.random.nextSigned() *
        this.resolved.fluctuationAcceleration * noiseSuppression;
      const floating = this.parameters.gravityDirection === "none"
        ? this.getFloatingAcceleration(vertexIndex)
        : { x: 0, y: 0 };
      const automaticSpatialFactor = this.automaticSpatialFactors[vertexIndex] ?? 0;
      const spatialAutomatic = {
        x: automaticAcceleration.x * automaticGain * automaticSpatialFactor,
        y: automaticAcceleration.y * automaticGain * automaticSpatialFactor,
      };
      const combinedInput = {
        x: inputAcceleration.x + automaticAcceleration.x * automaticGain,
        y: inputAcceleration.y + automaticAcceleration.y * automaticGain,
      };
      const elongation = {
        x: combinedInput.x * this.resolved.elongationStrength * 1.8 *
          (this.elongationXFactors[vertexIndex] ?? 0),
        y: combinedInput.y * this.resolved.elongationStrength * 1.8 *
          (this.elongationYFactors[vertexIndex] ?? 0),
      };
      const tremorAcceleration = this.getTremorAcceleration(vertexIndex);
      const tremorTarget = this.getTremorTarget(vertexIndex);
      const weight = resolveWeight(this.mesh.weights[vertexIndex] ?? 0);
      const elongationTarget = {
        x: combinedInput.x / 24 * this.resolved.elongationStrength * 0.04 *
          (this.elongationXFactors[vertexIndex] ?? 0) * weight,
        y: combinedInput.y / 24 * this.resolved.elongationStrength * 0.04 *
          (this.elongationYFactors[vertexIndex] ?? 0) * weight,
      };
      this.tetherTargetOffsets[positionOffset] = tremorTarget.x + elongationTarget.x +
        gravityTarget.x * weight;
      this.tetherTargetOffsets[positionOffset + 1] = tremorTarget.y + elongationTarget.y +
        gravityTarget.y * weight;
      const directAcceleration = clampVector({
        x: (inputAcceleration.x + spatialAutomatic.x + elongation.x + tremorAcceleration.x) * weight,
        y: (inputAcceleration.y + spatialAutomatic.y + elongation.y + tremorAcceleration.y) * weight,
      }, 24);
      const secondaryAcceleration = this.stepSecondaryMotion(
        vertexIndex,
        directAcceleration,
        fixedDeltaTime,
      );
      const accelerationX = (gravity.x + floating.x + fluctuationX) * weight +
        directAcceleration.x * directMotionRatio + secondaryAcceleration.x;
      const accelerationY = (gravity.y + floating.y + fluctuationY) * weight +
        directAcceleration.y * directMotionRatio + secondaryAcceleration.y;
      const velocity = clampVector({
        x: (this.mesh.velocities[positionOffset] ?? 0) +
          accelerationX * inverseMass * fixedDeltaTime,
        y: (this.mesh.velocities[positionOffset + 1] ?? 0) +
          accelerationY * inverseMass * fixedDeltaTime,
      }, this.resolved.maximumSpeed);
      this.mesh.velocities[positionOffset] = velocity.x;
      this.mesh.velocities[positionOffset + 1] = velocity.y;
      this.mesh.positions[positionOffset] = (this.mesh.positions[positionOffset] ?? 0) +
        velocity.x * fixedDeltaTime;
      this.mesh.positions[positionOffset + 1] = (this.mesh.positions[positionOffset + 1] ?? 0) +
        velocity.y * fixedDeltaTime;
      this.clampVertexDisplacement(vertexIndex);
    }

    for (let iteration = 0; iteration < solverIterations; iteration += 1) {
      solveTetherConstraints(
        this.mesh,
        this.constraints,
        this.resolved.tetherCompliance,
        fixedDeltaTime,
        this.tetherTargetOffsets,
      );
      solveDistanceConstraints(
        this.mesh,
        this.constraints,
        this.resolved.distanceCompliance,
        fixedDeltaTime,
      );
      solveMaximumDistanceConstraints(
        this.mesh,
        this.constraints,
        this.resolved.maximumStretchRatio,
        1e-9,
        fixedDeltaTime,
      );
      solveAreaConstraints(this.mesh, this.constraints, 1e-10, fixedDeltaTime);
      solveShapeMatching(this.mesh, this.clusters, this.resolved.shapeStrength);
    }
    solveMaximumDistanceConstraints(
      this.mesh,
      this.constraints,
      this.resolved.maximumStretchRatio,
      0,
      fixedDeltaTime,
    );
    solveAreaConstraints(this.mesh, this.constraints, 0, fixedDeltaTime);
    const dampingMultiplier = Math.exp(-this.resolved.dampingRate * fixedDeltaTime);
    for (let vertexIndex = 0; vertexIndex < this.mesh.weights.length; vertexIndex += 1) {
      const positionOffset = vertexIndex * 2;
      if ((this.mesh.inverseMasses[vertexIndex] ?? 0) <= 0) {
        this.mesh.positions[positionOffset] = this.mesh.restPositions[positionOffset] ?? 0;
        this.mesh.positions[positionOffset + 1] = this.mesh.restPositions[positionOffset + 1] ?? 0;
        this.mesh.velocities[positionOffset] = 0;
        this.mesh.velocities[positionOffset + 1] = 0;
        continue;
      }
      this.clampVertexDisplacement(vertexIndex);
      const velocity = clampVector({
        x: ((this.mesh.positions[positionOffset] ?? 0) -
          (this.mesh.previousPositions[positionOffset] ?? 0)) /
          fixedDeltaTime * dampingMultiplier,
        y: ((this.mesh.positions[positionOffset + 1] ?? 0) -
          (this.mesh.previousPositions[positionOffset + 1] ?? 0)) /
          fixedDeltaTime * dampingMultiplier,
      }, this.resolved.maximumSpeed);
      this.mesh.velocities[positionOffset] = velocity.x;
      this.mesh.velocities[positionOffset + 1] = velocity.y;
    }
    this.gravityElapsedSeconds += fixedDeltaTime;
    this.tickValue += 1;
  }

  private clampVertexDisplacement(vertexIndex: number) {
    const positionOffset = vertexIndex * 2;
    const displacement = clampVector({
      x: (this.mesh.positions[positionOffset] ?? 0) -
        (this.mesh.restPositions[positionOffset] ?? 0),
      y: (this.mesh.positions[positionOffset + 1] ?? 0) -
        (this.mesh.restPositions[positionOffset + 1] ?? 0),
    }, this.resolved.maximumDisplacement);
    this.mesh.positions[positionOffset] = (this.mesh.restPositions[positionOffset] ?? 0) +
      displacement.x;
    this.mesh.positions[positionOffset + 1] =
      (this.mesh.restPositions[positionOffset + 1] ?? 0) + displacement.y;
  }

  private stepSecondaryMotion(vertexIndex: number, acceleration: Point, deltaSeconds: number) {
    const positionOffset = vertexIndex * 2;
    const strength = this.resolved.secondaryMotionStrength;
    if (strength <= 0) {
      this.secondaryOffsets[positionOffset] = 0;
      this.secondaryOffsets[positionOffset + 1] = 0;
      this.secondaryVelocities[positionOffset] = 0;
      this.secondaryVelocities[positionOffset + 1] = 0;
      return { x: 0, y: 0 };
    }
    const restX = this.mesh.restPositions[positionOffset] ?? 0;
    const restY = this.mesh.restPositions[positionOffset + 1] ?? 0;
    const spatialPhase = Math.sin(restX * 8.37 + restY * 5.19);
    const frequency = this.resolved.secondaryFrequency *
      (1 + spatialPhase * this.resolved.secondaryPhaseSpread);
    const angularFrequency = Math.PI * 2 * frequency;
    const damping = 2 * this.resolved.secondaryDampingRatio * angularFrequency;
    const verticalCoupling = acceleration.x * spatialPhase * 0.22 *
      this.resolved.secondaryVerticalBias;
    const targets = [
      acceleration.x * 0.045 * (1 - this.resolved.secondaryVerticalBias * 0.45),
      (acceleration.y + verticalCoupling) * 0.06,
    ];
    const output = { x: 0, y: 0 };
    for (let axis = 0; axis < 2; axis += 1) {
      const componentOffset = positionOffset + axis;
      const currentOffset = this.secondaryOffsets[componentOffset] ?? 0;
      const currentVelocity = this.secondaryVelocities[componentOffset] ?? 0;
      const nextAcceleration = ((targets[axis] ?? 0) * strength - currentOffset) *
        angularFrequency * angularFrequency - currentVelocity * damping;
      const nextVelocity = clamp(currentVelocity + nextAcceleration * deltaSeconds, -12, 12);
      const nextOffset = clamp(currentOffset + nextVelocity * deltaSeconds, -1.5, 1.5);
      this.secondaryVelocities[componentOffset] = nextVelocity;
      this.secondaryOffsets[componentOffset] = nextOffset;
      const component = nextOffset * strength * 9;
      if (axis === 0) output.x = component;
      else output.y = component;
    }
    return output;
  }

  private getFloatingAcceleration(vertexIndex: number) {
    const positionOffset = vertexIndex * 2;
    const restX = this.mesh.restPositions[positionOffset] ?? 0;
    const restY = this.mesh.restPositions[positionOffset + 1] ?? 0;
    const elapsed = this.tickValue * fixedDeltaTime;
    const clusterIndex = this.vertexClusterIndices[vertexIndex] ?? -1;
    if (clusterIndex < 0) return { x: 0, y: 0 };
    const phase = 1347768917 % 65521 / 65521 * Math.PI * 2 +
      clusterIndex * 2.399963229728653;
    const spatial = restX * 1.7 + restY * 1.13;
    const strength = this.resolved.floatingAcceleration;
    return {
      x: (
        Math.sin(elapsed * 0.83 + phase) * 0.75 +
        Math.sin(elapsed * 0.83 + phase + spatial) * 0.25
      ) * strength,
      y: (
        Math.cos(elapsed * 0.61 + phase * 1.37) * 0.75 +
        Math.cos(elapsed * 0.61 + phase * 1.37 - spatial * 0.72) * 0.25
      ) * strength * 0.72,
    };
  }

  private getTremorPhase(vertexIndex: number) {
    const clusterIndex = this.vertexClusterIndices[vertexIndex] ?? -1;
    if (clusterIndex < 0) return null;
    const elapsed = this.tickValue * fixedDeltaTime;
    const phaseOffset = clusterIndex * 1.618033988749895 +
      1347768917 % 8191 / 8191 * Math.PI * 2;
    return elapsed * Math.PI * 2 * this.resolved.tremorFrequency + phaseOffset;
  }

  private getTremorAcceleration(vertexIndex: number) {
    const strength = this.resolved.tremorStrength;
    const spatialFactor = this.automaticSpatialFactors[vertexIndex] ?? 0;
    const phase = this.getTremorPhase(vertexIndex);
    if (strength <= 0 || spatialFactor === 0 || phase === null) return { x: 0, y: 0 };
    return {
      x: Math.sin(phase) * strength * 2 * spatialFactor,
      y: Math.cos(phase) * strength * 0.7 * spatialFactor,
    };
  }

  private getTremorTarget(vertexIndex: number) {
    const strength = this.resolved.tremorStrength;
    const spatialFactor = this.automaticSpatialFactors[vertexIndex] ?? 0;
    const phase = this.getTremorPhase(vertexIndex);
    if (strength <= 0 || spatialFactor === 0 || phase === null) return { x: 0, y: 0 };
    const weight = resolveWeight(this.mesh.weights[vertexIndex] ?? 0);
    return {
      x: Math.sin(phase) * strength * 0.45 * spatialFactor * weight,
      y: Math.cos(phase) * strength * 0.165 * spatialFactor * weight,
    };
  }

  private initializeSpatialFields() {
    const normalizeClusterField = (
      cluster: Cluster,
      target: Float64Array,
      getValue: (vertexIndex: number) => number,
    ) => {
      let weightedSquares = 0;
      let weightSum = 0;
      for (const vertexIndex of cluster.vertices) {
        const weight = this.mesh.weights[vertexIndex] ?? 0;
        const value = getValue(vertexIndex);
        weightedSquares += value * value * weight;
        weightSum += weight;
      }
      const rootMeanSquare = Math.sqrt(weightedSquares / Math.max(weightSum, epsilon));
      if (rootMeanSquare < epsilon) return;
      for (const vertexIndex of cluster.vertices) {
        target[vertexIndex] = getValue(vertexIndex) / rootMeanSquare;
      }
    };
    this.clusters.forEach((cluster, clusterIndex) => {
      for (const vertexIndex of cluster.vertices) {
        this.vertexClusterIndices[vertexIndex] = clusterIndex;
      }
      const getHorizontal = (vertexIndex: number) =>
        (this.mesh.restPositions[vertexIndex * 2] ?? 0) - cluster.restCenterX;
      const getVertical = (vertexIndex: number) =>
        (this.mesh.restPositions[vertexIndex * 2 + 1] ?? 0) - cluster.restCenterY;
      normalizeClusterField(
        cluster,
        this.automaticSpatialFactors,
        (vertexIndex) => getHorizontal(vertexIndex) + getVertical(vertexIndex) * 0.63,
      );
      normalizeClusterField(cluster, this.elongationXFactors, getHorizontal);
      normalizeClusterField(cluster, this.elongationYFactors, getVertical);
    });
  }
}
