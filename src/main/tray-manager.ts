import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { CH } from "../shared/ipc";
import * as config from "./config";
import * as windowManager from "./window-manager";

type PlayerAction = () => void;

/** 托盘菜单关心的播放状态子集(index.ts 传入完整 HookPayload 亦可) */
export interface TraySong {
    songName?: string;
    songArtist?: string;
    isPlaying?: boolean;
}

let tray: Tray | null = null;

export function createTray(onPlayPrev: PlayerAction, onPlayNext: PlayerAction, onPlayOrPause: PlayerAction): void {
    const trayIconPath = path.join(__dirname, "..", "..", "public", "icons", "tray", "tray.png");
    const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });

    tray = new Tray(trayIcon);

    tray.on("click", () => {
        const mainWindow = windowManager.getMainWindow();
        if (!mainWindow) {
            windowManager.createMainWindow();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    updateTrayMenu({
        songName: "",
        songArtist: "",
        isPlaying: false
    }, onPlayPrev, onPlayNext, onPlayOrPause);
}

interface TrayState {
    songName: string;
    songArtist: string;
    isPlaying: boolean;
    lyricVisible: boolean;
    showTranslation: boolean;
    isLock: boolean;
}

let lastTrayState: TrayState | null = null;

export function updateTrayMenu(
    currentSong: TraySong,
    onPlayPrev: PlayerAction,
    onPlayNext: PlayerAction,
    onPlayOrPause: PlayerAction,
    force = false
): void {
    if (!tray || tray.isDestroyed()) return;

    const currentConfig = config.getConfig();
    const lyricVisible = windowManager.isLyricWindowVisible();

    const currentState: TrayState = {
        songName: (currentSong && currentSong.songName) || "",
        songArtist: (currentSong && currentSong.songArtist) || "",
        isPlaying: (currentSong && !!currentSong.isPlaying) || false,
        lyricVisible: !!lyricVisible,
        showTranslation: !!currentConfig.showTranslation,
        isLock: !!currentConfig.isLock
    };

    if (!force && lastTrayState &&
        lastTrayState.songName === currentState.songName &&
        lastTrayState.songArtist === currentState.songArtist &&
        lastTrayState.isPlaying === currentState.isPlaying &&
        lastTrayState.lyricVisible === currentState.lyricVisible &&
        lastTrayState.showTranslation === currentState.showTranslation &&
        lastTrayState.isLock === currentState.isLock) {
        return;
    }

    lastTrayState = currentState;

    const template: MenuItemConstructorOptions[] = [];

    if (currentState.isPlaying) {
        template.push(
            { label: `🎵 歌曲: ${currentState.songName}` },
            { label: `👤 歌手: ${currentState.songArtist}` },
            { type: "separator" }
        );
    } else {
        template.push({ label: "未播放", enabled: false }, { type: "separator" });
    }

    template.push({
        label: "⏮ 上一首",
        click: () => {
            onPlayPrev();
        }
    });

    template.push({
        label: currentState.isPlaying ? "⏸ 暂停" : "▶ 播放",
        click: () => {
            onPlayOrPause();
        }
    });

    template.push({
        label: "⏭ 下一首",
        click: () => {
            onPlayNext();
        }
    });

    template.push({ type: "separator" });

    template.push({
        label: "显示桌面歌词",
        type: "checkbox",
        checked: currentState.lyricVisible,
        click: () => {
            windowManager.toggleLyricWindowVisibility();
            updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause, true);
        }
    });

    template.push({
        label: "桌面歌词翻译",
        type: "checkbox",
        checked: currentConfig.showTranslation,
        click: () => {
            currentConfig.showTranslation = !currentConfig.showTranslation;
            config.saveConfig(currentConfig);
            const lyricWindow = windowManager.getLyricWindow();
            if (lyricWindow) {
                lyricWindow.webContents.send(CH.evConfigChanged, currentConfig);
            }
            updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause, true);
        }
    });

    template.push({
        label: "锁定歌词",
        type: "checkbox",
        checked: currentConfig.isLock,
        click: () => {
            currentConfig.isLock = !currentConfig.isLock;
            config.saveConfig(currentConfig);
            windowManager.setLyricWindowLock(currentConfig.isLock);
            const lyricWindow = windowManager.getLyricWindow();
            if (lyricWindow) {
                lyricWindow.webContents.send(CH.evConfigChanged, currentConfig);
            }
            updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause, true);
        }
    });

    template.push({ type: "separator" });
    template.push({
        label: "打开主界面",
        click: () => {
            const mainWindow = windowManager.getMainWindow();
            if (!mainWindow) {
                windowManager.createMainWindow();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
    template.push({
        label: "打开设置",
        click: () => {
            windowManager.createSettingsWindow();
        }
    });
    template.push({ type: "separator" });
    template.push({
        label: "退出",
        click: () => {
            windowManager.setQuitting(true);
            app.quit();
        }
    });

    tray.setContextMenu(Menu.buildFromTemplate(template));
}

export function destroyTray(): void {
    tray?.destroy();
}
