const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow = null;
let lyricWindow = null;
let tray = null;
let isQuiting = false;
let lyricWindowVisible = true;
let isShowTranslation = true;

// 歌词窗口的默认/当前期望尺寸
const DEFAULT_LYRIC_WIDTH = 1200;
const DEFAULT_LYRIC_HEIGHT = 150;
let currentLyricWidth = DEFAULT_LYRIC_WIDTH;
let currentLyricHeight = DEFAULT_LYRIC_HEIGHT;
let isResizing = false; // 用于标记是否是手动通过 resize-window 进行的尺寸调整

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

function getScreenWidth() {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayMatching({ x: cursor.x, y: cursor.y, width: 1, height: 1 });
    return display.bounds.width;
}


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

    // 使用默认宽高初始化
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

    lyricWindow.on('resize', () => {
        if (lyricWindow && !isResizing) {
            const [actualWidth, actualHeight] = lyricWindow.getSize();
            // 只有当实际尺寸与期望尺寸不一致时才进行恢复
            if (actualWidth !== currentLyricWidth || actualHeight !== currentLyricHeight) {
                // 使用 setSize 而非 setBounds，只设置大小
                lyricWindow.setSize(currentLyricWidth, currentLyricHeight);
                // console.log(`窗口尺寸被意外修改，已恢复到 W:${currentLyricWidth} H:${currentLyricHeight}`);
            }
        }
    });

    toggleLyricLock();
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

// 切换歌词锁定状态
function toggleLyricLock() {
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
            toggleLyricLock();
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
    if (!lyricWindow) return { x: 0, y: 0, width: DEFAULT_LYRIC_WIDTH, height: DEFAULT_LYRIC_HEIGHT };
    // 确保返回的bounds中使用当前期望的宽高，防止渲染进程获取到错误尺寸
    const bounds = lyricWindow.getBounds();
    return { ...bounds, width: currentLyricWidth, height: currentLyricHeight };
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

// IPC: 移动歌词窗口并限制在当前屏幕内
ipcMain.on('move-window', (event, newX, newY) => {
    if (!lyricWindow) return;

    const currentWidth = currentLyricWidth;
    const currentHeight = currentLyricHeight;

    // 获取当前光标位置
    const cursorPoint = screen.getCursorScreenPoint();
    // 获取光标所在的显示器
    const display = screen.getDisplayMatching({ x: cursorPoint.x, y: cursorPoint.y, width: 1, height: 1 });

    const { x, y, width, height } = display.bounds;

    // 限制窗口在当前显示器内部移动
    let finalX = newX;
    let finalY = newY;

    // 限制左边界 (finalX 必须大于等于 display.bounds.x)
    finalX = Math.max(x, finalX);
    // 限制上边界 (finalY 必须大于等于 display.bounds.y)
    finalY = Math.max(y, finalY);

    // 限制右边界 (finalX + windowWidth 必须小于等于 display.bounds.x + display.bounds.width)
    finalX = Math.min(x + width - currentWidth, finalX);
    // 限制下边界 (finalY + windowHeight 必须小于等于 display.bounds.y + display.bounds.height)
    finalY = Math.min(y + height - currentHeight, finalY);

    // 3. 设置窗口新位置，同时指定宽高，避免拖动造成尺寸变化
    lyricWindow.setBounds({ x: finalX, y: finalY, width: currentWidth, height: currentHeight });
});

// 窗口拉伸/调整大小
ipcMain.on('resize-window', (event, x, y, width, height) => {
    if (lyricWindow) {
        // 标记为手动调整，防止 resize 监听器触发恢复逻辑
        isResizing = true;

        // 更新期望的宽高
        currentLyricWidth = Math.floor(width);
        currentLyricHeight = Math.floor(height);

        // 设置新的位置和大小
        lyricWindow.setBounds({
            x: Math.floor(x),
            y: Math.floor(y),
            width: currentLyricWidth,
            height: currentLyricHeight // 使用更新后的宽高
        });

        // 重置标记，允许 resize 监听器在下次非手动调整时工作
        // 使用 setTimeout 确保 setBounds 执行完毕后才重置
        setTimeout(() => {
            isResizing = false;
        }, 100);
    }
});

// Electron 生命周期
app.whenReady().then(() => {
    createMainWindow();
    createLyricWindow();
    createTray();
});