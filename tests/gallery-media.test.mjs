import assert from "node:assert/strict";
import test from "node:test";
import { collectMedia, galleryGenerations, mediaKind } from "../src/galleryMedia.js";

const base = "/comfy";
const file = (filename, extra = {}) => ({ filename, subfolder: extra.subfolder || "", type: extra.type || "output", ...extra });
const history = (outputs) => ({ prompt123: { outputs } });

test("collects still images from output.images", () => {
  const media = collectMedia(history({ 9: { images: [file("ComfyUI_00001.png")] } }), base);
  assert.equal(media.length, 1);
  assert.equal(media[0].kind, "image");
  assert.equal(media[0].filename, "ComfyUI_00001.png");
  assert.equal(media[0].url, "/comfy/view?filename=ComfyUI_00001.png&subfolder=&type=output");
  assert.equal("blob" in media[0], false);
});

test("marks SaveVideo mp4 refs as video without treating animated as files", () => {
  const media = collectMedia(history({
    12: { images: [file("walk.mp4", { subfolder: "video" })], animated: [true] },
  }), base);
  assert.deepEqual(media.map((item) => [item.kind, item.filename, item.subfolder]), [["video", "walk.mp4", "video"]]);
});

test("ignores animated when it is only True and there are no file arrays", () => {
  assert.deepEqual(collectMedia(history({ 3: { animated: [true] } }), base), []);
  assert.deepEqual(collectMedia(history({ 3: { animated: true } }), base), []);
});

test("collects VHS gifs and videos buckets", () => {
  const media = collectMedia(history({
    20: { gifs: [file("combine.mp4", { format: "video/h264-mp4" })] },
    21: { videos: [file("preview.webm")] },
  }), base);
  assert.deepEqual(media.map((item) => [item.kind, item.filename]), [["video", "combine.mp4"], ["video", "preview.webm"]]);
});

test("gif webp png and jpg stay images", () => {
  const media = collectMedia(history({
    1: { images: [file("still.png"), file("photo.jpg")], gifs: [file("loop.gif"), file("loop.webp")] },
  }), base);
  assert.deepEqual(media.map((item) => item.kind), ["image", "image", "image", "image"]);
});

test("format field can mark a video when the extension is missing", () => {
  assert.equal(mediaKind(file("output", { format: "video/h264-mp4" })), "video");
  assert.equal(mediaKind(file("clip.mov")), "video");
  assert.equal(mediaKind(file("loop.gif")), "image");
});

test("dedupes the same ref when it appears in images and gifs", () => {
  const media = collectMedia(history({
    8: { images: [file("same.mp4")], gifs: [file("same.mp4")], animated: [true] },
  }), base);
  assert.equal(media.length, 1);
  assert.equal(media[0].kind, "video");
});

test("galleryGenerations keeps the newest 5 runs that have media", () => {
  const runs = [
    { promptId: "queued", queuedAt: 900, workflowName: "Queued", images: [] },
    { promptId: "new", completedAt: 800, workflowName: "Newest", images: [file("a.png")] },
    { promptId: "v", completedAt: 700, workflowName: "Video", images: [file("b.mp4", { kind: "video" })] },
    { promptId: "3", completedAt: 600, workflowName: "Three", images: [file("c.png")] },
    { promptId: "4", completedAt: 500, workflowName: "Four", images: [file("d.png")] },
    { promptId: "5", completedAt: 400, workflowName: "Five", images: [file("e.png")] },
    { promptId: "old", completedAt: 300, workflowName: "Dropped", images: [file("f.png")] },
    { promptId: "empty", completedAt: 1000, workflowName: "Empty", images: [] },
  ];
  const generations = galleryGenerations(runs, base, 5);
  assert.deepEqual(generations.map((item) => item.promptId), ["new", "v", "3", "4", "5"]);
  assert.equal(generations[1].media[0].kind, "video");
  assert.equal(generations[1].media[0].url.includes("/view?"), true);
  assert.equal(generations.length, 5);
});

test("one generation can mix image and video refs", () => {
  const media = collectMedia(history({
    9: { images: [file("still.png")] },
    12: { images: [file("motion.mp4")], animated: [true] },
  }), base);
  assert.deepEqual(media.map((item) => item.kind), ["image", "video"]);
});

test("galleryGenerations infers kind for older refs without kind", () => {
  const [generation] = galleryGenerations([{
    promptId: "legacy",
    completedAt: 1,
    workflowName: "Legacy",
    images: [file("clip.webm")],
  }], base, 5);
  assert.equal(generation.media[0].kind, "video");
  assert.equal(generation.media[0].url, "/comfy/view?filename=clip.webm&subfolder=&type=output");
});
