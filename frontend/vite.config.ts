import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../src/Claudio.Api/wwwroot",
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
    proxy: {
      "/api": "http://localhost:8080",
      "/connect": "http://localhost:8080",
      "/images": "http://localhost:8080",
    },
  },
});
