/**
 * App 内部 IPC 契约(单一事实来源)。
 * main / preload / renderer 共享;main 侧入口对 send 通道 payload 做 zod 校验。
 * 旧实现的 ~25 个裸通道收敛为按域命名的类型化通道(迁移对照见各 schema 注释)。
 */
import { z } from "zod";
import {
  CoverThemeSchema,
  HookPayloadSchema,
  WordProgressSchema,
  type HookPayload,
} from "./hook-contract";

export { HookPayloadSchema, type HookPayload };

/* ========== 通道名(定义在零依赖的 channels.ts,preload 运行时直接引用) ========== */

export { CH, type ChannelName } from "./channels";

/* ========== payload schema ========== */

/** 桌面歌词外观配置(旧 config.js DEFAULT_CONFIG,字段与持久化文件
 *  userData/desktop-lyric-config.json 保持一致,老用户配置无损) */
export const LyricConfigSchema = z.object({
  /** 历史遗留,无运行时消费;保留仅为老配置文件字段无损往返 */
  fontSize: z.number().default(36),
  /** 历史遗留,无运行时消费;保留仅为老配置文件字段无损往返 */
  transFontSize: z.number().default(18),
  lyricFontFamily: z.string().default(""),
  translationFontFamily: z.string().default(""),
  lyricFontWeight: z.number().default(700),
  translationFontWeight: z.number().default(400),
  textColor: z.string().default("#ffffff"),
  colorActive: z.string().default("#ffffff"),
  colorInactive: z.string().default("rgba(255, 255, 255, 0.3)"),
  showTranslation: z.boolean().default(true),
  isLock: z.boolean().default(false),
  bgColor: z.string().default("rgba(0, 0, 0, 0.2)"),
  bgBlur: z.number().default(10),
  useThemeColorForActive: z.boolean().default(true),
  textOpacity: z.number().default(100),
  strokeWidth: z.number().default(0),
  strokeColor: z.string().default("#000000"),
  windowX: z.number().nullable().default(null),
  windowY: z.number().nullable().default(null),
  windowWidth: z.number().nullable().default(null),
  windowHeight: z.number().nullable().default(null),
  overallOpacity: z.number().default(90),
  transFontSizeScale: z.number().default(23),
  pausedOpacity: z.number().default(30),
});
export type LyricConfig = z.infer<typeof LyricConfigSchema>;
export const defaultLyricConfig = (): LyricConfig => LyricConfigSchema.parse({});

export const PlayerCommandSchema = z.object({
  action: z.enum(["prev", "next", "playOrPause"]),
});
export type PlayerCommand = z.infer<typeof PlayerCommandSchema>;

export const WindowControlSchema = z.object({
  action: z.enum([
    "hide-main",
    "show-main",
    "open-settings",
    "close-settings",
    /* ---- 主窗窗口控制(主窗是 frame: false,按钮由远端 UI 渲染后回调过来) ---- */
    "minimize-main",
    "toggle-maximize-main",
    /** 走 win.close() —— 隐藏到托盘还是真正退出,由 main 侧既有的 close 处理决定 */
    "close-main",
  ]),
});
export type WindowControl = z.infer<typeof WindowControlSchema>;

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.infer<typeof RectSchema>;

/** 歌词窗几何操作判别联合 */
export const LyricWindowActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set-lock"), isLock: z.boolean() }),
  z.object({ type: z.literal("toggle-visibility") }),
  /** 拖动中实时移动(不落盘,旧 move-window) */
  z.object({ type: z.literal("move"), x: z.number(), y: z.number() }),
  /** 移动并保存坐标(旧 update-lyric-position) */
  z.object({ type: z.literal("save-position"), x: z.number(), y: z.number() }),
  /** JS 拖拽调整大小(旧 resize-window;Wayland 下用原生 resize,不走此通道) */
  z.object({ type: z.literal("resize"), x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  /** 保存完整 bounds(旧 save-lyric-window-bounds) */
  z.object({ type: z.literal("save-bounds"), bounds: RectSchema }),
  /** 拖动/缩放结束:main 自读 lyricWindow.getBounds() 落盘(渲染端无需回读 bounds) */
  z.object({ type: z.literal("save-current-bounds") }),
  /** 锁定态穿透联动:解锁按钮 hover 时临时关闭鼠标穿透(enabled=true 时按当前 isLock 重新应用) */
  z.object({ type: z.literal("set-passthrough"), enabled: z.boolean() }),
  z.object({ type: z.literal("reset-position") }),
]);
export type LyricWindowAction = z.infer<typeof LyricWindowActionSchema>;

/** 歌词行事件 payload(main 按 ≥50ms 合并后发出;
 *  showTranslation=false 时 main 侧清空 lyricTrans,行为与旧实现一致;
 *  lyricData / coverTheme 直接派生自 hook-contract,两端类型统一) */
export const LyricLineEventSchema = z.object({
  lyricText: z.string(),
  lyricData: z.array(WordProgressSchema),
  lyricTrans: z.string(),
  coverTheme: CoverThemeSchema.nullable(),
});
export type LyricLineEvent = z.infer<typeof LyricLineEventSchema>;

export interface AppInfo {
  screen: { width: number; height: number };
  isWayland: boolean;
}

/* ========== preload 暴露的 API 形状 ========== */

/** 主窗 preload(远程 UI 使用) */
export interface MainWindowAPI {
  sendHookData(data: HookPayload): void;
  hideWindow(): void;
  openSettings(): void;
  /* 窗口控制(无边框主窗的最小化/最大化/关闭,由 UI 顶栏按钮触发) */
  minimizeWindow(): void;
  toggleMaximize(): void;
  closeWindow(): void;
}

/** 歌词窗 / 设置窗 preload */
export interface DesktopAPI {
  // invoke
  getAppInfo(): Promise<AppInfo>;
  getLyricBounds(): Promise<Rect>;
  getLyricConfig(): Promise<LyricConfig>;
  // send
  playerCommand(action: PlayerCommand["action"]): void;
  windowControl(action: WindowControl["action"]): void;
  lyricWindow(action: LyricWindowAction): void;
  setLyricConfig(config: Partial<LyricConfig>): void;
  // events(返回取消订阅函数)
  onLyricChange(cb: (data: LyricLineEvent) => void): () => void;
  onSongChange(cb: (label: string) => void): () => void;
  onStatusChange(cb: (isPlaying: boolean) => void): () => void;
  onConfigChanged(cb: (config: LyricConfig) => void): () => void;
  onWindowResized(cb: (width: number, height: number) => void): () => void;
  onBoundsChanged(cb: (bounds: Rect) => void): () => void;
}

declare global {
  interface Window {
    /** 主窗(远程 UI)宿主 API */
    electronAPI: MainWindowAPI;
    /** 歌词窗/设置窗 API */
    desktopAPI: DesktopAPI;
  }
}
