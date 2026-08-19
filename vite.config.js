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
    plugins: [localAiPlugin({ comfyUrl: target })],
    oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
    optimizeDeps: {
      rolldownOptions: {
        transform: { jsx: { runtime: "automatic", importSource: "preact" } },
      },
    },
    server: { proxy: comfyProxy },
    preview: { proxy: comfyProxy },
  };
});
