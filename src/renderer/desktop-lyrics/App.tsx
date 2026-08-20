import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type JSX,
    type MouseEvent as ReactMouseEvent,
} from "react";
import { defaultLyricConfig, type LyricConfig, type LyricLineEvent } from "@shared/ipc";
import { Toolbar } from "./Toolbar";

type LyricWord = LyricLineEvent["lyricData"][number];
type CoverTheme = LyricLineEvent["coverTheme"];

/** 固定布局开销:#app 内边距 (12px*2) + 顶部工具条 (~20px),与旧实现一致 */
const LAYOUT_OVERHEAD = 44;
/** 主进程窗口最小尺寸(与旧实现 JS resize 分支的 minW/minH 一致) */
const MIN_WIDTH = 100;
const MIN_HEIGHT = 50;
/** 行切换过渡时长(与旧 .lyric-scroll 过渡 0.4s 一致) */
const LINE_TRANSITION_MS = 400;

const RESIZE_DIRS = [
    "top",
    "bottom",
    "left",
    "right",
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
] as const;
type ResizeDir = (typeof RESIZE_DIRS)[number];

interface LineState {
    key: number;
    text: string;
    trans: string;
    data: LyricWord[];
}

/** 离场行快照:冻结离场瞬间的 KTV 染色进度与横向滚动位置 */
interface LeavingLine extends LineState {
    posX: string;
    tx: number;
}

interface KtvMetrics {
    spanWidthRatios: number[];
    textWidth: number;
    containerWidth: number;
}

interface InteractionState {
    mode: "drag" | "resize";
    dir: ResizeDir | null;
    startX: number;
    startY: number;
    startWinX: number;
    startWinY: number;
    winWidth: number;
    winHeight: number;
    /** 异步取到窗口 bounds 之后才允许 move/resize,避免起点为 0 的跳变 */
    ready: boolean;
    lastX: number;
    lastY: number;
}

function hexToRgba(hex: string, opacityPercent: number): string {
    if (!hex) return "rgba(255, 255, 255, 1)";
    const cleanHex = hex.replace("#", "");
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    const alpha = (opacityPercent / 100).toFixed(2);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * KTV 逐字进度在同一行内单调递增,均值回落即视为进入了新的一行
 * (用于相邻两行歌词文本完全相同的场景,与旧实现一致)。
 */
function getDataProgress(data: LyricWord[]): number | null {
    if (!Array.isArray(data) || data.length === 0) return null;

    let total = 0;
    let count = 0;
    for (const word of data) {
        const progress = Number(word?.percent);
        if (!Number.isFinite(progress)) continue;
        total += progress;
        count += 1;
    }

    return count > 0 ? total / count : null;
}

/** 旧实现:backgroundPositionX = max(0, (1 - percent) * 100)% */
function ktvBackgroundPositionX(percent: number): string {
    return `${Math.max(0, (1 - percent) * 100).toFixed(2)}%`;
}

const INITIAL_LINE: LineState = { key: 0, text: "MeT-Music", trans: "", data: [] };

export function App(): JSX.Element {
    const [config, setConfig] = useState<LyricConfig>(() => defaultLyricConfig());
    const [isPlaying, setIsPlaying] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isWayland, setIsWayland] = useState(false);
    const [songLabel, setSongLabel] = useState("");
    const [coverTheme, setCoverTheme] = useState<CoverTheme>(null);
    const [line, setLine] = useState<LineState>(INITIAL_LINE);
    const [leaving, setLeaving] = useState<LeavingLine | null>(null);
    const [ktv, setKtv] = useState({ posX: ktvBackgroundPositionX(0), tx: 0 });
    const [mainContentHeight, setMainContentHeight] = useState(() =>
        Math.max(50, window.innerHeight - LAYOUT_OVERHEAD)
    );

    // ---- refs(事件回调中读取,避免闭包过期) ----
    const configRef = useRef(config);
    const isWaylandRef = useRef(false);
    const lineStateRef = useRef<LineState>(INITIAL_LINE);
    const latestDataRef = useRef<LyricWord[]>([]);
    const lineSigRef = useRef("");
    const themeSigRef = useRef("");
    const prevProgressRef = useRef<number | null>(null);
    const ktvRef = useRef({ percent: 0, tx: 0 });
    const metricsRef = useRef<KtvMetrics | null>(null);
    const rafRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const currentLineElRef = useRef<HTMLDivElement | null>(null);
    const interactionRef = useRef<InteractionState | null>(null);

    useEffect(() => {
        configRef.current = config;
    }, [config]);

    useEffect(() => {
        isWaylandRef.current = isWayland;
        document.body.classList.toggle("wayland-native", isWayland);
    }, [isWayland]);

    // ---- KTV 逐字染色:测量 / 进度计算(逐行对照旧实现) ----

    const measureKtvLayout = useCallback(() => {
        const lineDom = currentLineElRef.current;
        const containerDom = containerRef.current;
        const latest = latestDataRef.current;
        if (!lineDom || !containerDom || latest.length === 0) {
            metricsRef.current = null;
            return;
        }

        const spans = lineDom.querySelectorAll(".ktv-word");
        if (spans.length !== latest.length) {
            metricsRef.current = null;
            return;
        }

        const lineWidth = Math.max(1, lineDom.offsetWidth);
        metricsRef.current = {
            spanWidthRatios: Array.from(spans, (span) => (span as HTMLElement).offsetWidth / lineWidth),
            textWidth: lineDom.scrollWidth,
            containerWidth: containerDom.offsetWidth,
        };
    }, []);

    /** 进度更新复用缓存的布局测量;仅在行/字体/窗口尺寸变化时重新测量 */
    const updateKtvProgress = useCallback(() => {
        const latest = latestDataRef.current;
        if (latest.length === 0) {
            ktvRef.current = { percent: 0, tx: 0 };
            setKtv({ posX: ktvBackgroundPositionX(0), tx: 0 });
            return;
        }

        if (!metricsRef.current) measureKtvLayout();
        const metrics = metricsRef.current;
        if (!metrics) return;

        let percent = 0;
        for (let i = 0; i < metrics.spanWidthRatios.length; i++) {
            percent += (metrics.spanWidthRatios[i] ?? 0) * (latest[i]?.percent || 0);
        }
        percent = Math.max(0, Math.min(1, percent));

        // 超宽行横向滚动:以当前进度为中心,夹在首尾之间
        const { textWidth, containerWidth } = metrics;
        let tx = 0;
        if (textWidth > containerWidth) {
            const startLeft = (containerWidth - textWidth) / 2;
            tx = textWidth * (0.5 - percent);
            const maxTranslate = -startLeft;
            const minTranslate = startLeft;
            if (tx > maxTranslate) tx = maxTranslate;
            if (tx < minTranslate) tx = minTranslate;
        }

        ktvRef.current = { percent, tx };
        setKtv({ posX: ktvBackgroundPositionX(percent), tx });
    }, [measureKtvLayout]);

    const scheduleKtvUpdate = useCallback(() => {
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            updateKtvProgress();
        });
    }, [updateKtvProgress]);

    useEffect(() => {
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    // ---- 歌词行事件(对照旧 play-lyric-change 处理) ----

    const handleLyricChange = useCallback(
        (data: LyricLineEvent) => {
            if (!data) return;

            const nextText = data.lyricText || "";
            const nextData = data.lyricData || [];
            const nextTrans = data.lyricTrans || "";
            const nextProgress = getDataProgress(nextData);

            const cur = lineStateRef.current;
            const textChanged = nextText !== cur.text;
            const nextSig = nextData.map((word) => word?.content || "").join("\u0001");
            const structureChanged = nextSig !== lineSigRef.current;
            const repeatedTextStartedNewLine =
                !textChanged &&
                prevProgressRef.current !== null &&
                nextProgress !== null &&
                nextProgress + 0.05 < prevProgressRef.current;
            const lineChanged = textChanged || structureChanged || repeatedTextStartedNewLine;

            if (lineChanged) {
                // 离场快照(冻结旧行的染色进度),行 key 自增以强制重放行切换过渡
                const snapshot: LeavingLine = {
                    ...cur,
                    posX: ktvBackgroundPositionX(ktvRef.current.percent),
                    tx: ktvRef.current.tx,
                };
                const nextLine: LineState = {
                    key: cur.key + 1,
                    text: nextText,
                    trans: nextTrans,
                    data: nextData,
                };
                lineSigRef.current = nextSig;
                metricsRef.current = null;
                ktvRef.current = { percent: 0, tx: 0 };
                setKtv({ posX: ktvBackgroundPositionX(0), tx: 0 });
                lineStateRef.current = nextLine;
                setLine(nextLine);
                setLeaving(snapshot);
            } else {
                const nextLine: LineState = { ...cur, text: nextText, trans: nextTrans, data: nextData };
                lineStateRef.current = nextLine;
                setLine(nextLine);
            }

            latestDataRef.current = nextData;

            const nextThemeSig = JSON.stringify(data.coverTheme ?? null);
            if (nextThemeSig !== themeSigRef.current) {
                themeSigRef.current = nextThemeSig;
                setCoverTheme(data.coverTheme ?? null);
            }
            prevProgressRef.current = nextProgress;

            // 行变化时由 line.key effect 在渲染完成后重测(对应旧 nextTick)
            if (!lineChanged) scheduleKtvUpdate();
        },
        [scheduleKtvUpdate]
    );

    /** 行切换后:渲染完成再测量新行布局(对应旧 nextTick(scheduleKtvProgressUpdate)) */
    useEffect(() => {
        metricsRef.current = null;
        scheduleKtvUpdate();
    }, [line.key, scheduleKtvUpdate]);

    /** 离场行在过渡结束后移除 */
    useEffect(() => {
        if (!leaving) return;
        const timer = setTimeout(() => setLeaving(null), LINE_TRANSITION_MS);
        return () => clearTimeout(timer);
    }, [leaving]);

    /** 内容区高度变化 → 重测布局 */
    useEffect(() => {
        metricsRef.current = null;
        scheduleKtvUpdate();
    }, [mainContentHeight, scheduleKtvUpdate]);

    // ---- 字号:按内容区高度自适应(与旧实现一致,config.fontSize 不直接参与) ----

    const hasTrans = config.showTranslation && line.trans !== "";
    const computedFontSize = hasTrans
        ? Math.max(16, Math.floor(mainContentHeight * 0.55))
        : Math.max(20, Math.floor(mainContentHeight * 0.75));
    const transScale = (config.transFontSizeScale ?? 23) / 100;
    const computedTransFontSize = Math.max(12, Math.floor(mainContentHeight * transScale));

    const lyricFontFamily = config.lyricFontFamily?.trim() || "inherit";
    const translationFontFamily = config.translationFontFamily?.trim() || "inherit";

    /** 字号/字体/字重变化会使已测量的 KTV 布局失效(对应旧 layoutStyleSignature) */
    useEffect(() => {
        metricsRef.current = null;
    }, [computedFontSize, lyricFontFamily, config.lyricFontWeight]);

    // ---- IPC 订阅与初始化 ----

    useEffect(() => {
        let disposed = false;
        const unsubs: Array<() => void> = [];

        void (async () => {
            try {
                const info = await window.desktopAPI.getAppInfo();
                if (!disposed) setIsWayland(Boolean(info?.isWayland));
            } catch {
                /* 环境信息获取失败时按非 Wayland 处理 */
            }
            try {
                const initial = await window.desktopAPI.getLyricConfig();
                if (!disposed && initial) setConfig((prev) => ({ ...prev, ...initial }));
            } catch {
                /* 保持默认配置 */
            }
        })();

        unsubs.push(window.desktopAPI.onLyricChange(handleLyricChange));
        unsubs.push(window.desktopAPI.onStatusChange((state) => setIsPlaying(Boolean(state))));
        unsubs.push(
            window.desktopAPI.onConfigChanged((newConfig) => {
                if (newConfig) setConfig((prev) => ({ ...prev, ...newConfig }));
            })
        );
        unsubs.push(window.desktopAPI.onSongChange((label) => setSongLabel(label || "")));
        // 主进程侧程序化调整窗口尺寸(Wayland 原生 resize 也走这里)
        unsubs.push(
            window.desktopAPI.onWindowResized((_width, height) => {
                setMainContentHeight(Math.max(50, height - LAYOUT_OVERHEAD));
            })
        );

        return () => {
            disposed = true;
            for (const unsub of unsubs) unsub();
        };
    }, [handleLyricChange]);

    /** 窗口自身 resize 事件(与主进程事件互为兜底,同旧实现) */
    useEffect(() => {
        const onResize = () => {
            setMainContentHeight(Math.max(50, window.innerHeight - LAYOUT_OVERHEAD));
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    // ---- 拖动 / 调整大小(非 Wayland:JS 实现;Wayland:原生 app-region + 原生边缘 resize) ----

    const startDrag = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (configRef.current.isLock || isWaylandRef.current) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target && (target.closest(".item") || target.closest(".resize-handle"))) return;

        const state: InteractionState = {
            mode: "drag",
            dir: null,
            startX: event.screenX,
            startY: event.screenY,
            startWinX: 0,
            startWinY: 0,
            winWidth: 0,
            winHeight: 0,
            ready: false,
            lastX: 0,
            lastY: 0,
        };
        interactionRef.current = state;
        setIsDragging(true);

        void window.desktopAPI
            .getLyricBounds()
            .then((bounds) => {
                if (interactionRef.current !== state) return;
                state.startWinX = bounds.x;
                state.startWinY = bounds.y;
                state.winWidth = bounds.width;
                state.winHeight = bounds.height;
                state.lastX = bounds.x;
                state.lastY = bounds.y;
                state.ready = true;
            })
            .catch(() => {
                if (interactionRef.current === state) {
                    interactionRef.current = null;
                    setIsDragging(false);
                }
            });
    }, []);

    const startResize = useCallback((event: ReactMouseEvent<HTMLDivElement>, dir: ResizeDir) => {
        if (configRef.current.isLock || isWaylandRef.current) return;
        event.stopPropagation();
        event.preventDefault();

        const state: InteractionState = {
            mode: "resize",
            dir,
            startX: event.screenX,
            startY: event.screenY,
            startWinX: 0,
            startWinY: 0,
            winWidth: 0,
            winHeight: 0,
            ready: false,
            lastX: 0,
            lastY: 0,
        };
        interactionRef.current = state;

        void window.desktopAPI
            .getLyricBounds()
            .then((bounds) => {
                if (interactionRef.current !== state) return;
                state.startWinX = bounds.x;
                state.startWinY = bounds.y;
                state.winWidth = bounds.width;
                state.winHeight = bounds.height;
                state.ready = true;
            })
            .catch(() => {
                if (interactionRef.current === state) interactionRef.current = null;
            });
    }, []);

    useEffect(() => {
        const onMouseMove = (event: MouseEvent) => {
            const state = interactionRef.current;
            if (!state || !state.ready) return;

            const deltaX = event.screenX - state.startX;
            const deltaY = event.screenY - state.startY;

            if (state.mode === "drag") {
                const x = state.startWinX + deltaX;
                const y = state.startWinY + deltaY;
                state.lastX = x;
                state.lastY = y;
                window.desktopAPI.lyricWindow({ type: "move", x, y });
                return;
            }

            const dir = state.dir ?? "";
            let newX = state.startWinX;
            let newY = state.startWinY;
            let newW = state.winWidth;
            let newH = state.winHeight;

            if (dir.includes("top")) {
                newY = state.startWinY + deltaY;
                newH = state.winHeight - deltaY;
            } else if (dir.includes("bottom")) {
                newH = state.winHeight + deltaY;
            }

            if (dir.includes("left")) {
                newX = state.startWinX + deltaX;
                newW = state.winWidth - deltaX;
            } else if (dir.includes("right")) {
                newW = state.winWidth + deltaX;
            }

            if (newW < MIN_WIDTH) {
                if (dir.includes("left")) newX = state.startWinX + (state.winWidth - MIN_WIDTH);
                newW = MIN_WIDTH;
            }
            if (newH < MIN_HEIGHT) {
                if (dir.includes("top")) newY = state.startWinY + (state.winHeight - MIN_HEIGHT);
                newH = MIN_HEIGHT;
            }

            window.desktopAPI.lyricWindow({
                type: "resize",
                x: Math.floor(newX),
                y: Math.floor(newY),
                width: Math.floor(newW),
                height: Math.floor(newH),
            });

            // 由已知窗口高度直接推算内容区高度(与旧实现一致)
            setMainContentHeight(Math.max(50, Math.floor(newH) - LAYOUT_OVERHEAD));
        };

        const onMouseUp = () => {
            const state = interactionRef.current;
            interactionRef.current = null;
            setIsDragging(false);
            if (!state || !state.ready) return;

            if (state.mode === "drag") {
                // 拖动结束:保存位置
                window.desktopAPI.lyricWindow({
                    type: "save-position",
                    x: Math.floor(state.lastX),
                    y: Math.floor(state.lastY),
                });
            } else {
                // 调整大小结束:保存完整 bounds
                void window.desktopAPI
                    .getLyricBounds()
                    .then((bounds) => {
                        window.desktopAPI.lyricWindow({ type: "save-bounds", bounds });
                    })
                    .catch(() => {
                        /* 忽略,下次交互再保存 */
                    });
            }
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, []);

    // ---- 工具条动作 ----

    const showApp = useCallback(() => window.desktopAPI.windowControl("show-main"), []);
    const openSettings = useCallback(() => window.desktopAPI.windowControl("open-settings"), []);
    const playPrev = useCallback(() => window.desktopAPI.playerCommand("prev"), []);
    const playNext = useCallback(() => window.desktopAPI.playerCommand("next"), []);
    const playOrPause = useCallback(() => window.desktopAPI.playerCommand("playOrPause"), []);
    const closeLyric = useCallback(() => window.desktopAPI.lyricWindow({ type: "toggle-visibility" }), []);
    const toggleLock = useCallback(() => {
        const nextLock = !configRef.current.isLock;
        setConfig((prev) => ({ ...prev, isLock: nextLock }));
        window.desktopAPI.lyricWindow({ type: "set-lock", isLock: nextLock });
    }, []);

    // ---- 样式变量(对应旧 watchEffect 写入 #app 的 CSS 变量) ----

    const activeColor = (() => {
        if (config.useThemeColorForActive) {
            const shadeTwo = coverTheme?.light?.shadeTwo;
            if (shadeTwo) return `rgba(${shadeTwo}, 0.95)`;
            return "#efefef95";
        }
        return config.colorActive;
    })();

    const baseOpacity = isPlaying ? 1 : (config.pausedOpacity ?? 30) / 100;
    const appOpacity = ((baseOpacity * (config.overallOpacity || 100)) / 100).toFixed(2);

    const appStyle = {
        "--lyric-font-size": `${computedFontSize}px`,
        "--trans-font-size": `${computedTransFontSize}px`,
        "--lyric-font-family": lyricFontFamily,
        "--translation-font-family": translationFontFamily,
        "--lyric-font-weight": String(config.lyricFontWeight ?? 700),
        "--translation-font-weight": String(config.translationFontWeight ?? 400),
        "--main-color": hexToRgba(config.textColor, config.textOpacity),
        "--color-active": activeColor,
        "--color-inactive": config.colorInactive,
        "--lyric-stroke-width": `${config.strokeWidth}px`,
        "--lyric-stroke-color": config.strokeColor,
        "--hover-bg-color": config.bgColor,
        "--hover-bg-blur": `${config.bgBlur}px`,
        opacity: appOpacity,
    } as CSSProperties;

    const appClassName = [config.isLock ? "lock-lyric" : "", isDragging ? "is-dragging" : ""]
        .filter(Boolean)
        .join(" ");

    const setCurrentLineEl = useCallback((el: HTMLDivElement | null) => {
        currentLineElRef.current = el;
    }, []);

    // 进场动画仅在发生过行切换时启用(初始渲染不动画,同旧 Vue transition 行为)
    const enterClass = leaving ? " lyric-scroll-enter" : "";
    const transEnterClass = leaving && leaving.trans !== "" ? " lyric-scroll-enter" : "";

    return (
        <div id="app" className={appClassName} style={appStyle}>
            <div className="drag-area" onMouseDown={startDrag} />

            <Toolbar
                isPlaying={isPlaying}
                isLock={config.isLock}
                songLabel={songLabel}
                onShowApp={showApp}
                onOpenSettings={openSettings}
                onPlayPrev={playPrev}
                onPlayOrPause={playOrPause}
                onPlayNext={playNext}
                onToggleLock={toggleLock}
                onClose={closeLyric}
            />

            <main id="lyric-content">
                <div id="lyric-text-container" ref={containerRef}>
                    {leaving && (
                        <div key={`leave-${leaving.key}`} className="lyric-wrapper lyric-scroll-leave">
                            {leaving.data.length > 0 ? (
                                <div
                                    className="ktv-line"
                                    style={{
                                        backgroundPositionX: leaving.posX,
                                        transform: `translateX(${leaving.tx}px)`,
                                    }}
                                >
                                    {leaving.data.map((word, index) => (
                                        <span key={index} className="ktv-word">
                                            {word.content}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <div className="plain-line" style={{ transform: `translateX(${leaving.tx}px)` }}>
                                    {leaving.text || "MeT-Music"}
                                </div>
                            )}
                        </div>
                    )}

                    <div key={line.key} className={`lyric-wrapper${enterClass}`}>
                        {line.data.length > 0 ? (
                            <div
                                ref={setCurrentLineEl}
                                className="ktv-line"
                                style={{
                                    backgroundPositionX: ktv.posX,
                                    transform: `translateX(${ktv.tx}px)`,
                                }}
                            >
                                {line.data.map((word, index) => (
                                    <span key={index} className="ktv-word">
                                        {word.content}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <div
                                ref={setCurrentLineEl}
                                className="plain-line"
                                style={{ transform: `translateX(${ktv.tx}px)` }}
                            >
                                {line.text || "MeT-Music"}
                            </div>
                        )}
                    </div>
                </div>

                {hasTrans && (
                    <div id="lyric-tran-container">
                        {leaving && leaving.trans !== "" && (
                            <div key={`leave-${leaving.key}`} className="lyric-tran-wrapper lyric-scroll-leave">
                                <div id="lyric-tran">{leaving.trans}</div>
                            </div>
                        )}
                        <div key={line.key} className={`lyric-tran-wrapper${transEnterClass}`}>
                            <div id="lyric-tran">{line.trans}</div>
                        </div>
                    </div>
                )}
            </main>

            {RESIZE_DIRS.map((dir) => (
                <div
                    key={dir}
                    className={`resize-handle resize-${dir}`}
                    data-direction={dir}
                    onMouseDown={(event) => startResize(event, dir)}
                />
            ))}
        </div>
    );
}
