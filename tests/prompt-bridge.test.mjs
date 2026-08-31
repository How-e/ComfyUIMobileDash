import assert from "node:assert/strict";
import test from "node:test";
import { comfyImageViewPath, promptBridgeTargets } from "../src/promptBridge.js";

test("finds every transferable prompt and image input without changing values", () => {
  const workflow = {
    "4": { class_type: "LoadImage", inputs: { image: "references/hero.png", upload: "image" }, _meta: { title: "Hero reference" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "positive prompt", clip: ["1", 1] }, _meta: { title: "Positive" } },
    "7": { class_type: "CustomPromptNode", inputs: { negative_prompt: "low quality", guide_image: "guide.webp", strength: 0.8 }, _meta: { inputLabels: { guide_image: "Guide frame" } } },
  };
  const targets = promptBridgeTargets(workflow);
  assert.deepEqual(targets.prompts.map(({ id, value }) => [id, value]), [["6:text", "positive prompt"], ["7:negative_prompt", "low quality"]]);
  assert.deepEqual(targets.images.map(({ id, value }) => [id, value]), [["4:image", "references/hero.png"], ["7:guide_image", "guide.webp"]]);
  assert.match(targets.images[1].label, /Guide frame/);
});

test("builds safe ComfyUI view paths for root and subfolder image references", () => {
  assert.equal(comfyImageViewPath("hero image.png"), "/view?filename=hero+image.png&subfolder=&type=input");
  assert.equal(comfyImageViewPath("shots\\scene 1\\frame.webp [output]"), "/view?filename=frame.webp&subfolder=shots%2Fscene+1&type=output");
  assert.throws(() => comfyImageViewPath(""), /empty/);
});
