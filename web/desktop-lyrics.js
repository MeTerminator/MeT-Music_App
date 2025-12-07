class LyricsWindow {
    constructor() {
        this.lyricTextDom = document.getElementById("lyric-text");
        this.lyricTranDom = document.getElementById("lyric-tran");
        // 窗口移动拖拽状态
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.startWinX = 0;
        this.startWinY = 0;
        this.winWidth = 0;
        this.winHeight = 0;
        // 窗口拉伸状态
        this.isResizing = false;
        this.resizeDirection = "";

        this.menuClick();
        this.setupIPCListeners();

        // 窗口移动事件监听（从 drag-area 元素触发）
        document.querySelector(".drag-area").addEventListener("mousedown", this.startDrag.bind(this));

        // 窗口拉伸事件监听（从 resize-handle 元素触发）
        this.setupWindowResizeListeners();

        // 全局的 move/up 监听
        document.addEventListener("mousemove", this.handleMove.bind(this));
        document.addEventListener("mouseup", this.endInteraction.bind(this));

        this.initLockState();
    }

    updateLyrics(lyricText = "", translation = "", lyricData = null) {
        const lineDom = this.lyricTextDom;

        // console.log("updateLyrics", lyricText, translation, lyricData);

        // 空歌词
        if (!lyricData || lyricData.length === 0) {
            lineDom.textContent = lyricText;
            lineDom.className = "";
            this.lyricTranDom.textContent = translation;
            return;
        }

        let lineHtml = "";
        for (let i = 0; i < lyricData.length; i++) {
            const { content } = lyricData[i];
            lineHtml += `<span data-item="${i}" class="ktv-word">${content}</span>`;
        }

        let percent = 0;
        let isNewLine = false;

        if (lyricData && lyricData.length > 0) {
            // 获取 lyric-text 元素的宽度
            let lineWidth = lineDom.offsetWidth;
            // 获取每个 span 元素的宽度
            let spans = lineDom.querySelectorAll(".ktv-word");
            if (spans.length !== lyricData.length) percent = 0;
            else {
                // 计算歌词宽度占比
                let spanWidths = Array.from(spans).map(span => span.offsetWidth);
                let spanWidthsPercent = spanWidths.map(width => width / lineWidth);
                for (let i = 0; i < spanWidthsPercent.length; i++) {
                    percent += spanWidthsPercent[i] * lyricData[i].percent;
                }
            }
        }

        // 限制范围
        percent = Math.max(0, Math.min(1, percent));
        if (percent <= 0) {
            isNewLine = true;
        }

        // 计算目标位置 (0% 是全亮，100% 是全暗)
        const targetPos = Math.max(0, (1 - percent) * 100).toFixed(2) + "%";
        if (isNewLine) {
            // 彻底禁用动画
            lineDom.style.transition = "none";

            // 更新歌词内容和设置初始位置 (100% 全暗)
            lineDom.innerHTML = lineHtml;
            lineDom.className = "ktv-line";

            // 确保新行开始时，背景位置是 100%（全暗），为下一步的无动画更新做准备
            lineDom.style.backgroundPositionX = `100%`;

            void lineDom.offsetHeight; // 读取 offsetHeight 来强制回流
        }

        // --- 设置整行遮罩进度 ---

        // 恢复动画
        if (!isNewLine) {
            lineDom.style.transition = "background-position-x 0.25s linear";
        }

        // 设置目标位置
        lineDom.style.backgroundPositionX = targetPos;

        // 为新行在下一帧启用动画
        // 如果是新行，必须在当前帧的位置更新完成后，在下一帧恢复动画，否则后续进度不会动。
        if (isNewLine) {
            setTimeout(() => {
                lineDom.style.transition = "background-position-x 0.25s linear";
            }, 0);
        }

        // 更新歌词和翻译
        if (lineDom.innerHTML !== lineHtml) lineDom.innerHTML = lineHtml;
        this.lyricTranDom.innerHTML = translation;
    }


    // 初始化锁定状态
    async initLockState() {
        document.body.classList.toggle("lock-lyric", false);
    }

    menuClick() {
        const toolsDom = document.getElementById("tools");
        if (!toolsDom) return;
        toolsDom.addEventListener("click", async (event) => {
            // 确保点击事件发生在可交互的按钮上
            const target = event.target.closest(".item");
            if (!target) return;
            const id = target.id;
            if (!id) return;

            switch (id) {
                case "show-app":
                    // 通知主进程显示主窗口
                    window.electron.ipcRenderer.send("show-window");
                    break;
                case "play-prev":
                    window.electron.ipcRenderer.send("play-prev");
                    break;
                case "play-next":
                    window.electron.ipcRenderer.send("play-next");
                    break;
                case "play":
                case "pause":
                    window.electron.ipcRenderer.send("play-or-pause");
                    break;
                case "close-lyric":
                    // 通知主进程隐藏窗口
                    window.electron.ipcRenderer.send("hide-desktop-lyric-window");
                    break;
                case "lock-lyric":
                    // 切换锁定状态，并通知主进程
                    const newLockState = !document.body.classList.contains("lock-lyric");
                    document.body.classList.toggle("lock-lyric", newLockState);
                    window.electron.ipcRenderer.send("toggle-desktop-lyric-lock", newLockState);
                    break;
            }
        });
    }

    setupIPCListeners() {
        // 更新歌曲信息
        window.electron.ipcRenderer.on("play-song-change", (_, title) => {
            if (!title) return;
            const [songName, songArtist] = title.split(" - ");
            // console.log(`Now playing: ${songName} by ${songArtist}`);
        });

        // 更新歌词
        window.electron.ipcRenderer.on("play-lyric-change", (_, data) => {
            if (!data) return;
            const { lyricText, lyricTrans, lyricData } = data;

            if (!lyricText || lyricText.length === 0) {
                this.updateLyrics("该歌曲暂无歌词", "", null);
                return;
            }

            this.updateLyrics(lyricText, lyricTrans || "", lyricData);
        });

        // 锁定状态变化
        window.electron.ipcRenderer.on("toggle-desktop-lyric-lock-from-main", (_, lock) => {
            document.body.classList.toggle("lock-lyric", lock);
        });

        // 是否播放
        window.electron.ipcRenderer.on("play-status-change", (_, isPlaying) => {
            if (!isPlaying) {
                // 暂停时，body 变透明
                document.body.style.opacity = "0.3";
                document.getElementById("play").classList.remove("hidden");
                document.getElementById("pause").classList.add("hidden");
            } else {
                // 播放时，body 恢复不透明
                document.body.style.opacity = "1";
                document.getElementById("play").classList.add("hidden");
                document.getElementById("pause").classList.remove("hidden");
            }
        });
    }

    /* ---------------------------------------------------- */
    /* 窗口移动逻辑 */
    /* ---------------------------------------------------- */

    async startDrag(event) {
        // 确保只有在非锁定状态下才能拖拽
        if (document.body.classList.contains("lock-lyric")) return;

        // 避免点击工具按钮时触发拖拽
        if (event.target.closest(".item")) return;

        this.isDragging = true;
        document.body.classList.add("is-dragging"); // 添加类用于光标改变

        const { screenX, screenY } = event;
        const { x: winX, y: winY, width, height } = await window.electron.ipcRenderer.invoke("get-window-bounds");

        this.startX = screenX;
        this.startY = screenY;
        this.startWinX = winX;
        this.startWinY = winY;
        this.winWidth = width;
        this.winHeight = height;
    }

    dragWindow(event) {
        if (!this.isDragging) return;
        const { screenX, screenY } = event;

        // 1. 计算偏移量
        const deltaX = screenX - this.startX;
        const deltaY = screenY - this.startY;

        // 2. 计算新的绝对位置
        let newWinX = this.startWinX + deltaX;
        let newWinY = this.startWinY + deltaY;

        // 3. 将新的绝对位置发送给主进程。
        window.electron.ipcRenderer.send("move-window", newWinX, newWinY);
    }

    /* ---------------------------------------------------- */
    /* 窗口拉伸逻辑 */
    /* ---------------------------------------------------- */

    setupWindowResizeListeners() {
        document.querySelectorAll(".resize-handle").forEach(handle => {
            handle.addEventListener("mousedown", this.startResize.bind(this));
        });
    }

    async startResize(event) {
        // 确保只有在非锁定状态下才能拉伸
        if (document.body.classList.contains("lock-lyric")) return;

        // 阻止事件传播，避免同时触发拖拽
        event.stopPropagation();

        this.isResizing = true;
        this.resizeDirection = event.currentTarget.dataset.direction;

        const { screenX, screenY } = event;
        const { x: winX, y: winY, width, height } = await window.electron.ipcRenderer.invoke("get-window-bounds");

        this.startX = screenX;
        this.startY = screenY;
        this.startWinX = winX;
        this.startWinY = winY;
        this.winWidth = width;
        this.winHeight = height;
    }

    resizeWindow(event) {
        if (!this.isResizing) return;
        const { screenX, screenY } = event;
        const deltaX = screenX - this.startX;
        const deltaY = screenY - this.startY;

        let newWinX = this.startWinX;
        let newWinY = this.startWinY;
        let newWidth = this.winWidth;
        let newHeight = this.winHeight;

        const direction = this.resizeDirection;

        // 计算Y轴 (上/下)
        if (direction.includes("top")) {
            newWinY = this.startWinY + deltaY;
            newHeight = this.winHeight - deltaY;
        } else if (direction.includes("bottom")) {
            newHeight = this.winHeight + deltaY;
        }

        // 计算X轴 (左/右)
        if (direction.includes("left")) {
            newWinX = this.startWinX + deltaX;
            newWidth = this.winWidth - deltaX;
        } else if (direction.includes("right")) {
            newWidth = this.winWidth + deltaX;
        }

        // 最小尺寸检查 (防止拉伸过小)
        const minWidth = 100;
        const minHeight = 50;

        if (newWidth < minWidth) {
            // 如果从左边拉伸，需要修正 x 坐标以保持窗口右边缘不动
            if (direction.includes("left")) {
                newWinX = this.startWinX + (this.winWidth - minWidth);
            }
            newWidth = minWidth;
        }

        if (newHeight < minHeight) {
            // 如果从上边拉伸，需要修正 y 坐标以保持窗口下边缘不动
            if (direction.includes("top")) {
                newWinY = this.startWinY + (this.winHeight - minHeight);
            }
            newHeight = minHeight;
        }


        // 4. 将新的位置和大小发送给主进程。
        window.electron.ipcRenderer.send("resize-window", Math.floor(newWinX), Math.floor(newWinY), Math.floor(newWidth), Math.floor(newHeight));
    }

    /* ---------------------------------------------------- */
    /* 通用事件处理 */
    /* ---------------------------------------------------- */

    handleMove(event) {
        if (this.isDragging) {
            this.dragWindow(event);
        } else if (this.isResizing) {
            this.resizeWindow(event);
        }
    }

    endInteraction() {
        this.isDragging = false;
        this.isResizing = false;
        this.resizeDirection = "";
        document.body.classList.remove("is-dragging");
    }
}

new LyricsWindow();