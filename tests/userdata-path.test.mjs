import assert from "node:assert/strict";
import test from "node:test";
import { encodeUserdataPath } from "../src/userdataPath.js";

test("encodes normal workflow paths for ComfyUI userdata routes", () => {
  assert.equal(
    encodeUserdataPath("workflows/Custom Model - I2V.json"),
    "workflows%2FCustom%20Model%20-%20I2V.json",
  );
});

test("protects literal percent escapes from ComfyUI's second decode", () => {
  assert.equal(
    encodeUserdataPath("workflows/Custom-Edit-A4E892BAE5878D%A2.json"),
    "workflows%2FCustom-Edit-A4E892BAE5878D%2525A2.json",
  );
});
