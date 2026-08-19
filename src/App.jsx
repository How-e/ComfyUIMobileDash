import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Activity, Bot, Check, ChevronDown, CircleStop, Clipboard, Cpu, FileJson, FolderOpen, GalleryHorizontalEnd, Image as ImageIcon,
  HardDriveDownload, ListFilter, LoaderCircle, Maximize2, MemoryStick, Minus, Play, Plus, Power, RefreshCw, Search,
  SlidersHorizontal, Sparkles, Trash2, Upload, Wifi, WifiOff, X,
} from "lucide-preact";
import { sampleWorkflow } from "./sampleWorkflow";
import { normalizeWorkflow, priorityForNode, workflowClassTypes } from "./workflowAdapter";

const makeClientId = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
const clone = (value) => JSON.parse(JSON.stringify(value));
const editable = (value) => ["string", "number", "boolean"].includes(typeof value);
const STORAGE = { activePrompt: "comfydeck.activePrompt", runs: "comfydeck.recentRuns" };
const LIGHTWEIGHT = {
  maxSavedRuns: 16,
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

function nodeTone(node) {
  const text = `${node.class_type} ${nodeTitle(node)}`.toLowerCase();
  if (text.includes("text") || text.includes("prompt") || text.includes("clip")) return "coral";
  if (text.includes("sampler") || text.includes("scheduler")) return "blue";
  if (text.includes("load") || text.includes("model") || text.includes("lora")) return "green";
  if (text.includes("latent") || text.includes("image")) return "violet";
  return "slate";
}

function collectImages(history, base) {
  const item = Object.values(history || {})[0];
  return Object.values(item?.outputs || {}).flatMap((output) => (output.images || []).map((image) => {
    const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" });
    return { ...image, url: httpUrl(base, `/view?${params}`) };
  }));
}

export default function App() {
  const [base, setBase] = useState(() => localStorage.getItem("comfydeck.base") || "/comfy");
  const [draftBase, setDraftBase] = useState(base);
  const [workflow, setWorkflow] = useState(() => clone(sampleWorkflow));
  const [workflowName, setWorkflowName] = useState("Portrait Lab");
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
  const [activeNode, setActiveNode] = useState(null);
  const [activePromptId, setActivePromptId] = useState(() => localStorage.getItem(STORAGE.activePrompt) || "");
  const [images, setImages] = useState([]);
  const [recentRuns, setRecentRuns] = useState(() => readLocal(STORAGE.runs, []));
  const [activeTab, setActiveTab] = useState("create");
  const [search, setSearch] = useState("");
  const [essentialsOnly, setEssentialsOnly] = useState(true);
  const [notice, setNotice] = useState("Demo workflow loaded — open your API JSON when ready.");
  const [focusEditor, setFocusEditor] = useState(null);
  const [aiStatus, setAiStatus] = useState({ mode: "unknown", loaded: [], models: [] });
  const fileRef = useRef(null);
  const clientId = useRef(makeClientId());
  const activePromptRef = useRef(activePromptId);
  const finishPromptRef = useRef(null);
  const objectInfoRef = useRef({});
  const objectInfoRequests = useRef(new Map());
  const objectInfoBaseRef = useRef(base);

  useEffect(() => {
    activePromptRef.current = activePromptId;
    if (activePromptId) localStorage.setItem(STORAGE.activePrompt, activePromptId);
    else localStorage.removeItem(STORAGE.activePrompt);
  }, [activePromptId]);
  useEffect(() => { localStorage.setItem(STORAGE.runs, JSON.stringify(recentRuns.slice(0, LIGHTWEIGHT.maxSavedRuns))); }, [recentRuns]);

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
    if (!promptId) return;
    try {
      const history = await request(`/history/${promptId}`);
      if (!history?.[promptId]) return;
      const historyItem = history[promptId];
      const messages = historyItem.status?.messages || [];
      const interrupted = messages.some((message) => message?.[0] === "execution_interrupted");
      const failed = historyItem.status?.status_str === "error";
      const nextImages = collectImages(history, base);
      setImages(nextImages);
      setBusy(false); setProgress(null); setActivePromptId("");
      rememberRun({ promptId, workflowName, workflow: clone(workflow), ...(failed ? { stoppedAt: Date.now() } : { completedAt: Date.now() }), images: nextImages.map(({ url, ...image }) => image) });
      setNotice(interrupted ? "Generation interrupted." : failed ? "Workflow stopped with an execution error." : nextImages.length ? `${nextImages.length} output${nextImages.length === 1 ? "" : "s"} ready.` : "Workflow finished.");
      refreshQueue(true);
    } catch { /* Completion can be recovered next time the dashboard opens. */ }
  }, [base, rememberRun, refreshQueue, request, workflow, workflowName]);
  useEffect(() => { finishPromptRef.current = finishPrompt; }, [finishPrompt]);

  useEffect(() => {
    if (!activePromptId) return;
    finishPromptRef.current?.(activePromptId);
  }, [activePromptId]);

  useEffect(() => { if (activeTab === "queue") refreshQueue(true); }, [activeTab, refreshQueue]);

  useEffect(() => {
    let socket;
    let retry;
    let disposed = false;
    const connect = () => {
      socket = new WebSocket(wsUrl(base, clientId.current));
      socket.onopen = () => setConnected(true);
      socket.onclose = () => { setConnected(false); if (!disposed) retry = setTimeout(connect, 3500); };
      socket.onerror = () => socket.close();
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        const message = JSON.parse(event.data);
        const data = message.data || {};
        if (message.type === "status") setQueueRemaining(data.status?.exec_info?.queue_remaining || 0);
        if (message.type === "execution_start") { setBusy(true); setProgress(null); }
        if (message.type === "executing") { setActiveNode(data.node); if (data.node === null && data.prompt_id === activePromptRef.current) finishPromptRef.current?.(activePromptRef.current); }
        if (message.type === "progress") setProgress({ value: data.value || 0, max: data.max || 1 });
        if (message.type === "execution_error") { setBusy(false); setNotice(`Execution stopped at node ${data.node_id || "unknown"}.`); }
      };
    };
    connect();
    return () => { disposed = true; clearTimeout(retry); socket?.close(); };
  }, [base]);

  const nodes = useMemo(() => Object.entries(workflow).map(([id, node]) => ({ id, ...node })).sort((a, b) => priorityForNode(a) - priorityForNode(b)), [workflow]);
  const visibleNodes = useMemo(() => nodes.filter((node) => {
    const haystack = `${nodeTitle(node)} ${node.class_type} ${Object.keys(node.inputs).join(" ")} ${Object.values(node._meta?.inputLabels || {}).join(" ")}`.toLowerCase();
    return haystack.includes(search.toLowerCase()) && Object.values(node.inputs).some(editable) && (!essentialsOnly || priorityForNode(node) <= 4);
  }), [nodes, search, essentialsOnly]);

  function updateInput(nodeId, key, value) {
    setWorkflow((current) => ({ ...current, [nodeId]: { ...current[nodeId], inputs: { ...current[nodeId].inputs, [key]: value } } }));
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
      const json = await request(`/userdata/${encodeURIComponent(item.path)}`);
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

  async function uploadImage(nodeId, file) {
    if (!file) return;
    const form = new FormData();
    form.append("image", file);
    form.append("type", "input");
    form.append("overwrite", "true");
    try {
      setNotice(`Uploading ${file.name}…`);
      const result = await request("/upload/image", { method: "POST", body: form });
      const value = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
      updateInput(nodeId, "image", value);
      setNotice(`${result.name} is ready as the workflow input.`);
    } catch (error) { setNotice(`Image upload failed: ${error.message}`); }
  }

  async function queuePrompt(promptToQueue = workflow, name = workflowName, front = false) {
    if (aiStatus.mode !== "comfy") {
      setActiveTab("prompt");
      setNotice("Finish Prompt Studio and release its model before queueing ComfyUI.");
      return null;
    }
    setBusy(true); setProgress(null); setNotice("Sending workflow to ComfyUI…");
    try {
      const result = await request("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: promptToQueue, client_id: clientId.current, ...(front ? { front: true } : {}) }) });
      setActivePromptId(result.prompt_id);
      rememberRun({ promptId: result.prompt_id, workflowName: name, workflow: clone(promptToQueue), queuedAt: Date.now(), images: [] });
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
  const promptTargets = nodes.flatMap((node) => Object.entries(node.inputs).filter(([key,value]) => typeof value === "string" && (key.toLowerCase().includes("prompt") || key.toLowerCase().includes("text"))).map(([key]) => ({ id: `${node.id}:${key}`, nodeId: node.id, key, label: `${nodeTitle(node)} · ${key.replaceAll("_", " ")}` })));
  const promptRuntimeActive = aiStatus.mode === "prompt" || aiStatus.mode === "desktop";
  const runtimeChecking = aiStatus.mode === "unknown";

  function applyGeneratedPrompt(targetId, value) {
    const target = promptTargets.find((item) => item.id === targetId) || promptTargets[0];
    if (!target) { setNotice("No editable prompt field exists in the current workflow."); return; }
    updateInput(target.nodeId, target.key, value);
    setActiveTab("create");
    setNotice(`Generated prompt added to ${target.label}.`);
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

      <nav className="tabbar" aria-label="Primary navigation">
        {[{id:"create",label:"Create",icon:Sparkles},{id:"prompt",label:"Prompt",icon:Bot},{id:"queue",label:"Queue",icon:Activity},{id:"gallery",label:"Gallery",icon:GalleryHorizontalEnd}].map(({id,label,icon:Icon}) => <button key={id} aria-current={activeTab===id?"page":undefined} className={activeTab===id?"active":""} onClick={()=>setActiveTab(id)}><Icon size={19}/><span>{label}</span>{id==="queue"&&queueRemaining>0?<b aria-label={`${queueRemaining} queued`}>{queueRemaining}</b>:null}</button>)}
      </nav>

      {activeTab === "create" && <section className="workspace-head">
        <div className="workflow-heading"><div className="workflow-icon">WF</div><div><span className="overline">ACTIVE WORKFLOW</span><h1>{workflowName}</h1></div></div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e)=>openFile(e.target.files?.[0])}/>
        <button className="file-button" onClick={()=>setLibraryOpen(true)}><FolderOpen size={15}/> Workflows <span>{savedWorkflows.length}</span></button>
      </section>}

      {activeTab === "create" && <>
        <section className="notice" role="status" aria-live="polite"><Check size={15}/><span>{notice}</span></section>
        <section className="search-row"><label className="search-box"><span className="sr-only">Find a node or setting</span><Search size={19}/><input aria-label="Find a node or setting" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Find a control" autoCapitalize="none" autoCorrect="off"/><kbd aria-hidden="true">{visibleNodes.length}</kbd></label><button className={`filter-button ${essentialsOnly?"active":""}`} aria-pressed={essentialsOnly} aria-label={essentialsOnly?"Show all editable nodes":"Show essential nodes only"} onClick={()=>setEssentialsOnly((value)=>!value)}><ListFilter size={19}/><span className="filter-label">{essentialsOnly?"Essential":"All"}</span></button></section>
        <section className="content-area"><div className="section-title"><span>{essentialsOnly?"ESSENTIAL CONTROLS":"ALL EDITABLE CONTROLS"}</span><small>{visibleNodes.length} OF {nodes.length} NODES</small></div><div className="card-stack">
          {visibleNodes.map((node) => <NodeCard key={node.id} node={node} active={String(activeNode)===String(node.id)} updateInput={updateInput} setFocusEditor={setFocusEditor} info={objectInfo[node.class_type]} uploadImage={uploadImage} base={base}/>) }
          {!visibleNodes.length && <div className="empty-state"><SlidersHorizontal/><h2>No editable nodes found</h2><p>Try a different search or open an API-format workflow JSON.</p></div>}
        </div></section>
      </>}

      {activeTab === "queue" && <QueuePanel busy={busy} queueRemaining={queueRemaining} progressPercent={progressPercent} activeNode={activeNode} interrupt={interrupt} jobs={queueJobs} refresh={refreshQueue} removeQueued={removeQueued} clearQueue={clearQueue} moveToFront={moveToFront}/>} 
      {activeTab === "gallery" && <Gallery images={images} runs={recentRuns} base={base} rerun={(run)=>queuePrompt(run.workflow, run.workflowName, true)} clearHistory={()=>setRecentRuns([])}/>} 
      <PromptStudio hidden={activeTab !== "prompt"} status={aiStatus} setStatus={setAiStatus} targets={promptTargets} applyPrompt={applyGeneratedPrompt}/>

      {activeTab === "create" && <footer className="action-dock"><div className="dock-status">{busy||runtimeChecking?<LoaderCircle className="spin"/>:<span className={`ready-orb ${connected?"":"offline"}`}>{connected?<Check size={16}/>:<WifiOff size={15}/>}</span>}<span><small>{runtimeChecking?"CHECKING":promptRuntimeActive?"PROMPT MODE":busy?"GENERATING":connected?"READY":"OFFLINE"}</small><strong>{runtimeChecking?"Runtime safety":promptRuntimeActive?"ComfyUI locked":progressPercent!==null?`${progressPercent}% complete`:`${editableCount} editable values`}</strong></span></div><button className={busy?"queue-button stop":"queue-button"} onClick={promptRuntimeActive?()=>setActiveTab("prompt"):busy?interrupt:()=>queuePrompt()} disabled={runtimeChecking||(!promptRuntimeActive&&!connected)}>{busy?<CircleStop/>:promptRuntimeActive?<Bot/>:<Play fill="currentColor"/>}<span><strong>{busy?"Stop":promptRuntimeActive?"Prompt Studio":"Queue workflow"}</strong><small>{busy?(activeNode?`NODE #${activeNode}`:"RUNNING"):promptRuntimeActive?"LM ACTIVE":"START RUN"}</small></span></button></footer>}

      {connectionOpen && <div className="modal-backdrop" onClick={()=>setConnectionOpen(false)}><section className="connection-sheet" role="dialog" aria-modal="true" aria-labelledby="connection-title" onClick={(e)=>e.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><div><span className="overline">CONNECTION</span><h2 id="connection-title">ComfyUI address</h2></div><button aria-label="Close connection settings" onClick={()=>setConnectionOpen(false)}><X/></button></div><p>Keep <b>/comfy</b> when this dashboard runs on the same PC as ComfyUI. The local proxy avoids browser cross-origin issues.</p><label><span>Server URL</span><input value={draftBase} onChange={(e)=>setDraftBase(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck="false" placeholder="/comfy or http://192.168.1.42:8188"/></label><div className="sheet-actions"><button onClick={()=>testConnection()}>Test current</button><button className="primary" onClick={saveConnection}>Save address</button></div></section></div>}
      {memoryOpen && <div className="modal-backdrop" onClick={()=>!memoryWorking&&setMemoryOpen(false)}><section className="connection-sheet memory-sheet" role="dialog" aria-modal="true" aria-labelledby="memory-title" onClick={(e)=>e.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><div><span className="overline">LOCAL RUNTIMES</span><h2 id="memory-title">Memory & shutdown</h2></div><button aria-label="Close memory controls" disabled={!!memoryWorking} onClick={()=>setMemoryOpen(false)}><X/></button></div><p className="memory-message">{memoryMessage}</p><div className="runtime-actions"><button disabled={!!memoryWorking} onClick={()=>runMemoryAction("free", "free-memory")}><span className="runtime-action-icon"><HardDriveDownload/></span><span><strong>Free RAM / VRAM</strong><small>Unload models from ComfyUI and LM Studio without loading another model.</small></span>{memoryWorking==="free"&&<LoaderCircle className="spin"/>}</button><button disabled={!!memoryWorking} onClick={()=>runMemoryAction("close-lm", "stop")}><span className="runtime-action-icon"><Power/></span><span><strong>Close LM runtime</strong><small>Unload LM models, stop its local server, and close the headless daemon.</small></span>{memoryWorking==="close-lm"&&<LoaderCircle className="spin"/>}</button><button className="danger" disabled={!!memoryWorking || !connected} onClick={()=>runMemoryAction("close-comfy", "close-comfy")}><span className="runtime-action-icon"><CircleStop/></span><span><strong>Close ComfyUI</strong><small>Free its models, then close the verified local ComfyUI process.</small></span>{memoryWorking==="close-comfy"&&<LoaderCircle className="spin"/>}</button></div></section></div>}
      {libraryOpen && <WorkflowLibrary items={savedWorkflows} search={librarySearch} setSearch={setLibrarySearch} openWorkflow={openSavedWorkflow} close={()=>setLibraryOpen(false)} importFile={()=>fileRef.current?.click()} connected={connected}/>} 
      {focusEditor && <FocusEditor editor={focusEditor} value={workflow[focusEditor.nodeId].inputs[focusEditor.key]} onChange={(value)=>updateInput(focusEditor.nodeId,focusEditor.key,value)} close={()=>setFocusEditor(null)}/>} 
    </main>
  );
}

function NodeCard({ node, active, updateInput, setFocusEditor, info, uploadImage, base }) {
  const fields = Object.entries(node.inputs).filter(([,value])=>editable(value));
  return <article className={`node-card ${nodeTone(node)} ${active?"executing":""}`}><div className="node-head"><div><span className="node-dot"/><span className="overline">{node.class_type}</span><h2>{nodeTitle(node)}</h2></div><span className="node-id">#{node.id}</span></div><div className="fields-grid">{fields.map(([key,value]) => <Field key={key} node={node} nodeId={node.id} name={key} label={node._meta?.inputLabels?.[key]} value={value} updateInput={updateInput} setFocusEditor={setFocusEditor} info={info} uploadImage={uploadImage} base={base}/>)}</div></article>;
}

function Field({ node, nodeId, name, label: promotedLabel, value, updateInput, setFocusEditor, info, uploadImage, base }) {
  const label = (promotedLabel || name).replaceAll("_", " ");
  const spec = info?.input?.required?.[name] || info?.input?.optional?.[name];
  const options = Array.isArray(spec?.[0]) ? spec[0] : spec?.[0] === "COMBO" ? spec?.[1]?.options : null;
  if (node.class_type === "LoadImage" && name === "image") return <ImageField nodeId={nodeId} value={value} uploadImage={uploadImage} base={base}/>;
  if (typeof value === "boolean") return <label className="toggle-field"><span>{label}</span><button type="button" role="switch" aria-checked={value} className={value?"on":""} onClick={()=>updateInput(nodeId,name,!value)}><i/></button></label>;
  const isPrompt = typeof value === "string" && (name.toLowerCase().includes("text") || name.toLowerCase().includes("prompt") || value.length > 100);
  if (isPrompt) return <label className="prompt-field"><span>{label}</span><textarea rows={4} value={value} onChange={(e)=>updateInput(nodeId,name,e.target.value)} enterKeyHint="done"/><div className="prompt-tools"><small>{value.length} chars</small><button type="button" onClick={()=>updateInput(nodeId,name,"")}>Clear</button><button type="button" className="focus-button" onClick={()=>setFocusEditor({nodeId,key:name,label})}><Maximize2 size={13}/> Focus</button></div></label>;
  if (typeof value === "number") {
    const step = Number.isInteger(value) ? 1 : .1;
    return <label className="number-field"><span>{label}</span><div className="stepper"><button type="button" aria-label={`Decrease ${label}`} onClick={()=>updateInput(nodeId,name,Number((value-step).toFixed(4)))}><Minus/></button><input inputMode={Number.isInteger(value)?"numeric":"decimal"} value={value} onChange={(e)=>updateInput(nodeId,name,Number(e.target.value))}/><button type="button" aria-label={`Increase ${label}`} onClick={()=>updateInput(nodeId,name,Number((value+step).toFixed(4)))}><Plus/></button></div></label>;
  }
  if (options?.length) return <label className="text-field"><span>{label}</span><select value={value} onChange={(e)=>updateInput(nodeId,name,e.target.value)}>{options.map((option)=><option key={String(option)} value={option}>{option}</option>)}</select></label>;
  return <label className="text-field"><span>{label}</span><input value={value} onChange={(e)=>updateInput(nodeId,name,e.target.value)}/></label>;
}

function ImageField({ nodeId, value, uploadImage, base }) {
  const input = useRef(null);
  const parts = String(value).split("/");
  const filename = parts.pop();
  const subfolder = parts.join("/");
  const preview = httpUrl(base, `/view?${new URLSearchParams({ filename, subfolder, type: "input" })}`);
  return <div className="image-field"><span>INPUT IMAGE</span><div className="image-control"><img src={preview} alt="Current workflow input" onError={(e)=>{e.currentTarget.style.display="none"}}/><div><strong>{filename || "No image selected"}</strong><small>Tap replace to upload from Photos or Files.</small><input ref={input} type="file" accept="image/*" hidden onChange={(e)=>uploadImage(nodeId,e.target.files?.[0])}/><button type="button" onClick={()=>input.current?.click()}><Upload size={14}/> Replace image</button></div></div></div>;
}

function WorkflowLibrary({ items, search, setSearch, openWorkflow, close, importFile, connected }) {
  const filtered = items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  return <div className="modal-backdrop library-backdrop" onClick={close}><section className="workflow-library" role="dialog" aria-modal="true" aria-labelledby="workflow-library-title" onClick={(e)=>e.stopPropagation()}><header><div><span className="overline">COMFYUI LIBRARY</span><h2 id="workflow-library-title">Choose a workflow</h2></div><button aria-label="Close workflow library" onClick={close}><X/></button></header><label className="library-search"><Search/><input aria-label="Search workflows" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search MiniMax, Qwen, upscale…" autoCapitalize="none" autoCorrect="off"/><kbd aria-hidden="true">{filtered.length}</kbd></label><div className="workflow-list">{filtered.map((item)=><button key={item.path} onClick={()=>openWorkflow(item)}><span className="workflow-file-icon"><FileJson/></span><span><strong>{item.name.replace(/\.json$/i, "")}</strong><small>{item.path.includes("/") ? item.path.slice(0,item.path.lastIndexOf("/")) : "workflows"}</small></span><ChevronDown className="row-arrow"/></button>)}{!filtered.length&&<div className="library-empty"><FolderOpen/><strong>{connected?"No matching workflows":"Connect to ComfyUI to load your workflows"}</strong></div>}</div><footer><button onClick={importFile}><Upload/> Import JSON from this device</button></footer></section></div>;
}

function FocusEditor({ editor, value, onChange, close }) {
  useEffect(()=>{ document.body.classList.add("editor-open"); return ()=>document.body.classList.remove("editor-open"); },[]);
  return <section className="focus-editor"><header><button onClick={close}><X/> Close</button><div><span className="overline">PROMPT EDITOR</span><strong>{editor.label}</strong></div><button className="done" onClick={close}><Check/> Done</button></header><textarea autoFocus value={value} onChange={(e)=>onChange(e.target.value)} placeholder="Describe what you want to create…"/><footer><span>{value.length} characters</span><button onClick={()=>onChange("")}>Clear prompt</button></footer></section>;
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

function PromptStudio({ hidden, status, setStatus, targets, applyPrompt }) {
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("Prompt Studio is local and only runs when you start it.");
  const [modelKey, setModelKey] = useState("");
  const [presetId, setPresetId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [output, setOutput] = useState("");
  const [targetId, setTargetId] = useState("");
  const imageInput = useRef(null);

  useEffect(() => {
    localAiRequest("status").then((next) => {
      setStatus(next);
      if (next.models?.length) setModelKey((value) => value || next.models[0].modelKey);
      if (next.selectedPresetId) setPresetId(next.selectedPresetId);
    }).catch((error) => {
      setStatus({ mode: "comfy", loaded: [], models: [], presets: [], controllerAvailable: false });
      setMessage(`Prompt Studio unavailable: ${error.message}`);
    });
  }, [setStatus]);
  useEffect(() => { if (!targets.some((target) => target.id === targetId)) setTargetId(targets[0]?.id || ""); }, [targetId, targets]);

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
    setModelKey((value) => value || next.models?.[0]?.modelKey || "");
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

  async function useInWorkflow() {
    if (!output || !targetId) return;
    if (await stop()) applyPrompt(targetId, output);
  }

  const loaded = status.loaded?.length > 0;
  const loadedModel = status.loaded?.[0];
  const desktop = status.mode === "desktop";
  const promptMode = status.mode === "prompt";
  const checking = status.mode === "unknown";
  return <section className="panel-page prompt-studio" hidden={hidden}>
    <div className="panel-kicker"><Bot/><span>LOCAL PROMPT STUDIO</span></div>
    <h1>Turn a reference image into a prompt</h1>
    <p>ComfyUI and LM Studio take turns using memory. Images, instructions, and generated prompts stay on this PC.</p>
    <div className={`runtime-banner ${desktop ? "warning" : promptMode ? "active" : ""}`}><span className="runtime-icon"><Cpu/></span><div><span className="overline">RUNTIME HANDOFF</span><strong>{desktop ? "Desktop LM Studio detected" : promptMode ? "Prompt Studio owns model memory" : "ComfyUI mode"}</strong><small>{message}</small></div></div>

    {!promptMode && <div className="prompt-card start-card"><h2>{desktop ? "Quit LM Studio desktop first" : "Start a clean prompt session"}</h2><p>{desktop ? "Right-click LM Studio in the Windows tray and quit it completely. This one-time change lets Comfy Deck use the lighter headless runtime." : "This checks the ComfyUI queue, unloads its models, frees cached memory, and starts LM Studio headlessly on loopback only."}</p><button className="primary-action" disabled={!!working || desktop || checking} onClick={start}>{working === "start" || checking ? <LoaderCircle className="spin"/> : <Play/>}{working === "start" ? "Switching runtimes…" : checking ? "Checking runtimes…" : "Free ComfyUI & start"}</button></div>}

    {promptMode && <>
      <div className="prompt-card"><div className="prompt-card-head"><div><span className="overline">VISION MODEL</span><h2>{loaded ? "Model ready" : "Choose a model"}</h2></div>{loaded && <span className="ready-chip"><Check/> Loaded</span>}</div>{loaded && <div className="loaded-model"><strong>{loadedModel?.displayName || status.models?.find((model)=>model.modelKey===modelKey)?.displayName || modelKey}</strong><small>Vision model remains visible while Prompt Studio is active.</small></div>}<label className="studio-field"><span>Installed vision model</span><select value={modelKey} disabled={loaded || !!working} onChange={(e)=>setModelKey(e.target.value)}>{status.models?.map((model)=><option key={model.modelKey} value={model.modelKey}>{model.displayName} · {modelSize(model.sizeBytes)}</option>)}</select></label><label className="studio-field"><span>LM Studio preset</span><select value={presetId} disabled={!!working} onChange={(e)=>setPresetId(e.target.value)}><option value="">Built-in Prompt Studio defaults</option>{status.presets?.map((preset)=><option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><small className="field-help">System prompt and supported inference values are read locally from this preset. You can switch presets without reloading the model.</small></label>{!loaded && <button className="primary-action" disabled={!modelKey || !!working} onClick={load}>{working === "load" ? <LoaderCircle className="spin"/> : <Cpu/>}{working === "load" ? "Loading model…" : "Load selected model"}</button>}</div>

      <div className="prompt-card reference-card"><span className="overline">REFERENCE</span><h2>Image and direction</h2><input ref={imageInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e)=>chooseImage(e.target.files?.[0])}/><button className="image-drop" onClick={()=>imageInput.current?.click()}>{imageDataUrl?<img src={imageDataUrl} alt="Prompt reference"/>:<ImageIcon/>}<span><strong>{imageName || "Choose an image"}</strong><small>JPEG, PNG, or WebP · up to 12 MB</small></span><Upload/></button><label className="studio-field"><span>What should the final prompt accomplish?</span><textarea rows={5} value={instructions} onChange={(e)=>setInstructions(e.target.value)} placeholder="Example: Describe the composition, lighting, camera movement, and atmosphere for a cinematic image-to-video prompt."/></label><button className="primary-action" disabled={!loaded || !imageDataUrl || !instructions.trim() || !!working} onClick={generate}>{working === "generate" ? <LoaderCircle className="spin"/> : <Sparkles/>}{working === "generate" ? "Generating locally…" : "Generate prompt"}</button></div>

      {output && <div className="prompt-card output-card"><div className="prompt-card-head"><div><span className="overline">GENERATED PROMPT</span><h2>Ready to use</h2></div><button className="copy-button" onClick={copyPrompt}><Clipboard/> Copy</button></div><textarea value={output} onChange={(e)=>setOutput(e.target.value)} rows={9}/><label className="studio-field"><span>ComfyUI prompt field</span><select value={targetId} onChange={(e)=>setTargetId(e.target.value)}>{targets.map((target)=><option value={target.id} key={target.id}>{target.label}</option>)}</select></label><button className="primary-action" disabled={!targetId || !!working} onClick={useInWorkflow}>{working === "stop" ? <LoaderCircle className="spin"/> : <Check/>}{working === "stop" ? "Freeing LM Studio…" : "Unload LM & use in workflow"}</button></div>}

      <button className="shutdown-action" disabled={!!working} onClick={stop}><CircleStop/> Finish and free LM memory</button>
    </>}
  </section>;
}

function QueuePanel({ busy, queueRemaining, progressPercent, activeNode, interrupt, jobs, refresh, removeQueued, clearQueue, moveToFront }) {
  return <section className="panel-page"><div className="panel-kicker"><Activity/><span>LIVE ACTIVITY</span></div><h1>{busy?"Your workflow is running":jobs.length?"Your queue is ready":"The queue is clear"}</h1><p>{busy?`ComfyUI is processing node ${activeNode || "…"}. You can leave this tab—the dock keeps the current status visible.`:"Queue jobs only refresh when you open this tab or tap refresh, keeping background activity near zero."}</p><div className="queue-card"><div className="queue-ring" style={{"--progress":`${progressPercent || 0}%`}}><strong>{progressPercent ?? (busy?"…":0)}{progressPercent!==null?"%":""}</strong></div><div><span className="overline">CURRENT RUN</span><h2>{busy?"Generating output":"Waiting for a prompt"}</h2><small>{queueRemaining} pending item{queueRemaining===1?"":"s"}</small></div>{busy&&<button onClick={interrupt}><CircleStop/> Stop</button>}</div><div className="queue-toolbar"><button onClick={()=>refresh()}><RefreshCw/> Refresh</button>{jobs.some((job)=>!job.running)&&<button onClick={clearQueue}><Trash2/> Clear pending</button>}</div><div className="job-list">{jobs.map((job)=><article className="job-row" key={job.promptId}><div><span className="overline">{job.running?"RUNNING":"QUEUED"} · #{String(job.promptId).slice(0,8)}</span><strong>{job.running?"Generating now":"Awaiting its turn"}</strong></div>{job.running?<button onClick={interrupt}>Stop</button>:<div className="job-actions"><button onClick={()=>moveToFront(job)}>Run first</button><button aria-label="Remove queued job" onClick={()=>removeQueued(job.promptId)}><Trash2/></button></div>}</article>)}{!jobs.length&&<div className="queue-empty">No active or pending jobs.</div>}</div></section>;
}

function Gallery({ images, runs, base, rerun, clearHistory }) {
  const latest = images.length ? images : (runs.find((run)=>run.images?.length)?.images || []).map((image) => ({ ...image, url: httpUrl(base, `/view?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" })}`) }));
  return <section className="panel-page"><div className="panel-kicker"><ImageIcon/><span>RECENT OUTPUTS</span></div><h1>{latest.length?"Latest generation":"Nothing here yet"}</h1><p>{latest.length?"Tap an image to view it at full size. Past runs store settings and image references only—never output files.":"Completed dashboard runs will appear here."}</p>{latest.length?<div className="gallery-grid">{latest.map((image,index)=><a href={image.url} target="_blank" rel="noreferrer" key={`${image.filename}-${index}`}><img loading="lazy" decoding="async" src={image.url} alt={`ComfyUI output ${index+1}`}/><span>{image.filename}</span></a>)}</div>:<div className="gallery-empty"><ImageIcon/><span>Queue your first workflow</span></div>}<div className="run-history"><div className="history-heading"><div><span className="overline">LOCAL RUN HISTORY</span><h2>Reuse a previous run</h2></div>{runs.length>0&&<button onClick={clearHistory}>Clear history</button>}</div>{runs.map((run)=><article className="run-row" key={run.promptId}><div><strong>{run.workflowName}</strong><small>{new Date(run.completedAt || run.stoppedAt || run.queuedAt).toLocaleString()} · {String(run.promptId).slice(0,8)}</small></div><button onClick={()=>rerun(run)} disabled={!run.workflow}>Queue first</button></article>)}{!runs.length&&<div className="queue-empty">Settings from future dashboard runs will be saved on this device.</div>}</div></section>;
}
