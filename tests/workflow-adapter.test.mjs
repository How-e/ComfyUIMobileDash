import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { loadEnv } from "vite";
import { normalizeWorkflow, convertCanvasWorkflow, workflowClassTypes } from "../src/workflowAdapter.js";
import { sampleWorkflow } from "../src/sampleWorkflow.js";

const localEnv = loadEnv("development", process.cwd(), "");
const comfyUrl = (localEnv.COMFYUI_URL || process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const candidates = [
  localEnv.COMFYUI_WORKFLOW_DIR || process.env.COMFYUI_WORKFLOW_DIR,
  resolve(process.cwd(), "..", "user", "default", "workflows"),
  resolve(process.cwd(), "..", "ComfyUI", "user", "default", "workflows"),
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

test("normalizes the bundled API workflow without a ComfyUI installation", () => {
  assert.deepEqual(normalizeWorkflow(sampleWorkflow), sampleWorkflow);
});

test("converts named widget objects and fills newly added required defaults", () => {
  const workflow = {
    nodes: [{ id: 1, type: "OutputNode", mode: 0, inputs: [], widgets_values: { title: "saved", preview: { ignored: true } } }],
    links: [],
  };
  const info = {
    OutputNode: {
      output_node: true,
      input: { required: {
        title: ["STRING", { default: "default" }],
        new_option: ["INT", { default: 3 }],
      } },
      input_order: { required: ["title", "new_option"] },
    },
  };
  assert.deepEqual(convertCanvasWorkflow(workflow, info)["1"].inputs, { title: "saved", new_option: 3 });
});

async function load(name) {
  if (!workflowRoot) throw new Error("No ComfyUI workflow directory was found");
  return JSON.parse((await readFile(new URL(name, workflowRoot), "utf8")).replace(/^\uFEFF/, ""));
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
    const response = await fetch(`${comfyUrl}/object_info/${encodeURIComponent(type)}`);
    assert.equal(response.ok, true, `ComfyUI object_info should include ${type}`);
    return response.json();
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
