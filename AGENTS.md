# Agent Guidelines for Comfy Deck (ComfyUIMobileDash)

This guide provides context, architectural constraints, and operational rules for AI coding assistants and autonomous agents working on this codebase.

---

## 1. Project Overview & Architecture

**Comfy Deck** is a lightweight, mobile-first touch dashboard for controlling ComfyUI and LM Studio workflows over a private local network.

- **Frontend**: Preact + Vite (`src/`), styled with clean CSS (`src/styles.css`), touch-optimized controls, mobile sheet dialogs, and SVG icons from `lucide-preact`.
- **Backend / Proxy Plugin**: Node.js Vite plugin (`server/localAiController.mjs`) providing same-origin local proxying to ComfyUI and headless LM Studio (`llmster` runtime).
- **Core Modules**:
  - `src/workflowAdapter.js`: Normalizes API and canvas workflows, handles dynamic node types (rgthree Power LoRA, VHS video combine, KSampler seeds, MiniMax subgraphs).
  - `src/livePreview.js`: Binary WebSocket preview decoding and state restoration.
  - `src/galleryMedia.js`: Grouped run history, video/image inference, deduplication.
  - `src/createSession.js`: Local tab persistence and recovery.
  - `src/promptBridge.js`: Visual prompt extraction and transfer.
  - `src/LMStudioPanel.jsx`: Headless local LLM/vision model workspace.

---

## 2. Mandatory Engineering Constraints

### Strict Privacy & Zero Credentials
- **NEVER** hardcode personal user directories, machine hostnames, private network IP addresses, personal emails, tokens, or API keys in source files or tests.
- **NEVER** track `.env.local` or `.env` files. `.env.example` is the only tracked configuration template.
- Always run `npm run privacy:check` after editing code.

### Pure Portability & Configurable Defaults
- All external endpoints must use environment variables (`COMFYUI_URL`, `LMSTUDIO_URL`, `LMSTUDIO_PRESET_DIR`, `HOST`, `PORT`) with sensible loopback defaults (`http://127.0.0.1:8188`, `http://127.0.0.1:1234`).
- No filesystem path dependencies for normal ComfyUI operations (use ComfyUI API endpoints for discovery).

### Lightweight Performance Principle
- Keep the project lean: avoid adding bulky npm dependencies.
- Do not introduce persistent polling loops; use reactive WebSocket updates and single-shot fallbacks.
- Media and workflow schemas must be lazy-loaded on demand to preserve GPU/RAM headroom.

### VRAM & Process Safety
- Before starting LM Studio inference, ensure ComfyUI queue is idle and release ComfyUI model cache via `/free`.
- Before returning to ComfyUI, ensure LM Studio models and daemons are completely unloaded/stopped.
- Process termination must strictly target verified Python / ComfyUI processes listening on the configured port.

---

## 3. Developer Commands

```bash
# Run unit test suite (Node native test runner)
npm test

# Run privacy and secret scanner
npm run privacy:check

# Start local development server
npm run dev

# Build production frontend
npm run build

# Build complete open-source release package (excludes tests & agent docs)
npm run build:release
```

---

## 4. Pull Request & Verification Checklist
Before submitting changes or completing a task:
1. `npm test` passes all tests.
2. `npm run privacy:check` passes with zero violations.
3. `npm run build` succeeds cleanly.
4. Line endings conform to `.gitattributes`.
