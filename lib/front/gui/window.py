"""스마트홈 태블릿 톤 PyQt 메인 창. 조회는 백그라운드에서 돌린다."""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from PyQt6.QtCore import QEvent, QObject, QSettings, Qt, QTimer, QUrl
from PyQt6.QtGui import QCloseEvent, QColor, QDesktopServices, QShowEvent
from PyQt6.QtWidgets import (
    QFileDialog,
    QFrame,
    QGraphicsDropShadowEffect,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QTextEdit,
    QVBoxLayout,
    QWidget,
    QComboBox,
)

from backend import Backend, ensure_login_file, load_login_file, login_file_complete
from style import CURRENT, DARK, LIGHT, Theme, qss, set_current
from widgets import (
    DashTile,
    EmptyState,
    FadeStack,
    FeatureCard,
    InquiryGauge,
    JobList,
    JobRow,
    LineIcon,
    LoadingOverlay,
    Sidebar,
    StatBox,
    SuccessMark,
    TimetableBoard,
    ToastBanner,
    TossCheck,
    TossSwitch,
    FnThread,
)

from lib.seowon import VERSION

BUSY_MIN_MS = 520

PAGE_HOME = 0
PAGE_TODO = 1
PAGE_ASG = 2
PAGE_NOTICE = 3
PAGE_MAT = 4
PAGE_LES = 5
PAGE_TT = 6
PAGE_SUM = 7
PAGE_CFG = 8
PAGE_INFO = 9

NAV: list[tuple[str, str]] = [
    ("login", "로그인"),
    ("todo", "지금 할 것"),
    ("assignment", "과제"),
    ("notice", "공지"),
    ("material", "자료"),
    ("lesson", "이러닝"),
    ("timetable", "시간표"),
    ("status", "현황"),
    ("settings", "설정"),
    ("info", "정보"),
]


def _badge_kind_status(status: str) -> str:
    """과제 제출 상태를 알약 색으로 바꾼다.

    Args:
        status: 제출 상태 문구.

    Returns:
        ``miss`` / ``watch`` / ``done`` / ``info``.
    """
    if "미제출" in status:
        return "miss"
    if "진행" in status:
        return "watch"
    if "제출" in status or "완료" in status:
        return "done"
    return "info"


def _badge_kind_att(att: str) -> str:
    """이러닝 출결 문구를 알약 색으로 바꾼다.

    Args:
        att: 출결 상태 문구.

    Returns:
        ``miss`` / ``watch`` / ``done`` / ``info``.
    """
    if "결석" in att or "미학습" in att:
        return "miss"
    if "진행" in att:
        return "watch"
    if "출석" in att or "완료" in att or "학습" in att:
        return "done"
    return "info"


class MainWindow(QMainWindow):
    """왼쪽 내비 + 오른쪽 페이지. 조회는 백그라운드 스레드에서 돌린다."""

    def __init__(self) -> None:
        """사이드바·페이지·테마를 만들고 login.json 을 채운다."""
        super().__init__()
        self.backend = Backend()
        self._th: FnThread | None = None
        self._cards: list[QFrame] = []
        self.setWindowTitle("서원대 몰아보기")
        self.resize(1240, 800)
        ensure_login_file()

        root = QWidget()
        self.setCentralWidget(root)
        split = QHBoxLayout(root)
        split.setContentsMargins(0, 0, 0, 0)
        split.setSpacing(0)

        self.sidebar = Sidebar(NAV)
        self.sidebar.nav_clicked.connect(self._goto)
        self.sidebar.logout_clicked.connect(self.on_logout)
        split.addWidget(self.sidebar)

        right = QWidget()
        right_l = QVBoxLayout(right)
        right_l.setContentsMargins(0, 0, 0, 0)
        right_l.setSpacing(0)
        toast_wrap = QHBoxLayout()
        toast_wrap.setContentsMargins(28, 12, 28, 0)
        self.toast = ToastBanner()
        toast_wrap.addWidget(self.toast, 1)
        right_l.addLayout(toast_wrap)

        self.stack = FadeStack()
        self.stack.setObjectName("canvas")
        self.page_login = self._build_auth()
        self.page_todo = self._build_todo()
        self.page_asg = self._build_assignments()
        self.page_notice = self._build_notices()
        self.page_mat = self._build_materials()
        self.page_les = self._build_lessons()
        self.page_tt = self._build_timetable()
        self.page_sum = self._build_summary()
        self.page_cfg = self._build_settings()
        self.page_info = self._build_info()
        for p in (
            self.page_login,
            self.page_todo,
            self.page_asg,
            self.page_notice,
            self.page_mat,
            self.page_les,
            self.page_tt,
            self.page_sum,
            self.page_cfg,
            self.page_info,
        ):
            self.stack.addWidget(p)
        right_l.addWidget(self.stack, 1)
        split.addWidget(right, 1)

        self.overlay = LoadingOverlay(root)
        root.installEventFilter(self)
        self._fill_login_from_file()
        self._apply_profile_chip()
        settings = QSettings("seowon-cli", "e-campus")
        dark = bool(settings.value("darkMode", False, type=bool))
        self.theme_switch.blockSignals(True)
        self.theme_switch.setChecked(dark)
        self.theme_switch.blockSignals(False)
        self.apply_theme(DARK if dark else LIGHT)

    def eventFilter(self, obj: QObject, event: QEvent) -> bool:
        """창 크기가 바뀌면 로딩 막을 다시 맞춘다."""
        if obj is self.centralWidget() and event.type() == QEvent.Type.Resize:
            self.overlay.setGeometry(self.centralWidget().rect())
        return super().eventFilter(obj, event)

    def showEvent(self, event: QShowEvent | None) -> None:  # noqa: N802
        """처음 보일 때 로딩 막 크기를 맞춘다."""
        super().showEvent(event)
        if self.centralWidget() is not None:
            self.overlay.setGeometry(self.centralWidget().rect())

    def closeEvent(self, event: QCloseEvent | None) -> None:  # noqa: N802
        """돌아가는 조회가 있으면 잠시 기다린다."""
        if self._th is not None and self._th.isRunning():
            self._th.wait(4000)
        super().closeEvent(event)

    def _card(self) -> QFrame:
        """흰(또는 다크) 둥근 카드."""
        frame = QFrame()
        frame.setObjectName("card")
        frame.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        shadow = QGraphicsDropShadowEffect(frame)
        shadow.setBlurRadius(28)
        shadow.setOffset(0, 6)
        shadow.setColor(QColor(0, 0, 0, CURRENT.shadow_a))
        frame.setGraphicsEffect(shadow)
        self._cards.append(frame)
        return frame

    def _scroll_page(self, inner: QWidget) -> QWidget:
        """긴 페이지는 스크롤한다."""
        wrap = QWidget()
        wrap.setObjectName("canvas")
        lay = QVBoxLayout(wrap)
        lay.setContentsMargins(0, 0, 0, 0)
        sc = QScrollArea()
        sc.setWidgetResizable(True)
        sc.setFrameShape(QFrame.Shape.NoFrame)
        sc.setWidget(inner)
        lay.addWidget(sc)
        return wrap

    def apply_theme(self, theme: Theme) -> None:
        """라이트/다크를 창 전체에 입히고 설정을 기억한다."""
        set_current(theme)
        self.setStyleSheet(qss(theme))
        self.overlay.apply_theme(theme)
        self.sidebar.apply_theme()
        for card in self._cards:
            effect = card.graphicsEffect()
            if isinstance(effect, QGraphicsDropShadowEffect):
                effect.setColor(QColor(0, 0, 0, theme.shadow_a))
        for lst in (self.todo_list, self.asg_list, self.notice_list, self.mat_list, self.les_list):
            lst.apply_shadow()
        self.theme_caption.setText(
            "남색 바탕의 태블릿 화면입니다." if theme is DARK else "연한 라벤더 태블릿 화면입니다."
        )
        QSettings("seowon-cli", "e-campus").setValue("darkMode", theme is DARK)
        self.update()

    def _on_theme_toggled(self, dark: bool) -> None:
        """설정 스위치를 켤 때 다크, 끌 때 라이트."""
        self.apply_theme(DARK if dark else LIGHT)

    def _page(self, title: str, caption: str) -> tuple[QWidget, QVBoxLayout]:
        """과제·이러닝·현황·설정 공통 머리글."""
        w = QWidget()
        w.setObjectName("canvas")
        v = QVBoxLayout(w)
        v.setContentsMargins(28, 24, 28, 24)
        v.setSpacing(16)
        t = QLabel(title)
        t.setObjectName("pageTitle")
        c = QLabel(caption)
        c.setObjectName("caption")
        c.setWordWrap(True)
        v.addWidget(t)
        v.addWidget(c)
        return w, v

    def _toolbar(self, *widgets: QWidget) -> QHBoxLayout:
        """필터 + 조회 버튼 한 줄."""
        bar = QHBoxLayout()
        bar.setSpacing(8)
        for w in widgets:
            bar.addWidget(w, 1 if isinstance(w, QComboBox) else 0)
        bar.addStretch(1)
        return bar

    def _primary(self, text: str, slot: Callable[..., object]) -> QPushButton:
        """파란 기본 버튼."""
        btn = QPushButton(text)
        btn.setObjectName("primary")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(slot)
        return btn

    def _ghost(self, text: str, slot: Callable[..., object]) -> QPushButton:
        """테두리 있는 보조 버튼."""
        btn = QPushButton(text)
        btn.setObjectName("ghost")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(slot)
        return btn

    def _build_login(self) -> QWidget:
        """로그인 입력 카드와 성공 카드를 겹쳐 둔다."""
        w = QWidget()
        w.setObjectName("canvas")
        outer = QVBoxLayout(w)
        outer.setContentsMargins(28, 36, 28, 28)
        outer.addStretch(1)
        row = QHBoxLayout()
        row.addStretch(1)
        self.login_stack = FadeStack(duration=280)
        self.login_stack.setFixedWidth(420)
        self.login_stack.addWidget(self._build_login_form())
        self.login_stack.addWidget(self._build_login_success())
        row.addWidget(self.login_stack)
        row.addStretch(1)
        outer.addLayout(row)
        outer.addStretch(2)
        return w

    def _build_login_form(self) -> QWidget:
        """학번·비밀번호 입력 카드."""
        card = self._card()
        inner = QVBoxLayout(card)
        inner.setContentsMargins(28, 28, 28, 24)
        inner.setSpacing(10)

        hello = QLabel("안녕하세요")
        hello.setObjectName("hello")
        sub = QLabel("학번과 비밀번호로\ne-campus를 확인하세요")
        sub.setObjectName("caption")
        sub.setWordWrap(True)
        inner.addWidget(hello)
        inner.addWidget(sub)
        inner.addSpacing(8)

        lab_id = QLabel("학번")
        lab_id.setObjectName("field")
        self.id_edit = QLineEdit()
        self.id_edit.setPlaceholderText("학번")
        lab_pw = QLabel("비밀번호")
        lab_pw.setObjectName("field")
        self.pw_edit = QLineEdit()
        self.pw_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.pw_edit.setPlaceholderText("비밀번호")
        self.pw_edit.returnPressed.connect(self.on_login)
        inner.addWidget(lab_id)
        inner.addWidget(self.id_edit)
        inner.addWidget(lab_pw)
        inner.addWidget(self.pw_edit)

        self.demo_chk = TossCheck("데모 모드  ·  네트워크 없이 샘플 보기")
        self.demo_chk.setChecked(True)
        inner.addSpacing(4)
        inner.addWidget(self.demo_chk)

        self.login_file_hint = QLabel()
        self.login_file_hint.setObjectName("hint")
        self.login_file_hint.setWordWrap(True)
        inner.addWidget(self.login_file_hint)

        inner.addSpacing(8)
        inner.addWidget(self._primary("로그인", self.on_login))
        inner.addWidget(self._ghost("저장된 세션으로 접속", self.on_session))

        self.profile = QLabel("로그인하면 이름 · 학번 · 학과를 보여 줍니다.")
        self.profile.setObjectName("hint")
        self.profile.setWordWrap(True)
        inner.addWidget(self.profile)
        notice = QLabel("공식 SDK가 아닙니다. 비공식 수업용 클라이언트입니다.")
        notice.setObjectName("hint")
        notice.setWordWrap(True)
        inner.addWidget(notice)
        return card

    def _build_login_success(self) -> QWidget:
        """로그인 성공 뒤 바꾸는 Successful! 카드."""
        card = self._card()
        inner = QVBoxLayout(card)
        inner.setContentsMargins(32, 36, 32, 28)
        inner.setSpacing(8)
        self.ok_mark = SuccessMark(size=76)
        title = QLabel("Successful!")
        title.setObjectName("successTitle")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sub = QLabel("로그인 완료")
        sub.setObjectName("caption")
        sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.ok_who = QLabel("")
        self.ok_who.setObjectName("hello")
        self.ok_who.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.ok_who.setWordWrap(True)
        self.ok_sub = QLabel("")
        self.ok_sub.setObjectName("caption")
        self.ok_sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.ok_sub.setWordWrap(True)
        go = self._primary("홈으로 가기", lambda: self._show_home())
        again = self._ghost("다시 로그인", self._show_login_form)
        inner.addWidget(self.ok_mark, 0, Qt.AlignmentFlag.AlignHCenter)
        inner.addSpacing(8)
        inner.addWidget(title)
        inner.addWidget(sub)
        inner.addSpacing(10)
        inner.addWidget(self.ok_who)
        inner.addWidget(self.ok_sub)
        inner.addSpacing(18)
        inner.addWidget(go)
        inner.addWidget(again)
        return card

    def _goto(self, index: int) -> None:
        """왼쪽 메뉴와 페이지를 같이 옮긴다. 0번은 로그인 또는 홈."""
        self.sidebar.set_current(index)
        self.stack.setCurrentIndex(index)
        if index == 0 and self.backend.logged_in:
            self.auth_stack.setCurrentIndex(1)

    def _show_home(self) -> None:
        """로그인 뒤 태블릿 홈을 연다."""
        self._fill_home()
        self.auth_stack.setCurrentIndex(1)
        self._goto(0)

    def _build_auth(self) -> QWidget:
        """로그인 카드와 홈 대시보드를 같은 메뉴에 둔다."""
        self.auth_stack = FadeStack(duration=280)
        self.auth_stack.setObjectName("canvas")
        self.auth_stack.addWidget(self._build_login())
        self.auth_stack.addWidget(self._build_home())
        return self.auth_stack

    def _build_home(self) -> QWidget:
        """인사 + 통계 + 색 타일 + 조회 원 + 바로가기."""
        inner = QWidget()
        inner.setObjectName("canvas")
        v = QVBoxLayout(inner)
        v.setContentsMargins(28, 8, 28, 16)
        v.setSpacing(10)

        top = QHBoxLayout()
        self.home_date = QLabel(datetime.now().strftime("%Y. %m. %d"))
        self.home_date.setObjectName("topDate")
        self.home_who_chip = QLabel("학생")
        self.home_who_chip.setObjectName("chipName")
        top.addStretch(1)
        top.addWidget(self.home_date)
        top.addSpacing(16)
        top.addWidget(self.home_who_chip)
        v.addLayout(top)

        self.home_title = QLabel("안녕하세요!")
        self.home_title.setObjectName("heroTitle")
        self.home_sub = QLabel("로그인하면 과제와 이러닝을 한곳에서 봅니다.")
        self.home_sub.setObjectName("heroSub")
        greet = QVBoxLayout()
        greet.setSpacing(2)
        greet.setContentsMargins(0, 0, 0, 0)
        greet.addWidget(self.home_title)
        greet.addWidget(self.home_sub)
        v.addLayout(greet)

        body = QHBoxLayout()
        body.setSpacing(16)
        left = QVBoxLayout()
        left.setSpacing(10)

        stats = QHBoxLayout()
        stats.setSpacing(10)
        self.home_stat_asg = StatBox("미제출 과제")
        self.home_stat_les = StatBox("미완료 이러닝")
        self.home_stat_crs = StatBox("과목")
        stats.addWidget(self.home_stat_asg)
        stats.addWidget(self.home_stat_les)
        stats.addWidget(self.home_stat_crs)
        left.addLayout(stats)

        for group in (
            (
                ("todo", "지금 할 것", "blue", PAGE_TODO),
                ("assignment", "과제", "pink", PAGE_ASG),
                ("notice", "공지", "blue", PAGE_NOTICE),
            ),
            (
                ("material", "자료", "pink", PAGE_MAT),
                ("lesson", "이러닝", "blue", PAGE_LES),
                ("timetable", "시간표", "pink", PAGE_TT),
            ),
        ):
            tiles = QHBoxLayout()
            tiles.setSpacing(12)
            for icon, title, var, idx in group:
                tile = DashTile(icon, title, var)
                tile.clicked.connect(lambda i=idx: self._goto(i))
                tiles.addWidget(tile)
            left.addLayout(tiles)

        bottom = QHBoxLayout()
        bottom.setSpacing(12)
        gauge_card = QFrame()
        gauge_card.setObjectName("featBlue")
        gauge_card.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        gauge_card.setMinimumHeight(228)
        gl = QHBoxLayout(gauge_card)
        gl.setContentsMargins(16, 16, 16, 16)
        self.home_gauge = InquiryGauge()
        self.home_gauge.setMinimumSize(200, 200)
        self.home_gauge.clicked.connect(self._on_home_scan)
        gl.addWidget(self.home_gauge)
        bottom.addWidget(gauge_card, 1)
        left.addLayout(bottom)
        left.addStretch(1)

        right = QVBoxLayout()
        right.setSpacing(10)
        shortcuts = QFrame()
        shortcuts.setObjectName("sidePanel")
        shortcuts.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        sl = QVBoxLayout(shortcuts)
        sl.setContentsMargins(20, 14, 20, 14)
        sl.setSpacing(8)
        st = QLabel("Shortcuts")
        st.setObjectName("panelTitle")
        sl.addWidget(st)
        for icon, name, idx in (
            ("status", "현황", PAGE_SUM),
            ("settings", "설정", PAGE_CFG),
            ("info", "정보", PAGE_INFO),
        ):
            row = QHBoxLayout()
            ic = LineIcon(icon, size=22, color=CURRENT.blue, stroke=1.8)
            nm = QLabel(name)
            nm.setObjectName("shortName")
            go = QPushButton("열기")
            go.setObjectName("shortBtn")
            go.setCursor(Qt.CursorShape.PointingHandCursor)
            go.setMinimumSize(64, 32)
            go.setSizePolicy(QSizePolicy.Policy.Minimum, QSizePolicy.Policy.Fixed)
            go.clicked.connect(lambda _=False, i=idx: self._goto(i))
            row.addWidget(ic)
            row.addWidget(nm, 1)
            row.addWidget(go)
            sl.addLayout(row)
        sl.addStretch(1)

        members = QFrame()
        members.setObjectName("sidePanel")
        members.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        ml = QVBoxLayout(members)
        ml.setContentsMargins(20, 18, 20, 18)
        mt = QLabel("Profile")
        mt.setObjectName("panelTitle")
        self.home_member_av = QLabel("?")
        self.home_member_av.setObjectName("avatar")
        self.home_member_av.setFixedSize(48, 48)
        self.home_member_av.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.home_member_av.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.home_member_av.setStyleSheet("background:#FF6B9D; color:#FFFFFF; border-radius:24px; font-weight:800;")
        self.home_member_name = QLabel("로그인 전")
        self.home_member_name.setObjectName("memberName")
        self.home_member_name.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.home_member_id = QLabel("학번 —")
        self.home_member_id.setObjectName("memberMeta")
        self.home_member_id.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.home_member_id.setWordWrap(True)
        self.home_member_college = QLabel("대학 —")
        self.home_member_college.setObjectName("memberMeta")
        self.home_member_college.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.home_member_college.setWordWrap(True)
        self.home_member_dept = QLabel("학과 —")
        self.home_member_dept.setObjectName("memberHint")
        self.home_member_dept.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.home_member_dept.setWordWrap(True)
        ml.addWidget(mt)
        ml.addSpacing(8)
        ml.addWidget(self.home_member_av, 0, Qt.AlignmentFlag.AlignHCenter)
        ml.addWidget(self.home_member_name)
        ml.addWidget(self.home_member_id)
        ml.addWidget(self.home_member_college)
        ml.addWidget(self.home_member_dept)
        ml.addStretch(1)

        right.addWidget(shortcuts, 1)
        right.addWidget(members)
        body.addLayout(left, 3)
        body.addLayout(right, 2)
        v.addLayout(body, 1)
        return self._scroll_page(inner)

    def _on_home_scan(self) -> None:
        """홈의 조회 원. 로그인 뒤 지금 할 일을 연다."""
        if not self.backend.logged_in:
            self._alert("먼저 로그인하세요.", True)
            return

        def then() -> None:
            """홈 숫자를 고치고 할 일 화면으로 간다."""
            self._fill_home()
            self._goto(PAGE_TODO)
            self._fill_todo()

        self._reload(then, "지금 할 일을 불러오는 중")

    def _fill_home(self) -> None:
        """인사와 숫자, 프로필을 채운다."""
        who = self.backend.student_name or "학생"
        college = self.backend.college_name or "서원대학교"
        dept = self.backend.dept_name or ""
        tag = "데모 모드" if self.backend.demo else (dept or college)
        self.home_title.setText(f"안녕하세요, {who}님!")
        self.home_sub.setText(f"{tag} · 과제, 공지, 이러닝, 시간표를 한곳에서 봅니다.")
        self.home_who_chip.setText(f"{who}님")
        self.home_member_av.setText(who[0])
        self.home_member_name.setText(who)
        self.home_member_id.setText(self.backend.student_id or "학번 —")
        self.home_member_college.setText(college)
        self.home_member_dept.setText(dept or "학과 정보 없음")
        courses = list(self.backend.data.get("courses") or [])
        due = 0
        pend = 0
        for c in courses:
            due += sum(1 for a in (c.get("assignments") or []) if a.get("dueNow"))
            pend += sum(1 for les in (c.get("elearning") or []) if les.get("needsWatch"))
        self.home_stat_asg.set_value(due)
        self.home_stat_les.set_value(pend)
        self.home_stat_crs.set_value(len(courses))

    def _show_login_form(self) -> None:
        """성공 카드에서 입력 카드로 돌아간다."""
        self.login_stack.setCurrentIndex(0)

    def _show_login_success(self, who: str, subtitle: str) -> None:
        """알림창 대신 성공 카드로 화면을 바꾼다."""
        self.ok_who.setText(who)
        self.ok_sub.setText(subtitle)
        self.login_stack.setCurrentIndex(1)
        self.ok_mark.play()

    def _build_todo(self) -> QWidget:
        """지금 할 것 페이지."""
        inner, v = self._page("지금 할 것", "기간 안 미제출 과제와 들어야 할 이러닝을 과목별로 모읍니다.")
        self.todo_filter = QComboBox()
        self.todo_filter.addItems(["전체 항목 (이러닝+과제)", "과제만", "이러닝만"])
        v.addLayout(self._toolbar(self.todo_filter, self._primary("조회", self.refresh_todo), self._ghost("새로고침", self.refresh_todo)))

        self.todo_summary = QFrame()
        self.todo_summary.setObjectName("todoSummary")
        self.todo_summary.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        sl = QVBoxLayout(self.todo_summary)
        sl.setContentsMargins(24, 18, 24, 18)
        sl.setSpacing(8)
        self.todo_badge = QLabel("할 일")
        self.todo_badge.setObjectName("todoBadge")
        self.todo_badge.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Fixed)
        self.todo_sum_text = QLabel("조회하면 지금 할 일을 모읍니다.")
        self.todo_sum_text.setWordWrap(True)
        sl.addWidget(self.todo_badge)
        sl.addWidget(self.todo_sum_text)
        self.todo_summary.hide()
        v.addWidget(self.todo_summary)

        self.todo_list = JobList()
        self.todo_list.show_empty("todo", "조회 버튼을 눌러 할 일을 확인하세요", "현재 수강 기간 안에 제출할 과제와 들어야 할 이러닝을 과목별로 모읍니다.", "조회")
        self.todo_list.row_acted.connect(lambda row: self.refresh_todo() if row is None else self._todo_act(row))
        v.addWidget(self.todo_list, 1)
        return self._scroll_page(inner)

    def _build_assignments(self) -> QWidget:
        """과제 목록. 고른 행 아래에 상세·제출 칸을 펼친다."""
        inner, v = self._page("과제", "기간과 제출 상태를 한 번에 보고, 글·파일로 제출할 수 있습니다.")
        self.asg_filter = QComboBox()
        self.asg_filter.addItems(["전체 과제", "지금 할 수 있는 과제", "미제출 · 진행중"])
        self.asg_course = QComboBox()
        self.asg_course.setMinimumWidth(160)
        self.asg_course.addItem("전체 과목", "all")
        self.asg_filter.currentIndexChanged.connect(lambda _: self._fill_assignments())
        self.asg_course.currentIndexChanged.connect(lambda _: self._fill_assignments())
        v.addLayout(self._toolbar(self.asg_filter, self.asg_course, self._primary("조회", self.refresh_assignments)))

        self.asg_list = JobList()
        self.asg_list.show_empty("assignment", "아직 과제가 없습니다", "조회를 누르면 과목별 과제를 카드로 보여 줍니다.", "조회")
        self.asg_list.row_acted.connect(lambda row: self.refresh_assignments() if row is None else None)
        self.asg_list.row_clicked.connect(self._on_asg_clicked)
        v.addWidget(self.asg_list, 1)
        self.asg_detail: QTextEdit | None = None
        self.asg_submit_text: QTextEdit | None = None
        self.asg_file_lab: QLabel | None = None
        self.asg_files: QHBoxLayout | None = None
        self._asg_file: str = ""
        return self._scroll_page(inner)

    def _build_notices(self) -> QWidget:
        """과목 공지 목록. 고른 행 아래에 본문·첨부를 펼친다."""
        inner, v = self._page("공지", "과목마다 강의실 공지를 모으고, 본문과 첨부를 봅니다.")
        self.notice_course = QComboBox()
        self.notice_course.setMinimumWidth(160)
        self.notice_course.addItem("전체 과목", "all")
        self.notice_course.currentIndexChanged.connect(lambda _: self._fill_notices())
        v.addLayout(self._toolbar(self.notice_course, self._primary("조회", self.refresh_notices)))
        self.notice_list = JobList()
        self.notice_list.show_empty("notice", "아직 공지가 없습니다", "조회를 누르면 과목별 공지를 카드로 보여 줍니다.", "조회")
        self.notice_list.row_acted.connect(lambda row: self.refresh_notices() if row is None else None)
        self.notice_list.row_clicked.connect(self._on_notice_clicked)
        v.addWidget(self.notice_list, 1)
        self.notice_detail: QTextEdit | None = None
        self.notice_files: QHBoxLayout | None = None
        return self._scroll_page(inner)

    def _build_materials(self) -> QWidget:
        """강의자료실 목록. 고른 행 아래에 본문·첨부를 펼친다."""
        inner, v = self._page("강의실 자료", "강의자료실 글을 모으고 첨부 파일을 받습니다.")
        self.mat_course = QComboBox()
        self.mat_course.setMinimumWidth(160)
        self.mat_course.addItem("전체 과목", "all")
        self.mat_course.currentIndexChanged.connect(lambda _: self._fill_materials())
        v.addLayout(self._toolbar(self.mat_course, self._primary("조회", self.refresh_materials)))
        self.mat_list = JobList()
        self.mat_list.show_empty("material", "아직 자료가 없습니다", "조회를 누르면 과목별 강의자료를 카드로 보여 줍니다.", "조회")
        self.mat_list.row_acted.connect(lambda row: self.refresh_materials() if row is None else None)
        self.mat_list.row_clicked.connect(self._on_mat_clicked)
        v.addWidget(self.mat_list, 1)
        self.mat_detail: QTextEdit | None = None
        self.mat_files: QHBoxLayout | None = None
        return self._scroll_page(inner)

    def _build_timetable(self) -> QWidget:
        """수강 시간표 격자."""
        inner, v = self._page("시간표", "이번 학기 수강 시간표를 표로 봅니다. 신청·취소는 하지 않습니다.")
        v.addLayout(
            self._toolbar(
                self._primary("조회", self.refresh_timetable),
                self._ghost("그림 저장", self.save_timetable_image),
            )
        )
        self.tt_summary = QLabel("조회하면 과목 수와 학점을 보여 줍니다.")
        self.tt_summary.setObjectName("caption")
        self.tt_summary.setWordWrap(True)
        v.addWidget(self.tt_summary)
        self.tt_board = TimetableBoard()
        v.addWidget(self.tt_board, 1)
        self.tt_courses = JobList()
        self.tt_courses.show_empty("timetable", "시간표를 조회해보세요", "상단의 조회를 누르면 이번 학기 수강 시간표를 그립니다.", "조회")
        self.tt_courses.row_acted.connect(lambda row: self.refresh_timetable() if row is None else None)
        v.addWidget(self.tt_courses, 1)
        return self._scroll_page(inner)

    def _build_lessons(self) -> QWidget:
        """이러닝 차시 목록."""
        inner, v = self._page("이러닝", "차시 출결과 들어야 할 강의를 모읍니다.")
        self.les_filter = QComboBox()
        self.les_filter.addItems(["차시 목록", "들을 차시"])
        v.addLayout(self._toolbar(self.les_filter, self._primary("조회", self.refresh_lessons), self._ghost("학습률(%)", self.show_progress)))

        self.les_list = JobList()
        self.les_list.show_empty("lesson", "아직 차시가 없습니다", "조회를 누르면 주차별 이러닝을 카드로 보여 줍니다.", "조회")
        self.les_list.row_acted.connect(lambda row: self.refresh_lessons() if row is None else self.show_progress())
        v.addWidget(self.les_list, 1)
        return self._scroll_page(inner)

    def _build_summary(self) -> QWidget:
        """과목별 미제출·미완료 카드."""
        inner, v = self._page("현황", "과목별 미제출 과제와 미완료 이러닝을 한눈에 봅니다.")
        v.addWidget(self._primary("과목별 모아 보기", self.refresh_summary), 0, Qt.AlignmentFlag.AlignLeft)

        stats = QHBoxLayout()
        stats.setSpacing(10)
        self.stat_asg = StatBox("미제출 과제")
        self.stat_les = StatBox("미완료 이러닝")
        self.stat_crs = StatBox("과목")
        stats.addWidget(self.stat_asg)
        stats.addWidget(self.stat_les)
        stats.addWidget(self.stat_crs)
        v.addLayout(stats)

        self.sum_grid_host = QWidget()
        self.sum_grid = QGridLayout(self.sum_grid_host)
        self.sum_grid.setContentsMargins(0, 0, 0, 0)
        self.sum_grid.setSpacing(16)
        v.addWidget(self.sum_grid_host)
        v.addStretch(1)
        return self._scroll_page(inner)

    def _build_settings(self) -> QWidget:
        """다크 모드 스위치와 결과 저장."""
        inner, v = self._page("설정", "화면 테마와 조회 파일을 여기서 바꿉니다.")

        theme_card = self._card()
        tl = QVBoxLayout(theme_card)
        tl.setContentsMargins(22, 18, 22, 18)
        tl.setSpacing(6)
        row_t = QHBoxLayout()
        lab = QLabel("다크 모드")
        lab.setObjectName("hello")
        self.theme_switch = TossSwitch()
        self.theme_switch.toggled.connect(self._on_theme_toggled)
        row_t.addWidget(lab)
        row_t.addStretch(1)
        row_t.addWidget(self.theme_switch)
        self.theme_caption = QLabel("연한 라벤더 태블릿 화면입니다.")
        self.theme_caption.setObjectName("caption")
        self.theme_caption.setWordWrap(True)
        tl.addLayout(row_t)
        tl.addWidget(self.theme_caption)
        v.addWidget(theme_card)

        card = self._card()
        cl = QVBoxLayout(card)
        cl.setContentsMargins(22, 20, 22, 20)
        cl.setSpacing(10)
        hint = QLabel(
            "config.json · login.json 은 실행 폴더에 있습니다.\n"
            "login.json 에 학번과 비밀번호를 둘 다 넣으면 입력 칸을 건너뜁니다.\n"
            "하나라도 비어 있으면 지금처럼 직접 입력합니다. 비밀번호는 session.json 에 넣지 않습니다."
        )
        hint.setObjectName("hint")
        hint.setWordWrap(True)
        cl.addWidget(hint)
        row = QHBoxLayout()
        row.addWidget(self._primary("조회 결과 저장", self.save_result))
        row.addWidget(self._ghost("조회 결과 불러오기", self.load_result))
        row.addStretch(1)
        cl.addLayout(row)
        v.addWidget(card)
        v.addStretch(1)
        return self._scroll_page(inner)

    def _build_info(self) -> QWidget:
        """프로그램 안내와 관련 저장소."""
        inner, v = self._page("프로그램 정보", f"seowon-cli  v{VERSION}  ·  Python 클라이언트")

        notice = QFrame()
        notice.setObjectName("infoNotice")
        notice.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        nl = QHBoxLayout(notice)
        nl.setContentsMargins(14, 10, 14, 10)
        nlab = QLabel("공식 SDK가 아닙니다. 비공식 수업용 클라이언트입니다.")
        nlab.setObjectName("infoNoticeText")
        nlab.setWordWrap(True)
        nl.addWidget(nlab)
        v.addWidget(notice)

        head = self._card()
        hl = QVBoxLayout(head)
        hl.setContentsMargins(24, 22, 24, 22)
        ht = QLabel("서원대 e-campus 몰아보기")
        ht.setObjectName("hello")
        hd = QLabel("로그인 한 번으로 전 과목의 과제, 공지, 강의자료, 이러닝, 시간표를 모아 보여 줍니다. 화면은 스마트홈 태블릿처럼 파랑과 핑크 타일입니다.")
        hd.setObjectName("caption")
        hd.setWordWrap(True)
        pills = QHBoxLayout()
        for text, accent in (("Python 3.10+", True), ("PyQt6", False), ("과제 제출", True), ("JSON 저장", False), ("MIT", False)):
            p = QLabel(text)
            p.setObjectName("infoPill")
            p.setProperty("accent", accent)
            p.setAlignment(Qt.AlignmentFlag.AlignCenter)
            pills.addWidget(p)
        pills.addStretch(1)
        hl.addWidget(ht)
        hl.addWidget(hd)
        hl.addLayout(pills)
        v.addWidget(head)

        grid = QGridLayout()
        grid.setSpacing(16)
        cards = [
            ("assignment", "과제", "기간·제출 상태를 보고 글·파일로 제출합니다.", "과제 ➔", "blue", PAGE_ASG),
            ("notice", "수강 공지", "과목 공지 본문과 첨부를 모읍니다.", "공지 ➔", "surface", PAGE_NOTICE),
            ("material", "강의실 자료", "강의자료실 글과 첨부 파일을 받습니다.", "자료 ➔", "dark", PAGE_MAT),
            ("timetable", "수강 시간표", "이번 학기 요일·교시 격자를 그립니다.", "시간표 ➔", "surface", PAGE_TT),
        ]
        for i, (icon, title, sub, action, variant, idx) in enumerate(cards):
            card = FeatureCard(icon, title, sub, action, variant)
            card.clicked.connect(lambda i=idx: self._goto(i))
            grid.addWidget(card, i // 2, i % 2)
        v.addLayout(grid)

        bound = self._card()
        bl = QVBoxLayout(bound)
        bl.setContentsMargins(22, 18, 22, 18)
        bt = QLabel("하지 않는 것")
        bt.setObjectName("hello")
        bd = QLabel("수강신청 · 희망바구니 · 다른 학생 계정 조회")
        bd.setObjectName("caption")
        bd.setWordWrap(True)
        bl.addWidget(bt)
        bl.addWidget(bd)
        v.addWidget(bound)

        links = QHBoxLayout()
        for label, url in (
            ("seowon-cli", "https://github.com/hy040504/seowon-cli"),
            ("seowon-client-web", "https://github.com/hy040504/seowon-client-web"),
            ("seowon-client-api", "https://github.com/hy040504/seowon-client-api"),
        ):
            b = self._ghost(label, lambda _=False, u=url: QDesktopServices.openUrl(QUrl(u)))
            links.addWidget(b)
        links.addStretch(1)
        v.addLayout(links)
        v.addStretch(1)
        return self._scroll_page(inner)

    def _fill_login_from_file(self) -> None:
        """login.json 값을 입력칸에 미리 넣는다."""
        sid, pw = load_login_file()
        if sid:
            self.id_edit.setText(sid)
        if pw:
            self.pw_edit.setText(pw)
        if login_file_complete():
            self.login_file_hint.setText("login.json 에 학번·비밀번호가 있습니다. 로그인만 누르면 됩니다.")
        elif sid or pw:
            self.login_file_hint.setText("login.json 에 빈 칸이 있습니다. 비어 있는 값을 입력하세요.")
        else:
            self.login_file_hint.setText("login.json 이 비어 있습니다. 학번과 비밀번호를 입력하세요.")

    def _apply_profile_chip(self) -> None:
        """왼쪽 아래 이름 칩을 고친다."""
        if not self.backend.logged_in:
            self.sidebar.set_profile("로그인 전", "세션 없음", "?")
            self.sidebar.set_logged_in(False)
            return
        who = self.backend.student_name or self.backend.student_id or "학생"
        self.sidebar.set_profile(who, "", who[0])
        self.sidebar.set_logged_in(True)

    def _alert(self, msg: str, err: bool = False) -> None:
        """오류·안내는 웹처럼 토스트로 띄운다."""
        self.toast.show_msg(msg, err)

    def _busy(self, message: str, fn: Callable[[], Any], done: Callable[[Any], None]) -> None:
        """스피너를 띄운 채 ``fn`` 을 백그라운드에서 돌린다.

        메뉴마다 같은 로딩 막을 쓴다. 너무 짧게 깜빡이지 않게 최소 시간을 둔다.

        Parameters
        ----------
        message : str
            막 위에 띄울 안내.
        fn : Callable
            워커 스레드에서 실행할 함수.
        done : Callable
            성공 시 UI 스레드에서 결과를 받는 콜백.
        """
        if self._th is not None and self._th.isRunning():
            return
        self.overlay.setGeometry(self.centralWidget().rect())
        self.overlay.show_msg(message)
        self._busy_t0 = time.monotonic()
        th = FnThread(fn)
        self._th = th
        th.ok.connect(lambda result, cb=done: self._busy_ok(result, cb))
        th.err.connect(self._busy_err)
        th.finished.connect(self._on_thread_finished)
        th.start()

    def _busy_wait(self) -> int:
        """스피너가 너무 짧게 깜빡이지 않게 남은 시간(ms)."""
        elapsed = int((time.monotonic() - getattr(self, "_busy_t0", 0.0)) * 1000)
        return max(0, BUSY_MIN_MS - elapsed)

    def _on_thread_finished(self) -> None:
        """끝난 스레드 손잡이를 비운다."""
        th = self._th
        self._th = None
        if th is not None:
            th.deleteLater()

    def _busy_ok(self, result: Any, done: Callable[[Any], None]) -> None:
        """작업이 끝나면 스피너를 내리고 화면을 갱신한다."""
        wait = self._busy_wait()
        if wait > 40:
            QTimer.singleShot(wait, lambda r=result, cb=done: self._busy_ok_now(r, cb))
            return
        self._busy_ok_now(result, done)

    def _busy_ok_now(self, result: Any, done: Callable[[Any], None]) -> None:
        """스피너를 내리고 성공 콜백을 부른다."""
        self.overlay.hide_msg()
        try:
            done(result)
        except Exception as e:  # noqa: BLE001
            self._alert(str(e), True)

    def _busy_err(self, msg: str) -> None:
        """작업이 실패하면 스피너를 내리고 이유를 보여 준다."""
        wait = self._busy_wait()
        if wait > 40:
            QTimer.singleShot(wait, lambda m=msg: self._busy_err_now(m))
            return
        self._busy_err_now(msg)

    def _busy_err_now(self, msg: str) -> None:
        """스피너를 내리고 오류 토스트를 띄운다."""
        self.overlay.hide_msg()
        self._alert(msg, True)

    def _reload(self, then: Callable[[], None], message: str) -> None:
        """조회 버튼은 항상 다시 가져와 같은 로딩 막을 보여 준다."""

        def work() -> dict[str, Any]:
            """과제·이러닝을 한 번에 가져온다."""
            return self.backend.fetch()

        self._busy(message, work, lambda _: then())

    def _ensure_data(self, then: Callable[[], None], message: str = "불러오는 중") -> None:
        """아직 조회 결과가 없으면 먼저 fetch 한 뒤 then 을 부른다."""
        if self.backend.data.get("courses"):
            then()
            return
        self._reload(then, message)

    def on_login(self) -> None:
        """로그인 버튼. 조회는 백그라운드 스레드에서 돈다."""
        sid = self.id_edit.text().strip()
        pw = self.pw_edit.text()
        demo = self.demo_chk.isChecked()
        file_sid, file_pw = load_login_file()
        if not sid:
            sid = file_sid
        if not pw:
            pw = file_pw
        if not demo and (not sid or not pw):
            self._alert("학번과 비밀번호를 입력하거나 login.json 을 채워 주세요.", True)
            return

        def work() -> dict[str, Any]:
            """학번·비밀번호로 로그인한다."""
            return self.backend.login(sid, pw, demo)

        self._busy("로그인하는 중", work, self._after_login)

    def _after_login(self, _out: Any) -> None:
        """로그인 성공 카드로 바꾼다."""
        self.pw_edit.clear()
        who = self.backend.profile_label()
        tag = "데모 모드로 들어왔어요" if self.backend.demo else "과제·이러닝 메뉴에서 조회하세요"
        self.profile.setText(who)
        self._apply_profile_chip()
        self._show_login_success(who, tag)
        self._show_home()

    def on_session(self) -> None:
        """저장된 세션으로 접속한다."""
        if self.demo_chk.isChecked():
            self.on_login()
            return

        def work() -> bool:
            """session.json 쿠키를 시험한다."""
            return self.backend.try_session()

        def done(ok: Any) -> None:
            """세션이 살아 있으면 성공 카드를 연다."""
            if not ok:
                self._alert("세션이 없거나 만료되었습니다. 다시 로그인하세요.", True)
                return
            who = self.backend.profile_label()
            self.profile.setText(who)
            self._apply_profile_chip()
            self._show_login_success(who, "저장된 세션으로 들어왔어요")
            self._show_home()

        self._busy("세션을 확인하는 중", work, done)

    def on_logout(self) -> None:
        """사이드바 로그아웃. 세션 파일은 지우지 않고 화면만 로그인으로 돌린다."""
        self.backend.logged_in = False
        self.backend.student_id = ""
        self.backend.student_name = ""
        self.backend.college_name = ""
        self.backend.dept_name = ""
        self._apply_profile_chip()
        self.auth_stack.setCurrentIndex(0)
        self._show_login_form()
        self._goto(0)

    def refresh_todo(self) -> None:
        """지금 할 일 조회."""
        self._reload(self._fill_todo, "지금 할 일을 불러오는 중")

    def _fill_todo(self) -> None:
        """기간 안 미제출 과제와 들을 차시를 카드로 넣는다."""
        mode = self.todo_filter.currentIndex()  # 0 전체, 1 과제, 2 이러닝
        self.todo_list.clear()
        due_n = 0
        watch_n = 0
        any_row = False
        for ci, course in enumerate(self.backend.data.get("courses") or []):
            title = course.get("courseTitle") or ""
            block: list[JobRow] = []
            if mode != 2:
                for ai, a in enumerate(course.get("assignments") or []):
                    if not a.get("dueNow"):
                        continue
                    due_n += 1
                    status = a.get("status") or ""
                    block.append(
                        JobRow(
                            a.get("title") or "",
                            f"{title}  ·  {a.get('period') or ''}",
                            badge=status or "과제",
                            badge_kind=_badge_kind_status(status),
                            hot="지금",
                            action="상세",
                            payload={"kind": "asg", "ci": ci, "ai": ai},
                        )
                    )
            if mode != 1:
                for li, les in enumerate(course.get("elearning") or []):
                    if not les.get("needsWatch"):
                        continue
                    watch_n += 1
                    att = les.get("attendanceStatus") or ""
                    pct = les.get("progressPercent")
                    block.append(
                        JobRow(
                            les.get("title") or "",
                            f"{title}  ·  {les.get('week') or ''}  ·  {les.get('period') or ''}",
                            badge=att or "이러닝",
                            badge_kind=_badge_kind_att(att),
                            hot="-" if pct is None else f"{pct}%",
                            action="학습률",
                            payload={"kind": "les", "ci": ci, "li": li},
                        )
                    )
            if block:
                any_row = True
                self.todo_list.add_header(title)
                for row in block:
                    self.todo_list.add_row(row)
        if not any_row:
            self.todo_list.show_empty("sparkle", "지금 할 일이 없습니다", "기간 안 미제출 과제와 들을 차시가 없습니다.")
            self.todo_badge.setText("할 일 없음")
            self.todo_badge.setProperty("done", True)
            self.todo_sum_text.setText("지금은 제출할 과제와 들을 이러닝이 없습니다.")
        else:
            self.todo_list.finish()
            self.todo_badge.setText(f"할 일 {due_n + watch_n}")
            self.todo_badge.setProperty("done", False)
            self.todo_sum_text.setText(f"미제출 과제 {due_n}건 · 들을 이러닝 {watch_n}건")
        self.todo_badge.style().unpolish(self.todo_badge)
        self.todo_badge.style().polish(self.todo_badge)
        self.todo_summary.show()

    def _todo_act(self, row: JobRow) -> None:
        """할 일 카드의 상세/% 버튼."""
        payload = row.payload or {}
        if payload.get("kind") == "asg":
            self._goto(PAGE_ASG)
            self._ensure_data(self._fill_assignments)
        elif payload.get("kind") == "les":
            self._goto(PAGE_LES)

            def work() -> int:
                """고른 차시 학습률."""
                return self.backend.lesson_progress(int(payload["ci"]), int(payload["li"]))

            def done(pct: Any) -> None:
                """학습률을 행에 반영한다."""
                row.set_hot(f"{pct}%")
                self._alert(f"학습률 {pct}%")

            self._busy("학습률을 조회하는 중", work, done)

    def refresh_assignments(self) -> None:
        """과제 조회."""
        self._reload(self._fill_assignments, "과제를 불러오는 중")

    def _fill_course_combo(self, combo: QComboBox) -> None:
        """수강 과목으로 필터 목록을 채운다.

        Args:
            combo: 과제·공지·자료 과목 콤보.
        """
        prev = combo.currentData()
        combo.blockSignals(True)
        combo.clear()
        combo.addItem("전체 과목", "all")
        seen: set[str] = set()
        for course in self.backend.data.get("courses") or []:
            cd = str(course.get("crsCreCd") or "")
            title = str(course.get("courseTitle") or cd)
            if not cd or cd in seen:
                continue
            seen.add(cd)
            combo.addItem(title, cd)
        idx = combo.findData(prev)
        combo.setCurrentIndex(idx if idx >= 0 else 0)
        combo.blockSignals(False)

    def _course_filter_cd(self, combo: QComboBox) -> str:
        """선택한 과목 코드. 전체면 빈 문자열.

        Args:
            combo: 과목 콤보.

        Returns:
            ``crsCreCd``. 전체면 ``""``.
        """
        cd = combo.currentData()
        if cd in (None, "all", ""):
            return ""
        return str(cd)

    def _fill_assignments(self) -> None:
        """필터에 맞는 과제 행을 카드에 넣는다."""
        self._fill_course_combo(self.asg_course)
        mode = self.asg_filter.currentIndex()
        want = self._course_filter_cd(self.asg_course)
        self.asg_list.clear()
        n = 0
        for ci, course in enumerate(self.backend.data.get("courses") or []):
            if want and str(course.get("crsCreCd") or "") != want:
                continue
            title = course.get("courseTitle") or ""
            for ai, a in enumerate(course.get("assignments") or []):
                due = bool(a.get("dueNow"))
                status = a.get("status") or ""
                if mode == 1 and not due:
                    continue
                if mode == 2 and status not in ("미제출",) and "진행중" not in status:
                    continue
                n += 1
                submitted = "제출" in status and "미제출" not in status
                self.asg_list.add_row(
                    JobRow(
                        a.get("title") or "",
                        f"{title}  ·  {a.get('period') or ''}",
                        badge="완료" if submitted else (status or "과제"),
                        badge_kind=_badge_kind_status(status),
                        hot="지금" if due else "",
                        payload={"ci": ci, "ai": ai},
                    )
                )
        if n == 0:
            self.asg_list.show_empty("assignment", "조건에 맞는 과제가 없습니다", "필터를 바꾸거나 다시 조회해 보세요.")
        else:
            self.asg_list.finish()

    def _fill_board_list(self, lst: JobList, key: str, icon: str, course_combo: QComboBox) -> None:
        """공지 또는 자료 카드를 채운다.

        Args:
            lst: 목록 위젯.
            key: ``notices`` 또는 ``materials``.
            icon: 빈 화면 아이콘 이름.
            course_combo: 과목 필터.
        """
        self._fill_course_combo(course_combo)
        want = self._course_filter_cd(course_combo)
        lst.clear()
        n = 0
        for ci, course in enumerate(self.backend.data.get("courses") or []):
            if want and str(course.get("crsCreCd") or "") != want:
                continue
            title = course.get("courseTitle") or ""
            for pi, post in enumerate(course.get(key) or []):
                n += 1
                att = "첨부" if post.get("hasAttachment") else ""
                lst.add_row(
                    JobRow(
                        post.get("title") or "",
                        f"{title}  ·  {post.get('date') or ''}",
                        badge=att,
                        badge_kind="info",
                        payload={"ci": ci, "pi": pi, "section": key},
                    )
                )
        if n == 0:
            lst.show_empty(icon, "조건에 맞는 글이 없습니다", "조회를 눌러 과목별 목록을 모으세요.")
        else:
            lst.finish()

    def _clear_file_row(self, layout: QHBoxLayout) -> None:
        """첨부 버튼을 비운다."""
        while layout.count():
            item = layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()

    def _put_attachments(self, layout: QHBoxLayout, atts: list[dict[str, Any]]) -> None:
        """첨부 받기 버튼."""
        self._clear_file_row(layout)
        if not atts:
            lab = QLabel("첨부 없음")
            lab.setObjectName("hint")
            layout.addWidget(lab)
            layout.addStretch(1)
            return
        for att in atts:
            btn = self._ghost(str(att.get("title") or "첨부파일"), lambda _=False, a=att: self.save_attachment(a))
            layout.addWidget(btn)
        layout.addStretch(1)

    def refresh_notices(self) -> None:
        """공지 조회."""

        def work() -> dict[str, Any]:
            """전 과목 공지."""
            return self.backend.fetch_notices()

        self._busy("공지를 불러오는 중", work, lambda _: self._fill_notices())

    def _fill_notices(self) -> None:
        """공지 카드."""
        self._fill_board_list(self.notice_list, "notices", "notice", self.notice_course)

    def refresh_materials(self) -> None:
        """강의자료 조회."""

        def work() -> dict[str, Any]:
            """전 과목 자료."""
            return self.backend.fetch_materials()

        self._busy("자료를 불러오는 중", work, lambda _: self._fill_materials())

    def _fill_materials(self) -> None:
        """자료 카드."""
        self._fill_board_list(self.mat_list, "materials", "material", self.mat_course)

    def _body_edit(self, placeholder: str, readonly: bool = True) -> QTextEdit:
        """목록 펼침 칸의 본문."""
        ed = QTextEdit()
        ed.setObjectName("jobBody")
        ed.setReadOnly(readonly)
        ed.setPlaceholderText(placeholder)
        ed.setMinimumHeight(88)
        ed.setMaximumHeight(180)
        return ed

    def _field_lab(self, text: str) -> QLabel:
        """펼침 칸 구역 제목."""
        lab = QLabel(text)
        lab.setObjectName("field")
        return lab

    def _make_asg_expand(self) -> QWidget:
        """웹 asg-expand. 본문·첨부·제출."""
        w = QWidget()
        w.setObjectName("jobExpand")
        lay = QVBoxLayout(w)
        lay.setContentsMargins(24, 4, 24, 22)
        lay.setSpacing(8)
        lay.addWidget(self._field_lab("상세 내용"))
        self.asg_detail = self._body_edit("상세 내용")
        lay.addWidget(self.asg_detail)
        lay.addWidget(self._field_lab("과제 첨부"))
        files_host = QWidget()
        self.asg_files = QHBoxLayout(files_host)
        self.asg_files.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(files_host)
        lay.addWidget(self._field_lab("제출 내용"))
        self.asg_submit_text = QTextEdit()
        self.asg_submit_text.setPlaceholderText("제출할 내용을 적으세요")
        self.asg_submit_text.setFixedHeight(100)
        lay.addWidget(self.asg_submit_text)
        lay.addWidget(self._field_lab("제출 파일"))
        file_row = QHBoxLayout()
        file_row.setSpacing(8)
        self.asg_file_lab = QLabel(Path(self._asg_file).name if self._asg_file else "파일 없음")
        self.asg_file_lab.setObjectName("hint")
        self.asg_file_lab.setWordWrap(True)
        file_row.addWidget(self._primary("제출하기", self.submit_assignment))
        file_row.addWidget(self._ghost("파일 선택", self.pick_assignment_file))
        file_row.addWidget(self._ghost("파일 지우기", self.clear_assignment_file))
        file_row.addWidget(self.asg_file_lab, 1)
        lay.addLayout(file_row)
        return w

    def _make_board_expand(self, kind: str) -> QWidget:
        """웹 job-expand. 본문과 첨부 버튼."""
        w = QWidget()
        w.setObjectName("jobExpand")
        lay = QVBoxLayout(w)
        lay.setContentsMargins(24, 4, 24, 22)
        lay.setSpacing(8)
        lay.addWidget(self._field_lab("본문"))
        body = self._body_edit("본문")
        lay.addWidget(body)
        lay.addWidget(self._field_lab("첨부파일"))
        files_host = QWidget()
        files = QHBoxLayout(files_host)
        files.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(files_host)
        if kind == "notice":
            self.notice_detail = body
            self.notice_files = files
        else:
            self.mat_detail = body
            self.mat_files = files
        return w

    def _on_asg_clicked(self, row: JobRow | None) -> None:
        """과제 행을 누르면 아래에 상세를 펼친다."""
        if row is None or not isinstance(row.payload, dict):
            return
        try:
            ci = int(row.payload["ci"])
            ai = int(row.payload["ai"])
        except (KeyError, TypeError, ValueError):
            self._alert("과제를 다시 조회한 뒤 골라 주세요.", True)
            return

        def work() -> dict[str, Any]:
            """과제 본문·첨부."""
            return self.backend.assignment_detail_full(ci, ai)

        def done(out: Any) -> None:
            """펼침 칸에 본문과 첨부를 넣는다."""
            if self.asg_list.selected() is not row or not isinstance(out, dict):
                return
            panel = self._make_asg_expand()
            if self.asg_detail is not None:
                self.asg_detail.setPlainText(str(out.get("text") or ""))
            if self.asg_files is not None:
                self._put_attachments(self.asg_files, list(out.get("attachments") or []))
            self.asg_list.set_expand(panel)

        self._busy("과제 상세를 불러오는 중", work, done)

    def _on_notice_clicked(self, row: JobRow | None) -> None:
        """공지 행을 누르면 본문을 펼친다."""
        self._open_board_expand(row, self.notice_list, "notices", "공지")

    def _on_mat_clicked(self, row: JobRow | None) -> None:
        """자료 행을 누르면 본문을 펼친다."""
        self._open_board_expand(row, self.mat_list, "materials", "자료")

    def _open_board_expand(self, row: JobRow | None, lst: JobList, key: str, label: str) -> None:
        """공지·자료 상세를 행 아래에 펼친다."""
        if row is None or not isinstance(row.payload, dict):
            return
        try:
            ci = int(row.payload["ci"])
            pi = int(row.payload["pi"])
        except (KeyError, TypeError, ValueError):
            self._alert(f"{label}를 다시 조회한 뒤 골라 주세요.", True)
            return

        def work() -> dict[str, Any]:
            """본문·첨부."""
            return self.backend.board_detail(ci, pi, key)

        def done(out: Any) -> None:
            """펼침 칸."""
            if lst.selected() is not row or not isinstance(out, dict):
                return
            kind = "notice" if key == "notices" else "mat"
            panel = self._make_board_expand(kind)
            editor = self.notice_detail if kind == "notice" else self.mat_detail
            files = self.notice_files if kind == "notice" else self.mat_files
            if editor is not None:
                editor.setPlainText(str(out.get("text") or ""))
            if files is not None:
                self._put_attachments(files, list(out.get("attachments") or []))
            lst.set_expand(panel)

        self._busy(f"{label} 상세를 불러오는 중", work, done)

    def save_attachment(self, att: dict[str, Any]) -> None:
        """첨부를 고른 경로에 저장한다."""
        name = str(att.get("title") or "첨부파일")
        url = str(att.get("url") or "")
        if not url and att.get("token"):
            url = f"https://ecampus.seowon.ac.kr/file/download/{att.get('token')}"
        path, _ = QFileDialog.getSaveFileName(self, "첨부 저장", name)
        if not path:
            return

        def work() -> str:
            """다운로드."""
            return self.backend.download_attachment(url, path)

        self._busy("파일을 받는 중", work, lambda p: self._alert(f"저장했습니다.  {p}"))

    def refresh_timetable(self) -> None:
        """시간표 조회."""

        def work() -> dict[str, Any]:
            """수강 확정 목록."""
            return self.backend.fetch_timetable()

        self._busy("시간표를 불러오는 중", work, lambda _: self._fill_timetable())

    def _fill_timetable(self) -> None:
        """격자와 과목 목록."""
        data = self.backend.data.get("timetable") or {}
        n = int(data.get("courseCount") or 0)
        cred = data.get("totalCredits") or 0
        conf = int(data.get("conflictCount") or 0)
        extra = f" · 충돌 {conf}건" if conf else ""
        self.tt_summary.setText(f"{data.get('title') or '수강 시간표'}  ·  {n}과목 · {cred}학점{extra}")
        self.tt_board.set_data(data)
        self.tt_courses.clear()
        for sub in data.get("subjects") or []:
            self.tt_courses.add_row(
                JobRow(
                    str(sub.get("subjtNm") or ""),
                    f"{sub.get('kind') or ''}  ·  {sub.get('chrgInstrEmpnm') or ''}  ·  {sub.get('timtbNm') or ''}",
                    badge=f"{sub.get('cmpsjCdt') or '?'}학점",
                    badge_kind="info",
                )
            )
        if n:
            self.tt_courses.finish()
        else:
            self.tt_courses.show_empty("timetable", "수강 과목이 없습니다", "조회를 누르면 이번 학기 시간표를 그립니다.")

    def save_timetable_image(self) -> None:
        """시간표 SVG 를 파일로 저장한다."""
        data = self.backend.data.get("timetable") or {}
        svg = str(data.get("svg") or "")
        if not svg:
            self._alert("먼저 시간표를 조회하세요.", True)
            return
        path, _ = QFileDialog.getSaveFileName(self, "시간표 저장", "수강_시간표.svg", "SVG (*.svg)")
        if not path:
            return
        Path(path).write_text(svg, encoding="utf-8")
        self._alert(f"저장했습니다.  {path}")

    def pick_assignment_file(self) -> None:
        """제출할 로컬 파일을 고른다."""
        path, _ = QFileDialog.getOpenFileName(self, "과제 파일 선택", "", "모든 파일 (*.*)")
        if not path:
            return
        self._asg_file = path
        if self.asg_file_lab is not None:
            self.asg_file_lab.setText(Path(path).name)

    def clear_assignment_file(self) -> None:
        """고른 파일을 비운다."""
        self._asg_file = ""
        if self.asg_file_lab is not None:
            self.asg_file_lab.setText("파일 없음")

    def submit_assignment(self) -> None:
        """고른 과제를 글·파일로 제출한다.

        펼침 칸의 본문과 파일 선택 값을 백엔드로 보낸다.
        """
        row = self.asg_list.selected()
        if row is None or not isinstance(row.payload, dict):
            self._alert("과제를 먼저 고르세요.", True)
            return
        try:
            ci = int(row.payload["ci"])
            ai = int(row.payload["ai"])
        except (KeyError, TypeError, ValueError):
            self._alert("과제를 다시 조회한 뒤 골라 주세요.", True)
            return
        text = self.asg_submit_text.toPlainText() if self.asg_submit_text is not None else ""
        file_path = self._asg_file or None
        if not text.strip() and not file_path:
            self._alert("제출할 내용이나 파일을 넣어 주세요.", True)
            return
        title = row.title_lab.text()
        box = QMessageBox(self)
        box.setWindowTitle("과제 제출")
        box.setText(f"「{title}」을(를) e-campus에 제출할까요?")
        box.setInformativeText("제출 뒤에는 e-campus에서 상태를 한 번 더 확인하세요.")
        box.setStandardButtons(QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        yes = box.button(QMessageBox.StandardButton.Yes)
        no = box.button(QMessageBox.StandardButton.No)
        if yes is not None:
            yes.setText("제출")
        if no is not None:
            no.setText("취소")
        if box.exec() != QMessageBox.StandardButton.Yes:
            return

        def work() -> str:
            """선택한 과제를 제출한다."""
            return self.backend.submit_assignment(ci, ai, text, file_path)

        def done(msg: Any) -> None:
            """목록과 홈 숫자를 다시 그린다."""
            self._alert(str(msg))
            self.clear_assignment_file()
            self._fill_assignments()
            self._fill_todo()
            self._fill_home()

        self._busy("과제를 제출하는 중", work, done)

    def refresh_lessons(self) -> None:
        """이러닝 조회."""
        self._reload(self._fill_lessons, "이러닝을 불러오는 중")

    def _fill_lessons(self) -> None:
        """차시 행을 카드에 넣는다."""
        only_watch = self.les_filter.currentIndex() == 1
        self.les_list.clear()
        n = 0
        for ci, course in enumerate(self.backend.data.get("courses") or []):
            title = course.get("courseTitle") or ""
            for li, les in enumerate(course.get("elearning") or []):
                if only_watch and not les.get("needsWatch"):
                    continue
                n += 1
                att = les.get("attendanceStatus") or ""
                pct = les.get("progressPercent")
                self.les_list.add_row(
                    JobRow(
                        les.get("title") or "",
                        f"{title}  ·  {les.get('week') or ''}  ·  {les.get('period') or ''}",
                        badge=att or "차시",
                        badge_kind=_badge_kind_att(att),
                        hot="-" if pct is None else f"{pct}%",
                        action="학습률",
                        payload={"ci": ci, "li": li, "row": None},
                    )
                )
        if n == 0:
            self.les_list.show_empty("lesson", "조건에 맞는 차시가 없습니다", "필터를 바꾸거나 다시 조회해 보세요.")
        else:
            self.les_list.finish()

    def show_progress(self) -> None:
        """고른 차시 학습률."""
        row = self.les_list.selected()
        if row is None or not isinstance(row.payload, dict):
            self._alert("차시를 먼저 고르세요.", True)
            return
        try:
            ci = int(row.payload["ci"])
            li = int(row.payload["li"])
        except (KeyError, TypeError, ValueError):
            self._alert("차시를 다시 조회한 뒤 골라 주세요.", True)
            return

        def work() -> int:
            """학습률만 조회한다."""
            return self.backend.lesson_progress(ci, li)

        def done(pct: Any) -> None:
            """진행 % 를 행에 쓰고 토스트를 띄운다."""
            row.set_hot(f"{pct}%")
            self._alert(f"학습률 {pct}%")

        self._busy("학습률을 조회하는 중", work, done)

    def refresh_summary(self) -> None:
        """현황 한 표."""
        self._reload(self._fill_summary, "현황을 모으는 중")

    def _clear_sum_grid(self) -> None:
        """과목 카드를 비운다."""
        while self.sum_grid.count():
            item = self.sum_grid.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()

    def _fill_summary(self) -> None:
        """과목별 미제출·미완료 수를 채운다."""
        summary = list(self.backend.data.get("summary") or [])
        if not summary:
            for course in self.backend.data.get("courses") or []:
                due = sum(1 for a in course.get("assignments") or [] if a.get("dueNow"))
                pend = sum(1 for l in course.get("elearning") or [] if l.get("needsWatch"))
                summary.append({"courseTitle": course.get("courseTitle"), "dueAssignments": due, "pendingLessons": pend})
        due_total = sum(int(s.get("dueAssignments") or 0) for s in summary)
        pend_total = sum(int(s.get("pendingLessons") or 0) for s in summary)
        self.stat_asg.set_value(due_total)
        self.stat_les.set_value(pend_total)
        self.stat_crs.set_value(len(summary))

        self._clear_sum_grid()
        if not summary:
            empty = EmptyState("status", "현황이 없습니다", "조회를 누르면 과목별 숫자를 모읍니다.", "조회")
            empty.action_clicked.connect(self.refresh_summary)
            self.sum_grid.addWidget(empty, 0, 0)
            return
        for i, s in enumerate(summary):
            due = int(s.get("dueAssignments") or 0)
            pend = int(s.get("pendingLessons") or 0)
            variant = "blue" if due or pend else "surface"
            card = FeatureCard(
                "status",
                str(s.get("courseTitle") or ""),
                f"미제출 과제 {due}  ·  미완료 이러닝 {pend}",
                "과제 보기 ➔" if due else "이러닝 보기 ➔" if pend else "자세히 ➔",
                variant,
            )
            card.clicked.connect(lambda d=due, p=pend: self._goto(PAGE_ASG if d else PAGE_LES if p else PAGE_ASG))
            self.sum_grid.addWidget(card, i // 2, i % 2)

    def save_result(self) -> None:
        """조회 결과를 result.json 에 저장한다."""
        def work() -> str:
            """없으면 조회한 뒤 저장 경로를 돌린다."""
            if not self.backend.data.get("courses"):
                self.backend.fetch()
            return str(self.backend.save_result_copy())

        self._busy("저장하는 중", work, lambda path: self._alert(f"저장했습니다.  {path}"))

    def load_result(self) -> None:
        """저장해 둔 조회 결과를 다시 그린다."""
        def work() -> dict[str, Any]:
            """result.json 을 읽는다."""
            return self.backend.load_saved()

        def done(_: Any) -> None:
            """과제·이러닝·현황·할 일을 다시 그린다."""
            self._fill_summary()
            self._fill_assignments()
            self._fill_lessons()
            self._fill_todo()
            self._fill_notices()
            self._fill_materials()
            self._fill_timetable()
            self._alert("저장된 조회 결과를 그렸습니다.")

        self._busy("불러오는 중", work, done)
