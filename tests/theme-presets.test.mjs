import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("theme engine defines obsidian default and all 5 color presets", () => {
  assert.match(styles, /\[data-theme="obsidian"\]/, "obsidian theme preset defined");
  assert.match(styles, /\[data-theme="midnight"\]/, "midnight theme preset defined");
  assert.match(styles, /\[data-theme="emerald"\]/, "emerald theme preset defined");
  assert.match(styles, /\[data-theme="amethyst"\]/, "amethyst theme preset defined");
  assert.match(styles, /\[data-theme="light"\]/, "light theme preset defined");
});

test("solid primary action buttons avoid multi-color gradient fills", () => {
  assert.match(styles, /\.queue-button\s*\{[^}]*background:\s*var\(--accent\)/, "queue-button uses clean solid accent background");
  assert.match(styles, /\.primary-action\s*\{[^}]*background:\s*var\(--accent\)/, "primary-action uses clean solid accent background");
});

test("mobile-first responsive queries protect touch dock and tabbar", () => {
  assert.match(styles, /@media\s*\(max-width:\s*699px\)/, "mobile 699px breakpoint defined");
  assert.match(styles, /@media\s*\(max-width:\s*430px\)/, "compact mobile 430px breakpoint defined");
});
