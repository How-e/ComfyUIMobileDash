import test from "node:test";
import assert from "node:assert/strict";
import { formatImageDimensions } from "../src/imageDimensions.js";

test("formats image resolution with a simplified landscape aspect ratio", () => {
  assert.equal(formatImageDimensions(1920, 1080), "1920 x 1080 · 16:9");
});

test("formats portrait and square image ratios", () => {
  assert.equal(formatImageDimensions(1080, 1920), "1080 x 1920 · 9:16");
  assert.equal(formatImageDimensions(1024, 1024), "1024 x 1024 · 1:1");
});

test("omits invalid dimensions", () => {
  assert.equal(formatImageDimensions(0, 1080), "");
  assert.equal(formatImageDimensions(undefined, undefined), "");
});
