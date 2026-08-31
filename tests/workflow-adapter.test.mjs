import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { loadEnv } from "vite";
import { addLoraInput, normalizeWorkflow, convertCanvasWorkflow, workflowClassTypes, applyControlAfterGenerate, containsWorkflowLink, isEditableWorkflowValue, isLoraInputValue, nextLoraInputName, removeLoraInput, updateWorkflowInput, workflowInputSpec } from "../src/workflowAdapter.js";
import { sampleWorkflow } from "../src/sampleWorkflow.js";

const localEnv = loadEnv("development", process.cwd(), "");
const comfyUrl = (localEnv.COMFYUI_URL || process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const candidates = [
  localEnv.COMFYUI_WORKFLOW_DIR || process.env.COMFYUI_WORKFLOW_DIR,
  resolve(process.cwd(), "..", "user", "default", "workflows"),
  resolve(process.cwd(), "..", "ComfyUI", "user", "default", "workflows"),
  resolve(process.cwd(), "..", "ComfyUI_windows_portable", "ComfyUI", "user", "default", "workflows"),
  resolve(process.cwd(), "..", "..", "ComfyUI", "user", "default", "workflows"),
].filter(Boolean);

async function findWorkflowRoot() {
  for (const candidate of candidates) {
    try { await access(candidate); return pathToFileURL(`${resolve(candidate)}/`); } catch { /* Try the next portable layout. */ }
  }
  return null;
}

const workflowRoot = await findWorkflowRoot();
let serverAvailable;
const objectInfoCache = new Map();

test("normalizes the bundled API workflow without a ComfyUI installation", () => {
  assert.deepEqual(normalizeWorkflow(sampleWorkflow), sampleWorkflow);
});

test("API workflows preserve every node, linked input, scalar, object, and metadata value", () => {
  const source = {
    prompt: {
      "1": { class_type: "CustomLoader", inputs: { model: "model.safetensors", options: { tiled: true } }, _meta: { title: "Loader" } },
      "2": { class_type: "CustomSampler", inputs: { model: ["1", 0], seed: 7, cfg: 4.5, enabled: true, schedule: [0.1, 0.5, 1] }, _meta: { title: "Sampler", custom: "kept" } },
    },
  };
  const normalized = normalizeWorkflow(source);
  assert.deepEqual(normalized, source.prompt);
  normalized["2"].inputs.seed = 8;
  assert.equal(source.prompt["2"].inputs.seed, 7);
});

test("exposes structured custom-node settings while protecting linked values", () => {
  assert.equal(isEditableWorkflowValue({ mode: "tiles", overlap: 16 }), true);
  assert.equal(isEditableWorkflowValue([0.1, 0.5, 1]), true);
  assert.equal(isEditableWorkflowValue(["12", 0]), false);
  assert.equal(isEditableWorkflowValue([12, 0]), false);
  assert.equal(isEditableWorkflowValue(["literal", 0], [["literal", 0], {}]), true);
  assert.equal(isEditableWorkflowValue({ source: ["12", 0], weight: 0.5 }), false);
  assert.equal(containsWorkflowLink({ nested: [["12", 0]] }), true);
});

test("converts named widget objects, including structured custom settings, and fills newly added required defaults", () => {
  const workflow = {
    nodes: [{ id: 1, type: "OutputNode", mode: 0, inputs: [], widgets_values: { title: "saved", advanced: { tiled: true, schedule: [0.1, 0.5] }, preview: { ignored: true } } }],
    links: [],
  };
  const info = {
    OutputNode: {
      output_node: true,
      input: { required: {
        title: ["STRING", { default: "default" }],
        advanced: ["STRING", { default: {} }],
        new_option: ["INT", { default: 3 }],
      } },
      input_order: { required: ["title", "advanced", "new_option"] },
    },
  };
  assert.deepEqual(convertCanvasWorkflow(workflow, info)["1"].inputs, { title: "saved", advanced: { tiled: true, schedule: [0.1, 0.5] }, new_option: 3 });
});

test("restores every dynamic rgthree Power Lora row as an editable API input", () => {
  const loraOne = { on: true, lora: "style-one.safetensors", strength: 0.8, strengthTwo: null };
  const loraTwo = { on: false, lora: "style-two.safetensors", strength: 0.65, strengthTwo: 0.4 };
  const workflow = {
    nodes: [
      { id: 1, type: "ModelLoader", mode: 0, widgets_values: ["model.safetensors"] },
      { id: 2, type: "Power Lora Loader (rgthree)", mode: 0, widgets_values: [{}, { type: "PowerLoraLoaderHeaderWidget" }, loraOne, loraTwo, {}, ""], inputs: [{ name: "model", type: "MODEL", link: 1 }] },
      { id: 3, type: "OutputNode", mode: 0, widgets_values: [], inputs: [{ name: "model", type: "MODEL", link: 2 }] },
    ],
    links: [[1, 1, 0, 2, 0, "MODEL"], [2, 2, 0, 3, 0, "MODEL"]],
  };
  const info = {
    ModelLoader: { input: { required: { model_name: [["model.safetensors"], {}] } }, output: ["MODEL"] },
    "Power Lora Loader (rgthree)": { input: { required: {}, optional: { model: ["MODEL"], clip: ["CLIP"] } }, output: ["MODEL", "CLIP"] },
    OutputNode: { output_node: true, input: { required: { model: ["MODEL"] } } },
  };
  const prompt = convertCanvasWorkflow(workflow, info);
  assert.deepEqual(prompt["2"].inputs.lora_1, loraOne);
  assert.deepEqual(prompt["2"].inputs.lora_2, loraTwo);
  assert.equal(isLoraInputValue(prompt["2"].inputs.lora_1), true);
  assert.equal(isLoraInputValue({ lora: "missing-fields.safetensors" }), false);
});

test("restores named Power Lora rows used by the MiniMax custom prompt workflow", () => {
  const first = { on: true, lora: "minimax-style.safetensors", strength: 1, strengthTwo: null };
  const second = { on: false, lora: "minimax-motion.safetensors", strength: 0.8, strengthTwo: null };
  const workflow = {
    nodes: [
      { id: 1, type: "ModelLoader", mode: 0, widgets_values: ["model.safetensors"] },
      { id: 2, type: "Power Lora Loader (rgthree)", mode: 0, widgets_values_named: { divider: {}, lora_1: first, lora_2: second, "Add Lora": "" }, inputs: [{ name: "model", type: "MODEL", link: 1 }] },
      { id: 3, type: "OutputNode", mode: 0, inputs: [{ name: "model", type: "MODEL", link: 2 }] },
    ],
    links: [[1, 1, 0, 2, 0, "MODEL"], [2, 2, 0, 3, 0, "MODEL"]],
  };
  const info = {
    ModelLoader: { input: { required: { model_name: [["model.safetensors"], {}] } }, output: ["MODEL"] },
    "Power Lora Loader (rgthree)": { input: { required: {}, optional: { model: ["MODEL"], clip: ["CLIP"] } }, output: ["MODEL", "CLIP"] },
    OutputNode: { output_node: true, input: { required: { model: ["MODEL"] } } },
  };
  const prompt = convertCanvasWorkflow(workflow, info);
  assert.deepEqual(prompt["2"].inputs.lora_1, first);
  assert.deepEqual(prompt["2"].inputs.lora_2, second);
});

test("adds the next Power Lora row and removes rows without disturbing linked inputs", () => {
  const original = {
    model: ["1", 0],
    lora_1: { on: true, lora: "one.safetensors", strength: 1, strengthTwo: null },
    lora_2: { on: false, lora: "two.safetensors", strength: 0.8, strengthTwo: null },
  };
  assert.equal(nextLoraInputName(original), "lora_3");
  const removed = removeLoraInput(original, "lora_2");
  assert.equal("lora_2" in removed, false);
  assert.deepEqual(removed.model, ["1", 0]);
  const added = addLoraInput(original, "three.safetensors");
  assert.deepEqual(added.lora_3, { on: true, lora: "three.safetensors", strength: 1, strengthTwo: null });
  assert.equal(original.lora_3, undefined);
});

const videoCombineInfo = {
  VHS_VideoCombine: {
    output_node: true,
    input: { required: {
      images: ["IMAGE"],
      frame_rate: ["FLOAT", { default: 8, min: 1, step: 1 }],
      loop_count: ["INT", { default: 0, min: 0, max: 100, step: 1 }],
      filename_prefix: ["STRING", { default: "AnimateDiff" }],
      format: [["video/h264-mp4", "video/nvenc_h264-mp4"], { formats: {
        "video/h264-mp4": [
          ["pix_fmt", ["yuv420p", "yuv420p10le"]],
          ["crf", "INT", { default: 19, min: 0, max: 100, step: 1 }],
          ["save_metadata", "BOOLEAN", { default: true }],
          ["trim_to_audio", "BOOLEAN", { default: false }],
        ],
        "video/nvenc_h264-mp4": [
          ["pix_fmt", ["yuv420p", "p010le"]],
          ["bitrate", "INT", { default: 10, min: 1, max: 999, step: 1 }],
          ["megabit", "BOOLEAN", { default: true }],
          ["save_metadata", "BOOLEAN", { default: true }],
        ],
      } }],
      pingpong: ["BOOLEAN", { default: false }],
      save_output: ["BOOLEAN", { default: true }],
    } },
    input_order: { required: ["images", "frame_rate", "loop_count", "filename_prefix", "format", "pingpong", "save_output"] },
  },
};

test("preserves VHS format-dependent controls and excludes preview-only metadata", () => {
  const workflow = {
    nodes: [{
      id: 9, type: "VHS_VideoCombine", mode: 0, inputs: [],
      widgets_values_named: {
        frame_rate: 24, loop_count: 0, filename_prefix: "AnimateDiff", format: "video/h264-mp4",
        pix_fmt: "yuv420p", crf: 12, save_metadata: false, trim_to_audio: false,
        pingpong: false, save_output: true, videopreview: { paused: false, params: { filename: "old.mp4" } },
      },
    }],
    links: [],
  };
  const inputs = convertCanvasWorkflow(workflow, videoCombineInfo)["9"].inputs;
  assert.deepEqual(inputs, {
    frame_rate: 24, loop_count: 0, filename_prefix: "AnimateDiff", format: "video/h264-mp4",
    pix_fmt: "yuv420p", crf: 12, save_metadata: false, trim_to_audio: false, pingpong: false, save_output: true,
  });
  assert.deepEqual(workflowInputSpec(videoCombineInfo.VHS_VideoCombine, "pix_fmt", inputs)[0], ["yuv420p", "yuv420p10le"]);
});

test("switching a conditional format replaces obsolete controls with valid options", () => {
  const current = {
    format: "video/h264-mp4", pix_fmt: "yuv420p", crf: 12, save_metadata: false, trim_to_audio: false,
  };
  const next = updateWorkflowInput(current, videoCombineInfo.VHS_VideoCombine, "format", "video/nvenc_h264-mp4");
  assert.deepEqual(next, {
    format: "video/nvenc_h264-mp4", pix_fmt: "yuv420p", bitrate: 10, megabit: true, save_metadata: false,
  });
});

test("ignores non-conditional custom-node formats metadata", () => {
  const info = { input: { required: { format: [["png"], { formats: { png: { extension: ".png" } } }] } } };
  assert.deepEqual(workflowInputSpec(info, "format", { format: "png" }), [["png"], { formats: { png: { extension: ".png" } } }]);
  assert.deepEqual(updateWorkflowInput({ format: "png" }, info, "format", "png"), { format: "png" });
});

const ksamplerInfo = {
  KSampler: {
    input: { required: {
      model: ["MODEL", {}],
      positive: ["CONDITIONING", {}],
      negative: ["CONDITIONING", {}],
      latent_image: ["LATENT", {}],
      seed: ["INT", { default: 0, control_after_generate: true }],
      steps: ["INT", { default: 20 }],
      cfg: ["FLOAT", { default: 8 }],
      sampler_name: [["euler", "dpm"], {}],
      scheduler: [["normal", "karras"], {}],
      denoise: ["FLOAT", { default: 1 }],
    } },
    input_order: { required: ["model", "positive", "negative", "latent_image", "seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"] },
  },
  SaveImage: {
    output_node: true,
    input: { required: { filename_prefix: ["STRING", { default: "ComfyUI" }], images: ["IMAGE", {}] } },
  },
};

function ksamplerCanvas(widgetsValues) {
  return {
    nodes: [
      { id: 3, type: "KSampler", mode: 0, widgets_values: widgetsValues },
      { id: 9, type: "SaveImage", mode: 0, widgets_values: ["ComfyDeck"], inputs: [{ name: "images", link: 1 }] },
    ],
    links: [[1, 3, 0, 9, 0, "IMAGE"]],
  };
}

test("preserves KSampler control_after_generate in meta and keeps seed aligned", () => {
  const prompt = convertCanvasWorkflow(ksamplerCanvas([42, "increment", 20, 8, "euler", "normal", 1]), ksamplerInfo);
  const sampler = prompt["3"];
  assert.equal(sampler.inputs.seed, 42);
  assert.equal(sampler.inputs.steps, 20);
  assert.equal(sampler.inputs.cfg, 8);
  assert.equal(sampler.inputs.sampler_name, "euler");
  assert.equal(sampler._meta.controlAfterGenerate.seed, "increment");
  assert.equal("control_after_generate" in sampler.inputs, false);
  assert.equal(Object.values(sampler.inputs).includes("increment"), false);
});

test("named widgets_values maps control_after_generate onto the flagged INT field", () => {
  const prompt = convertCanvasWorkflow(ksamplerCanvas({
    seed: 42,
    control_after_generate: "randomize",
    steps: 20,
    cfg: 8,
    sampler_name: "euler",
    scheduler: "normal",
    denoise: 1,
  }), ksamplerInfo);
  const sampler = prompt["3"];
  assert.equal(sampler.inputs.seed, 42);
  assert.equal(sampler.inputs.steps, 20);
  assert.equal(sampler._meta.controlAfterGenerate.seed, "randomize");
  assert.equal("control_after_generate" in sampler.inputs, false);
});

test("applyControlAfterGenerate mutates listed seed fields after queue", () => {
  const workflow = {
    "3": { class_type: "KSampler", inputs: { seed: 42, steps: 20 }, _meta: { controlAfterGenerate: { seed: "increment" } } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "ComfyDeck" }, _meta: { title: "Save image" } },
  };
  const incremented = applyControlAfterGenerate(workflow);
  assert.equal(incremented["3"].inputs.seed, 43);
  assert.equal(incremented["3"].inputs.steps, 20);
  assert.equal(workflow["3"].inputs.seed, 42);

  workflow["3"]._meta.controlAfterGenerate.seed = "decrement";
  assert.equal(applyControlAfterGenerate(workflow)["3"].inputs.seed, 41);
  workflow["3"].inputs.seed = 0;
  assert.equal(applyControlAfterGenerate(workflow)["3"].inputs.seed, 0);

  workflow["3"].inputs.seed = 42;
  workflow["3"]._meta.controlAfterGenerate.seed = "fixed";
  assert.equal(applyControlAfterGenerate(workflow)["3"].inputs.seed, 42);

  workflow["3"]._meta.controlAfterGenerate.seed = "randomize";
  const randomized = applyControlAfterGenerate(workflow)["3"].inputs.seed;
  assert.notEqual(randomized, 42);
  assert.equal(Number.isInteger(randomized), true);
  assert.ok(randomized >= 0 && randomized < 1e15);
});

async function load(name) {
  if (!workflowRoot) throw new Error("No ComfyUI workflow directory was found");
  return JSON.parse((await readFile(new URL(name.replaceAll("%", "%25"), workflowRoot), "utf8")).replace(/^\uFEFF/, ""));
}

async function integrationReady(t) {
  if (!workflowRoot) { t.skip("Set COMFYUI_WORKFLOW_DIR to run installed-workflow integration tests"); return false; }
  if (serverAvailable === undefined) {
    serverAvailable = await fetch(`${comfyUrl}/system_stats`).then((response) => response.ok).catch(() => false);
  }
  if (!serverAvailable) { t.skip(`Start ComfyUI or set COMFYUI_URL to run integration tests`); return false; }
  return true;
}

async function getObjectInfo(workflow) {
  const parts = await Promise.all(workflowClassTypes(workflow).map(async (type) => {
    if (objectInfoCache.has(type)) return objectInfoCache.get(type);
    const response = await fetch(`${comfyUrl}/object_info/${encodeURIComponent(type)}`);
    assert.equal(response.ok, true, `ComfyUI object_info should include ${type}`);
    const promise = response.json();
    objectInfoCache.set(type, promise);
    return promise;
  }));
  return Object.assign({}, ...parts);
}

function missingRequired(prompt, objectInfo) {
  return Object.entries(prompt).flatMap(([id, node]) => {
    const required = Object.keys(objectInfo[node.class_type]?.input?.required || {});
    return required.filter((name) => !(name in node.inputs) && !Object.keys(node.inputs).some((key) => key.startsWith(`${name}.`)))
      .map((name) => `${id}:${node.class_type}.${name}`);
  });
}

test("converts the saved MiniMax H3 subgraph workflow", async (t) => {
  if (!await integrationReady(t)) return;
  const workflow = await load("MiniMax H3 - I2V - BALANCED - RTX 4080 12GB.json");
  const objectInfo = await getObjectInfo(workflow);
  const prompt = convertCanvasWorkflow(workflow, objectInfo);
  assert.ok(Object.values(prompt).some((node) => node.class_type === "LoadImage"));
  assert.ok(Object.values(prompt).some((node) => node.class_type === "LoraLoaderModelOnly"));
  assert.ok(Object.values(prompt).some((node) => Object.values(node._meta?.inputLabels || {}).includes("duration")));
  const math = Object.values(prompt).find((node) => node.class_type === "ComfyMathExpression");
  const duration = Object.entries(prompt).find(([, node]) => node.class_type === "PrimitiveFloat")?.[0];
  assert.ok(math, "converted workflow should retain its duration expression");
  assert.deepEqual(math.inputs["values.a"], [duration, 0]);
  assert.equal("values" in math.inputs, false, "dotted ComfyUI input names must remain literal keys");
  assert.equal(Object.values(prompt).some((node) => /^[0-9a-f-]{36}$/i.test(node.class_type)), false);
  assert.deepEqual(missingRequired(prompt, objectInfo), []);
});

test("converts the active Qwen Image Edit 2509 branch", async (t) => {
  if (!await integrationReady(t)) return;
  const workflow = await load("Qwen Image Edit 2509 - RTX 4080 12GB - FP8 4 Step.json");
  const objectInfo = await getObjectInfo(workflow);
  const prompt = convertCanvasWorkflow(workflow, objectInfo);
  assert.ok(Object.values(prompt).some((node) => node.class_type === "TextEncodeQwenImageEditPlus"));
  assert.ok(Object.values(prompt).some((node) => node.class_type === "LoraLoaderModelOnly"));
  assert.ok(Object.values(prompt).some((node) => node.class_type === "LoadImage"));
  assert.deepEqual(missingRequired(prompt, objectInfo), []);
});

test("converts every saved Qwen and MiniMax workflow with complete server inputs", async (t) => {
  if (!await integrationReady(t)) return;
  const names = (await readdir(workflowRoot)).filter((name) => /qwen|minimax/i.test(name) && name.endsWith(".json"));
  assert.ok(names.length >= 12, "the installed Qwen and MiniMax workflow set should be present");
  for (const name of names) {
    const workflow = await load(name);
    const objectInfo = await getObjectInfo(workflow);
    const prompt = convertCanvasWorkflow(workflow, objectInfo);
    assert.deepEqual(missingRequired(prompt, objectInfo), [], `${name} should preserve every required server input`);
    const unsupported = Object.entries(prompt).flatMap(([id, node]) => Object.entries(node.inputs || {})
      .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value) && !isLoraInputValue(value))
      .map(([key]) => `${id}:${node.class_type}.${key}`));
    assert.deepEqual(unsupported, [], `${name} should not expose unsupported object-valued generation controls`);
  }
});

test("converts every saved workflow with complete required custom-node inputs", async (t) => {
  if (!await integrationReady(t)) return;
  const names = (await readdir(workflowRoot)).filter((name) => !name.startsWith(".") && name.endsWith(".json"));
  assert.ok(names.length, "at least one installed workflow should be present");
  for (const name of names) {
    const workflow = await load(name);
    const objectInfo = await getObjectInfo(workflow);
    const prompt = convertCanvasWorkflow(workflow, objectInfo);
    assert.ok(Object.keys(prompt).length, `${name} should contain runnable nodes`);
    assert.deepEqual(missingRequired(prompt, objectInfo), [], `${name} should preserve every required server input`);
  }
});
