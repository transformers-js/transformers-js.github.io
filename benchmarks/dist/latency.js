var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/preprocessing/resize/cpu.ts
var cpu_exports = {};
__export(cpu_exports, {
  cpuResize: () => cpuResize
});
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function idx(image, x, y, ch) {
  return (y * image.width + x) * image.channels + ch;
}
function nearest(image, size) {
  const { data, width: sw, height: sh, channels: c } = image;
  const { width: dw, height: dh } = size;
  const out = new Float32Array(dw * dh * c);
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const sx = clamp(Math.floor((dx + 0.5) * (sw / dw)), 0, sw - 1);
      const sy = clamp(Math.floor((dy + 0.5) * (sh / dh)), 0, sh - 1);
      for (let ch = 0; ch < c; ch++) {
        out[(dy * dw + dx) * c + ch] = data[idx(image, sx, sy, ch)];
      }
    }
  }
  return { data: out, width: dw, height: dh, channels: c };
}
function bilinear(image, size) {
  const { data, width: sw, height: sh, channels: c } = image;
  const { width: dw, height: dh } = size;
  const out = new Float32Array(dw * dh * c);
  const scaleX = sw / dw;
  const scaleY = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const sx = (dx + 0.5) * scaleX - 0.5;
      const sy = (dy + 0.5) * scaleY - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const cx0 = clamp(x0, 0, sw - 1);
      const cx1 = clamp(x0 + 1, 0, sw - 1);
      const cy0 = clamp(y0, 0, sh - 1);
      const cy1 = clamp(y0 + 1, 0, sh - 1);
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      for (let ch = 0; ch < c; ch++) {
        out[(dy * dw + dx) * c + ch] = w00 * data[idx(image, cx0, cy0, ch)] + w10 * data[idx(image, cx1, cy0, ch)] + w01 * data[idx(image, cx0, cy1, ch)] + w11 * data[idx(image, cx1, cy1, ch)];
      }
    }
  }
  return { data: out, width: dw, height: dh, channels: c };
}
function cubicWeight(t) {
  const a = -0.5;
  const at = Math.abs(t);
  if (at <= 1) return (a + 2) * at ** 3 - (a + 3) * at ** 2 + 1;
  if (at < 2) return a * at ** 3 - 5 * a * at ** 2 + 8 * a * at - 4 * a;
  return 0;
}
function bicubic(image, size) {
  const { data, width: sw, height: sh, channels: c } = image;
  const { width: dw, height: dh } = size;
  const out = new Float32Array(dw * dh * c);
  const scaleX = sw / dw;
  const scaleY = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const sx = (dx + 0.5) * scaleX - 0.5;
      const sy = (dy + 0.5) * scaleY - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const wx = [];
      const wy = [];
      for (let k = -1; k <= 2; k++) {
        wx.push(cubicWeight(sx - (x0 + k)));
        wy.push(cubicWeight(sy - (y0 + k)));
      }
      for (let ch = 0; ch < c; ch++) {
        let val = 0;
        for (let ky = 0; ky < 4; ky++) {
          const py = clamp(y0 + ky - 1, 0, sh - 1);
          for (let kx = 0; kx < 4; kx++) {
            const px = clamp(x0 + kx - 1, 0, sw - 1);
            val += wy[ky] * wx[kx] * data[idx(image, px, py, ch)];
          }
        }
        out[(dy * dw + dx) * c + ch] = val;
      }
    }
  }
  return { data: out, width: dw, height: dh, channels: c };
}
async function cpuResize(image, size, filter = "bilinear") {
  switch (filter) {
    case "nearest":
      return nearest(image, size);
    case "bilinear":
      return bilinear(image, size);
    case "bicubic":
      return bicubic(image, size);
    case "lanczos":
      return bicubic(image, size);
  }
}
var init_cpu = __esm({
  "src/preprocessing/resize/cpu.ts"() {
    "use strict";
  }
});

// src/preprocessing/resize/webgpu.ts
var webgpu_exports = {};
__export(webgpu_exports, {
  makeWebGPUResize: () => makeWebGPUResize
});
function makeWebGPUResize(device) {
  const bilinearPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: BILINEAR_SHADER }), entryPoint: "main" }
  });
  const bicubicPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: BICUBIC_SHADER }), entryPoint: "main" }
  });
  async function gpuDispatch(pipeline, image, size) {
    const { width: dw, height: dh } = size;
    const { width: sw, height: sh, channels: c } = image;
    const dstBytes = dw * dh * c * 4;
    const srcBuf = device.createBuffer({
      size: image.data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(srcBuf, 0, image.data.buffer, image.data.byteOffset, image.data.byteLength);
    const dstBuf = device.createBuffer({
      size: dstBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    const paramsBuf = device.createBuffer({
      size: 20,
      // 5 × u32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(paramsBuf, 0, new Uint32Array([sw, sh, dw, dh, c]));
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: srcBuf } },
        { binding: 1, resource: { buffer: dstBuf } },
        { binding: 2, resource: { buffer: paramsBuf } }
      ]
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(dw / 8), Math.ceil(dh / 8));
    pass.end();
    const readBuf = device.createBuffer({
      size: dstBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    enc.copyBufferToBuffer(dstBuf, 0, readBuf, 0, dstBytes);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();
    srcBuf.destroy();
    dstBuf.destroy();
    paramsBuf.destroy();
    readBuf.destroy();
    return { data: result, width: dw, height: dh, channels: c };
  }
  return async function webgpuResize(image, size, filter = "bilinear") {
    if (filter === "bilinear") return gpuDispatch(bilinearPipeline, image, size);
    if (filter === "bicubic" || filter === "lanczos") return gpuDispatch(bicubicPipeline, image, size);
    const { cpuResize: cpuResize2 } = await Promise.resolve().then(() => (init_cpu(), cpu_exports));
    return cpuResize2(image, size, filter);
  };
}
var PARAMS_STRUCT, BILINEAR_SHADER, BICUBIC_SHADER;
var init_webgpu = __esm({
  "src/preprocessing/resize/webgpu.ts"() {
    "use strict";
    PARAMS_STRUCT = /* wgsl */
    `
struct Params {
    src_w:    u32,
    src_h:    u32,
    dst_w:    u32,
    dst_h:    u32,
    channels: u32,
}
@group(0) @binding(0) var<storage, read>       src:    array<f32>;
@group(0) @binding(1) var<storage, read_write> dst:    array<f32>;
@group(0) @binding(2) var<uniform>             params: Params;
`;
    BILINEAR_SHADER = PARAMS_STRUCT + /* wgsl */
    `
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let dx = id.x;
    let dy = id.y;
    if (dx >= params.dst_w || dy >= params.dst_h) { return; }

    let scale_x = f32(params.src_w) / f32(params.dst_w);
    let scale_y = f32(params.src_h) / f32(params.dst_h);

    // Half-pixel offset \u2014 matches PyTorch align_corners=false and PIL
    let sx = (f32(dx) + 0.5) * scale_x - 0.5;
    let sy = (f32(dy) + 0.5) * scale_y - 0.5;

    let x0 = i32(floor(sx));
    let y0 = i32(floor(sy));
    let fx = sx - floor(sx);
    let fy = sy - floor(sy);

    let cx0 = u32(clamp(x0,     0, i32(params.src_w) - 1));
    let cx1 = u32(clamp(x0 + 1, 0, i32(params.src_w) - 1));
    let cy0 = u32(clamp(y0,     0, i32(params.src_h) - 1));
    let cy1 = u32(clamp(y0 + 1, 0, i32(params.src_h) - 1));

    let w00 = (1.0 - fx) * (1.0 - fy);
    let w10 =        fx  * (1.0 - fy);
    let w01 = (1.0 - fx) *        fy;
    let w11 =        fx  *        fy;

    let c = params.channels;
    for (var ch = 0u; ch < c; ch++) {
        let tl = src[(cy0 * params.src_w + cx0) * c + ch];
        let tr = src[(cy0 * params.src_w + cx1) * c + ch];
        let bl = src[(cy1 * params.src_w + cx0) * c + ch];
        let br = src[(cy1 * params.src_w + cx1) * c + ch];
        dst[(dy * params.dst_w + dx) * c + ch] = w00*tl + w10*tr + w01*bl + w11*br;
    }
}
`;
    BICUBIC_SHADER = PARAMS_STRUCT + /* wgsl */
    `
fn cubic(t: f32) -> f32 {
    let a = abs(t);
    if (a <= 1.0) { return (1.5*a - 2.5)*a*a + 1.0; }
    if (a <  2.0) { return ((-0.5*a + 2.5)*a - 4.0)*a + 2.0; }
    return 0.0;
}

fn px(x: i32, y: i32, ch: u32) -> f32 {
    let cx = u32(clamp(x, 0, i32(params.src_w) - 1));
    let cy = u32(clamp(y, 0, i32(params.src_h) - 1));
    return src[(cy * params.src_w + cx) * params.channels + ch];
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let dx = id.x;
    let dy = id.y;
    if (dx >= params.dst_w || dy >= params.dst_h) { return; }

    let sx = (f32(dx) + 0.5) * f32(params.src_w) / f32(params.dst_w) - 0.5;
    let sy = (f32(dy) + 0.5) * f32(params.src_h) / f32(params.dst_h) - 0.5;

    let x0 = i32(floor(sx));
    let y0 = i32(floor(sy));
    let fx = sx - floor(sx);
    let fy = sy - floor(sy);

    // 4-tap Keys cubic weights per axis \u2014 use named components to avoid
    // dynamic vec4 indexing (wider WGSL compatibility)
    let wx = vec4<f32>(cubic(fx+1.0), cubic(fx), cubic(fx-1.0), cubic(fx-2.0));
    let wy = vec4<f32>(cubic(fy+1.0), cubic(fy), cubic(fy-1.0), cubic(fy-2.0));

    let c = params.channels;
    for (var ch = 0u; ch < c; ch++) {
        let v = wy.x * (wx.x*px(x0-1,y0-1,ch) + wx.y*px(x0,y0-1,ch) + wx.z*px(x0+1,y0-1,ch) + wx.w*px(x0+2,y0-1,ch))
              + wy.y * (wx.x*px(x0-1,y0,  ch) + wx.y*px(x0,y0,  ch) + wx.z*px(x0+1,y0,  ch) + wx.w*px(x0+2,y0,  ch))
              + wy.z * (wx.x*px(x0-1,y0+1,ch) + wx.y*px(x0,y0+1,ch) + wx.z*px(x0+1,y0+1,ch) + wx.w*px(x0+2,y0+1,ch))
              + wy.w * (wx.x*px(x0-1,y0+2,ch) + wx.y*px(x0,y0+2,ch) + wx.z*px(x0+1,y0+2,ch) + wx.w*px(x0+2,y0+2,ch));
        dst[(dy * params.dst_w + dx) * c + ch] = v;
    }
}
`;
  }
});

// src/preprocessing/ops.ts
function rescale(image, factor) {
  const data = new Float32Array(image.data.length);
  for (let i = 0; i < image.data.length; i++) {
    data[i] = image.data[i] * factor;
  }
  return { ...image, data };
}
function normalize(image, mean, std) {
  const data = new Float32Array(image.data.length);
  const c = image.channels;
  for (let i = 0; i < image.data.length; i++) {
    const ch = i % c;
    data[i] = (image.data[i] - (mean[ch] ?? 0)) / (std[ch] ?? 1);
  }
  return { ...image, data };
}
function hwcToChw(image) {
  const { data, width, height, channels: c } = image;
  const out = new Float32Array(data.length);
  for (let h = 0; h < height; h++) {
    for (let w = 0; w < width; w++) {
      for (let ch = 0; ch < c; ch++) {
        out[ch * height * width + h * width + w] = data[(h * width + w) * c + ch];
      }
    }
  }
  return out;
}
function crop(image, box) {
  const { left, top, right, bottom } = box;
  const newWidth = right - left;
  const newHeight = bottom - top;
  const { channels: c } = image;
  const data = new Float32Array(newWidth * newHeight * c);
  for (let h = 0; h < newHeight; h++) {
    for (let w = 0; w < newWidth; w++) {
      for (let ch = 0; ch < c; ch++) {
        data[(h * newWidth + w) * c + ch] = image.data[((h + top) * image.width + (w + left)) * c + ch];
      }
    }
  }
  return { data, width: newWidth, height: newHeight, channels: c };
}
function centerCrop(image, size) {
  const left = Math.floor((image.width - size.width) / 2);
  const top = Math.floor((image.height - size.height) / 2);
  return crop(image, { left, top, right: left + size.width, bottom: top + size.height });
}
var resize = () => Promise.reject(new Error("resize not initialized \u2014 call initRuntime() first"));
function setResizeImpl(impl) {
  resize = impl;
}

// src/runtime/index.ts
init_cpu();
async function initRuntime(preferred = "webgpu") {
  if (preferred === "webgpu" && typeof navigator !== "undefined" && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        const gpuDevice = await adapter.requestDevice();
        const { makeWebGPUResize: makeWebGPUResize2 } = await Promise.resolve().then(() => (init_webgpu(), webgpu_exports));
        setResizeImpl(makeWebGPUResize2(gpuDevice));
        gpuDevice.addEventListener("uncapturederror", (e) => {
          console.error("[transformers-js] WebGPU device error:", e);
        });
        return { device: "webgpu", gpuAdapter: adapter };
      }
    } catch (err) {
      console.warn("[transformers-js] WebGPU unavailable, falling back to CPU:", err);
    }
  }
  setResizeImpl(cpuResize);
  return { device: "cpu" };
}

// src/runtime/hub.ts
var HF_ENDPOINT = "https://huggingface.co";
var _hfToken = null;
async function fetchRaw(modelId, filename, mirrorBaseUrl) {
  const url = mirrorBaseUrl ? `${mirrorBaseUrl}/${filename.split("/").pop()}` : `${HF_ENDPOINT}/${modelId}/resolve/main/${filename}`;
  const headers = !mirrorBaseUrl && _hfToken ? { Authorization: `Bearer ${_hfToken}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const hint = !mirrorBaseUrl && res.status === 401 ? " (gated model \u2014 accept the license on huggingface.co and provide your access token)" : "";
    throw new Error(`Hub fetch failed (${res.status})${hint}: ${url}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    throw new Error(
      `Expected binary data but got HTML for ${url}. The model may be gated \u2014 accept its license on huggingface.co first.`
    );
  }
  return res.arrayBuffer();
}
async function fetchJSON(modelId, filename, mirrorBaseUrl) {
  const buf = await fetchRaw(modelId, filename, mirrorBaseUrl);
  return JSON.parse(new TextDecoder().decode(buf));
}

// src/runtime/session.ts
var _ort = null;
var WASM_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
async function getORT() {
  if (_ort) return _ort;
  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  if (isNode) {
    _ort = await import("onnxruntime-node");
  } else {
    _ort = await import("onnxruntime-web");
  }
  return _ort;
}
function ensureWasmPaths(ort) {
  const o = ort;
  if (o?.env?.wasm && !o.env.wasm.wasmPaths) {
    o.env.wasm.wasmPaths = WASM_CDN;
  }
}
var ONNXSession = class _ONNXSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(session, ort) {
    this.session = session;
    this.ort = ort;
  }
  static async load(modelBuffer, device, externalData) {
    const ort = await getORT();
    const firstByte = new Uint8Array(modelBuffer, 0, 1)[0];
    if (firstByte === 60) {
      throw new Error(
        "Model buffer starts with '<' \u2014 received HTML instead of ONNX binary. The model may be gated; accept its license on huggingface.co."
      );
    }
    const opts = externalData ? { externalData } : {};
    const candidates = device === "webgpu" ? [["webgpu"], ["wasm"]] : [["wasm"]];
    let lastErr;
    for (const eps of candidates) {
      if (eps[0] === "wasm") ensureWasmPaths(ort);
      try {
        const session = await ort.InferenceSession.create(modelBuffer, {
          executionProviders: eps,
          ...opts
        });
        if (device === "webgpu" && eps[0] === "wasm") {
          console.warn("[transformers-js] WebGPU EP failed, fell back to WASM EP.");
        }
        return new _ONNXSession(session, ort);
      } catch (err) {
        lastErr = err;
        if (eps !== candidates[candidates.length - 1]) {
          console.warn(`[transformers-js] ${eps[0]} EP failed (${err}), trying wasm\u2026`);
        }
      }
    }
    if (typeof lastErr === "number") {
      throw new Error(
        `ORT session creation failed with native exception (code ${lastErr}). Check the browser console above for ORT error details.`
      );
    }
    throw lastErr;
  }
  async run(inputs) {
    const ort = this.ort;
    const feeds = {};
    const validNames = new Set(this.session.inputNames ?? []);
    for (const [name, { data, dims }] of Object.entries(inputs)) {
      if (validNames.size > 0 && !validNames.has(name)) continue;
      const dtype = data instanceof BigInt64Array ? "int64" : "float32";
      feeds[name] = new ort.Tensor(dtype, data, dims);
    }
    const results = await this.session.run(feeds);
    const out = {};
    for (const [name, tensor] of Object.entries(results)) {
      out[name] = { data: tensor.data, dims: tensor.dims };
    }
    return out;
  }
  dispose() {
    this.session.release?.();
  }
};

// src/preprocessing/image-processor.ts
var PIL_RESAMPLE = {
  0: "nearest",
  2: "bilinear",
  3: "bicubic",
  1: "lanczos"
};
function normalizeSize(raw, fallback) {
  if (!raw) return { height: fallback, width: fallback };
  if (raw.shortest_edge != null) return { height: raw.shortest_edge, width: raw.shortest_edge };
  return { height: raw.height ?? fallback, width: raw.width ?? fallback };
}
function fromRaw(raw) {
  const size = normalizeSize(raw.size, 224);
  return {
    do_resize: raw.do_resize ?? true,
    size,
    resample: PIL_RESAMPLE[raw.resample ?? 3] ?? "bicubic",
    do_center_crop: raw.do_center_crop ?? true,
    crop_size: normalizeSize(raw.crop_size, size.height),
    do_rescale: raw.do_rescale ?? true,
    rescale_factor: raw.rescale_factor ?? 1 / 255,
    do_normalize: raw.do_normalize ?? true,
    image_mean: raw.image_mean ?? [0.5, 0.5, 0.5],
    image_std: raw.image_std ?? [0.5, 0.5, 0.5]
  };
}
var ImageProcessor = class _ImageProcessor {
  constructor(config) {
    this.config = config;
  }
  static async fromHub(modelId) {
    const raw = await fetchJSON(modelId, "preprocessor_config.json");
    return new _ImageProcessor(fromRaw(raw));
  }
  static fromConfig(config) {
    return new _ImageProcessor(config);
  }
  /** Returns a CHW float32 tensor with a leading batch dim: [1, C, H, W]. */
  async preprocess(image, override = {}) {
    const cfg = { ...this.config, ...override };
    let img = image;
    if (cfg.do_resize) img = await resize(img, cfg.size, cfg.resample);
    if (cfg.do_center_crop) img = centerCrop(img, cfg.crop_size);
    if (cfg.do_rescale) img = rescale(img, cfg.rescale_factor);
    if (cfg.do_normalize) img = normalize(img, cfg.image_mean, cfg.image_std);
    const chw = hwcToChw(img);
    const batched = new Float32Array(chw.length);
    batched.set(chw);
    return batched;
  }
};

// src/models/vit.ts
var ViTForImageClassification = class _ViTForImageClassification {
  constructor(session, processor, id2label) {
    this.session = session;
    this.processor = processor;
    this.id2label = id2label;
  }
  static async fromHub(modelId, options = {}) {
    const { device = "webgpu", quantized = false } = options;
    const modelFile = quantized ? "onnx/model_quantized.onnx" : "onnx/model.onnx";
    const [modelBuffer, processor, config] = await Promise.all([
      fetchRaw(modelId, modelFile),
      ImageProcessor.fromHub(modelId),
      fetchJSON(modelId, "config.json")
    ]);
    const session = await ONNXSession.load(modelBuffer, device);
    const id2label = {};
    for (const [k, v] of Object.entries(config.id2label ?? {})) {
      id2label[Number(k)] = v;
    }
    return new _ViTForImageClassification(session, processor, id2label);
  }
  async run(image) {
    const { config } = this.processor;
    const pixelValues = await this.processor.preprocess(image);
    const dims = [1, 3, config.size.height, config.size.width];
    const outputs = await this.session.run({
      pixel_values: { data: pixelValues, dims }
    });
    return outputs["logits"].data;
  }
  label(classIndex) {
    return this.id2label[classIndex] ?? `LABEL_${classIndex}`;
  }
  dispose() {
    this.session.dispose();
  }
};
export {
  ViTForImageClassification,
  initRuntime
};
//# sourceMappingURL=latency.js.map
