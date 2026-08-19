# Comfy Deck

A local, touch-first dashboard for opening and running ComfyUI API-format workflows from a phone or tablet.

## Start

1. Start ComfyUI with LAN access (`--listen`).
2. Double-click `start-dashboard.bat` (or run `npm install`, then `npm run dev`).
3. Open the LAN URL printed by Vite on your mobile device.
4. Tap **Workflows** in Comfy Deck and choose any workflow saved in ComfyUI.

The dashboard automatically uses ComfyUI at `127.0.0.1:8188`, so the common portable installation needs no path configuration or CORS flag. If ComfyUI uses another address, run `configure-dashboard.bat`; the chosen values are saved only in the ignored `.env.local` file. You can also copy `.env.example` manually or set `COMFYUI_URL` in the shell.

If ComfyUI runs on another computer, you may instead open the connection sheet in the dashboard and enter its full LAN URL. That server must permit the dashboard origin with ComfyUI's `--enable-cors-header` option.

## Portable configuration

- `COMFYUI_URL` controls the server-side Vite proxy and defaults to `http://127.0.0.1:8188`.
- `COMFYUI_WORKFLOW_DIR` points integration tests at an installed workflow folder. Tests also detect common adjacent ComfyUI layouts automatically.
- `.env.local` is deliberately ignored by Git. Never put credentials, personal paths, workflow files, prompts, or generated media in tracked files.
- Run `npm run privacy:check` before publishing. It reports locations only and never prints a detected value.

The application does not need a filesystem path to ComfyUI during normal use; it discovers saved workflows through ComfyUI's API.

## Current capabilities

- Lists workflows directly from ComfyUI's saved workflow library.
- Converts both canvas workflows and API-format workflows into runnable touch controls.
- Expands modern ComfyUI subgraphs, including the promoted MiniMax H3 controls.
- Protects linked node inputs from accidental edits.
- Prioritizes image inputs, prompts, LoRAs, duration, and sampling controls.
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

The memory-chip button immediately left of the ComfyUI connection indicator provides finish-up controls from every tab:

- **Free RAM / VRAM** requires an idle ComfyUI queue, unloads every LM Studio model, stops the headless LM server and daemon, then asks ComfyUI to unload models and release cached memory. It never loads a replacement model.
- **Close LM runtime** unloads LM models and stops the loopback server and headless daemon without closing ComfyUI.
- **Close ComfyUI** releases its model memory and closes only a verified local Python process whose command line belongs to ComfyUI. Remote addresses, active queues, and unrelated port listeners are refused.

Images and prompt text are held in browser memory for the current dashboard session. They are not written to disk, local storage, logs, or tracked files. Closing the dashboard server also attempts to stop the headless LM runtime. LM Studio and ComfyUI remain loopback-only behind the existing dashboard proxy.

The mobile dashboard has no login screen and its development command listens on the local network so a phone can connect. Run it only on a trusted private LAN, do not port-forward or expose it to the public internet, and stop the dashboard when it is not in use. Local control requests are same-origin checked and size-limited; the LM Studio API remains bound to loopback, and ComfyUI shutdown is limited to a verified local Python process.

LM Studio presets remain local in `%USERPROFILE%\.lmstudio\config-presets`. Prompt Studio lists only their names in the browser and reads the selected preset server-side. Its system prompt and supported generation values (temperature, top-k/top-p/min-p, repeat/frequency/presence penalties, seed, and max tokens) are applied to the local request. LM Studio's per-model load defaults are separate from presets and are still honored by `lms load`; the dashboard intentionally fixes context, one inference slot, and the idle TTL for safe GPU handoff.

## Queue, recovery, and lightweight operation

- The **Queue** tab loads detailed jobs only when you open it or tap **Refresh**. Its actions can stop the current run, remove individual pending jobs, clear pending jobs, or re-submit a pending job at the front of the queue.
- The **Gallery** keeps the last 16 dashboard-run settings locally on the phone/browser. It stores workflow JSON and output references only—never output image or video data—and lets you queue a saved run first.
- An active dashboard prompt ID survives a browser refresh. The dashboard performs one small history lookup on restoration and otherwise uses the existing WebSocket to notice completion. A single five-second fallback check covers missed completion events; it does not run a repeating poll.
- Images are lazy-loaded and the dashboard does not prefetch ComfyUI history, output folders, thumbnails, hardware telemetry, or the multi-megabyte global node catalog. Node metadata is fetched only for classes used by the workflow you open. This is deliberate so generation retains CPU, RAM, and GPU headroom.
- Prompt Studio adds no runtime package dependency, performs no background inference or status polling, and starts its local model service only on demand. Keeping the application lightweight is a permanent project requirement.
