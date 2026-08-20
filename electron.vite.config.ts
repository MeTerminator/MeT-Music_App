import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(import.meta.dirname, "src/main/index.ts") },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: {
          // 主窗口(远程 UI)与本地窗口(桌面歌词/设置)使用不同 preload
          "main-window": resolve(import.meta.dirname, "src/preload/main-window.ts"),
          "local-window": resolve(import.meta.dirname, "src/preload/local-window.ts"),
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": resolve(import.meta.dirname, "src/renderer"),
        "@shared": resolve(import.meta.dirname, "src/shared"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          "desktop-lyrics": resolve(import.meta.dirname, "src/renderer/desktop-lyrics/index.html"),
          settings: resolve(import.meta.dirname, "src/renderer/settings/index.html"),
        },
      },
    },
  },
});
