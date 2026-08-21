/**
 * MeT-Music 跨仓宿主契约 v2(FROZEN 2026-08-20)
 *
 * 本文件在两个仓库中各有一份【内容完全相同】的副本,修改必须同步提交两仓:
 *   - MeT-Music_UI:  packages/app/src/host/contract.ts
 *   - MeT-Music_App: src/shared/hook-contract.ts
 *
 * 契约双方:
 *   - UI(web 播放器,https://music.met6.top:444/app/)实现并暴露全局函数;
 *   - App(Electron 壳)在 did-finish-load 后注入 $MeTMusic_Hook 回调,
 *     并通过 executeJavaScript 调用控制函数。
 *
 * v2 相对 v1 的变化(函数名与 payload 字段全部向后兼容):
 *   1. payload 新增 contractVersion 字段(v1 payload 无此字段,宿主据此降级);
 *   2. 新增 $MeTMusic_registerHost:宿主注册回调后,UI 自行在导航栏渲染
 *      设置/隐藏按钮并回调宿主,废除宿主向 `.main-nav > .right` 的 DOM 注入;
 *   3. payload 结构以本文件 zod schema 为准(v1 仅有文档描述)。
 *
 * 破坏性变更流程:改动任何 schema/函数签名 → 版本号 +1 → 两仓同步提交。
 *
 * ⚠️ 为什么窗口控制(2026-08-21 追加)没有把版本号顶到 v3:
 *   UI 是宿主从远端 URL 加载的,**UI 会先于用户安装的 App 更新**。
 *   HookPayloadSchema.contractVersion 是 z.literal(CONTRACT_VERSION),
 *   一旦 UI 发出 3 而用户装的仍是 v2 App,App 侧 payload 校验会整体失败,
 *   桌面歌词直接哑掉。所以窗口控制一律做成**纯增量**:
 *   HostCallbacksSchema 只加可选字段,payload schema 一字未动,
 *   CONTRACT_VERSION 保持 2。UI 按「回调存在才渲染对应按钮」降级,
 *   旧 App 上表现与改动前完全一致。
 *   下次真要动 payload 结构时再走版本号 +1 的流程。
 */

import { z } from "zod";

export const CONTRACT_VERSION = 2 as const;

/** UI 侧逐字进度计算时对 currentTime 施加的默认偏移(秒),对应 siteSettings.lyricsHookOffset */
export const LYRICS_HOOK_OFFSET_DEFAULT = 0.3;

/** App 侧对 hook 数据向歌词窗转发的最小合并间隔(毫秒) */
export const HOOK_MIN_INTERVAL_MS = 50;

/** 逐字歌词进度项:content 为单字/词,percent ∈ [0,1](0 未播,1 已播完,中间为进行中) */
export const WordProgressSchema = z.object({
  content: z.string(),
  percent: z.number().min(0).max(1),
});

/** 封面取色主题的单侧(dark 或 light);各字段为 CSS 颜色值,取色失败时可为空 */
export const CoverThemeSideSchema = z.object({
  bg: z.string().optional(),
  mainBg: z.string().optional(),
  primary: z.string().optional(),
  shade: z.string().optional(),
  shadeTwo: z.string().optional(),
});

export const CoverThemeSchema = z.object({
  dark: CoverThemeSideSchema,
  light: CoverThemeSideSchema,
});

/**
 * UI → App 播放状态 payload($MeTMusic_Hook 的实参,亦写入 $MeTMusic_Data)。
 * UI 在播放进度 tick(rAF / 17ms interval)中调用,App 侧自行按
 * HOOK_MIN_INTERVAL_MS 合并;App 的 showTranslation=false 时可在转发前清空 lyricTrans。
 */
export const HookPayloadSchema = z.object({
  /** v2 起恒为 CONTRACT_VERSION;v1 payload 无此字段 */
  contractVersion: z.literal(CONTRACT_VERSION).optional(),
  songName: z.string(),
  /** 多歌手以 " / " 连接 */
  songArtist: z.string(),
  /** 歌曲 id;本地歌曲等场景可能为字符串 "Unknown" */
  songMid: z.union([z.string(), z.number()]),
  /** 当前进度(秒) */
  currentTime: z.number(),
  /** 总时长(秒);元数据未加载时可能为 0 */
  duration: z.number(),
  /** 当前行歌词原文(yrc 内容拼接) */
  lyricText: z.string(),
  /** 当前行翻译;无翻译时为空串或缺省 */
  lyricTrans: z.string().optional(),
  /** 当前行逐字 KTV 进度;percent 基于 currentTime + lyricsHookOffset 计算 */
  lyricData: z.array(WordProgressSchema),
  /** 大图封面 URL(coverSize.l);本地歌曲可能缺省 */
  coverUrl: z.string().optional(),
  coverTheme: CoverThemeSchema.optional(),
  isPlaying: z.boolean(),
});

export type WordProgress = z.infer<typeof WordProgressSchema>;
export type CoverTheme = z.infer<typeof CoverThemeSchema>;
export type HookPayload = z.infer<typeof HookPayloadSchema>;

/**
 * 宿主注册接口(v2 新增)。
 * App 在注入 $MeTMusic_Hook 的同时调用 $MeTMusic_registerHost;
 * UI 收到注册后即认定运行于桌面宿主内(这是 UI 判断宿主环境的唯一依据),
 * 并在导航栏渲染设置/隐藏按钮,点击时回调对应函数。
 */
const hostCallback = () => z.custom<() => void>((v) => typeof v === "function").optional();

export const HostCallbacksSchema = z.object({
  /** 用户点击 UI 内"设置"按钮(打开桌面歌词外观设置窗) */
  onOpenSettings: hostCallback(),
  /** 用户点击 UI 内"隐藏"按钮(主窗隐藏到托盘) */
  onHideWindow: hostCallback(),

  /* ---- 窗口控制(2026-08-21 追加;全部可选,缺省则 UI 不渲染对应按钮) ----
     主窗是 frame: false 的无边框窗口,窗口按钮与拖拽区都得由 UI 提供。
     UI 侧只负责「点了就回调」,具体语义(是否询问、隐藏到托盘还是退出)
     一律留给宿主,免得两仓各自实现一套关闭策略。 */
  /** 最小化主窗 */
  onMinimizeWindow: hostCallback(),
  /** 最大化 / 还原主窗(由宿主判断当前状态并取反) */
  onToggleMaximize: hostCallback(),
  /** 关闭主窗;隐藏到托盘还是真正退出由宿主的「关闭方式」设置决定 */
  onCloseWindow: hostCallback(),
});

export type HostCallbacks = z.infer<typeof HostCallbacksSchema>;

/**
 * UI 暴露的全局接口(挂载在 window 上)。
 *
 * 生命周期:
 *   1. UI 启动时初始化 $MeTMusic_Data(空数据)与 $MeTMusic_Hook = null,
 *      并挂载三个控制函数与 $MeTMusic_registerHost;
 *   2. App 在 did-finish-load 后注入:
 *        window.$MeTMusic_Hook = (data) => electronAPI.sendHookData(data);
 *        window.$MeTMusic_registerHost({ onOpenSettings, onHideWindow });
 *   3. UI 每个播放 tick 更新 $MeTMusic_Data 并调用 $MeTMusic_Hook(如已注入);
 *   4. App 经 executeJavaScript 调用控制函数(托盘/桌面歌词按钮/SMTC)。
 */
export interface MeTMusicGlobals {
  /** 最近一次 hook payload(UI 启动时为空骨架) */
  $MeTMusic_Data: HookPayload | Record<string, unknown>;
  /** 宿主注入的状态回调;UI 启动时为 null */
  $MeTMusic_Hook: ((data: HookPayload) => void) | null;
  $MeTMusic_playOrPause: () => void;
  $MeTMusic_next: () => void;
  $MeTMusic_prev: () => void;
  /** v2 新增;v1 UI 不存在此函数,宿主注入前需判空 */
  $MeTMusic_registerHost?: (callbacks: HostCallbacks) => void;
  /**
   * 宿主向 UI 回推主窗状态(2026-08-21 追加,可选)。
   * 用户双击拖拽区、用系统快捷键或窗口菜单改变最大化状态时,UI 无从感知,
   * 「最大化/还原」图标会和实际状态对不上,故由宿主在 maximize/unmaximize
   * 事件里回推一次。宿主注入前需判空(旧 UI 没有此函数)。
   */
  $MeTMusic_setWindowState?: (state: { maximized: boolean }) => void;
}

declare global {
  interface Window extends MeTMusicGlobals {}
}
