import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
// 注意:仅 type-only 引用契约。preload 在沙箱中运行,不能在运行时 require 被
// externalize 的依赖(ipc.ts 顶层引入 zod),因此通道字符串在此以字面量书写,
// 并用 `satisfies typeof CH[...]` 钉死在 src/shared/ipc.ts 的契约上(漂移即编译失败)。
import type { CH, MainWindowAPI, WindowControl } from "../shared/ipc";
import type { HookPayload } from "../shared/hook-contract";

type Ch = typeof CH;

const HOOK_STATE = "hook:state" satisfies Ch["hookState"];
const WINDOW_CONTROL = "window:control" satisfies Ch["windowControl"];

const api: MainWindowAPI = {
    sendHookData: (data: HookPayload) => ipcRenderer.send(HOOK_STATE, data),
    hideWindow: () => ipcRenderer.send(WINDOW_CONTROL, { action: "hide-main" } satisfies WindowControl),
    openSettings: () => ipcRenderer.send(WINDOW_CONTROL, { action: "open-settings" } satisfies WindowControl)
};

contextBridge.exposeInMainWorld("electronAPI", api);

// 兼容层:旧 UI 残留的 window.electron.ipcRenderer 调用防 ReferenceError(与旧 preload 相同)
contextBridge.exposeInMainWorld("electron", {
    ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
        on: (channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void) =>
            ipcRenderer.on(channel, listener),
        invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
    }
});
