"""파이썬 조회 계층. GUI 가 ``lib.back.App`` 을 직접 부른다.

워커 스레드에서 이 클래스만 부르면 된다. 예외는 ``BackendError``.
"""

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
from lib.back.parse import parse_assignment_detail, parse_file_down_links, parse_progress_json  # noqa: E402
from lib.back.sugang import load_demo_profile, session_label, session_org  # noqa: E402
from lib.seowon import LOGIN_FILE, SW_OK, BoardPost, Session  # noqa: E402

LOGIN_PATH = ROOT / LOGIN_FILE


def testdata_dir() -> Path:
    """데모·단위 테스트용 HTML/JSON 폴더.

    Returns:
        ``db/testdata``.
    """
    return ROOT / "db" / "testdata"


def load_login_file() -> tuple[str, str]:
    """``login.json`` 의 학번·비밀번호. 없거나 깨져 있으면 빈 문자열.

    Returns:
        ``(학번, 비밀번호)``.
    """
    if not LOGIN_PATH.is_file():
        return "", ""
    try:
        lf = login_file_load(LOGIN_PATH)
    except (OSError, ValueError, json.JSONDecodeError):
        return "", ""
    pw = lf.password if lf.password.strip() else ""
    return lf.student_id, pw


def login_file_complete() -> bool:
    """학번과 비밀번호가 둘 다 있으면 로그인 입력을 건너뛴다.

    Returns:
        둘 다 있으면 True.
    """
    sid, pw = load_login_file()
    return bool(sid and pw)


def ensure_login_file() -> Path:
    """없으면 빈 ``login.json`` 을 만든다.

    Returns:
        login.json 경로.
    """
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
        self.college_name: str = ""
        self.dept_name: str = ""
        self.dept_cd: str = ""
        self.data: dict[str, Any] = {"courses": [], "summary": [], "timetable": {}}
        self.last_error: str = ""
        self._app: App = App(ROOT, demo=True, quiet=True)

    def profile_label(self) -> str:
        """이름 (학번) · 학과. 칩·성공 카드에 쓴다.

        Returns:
            한 줄 라벨.
        """
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
        college, dept = session_org(s)
        self.college_name = college
        self.dept_name = dept or s.dept_name
        self.dept_cd = s.dept_cd
        self.logged_in = self._app.logged_in
        self.last_error = self._app.last_error

    def load_demo_result(self) -> dict[str, Any]:
        """``testdata/sample_result.json`` 과 데모 프로필을 읽는다.

        Returns:
            GUI 가 그리는 result dict.

        Raises:
            BackendError: 파일이 없거나 형식이 잘못됐을 때.
        """
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
        """e-campus 로그인 또는 데모 로그인. 칸이 비면 ``login.json`` 을 쓴다.

        Parameters
        ----------
        student_id : str
            학번. 비면 login.json.
        password : str
            비밀번호. 비면 login.json.
        demo : bool
            True 면 testdata 만 쓴다.

        Returns
        -------
        dict
            ``ok``, 학번, 이름, 대학, 학과.

        Raises
        ------
        BackendError
            칸이 비었거나 로그인이 실패했을 때.
        """
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
            "collegeName": self.college_name,
            "deptName": self.dept_name,
            "deptCd": self.dept_cd,
        }

    def try_session(self) -> bool:
        """``session.json`` 쿠키로 재접속. 만료면 False.

        Returns:
            세션이 살아 있으면 True.
        """
        self._app = App(ROOT, demo=False, quiet=True)
        self._app.boot()
        if self._app.try_session() != SW_OK:
            return False
        self.demo = False
        self._sync_profile()
        return True

    def fetch(self) -> dict[str, Any]:
        """과제·이러닝을 모아 result dict 로 돌린다.

        Returns:
            ``courses`` / ``summary`` JSON.

        Raises:
            BackendError: 로그인 전 또는 조회 실패.
        """
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
        """``result.json`` 을 다시 그린다. 데모면 샘플을 쓴다.

        Returns:
            result dict.

        Raises:
            BackendError: 파일이 없거나 형식이 잘못됐을 때.
        """
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
        """고른 과제 본문. 데모는 testdata HTML.

        Args:
            course_i: 과목 인덱스.
            assign_i: 과제 인덱스.

        Returns:
            본문 문자열.
        """
        return str(self.assignment_detail_full(course_i, assign_i).get("text") or "")

    def assignment_detail_full(self, course_i: int, assign_i: int) -> dict[str, Any]:
        """과제 본문과 첨부.

        Args:
            course_i: 과목 인덱스.
            assign_i: 과제 인덱스.

        Returns:
            ``text``, ``attachments``.

        Raises:
            BackendError: 상세 조회 실패.
        """
        if self.demo:
            html = testdata_dir() / "assignment_detail.html"
            raw = html.read_text(encoding="utf-8", errors="replace") if html.is_file() else ""
            text = parse_assignment_detail(raw) if raw else "(데모 상세 파일이 없습니다)"
            atts = parse_file_down_links(raw) if raw else []
            return {
                "text": text,
                "attachments": [{"title": a.title, "url": a.url, "token": a.token} for a in atts],
            }
        try:
            if not self._app.courses:
                self._app.fetch_assignments(True)
            text, atts = self._app.fetch_assignment_detail_parts(course_i, assign_i)
            return {
                "text": text,
                "attachments": [{"title": a.title, "url": a.url, "token": a.token} for a in atts],
            }
        except Exception as e:
            raise BackendError("상세 조회 실패") from e

    def submit_assignment(self, course_i: int, assign_i: int, text: str, file_path: str | None) -> str:
        """과제 제출. 데모는 상태만 바꾸고, 실제는 e-campus 로 보낸다.

        Parameters
        ----------
        course_i : int
            과목 인덱스.
        assign_i : int
            과제 인덱스.
        text : str
            제출 글.
        file_path : str or None
            첨부 경로.

        Returns
        -------
        str
            성공 안내.

        Raises
        ------
        BackendError
            내용 없음 또는 서버 거절.
        """
        if self.demo:
            courses = self.data.get("courses") or []
            try:
                item = courses[course_i]["assignments"][assign_i]
            except (IndexError, KeyError, TypeError) as e:
                raise BackendError("과제를 다시 조회한 뒤 제출하세요.") from e
            if not (text or "").strip() and not file_path:
                raise BackendError("제출할 내용이나 파일을 넣어 주세요.")
            item["status"] = "과제를 제출하였습니다"
            item["dueNow"] = False
            return "데모 모드에서 제출한 것으로 표시했습니다."
        try:
            if not self._app.courses:
                self._app.fetch_assignments(True)
            msg = self._app.submit_assignment(course_i, assign_i, text, file_path)
            self.data = self._app.result_dict()
            return msg
        except Exception as e:
            raise BackendError(str(e) or "과제 제출에 실패했습니다.") from e

    def _dump_posts(self, posts: list[BoardPost]) -> list[dict[str, Any]]:
        """공지·자료 JSON.

        Args:
            posts: 글 목록.

        Returns:
            GUI dict 목록.
        """
        rows = []
        for p in posts:
            rows.append(
                {
                    "id": p.id,
                    "title": p.title,
                    "date": p.date,
                    "hasAttachment": bool(p.has_attachment),
                    "crsCreCd": p.crs_cre_cd,
                    "bbsId": p.bbs_id,
                    "bbsCd": p.bbs_cd,
                    "text": p.text,
                    "attachments": [{"title": a.title, "url": a.url, "token": a.token} for a in p.attachments],
                }
            )
        return rows

    def _merge_board(self, key: str) -> None:
        """데모 ``sample_result`` 과 조회 결과를 과목 코드로 합친다.

        Args:
            key: ``notices`` 또는 ``materials``.
        """
        by_cd = {c.course.crs_cre_cd: c for c in self._app.courses}
        courses = list(self.data.get("courses") or [])
        if not courses:
            self.data = self._app.result_dict()
            return
        for course in courses:
            src = by_cd.get(str(course.get("crsCreCd") or ""))
            if src is None:
                continue
            posts = src.notices if key == "notices" else src.materials
            course[key] = self._dump_posts(posts)
        self.data["courses"] = courses

    def fetch_notices(self) -> dict[str, Any]:
        """전 과목 공지.

        Returns:
            result dict.

        Raises:
            BackendError: 로그인 전 또는 조회 실패.
        """
        if self.demo:
            self._app.demo = True
            if self._app.fetch_notices(True) != SW_OK:
                raise BackendError(self._app.last_error or "공지를 가져오지 못했습니다.")
            self._merge_board("notices")
            return self.data
        if not self._app.logged_in and self._app.try_session() != SW_OK:
            raise BackendError("먼저 로그인하세요.")
        if self._app.fetch_notices(True) != SW_OK:
            raise BackendError(self._app.last_error or "공지를 가져오지 못했습니다.")
        self.data = self._app.result_dict()
        return self.data

    def fetch_materials(self) -> dict[str, Any]:
        """전 과목 강의자료실.

        Returns:
            result dict.

        Raises:
            BackendError: 로그인 전 또는 조회 실패.
        """
        if self.demo:
            self._app.demo = True
            if self._app.fetch_materials(True) != SW_OK:
                raise BackendError(self._app.last_error or "자료를 가져오지 못했습니다.")
            self._merge_board("materials")
            return self.data
        if not self._app.logged_in and self._app.try_session() != SW_OK:
            raise BackendError("먼저 로그인하세요.")
        if self._app.fetch_materials(True) != SW_OK:
            raise BackendError(self._app.last_error or "자료를 가져오지 못했습니다.")
        self.data = self._app.result_dict()
        return self.data

    def fetch_timetable(self) -> dict[str, Any]:
        """수강 시간표.

        Returns:
            result dict. ``timetable`` 키가 채워진다.

        Raises:
            BackendError: 로그인 전 또는 조회 실패.
        """
        if self.demo:
            self._app.demo = True
        elif not self._app.logged_in and self._app.try_session() != SW_OK:
            raise BackendError("먼저 로그인하세요.")
        if self._app.fetch_timetable() != SW_OK:
            raise BackendError(self._app.last_error or "시간표를 가져오지 못했습니다.")
        self.data["timetable"] = self._app.timetable
        if not self.demo:
            self.data = self._app.result_dict()
            self.data["timetable"] = self._app.timetable
        return self.data

    def board_detail(self, course_i: int, post_i: int, section: str) -> dict[str, Any]:
        """공지·자료 본문과 첨부.

        Args:
            course_i: 과목 인덱스.
            post_i: 글 인덱스.
            section: ``notices`` 또는 ``materials``.

        Returns:
            ``text``, ``attachments``.

        Raises:
            BackendError: 상세 조회 실패.
        """
        try:
            if self.demo:
                self._app.demo = True
                if section == "materials":
                    if not self._app.courses or not any(c.materials for c in self._app.courses):
                        self._app.fetch_materials(True)
                elif not self._app.courses or not any(c.notices for c in self._app.courses):
                    self._app.fetch_notices(True)
            self._app.fetch_board_detail(course_i, post_i, section)
            post = self._app._board_post(course_i, post_i, section)
            return {
                "text": post.text or "(본문이 없습니다)",
                "attachments": [{"title": a.title, "url": a.url, "token": a.token} for a in post.attachments],
            }
        except Exception as e:
            raise BackendError("상세 조회 실패") from e

    def download_attachment(self, url: str, dest: str) -> str:
        """첨부를 로컬 파일로 저장한다.

        Args:
            url: e-campus 첨부 주소.
            dest: 저장 경로.

        Returns:
            실제 저장 경로.

        Raises:
            BackendError: 다운로드 실패.
        """
        try:
            path = self._app.download_attachment(url, Path(dest))
            return str(path)
        except Exception as e:
            raise BackendError(str(e) or "파일을 받지 못했습니다.") from e

    def lesson_progress(self, course_i: int, lesson_i: int) -> int:
        """고른 차시 학습률(%).

        Args:
            course_i: 과목 인덱스.
            lesson_i: 차시 인덱스.

        Returns:
            퍼센트 정수.

        Raises:
            BackendError: 조회 실패.
        """
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
        """지금 화면의 조회 결과를 ``db/result.json`` 에 쓴다.

        Returns:
            저장한 경로.
        """
        dest = ROOT / "db" / "result.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        return dest
