import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("gallery videos and images preserve their intrinsic aspect ratios", () => {
  const rule = styles.match(/\.gallery-grid img,\.gallery-grid video\{([^}]+)\}/);

  assert.ok(rule, "gallery image/video rule should stay shared");
  assert.match(rule[1], /width:100%/);
  assert.match(rule[1], /height:auto/);
  assert.match(rule[1], /object-fit:contain/);
  assert.doesNotMatch(rule[1], /aspect-ratio/);
});
