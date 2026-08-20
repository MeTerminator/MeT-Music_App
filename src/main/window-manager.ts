import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from "electron";
import path from "node:path";
import { CH } from "../shared/ipc";
import * as config from "./config";

let mainWindow: BrowserWindow | null = null;
let lyricWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let isQuiting = false;
let lyricWindowVisible = true;

const DEFAULT_LYRIC_WIDTH = 1200;
const DEFAULT_LYRIC_HEIGHT = 130;
let currentLyricWidth = DEFAULT_LYRIC_WIDTH;
let currentLyricHeight = DEFAULT_LYRIC_HEIGHT;
let saveLyricBoundsTimer: ReturnType<typeof setTimeout> | null = null;

export function isWaylandSession(): boolean {
    const ozoneArgument = process.argv.find(argument =>
        argument.startsWith("--ozone-platform=") ||
        argument.startsWith("--ozone-platform-hint=")
    );
    const explicitOzonePlatform = (
        ozoneArgument?.split("=")[1] ||
        process.env.ELECTRON_OZONE_PLATFORM_HINT ||
        process.env.OZONE_PLATFORM ||
        ""
    ).toLowerCase();

    if (explicitOzonePlatform === "x11") return false;
    if (explicitOzonePlatform === "wayland") return true;

    return process.platform === "linux" && (
        Boolean(process.env.WAYLAND_DISPLAY) ||
        String(process.env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland"
    );
}

function scheduleLyricBoundsSave(): void {
    if (saveLyricBoundsTimer) clearTimeout(saveLyricBoundsTimer);
    saveLyricBoundsTimer = setTimeout(() => {
        if (!lyricWindow || lyricWindow.isDestroyed()) return;

        const bounds = lyricWindow.getBounds();
        const currentConfig = config.getConfig();
        currentConfig.windowWidth = bounds.width;
        currentConfig.windowHeight = bounds.height;

        // Wayland deliberately hides global window coordinates (they are always 0,0).
        // Keep the last meaningful coordinates instead of overwriting them.
        if (!isWaylandSession()) {
            currentConfig.windowX = bounds.x;
            currentConfig.windowY = bounds.y;
        }

        config.saveConfig(currentConfig);
    }, 250);
}

export function getScreenWidth(): number {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayMatching({ x: cursor.x, y: cursor.y, width: 1, height: 1 });
    return display.bounds.width;
}

export function createMainWindow(): BrowserWindow {
    if (mainWindow) return mainWindow;
    const screenWidth = getScreenWidth();

    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        x: (screenWidth - 1200) / 2,
        y: 80,
        show: true,
        frame: false,
        title: "MeT-Music",
        icon: path.join(__dirname, "..", "..", "public", "icons", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "main-window.js"),
            contextIsolation: true,
            nodeIntegration: false,
            // Keep Media Session / audio alive after hide-to-tray.
            backgroundThrottling: false
        }
    });
    mainWindow = win;

    win.webContents.setBackgroundThrottling(false);
    win.loadURL(process.env.METMUSIC_UI_URL || "https://music.met6.top:444/app/");

    win.on("close", (e) => {
        if (!isQuiting) {
            e.preventDefault();
            win.hide();
        }
    });

    win.on("page-title-updated", (e) => {
        e.preventDefault();
        win.setTitle("MeT-MusicQ");
    });

    win.webContents.on("did-finish-load", () => {
        // 契约 v2(src/shared/hook-contract.ts):
        //  1. 注入 $MeTMusic_Hook 回调;
        //  2. 探测 $MeTMusic_registerHost —— v2 UI 自行渲染导航栏按钮并回调宿主;
        //  3. 不存在则降级为 v1 的 DOM 按钮注入(照抄旧 windowManager.js)。
        const inject = `
            // === 注入 MeTMusic_Hook ===
            window.$MeTMusic_Hook = (d) => window.electronAPI.sendHookData(d);

            if (typeof window.$MeTMusic_registerHost === "function") {
                // === 契约 v2:UI 自行渲染设置/隐藏按钮 ===
                window.$MeTMusic_registerHost({
                    onOpenSettings: () => window.electronAPI.openSettings(),
                    onHideWindow: () => window.electronAPI.hideWindow()
                });
            } else {
                // === v1 UI 降级:注入隐藏/设置按钮 ===
                function injectWindowButtons() {
                    const target = document.querySelector('.main-nav > .right');
                    if (target && !target.querySelector('.electron-hide-btn')) {
                        // Settings Button
                        const settingsBtn = document.createElement('div');
                        settingsBtn.className = 'electron-settings-btn';
                        settingsBtn.innerHTML = '⚙';
                        settingsBtn.style.cssText = \`
                            width: 30px;
                            height: 30px;
                            margin-left: 10px;
                            font-size: 18px;
                            color: white;
                            background: rgba(255,255,255,0.12);
                            border-radius: 50%;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            user-select: none;
                            -webkit-app-region: no-drag !important;
                            pointer-events: auto !important;
                            position: relative;
                            transition: background-color 0.2s;
                        \`;
                        settingsBtn.addEventListener("mouseover", () => {
                            settingsBtn.style.backgroundColor = "rgba(255,255,255,0.2)";
                        });
                        settingsBtn.addEventListener("mouseout", () => {
                            settingsBtn.style.backgroundColor = "rgba(255,255,255,0.12)";
                        });
                        settingsBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            window.electronAPI.openSettings();
                        });

                        // Close Button
                        const closeBtn = document.createElement('div');
                        closeBtn.className = 'electron-hide-btn';
                        closeBtn.textContent = '×';
                        closeBtn.style.cssText = \`
                            width: 30px;
                            height: 30px;
                            margin-left: 10px;
                            font-size: 18px;
                            font-weight: bold;
                            color: white;
                            background: rgba(255,255,255,0.12);
                            border-radius: 50%;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            user-select: none;
                            -webkit-app-region: no-drag !important;
                            pointer-events: auto !important;
                            position: relative;
                            transition: background-color 0.2s;
                        \`;
                        closeBtn.addEventListener("mouseover", () => {
                            closeBtn.style.backgroundColor = "rgba(245,94,85,0.8)";
                        });
                        closeBtn.addEventListener("mouseout", () => {
                            closeBtn.style.backgroundColor = "rgba(255,255,255,0.12)";
                        });
                        closeBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            window.electronAPI.hideWindow();
                        });

                        target.appendChild(settingsBtn);
                        target.appendChild(closeBtn);
                    }
                }
                injectWindowButtons();
            }
        `;
        win.webContents.executeJavaScript(inject);
    });

    return win;
}

export function setLyricWindowLock(isLock: boolean): void {
    if (!lyricWindow) return;
    if (process.platform === "darwin" || process.platform === "win32") {
        lyricWindow.setIgnoreMouseEvents(isLock, { forward: true });
    } else {
        lyricWindow.setIgnoreMouseEvents(isLock);
    }
}

function notifyBoundsChanged(): void {
    if (settingsWindow && !settingsWindow.isDestroyed() && lyricWindow && !lyricWindow.isDestroyed()) {
        settingsWindow.webContents.send(CH.evBoundsChanged, lyricWindow.getBounds());
    }
}

export function createLyricWindow(): BrowserWindow {
    if (lyricWindow) return lyricWindow;

    const currentConfig = config.getConfig();
    currentLyricWidth = currentConfig.windowWidth || getScreenWidth();
    currentLyricHeight = currentConfig.windowHeight || DEFAULT_LYRIC_HEIGHT;

    const finalX = (currentConfig.windowX !== undefined && currentConfig.windowX !== null) ? currentConfig.windowX : 0;
    const finalY = (currentConfig.windowY !== undefined && currentConfig.windowY !== null) ? currentConfig.windowY : 0;

    const windowOptions: BrowserWindowConstructorOptions = {
        width: currentLyricWidth,
        height: currentLyricHeight,
        x: finalX,
        y: finalY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        minWidth: 100,
        minHeight: 50,
        show: true,
        maximizable: false,
        icon: path.join(__dirname, "..", "..", "public", "icons", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "local-window.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    };

    const win = new BrowserWindow(windowOptions);
    lyricWindow = win;

    win.setAlwaysOnTop(true, "screen-saver");

    if (win.setVisibleOnAllWorkspaces) {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
        win.loadURL(process.env.ELECTRON_RENDERER_URL + "/desktop-lyrics/index.html");
    } else {
        win.loadFile(path.join(__dirname, "..", "renderer", "desktop-lyrics", "index.html"));
    }

    win.on("closed", () => { lyricWindow = null; });

    win.on("hide", () => { lyricWindowVisible = false; });
    win.on("show", () => { lyricWindowVisible = true; });

    win.on("resize", () => {
        if (!lyricWindow) return;

        // Native edge resizing is required on Wayland: the compositor, rather than
        // JavaScript, owns the interactive resize operation.
        const [width, height] = lyricWindow.getSize();
        currentLyricWidth = width ?? currentLyricWidth;
        currentLyricHeight = height ?? currentLyricHeight;
        lyricWindow.webContents.send(CH.evWindowResized, [currentLyricWidth, currentLyricHeight]);
        notifyBoundsChanged();
        scheduleLyricBoundsSave();
    });

    win.on("move", () => {
        notifyBoundsChanged();
    });

    win.webContents.on("did-finish-load", () => {
        setLyricWindowLock(currentConfig.isLock);
        win.webContents.send(CH.evConfigChanged, currentConfig);
    });

    return win;
}

export function createSettingsWindow(): BrowserWindow {
    if (settingsWindow) {
        settingsWindow.show();
        settingsWindow.focus();
        return settingsWindow;
    }

    const win = new BrowserWindow({
        width: 520,
        height: 720,
        frame: false,
        transparent: true,
        resizable: false,
        alwaysOnTop: true,
        show: true,
        icon: path.join(__dirname, "..", "..", "public", "icons", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "local-window.js"),
            contextIsolation: true,
            nodeIntegration: false,
            partition: "persist:settings"
        }
    });
    settingsWindow = win;

    const settingsSession = win.webContents.session;
    // Electron 类型联合暂未收录 "local-fonts",运行时确有该权限,故经 string 比较
    settingsSession.setPermissionCheckHandler((_webContents, permission) => (permission as string) === "local-fonts");
    settingsSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        callback((permission as string) === "local-fonts");
    });

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
        win.loadURL(process.env.ELECTRON_RENDERER_URL + "/settings/index.html");
    } else {
        win.loadFile(path.join(__dirname, "..", "renderer", "settings", "index.html"));
    }

    win.on("closed", () => {
        settingsWindow = null;
    });

    return win;
}

export function moveLyricWindow(newX: number, newY: number): void {
    if (!lyricWindow) return;

    const finalX = Math.round(newX);
    const finalY = Math.round(newY);

    lyricWindow.setPosition(finalX, finalY);
    notifyBoundsChanged();
}

export function resizeLyricWindow(x: number, y: number, width: number, height: number): void {
    if (!lyricWindow) return;

    currentLyricWidth = Math.floor(width);
    currentLyricHeight = Math.floor(height);

    lyricWindow.setBounds({
        x: Math.floor(x),
        y: Math.floor(y),
        width: currentLyricWidth,
        height: currentLyricHeight
    });

    // Notify renderer of the updated size
    lyricWindow.webContents.send(CH.evWindowResized, [currentLyricWidth, currentLyricHeight]);
    notifyBoundsChanged();
}

export function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}

export function getLyricWindow(): BrowserWindow | null {
    return lyricWindow;
}

export function getSettingsWindow(): BrowserWindow | null {
    return settingsWindow;
}

export function isLyricWindowVisible(): boolean {
    return lyricWindowVisible;
}

export function toggleLyricWindowVisibility(): void {
    const win = lyricWindow ?? createLyricWindow();
    if (lyricWindowVisible) {
        win.hide();
    } else {
        win.show();
    }
}

export function setQuitting(val: boolean): void {
    isQuiting = val;
}
