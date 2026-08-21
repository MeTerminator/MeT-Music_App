import { app, dialog } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import * as windowManager from "./window-manager";

/** 首次检查延迟:避免与应用启动抢占带宽 */
const INITIAL_CHECK_DELAY_MS = 10_000;
/** 后续定时检查间隔:4 小时 */
const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let initialized = false;
let manualCheckInProgress = false;

function promptRestartForUpdate(info: UpdateInfo): void {
    void dialog
        .showMessageBox({
            type: "info",
            title: "发现新版本",
            message: `发现新版本 v${info.version},重启后生效`,
            buttons: ["立即重启", "稍后"],
            defaultId: 0,
            cancelId: 1
        })
        .then(({ response }) => {
            if (response === 0) {
                // 主窗口 close 事件默认拦截为隐藏,先标记退出中再安装,
                // 否则 quitAndInstall 会被 window-manager 的 close 拦截挡住。
                windowManager.setQuitting(true);
                autoUpdater.quitAndInstall();
            }
        });
}

function checkForUpdatesInBackground(): void {
    autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
        console.warn("[updater] 后台检查更新失败(已静默):", error);
    });
}

/**
 * 初始化自动更新:仅在打包环境生效。
 * app ready 后延迟 10 秒首次检查,此后每 4 小时定时检查一次。
 */
export function initUpdater(): void {
    if (!app.isPackaged) {
        console.log("[updater] 开发模式(未打包),跳过自动更新初始化");
        return;
    }
    if (initialized) return;
    initialized = true;

    autoUpdater.logger = console;

    autoUpdater.on("update-available", (info: UpdateInfo) => {
        console.log(`[updater] 发现新版本 v${info.version},开始后台下载`);
    });

    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
        promptRestartForUpdate(info);
    });

    autoUpdater.on("error", (error: Error) => {
        // 自动检查失败保持静默,不打扰用户(手动检查有单独的 dialog 反馈)
        console.warn("[updater] 更新出错(已静默):", error.message);
    });

    setTimeout(() => {
        checkForUpdatesInBackground();
        setInterval(checkForUpdatesInBackground, PERIODIC_CHECK_INTERVAL_MS);
    }, INITIAL_CHECK_DELAY_MS);
}

/**
 * 手动检查更新(托盘菜单触发):
 * 无更新与检查失败均通过 dialog 给出明确反馈;
 * 有更新时后台下载,下载完成后由 update-downloaded 弹出重启提示。
 */
export async function checkForUpdatesManually(): Promise<void> {
    if (!app.isPackaged) {
        await dialog.showMessageBox({
            type: "info",
            title: "检查更新",
            message: "开发模式下不可用",
            buttons: ["确定"]
        });
        return;
    }

    if (manualCheckInProgress) return;
    manualCheckInProgress = true;

    try {
        const result = await autoUpdater.checkForUpdates();
        if (!result || !result.isUpdateAvailable) {
            await dialog.showMessageBox({
                type: "info",
                title: "检查更新",
                message: `当前已是最新版本(v${app.getVersion()})`,
                buttons: ["确定"]
            });
            return;
        }

        await dialog.showMessageBox({
            type: "info",
            title: "检查更新",
            message: `发现新版本 v${result.updateInfo.version},正在后台下载,完成后将提示重启`,
            buttons: ["确定"]
        });
    } catch (error) {
        console.warn("[updater] 手动检查更新失败:", error);
        await dialog.showMessageBox({
            type: "warning",
            title: "检查更新",
            message: "检查更新失败,请稍后重试或检查网络连接",
            buttons: ["确定"]
        });
    } finally {
        manualCheckInProgress = false;
    }
}
