const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('./config');

let mainWindow = null;
let lyricWindow = null;
let settingsWindow = null;
let isQuiting = false;
let lyricWindowVisible = true;

const DEFAULT_LYRIC_WIDTH = 1200;
const DEFAULT_LYRIC_HEIGHT = 130;
let currentLyricWidth = DEFAULT_LYRIC_WIDTH;
let currentLyricHeight = DEFAULT_LYRIC_HEIGHT;
let isResizing = false;

function getScreenWidth() {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayMatching({ x: cursor.x, y: cursor.y, width: 1, height: 1 });
    return display.bounds.width;
}

function createMainWindow() {
    if (mainWindow) return mainWindow;
    let screenWidth = getScreenWidth();

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        x: (screenWidth - 1200) / 2,
        y: 80,
        show: true,
        frame: false,
        title: "MeT-Music",
        icon: path.join(__dirname, "..", "..", "public", "icons", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadURL("https://music.met6.top:444/app/");

    mainWindow.on("close", (e) => {
        if (!isQuiting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on("page-title-updated", (e) => {
        e.preventDefault();
        mainWindow.setTitle("MeT-MusicQ");
    });

    mainWindow.webContents.on("did-finish-load", () => {
        const inject = `
            // === 注入 MeTMusic_Hook ===
            window.$MeTMusic_Hook = function(data) {
                window.electronAPI.sendHookData(data);
            };

            // === 注入隐藏/设置按钮 ===
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
        `;
        mainWindow.webContents.executeJavaScript(inject);
    });

    return mainWindow;
}

function createLyricWindow() {
    if (lyricWindow) return lyricWindow;

    const currentConfig = config.getConfig();
    currentLyricWidth = getScreenWidth();
    currentLyricHeight = DEFAULT_LYRIC_HEIGHT;

    lyricWindow = new BrowserWindow({
        width: currentLyricWidth,
        height: currentLyricHeight,
        x: 0,
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        show: true,
        maximizable: false,
        icon: path.join(__dirname, "..", "..", "public", "icons", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    lyricWindow.loadFile(path.join(__dirname, "..", "renderer", "desktop-lyrics", "index.html"));

    lyricWindow.on("closed", () => { lyricWindow = null; });

    lyricWindow.on('hide', () => { lyricWindowVisible = false; });
    lyricWindow.on('show', () => { lyricWindowVisible = true; });

    lyricWindow.on('resize', () => {
        if (lyricWindow && !isResizing) {
            const [actualWidth, actualHeight] = lyricWindow.getSize();
            if (actualWidth !== currentLyricWidth || actualHeight !== currentLyricHeight) {
                lyricWindow.setSize(currentLyricWidth, currentLyricHeight);
            }
        }
    });

    lyricWindow.webContents.on("did-finish-load", () => {
        lyricWindow.setIgnoreMouseEvents(currentConfig.isLock, { forward: true });
        lyricWindow.webContents.send('lyric-config-changed', currentConfig);
    });

    return lyricWindow;
}

function createSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.show();
        settingsWindow.focus();
        return settingsWindow;
    }

    settingsWindow = new BrowserWindow({
        width: 500,
        height: 600,
        frame: false,
        transparent: true,
        resizable: false,
        alwaysOnTop: true,
        show: true,
        icon: path.join(__dirname, "..", "..", "public", "icons", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    settingsWindow.loadFile(path.join(__dirname, "..", "renderer", "settings", "index.html"));

    settingsWindow.on("closed", () => {
        settingsWindow = null;
    });

    return settingsWindow;
}

function moveLyricWindow(newX, newY) {
    if (!lyricWindow) return;

    const currentWidth = currentLyricWidth;
    const currentHeight = currentLyricHeight;

    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayMatching({ x: cursorPoint.x, y: cursorPoint.y, width: 1, height: 1 });
    const { x, y, width, height } = display.bounds;

    let finalX = newX;
    let finalY = newY;

    finalX = Math.max(x, finalX);
    finalY = Math.max(y, finalY);
    finalX = Math.min(x + width - currentWidth, finalX);
    finalY = Math.min(y + height - currentHeight, finalY);

    lyricWindow.setBounds({ x: finalX, y: finalY, width: currentWidth, height: currentHeight });
}

function resizeLyricWindow(x, y, width, height) {
    if (!lyricWindow) return;

    isResizing = true;
    currentLyricWidth = Math.floor(width);
    currentLyricHeight = Math.floor(height);

    lyricWindow.setBounds({
        x: Math.floor(x),
        y: Math.floor(y),
        width: currentLyricWidth,
        height: currentLyricHeight
    });

    // Notify renderer of the updated size
    lyricWindow.webContents.send('window-resized', currentLyricWidth, currentLyricHeight);

    setTimeout(() => {
        isResizing = false;
    }, 100);
}

module.exports = {
    createMainWindow,
    createLyricWindow,
    createSettingsWindow,
    getMainWindow: () => mainWindow,
    getLyricWindow: () => lyricWindow,
    getSettingsWindow: () => settingsWindow,
    isLyricWindowVisible: () => lyricWindowVisible,
    toggleLyricWindowVisibility: () => {
        if (!lyricWindow) createLyricWindow();
        if (lyricWindowVisible) {
            lyricWindow.hide();
        } else {
            lyricWindow.show();
        }
    },
    setQuitting: (val) => { isQuiting = val; },
    moveLyricWindow,
    resizeLyricWindow
};
