import { defineConfig } from "tsup";
import { cpSync } from "node:fs";

export default defineConfig([
  // Library bundle
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    onSuccess: async () => {
      // Copy Studio UI static assets to dist
      cpSync("src/studio/ui", "dist/studio/ui", { recursive: true });
    },
  },
  // CLI entry point
  {
    entry: ["src/cli/bin.ts"],
    format: ["cjs"],
    outDir: "dist/cli",
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    splitting: false,
  },
]);
