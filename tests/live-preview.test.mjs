import assert from "node:assert/strict";
import test from "node:test";
import { parseKjPreview, parsePreviewFrame } from "../src/livePreview.js";

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function frame(...parts) {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(new Uint8Array(part.buffer || part, part.byteOffset || 0, part.byteLength), offset);
    offset += part.byteLength;
  }
  return bytes.buffer;
}

test("parses legacy JPEG preview frames", async () => {
  const parsed = parsePreviewFrame(frame(uint32(1), uint32(1), new Uint8Array([0xff, 0xd8, 0xff])));
  assert.equal(parsed.blob.type, "image/jpeg");
  assert.deepEqual([...new Uint8Array(await parsed.blob.arrayBuffer())], [0xff, 0xd8, 0xff]);
  assert.deepEqual(parsed.metadata, {});
});

test("parses metadata preview frames and preserves prompt scope", async () => {
  const metadata = new TextEncoder().encode(JSON.stringify({
    image_type: "image/png",
    prompt_id: "prompt-123",
    node_id: "141",
  }));
  const parsed = parsePreviewFrame(frame(uint32(4), uint32(metadata.byteLength), metadata, new Uint8Array([0x89, 0x50, 0x4e, 0x47])));
  assert.equal(parsed.blob.type, "image/png");
  assert.equal(parsed.metadata.prompt_id, "prompt-123");
  assert.equal(parsed.metadata.node_id, "141");
  assert.deepEqual([...new Uint8Array(await parsed.blob.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47]);
});

test("ignores unrelated and malformed binary events", () => {
  assert.equal(parsePreviewFrame(new Uint8Array([1, 2, 3]).buffer), null);
  assert.equal(parsePreviewFrame(frame(uint32(3), uint32(1), new Uint8Array([1]))), null);
  assert.equal(parsePreviewFrame(frame(uint32(4), uint32(99), new Uint8Array([1]))), null);
});

test("parses KJ Model Preview Override animated payloads", async () => {
  const parsed = parseKjPreview({
    image: btoa(String.fromCharCode(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70)),
    mime: "video/mp4",
    node_id: "141",
    step: 3,
    total: 8,
    w: 720,
    h: 480,
  });
  assert.equal(parsed.blob.type, "video/mp4");
  assert.deepEqual(parsed.metadata, { node_id: "141", step: 3, total: 8, width: 720, height: 480 });
  assert.equal((await parsed.blob.arrayBuffer()).byteLength, 8);
});

test("rejects empty KJ payloads and defaults old image messages to JPEG", () => {
  assert.equal(parseKjPreview({ image: "" }), null);
  assert.equal(parseKjPreview(null), null);
  assert.equal(parseKjPreview({ image: btoa("jpeg") }).blob.type, "image/jpeg");
});
