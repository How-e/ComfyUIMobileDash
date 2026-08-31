# Comfy Deck

**Comfy Deck** is a lightweight, touch-first mobile dashboard designed to eliminate the clunky, buggy, and frustrating experience of using standard desktop ComfyUI interfaces on mobile phones and tablets.

Standard ComfyUI node canvases are heavy desktop web apps designed for mouse navigation and large monitors. Operating complex spaghetti node graphs on a mobile touchscreen is cumbersome, error-prone, and consumes excessive device memory. **Comfy Deck** transforms your ComfyUI workflows and local LM Studio models into clean, responsive, touch-optimized controls. Engineered with Preact and zero bloated dependencies, it stays ultra-lightweight and out of the way—ensuring all host and device compute, RAM, and GPU resources remain completely dedicated to running your AI models.

## Start

1. Start ComfyUI with LAN access (`--listen`).
2. Double-click `start-dashboard.bat` (or run `npm install`, then `npm run dev`).
3. Open the LAN URL printed by Vite on your mobile device.
4. Tap **Workflows** in Comfy Deck and choose any workflow saved in ComfyUI.

The dashboard automatically uses ComfyUI at `127.0.0.1:8188`, so the common portable installation needs no path configuration or CORS flag. If ComfyUI uses another address, run `configure-dashboard.bat`; the chosen values are saved only in the ignored `.env.local` file. You can also copy `.env.example` manually or set `COMFYUI_URL` in the shell.

If ComfyUI runs on another computer, you may instead open the connection sheet in the dashboard and enter its full LAN URL. That server must permit the dashboard origin with ComfyUI's `--enable-cors-header` option.

## Portable configuration

All connection and runtime variables are fully configurable via `.env.local` (or shell environment variables):

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `COMFYUI_URL` | `http://127.0.0.1:8188` | Upstream ComfyUI server address proxied by the dashboard. |
| `LMSTUDIO_URL` | `http://127.0.0.1:1234` | Headless LM Studio API endpoint for Prompt Studio and model chat. |
| `LMSTUDIO_PRESET_DIR` | Auto-detected | Path to LM Studio config presets (`%USERPROFILE%\.lmstudio\config-presets`). |
| `HOST` | `0.0.0.0` | Network interface to bind (use `127.0.0.1` for loopback-only access). |
| `PORT` | `5173` | Local HTTP port for the dashboard server. |
| `COMFYUI_WORKFLOW_DIR` | Auto-detected | Optional folder containing workflow JSON files for integration tests. |

- `.env.local` is deliberately ignored by Git. Never put credentials, personal paths, workflow files, prompts, or generated media in tracked files.
- Run `npm run privacy:check` before publishing or committing. It reports locations only and never prints a detected value.
- To produce a clean, test-free production release bundle: `npm run build:release`.

The application does not need a filesystem path to ComfyUI during normal use; it discovers saved workflows through ComfyUI's API.

## Current capabilities

- Three purpose-built workspaces: **Flow** for the safe ComfyUI ↔ LM Studio handoff, **ComfyUI** for workflow operations only, and **LM Studio** for independent local model work.
- A ComfyUI control room with on-demand device, RAM, VRAM, queue, and workflow snapshots; direct Create, Queue, and Gallery views; and ComfyUI-only model unload/shutdown controls.
- An independent LM Studio workspace for installed text and vision models, local presets, bounded context and idle-unload settings, session-only chat, optional image input, model-only unload, and full headless-runtime shutdown.
- Lists workflows directly from ComfyUI's saved workflow library.
- Converts both canvas workflows and API-format workflows into runnable touch controls.
- Expands modern ComfyUI subgraphs, including the promoted MiniMax H3 controls.
- Protects linked node inputs from accidental edits.
- Prioritizes image inputs, prompts, LoRAs, duration, and sampling controls.
- Sampler seeds support ComfyUI control-after-generate (fixed / increment / decrement / randomize) in the Create tab.
- Uploads replacement input images directly to ComfyUI.
- Full-screen, keyboard-safe prompt editor.
- Live WebSocket status, progress, queue count, interrupt, and output gallery.
- Drag-and-drop or file-picker workflow import.
- Local connection preference storage only; no cloud or hosted services.
- A local Prompt Studio can hand model memory from ComfyUI to an LM Studio vision model, generate a prompt from an image plus instructions, copy it on mobile, insert it into a selected workflow field, and fully unload LM Studio before returning to ComfyUI.

## Local Prompt Studio

Prompt Studio uses LM Studio's lightweight headless runtime (`llmster`), not desktop-window automation. Install the standalone Windows runtime using LM Studio's official headless installer (`irm https://lmstudio.ai/install.ps1 | iex`); having only the `lms` CLI bundled with the desktop app is not sufficient. If the LM Studio desktop application is running, quit it completely from the Windows system tray before starting Prompt Studio; the dashboard deliberately refuses to force-close the GUI.

The handoff is strict:

1. Comfy Deck verifies that the ComfyUI running and pending queues are empty.
2. It calls ComfyUI's native `/free` endpoint to unload models and release cached memory.
3. It starts `llmster` and the LM Studio server on `127.0.0.1:1234` only.
4. It exposes installed vision-capable models and local LM Studio config presets, loads only the selected model with one inference slot and an 8K context, and gives that model a 15-minute idle unload timer as crash protection.
5. **Unload LM & use in workflow** unloads all LM Studio models, stops its API server, stops `llmster`, and only then places the generated text in the chosen ComfyUI prompt field.

## Independent workspaces

The **ComfyUI** workspace never starts or loads LM Studio. Its Overview snapshot is fetched only when opened or manually refreshed, and its **Unload models** action calls ComfyUI's native memory-release endpoint without touching LM Studio. Create, Queue, and Gallery retain the existing workflow editor, live preview, recovery, and run-history behavior.

The **LM Studio** workspace does not require a ComfyUI workflow. It can load any installed LM Studio LLM, including text-only models, with one inference slot and a selectable 4K–32K context plus a 5–60 minute idle unload. Chat history, custom system instructions, sampling controls, and optional image attachments stay in browser memory for the current tab. **Unload model** keeps the lightweight server ready for another model; **Stop runtime** unloads models and closes the server and headless daemon.

Starting the independent LM workspace still protects shared VRAM. If ComfyUI is reachable, its queue must be idle and its model memory is released first. If ComfyUI is intentionally closed and therefore unreachable, LM Studio may start on its own. The **Flow** workspace remains stricter and refuses a handoff unless ComfyUI cleanup can be verified.

The memory-chip button immediately left of the ComfyUI connection indicator provides finish-up controls from every tab:

- **Free RAM / VRAM** requires an idle ComfyUI queue, unloads every LM Studio model, stops the headless LM server and daemon, then asks ComfyUI to unload models and release cached memory. It never loads a replacement model.
- **Close LM runtime** unloads LM models and stops the loopback server and headless daemon without closing ComfyUI.
- **Close ComfyUI** releases its model memory and closes only a verified local Python process whose command line belongs to ComfyUI. Remote addresses, active queues, and unrelated port listeners are refused.

Images and prompt text are held in browser memory for the current dashboard session. They are not written to disk, local storage, logs, or tracked files. Closing the dashboard server also attempts to stop the headless LM runtime. LM Studio and ComfyUI remain loopback-only behind the existing dashboard proxy.

The mobile dashboard has no login screen and its development command listens on the local network so a phone can connect. Run it only on a trusted private LAN, do not port-forward or expose it to the public internet, and stop the dashboard when it is not in use. Local control requests are same-origin checked and size-limited; the LM Studio API remains bound to loopback, and ComfyUI shutdown is limited to a verified local Python process.

LM Studio presets remain local in `%USERPROFILE%\.lmstudio\config-presets`. Prompt Studio lists only their names in the browser and reads the selected preset server-side. Its system prompt and supported generation values (temperature, top-k/top-p/min-p, repeat/frequency/presence penalties, seed, and max tokens) are applied to the local request. LM Studio's per-model load defaults are separate from presets and are still honored by `lms load`; the dashboard intentionally fixes context, one inference slot, and the idle TTL for safe GPU handoff.

## Queue, recovery, and lightweight operation

- The **Queue** tab loads detailed jobs only when you open it or tap **Refresh**. Its actions can stop the current run, remove individual pending jobs, clear pending jobs, or re-submit a pending job at the front of the queue.
- The **Gallery** shows the last 5 generations of image and video output references, grouped by run. Run-history settings still keep the last 16 dashboard runs locally on the phone/browser. It stores workflow JSON and output references only—never output image or video data—and lets you queue a saved run first.
- The active Create-tab workflow and input values survive a browser refresh or tab discard locally. Prompt Studio images, instructions, and generated prompts stay in session memory only.
- An active dashboard prompt ID and the tab's ComfyUI WebSocket client ID survive a browser refresh. The dashboard performs one small history and queue lookup on restoration, restores the running state immediately, and receives progress and preview again on the next ComfyUI update. A single five-second fallback history check covers missed completion events; it does not run a repeating poll.
- Images are lazy-loaded and the dashboard does not prefetch ComfyUI history, output folders, thumbnails, hardware telemetry, or the multi-megabyte global node catalog. Node metadata is fetched only for classes used by the workflow you open. This is deliberate so generation retains CPU, RAM, and GPU headroom.
- Prompt Studio adds no runtime package dependency, performs no background inference or status polling, and starts its local model service only on demand. Keeping the application lightweight is a permanent project requirement.

## Development and contributing

We welcome contributions from human developers and AI assistants!

- **Testing**: Run the native test suite with `npm test`.
- **Privacy Check**: Verify that no personal paths or secrets are included with `npm run privacy:check`.
- **Release Build**: Build a clean, test-free production bundle with `npm run build:release`.
- **Contributor Guidelines**: See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution steps and pull request conventions.
- **AI Agent Guidelines**: See [AGENTS.md](AGENTS.md) for architectural constraints and AI assistant instructions.
- **Security Policy**: See [SECURITY.md](SECURITY.md) for security reporting procedures.

## License

This project is open-source software licensed under the [MIT License](LICENSE).

