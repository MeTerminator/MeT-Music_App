import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { AppConfigSchema, defaultAppConfig, type AppConfig } from "../shared/ipc";

/**
 * 应用级设置的持久化(托盘进度、主窗关闭按钮行为)。
 *
 * 与 api-config.ts 同样单独一个文件:desktop-lyric-config.json 是老用户一路带过来的
 * 歌词外观配置,壳自身的行为不该混进去(理由见 api-config.ts 顶部注释)。
 */
const CONFIG_FILE = path.join(app.getPath("userData"), "app-config.json");

let currentConfig: AppConfig = defaultAppConfig();

/** 与 config.ts / api-config.ts 同款清洗策略:整包不过则逐字段校验,坏字段丢弃并回退默认值 */
function sanitizeConfig(raw: unknown): AppConfig {
    const result = defaultAppConfig();
    if (typeof raw !== "object" || raw === null) {
        console.warn("[app-config] config file is not an object, using defaults");
        return result;
    }

    const wholeParse = AppConfigSchema.partial().safeParse(raw);
    if (wholeParse.success) {
        return { ...result, ...wholeParse.data };
    }

    const rawRecord = raw as Record<string, unknown>;
    for (const key of Object.keys(AppConfigSchema.shape) as Array<keyof AppConfig>) {
        if (!(key in rawRecord)) continue;
        const fieldParse = AppConfigSchema.shape[key].safeParse(rawRecord[key]);
        if (fieldParse.success) {
            (result as Record<string, unknown>)[key] = fieldParse.data;
        } else {
            console.warn(`[app-config] dropped invalid field "${key}":`, fieldParse.error.message);
        }
    }
    return result;
}

export function loadConfig(): AppConfig {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            currentConfig = sanitizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")));
        } else {
            currentConfig = defaultAppConfig();
        }
    } catch (err) {
        console.error("[app-config] failed to load, using defaults:", err);
        currentConfig = defaultAppConfig();
    }
    return currentConfig;
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
    currentConfig = { ...currentConfig, ...patch };
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), "utf-8");
    } catch (err) {
        console.error("[app-config] failed to save:", err);
    }
    return currentConfig;
}

export function getConfig(): AppConfig {
    return currentConfig;
}
