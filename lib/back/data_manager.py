"""로그인 · 조회 · 결과 저장."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from lib.seowon import (
    ASSIGN_LIST,
    ASSIGN_VIEW,
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
    parse_assignment_detail,
    parse_assignments_html,
    parse_courses_html,
    parse_lessons_html,
    parse_login_json,
    parse_progress_json,
)
from lib.back.sugang import fetch_profile, load_demo_profile, session_label
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
        """작업 폴더와 데모/조용 모드. HTTP 는 boot 에서 다시 연다."""
        self.root = Path(root)
        self.demo: bool = demo
        self.quiet: bool = quiet
        self.cfg: Config = config_default()
        self.sess: Session = Session()
        self.http: HttpClient = HttpClient()
        self.courses: list[CourseData] = []
        self.logged_in: bool = False
        self.testdata_dir = find_testdata(self.root)
        self.last_error: str = ""
        try:
            self.http.init(self.cfg.base_url)
        except Exception:
            pass

    def _say_ok(self, msg: str) -> None:
        """quiet 가 아니면 성공 줄을 찍는다."""
        if not self.quiet:
            ui_ok(msg)

    def _say_err(self, msg: str) -> None:
        """last_error 를 남기고, quiet 가 아니면 오류를 찍는다."""
        self.last_error = msg
        if not self.quiet:
            ui_err(msg)

    def _say_info(self, msg: str) -> None:
        """quiet 가 아니면 안내를 찍는다."""
        if not self.quiet:
            ui_info(msg)

    def _say_warn(self, msg: str) -> None:
        """quiet 가 아니면 경고를 찍는다."""
        if not self.quiet:
            ui_warn(msg)

    def _spin(self, speed: int, text: str) -> None:
        """quiet 가 아니면 로딩 막대를 돌린다."""
        if not self.quiet:
            load_spin(speed, text)

    def _demo_read(self, name: str) -> str:
        """db/testdata 의 고정 응답 파일."""
        return read_file(Path(self.testdata_dir) / name)

    def _post_form(self, path: str, fields: list[tuple[str, str]], referer: str | None = None) -> str:
        """e-campus 폼 POST. 본문은 UTF-8 urlencoded."""
        html, _ = self.http.post(path, referer or BASE_URL, _FORM, form_encode(fields), ajax=True)
        return html

    def boot(self) -> int:
        """config · login.json · 저장 세션을 읽는다. 만료면 다시 로그인한다."""
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
        """쿠키로 과목 목록을 열어 세션이 살아 있는지 본다."""
        if self.demo:
            self.logged_in = True
            return SW_OK
        if self.fetch_courses() == SW_OK and self.courses:
            self.logged_in = True
            return SW_OK
        self.logged_in = False
        return SW_ERR_SESSION

    def ensure_auth(self) -> int:
        """로그인되어 있지 않으면 세션 재사용 또는 입력을 받는다."""
        if self.logged_in:
            return SW_OK
        if self.demo:
            self.logged_in = True
            return SW_OK
        if self.http.cookie_usable() and self.try_session() == SW_OK:
            return SW_OK
        return self.login_interactive()

    def login_interactive(self) -> int:
        """login.json 이 완전하면 그걸로, 아니면 학번·비밀번호를 묻는다."""
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
        """NICE encryptData 로 로그인하고 sugangh 에서 이름·학과를 채운다."""
        if self.demo:
            self.sess.student_id = sid or self.cfg.last_student_id or "20241234"
            self.sess.user_no = self.sess.student_id
            load_demo_profile(self.testdata_dir, self.sess)
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
        """수강 과목 목록. 데모는 testdata/courses.html."""
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
        """한 과목의 과제 목록."""
        if c.fetched_asg:
            return SW_OK
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
        """한 과목의 이러닝 차시."""
        if c.fetched_les:
            return SW_OK
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
        """전 과목(또는 첫 과목) 과제를 모은다."""
        if not self.courses and self.fetch_courses() != SW_OK:
            return SW_ERR
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
        """전 과목(또는 첫 과목) 이러닝을 모은다."""
        if not self.courses and self.fetch_courses() != SW_OK:
            return SW_ERR
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

    def fetch_assignment_detail(self, ci: int, ai: int) -> str:
        """고른 과제 본문. 제출은 하지 않는다."""
        if ci >= len(self.courses) or ai >= len(self.courses[ci].assignments):
            raise IndexError("assignment")
        a = self.courses[ci].assignments[ai]
        if self.demo:
            html = self._demo_read("assignment_detail.html")
        else:
            html = self._post_form(
                ASSIGN_VIEW,
                [
                    ("asmntCd", a.id),
                    ("crsCreCd", a.crs_cre_cd or self.courses[ci].course.crs_cre_cd),
                ],
            )
        return parse_assignment_detail(html)

    def fetch_progress(self, ci: int, li: int) -> int:
        """고른 차시 학습률(%). 시청 기록은 보내지 않는다."""
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
        """result.json 에 지금 조회 결과를 쓴다."""
        _, rpath = config_paths(self.cfg)
        Path(self.cfg.data_dir).mkdir(parents=True, exist_ok=True)
        result_save(rpath, self.courses, course_semester(self.courses))
        return SW_OK

    def load_result(self) -> int:
        """result.json 을 다시 읽는다."""
        _, rpath = config_paths(self.cfg)
        try:
            self.courses, _sem = result_load(rpath)
        except Exception:
            return SW_ERR_IO
        return SW_OK

    def result_dict(self) -> dict[str, Any]:
        """GUI 가 그리는 courses/summary JSON."""
        _, rpath = config_paths(self.cfg)
        return result_save(rpath, self.courses, course_semester(self.courses))
