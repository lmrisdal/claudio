import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: { "main/index": "src/main/index.ts" },
      format: "cjs",
      platform: "node",
      outDir: "dist",
      deps: { neverBundle: ["electron"] },
      clean: true,
    },
    {
      entry: { "preload/index": "src/preload/index.ts" },
      format: "cjs",
      platform: "node",
      outDir: "dist",
      deps: { neverBundle: ["electron"] },
      clean: false,
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
