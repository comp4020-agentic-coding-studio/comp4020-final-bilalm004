import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  build: { outDir: "../dist/client", emptyOutDir: true, target: "es2023" },
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/readme": "http://localhost:8080",
    },
  },
});
