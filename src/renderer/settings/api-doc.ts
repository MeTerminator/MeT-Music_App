/**
 * 外部 API 文档的单一事实来源。
 *
 * 设置窗里的说明表格与「复制文档 Markdown」按钮共用这里的数据 ——
 * 两边各写一份的话,改了端点必然漏掉其中一边,而复制出去的文档是要贴给
 * 别人照着接的,过期的文档比没有文档更糟。
 *
 * 内容与 main/external-api.ts 的路由、main/index.ts 的事件广播一一对应,
 * 改那两处时记得同步这里。
 */

export interface EndpointDoc {
  method: "GET" | "POST";
  path: string;
  desc: string;
  /** 请求体(仅 POST 且需要参数时) */
  body?: string;
  /** 响应示例 */
  response: string;
}

export const ENDPOINTS: readonly EndpointDoc[] = [
  {
    method: "GET",
    path: "/api/info",
    desc: "应用名、版本与当前 WebSocket 连接数",
    response: '{ "name": "MeT-MusicQ", "version": "2.0.0", "wsClients": 0 }',
  },
  {
    method: "GET",
    path: "/api/status",
    desc: "播放状态、进度、时长与音量",
    response:
      '{ "state": "playing", "position": 12000, "duration": 240000, "volume": 1, "isFinished": false }',
  },
  {
    method: "GET",
    path: "/api/volume",
    desc: "当前音量",
    response: '{ "volume": 1 }',
  },
  {
    method: "GET",
    path: "/api/now-playing",
    desc: "轻量播放快照：曲目信息 + 当前歌词行，不含歌词正文全量，适合频繁轮询",
    response:
      '{ "state": "playing", "position": 12000, "duration": 240000, "volume": 1,\n' +
      '  "isFinished": false, "id": "0039MnYb0qxYhV", "name": "晴天", "artist": "周杰伦",\n' +
      '  "album": "叶惠美", "cover": "https://…", "lyricAvailable": true,\n' +
      '  "lyricLineCount": 42, "lyricText": "故事的小黄花", "lyricTrans": "" }',
  },
  {
    method: "GET",
    path: "/api/lyrics",
    desc: "当前曲目的完整解析歌词；source 为 yrc（逐字）/ lrc（逐行）/ none，offset 为歌词偏移设置",
    response:
      '{ "source": "yrc", "offset": 400, "lines": [\n' +
      '  { "time": 27000, "endTime": 31000, "content": "故事的小黄花", "tran": "",\n' +
      '    "words": [{ "content": "故", "start": 27000, "end": 27300 }] }\n' +
      "] }",
  },
  {
    method: "POST",
    path: "/api/play",
    desc: "播放（已在播放则无副作用）",
    response: '{ "ok": true }',
  },
  {
    method: "POST",
    path: "/api/pause",
    desc: "暂停（已暂停则无副作用）",
    response: '{ "ok": true }',
  },
  { method: "POST", path: "/api/stop", desc: "停止播放", response: '{ "ok": true }' },
  { method: "POST", path: "/api/next", desc: "下一曲", response: '{ "ok": true }' },
  { method: "POST", path: "/api/prev", desc: "上一曲", response: '{ "ok": true }' },
  {
    method: "POST",
    path: "/api/seek",
    desc: "跳转到指定位置",
    body: '{ "positionMs": 60000 }  // 毫秒，≥ 0',
    response: '{ "ok": true }',
  },
  {
    method: "POST",
    path: "/api/volume",
    desc: "设置音量",
    body: '{ "volume": 0.5 }  // 0 ~ 1',
    response: '{ "ok": true }',
  },
];

/** 服务器 → 客户端消息(全部带 kind 字段) */
export const WS_DOWN: readonly { kind: string; shape: string; desc: string }[] = [
  {
    kind: "hello",
    shape: '{ "kind": "hello", "clients": 1 }',
    desc: "连接建立时发送，附当前连接数；随后补发一次 track + state 快照",
  },
  {
    kind: "event",
    shape: '{ "kind": "event", "type": "progress", "data": { … } }',
    desc: "播放事件推送（见下表）",
  },
  { kind: "ack", shape: '{ "kind": "ack", "op": "pause" }', desc: "命令执行成功的回执" },
  {
    kind: "error",
    shape: '{ "kind": "error", "op": "seek", "error": "…" }',
    desc: "命令失败，error 为原因；非法 JSON 时 op 为 null",
  },
];

/** event 消息的 type 与 data(对应 main/index.ts 的 broadcastPlaybackEvents
 *  与 main/external-api.ts 的 sendHelloSnapshot) */
export const WS_EVENTS: readonly { type: string; data: string; desc: string }[] = [
  {
    type: "track",
    data: '{ "id", "name", "artist", "cover", "duration" }',
    desc: "切歌时推送一次；连接建立后也补发一次当前曲目（duration 为毫秒）",
  },
  {
    type: "state",
    data: '{ "state", "position", "duration" }',
    desc: "播放 / 暂停状态变化时推送；连接建立后也补发一次当前状态",
  },
  {
    type: "progress",
    data: '{ "position", "duration", "lyricText" }',
    desc: "播放中每秒一次（播放器暂停后不再推送）",
  },
];

/** 客户端 → 服务器命令 */
export const WS_OPS: readonly { op: string; args: string; desc: string }[] = [
  { op: "play / pause / stop", args: "—", desc: "播放 / 暂停 / 停止" },
  { op: "next / prev", args: "—", desc: "下一曲 / 上一曲" },
  { op: "seek", args: '{ "positionMs": number }', desc: "跳转（毫秒，≥ 0）" },
  { op: "setVolume", args: '{ "volume": number }', desc: "音量（0 ~ 1）" },
];

/** 通用约定(界面与 Markdown 共用) */
export const CONVENTIONS: readonly string[] = [
  "数据格式：请求与响应均为 JSON（Content-Type: application/json）",
  "时间单位：毫秒（ms）",
  '成功响应：控制类接口返回 { "ok": true }',
  '错误响应：参数非法返回 400，未知路由返回 404，响应体为 { "error": "<原因>" }',
  "播放器未就绪（主窗未加载或 UI 版本过旧）时，取数类接口返回 501",
  "跨域：响应带 Access-Control-Allow-Origin: *，浏览器脚本可直接调用",
  "鉴权：无。默认仅绑定 127.0.0.1；开启「允许局域网访问」后绑定 0.0.0.0，请仅在可信网络中使用",
];

export interface ApiDocContext {
  /** 文档里示例使用的地址(局域网开启且拿到网卡地址时为该地址,否则 127.0.0.1) */
  host: string;
  port: number;
  wsEnabled: boolean;
}

/** 生成可直接贴给别人的接口文档(Markdown) */
export const buildApiDocMarkdown = ({ host, port, wsEnabled }: ApiDocContext): string => {
  const base = `http://${host}:${port}/api`;
  const wsUrl = `ws://${host}:${port}/ws`;

  const endpointRows = ENDPOINTS.map(
    (item) => `| ${item.method} | \`${item.path}\` | ${item.desc} |`,
  ).join("\n");

  const endpointDetails = ENDPOINTS.map((item) => {
    const parts = [`### ${item.method} ${item.path}\n\n${item.desc}`];
    if (item.body) parts.push(`请求体\n\n\`\`\`json\n${item.body}\n\`\`\``);
    parts.push(`响应\n\n\`\`\`json\n${item.response}\n\`\`\``);
    return parts.join("\n\n");
  }).join("\n\n");

  const downRows = WS_DOWN.map(
    (item) => `| \`${item.kind}\` | \`${item.shape}\` | ${item.desc} |`,
  ).join("\n");
  const eventRows = WS_EVENTS.map(
    (item) => `| \`${item.type}\` | \`${item.data}\` | ${item.desc} |`,
  ).join("\n");
  const opRows = WS_OPS.map(
    (item) => `| \`${item.op}\` | ${item.args === "—" ? "—" : `\`${item.args}\``} | ${item.desc} |`,
  ).join("\n");

  return `# MeT-Music 外部 API

本地 HTTP / WebSocket 接口，用于查询播放状态与控制播放。
在客户端「设置 → 外部 API」中开启（默认关闭）。

## 约定

- 基础路径：\`${base}\`
- 默认端口：\`14558\`（当前 \`${port}\`，可在设置中修改；HTTP 与 WebSocket 共用）
${CONVENTIONS.map((line) => `- ${line}`).join("\n")}

## 端点总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
${endpointRows}

## 端点详情

${endpointDetails}

## WebSocket

需在外部 API 之上额外开启${wsEnabled ? "" : "（当前未启用）"}。

- 地址：\`${wsUrl}\`

### 服务器 → 客户端

| kind | 形态 | 说明 |
| --- | --- | --- |
${downRows}

事件（\`kind: "event"\`）的 type：

| type | data | 说明 |
| --- | --- | --- |
${eventRows}

### 客户端 → 服务器

命令为 JSON，统一通过 \`op\` 字段标识；非法 JSON 或未知 op 会收到 \`error\`。

| op | 附加字段 | 说明 |
| --- | --- | --- |
${opRows}

## 示例

\`\`\`bash
# 查询播放状态
curl ${base}/status

# 播放 / 暂停 / 下一曲
curl -X POST ${base}/play
curl -X POST ${base}/pause
curl -X POST ${base}/next

# 跳转到 1 分钟处
curl -X POST ${base}/seek \\
  -H "Content-Type: application/json" \\
  -d '{ "positionMs": 60000 }'

# 设置音量为 50%
curl -X POST ${base}/volume \\
  -H "Content-Type: application/json" \\
  -d '{ "volume": 0.5 }'
\`\`\`

\`\`\`javascript
const ws = new WebSocket("${wsUrl}");

ws.onopen = () => {
  ws.send(JSON.stringify({ op: "pause" }));
  ws.send(JSON.stringify({ op: "seek", positionMs: 60000 }));
};

ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  switch (msg.kind) {
    case "hello":
      console.log("已连接，当前客户端数：", msg.clients);
      break;
    case "event":
      console.log("播放事件：", msg.type, msg.data);
      break;
    case "ack":
      console.log("命令成功：", msg.op);
      break;
    case "error":
      console.warn("命令失败：", msg.op, msg.error);
      break;
  }
};
\`\`\`
`;
};
