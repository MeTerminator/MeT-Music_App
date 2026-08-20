/**
 * App 内部 IPC 契约(单一事实来源)。
 * main / preload / renderer 共享;main 侧入口对 send 通道 payload 做 zod 校验。
 * 旧实现的 ~25 个裸通道收敛为按域命名的类型化通道(迁移对照见各 schema 注释)。
 */
import { z } from "zod";
import { HookPayloadSchema, type HookPayload } from "./hook-contract";

export { HookPayloadSchema, type HookPayload };

/* ========== 通道名 ========== */

export const CH = {
  /** 主窗 preload → main:播放状态 hook 转发(旧 metmusic-hook) */
  hookState: "hook:state",
  /** 歌词/设置窗 → main:播放控制(旧 play-prev / play-next / play-or-pause) */
  playerCommand: "player:command",
  /** 窗口控制(旧 hide-window / show-window / open-settings / close-settings-window) */
  windowControl: "window:control",
  /** 歌词窗几何操作(旧 toggle-desktop-lyric-lock / hide-desktop-lyric-window /
   *  move-window / update-lyric-position / resize-window /
   *  save-lyric-window-bounds / reset-lyric-window-position) */
  lyricWindow: "lyric:window",
  /** invoke:歌词外观配置(旧 get-lyric-config) */
  lyricConfigGet: "lyric:config-get",
  /** send:保存歌词外观配置并广播(旧 update-lyric-config) */
  lyricConfigSet: "lyric:config-set",
  /** invoke:环境信息(旧 get-screen-size + get-window-system 合并) */
  appInfo: "app:info",
  /** invoke:歌词窗当前 bounds(旧 get-window-bounds) */
  lyricBoundsGet: "lyric:bounds-get",

  /* ---- main → 歌词/设置窗事件 ---- */
  /** 歌词行更新(旧 play-lyric-change,≥50ms 合并后) */
  evLyricChange: "lyric:line-change",
  /** 歌名变更(旧 play-song-change,payload 为 "歌名 - 歌手") */
  evSongChange: "lyric:song-change",
  /** 播放状态变更(旧 play-status-change,payload 为 boolean) */
  evStatusChange: "lyric:status-change",
  /** 配置变更广播(旧 lyric-config-changed) */
  evConfigChanged: "lyric:config-changed",
  /** 歌词窗尺寸变化(旧 window-resized,payload 为 [width, height]) */
  evWindowResized: "lyric:window-resized",
  /** 歌词窗 bounds 变化 → 设置窗(旧 lyric-bounds-changed) */
  evBoundsChanged: "lyric:bounds-changed",
} as const;

export type ChannelName = (typeof CH)[keyof typeof CH];

/* ========== payload schema ========== */

/** 桌面歌词外观配置(旧 config.js DEFAULT_CONFIG,字段与持久化文件
 *  userData/desktop-lyric-config.json 保持一致,老用户配置无损) */
export const LyricConfigSchema = z.object({
  fontSize: z.number().default(36),
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
  action: z.enum(["hide-main", "show-main", "open-settings", "close-settings"]),
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
  z.object({ type: z.literal("reset-position") }),
]);
export type LyricWindowAction = z.infer<typeof LyricWindowActionSchema>;

/** 歌词行事件 payload(main 按 ≥50ms 合并后发出;
 *  showTranslation=false 时 main 侧清空 lyricTrans,行为与旧实现一致) */
export const LyricLineEventSchema = z.object({
  lyricText: z.string(),
  lyricData: z.array(z.object({ content: z.string(), percent: z.number() })),
  lyricTrans: z.string(),
  coverTheme: z
    .object({
      dark: z.record(z.string(), z.string().optional()).optional(),
      light: z.record(z.string(), z.string().optional()).optional(),
    })
    .nullable(),
});
export type LyricLineEvent = z.infer<typeof LyricLineEventSchema>;

export interface AppInfo {
  screen: { width: number; height: number };
  isWayland: boolean;
}

/* ========== preload 暴露的 API 形状 ========== */

/** 主窗 preload(远程 UI 使用;命名保持 v1 兼容,旧 UI 的注入代码依赖这些名字) */
export interface MainWindowAPI {
  sendHookData(data: HookPayload): void;
  hideWindow(): void;
  openSettings(): void;
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
    /** 主窗(远程 UI)宿主 API,名称 v1 兼容 */
    electronAPI: MainWindowAPI;
    /** 歌词窗/设置窗 API */
    desktopAPI: DesktopAPI;
  }
}
