const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_FILE = path.join(app.getPath('userData'), 'desktop-lyric-config.json');

const DEFAULT_CONFIG = {
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

let currentConfig = { ...DEFAULT_CONFIG };

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
        } else {
            currentConfig = { ...DEFAULT_CONFIG };
        }
    } catch (err) {
        console.error('Failed to load config, using defaults:', err);
        currentConfig = { ...DEFAULT_CONFIG };
    }
    return currentConfig;
}

function saveConfig(config) {
    try {
        currentConfig = { ...currentConfig, ...config };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
    } catch (err) {
        console.error('Failed to save config:', err);
    }
}

module.exports = {
    loadConfig,
    saveConfig,
    getConfig: () => currentConfig
};
