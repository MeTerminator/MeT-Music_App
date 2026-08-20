import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { defaultLyricConfig, type LyricConfig } from "../shared/ipc";

/** 持久化文件路径与旧实现保持一致(老用户配置无损) */
const CONFIG_FILE = path.join(app.getPath("userData"), "desktop-lyric-config.json");

let currentConfig: LyricConfig = defaultLyricConfig();

export function loadConfig(): LyricConfig {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, "utf-8");
            currentConfig = { ...defaultLyricConfig(), ...(JSON.parse(data) as Partial<LyricConfig>) };
        } else {
            currentConfig = defaultLyricConfig();
        }
    } catch (err) {
        console.error("Failed to load config, using defaults:", err);
        currentConfig = defaultLyricConfig();
    }
    return currentConfig;
}

export function saveConfig(config: Partial<LyricConfig>): void {
    try {
        currentConfig = { ...currentConfig, ...config };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), "utf-8");
    } catch (err) {
        console.error("Failed to save config:", err);
    }
}

export function getConfig(): LyricConfig {
    return currentConfig;
}
