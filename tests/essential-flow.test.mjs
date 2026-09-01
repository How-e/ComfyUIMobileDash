import assert from "node:assert/strict";
import test from "node:test";
import { essentialStepForNode, groupEssentialNodes } from "../src/essentialFlow.js";

test("groups generic workflow controls into the four editable essentials steps", () => {
  const nodes = [
    { id: "1", class_type: "LoadImage", inputs: { image: "input.png" } },
    { id: "2", class_type: "AnyTextEncoder", inputs: { prompt: "hello" } },
    { id: "3", class_type: "CustomVideoTiming", inputs: { duration_seconds: 5, fps: 24 } },
    { id: "4", class_type: "UniversalModelLoader", inputs: { model_name: "local.safetensors" } },
    { id: "5", class_type: "VendorSpecificNode", inputs: { custom_value: 1 } },
  ];
  const groups = groupEssentialNodes(nodes);
  assert.deepEqual(groups.image.map(({ id }) => id), ["1"]);
  assert.deepEqual(groups.prompt.map(({ id }) => id), ["2"]);
  assert.deepEqual(groups.settings.map(({ id }) => id), ["3"]);
  assert.deepEqual(groups.model.map(({ id }) => id), ["4"]);
  assert.deepEqual(groups.advanced.map(({ id }) => id), ["5"]);
});

test("model terms take precedence over generic settings embedded in model nodes", () => {
  assert.equal(essentialStepForNode({ class_type: "LoRAAdapter", inputs: { model_strength: 0.8 } }), "model");
});
