import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  // Stamped into the build so the window can say which one it is. A window
  // that was closed rather than quit keeps running the OLD build, and there
  // was no way to tell that apart from a bug.
  define: {
    __BUILD_STAMP__: JSON.stringify(
      new Date().toISOString().replace("T", " ").slice(0, 16),
    ),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM == "windows"
      ? "chrome105"
      : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));
