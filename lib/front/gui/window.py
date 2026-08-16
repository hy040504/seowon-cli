"""seowon-cli PyQt 메인 창 — TUI 메뉴와 같은 기능을 화면으로 보여 준다."""

from __future__ import annotations

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSplitter,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from backend import Backend, BackendError


NAV = ["로그인 / 세션", "과제 확인", "이러닝 확인", "현황 한 표", "파일 / 설정"]

STYLE = """
QMainWindow, QWidget { background: #0f172a; color: #e2e8f0; font-size: 13px; }
QListWidget { background: #1e293b; border: none; padding: 8px; }
QListWidget::item { padding: 10px 12px; border-radius: 6px; }
QListWidget::item:selected { background: #0ea5e9; color: #0f172a; }
QLineEdit, QComboBox, QTextEdit, QTableWidget {
    background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 6px; color: #e2e8f0;
}
QHeaderView::section { background: #334155; color: #e2e8f0; padding: 6px; border: none; }
QPushButton {
    background: #0ea5e9; color: #0f172a; border: none; border-radius: 6px; padding: 8px 14px; font-weight: 600;
}
QPushButton:hover { background: #38bdf8; }
QPushButton#ghost { background: #334155; color: #e2e8f0; }
QLabel#title { font-size: 20px; font-weight: 700; color: #7dd3fc; }
QLabel#hint { color: #94a3b8; }
QCheckBox { spacing: 8px; }
"""


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.backend = Backend()
        self.setWindowTitle("seowon-cli  ·  e-campus 현황 (GUI)")
        self.resize(1100, 720)
        self.setStyleSheet(STYLE)

        root = QWidget()
        self.setCentralWidget(root)
        split = QSplitter(Qt.Orientation.Horizontal)
        lay = QHBoxLayout(root)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(split)

        left = QWidget()
        left_l = QVBoxLayout(left)
        brand = QLabel("서원대 e-campus")
        brand.setObjectName("title")
        sub = QLabel("조회 전용 · JSON 저장")
        sub.setObjectName("hint")
        self.nav = QListWidget()
        self.nav.addItems(NAV)
        self.nav.setCurrentRow(0)
        self.status = QLabel("로그인되지 않음")
        self.status.setObjectName("hint")
        left_l.addWidget(brand)
        left_l.addWidget(sub)
        left_l.addWidget(self.nav, 1)
        left_l.addWidget(self.status)
        split.addWidget(left)

        self.stack = QStackedWidget()
        self.page_login = self._build_login()
        self.page_asg = self._build_assignments()
        self.page_les = self._build_lessons()
        self.page_sum = self._build_summary()
        self.page_cfg = self._build_settings()
        for p in (self.page_login, self.page_asg, self.page_les, self.page_sum, self.page_cfg):
            self.stack.addWidget(p)
        split.addWidget(self.stack)
        split.setSizes([240, 860])
        self.nav.currentRowChanged.connect(self.stack.setCurrentIndex)

    def _title(self, text: str) -> QLabel:
        lab = QLabel(text)
        lab.setObjectName("title")
        return lab

    def _build_login(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        v.addWidget(self._title("로그인 / 세션"))
        form = QFormLayout()
        self.id_edit = QLineEdit()
        self.id_edit.setPlaceholderText("학번")
        self.pw_edit = QLineEdit()
        self.pw_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.pw_edit.setPlaceholderText("비밀번호 (저장하지 않음)")
        self.demo_chk = QCheckBox("데모 모드 (testdata, 네트워크 없음)")
        self.demo_chk.setChecked(True)
        form.addRow("학번", self.id_edit)
        form.addRow("비밀번호", self.pw_edit)
        v.addLayout(form)
        v.addWidget(self.demo_chk)
        row = QHBoxLayout()
        b1 = QPushButton("로그인")
        b2 = QPushButton("저장된 세션으로 접속")
        b2.setObjectName("ghost")
        b1.clicked.connect(self.on_login)
        b2.clicked.connect(self.on_session)
        row.addWidget(b1)
        row.addWidget(b2)
        v.addLayout(row)
        self.profile = QLabel("로그인하면 이름 · 학번 · 학과를 보여 줍니다.")
        self.profile.setObjectName("hint")
        self.profile.setWordWrap(True)
        v.addWidget(self.profile)
        hint = QLabel("공식 SDK가 아닙니다. 조회만 하며 과제 제출·자동 시청은 하지 않습니다.")
        hint.setObjectName("hint")
        hint.setWordWrap(True)
        v.addWidget(hint)
        v.addStretch(1)
        return w

    def _build_assignments(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        v.addWidget(self._title("과제 확인"))
        row = QHBoxLayout()
        self.asg_filter = QComboBox()
        self.asg_filter.addItems(["전체 과제", "현재 수행 가능 (기간 안 미제출)", "미제출 · 진행중"])
        btn = QPushButton("조회")
        det = QPushButton("상세 보기")
        det.setObjectName("ghost")
        btn.clicked.connect(self.refresh_assignments)
        det.clicked.connect(self.show_assignment_detail)
        row.addWidget(self.asg_filter, 1)
        row.addWidget(btn)
        row.addWidget(det)
        v.addLayout(row)
        self.asg_table = QTableWidget(0, 5)
        self.asg_table.setHorizontalHeaderLabels(["과목", "제목", "기간", "상태", "지금"])
        self.asg_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.asg_table.setColumnHidden(5, True)
        v.addWidget(self.asg_table, 1)
        self.asg_detail = QTextEdit()
        self.asg_detail.setReadOnly(True)
        self.asg_detail.setPlaceholderText("과제를 고른 뒤 상세 보기")
        self.asg_detail.setFixedHeight(160)
        v.addWidget(self.asg_detail)
        return w

    def _build_lessons(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        v.addWidget(self._title("이러닝 확인"))
        row = QHBoxLayout()
        self.les_filter = QComboBox()
        self.les_filter.addItems(["차시 목록", "들을 차시"])
        btn = QPushButton("조회")
        pr = QPushButton("학습률(%)")
        pr.setObjectName("ghost")
        btn.clicked.connect(self.refresh_lessons)
        pr.clicked.connect(self.show_progress)
        row.addWidget(self.les_filter, 1)
        row.addWidget(btn)
        row.addWidget(pr)
        v.addLayout(row)
        self.les_table = QTableWidget(0, 6)
        self.les_table.setHorizontalHeaderLabels(["과목", "주차", "제목", "기간", "출결", "진행"])
        self.les_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        v.addWidget(self.les_table, 1)
        return w

    def _build_summary(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        v.addWidget(self._title("현황 한 표"))
        btn = QPushButton("과목별 과제·이러닝 모으기")
        btn.clicked.connect(self.refresh_summary)
        v.addWidget(btn, 0, Qt.AlignmentFlag.AlignLeft)
        self.sum_table = QTableWidget(0, 3)
        self.sum_table.setHorizontalHeaderLabels(["과목", "미제출 과제", "미완료 이러닝"])
        v.addWidget(self.sum_table, 1)
        return w

    def _build_settings(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        v.addWidget(self._title("파일 / 설정"))
        hint = QLabel("설정 파일은 실행 폴더의 config.json, 결과는 dataDir/result.json 입니다.")
        hint.setObjectName("hint")
        v.addWidget(hint)
        row = QHBoxLayout()
        s = QPushButton("조회 결과 저장")
        l = QPushButton("조회 결과 불러오기")
        l.setObjectName("ghost")
        s.clicked.connect(self.save_result)
        l.clicked.connect(self.load_result)
        row.addWidget(s)
        row.addWidget(l)
        v.addLayout(row)
        v.addStretch(1)
        return w

    def _alert(self, msg: str, err: bool = False) -> None:
        if err:
            QMessageBox.warning(self, "seowon-cli", msg)
        else:
            QMessageBox.information(self, "seowon-cli", msg)

    def _need_data(self) -> bool:
        if self.backend.data.get("courses"):
            return True
        try:
            self.backend.fetch()
            return True
        except BackendError as e:
            self._alert(str(e), True)
            return False

    def on_login(self) -> None:
        try:
            self.backend.login(self.id_edit.text().strip(), self.pw_edit.text(), self.demo_chk.isChecked())
            self.pw_edit.clear()
            who = self.backend.profile_label()
            tag = "  [데모]" if self.backend.demo else ""
            self.status.setText(f"로그인됨: {who}{tag}")
            self.profile.setText(who)
            self._alert(f"로그인했습니다.\n{who}\n과제·이러닝 메뉴에서 조회하세요.")
        except BackendError as e:
            self._alert(str(e), True)

    def on_session(self) -> None:
        if self.demo_chk.isChecked():
            self.on_login()
            return
        if self.backend.try_session():
            who = self.backend.profile_label()
            self.status.setText(f"로그인됨: {who}")
            self.profile.setText(who)
            self._alert(f"저장된 세션을 재사용합니다.\n{who}")
        else:
            self._alert("세션이 없거나 만료되었습니다. 다시 로그인하세요.", True)

    def refresh_assignments(self) -> None:
        if not self._need_data():
            return
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

    def show_assignment_detail(self) -> None:
        r = self.asg_table.currentRow()
        if r < 0:
            self._alert("과제를 먼저 고르세요.", True)
            return
        try:
            ci = int(self.asg_table.item(r, 5).text())
            ai = int(self.asg_table.item(r, 6).text())
            self.asg_detail.setPlainText(self.backend.assignment_detail(ci, ai))
        except BackendError as e:
            self._alert(str(e), True)

    def refresh_lessons(self) -> None:
        if not self._need_data():
            return
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

    def show_progress(self) -> None:
        r = self.les_table.currentRow()
        if r < 0:
            self._alert("차시를 먼저 고르세요.", True)
            return
        try:
            ci = int(self.les_table.item(r, 6).text())
            li = int(self.les_table.item(r, 7).text())
            pct = self.backend.lesson_progress(ci, li)
            self.les_table.setItem(r, 5, QTableWidgetItem(f"{pct}%"))
            self._alert(f"학습률 {pct}%  (자동 시청 없음)")
        except BackendError as e:
            self._alert(str(e), True)

    def refresh_summary(self) -> None:
        if not self._need_data():
            return
        summary = self.backend.data.get("summary") or []
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

    def save_result(self) -> None:
        try:
            if not self.backend.data.get("courses"):
                self.backend.fetch()
            path = self.backend.save_result_copy()
            self._alert(f"저장했습니다.\n{path}")
        except BackendError as e:
            self._alert(str(e), True)

    def load_result(self) -> None:
        try:
            self.backend.load_saved()
            self.refresh_summary()
            self.refresh_assignments()
            self.refresh_lessons()
            self._alert("저장된 조회 결과를 그렸습니다.")
        except BackendError as e:
            self._alert(str(e), True)
