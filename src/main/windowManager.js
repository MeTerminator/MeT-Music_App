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
let saveLyricBoundsTimer = null;

function isWaylandSession() {
    const ozoneArgument = process.argv.find(argument =>
        argument.startsWith('--ozone-platform=') ||
        argument.startsWith('--ozone-platform-hint=')
    );
    const explicitOzonePlatform = (
        ozoneArgument?.split('=')[1] ||
        process.env.ELECTRON_OZONE_PLATFORM_HINT ||
        process.env.OZONE_PLATFORM ||
        ''
    ).toLowerCase();

    if (explicitOzonePlatform === 'x11') return false;
    if (explicitOzonePlatform === 'wayland') return true;

    return process.platform === 'linux' && (
        Boolean(process.env.WAYLAND_DISPLAY) ||
        String(process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland'
    );
}

function scheduleLyricBoundsSave() {
    clearTimeout(saveLyricBoundsTimer);
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
            nodeIntegration: false,
            // Keep Media Session / audio alive after hide-to-tray.
            backgroundThrottling: false
        }
    });

    mainWindow.webContents.setBackgroundThrottling(false);
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

function setLyricWindowLock(isLock) {
    if (!lyricWindow) return;
    if (process.platform === 'darwin' || process.platform === 'win32') {
        lyricWindow.setIgnoreMouseEvents(isLock, { forward: true });
    } else {
        lyricWindow.setIgnoreMouseEvents(isLock);
    }
}

function notifyBoundsChanged() {
    if (settingsWindow && !settingsWindow.isDestroyed() && lyricWindow && !lyricWindow.isDestroyed()) {
        settingsWindow.webContents.send('lyric-bounds-changed', lyricWindow.getBounds());
    }
}

function createLyricWindow() {
    if (lyricWindow) return lyricWindow;

    const currentConfig = config.getConfig();
    currentLyricWidth = currentConfig.windowWidth || getScreenWidth();
    currentLyricHeight = currentConfig.windowHeight || DEFAULT_LYRIC_HEIGHT;
    
    const finalX = (currentConfig.windowX !== undefined && currentConfig.windowX !== null) ? currentConfig.windowX : 0;
    const finalY = (currentConfig.windowY !== undefined && currentConfig.windowY !== null) ? currentConfig.windowY : 0;

    const windowOptions = {
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
            preload: path.join(__dirname, "..", "preload", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    };

    lyricWindow = new BrowserWindow(windowOptions);

    lyricWindow.setAlwaysOnTop(true, 'screen-saver');

    if (lyricWindow.setVisibleOnAllWorkspaces) {
        lyricWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    lyricWindow.loadFile(path.join(__dirname, "..", "renderer", "desktop-lyrics", "index.html"));

    lyricWindow.on("closed", () => { lyricWindow = null; });

    lyricWindow.on('hide', () => { lyricWindowVisible = false; });
    lyricWindow.on('show', () => { lyricWindowVisible = true; });

    lyricWindow.on('resize', () => {
        if (!lyricWindow) return;

        // Native edge resizing is required on Wayland: the compositor, rather than
        // JavaScript, owns the interactive resize operation.
        [currentLyricWidth, currentLyricHeight] = lyricWindow.getSize();
        lyricWindow.webContents.send('window-resized', currentLyricWidth, currentLyricHeight);
        notifyBoundsChanged();
        scheduleLyricBoundsSave();
    });

    lyricWindow.on('move', () => {
        notifyBoundsChanged();
    });

    lyricWindow.webContents.on("did-finish-load", () => {
        setLyricWindowLock(currentConfig.isLock);
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
        width: 520,
        height: 720,
        frame: false,
        transparent: true,
        resizable: false,
        alwaysOnTop: true,
        show: true,
        icon: path.join(__dirname, "..", "..", "public", "icons", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            partition: 'persist:settings'
        }
    });

    const settingsSession = settingsWindow.webContents.session;
    settingsSession.setPermissionCheckHandler((_webContents, permission) => permission === 'local-fonts');
    settingsSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        callback(permission === 'local-fonts');
    });

    settingsWindow.loadFile(path.join(__dirname, "..", "renderer", "settings", "index.html"));

    settingsWindow.on("closed", () => {
        settingsWindow = null;
    });

    return settingsWindow;
}

function moveLyricWindow(newX, newY) {
    if (!lyricWindow) return;

    const finalX = Math.round(newX);
    const finalY = Math.round(newY);

    lyricWindow.setPosition(finalX, finalY);
    notifyBoundsChanged();
}

function resizeLyricWindow(x, y, width, height) {
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
    lyricWindow.webContents.send('window-resized', currentLyricWidth, currentLyricHeight);
    notifyBoundsChanged();
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
    resizeLyricWindow,
    setLyricWindowLock,
    isWaylandSession,
    getScreenWidth
};
