const { createApp, ref, computed, onMounted, onUnmounted } = Vue;

createApp({
    setup() {
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

        const inactiveColorHex = ref('#ffffff');
        const inactiveOpacity = ref(30);
        const bgColorHex = ref('#000000');
        const systemFonts = ref([]);
        const fontLoadError = ref('');
        const featuredFonts = [
            { label: 'Spotify Mix（内置）', value: 'Spotify Mix UI Title' },
            { label: 'HarmonyOS Sans SC（内置）', value: 'HarmonyOS Sans SC' },
            { label: 'SF Pro（内置）', value: 'MeT SF Pro' },
            { label: 'PingFang SC（内置）', value: 'MeT PingFang SC' }
        ];

        const loadSystemFonts = async () => {
            if (typeof window.queryLocalFonts !== 'function') {
                fontLoadError.value = '当前系统不支持读取字体列表，仍可使用内置与推荐字体。';
                return;
            }

            try {
                const fontData = await window.queryLocalFonts();
                systemFonts.value = [...new Set(fontData.map(font => font.family).filter(Boolean))]
                    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
            } catch (error) {
                console.error('Failed to query local fonts:', error);
                fontLoadError.value = '无法读取系统字体列表，请检查本地字体访问权限。';
            }
        };

        // Screen & Window Bounds State for Position Control
        const screenSize = ref({ width: 1920, height: 1080 });
        const windowX = ref(0);
        const windowY = ref(0);
        const windowWidth = ref(1200);
        const windowHeight = ref(130);

        // Step & Pad state
        const moveStep = ref(10);
        const padRef = ref(null);
        const isPadDragging = ref(false);
        let configUpdateTimer = null;

        // Computed style for drag pad indicator handle
        const padHandleStyle = computed(() => {
            const maxX = Math.max(1, screenSize.value.width - windowWidth.value);
            const maxY = Math.max(1, screenSize.value.height - windowHeight.value);
            const percentX = Math.max(0, Math.min(1, windowX.value / maxX));
            const percentY = Math.max(0, Math.min(1, windowY.value / maxY));

            return {
                left: `${(percentX * 100).toFixed(2)}%`,
                top: `${(percentY * 100).toFixed(2)}%`
            };
        });

        const updatePosition = (newX, newY) => {
            const maxX = Math.max(0, screenSize.value.width - windowWidth.value);
            const maxY = Math.max(0, screenSize.value.height - windowHeight.value);
            const clampedX = Math.max(0, Math.min(maxX, Math.round(newX)));
            const clampedY = Math.max(0, Math.min(maxY, Math.round(newY)));

            windowX.value = clampedX;
            windowY.value = clampedY;

            window.electron.ipcRenderer.send("update-lyric-position", clampedX, clampedY);
        };

        const onCoordInputChange = () => {
            updatePosition(windowX.value, windowY.value);
        };

        const updateWindowSize = () => {
            const maxWidth = Math.max(100, screenSize.value.width);
            const maxHeight = Math.max(50, screenSize.value.height);
            windowWidth.value = Math.max(100, Math.min(maxWidth, Math.round(Number(windowWidth.value) || 100)));
            windowHeight.value = Math.max(50, Math.min(maxHeight, Math.round(Number(windowHeight.value) || 50)));

            const maxX = Math.max(0, screenSize.value.width - windowWidth.value);
            const maxY = Math.max(0, screenSize.value.height - windowHeight.value);
            windowX.value = Math.max(0, Math.min(maxX, windowX.value));
            windowY.value = Math.max(0, Math.min(maxY, windowY.value));

            window.electron.ipcRenderer.send(
                "resize-window",
                windowX.value,
                windowY.value,
                windowWidth.value,
                windowHeight.value
            );
        };

        const moveOffset = (deltaX, deltaY) => {
            updatePosition(windowX.value + deltaX, windowY.value + deltaY);
        };

        const alignPosition = (preset) => {
            const sw = screenSize.value.width;
            const sh = screenSize.value.height;
            const ww = windowWidth.value;
            const wh = windowHeight.value;

            let targetX = windowX.value;
            let targetY = windowY.value;

            switch (preset) {
                case 'top-center':
                    targetX = Math.round((sw - ww) / 2);
                    targetY = 0;
                    break;
                case 'bottom-center':
                    targetX = Math.round((sw - ww) / 2);
                    targetY = Math.max(0, sh - wh);
                    break;
                case 'center':
                    targetX = Math.round((sw - ww) / 2);
                    targetY = Math.round((sh - wh) / 2);
                    break;
                case 'left':
                    targetX = 0;
                    break;
                case 'right':
                    targetX = Math.max(0, sw - ww);
                    break;
            }

            updatePosition(targetX, targetY);
        };

        // Drag pad event handlers
        const handlePadMove = (e) => {
            if (!isPadDragging.value || !padRef.value) return;
            const rect = padRef.value.getBoundingClientRect();
            const mouseX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const mouseY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

            const percentX = mouseX / rect.width;
            const percentY = mouseY / rect.height;

            const targetX = percentX * Math.max(0, screenSize.value.width - windowWidth.value);
            const targetY = percentY * Math.max(0, screenSize.value.height - windowHeight.value);

            updatePosition(targetX, targetY);
        };

        const onPadMouseDown = (e) => {
            isPadDragging.value = true;
            handlePadMove(e);

            const onMouseUp = () => {
                isPadDragging.value = false;
                window.removeEventListener('mousemove', handlePadMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', handlePadMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        const closeSettings = () => {
            window.electron.ipcRenderer.send("close-settings-window");
        };

        const sendConfigUpdate = () => {
            configUpdateTimer = null;
            window.electron.ipcRenderer.send("update-lyric-config", JSON.parse(JSON.stringify(config.value)));
        };

        const updateConfig = () => {
            clearTimeout(configUpdateTimer);
            configUpdateTimer = setTimeout(sendConfigUpdate, 80);
        };

        const flushConfigUpdate = () => {
            if (configUpdateTimer === null) return;
            clearTimeout(configUpdateTimer);
            sendConfigUpdate();
        };

        const updateInactiveColor = () => {
            const hex = inactiveColorHex.value;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const alpha = (inactiveOpacity.value / 100).toFixed(2);
            config.value.colorInactive = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            updateConfig();
        };

        const updateBgColor = () => {
            const hex = bgColorHex.value;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            config.value.bgColor = `rgba(${r}, ${g}, ${b}, 0.2)`;
            updateConfig();
        };

        const parseConfigColors = () => {
            if (config.value.colorInactive.startsWith('rgba')) {
                const match = config.value.colorInactive.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
                if (match) {
                    const r = parseInt(match[1]).toString(16).padStart(2, '0');
                    const g = parseInt(match[2]).toString(16).padStart(2, '0');
                    const b = parseInt(match[3]).toString(16).padStart(2, '0');
                    inactiveColorHex.value = `#${r}${g}${b}`;
                    inactiveOpacity.value = Math.round(parseFloat(match[4]) * 100);
                } else {
                    const matchRGB = config.value.colorInactive.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
                    if (matchRGB) {
                        const r = parseInt(matchRGB[1]).toString(16).padStart(2, '0');
                        const g = parseInt(matchRGB[2]).toString(16).padStart(2, '0');
                        const b = parseInt(matchRGB[3]).toString(16).padStart(2, '0');
                        inactiveColorHex.value = `#${r}${g}${b}`;
                        inactiveOpacity.value = 100;
                    }
                }
            } else if (config.value.colorInactive.startsWith('#')) {
                inactiveColorHex.value = config.value.colorInactive.slice(0, 7);
                inactiveOpacity.value = 100;
            }

            if (config.value.bgColor.startsWith('rgba')) {
                const parts = config.value.bgColor.match(/\d+/g);
                if (parts && parts.length >= 3) {
                    const r = parseInt(parts[0]).toString(16).padStart(2, '0');
                    const g = parseInt(parts[1]).toString(16).padStart(2, '0');
                    const b = parseInt(parts[2]).toString(16).padStart(2, '0');
                    bgColorHex.value = `#${r}${g}${b}`;
                }
            } else if (config.value.bgColor.startsWith('#')) {
                bgColorHex.value = config.value.bgColor.slice(0, 7);
            }
        };

        const resetConfig = () => {
            config.value = {
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
            };
            inactiveColorHex.value = '#ffffff';
            inactiveOpacity.value = 30;
            bgColorHex.value = '#000000';
            updateConfig();
        };

        const resetLyricPosition = () => {
            window.electron.ipcRenderer.send("reset-lyric-window-position");
        };

        onMounted(async () => {
            const currentConfig = await window.electron.ipcRenderer.invoke("get-lyric-config");
            if (currentConfig) {
                config.value = { ...config.value, ...currentConfig };
                parseConfigColors();
            }

            loadSystemFonts();

            try {
                const screen = await window.electron.ipcRenderer.invoke("get-screen-size");
                if (screen) screenSize.value = screen;

                const bounds = await window.electron.ipcRenderer.invoke("get-window-bounds");
                if (bounds) {
                    windowX.value = bounds.x;
                    windowY.value = bounds.y;
                    windowWidth.value = bounds.width;
                    windowHeight.value = bounds.height;
                }
            } catch (e) {
                console.error("Failed to retrieve screen/window bounds:", e);
            }

            window.electron.ipcRenderer.on("lyric-bounds-changed", (_, bounds) => {
                if (bounds && !isPadDragging.value) {
                    windowX.value = bounds.x;
                    windowY.value = bounds.y;
                    windowWidth.value = bounds.width;
                    windowHeight.value = bounds.height;
                }
            });
        });

        onUnmounted(flushConfigUpdate);

        return {
            config,
            systemFonts,
            featuredFonts,
            fontLoadError,
            inactiveColorHex,
            inactiveOpacity,
            bgColorHex,
            screenSize,
            windowX,
            windowY,
            windowWidth,
            windowHeight,
            moveStep,
            padRef,
            padHandleStyle,
            updatePosition,
            onCoordInputChange,
            updateWindowSize,
            moveOffset,
            alignPosition,
            onPadMouseDown,
            closeSettings,
            updateConfig,
            updateInactiveColor,
            updateBgColor,
            resetLyricPosition,
            resetConfig
        };
    }
}).mount('#app');
