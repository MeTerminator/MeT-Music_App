const { createApp, ref, computed, onMounted, onUnmounted, nextTick, watchEffect } = Vue;

createApp({
    setup() {
        const lyricText = ref('MeT-Music');
        const lyricTrans = ref('');
        const lyricData = ref([]);
        const isPlaying = ref(false);
        const isDragging = ref(false);
        const isResizing = ref(false);

        const config = ref({
            fontSize: 36,
            transFontSize: 18,
            textColor: '#ffffff',
            colorActive: '#ffffff',
            colorInactive: 'rgba(255, 255, 255, 0.3)',
            showTranslation: true,
            isLock: false,
            bgColor: 'rgba(0, 0, 0, 0.2)',
            bgBlur: 10,
            useThemeColorForActive: true,
            textOpacity: 100,
            strokeWidth: 1,
            strokeColor: '#000000',
            overallOpacity: 90,
            transFontSizeScale: 23,
            pausedOpacity: 30
        });

        const hexToRgba = (hex, opacityPercent) => {
            if (!hex) return 'rgba(255, 255, 255, 1)';
            const cleanHex = hex.replace('#', '');
            const r = parseInt(cleanHex.substring(0, 2), 16);
            const g = parseInt(cleanHex.substring(2, 4), 16);
            const b = parseInt(cleanHex.substring(4, 6), 16);
            const alpha = (opacityPercent / 100).toFixed(2);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        const coverTheme = ref(null);

        const activeColor = computed(() => {
            if (config.value.useThemeColorForActive) {
                if (coverTheme.value?.light?.shadeTwo) {
                    return `rgba(${coverTheme.value.light.shadeTwo}, 0.95)`;
                }
                return '#efefef95';
            }
            return config.value.colorActive;
        });

        // Elements
        const lineRef = ref(null);
        const containerRef = ref(null);
        const mainRef = ref(null);

        // KTV states
        const ktvProgressPercent = ref(0);
        const translateX = ref(0);

        // The fixed overhead: #app padding (12px*2) + header tools (~20px)
        const LAYOUT_OVERHEAD = 44;
        const mainContentHeight = ref(Math.max(50, window.innerHeight - LAYOUT_OVERHEAD));


        // Drag/Resize values
        let startX = 0, startY = 0;
        let startWinX = 0, startWinY = 0;
        let winWidth = 0, winHeight = 0;
        let resizeDirection = "";

        const resizeDirs = ["top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"];

        // Automatically scale font sizes based on main content area height
        const computedFontSize = computed(() => {
            const H = mainContentHeight.value;
            if (config.value.showTranslation && lyricTrans.value) {
                // With translation: lyric takes ~65%, translation takes ~35%
                return Math.max(16, Math.floor(H * 0.55));
            } else {
                // No translation: lyric fills entire area
                return Math.max(20, Math.floor(H * 0.75));
            }
        });

        const computedTransFontSize = computed(() => {
            const H = mainContentHeight.value;
            const scale = (config.value.transFontSizeScale !== undefined ? config.value.transFontSizeScale : 23) / 100;
            return Math.max(12, Math.floor(H * scale));
        });

        // Imperatively apply styles and classes to #app element.
        // Vue 3 does NOT process directives on the mount element itself,
        // so :style and :class on <div id="app"> are ignored.
        const appEl = document.getElementById('app');
        watchEffect(() => {
            if (!appEl) return;
            appEl.style.setProperty('--lyric-font-size', computedFontSize.value + 'px');
            appEl.style.setProperty('--trans-font-size', computedTransFontSize.value + 'px');
            appEl.style.setProperty('--main-color', hexToRgba(config.value.textColor, config.value.textOpacity));
            appEl.style.setProperty('--color-active', activeColor.value);
            appEl.style.setProperty('--color-inactive', config.value.colorInactive);
            appEl.style.setProperty('--lyric-stroke-width', config.value.strokeWidth + 'px');
            appEl.style.setProperty('--lyric-stroke-color', config.value.strokeColor);
            appEl.style.setProperty('--hover-bg-color', config.value.bgColor);
            appEl.style.setProperty('--hover-bg-blur', config.value.bgBlur + 'px');
            
            const baseOpacity = isPlaying.value ? 1 : ((config.value.pausedOpacity !== undefined ? config.value.pausedOpacity : 30) / 100);
            appEl.style.opacity = (baseOpacity * (config.value.overallOpacity || 100) / 100).toFixed(2);
            
            appEl.classList.toggle('lock-lyric', config.value.isLock);
            appEl.classList.toggle('is-dragging', isDragging.value);
        });

        const ktvStyle = computed(() => {
            const pos = Math.max(0, (1 - ktvProgressPercent.value) * 100).toFixed(2);
            return {
                backgroundPositionX: `${pos}%`,
                transform: `translateX(${translateX.value}px)`
            };
        });

        const plainStyle = computed(() => {
            return {
                transform: `translateX(${translateX.value}px)`
            };
        });

        // Action Handlers
        const showApp = () => window.electron.ipcRenderer.send("show-window");
        const playPrev = () => window.electron.ipcRenderer.send("play-prev");
        const playNext = () => window.electron.ipcRenderer.send("play-next");
        const playOrPause = () => window.electron.ipcRenderer.send("play-or-pause");
        const closeLyric = () => window.electron.ipcRenderer.send("hide-desktop-lyric-window");
        
        const toggleLock = () => {
            const newLock = !config.value.isLock;
            config.value.isLock = newLock;
            window.electron.ipcRenderer.send("toggle-desktop-lyric-lock", newLock);
        };

        // Window drag logic
        const startDrag = async (event) => {
            if (config.value.isLock) return;
            if (event.target.closest(".item")) return;

            isDragging.value = true;
            const { screenX, screenY } = event;
            const { x, y, width, height } = await window.electron.ipcRenderer.invoke("get-window-bounds");

            startX = screenX;
            startY = screenY;
            startWinX = x;
            startWinY = y;
            winWidth = width;
            winHeight = height;
        };

        // Window resize logic
        const startResize = async (event, dir) => {
            if (config.value.isLock) return;

            isResizing.value = true;
            resizeDirection = dir;

            const { screenX, screenY } = event;
            const { x, y, width, height } = await window.electron.ipcRenderer.invoke("get-window-bounds");

            startX = screenX;
            startY = screenY;
            startWinX = x;
            startWinY = y;
            winWidth = width;
            winHeight = height;
        };

        const handleMove = (event) => {
            if (isDragging.value) {
                const deltaX = event.screenX - startX;
                const deltaY = event.screenY - startY;
                window.electron.ipcRenderer.send("move-window", startWinX + deltaX, startWinY + deltaY);
            } else if (isResizing.value) {
                const deltaX = event.screenX - startX;
                const deltaY = event.screenY - startY;

                let newX = startWinX;
                let newY = startWinY;
                let newW = winWidth;
                let newH = winHeight;

                if (resizeDirection.includes("top")) {
                    newY = startWinY + deltaY;
                    newH = winHeight - deltaY;
                } else if (resizeDirection.includes("bottom")) {
                    newH = winHeight + deltaY;
                }

                if (resizeDirection.includes("left")) {
                    newX = startWinX + deltaX;
                    newW = winWidth - deltaX;
                } else if (resizeDirection.includes("right")) {
                    newW = winWidth + deltaX;
                }

                const minW = 100;
                const minH = 50;

                if (newW < minW) {
                    if (resizeDirection.includes("left")) {
                        newX = startWinX + (winWidth - minW);
                    }
                    newW = minW;
                }
                if (newH < minH) {
                    if (resizeDirection.includes("top")) {
                        newY = startWinY + (winHeight - minH);
                    }
                    newH = minH;
                }

                window.electron.ipcRenderer.send("resize-window", Math.floor(newX), Math.floor(newY), Math.floor(newW), Math.floor(newH));

                // Directly compute content height from known window height
                mainContentHeight.value = Math.max(50, newH - LAYOUT_OVERHEAD);
            }
        };

        const endInteraction = async () => {
            if (isDragging.value || isResizing.value) {
                isDragging.value = false;
                isResizing.value = false;
                resizeDirection = "";
                
                // Save lyric window bounds after drag/resize finishes
                const bounds = await window.electron.ipcRenderer.invoke("get-window-bounds");
                window.electron.ipcRenderer.send("save-lyric-window-bounds", bounds);
            } else {
                isDragging.value = false;
                isResizing.value = false;
                resizeDirection = "";
            }
        };

        // KTV Calculation
        const updateKtvProgress = () => {
            if (!lyricData.value || lyricData.value.length === 0) {
                ktvProgressPercent.value = 0;
                translateX.value = 0;
                return;
            }

            const lineDom = lineRef.value;
            if (!lineDom) return;

            let lineWidth = lineDom.offsetWidth;
            if (lineWidth === 0) lineWidth = 1;

            const spans = lineDom.querySelectorAll(".ktv-word");
            if (spans.length !== lyricData.value.length) return;

            let percent = 0;
            const spanWidths = Array.from(spans).map(span => span.offsetWidth);
            const spanWidthsPercent = spanWidths.map(w => w / lineWidth);

            for (let i = 0; i < spanWidthsPercent.length; i++) {
                percent += spanWidthsPercent[i] * (lyricData.value[i].percent || 0);
            }

            percent = Math.max(0, Math.min(1, percent));
            ktvProgressPercent.value = percent;

            // Scroll calculation
            const textWidth = lineDom.scrollWidth;
            const containerDom = containerRef.value;
            if (!containerDom) return;
            const containerWidth = containerDom.offsetWidth;

            if (textWidth > containerWidth) {
                const startLeft = (containerWidth - textWidth) / 2;
                let tx = textWidth * (0.5 - percent);
                const maxTranslate = -startLeft;
                const minTranslate = startLeft;

                if (tx > maxTranslate) tx = maxTranslate;
                if (tx < minTranslate) tx = minTranslate;

                translateX.value = tx;
            } else {
                translateX.value = 0;
            }
        };

        // IPC Listeners
        const setupIPC = async () => {
            const initialConfig = await window.electron.ipcRenderer.invoke("get-lyric-config");
            if (initialConfig) {
                config.value = { ...config.value, ...initialConfig };
            }

            window.electron.ipcRenderer.on("play-lyric-change", (_, data) => {
                if (!data) return;

                // Reset KTV progress synchronously when the lyric line changes to prevent backward transition
                if (data.lyricText !== lyricText.value) {
                    ktvProgressPercent.value = 0;
                    translateX.value = 0;
                }

                lyricText.value = data.lyricText || "";
                lyricTrans.value = data.lyricTrans || "";
                lyricData.value = data.lyricData || [];
                coverTheme.value = data.coverTheme || null;

                nextTick(() => {
                    updateKtvProgress();
                });
            });

            window.electron.ipcRenderer.on("play-status-change", (_, state) => {
                isPlaying.value = state;
            });

            window.electron.ipcRenderer.on("lyric-config-changed", (_, newConfig) => {
                if (newConfig) {
                    config.value = { ...config.value, ...newConfig };
                }
            });

            // Handle programmatic window resize events from the main process
            window.electron.ipcRenderer.on("window-resized", (_, w, h) => {
                mainContentHeight.value = Math.max(50, h - LAYOUT_OVERHEAD);
                nextTick(() => {
                    updateKtvProgress();
                });
            });
        };

        const handleWindowResize = () => {
            mainContentHeight.value = Math.max(50, window.innerHeight - LAYOUT_OVERHEAD);
            nextTick(() => {
                updateKtvProgress();
            });
        };

        onMounted(() => {
            window.addEventListener("mousemove", handleMove);
            window.addEventListener("mouseup", endInteraction);
            window.addEventListener("resize", handleWindowResize);
            setupIPC();
        });

        onUnmounted(() => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", endInteraction);
            window.removeEventListener("resize", handleWindowResize);
        });

        return {
            lyricText,
            lyricTrans,
            lyricData,
            isPlaying,
            isDragging,
            config,
            resizeDirs,
            ktvStyle,
            plainStyle,
            lineRef,
            containerRef,
            mainRef,
            showApp,
            playPrev,
            playNext,
            playOrPause,
            closeLyric,
            toggleLock,
            startDrag,
            startResize
        };
    }
}).mount('#app');
