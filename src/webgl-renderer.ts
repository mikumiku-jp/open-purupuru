import type { Mesh, WobblePhysics } from "./physics";
import type { LoadedImage, Point } from "./types";

type Color = [number, number, number, number];
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
type RecordArea = { x: number; y: number; width: number; height: number };
type RenderOptions = {
  background?: Color;
  frameOffset?: Point;
  foregroundScale?: number;
  recordArea?: RecordArea;
};

const automaticTravel = 0.16;
const backdropMotionScale = 0.5;
const backdropBlurPixels = 52;
const defaultEdgeColors: Color[] = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
];

const vertexShaderSource = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
uniform vec2 u_scale;
uniform vec2 u_translation;
uniform float u_content_scale;
out vec2 v_uv;
void main() {
  vec2 clip = (a_position * u_content_scale + u_translation) * u_scale;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
}`;

const fragmentShaderSource = `#version 300 es
precision mediump float;
uniform sampler2D u_image;
uniform vec2 u_blur_radius_uv;
uniform float u_blur_mix;
uniform float u_gradient_mix;
uniform vec4 u_edge_top;
uniform vec4 u_edge_right;
uniform vec4 u_edge_bottom;
uniform vec4 u_edge_left;
in vec2 v_uv;
out vec4 out_color;
vec2 nearest_edge_uv(vec2 uv) {
  float nearest = uv.x;
  vec2 result = vec2(0.002, uv.y);
  if (1.0 - uv.x < nearest) {
    nearest = 1.0 - uv.x;
    result = vec2(0.998, uv.y);
  }
  if (uv.y < nearest) {
    nearest = uv.y;
    result = vec2(uv.x, 0.002);
  }
  if (1.0 - uv.y < nearest) {
    result = vec2(uv.x, 0.998);
  }
  return clamp(result, vec2(0.002), vec2(0.998));
}
vec2 nearest_edge_tangent(vec2 uv) {
  float horizontal_edge = min(uv.x, 1.0 - uv.x);
  float vertical_edge = min(uv.y, 1.0 - uv.y);
  return horizontal_edge < vertical_edge ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
}
void main() {
  float backdrop = max(u_blur_mix, u_gradient_mix);
  vec2 sample_uv = mix(v_uv, nearest_edge_uv(v_uv), backdrop);
  vec2 blur_offset = nearest_edge_tangent(v_uv) * u_blur_radius_uv;
  vec4 sharp = texture(u_image, sample_uv);
  vec4 blurred = sharp * 0.24;
  blurred += texture(u_image, sample_uv + blur_offset) * 0.10;
  blurred += texture(u_image, sample_uv - blur_offset) * 0.10;
  blurred += texture(u_image, sample_uv + blur_offset * 0.72) * 0.12;
  blurred += texture(u_image, sample_uv - blur_offset * 0.72) * 0.12;
  blurred += texture(u_image, sample_uv + blur_offset * 0.38) * 0.16;
  blurred += texture(u_image, sample_uv - blur_offset * 0.38) * 0.16;
  vec4 horizontal = mix(u_edge_left, u_edge_right, smoothstep(0.0, 1.0, v_uv.x));
  vec4 vertical = mix(u_edge_top, u_edge_bottom, smoothstep(0.0, 1.0, v_uv.y));
  vec4 edge_gradient = mix(horizontal, vertical, 0.5);
  vec3 bright_blur = mix(blurred.rgb, vec3(1.0), 0.36);
  vec4 hybrid = mix(edge_gradient, vec4(bright_blur, 1.0), 0.80);
  out_color = mix(sharp, hybrid, backdrop);
}`;

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL shader allocation failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "WebGL shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL program allocation failed");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "WebGL program linking failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function getBounds(positions: Float64Array): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let positionIndex = 0; positionIndex < positions.length; positionIndex += 2) {
    const x = positions[positionIndex] ?? 0;
    const y = positions[positionIndex + 1] ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

function getMedian(values: number[]) {
  if (values.length === 0) return 255;
  values.sort((first, second) => first - second);
  const middleIndex = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middleIndex] ?? 255
    : ((values[middleIndex - 1] ?? 255) + (values[middleIndex] ?? 255)) / 2;
}

function sampleEdgeColors(image: CanvasImageSource): Color[] {
  try {
    const canvas = typeof OffscreenCanvas === "undefined"
      ? Object.assign(document.createElement("canvas"), { width: 32, height: 32 })
      : new OffscreenCanvas(32, 32);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return defaultEdgeColors;
    context.clearRect(0, 0, 32, 32);
    context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32);
    const horizontalThickness = Math.max(1, Math.round(pixels.width * 0.1));
    const verticalThickness = Math.max(1, Math.round(pixels.height * 0.1));
    const regions = [
      { x0: 0, y0: 0, x1: pixels.width, y1: verticalThickness },
      { x0: pixels.width - horizontalThickness, y0: 0, x1: pixels.width, y1: pixels.height },
      { x0: 0, y0: pixels.height - verticalThickness, x1: pixels.width, y1: pixels.height },
      { x0: 0, y0: 0, x1: horizontalThickness, y1: pixels.height },
    ];
    return regions.map((region) => {
      const channels: number[][] = [[], [], []];
      for (let y = region.y0; y < region.y1; y += 1) {
        for (let x = region.x0; x < region.x1; x += 1) {
          const pixelIndex = (y * pixels.width + x) * 4;
          if ((pixels.data[pixelIndex + 3] ?? 0) < 16) continue;
          channels[0]?.push(pixels.data[pixelIndex] ?? 255);
          channels[1]?.push(pixels.data[pixelIndex + 1] ?? 255);
          channels[2]?.push(pixels.data[pixelIndex + 2] ?? 255);
        }
      }
      return [
        getMedian(channels[0] ?? []) / 255,
        getMedian(channels[1] ?? []) / 255,
        getMedian(channels[2] ?? []) / 255,
        1,
      ];
    });
  } catch {
    return defaultEdgeColors;
  }
}

function getBackdropScale(shortSide: number) {
  if (!(shortSide > 0) || !Number.isFinite(shortSide)) {
    throw new RangeError("Output short side must be positive and finite");
  }
  return 1 + 2 * (
    automaticTravel * backdropMotionScale + backdropBlurPixels / shortSide
  );
}

function getBackdropOffset(frameOffset: Point | undefined): Point {
  return {
    x: (Number.isFinite(frameOffset?.x) ? frameOffset?.x ?? 0 : 0) * backdropMotionScale,
    y: (Number.isFinite(frameOffset?.y) ? frameOffset?.y ?? 0 : 0) * backdropMotionScale,
  };
}

export class WobbleRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly positionBuffer: WebGLBuffer;
  private readonly uvBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly scaleLocation: WebGLUniformLocation;
  private readonly translationLocation: WebGLUniformLocation;
  private readonly contentScaleLocation: WebGLUniformLocation;
  private readonly blurRadiusLocation: WebGLUniformLocation;
  private readonly blurMixLocation: WebGLUniformLocation;
  private readonly gradientMixLocation: WebGLUniformLocation;
  private readonly edgeColorLocations: WebGLUniformLocation[];
  private readonly mesh: Mesh;
  private readonly positionScratch: Float32Array;
  private readonly edgeColors: Color[];
  private isDisposed = false;

  constructor(canvas: HTMLCanvasElement, image: LoadedImage, physics: WobblePhysics) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 is unavailable");
    const program = createProgram(gl);
    const vertexArray = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    const uvBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const texture = gl.createTexture();
    const scaleLocation = gl.getUniformLocation(program, "u_scale");
    const translationLocation = gl.getUniformLocation(program, "u_translation");
    const contentScaleLocation = gl.getUniformLocation(program, "u_content_scale");
    const blurRadiusLocation = gl.getUniformLocation(program, "u_blur_radius_uv");
    const blurMixLocation = gl.getUniformLocation(program, "u_blur_mix");
    const gradientMixLocation = gl.getUniformLocation(program, "u_gradient_mix");
    const edgeColorLocations = [
      "u_edge_top",
      "u_edge_right",
      "u_edge_bottom",
      "u_edge_left",
    ].map((uniformName) => gl.getUniformLocation(program, uniformName));
    if (
      !vertexArray || !positionBuffer || !uvBuffer || !indexBuffer || !texture ||
      !scaleLocation || !translationLocation || !contentScaleLocation ||
      !blurRadiusLocation || !blurMixLocation || !gradientMixLocation ||
      edgeColorLocations.some((location) => !location)
    ) {
      throw new Error("WebGL resource allocation failed");
    }
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.vertexArray = vertexArray;
    this.positionBuffer = positionBuffer;
    this.uvBuffer = uvBuffer;
    this.indexBuffer = indexBuffer;
    this.texture = texture;
    this.scaleLocation = scaleLocation;
    this.translationLocation = translationLocation;
    this.contentScaleLocation = contentScaleLocation;
    this.blurRadiusLocation = blurRadiusLocation;
    this.blurMixLocation = blurMixLocation;
    this.gradientMixLocation = gradientMixLocation;
    this.edgeColorLocations = edgeColorLocations as WebGLUniformLocation[];
    this.mesh = physics.mesh;
    this.positionScratch = new Float32Array(this.mesh.positions.length);
    this.edgeColors = sampleEdgeColors(image.bitmap);

    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.mesh.positions.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.mesh.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image.bitmap);
  }

  render(frameOffsetOrOptions: Point | RenderOptions = { x: 0, y: 0 }) {
    this.assertUsable();
    const options: RenderOptions = "x" in frameOffsetOrOptions &&
        "y" in frameOffsetOrOptions
      ? { frameOffset: frameOffsetOrOptions }
      : frameOffsetOrOptions;
    const gl = this.gl;
    const background = options.background ?? [1, 1, 1, 1];
    const bounds = getBounds(this.mesh.restPositions);
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;
    const recordArea = options.recordArea ?? { x: 0, y: 0, width: 1, height: 1 };
    const areaX = Math.max(0, Math.min(1, recordArea.x));
    const areaY = Math.max(0, Math.min(1, recordArea.y));
    const areaWidth = Math.max(0.001, Math.min(1 - areaX, recordArea.width));
    const areaHeight = Math.max(0.001, Math.min(1 - areaY, recordArea.height));
    const visibleWidth = contentWidth * areaWidth;
    const visibleHeight = contentHeight * areaHeight;
    const centerX = bounds.minX + (areaX + areaWidth / 2) * contentWidth;
    const centerY = bounds.minY + (areaY + areaHeight / 2) * contentHeight;
    const foregroundScale = Number.isFinite(options.foregroundScale)
      ? Math.max(1, options.foregroundScale ?? 1)
      : 1;
    const availableScale = 1;
    const canvasAspect = this.canvas.width / Math.max(1, this.canvas.height);
    const scaleY = availableScale * Math.min(
      2 / visibleHeight,
      2 * canvasAspect / visibleWidth,
    );
    const scaleX = scaleY / canvasAspect;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(background[0], background[1], background[2], background[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.uniform2f(this.scaleLocation, scaleX, scaleY);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const backdropScale = getBackdropScale(Math.min(this.canvas.width, this.canvas.height));
    gl.uniform2f(
      this.blurRadiusLocation,
      backdropBlurPixels / (Math.max(1, this.canvas.width) * backdropScale),
      backdropBlurPixels / (Math.max(1, this.canvas.height) * backdropScale),
    );
    for (let edgeIndex = 0; edgeIndex < this.edgeColors.length; edgeIndex += 1) {
      const edgeColor = this.edgeColors[edgeIndex] ?? defaultEdgeColors[edgeIndex];
      const location = this.edgeColorLocations[edgeIndex];
      if (edgeColor && location) {
        gl.uniform4f(location, edgeColor[0], edgeColor[1], edgeColor[2], edgeColor[3]);
      }
    }

    const backdropOffset = getBackdropOffset(options.frameOffset);
    this.positionScratch.set(this.mesh.restPositions);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positionScratch);
    gl.uniform1f(this.contentScaleLocation, backdropScale);
    gl.uniform1f(this.blurMixLocation, 1);
    gl.uniform1f(this.gradientMixLocation, 1);
    gl.uniform2f(
      this.translationLocation,
      backdropOffset.x - centerX * backdropScale,
      backdropOffset.y - centerY * backdropScale,
    );
    gl.drawElements(gl.TRIANGLES, this.mesh.indices.length, gl.UNSIGNED_INT, 0);

    this.positionScratch.set(this.mesh.positions);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positionScratch);
    gl.uniform1f(this.contentScaleLocation, foregroundScale);
    gl.uniform1f(this.blurMixLocation, 0);
    gl.uniform1f(this.gradientMixLocation, 0);
    gl.uniform2f(
      this.translationLocation,
      (options.frameOffset?.x ?? 0) - centerX * foregroundScale,
      (options.frameOffset?.y ?? 0) - centerY * foregroundScale,
    );
    gl.drawElements(gl.TRIANGLES, this.mesh.indices.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  isContextLost() {
    return this.gl.isContextLost();
  }

  readRgba(target: Uint8Array) {
    const expectedLength = this.canvas.width * this.canvas.height * 4;
    if (target.byteLength !== expectedLength) {
      throw new Error("RGBA target has an unexpected size");
    }
    const source = new Uint8Array(expectedLength);
    this.gl.readPixels(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      source,
    );
    const rowLength = this.canvas.width * 4;
    for (let row = 0; row < this.canvas.height; row += 1) {
      const sourceOffset = (this.canvas.height - row - 1) * rowLength;
      target.set(source.subarray(sourceOffset, sourceOffset + rowLength), row * rowLength);
    }
  }

  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteBuffer(this.uvBuffer);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.program);
  }

  private assertUsable() {
    if (this.isDisposed) throw new Error("WobbleRenderer has been disposed");
    if (this.gl.isContextLost()) throw new Error("The WebGL2 context is lost");
  }
}
