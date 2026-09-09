"""파이썬 조회 계층. GUI 가 lib.back.App 을 직접 부른다."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lib.back.data_manager import App  # noqa: E402
from lib.back.fs import config_paths, login_file_ensure, login_file_load  # noqa: E402
from lib.back.parse import parse_assignment_detail, parse_progress_json  # noqa: E402
from lib.back.sugang import load_demo_profile, session_label  # noqa: E402
from lib.seowon import LOGIN_FILE, SW_OK, Session  # noqa: E402

LOGIN_PATH = ROOT / LOGIN_FILE


def testdata_dir() -> Path:
    """데모·단위 테스트용 HTML/JSON 폴더."""
    return ROOT / "db" / "testdata"


def load_login_file() -> tuple[str, str]:
    """login.json 의 학번·비밀번호. 없거나 깨져 있으면 빈 문자열."""
    if not LOGIN_PATH.is_file():
        return "", ""
    try:
        lf = login_file_load(LOGIN_PATH)
    except (OSError, ValueError, json.JSONDecodeError):
        return "", ""
    pw = lf.password if lf.password.strip() else ""
    return lf.student_id, pw


def login_file_complete() -> bool:
    """학번과 비밀번호가 둘 다 있으면 로그인 입력을 건너뛴다."""
    sid, pw = load_login_file()
    return bool(sid and pw)


def ensure_login_file() -> Path:
    """없으면 빈 login.json 을 만든다."""
    login_file_ensure(LOGIN_PATH)
    return LOGIN_PATH


class BackendError(RuntimeError):
    """조회·로그인 실패를 GUI 에 넘기는 예외."""


class Backend:
    """조회·로그인을 같은 프로세스에서 수행한다."""

    def __init__(self) -> None:
        """데모 기본. login/fetch 때 App 을 다시 연다."""
        self.demo: bool = True
        self.logged_in: bool = False
        self.student_id: str = ""
        self.student_name: str = ""
        self.dept_name: str = ""
        self.dept_cd: str = ""
        self.data: dict[str, Any] = {"courses": [], "summary": []}
        self.last_error: str = ""
        self._app: App = App(ROOT, demo=True, quiet=True)

    def profile_label(self) -> str:
        """이름 (학번) · 학과. 칩·성공 카드에 쓴다."""
        return session_label(
            Session(
                student_id=self.student_id,
                student_name=self.student_name,
                dept_name=self.dept_name,
            )
        )

    def _sync_profile(self) -> None:
        """App.sess 를 GUI 가 읽는 필드로 복사한다."""
        s = self._app.sess
        self.student_id = s.student_id
        self.student_name = s.student_name
        self.dept_name = s.dept_name
        self.dept_cd = s.dept_cd
        self.logged_in = self._app.logged_in
        self.last_error = self._app.last_error

    def load_demo_result(self) -> dict[str, Any]:
        """testdata/sample_result.json 과 데모 프로필을 읽는다."""
        path = testdata_dir() / "sample_result.json"
        if not path.is_file():
            raise BackendError("db/testdata/sample_result.json 이 없습니다.")
        loaded: object = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise BackendError("sample_result.json 형식이 잘못되었습니다.")
        self.data = loaded
        load_demo_profile(testdata_dir(), self._app.sess)
        self._sync_profile()
        self.logged_in = True
        return self.data

    def login(self, student_id: str, password: str, demo: bool) -> dict[str, Any]:
        """e-campus 로그인 또는 데모 로그인. 칸이 비면 login.json 을 쓴다."""
        self.demo = demo
        file_sid, file_pw = load_login_file()
        student_id = (student_id or "").strip() or file_sid
        password = password or file_pw
        if not demo and (not student_id or not password):
            raise BackendError("학번 또는 비밀번호가 비어 있습니다. login.json 을 채우거나 입력하세요.")
        self._app = App(ROOT, demo=demo, quiet=True)
        self._app.boot()
        rc = self._app.login_with(student_id, password)
        self._sync_profile()
        if rc != SW_OK:
            raise BackendError(self.last_error or "로그인에 실패했습니다.")
        if demo:
            self.load_demo_result()
        return {
            "ok": True,
            "studentId": self.student_id,
            "studentName": self.student_name,
            "deptName": self.dept_name,
            "deptCd": self.dept_cd,
        }

    def try_session(self) -> bool:
        """session.json 쿠키로 재접속. 만료면 False."""
        self._app = App(ROOT, demo=False, quiet=True)
        self._app.boot()
        if self._app.try_session() != SW_OK:
            return False
        self.demo = False
        self._sync_profile()
        return True

    def fetch(self) -> dict[str, Any]:
        """과제·이러닝을 모아 result dict 로 돌린다."""
        if self.demo:
            return self.load_demo_result()
        if not self._app.logged_in and self._app.try_session() != SW_OK:
            raise BackendError("먼저 로그인하세요.")
        if self._app.fetch_assignments(True) != SW_OK or self._app.fetch_lessons(True) != SW_OK:
            raise BackendError(self._app.last_error or "조회에 실패했습니다.")
        self.data = self._app.result_dict()
        self.logged_in = True
        return self.data

    def load_saved(self) -> dict[str, Any]:
        """result.json 을 다시 그린다. 데모면 샘플을 쓴다."""
        if self.demo:
            return self.load_demo_result()
        if self._app.load_result() != SW_OK:
            path = ROOT / "db" / "result.json"
            if path.is_file():
                loaded: object = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(loaded, dict):
                    raise BackendError("result.json 형식이 잘못되었습니다.")
                self.data = loaded
                return self.data
            raise BackendError("저장된 결과가 없습니다.")
        _, rpath = config_paths(self._app.cfg)
        loaded = json.loads(rpath.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise BackendError("result.json 형식이 잘못되었습니다.")
        self.data = loaded
        return self.data

    def assignment_detail(self, course_i: int, assign_i: int) -> str:
        """고른 과제 본문. 데모는 testdata HTML."""
        if self.demo:
            html = testdata_dir() / "assignment_detail.html"
            if html.is_file():
                return parse_assignment_detail(html.read_text(encoding="utf-8", errors="replace"))
            return "(데모 상세 파일이 없습니다)"
        try:
            if not self._app.courses:
                self._app.fetch_assignments(True)
            return self._app.fetch_assignment_detail(course_i, assign_i)
        except Exception as e:
            raise BackendError("상세 조회 실패") from e

    def lesson_progress(self, course_i: int, lesson_i: int) -> int:
        """고른 차시 학습률(%). 시청 기록은 보내지 않는다."""
        if self.demo:
            raw = testdata_dir() / "progress.json"
            if raw.is_file():
                return parse_progress_json(raw.read_text(encoding="utf-8"))
            return 72
        try:
            if not self._app.courses:
                self._app.fetch_lessons(True)
            return self._app.fetch_progress(course_i, lesson_i)
        except Exception as e:
            raise BackendError("학습률 조회 실패") from e

    def save_result_copy(self) -> Path:
        """지금 화면의 조회 결과를 db/result.json 에 쓴다."""
        dest = ROOT / "db" / "result.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        return dest
