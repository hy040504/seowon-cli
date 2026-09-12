"""상수 · 자료 구조 · 오류 코드.

이 모듈은 e-campus URL, 수강신청 SSO 경로, 오류 코드, 조회 결과 dataclass 를
한곳에 둔다. 화면·HTTP 계층이 같은 타입을 쓰도록 하는 공유 계약이다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

VERSION = "1.1.0"

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
ASSIGN_VIEW_AJAX = "/asmnt/asmntLect/asmntStuMain"
ASSIGN_RIGHT = "/asmnt/asmntHome/asmntRightView"
ASSIGN_SEND_VIEW = "/asmnt/asmntHome/asmntSendView"
ASSIGN_SEND = "/asmnt/asmntHome/sendAsmnt"
FILE_AJAX_UPLOAD = "/file/ajaxupload/"
ATCL_LIST = "/bbs/bbsLect/atclList"
VIEW_ATCL = "/bbs/bbsLect/viewAtcl"
VIEW_ATCL_FORM = "/bbs/bbsLect/Form/viewAtclForm"
FILE_DOWNLOAD = "/file/download/"
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
# 확정 수강 목록. 신청·취소는 하지 않는다. (seowon-client-web findAppcsDtlsList)
SUGANG_MY_LIST = "/com/sapl/SaplapCtr/findAppcsDtlsList.do?menuId=M100780&pgmId=P001619"

SW_OK = 0
SW_ERR = -1
SW_ERR_AUTH = -2
SW_ERR_NET = -3
SW_ERR_PARSE = -4
SW_ERR_IO = -5
SW_ERR_OTP = -6
SW_ERR_SESSION = -7


class SwError(Exception):
    """조회·로그인·파일 오류.

    Attributes:
        code: ``SW_ERR_*`` 정수. 기본값은 ``SW_ERR``.
    """

    def __init__(self, message: str, code: int = SW_ERR) -> None:
        """메시지와 오류 코드를 붙인다.

        Args:
            message: 사용자에게 보여줄 설명.
            code: ``SW_ERR_*`` 상수. 기본 ``SW_ERR``.
        """
        super().__init__(message)
        self.code = code


@dataclass
class Cookie:
    """e-campus 세션 쿠키. 비밀번호는 넣지 않는다.

    Attributes:
        name: 쿠키 이름.
        value: 쿠키 값.
        domain: 호스트. 기본은 e-campus.
        path: 경로. 기본 ``/``.
    """

    name: str
    value: str
    domain: str = HOST
    path: str = "/"


@dataclass
class Config:
    """실행 폴더 ``config.json``. 마지막 학번·저장 옵션·dataDir.

    Attributes:
        last_student_id: 마지막으로 쓴 학번.
        save_session: ``session.json`` 저장 여부.
        save_result: ``result.json`` 저장 여부.
        data_dir: JSON 저장 폴더.
        base_url: e-campus origin.
        config_path: 이 설정을 읽은 파일 경로.
    """

    last_student_id: str = ""
    save_session: bool = True
    save_result: bool = True
    data_dir: str = "./db"
    base_url: str = BASE_URL
    config_path: str = "config.json"


@dataclass
class LoginFile:
    """``login.json``. 학번·비밀번호가 둘 다 있으면 입력을 건너뛴다.

    Attributes:
        student_id: 학번.
        password: 비밀번호. 세션 파일에는 넣지 않는다.
        path: 파일 경로.
    """

    student_id: str = ""
    password: str = ""
    path: str = LOGIN_FILE


@dataclass
class Session:
    """로그인 뒤 학번·이름·학과·쿠키. ``session.json`` 과 같다.

    Attributes:
        student_id: 학번.
        user_no: e-campus 사용자 번호. 없으면 학번.
        student_name: 이름.
        college_name: 대학.
        dept_name: 학과.
        dept_cd: 학과 코드.
        saved_at: 저장 시각 ISO 문자열.
        cookies: 세션 쿠키. 비밀번호는 없다.
    """

    student_id: str = ""
    user_no: str = ""
    student_name: str = ""
    college_name: str = ""
    dept_name: str = ""
    dept_cd: str = ""
    saved_at: str = ""
    cookies: list[Cookie] = field(default_factory=list)


@dataclass
class Course:
    """수강 과목 한 줄.

    Attributes:
        title: 과목명.
        crs_cre_cd: 강의실 개설 코드.
        crs_type_cd: 교과/비교과 구분 코드.
        category: ``curricular`` 또는 ``extracurricular``.
        label: 목록에 붙은 라벨 텍스트.
    """

    title: str = ""
    crs_cre_cd: str = ""
    crs_type_cd: str = ""
    category: str = ""
    label: str = ""


@dataclass
class Assignment:
    """과제 한 건. ``due_now`` 는 기간 안 + 미제출.

    Attributes:
        id: 과제 코드 ``asmntCd``.
        title: 제목.
        period: 제출 기간 원문.
        status: 제출 상태 문구.
        crs_cre_cd: 소속 과목 코드.
        due_now: 지금 할 수 있는 과제인지.
    """

    id: str = ""
    title: str = ""
    period: str = ""
    status: str = ""
    crs_cre_cd: str = ""
    due_now: bool = False


@dataclass
class Lesson:
    """이러닝 차시 한 건. ``needs_watch`` 는 기간 안 + 미학습.

    Attributes:
        week: 주차 표시.
        title: 차시 제목.
        period: 학습 기간 원문.
        attendance: 출결 상태 문구.
        lesson_cnts_id: 콘텐츠 ID.
        lesson_schedule_id: 일정 ID.
        crs_cre_cd: 소속 과목 코드.
        needs_watch: 기간 안 미학습이면 True.
        progress_percent: 학습률. 미조회는 -1.
    """

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
class Attachment:
    """공지·자료·과제 첨부. ``url`` 은 e-campus ``/file/download/`` 만 쓴다.

    Attributes:
        title: 파일 이름.
        url: 다운로드 경로 또는 절대 URL.
        token: ``fileDown`` 토큰. 없으면 빈 문자열.
    """

    title: str = ""
    url: str = ""
    token: str = ""


@dataclass
class BoardPost:
    """강의실 공지 또는 강의자료실 글.

    Attributes:
        id: 글 ID ``atclId``.
        title: 제목.
        date: 작성일 원문.
        has_attachment: 목록에서 첨부 표시가 있었는지.
        crs_cre_cd: 소속 과목 코드.
        bbs_id: 게시판 ID.
        bbs_cd: ``NOTICE`` 또는 ``PDS``.
        text: 상세 본문. 목록만 읽으면 빈 문자열.
        attachments: 상세에서 읽은 첨부.
    """

    id: str = ""
    title: str = ""
    date: str = ""
    has_attachment: bool = False
    crs_cre_cd: str = ""
    bbs_id: str = ""
    bbs_cd: str = ""
    text: str = ""
    attachments: list[Attachment] = field(default_factory=list)


@dataclass
class TimetableSubject:
    """수강 확정 과목 한 줄. ``timtbNm`` 원문을 슬롯으로 푼다.

    Attributes:
        subjt_cd: 과목 코드.
        subjt_nm: 과목명.
        corse_dvcls_no: 분반.
        cmpsj_cdt: 학점.
        chrg_instr: 담당 교수.
        timtb_nm: 요일·교시·강의실 원문.
        kind: 전공/교양 등 이수 구분.
    """

    subjt_cd: str = ""
    subjt_nm: str = ""
    corse_dvcls_no: str = ""
    cmpsj_cdt: str = ""
    chrg_instr: str = ""
    timtb_nm: str = ""
    kind: str = ""


@dataclass
class TimetableSlot:
    """요일·교시 한 칸.

    Attributes:
        day: 요일 한글 한 글자.
        period: 교시 번호. 1부터.
        place: 강의실.
        subjt_cd: 과목 코드.
        subjt_nm: 과목명.
        corse_dvcls_no: 분반.
        chrg_instr: 담당 교수.
        cmpsj_cdt: 학점.
    """

    day: str = ""
    period: int = 0
    place: str = ""
    subjt_cd: str = ""
    subjt_nm: str = ""
    corse_dvcls_no: str = ""
    chrg_instr: str = ""
    cmpsj_cdt: str = ""


@dataclass
class CourseData:
    """과목 + 그 과목의 과제·이러닝·공지·자료.

    Attributes:
        course: 과목 한 줄.
        assignments: 과제 목록.
        lessons: 이러닝 차시.
        notices: 공지.
        materials: 강의자료.
        fetched_asg: 과제를 이미 조회했는지.
        fetched_les: 이러닝을 이미 조회했는지.
        fetched_notice: 공지를 이미 조회했는지.
        fetched_mat: 자료를 이미 조회했는지.
    """

    course: Course = field(default_factory=Course)
    assignments: list[Assignment] = field(default_factory=list)
    lessons: list[Lesson] = field(default_factory=list)
    notices: list[BoardPost] = field(default_factory=list)
    materials: list[BoardPost] = field(default_factory=list)
    fetched_asg: bool = False
    fetched_les: bool = False
    fetched_notice: bool = False
    fetched_mat: bool = False


@dataclass
class LoginResult:
    """로그인 JSON 파싱 결과. ``type``: 0=실패, 1=성공, 2=OTP.

    Attributes:
        type: 결과 종류.
        message: 서버 또는 파서가 만든 안내.
        user_id: 로그인 ID.
        user_no: 사용자 번호.
        redirect: 성공 시 이동 URL.
    """

    type: int = 0
    message: str = ""
    user_id: str = ""
    user_no: str = ""
    redirect: str = ""


def find_testdata(root: Path | str | None = None) -> Path:
    """데모·단위 테스트용 HTML/JSON 폴더.

    Args:
        root: 프로젝트 루트. 없으면 현재 작업 폴더를 본다.

    Returns:
        존재하는 testdata 경로. 없으면 ``testdata``.
    """
    cands: list[Path] = []
    if root:
        cands.append(Path(root) / "db" / "testdata")
    cands.append(Path("db") / "testdata")
    cands.append(Path("testdata"))
    for p in cands:
        if p.is_dir():
            return p
    return Path("testdata")
