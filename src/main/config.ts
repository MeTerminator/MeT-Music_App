import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { defaultLyricConfig, LyricConfigSchema, type LyricConfig } from "../shared/ipc";

/** 持久化文件路径与旧实现保持一致(老用户配置无损) */
const CONFIG_FILE = path.join(app.getPath("userData"), "desktop-lyric-config.json");

let currentConfig: LyricConfig = defaultLyricConfig();

/**
 * 读入 JSON 后逐字段清洗:整包 partial 校验通过则直接合并;
 * 失败时不整包放弃,而是逐字段单独校验,坏字段丢弃(console.warn)并回退默认值。
 */
function sanitizeConfig(raw: unknown): LyricConfig {
    const result = defaultLyricConfig();
    if (typeof raw !== "object" || raw === null) {
        console.warn("[config] config file is not an object, using defaults");
        return result;
    }

    const wholeParse = LyricConfigSchema.partial().safeParse(raw);
    if (wholeParse.success) {
        return { ...result, ...wholeParse.data };
    }

    const rawRecord = raw as Record<string, unknown>;
    for (const key of Object.keys(LyricConfigSchema.shape) as Array<keyof LyricConfig>) {
        if (!(key in rawRecord)) continue;
        const fieldParse = LyricConfigSchema.shape[key].safeParse(rawRecord[key]);
        if (fieldParse.success) {
            (result as Record<string, unknown>)[key] = fieldParse.data;
        } else {
            console.warn(`[config] dropped invalid field "${key}":`, fieldParse.error.message);
        }
    }
    return result;
}

export function loadConfig(): LyricConfig {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, "utf-8");
            currentConfig = sanitizeConfig(JSON.parse(data));
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
