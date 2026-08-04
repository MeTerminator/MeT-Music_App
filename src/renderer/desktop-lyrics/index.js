const { createApp, ref, computed, onMounted, onUnmounted, nextTick, watchEffect } = Vue;

createApp({
    setup() {
        const lyricText = ref('MeT-Music');
        const lyricTrans = ref('');
        const lyricData = ref([]);
        const lyricLineKey = ref(0);
        const isPlaying = ref(false);
        const isDragging = ref(false);
        const isResizing = ref(false);

        const config = ref({
            fontSize: 36,
            transFontSize: 18,
            lyricFontFamily: '',
            translationFontFamily: '',
            lyricFontWeight: 700,
            translationFontWeight: 400,
            textColor: '#ffffff',
            colorActive: '#ffffff',
            colorInactive: 'rgba(255, 255, 255, 0.3)',
            showTranslation: true,
            isLock: false,
            bgColor: 'rgba(0, 0, 0, 0.2)',
            bgBlur: 10,
            useThemeColorForActive: true,
            textOpacity: 100,
            strokeWidth: 0,
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
        let latestLyricData = [];
        let currentLineSignature = '';
        let currentThemeSignature = '';
        let ktvLayoutMetrics = null;
        let ktvAnimationFrame = null;
        let layoutStyleSignature = '';

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
            const lyricFontFamily = config.value.lyricFontFamily?.trim() || 'inherit';
            const lyricFontWeight = String(config.value.lyricFontWeight ?? 700);
            appEl.style.setProperty('--lyric-font-size', computedFontSize.value + 'px');
            appEl.style.setProperty('--trans-font-size', computedTransFontSize.value + 'px');
            appEl.style.setProperty('--lyric-font-family', lyricFontFamily);
            appEl.style.setProperty('--translation-font-family', config.value.translationFontFamily?.trim() || 'inherit');
            appEl.style.setProperty('--lyric-font-weight', lyricFontWeight);
            appEl.style.setProperty('--translation-font-weight', String(config.value.translationFontWeight ?? 400));
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

            const nextLayoutStyleSignature = `${computedFontSize.value}|${lyricFontFamily}|${lyricFontWeight}`;
            if (nextLayoutStyleSignature !== layoutStyleSignature) {
                layoutStyleSignature = nextLayoutStyleSignature;
                ktvLayoutMetrics = null;
            }
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

        // KTV word progress is monotonic within one lyric line. A drop therefore
        // identifies a new line even when two adjacent lines have identical text.
        let previousDataProgress = null;
        const getDataProgress = (data) => {
            if (!Array.isArray(data) || data.length === 0) return null;

            let total = 0;
            let count = 0;
            for (const word of data) {
                const progress = Number(word?.percent);
                if (!Number.isFinite(progress)) continue;
                total += progress;
                count += 1;
            }

            return count > 0 ? total / count : null;
        };

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
            if (event.target.closest(".item") || event.target.closest(".resize-handle")) return;

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

            event.stopPropagation();
            event.preventDefault();

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

        const measureKtvLayout = () => {
            const lineDom = lineRef.value;
            const containerDom = containerRef.value;
            if (!lineDom || !containerDom || latestLyricData.length === 0) {
                ktvLayoutMetrics = null;
                return;
            }

            const spans = lineDom.querySelectorAll(".ktv-word");
            if (spans.length !== latestLyricData.length) {
                ktvLayoutMetrics = null;
                return;
            }

            const lineWidth = Math.max(1, lineDom.offsetWidth);
            ktvLayoutMetrics = {
                spanWidthRatios: Array.from(spans, span => span.offsetWidth / lineWidth),
                textWidth: lineDom.scrollWidth,
                containerWidth: containerDom.offsetWidth
            };
        };

        // Progress updates reuse cached layout metrics. Layout is measured only
        // when the lyric line, font, or window size changes.
        const updateKtvProgress = () => {
            if (latestLyricData.length === 0) {
                ktvProgressPercent.value = 0;
                translateX.value = 0;
                return;
            }

            if (!ktvLayoutMetrics) measureKtvLayout();
            if (!ktvLayoutMetrics) return;

            let percent = 0;
            for (let i = 0; i < ktvLayoutMetrics.spanWidthRatios.length; i++) {
                percent += ktvLayoutMetrics.spanWidthRatios[i] * (latestLyricData[i].percent || 0);
            }

            percent = Math.max(0, Math.min(1, percent));
            ktvProgressPercent.value = percent;

            // Scroll calculation
            const { textWidth, containerWidth } = ktvLayoutMetrics;

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

        const scheduleKtvProgressUpdate = () => {
            if (ktvAnimationFrame !== null) return;
            ktvAnimationFrame = requestAnimationFrame(() => {
                ktvAnimationFrame = null;
                updateKtvProgress();
            });
        };

        // IPC Listeners
        const setupIPC = async () => {
            const windowSystem = await window.electron.ipcRenderer.invoke("get-window-system");
            document.body.classList.toggle("wayland-native", Boolean(windowSystem?.isWayland));

            const initialConfig = await window.electron.ipcRenderer.invoke("get-lyric-config");
            if (initialConfig) {
                config.value = { ...config.value, ...initialConfig };
            }

            window.electron.ipcRenderer.on("play-lyric-change", (_, data) => {
                if (!data) return;

                const nextText = data.lyricText || "";
                const nextLyricData = data.lyricData || [];
                const nextDataProgress = getDataProgress(nextLyricData);
                const textChanged = nextText !== lyricText.value;
                const nextLineSignature = nextLyricData.map(word => word?.content || '').join('\u0001');
                const structureChanged = nextLineSignature !== currentLineSignature;
                const repeatedTextStartedNewLine = !textChanged &&
                    previousDataProgress !== null &&
                    nextDataProgress !== null &&
                    nextDataProgress + 0.05 < previousDataProgress;
                const lineChanged = textChanged || structureChanged || repeatedTextStartedNewLine;

                // A separate line key forces Vue to run the line transition even
                // when adjacent lyric lines contain exactly the same text.
                if (lineChanged) {
                    ktvProgressPercent.value = 0;
                    translateX.value = 0;
                    lyricLineKey.value += 1;
                    lyricData.value = nextLyricData;
                    currentLineSignature = nextLineSignature;
                    ktvLayoutMetrics = null;
                }

                lyricText.value = nextText;
                lyricTrans.value = data.lyricTrans || "";
                latestLyricData = nextLyricData;

                const nextThemeSignature = JSON.stringify(data.coverTheme || null);
                if (nextThemeSignature !== currentThemeSignature) {
                    currentThemeSignature = nextThemeSignature;
                    coverTheme.value = data.coverTheme || null;
                }
                previousDataProgress = nextDataProgress;

                if (lineChanged) {
                    nextTick(scheduleKtvProgressUpdate);
                } else {
                    scheduleKtvProgressUpdate();
                }
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
                ktvLayoutMetrics = null;
                nextTick(scheduleKtvProgressUpdate);
            });
        };

        const handleWindowResize = () => {
            mainContentHeight.value = Math.max(50, window.innerHeight - LAYOUT_OVERHEAD);
            ktvLayoutMetrics = null;
            nextTick(scheduleKtvProgressUpdate);
        };

        onMounted(() => {
            window.addEventListener("mousemove", handleMove);
            window.addEventListener("mouseup", endInteraction);
            window.addEventListener("resize", handleWindowResize);
            setupIPC();
        });

        onUnmounted(() => {
            if (ktvAnimationFrame !== null) cancelAnimationFrame(ktvAnimationFrame);
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", endInteraction);
            window.removeEventListener("resize", handleWindowResize);
        });

        return {
            lyricText,
            lyricTrans,
            lyricData,
            lyricLineKey,
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
