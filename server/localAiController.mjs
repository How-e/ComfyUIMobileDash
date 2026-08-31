import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const JSON_TYPE = "application/json; charset=utf-8";
const BODY_LIMIT = 18 * 1024 * 1024;
const DEFAULT_LM_HOST = "http://127.0.0.1:1234";
const VISION_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const DEFAULT_PRESET_DIR = join(homedir(), ".lmstudio", "config-presets");

function comfyEndpoint(value) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw Object.assign(new Error("ComfyUI can only be closed when it is running on this PC."), { status: 403 });
  }
  return { url, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)) };
}

export async function stopLocalComfyProcess(comfyUrl, execute = execFile) {
  const { port } = comfyEndpoint(comfyUrl);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$port = [int]$env:COMFY_DASH_PORT",
    "$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port)",
    "if (-not $listeners.Count) { throw \"No process is listening on port $port.\" }",
    "$pids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)",
    "$targets = @(Get-CimInstance Win32_Process | Where-Object { $pids -contains [uint32]$_.ProcessId })",
    "$unsafe = @($targets | Where-Object { $_.Name -notmatch '^python(?:w)?\\.exe$' -or $_.CommandLine -notmatch '(?i)(ComfyUI|main\\.py)' })",
    "if ($unsafe.Count) { throw 'The listener is not a verified ComfyUI Python process; it was not closed.' }",
    "$targets | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }",
    "$targets | Select-Object ProcessId, Name | ConvertTo-Json -Compress",
  ].join("; ");
  const result = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, COMFY_DASH_PORT: String(port) },
  });
  return parseJsonOutput(result.stdout.trim(), []);
}

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", JSON_TYPE);
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

function parseJsonOutput(output, fallback) {
  try { return JSON.parse(output || ""); } catch { return fallback; }
}

function checkedValue(value) {
  if (value && typeof value === "object" && "checked" in value) return value.checked === false ? undefined : value.value;
  return value;
}

function presetRequestConfig(preset) {
  const fields = new Map((preset?.operation?.fields || []).map((field) => [field.key, checkedValue(field.value)]));
  const mapped = {};
  const assign = (source, target) => {
    const value = fields.get(source);
    if (value !== undefined && value !== null && value !== "") mapped[target] = value;
  };
  assign("llm.prediction.temperature", "temperature");
  assign("llm.prediction.topKSampling", "top_k");
  assign("llm.prediction.topPSampling", "top_p");
  assign("llm.prediction.minPSampling", "min_p");
  assign("llm.prediction.repeatPenalty", "repeat_penalty");
  assign("llm.prediction.frequencyPenalty", "frequency_penalty");
  assign("llm.prediction.presencePenalty", "presence_penalty");
  assign("llm.prediction.seed", "seed");
  assign("llm.prediction.maxTokens", "max_tokens");
  return {
    systemPrompt: fields.get("llm.prediction.systemPrompt"),
    request: mapped,
  };
}

function queueItems(queue) {
  if (Array.isArray(queue)) return [...(queue[0] || []), ...(queue[1] || [])];
  return [...(queue?.queue_running || []), ...(queue?.queue_pending || [])];
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("Image request is too large."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 }); }
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const expected = `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
  if (origin !== expected) throw Object.assign(new Error("Cross-origin control request blocked."), { status: 403 });
}

export function createLocalAiController(options = {}) {
  const run = options.run || (async (args, timeout = 120000) => {
    const result = await execFile("lms", args, { encoding: "utf8", timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return result.stdout.trim();
  });
  const request = options.fetch || globalThis.fetch;
  const delay = options.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const comfyUrl = (options.comfyUrl || "http://127.0.0.1:8188").replace(/\/$/, "");
  const lmStudioUrl = (options.lmStudioUrl || process.env.LMSTUDIO_URL || process.env.LM_STUDIO_URL || DEFAULT_LM_HOST).replace(/\/$/, "");
  const lmParsed = new URL(lmStudioUrl);
  const lmPort = lmParsed.port || (lmParsed.protocol === "https:" ? "443" : "80");
  const lmHost = lmParsed.hostname;
  const presetDir = options.presetDir || process.env.LMSTUDIO_PRESET_DIR || DEFAULT_PRESET_DIR;
  const stopComfyProcess = options.stopComfyProcess || (() => stopLocalComfyProcess(comfyUrl));
  const readPresets = options.readPresets || (async () => {
    const names = await readdir(presetDir);
    return Promise.all(names.filter((name) => name.toLowerCase().endsWith(".json")).map(async (file) => {
      try { return JSON.parse(await readFile(join(presetDir, file), "utf8")); } catch { return null; }
    }));
  });
  let transition = null;
  let selectedModel = "";
  let selectedPresetId = "";
  let selectedLoadSettings = { contextLength: 8192, ttl: 900 };

  async function presets() {
    let values;
    try { values = await readPresets(); } catch { return []; }
    const loaded = values.map((value) => value?.identifier && value?.name && Array.isArray(value.operation?.fields)
      ? { id: value.identifier, name: value.name, value }
      : null);
    return loaded.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function publicPresets() {
    return (await presets()).map(({ id, name }) => ({ id, name }));
  }

  async function resolvePreset(presetId) {
    if (!presetId) return null;
    const preset = (await presets()).find((item) => item.id === presetId);
    if (!preset) throw Object.assign(new Error("Choose an available LM Studio preset."), { status: 400 });
    return preset;
  }

  async function daemonStatus() {
    const output = await run(["daemon", "status", "--json"], 15000).catch(() => "{}");
    const value = parseJsonOutput(output, {});
    return { running: value.status === "running", isDaemon: value.isDaemon === true, pid: value.pid || null };
  }

  async function serverStatus() {
    const output = await run(["server", "status", "--json"], 15000).catch(() => "{}");
    const value = parseJsonOutput(output, {});
    return value.running === true;
  }

  async function loadedModels() {
    const output = await run(["ps", "--json"], 15000).catch(() => "[]");
    return parseJsonOutput(output, []);
  }

  async function catalog() {
    const output = await run(["ls", "--json"], 30000);
    return parseJsonOutput(output, []).filter((model) => model.type === "llm").map((model) => ({
      modelKey: model.modelKey,
      displayName: model.displayName || model.modelKey,
      sizeBytes: model.sizeBytes || 0,
      paramsString: model.paramsString || "",
      architecture: model.architecture || "",
      vision: model.vision === true,
    }));
  }

  async function status(includeCatalog = false) {
    const daemon = await daemonStatus();
    if (!daemon.running) return { mode: "comfy", daemon, serverRunning: false, loaded: [], models: [], presets: await publicPresets(), selectedPresetId: "" };
    const [serverRunning, loaded] = await Promise.all([serverStatus(), loadedModels()]);
    if (loaded.length && !selectedModel) selectedModel = loaded[0].identifier || loaded[0].modelKey || "";
    return {
      mode: daemon.isDaemon ? "prompt" : "desktop",
      daemon,
      serverRunning,
      loaded: loaded.map((model) => ({ identifier: model.identifier || model.modelKey, modelKey: model.modelKey, displayName: model.displayName })),
      models: includeCatalog && daemon.isDaemon ? await catalog() : [],
      presets: await publicPresets(),
      selectedPresetId,
      selectedModel,
      loadSettings: selectedLoadSettings,
    };
  }

  async function exclusive(name, action) {
    if (transition) throw Object.assign(new Error(`${transition} is already in progress.`), { status: 409 });
    transition = name;
    try { return await action(); } finally { transition = null; }
  }

  async function assertComfyIdle() {
    let response;
    try {
      response = await request(`${comfyUrl}/queue`, { signal: AbortSignal.timeout(5000) });
    } catch (error) {
      throw Object.assign(new Error(`ComfyUI cleanup could not be verified: ${error.message}`), { status: 503, comfyUnavailable: true });
    }
    if (!response.ok) throw Object.assign(new Error(`ComfyUI cleanup could not be verified: HTTP ${response.status}`), { status: 502 });
    let queue;
    try { queue = await response.json(); }
    catch { throw Object.assign(new Error("ComfyUI returned an invalid queue response."), { status: 502 }); }
    if (queueItems(queue).length) throw Object.assign(new Error("Stop the active ComfyUI job and clear its pending queue first."), { status: 409 });
  }

  async function requestComfyMemoryRelease() {
    const freed = await request(`${comfyUrl}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!freed.ok) throw Object.assign(new Error(`ComfyUI refused memory cleanup (HTTP ${freed.status}).`), { status: 502 });
  }

  async function freeComfyMemory() {
    await assertComfyIdle();
    await requestComfyMemoryRelease();
  }

  async function start({ allowComfyOffline = false } = {}) {
    return exclusive("Runtime handoff", async () => {
      const before = await daemonStatus();
      if (before.running && !before.isDaemon) {
        throw Object.assign(new Error("LM Studio desktop is running. Quit it completely from the system tray once, then try again; Prompt Studio uses the lighter headless daemon."), { status: 409 });
      }

      try { await freeComfyMemory(); }
      catch (error) {
        if (!(allowComfyOffline && error.comfyUnavailable)) throw error;
      }
      await delay(750);

      let started;
      if (!before.running) {
        const output = await run(["daemon", "up", "--json"], 30000);
        started = parseJsonOutput(output, {});
      }
      const daemon = await daemonStatus();
      if (daemon.running && !daemon.isDaemon) {
        throw Object.assign(new Error("LM Studio desktop started instead of the standalone headless runtime. Install llmster for Windows from the official LM Studio headless setup, then quit LM Studio from the system tray and try again."), { status: 409 });
      }
      if (!daemon.running) {
        const detail = started?.status && started.status !== "running" ? ` (status: ${started.status})` : "";
        throw new Error(`The LM Studio headless daemon did not start${detail}.`);
      }
      if (!(await serverStatus())) await run(["server", "start", "--port", lmPort, "--bind", lmHost], 30000);
      return status(true);
    });
  }

  async function load(modelKey, presetId = "", options = {}) {
    return exclusive("Model load", async () => {
      const runtime = await status(true);
      if (runtime.mode !== "prompt") throw Object.assign(new Error("Start Prompt Studio before loading a model."), { status: 409 });
      if (!runtime.models.some((model) => model.modelKey === modelKey)) throw Object.assign(new Error("Choose an installed LM Studio model."), { status: 400 });
      await resolvePreset(presetId);
      const contextLength = Number(options.contextLength ?? 8192);
      const ttl = Number(options.ttl ?? 900);
      if (!Number.isInteger(contextLength) || contextLength < 2048 || contextLength > 32768) {
        throw Object.assign(new Error("Context length must be between 2,048 and 32,768 tokens."), { status: 400 });
      }
      if (!Number.isInteger(ttl) || ttl < 300 || ttl > 3600) {
        throw Object.assign(new Error("Idle unload must be between 5 and 60 minutes."), { status: 400 });
      }
      await run(["unload", "--all"], 60000).catch(() => "");
      await run(["load", modelKey, "--context-length", String(contextLength), "--parallel", "1", "--ttl", String(ttl), "--yes"], 300000);
      const loaded = await loadedModels();
      const match = loaded.find((model) => model.modelKey === modelKey) || loaded[0];
      selectedModel = match?.identifier || match?.modelKey || modelKey;
      selectedPresetId = presetId;
      selectedLoadSettings = { contextLength, ttl };
      return { ...(await status(true)), selectedModel };
    });
  }

  async function unload() {
    return exclusive("Model unload", async () => {
      const runtime = await status(false);
      if (runtime.mode !== "prompt") throw Object.assign(new Error("The LM Studio headless runtime is not active."), { status: 409 });
      await run(["unload", "--all"], 60000);
      selectedModel = "";
      return { ...(await status(true)), unloaded: true };
    });
  }

  async function chat({ messages = [], prompt = "", systemPrompt = "", imageDataUrl = "", presetId = selectedPresetId, temperature, maxTokens } = {}) {
    const runtime = await status(false);
    if (runtime.mode !== "prompt" || !runtime.serverRunning || !runtime.loaded.length) throw Object.assign(new Error("Load an LM Studio model before sending a message."), { status: 409 });
    const normalizedMessages = Array.isArray(messages) ? messages.slice(-24).map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || "").slice(0, 20000),
    })).filter((message) => message.content.trim()) : [];
    const userPrompt = String(prompt || "").trim();
    if (userPrompt) normalizedMessages.push({ role: "user", content: userPrompt });
    if (!normalizedMessages.length) throw Object.assign(new Error("Enter a message for the model."), { status: 400 });
    if (imageDataUrl && !VISION_DATA_URL.test(String(imageDataUrl))) throw Object.assign(new Error("Choose a JPEG, PNG, or WebP image."), { status: 400 });
    const selected = runtime.loaded.find((model) => (model.identifier || model.modelKey) === selectedModel) || runtime.loaded[0];
    const catalogModel = (await catalog()).find((model) => model.modelKey === selected.modelKey);
    if (imageDataUrl && catalogModel && !catalogModel.vision) throw Object.assign(new Error("The loaded model does not support image input."), { status: 400 });
    const preset = await resolvePreset(presetId);
    selectedPresetId = presetId;
    const presetConfig = presetRequestConfig(preset?.value);
    const requestConfig = { ...presetConfig.request };
    if (temperature !== undefined) {
      const value = Number(temperature);
      if (!Number.isFinite(value) || value < 0 || value > 2) throw Object.assign(new Error("Temperature must be between 0 and 2."), { status: 400 });
      requestConfig.temperature = value;
    }
    if (maxTokens !== undefined) {
      const value = Number(maxTokens);
      if (!Number.isInteger(value) || value < 64 || value > 8192) throw Object.assign(new Error("Max output must be between 64 and 8,192 tokens."), { status: 400 });
      requestConfig.max_tokens = value;
    }
    const last = normalizedMessages.at(-1);
    if (imageDataUrl && last?.role === "user") last.content = [
      { type: "text", text: last.content },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ];
    const resolvedSystem = String(systemPrompt || "").trim() || presetConfig.systemPrompt;
    const response = await request(`${lmStudioUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel || selected.identifier || selected.modelKey,
        temperature: 0.4,
        max_tokens: 2048,
        ...requestConfig,
        messages: [...(resolvedSystem ? [{ role: "system", content: resolvedSystem.slice(0, 20000) }] : []), ...normalizedMessages],
      }),
      signal: AbortSignal.timeout(300000),
    });
    if (!response.ok) throw Object.assign(new Error((await response.text()) || `LM Studio returned HTTP ${response.status}.`), { status: 502 });
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content?.trim();
    if (!content) throw Object.assign(new Error("The model returned an empty response."), { status: 502 });
    return { content, model: selectedModel || selected.identifier || selected.modelKey };
  }

  async function generate({ instructions, imageDataUrl, presetId = selectedPresetId }) {
    if (!String(instructions || "").trim()) throw Object.assign(new Error("Add instructions for the prompt you want to create."), { status: 400 });
    if (!VISION_DATA_URL.test(String(imageDataUrl || ""))) throw Object.assign(new Error("Choose a JPEG, PNG, or WebP image."), { status: 400 });
    const runtime = await status(false);
    if (runtime.mode !== "prompt" || !runtime.serverRunning || !runtime.loaded.length) throw Object.assign(new Error("Load a vision model before generating a prompt."), { status: 409 });
    const model = selectedModel || runtime.loaded[0].identifier;
    const preset = await resolvePreset(presetId);
    selectedPresetId = presetId;
    const presetConfig = presetRequestConfig(preset?.value);
    const systemPrompt = presetConfig.systemPrompt || "Create one polished, detailed prompt for an image or video generation model. Use the supplied image as visual reference and follow the user's instructions. Return only the final prompt, with no analysis, headings, quotation marks, or commentary.";
    const response = await request(`${lmStudioUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 2048,
        ...presetConfig.request,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [
            { type: "text", text: String(instructions).trim() },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ] },
        ],
      }),
      signal: AbortSignal.timeout(300000),
    });
    if (!response.ok) throw Object.assign(new Error((await response.text()) || `LM Studio returned HTTP ${response.status}.`), { status: 502 });
    const result = await response.json();
    const prompt = result.choices?.[0]?.message?.content?.trim();
    if (!prompt) throw Object.assign(new Error("The model returned an empty prompt."), { status: 502 });
    return { prompt };
  }

  async function stop() {
    return exclusive("Runtime shutdown", async () => {
      const before = await daemonStatus();
      if (before.running && !before.isDaemon) throw Object.assign(new Error("LM Studio desktop is running and cannot be safely closed by the headless controller. Quit it from the system tray."), { status: 409 });
      if (before.running) {
        await run(["unload", "--all"], 60000).catch(() => "");
        if (await serverStatus()) await run(["server", "stop"], 30000).catch(() => "");
        await run(["daemon", "down"], 30000);
      }
      selectedModel = "";
      selectedPresetId = "";
      const after = await daemonStatus();
      if (after.running) throw new Error("LM Studio is still running; ComfyUI remains locked to prevent overlapping model use.");
      return { mode: "comfy", daemon: after, serverRunning: false, loaded: [], models: [], presets: await publicPresets(), selectedPresetId: "" };
    });
  }

  async function freeMemory() {
    return exclusive("Memory cleanup", async () => {
      await assertComfyIdle();
      const daemon = await daemonStatus();
      if (daemon.running && !daemon.isDaemon) {
        throw Object.assign(new Error("LM Studio desktop is running. Quit it from the system tray so memory cleanup can leave LM Studio fully closed."), { status: 409 });
      }
      if (daemon.running) {
        await run(["unload", "--all"], 60000);
        if (await serverStatus()) await run(["server", "stop"], 30000).catch(() => "");
        await run(["daemon", "down"], 30000);
      }
      selectedModel = "";
      selectedPresetId = "";
      await requestComfyMemoryRelease();
      return { ...(await status(true)), memoryFreed: true };
    });
  }

  async function freeComfyOnly() {
    return exclusive("ComfyUI memory cleanup", async () => {
      await freeComfyMemory();
      return { memoryFreed: true };
    });
  }

  async function closeComfy() {
    return exclusive("ComfyUI shutdown", async () => {
      comfyEndpoint(comfyUrl);
      await freeComfyMemory();
      const stopped = await stopComfyProcess();
      return { closed: true, stopped: Array.isArray(stopped) ? stopped : [stopped] };
    });
  }

  return { status, start, load, unload, chat, generate, stop, freeMemory, freeComfyOnly, closeComfy };
}

export function localAiPlugin(options = {}) {
  const controller = createLocalAiController(options);
  const attach = (server) => {
    server.middlewares.use(middleware);
    server.httpServer?.once("close", () => { void controller.stop().catch(() => {}); });
  };
  const middleware = async (req, res, next) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/local-ai/")) return next();
    try {
      assertSameOrigin(req);
      if (req.method !== "GET" && !String(req.headers["content-type"] || "").startsWith("application/json")) {
        throw Object.assign(new Error("Control requests require JSON."), { status: 415 });
      }
      if (req.method === "GET" && path === "/local-ai/status") return json(res, 200, await controller.status(true));
      const body = req.method === "GET" ? {} : await readBody(req);
      if (req.method === "POST" && path === "/local-ai/start") return json(res, 200, await controller.start());
      if (req.method === "POST" && path === "/local-ai/start-independent") return json(res, 200, await controller.start({ allowComfyOffline: true }));
      if (req.method === "POST" && path === "/local-ai/load") return json(res, 200, await controller.load(body.modelKey, body.presetId, body));
      if (req.method === "POST" && path === "/local-ai/unload") return json(res, 200, await controller.unload());
      if (req.method === "POST" && path === "/local-ai/chat") return json(res, 200, await controller.chat(body));
      if (req.method === "POST" && path === "/local-ai/generate") return json(res, 200, await controller.generate(body));
      if (req.method === "POST" && path === "/local-ai/stop") return json(res, 200, await controller.stop());
      if (req.method === "POST" && path === "/local-ai/free-memory") return json(res, 200, await controller.freeMemory());
      if (req.method === "POST" && path === "/local-ai/free-comfy") return json(res, 200, await controller.freeComfyOnly());
      if (req.method === "POST" && path === "/local-ai/close-comfy") return json(res, 200, await controller.closeComfy());
      return json(res, 404, { error: "Unknown local AI route." });
    } catch (error) {
      return json(res, error.status || 500, { error: error.message || "Local AI control failed." });
    }
  };
  return {
    name: "comfy-deck-local-ai",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

