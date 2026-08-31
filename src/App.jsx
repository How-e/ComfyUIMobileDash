import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Activity, Bot, Check, ChevronDown, CircleStop, Clipboard, Cpu, FileJson, FolderOpen, GalleryHorizontalEnd, Image as ImageIcon,
  HardDriveDownload, ListFilter, LoaderCircle, Maximize2, MemoryStick, Minus, Play, Plus, Power, RefreshCw, Search,
  SlidersHorizontal, Sparkles, Trash2, Upload, Wifi, WifiOff, X,
} from "lucide-preact";
import { collectMedia, galleryGenerations } from "./galleryMedia";
import { CREATE_SESSION_KEY, parseCreateSession, writeCreateSession } from "./createSession";
import { formatImageDimensions } from "./imageDimensions";
import { parseKjPreview, parsePreviewFrame } from "./livePreview";
import { activeQueueState, getPersistentClientId } from "./queueRecovery";
import { addLoraInput, applyControlAfterGenerate, isLoraInputValue, normalizeWorkflow, priorityForNode, removeLoraInput, updateWorkflowInput, workflowClassTypes, workflowInputSpec } from "./workflowAdapter";
import { comfyImageViewPath, promptBridgeTargets } from "./promptBridge";
import { encodeUserdataPath } from "./userdataPath";
import { LMStudioPanel } from "./LMStudioPanel";

const makeClientId = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
const clone = (value) => JSON.parse(JSON.stringify(value));
const editable = (value) => ["string", "number", "boolean"].includes(typeof value) || isLoraInputValue(value);
const STORAGE = { activePrompt: "comfydeck.activePrompt", runs: "comfydeck.recentRuns", createSession: CREATE_SESSION_KEY };
const LIGHTWEIGHT = {
  maxSavedRuns: 16,
  maxGalleryGenerations: 5,
  completionFallbackMs: 5000,
  queueRefresh: "manual-or-queue-tab",
  historyFetch: "active-prompt-only",
};

function errorText(value, fallback) {
  if (typeof value === "string") return value.trim() || fallback;
  const primary = (typeof value?.error === "string" ? value.error : value?.error?.message) || value?.message || fallback;
  const details = value?.error?.details || value?.details;
  const nodeDetails = Object.entries(value?.node_errors || {}).flatMap(([id, node]) =>
    (node.errors || []).map((error) => `Node ${id} ${node.class_type || ""}: ${error.message}${error.details ? ` (${error.details})` : ""}`));
  return [primary, details, ...nodeDetails].filter(Boolean).join(" — ");
}

function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function queueJob(item, running = false) {
  const [number, promptId, prompt, extraData] = item;
  return { number, promptId, prompt, running, createdAt: extraData?.create_time || 0 };
}

function normalizeBase(raw) {
  const value = raw.trim().replace(/\/$/, "");
  return value || "/comfy";
}

function httpUrl(base, path) { return `${base}${path}`; }

function wsUrl(base, clientId) {
  if (base.startsWith("http")) return `${base.replace(/^http/, "ws")}/ws?clientId=${clientId}`;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${base}/ws?clientId=${clientId}`;
}

function nodeTitle(node) { return node._meta?.title || node.class_type.replace(/([a-z])([A-Z])/g, "$1 $2"); }
function isPowerLoraNode(node) { return node.class_type.toLowerCase().includes("power lora loader"); }

const SEED_CONTROL_MODES = [
  ["fixed", "Fixed"],
  ["increment", "Increment"],
  ["decrement", "Decrement"],
  ["randomize", "Randomize"],
];

function inputSpec(info, name, values = {}) { return workflowInputSpec(info, name, values); }

function hasSeedControl(name, spec) {
  return name === "seed" || name === "noise_seed" || !!spec?.[1]?.control_after_generate;
}

function withDefaultSeedModes(workflow, objectInfo = {}) {
  const next = clone(workflow);
  for (const node of Object.values(next)) {
    const info = objectInfo[node.class_type];
    const modes = { ...node._meta?.controlAfterGenerate };
    let changed = false;
    for (const [name, value] of Object.entries(node.inputs || {})) {
      if (typeof value !== "number" || name in modes) continue;
      if (!hasSeedControl(name, inputSpec(info, name, node.inputs))) continue;
      modes[name] = "randomize";
      changed = true;
    }
    if (changed) node._meta = { ...node._meta, controlAfterGenerate: modes };
  }
  return next;
}

function nodeTone(node) {
  const text = `${node.class_type} ${nodeTitle(node)}`.toLowerCase();
  if (text.includes("text") || text.includes("prompt") || text.includes("clip")) return "coral";
  if (text.includes("sampler") || text.includes("scheduler")) return "blue";
  if (text.includes("load") || text.includes("model") || text.includes("lora")) return "green";
  if (text.includes("latent") || text.includes("image")) return "violet";
  return "slate";
}

export default function App() {
  const [base, setBase] = useState(() => localStorage.getItem("comfydeck.base") || "/comfy");
  const [draftBase, setDraftBase] = useState(base);
  const [createBoot] = useState(() => parseCreateSession(readLocal(STORAGE.createSession, null)));
  const [workflow, setWorkflow] = useState(createBoot.workflow);
  const [workflowName, setWorkflowName] = useState(createBoot.workflowName);
  const [objectInfo, setObjectInfo] = useState({});
  const [savedWorkflows, setSavedWorkflows] = useState([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [connected, setConnected] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryWorking, setMemoryWorking] = useState("");
  const [memoryMessage, setMemoryMessage] = useState("Unload model memory or close a local runtime when you are finished.");
  const [busy, setBusy] = useState(false);
  const [queueRemaining, setQueueRemaining] = useState(0);
  const [queueJobs, setQueueJobs] = useState([]);
  const [progress, setProgress] = useState(null);
  const [livePreview, setLivePreview] = useState(null);
  const [activeNode, setActiveNode] = useState(null);
  const [activePromptId, setActivePromptId] = useState(() => localStorage.getItem(STORAGE.activePrompt) || "");
  const [images, setImages] = useState([]);
  const [recentRuns, setRecentRuns] = useState(() => readLocal(STORAGE.runs, []));
  const [activeTab, setActiveTab] = useState(createBoot.activeTab);
  const [workspace, setWorkspace] = useState(() => {
    const saved = localStorage.getItem("comfydeck.workspace");
    return ["flow", "comfy", "lm"].includes(saved) ? saved : createBoot.activeTab === "prompt" ? "flow" : "comfy";
  });
  const [search, setSearch] = useState(createBoot.search);
  const [essentialsOnly, setEssentialsOnly] = useState(createBoot.essentialsOnly);
  const [notice, setNotice] = useState(createBoot.restored ? `${createBoot.workflowName} restored.` : "Demo workflow loaded — open your API JSON when ready.");
  const [focusEditor, setFocusEditor] = useState(null);
  const [aiStatus, setAiStatus] = useState({ mode: "unknown", loaded: [], models: [] });
  const fileRef = useRef(null);
  const clientId = useRef(getPersistentClientId(sessionStorage, makeClientId));
  const activePromptRef = useRef(activePromptId);
  const finishPromptRef = useRef(null);
  const objectInfoRef = useRef({});
  const objectInfoRequests = useRef(new Map());
  const objectInfoBaseRef = useRef(base);
  const workflowRef = useRef(workflow);
  const livePreviewUrlRef = useRef("");
  const runningPromptRef = useRef("");
  workflowRef.current = workflow;

  const clearLivePreview = useCallback(() => {
    if (livePreviewUrlRef.current) URL.revokeObjectURL(livePreviewUrlRef.current);
    livePreviewUrlRef.current = "";
    setLivePreview(null);
  }, []);

  const showLivePreview = useCallback((frame) => {
    const nextUrl = URL.createObjectURL(frame.blob);
    if (livePreviewUrlRef.current) URL.revokeObjectURL(livePreviewUrlRef.current);
    livePreviewUrlRef.current = nextUrl;
    setLivePreview({
      url: nextUrl,
      nodeId: frame.metadata.node_id || frame.metadata.display_node_id || "",
      promptId: frame.metadata.prompt_id || runningPromptRef.current || activePromptRef.current,
      step: Number.isFinite(frame.metadata.step) ? frame.metadata.step : null,
      total: Number.isFinite(frame.metadata.total) ? frame.metadata.total : null,
      kind: frame.blob.type.startsWith("video/") ? "video" : "image",
    });
  }, []);

  useEffect(() => clearLivePreview, [clearLivePreview]);

  useEffect(() => {
    activePromptRef.current = activePromptId;
    if (activePromptId) localStorage.setItem(STORAGE.activePrompt, activePromptId);
    else localStorage.removeItem(STORAGE.activePrompt);
  }, [activePromptId]);
  useEffect(() => { localStorage.setItem(STORAGE.runs, JSON.stringify(recentRuns.slice(0, LIGHTWEIGHT.maxSavedRuns))); }, [recentRuns]);
  useEffect(() => {
    writeCreateSession(STORAGE.createSession, { workflow, workflowName, essentialsOnly, search, activeTab });
  }, [workflow, workflowName, essentialsOnly, search, activeTab]);
  useEffect(() => { localStorage.setItem("comfydeck.workspace", workspace); }, [workspace]);

  const request = useCallback(async (path, options) => {
    const response = await fetch(httpUrl(base, path), options);
    if (!response.ok) {
      const raw = await response.text();
      let detail = raw;
      try { detail = JSON.parse(raw); } catch { /* Keep plain-text proxy/server errors. */ }
      throw new Error(errorText(detail, `ComfyUI returned ${response.status}`));
    }
    return response.headers.get("content-type")?.includes("json") ? response.json() : response;
  }, [base]);

  const loadObjectInfo = useCallback(async (json) => {
    const types = workflowClassTypes(json);
    if (types.some((type) => type.toLowerCase().includes("power lora loader")) && !types.includes("LoraLoaderModelOnly")) {
      types.push("LoraLoaderModelOnly");
    }
    const fetchType = (type) => {
      if (objectInfoRef.current[type]) return Promise.resolve();
      if (!objectInfoRequests.current.has(type)) {
        objectInfoRequests.current.set(type, request(`/object_info/${encodeURIComponent(type)}`)
          .then((info) => {
            if (objectInfoBaseRef.current === base) objectInfoRef.current = { ...objectInfoRef.current, ...info };
          })
          .finally(() => objectInfoRequests.current.delete(type)));
      }
      return objectInfoRequests.current.get(type);
    };
    await Promise.all(types.map(fetchType));
    setObjectInfo(objectInfoRef.current);
    return objectInfoRef.current;
  }, [request]);

  useEffect(() => {
    loadObjectInfo(workflowRef.current).catch(() => {});
  }, [loadObjectInfo]);

  const testConnection = useCallback(async (quiet = false) => {
    try {
      const [, files] = await Promise.all([
        request("/system_stats"),
        request("/v2/userdata?path=workflows"),
      ]);
      const workflows = (files || []).filter((item) => item.type === "file" && item.name.toLowerCase().endsWith(".json") && !item.name.startsWith("."));
      setSavedWorkflows(workflows);
      setConnected(true);
      if (!quiet) setNotice(`Connected — ${workflows.length} saved workflows found.`);
      return true;
    } catch {
      setConnected(false);
      if (!quiet) setNotice("Could not reach ComfyUI. Start it, then check the address.");
      return false;
    }
  }, [request]);

  useEffect(() => { testConnection(true); }, [testConnection]);
  useEffect(() => {
    if (!libraryOpen && !connectionOpen && !memoryOpen) return;
    document.body.classList.add("sheet-open");
    return () => document.body.classList.remove("sheet-open");
  }, [libraryOpen, connectionOpen, memoryOpen]);

  const refreshQueue = useCallback(async (quiet = false) => {
    try {
      const [running = [], pending = []] = await request("/queue");
      const jobs = [...running.map((item) => queueJob(item, true)), ...pending.map((item) => queueJob(item))];
      setQueueJobs(jobs);
      setQueueRemaining(pending.length);
      return jobs;
    } catch (error) { if (!quiet) setNotice(`Could not refresh queue: ${error.message}`); return []; }
  }, [request]);

  const rememberRun = useCallback((run) => {
    setRecentRuns((current) => [run, ...current.filter((item) => item.promptId !== run.promptId)].slice(0, LIGHTWEIGHT.maxSavedRuns));
  }, []);

  const finishPrompt = useCallback(async (promptId) => {
    if (!promptId) return false;
    try {
      const history = await request(`/history/${promptId}`);
      if (!history?.[promptId]) return false;
      const historyItem = history[promptId];
      const messages = historyItem.status?.messages || [];
      const interrupted = messages.some((message) => message?.[0] === "execution_interrupted");
      const failed = historyItem.status?.status_str === "error";
      const nextImages = collectMedia(history, base);
      setImages(nextImages);
      clearLivePreview();
      setBusy(false); setProgress(null); setActivePromptId("");
      rememberRun({ promptId, workflowName, workflow: clone(workflow), ...(failed ? { stoppedAt: Date.now() } : { completedAt: Date.now() }), images: nextImages.map(({ url, ...image }) => image) });
      setNotice(interrupted ? "Generation interrupted." : failed ? "Workflow stopped with an execution error." : nextImages.length ? `${nextImages.length} output${nextImages.length === 1 ? "" : "s"} ready.` : "Workflow finished.");
      refreshQueue(true);
      return true;
    } catch { return false; /* Completion can be recovered next time the dashboard opens. */ }
  }, [base, clearLivePreview, rememberRun, refreshQueue, request, workflow, workflowName]);
  useEffect(() => { finishPromptRef.current = finishPrompt; }, [finishPrompt]);

  useEffect(() => {
    if (!activePromptId) return;
    let disposed = false;
    let fallback;
    const recover = async () => {
      const finished = await finishPromptRef.current?.(activePromptId);
      if (finished || disposed) return;
      const jobs = await refreshQueue(true);
      if (disposed) return;
      const state = activeQueueState(activePromptId, jobs);
      if (state === "running") {
        runningPromptRef.current = activePromptId;
        setBusy(true);
        setNotice(`Restored running prompt ${String(activePromptId).slice(0, 8)}. Progress and preview will resume with the next update.`);
      } else if (state === "pending") {
        setBusy(false);
        setNotice(`Restored queued prompt ${String(activePromptId).slice(0, 8)}.`);
      }
      fallback = setTimeout(() => finishPromptRef.current?.(activePromptId), LIGHTWEIGHT.completionFallbackMs);
    };
    recover();
    return () => { disposed = true; clearTimeout(fallback); };
  }, [activePromptId, refreshQueue]);

  useEffect(() => { if (activeTab === "queue") refreshQueue(true); }, [activeTab, refreshQueue]);

  useEffect(() => {
    let socket;
    let retry;
    let disposed = false;
    const connect = () => {
      socket = new WebSocket(wsUrl(base, clientId.current));
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        setConnected(true);
        socket.send(JSON.stringify({ type: "feature_flags", data: { supports_preview_metadata: true } }));
      };
      socket.onclose = () => { setConnected(false); clearLivePreview(); if (!disposed) retry = setTimeout(connect, 3500); };
      socket.onerror = () => socket.close();
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const frame = parsePreviewFrame(event.data);
          if (!frame) return;
          const promptId = frame.metadata.prompt_id;
          if (promptId && runningPromptRef.current && promptId !== runningPromptRef.current) return;
          showLivePreview(frame);
          return;
        }
        if (typeof event.data !== "string") return;
        const message = JSON.parse(event.data);
        const data = message.data || {};
        if (message.type === "kj_preview_override") {
          const frame = parseKjPreview(data);
          if (frame) showLivePreview(frame);
          return;
        }
        if (message.type === "status") setQueueRemaining(data.status?.exec_info?.queue_remaining || 0);
        if (message.type === "execution_start") { runningPromptRef.current = data.prompt_id || activePromptRef.current; clearLivePreview(); setBusy(true); setProgress(null); }
        if (message.type === "executing") { setActiveNode(data.node); if (data.node === null && data.prompt_id === activePromptRef.current) finishPromptRef.current?.(activePromptRef.current); }
        if (message.type === "progress") setProgress({ value: data.value || 0, max: data.max || 1 });
        if (message.type === "execution_error") { runningPromptRef.current = ""; clearLivePreview(); setBusy(false); setNotice(`Execution stopped at node ${data.node_id || "unknown"}.`); }
      };
    };
    connect();
    return () => { disposed = true; clearTimeout(retry); socket?.close(); };
  }, [base, clearLivePreview, showLivePreview]);

  const nodes = useMemo(() => Object.entries(workflow).map(([id, node]) => ({ id, ...node })).sort((a, b) => priorityForNode(a) - priorityForNode(b)), [workflow]);
  const visibleNodes = useMemo(() => nodes.filter((node) => {
    const haystack = `${nodeTitle(node)} ${node.class_type} ${Object.keys(node.inputs).join(" ")} ${Object.values(node._meta?.inputLabels || {}).join(" ")}`.toLowerCase();
    return haystack.includes(search.toLowerCase()) && (Object.values(node.inputs).some(editable) || isPowerLoraNode(node)) && (!essentialsOnly || priorityForNode(node) <= 4);
  }), [nodes, search, essentialsOnly]);
  const loraOptions = useMemo(() => {
    const spec = inputSpec(objectInfo.LoraLoaderModelOnly, "lora_name");
    return Array.isArray(spec?.[0]) ? spec[0] : [];
  }, [objectInfo]);

  function updateInput(nodeId, key, value) {
    setWorkflow((current) => {
      const node = current[nodeId];
      const info = objectInfoRef.current[node.class_type];
      return { ...current, [nodeId]: { ...node, inputs: updateWorkflowInput(node.inputs, info, key, value) } };
    });
  }

  function updateMeta(nodeId, key, value) {
    setWorkflow((current) => ({ ...current, [nodeId]: { ...current[nodeId], _meta: { ...current[nodeId]._meta, [key]: value } } }));
  }

  async function openFile(file) {
    if (!file) return;
    try {
      const json = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      const info = await loadObjectInfo(json);
      const next = normalizeWorkflow(json, info);
      setWorkflow(next);
      setWorkflowName(file.name.replace(/\.json$/i, ""));
      setImages([]);
      setNotice(`${Object.keys(next).length} nodes loaded. Linked values stay protected.`);
    } catch (error) { setNotice(error.message); }
  }

  async function openSavedWorkflow(item) {
    setNotice(`Opening ${item.name}…`);
    try {
      const json = await request(`/userdata/${encodeUserdataPath(item.path)}`);
      const info = await loadObjectInfo(json);
      const next = normalizeWorkflow(json, info);
      setWorkflow(next);
      setWorkflowName(item.name.replace(/\.json$/i, ""));
      setImages([]);
      setActiveTab("create");
      setLibraryOpen(false);
      setNotice(`${Object.keys(next).length} runnable nodes loaded from ComfyUI.`);
    } catch (error) { setNotice(`Could not open workflow: ${error.message}`); }
  }

  async function uploadImage(nodeId, file, inputName = "image") {
    if (!file) return null;
    const form = new FormData();
    form.append("image", file);
    form.append("type", "input");
    form.append("overwrite", "true");
    try {
      setNotice(`Uploading ${file.name}…`);
      const result = await request("/upload/image", { method: "POST", body: form });
      const value = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
      updateInput(nodeId, inputName, value);
      setNotice(`${result.name} is ready as the workflow input.`);
      return value;
    } catch (error) { setNotice(`Image upload failed: ${error.message}`); return null; }
  }

  async function queuePrompt(promptToQueue = workflow, name = workflowName, front = false) {
    if (aiStatus.mode !== "comfy") {
      setWorkspace("flow");
      setNotice("Finish Prompt Studio and release its model before queueing ComfyUI.");
      return null;
    }
    setBusy(true); setProgress(null); setNotice("Sending workflow to ComfyUI…");
    try {
      const result = await request("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: promptToQueue, client_id: clientId.current, ...(front ? { front: true } : {}) }) });
      setActivePromptId(result.prompt_id);
      rememberRun({ promptId: result.prompt_id, workflowName: name, workflow: clone(promptToQueue), queuedAt: Date.now(), images: [] });
      if (result.prompt_id) setWorkflow((current) => applyControlAfterGenerate(withDefaultSeedModes(current, objectInfo)));
      setNotice(`Queued as ${String(result.prompt_id).slice(0, 8)}. Watching progress…`);
      setTimeout(() => finishPrompt(result.prompt_id), LIGHTWEIGHT.completionFallbackMs);
      refreshQueue(true);
      return result;
    } catch (error) { setBusy(false); setNotice(error.message); return null; }
  }

  async function interrupt() {
    try { await request("/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(activePromptId ? { prompt_id: activePromptId } : {}) }); setNotice("Interrupt requested."); refreshQueue(true); }
    catch (error) { setNotice(error.message); }
  }

  async function removeQueued(promptId) {
    try { await request("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [promptId] }) }); setNotice("Removed queued job."); refreshQueue(true); }
    catch (error) { setNotice(`Could not remove job: ${error.message}`); }
  }
  async function clearQueue() {
    try { await request("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); setNotice("Cleared pending queue."); refreshQueue(true); }
    catch (error) { setNotice(`Could not clear queue: ${error.message}`); }
  }
  async function moveToFront(job) {
    const result = await queuePrompt(job.prompt, "Queued workflow", true);
    if (result) await removeQueued(job.promptId);
  }

  function saveConnection() {
    const next = normalizeBase(draftBase);
    if (next !== base) {
      objectInfoBaseRef.current = next;
      objectInfoRef.current = {};
      objectInfoRequests.current.clear();
      setObjectInfo({});
    }
    setBase(next); localStorage.setItem("comfydeck.base", next); setConnectionOpen(false);
  }

  const editableCount = nodes.reduce((sum, node) => sum + Object.values(node.inputs).filter(editable).length, 0);
  const progressPercent = progress ? Math.round((progress.value / progress.max) * 100) : null;
  const bridgeTargets = useMemo(() => promptBridgeTargets(workflow), [workflow]);
  const promptTargets = bridgeTargets.prompts;
  const imageTargets = bridgeTargets.images;
  const promptRuntimeActive = aiStatus.mode === "prompt" || aiStatus.mode === "desktop";
  const runtimeChecking = aiStatus.mode === "unknown";

  async function readWorkflowImage(targetId) {
    const target = imageTargets.find((item) => item.id === targetId) || imageTargets[0];
    if (!target) throw new Error("No transferable image input exists in the current workflow.");
    const response = await request(comfyImageViewPath(target.value));
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("ComfyUI did not return an image for that input.");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const name = target.value.replace(/\s+\[(input|output|temp)\]$/i, "").replaceAll("\\", "/").split("/").pop();
    return { dataUrl, name, label: target.label };
  }

  function addNodeLora(nodeId, lora) {
    setWorkflow((current) => ({ ...current, [nodeId]: { ...current[nodeId], inputs: addLoraInput(current[nodeId].inputs, lora) } }));
  }

  function removeNodeLora(nodeId, name) {
    setWorkflow((current) => ({ ...current, [nodeId]: { ...current[nodeId], inputs: removeLoraInput(current[nodeId].inputs, name) } }));
  }

  async function applyStudioTransfer({ promptTargetId, prompt, imageTargetId, imageDataUrl, imageName }) {
    const applied = [];
    const promptTarget = promptTargets.find((item) => item.id === promptTargetId);
    if (prompt && promptTarget) {
      updateInput(promptTarget.nodeId, promptTarget.key, prompt);
      applied.push("prompt");
    }
    const imageTarget = imageTargets.find((item) => item.id === imageTargetId);
    if (imageDataUrl && imageTarget) {
      const blob = await fetch(imageDataUrl).then((response) => response.blob());
      const safeName = imageName || `prompt-studio.${blob.type.split("/")[1] || "png"}`;
      const file = new File([blob], safeName, { type: blob.type });
      const uploaded = await uploadImage(imageTarget.nodeId, file, imageTarget.key);
      if (uploaded) applied.push("image");
    }
    if (!applied.length) throw new Error("Choose a prompt or image target to transfer.");
    setWorkspace("comfy");
    setActiveTab("create");
    setNotice(`${applied.join(" and ")} transferred from Prompt Studio to the workflow.`);
  }

  async function runMemoryAction(name, path) {
    if (name === "close-comfy" && !globalThis.confirm("Close the local ComfyUI process? Active or queued work will be refused.")) return;
    setMemoryWorking(name);
    try {
      const next = await localAiRequest(path, {});
      if (name === "free") {
        setAiStatus(next);
        setMemoryMessage("ComfyUI and LM Studio models are unloaded. No replacement model was loaded.");
        setNotice("RAM / VRAM released from ComfyUI and LM Studio.");
      } else if (name === "close-lm") {
        setAiStatus(next);
        setMemoryMessage("The LM model, API server, and headless runtime are stopped.");
        setNotice("LM Studio headless runtime closed.");
      } else {
        setConnected(false);
        setMemoryMessage("ComfyUI was closed. The dashboard remains available.");
        setNotice("ComfyUI closed.");
      }
    } catch (error) {
      setMemoryMessage(error.message);
    } finally {
      setMemoryWorking("");
    }
  }

  return (
    <main className="app-shell" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); openFile(e.dataTransfer.files[0]); }}>
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><i/><i/><i/></div><div><span className="brand-name">COMFY</span><span className="brand-product">DECK</span></div></div>
        <div className="topbar-actions">
          <button className="memory-control-button" aria-label="Open memory and runtime controls" title="Memory and runtime controls" onClick={() => setMemoryOpen(true)}><MemoryStick/></button>
          <button className={`connection-pill ${connected ? "online" : ""}`} onClick={() => setConnectionOpen(true)}>
            {connected ? <Wifi size={15}/> : <WifiOff size={15}/>}<span><strong>{connected ? "CONNECTED" : "OFFLINE"}</strong><small>{base === "/comfy" ? "LOCAL PROXY · 8188" : base.replace(/^https?:\/\//, "")}</small></span><ChevronDown size={15}/>
          </button>
        </div>
      </header>

      <nav className="tabbar" aria-label="Workspace navigation">
        {[{id:"flow",label:"Flow",icon:RefreshCw},{id:"comfy",label:"ComfyUI",icon:Sparkles},{id:"lm",label:"LM Studio",icon:Bot}].map(({id,label,icon:Icon}) => <button key={id} aria-current={workspace===id?"page":undefined} className={workspace===id?"active":""} onClick={()=>{setWorkspace(id);if(id==="comfy"&&!['overview','create','queue','gallery'].includes(activeTab))setActiveTab("overview");}}><Icon size={19}/><span>{label}</span>{id==="comfy"&&queueRemaining>0?<b aria-label={`${queueRemaining} queued`}>{queueRemaining}</b>:null}</button>)}
      </nav>

      {workspace === "comfy" && <nav className="section-tabs" aria-label="ComfyUI sections">
        {[{id:"overview",label:"Overview"},{id:"create",label:"Create"},{id:"queue",label:"Queue"},{id:"gallery",label:"Gallery"}].map(({id,label})=><button key={id} className={activeTab===id?"active":""} aria-current={activeTab===id?"page":undefined} onClick={()=>setActiveTab(id)}>{label}{id==="queue"&&queueRemaining>0?<b>{queueRemaining}</b>:null}</button>)}
      </nav>}

      {workspace === "comfy" && activeTab === "overview" && <ComfyOverview connected={connected} request={request} workflowCount={savedWorkflows.length} onOpenCreate={()=>setActiveTab("create")} onOpenQueue={()=>setActiveTab("queue")} onOpenConnection={()=>setConnectionOpen(true)} onClosed={()=>setConnected(false)}/>}

      {workspace === "comfy" && activeTab === "create" && <section className="workspace-head">
        <div className="workflow-heading"><div className="workflow-icon">WF</div><div><span className="overline">ACTIVE WORKFLOW</span><h1>{workflowName}</h1></div></div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e)=>openFile(e.target.files?.[0])}/>
        <button className="file-button" onClick={()=>setLibraryOpen(true)}><FolderOpen size={15}/> Workflows <span>{savedWorkflows.length}</span></button>
      </section>}

      {workspace === "comfy" && activeTab === "create" && <>
        <section className="notice" role="status" aria-live="polite"><Check size={15}/><span>{notice}</span></section>
        <section className="search-row"><label className="search-box"><span className="sr-only">Find a node or setting</span><Search size={19}/><input aria-label="Find a node or setting" value={search} onInput={(e)=>setSearch(e.target.value)} placeholder="Find a control" autoCapitalize="none" autoCorrect="off"/><kbd aria-hidden="true">{visibleNodes.length}</kbd></label><button className={`filter-button ${essentialsOnly?"active":""}`} aria-pressed={essentialsOnly} aria-label={essentialsOnly?"Show all editable nodes":"Show essential nodes only"} onClick={()=>setEssentialsOnly((value)=>!value)}><ListFilter size={19}/><span className="filter-label">{essentialsOnly?"Essential":"All"}</span></button></section>
        <section className="content-area"><div className="section-title"><span>{essentialsOnly?"ESSENTIAL CONTROLS":"ALL EDITABLE CONTROLS"}</span><small>{visibleNodes.length} OF {nodes.length} NODES</small></div><div className="card-stack">
          {visibleNodes.map((node) => <NodeCard key={node.id} node={node} active={String(activeNode)===String(node.id)} updateInput={updateInput} updateMeta={updateMeta} addLora={addNodeLora} removeLora={removeNodeLora} loraOptions={loraOptions} setFocusEditor={setFocusEditor} info={objectInfo[node.class_type]} uploadImage={uploadImage} base={base}/>) }
          {!visibleNodes.length && <div className="empty-state"><SlidersHorizontal/><h2>No editable nodes found</h2><p>Try a different search or open an API-format workflow JSON.</p></div>}
        </div></section>
      </>}

      {workspace === "comfy" && activeTab === "queue" && <QueuePanel busy={busy} queueRemaining={queueRemaining} progressPercent={progressPercent} activeNode={activeNode} livePreview={livePreview} interrupt={interrupt} jobs={queueJobs} refresh={refreshQueue} removeQueued={removeQueued} clearQueue={clearQueue} moveToFront={moveToFront}/>}
      {workspace === "comfy" && activeTab === "gallery" && <Gallery runs={recentRuns} base={base} rerun={(run)=>queuePrompt(run.workflow, run.workflowName, true)} clearHistory={()=>setRecentRuns([])}/>}
      <PromptStudio hidden={workspace !== "flow"} status={aiStatus} setStatus={setAiStatus} promptTargets={promptTargets} imageTargets={imageTargets} readWorkflowImage={readWorkflowImage} applyTransfer={applyStudioTransfer}/>
      <LMStudioPanel hidden={workspace !== "lm"} status={aiStatus} setStatus={setAiStatus}/>

      {workspace === "comfy" && activeTab === "create" && <footer className="action-dock"><div className="dock-status">{busy||runtimeChecking?<LoaderCircle className="spin"/>:<span className={`ready-orb ${connected?"":"offline"}`}>{connected?<Check size={16}/>:<WifiOff size={15}/>}</span>}<span><small>{runtimeChecking?"CHECKING":promptRuntimeActive?"LM STUDIO ACTIVE":busy?"GENERATING":connected?"READY":"OFFLINE"}</small><strong>{runtimeChecking?"Runtime safety":promptRuntimeActive?"Switch back through Flow":progressPercent!==null?`${progressPercent}% complete`:`${editableCount} editable values`}</strong></span></div><button className={busy?"queue-button stop":"queue-button"} onClick={promptRuntimeActive?()=>setWorkspace("flow"):busy?interrupt:()=>queuePrompt()} disabled={runtimeChecking||(!promptRuntimeActive&&!connected)}>{busy?<CircleStop/>:promptRuntimeActive?<RefreshCw/>:<Play fill="currentColor"/>}<span><strong>{busy?"Stop":promptRuntimeActive?"Open Flow":"Queue workflow"}</strong><small>{busy?(activeNode?`NODE #${activeNode}`:"RUNNING"):promptRuntimeActive?"LM ACTIVE":"START RUN"}</small></span></button></footer>}

      {connectionOpen && <div className="modal-backdrop" onClick={()=>setConnectionOpen(false)}><section className="connection-sheet" role="dialog" aria-modal="true" aria-labelledby="connection-title" onClick={(e)=>e.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><div><span className="overline">CONNECTION</span><h2 id="connection-title">ComfyUI address</h2></div><button aria-label="Close connection settings" onClick={()=>setConnectionOpen(false)}><X/></button></div><p>Keep <b>/comfy</b> when this dashboard runs on the same PC as ComfyUI. The local proxy avoids browser cross-origin issues.</p><label><span>Server URL</span><input value={draftBase} onInput={(e)=>setDraftBase(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck="false" placeholder="/comfy or http://192.168.1.42:8188"/></label><div className="sheet-actions"><button onClick={()=>testConnection()}>Test current</button><button className="primary" onClick={saveConnection}>Save address</button></div></section></div>}
      {memoryOpen && <div className="modal-backdrop" onClick={()=>!memoryWorking&&setMemoryOpen(false)}><section className="connection-sheet memory-sheet" role="dialog" aria-modal="true" aria-labelledby="memory-title" onClick={(e)=>e.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><div><span className="overline">LOCAL RUNTIMES</span><h2 id="memory-title">Memory & shutdown</h2></div><button aria-label="Close memory controls" disabled={!!memoryWorking} onClick={()=>setMemoryOpen(false)}><X/></button></div><p className="memory-message">{memoryMessage}</p><div className="runtime-actions"><button disabled={!!memoryWorking} onClick={()=>runMemoryAction("free", "free-memory")}><span className="runtime-action-icon"><HardDriveDownload/></span><span><strong>Free RAM / VRAM</strong><small>Unload models from ComfyUI and LM Studio without loading another model.</small></span>{memoryWorking==="free"&&<LoaderCircle className="spin"/>}</button><button disabled={!!memoryWorking} onClick={()=>runMemoryAction("close-lm", "stop")}><span className="runtime-action-icon"><Power/></span><span><strong>Close LM runtime</strong><small>Unload LM models, stop its local server, and close the headless daemon.</small></span>{memoryWorking==="close-lm"&&<LoaderCircle className="spin"/>}</button><button className="danger" disabled={!!memoryWorking || !connected} onClick={()=>runMemoryAction("close-comfy", "close-comfy")}><span className="runtime-action-icon"><CircleStop/></span><span><strong>Close ComfyUI</strong><small>Free its models, then close the verified local ComfyUI process.</small></span>{memoryWorking==="close-comfy"&&<LoaderCircle className="spin"/>}</button></div></section></div>}
      {libraryOpen && <WorkflowLibrary items={savedWorkflows} search={librarySearch} setSearch={setLibrarySearch} openWorkflow={openSavedWorkflow} close={()=>setLibraryOpen(false)} importFile={()=>fileRef.current?.click()} connected={connected}/>} 
      {focusEditor && <FocusEditor editor={focusEditor} value={workflow[focusEditor.nodeId].inputs[focusEditor.key]} onChange={(value)=>updateInput(focusEditor.nodeId,focusEditor.key,value)} close={()=>setFocusEditor(null)}/>} 
    </main>
  );
}

function NodeCard({ node, active, updateInput, updateMeta, addLora, removeLora, loraOptions, setFocusEditor, info, uploadImage, base }) {
  const fields = Object.entries(node.inputs).filter(([,value])=>editable(value));
  const [newLora, setNewLora] = useState("");
  const powerLora = isPowerLoraNode(node);
  const addSelected = () => { if (newLora) { addLora(node.id, newLora); setNewLora(""); } };
  return <article className={`node-card ${nodeTone(node)} ${active?"executing":""}`}><div className="node-head"><div><span className="node-dot"/><span className="overline">{node.class_type}</span><h2>{nodeTitle(node)}</h2></div><span className="node-id">#{node.id}</span></div>{powerLora&&<div className="lora-add-row"><label><span>Add another LoRA</span>{loraOptions.length?<select aria-label={`LoRA to add to ${nodeTitle(node)}`} value={newLora} onChange={(e)=>setNewLora(e.target.value)}><option value="">Choose installed LoRA…</option>{loraOptions.map((option)=><option key={option} value={option}>{option}</option>)}</select>:<input aria-label={`LoRA to add to ${nodeTitle(node)}`} value={newLora} onInput={(e)=>setNewLora(e.target.value)} placeholder="LoRA filename" autoCapitalize="none" autoCorrect="off" spellCheck="false"/>}</label><button type="button" disabled={!newLora} onClick={addSelected}><Plus/> Add LoRA</button></div>}<div className="fields-grid">{fields.map(([key,value]) => <Field key={key} node={node} nodeId={node.id} name={key} label={node._meta?.inputLabels?.[key]} value={value} updateInput={updateInput} updateMeta={updateMeta} removeLora={removeLora} setFocusEditor={setFocusEditor} info={info} uploadImage={uploadImage} base={base}/>)}</div></article>;
}

function Field({ node, nodeId, name, label: promotedLabel, value, updateInput, updateMeta, removeLora, setFocusEditor, info, uploadImage, base }) {
  const label = (promotedLabel || name).replaceAll("_", " ");
  const spec = inputSpec(info, name, node.inputs);
  const options = Array.isArray(spec?.[0]) ? spec[0] : spec?.[0] === "COMBO" ? spec?.[1]?.options : null;
  if (node.class_type === "LoadImage" && name === "image") return <ImageField nodeId={nodeId} value={value} uploadImage={uploadImage} base={base}/>;
  if (isLoraInputValue(value)) return <LoraField nodeId={nodeId} name={name} label={label} value={value} updateInput={updateInput} removeLora={removeLora}/>;
  if (typeof value === "boolean") return <label className="toggle-field"><span>{label}</span><button type="button" role="switch" aria-checked={value} className={value?"on":""} onClick={()=>updateInput(nodeId,name,!value)}><i/></button></label>;
  const isPrompt = typeof value === "string" && (spec?.[1]?.multiline || name.toLowerCase().includes("text") || name.toLowerCase().includes("prompt") || value.length > 100);
  if (isPrompt) return <label className="prompt-field"><span>{label}</span><textarea rows={4} value={value} onInput={(e)=>updateInput(nodeId,name,e.target.value)} enterKeyHint="done"/><div className="prompt-tools"><small>{value.length} chars</small><button type="button" onClick={()=>updateInput(nodeId,name,"")}>Clear</button><button type="button" className="focus-button" onClick={()=>setFocusEditor({nodeId,key:name,label})}><Maximize2 size={13}/> Focus</button></div></label>;
  if (typeof value === "number") {
    const settings = spec?.[1] || {};
    const step = Number.isFinite(Number(settings.step)) && Number(settings.step) > 0 ? Number(settings.step) : Number.isInteger(value) ? 1 : .1;
    const min = Number.isFinite(Number(settings.min)) ? Number(settings.min) : -Infinity;
    const max = Number.isFinite(Number(settings.max)) ? Number(settings.max) : Infinity;
    const setNumber = (next) => updateInput(nodeId, name, Math.min(max, Math.max(min, next)));
    const seedControl = hasSeedControl(name, spec);
    const storedMode = node._meta?.controlAfterGenerate?.[name];
    const seedMode = SEED_CONTROL_MODES.some(([id]) => id === storedMode) ? storedMode : "randomize";
    return <label className={`number-field${seedControl ? " seed-field" : ""}`}><span>{label}</span><div className="stepper"><button type="button" aria-label={`Decrease ${label}`} disabled={value<=min} onClick={()=>setNumber(Number((value-step).toFixed(4)))}><Minus/></button><input inputMode={Number.isInteger(value)?"numeric":"decimal"} min={Number.isFinite(min)?min:undefined} max={Number.isFinite(max)?max:undefined} step={step} value={value} onInput={(e)=>setNumber(Number(e.target.value))}/><button type="button" aria-label={`Increase ${label}`} disabled={value>=max} onClick={()=>setNumber(Number((value+step).toFixed(4)))}><Plus/></button></div>{seedControl && <select className="seed-mode" aria-label={`${label} after generate`} value={seedMode} onChange={(e)=>updateMeta(nodeId,"controlAfterGenerate",{ ...node._meta?.controlAfterGenerate, [name]: e.target.value })}>{SEED_CONTROL_MODES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>}</label>;
  }
  if (options?.length) {
    const missing = !options.some((option) => Object.is(option, value));
    return <label className="text-field"><span>{label}</span><select value={value} onChange={(e)=>updateInput(nodeId,name,options.find((option)=>String(option)===e.target.value) ?? e.target.value)}>{missing&&<option value={value}>{String(value)} (unavailable)</option>}{options.map((option)=><option key={String(option)} value={option}>{option}</option>)}</select></label>;
  }
  return <label className="text-field"><span>{label}</span><input value={value} onInput={(e)=>updateInput(nodeId,name,e.target.value)}/></label>;
}

function LoraField({ nodeId, name, label, value, updateInput, removeLora }) {
  const update = (key, next) => updateInput(nodeId, name, { ...value, [key]: next });
  const strengthStep = (key, amount) => update(key, Number(((Number(value[key]) || 0) + amount).toFixed(4)));
  return <fieldset className={`lora-field ${value.on ? "enabled" : ""}`}><legend>{label}</legend><div className="lora-heading"><span>{value.on ? "Enabled" : "Disabled"}</span><div className="lora-heading-actions"><button type="button" role="switch" aria-label={`${label} enabled`} aria-checked={value.on} className={value.on ? "on" : ""} onClick={()=>update("on", !value.on)}><i/></button><button type="button" className="lora-remove" aria-label={`Remove ${label}`} onClick={()=>removeLora(nodeId,name)}><Trash2/></button></div></div><label className="text-field"><span>LoRA file</span><input value={value.lora} onInput={(e)=>update("lora", e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck="false"/></label><label className="number-field"><span>Model strength</span><div className="stepper"><button type="button" aria-label={`Decrease ${label} model strength`} onClick={()=>strengthStep("strength", -.1)}><Minus/></button><input inputMode="decimal" value={value.strength} onInput={(e)=>update("strength", Number(e.target.value))}/><button type="button" aria-label={`Increase ${label} model strength`} onClick={()=>strengthStep("strength", .1)}><Plus/></button></div></label>{value.strengthTwo !== null && value.strengthTwo !== undefined && <label className="number-field"><span>CLIP strength</span><div className="stepper"><button type="button" aria-label={`Decrease ${label} CLIP strength`} onClick={()=>strengthStep("strengthTwo", -.1)}><Minus/></button><input inputMode="decimal" value={value.strengthTwo} onInput={(e)=>update("strengthTwo", Number(e.target.value))}/><button type="button" aria-label={`Increase ${label} CLIP strength`} onClick={()=>strengthStep("strengthTwo", .1)}><Plus/></button></div></label>}</fieldset>;
}

function ImageField({ nodeId, value, uploadImage, base }) {
  const input = useRef(null);
  const [dimensions, setDimensions] = useState("");
  const parts = String(value).split("/");
  const filename = parts.pop();
  const subfolder = parts.join("/");
  const preview = httpUrl(base, `/view?${new URLSearchParams({ filename, subfolder, type: "input" })}`);
  useEffect(() => setDimensions(""), [preview]);
  return <div className="image-field"><span>INPUT IMAGE</span><div className="image-control"><img src={preview} alt="Current workflow input" onLoad={(e)=>{e.currentTarget.style.display="block";setDimensions(formatImageDimensions(e.currentTarget.naturalWidth,e.currentTarget.naturalHeight))}} onError={(e)=>{e.currentTarget.style.display="none";setDimensions("")}}/><div><strong>{filename || "No image selected"}</strong>{dimensions && <small className="image-dimensions">{dimensions}</small>}<small>Tap replace to upload from Photos or Files.</small><input ref={input} type="file" accept="image/*" hidden onChange={(e)=>uploadImage(nodeId,e.target.files?.[0])}/><button type="button" onClick={()=>input.current?.click()}><Upload size={14}/> Replace image</button></div></div></div>;
}

function WorkflowLibrary({ items, search, setSearch, openWorkflow, close, importFile, connected }) {
  const filtered = items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  return <div className="modal-backdrop library-backdrop" onClick={close}><section className="workflow-library" role="dialog" aria-modal="true" aria-labelledby="workflow-library-title" onClick={(e)=>e.stopPropagation()}><header><div><span className="overline">COMFYUI LIBRARY</span><h2 id="workflow-library-title">Choose a workflow</h2></div><button aria-label="Close workflow library" onClick={close}><X/></button></header><label className="library-search"><Search/><input aria-label="Search workflows" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search MiniMax, Qwen, upscale…" autoCapitalize="none" autoCorrect="off"/><kbd aria-hidden="true">{filtered.length}</kbd></label><div className="workflow-list">{filtered.map((item)=><button key={item.path} onClick={()=>openWorkflow(item)}><span className="workflow-file-icon"><FileJson/></span><span><strong>{item.name.replace(/\.json$/i, "")}</strong><small>{item.path.includes("/") ? item.path.slice(0,item.path.lastIndexOf("/")) : "workflows"}</small></span><ChevronDown className="row-arrow"/></button>)}{!filtered.length&&<div className="library-empty"><FolderOpen/><strong>{connected?"No matching workflows":"Connect to ComfyUI to load your workflows"}</strong></div>}</div><footer><button onClick={importFile}><Upload/> Import JSON from this device</button></footer></section></div>;
}

function FocusEditor({ editor, value, onChange, close }) {
  useEffect(()=>{ document.body.classList.add("editor-open"); return ()=>document.body.classList.remove("editor-open"); },[]);
  return <section className="focus-editor"><header><button onClick={close}><X/> Close</button><div><span className="overline">PROMPT EDITOR</span><strong>{editor.label}</strong></div><button className="done" onClick={close}><Check/> Done</button></header><textarea autoFocus value={value} onInput={(e)=>onChange(e.target.value)} placeholder="Describe what you want to create…"/><footer><span>{value.length} characters</span><button onClick={()=>onChange("")}>Clear prompt</button></footer></section>;
}

async function localAiRequest(path, body) {
  const response = await fetch(`/local-ai/${path}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorText(result, `Local AI controller returned ${response.status}.`));
  return result;
}

function modelSize(bytes) { return bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "Size unknown"; }

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "Unavailable";
  return `${(value / 1024 ** 3).toFixed(value >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
}

function ComfyOverview({ connected, request, workflowCount, onOpenCreate, onOpenQueue, onOpenConnection, onClosed }) {
  const [snapshot, setSnapshot] = useState({ stats: null, running: 0, pending: 0 });
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("Refreshes only when this page opens or when you ask, preserving resources for generation.");

  async function refresh() {
    setWorking("refresh");
    try {
      const [stats, queue] = await Promise.all([request("/system_stats"), request("/queue")]);
      const [running = [], pending = []] = Array.isArray(queue) ? queue : [queue?.queue_running || [], queue?.queue_pending || []];
      setSnapshot({ stats, running: running.length, pending: pending.length });
      setMessage("Runtime snapshot updated.");
    } catch (error) { setMessage(error.message); }
    finally { setWorking(""); }
  }

  useEffect(() => { if (connected) refresh(); }, [connected]);

  async function runtimeAction(name, path) {
    if (name === "close" && !globalThis.confirm("Close the verified local ComfyUI process? Active or queued work will be refused.")) return;
    setWorking(name);
    try {
      await localAiRequest(path, {});
      if (name === "close") { onClosed(); setSnapshot({ stats: null, running: 0, pending: 0 }); setMessage("ComfyUI was closed. The dashboard is still running."); }
      else { setMessage("ComfyUI models and cached memory were released. ComfyUI remains open."); await refresh(); }
    } catch (error) { setMessage(error.message); }
    finally { setWorking(""); }
  }

  const system = snapshot.stats?.system || {};
  const device = snapshot.stats?.devices?.[0] || {};
  const ramUsed = Number(system.ram_total) - Number(system.ram_free);
  const vramUsed = Number(device.vram_total) - Number(device.vram_free);
  return <section className="panel-page comfy-overview">
    <div className="panel-kicker"><Sparkles/><span>INDEPENDENT COMFYUI</span></div>
    <div className="page-title-row"><div><h1>ComfyUI control room</h1><p>Run workflows, watch the queue, inspect local resources, and manage ComfyUI without starting LM Studio.</p></div><button className="icon-action" aria-label="Refresh ComfyUI overview" disabled={!!working || !connected} onClick={refresh}>{working === "refresh" ? <LoaderCircle className="spin"/> : <RefreshCw/>}</button></div>
    <div className={`runtime-banner ${connected ? "active" : "warning"}`}><span className="runtime-icon">{connected ? <Wifi/> : <WifiOff/>}</span><div><span className="overline">COMFYUI RUNTIME</span><strong>{connected ? "Connected and ready" : "ComfyUI is offline"}</strong><small>{message}</small></div></div>
    <div className="metric-grid">
      <article><span><Cpu/> DEVICE</span><strong>{device.name || "No device reported"}</strong><small>{device.type || "Start ComfyUI to inspect hardware"}</small></article>
      <article><span><MemoryStick/> VRAM</span><strong>{device.vram_total ? `${formatBytes(vramUsed)} used` : "Unavailable"}</strong><small>{device.vram_total ? `${formatBytes(device.vram_free)} free of ${formatBytes(device.vram_total)}` : "No live snapshot"}</small></article>
      <article><span><HardDriveDownload/> SYSTEM RAM</span><strong>{system.ram_total ? `${formatBytes(ramUsed)} used` : "Unavailable"}</strong><small>{system.ram_total ? `${formatBytes(system.ram_free)} free of ${formatBytes(system.ram_total)}` : "No live snapshot"}</small></article>
      <article><span><Activity/> QUEUE</span><strong>{snapshot.running} running · {snapshot.pending} pending</strong><small>{workflowCount} saved workflow{workflowCount === 1 ? "" : "s"} available</small></article>
    </div>
    <div className="control-grid">
      <article className="control-card"><span className="control-icon"><FolderOpen/></span><div><span className="overline">WORKFLOWS</span><h2>Create and generate</h2><p>Open saved API workflows, edit promoted controls, upload inputs, and queue runs.</p></div><button onClick={onOpenCreate}>Open Create</button></article>
      <article className="control-card"><span className="control-icon"><Activity/></span><div><span className="overline">OPERATIONS</span><h2>Queue and preview</h2><p>Inspect running and pending jobs, move work forward, interrupt, and watch live previews.</p></div><button onClick={onOpenQueue}>Open Queue</button></article>
    </div>
    <div className="prompt-card runtime-console"><div className="prompt-card-head"><div><span className="overline">COMFYUI-ONLY CONTROLS</span><h2>Runtime and memory</h2></div><Cpu/></div><p>These controls affect ComfyUI only. They do not start, stop, or load an LM Studio model.</p><div className="model-actions"><button disabled={!!working || !connected} onClick={()=>runtimeAction("free", "free-comfy")}>{working === "free" ? <LoaderCircle className="spin"/> : <HardDriveDownload/>}Unload models</button><button className="danger-text" disabled={!!working || !connected} onClick={()=>runtimeAction("close", "close-comfy")}>{working === "close" ? <LoaderCircle className="spin"/> : <CircleStop/>}Close ComfyUI</button></div>{!connected&&<button className="secondary-action" onClick={onOpenConnection}>Check connection settings</button>}</div>
  </section>;
}

function PromptStudio({ hidden, status, setStatus, promptTargets, imageTargets, readWorkflowImage, applyTransfer }) {
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("Prompt Studio is local and only runs when you start it.");
  const [modelKey, setModelKey] = useState("");
  const [presetId, setPresetId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [output, setOutput] = useState("");
  const [targetId, setTargetId] = useState("");
  const [imageTargetId, setImageTargetId] = useState("");
  const imageInput = useRef(null);

  useEffect(() => {
    localAiRequest("status").then((next) => {
      setStatus(next);
      const visionModel = next.models?.find((model) => model.vision);
      if (visionModel) setModelKey((value) => value || visionModel.modelKey);
      if (next.selectedPresetId) setPresetId(next.selectedPresetId);
    }).catch((error) => {
      setStatus({ mode: "comfy", loaded: [], models: [], presets: [], controllerAvailable: false });
      setMessage(`Prompt Studio unavailable: ${error.message}`);
    });
  }, [setStatus]);
  useEffect(() => { if (!promptTargets.some((target) => target.id === targetId)) setTargetId(promptTargets[0]?.id || ""); }, [targetId, promptTargets]);
  useEffect(() => { if (!imageTargets.some((target) => target.id === imageTargetId)) setImageTargetId(imageTargets[0]?.id || ""); }, [imageTargetId, imageTargets]);

  async function runAction(name, action) {
    setWorking(name);
    try { return await action(); }
    catch (error) { setMessage(error.message); return null; }
    finally { setWorking(""); }
  }

  async function start() {
    const next = await runAction("start", () => localAiRequest("start", {}));
    if (!next) return;
    setStatus(next);
    setModelKey((value) => value || next.models?.find((model) => model.vision)?.modelKey || "");
    setPresetId((value) => value || next.presets?.[0]?.id || "");
    setMessage("ComfyUI models are unloaded. Choose a vision model to load.");
  }

  async function load() {
    const next = await runAction("load", () => localAiRequest("load", { modelKey, presetId }));
    if (!next) return;
    setStatus((current) => ({ ...current, ...next }));
    setMessage("Vision model loaded. The selected preset will be applied when you generate.");
  }

  async function chooseImage(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setMessage("Choose a JPEG, PNG, or WebP image."); return; }
    if (file.size > 12 * 1024 * 1024) { setMessage("Choose an image smaller than 12 MB."); return; }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setImageDataUrl(dataUrl);
    setImageName(file.name);
    setMessage(`${file.name} is ready for local analysis.`);
  }

  async function generate() {
    const result = await runAction("generate", () => localAiRequest("generate", { instructions, imageDataUrl, presetId }));
    if (!result) return;
    setOutput(result.prompt);
    setMessage("Prompt generated locally. Copy it or send it to the current workflow.");
  }

  async function stop() {
    const next = await runAction("stop", () => localAiRequest("stop", {}));
    if (!next) return false;
    setStatus(next);
    setImageDataUrl("");
    setImageName("");
    setMessage("LM Studio is unloaded and stopped. ComfyUI can safely load models again.");
    return true;
  }

  async function copyPrompt() {
    if (!output) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(output);
      else {
        const area = document.createElement("textarea");
        area.value = output; area.style.position = "fixed"; area.style.opacity = "0";
        document.body.append(area); area.select(); document.execCommand("copy"); area.remove();
      }
      setMessage("Prompt copied to this device's clipboard.");
    } catch { setMessage("Clipboard access was blocked. Press and hold the prompt text to copy it."); }
  }

  async function useWorkflowInputs() {
    const promptTarget = promptTargets.find((target) => target.id === targetId);
    const imageTarget = imageTargets.find((target) => target.id === imageTargetId);
    if (!promptTarget && !imageTarget) { setMessage("The current workflow has no transferable prompt or image inputs."); return; }
    if (promptTarget) setOutput(promptTarget.value);
    const image = imageTarget ? await runAction("workflow", () => readWorkflowImage(imageTarget.id)) : null;
    if (imageTarget && !image) return;
    if (image) { setImageDataUrl(image.dataUrl); setImageName(image.name); }
    setMessage(`${[promptTarget && "prompt", image && "image"].filter(Boolean).join(" and ")} transferred from the workflow.`);
  }

  async function useInWorkflow() {
    if (!output && !imageDataUrl) return;
    const transfer = { promptTargetId: targetId, prompt: output, imageTargetId, imageDataUrl, imageName };
    if (promptMode && !(await stop())) return;
    await runAction("transfer", () => applyTransfer(transfer));
  }

  const loadedModel = status.loaded?.[0];
  const loadedModelInfo = status.models?.find((model) => model.modelKey === loadedModel?.modelKey);
  const loaded = status.loaded?.length > 0 && loadedModelInfo?.vision !== false;
  const desktop = status.mode === "desktop";
  const promptMode = status.mode === "prompt";
  const checking = status.mode === "unknown";
  return <section className="panel-page prompt-studio" hidden={hidden}>
    <div className="panel-kicker"><Bot/><span>LOCAL PROMPT STUDIO</span></div>
    <h1>Turn a reference image into a prompt</h1>
    <p>ComfyUI and LM Studio take turns using memory. Images, instructions, and generated prompts stay on this PC.</p>
    <div className={`runtime-banner ${desktop ? "warning" : promptMode ? "active" : ""}`}><span className="runtime-icon"><Cpu/></span><div><span className="overline">RUNTIME HANDOFF</span><strong>{desktop ? "Desktop LM Studio detected" : promptMode ? "Prompt Studio owns model memory" : "ComfyUI mode"}</strong><small>{message}</small></div></div>

    <div className="prompt-card transfer-card"><div className="prompt-card-head"><div><span className="overline">TWO-WAY TRANSFER</span><h2>Workflow inputs</h2></div><RefreshCw/></div><p>Bring the selected workflow prompt and reference image into Prompt Studio. Linked node connections stay untouched.</p>{promptTargets.length > 0 && <label className="studio-field"><span>Prompt field</span><select value={targetId} onChange={(e)=>setTargetId(e.target.value)}>{promptTargets.map((target)=><option value={target.id} key={target.id}>{target.label}</option>)}</select></label>}{imageTargets.length > 0 && <label className="studio-field"><span>Image field</span><select value={imageTargetId} onChange={(e)=>setImageTargetId(e.target.value)}>{imageTargets.map((target)=><option value={target.id} key={target.id}>{target.label}</option>)}</select></label>}<button className="secondary-action" disabled={!!working || (!promptTargets.length && !imageTargets.length)} onClick={useWorkflowInputs}>{working === "workflow" ? <LoaderCircle className="spin"/> : <HardDriveDownload/>}{working === "workflow" ? "Reading workflow…" : "Transfer workflow to Prompt Studio"}</button></div>

    {!promptMode && <div className="prompt-card start-card"><h2>{desktop ? "Quit LM Studio desktop first" : "Start a clean prompt session"}</h2><p>{desktop ? "Right-click LM Studio in the Windows tray and quit it completely. This one-time change lets Comfy Deck use the lighter headless runtime." : "This checks the ComfyUI queue, unloads its models, frees cached memory, and starts LM Studio headlessly on loopback only."}</p><button className="primary-action" disabled={!!working || desktop || checking} onClick={start}>{working === "start" || checking ? <LoaderCircle className="spin"/> : <Play/>}{working === "start" ? "Switching runtimes…" : checking ? "Checking runtimes…" : "Free ComfyUI & start"}</button></div>}

    {promptMode && <>
      <div className="prompt-card"><div className="prompt-card-head"><div><span className="overline">VISION MODEL</span><h2>{loaded ? "Model ready" : "Choose a model"}</h2></div>{loaded && <span className="ready-chip"><Check/> Loaded</span>}</div>{loaded && <div className="loaded-model"><strong>{loadedModel?.displayName || status.models?.find((model)=>model.modelKey===modelKey)?.displayName || modelKey}</strong><small>Vision model remains visible while Prompt Studio is active.</small></div>}<label className="studio-field"><span>Installed vision model</span><select value={modelKey} disabled={loaded || !!working} onChange={(e)=>setModelKey(e.target.value)}>{status.models?.filter((model)=>model.vision).map((model)=><option key={model.modelKey} value={model.modelKey}>{model.displayName} · {modelSize(model.sizeBytes)}</option>)}</select></label><label className="studio-field"><span>LM Studio preset</span><select value={presetId} disabled={!!working} onChange={(e)=>setPresetId(e.target.value)}><option value="">Built-in Prompt Studio defaults</option>{status.presets?.map((preset)=><option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><small className="field-help">System prompt and supported inference values are read locally from this preset. You can switch presets without reloading the model.</small></label>{!loaded && <button className="primary-action" disabled={!modelKey || !!working} onClick={load}>{working === "load" ? <LoaderCircle className="spin"/> : <Cpu/>}{working === "load" ? "Loading model…" : "Load selected model"}</button>}</div>

      <div className="prompt-card reference-card"><span className="overline">REFERENCE</span><h2>Image and direction</h2><input ref={imageInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e)=>chooseImage(e.target.files?.[0])}/><button className="image-drop" onClick={()=>imageInput.current?.click()}>{imageDataUrl?<img src={imageDataUrl} alt="Prompt reference"/>:<ImageIcon/>}<span><strong>{imageName || "Choose an image"}</strong><small>JPEG, PNG, or WebP · up to 12 MB</small></span><Upload/></button><label className="studio-field"><span>What should the final prompt accomplish?</span><textarea rows={5} value={instructions} onInput={(e)=>setInstructions(e.target.value)} placeholder="Example: Describe the composition, lighting, camera movement, and atmosphere for a cinematic image-to-video prompt."/></label><button className="primary-action" disabled={!loaded || !imageDataUrl || !instructions.trim() || !!working} onClick={generate}>{working === "generate" ? <LoaderCircle className="spin"/> : <Sparkles/>}{working === "generate" ? "Generating locally…" : "Generate prompt"}</button></div>

      <button className="shutdown-action" disabled={!!working} onClick={stop}><CircleStop/> Finish and free LM memory</button>
    </>}
    {(output || imageDataUrl) && <div className="prompt-card output-card"><div className="prompt-card-head"><div><span className="overline">WORKFLOW TRANSFER</span><h2>Ready to use</h2></div>{output && <button className="copy-button" onClick={copyPrompt}><Clipboard/> Copy</button>}</div>{imageDataUrl && <div className="transfer-image-preview"><img src={imageDataUrl} alt="Image ready to transfer"/><span><strong>{imageName || "Reference image"}</strong><small>Ready for the selected workflow image field.</small></span></div>}{output && <textarea aria-label="Prompt Studio transfer prompt" value={output} onInput={(e)=>setOutput(e.target.value)} rows={9}/>}<p>Transfers the current prompt and reference image back to their selected workflow fields.</p>{promptTargets.length > 0 && <label className="studio-field"><span>ComfyUI prompt field</span><select value={targetId} onChange={(e)=>setTargetId(e.target.value)}>{promptTargets.map((target)=><option value={target.id} key={target.id}>{target.label}</option>)}</select></label>}{imageTargets.length > 0 && <label className="studio-field"><span>ComfyUI image field</span><select value={imageTargetId} onChange={(e)=>setImageTargetId(e.target.value)}>{imageTargets.map((target)=><option value={target.id} key={target.id}>{target.label}</option>)}</select></label>}<button className="primary-action" disabled={!!working || (!targetId && !imageTargetId)} onClick={useInWorkflow}>{working === "stop" || working === "transfer" ? <LoaderCircle className="spin"/> : <Check/>}{working === "stop" ? "Freeing LM Studio…" : working === "transfer" ? "Transferring…" : promptMode ? "Unload LM & transfer to workflow" : "Transfer to workflow"}</button></div>}
  </section>;
}

function QueuePanel({ busy, queueRemaining, progressPercent, activeNode, livePreview, interrupt, jobs, refresh, removeQueued, clearQueue, moveToFront }) {
  const previewStatus = livePreview && livePreview.step !== null && livePreview.total !== null ? `Step ${livePreview.step} of ${livePreview.total}` : "Updates during sampling";
  return <section className="panel-page"><div className="panel-kicker"><Activity/><span>LIVE ACTIVITY</span></div><h1>{busy?"Your workflow is running":jobs.length?"Your queue is ready":"The queue is clear"}</h1><p>{busy?`ComfyUI is processing node ${activeNode || "…"}. You can leave this tab—the dock keeps the current status visible.`:"Queue jobs only refresh when you open this tab or tap refresh, keeping background activity near zero."}</p>{busy&&livePreview&&<figure className="live-preview">{livePreview.kind==="video"?<video src={livePreview.url} autoPlay loop muted playsInline aria-label="Current ComfyUI animated generation preview"/>:<img src={livePreview.url} alt="Current ComfyUI generation preview"/>}<figcaption><span><i/>LIVE PREVIEW</span><small>{livePreview.nodeId?`Node ${livePreview.nodeId} · `:""}{previewStatus}</small></figcaption></figure>}<div className="queue-card"><div className="queue-ring" style={{"--progress":`${progressPercent || 0}%`}}><strong>{progressPercent ?? (busy?"…":0)}{progressPercent!==null?"%":""}</strong></div><div><span className="overline">CURRENT RUN</span><h2>{busy?"Generating output":"Waiting for a prompt"}</h2><small>{queueRemaining} pending item{queueRemaining===1?"":"s"}</small></div>{busy&&<button onClick={interrupt}><CircleStop/> Stop</button>}</div><div className="queue-toolbar"><button onClick={()=>refresh()}><RefreshCw/> Refresh</button>{jobs.some((job)=>!job.running)&&<button onClick={clearQueue}><Trash2/> Clear pending</button>}</div><div className="job-list">{jobs.map((job)=><article className="job-row" key={job.promptId}><div><span className="overline">{job.running?"RUNNING":"QUEUED"} · #{String(job.promptId).slice(0,8)}</span><strong>{job.running?"Generating now":"Awaiting its turn"}</strong></div>{job.running?<button onClick={interrupt}>Stop</button>:<div className="job-actions"><button onClick={()=>moveToFront(job)}>Run first</button><button aria-label="Remove queued job" onClick={()=>removeQueued(job.promptId)}><Trash2/></button></div>}</article>)}{!jobs.length&&<div className="queue-empty">No active or pending jobs.</div>}</div></section>;
}

function Gallery({ runs, base, rerun, clearHistory }) {
  const generations = galleryGenerations(runs, base, LIGHTWEIGHT.maxGalleryGenerations);
  return <section className="panel-page"><div className="panel-kicker"><ImageIcon/><span>RECENT OUTPUTS</span></div><h1>{generations.length ? (generations.length === 1 ? "Latest generation" : `Last ${generations.length} generations`) : "Nothing here yet"}</h1><p>{generations.length ? "Tap an image or video to open it. Past runs store settings and output references only—never image or video files." : "Completed dashboard runs will appear here."}</p>{generations.length ? generations.map((generation) => <div className="gallery-generation" key={generation.promptId}><div className="gallery-generation-head"><strong>{generation.workflowName}</strong><small>{new Date(generation.timestamp).toLocaleString()}</small></div><div className="gallery-grid">{generation.media.map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" key={`${generation.promptId}-${item.filename}-${index}`}>{item.kind === "video" ? <video controls playsInline preload="metadata" src={item.url} onClick={(event) => event.preventDefault()}/> : <img loading="lazy" decoding="async" src={item.url} alt={`ComfyUI output ${index + 1}`}/>}<span>{item.filename}</span></a>)}</div></div>) : <div className="gallery-empty"><ImageIcon/><span>Queue your first workflow</span></div>}<div className="run-history"><div className="history-heading"><div><span className="overline">LOCAL RUN HISTORY</span><h2>Reuse a previous run</h2></div>{runs.length>0&&<button onClick={clearHistory}>Clear history</button>}</div>{runs.map((run)=><article className="run-row" key={run.promptId}><div><strong>{run.workflowName}</strong><small>{new Date(run.completedAt || run.stoppedAt || run.queuedAt).toLocaleString()} · {String(run.promptId).slice(0,8)}</small></div><button onClick={()=>rerun(run)} disabled={!run.workflow}>Queue first</button></article>)}{!runs.length&&<div className="queue-empty">Settings from future dashboard runs will be saved on this device.</div>}</div></section>;
}
