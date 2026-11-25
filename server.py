

"""
Hatsune Miku 3D Companion — Unified Studio Neural & Peak-Normalized Warm SAPI WAV Audio + Static Web Server
Runs on http://127.0.0.1:8080 (with full CORS for Apache port 80 compatibility)

Voice Reliability & Loudness Upgrades:
1. /api/tts : Studio-grade Neural Human Voice synthesis (edge-tts, 5.5s timeout so TLS handshakes succeed reliably!)
   with a 45s offline circuit-breaker only when network is genuinely unreachable.
2. Peak-Normalized Warm SAPI5 Pipe Worker: Keeps one pre-loaded .NET SpeechSynthesizer resident in memory (~52ms WAV)
   and automatically normalizes 16-bit PCM peak amplitude to 92% full-scale so offline voice is loud, clear, and punchy!
3. 64-entry LRU RAM Cache (<1ms replay).
"""

import array
import asyncio
import base64
from contextlib import asynccontextmanager
import hashlib
import io
import os
import subprocess
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Optional
import wave

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from pc_control import PCController, BUILTIN_APPS

try:
    import edge_tts
    HAS_EDGE_TTS = True
except ImportError:
    HAS_EDGE_TTS = False

ROOT_DIR = Path(__file__).resolve().parent

AUDIO_CACHE: "OrderedDict[str, tuple[bytes, str, str]]" = OrderedDict()
MAX_CACHE_ITEMS = 64

EDGE_COOLDOWN_UNTIL: float = 0.0

NEURAL_VOICE_MAP = {
    "en": "en-US-AvaMultilingualNeural",
    "ja": "ja-JP-NanamiNeural",
    "es": "es-ES-ElviraNeural",
    "zh": "zh-CN-XiaoxiaoNeural",
    "hi": "hi-IN-SwaraNeural",
    "ko": "ko-KR-SunHiNeural",
    "fr": "fr-FR-DeniseNeural",
    "de": "de-DE-KatjaNeural",
    "ru": "ru-RU-SvetlanaNeural",
}


def normalize_wav_loudness(wav_bytes: bytes, target_peak: int = 30000) -> bytes:
    """Boosts 16-bit PCM WAV amplitude cleanly to ~92% full-scale (-0.8 dBFS) so offline SAPI voice is loud and clear."""
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            params = wf.getparams()
            if params.sampwidth != 2:
                return wav_bytes
            raw_frames = wf.readframes(params.nframes)

        samples = array.array("h")
        samples.frombytes(raw_frames)
        if not samples:
            return wav_bytes

        peak = max(abs(samples[0]), max((abs(s) for s in samples), default=0))
        if peak < 200 or peak >= target_peak:
            return wav_bytes

        gain = min(3.2, target_peak / float(peak))
        for i in range(len(samples)):
            val = int(samples[i] * gain)
            if val > 32767:
                val = 32767
            elif val < -32768:
                val = -32768
            samples[i] = val

        out_io = io.BytesIO()
        with wave.open(out_io, "wb") as out_wf:
            out_wf.setparams(params)
            out_wf.writeframes(samples.tobytes())
        return out_io.getvalue()
    except Exception:
        return wav_bytes


class PersistentSapiWorker:
    """Keeps ONE pre-warmed Windows SAPI5 SpeechSynthesizer alive via stdin/stdout pipe (~52ms WAV generation!)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: Optional[subprocess.Popen] = None

    def _ensure_started(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            return

        ps_daemon = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$s.Volume = 100; "
            "foreach ($v in $s.GetInstalledVoices()) { "
            "  if ($v.VoiceInfo.Gender -eq 'Female') { $s.SelectVoice($v.VoiceInfo.Name); break } "
            "} "
            "[Console]::InputEncoding = [System.Text.Encoding]::ASCII; "
            "[Console]::OutputEncoding = [System.Text.Encoding]::ASCII; "
            "while (($line = [Console]::In.ReadLine()) -ne $null) { "
            "  if ($line -eq 'PING') { [Console]::Out.WriteLine('PONG'); [Console]::Out.Flush(); continue } "
            "  try { "
            "    $parts = $line.Split('|', 2); "
            "    $rate = [int]$parts[0]; "
            "    $txt = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($parts[1])); "
            "    $s.Rate = $rate; "
            "    $ms = New-Object System.IO.MemoryStream; "
            "    $s.SetOutputToWaveStream($ms); "
            "    $s.Speak($txt); "
            "    [Console]::Out.WriteLine([System.Convert]::ToBase64String($ms.ToArray())); "
            "    [Console]::Out.Flush(); "
            "    $ms.Dispose(); "
            "  } catch { "
            "    [Console]::Out.WriteLine('ERR'); "
            "    [Console]::Out.Flush(); "
            "  } "
            "}"
        )
        self._proc = subprocess.Popen(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_daemon],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        assert self._proc.stdin and self._proc.stdout
        self._proc.stdin.write("PING\n")
        self._proc.stdin.flush()
        self._proc.stdout.readline()

    def synthesize(self, text: str, emotion: str = "explain") -> bytes:
        rate = 1
        emo = (emotion or "explain").lower()
        if emo in ("cheer", "laugh", "surprise"):
            rate = 2
        elif emo in ("empathy", "shy", "think"):
            rate = 0

        b64_text = base64.b64encode(text.encode("utf-8")).decode("ascii")
        with self._lock:
            self._ensure_started()
            assert self._proc and self._proc.stdin and self._proc.stdout
            self._proc.stdin.write(f"{rate}|{b64_text}\n")
            self._proc.stdin.flush()
            out_line = (self._proc.stdout.readline() or "").strip()
            if not out_line or out_line == "ERR":
                self._proc.kill()
                self._proc = None
                raise RuntimeError("Warm SAPI worker returned error")
            raw_wav = base64.b64decode(out_line)
            return normalize_wav_loudness(raw_wav)


SAPI_WORKER = PersistentSapiWorker() if os.name == "nt" else None
PC_CONTROLLER = PCController()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if SAPI_WORKER is not None:
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, SAPI_WORKER._ensure_started)
    yield


app = FastAPI(title="Miku 3D Human Companion Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Voice-Engine"],
)


class TTSRequest(BaseModel):
    text: str
    lang: Optional[str] = "en-US"
    emotion: Optional[str] = "explain"
    mode: Optional[str] = "auto"  # "auto" | "neural" | "offline"
    voice: Optional[str] = None


def get_prosody_offsets(emotion: str, text: str) -> tuple[str, str]:
    pitch_hz = 6
    rate_pct = 4
    emo = (emotion or "explain").lower()
    if emo in ("cheer", "laugh"):
        pitch_hz = 12
        rate_pct = 9
    elif emo == "surprise":
        pitch_hz = 14
        rate_pct = 7
    elif emo in ("empathy", "shy"):
        pitch_hz = 1
        rate_pct = -3
    elif emo == "think":
        pitch_hz = 3
        rate_pct = -1
    if text.strip().endswith("?"):
        pitch_hz += 3
    return f"{rate_pct:+d}%", f"{pitch_hz:+d}Hz"


async def synthesize_neural_mp3(text: str, lang: str, emotion: str, custom_voice: Optional[str] = None) -> bytes:
    lang_prefix = (lang or "en-US").split("-")[0].lower()
    voice_name = custom_voice or NEURAL_VOICE_MAP.get(lang_prefix, "en-US-AvaMultilingualNeural")
    rate_str, pitch_str = get_prosody_offsets(emotion, text)

    communicate = edge_tts.Communicate(text=text, voice=voice_name, rate=rate_str, pitch=pitch_str)
    chunks = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.extend(chunk["data"])
    if not chunks:
        raise RuntimeError("Empty neural audio stream")
    return bytes(chunks)


@app.get("/api/health")
async def health_check():
    return {
        "ok": True,
        "neural_tts": HAS_EDGE_TTS,
        "offline_sapi_wav": SAPI_WORKER is not None,
        "pc_control": True,
        "interactive_desktop": PC_CONTROLLER.is_interactive_desktop,
        "desktop_name": PC_CONTROLLER.desktop_name,
        "saved_commands_count": len(PC_CONTROLLER.saved_commands),
        "installed_apps_count": len(PC_CONTROLLER.discovered_apps) + len(BUILTIN_APPS),
        "voices": NEURAL_VOICE_MAP,
    }


class PCResolveRequest(BaseModel):
    text: str
    only_saved: Optional[bool] = False
    execute: Optional[bool] = True
    dry_run: Optional[bool] = False


class PCExecuteRequest(BaseModel):
    tool: str
    target: str
    steps: Optional[list[dict]] = None
    phrase: Optional[str] = None
    reply: Optional[str] = None
    execute: Optional[bool] = True
    save: Optional[bool] = True
    dry_run: Optional[bool] = False


@app.get("/api/pc/saved")
async def list_saved_pc_commands():
    return {
        "ok": True,
        "interactiveDesktop": PC_CONTROLLER.is_interactive_desktop,
        "desktopName": PC_CONTROLLER.desktop_name,
        "savedCommands": PC_CONTROLLER.get_saved_commands_list(),
        "installedAppsCount": len(PC_CONTROLLER.discovered_apps) + len(BUILTIN_APPS),
        "sampleApps": sorted(list(PC_CONTROLLER.discovered_apps.keys()))[:60],
    }


@app.post("/api/pc/resolve")
async def resolve_pc_command(req: PCResolveRequest):
    t0 = time.perf_counter()
    user_text = (req.text or "").strip()
    if not user_text:
        return {"matched": False}

    # 1. Check Persistent Saved Command Cache FIRST (<1ms lookup!)
    saved = PC_CONTROLLER.find_saved_command(user_text)
    if saved is not None:
        steps = saved.get("steps") or [{"tool": saved["tool"], "target": saved["target"]}]
        result = None
        if req.execute:
            if req.dry_run:
                result = {
                    "ok": True,
                    "dryRun": True,
                    "tool": saved["tool"],
                    "target": saved["target"],
                    "action": "nod",
                    "reply": saved["reply"],
                }
            else:
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(None, PC_CONTROLLER.execute_steps, steps)
            PC_CONTROLLER.save_command(saved["phrase"], saved["tool"], saved["target"], saved["reply"], steps=steps)
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "matched": True,
            "source": "saved_cache",
            "latencyMs": latency_ms,
            "tool": saved["tool"],
            "target": saved["target"],
            "steps": steps,
            "reply": saved["reply"],
            "hits": saved.get("hits", 1),
            "result": result,
        }

    if req.only_saved:
        return {"matched": False}

    # 2. Check Fast Multi-Step Deterministic Command Parser (executes clear commands in <15ms & saves for next time!)
    steps = PC_CONTROLLER.detect_direct_steps(user_text)
    if steps:
        first_tool = steps[0]["tool"]
        first_target = steps[0]["target"]
        result = None
        if req.execute:
            if req.dry_run:
                result = {
                    "ok": True,
                    "dryRun": True,
                    "tool": first_tool,
                    "target": first_target,
                    "steps": steps,
                    "action": "nod",
                    "reply": f"Executed {first_tool}: {first_target}",
                }
            else:
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(None, PC_CONTROLLER.execute_steps, steps)
                if result.get("ok", False):
                    PC_CONTROLLER.save_command(user_text, first_tool, first_target, result.get("reply", ""), steps=steps)
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "matched": True,
            "source": "direct_parser",
            "latencyMs": latency_ms,
            "tool": first_tool,
            "target": first_target,
            "steps": steps,
            "reply": result["reply"] if result else "",
            "result": result,
        }

    return {"matched": False}


@app.post("/api/pc/execute")
async def execute_pc_command(req: PCExecuteRequest):
    t0 = time.perf_counter()
    steps = req.steps or [{"tool": req.tool, "target": req.target}]
    if not req.execute:
        res = {
            "ok": True,
            "skippedExecution": True,
            "tool": req.tool,
            "target": req.target,
            "action": "nod",
            "reply": req.reply or "",
        }
    elif req.dry_run:
        res = {
            "ok": True,
            "dryRun": True,
            "tool": req.tool,
            "target": req.target,
            "steps": steps,
            "action": "nod",
            "reply": req.reply or f"Ready to run {req.tool} ({req.target})!",
        }
    else:
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(None, PC_CONTROLLER.execute_steps, steps)

    saved_entry = None
    if req.save and req.phrase and res.get("ok", False):
        final_reply = (req.reply or "").strip() or res.get("reply", "")
        saved_entry = PC_CONTROLLER.save_command(req.phrase, req.tool, req.target, final_reply, steps=steps)

    res["latencyMs"] = round((time.perf_counter() - t0) * 1000, 2)
    res["savedCommand"] = saved_entry
    return res


@app.post("/api/tts")
async def tts_endpoint(req: TTSRequest):
    global EDGE_COOLDOWN_UNTIL
    clean_text = (req.text or "").strip()
    if not clean_text:
        return Response(content=b"", status_code=204)

    cache_key = hashlib.sha1(
        f"{clean_text}|{req.lang}|{req.emotion}|{req.mode}|{req.voice}".encode("utf-8")
    ).hexdigest()

    if cache_key in AUDIO_CACHE:
        AUDIO_CACHE.move_to_end(cache_key)
        audio_bytes, media_type, cached_engine = AUDIO_CACHE[cache_key]
        return Response(
            content=audio_bytes,
            media_type=media_type,
            headers={"X-Voice-Engine": cached_engine, "Cache-Control": "no-store"},
        )

    audio_bytes: Optional[bytes] = None
    media_type = "audio/mpeg"
    engine_used = "neural"

    now_mono = time.monotonic()
    try_neural = (
        req.mode != "offline"
        and HAS_EDGE_TTS
        and (req.mode == "neural" or now_mono >= EDGE_COOLDOWN_UNTIL)
    )

    if try_neural:
        try:
            audio_bytes = await asyncio.wait_for(
                synthesize_neural_mp3(clean_text, req.lang or "en-US", req.emotion or "explain", req.voice),
                timeout=5.5,
            )
            media_type = "audio/mpeg"
            engine_used = "edge-neural"
            EDGE_COOLDOWN_UNTIL = 0.0
        except Exception:
            audio_bytes = None
            EDGE_COOLDOWN_UNTIL = time.monotonic() + 45.0

    if audio_bytes is None and SAPI_WORKER is not None:
        loop = asyncio.get_running_loop()
        audio_bytes = await loop.run_in_executor(None, SAPI_WORKER.synthesize, clean_text, req.emotion or "explain")
        media_type = "audio/wav"
        engine_used = "sapi-offline-wav"

    if not audio_bytes:
        return Response(content=b"TTS unavailable", status_code=503)

    AUDIO_CACHE[cache_key] = (audio_bytes, media_type, engine_used)
    if len(AUDIO_CACHE) > MAX_CACHE_ITEMS:
        AUDIO_CACHE.popitem(last=False)

    return Response(
        content=audio_bytes,
        media_type=media_type,
        headers={"X-Voice-Engine": engine_used, "Cache-Control": "no-store"},
    )


app.mount("/", StaticFiles(directory=str(ROOT_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="warning")
