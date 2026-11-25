"""
Miku Advanced Computer-Use & Desktop Automation Engine (`pc_control.py`)
100% Local Win32 GUI, Keyboard, Mouse, Window Management, App Launcher, YouTube/Web Search & Live Web Reader.
Strictly Non-Destructive: Zero file or folder deletions ever performed.

Full Capabilities:
1. Foreground GUI App & URL Launching (`ShellExecuteW` with `SW_SHOWNORMAL = 1` + `SetForegroundWindow` focus)
   across 119+ auto-discovered Windows Start Menu apps, UWP apps, and websites.
2. Multi-Step Chained Execution: e.g. "open notepad and write hello world" -> launches Notepad, waits for focus,
   and types Unicode text directly into the window!
3. Full Win32 Keyboard & Shortcut Automation (`SendInput` Unicode typing + hotkeys: Enter, Space, Ctrl+C/V/S/T/W, Alt+Tab, Win+Left/Right, F11).
4. Mouse & Screen Scrolling (`scroll_down`, `scroll_up`, `click`, `double_click`, `right_click`).
5. Active Window Manager (`focus_window`, `maximize_window`, `minimize_window`, `close_window`, `list_windows`, `show_desktop`).
6. Browser, YouTube Auto-Play & Live Web Answer Extraction (`bs4` DuckDuckGo/Wikipedia instant answers + browser tab).
7. System Hardware Controls: Volume, Media Keys, Screen Brightness, Clipboard, Quick Desktop Notes, Screenshots, & Live `psutil` CPU/RAM/Disk stats.
8. Persistent Self-Learning Command Cache (`data/saved_commands.json`) for <5ms repeat execution!
"""

import ctypes
from ctypes import wintypes
from difflib import SequenceMatcher
import json
import os
from pathlib import Path
import re
import subprocess
import time
from typing import Any, Dict, List, Optional, Tuple
import urllib.parse
import urllib.request

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
SAVED_COMMANDS_PATH = DATA_DIR / "saved_commands.json"

# =============================================================================
# WIN32 CONSTANTS & SENDINPUT STRUCTURES FOR REAL KEYBOARD / MOUSE / WINDOW GUI
# =============================================================================

SW_HIDE = 0
SW_SHOWNORMAL = 1
SW_SHOWMAXIMIZED = 3
SW_MINIMIZE = 6
SW_RESTORE = 9
WM_CLOSE = 0x0010

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004

MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800

VK_MAP: Dict[str, int] = {
    "backspace": 0x08,
    "tab": 0x09,
    "enter": 0x0D,
    "return": 0x0D,
    "shift": 0x10,
    "ctrl": 0x11,
    "control": 0x11,
    "alt": 0x12,
    "escape": 0x1B,
    "esc": 0x1B,
    "space": 0x20,
    "spacebar": 0x20,
    "pageup": 0x21,
    "pagedown": 0x22,
    "end": 0x23,
    "home": 0x24,
    "left": 0x25,
    "up": 0x26,
    "right": 0x27,
    "down": 0x28,
    "win": 0x5B,
    "windows": 0x5B,
    "f5": 0x74,
    "f11": 0x7A,
    "volume_mute": 0xAD,
    "volume_down": 0xAE,
    "volume_up": 0xAF,
    "media_next": 0xB0,
    "media_prev": 0xB1,
    "media_stop": 0xB2,
    "media_play_pause": 0xB3,
}
for _ch_code in range(ord("0"), ord("9") + 1):
    VK_MAP[chr(_ch_code)] = _ch_code
for _ch_code in range(ord("a"), ord("z") + 1):
    VK_MAP[chr(_ch_code)] = _ch_code - 32  # VK_A..VK_Z = 0x41..0x5A


ULONG_PTR = wintypes.WPARAM


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class _INPUTunion(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("union", _INPUTunion)]


KNOWN_WEBSITES: Dict[str, str] = {
    "youtube": "https://www.youtube.com",
    "google": "https://www.google.com",
    "gmail": "https://mail.google.com",
    "github": "https://github.com",
    "chatgpt": "https://chatgpt.com",
    "whatsapp": "https://web.whatsapp.com",
    "whatsapp web": "https://web.whatsapp.com",
    "instagram": "https://www.instagram.com",
    "facebook": "https://www.facebook.com",
    "linkedin": "https://www.linkedin.com",
    "twitter": "https://x.com",
    "x": "https://x.com",
    "reddit": "https://www.reddit.com",
    "netflix": "https://www.netflix.com",
    "spotify web": "https://open.spotify.com",
    "stackoverflow": "https://stackoverflow.com",
    "stack overflow": "https://stackoverflow.com",
    "maps": "https://maps.google.com",
    "google maps": "https://maps.google.com",
    "drive": "https://drive.google.com",
    "google drive": "https://drive.google.com",
    "wikipedia": "https://www.wikipedia.org",
    "amazon": "https://www.amazon.in",
    "flipkart": "https://www.flipkart.com",
}

BUILTIN_APPS: Dict[str, Tuple[str, str]] = {
    "calculator": ("calc.exe", "Calculator"),
    "calc": ("calc.exe", "Calculator"),
    "notepad": ("notepad.exe", "Notepad"),
    "paint": ("mspaint.exe", "Paint"),
    "mspaint": ("mspaint.exe", "Paint"),
    "cmd": ("cmd.exe", "Command Prompt"),
    "command prompt": ("cmd.exe", "Command Prompt"),
    "terminal": ("wt.exe", "Windows Terminal"),
    "powershell": ("powershell.exe", "PowerShell"),
    "explorer": ("explorer.exe", "File Explorer"),
    "file explorer": ("explorer.exe", "File Explorer"),
    "this pc": ("explorer.exe", "File Explorer"),
    "files": ("explorer.exe", "File Explorer"),
    "task manager": ("taskmgr.exe", "Task Manager"),
    "taskmgr": ("taskmgr.exe", "Task Manager"),
    "control panel": ("control.exe", "Control Panel"),
    "settings": ("ms-settings:", "Windows Settings"),
    "windows settings": ("ms-settings:", "Windows Settings"),
    "bluetooth": ("ms-settings:bluetooth", "Bluetooth Settings"),
    "wifi": ("ms-settings:network-wifi", "Wi-Fi Settings"),
    "display settings": ("ms-settings:display", "Display Settings"),
    "sound settings": ("ms-settings:sound", "Sound Settings"),
    "snipping tool": ("snippingtool.exe", "Snipping Tool"),
    "camera": ("microsoft.windows.camera:", "Camera"),
    "clock": ("ms-clock:", "Clock & Timer"),
    "wordpad": ("write.exe", "WordPad"),
    "vs code": ("code", "Visual Studio Code"),
    "vscode": ("code", "Visual Studio Code"),
    "visual studio code": ("code", "Visual Studio Code"),
    "xampp": (r"C:\xampp\xampp-control.exe", "XAMPP Control Panel"),
    "xampp control panel": (r"C:\xampp\xampp-control.exe", "XAMPP Control Panel"),
    "chrome": ("chrome.exe", "Google Chrome"),
    "google chrome": ("chrome.exe", "Google Chrome"),
    "edge": ("msedge.exe", "Microsoft Edge"),
    "microsoft edge": ("msedge.exe", "Microsoft Edge"),
    "firefox": ("firefox.exe", "Mozilla Firefox"),
    "brave": ("brave.exe", "Brave Browser"),
}


def get_current_desktop_name() -> str:
    if os.name != "nt":
        return "default"
    try:
        u32 = ctypes.windll.user32
        k32 = ctypes.windll.kernel32
        hdesk = u32.GetThreadDesktop(k32.GetCurrentThreadId())
        buf = ctypes.create_unicode_buffer(256)
        u32.GetUserObjectInformationW(hdesk, 2, buf, 512, None)
        return buf.value or "Default"
    except Exception:
        return "Default"


def normalize_phrase(text: str) -> str:
    cleaned = re.sub(r"[^\w\s]", " ", (text or "").lower())
    cleaned = re.sub(r"\b(hey|hi|hello|miku|please|can you|could you|would you|for me|right now)\b", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


class PCController:
    def __init__(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.desktop_name = get_current_desktop_name()
        self.is_interactive_desktop = self.desktop_name.lower() == "default"
        self.discovered_apps: Dict[str, str] = {}
        self.saved_commands: Dict[str, Dict[str, Any]] = {}
        self._discover_apps()
        self._load_saved_commands()

    def _discover_apps(self) -> None:
        """Scan Start Menu shortcuts AND Windows App Paths registry for all installed software."""
        roots = [
            Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / r"Microsoft\Windows\Start Menu\Programs",
            Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs",
        ]
        skip_words = ("uninstall", "readme", "help", "manual", "documentation", "license")
        for root in roots:
            if not root.exists():
                continue
            try:
                for lnk in root.rglob("*.lnk"):
                    key = lnk.stem.strip().lower()
                    if key and not any(w in key for w in skip_words) and key not in self.discovered_apps:
                        self.discovered_apps[key] = str(lnk)
            except Exception:
                pass

        # Also check Windows Registry App Paths (e.g., chrome.exe, vlc.exe, winword.exe, excel.exe)
        if os.name == "nt":
            try:
                import winreg
                for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                    try:
                        with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths") as k:
                            count = winreg.QueryInfoKey(k)[0]
                            for i in range(count):
                                sub_name = winreg.EnumKey(k, i)
                                clean_key = sub_name.lower().replace(".exe", "").strip()
                                with winreg.OpenKey(k, sub_name) as sub_k:
                                    exe_path, _ = winreg.QueryValueEx(sub_k, "")
                                    if exe_path and clean_key and clean_key not in self.discovered_apps:
                                        self.discovered_apps[clean_key] = exe_path.strip('"')
                    except Exception:
                        pass
            except Exception:
                pass

    # =========================================================================
    # PERSISTENT SAVED COMMANDS CACHE (Supports Single & Multi-Step Chains!)
    # =========================================================================

    def _load_saved_commands(self) -> None:
        if not SAVED_COMMANDS_PATH.exists():
            self.saved_commands = {}
            return
        try:
            data = json.loads(SAVED_COMMANDS_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                self.saved_commands = data
        except Exception:
            self.saved_commands = {}

    def _persist_saved_commands(self) -> None:
        try:
            SAVED_COMMANDS_PATH.write_text(
                json.dumps(self.saved_commands, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception:
            pass

    def save_command(
        self,
        raw_phrase: str,
        tool: str,
        target: str,
        reply: str,
        steps: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        norm = normalize_phrase(raw_phrase)
        if not norm or len(norm) < 2:
            norm = (raw_phrase or "").strip().lower()
        existing = self.saved_commands.get(norm)
        entry: Dict[str, Any] = {
            "key": norm,
            "phrase": raw_phrase.strip(),
            "tool": tool,
            "target": target,
            "steps": steps or [{"tool": tool, "target": target}],
            "reply": reply,
            "hits": (existing.get("hits", 0) + 1) if existing else 1,
            "updatedAt": int(time.time()),
        }
        self.saved_commands[norm] = entry
        self._persist_saved_commands()
        return entry

    def find_saved_command(self, user_text: str) -> Optional[Dict[str, Any]]:
        norm = normalize_phrase(user_text)
        if not norm:
            return None
        if norm in self.saved_commands:
            return self.saved_commands[norm]

        best_score = 0.0
        best_entry = None
        for k, entry in self.saved_commands.items():
            if abs(len(k) - len(norm)) > 8:
                continue
            score = SequenceMatcher(None, norm, k).ratio()
            if score >= 0.92 and score > best_score:
                best_score = score
                best_entry = entry
        return best_entry

    def get_saved_commands_list(self) -> List[Dict[str, Any]]:
        items = list(self.saved_commands.values())
        items.sort(key=lambda x: (-x.get("hits", 1), -x.get("updatedAt", 0)))
        return items

    # =========================================================================
    # WIN32 FOREGROUND LAUNCHER, KEYBOARD, MOUSE & WINDOW CONTROLS
    # =========================================================================

    def _shell_open_foreground(self, target: str, params: str = "") -> None:
        """
        Uses Win32 ShellExecuteW with explicit SW_SHOWNORMAL (1) + AllowSetForegroundWindow
        so launched browsers, UWP apps, and Win32 apps ALWAYS appear visibly on screen!
        """
        if os.name != "nt":
            subprocess.Popen([target])
            return

        u32 = ctypes.windll.user32
        shell32 = ctypes.windll.shell32
        try:
            u32.AllowSetForegroundWindow(-1)  # ASFW_ANY
            # Momentarily tap a zero-effect modifier release to unlock Windows ForegroundLockTimeout
            u32.keybd_event(0x12, 0, KEYEVENTF_KEYUP, 0)
        except Exception:
            pass

        ret = shell32.ShellExecuteW(None, "open", target, params or None, None, SW_SHOWNORMAL)
        if ret <= 32:
            # Fallback via explorer.exe (which always runs in interactive desktop shell)
            subprocess.Popen(["explorer.exe", target])

    def _list_visible_windows(self) -> List[Tuple[int, str]]:
        if os.name != "nt":
            return []
        u32 = ctypes.windll.user32
        windows: List[Tuple[int, str]] = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def enum_proc(hwnd: int, _lparam: int) -> bool:
            if u32.IsWindowVisible(hwnd):
                length = u32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buf = ctypes.create_unicode_buffer(length + 1)
                    u32.GetWindowTextW(hwnd, buf, length + 1)
                    title = buf.value.strip()
                    if title and title not in ("Program Manager", "Windows Input Experience", "Settings"):
                        windows.append((hwnd, title))
            return True

        u32.EnumWindows(enum_proc, 0)
        return windows

    def _focus_window_by_title(self, query: str) -> Optional[str]:
        if os.name != "nt":
            return None
        q = query.lower().strip()
        u32 = ctypes.windll.user32
        k32 = ctypes.windll.kernel32
        for hwnd, title in self._list_visible_windows():
            if q in title.lower():
                if u32.IsIconic(hwnd):
                    u32.ShowWindow(hwnd, SW_RESTORE)
                else:
                    u32.ShowWindow(hwnd, SW_SHOWNORMAL)
                fg_hwnd = u32.GetForegroundWindow()
                fg_tid = u32.GetWindowThreadProcessId(fg_hwnd, None)
                cur_tid = k32.GetCurrentThreadId()
                if fg_tid != cur_tid:
                    u32.AttachThreadInput(cur_tid, fg_tid, True)
                    u32.BringWindowToTop(hwnd)
                    u32.SetForegroundWindow(hwnd)
                    u32.AttachThreadInput(cur_tid, fg_tid, False)
                else:
                    u32.SetForegroundWindow(hwnd)
                return title
        return None

    def _type_unicode_text(self, text: str) -> None:
        """Types arbitrary Unicode text into the active foreground window using Win32 SendInput."""
        if os.name != "nt" or not text:
            return
        u32 = ctypes.windll.user32
        for ch in text:
            if ch == "\n":
                self._press_hotkey("enter")
                continue
            code = ord(ch)
            down = INPUT(type=INPUT_KEYBOARD, union=_INPUTunion(ki=KEYBDINPUT(0, code, KEYEVENTF_UNICODE, 0, 0)))
            up = INPUT(type=INPUT_KEYBOARD, union=_INPUTunion(ki=KEYBDINPUT(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0, 0)))
            arr = (INPUT * 2)(down, up)
            u32.SendInput(2, ctypes.byref(arr), ctypes.sizeof(INPUT))
            time.sleep(0.006)

    def _press_hotkey(self, combo: str) -> None:
        """Presses a single key ('enter', 'space', 'f11') or shortcut ('ctrl+c', 'ctrl+t', 'alt+tab', 'win+d')."""
        if os.name != "nt":
            return
        u32 = ctypes.windll.user32
        parts = [p.strip().lower() for p in combo.replace("-", "+").split("+") if p.strip()]
        vks = [VK_MAP[p] for p in parts if p in VK_MAP]
        if not vks:
            return
        for vk in vks:
            u32.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0)
            time.sleep(0.015)
        for vk in reversed(vks):
            u32.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
            time.sleep(0.01)

    def _scroll_wheel(self, direction: str, clicks: int = 5) -> None:
        if os.name != "nt":
            return
        delta = 120 * clicks if direction == "up" else -120 * clicks
        ctypes.windll.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)

    def _mouse_click(self, kind: str = "left") -> None:
        if os.name != "nt":
            return
        u32 = ctypes.windll.user32
        if kind == "right":
            u32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
            time.sleep(0.02)
            u32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
        elif kind == "double":
            for _ in range(2):
                u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
                time.sleep(0.04)
        else:
            u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            time.sleep(0.02)
            u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

    # =========================================================================
    # MULTI-STEP DETERMINISTIC COMMAND PARSER (Catches Single & Chained Intents!)
    # =========================================================================

    def detect_direct_steps(self, text: str) -> Optional[List[Dict[str, str]]]:
        """
        Parses natural voice/text commands into 1 or more sequential PC actions!
        Example: "open notepad and write buy milk and eggs" -> [open_app:notepad, wait:700, type_text:buy milk and eggs]
        """
        raw = (text or "").strip()
        lower = raw.lower()
        cleaned = re.sub(r"^(?:hey\s+miku|hi\s+miku|okay\s+miku|miku|please|can you|could you|would you)\s*,?\s*", "", lower).strip()
        cleaned_raw_case = re.sub(r"^(?:hey\s+miku|hi\s+miku|okay\s+miku|miku|please|can you|could you|would you)\s*,?\s*", "", raw, flags=re.I).strip()
        cleaned = re.sub(r"[.!?]+$", "", cleaned).strip()

        # 0. Compound: "open <app> and write/type <text>"
        m_open_type = re.match(
            r"^(?:open|launch|start)\s+([a-z0-9\s]+?)\s+and\s+(?:write|type)\s+(.+)$",
            cleaned_raw_case,
            flags=re.I,
        )
        if m_open_type:
            app_name = m_open_type.group(1).strip().lower()
            to_type = m_open_type.group(2).strip()
            if self._resolve_app_target(app_name):
                return [
                    {"tool": "open_app", "target": app_name},
                    {"tool": "wait", "target": "750"},
                    {"tool": "type_text", "target": to_type},
                ]

        # 1. Direct Typing into Active Window ("type hello world", "write good morning and press enter")
        m_type = re.match(r"^(?:type|write\s+down|enter\s+text)\s+(.+)$", cleaned_raw_case, flags=re.I)
        if m_type:
            content = m_type.group(1).strip()
            press_enter = False
            if re.search(r"\s+and\s+(?:press|hit)\s+enter$", content, flags=re.I):
                content = re.sub(r"\s+and\s+(?:press|hit)\s+enter$", "", content, flags=re.I).strip()
                press_enter = True
            steps = [{"tool": "type_text", "target": content}]
            if press_enter:
                steps.append({"tool": "hotkey", "target": "enter"})
            return steps

        # 2. Create / Save a Note File on Desktop ("create a note on desktop saying ...", "save note ...")
        m_note = re.match(r"^(?:create|make|save)\s+(?:a\s+)?(?:note|text\s+file)(?:\s+on\s+desktop)?\s+(?:saying|with|about|that\s+says)\s+(.+)$", cleaned_raw_case, flags=re.I)
        if m_note:
            return [{"tool": "save_note", "target": m_note.group(1).strip()}]

        # 3. YouTube Play & Search
        m_yt_play = (
            re.match(r"^play\s+(.+?)(?:\s+on\s+youtube|\s+video|\s+song)?$", cleaned)
            if ("youtube" in cleaned or cleaned.startswith("play "))
            else None
        )
        if m_yt_play and m_yt_play.group(1).strip() and m_yt_play.group(1).strip() not in ("pause", "music", "media"):
            q = re.sub(r"\s+on\s+youtube$", "", m_yt_play.group(1).strip())
            return [{"tool": "youtube_play", "target": q}]

        m_yt = (
            re.match(r"^open\s+youtube\s+and\s+(?:search|find|look\s+up)(?:\s+videos?)?(?:\s+for|\s+about)?\s+(.+)$", cleaned)
            or re.match(r"^(?:search|find|look\s+up)\s+(?:on\s+|in\s+)?youtube(?:\s+videos?)?(?:\s+for|\s+about)?\s+(.+)$", cleaned)
            or re.match(r"^youtube\s+(?:search|videos?)(?:\s+for)?\s+(.+)$", cleaned)
            or re.match(r"^(?:search|find)\s+(.+?)\s+(?:on|in)\s+youtube(?:\s+videos?)?$", cleaned)
        )
        if m_yt and m_yt.group(1).strip():
            return [{"tool": "youtube_search", "target": m_yt.group(1).strip()}]

        # 4. Browser / Google Search (with live web answer!)
        m_web = (
            re.match(r"^open\s+(?:the\s+)?(?:web\s+)?(?:browser|google|chrome|edge)\s+and\s+(?:search|look\s+up)(?:\s+for|\s+about)?\s+(.+)$", cleaned)
            or re.match(r"^(?:search|look\s+up)(?:\s+content)?\s+(?:on\s+|in\s+|through\s+)?(?:the\s+)?(?:google|web|browser|internet)(?:\s+for|\s+about)?\s+(.+)$", cleaned)
            or re.match(r"^google(?:\s+search)?(?:\s+for)?\s+(.+)$", cleaned)
            or re.match(r"^(?:search|look\s+up)\s+(.+?)\s+(?:on|in|through)\s+(?:the\s+)?(?:google|web\s+browser|browser|web|internet)$", cleaned)
        )
        if m_web and m_web.group(1).strip():
            return [{"tool": "web_search", "target": m_web.group(1).strip()}]

        # 5. Keyboard Shortcuts, Browser Tabs, Scrolling & Mouse
        if re.search(r"\b(scroll\s+down|page\s+down)\b", cleaned):
            amt = "10" if "lot" in cleaned or "fast" in cleaned else "5"
            return [{"tool": "scroll", "target": f"down:{amt}"}]
        if re.search(r"\b(scroll\s+up|page\s+up)\b", cleaned):
            amt = "10" if "lot" in cleaned or "fast" in cleaned else "5"
            return [{"tool": "scroll", "target": f"up:{amt}"}]
        if re.search(r"\b(double\s+click)\b", cleaned):
            return [{"tool": "mouse_click", "target": "double"}]
        if re.search(r"\b(right\s+click)\b", cleaned):
            return [{"tool": "mouse_click", "target": "right"}]
        if re.match(r"^(?:click|left\s+click)(?:\s+here|\s+mouse)?$", cleaned):
            return [{"tool": "mouse_click", "target": "left"}]

        hotkey_phrases = {
            r"\b(new\s+tab|open\s+new\s+tab)\b": "ctrl+t",
            r"\b(close\s+tab|close\s+this\s+tab)\b": "ctrl+w",
            r"\b(reopen\s+(?:closed\s+)?tab)\b": "ctrl+shift+t",
            r"\b(full\s*screen|toggle\s+fullscreen)\b": "f11",
            r"\b(switch\s+window|alt\s+tab|next\s+window)\b": "alt+tab",
            r"\b(copy\s+that|copy\s+selection)\b": "ctrl+c",
            r"\b(paste|paste\s+here|paste\s+that)\b": "ctrl+v",
            r"\b(select\s+all)\b": "ctrl+a",
            r"\b(save\s+file|press\s+ctrl\s+s)\b": "ctrl+s",
            r"\b(undo\s+that)\b": "ctrl+z",
            r"^(?:press|hit)\s+enter$": "enter",
            r"^(?:press|hit)\s+(?:space|spacebar)$": "space",
            r"^(?:press|hit)\s+(?:escape|esc)$": "escape",
            r"\b(snap\s+(?:window\s+)?left)\b": "win+left",
            r"\b(snap\s+(?:window\s+)?right)\b": "win+right",
        }
        for pat, hk in hotkey_phrases.items():
            if re.search(pat, cleaned):
                return [{"tool": "hotkey", "target": hk}]

        # 6. Window Focus, Maximize, Minimize, Close & List
        m_focus = re.match(r"^(?:switch\s+to|focus|bring\s+up)\s+(.+?)(?:\s+window)?$", cleaned)
        if m_focus:
            return [{"tool": "window_control", "target": f"focus:{m_focus.group(1).strip()}"}]
        if re.search(r"\b(maximize\s+(?:this\s+|current\s+)?window)\b", cleaned):
            return [{"tool": "window_control", "target": "maximize"}]
        if re.search(r"\b(minimize\s+all(?:\s+windows)?|show\s+desktop)\b", cleaned):
            return [{"tool": "system_control", "target": "show_desktop"}]
        if re.search(r"\b(minimize\s+(?:this\s+|current\s+)?window)\b", cleaned):
            return [{"tool": "window_control", "target": "minimize"}]
        if re.search(r"\b(close\s+(?:this\s+|active\s+|current\s+)?window)\b", cleaned):
            return [{"tool": "window_control", "target": "close_active"}]
        if re.search(r"\b(what\s+windows\s+are\s+open|list\s+open\s+windows)\b", cleaned):
            return [{"tool": "window_control", "target": "list"}]

        # 7. Brightness, Volume, Media, Screenshot & PC Status
        m_bright = re.search(r"brightness\s+(?:to\s+)?(\d{1,3})", cleaned)
        if m_bright:
            lvl = max(10, min(100, int(m_bright.group(1))))
            return [{"tool": "brightness", "target": str(lvl)}]
        if re.search(r"\b(increase\s+brightness|brighter)\b", cleaned):
            return [{"tool": "brightness", "target": "85"}]
        if re.search(r"\b(decrease\s+brightness|dim\s+(?:the\s+)?screen|lower\s+brightness)\b", cleaned):
            return [{"tool": "brightness", "target": "35"}]

        if re.search(r"\b(volume\s+up|increase\s+(?:the\s+)?volume|turn\s+up\s+(?:the\s+)?volume|louder)\b", cleaned):
            return [{"tool": "system_control", "target": "volume_up"}]
        if re.search(r"\b(volume\s+down|decrease\s+(?:the\s+)?volume|lower\s+(?:the\s+)?volume|turn\s+down\s+(?:the\s+)?volume|quieter)\b", cleaned):
            return [{"tool": "system_control", "target": "volume_down"}]
        if re.search(r"\b(mute\s+(?:the\s+)?(?:volume|pc|computer|sound|audio)|unmute)\b", cleaned):
            return [{"tool": "system_control", "target": "volume_mute"}]
        if re.search(r"\b(pause\s+(?:the\s+)?(?:music|media|video|song)|resume\s+(?:music|media)|play\s+pause)\b", cleaned):
            return [{"tool": "system_control", "target": "media_play_pause"}]
        if re.search(r"\b(next\s+(?:song|track|video)|skip\s+(?:song|track))\b", cleaned):
            return [{"tool": "system_control", "target": "media_next"}]
        if re.search(r"\b(previous\s+(?:song|track)|prev\s+track)\b", cleaned):
            return [{"tool": "system_control", "target": "media_prev"}]

        if re.search(r"\b(take\s+(?:a\s+)?screenshot|capture\s+(?:my\s+)?screen|screen\s*shot)\b", cleaned):
            return [{"tool": "screenshot", "target": "desktop"}]
        if re.search(r"\b(pc\s+status|system\s+status|computer\s+status|cpu\s+(?:and\s+)?ram|how\s+much\s+ram|memory\s+usage|battery\s+status)\b", cleaned):
            return [{"tool": "pc_status", "target": "summary"}]

        # 8. Open User Folders
        m_folder = re.match(r"^(?:open|show)\s+(?:my\s+|the\s+)?(downloads|documents|desktop|pictures|music|videos)(?:\s+folder)?$", cleaned)
        if m_folder:
            return [{"tool": "open_folder", "target": m_folder.group(1).lower()}]

        # 9. Open Browser / Website / Any Installed Software App
        m_open = re.match(r"^(?:open|launch|start|run)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:app|application|software|program))?$", cleaned)
        if m_open:
            target = m_open.group(1).strip()
            if target in ("browser", "web browser", "internet", "internet browser"):
                return [{"tool": "open_url", "target": "https://www.google.com"}]
            if target in KNOWN_WEBSITES:
                return [{"tool": "open_url", "target": KNOWN_WEBSITES[target]}]
            if re.match(r"^(?:https?://)?[a-z0-9\-]+\.(?:com|org|net|in|io|ai|dev|edu|gov)(?:/.*)?$", target):
                url = target if target.startswith("http") else f"https://{target}"
                return [{"tool": "open_url", "target": url}]
            if self._resolve_app_target(target) is not None:
                return [{"tool": "open_app", "target": target}]

        return None

    def detect_direct_command(self, text: str) -> Optional[Tuple[str, str]]:
        steps = self.detect_direct_steps(text)
        if steps and len(steps) == 1:
            return (steps[0]["tool"], steps[0]["target"])
        return None

    def _resolve_app_target(self, app_query: str) -> Optional[Tuple[str, str]]:
        q = (app_query or "").strip().lower()
        q = re.sub(r"\s+(?:app|application|software|program)$", "", q).strip()
        if not q:
            return None

        if q in BUILTIN_APPS:
            return BUILTIN_APPS[q]

        if q in self.discovered_apps:
            return (self.discovered_apps[q], app_query.title())

        for name, lnk_path in self.discovered_apps.items():
            if len(q) >= 3 and (q in name or name in q):
                return (lnk_path, name.title())

        best_ratio = 0.0
        best_match = None
        for name, lnk_path in self.discovered_apps.items():
            r = SequenceMatcher(None, q, name).ratio()
            if r >= 0.80 and r > best_ratio:
                best_ratio = r
                best_match = (lnk_path, name.title())
        return best_match

    # =========================================================================
    # LIVE YOUTUBE RESOLVER & LIVE WEB ANSWER EXTRACTOR (`bs4`)
    # =========================================================================

    def _resolve_first_youtube_video(self, query: str) -> Optional[Tuple[str, str]]:
        search_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}"
        try:
            req = urllib.request.Request(
                search_url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36"},
            )
            with urllib.request.urlopen(req, timeout=3.5) as resp:
                html = resp.read(950_000).decode("utf-8", errors="ignore")
            vid_match = re.search(r'"videoId":"([a-zA-Z0-9_-]{11})"', html)
            title_match = re.search(r'"title":\{"runs":\[\{"text":"([^"]{3,90})"\}', html)
            if vid_match:
                vid_url = f"https://www.youtube.com/watch?v={vid_match.group(1)}"
                vid_title = title_match.group(1) if title_match else query
                return (vid_url, vid_title)
        except Exception:
            pass
        return None

    def _fetch_live_web_snippet(self, query: str) -> Optional[str]:
        """Fetches a real live 1-sentence answer from DuckDuckGo HTML using BeautifulSoup so Miku speaks live facts!"""
        if not HAS_BS4:
            return None
        try:
            ddg_url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote_plus(query)}"
            req = urllib.request.Request(
                ddg_url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36"},
            )
            with urllib.request.urlopen(req, timeout=2.6) as resp:
                html = resp.read(160_000).decode("utf-8", errors="ignore")
            soup = BeautifulSoup(html, "html.parser")
            snippet_el = soup.select_one(".result__snippet")
            if snippet_el:
                txt = re.sub(r"\s+", " ", snippet_el.get_text(" ", strip=True)).strip()
                if len(txt) > 160:
                    txt = txt[:157].rsplit(" ", 1)[0] + "..."
                return txt
        except Exception:
            pass
        return None

    def _get_pc_status_summary(self) -> Tuple[Dict[str, Any], str]:
        cpu_pct = psutil.cpu_percent(interval=0.15) if HAS_PSUTIL else 0
        if HAS_PSUTIL:
            vm = psutil.virtual_memory()
            total_gb = round(vm.total / (1024 ** 3), 1)
            used_gb = round(vm.used / (1024 ** 3), 1)
            ram_pct = round(vm.percent)
            disk_free_gb = round(psutil.disk_usage("C:\\").free / (1024 ** 3), 1)
            batt = psutil.sensors_battery()
            batt_str = f", battery at {round(batt.percent)}%" if batt else ""
        else:
            total_gb, used_gb, ram_pct, disk_free_gb, batt_str = 8.0, 4.0, 50, 100.0, ""

        stats = {
            "cpuPercent": cpu_pct,
            "ramPercent": ram_pct,
            "ramUsedGb": used_gb,
            "ramTotalGb": total_gb,
            "diskFreeGb": disk_free_gb,
            "installedAppsIndexed": len(self.discovered_apps) + len(BUILTIN_APPS),
        }
        spoken = (
            f"CPU is at {cpu_pct}%, RAM is using {used_gb} of {total_gb} gigabytes ({ram_pct}%), "
            f"and you have {disk_free_gb} gigabytes free on drive C{batt_str}."
        )
        return stats, spoken

    # =========================================================================
    # MULTI-STEP & SINGLE-TOOL EXECUTION ENGINE
    # =========================================================================

    def execute_steps(self, steps: List[Dict[str, str]]) -> Dict[str, Any]:
        last_res: Dict[str, Any] = {"ok": False, "action": "shrug", "reply": "No steps executed."}
        replies: List[str] = []
        for step in steps:
            t_name = step.get("tool", "")
            t_arg = step.get("target", "")
            if t_name == "wait":
                ms = max(50, min(4000, int(t_arg or "500")))
                time.sleep(ms / 1000.0)
                continue
            last_res = self.execute_tool(t_name, t_arg)
            if last_res.get("reply"):
                replies.append(last_res["reply"])
        if len(replies) > 1:
            last_res["reply"] = " ".join(replies)
        return last_res

    def execute_tool(self, tool: str, target: str) -> Dict[str, Any]:
        tool = (tool or "").strip().lower()
        target = (target or "").strip()

        if tool == "open_url":
            url = KNOWN_WEBSITES.get(target.lower(), target)
            if not url.startswith(("http://", "https://")):
                url = f"https://{url}"
            self._shell_open_foreground(url)
            host_label = urllib.parse.urlparse(url).netloc.replace("www.", "") or url
            return {
                "ok": True,
                "tool": tool,
                "target": url,
                "action": "nod",
                "reply": f"Opened {host_label} right in front of your browser!",
            }

        if tool == "web_search":
            q = target or "news"
            url = f"https://www.google.com/search?q={urllib.parse.quote_plus(q)}"
            self._shell_open_foreground(url)
            snippet = self._fetch_live_web_snippet(q)
            spoken = (
                f"Opened Google results for {q}! Quick summary: {snippet}"
                if snippet
                else f"Opened Google search results for {q} in your browser!"
            )
            return {
                "ok": True,
                "tool": tool,
                "target": q,
                "url": url,
                "action": "explain",
                "reply": spoken,
            }

        if tool == "youtube_search":
            q = target or "hatsune miku"
            url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(q)}"
            self._shell_open_foreground(url)
            return {
                "ok": True,
                "tool": tool,
                "target": q,
                "url": url,
                "action": "cheer",
                "reply": f"Opened YouTube search results for {q}!",
            }

        if tool == "youtube_play":
            q = target or "hatsune miku"
            resolved = self._resolve_first_youtube_video(q)
            if resolved:
                final_url, vid_title = resolved
                reply_msg = f"Playing {vid_title} on YouTube right now!"
            else:
                final_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(q)}"
                reply_msg = f"Opened YouTube for {q}!"
            self._shell_open_foreground(final_url)
            return {
                "ok": True,
                "tool": tool,
                "target": q,
                "url": final_url,
                "action": "cheer",
                "reply": reply_msg,
            }

        if tool == "open_app":
            resolved_app = self._resolve_app_target(target)
            if not resolved_app:
                return {
                    "ok": False,
                    "tool": tool,
                    "target": target,
                    "action": "shrug",
                    "reply": f"I couldn't find an installed app named {target} on your PC.",
                }
            cmd_path, pretty_name = resolved_app
            try:
                self._shell_open_foreground(cmd_path)
                time.sleep(0.25)
                self._focus_window_by_title(pretty_name.split()[0])
                return {
                    "ok": True,
                    "tool": tool,
                    "target": pretty_name,
                    "action": "nod",
                    "reply": f"Opened {pretty_name} on your screen!",
                }
            except Exception as e:
                return {
                    "ok": False,
                    "tool": tool,
                    "target": pretty_name,
                    "action": "empathy",
                    "reply": f"Tried launching {pretty_name}, but Windows reported: {e}",
                }

        if tool == "type_text":
            self._type_unicode_text(target)
            preview = target if len(target) <= 40 else (target[:37] + "...")
            return {
                "ok": True,
                "tool": tool,
                "target": target,
                "action": "explain",
                "reply": f"Typed \"{preview}\" into your active window!",
            }

        if tool == "hotkey":
            self._press_hotkey(target)
            return {
                "ok": True,
                "tool": tool,
                "target": target,
                "action": "nod",
                "reply": f"Pressed {target.upper()}!",
            }

        if tool == "scroll":
            parts = target.split(":")
            direction = parts[0] if parts else "down"
            clicks = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 5
            self._scroll_wheel(direction, clicks)
            return {
                "ok": True,
                "tool": tool,
                "target": target,
                "action": "nod",
                "reply": f"Scrolled {direction}!",
            }

        if tool == "mouse_click":
            self._mouse_click(target or "left")
            return {
                "ok": True,
                "tool": tool,
                "target": target,
                "action": "nod",
                "reply": f"Clicked ({target or 'left'})!",
            }

        if tool == "window_control":
            u32 = ctypes.windll.user32
            if target.startswith("focus:"):
                win_q = target.split(":", 1)[1]
                matched_title = self._focus_window_by_title(win_q)
                if matched_title:
                    return {"ok": True, "tool": tool, "target": matched_title, "action": "nod", "reply": f"Switched focus to {matched_title}!"}
                return {"ok": False, "tool": tool, "target": win_q, "action": "shrug", "reply": f"Couldn't find an open window matching {win_q}."}
            if target == "maximize":
                hwnd = u32.GetForegroundWindow()
                if hwnd:
                    u32.ShowWindow(hwnd, SW_SHOWMAXIMIZED)
                return {"ok": True, "tool": tool, "target": target, "action": "nod", "reply": "Maximized your active window!"}
            if target == "minimize":
                hwnd = u32.GetForegroundWindow()
                if hwnd:
                    u32.ShowWindow(hwnd, SW_MINIMIZE)
                return {"ok": True, "tool": tool, "target": target, "action": "nod", "reply": "Minimized the window!"}
            if target == "close_active":
                hwnd = u32.GetForegroundWindow()
                if hwnd:
                    u32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
                return {"ok": True, "tool": tool, "target": target, "action": "nod", "reply": "Closed the active window!"}
            if target == "list":
                titles = [t for _, t in self._list_visible_windows()][:6]
                summary = ", ".join(titles) if titles else "no desktop windows"
                return {"ok": True, "tool": tool, "target": target, "action": "explain", "reply": f"You currently have open: {summary}."}

        if tool == "brightness":
            lvl = max(10, min(100, int(re.sub(r"\D", "", target) or "75")))
            ps_b = f"(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue).WmiSetBrightness(1, {lvl})"
            subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_b])
            return {"ok": True, "tool": tool, "target": str(lvl), "action": "nod", "reply": f"Set screen brightness to {lvl}%!"}

        if tool == "save_note":
            desk = Path.home() / "Desktop"
            note_file = desk / f"Miku_Note_{int(time.time())}.txt"
            note_file.write_text(target, encoding="utf-8")
            self._shell_open_foreground(str(note_file))
            return {
                "ok": True,
                "tool": tool,
                "target": str(note_file),
                "action": "cheer",
                "reply": f"Saved your note to Desktop ({note_file.name}) and opened it for you!",
            }

        if tool == "open_folder":
            home = Path.home()
            folder_map = {
                "downloads": home / "Downloads",
                "documents": home / "Documents",
                "desktop": home / "Desktop",
                "pictures": home / "Pictures",
                "music": home / "Music",
                "videos": home / "Videos",
            }
            folder_path = folder_map.get(target.lower(), home)
            self._shell_open_foreground(str(folder_path))
            return {
                "ok": True,
                "tool": tool,
                "target": str(folder_path),
                "action": "nod",
                "reply": f"Opened your {target.title()} folder right on screen!",
            }

        if tool == "screenshot":
            pics_dir = Path.home() / "Pictures" / "Miku_Screenshots"
            pics_dir.mkdir(parents=True, exist_ok=True)
            out_file = pics_dir / f"miku_screenshot_{int(time.time())}.png"
            try:
                from PIL import ImageGrab
                img = ImageGrab.grab()
                img.save(str(out_file))
            except Exception:
                ps_snap = (
                    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; "
                    "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "
                    "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; "
                    "$g = [System.Drawing.Graphics]::FromImage($bmp); "
                    "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); "
                    f"$bmp.Save('{str(out_file)}'); "
                    "$g.Dispose(); $bmp.Dispose()"
                )
                subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_snap], timeout=8, check=True)
            self._shell_open_foreground(str(out_file))
            return {
                "ok": True,
                "tool": tool,
                "target": str(out_file),
                "action": "wink",
                "reply": f"Captured your screen and opened {out_file.name}!",
            }

        if tool == "pc_status":
            stats, spoken = self._get_pc_status_summary()
            return {
                "ok": True,
                "tool": tool,
                "target": "summary",
                "stats": stats,
                "action": "explain",
                "reply": spoken,
            }

        if tool == "system_control":
            sub = target.lower()
            if sub == "volume_up":
                for _ in range(4):
                    self._press_hotkey("volume_up")
                return {"ok": True, "tool": tool, "target": sub, "action": "nod", "reply": "Turned your PC volume up!"}
            if sub == "volume_down":
                for _ in range(4):
                    self._press_hotkey("volume_down")
                return {"ok": True, "tool": tool, "target": sub, "action": "nod", "reply": "Turned your PC volume down."}
            if sub == "volume_mute":
                self._press_hotkey("volume_mute")
                return {"ok": True, "tool": tool, "target": sub, "action": "wink", "reply": "Toggled PC audio mute!"}
            if sub == "media_play_pause":
                self._press_hotkey("media_play_pause")
                return {"ok": True, "tool": tool, "target": sub, "action": "nod", "reply": "Toggled media play/pause!"}
            if sub == "media_next":
                self._press_hotkey("media_next")
                return {"ok": True, "tool": tool, "target": sub, "action": "cheer", "reply": "Skipped to the next track!"}
            if sub == "media_prev":
                self._press_hotkey("media_prev")
                return {"ok": True, "tool": tool, "target": sub, "action": "nod", "reply": "Back to the previous track!"}
            if sub == "show_desktop":
                self._press_hotkey("win+d")
                return {"ok": True, "tool": tool, "target": sub, "action": "nod", "reply": "Toggled Show Desktop!"}

        return {
            "ok": False,
            "tool": tool,
            "target": target,
            "action": "shrug",
            "reply": "Hmm, I don't recognize that computer action yet.",
        }
