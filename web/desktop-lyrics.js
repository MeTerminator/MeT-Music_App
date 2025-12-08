class LyricsWindow {
    constructor() {
        this.lyricTextDom = document.getElementById("lyric-text");
        this.lyricTextContainerDom = document.getElementById("lyric-text-container");
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
        const containerDom = this.lyricTextContainerDom;

        // 1. 处理空歌词或无数据情况
        if (!lyricData || lyricData.length === 0) {
            lineDom.textContent = lyricText;
            lineDom.className = "";
            lineDom.style.transform = "translateX(0)";
            this.lyricTranDom.textContent = translation;
            return;
        }

        // 2. 构建歌词 HTML
        let lineHtml = "";
        for (let i = 0; i < lyricData.length; i++) {
            const { content } = lyricData[i];
            lineHtml += `<span data-item="${i}" class="ktv-word">${content}</span>`;
        }

        // 3. 计算当前进度百分比 (percent)
        let percent = 0;
        let isNewLine = false;

        if (lyricData && lyricData.length > 0) {
            let lineWidth = lineDom.offsetWidth;
            // 防御性检查：如果宽度为0（例如刚启动），设为1避免除零
            if (lineWidth === 0) lineWidth = 1;

            let spans = lineDom.querySelectorAll(".ktv-word");
            if (spans.length === lyricData.length) {
                let spanWidths = Array.from(spans).map(span => span.offsetWidth);
                let spanWidthsPercent = spanWidths.map(width => width / lineWidth);
                for (let i = 0; i < spanWidthsPercent.length; i++) {
                    percent += spanWidthsPercent[i] * lyricData[i].percent;
                }
            }
        }

        percent = Math.max(0, Math.min(1, percent));

        // 4. 判断是否换行
        if (lineDom.innerHTML !== lineHtml) {
            isNewLine = true;
        }

        // 5. 设置 KTV 染色进度 (Background Position)
        // 注意：background-position 100% 代表全暗(0进度)，0% 代表全亮(100进度)
        const targetBgPos = Math.max(0, (1 - percent) * 100).toFixed(2) + "%";

        // ==========================================
        // 基于进度的动态滚动计算
        // ==========================================

        // 只有换行或有进度时才计算，节省性能
        const textWidth = lineDom.scrollWidth;
        const containerWidth = containerDom.offsetWidth;

        // 只有当文字宽度大于容器宽度时，才需要滚动
        if (textWidth > containerWidth) {
            // A. 计算原本 Flex 居中时的默认左边距 (相对于容器左侧，通常是负数)
            // Flex Center 使得文本中心 = 容器中心
            // 所以文本左边缘位置 = (容器宽 - 文本宽) / 2
            const startLeft = (containerWidth - textWidth) / 2;

            // B. 计算为了让"当前进度点"居中，文本需要向左移动的距离 (Offset)
            // 目标：文本左边缘位置 + (文本宽 * percent) = 容器宽 / 2
            // 也就是：文本左边缘位置 = 容器宽 / 2 - (文本宽 * percent)
            // 我们通过 transform: translateX(delta) 来修正位置
            // delta = 目标左边缘 - 初始Flex左边缘
            // delta = [ContainerW/2 - TextW*p] - [(ContainerW - TextW)/2]
            // 化简后: delta = TextW * (0.5 - p)
            let translateX = textWidth * (0.5 - percent);

            // C. 边界限制 (Clamping)
            // 我们不希望文字滚得太远，导致左边或右边出现空白
            // 左边界限制：不能把开头滚到屏幕中间右侧去。最大 translateX 使得左边缘对齐容器左边缘。
            // 也就是 transform + startLeft <= 0 -> transform <= -startLeft
            const maxTranslate = -startLeft; // 向右最大移动距离
            const minTranslate = startLeft;  // 向左最大移动距离

            // 应用限制
            if (translateX > maxTranslate) translateX = maxTranslate;
            if (translateX < minTranslate) translateX = minTranslate;

            // 应用变换
            if (isNewLine) {
                // 换行瞬间取消动画，直接跳到新位置
                lineDom.style.transition = "none";
                lineDom.style.transform = `translateX(${translateX}px)`;
            } else {
                // 播放过程中恢复平滑过渡
                // 注意：这里的时间要和 updateLyrics 的调用频率配合，通常 0.1s~0.2s 比较自然
                lineDom.style.transition = "background-position-x 0.2s linear, transform 0.2s linear";
                lineDom.style.transform = `translateX(${translateX}px)`;
            }

        } else {
            // 没有溢出，复位
            lineDom.style.transform = "translateX(0)";
        }

        // ==========================================

        if (isNewLine) {
            // 换行处理：先隐藏动画效果
            lineDom.style.transition = "none";

            // 换行处理：重置内容和样式
            lineDom.innerHTML = lineHtml;
            lineDom.className = "ktv-line";

            // 初始染色状态：全暗
            lineDom.style.backgroundPositionX = `100%`;

            // 强制回流
            void lineDom.offsetHeight;

            // 下一帧恢复动画
            setTimeout(() => {
                lineDom.style.transition = "background-position-x 0.25s linear, transform 0.25s linear";
            }, 20);
        } else {
            lineDom.style.backgroundPositionX = targetBgPos;
        }

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
                this.updateLyrics("", "", null);
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