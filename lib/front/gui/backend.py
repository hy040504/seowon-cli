"""TUI 백엔드(seowon-tui --rpc)와 testdata 를 쓰는 GUI 조회 계층."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
LOGIN_PATH = ROOT / "login.json"


def find_tui_exe() -> Path | None:
    for name in ("seowon-tui.exe", "seowon-core.exe", "seowon-cli.exe"):
        p = ROOT / name
        if p.is_file():
            return p
    return None


def _find_percent(obj: Any) -> int | None:
    if isinstance(obj, dict):
        for key in ("prgrRatio", "progressPercent"):
            if key in obj and obj[key] is not None:
                try:
                    return int(obj[key])
                except (TypeError, ValueError):
                    pass
        for val in obj.values():
            found = _find_percent(val)
            if found is not None:
                return found
    return None


def testdata_dir() -> Path:
    return ROOT / "db" / "testdata"


def load_login_file() -> tuple[str, str]:
    """login.json 에서 학번·비밀번호를 읽는다. 없거나 깨지면 빈 값."""
    if not LOGIN_PATH.is_file():
        return "", ""
    try:
        raw = json.loads(LOGIN_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "", ""
    if not isinstance(raw, dict):
        return "", ""
    sid = str(raw.get("studentId") or "").strip()
    pw = str(raw.get("password") or "")
    if not pw.strip():
        pw = ""
    return sid, pw


def login_file_complete() -> bool:
    sid, pw = load_login_file()
    return bool(sid and pw)


def ensure_login_file() -> Path:
    """없으면 빈 login.json 을 만든다."""
    if not LOGIN_PATH.is_file():
        LOGIN_PATH.write_text(
            json.dumps({"studentId": "", "password": ""}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return LOGIN_PATH


class BackendError(RuntimeError):
    pass


class Backend:
    def __init__(self) -> None:
        self.demo = True
        self.logged_in = False
        self.student_id = ""
        self.student_name = ""
        self.dept_name = ""
        self.dept_cd = ""
        self.data: dict[str, Any] = {"courses": [], "summary": []}
        self.last_error = ""

    def profile_label(self) -> str:
        sid = self.student_id or "-"
        if self.student_name and self.dept_name:
            return f"{self.student_name} ({sid}) · {self.dept_name}"
        if self.student_name:
            return f"{self.student_name} ({sid})"
        if self.dept_name:
            return f"{sid} · {self.dept_name}"
        return sid

    def _apply_profile(self, out: dict[str, Any], fallback_id: str = "") -> None:
        self.student_id = str(out.get("studentId") or fallback_id or self.student_id or "")
        self.student_name = str(out.get("studentName") or self.student_name or "")
        self.dept_name = str(out.get("deptName") or self.dept_name or "")
        self.dept_cd = str(out.get("deptCd") or self.dept_cd or "")

    def _load_demo_profile(self) -> None:
        path = testdata_dir() / "student.json"
        if path.is_file():
            j = json.loads(path.read_text(encoding="utf-8"))
            self.student_id = str(j.get("stuno") or self.student_id or "20241234")
            self.student_name = str(j.get("stdntNm") or "")
            self.dept_name = str(j.get("deprtNm") or "")
            self.dept_cd = str(j.get("deptCd") or "")
        elif not self.student_id:
            self.student_id = "20241234"
            self.student_name = "홍길동"
            self.dept_name = "컴퓨터공학과"

    def load_demo_result(self) -> dict[str, Any]:
        path = testdata_dir() / "sample_result.json"
        if not path.is_file():
            raise BackendError("db/testdata/sample_result.json 이 없습니다.")
        self.data = json.loads(path.read_text(encoding="utf-8"))
        self.logged_in = True
        self._load_demo_profile()
        return self.data

    def login(self, student_id: str, password: str, demo: bool) -> dict[str, Any]:
        self.demo = demo
        file_sid, file_pw = load_login_file()
        student_id = (student_id or "").strip() or file_sid
        password = password or file_pw
        if not demo and (not student_id or not password):
            raise BackendError("학번 또는 비밀번호가 비어 있습니다. login.json 을 채우거나 입력하세요.")
        exe = find_tui_exe()
        if demo:
            if exe:
                env = os.environ.copy()
                env["SEOWON_ID"] = student_id
                env["SEOWON_PW"] = password or "demo"
                out = self._run(exe, ["--demo", "--rpc", "login"], env=env)
                self.logged_in = True
                self._apply_profile(out, student_id)
                if not self.student_name:
                    self._load_demo_profile()
                self.load_demo_result()
                return out
            self.load_demo_result()
            if student_id.strip():
                self.student_id = student_id.strip()
            return {
                "ok": True,
                "studentId": self.student_id,
                "studentName": self.student_name,
                "deptName": self.dept_name,
            }

        if not exe:
            raise BackendError("seowon-tui.exe 또는 seowon-core.exe 가 없습니다. 먼저 build.bat 를 실행하세요.")
        env = os.environ.copy()
        env["SEOWON_ID"] = student_id
        env["SEOWON_PW"] = password
        out = self._run(exe, ["--rpc", "login"], env=env)
        if not out.get("ok"):
            raise BackendError(out.get("error") or "로그인에 실패했습니다.")
        self.logged_in = True
        self._apply_profile(out, student_id)
        return out

    def try_session(self) -> bool:
        exe = find_tui_exe()
        if not exe:
            return False
        out = self._run(exe, ["--rpc", "session"])
        if out.get("ok"):
            self.logged_in = True
            self._apply_profile(out)
            return True
        return False

    def fetch(self) -> dict[str, Any]:
        if self.demo:
            return self.load_demo_result()
        exe = find_tui_exe()
        if not exe:
            raise BackendError("seowon-tui.exe 또는 seowon-core.exe 가 없습니다. 먼저 build.bat 를 실행하세요.")
        args = ["--rpc", "fetch"]
        out = self._run_raw(exe, args)
        data = json.loads(out)
        if isinstance(data, dict) and data.get("ok") is False:
            raise BackendError(data.get("error") or "조회에 실패했습니다.")
        self.data = data
        self.logged_in = True
        return data

    def load_saved(self) -> dict[str, Any]:
        if self.demo:
            return self.load_demo_result()
        exe = find_tui_exe()
        if not exe:
            path = ROOT / "db" / "result.json"
            if path.is_file():
                self.data = json.loads(path.read_text(encoding="utf-8"))
                return self.data
            raise BackendError("저장된 결과가 없습니다.")
        out = self._run_raw(exe, ["--rpc", "load"])
        data = json.loads(out)
        if isinstance(data, dict) and data.get("ok") is False:
            raise BackendError(data.get("error") or "불러오기에 실패했습니다.")
        self.data = data
        return data

    def assignment_detail(self, course_i: int, assign_i: int) -> str:
        if self.demo:
            html = testdata_dir() / "assignment_detail.html"
            if html.is_file():
                return _html_to_text(html.read_text(encoding="utf-8", errors="replace"))
            return "(데모 상세 파일이 없습니다)"
        exe = find_tui_exe()
        if not exe:
            raise BackendError("seowon-tui.exe 또는 seowon-core.exe 가 없습니다.")
        out = self._run(exe, ["--rpc", "detail", str(course_i), str(assign_i)])
        if not out.get("ok"):
            raise BackendError(out.get("error") or "상세 조회 실패")
        return str(out.get("detail") or "")

    def lesson_progress(self, course_i: int, lesson_i: int) -> int:
        if self.demo:
            raw = testdata_dir() / "progress.json"
            if raw.is_file():
                j = json.loads(raw.read_text(encoding="utf-8"))
                pct = _find_percent(j)
                return pct if pct is not None else 72
            return 72
        exe = find_tui_exe()
        if not exe:
            raise BackendError("seowon-tui.exe 또는 seowon-core.exe 가 없습니다.")
        out = self._run(exe, ["--rpc", "progress", str(course_i), str(lesson_i)])
        if not out.get("ok"):
            raise BackendError(out.get("error") or "학습률 조회 실패")
        return int(out.get("percent") or -1)

    def save_result_copy(self) -> Path:
        dest = ROOT / "db" / "result.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        return dest

    def _run(self, exe: Path, args: list[str], env: dict[str, str] | None = None) -> dict[str, Any]:
        raw = self._run_raw(exe, args, env)
        return json.loads(raw)

    def _run_raw(self, exe: Path, args: list[str], env: dict[str, str] | None = None) -> str:
        cmd = [str(exe)]
        if self.demo and "--rpc" in args and args[args.index("--rpc") + 1] != "login":
            cmd.append("--demo")
        cmd.extend(args)
        proc = subprocess.run(
            cmd,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        text = (proc.stdout or "").strip()
        if not text:
            err = (proc.stderr or "").strip() or f"종료 코드 {proc.returncode}"
            raise BackendError(err)
        return text.splitlines()[-1] if args[:2] == ["--rpc", "login"] or (
            args[:1] == ["--rpc"] and args[1] in ("login", "session", "detail", "progress")
        ) else text


def _html_to_text(html: str) -> str:
    out: list[str] = []
    i = 0
    skip = False
    while i < len(html):
        if html.startswith("<", i):
            gt = html.find(">", i)
            if gt < 0:
                break
            name = html[i + 1 : gt].split()[0].strip("/").lower()
            if name in ("br", "p", "div", "tr", "li"):
                out.append("\n")
            if name in ("script", "style"):
                skip = not html.startswith("</", i)
            i = gt + 1
            continue
        if not skip:
            out.append(html[i])
        i += 1
    text = "".join(out)
    for a, b in (("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&"), ("&quot;", '"')):
        text = text.replace(a, b)
    lines = [" ".join(line.split()) for line in text.splitlines()]
    return "\n".join(line for line in lines if line)
