import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Activity, Check, ChevronDown, CircleStop, FileJson, FolderOpen, GalleryHorizontalEnd, Image as ImageIcon,
  ListFilter, LoaderCircle, Maximize2, Minus, Play, Plus, RefreshCw, Search,
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
    if (!response.ok) throw new Error((await response.text()) || `ComfyUI returned ${response.status}`);
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
      setSavedWorkflows((files || []).filter((item) => item.type === "file" && item.name.toLowerCase().endsWith(".json")));
      setConnected(true);
      if (!quiet) setNotice(`Connected — ${files?.filter((item) => item.type === "file" && item.name.toLowerCase().endsWith(".json")).length || 0} saved workflows found.`);
      return true;
    } catch {
      setConnected(false);
      if (!quiet) setNotice("Could not reach ComfyUI. Start it, then check the address.");
      return false;
    }
  }, [request]);

  useEffect(() => { testConnection(true); }, [testConnection]);

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
      const nextImages = collectImages(history, base);
      setImages(nextImages);
      setBusy(false); setProgress(null); setActivePromptId("");
      rememberRun({ promptId, workflowName, workflow: clone(workflow), completedAt: Date.now(), images: nextImages.map(({ url, ...image }) => image) });
      setNotice(nextImages.length ? `${nextImages.length} output${nextImages.length === 1 ? "" : "s"} ready.` : "Workflow finished.");
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

  return (
    <main className="app-shell" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); openFile(e.dataTransfer.files[0]); }}>
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><i/><i/><i/></div><div><span className="brand-name">COMFY</span><span className="brand-product">DECK</span></div></div>
        <button className={`connection-pill ${connected ? "online" : ""}`} onClick={() => setConnectionOpen(true)}>
          {connected ? <Wifi size={15}/> : <WifiOff size={15}/>}<span><strong>{connected ? "CONNECTED" : "OFFLINE"}</strong><small>{base === "/comfy" ? "LOCAL PROXY · 8188" : base.replace(/^https?:\/\//, "")}</small></span><ChevronDown size={15}/>
        </button>
      </header>

      <nav className="tabbar" aria-label="Primary navigation">
        {[{id:"create",label:"Create",icon:Sparkles},{id:"queue",label:"Queue",icon:Activity},{id:"gallery",label:"Gallery",icon:GalleryHorizontalEnd}].map(({id,label,icon:Icon}) => <button key={id} className={activeTab===id?"active":""} onClick={()=>setActiveTab(id)}><Icon size={18}/>{label}{id==="queue"&&queueRemaining>0?<b>{queueRemaining}</b>:null}</button>)}
      </nav>

      <section className="workspace-head">
        <div className="workflow-heading"><div className="workflow-icon">WF</div><div><span className="overline">ACTIVE WORKFLOW</span><h1>{workflowName}</h1></div></div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e)=>openFile(e.target.files?.[0])}/>
        <button className="file-button" onClick={()=>setLibraryOpen(true)}><FolderOpen size={15}/> Workflows <span>{savedWorkflows.length}</span></button>
      </section>

      {activeTab === "create" && <>
        <section className="notice"><Check size={14}/><span>{notice}</span></section>
        <section className="search-row"><label className="search-box"><Search size={19}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Find a node or setting"/><kbd>{visibleNodes.length}</kbd></label><button className={`filter-button ${essentialsOnly?"active":""}`} aria-label={essentialsOnly?"Show all editable nodes":"Show essential nodes only"} onClick={()=>setEssentialsOnly((value)=>!value)}><ListFilter size={19}/></button></section>
        <section className="content-area"><div className="section-title"><span>{essentialsOnly?"ESSENTIAL CONTROLS":"ALL EDITABLE CONTROLS"}</span><small>{visibleNodes.length} OF {nodes.length} NODES</small></div><div className="card-stack">
          {visibleNodes.map((node) => <NodeCard key={node.id} node={node} active={String(activeNode)===String(node.id)} updateInput={updateInput} setFocusEditor={setFocusEditor} info={objectInfo[node.class_type]} uploadImage={uploadImage} base={base}/>) }
          {!visibleNodes.length && <div className="empty-state"><SlidersHorizontal/><h2>No editable nodes found</h2><p>Try a different search or open an API-format workflow JSON.</p></div>}
        </div></section>
      </>}

      {activeTab === "queue" && <QueuePanel busy={busy} queueRemaining={queueRemaining} progressPercent={progressPercent} activeNode={activeNode} interrupt={interrupt} jobs={queueJobs} refresh={refreshQueue} removeQueued={removeQueued} clearQueue={clearQueue} moveToFront={moveToFront}/>} 
      {activeTab === "gallery" && <Gallery images={images} runs={recentRuns} base={base} rerun={(run)=>queuePrompt(run.workflow, run.workflowName, true)} clearHistory={()=>setRecentRuns([])}/>} 

      <footer className="action-dock"><div className="dock-status">{busy?<LoaderCircle className="spin"/>:<span className={`ready-orb ${connected?"":"offline"}`}>{connected?<Check size={16}/>:<WifiOff size={15}/>}</span>}<span><small>{busy?"GENERATING":connected?"READY TO CREATE":"COMFYUI OFFLINE"}</small><strong>{progressPercent!==null?`${progressPercent}% complete`:`${editableCount} editable values`}</strong></span></div><button className={busy?"queue-button stop":"queue-button"} onClick={busy?interrupt:queuePrompt} disabled={!connected}>{busy?<CircleStop/>:<Play fill="currentColor"/>}<span><strong>{busy?"Stop generation":"Queue prompt"}</strong><small>{busy?(activeNode?`NODE #${activeNode}`:"RUNNING"):"1 RUN"}</small></span></button></footer>

      {connectionOpen && <div className="modal-backdrop" onClick={()=>setConnectionOpen(false)}><section className="connection-sheet" onClick={(e)=>e.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><div><span className="overline">CONNECTION</span><h2>ComfyUI address</h2></div><button onClick={()=>setConnectionOpen(false)}><X/></button></div><p>Keep <b>/comfy</b> when this dashboard runs on the same PC as ComfyUI. The local proxy avoids browser cross-origin issues.</p><label><span>Server URL</span><input value={draftBase} onChange={(e)=>setDraftBase(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck="false" placeholder="/comfy or http://192.168.1.42:8188"/></label><div className="sheet-actions"><button onClick={()=>testConnection()}>Test current</button><button className="primary" onClick={saveConnection}>Save address</button></div></section></div>}
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
  return <div className="modal-backdrop library-backdrop" onClick={close}><section className="workflow-library" onClick={(e)=>e.stopPropagation()}><header><div><span className="overline">COMFYUI LIBRARY</span><h2>Choose a workflow</h2></div><button onClick={close}><X/></button></header><label className="library-search"><Search/><input autoFocus value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search MiniMax, Qwen, upscale…"/><kbd>{filtered.length}</kbd></label><div className="workflow-list">{filtered.map((item)=><button key={item.path} onClick={()=>openWorkflow(item)}><span className="workflow-file-icon"><FileJson/></span><span><strong>{item.name.replace(/\.json$/i, "")}</strong><small>{item.path.includes("/") ? item.path.slice(0,item.path.lastIndexOf("/")) : "workflows"}</small></span><ChevronDown className="row-arrow"/></button>)}{!filtered.length&&<div className="library-empty"><FolderOpen/><strong>{connected?"No matching workflows":"Connect to ComfyUI to load your workflows"}</strong></div>}</div><footer><button onClick={importFile}><Upload/> Import JSON from this device</button></footer></section></div>;
}

function FocusEditor({ editor, value, onChange, close }) {
  useEffect(()=>{ document.body.classList.add("editor-open"); return ()=>document.body.classList.remove("editor-open"); },[]);
  return <section className="focus-editor"><header><button onClick={close}><X/> Close</button><div><span className="overline">PROMPT EDITOR</span><strong>{editor.label}</strong></div><button className="done" onClick={close}><Check/> Done</button></header><textarea autoFocus value={value} onChange={(e)=>onChange(e.target.value)} placeholder="Describe what you want to create…"/><footer><span>{value.length} characters</span><button onClick={()=>onChange("")}>Clear prompt</button></footer></section>;
}

function QueuePanel({ busy, queueRemaining, progressPercent, activeNode, interrupt, jobs, refresh, removeQueued, clearQueue, moveToFront }) {
  return <section className="panel-page"><div className="panel-kicker"><Activity/><span>LIVE ACTIVITY</span></div><h1>{busy?"Your workflow is running":jobs.length?"Your queue is ready":"The queue is clear"}</h1><p>{busy?`ComfyUI is processing node ${activeNode || "…"}. You can leave this tab—the dock keeps the current status visible.`:"Queue jobs only refresh when you open this tab or tap refresh, keeping background activity near zero."}</p><div className="queue-card"><div className="queue-ring" style={{"--progress":`${progressPercent || 0}%`}}><strong>{progressPercent ?? (busy?"…":0)}{progressPercent!==null?"%":""}</strong></div><div><span className="overline">CURRENT RUN</span><h2>{busy?"Generating output":"Waiting for a prompt"}</h2><small>{queueRemaining} pending item{queueRemaining===1?"":"s"}</small></div>{busy&&<button onClick={interrupt}><CircleStop/> Stop</button>}</div><div className="queue-toolbar"><button onClick={()=>refresh()}><RefreshCw/> Refresh</button>{jobs.some((job)=>!job.running)&&<button onClick={clearQueue}><Trash2/> Clear pending</button>}</div><div className="job-list">{jobs.map((job)=><article className="job-row" key={job.promptId}><div><span className="overline">{job.running?"RUNNING":"QUEUED"} · #{String(job.promptId).slice(0,8)}</span><strong>{job.running?"Generating now":"Awaiting its turn"}</strong></div>{job.running?<button onClick={interrupt}>Stop</button>:<div className="job-actions"><button onClick={()=>moveToFront(job)}>Run first</button><button aria-label="Remove queued job" onClick={()=>removeQueued(job.promptId)}><Trash2/></button></div>}</article>)}{!jobs.length&&<div className="queue-empty">No active or pending jobs.</div>}</div></section>;
}

function Gallery({ images, runs, base, rerun, clearHistory }) {
  const latest = images.length ? images : (runs.find((run)=>run.images?.length)?.images || []).map((image) => ({ ...image, url: httpUrl(base, `/view?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" })}`) }));
  return <section className="panel-page"><div className="panel-kicker"><ImageIcon/><span>RECENT OUTPUTS</span></div><h1>{latest.length?"Latest generation":"Nothing here yet"}</h1><p>{latest.length?"Tap an image to view it at full size. Past runs store settings and image references only—never output files.":"Completed dashboard runs will appear here."}</p>{latest.length?<div className="gallery-grid">{latest.map((image,index)=><a href={image.url} target="_blank" rel="noreferrer" key={`${image.filename}-${index}`}><img loading="lazy" decoding="async" src={image.url} alt={`ComfyUI output ${index+1}`}/><span>{image.filename}</span></a>)}</div>:<div className="gallery-empty"><ImageIcon/><span>Queue your first workflow</span></div>}<div className="run-history"><div className="history-heading"><div><span className="overline">LOCAL RUN HISTORY</span><h2>Reuse a previous run</h2></div>{runs.length>0&&<button onClick={clearHistory}>Clear history</button>}</div>{runs.map((run)=><article className="run-row" key={run.promptId}><div><strong>{run.workflowName}</strong><small>{new Date(run.completedAt || run.queuedAt).toLocaleString()} · {String(run.promptId).slice(0,8)}</small></div><button onClick={()=>rerun(run)} disabled={!run.workflow}>Queue first</button></article>)}{!runs.length&&<div className="queue-empty">Settings from future dashboard runs will be saved on this device.</div>}</div></section>;
}
