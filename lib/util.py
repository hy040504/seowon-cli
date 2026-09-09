"""문자열 · 기간 · HTML · 콘솔 도우미."""

from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

def str_ieq(a: str | None, b: str | None) -> bool:
    """대소문자 무시 비교."""
    if a is None or b is None:
        return a == b
    return a.lower() == b.lower()


def normalize_space(s: str) -> str:
    """연속 공백을 한 칸으로 줄인다."""
    return " ".join(s.split())


def decode_entities(s: str) -> str:
    """e-campus HTML 에 나오는 기본 엔티티만 푼다."""
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        if s[i] == "&":
            if s.startswith("&amp;", i):
                out.append("&")
                i += 5
                continue
            if s.startswith("&lt;", i):
                out.append("<")
                i += 4
                continue
            if s.startswith("&gt;", i):
                out.append(">")
                i += 4
                continue
            if s.startswith("&quot;", i):
                out.append('"')
                i += 6
                continue
            if s.startswith("&nbsp;", i):
                out.append(" ")
                i += 6
                continue
            if i + 2 < n and s[i + 1] == "#" and s[i + 2].isdigit():
                j = i + 2
                code = 0
                while j < n and s[j].isdigit():
                    code = code * 10 + ord(s[j]) - 48
                    j += 1
                if j < n and s[j] == ";":
                    out.append(chr(code) if 0 < code < 128 else "?")
                    i = j + 1
                    continue
        out.append(s[i])
        i += 1
    return "".join(out)


_VOIDISH = {"br", "hr", "p", "div", "li", "tr", "h1", "h2", "h3"}


def html_to_text(html: str | None) -> str:
    """태그를 버리고 br/p 는 줄바꿈으로 바꾼 뒤 공백을 정규화한다."""
    if not html:
        return ""
    buf: list[str] = []
    i = 0
    n = len(html)
    skip = False
    while i < n:
        if html[i] == "<":
            gt = html.find(">", i)
            if gt < 0:
                break
            q = i + 1
            if q < n and html[q] == "/":
                q += 1
            name_chars: list[str] = []
            while q < gt and (html[q].isalnum() or html[q] == "-"):
                name_chars.append(html[q].lower())
                q += 1
            name = "".join(name_chars)
            if name in ("script", "style", "noscript"):
                if i + 1 < n and html[i + 1] == "/":
                    skip = False
                else:
                    skip = True
                    close = {"script": "</script", "style": "</style", "noscript": "</noscript"}[name]
                    end = html.find(close, gt)
                    if end >= 0:
                        p = html.find(">", end)
                        if p >= 0:
                            i = p + 1
                            skip = False
                            continue
            if not skip and name in _VOIDISH:
                buf.append("\n")
            i = gt + 1
            continue
        if not skip:
            buf.append(html[i])
        i += 1
    return normalize_space(decode_entities("".join(buf)))


def url_encode(s: str) -> str:
    """application/x-www-form-urlencoded. `-_.!~*'()` 는 그대로 둔다."""
    return quote(s, safe="-_.!~*'()", encoding="utf-8")


def form_encode(fields: list[tuple[str, str]]) -> str:
    parts = [f"{url_encode(k)}={url_encode(v)}" for k, v in fields]
    return "&".join(parts)


def read_file(path: str | Path) -> str:
    p = Path(path)
    return p.read_bytes().decode("utf-8", errors="replace")


def write_file(path: str | Path, data: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data.encode("utf-8"))


def now_iso() -> str:
    t = datetime.now()
    return t.strftime("%Y-%m-%dT%H:%M:%S")


def local_ymdhms(y: int, mo: int, d: int, h: int, mi: int, s: int) -> float:
    return time.mktime((y, mo, d, h, mi, s, 0, 0, -1))


def _parse_one_date(s: str, end_of_day: bool) -> tuple[float, str] | None:
    p = s
    idx = p.find("20")
    while idx >= 0:
        if idx + 4 <= len(p) and p[idx : idx + 2] == "20":
            break
        idx = p.find("20", idx + 1)
    else:
        return None
    p = p[idx:]
    try:
        y = int(p[:4])
    except ValueError:
        return None
    if y < 2000 or y > 2100:
        return None
    p = p[4:]
    m = re.search(r"(\d+)", p)
    if not m:
        return None
    mo = int(m.group(1))
    if mo < 1 or mo > 12:
        return None
    p = p[m.end() :]
    m = re.search(r"(\d+)", p)
    if not m:
        return None
    d = int(m.group(1))
    if d < 1 or d > 31:
        return None
    p = p[m.end() :]
    p = p.lstrip(" \t")
    h, mi = (-1, 0)
    hm = re.match(r"(\d+):(\d+)", p)
    if hm:
        h = int(hm.group(1))
        mi = int(hm.group(2))
        p = p[hm.end() :]
    if h < 0:
        h = 23 if end_of_day else 0
        mi = 59 if end_of_day else 0
    ts = local_ymdhms(y, mo, d, h, mi, 59 if end_of_day else 0)
    if ts == -1:
        return None
    return ts, p


def period_range(period: str | None) -> tuple[float, float] | None:
    """`YYYY.MM.DD ~ YYYY.MM.DD` 구간을 로컬 시각으로 바꾼다."""
    if not period:
        return None
    cleaned: list[str] = []
    skip = False
    for ch in period:
        if ch == "(":
            skip = True
        if not skip:
            cleaned.append(ch)
        if ch == ")":
            skip = False
    text = "".join(cleaned)
    first = _parse_one_date(text, False)
    if not first:
        return None
    a, rest = first
    second = _parse_one_date(rest, True)
    if not second:
        return None
    b, _ = second
    return a, b


def period_active(period: str | None, now: float | None = None) -> bool:
    """지금이 제출·학습 기간 안인지."""
    rng = period_range(period)
    if not rng:
        return False
    if now is None:
        now = time.time()
    a, b = rng
    return a <= now <= b


def looks_like_login_html(html: str | None) -> bool:
    """세션이 끊겨 로그인 페이지가 돌아왔는지."""
    if not html:
        return True
    low = html[:4095].lower()
    return "encryptdata" in low or "userhome" in low or "popup/login" in low


def enable_console() -> None:
    """Windows 콘솔을 UTF-8 · ANSI 로 맞춘다."""
    if os.name == "nt":
        try:
            import ctypes

            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleOutputCP(65001)
            kernel32.SetConsoleCP(65001)
            handle = kernel32.GetStdHandle(-11)
            mode = ctypes.c_uint()
            if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                kernel32.SetConsoleMode(handle, mode.value | 0x0004)
        except Exception:
            pass
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass


def read_line(prompt: str = "") -> str:
    try:
        return input(prompt).strip()
    except EOFError:
        return ""


def read_password(prompt: str = "비밀번호: ") -> str:
    """마지막 글자만 잠깐 보여 주고 나머지는 * 로 가린다."""
    if os.name != "nt":
        import getpass

        return getpass.getpass(prompt)

    import msvcrt

    sys.stdout.write(prompt)
    sys.stdout.flush()
    chars: list[str] = []
    vis = len(prompt)

    def paint(reveal_last: bool) -> None:
        nonlocal vis
        sys.stdout.write("\r" + prompt)
        n = len(chars)
        for i, ch in enumerate(chars):
            if reveal_last and i + 1 == n and 32 <= ord(ch) < 127:
                sys.stdout.write(ch)
            else:
                sys.stdout.write("*")
        cols = len(prompt) + n
        if vis > cols:
            extra = vis - cols
            sys.stdout.write(" " * extra)
            sys.stdout.write("\b" * extra)
        vis = cols
        sys.stdout.flush()

    while True:
        ch = msvcrt.getwch()
        if ch in ("\r", "\n"):
            break
        if ch == "\x03":
            sys.stdout.write("\n")
            return ""
        if ch in ("\b", "\x7f"):
            if chars:
                chars.pop()
            paint(False)
            continue
        if ch in ("\x00", "\xe0"):
            msvcrt.getwch()
            continue
        if ord(ch) < 32:
            continue
        chars.append(ch)
        paint(True)
    paint(False)
    sys.stdout.write("\n")
    return "".join(chars)


def pause() -> None:
    read_line("\nEnter 키를 누르면 메뉴로 돌아갑니다. ")


def sleep_ms(ms: int) -> None:
    if ms > 0:
        time.sleep(ms / 1000.0)


def term_clear() -> None:
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()


def load_spin(total_speed: int, plus_text: str = "") -> None:
    if total_speed <= 0:
        total_speed = 10
    download_speed = 10
    total_time = total_speed // download_speed + 1
    cursor = "|/-\\"
    for i in range(total_time):
        current_size = i * download_speed
        ratio = min(1.0, current_size / float(total_speed))
        percent = ratio * 100.0
        sys.stdout.write(f"\r{plus_text}[{percent:.1f}%] Loading... {cursor[i % 4]}")
        sys.stdout.flush()
        sleep_ms(100)
    sys.stdout.write(f"\r{plus_text}[100.0%] Loading... *\n")
    sys.stdout.flush()


def load_spin_step(current: int, total: int, plus_text: str = "") -> None:
    cursor = "|/-\\"
    if total <= 0:
        total = 1
    current = max(0, min(current, total))
    percent = 100.0 * current / total
    sys.stdout.write(f"\r{plus_text}[{percent:.1f}%] Loading... {cursor[current % 4]}                    ")
    sys.stdout.flush()


def load_spin_done() -> None:
    sys.stdout.write("\r                                                                  \r")
    sys.stdout.flush()


def disappear_text(text: str) -> None:
    if not text:
        text = ""
    for i in range(2):
        color = 30 if i % 2 else 37
        sys.stdout.write(f"\033[{color}m")
        for ch in text:
            sys.stdout.write(ch)
            sys.stdout.flush()
            sleep_ms(100)
        sys.stdout.write("\033[0m\r")
        sleep_ms(500)
    sys.stdout.write("\n")


def char_in(value: str, sett: str) -> bool:
    """한 글자 메뉴 키가 sett 에 있는지."""
    return bool(value) and value in sett
