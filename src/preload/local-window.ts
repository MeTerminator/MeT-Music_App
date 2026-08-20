import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
// 注意:仅 type-only 引用契约。preload 在沙箱中运行,不能在运行时 require 被
// externalize 的依赖(ipc.ts 顶层引入 zod),因此通道字符串在此以字面量书写,
// 并用 `satisfies Partial<typeof CH>` 钉死在 src/shared/ipc.ts 的契约上(漂移即编译失败)。
import type {
    AppInfo,
    CH,
    DesktopAPI,
    LyricConfig,
    LyricLineEvent,
    LyricWindowAction,
    PlayerCommand,
    Rect,
    WindowControl
} from "../shared/ipc";

const C = {
    playerCommand: "player:command",
    windowControl: "window:control",
    lyricWindow: "lyric:window",
    lyricConfigGet: "lyric:config-get",
    lyricConfigSet: "lyric:config-set",
    appInfo: "app:info",
    lyricBoundsGet: "lyric:bounds-get",
    evLyricChange: "lyric:line-change",
    evSongChange: "lyric:song-change",
    evStatusChange: "lyric:status-change",
    evConfigChanged: "lyric:config-changed",
    evWindowResized: "lyric:window-resized",
    evBoundsChanged: "lyric:bounds-changed"
} as const satisfies Partial<typeof CH>;

/** 订阅 main → 渲染进程事件,返回取消订阅函数 */
function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
    const listener = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
    ipcRenderer.on(channel, listener);
    return () => {
        ipcRenderer.removeListener(channel, listener);
    };
}

const api: DesktopAPI = {
    // invoke
    getAppInfo: () => ipcRenderer.invoke(C.appInfo) as Promise<AppInfo>,
    getLyricBounds: () => ipcRenderer.invoke(C.lyricBoundsGet) as Promise<Rect>,
    getLyricConfig: () => ipcRenderer.invoke(C.lyricConfigGet) as Promise<LyricConfig>,

    // send
    playerCommand: (action: PlayerCommand["action"]) =>
        ipcRenderer.send(C.playerCommand, { action } satisfies PlayerCommand),
    windowControl: (action: WindowControl["action"]) =>
        ipcRenderer.send(C.windowControl, { action } satisfies WindowControl),
    lyricWindow: (action: LyricWindowAction) => ipcRenderer.send(C.lyricWindow, action),
    setLyricConfig: (config: Partial<LyricConfig>) => ipcRenderer.send(C.lyricConfigSet, config),

    // events
    onLyricChange: (cb) => subscribe<[LyricLineEvent]>(C.evLyricChange, cb),
    onSongChange: (cb) => subscribe<[string]>(C.evSongChange, cb),
    onStatusChange: (cb) => subscribe<[boolean]>(C.evStatusChange, cb),
    onConfigChanged: (cb) => subscribe<[LyricConfig]>(C.evConfigChanged, cb),
    // payload 为 [width, height](见 ipc.ts evWindowResized 注释)
    onWindowResized: (cb) => subscribe<[[number, number]]>(C.evWindowResized, ([width, height]) => cb(width, height)),
    onBoundsChanged: (cb) => subscribe<[Rect]>(C.evBoundsChanged, cb)
};

contextBridge.exposeInMainWorld("desktopAPI", api);
