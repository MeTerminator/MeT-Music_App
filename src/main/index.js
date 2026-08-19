const { app, ipcMain, screen } = require('electron');
const config = require('./config');
const windowManager = require('./windowManager');
const trayManager = require('./trayManager');
const mediaManager = require('./mediaManager');

try {
    if (require('electron-squirrel-startup')) app.quit();
} catch (e) {
    // Ignore
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

mediaManager.setupAppIdentity();

let currentSong = {
    songName: '',
    songArtist: '',
    songMid: '',
    currentTime: 0,
    duration: 0,
    lyricText: '',
    lyricTrans: '',
    lyricData: [],
    isPlaying: false
};

const LYRIC_UPDATE_INTERVAL = 50;
let pendingLyricUpdate = null;
let lyricUpdateTimer = null;
let lastLyricUpdateTime = 0;
let lastSongLabel = '';
let lastPlayingState = null;

function flushLyricUpdate() {
    lyricUpdateTimer = null;
    if (!pendingLyricUpdate) return;

    const lyricWindow = windowManager.getLyricWindow();
    const lyricUpdate = pendingLyricUpdate;
    pendingLyricUpdate = null;
    lastLyricUpdateTime = Date.now();

    if (!lyricWindow || lyricWindow.isDestroyed() || !lyricWindow.isVisible()) return;

    const currentConfig = config.getConfig();
    lyricWindow.webContents.send('play-lyric-change', {
        lyricText: lyricUpdate.lyricText,
        lyricData: lyricUpdate.lyricData,
        lyricTrans: currentConfig.showTranslation ? lyricUpdate.lyricTrans : '',
        coverTheme: lyricUpdate.coverTheme
    });
}

function scheduleLyricUpdate(data) {
    pendingLyricUpdate = {
        lyricText: data.lyricText || '',
        lyricData: data.lyricData || [],
        lyricTrans: data.lyricTrans || '',
        coverTheme: data.coverTheme || null
    };

    if (lyricUpdateTimer) return;

    const elapsed = Date.now() - lastLyricUpdateTime;
    const delay = Math.max(0, LYRIC_UPDATE_INTERVAL - elapsed);
    lyricUpdateTimer = setTimeout(flushLyricUpdate, delay);
}

function setupIPC() {
    ipcMain.on('metmusic-hook', (_event, data) => {
        currentSong = { ...currentSong, ...data };
        const lyricWindow = windowManager.getLyricWindow();

        trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);
        mediaManager.update(currentSong);

        if (lyricWindow && !lyricWindow.isDestroyed()) {
            const songLabel = `${currentSong.songName} - ${currentSong.songArtist}`;
            if (songLabel !== lastSongLabel) {
                lastSongLabel = songLabel;
                lyricWindow.webContents.send('play-song-change', songLabel);
            }

            if (currentSong.isPlaying !== lastPlayingState) {
                lastPlayingState = currentSong.isPlaying;
                lyricWindow.webContents.send('play-status-change', currentSong.isPlaying);
            }

            scheduleLyricUpdate(currentSong);
        }
    });

    ipcMain.on('hide-window', () => {
        windowManager.getMainWindow()?.hide();
    });

    ipcMain.on('show-window', () => {
        windowManager.getMainWindow()?.show();
    });

    ipcMain.handle('get-screen-size', () => {
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        return { width, height };
    });

    ipcMain.handle('get-window-bounds', () => {
        const lyricWindow = windowManager.getLyricWindow();
        if (!lyricWindow) return { x: 0, y: 0, width: 1200, height: 130 };
        return lyricWindow.getBounds();
    });

    ipcMain.handle('get-window-system', () => ({
        isWayland: windowManager.isWaylandSession()
    }));

    ipcMain.on('toggle-desktop-lyric-lock', (_event, isLock) => {
        const currentConfig = config.getConfig();
        currentConfig.isLock = isLock;
        config.saveConfig(currentConfig);

        windowManager.setLyricWindowLock(isLock);
        trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);
    });

    ipcMain.on('hide-desktop-lyric-window', () => {
        windowManager.toggleLyricWindowVisibility();
        trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);
    });

    ipcMain.on('move-window', (event, newX, newY) => {
        windowManager.moveLyricWindow(newX, newY);
    });

    ipcMain.on('update-lyric-position', (event, newX, newY) => {
        windowManager.moveLyricWindow(newX, newY);
        const currentConfig = config.getConfig();
        currentConfig.windowX = newX;
        currentConfig.windowY = newY;
        config.saveConfig(currentConfig);
    });

    ipcMain.on('resize-window', (event, x, y, width, height) => {
        windowManager.resizeLyricWindow(x, y, width, height);
    });

    ipcMain.on('save-lyric-window-bounds', (_event, bounds) => {
        const currentConfig = config.getConfig();
        currentConfig.windowX = bounds.x;
        currentConfig.windowY = bounds.y;
        currentConfig.windowWidth = bounds.width;
        currentConfig.windowHeight = bounds.height;
        config.saveConfig(currentConfig);
    });

    ipcMain.on('reset-lyric-window-position', () => {
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
    });

    ipcMain.handle('get-lyric-config', () => {
        return config.getConfig();
    });

    ipcMain.on('update-lyric-config', (event, newConfig) => {
        config.saveConfig(newConfig);

        const lyricWindow = windowManager.getLyricWindow();
        if (lyricWindow) {
            windowManager.setLyricWindowLock(newConfig.isLock);
            lyricWindow.webContents.send('lyric-config-changed', newConfig);
        }

        trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);
    });

    ipcMain.on('open-settings', () => {
        windowManager.createSettingsWindow();
    });

    ipcMain.on('close-settings-window', () => {
        windowManager.getSettingsWindow()?.close();
    });

    ipcMain.on('play-prev', () => { playPrev(); });
    ipcMain.on('play-next', () => { playNext(); });
    ipcMain.on('play-or-pause', () => { playOrPause(); });
}

function runPlayerCommand(name) {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents
        .executeJavaScript(`typeof window.${name} === "function" && window.${name}();`)
        .catch(() => {});
}

function playPrev() {
    runPlayerCommand('$MeTMusic_prev');
}

function playNext() {
    runPlayerCommand('$MeTMusic_next');
}

function playOrPause() {
    runPlayerCommand('$MeTMusic_playOrPause');
}

function showMainWindow() {
    const mainWindow = windowManager.getMainWindow() || windowManager.createMainWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

app.on('second-instance', showMainWindow);

// macOS emits activate when the user clicks the running app's Dock icon.
app.on('activate', showMainWindow);

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
});
