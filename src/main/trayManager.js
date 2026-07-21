const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const config = require('./config');
const windowManager = require('./windowManager');

let tray = null;

function createTray(onPlayPrev, onPlayNext, onPlayOrPause) {
    let trayIconPath = path.join(__dirname, "..", "..", "public", "icons", "tray", "tray.png");
    let trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });

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
        songName: '',
        songArtist: '',
        currentTime: 0,
        duration: 0,
        lyricText: '',
        lyricTrans: '',
        isPlaying: false
    }, onPlayPrev, onPlayNext, onPlayOrPause);
}

let lastTrayState = null;

function updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause, force = false) {
    if (!tray || tray.isDestroyed()) return;

    const currentConfig = config.getConfig();
    const lyricVisible = windowManager.isLyricWindowVisible();

    const currentState = {
        songName: (currentSong && currentSong.songName) || '',
        songArtist: (currentSong && currentSong.songArtist) || '',
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

    const template = [];

    if (currentState.isPlaying) {
        template.push(
            { label: `🎵 歌曲: ${currentState.songName}` },
            { label: `👤 歌手: ${currentState.songArtist}` },
            { type: 'separator' }
        );
    } else {
        template.push({ label: '未播放', enabled: false }, { type: 'separator' });
    }

    template.push({
        label: '⏮ 上一首',
        click: () => {
            onPlayPrev();
        }
    });

    template.push({
        label: currentState.isPlaying ? '⏸ 暂停' : '▶ 播放',
        click: () => {
            onPlayOrPause();
        }
    });

    template.push({
        label: '⏭ 下一首',
        click: () => {
            onPlayNext();
        }
    });

    template.push({ type: 'separator' });

    template.push({
        label: '显示桌面歌词',
        type: 'checkbox',
        checked: currentState.lyricVisible,
        click: () => {
            windowManager.toggleLyricWindowVisibility();
            updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause, true);
        }
    });

    template.push({
        label: '桌面歌词翻译',
        type: 'checkbox',
        checked: currentConfig.showTranslation,
        click: () => {
            currentConfig.showTranslation = !currentConfig.showTranslation;
            config.saveConfig(currentConfig);
            const lyricWindow = windowManager.getLyricWindow();
            if (lyricWindow) {
                lyricWindow.webContents.send('lyric-config-changed', currentConfig);
            }
            updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause, true);
        }
    });

    template.push({
        label: '锁定歌词',
        type: 'checkbox',
        checked: currentConfig.isLock,
        click: () => {
            currentConfig.isLock = !currentConfig.isLock;
            config.saveConfig(currentConfig);
            windowManager.setLyricWindowLock(currentConfig.isLock);
            const lyricWindow = windowManager.getLyricWindow();
            if (lyricWindow) {
                lyricWindow.webContents.send('lyric-config-changed', currentConfig);
            }
            updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause, true);
        }
    });

    template.push({ type: 'separator' });
    template.push({
        label: '打开主界面',
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
        label: '打开设置',
        click: () => {
            windowManager.createSettingsWindow();
        }
    });
    template.push({ type: 'separator' });
    template.push({
        label: '退出',
        click: () => {
            windowManager.setQuitting(true);
            app.quit();
        }
    });

    tray.setContextMenu(Menu.buildFromTemplate(template));
}

function destroyTray() {
    tray?.destroy();
}

module.exports = {
    createTray,
    updateTrayMenu,
    destroyTray
};
