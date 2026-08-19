import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { convertCanvasWorkflow, workflowClassTypes } from "../src/workflowAdapter.js";

const workflowRoot = new URL("../../ComfyUI/user/default/workflows/", import.meta.url);

async function load(name) {
  return JSON.parse((await readFile(new URL(name, workflowRoot), "utf8")).replace(/^\uFEFF/, ""));
}

async function getObjectInfo(workflow) {
  const parts = await Promise.all(workflowClassTypes(workflow).map(async (type) => {
    const response = await fetch(`http://127.0.0.1:8188/object_info/${encodeURIComponent(type)}`);
    assert.equal(response.ok, true, `ComfyUI object_info should include ${type}`);
    return response.json();
  }));
  return Object.assign({}, ...parts);
}

function missingRequired(prompt, objectInfo) {
  return Object.entries(prompt).flatMap(([id, node]) => {
    const required = Object.keys(objectInfo[node.class_type]?.input?.required || {});
    return required.filter((name) => !(name in node.inputs)).map((name) => `${id}:${node.class_type}.${name}`);
  });
}

test("converts the saved MiniMax H3 subgraph workflow", async () => {
  const workflow = await load("MiniMax H3 - I2V - BALANCED - RTX 4080 12GB.json");
  const objectInfo = await getObjectInfo(workflow);
  const prompt = convertCanvasWorkflow(workflow, objectInfo);
  assert.ok(Object.values(prompt).some((node) => node.class_type === "LoadImage"));
  assert.ok(Object.values(prompt).some((node) => node.class_type === "LoraLoaderModelOnly"));
  assert.ok(Object.values(prompt).some((node) => Object.values(node._meta?.inputLabels || {}).includes("duration")));
  assert.equal(Object.values(prompt).some((node) => /^[0-9a-f-]{36}$/i.test(node.class_type)), false);
  assert.deepEqual(missingRequired(prompt, objectInfo), []);
});

test("converts the active Qwen Image Edit 2509 branch", async () => {
  const workflow = await load("Qwen Image Edit 2509 - RTX 4080 12GB - FP8 4 Step.json");
  const objectInfo = await getObjectInfo(workflow);
  const prompt = convertCanvasWorkflow(workflow, objectInfo);
  assert.ok(Object.values(prompt).some((node) => node.class_type === "TextEncodeQwenImageEditPlus"));
  assert.ok(Object.values(prompt).some((node) => node.class_type === "LoraLoaderModelOnly"));
  assert.ok(Object.values(prompt).some((node) => node.class_type === "LoadImage"));
  assert.deepEqual(missingRequired(prompt, objectInfo), []);
});
