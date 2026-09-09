"""상수 · 자료 구조 · 오류 코드."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

VERSION = "1.0.0"

# e-campus
BASE_URL = "https://ecampus.seowon.ac.kr"
HOST = "ecampus.seowon.ac.kr"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
)
LOGIN_PAGE = "/home/mainPop/popup/login"
LOGIN_API = "/user/userHome/login"
COURSE_LIST = "/crs/creCrsHome/classRoomCrsCreList"
ASSIGN_LIST = "/asmnt/asmntHome/stuAsmntGridList"
ASSIGN_VIEW = "/asmnt/asmntLect/Form/asmntStuMain"
LESSON_FORM = "/lesson/lessonLect/Form/lessonListForm"
LESSON_INFO = "/crs/creCrsLect/creInfo"
LESSON_LIST = "/lesson/lessonLect/lessonList"
STUDY_DETAIL = "/lesson/lessonLect/viewLessonStudyDetail"
LESSON_MCD = "MH_210504T143020d03000a"
PROGRESS_TYPE = "WEEK"
LIST_SCALE = "100"
LOGIN_FILE = "login.json"

# 수강신청 SSO (이름·학과). 수강신청은 하지 않는다.
SUGANG_URL = "https://sugangh.seowon.ac.kr"
SUGANG_HOME = "/nx/"
SUGANG_TERM = "/com/SsoCtr/findScomUnvfrSchdlInfo.do?menuId=edu&pgmId=edu"
SUGANG_LOGIN = "/com/SsoCtr/findAppcsLogin.do?menuId=edu&pgmId=edu"
SUGANG_STUNO = "/com/SsoCtr/findStunoInfo.do?menuId=edu&pgmId=edu"

SW_OK = 0
SW_ERR = -1
SW_ERR_AUTH = -2
SW_ERR_NET = -3
SW_ERR_PARSE = -4
SW_ERR_IO = -5
SW_ERR_OTP = -6
SW_ERR_SESSION = -7


class SwError(Exception):
    """조회·로그인·파일 오류."""

    def __init__(self, message: str, code: int = SW_ERR) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class Cookie:
    """e-campus 세션 쿠키. 비밀번호는 넣지 않는다."""

    name: str
    value: str
    domain: str = HOST
    path: str = "/"


@dataclass
class Config:
    """실행 폴더 config.json. 마지막 학번·저장 옵션·dataDir."""

    last_student_id: str = ""
    save_session: bool = True
    save_result: bool = True
    data_dir: str = "./db"
    base_url: str = BASE_URL
    config_path: str = "config.json"


@dataclass
class LoginFile:
    """login.json. 학번·비밀번호가 둘 다 있으면 입력을 건너뛴다."""

    student_id: str = ""
    password: str = ""
    path: str = LOGIN_FILE


@dataclass
class Session:
    """로그인 뒤 학번·이름·학과·쿠키. session.json 과 같다."""

    student_id: str = ""
    user_no: str = ""
    student_name: str = ""
    dept_name: str = ""
    dept_cd: str = ""
    saved_at: str = ""
    cookies: list[Cookie] = field(default_factory=list)


@dataclass
class Course:
    """수강 과목 한 줄."""

    title: str = ""
    crs_cre_cd: str = ""
    crs_type_cd: str = ""
    category: str = ""
    label: str = ""


@dataclass
class Assignment:
    """과제 한 건. due_now 는 기간 안 + 미제출."""

    id: str = ""
    title: str = ""
    period: str = ""
    status: str = ""
    crs_cre_cd: str = ""
    due_now: bool = False


@dataclass
class Lesson:
    """이러닝 차시 한 건. needs_watch 는 기간 안 + 미학습."""

    week: str = ""
    title: str = ""
    period: str = ""
    attendance: str = ""
    lesson_cnts_id: str = ""
    lesson_schedule_id: str = ""
    crs_cre_cd: str = ""
    needs_watch: bool = False
    progress_percent: int = -1


@dataclass
class CourseData:
    """과목 + 그 과목의 과제·이러닝."""

    course: Course = field(default_factory=Course)
    assignments: list[Assignment] = field(default_factory=list)
    lessons: list[Lesson] = field(default_factory=list)
    fetched_asg: bool = False
    fetched_les: bool = False


@dataclass
class LoginResult:
    """로그인 JSON 파싱 결과. type: 0=실패, 1=성공, 2=OTP."""

    type: int = 0
    message: str = ""
    user_id: str = ""
    user_no: str = ""
    redirect: str = ""


def find_testdata(root: Path | str | None = None) -> Path:
    """데모·단위 테스트용 HTML/JSON 폴더."""
    cands: list[Path] = []
    if root:
        cands.append(Path(root) / "db" / "testdata")
    cands.append(Path("db") / "testdata")
    cands.append(Path("testdata"))
    for p in cands:
        if p.is_dir():
            return p
    return Path("testdata")
