import { useEffect, useRef, useState } from "preact/hooks";
import { Bot, Check, CircleStop, Cpu, Image as ImageIcon, LoaderCircle, Play, RefreshCw, Send, Trash2, Upload, X } from "lucide-preact";

function errorText(value, fallback) {
  return (typeof value?.error === "string" ? value.error : value?.message) || fallback;
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

function modelSize(bytes) {
  return bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "Size unknown";
}

async function imageData(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file?.type || "")) throw new Error("Choose a JPEG, PNG, or WebP image.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose an image smaller than 12 MB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function LMStudioPanel({ hidden, status, setStatus }) {
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("Start the local runtime when you want to work only with LM Studio.");
  const [modelKey, setModelKey] = useState("");
  const [presetId, setPresetId] = useState("");
  const [contextLength, setContextLength] = useState("8192");
  const [ttl, setTtl] = useState("900");
  const [temperature, setTemperature] = useState("0.4");
  const [maxTokens, setMaxTokens] = useState("2048");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [image, setImage] = useState(null);
  const imageInput = useRef(null);

  async function run(name, action) {
    setWorking(name);
    try { return await action(); }
    catch (error) { setMessage(error.message); return null; }
    finally { setWorking(""); }
  }

  async function refresh() {
    const next = await run("refresh", () => localAiRequest("status"));
    if (!next) return;
    setStatus(next);
    setModelKey((value) => value || next.models?.[0]?.modelKey || "");
    setPresetId(next.selectedPresetId || "");
    if (next.loadSettings) {
      setContextLength(String(next.loadSettings.contextLength || 8192));
      setTtl(String(next.loadSettings.ttl || 900));
    }
    setMessage(next.mode === "prompt" ? "Headless LM Studio is ready on this PC." : "LM Studio is stopped. ComfyUI may use model memory.");
  }

  useEffect(() => {
    setModelKey((value) => value || status.loaded?.[0]?.modelKey || status.models?.[0]?.modelKey || "");
    if (status.selectedPresetId) setPresetId(status.selectedPresetId);
    if (status.loadSettings) {
      setContextLength(String(status.loadSettings.contextLength || 8192));
      setTtl(String(status.loadSettings.ttl || 900));
    }
  }, [status]);

  async function start() {
    const next = await run("start", () => localAiRequest("start-independent", {}));
    if (!next) return;
    setStatus(next);
    setModelKey((value) => value || next.models?.[0]?.modelKey || "");
    setMessage("LM Studio is running headlessly. If ComfyUI was available, its idle model memory was released first.");
  }

  async function load() {
    const next = await run("load", () => localAiRequest("load", { modelKey, presetId, contextLength: Number(contextLength), ttl: Number(ttl) }));
    if (!next) return;
    setStatus(next);
    setMessage("Model loaded. Chat history stays only in this browser tab.");
  }

  async function unload() {
    const next = await run("unload", () => localAiRequest("unload", {}));
    if (!next) return;
    setStatus(next);
    setMessage("Model unloaded. The lightweight local server remains ready for another model.");
  }

  async function stop() {
    const next = await run("stop", () => localAiRequest("stop", {}));
    if (!next) return;
    setStatus(next);
    setImage(null);
    setMessage("LM Studio models, server, and headless runtime are stopped.");
  }

  async function chooseImage(file) {
    try { setImage({ name: file.name, dataUrl: await imageData(file) }); setMessage(`${file.name} will be sent with the next message only.`); }
    catch (error) { setMessage(error.message); }
  }

  async function send() {
    const prompt = draft.trim();
    if (!prompt) return;
    const prior = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: prompt, imageName: image?.name }]);
    setDraft("");
    const result = await run("chat", () => localAiRequest("chat", {
      messages: prior,
      prompt,
      systemPrompt,
      imageDataUrl: image?.dataUrl || "",
      presetId,
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
    }));
    if (!result) return;
    setMessages((current) => [...current, { role: "assistant", content: result.content }]);
    setImage(null);
    setMessage("Response completed locally.");
  }

  const promptMode = status.mode === "prompt";
  const desktop = status.mode === "desktop";
  const loaded = status.loaded?.length > 0;
  const loadedModel = status.loaded?.[0];
  const selectedCatalog = status.models?.find((model) => model.modelKey === (loadedModel?.modelKey || modelKey));

  return <section className="panel-page lm-studio" hidden={hidden}>
    <div className="panel-kicker"><Bot/><span>INDEPENDENT LM STUDIO</span></div>
    <div className="page-title-row"><div><h1>Local model workspace</h1><p>Load, configure, and chat with local models without opening or editing a ComfyUI workflow.</p></div><button className="icon-action" aria-label="Refresh LM Studio status" disabled={!!working} onClick={refresh}>{working === "refresh" ? <LoaderCircle className="spin"/> : <RefreshCw/>}</button></div>

    <div className={`runtime-banner ${desktop ? "warning" : promptMode ? "active" : ""}`}><span className="runtime-icon"><Cpu/></span><div><span className="overline">LM RUNTIME</span><strong>{desktop ? "Desktop LM Studio detected" : promptMode ? loaded ? "Model loaded" : "Runtime ready" : "Runtime stopped"}</strong><small>{message}</small></div></div>

    {!promptMode && <div className="prompt-card start-card"><h2>{desktop ? "Quit the desktop app first" : "Start LM Studio only"}</h2><p>{desktop ? "Quit LM Studio completely from the Windows tray so the dashboard can use the lightweight headless runtime." : "If ComfyUI is running, it must be idle and releases its models first. If ComfyUI is intentionally closed, LM Studio can start independently."}</p><button className="primary-action" disabled={!!working || desktop} onClick={start}>{working === "start" ? <LoaderCircle className="spin"/> : <Play/>}{working === "start" ? "Starting locally…" : "Start LM workspace"}</button></div>}

    {promptMode && <>
      <div className="prompt-card model-console"><div className="prompt-card-head"><div><span className="overline">MODEL CONTROL</span><h2>{loaded ? "Active model" : "Load a model"}</h2></div>{loaded && <span className="ready-chip"><Check/> Loaded</span>}</div>
        {loaded && <div className="loaded-model"><strong>{loadedModel?.displayName || selectedCatalog?.displayName || loadedModel?.modelKey}</strong><small>{selectedCatalog?.vision ? "Text + image input" : "Text input"} · {Number(status.loadSettings?.contextLength || contextLength).toLocaleString()} context · {Math.round(Number(status.loadSettings?.ttl || ttl) / 60)} min idle unload</small></div>}
        <label className="studio-field"><span>Installed model</span><select value={modelKey} disabled={loaded || !!working} onChange={(e)=>setModelKey(e.target.value)}>{status.models?.map((model)=><option key={model.modelKey} value={model.modelKey}>{model.displayName} · {model.vision ? "Vision" : "Text"} · {modelSize(model.sizeBytes)}</option>)}</select></label>
        <label className="studio-field"><span>LM Studio preset</span><select value={presetId} disabled={!!working} onChange={(e)=>setPresetId(e.target.value)}><option value="">No preset</option>{status.presets?.map((preset)=><option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><small className="field-help">Preset system and sampling values remain local. The controls below override temperature and max output for this workspace.</small></label>
        {!loaded && <div className="compact-grid"><label className="studio-field"><span>Context</span><select value={contextLength} onChange={(e)=>setContextLength(e.target.value)}><option value="4096">4K tokens</option><option value="8192">8K tokens</option><option value="16384">16K tokens</option><option value="32768">32K tokens</option></select></label><label className="studio-field"><span>Idle unload</span><select value={ttl} onChange={(e)=>setTtl(e.target.value)}><option value="300">5 minutes</option><option value="900">15 minutes</option><option value="1800">30 minutes</option><option value="3600">60 minutes</option></select></label></div>}
        {!loaded ? <button className="primary-action" disabled={!modelKey || !!working} onClick={load}>{working === "load" ? <LoaderCircle className="spin"/> : <Cpu/>}{working === "load" ? "Loading model…" : "Load selected model"}</button> : <div className="model-actions"><button disabled={!!working} onClick={unload}>{working === "unload" ? <LoaderCircle className="spin"/> : <X/>}Unload model</button><button className="danger-text" disabled={!!working} onClick={stop}>{working === "stop" ? <LoaderCircle className="spin"/> : <CircleStop/>}Stop runtime</button></div>}
      </div>

      <div className="prompt-card chat-console"><div className="prompt-card-head"><div><span className="overline">LOCAL CHAT</span><h2>Session</h2></div><button className="copy-button" disabled={!messages.length || !!working} onClick={()=>setMessages([])}><Trash2/> Clear</button></div>
        <details className="advanced-settings"><summary>Generation settings</summary><label className="studio-field"><span>System prompt</span><textarea rows={3} value={systemPrompt} onInput={(e)=>setSystemPrompt(e.target.value)} placeholder="Optional instructions for this chat session"/></label><div className="compact-grid"><label className="studio-field"><span>Temperature</span><input type="number" min="0" max="2" step="0.1" value={temperature} onInput={(e)=>setTemperature(e.target.value)}/></label><label className="studio-field"><span>Max output</span><select value={maxTokens} onChange={(e)=>setMaxTokens(e.target.value)}><option value="512">512 tokens</option><option value="1024">1K tokens</option><option value="2048">2K tokens</option><option value="4096">4K tokens</option><option value="8192">8K tokens</option></select></label></div></details>
        <div className="chat-thread" aria-live="polite">{messages.map((item,index)=><article key={index} className={`chat-message ${item.role}`}><span>{item.role === "assistant" ? "LM" : "YOU"}</span><p>{item.content}</p>{item.imageName&&<small><ImageIcon/> {item.imageName}</small>}</article>)}{!messages.length&&<div className="chat-empty"><Bot/><strong>Ready for a local conversation</strong><small>Nothing is saved to disk or sent to a cloud service.</small></div>}{working === "chat"&&<article className="chat-message assistant pending"><span>LM</span><p><LoaderCircle className="spin"/> Generating locally…</p></article>}</div>
        {image && <div className="chat-attachment"><img src={image.dataUrl} alt="Chat attachment"/><span><strong>{image.name}</strong><small>Attached to next message</small></span><button aria-label="Remove image" onClick={()=>setImage(null)}><X/></button></div>}
        <div className="chat-compose"><input ref={imageInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e)=>chooseImage(e.target.files?.[0])}/><button className="attach-button" aria-label="Attach image" disabled={!loaded || !!working || selectedCatalog?.vision === false} onClick={()=>imageInput.current?.click()}><Upload/></button><textarea rows={2} value={draft} disabled={!loaded || !!working} onInput={(e)=>setDraft(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder={loaded ? "Message the local model…" : "Load a model to begin"}/><button className="send-button" aria-label="Send message" disabled={!loaded || !draft.trim() || !!working} onClick={send}>{working === "chat" ? <LoaderCircle className="spin"/> : <Send/>}</button></div>
      </div>
    </>}
  </section>;
}
