import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import {
  defaultExternalApiConfig,
  type ExternalApiConfig,
  type ExternalApiConfigPatch,
  type ExternalApiStatus,
} from "@shared/ipc";
import { NumberInput, Switch } from "./components";

/**
 * 外部 API 设置面板(HTTP + WebSocket)。
 *
 * 能力与 SPlayer-Next 的「外部 API」对齐(api.html / socket.html):
 * 默认关闭、默认只绑本机、无鉴权;WebSocket 与 HTTP 同端口,挂在 /ws,
 * 且必须先开外部 API 才生效。
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

/** 端点速查(与 main/external-api.ts 的路由一一对应) */
const ENDPOINTS: ReadonlyArray<{ method: string; path: string; desc: string }> = [
  { method: "GET", path: "/api/info", desc: "应用与连接信息" },
  { method: "GET", path: "/api/status", desc: "播放状态" },
  { method: "GET", path: "/api/volume", desc: "当前音量" },
  { method: "GET", path: "/api/now-playing", desc: "轻量播放快照" },
  { method: "GET", path: "/api/lyrics", desc: "当前曲目完整歌词" },
  { method: "POST", path: "/api/play", desc: "播放" },
  { method: "POST", path: "/api/pause", desc: "暂停" },
  { method: "POST", path: "/api/stop", desc: "停止" },
  { method: "POST", path: "/api/next", desc: "下一曲" },
  { method: "POST", path: "/api/prev", desc: "上一曲" },
  { method: "POST", path: "/api/seek", desc: "跳转({ positionMs })" },
  { method: "POST", path: "/api/volume", desc: "设置音量({ volume })" },
];

/** WebSocket 命令速查(客户端 → 服务器的 op) */
const WS_OPS: ReadonlyArray<{ op: string; desc: string }> = [
  { op: "play / pause / stop", desc: "播放 / 暂停 / 停止" },
  { op: "next / prev", desc: "下一曲 / 上一曲" },
  { op: "seek", desc: "跳转,附 positionMs(毫秒)" },
  { op: "setVolume", desc: "音量,附 volume(0 ~ 1)" },
];

export default function ExternalApiPanel(): React.JSX.Element {
  const [config, setConfig] = useState<ExternalApiConfig>(defaultExternalApiConfig);
  const [status, setStatus] = useState<ExternalApiStatus>(DEFAULT_STATUS);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

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

  const displayHost = status.lanAddress ?? "127.0.0.1";
  const httpBase = `http://${displayHost}:${config.port}/api`;
  const wsBase = `ws://${displayHost}:${config.port}/ws`;

  const statusText = status.error
    ? `启动失败：${status.error}`
    : status.running
      ? `运行中 · 监听 ${status.host}:${status.port}`
      : "未运行";
  const statusTone = status.error ? "error" : status.running ? "ok" : "idle";

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
        <h3>端点速查</h3>
        <div className="setting-item api-table">
          {ENDPOINTS.map((item) => (
            <div className="api-row" key={`${item.method} ${item.path}`}>
              <span className={`api-method api-method-${item.method.toLowerCase()}`}>
                {item.method}
              </span>
              <code className="api-path">{item.path}</code>
              <span className="api-desc">{item.desc}</span>
            </div>
          ))}
        </div>
        <div className="setting-item api-table">
          {WS_OPS.map((item) => (
            <div className="api-row" key={item.op}>
              <span className="api-method api-method-ws">WS</span>
              <code className="api-path">{item.op}</code>
              <span className="api-desc">{item.desc}</span>
            </div>
          ))}
        </div>
        <p className="api-note">
          时间单位均为毫秒；控制类接口成功返回 {"{ ok: true }"}，参数非法返回 400。 WebSocket
          下行消息带 kind 字段（hello / event / ack / error）。
        </p>
      </section>
    </div>
  );
}
