# Comfy Deck

A local, touch-first dashboard for opening and running ComfyUI API-format workflows from a phone or tablet.

## Start

1. Start ComfyUI with LAN access (`--listen`).
2. Double-click `start-dashboard.bat` (or run `npm install`, then `npm run dev`).
3. Open the LAN URL printed by Vite on your mobile device.
4. Tap **Workflows** in Comfy Deck and choose any workflow saved in ComfyUI.

The default `/comfy` connection is proxied to `127.0.0.1:8188` on this PC, so no CORS flag is needed. If ComfyUI runs on a different computer, open the connection sheet and enter its full LAN URL; that server must permit the dashboard origin with ComfyUI's `--enable-cors-header` option.

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

## Queue, recovery, and lightweight operation

- The **Queue** tab loads detailed jobs only when you open it or tap **Refresh**. Its actions can stop the current run, remove individual pending jobs, clear pending jobs, or re-submit a pending job at the front of the queue.
- The **Gallery** keeps the last 16 dashboard-run settings locally on the phone/browser. It stores workflow JSON and output references only—never output image or video data—and lets you queue a saved run first.
- An active dashboard prompt ID survives a browser refresh. The dashboard performs one small history lookup on restoration and otherwise uses the existing WebSocket to notice completion. A single five-second fallback check covers missed completion events; it does not run a repeating poll.
- Images are lazy-loaded and the dashboard does not prefetch ComfyUI history, output folders, thumbnails, or hardware telemetry. This is deliberate so generation retains CPU, RAM, and GPU headroom.
