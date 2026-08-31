import { defineConfig, loadEnv } from "vite";
import { localAiPlugin } from "./server/localAiController.mjs";

function comfyUrl(value) {
  const url = new URL(value || "http://127.0.0.1:8188");
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("COMFYUI_URL must use http:// or https://");
  return url.href.replace(/\/$/, "");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = comfyUrl(env.COMFYUI_URL || process.env.COMFYUI_URL);
  const lmStudioUrl = env.LMSTUDIO_URL || env.LM_STUDIO_URL || process.env.LMSTUDIO_URL || process.env.LM_STUDIO_URL;
  const presetDir = env.LMSTUDIO_PRESET_DIR || process.env.LMSTUDIO_PRESET_DIR;
  const host = env.HOST || process.env.HOST || env.VITE_HOST || process.env.VITE_HOST || "0.0.0.0";
  const port = Number(env.PORT || process.env.PORT || env.VITE_PORT || process.env.VITE_PORT || 5173);

  const comfyProxy = {
    "/comfy": {
      target,
      changeOrigin: true,
      ws: true,
      rewriteWsOrigin: true,
      headers: { origin: target },
      rewrite: (path) => path.replace(/^\/comfy/, ""),
    },
  };

  return {
    plugins: [localAiPlugin({ comfyUrl: target, lmStudioUrl, presetDir })],
    oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
    optimizeDeps: {
      rolldownOptions: {
        transform: { jsx: { runtime: "automatic", importSource: "preact" } },
      },
    },
    server: { host, port, proxy: comfyProxy },
    preview: { host, port, proxy: comfyProxy },
  };
});

