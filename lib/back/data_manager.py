"""로그인 · 조회 · 결과 저장.

``App`` 은 TUI 와 GUI 가 같이 쓰는 조회 엔진이다. 데모 모드면 testdata HTML 을 읽는다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from lib.seowon import (
    ASSIGN_LIST,
    ASSIGN_RIGHT,
    ASSIGN_SEND,
    ASSIGN_SEND_VIEW,
    ASSIGN_VIEW,
    ASSIGN_VIEW_AJAX,
    ATCL_LIST,
    FILE_AJAX_UPLOAD,
    BASE_URL,
    COURSE_LIST,
    LESSON_FORM,
    LESSON_INFO,
    LESSON_LIST,
    LESSON_MCD,
    LIST_SCALE,
    LOGIN_API,
    LOGIN_FILE,
    LOGIN_PAGE,
    PROGRESS_TYPE,
    STUDY_DETAIL,
    SW_ERR,
    SW_ERR_AUTH,
    SW_ERR_IO,
    SW_ERR_NET,
    SW_ERR_OTP,
    SW_ERR_PARSE,
    SW_ERR_SESSION,
    SW_OK,
    VIEW_ATCL,
    Attachment,
    BoardPost,
    Config,
    CourseData,
    Session,
    find_testdata,
)
from lib.back.crypto import make_encrypt_data
from lib.back.fs import (
    config_default,
    config_load,
    config_paths,
    config_save,
    login_file_complete,
    login_file_ensure,
    login_file_load,
    login_file_wipe,
    result_load,
    result_save,
    session_load,
    session_save,
)
from lib.back.http import HttpClient
from lib.back.parse import (
    SessionExpired,
    course_semester,
    extract_upload_file_sn,
    looks_like_campus_file_url,
    mark_assignment_flags,
    parse_assignment_detail,
    parse_assignment_send_type,
    parse_assignment_title,
    parse_assignments_html,
    parse_bbs_list_html,
    parse_courses_html,
    parse_file_down_links,
    parse_lessons_html,
    parse_login_json,
    parse_notice_detail,
    parse_progress_json,
    parse_submit_ok,
)
from lib.back.sugang import fetch_profile, fetch_registered_subjects, load_demo_profile, session_label
from lib.back.timetable import build_timetable, render_timetable_svg
from lib.front.tui.ui import ui_err, ui_info, ui_ok, ui_warn
from lib.util import (
    form_encode,
    load_spin,
    load_spin_done,
    load_spin_step,
    now_iso,
    read_file,
    read_line,
    read_password,
)

_FORM = "application/x-www-form-urlencoded; charset=UTF-8"


class App:
    """로그인 · 과제/이러닝 조회 · JSON 저장. TUI·GUI 가 같이 쓴다."""

    def __init__(self, root: str | Path, demo: bool = False, quiet: bool = False) -> None:
        """작업 폴더와 데모/조용 모드. HTTP 는 ``boot`` 에서 다시 연다.

        Args:
            root: 프로젝트 루트.
            demo: True 면 testdata 만 쓴다.
            quiet: True 면 콘솔 메시지를 찍지 않는다.
        """
        self.root = Path(root)
        self.demo: bool = demo
        self.quiet: bool = quiet
        self.cfg: Config = config_default()
        self.sess: Session = Session()
        self.http: HttpClient = HttpClient()
        self.courses: list[CourseData] = []
        self.timetable: dict[str, Any] = {}
        self._sugang_pw: str = ""
        self.logged_in: bool = False
        self.testdata_dir = find_testdata(self.root)
        self.last_error: str = ""
        try:
            self.http.init(self.cfg.base_url)
        except Exception:
            pass

    def _say_ok(self, msg: str) -> None:
        """quiet 가 아니면 성공 줄을 찍는다.

        Args:
            msg: 메시지.
        """
        if not self.quiet:
            ui_ok(msg)

    def _say_err(self, msg: str) -> None:
        """``last_error`` 를 남기고, quiet 가 아니면 오류를 찍는다.

        Args:
            msg: 메시지.
        """
        self.last_error = msg
        if not self.quiet:
            ui_err(msg)

    def _say_info(self, msg: str) -> None:
        """quiet 가 아니면 안내를 찍는다.

        Args:
            msg: 메시지.
        """
        if not self.quiet:
            ui_info(msg)

    def _say_warn(self, msg: str) -> None:
        """quiet 가 아니면 경고를 찍는다.

        Args:
            msg: 메시지.
        """
        if not self.quiet:
            ui_warn(msg)

    def _spin(self, speed: int, text: str) -> None:
        """quiet 가 아니면 로딩 막대를 돌린다.

        Args:
            speed: 막대 스케일.
            text: 접두어.
        """
        if not self.quiet:
            load_spin(speed, text)

    def _demo_read(self, name: str) -> str:
        """``db/testdata`` 의 고정 응답 파일.

        Args:
            name: 파일 이름.

        Returns:
            UTF-8 내용.
        """
        return read_file(Path(self.testdata_dir) / name)

    def _post_form(self, path: str, fields: list[tuple[str, str]], referer: str | None = None) -> str:
        """e-campus 폼 POST. 본문은 UTF-8 urlencoded.

        Args:
            path: e-campus 경로.
            fields: 폼 필드.
            referer: Referer. None 이면 BASE_URL.

        Returns:
            응답 텍스트.
        """
        html, _ = self.http.post(path, referer or BASE_URL, _FORM, form_encode(fields), ajax=True)
        return html

    def boot(self) -> int:
        """config · login.json · 저장 세션을 읽는다. 만료면 다시 로그인한다.

        Returns:
            ``SW_OK``. 설정이 없어도 기본값을 만들고 성공으로 본다.
        """
        try:
            self.cfg = config_load(self.root / "config.json")
        except Exception:
            self.cfg = config_default()
            self.cfg.config_path = str(self.root / "config.json")
            config_save(self.cfg)
            self._say_info("config.json 이 없어 기본값으로 만들었습니다.")
        Path(self.cfg.data_dir).mkdir(parents=True, exist_ok=True)
        try:
            login_file_ensure(self.root / LOGIN_FILE)
        except Exception:
            self._say_warn("login.json 을 만들지 못했습니다.")
        if not self.demo:
            try:
                self.http.init(self.cfg.base_url)
            except Exception:
                pass
        if self.demo:
            load_demo_profile(self.testdata_dir, self.sess)
            return SW_OK
        spath, _ = config_paths(self.cfg)
        if self.cfg.save_session and spath.is_file():
            try:
                self.sess = session_load(spath)
            except Exception:
                return SW_OK
            if self.http.cookie_usable() or self.sess.cookies:
                self.http.apply_cookies(self.sess.cookies)
                self._say_info("저장된 세션으로 접속을 시도합니다.")
                if self.try_session() == SW_OK:
                    self._say_ok("세션을 재사용했습니다. 비밀번호 없이 이어서 조회합니다.")
                    return SW_OK
                self._say_warn("세션이 만료되었습니다. 다시 로그인하세요.")
        return SW_OK

    def try_session(self) -> int:
        """쿠키로 과목 목록을 열어 세션이 살아 있는지 본다.

        Returns:
            살아 있으면 ``SW_OK``, 아니면 ``SW_ERR_SESSION``.
        """
        if self.demo:
            self.logged_in = True
            return SW_OK
        if self.fetch_courses() == SW_OK and self.courses:
            self.logged_in = True
            return SW_OK
        self.logged_in = False
        return SW_ERR_SESSION

    def ensure_auth(self) -> int:
        """로그인되어 있지 않으면 세션 재사용 또는 입력을 받는다.

        Returns:
            로그인 결과 코드.
        """
        if self.logged_in:
            return SW_OK
        if self.demo:
            self.logged_in = True
            return SW_OK
        if self.http.cookie_usable() and self.try_session() == SW_OK:
            return SW_OK
        return self.login_interactive()

    def login_interactive(self) -> int:
        """``login.json`` 이 완전하면 그걸로, 아니면 학번·비밀번호를 묻는다.

        Returns:
            ``login_with`` 결과 코드.
        """
        if self.demo:
            return self.login_with("", "")
        try:
            lf = login_file_load(self.root / LOGIN_FILE)
        except Exception:
            lf = None
        if lf and login_file_complete(lf):
            self._say_info("login.json 의 학번·비밀번호로 로그인합니다.")
            rc = self.login_with(lf.student_id, lf.password)
            login_file_wipe(lf)
            return rc
        if lf:
            login_file_wipe(lf)
        self._say_info("login.json 에 학번 또는 비밀번호가 없어 직접 입력합니다.")
        hint = f" [{self.cfg.last_student_id}]" if self.cfg.last_student_id else ""
        sid = read_line(f"학번{hint}: ")
        if not sid:
            sid = self.cfg.last_student_id
        pw = read_password("비밀번호: ")
        return self.login_with(sid, pw)

    def login_with(self, sid: str, pw: str) -> int:
        """NICE ``encryptData`` 로 로그인하고 sugangh 에서 이름·학과를 채운다.

        Parameters
        ----------
        sid : str
            학번. 비면 config 의 마지막 학번.
        pw : str
            비밀번호. 세션 파일에는 쓰지 않고 메모리에만 둔다.

        Returns
        -------
        int
            ``SW_OK`` 또는 ``SW_ERR_*``. OTP 면 ``SW_ERR_OTP``.
        """
        if self.demo:
            self.sess.student_id = sid or self.cfg.last_student_id or "20241234"
            self.sess.user_no = self.sess.student_id
            load_demo_profile(self.testdata_dir, self.sess)
            self._sugang_pw = pw or ""
            self.logged_in = True
            self._say_ok("데모 모드: 실제 로그인 없이 샘플 데이터로 진행합니다.")
            return SW_OK

        idbuf = (sid or "").strip() or self.cfg.last_student_id
        if not idbuf:
            self._say_err("학번이 비어 있습니다.")
            return SW_ERR
        if not pw:
            self._say_err("비밀번호가 비어 있습니다.")
            return SW_ERR

        self._spin(50, "로그인 페이지 ")
        referer = BASE_URL + LOGIN_PAGE
        try:
            self.http.get(LOGIN_PAGE, referer=None, ajax=False)
        except Exception:
            self._say_err(self.http.last_error or "서버에 연결하지 못했습니다.")
            return SW_ERR_NET

        enc = make_encrypt_data(idbuf, pw)
        self._spin(50, "인증 요청 ")
        try:
            resp = self._post_form(LOGIN_API, [("encryptData", enc)], referer)
        except Exception:
            self._say_err(self.http.last_error or "요청 전송에 실패했습니다.")
            return SW_ERR_NET

        try:
            lr = parse_login_json(resp)
        except ValueError:
            self._say_err("로그인 응답을 해석하지 못했습니다.")
            return SW_ERR_PARSE
        if lr.type == 0:
            self._say_err(lr.message)
            return SW_ERR_AUTH
        if lr.type == 2:
            self._say_err(lr.message)
            return SW_ERR_OTP

        self.sess.student_id = idbuf
        self.sess.user_no = lr.user_no or idbuf
        self.sess.saved_at = now_iso()
        self.sess.cookies = self.http.snapshot()
        self._sugang_pw = pw

        self._spin(50, "학생 정보 ")
        fetch_profile(idbuf, pw, self.sess)

        self.cfg.last_student_id = idbuf
        self.cfg.config_path = str(self.root / "config.json")
        config_save(self.cfg)
        if self.cfg.save_session:
            spath, _ = config_paths(self.cfg)
            session_save(spath, self.sess)
        self.logged_in = True
        who = session_label(self.sess)
        if self.sess.student_name or self.sess.dept_name:
            self._say_ok(f"로그인에 성공했습니다.  {who}")
        else:
            self._say_ok("로그인에 성공했습니다.")
        return SW_OK

    def fetch_courses(self) -> int:
        """수강 과목 목록. 데모는 ``testdata/courses.html``.

        Returns:
            ``SW_OK`` 또는 네트워크/파싱 오류 코드.
        """
        try:
            if self.demo:
                html = self._demo_read("courses.html")
            else:
                html = self._post_form(COURSE_LIST, [("crsCreCd", "")])
        except Exception:
            if self.demo:
                self._say_err("testdata/courses.html 을 읽지 못했습니다.")
                return SW_ERR_IO
            self._say_err(self.http.last_error or "네트워크 오류")
            return SW_ERR_NET
        try:
            self.courses = parse_courses_html(html)
        except SessionExpired:
            self.last_error = "과목 목록을 해석하지 못했습니다. 세션을 확인하세요."
            return SW_ERR_SESSION
        except Exception:
            self.last_error = "과목 목록을 해석하지 못했습니다. 세션을 확인하세요."
            return SW_ERR_SESSION
        self.sess.cookies = self.http.snapshot()
        return SW_OK

    def _fetch_one_assignments(self, c: CourseData) -> int:
        """한 과목의 과제 목록을 채운다.

        Args:
            c: 대상 과목.

        Returns:
            ``SW_OK`` 또는 오류 코드.
        """
        try:
            if self.demo:
                if c.course.title != "논리회로":
                    c.fetched_asg = True
                    return SW_OK
                html = self._demo_read("assignments.html")
            else:
                html = self._post_form(
                    ASSIGN_LIST,
                    [
                        ("pageIndex", "1"),
                        ("listScale", LIST_SCALE),
                        ("searchValue", ""),
                        ("crsCreCd", c.course.crs_cre_cd),
                        ("userNo", self.sess.user_no or self.sess.student_id),
                        ("userName", ""),
                    ],
                )
        except Exception:
            return SW_ERR_NET if not self.demo else SW_ERR_IO
        try:
            c.assignments = parse_assignments_html(html, c.course.crs_cre_cd)
        except Exception:
            return SW_ERR_PARSE
        for a in c.assignments:
            a.crs_cre_cd = c.course.crs_cre_cd
        c.fetched_asg = True
        return SW_OK

    def _fetch_one_lessons(self, c: CourseData) -> int:
        """한 과목의 이러닝 차시를 채운다.

        Args:
            c: 대상 과목.

        Returns:
            ``SW_OK`` 또는 오류 코드.
        """
        try:
            if self.demo:
                if c.course.title != "논리회로":
                    c.fetched_les = True
                    return SW_OK
                html = self._demo_read("lessons.html")
            else:
                path = f"{LESSON_FORM}?mcd={LESSON_MCD}&crsCreCd={c.course.crs_cre_cd}"
                self.http.get(path, referer=BASE_URL, ajax=False)
                try:
                    self._post_form(LESSON_INFO, [("crsCreCd", c.course.crs_cre_cd)])
                except Exception:
                    pass
                html = self._post_form(
                    LESSON_LIST,
                    [
                        ("pageIndex", "1"),
                        ("listScale", LIST_SCALE),
                        ("searchValue", ""),
                        ("crsCreCd", c.course.crs_cre_cd),
                        ("lessonScheduleId", ""),
                        ("subParam", "GRID"),
                        ("progressTypeCd", PROGRESS_TYPE),
                    ],
                )
        except Exception:
            return SW_ERR_NET if not self.demo else SW_ERR_IO
        try:
            c.lessons = parse_lessons_html(html, c.course.crs_cre_cd)
        except Exception:
            return SW_ERR_PARSE
        c.fetched_les = True
        return SW_OK

    def fetch_assignments(self, all_courses: bool = True) -> int:
        """전 과목(또는 첫 과목) 과제를 모은다. 조회마다 다시 받는다.

        Args:
            all_courses: False 면 첫 과목만.

        Returns:
            한 과목이라도 성공하면 ``SW_OK``.
        """
        if not self.courses and self.fetch_courses() != SW_OK:
            return SW_ERR
        for c in self.courses:
            c.fetched_asg = False
        ok = 0
        n = len(self.courses)
        for i, c in enumerate(self.courses):
            if not self.quiet:
                load_spin_step(i, n, "과제 조회 ")
            if self._fetch_one_assignments(c) == SW_OK:
                ok += 1
            if not all_courses:
                break
        if not self.quiet:
            load_spin_step(n, n, "과제 조회 ")
            load_spin_done()
        return SW_OK if ok else SW_ERR

    def fetch_lessons(self, all_courses: bool = True) -> int:
        """전 과목(또는 첫 과목) 이러닝을 모은다. 조회마다 다시 받는다.

        Args:
            all_courses: False 면 첫 과목만.

        Returns:
            한 과목이라도 성공하면 ``SW_OK``.
        """
        if not self.courses and self.fetch_courses() != SW_OK:
            return SW_ERR
        for c in self.courses:
            c.fetched_les = False
        ok = 0
        n = len(self.courses)
        for i, c in enumerate(self.courses):
            if not self.quiet:
                load_spin_step(i, n, "이러닝 조회 ")
            if self._fetch_one_lessons(c) == SW_OK:
                ok += 1
            if not all_courses:
                break
        if not self.quiet:
            load_spin_step(n, n, "이러닝 조회 ")
            load_spin_done()
        return SW_OK if ok else SW_ERR

    def fetch_assignment_detail_parts(self, ci: int, ai: int) -> tuple[str, list[Attachment]]:
        """과제 본문과 첨부 목록.

        Args:
            ci: 과목 인덱스.
            ai: 과제 인덱스.

        Returns:
            ``(본문, 첨부 목록)``.
        """
        html = self._assignment_html(ci, ai)
        return parse_assignment_detail(html), parse_file_down_links(html)

    def fetch_assignment_detail(self, ci: int, ai: int) -> str:
        """고른 과제 본문. 첨부가 있으면 아래에 이름을 붙인다.

        Args:
            ci: 과목 인덱스.
            ai: 과제 인덱스.

        Returns:
            본문 문자열.
        """
        text, atts = self.fetch_assignment_detail_parts(ci, ai)
        if atts:
            lines = "\n".join(f"· {a.title}" for a in atts)
            text = f"{text}\n\n첨부\n{lines}"
        return text

    def _fetch_one_board(self, c: CourseData, section: str) -> int:
        """한 과목의 공지 또는 강의자료실.

        Args:
            c: 대상 과목.
            section: ``notices`` 또는 ``materials``.

        Returns:
            ``SW_OK`` 또는 오류 코드.
        """
        materials = section == "materials"
        bbs_cd = "PDS" if materials else "NOTICE"
        suffix = "P" if materials else "N"
        demo_file = "materials.html" if materials else "notices.html"
        try:
            if self.demo:
                if c.course.title != "논리회로":
                    if materials:
                        c.fetched_mat = True
                    else:
                        c.fetched_notice = True
                    return SW_OK
                html = self._demo_read(demo_file)
            else:
                html = self._post_form(
                    ATCL_LIST,
                    [
                        ("formType", "LIST"),
                        ("bbsId", f"BBS_{c.course.crs_cre_cd}_{suffix}"),
                        ("atclId", ""),
                        ("searchKey", "all"),
                        ("searchValue", ""),
                        ("listScale", LIST_SCALE),
                        ("pageIndex", "1"),
                        ("headCd", ""),
                        ("bbsCd", bbs_cd),
                        ("crsCreCd", c.course.crs_cre_cd),
                    ],
                )
        except Exception:
            return SW_ERR_NET if not self.demo else SW_ERR_IO
        try:
            items = parse_bbs_list_html(html, c.course.crs_cre_cd, section)
        except Exception:
            return SW_ERR_PARSE
        if materials:
            c.materials = items
            c.fetched_mat = True
        else:
            c.notices = items
            c.fetched_notice = True
        return SW_OK

    def fetch_notices(self, all_courses: bool = True) -> int:
        """전 과목 강의실 공지.

        Args:
            all_courses: False 면 첫 과목만.

        Returns:
            한 과목이라도 성공하면 ``SW_OK``.
        """
        if not self.courses and self.fetch_courses() != SW_OK:
            return SW_ERR
        ok = 0
        n = len(self.courses)
        for i, c in enumerate(self.courses):
            if not self.quiet:
                load_spin_step(i, n, "공지 조회 ")
            if self._fetch_one_board(c, "notices") == SW_OK:
                ok += 1
            if not all_courses:
                break
        if not self.quiet:
            load_spin_step(n, n, "공지 조회 ")
            load_spin_done()
        return SW_OK if ok else SW_ERR

    def fetch_materials(self, all_courses: bool = True) -> int:
        """전 과목 강의자료실.

        Args:
            all_courses: False 면 첫 과목만.

        Returns:
            한 과목이라도 성공하면 ``SW_OK``.
        """
        if not self.courses and self.fetch_courses() != SW_OK:
            return SW_ERR
        ok = 0
        n = len(self.courses)
        for i, c in enumerate(self.courses):
            if not self.quiet:
                load_spin_step(i, n, "자료 조회 ")
            if self._fetch_one_board(c, "materials") == SW_OK:
                ok += 1
            if not all_courses:
                break
        if not self.quiet:
            load_spin_step(n, n, "자료 조회 ")
            load_spin_done()
        return SW_OK if ok else SW_ERR

    def _board_post(self, ci: int, pi: int, section: str) -> BoardPost:
        """공지/자료 한 건.

        Args:
            ci: 과목 인덱스.
            pi: 글 인덱스.
            section: ``notices`` 또는 ``materials``.

        Returns:
            ``BoardPost``.

        Raises:
            IndexError: 범위 밖.
        """
        if ci >= len(self.courses):
            raise IndexError("course")
        items = self.courses[ci].materials if section == "materials" else self.courses[ci].notices
        if pi >= len(items):
            raise IndexError("post")
        return items[pi]

    def fetch_board_detail(self, ci: int, pi: int, section: str) -> str:
        """공지·자료 본문과 첨부 이름을 붙인다.

        Args:
            ci: 과목 인덱스.
            pi: 글 인덱스.
            section: ``notices`` 또는 ``materials``.

        Returns:
            본문. 첨부가 있으면 아래에 이름을 붙인다.
        """
        post = self._board_post(ci, pi, section)
        demo_file = "material_detail.html" if section == "materials" else "notice_detail.html"
        if self.demo:
            html = self._demo_read(demo_file)
        else:
            fields = [
                ("formType", "VIEW"),
                ("bbsId", post.bbs_id),
                ("atclId", post.id),
                ("bbsCd", post.bbs_cd),
                ("crsCreCd", post.crs_cre_cd or self.courses[ci].course.crs_cre_cd),
            ]
            html = self._post_form(VIEW_ATCL, fields)
        try:
            text = parse_notice_detail(html)
        except ValueError:
            text = ""
        atts = parse_file_down_links(html)
        post.text = text
        post.attachments = atts
        if atts:
            lines = "\n".join(f"· {a.title}" for a in atts)
            return f"{text}\n\n첨부\n{lines}".strip()
        return text or "(본문이 없습니다)"

    def download_attachment(self, url: str, dest: Path) -> Path:
        """e-campus 첨부를 ``dest`` 에 저장한다.

        Args:
            url: ``/file/download/`` 주소.
            dest: 저장 경로.

        Returns:
            실제로 쓴 경로.

        Raises:
            ValueError: 호스트가 아니거나 로그인 화면이 온 경우.
        """
        if self.demo:
            sample = Path(self.testdata_dir) / "sample_attachment.txt"
            dest.write_bytes(sample.read_bytes() if sample.is_file() else b"demo attachment\n")
            return dest
        if not looks_like_campus_file_url(url):
            raise ValueError("e-campus 첨부 주소만 받을 수 있습니다.")
        path = url
        if url.startswith("http"):
            from urllib.parse import urlparse

            parsed = urlparse(url)
            path = parsed.path
        data, status, extra = self.http.get_bytes(path, referer=BASE_URL)
        if status >= 400 or not data:
            raise ValueError("파일을 받지 못했습니다.")
        head = data[:200].lstrip().lower()
        if head.startswith(b"<!doctype html") or head.startswith(b"<html"):
            raise ValueError("로그인 화면이 돌아왔습니다. 다시 로그인하세요.")
        dest.write_bytes(data)
        return dest

    def _sugang_password(self) -> str:
        """메모리 또는 ``login.json`` 의 비밀번호. 파일에는 다시 쓰지 않는다.

        Returns:
            비밀번호. 없으면 빈 문자열.
        """
        if self._sugang_pw:
            return self._sugang_pw
        try:
            lf = login_file_load(self.root / LOGIN_FILE)
            pw = lf.password
            login_file_wipe(lf)
            return pw
        except Exception:
            return ""

    def fetch_timetable(self) -> int:
        """이번 학기 확정 수강 시간표.

        Returns:
            ``SW_OK`` 또는 인증/네트워크 오류 코드.
        """
        if self.demo:
            raw = self._demo_read("timetable.json")
            import json as _json

            root = _json.loads(raw)
            from lib.seowon import TimetableSubject

            subjects: list[TimetableSubject] = []
            for it in root.get("subjects") or []:
                subjects.append(
                    TimetableSubject(
                        subjt_cd=str(it.get("subjtCd") or ""),
                        subjt_nm=str(it.get("subjtNm") or ""),
                        corse_dvcls_no=str(it.get("corseDvclsNo") or ""),
                        cmpsj_cdt=str(it.get("cmpsjCdt") or ""),
                        chrg_instr=str(it.get("chrgInstrEmpnm") or ""),
                        timtb_nm=str(it.get("timtbNm") or ""),
                        kind=str(it.get("kind") or ""),
                    )
                )
            self.timetable = build_timetable(subjects)
            who = self.sess.student_name or "학생"
            self.timetable["title"] = f"{who} 수강 시간표"
            self.timetable["svg"] = render_timetable_svg(self.timetable, self.timetable["title"])
            return SW_OK
        pw = self._sugang_password()
        if not pw:
            self.last_error = "시간표는 학번·비밀번호로 다시 로그인해야 합니다."
            return SW_ERR_AUTH
        try:
            subjects = fetch_registered_subjects(self.sess.student_id, pw, self.sess)
        except Exception:
            self.last_error = "시간표를 가져오지 못했습니다."
            return SW_ERR_NET
        self.timetable = build_timetable(subjects)
        who = self.sess.student_name or "학생"
        self.timetable["title"] = f"{who} 수강 시간표"
        self.timetable["svg"] = render_timetable_svg(self.timetable, self.timetable["title"])
        return SW_OK

    def _assignment_html(self, ci: int, ai: int) -> str:
        """과제 상세 HTML.

        Args:
            ci: 과목 인덱스.
            ai: 과제 인덱스.

        Returns:
            상세 HTML.

        Raises:
            IndexError: 범위 밖.
        """
        if ci >= len(self.courses) or ai >= len(self.courses[ci].assignments):
            raise IndexError("assignment")
        a = self.courses[ci].assignments[ai]
        if self.demo:
            return self._demo_read("assignment_detail.html")
        fields = [
            ("asmntCd", a.id),
            ("crsCreCd", a.crs_cre_cd or self.courses[ci].course.crs_cre_cd),
        ]
        html = self._post_form(ASSIGN_VIEW, fields)
        if len(html) < 80:
            html = self._post_form(ASSIGN_VIEW_AJAX, fields)
        return html

    def submit_assignment(self, ci: int, ai: int, text: str, file_path: str | None) -> str:
        """과제 본문·파일을 e-campus 에 제출한다. 데모는 상태만 바꾼다.

        Parameters
        ----------
        ci : int
            과목 인덱스.
        ai : int
            과제 인덱스.
        text : str
            제출 글.
        file_path : str or None
            첨부 파일 경로. 파일 제출 과제면 필수.

        Returns
        -------
        str
            성공 안내.

        Raises
        ------
        IndexError
            범위 밖.
        ValueError
            내용/파일 없음, 업로드 실패, 서버 거절.
        """
        if ci >= len(self.courses) or ai >= len(self.courses[ci].assignments):
            raise IndexError("assignment")
        a = self.courses[ci].assignments[ai]
        body = (text or "").strip()
        path = Path(file_path) if file_path else None
        if self.demo:
            if not body and not (path and path.is_file()):
                raise ValueError("제출할 내용이나 파일을 넣어 주세요.")
            a.status = "과제를 제출하였습니다"
            mark_assignment_flags(a)
            return "데모 모드에서 제출한 것으로 표시했습니다."
        if not a.id:
            raise ValueError("과제 코드가 없어 제출할 수 없습니다. 다시 조회하세요.")
        crs = a.crs_cre_cd or self.courses[ci].course.crs_cre_cd
        html = self._assignment_html(ci, ai)
        send_type = parse_assignment_send_type(html) or ("F" if path and path.is_file() else "T")
        title = parse_assignment_title(html) or a.title
        attach = ""
        if send_type == "F":
            if path is None or not path.is_file():
                raise ValueError("이 과제는 파일 제출입니다. 파일을 고르세요.")
            attach = self._upload_assignment_file(a.id, crs, path)
        elif not body:
            raise ValueError("이 과제는 글 제출입니다. 내용을 입력하세요.")
        raw, _ = self.http.post(
            ASSIGN_SEND,
            BASE_URL,
            _FORM,
            form_encode(
                [
                    ("asmntCd", a.id),
                    ("crsCreCd", crs),
                    ("attachFileSns", attach),
                    ("teamCd", ""),
                    ("sendCts", body),
                    ("sendCnt", "1"),
                    ("asmntSubmitStatusCd", "Submit"),
                    ("asmntTitle", title),
                ]
            ),
            ajax=True,
        )
        if not parse_submit_ok(raw):
            raise ValueError("과제 제출에 실패했습니다. e-campus 에서 확인해 주세요.")
        a.status = "과제를 제출하였습니다"
        mark_assignment_flags(a)
        return "과제를 제출했습니다."

    def _upload_assignment_file(self, asmnt_cd: str, crs: str, path: Path) -> str:
        """제출 화면을 연 뒤 파일을 올려 ``fileSn`` 을 받는다.

        Args:
            asmnt_cd: 과제 코드.
            crs: 과목 코드.
            path: 로컬 파일.

        Returns:
            서버 파일 번호.

        Raises:
            ValueError: 50MB 초과 또는 업로드 실패.
        """
        try:
            self._post_form(
                ASSIGN_SEND_VIEW,
                [("asmntCd", asmnt_cd), ("crsCreCd", crs), ("teamCd", ""), ("sendType", "F")],
            )
        except Exception:
            pass
        try:
            self._post_form(
                ASSIGN_RIGHT,
                [
                    ("asmntCd", asmnt_cd),
                    ("crsCreCd", crs),
                    ("sendType", "F"),
                    ("asmntCtgrCd", "NORMAL"),
                    ("stdRole", ""),
                    ("teamCd", ""),
                ],
            )
        except Exception:
            pass
        data = path.read_bytes()
        if len(data) > 50 * 1024 * 1024:
            raise ValueError("파일이 50MB 를 넘습니다.")
        mime = "application/octet-stream"
        name = path.name
        low = name.lower()
        if low.endswith(".pdf"):
            mime = "application/pdf"
        elif low.endswith(".hwp"):
            mime = "application/x-hwp"
        elif low.endswith(".docx"):
            mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif low.endswith(".zip"):
            mime = "application/zip"
        last = "파일 업로드 주소를 찾지 못했습니다."
        for upload_path in (FILE_AJAX_UPLOAD, "/file/upload", "/comm/file/fileUpload"):
            try:
                raw, _ = self.http.post_multipart(
                    upload_path,
                    BASE_URL,
                    [],
                    [("file", name, data, mime), ("uploadFile", name, data, mime)],
                )
            except Exception as e:
                last = str(e) or last
                continue
            sn = extract_upload_file_sn(raw)
            if sn:
                return sn
            last = "파일 업로드 응답에서 파일 번호를 읽지 못했습니다."
        raise ValueError(last)

    def fetch_progress(self, ci: int, li: int) -> int:
        """고른 차시 학습률(%).

        Args:
            ci: 과목 인덱스.
            li: 차시 인덱스.

        Returns:
            퍼센트 정수.

        Raises:
            IndexError: 범위 밖.
        """
        if ci >= len(self.courses) or li >= len(self.courses[ci].lessons):
            raise IndexError("lesson")
        l = self.courses[ci].lessons[li]
        if self.demo:
            raw = self._demo_read("progress.json")
        else:
            crs = l.crs_cre_cd or self.courses[ci].course.crs_cre_cd
            stdno = f"{crs}_{self.sess.student_id}"
            raw = self._post_form(
                STUDY_DETAIL,
                [
                    ("lessonCntsId", l.lesson_cnts_id),
                    ("prgrRatioTypeCd", "STUDY_TOTAL_TM"),
                    ("stdNo", stdno),
                    ("crsCreCd", crs),
                    ("pageIndex", "1"),
                    ("listScale", "10"),
                ],
            )
        pct = parse_progress_json(raw)
        l.progress_percent = pct
        return pct

    def save_result(self) -> int:
        """``result.json`` 에 지금 조회 결과를 쓴다.

        Returns:
            ``SW_OK``.
        """
        _, rpath = config_paths(self.cfg)
        Path(self.cfg.data_dir).mkdir(parents=True, exist_ok=True)
        result_save(rpath, self.courses, course_semester(self.courses), self.timetable)
        return SW_OK

    def load_result(self) -> int:
        """``result.json`` 을 다시 읽는다.

        Returns:
            성공 ``SW_OK``, 실패 ``SW_ERR_IO``.
        """
        _, rpath = config_paths(self.cfg)
        try:
            self.courses, _sem = result_load(rpath)
        except Exception:
            return SW_ERR_IO
        return SW_OK

    def result_dict(self) -> dict[str, Any]:
        """GUI 가 그리는 courses/summary JSON.

        Returns:
            ``result_save`` 가 만든 dict. 파일에도 쓴다.
        """
        _, rpath = config_paths(self.cfg)
        return result_save(rpath, self.courses, course_semester(self.courses), self.timetable)
