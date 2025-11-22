const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow = null;
let lyricWindow = null;
let tray = null;
let isQuiting = false;
let lyricWindowVisible = false;
let isShowTranslation = true;

// 当前播放歌曲信息
let currentSong = {
    songName: '',
    songArtist: '',
    songMid: '',
    currentTime: 0,
    duration: 0,
    lyricText: '',
    lyricTrans: '',
    lyricData: [],
    coverUrl: '',
    coverTheme: {
        dark: {
            bg: '',
            mainBg: '',
            primary: '',
            shade: '',
            shadeTwo: ''
        },
        light: {
            bg: '',
            mainBg: '',
            primary: '',
            shade: '',
            shadeTwo: ''
        }
    },
    isPlaying: false
};

// 歌词配置
let lyricConfig = {
    isLock: false
};

// 格式化时间
function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// 创建主窗口
function createMainWindow() {
    if (mainWindow) return;

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: true,
        frame: false,
        title: "MeT-Music",
        // 使用 .png 作为开发模式下的图标
        icon: path.join(__dirname, "..", "public", "icons", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
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

    // 页面加载完成后注入 Hook、隐藏按钮和拖动区域
    mainWindow.webContents.on("did-finish-load", () => {
        const inject = `
    // === 注入 MeTMusic_Hook ===
    window.MeTMusic_Hook = function(data) {
      window.electronAPI.sendHookData(data);
    };

    // === 注入隐藏按钮 ===
    function injectCloseButton() {
      const target = document.querySelector('.main-nav > .right');
      if (target && !target.querySelector('.electron-hide-btn')) {
        const btn = document.createElement('div');
        btn.className = 'electron-hide-btn';
        btn.textContent = '×';
        btn.style.cssText = \`
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
        \`;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          window.electronAPI.hideWindow();
        });
        target.appendChild(btn);
      }
    }
    injectCloseButton();
  `;

        mainWindow.webContents.executeJavaScript(inject);
    });

}

// 创建桌面歌词窗口
function createLyricWindow() {
    if (lyricWindow) return;

    const { width } = screen.getPrimaryDisplay().workAreaSize;

    lyricWindow = new BrowserWindow({
        width: 800,
        height: 100,
        x: width - 620,
        y: 50,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        show: false,
        maximizable: false,
        icon: path.join(__dirname, "..", "public", "icons", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    lyricWindow.loadFile(path.join(__dirname, "..", "web", 'desktop-lyrics.html'));

    lyricWindow.on("closed", () => { lyricWindow = null; });

    // 监听窗口显示/隐藏状态变化
    lyricWindow.on('hide', () => { lyricWindowVisible = false; updateTrayMenu(); });
    lyricWindow.on('show', () => { lyricWindowVisible = true; updateTrayMenu(); });
}

// 创建系统托盘
function createTray() {
    let trayIconPath = path.join(__dirname, "..", "public", "icons", "tray", "tray.png");
    let trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
    
    tray = new Tray(trayIcon);
    updateTrayMenu();

    tray.on("click", () => {
        if (!mainWindow) createMainWindow();
        mainWindow.show();
        mainWindow.focus();
    });
}

// 更新托盘菜单
function updateTrayMenu() {
    if (!tray || tray.isDestroyed()) return;

    const template = [];

    if (currentSong.isPlaying) {
        template.push(
            { label: `🎵 歌曲: ${currentSong.songName}` },
            { label: `👤 歌手: ${currentSong.songArtist}` },
            { label: `⌛ 进度: ${formatTime(currentSong.currentTime)} / ${formatTime(currentSong.duration)}` },
            { type: 'separator' },
        );
    } else {
        template.push({ label: '未播放', enabled: false }, { type: 'separator' });
    }

    if (currentSong.isPlaying && currentSong.lyricText) template.push({ label: `💬 歌词: ${currentSong.lyricText}` });
    if (currentSong.isPlaying && currentSong.lyricTrans) template.push({ label: `📄 翻译: ${currentSong.lyricTrans}` });
    if (currentSong.isPlaying && currentSong.lyricText || currentSong.lyricTrans) template.push({ type: 'separator' });

    template.push({
        label: '显示桌面歌词',
        type: 'checkbox',
        checked: lyricWindowVisible,
        click: () => {
            if (!lyricWindow) createLyricWindow();
            lyricWindowVisible ? lyricWindow.hide() : lyricWindow.show();
            updateTrayMenu();
        }
    });

    template.push({
        label: '桌面歌词翻译',
        type: 'checkbox',
        checked: isShowTranslation,
        click: () => {
            isShowTranslation = !isShowTranslation;
            updateTrayMenu();
        }
    });

    template.push({
        label: '锁定歌词',
        type: 'checkbox',
        checked: lyricConfig.isLock,
        click: () => {
            if (!lyricWindow) createLyricWindow();
            const newLockState = !lyricConfig.isLock;
            // 更新主进程状态
            lyricConfig.isLock = newLockState;
            // 更新窗口穿透设置
            lyricWindow.setIgnoreMouseEvents(newLockState, { forward: true });
            // 通知渲染进程切换样式
            lyricWindow.webContents.send('toggle-desktop-lyric-lock-from-main', newLockState);
            // 更新托盘菜单
            updateTrayMenu();
        }
    });

    template.push({ type: 'separator' });
    template.push({ label: '退出', click: () => { isQuiting = true; app.quit(); } });

    tray.setContextMenu(Menu.buildFromTemplate(template));
}

// IPC 通信：接收前端 Hook 数据
ipcMain.on('metmusic-hook', (_event, data) => {
    if (isQuiting) return;
    
    currentSong = { ...currentSong, ...data };
    updateTrayMenu();

    // console.log('MeTMusic_Hook 数据：', data);

    // 更新桌面歌词窗口
    if (lyricWindow) {
        lyricWindow.webContents.send('play-song-change', `${data.songName} - ${data.songArtist}`);
        lyricWindow.webContents.send('play-lyric-change', { 
            lyricText: data.lyricText,
            lyricData: data.lyricData,
            lyricTrans: isShowTranslation ? data.lyricTrans : '', 
        });
        lyricWindow.webContents.send('play-status-change', data.isPlaying);
    }
});

// IPC：隐藏主窗口
ipcMain.on('hide-window', () => {
    mainWindow?.hide();
});

// IPC：获取屏幕和窗口信息
ipcMain.handle('get-screen-size', () => {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    return { width, height };
});
ipcMain.handle('get-window-bounds', () => {
    if (!lyricWindow) return { x: 0, y: 0, width: 400, height: 150 };
    return lyricWindow.getBounds();
});

// IPC：拖动窗口
ipcMain.on('move-window', (_event, x, y) => {
    if (lyricWindow) lyricWindow.setBounds({ ...lyricWindow.getBounds(), x, y });
});

// IPC：锁定/解锁歌词窗口
ipcMain.on('toggle-desktop-lyric-lock', (_event, isLock) => {
    if (!lyricWindow) return;
    // 更新主进程状态
    lyricConfig.isLock = isLock;
    // 设置穿透
    lyricWindow.setIgnoreMouseEvents(isLock, { forward: true });
    // 更新托盘菜单
    updateTrayMenu();
});

// IPC：隐藏歌词窗口
ipcMain.on('hide-desktop-lyric-window', (_event) => {
    if (!lyricWindow) return;
    lyricWindow.hide();
    // 更新托盘菜单
    updateTrayMenu();
});

// IPC: 获取是否显示翻译的初始状态 (供渲染进程使用)
ipcMain.handle('get-show-translation-state', () => {
    return isShowTranslation;
});

app.on("window-all-closed", () => { });
app.on("before-quit", () => {
    isQuiting = true;
    tray?.destroy();
});

// 监听来自主窗口的快捷操作
ipcMain.on('send-main-event', (_event, action) => {
    // 仅转发播放控制命令到主窗口
    if (mainWindow && ['play', 'pause', 'playPrev', 'playNext'].includes(action)) {
        mainWindow.webContents.executeJavaScript(`window.MeTMusic_Control('${action}');`);
    }
});


// Electron 生命周期
app.whenReady().then(() => {
    createMainWindow();
    createLyricWindow();
    createTray();
});