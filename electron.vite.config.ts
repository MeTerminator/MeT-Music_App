import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/**
 * 把 src/shared/channels.ts(零依赖通道常量)按 importer 复制内联进每个 preload 入口。
 * 两个 preload 都引用它时 rollup 会拆出共享 chunk 并以相对路径 require,
 * 而沙箱化 preload 的 require 只支持 electron/内建模块子集,相对 require 会抛错。
 */
function duplicateSharedChannels(): Plugin {
  const marker = "\0preload-inline-copy:";
  const channelsFile = resolve(import.meta.dirname, "src/shared/channels.ts");
  return {
    name: "duplicate-shared-channels",
    enforce: "pre",
    // rolldown-vite 仅对带 filter 的对象形式 hook 可靠触发
    resolveId: {
      filter: { id: /(^|\/)shared\/channels$/ },
      handler(_source, importer) {
        if (!importer) return null;
        // 每个 importer 得到独立虚拟模块 id → 各自内联一份,不产生共享 chunk
        return `${marker}${encodeURIComponent(importer)}`;
      },
    },
    load: {
      filter: { id: /preload-inline-copy:/ },
      handler(id) {
        if (!id.startsWith(marker)) return null;
        return readFileSync(channelsFile, "utf-8");
      },
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(import.meta.dirname, "src/main/index.ts") },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), duplicateSharedChannels()],
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
