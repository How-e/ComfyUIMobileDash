import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAiController, stopLocalComfyProcess } from "../server/localAiController.mjs";

function harness({ desktop = false, daemon = false, desktopOnStart = false, presets = [], comfyOffline = false } = {}) {
  const calls = [];
  let daemonRunning = desktop || daemon;
  let isDaemon = daemon;
  let serverRunning = daemon;
  let loaded = [];
  const run = async (args) => {
    calls.push(["lms", ...args]);
    const command = args.join(" ");
    if (command === "daemon status --json") return JSON.stringify({ status: daemonRunning ? "running" : "not-running", isDaemon, pid: daemonRunning ? 42 : undefined });
    if (command === "daemon up --json") {
      daemonRunning = true;
      isDaemon = !desktopOnStart;
      return JSON.stringify({ status: "running", isDaemon });
    }
    if (command === "daemon down") { daemonRunning = false; isDaemon = false; return ""; }
    if (command === "server status --json") return JSON.stringify({ running: serverRunning });
    if (command.startsWith("server start")) { serverRunning = true; return ""; }
    if (command === "server stop") { serverRunning = false; return ""; }
    if (command === "ls --json") return JSON.stringify([
      { type: "llm", vision: true, modelKey: "vision-model", displayName: "Vision Model", sizeBytes: 4_000_000_000 },
      { type: "llm", vision: false, modelKey: "text-model", displayName: "Text Model" },
    ]);
    if (command === "ps --json") return JSON.stringify(loaded);
    if (command === "unload --all") { loaded = []; return ""; }
    if (command.startsWith("load vision-model")) { loaded = [{ modelKey: "vision-model", identifier: "vision-model", displayName: "Vision Model" }]; return ""; }
    if (command.startsWith("load text-model")) { loaded = [{ modelKey: "text-model", identifier: "text-model", displayName: "Text Model" }]; return ""; }
    throw new Error(`Unexpected command: ${command}`);
  };
  const fetch = async (url, options = {}) => {
    calls.push([options.method || "GET", url, options.body]);
    if (comfyOffline && !url.endsWith("/v1/chat/completions")) throw new TypeError("fetch failed");
    if (url.endsWith("/queue")) return Response.json({ queue_running: [], queue_pending: [] });
    if (url.endsWith("/free")) return new Response(null, { status: 200 });
    if (url.endsWith("/v1/chat/completions")) return Response.json({ choices: [{ message: { content: "A polished local prompt" } }] });
    return new Response("not found", { status: 404 });
  };
  const stopComfyProcess = async () => { calls.push(["stop-comfy"]); return { ProcessId: 123, Name: "python.exe" }; };
  return { controller: createLocalAiController({ run, fetch, delay: async () => {}, readPresets: async () => presets, stopComfyProcess }), calls };
}

test("switches from an idle ComfyUI runtime to loopback-only llmster", async () => {
  const { controller, calls } = harness();
  const result = await controller.start();
  assert.equal(result.mode, "prompt");
  assert.deepEqual(result.models.map((model) => model.modelKey), ["vision-model", "text-model"]);
  assert.equal(result.models.find((model) => model.modelKey === "vision-model").vision, true);
  assert.equal(result.models.find((model) => model.modelKey === "text-model").vision, false);
  assert.ok(calls.some((call) => call[0] === "POST" && call[1].endsWith("/free") && call[2].includes('"unload_models":true')));
  assert.ok(calls.some((call) => call.join(" ").includes("server start --port 1234 --bind 127.0.0.1")));
});

test("refuses handoff while the LM Studio desktop application is running", async () => {
  const { controller, calls } = harness({ desktop: true });
  await assert.rejects(controller.start(), /Quit it completely/);
  assert.equal(calls.some((call) => call[0] === "POST"), false);
});

test("explains when daemon up launches the desktop service instead of llmster", async () => {
  const { controller } = harness({ desktopOnStart: true });
  await assert.rejects(controller.start(), /Install llmster for Windows/);
});

test("loads one vision model, keeps its catalog visible, generates locally, then fully stops llmster", async () => {
  const { controller, calls } = harness({ daemon: true });
  const loaded = await controller.load("vision-model");
  assert.equal(loaded.loaded[0].modelKey, "vision-model");
  assert.equal(loaded.models[0].modelKey, "vision-model");
  assert.ok(calls.some((call) => call.join(" ").includes("--context-length 8192 --parallel 1 --ttl 900")));
  const generated = await controller.generate({
    instructions: "Make this cinematic",
    imageDataUrl: "data:image/png;base64,aGVsbG8=",
  });
  assert.equal(generated.prompt, "A polished local prompt");
  const stopped = await controller.stop();
  assert.equal(stopped.mode, "comfy");
  assert.ok(calls.some((call) => call.join(" ") === "lms unload --all"));
  assert.ok(calls.some((call) => call.join(" ") === "lms daemon down"));
});

test("independent LM mode may start when ComfyUI is intentionally offline", async () => {
  const { controller } = harness({ comfyOffline: true });
  const result = await controller.start({ allowComfyOffline: true });
  assert.equal(result.mode, "prompt");
});

test("normal handoff still fails closed while ComfyUI is offline", async () => {
  const { controller } = harness({ comfyOffline: true });
  await assert.rejects(controller.start(), /could not be verified/);
});

test("loads a text-only model with bounded runtime settings and chats without an image", async () => {
  const { controller, calls } = harness({ daemon: true });
  const loaded = await controller.load("text-model", "", { contextLength: 16384, ttl: 1800 });
  assert.equal(loaded.loaded[0].modelKey, "text-model");
  assert.deepEqual(loaded.loadSettings, { contextLength: 16384, ttl: 1800 });
  assert.ok(calls.some((call) => call.join(" ").includes("load text-model --context-length 16384 --parallel 1 --ttl 1800")));
  const response = await controller.chat({ prompt: "Explain local inference", temperature: 0.2, maxTokens: 512 });
  assert.equal(response.content, "A polished local prompt");
  const body = JSON.parse(calls.findLast((call) => call[1]?.endsWith("/v1/chat/completions"))[2]);
  assert.equal(body.messages.at(-1).content, "Explain local inference");
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 512);
});

test("unloads an LM model without stopping the headless runtime", async () => {
  const { controller, calls } = harness({ daemon: true });
  await controller.load("text-model");
  const result = await controller.unload();
  assert.equal(result.mode, "prompt");
  assert.deepEqual(result.loaded, []);
  assert.equal(calls.some((call) => call.join(" ") === "lms daemon down"), false);
});

test("applies a selected LM Studio preset without exposing its system prompt in status", async () => {
  const preset = {
    identifier: "@local:test-preset",
    name: "Test preset",
    operation: { fields: [
      { key: "llm.prediction.systemPrompt", value: "Private preset instructions" },
      { key: "llm.prediction.temperature", value: 0.7 },
      { key: "llm.prediction.topKSampling", value: 24 },
      { key: "llm.prediction.repeatPenalty", value: { checked: true, value: 1.1 } },
    ] },
  };
  const { controller, calls } = harness({ daemon: true, presets: [preset] });
  const loaded = await controller.load("vision-model", preset.identifier);
  assert.deepEqual(loaded.presets, [{ id: preset.identifier, name: preset.name }]);
  assert.equal(JSON.stringify(loaded).includes("Private preset instructions"), false);
  await controller.generate({ instructions: "Describe this", imageDataUrl: "data:image/png;base64,aGVsbG8=" });
  const body = JSON.parse(calls.find((call) => call[1]?.endsWith("/v1/chat/completions"))[2]);
  assert.equal(body.messages[0].content, "Private preset instructions");
  assert.equal(body.temperature, 0.7);
  assert.equal(body.top_k, 24);
  assert.equal(body.repeat_penalty, 1.1);
});

test("frees models in LM Studio and ComfyUI without loading either runtime", async () => {
  const { controller, calls } = harness({ daemon: true });
  const result = await controller.freeMemory();
  assert.equal(result.memoryFreed, true);
  assert.ok(calls.some((call) => call.join(" ") === "lms unload --all"));
  assert.ok(calls.some((call) => call.join(" ") === "lms daemon down"));
  assert.ok(calls.some((call) => call[0] === "POST" && call[1].endsWith("/free")));
  assert.equal(calls.some((call) => call.join(" ").startsWith("lms load ")), false);
  assert.equal(result.mode, "comfy");
});

test("frees ComfyUI memory before closing its verified local process", async () => {
  const { controller, calls } = harness();
  const result = await controller.closeComfy();
  assert.equal(result.closed, true);
  const freeIndex = calls.findIndex((call) => call[0] === "POST" && call[1].endsWith("/free"));
  const stopIndex = calls.findIndex((call) => call[0] === "stop-comfy");
  assert.ok(freeIndex >= 0 && stopIndex > freeIndex);
});

test("releases only ComfyUI model memory from its independent control room", async () => {
  const { controller, calls } = harness();
  const result = await controller.freeComfyOnly();
  assert.equal(result.memoryFreed, true);
  assert.ok(calls.some((call) => call[0] === "POST" && call[1].endsWith("/free")));
  assert.equal(calls.some((call) => call[0] === "lms" && call[1] === "unload"), false);
});

test("refuses memory cleanup while ComfyUI has queued work", async () => {
  const busyController = createLocalAiController({
    run: async (args) => args.join(" ") === "daemon status --json" ? JSON.stringify({ status: "not-running" }) : "[]",
    fetch: async (url) => url.endsWith("/queue") ? Response.json({ queue_running: [[1, "active"]], queue_pending: [] }) : new Response(null, { status: 200 }),
    readPresets: async () => [],
  });
  await assert.rejects(busyController.freeMemory(), /Stop the active ComfyUI job/);
});

test("passes the configured ComfyUI port to PowerShell through the environment", async () => {
  let invocation;
  const execute = async (...args) => {
    invocation = args;
    return { stdout: JSON.stringify({ ProcessId: 123, Name: "python.exe" }) };
  };
  const result = await stopLocalComfyProcess("http://127.0.0.1:8188", execute);
  assert.equal(invocation[2].env.COMFY_DASH_PORT, "8188");
  assert.equal(invocation[1].at(-1).includes("$env:COMFY_DASH_PORT"), true);
  assert.equal(invocation[1].includes("8188"), false);
  assert.equal(result.ProcessId, 123);
});

test("supports configurable LM Studio host and port", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args.join(" "));
    if (args[0] === "daemon" && args[1] === "status") return JSON.stringify({ status: "running", isDaemon: true, pid: 99 });
    if (args[0] === "server" && args[1] === "status") return JSON.stringify({ running: false });
    if (args[0] === "server" && args[1] === "start") return "";
    return "[]";
  };
  const fetch = async (url) => {
    if (url.endsWith("/queue")) return Response.json({ queue_running: [], queue_pending: [] });
    if (url.endsWith("/free")) return new Response(null, { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const controller = createLocalAiController({
    lmStudioUrl: "http://127.0.0.1:8080",
    run,
    fetch,
    delay: async () => {},
  });
  await controller.start();
  assert.ok(calls.some((cmd) => cmd.includes("server start --port 8080 --bind 127.0.0.1")));
});
