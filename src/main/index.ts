import { app, ipcMain, screen } from "electron";
import { createRequire } from "node:module";
import {
    CH,
    HookPayloadSchema,
    LyricConfigSchema,
    LyricWindowActionSchema,
    PlayerCommandSchema,
    WindowControlSchema,
    type AppInfo,
    type HookPayload,
    type LyricConfig,
    type LyricLineEvent,
    type Rect
} from "../shared/ipc";
import { HOOK_MIN_INTERVAL_MS, type CoverTheme } from "../shared/hook-contract";
import * as config from "./config";
import * as windowManager from "./window-manager";
import * as trayManager from "./tray-manager";
import * as mediaManager from "./media-manager";
import * as updater from "./updater";

try {
    const nodeRequire = createRequire(__filename);
    if (nodeRequire("electron-squirrel-startup")) app.quit();
} catch {
    // Ignore
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

mediaManager.setupAppIdentity();

let currentSong: HookPayload = {
    songName: "",
    songArtist: "",
    songMid: "",
    currentTime: 0,
    duration: 0,
    lyricText: "",
    lyricTrans: "",
    lyricData: [],
    isPlaying: false
};

interface PendingLyricUpdate {
    lyricText: string;
    lyricData: HookPayload["lyricData"];
    lyricTrans: string;
    coverTheme: CoverTheme | null;
}

let pendingLyricUpdate: PendingLyricUpdate | null = null;
let lyricUpdateTimer: ReturnType<typeof setTimeout> | null = null;
let lastLyricUpdateTime = 0;
let lastSongLabel = "";
let lastPlayingState: boolean | null = null;

function flushLyricUpdate(): void {
    if (lyricUpdateTimer) {
        clearTimeout(lyricUpdateTimer);
        lyricUpdateTimer = null;
    }
    if (!pendingLyricUpdate) return;

    // 窗口不可见/不存在时保留 pending,待窗口 show 时补发(见 setOnLyricWindowShow)
    const lyricWindow = windowManager.getLyricWindow();
    if (!lyricWindow || lyricWindow.isDestroyed() || !lyricWindow.isVisible()) return;

    const lyricUpdate = pendingLyricUpdate;
    pendingLyricUpdate = null;
    lastLyricUpdateTime = Date.now();

    const currentConfig = config.getConfig();
    const payload: LyricLineEvent = {
        lyricText: lyricUpdate.lyricText,
        lyricData: lyricUpdate.lyricData,
        lyricTrans: currentConfig.showTranslation ? lyricUpdate.lyricTrans : "",
        coverTheme: lyricUpdate.coverTheme
    };
    lyricWindow.webContents.send(CH.evLyricChange, payload);
}

function scheduleLyricUpdate(data: HookPayload): void {
    pendingLyricUpdate = {
        lyricText: data.lyricText || "",
        lyricData: data.lyricData || [],
        lyricTrans: data.lyricTrans || "",
        coverTheme: data.coverTheme || null
    };

    if (lyricUpdateTimer) return;

    const elapsed = Date.now() - lastLyricUpdateTime;
    const delay = Math.max(0, HOOK_MIN_INTERVAL_MS - elapsed);
    lyricUpdateTimer = setTimeout(flushLyricUpdate, delay);
}

function setupIPC(): void {
    ipcMain.on(CH.hookState, (_event, data: HookPayload) => {
        // 契约 v2:仅在 dev 校验并告警,生产直接透传(hook 高频调用,不做丢弃)。
        if (!app.isPackaged) {
            const parsed = HookPayloadSchema.safeParse(data);
            if (!parsed.success) {
                console.warn(`[ipc] ${CH.hookState} payload failed HookPayloadSchema:`, parsed.error.message);
            }
        }

        currentSong = { ...currentSong, ...data };
        const lyricWindow = windowManager.getLyricWindow();

        trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);
        mediaManager.update(currentSong);

        if (lyricWindow && !lyricWindow.isDestroyed()) {
            const songLabel = `${currentSong.songName} - ${currentSong.songArtist}`;
            if (songLabel !== lastSongLabel) {
                lastSongLabel = songLabel;
                lyricWindow.webContents.send(CH.evSongChange, songLabel);
            }

            if (currentSong.isPlaying !== lastPlayingState) {
                lastPlayingState = currentSong.isPlaying;
                lyricWindow.webContents.send(CH.evStatusChange, currentSong.isPlaying);
            }

            scheduleLyricUpdate(currentSong);
        }
    });

    ipcMain.on(CH.windowControl, (_event, raw: unknown) => {
        const parsed = WindowControlSchema.safeParse(raw);
        if (!parsed.success) {
            console.warn(`[ipc] ${CH.windowControl} invalid payload dropped:`, parsed.error.message);
            return;
        }
        switch (parsed.data.action) {
            case "hide-main":
                windowManager.getMainWindow()?.hide();
                break;
            case "show-main":
                showMainWindow();
                break;
            case "open-settings":
                windowManager.createSettingsWindow();
                break;
            case "close-settings":
                windowManager.getSettingsWindow()?.close();
                break;
            case "minimize-main":
                windowManager.getMainWindow()?.minimize();
                break;
            case "toggle-maximize-main": {
                const main = windowManager.getMainWindow();
                if (!main) break;
                // 状态回推由 window-manager 挂在 maximize/unmaximize 事件上,此处不必手动通知
                if (main.isMaximized()) main.unmaximize();
                else main.maximize();
                break;
            }
            case "close-main":
                // 走 win.close():是隐藏到托盘还是真正退出,交给 createMainWindow 里
                // 既有的 close 处理(isQuiting 判定),不在这里另起一套关闭策略
                windowManager.getMainWindow()?.close();
                break;
        }
    });

    ipcMain.handle(CH.appInfo, (): AppInfo => {
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        return {
            screen: { width, height },
            isWayland: windowManager.isWaylandSession()
        };
    });

    ipcMain.handle(CH.lyricBoundsGet, (): Rect => {
        const lyricWindow = windowManager.getLyricWindow();
        if (!lyricWindow) return { x: 0, y: 0, width: 1200, height: 130 };
        return lyricWindow.getBounds();
    });

    ipcMain.on(CH.lyricWindow, (_event, raw: unknown) => {
        const parsed = LyricWindowActionSchema.safeParse(raw);
        if (!parsed.success) {
            console.warn(`[ipc] ${CH.lyricWindow} invalid payload dropped:`, parsed.error.message);
            return;
        }
        const action = parsed.data;

        switch (action.type) {
            case "set-lock": {
                config.saveConfig({ isLock: action.isLock });
                windowManager.setLyricWindowLock(action.isLock);
                windowManager.broadcastLyricConfig();
                trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);
                break;
            }
            case "set-passthrough": {
                // 锁定态解锁按钮 hover 联动:enabled=false 临时关闭穿透使按钮可点;
                // enabled=true 时按当前 isLock 状态重新应用
                windowManager.setLyricWindowLock(action.enabled ? config.getConfig().isLock : false);
                break;
            }
            case "toggle-visibility": {
                windowManager.toggleLyricWindowVisibility();
                trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);
                break;
            }
            case "move": {
                windowManager.moveLyricWindow(action.x, action.y);
                break;
            }
            case "save-position": {
                windowManager.moveLyricWindow(action.x, action.y);
                const currentConfig = config.getConfig();
                currentConfig.windowX = action.x;
                currentConfig.windowY = action.y;
                config.saveConfig(currentConfig);
                break;
            }
            case "resize": {
                windowManager.resizeLyricWindow(action.x, action.y, action.width, action.height);
                break;
            }
            case "save-bounds": {
                const currentConfig = config.getConfig();
                currentConfig.windowX = action.bounds.x;
                currentConfig.windowY = action.bounds.y;
                currentConfig.windowWidth = action.bounds.width;
                currentConfig.windowHeight = action.bounds.height;
                config.saveConfig(currentConfig);
                break;
            }
            case "save-current-bounds": {
                // 拖动/缩放结束:main 自读实际 bounds 落盘,渲染端无需回读
                const lyricWindow = windowManager.getLyricWindow();
                if (!lyricWindow || lyricWindow.isDestroyed()) break;
                const bounds = lyricWindow.getBounds();
                const patch: Partial<LyricConfig> = {
                    windowWidth: bounds.width,
                    windowHeight: bounds.height
                };
                // Wayland 不暴露全局窗口坐标(恒为 0,0),不覆盖已保存的坐标
                if (!windowManager.isWaylandSession()) {
                    patch.windowX = bounds.x;
                    patch.windowY = bounds.y;
                }
                config.saveConfig(patch);
                break;
            }
            case "reset-position": {
                const screenWidth = windowManager.getScreenWidth();
                const DEFAULT_HEIGHT = 130;

                const currentConfig = config.getConfig();
                currentConfig.windowX = 0;
                currentConfig.windowY = 0;
                currentConfig.windowWidth = screenWidth;
                currentConfig.windowHeight = DEFAULT_HEIGHT;
                config.saveConfig(currentConfig);

                const lyricWindow = windowManager.getLyricWindow();
                if (lyricWindow) {
                    windowManager.resizeLyricWindow(0, 0, screenWidth, DEFAULT_HEIGHT);
                    windowManager.moveLyricWindow(0, 0);
                }
                break;
            }
        }
    });

    ipcMain.handle(CH.lyricConfigGet, () => {
        return config.getConfig();
    });

    ipcMain.on(CH.lyricConfigSet, (_event, raw: unknown) => {
        // payload 为 Partial<LyricConfig>;partial() 校验避免 default 填充改写未提交字段
        const parsed = LyricConfigSchema.partial().safeParse(raw);
        if (!parsed.success) {
            console.warn(`[ipc] ${CH.lyricConfigSet} invalid payload dropped:`, parsed.error.message);
            return;
        }
        config.saveConfig(parsed.data);
        const newConfig = config.getConfig();

        windowManager.setLyricWindowLock(newConfig.isLock);
        // 合并后的完整配置广播给歌词窗与设置窗(设置窗只发 diff,依赖完整回包对齐)
        windowManager.broadcastLyricConfig();

        trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);
    });

    ipcMain.on(CH.playerCommand, (_event, raw: unknown) => {
        const parsed = PlayerCommandSchema.safeParse(raw);
        if (!parsed.success) {
            console.warn(`[ipc] ${CH.playerCommand} invalid payload dropped:`, parsed.error.message);
            return;
        }
        switch (parsed.data.action) {
            case "prev":
                playPrev();
                break;
            case "next":
                playNext();
                break;
            case "playOrPause":
                playOrPause();
                break;
        }
    });
}

function runPlayerCommand(name: string): void {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents
        .executeJavaScript(`typeof window.${name} === "function" && window.${name}();`)
        .catch(() => {});
}

function playPrev(): void {
    runPlayerCommand("$MeTMusic_prev");
}

function playNext(): void {
    runPlayerCommand("$MeTMusic_next");
}

function playOrPause(): void {
    runPlayerCommand("$MeTMusic_playOrPause");
}

function showMainWindow(): void {
    const existing = windowManager.getMainWindow();
    const mainWindow = existing && !existing.isDestroyed() ? existing : windowManager.createMainWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

app.on("second-instance", showMainWindow);

// macOS emits activate when the user clicks the running app's Dock icon.
app.on("activate", showMainWindow);

app.on("window-all-closed", () => {
    // Remain running in background (tray icon handles quit)
});

app.on("before-quit", () => {
    windowManager.setQuitting(true);
    mediaManager.destroy();
    trayManager.destroyTray();
});

app.whenReady().then(() => {
    config.loadConfig();
    // 歌词窗隐藏期间 flush 会保留 pending,重新可见时补发最后一次歌词行
    windowManager.setOnLyricWindowShow(() => {
        if (pendingLyricUpdate) flushLyricUpdate();
    });
    windowManager.createMainWindow();
    windowManager.createLyricWindow();
    trayManager.createTray(playPrev, playNext, playOrPause);
    mediaManager.create({
        playPrev,
        playNext,
        playOrPause,
        showWindow: showMainWindow
    });
    setupIPC();
    updater.initUpdater();
});
