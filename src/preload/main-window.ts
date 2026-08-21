import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
// 通道名来自零依赖的 channels.ts(运行时安全,打包时内联);
// 契约类型(含 zod 的 ipc.ts)仅 type-only 引用。
import { CH } from "../shared/channels";
import type { MainWindowAPI, WindowControl } from "../shared/ipc";
import type { HookPayload } from "../shared/hook-contract";

const api: MainWindowAPI = {
    sendHookData: (data: HookPayload) => ipcRenderer.send(CH.hookState, data),
    hideWindow: () => ipcRenderer.send(CH.windowControl, { action: "hide-main" } satisfies WindowControl),
    openSettings: () => ipcRenderer.send(CH.windowControl, { action: "open-settings" } satisfies WindowControl),
    minimizeWindow: () =>
        ipcRenderer.send(CH.windowControl, { action: "minimize-main" } satisfies WindowControl),
    toggleMaximize: () =>
        ipcRenderer.send(CH.windowControl, { action: "toggle-maximize-main" } satisfies WindowControl),
    closeWindow: () =>
        ipcRenderer.send(CH.windowControl, { action: "close-main" } satisfies WindowControl)
};

contextBridge.exposeInMainWorld("electronAPI", api);

// 兼容层:v1 的裸 IPC 通道在 v2 已全部移除,此透传仅防旧 UI 残留的
// window.electron.ipcRenderer 调用抛 ReferenceError —— send 到 v1 通道会静默无操作
// (main 侧无监听),invoke 会因无 handler 而 reject。
contextBridge.exposeInMainWorld("electron", {
    ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
        on: (channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void) =>
            ipcRenderer.on(channel, listener),
        invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
    }
});
