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

function updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause) {
    if (!tray || tray.isDestroyed()) return;

    const currentConfig = config.getConfig();
    const lyricVisible = windowManager.isLyricWindowVisible();

    const template = [];

    if (currentSong && currentSong.isPlaying) {
        template.push(
            { label: `🎵 歌曲: ${currentSong.songName}` },
            { label: `👤 歌手: ${currentSong.songArtist}` },
            { label: `⌛ 进度: ${formatTime(currentSong.currentTime)} / ${formatTime(currentSong.duration)}` },
            { type: 'separator' },
        );
    } else {
        template.push({ label: '未播放', enabled: false }, { type: 'separator' });
    }

    if (currentSong && currentSong.isPlaying && currentSong.lyricText) {
        template.push({ label: `💬 歌词: ${currentSong.lyricText}` });
    }
    if (currentSong && currentSong.isPlaying && currentSong.lyricTrans && currentConfig.showTranslation) {
        template.push({ label: `📄 翻译: ${currentSong.lyricTrans}` });
    }
    if (currentSong && currentSong.isPlaying && (currentSong.lyricText || (currentSong.lyricTrans && currentConfig.showTranslation))) {
        template.push({ type: 'separator' });
    }

    template.push({
        label: '⏮ 上一首',
        click: () => {
            onPlayPrev();
        }
    });

    template.push({
        label: (currentSong && currentSong.isPlaying) ? '⏸ 暂停' : '▶ 播放',
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
        checked: lyricVisible,
        click: () => {
            windowManager.toggleLyricWindowVisibility();
            updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause);
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
            updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause);
        }
    });

    template.push({
        label: '锁定歌词',
        type: 'checkbox',
        checked: currentConfig.isLock,
        click: () => {
            currentConfig.isLock = !currentConfig.isLock;
            config.saveConfig(currentConfig);
            const lyricWindow = windowManager.getLyricWindow();
            if (lyricWindow) {
                lyricWindow.setIgnoreMouseEvents(currentConfig.isLock, { forward: true });
                lyricWindow.webContents.send('lyric-config-changed', currentConfig);
            }
            updateTrayMenu(currentSong, onPlayPrev, onPlayNext, onPlayOrPause);
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

function formatTime(seconds) {
    if (!seconds) return '00:00';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function destroyTray() {
    tray?.destroy();
}

module.exports = {
    createTray,
    updateTrayMenu,
    destroyTray
};
