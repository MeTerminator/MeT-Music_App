import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import {
  defaultExternalApiConfig,
  type ExternalApiConfig,
  type ExternalApiConfigPatch,
  type ExternalApiStatus,
} from "@shared/ipc";
import { NumberInput, Switch } from "./components";
import { buildApiDocMarkdown, CONVENTIONS, ENDPOINTS, WS_DOWN, WS_EVENTS, WS_OPS } from "./api-doc";

/**
 * 外部 API 设置面板(HTTP + WebSocket)。
 *
 * 能力与 SPlayer-Next 的「外部 API」对齐(api.html / socket.html):
 * 默认关闭、默认只绑本机、无鉴权;WebSocket 与 HTTP 同端口,挂在 /ws,
 * 且必须先开外部 API 才生效。
 *
 * 页内文档与「复制文档 Markdown」按钮共用 ./api-doc 的数据,改端点只需改那一处。
 *
 * 与歌词配置不同,这里**不做防抖**:每一项都会触发 main 侧起/停/换端口重启服务,
 * 攒批提交反而让「改端口」中间态起一次没人要的服务。端口输入本身是 onCommit
 * (失焦/回车)语义,不会边打字边重启。
 */

const DEFAULT_STATUS: ExternalApiStatus = {
  running: false,
  port: defaultExternalApiConfig().port,
  host: "127.0.0.1",
  lanAddress: null,
  wsClients: 0,
  error: null,
};

export default function ExternalApiPanel(): React.JSX.Element {
  const [config, setConfig] = useState<ExternalApiConfig>(defaultExternalApiConfig);
  const [status, setStatus] = useState<ExternalApiStatus>(DEFAULT_STATUS);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  /** 「复制文档 Markdown」的反馈:idle → copied / failed,2 秒回落 */
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimerRef = useRef<number | null>(null);

  const patchConfig = useCallback((patch: ExternalApiConfigPatch) => {
    if (!loadedRef.current) return;
    setConfig((prev) => ({ ...prev, ...patch }));
    window.desktopAPI.setExternalApiConfig(patch);
  }, []);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [current, currentStatus] = await Promise.all([
          window.desktopAPI.getExternalApiConfig(),
          window.desktopAPI.getExternalApiStatus(),
        ]);
        if (disposed) return;
        if (current) setConfig((prev) => ({ ...prev, ...current }));
        if (currentStatus) setStatus(currentStatus);
      } catch (error) {
        console.error("Failed to load external API config:", error);
      }
      loadedRef.current = true;
      if (!disposed) setLoaded(true);
    })();
    return () => {
      disposed = true;
    };
  }, []);

  // 配置回声(其他窗口改的、或本窗提交后 main 合并出的完整配置)
  useEffect(() => {
    return window.desktopAPI.onExternalApiConfigChanged((next) => {
      if (next) setConfig((prev) => ({ ...prev, ...next }));
    });
  }, []);

  // 运行状态(启停成功/失败、WebSocket 连接数变化)
  useEffect(() => {
    return window.desktopAPI.onExternalApiStatusChanged((next) => {
      if (next) setStatus(next);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const displayHost = status.lanAddress ?? "127.0.0.1";
  const httpBase = `http://${displayHost}:${config.port}/api`;
  const wsBase = `ws://${displayHost}:${config.port}/ws`;

  const statusText = status.error
    ? `启动失败：${status.error}`
    : status.running
      ? `运行中 · 监听 ${status.host}:${status.port}`
      : "未运行";
  const statusTone = status.error ? "error" : status.running ? "ok" : "idle";

  /**
   * 复制接口文档。剪贴板走主进程的 clipboard 模块 —— 设置窗的 session 只放行
   * local-fonts 权限,渲染端的 navigator.clipboard 会被 permission handler 挡下。
   * 文档里的地址用当前实际的 host/端口,复制出去可以直接照着请求。
   */
  const copyDoc = useCallback(async () => {
    const markdown = buildApiDocMarkdown({
      host: displayHost,
      port: config.port,
      wsEnabled: config.wsEnabled,
    });
    let ok = false;
    try {
      ok = await window.desktopAPI.copyText(markdown);
    } catch (error) {
      console.error("Failed to copy API doc:", error);
    }
    setCopyState(ok ? "copied" : "failed");
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopyState("idle");
    }, 2000);
  }, [config.port, config.wsEnabled, displayHost]);

  return (
    <div style={loaded ? undefined : { pointerEvents: "none", opacity: 0.5 }}>
      <section className="settings-section">
        <h3>外部 API</h3>

        <div className={`api-status api-status-${statusTone}`}>
          <span className="api-status-dot" />
          <span className="api-status-text">{statusText}</span>
        </div>

        <div className="setting-item flex-row">
          <label>启用外部 API</label>
          <Switch checked={config.enabled} onChange={(value) => patchConfig({ enabled: value })} />
        </div>

        <div className="setting-item">
          <label>服务端口</label>
          <div className="flex-row-gap">
            <NumberInput
              value={config.port}
              min={1}
              max={65535}
              onCommit={(value) => patchConfig({ port: Math.round(value) })}
            />
            <span className="api-hint">默认 14558，HTTP 与 WebSocket 共用</span>
          </div>
        </div>

        <div className="setting-item flex-row">
          <label>
            允许局域网访问
            <span className="api-sub">开启后绑定 0.0.0.0，同一网络内的设备都能控制播放</span>
          </label>
          <Switch
            checked={config.allowLan}
            onChange={(value) => patchConfig({ allowLan: value })}
          />
        </div>

        <p className="api-note">
          服务不含任何鉴权：默认仅绑定
          127.0.0.1（本机可访问）。如需局域网访问，请仅在可信网络中开启。
        </p>
      </section>

      <section className="settings-section">
        <h3>WebSocket</h3>

        <div className="setting-item flex-row">
          <label>
            启用 WebSocket
            <span className="api-sub">需先启用外部 API；提供实时事件推送与控制命令</span>
          </label>
          <Switch
            checked={config.wsEnabled}
            onChange={(value) => patchConfig({ wsEnabled: value })}
          />
        </div>

        {config.enabled && config.wsEnabled && (
          <div className="setting-item flex-row">
            <label>当前连接数</label>
            <span className="api-value">{status.wsClients}</span>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h3>接入地址</h3>
        <div className="setting-item">
          <label>HTTP 基础路径</label>
          <code className="api-code">{httpBase}</code>
          <label>WebSocket 地址</label>
          <code className="api-code">{config.wsEnabled ? wsBase : "（未启用）"}</code>
        </div>
      </section>

      <section className="settings-section">
        <div className="api-doc-header">
          <h3>接口文档</h3>
          <button
            type="button"
            className={`btn btn-secondary btn-copy${copyState === "idle" ? "" : ` is-${copyState}`}`}
            onClick={() => void copyDoc()}
          >
            {copyState === "copied"
              ? "已复制"
              : copyState === "failed"
                ? "复制失败"
                : "复制文档 Markdown"}
          </button>
        </div>

        <div className="setting-item">
          <label>通用约定</label>
          <ul className="api-list">
            <li>
              基础路径：<code>{httpBase}</code>
            </li>
            {CONVENTIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="setting-item api-table">
          <label>HTTP 端点</label>
          {ENDPOINTS.map((item) => (
            <div className="api-row" key={`${item.method} ${item.path}`}>
              <span className={`api-method api-method-${item.method.toLowerCase()}`}>
                {item.method}
              </span>
              <code className="api-path">{item.path}</code>
              <span className="api-desc" title={item.desc}>
                {item.desc}
              </span>
            </div>
          ))}
        </div>

        <div className="setting-item">
          <label>请求 / 响应示例</label>
          <pre className="api-block">
            {[
              `GET ${httpBase}/status`,
              "→ " + ENDPOINTS.find((item) => item.path === "/api/status")!.response,
              "",
              `POST ${httpBase}/seek`,
              "← " + ENDPOINTS.find((item) => item.path === "/api/seek")!.body,
              "→ " + '{ "ok": true }',
            ].join("\n")}
          </pre>
        </div>
      </section>

      <section className="settings-section">
        <h3>WebSocket 协议</h3>

        <div className="setting-item">
          <label>地址</label>
          <code className="api-code">{config.wsEnabled ? wsBase : "（未启用）"}</code>
        </div>

        <div className="setting-item api-table">
          <label>服务器 → 客户端（kind）</label>
          {WS_DOWN.map((item) => (
            <div className="api-row" key={item.kind}>
              <span className="api-method api-method-ws">{item.kind}</span>
              <span className="api-desc" title={item.desc}>
                {item.desc}
              </span>
            </div>
          ))}
        </div>

        <div className="setting-item api-table">
          <label>事件类型（kind: event）</label>
          {WS_EVENTS.map((item) => (
            <div className="api-row" key={item.type}>
              <code className="api-path api-path-wide">{item.type}</code>
              <span className="api-desc" title={`${item.data} — ${item.desc}`}>
                {item.data}
              </span>
            </div>
          ))}
        </div>

        <div className="setting-item api-table">
          <label>客户端 → 服务器（op）</label>
          {WS_OPS.map((item) => (
            <div className="api-row" key={item.op}>
              <code className="api-path api-path-wide">{item.op}</code>
              <span className="api-desc" title={`${item.args} — ${item.desc}`}>
                {item.desc}
              </span>
            </div>
          ))}
        </div>

        <p className="api-note">
          完整端点详情、字段说明与 curl / JavaScript 示例都在「复制文档 Markdown」里，
          贴到编辑器或发给别人即可照着接入。
        </p>
      </section>
    </div>
  );
}
