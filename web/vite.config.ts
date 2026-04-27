import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/auth": "http://localhost:4000",
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../dist/web"),
    emptyOutDir: true,
  },
});
