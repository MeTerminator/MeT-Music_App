import asyncio
import websockets
import json
import requests
import urllib3
import re
import time
import ssl
from typing import Callable, Optional

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class RealtimeLyricsPlayer:
    def __init__(self, session_id: str, lyric_callback: Optional[Callable] = None):
        self.SID = session_id
        self.ws: websockets.ClientConnection | None = None
        self.server_local_time_diff = 0
        self.music_status = False
        self.current_song_mid = ""
        self.current_server_start_time = 0
        self.last_update_ts = 0
        self.lyrics_cache = {}

        self.song_lyrics = ""
        self.parsed_lyrics: list[dict] = []

        self.status_task: asyncio.Task | None = None
        self.lyrics_task: asyncio.Task | None = None
        self.time_sync_task: asyncio.Task | None = None
        self.lyric_callback: Optional[Callable] = lyric_callback

    def _parse_lyrics(self, lyric_text: str):
        self.parsed_lyrics = []

        time_tag_pattern = re.compile(r'\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]')
        lines = lyric_text.splitlines()

        for line in lines:
            line = line.strip()
            if not line:
                continue

            tags = list(time_tag_pattern.finditer(line))
            if not tags:
                continue

            text = time_tag_pattern.sub('', line).strip()
            if not text:
                continue

            for tag in tags:
                try:
                    minutes = int(tag.group(1))
                    seconds = int(tag.group(2))
                    ms_str = tag.group(3) or '0'
                    ms = int(ms_str.ljust(3, '0')[:3])
                    time_ms = (minutes * 60 + seconds) * 1000 + ms
                    self.parsed_lyrics.append(
                        {"time_ms": time_ms, "text": text}
                    )
                except:
                    pass

        self.parsed_lyrics.sort(key=lambda x: x["time_ms"])

    async def _fetch_lyrics(self, mid: str) -> bool:
        try:
            if mid in self.lyrics_cache:
                self.song_lyrics = self.lyrics_cache[mid]
                self._parse_lyrics(self.song_lyrics)
                return True

            url = f"https://music.met6.top:444/api/songlyric_get.php?show=lyric&mid={mid}"
            response = requests.get(url, timeout=5, verify=False)

            if response.status_code == 200:
                self.song_lyrics = response.text
                self.lyrics_cache[mid] = self.song_lyrics
                self._parse_lyrics(self.song_lyrics)
                return True
            else:
                self.song_lyrics = ""
                return False
        except:
            return False

    async def _connect_websocket(self):
        if self.ws is not None and getattr(self.ws, 'closed', False):
            self.ws = None

        if self.ws is None:
            try:
                ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE

                self.ws = await websockets.connect(
                    "wss://music.met6.top:444/api-client/ws/listen",
                    ssl=ssl_context
                )

                # 首次时间同步
                await self._send_ws({"type": "time"})
                await self._send_ws({"type": "listen", "SessionId": [self.SID]})

                # 启动状态检测
                if self.status_task is None or self.status_task.done():
                    self.status_task = asyncio.create_task(
                        self._status_check_task())

                # 启动时间同步任务（每 10 秒自动同步）
                if self.time_sync_task is None or self.time_sync_task.done():
                    self.time_sync_task = asyncio.create_task(
                        self._time_sync_task())

            except Exception:
                self.ws = None

    async def _send_ws(self, obj: dict):
        try:
            if self.ws is not None and not getattr(self.ws, 'closed', False):
                await self.ws.send(json.dumps(obj))
        except:
            pass

    async def _ws_handler(self):
        while True:
            try:
                if self.ws is None or getattr(self.ws, 'closed', False):
                    await self._connect_websocket()
                    if self.ws is None:
                        await asyncio.sleep(3)
                        continue

                message = await self.ws.recv()
                if message is None:
                    self.ws = None
                    await asyncio.sleep(1)
                    continue

                if isinstance(message, (bytes, bytearray)):
                    try:
                        message = message.decode('utf-8')
                    except:
                        continue

                data = json.loads(message)

                # 处理时间同步结果
                if data.get("type") == "time" and data.get("status") == "ok":
                    server_time_ms = data.get("timestamp")
                    if isinstance(server_time_ms, (int, float)):
                        local_time_ms = int(time.time() * 1000)
                        self.server_local_time_diff = int(
                            server_time_ms) - local_time_ms

                # feedback / play
                if data.get("type") in ["feedback", "play"] and data.get("data"):
                    session_field = data.get("SessionId")
                    matched = (self.SID in session_field) if isinstance(
                        session_field, list) else (session_field == self.SID)

                    if matched:
                        self.last_update_ts = int(time.time() * 1000)

                        payload = data["data"]
                        new_status = bool(payload.get("status", False))
                        new_mid = payload.get("songMid", "") or ""

                        try:
                            system_time = int(payload.get("systemTime", 0))
                        except:
                            system_time = 0
                        try:
                            current_time_sec = float(
                                payload.get("currentTime", 0))
                        except:
                            current_time_sec = 0.0

                        music_start_ts = system_time - \
                            int(current_time_sec * 1000)
                        await self._update_music_status(new_status, new_mid, music_start_ts)

            except websockets.ConnectionClosedOK:
                self.ws = None
                await asyncio.sleep(3)
            except websockets.ConnectionClosedError:
                self.ws = None
                await asyncio.sleep(3)
            except asyncio.CancelledError:
                raise
            except Exception:
                await asyncio.sleep(1)

    async def _time_sync_task(self):
        """每 10 秒发送一次时间同步请求"""
        while True:
            try:
                await asyncio.sleep(10)
                await self._send_ws({"type": "time"})
            except asyncio.CancelledError:
                raise
            except:
                await asyncio.sleep(5)

    async def _update_music_status(self, current_status: bool, current_mid: str, current_start_ts: int):
        is_new_song = current_mid != self.current_song_mid

        if current_status:
            self.music_status = True
            self.current_song_mid = current_mid
            self.current_server_start_time = current_start_ts

            if is_new_song and current_mid:
                try:
                    await self._fetch_lyrics(current_mid)
                except:
                    pass

            if self.lyrics_task is None or self.lyrics_task.done():
                self.lyrics_task = asyncio.create_task(
                    self._lyrics_print_task())
        else:
            self._handle_pause()

    def _handle_pause(self):
        self.music_status = False
        if self.lyrics_task and not self.lyrics_task.done():
            self.lyrics_task.cancel()
            self.lyrics_task = None

    async def _status_check_task(self):
        while True:
            await asyncio.sleep(5)

            now = int(time.time() * 1000)

            # 超过 12 秒未收到 feedback → 视为暂停
            if self.music_status and (now - self.last_update_ts > 12000):
                self._handle_pause()

            if self.ws is None or getattr(self.ws, 'closed', False):
                await self._connect_websocket()

    async def _lyrics_print_task(self):
        current_line_index = -1
        try:
            while self.music_status:
                local_time_ms = int(time.time() * 1000)
                server_time_ms = local_time_ms + self.server_local_time_diff
                current_play_time_ms = server_time_ms - self.current_server_start_time

                target_index = -1
                for i, item in enumerate(self.parsed_lyrics):
                    if item['time_ms'] <= current_play_time_ms:
                        target_index = i
                    else:
                        break

                if target_index >= 0 and target_index != current_line_index:
                    current_line_index = target_index
                    lyric_line = self.parsed_lyrics[current_line_index]['text']

                    clean_lyric = re.sub(
                        r'\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]', '', lyric_line).strip()

                    if clean_lyric and self.lyric_callback:
                        self.lyric_callback(clean_lyric)

                await asyncio.sleep(0.05)

        except asyncio.CancelledError:
            raise
        except:
            await asyncio.sleep(1)

    async def start(self):
        try:
            await self._ws_handler()
        except asyncio.CancelledError:
            pass
        finally:
            try:
                if self.ws and not getattr(self.ws, 'closed', False):
                    await self.ws.close()
            except:
                pass

            for task in [self.status_task, self.lyrics_task, self.time_sync_task]:
                if task and not task.done():
                    task.cancel()


def print_lyric(lyric: str):
    print(f"🎤 歌词: {lyric}")


if __name__ == "__main__":
    player = RealtimeLyricsPlayer("your_session_id_here", print_lyric)
    asyncio.run(player.start())
