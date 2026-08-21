import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
    defaultExternalApiConfig,
    ExternalApiConfigSchema,
    type ExternalApiConfig
} from "../shared/ipc";

/**
 * 外部 API 配置的持久化。
 *
 * 单独一个文件(不并进 desktop-lyric-config.json):歌词配置那份文件是老用户
 * 一路带过来的,里面每个字段都对应歌词窗外观;把服务开关塞进去,既让那份
 * schema 变得名不副实,也会让「恢复默认歌词配置」顺手把外部服务也重置掉。
 */
const CONFIG_FILE = path.join(app.getPath("userData"), "external-api-config.json");

let currentConfig: ExternalApiConfig = defaultExternalApiConfig();

/** 与 config.ts 同款清洗策略:整包不过则逐字段校验,坏字段丢弃并回退默认值 */
function sanitizeConfig(raw: unknown): ExternalApiConfig {
    const result = defaultExternalApiConfig();
    if (typeof raw !== "object" || raw === null) {
        console.warn("[api-config] config file is not an object, using defaults");
        return result;
    }

    const wholeParse = ExternalApiConfigSchema.partial().safeParse(raw);
    if (wholeParse.success) {
        return { ...result, ...wholeParse.data };
    }

    const rawRecord = raw as Record<string, unknown>;
    for (const key of Object.keys(ExternalApiConfigSchema.shape) as Array<keyof ExternalApiConfig>) {
        if (!(key in rawRecord)) continue;
        const fieldParse = ExternalApiConfigSchema.shape[key].safeParse(rawRecord[key]);
        if (fieldParse.success) {
            (result as Record<string, unknown>)[key] = fieldParse.data;
        } else {
            console.warn(`[api-config] dropped invalid field "${key}":`, fieldParse.error.message);
        }
    }
    return result;
}

export function loadConfig(): ExternalApiConfig {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            currentConfig = sanitizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")));
        } else {
            currentConfig = defaultExternalApiConfig();
        }
    } catch (err) {
        console.error("[api-config] failed to load, using defaults:", err);
        currentConfig = defaultExternalApiConfig();
    }
    return currentConfig;
}

export function saveConfig(patch: Partial<ExternalApiConfig>): ExternalApiConfig {
    currentConfig = { ...currentConfig, ...patch };
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), "utf-8");
    } catch (err) {
        console.error("[api-config] failed to save:", err);
    }
    return currentConfig;
}

export function getConfig(): ExternalApiConfig {
    return currentConfig;
}
