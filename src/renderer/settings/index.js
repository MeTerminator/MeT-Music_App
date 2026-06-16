const { createApp, ref, onMounted } = Vue;

createApp({
    setup() {
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

        const inactiveColorHex = ref('#ffffff');
        const inactiveOpacity = ref(30);
        const bgColorHex = ref('#000000');

        const closeSettings = () => {
            window.electron.ipcRenderer.send("close-settings-window");
        };

        const updateConfig = () => {
            window.electron.ipcRenderer.send("update-lyric-config", JSON.parse(JSON.stringify(config.value)));
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
        });

        return {
            config,
            inactiveColorHex,
            inactiveOpacity,
            bgColorHex,
            closeSettings,
            updateConfig,
            updateInactiveColor,
            updateBgColor,
            resetLyricPosition,
            resetConfig
        };
    }
}).mount('#app');
