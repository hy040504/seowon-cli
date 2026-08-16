"""토스뱅크 톤의 PyQt 메인 창. 조회는 백그라운드에서 돌려 화면이 멈추지 않게 한다."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from PyQt6.QtCore import QEvent, QObject, QSettings, Qt
from PyQt6.QtGui import QColor
from PyQt6.QtWidgets import (
    QAbstractItemView,
    QButtonGroup,
    QComboBox,
    QFrame,
    QGraphicsDropShadowEffect,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from backend import Backend, ensure_login_file, load_login_file, login_file_complete
from style import CURRENT, DARK, LIGHT, Theme, qss, set_current
from widgets import FnThread, LoadingOverlay, SuccessMark, TossCheck, TossSwitch


NAV = ["로그인", "과제", "이러닝", "현황", "설정"]


class MainWindow(QMainWindow):
    """왼쪽 내비 + 오른쪽 페이지. 조회는 백그라운드 스레드에서 돌린다."""

    def __init__(self) -> None:
        super().__init__()
        self.backend = Backend()                    # RPC 조회
        self._th: FnThread | None = None            # 지금 돌아가는 작업
        self._cards: list[QFrame] = []              # 그림자 다시 칠할 카드
        self.setWindowTitle("e-campus")
        self.resize(1120, 740)
        ensure_login_file()

        root = QWidget()
        self.setCentralWidget(root)
        split = QHBoxLayout(root)
        split.setContentsMargins(0, 0, 0, 0)
        split.setSpacing(0)

        split.addWidget(self._build_sidebar())
        self.stack = QStackedWidget()
        self.stack.setObjectName("canvas")
        self.page_login = self._build_login()
        self.page_asg = self._build_assignments()
        self.page_les = self._build_lessons()
        self.page_sum = self._build_summary()
        self.page_cfg = self._build_settings()
        for p in (self.page_login, self.page_asg, self.page_les, self.page_sum, self.page_cfg):
            self.stack.addWidget(p)
        split.addWidget(self.stack, 1)

        self.overlay = LoadingOverlay(root)
        root.installEventFilter(self)
        self._fill_login_from_file()
        self._apply_profile_chip()
        settings = QSettings("seowon-cli", "e-campus")
        dark = bool(settings.value("darkMode", False, type=bool))  # 지난 테마
        self.theme_switch.blockSignals(True)
        self.theme_switch.setChecked(dark)
        self.theme_switch.blockSignals(False)
        self.apply_theme(DARK if dark else LIGHT)

    def eventFilter(self, obj: QObject, event: QEvent) -> bool:
        """창 크기가 바뀌면 로딩 막을 다시 맞춘다."""
        if obj is self.centralWidget() and event.type() == QEvent.Type.Resize:
            self.overlay.setGeometry(self.centralWidget().rect())
        return super().eventFilter(obj, event)

    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        if self.centralWidget() is not None:
            self.overlay.setGeometry(self.centralWidget().rect())

    def closeEvent(self, event) -> None:  # noqa: N802
        """닫을 때 돌아가는 RPC 가 있으면 잠시 기다린다."""
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

    def apply_theme(self, theme: Theme) -> None:
        """라이트/다크를 창 전체에 입히고 설정을 기억한다."""
        set_current(theme)
        self.setStyleSheet(qss(theme))
        self.overlay.apply_theme(theme)
        for card in self._cards:
            effect = card.graphicsEffect()
            if isinstance(effect, QGraphicsDropShadowEffect):
                effect.setColor(QColor(0, 0, 0, theme.shadow_a))
        self.theme_caption.setText(
            "어두운 바탕과 밝은 글자로 봅니다." if theme is DARK else "밝은 카드 화면으로 봅니다."
        )
        QSettings("seowon-cli", "e-campus").setValue("darkMode", theme is DARK)
        self.update()

    def _on_theme_toggled(self, dark: bool) -> None:
        """설정 스위치를 켤 때 다크, 끌 때 라이트."""
        self.apply_theme(DARK if dark else LIGHT)

    def _build_sidebar(self) -> QWidget:
        """왼쪽 메뉴와 아래 프로필 칩."""
        side = QWidget()
        side.setObjectName("sidebar")
        side.setFixedWidth(236)
        lay = QVBoxLayout(side)
        lay.setContentsMargins(18, 24, 18, 18)
        lay.setSpacing(6)

        brand = QLabel("e-campus")
        brand.setObjectName("brand")
        sub = QLabel("과제 · 이러닝 조회")
        sub.setObjectName("brandSub")
        lay.addWidget(brand)
        lay.addWidget(sub)
        lay.addSpacing(18)

        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)
        self.nav_btns: list[QPushButton] = []
        for i, name in enumerate(NAV):
            btn = QPushButton(name)
            btn.setObjectName("navBtn")
            btn.setCheckable(True)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _=False, idx=i: self.stack.setCurrentIndex(idx))
            self.nav_group.addButton(btn, i)
            self.nav_btns.append(btn)
            lay.addWidget(btn)
        self.nav_btns[0].setChecked(True)
        lay.addStretch(1)

        chip = QFrame()
        chip.setObjectName("card")
        chip.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        chip_l = QHBoxLayout(chip)
        chip_l.setContentsMargins(12, 10, 12, 10)
        chip_l.setSpacing(10)
        self.avatar = QLabel("?")
        self.avatar.setObjectName("avatar")
        self.avatar.setFixedSize(32, 32)
        self.avatar.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        who_box = QVBoxLayout()
        who_box.setContentsMargins(0, 0, 0, 0)
        who_box.setSpacing(0)
        self.chip_name = QLabel("로그인 전")
        self.chip_name.setObjectName("profileName")
        self.chip_sub = QLabel("세션 없음")
        self.chip_sub.setObjectName("caption")
        who_box.addWidget(self.chip_name)
        who_box.addWidget(self.chip_sub)
        chip_l.addWidget(self.avatar)
        chip_l.addLayout(who_box, 1)
        lay.addWidget(chip)
        return side

    def _page(self, title: str, caption: str) -> tuple[QWidget, QVBoxLayout]:
        """과제·이러닝·현황·설정 공통 머리글."""
        w = QWidget()
        w.setObjectName("canvas")
        v = QVBoxLayout(w)
        v.setContentsMargins(28, 28, 28, 24)
        v.setSpacing(16)
        head = QVBoxLayout()
        head.setSpacing(4)
        t = QLabel(title)
        t.setObjectName("pageTitle")
        c = QLabel(caption)
        c.setObjectName("caption")
        c.setWordWrap(True)
        head.addWidget(t)
        head.addWidget(c)
        v.addLayout(head)
        return w, v

    def _style_table(self, table: QTableWidget) -> None:
        """표는 줄 선택만 하고 칸은 고치지 못하게 한다."""
        table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        table.setAlternatingRowColors(True)
        table.setShowGrid(False)
        table.verticalHeader().setVisible(False)
        table.verticalHeader().setDefaultSectionSize(48)
        table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        hdr = table.horizontalHeader()
        hdr.setHighlightSections(False)
        hdr.setDefaultAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        hdr.setStretchLastSection(True)

    def _build_login(self) -> QWidget:
        """로그인 입력 카드와 성공 카드를 겹쳐 둔다."""
        w = QWidget()
        w.setObjectName("canvas")
        outer = QVBoxLayout(w)
        outer.setContentsMargins(28, 36, 28, 28)
        outer.addStretch(1)

        row = QHBoxLayout()
        row.addStretch(1)
        self.login_stack = QStackedWidget()
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

        b1 = QPushButton("로그인")
        b1.setObjectName("primary")
        b1.setCursor(Qt.CursorShape.PointingHandCursor)
        b1.clicked.connect(self.on_login)
        b2 = QPushButton("저장된 세션으로 접속")
        b2.setObjectName("ghost")
        b2.setCursor(Qt.CursorShape.PointingHandCursor)
        b2.clicked.connect(self.on_session)
        inner.addSpacing(8)
        inner.addWidget(b1)
        inner.addWidget(b2)

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
        sub = QLabel("로그인했어요")
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
        go = QPushButton("과제 보러 가기")
        go.setObjectName("primary")
        go.setCursor(Qt.CursorShape.PointingHandCursor)
        go.clicked.connect(lambda: self._goto(1))
        again = QPushButton("다시 로그인")
        again.setObjectName("ghost")
        again.setCursor(Qt.CursorShape.PointingHandCursor)
        again.clicked.connect(self._show_login_form)
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
        """왼쪽 메뉴와 페이지를 같이 옮긴다."""
        if 0 <= index < len(self.nav_btns):
            self.nav_btns[index].setChecked(True)
        self.stack.setCurrentIndex(index)

    def _show_login_form(self) -> None:
        """성공 카드에서 입력 카드로 돌아간다."""
        self.login_stack.setCurrentIndex(0)

    def _show_login_success(self, who: str, subtitle: str) -> None:
        """알림창 대신 성공 카드로 화면을 바꾼다."""
        self.ok_who.setText(who)
        self.ok_sub.setText(subtitle)
        self.login_stack.setCurrentIndex(1)
        self.ok_mark.play()

    def _build_assignments(self) -> QWidget:
        """과제 목록·상세."""
        w, v = self._page("과제", "기간과 제출 상태를 한 번에 봅니다.")
        bar = QHBoxLayout()
        self.asg_filter = QComboBox()
        self.asg_filter.addItems(["전체 과제", "지금 할 수 있는 과제", "미제출 · 진행중"])
        btn = QPushButton("조회")
        btn.setObjectName("primary")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        det = QPushButton("상세 보기")
        det.setObjectName("ghost")
        det.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(self.refresh_assignments)
        det.clicked.connect(self.show_assignment_detail)
        bar.addWidget(self.asg_filter, 1)
        bar.addWidget(btn)
        bar.addWidget(det)
        v.addLayout(bar)

        card = self._card()
        cl = QVBoxLayout(card)
        cl.setContentsMargins(8, 8, 8, 8)
        self.asg_table = QTableWidget(0, 5)
        self.asg_table.setHorizontalHeaderLabels(["과목", "제목", "기간", "상태", "지금"])
        self._style_table(self.asg_table)
        self.asg_table.setColumnHidden(5, True)
        cl.addWidget(self.asg_table)
        v.addWidget(card, 1)

        detail_card = self._card()
        dl = QVBoxLayout(detail_card)
        dl.setContentsMargins(16, 12, 16, 12)
        self.asg_detail = QTextEdit()
        self.asg_detail.setReadOnly(True)
        self.asg_detail.setPlaceholderText("과제를 고른 뒤 상세 보기")
        self.asg_detail.setFixedHeight(150)
        dl.addWidget(self.asg_detail)
        v.addWidget(detail_card)
        return w

    def _build_lessons(self) -> QWidget:
        """이러닝 차시 목록."""
        w, v = self._page("이러닝", "차시 출결과 들어야 할 강의를 모읍니다.")
        bar = QHBoxLayout()
        self.les_filter = QComboBox()
        self.les_filter.addItems(["차시 목록", "들을 차시"])
        btn = QPushButton("조회")
        btn.setObjectName("primary")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        pr = QPushButton("학습률(%)")
        pr.setObjectName("ghost")
        pr.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(self.refresh_lessons)
        pr.clicked.connect(self.show_progress)
        bar.addWidget(self.les_filter, 1)
        bar.addWidget(btn)
        bar.addWidget(pr)
        v.addLayout(bar)

        card = self._card()
        cl = QVBoxLayout(card)
        cl.setContentsMargins(8, 8, 8, 8)
        self.les_table = QTableWidget(0, 6)
        self.les_table.setHorizontalHeaderLabels(["과목", "주차", "제목", "기간", "출결", "진행"])
        self._style_table(self.les_table)
        cl.addWidget(self.les_table)
        v.addWidget(card, 1)
        return w

    def _build_summary(self) -> QWidget:
        """과목별 미제출·미완료 한 표."""
        w, v = self._page("현황", "과목별 미제출 과제와 미완료 이러닝을 한 표로 봅니다.")
        btn = QPushButton("과목별 모아 보기")
        btn.setObjectName("primary")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Fixed)
        btn.clicked.connect(self.refresh_summary)
        v.addWidget(btn, 0, Qt.AlignmentFlag.AlignLeft)

        card = self._card()
        cl = QVBoxLayout(card)
        cl.setContentsMargins(8, 8, 8, 8)
        self.sum_table = QTableWidget(0, 3)
        self.sum_table.setHorizontalHeaderLabels(["과목", "미제출 과제", "미완료 이러닝"])
        self._style_table(self.sum_table)
        cl.addWidget(self.sum_table)
        v.addWidget(card, 1)
        return w

    def _build_settings(self) -> QWidget:
        """다크 모드 스위치와 결과 저장."""
        w, v = self._page("설정", "화면 테마와 조회 파일을 여기서 바꿉니다.")

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
        self.theme_caption = QLabel("밝은 카드 화면으로 봅니다.")
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
        s = QPushButton("조회 결과 저장")
        s.setObjectName("primary")
        s.setCursor(Qt.CursorShape.PointingHandCursor)
        l = QPushButton("조회 결과 불러오기")
        l.setObjectName("ghost")
        l.setCursor(Qt.CursorShape.PointingHandCursor)
        s.clicked.connect(self.save_result)
        l.clicked.connect(self.load_result)
        row.addWidget(s)
        row.addWidget(l)
        row.addStretch(1)
        cl.addLayout(row)
        v.addWidget(card)
        v.addStretch(1)
        return w

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
            self.chip_name.setText("로그인 전")
            self.chip_sub.setText("세션 없음")
            self.avatar.setText("?")
            return
        who = self.backend.student_name or self.backend.student_id or "학생"
        self.chip_name.setText(who)
        extra = self.backend.dept_name or (self.backend.student_id or "")
        tag = "데모" if self.backend.demo else extra
        self.chip_sub.setText(tag)
        self.avatar.setText(who[0])

    def _alert(self, msg: str, err: bool = False) -> None:
        """오류만 알림창으로 띄운다. 로그인 성공은 카드를 쓴다."""
        box = QMessageBox(self)
        box.setWindowTitle("e-campus")
        box.setText(msg)
        box.setIcon(QMessageBox.Icon.Warning if err else QMessageBox.Icon.Information)
        box.exec()

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

        def work() -> dict:
            return self.backend.fetch()

        self._busy(message, work, lambda _: then())

    def on_login(self) -> None:
        """로그인 버튼. exe 는 콘솔 창 없이 백그라운드에서 돈다."""
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

        def work() -> dict:
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

    def on_session(self) -> None:
        """저장된 세션으로 접속한다."""
        if self.demo_chk.isChecked():
            self.on_login()
            return

        def work() -> bool:
            return self.backend.try_session()

        def done(ok: Any) -> None:
            if not ok:
                self._alert("세션이 없거나 만료되었습니다. 다시 로그인하세요.", True)
                return
            who = self.backend.profile_label()
            self.profile.setText(who)
            self._apply_profile_chip()
            self._show_login_success(who, "저장된 세션으로 들어왔어요")

        self._busy("세션을 확인하는 중", work, done)

    def refresh_assignments(self) -> None:
        """과제 조회."""
        self._ensure_data(self._fill_assignments, "과제를 불러오는 중")

    def _fill_assignments(self) -> None:
        """필터에 맞는 과제 행을 표에 넣는다."""
        mode = self.asg_filter.currentIndex()
        rows: list[tuple] = []
        for ci, course in enumerate(self.backend.data.get("courses") or []):
            title = course.get("courseTitle") or ""
            for ai, a in enumerate(course.get("assignments") or []):
                due = bool(a.get("dueNow"))
                status = a.get("status") or ""
                if mode == 1 and not due:
                    continue
                if mode == 2 and status not in ("미제출",) and "진행중" not in status:
                    continue
                rows.append((title, a.get("title") or "", a.get("period") or "", status, "지금" if due else "", ci, ai))
        self.asg_table.setRowCount(len(rows))
        self.asg_table.setColumnCount(7)
        self.asg_table.setHorizontalHeaderLabels(["과목", "제목", "기간", "상태", "지금", "ci", "ai"])
        self.asg_table.setColumnHidden(5, True)
        self.asg_table.setColumnHidden(6, True)
        for r, row in enumerate(rows):
            for c, val in enumerate(row):
                self.asg_table.setItem(r, c, QTableWidgetItem(str(val)))
        self.asg_table.resizeColumnsToContents()
        hdr = self.asg_table.horizontalHeader()
        hdr.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)

    def show_assignment_detail(self) -> None:
        """고른 과제 상세."""
        r = self.asg_table.currentRow()
        if r < 0:
            self._alert("과제를 먼저 고르세요.", True)
            return
        try:
            ci = int(self.asg_table.item(r, 5).text())
            ai = int(self.asg_table.item(r, 6).text())
        except (TypeError, ValueError, AttributeError):
            self._alert("과제를 다시 조회한 뒤 골라 주세요.", True)
            return

        def work() -> str:
            return self.backend.assignment_detail(ci, ai)

        self._busy("과제 상세를 불러오는 중", work, lambda text: self.asg_detail.setPlainText(text))

    def refresh_lessons(self) -> None:
        """이러닝 조회."""
        self._ensure_data(self._fill_lessons, "이러닝을 불러오는 중")

    def _fill_lessons(self) -> None:
        """차시 행을 표에 넣는다."""
        only_watch = self.les_filter.currentIndex() == 1
        rows: list[tuple] = []
        for ci, course in enumerate(self.backend.data.get("courses") or []):
            title = course.get("courseTitle") or ""
            for li, les in enumerate(course.get("elearning") or []):
                if only_watch and not les.get("needsWatch"):
                    continue
                pct = les.get("progressPercent")
                rows.append(
                    (
                        title,
                        les.get("week") or "",
                        les.get("title") or "",
                        les.get("period") or "",
                        les.get("attendanceStatus") or "",
                        "-" if pct is None else f"{pct}%",
                        ci,
                        li,
                    )
                )
        self.les_table.setRowCount(len(rows))
        self.les_table.setColumnCount(8)
        self.les_table.setHorizontalHeaderLabels(["과목", "주차", "제목", "기간", "출결", "진행", "ci", "li"])
        self.les_table.setColumnHidden(6, True)
        self.les_table.setColumnHidden(7, True)
        for r, row in enumerate(rows):
            for c, val in enumerate(row):
                self.les_table.setItem(r, c, QTableWidgetItem(str(val)))
        self.les_table.resizeColumnsToContents()
        self.les_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)

    def show_progress(self) -> None:
        """고른 차시 학습률."""
        r = self.les_table.currentRow()
        if r < 0:
            self._alert("차시를 먼저 고르세요.", True)
            return
        try:
            ci = int(self.les_table.item(r, 6).text())
            li = int(self.les_table.item(r, 7).text())
        except (TypeError, ValueError, AttributeError):
            self._alert("차시를 다시 조회한 뒤 골라 주세요.", True)
            return

        def work() -> int:
            return self.backend.lesson_progress(ci, li)

        def done(pct: Any) -> None:
            self.les_table.setItem(r, 5, QTableWidgetItem(f"{pct}%"))
            self._alert(f"학습률 {pct}%  (자동 시청 없음)")

        self._busy("학습률을 조회하는 중", work, done)

    def refresh_summary(self) -> None:
        """현황 한 표."""
        self._ensure_data(self._fill_summary, "현황을 모으는 중")

    def _fill_summary(self) -> None:
        """과목별 미제출·미완료 수를 채운다."""
        summary = list(self.backend.data.get("summary") or [])
        if not summary:
            for course in self.backend.data.get("courses") or []:
                due = sum(1 for a in course.get("assignments") or [] if a.get("dueNow"))
                pend = sum(1 for l in course.get("elearning") or [] if l.get("needsWatch"))
                summary.append({"courseTitle": course.get("courseTitle"), "dueAssignments": due, "pendingLessons": pend})
        self.sum_table.setRowCount(len(summary))
        for r, s in enumerate(summary):
            self.sum_table.setItem(r, 0, QTableWidgetItem(str(s.get("courseTitle") or "")))
            self.sum_table.setItem(r, 1, QTableWidgetItem(str(s.get("dueAssignments") or 0)))
            self.sum_table.setItem(r, 2, QTableWidgetItem(str(s.get("pendingLessons") or 0)))
        self.sum_table.resizeColumnsToContents()
        self.sum_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)

    def save_result(self) -> None:
        """조회 결과를 result.json 에 저장한다."""
        def work() -> str:
            if not self.backend.data.get("courses"):
                self.backend.fetch()
            return str(self.backend.save_result_copy())

        self._busy("저장하는 중", work, lambda path: self._alert(f"저장했습니다.\n{path}"))

    def load_result(self) -> None:
        """저장해 둔 조회 결과를 다시 그린다."""
        def work() -> dict:
            return self.backend.load_saved()

        def done(_: Any) -> None:
            self._fill_summary()
            self._fill_assignments()
            self._fill_lessons()
            self._alert("저장된 조회 결과를 그렸습니다.")

        self._busy("불러오는 중", work, done)
