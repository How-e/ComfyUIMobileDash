import { defineConfig } from "vite";

const comfyProxy = {
  "/comfy": {
    target: "http://127.0.0.1:8188",
    changeOrigin: true,
    ws: true,
    rewriteWsOrigin: true,
    headers: {
      origin: "http://127.0.0.1:8188",
    },
    rewrite: (path) => path.replace(/^\/comfy/, ""),
  },
};

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  server: { proxy: comfyProxy },
  preview: { proxy: comfyProxy },
});
