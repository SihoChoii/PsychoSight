import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const dir = path.dirname(fileURLToPath(import.meta.url));

const apiProxy = {
  target: "http://127.0.0.1:8765",
  changeOrigin: false,
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: { allow: [path.resolve(dir, ".."), dir] },
    proxy: {
      "/health": apiProxy,
      "/config": apiProxy,
      "/conversations": apiProxy,
      "/analyses": apiProxy,
    },
  },
  preview: { host: "127.0.0.1", port: 4173 },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
  },
});
