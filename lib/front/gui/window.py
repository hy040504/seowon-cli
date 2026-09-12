"""스마트홈 태블릿 톤 PyQt 메인 창. 조회는 백그라운드에서 돌린다."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

from PyQt6.QtCore import QEvent, QObject, QSettings, Qt, QUrl
from PyQt6.QtGui import QCloseEvent, QColor, QDesktopServices, QShowEvent
from PyQt6.QtWidgets import (
    QFrame,
    QGraphicsDropShadowEffect,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
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
    RoundIconButton,
    Sidebar,
    StatBox,
    SuccessMark,
    ToastBanner,
    TossCheck,
    TossSwitch,
    FnThread,
)

from lib.seowon import VERSION

# 흰 선 아이콘 메뉴. 조회 전용이라 공지·자료·시간표·성적은 없다.
NAV: list[tuple[str, str]] = [
    ("login", "로그인"),
    ("todo", "지금 할 것"),
    ("assignment", "과제"),
    ("lesson", "이러닝"),
    ("status", "현황"),
    ("settings", "설정"),
    ("info", "정보"),
]


def _badge_kind_status(status: str) -> str:
    """과제 제출 상태를 알약 색으로 바꾼다."""
    if "미제출" in status:
        return "miss"
    if "진행" in status:
        return "watch"
    if "제출" in status or "완료" in status:
        return "done"
    return "info"


def _badge_kind_att(att: str) -> str:
    """이러닝 출결 문구를 알약 색으로 바꾼다."""
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
        self.page_les = self._build_lessons()
        self.page_sum = self._build_summary()
        self.page_cfg = self._build_settings()
        self.page_info = self._build_info()
        for p in (
            self.page_login,
            self.page_todo,
            self.page_asg,
            self.page_les,
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
        for lst in (self.todo_list, self.asg_list, self.les_list):
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
        for i, w in enumerate(widgets):
            bar.addWidget(w, 1 if i == 0 and isinstance(w, QComboBox) else 0)
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
        notice = QLabel("공식 SDK가 아닙니다. 조회만 하며 과제 제출·자동 시청은 하지 않습니다.")
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
        v.setContentsMargins(28, 18, 28, 24)
        v.setSpacing(16)

        top = QHBoxLayout()
        self.search_edit = QLineEdit()
        self.search_edit.setPlaceholderText("검색")
        self.search_edit.setMaximumWidth(280)
        self.home_date = QLabel(datetime.now().strftime("%Y. %m. %d"))
        self.home_date.setObjectName("topDate")
        self.home_who_chip = QLabel("Hello")
        self.home_who_chip.setObjectName("chipName")
        top.addWidget(self.search_edit)
        top.addStretch(1)
        top.addWidget(self.home_date)
        top.addSpacing(16)
        top.addWidget(self.home_who_chip)
        v.addLayout(top)

        hello_row = QHBoxLayout()
        self.home_title = QLabel("Hello!")
        self.home_title.setObjectName("heroTitle")
        self.home_sub = QLabel("로그인하면 과제와 이러닝을 한곳에서 봅니다.")
        self.home_sub.setObjectName("heroSub")
        greet = QVBoxLayout()
        greet.setSpacing(4)
        greet.addWidget(self.home_title)
        greet.addWidget(self.home_sub)
        hello_row.addLayout(greet, 1)
        for name, idx in (("todo", 1), ("assignment", 2), ("lesson", 3)):
            b = RoundIconButton(name)
            b.clicked.connect(lambda _=False, i=idx: self._goto(i))
            hello_row.addWidget(b, 0, Qt.AlignmentFlag.AlignVCenter)
        v.addLayout(hello_row)

        body = QHBoxLayout()
        body.setSpacing(16)
        left = QVBoxLayout()
        left.setSpacing(14)

        stats = QHBoxLayout()
        stats.setSpacing(10)
        self.home_stat_asg = StatBox("미제출 과제")
        self.home_stat_les = StatBox("미완료 이러닝")
        self.home_stat_crs = StatBox("과목")
        stats.addWidget(self.home_stat_asg)
        stats.addWidget(self.home_stat_les)
        stats.addWidget(self.home_stat_crs)
        left.addLayout(stats)

        tiles = QHBoxLayout()
        tiles.setSpacing(12)
        for icon, title, var, idx in (
            ("todo", "지금 할 것", "blue", 1),
            ("assignment", "과제", "pink", 2),
            ("lesson", "이러닝", "blue", 3),
            ("status", "현황", "pink", 4),
        ):
            tile = DashTile(icon, title, var)
            tile.clicked.connect(lambda i=idx: self._goto(i))
            tiles.addWidget(tile)
        left.addLayout(tiles)

        bottom = QHBoxLayout()
        bottom.setSpacing(12)
        gauge_card = QFrame()
        gauge_card.setObjectName("featBlue")
        gauge_card.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        gl = QHBoxLayout(gauge_card)
        gl.setContentsMargins(16, 16, 16, 16)
        self.home_gauge = InquiryGauge()
        self.home_gauge.clicked.connect(self._on_home_scan)
        gl.addWidget(self.home_gauge)
        info_card = self._card()
        il = QVBoxLayout(info_card)
        il.setContentsMargins(20, 18, 20, 18)
        it = QLabel("조회 전용")
        it.setObjectName("panelTitle")
        ib = QLabel("과제 제출과 자동 시청은 하지 않습니다. 원을 누르면 지금 할 일을 불러옵니다.")
        ib.setObjectName("caption")
        ib.setWordWrap(True)
        il.addWidget(it)
        il.addWidget(ib)
        il.addStretch(1)
        bottom.addWidget(gauge_card, 1)
        bottom.addWidget(info_card, 1)
        left.addLayout(bottom)
        left.addStretch(1)

        right = QVBoxLayout()
        right.setSpacing(14)
        shortcuts = QFrame()
        shortcuts.setObjectName("sidePanel")
        shortcuts.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        sl = QVBoxLayout(shortcuts)
        sl.setContentsMargins(20, 18, 20, 18)
        sl.setSpacing(10)
        st = QLabel("Shortcuts")
        st.setObjectName("panelTitle")
        sl.addWidget(st)
        for icon, name, idx in (("assignment", "과제", 2), ("lesson", "이러닝", 3), ("status", "현황", 4), ("settings", "설정", 5)):
            row = QHBoxLayout()
            ic = LineIcon(icon, size=22, color=CURRENT.blue, stroke=1.8)
            nm = QLabel(name)
            nm.setObjectName("shortName")
            go = QPushButton("열기")
            go.setObjectName("primary")
            go.setCursor(Qt.CursorShape.PointingHandCursor)
            go.setFixedHeight(30)
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
        ml.addWidget(mt)
        ml.addSpacing(8)
        ml.addWidget(self.home_member_av, 0, Qt.AlignmentFlag.AlignHCenter)
        ml.addWidget(self.home_member_name)
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
        self._goto(1)
        self.refresh_todo()

    def _fill_home(self) -> None:
        """인사와 숫자, 프로필을 채운다."""
        who = self.backend.student_name or "학생"
        dept = self.backend.dept_name or "서원대학교"
        tag = "데모 모드" if self.backend.demo else dept
        self.home_title.setText(f"Hello {who}!")
        self.home_sub.setText(f"{tag} · 과제와 이러닝을 한곳에서 조회합니다.")
        self.home_who_chip.setText(f"Hello  {who}")
        self.home_member_av.setText(who[0])
        self.home_member_name.setText(who)
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
        """과제 목록·상세."""
        inner, v = self._page("과제", "기간과 제출 상태를 한 번에 봅니다. 제출은 하지 않습니다.")
        self.asg_filter = QComboBox()
        self.asg_filter.addItems(["전체 과제", "지금 할 수 있는 과제", "미제출 · 진행중"])
        v.addLayout(self._toolbar(self.asg_filter, self._primary("조회", self.refresh_assignments), self._ghost("상세 보기", self.show_assignment_detail)))

        self.asg_list = JobList()
        self.asg_list.show_empty("assignment", "아직 과제가 없습니다", "조회를 누르면 과목별 과제를 카드로 보여 줍니다.", "조회")
        self.asg_list.row_acted.connect(lambda row: self.refresh_assignments() if row is None else self.show_assignment_detail())
        self.asg_list.row_clicked.connect(lambda _: None)
        v.addWidget(self.asg_list, 1)

        detail_card = self._card()
        dl = QVBoxLayout(detail_card)
        dl.setContentsMargins(16, 12, 16, 12)
        self.asg_detail = QTextEdit()
        self.asg_detail.setReadOnly(True)
        self.asg_detail.setPlaceholderText("과제를 고른 뒤 상세 보기")
        self.asg_detail.setFixedHeight(150)
        dl.addWidget(self.asg_detail)
        v.addWidget(detail_card)
        return self._scroll_page(inner)

    def _build_lessons(self) -> QWidget:
        """이러닝 차시 목록."""
        inner, v = self._page("이러닝", "차시 출결과 들어야 할 강의를 모읍니다. 학습률은 조회만 합니다.")
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
        """조회 전용 안내와 관련 저장소."""
        inner, v = self._page("프로그램 정보", f"seowon-cli  v{VERSION}  ·  조회 전용 Python 클라이언트")

        notice = QFrame()
        notice.setObjectName("infoNotice")
        notice.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        nl = QHBoxLayout(notice)
        nl.setContentsMargins(14, 10, 14, 10)
        nlab = QLabel("공식 SDK가 아닙니다. 과제 제출, 이러닝 자동 시청, 출석 처리는 넣지 않습니다.")
        nlab.setObjectName("infoNoticeText")
        nlab.setWordWrap(True)
        nl.addWidget(nlab)
        v.addWidget(notice)

        head = self._card()
        hl = QVBoxLayout(head)
        hl.setContentsMargins(24, 22, 24, 22)
        ht = QLabel("서원대 e-campus 몰아보기")
        ht.setObjectName("hello")
        hd = QLabel("로그인 한 번으로 전 과목의 과제와 이러닝을 모아 지금 할 일만 보여 줍니다. 화면은 스마트홈 태블릿처럼 파랑과 핑크 타일입니다.")
        hd.setObjectName("caption")
        hd.setWordWrap(True)
        pills = QHBoxLayout()
        for text, accent in (("Python 3.10+", True), ("PyQt6", False), ("조회 전용", True), ("JSON 저장", False), ("MIT", False)):
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
            ("assignment", "과제 조회", "기간·제출 상태를 카드로 모읍니다.", "과제 ➔", "blue", 2),
            ("lesson", "이러닝 조회", "출결과 들을 차시, 학습률(%)만 봅니다.", "이러닝 ➔", "surface", 3),
            ("todo", "지금 할 것", "기간 안 미제출과 미완료만 골라 줍니다.", "할 일 ➔", "dark", 1),
            ("status", "현황 한 표", "과목별 미제출·미완료 숫자를 모읍니다.", "현황 ➔", "surface", 4),
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
        bd = QLabel("과제 제출 · 파일 업로드 · 이러닝 자동 시청 · 출석 처리 · 수강신청 · 다른 학생 계정 조회")
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
        extra = self.backend.dept_name or (self.backend.student_id or "")
        tag = "데모" if self.backend.demo else extra
        self.sidebar.set_profile(who, tag, who[0])
        self.sidebar.set_logged_in(True)

    def _alert(self, msg: str, err: bool = False) -> None:
        """오류·안내는 웹처럼 토스트로 띄운다."""
        self.toast.show_msg(msg, err)

    def _busy(self, message: str, fn: Callable[[], Any], done: Callable[[Any], None]) -> None:
        """스피너를 띄운 채 fn 을 백그라운드에서 돌린다."""
        if self._th is not None and self._th.isRunning():
            return
        self.overlay.setGeometry(self.centralWidget().rect())
        self.overlay.show_msg(message)
        th = FnThread(fn)
        self._th = th
        th.ok.connect(lambda result, cb=done: self._busy_ok(result, cb))
        th.err.connect(self._busy_err)
        th.finished.connect(self._on_thread_finished)
        th.start()

    def _on_thread_finished(self) -> None:
        """끝난 스레드 손잡이를 비운다."""
        th = self._th
        self._th = None
        if th is not None:
            th.deleteLater()

    def _busy_ok(self, result: Any, done: Callable[[Any], None]) -> None:
        """작업이 끝나면 스피너를 내리고 화면을 갱신한다."""
        self.overlay.hide_msg()
        try:
            done(result)
        except Exception as e:  # noqa: BLE001
            self._alert(str(e), True)

    def _busy_err(self, msg: str) -> None:
        """작업이 실패하면 스피너를 내리고 이유를 보여 준다."""
        self.overlay.hide_msg()
        self._alert(msg, True)

    def _ensure_data(self, then: Callable[[], None], message: str = "불러오는 중") -> None:
        """아직 조회 결과가 없으면 먼저 fetch 한 뒤 then 을 부른다."""
        if self.backend.data.get("courses"):
            then()
            return

        def work() -> dict[str, Any]:
            """과제·이러닝을 한 번에 가져온다."""
            return self.backend.fetch()

        self._busy(message, work, lambda _: then())

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
        self.backend.dept_name = ""
        self._apply_profile_chip()
        self.auth_stack.setCurrentIndex(0)
        self._show_login_form()
        self._goto(0)

    def refresh_todo(self) -> None:
        """지금 할 일 조회."""
        self._ensure_data(self._fill_todo, "지금 할 일을 불러오는 중")

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
            self._goto(2)
            self._ensure_data(self._fill_assignments)
            self._busy(
                "과제 상세를 불러오는 중",
                lambda: self.backend.assignment_detail(int(payload["ci"]), int(payload["ai"])),
                lambda text: self.asg_detail.setPlainText(text),
            )
        elif payload.get("kind") == "les":
            self._goto(3)

            def work() -> int:
                """고른 차시 학습률."""
                return self.backend.lesson_progress(int(payload["ci"]), int(payload["li"]))

            def done(pct: Any) -> None:
                """학습률을 행에 반영한다."""
                row.set_hot(f"{pct}%")
                self._alert(f"학습률 {pct}%  (자동 시청 없음)")

            self._busy("학습률을 조회하는 중", work, done)

    def refresh_assignments(self) -> None:
        """과제 조회."""
        self._ensure_data(self._fill_assignments, "과제를 불러오는 중")

    def _fill_assignments(self) -> None:
        """필터에 맞는 과제 행을 카드에 넣는다."""
        mode = self.asg_filter.currentIndex()
        self.asg_list.clear()
        n = 0
        for ci, course in enumerate(self.backend.data.get("courses") or []):
            title = course.get("courseTitle") or ""
            for ai, a in enumerate(course.get("assignments") or []):
                due = bool(a.get("dueNow"))
                status = a.get("status") or ""
                if mode == 1 and not due:
                    continue
                if mode == 2 and status not in ("미제출",) and "진행중" not in status:
                    continue
                n += 1
                self.asg_list.add_row(
                    JobRow(
                        a.get("title") or "",
                        f"{title}  ·  {a.get('period') or ''}",
                        badge=status or "과제",
                        badge_kind=_badge_kind_status(status),
                        hot="지금" if due else "",
                        action="상세",
                        payload={"ci": ci, "ai": ai},
                    )
                )
        if n == 0:
            self.asg_list.show_empty("assignment", "조건에 맞는 과제가 없습니다", "필터를 바꾸거나 다시 조회해 보세요.")
        else:
            self.asg_list.finish()

    def show_assignment_detail(self) -> None:
        """고른 과제 상세."""
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

        def work() -> str:
            """과제 본문을 가져온다."""
            return self.backend.assignment_detail(ci, ai)

        self._busy("과제 상세를 불러오는 중", work, lambda text: self.asg_detail.setPlainText(text))

    def refresh_lessons(self) -> None:
        """이러닝 조회."""
        self._ensure_data(self._fill_lessons, "이러닝을 불러오는 중")

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
            """학습률만 조회한다. 시청 기록 없음."""
            return self.backend.lesson_progress(ci, li)

        def done(pct: Any) -> None:
            """진행 % 를 행에 쓰고 토스트를 띄운다."""
            row.set_hot(f"{pct}%")
            self._alert(f"학습률 {pct}%  (자동 시청 없음)")

        self._busy("학습률을 조회하는 중", work, done)

    def refresh_summary(self) -> None:
        """현황 한 표."""
        self._ensure_data(self._fill_summary, "현황을 모으는 중")

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
            card.clicked.connect(lambda d=due, p=pend: self._goto(2 if d else 3 if p else 2))
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
            self._alert("저장된 조회 결과를 그렸습니다.")

        self._busy("불러오는 중", work, done)
