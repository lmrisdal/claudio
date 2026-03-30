import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: !isTauri,
  build: {
    outDir: isTauri ? "dist" : "../src/Claudio.Api/wwwroot",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router/")
          ) {
            return "vendor";
          }
          if (id.includes("node_modules/@tanstack/")) {
            return "query";
          }
          if (id.includes("node_modules/@headlessui/")) {
            return "ui";
          }
        },
      },
    },
  },
  server: {
    strictPort: isTauri,
    proxy: isTauri
      ? undefined
      : {
          "/api": "http://localhost:8080",
          "/connect": "http://localhost:8080",
          "/images": "http://localhost:8080",
        },
  },
});
