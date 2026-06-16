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
            bgBlur: 10
        });

        const inactiveColorHex = ref('#ffffff');
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
            config.value.colorInactive = `rgba(${r}, ${g}, ${b}, 0.3)`;
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
                const parts = config.value.colorInactive.match(/\d+/g);
                if (parts && parts.length >= 3) {
                    const r = parseInt(parts[0]).toString(16).padStart(2, '0');
                    const g = parseInt(parts[1]).toString(16).padStart(2, '0');
                    const b = parseInt(parts[2]).toString(16).padStart(2, '0');
                    inactiveColorHex.value = `#${r}${g}${b}`;
                }
            } else if (config.value.colorInactive.startsWith('#')) {
                inactiveColorHex.value = config.value.colorInactive.slice(0, 7);
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
                bgBlur: 10
            };
            inactiveColorHex.value = '#ffffff';
            bgColorHex.value = '#000000';
            updateConfig();
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
            bgColorHex,
            closeSettings,
            updateConfig,
            updateInactiveColor,
            updateBgColor,
            resetConfig
        };
    }
}).mount('#app');
