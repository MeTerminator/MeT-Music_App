const { app, ipcMain, screen } = require('electron');
const config = require('./config');
const windowManager = require('./windowManager');
const trayManager = require('./trayManager');

try {
    if (require('electron-squirrel-startup')) app.quit();
} catch (e) {
    // Ignore
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

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

function setupIPC() {
    ipcMain.on('metmusic-hook', (_event, data) => {
        currentSong = { ...currentSong, ...data };

        const currentConfig = config.getConfig();
        const lyricWindow = windowManager.getLyricWindow();

        trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);

        if (lyricWindow) {
            lyricWindow.webContents.send('play-song-change', `${data.songName} - ${data.songArtist}`);
            lyricWindow.webContents.send('play-lyric-change', {
                lyricText: data.lyricText,
                lyricData: data.lyricData,
                lyricTrans: currentConfig.showTranslation ? data.lyricTrans : '',
                coverTheme: data.coverTheme
            });
            lyricWindow.webContents.send('play-status-change', data.isPlaying);
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

    ipcMain.on('toggle-desktop-lyric-lock', (_event, isLock) => {
        const currentConfig = config.getConfig();
        currentConfig.isLock = isLock;
        config.saveConfig(currentConfig);

        const lyricWindow = windowManager.getLyricWindow();
        lyricWindow?.setIgnoreMouseEvents(isLock, { forward: true });

        trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);
    });

    ipcMain.on('hide-desktop-lyric-window', () => {
        windowManager.toggleLyricWindowVisibility();
        trayManager.updateTrayMenu(currentSong, playPrev, playNext, playOrPause);
    });

    ipcMain.on('move-window', (event, newX, newY) => {
        windowManager.moveLyricWindow(newX, newY);
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
            lyricWindow.setIgnoreMouseEvents(newConfig.isLock, { forward: true });
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

function playPrev() {
    windowManager.getMainWindow()?.webContents.executeJavaScript(`window.$MeTMusic_prev();`);
}

function playNext() {
    windowManager.getMainWindow()?.webContents.executeJavaScript(`window.$MeTMusic_next();`);
}

function playOrPause() {
    windowManager.getMainWindow()?.webContents.executeJavaScript(`window.$MeTMusic_playOrPause();`);
}

app.on('second-instance', () => {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on("window-all-closed", () => {
    // Remain running in background (tray icon handles quit)
});

app.on("before-quit", () => {
    windowManager.setQuitting(true);
    trayManager.destroyTray();
});

app.whenReady().then(() => {
    config.loadConfig();
    windowManager.createMainWindow();
    windowManager.createLyricWindow();
    trayManager.createTray(playPrev, playNext, playOrPause);
    setupIPC();
});
