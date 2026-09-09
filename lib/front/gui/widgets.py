"""웹(seowon-client-web) 과 같은 토스 톤 위젯."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from PyQt6.QtCore import (
    QEasingCurve,
    QEvent,
    QPropertyAnimation,
    QRectF,
    QSize,
    Qt,
    QThread,
    QTimer,
    QVariantAnimation,
    pyqtSignal,
)
from PyQt6.QtGui import (
    QColor,
    QEnterEvent,
    QFont,
    QMouseEvent,
    QPainter,
    QPainterPath,
    QPaintEvent,
    QPen,
    QPixmap,
)
from PyQt6.QtWidgets import (
    QAbstractButton,
    QCheckBox,
    QFrame,
    QGraphicsDropShadowEffect,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from backend import BackendError
from style import CURRENT, Theme

ASSETS = Path(__file__).resolve().parent / "assets"
SPIN_PNG = ASSETS / "loading_e1.png"


def _refresh(widget: QWidget) -> None:
    """objectName / property 를 바꾼 뒤 QSS 를 다시 입힌다."""
    widget.style().unpolish(widget)
    widget.style().polish(widget)
    widget.update()


class TossCheck(QCheckBox):
    """파란 칸 안에 V자 체크가 그려지는 토스형 체크박스."""

    def __init__(self, text: str = "", parent: QWidget | None = None) -> None:
        """텍스트와 V자 진행도를 준비한다."""
        super().__init__(text, parent)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(26)
        self._tick: float = 1.0 if self.isChecked() else 0.0
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(170)
        self._anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim.valueChanged.connect(self._set_tick)
        self.toggled.connect(self._play)

    def _set_tick(self, value: object) -> None:
        """애니메이션 값으로 V자를 다시 그린다."""
        self._tick = float(value)
        self.update()

    def _play(self, on: bool) -> None:
        """켜고 끌 때 V자가 나타나거나 사라지게 한다."""
        self._anim.stop()
        self._anim.setStartValue(self._tick)
        self._anim.setEndValue(1.0 if on else 0.0)
        self._anim.start()

    def sizeHint(self) -> QSize:  # noqa: N802
        """체크 칸을 조금 키운 기본 크기."""
        hint = super().sizeHint()
        hint.setHeight(max(hint.height(), 26))
        hint.setWidth(hint.width() + 8)
        return hint

    def paintEvent(self, event: QPaintEvent | None) -> None:  # noqa: N802
        """기본 체크 그림 대신 네모 + V자만 그린다."""
        del event
        t = CURRENT
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        box = 22
        y = (self.height() - box) / 2
        rect = QRectF(1, y, box, box)
        fill = QColor(t.blue) if self.isChecked() or self._tick > 0.05 else QColor(t.surface)
        if not self.isChecked() and self._tick > 0.05:
            fill = QColor(t.blue)
            fill.setAlpha(int(40 + 180 * self._tick))
        painter.setPen(QPen(QColor(t.blue if self.isChecked() else t.check_border), 1.6))
        painter.setBrush(fill)
        painter.drawRoundedRect(rect, 6, 6)

        if self._tick > 0.02:
            path = QPainterPath()
            path.moveTo(rect.left() + 5.2, rect.top() + 11.2)
            path.lineTo(rect.left() + 9.0, rect.top() + 15.2)
            path.lineTo(rect.left() + 16.6, rect.top() + 6.6)
            pen = QPen(QColor("#FFFFFF"), 2.3, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin)
            painter.setPen(pen)
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.setOpacity(max(0.15, self._tick))
            painter.drawPath(path)
            painter.setOpacity(1.0)

        painter.setPen(QColor(t.text_2))
        font = QFont(self.font())
        font.setWeight(QFont.Weight.DemiBold)
        font.setPixelSize(14)
        painter.setFont(font)
        text_rect = QRectF(box + 12, 0, self.width() - box - 12, self.height())
        painter.drawText(text_rect, int(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft), self.text())


class TossSwitch(QAbstractButton):
    """토스 설정처럼 알약 트랙 위를 흰 원이 미끄러진다."""

    def __init__(self, parent: QWidget | None = None) -> None:
        """알약 스위치. 원은 왼쪽(꺼짐)에서 시작한다."""
        super().__init__(parent)
        self.setCheckable(True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedSize(50, 30)
        self._knob: float = 1.0 if self.isChecked() else 0.0
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(180)
        self._anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim.valueChanged.connect(self._set_knob)
        self.toggled.connect(self._play)

    def _set_knob(self, value: object) -> None:
        """원 위치를 바꾸고 다시 그린다."""
        self._knob = float(value)
        self.update()

    def _play(self, on: bool) -> None:
        """켜면 오른쪽으로, 끄면 왼쪽으로 민다."""
        self._anim.stop()
        self._anim.setStartValue(self._knob)
        self._anim.setEndValue(1.0 if on else 0.0)
        self._anim.start()

    def paintEvent(self, event: QPaintEvent | None) -> None:  # noqa: N802
        """트랙 색을 섞고 흰 원을 그린다."""
        del event
        t = CURRENT
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        track = QRectF(1, 3, self.width() - 2, self.height() - 6)
        off = QColor(t.track)
        on = QColor(t.blue)
        r = off.red() + int((on.red() - off.red()) * self._knob)
        g = off.green() + int((on.green() - off.green()) * self._knob)
        b = off.blue() + int((on.blue() - off.blue()) * self._knob)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor(r, g, b))
        painter.drawRoundedRect(track, 12, 12)
        pad = 4
        travel = self.width() - 24 - pad
        x = pad + travel * self._knob
        painter.setBrush(QColor(t.handle))
        painter.drawEllipse(QRectF(x, 5, 20, 20))


class SuccessMark(QWidget):
    """웹 로그인 성공과 같은 초록 원 테두리 + V자."""

    def __init__(self, parent: QWidget | None = None, size: int = 76) -> None:
        """초록 원 테두리 크기."""
        super().__init__(parent)
        self.setFixedSize(size, size)
        self._tick: float = 0.0
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(450)
        self._anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim.valueChanged.connect(self._set_tick)

    def _set_tick(self, value: object) -> None:
        """원·V자 등장 진행도."""
        self._tick = float(value)
        self.update()

    def play(self) -> None:
        """성공 화면이 열릴 때 원과 V자를 처음부터 그린다."""
        self._anim.stop()
        self._tick = 0.0
        self._anim.setStartValue(0.0)
        self._anim.setEndValue(1.0)
        self._anim.start()
        self.update()

    def paintEvent(self, event: QPaintEvent | None) -> None:  # noqa: N802
        """초록 원호를 그린 뒤 V자를 이어서 그린다."""
        del event
        t = CURRENT
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        m = 6
        rect = QRectF(m, m, self.width() - 2 * m, self.height() - 2 * m)
        pen = QPen(QColor(t.green), 4, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawArc(rect, 90 * 16, int(-360 * 16 * min(1.0, self._tick / 0.55)))
        if self._tick < 0.35:
            return
        path = QPainterPath()
        w, h = self.width(), self.height()
        path.moveTo(w * 0.29, h * 0.51)
        path.lineTo(w * 0.44, h * 0.66)
        path.lineTo(w * 0.72, h * 0.34)
        painter.setOpacity(min(1.0, (self._tick - 0.35) / 0.65))
        painter.drawPath(path)


class TossSpinner(QWidget):
    """끝이 둥근 파란 원호가 돌아가는 로딩 표시. PNG 가 없을 때 쓴다."""

    def __init__(self, parent: QWidget | None = None, size: int = 40) -> None:
        """원호 스피너. PNG 가 없을 때 쓴다."""
        super().__init__(parent)
        self._angle: int = 0
        self.setFixedSize(size, size)
        self._timer = QTimer(self)
        self._timer.setInterval(16)
        self._timer.timeout.connect(self._tick)

    def start(self) -> None:
        """회전 타이머를 켠다."""
        if not self._timer.isActive():
            self._timer.start()

    def stop(self) -> None:
        """회전 타이머를 끈다."""
        self._timer.stop()

    def _tick(self) -> None:
        """각도를 조금 돌린다."""
        self._angle = (self._angle + 8) % 360
        self.update()

    def paintEvent(self, event: QPaintEvent | None) -> None:  # noqa: N802
        """바탕 원과 파란 원호를 그린다."""
        del event
        t = CURRENT
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        track = QPen(QColor(t.spinner_track), 3.6, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap)
        painter.setPen(track)
        m = 4
        painter.drawArc(m, m, self.width() - 2 * m, self.height() - 2 * m, 0, 360 * 16)
        arc = QPen(QColor(t.blue), 3.6, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap)
        painter.setPen(arc)
        painter.drawArc(m, m, self.width() - 2 * m, self.height() - 2 * m, -self._angle * 16, 270 * 16)


class AssetSpinner(QWidget):
    """웹 loading_e1.png 를 돌리는 스피너."""

    def __init__(self, parent: QWidget | None = None, size: int = 52) -> None:
        """loading_e1.png 를 읽고 없으면 원호 스피너를 쓴다."""
        super().__init__(parent)
        self._angle: int = 0
        self._size: int = size
        self.setFixedSize(size, size)
        self._src = QPixmap(str(SPIN_PNG)) if SPIN_PNG.is_file() else QPixmap()
        self._timer = QTimer(self)
        self._timer.setInterval(16)
        self._timer.timeout.connect(self._tick)
        self._fallback = TossSpinner(self, size)
        self._fallback.hide()

    def start(self) -> None:
        """PNG 를 돌리거나 대체 스피너를 켠다."""
        if self._src.isNull():
            self._fallback.show()
            self._fallback.start()
            return
        if not self._timer.isActive():
            self._timer.start()

    def stop(self) -> None:
        """회전을 멈춘다."""
        self._timer.stop()
        self._fallback.stop()
        self._fallback.hide()

    def _tick(self) -> None:
        """각도를 조금 돌린다."""
        self._angle = (self._angle + 8) % 360
        self.update()

    def paintEvent(self, event: QPaintEvent | None) -> None:  # noqa: N802
        """테마 색으로 칠한 PNG 를 회전해 그린다."""
        del event
        if self._src.isNull():
            return
        t = CURRENT
        color = QColor(t.blue if t.name == "light" else "#F4F4F5")
        src = self._src.scaled(self._size, self._size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        tinted = QPixmap(src.size())
        tinted.fill(Qt.GlobalColor.transparent)
        p = QPainter(tinted)
        p.drawPixmap(0, 0, src)
        p.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceIn)
        p.fillRect(tinted.rect(), color)
        p.end()

        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        painter.translate(self.width() / 2, self.height() / 2)
        painter.rotate(self._angle)
        painter.translate(-tinted.width() / 2, -tinted.height() / 2)
        painter.drawPixmap(0, 0, tinted)


class LoadingOverlay(QWidget):
    """웹 page-overlay 처럼 흐린 막 + 스피너 + 알약 메시지."""

    def __init__(self, parent: QWidget) -> None:
        """부모 위에 깔 흐린 막과 스피너·알약을 만든다."""
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.hide()

        self.spin = AssetSpinner(self, 52)
        self.lab = QLabel("잠시만요")
        self.lab.setObjectName("loadPill")
        self.lab.setAlignment(Qt.AlignmentFlag.AlignCenter)

        inner = QVBoxLayout()
        inner.setSpacing(18)
        inner.addWidget(self.spin, 0, Qt.AlignmentFlag.AlignHCenter)
        inner.addWidget(self.lab, 0, Qt.AlignmentFlag.AlignHCenter)

        lay = QVBoxLayout(self)
        lay.addStretch(1)
        row = QHBoxLayout()
        row.addStretch(1)
        row.addLayout(inner)
        row.addStretch(1)
        lay.addLayout(row)
        lay.addStretch(1)
        self.apply_theme(CURRENT)

    def apply_theme(self, theme: Theme) -> None:
        """막 색을 라이트/다크에 맞춘다."""
        self.setStyleSheet(f"background: {theme.overlay};")

    def show_msg(self, text: str) -> None:
        """알약 문구를 넣고 스피너를 켠다."""
        self.lab.setText(text)
        self.spin.start()
        self.show()
        self.raise_()

    def hide_msg(self) -> None:
        """스피너를 끄고 막을 내린다."""
        self.spin.stop()
        self.hide()


class ToastBanner(QFrame):
    """웹 toast-banner. 오류·안내를 알림창 대신 위에 잠깐 띄운다."""

    def __init__(self, parent: QWidget | None = None) -> None:
        """위쪽 안내 막. 처음엔 숨긴다."""
        super().__init__(parent)
        self.setObjectName("toast")
        self.setProperty("kind", "info")
        self.hide()
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.hide)

        row = QHBoxLayout(self)
        row.setContentsMargins(14, 10, 14, 10)
        row.setSpacing(8)
        self.icon = QLabel("⚠️")
        self.msg = QLabel("")
        self.msg.setObjectName("toastMsg")
        self.msg.setWordWrap(True)
        row.addWidget(self.icon)
        row.addWidget(self.msg, 1)

    def show_msg(self, text: str, err: bool = False) -> None:
        """문구를 띄우고 잠깐 뒤 숨긴다."""
        self.msg.setText(text)
        self.icon.setText("⚠️" if err else "ℹ️")
        self.setProperty("kind", "error" if err else "info")
        _refresh(self)
        self.show()
        self.raise_()
        self._timer.start(3200)


class Badge(QLabel):
    """상태 알약. kind: due / miss / done / watch / info / demo."""

    def __init__(self, text: str = "", kind: str = "info", parent: QWidget | None = None) -> None:
        """상태 알약 글자와 색."""
        super().__init__(text, parent)
        self.setObjectName("badge")
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.set_kind(kind)

    def set_kind(self, kind: str) -> None:
        """due/miss/done/watch 색을 QSS property 로 바꾼다."""
        self.setProperty("kind", kind)
        _refresh(self)


class JobRow(QFrame):
    """웹 .job-row. 과제·이러닝 한 줄 카드."""

    clicked = pyqtSignal(object)
    acted = pyqtSignal(object)

    def __init__(
        self,
        title: str,
        meta: str,
        *,
        badge: str = "",
        badge_kind: str = "info",
        hot: str = "",
        action: str = "",
        payload: Any = None,
        parent: QWidget | None = None,
    ) -> None:
        """제목·메타·알약·액션 버튼을 한 줄에 놓는다."""
        super().__init__(parent)
        self.setObjectName("jobRow")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.payload = payload
        self.setProperty("selected", False)

        self.title_lab = QLabel(title)
        self.title_lab.setObjectName("jobTitle")
        self.title_lab.setWordWrap(True)
        self.meta_lab = QLabel(meta)
        self.meta_lab.setObjectName("jobMeta")
        self.meta_lab.setWordWrap(True)

        left = QVBoxLayout()
        left.setContentsMargins(0, 0, 0, 0)
        left.setSpacing(6)
        left.addWidget(self.title_lab)
        left.addWidget(self.meta_lab)

        right = QVBoxLayout()
        right.setContentsMargins(0, 0, 0, 0)
        right.setSpacing(8)
        right.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignRight)
        self.badge = Badge(badge, badge_kind)
        self.badge.setVisible(bool(badge))
        right.addWidget(self.badge, 0, Qt.AlignmentFlag.AlignRight)
        self.hot = QLabel(hot)
        self.hot.setObjectName("jobHot")
        self.hot.setVisible(bool(hot))
        right.addWidget(self.hot, 0, Qt.AlignmentFlag.AlignRight)
        self.act = QPushButton(action or "›")
        self.act.setObjectName("jobAct")
        self.act.setCursor(Qt.CursorShape.PointingHandCursor)
        self.act.setFixedSize(36, 36)
        self.act.setVisible(bool(action))
        self.act.clicked.connect(self._on_act)
        right.addWidget(self.act, 0, Qt.AlignmentFlag.AlignRight)

        row = QHBoxLayout(self)
        row.setContentsMargins(24, 18, 24, 18)
        row.setSpacing(16)
        row.addLayout(left, 1)
        row.addLayout(right)

    def _on_act(self) -> None:
        """액션 버튼은 행 선택 후 동작한다."""
        self.clicked.emit(self)
        self.acted.emit(self)

    def set_selected(self, on: bool) -> None:
        """선택 배경을 켠다."""
        self.setProperty("selected", on)
        _refresh(self)

    def set_hot(self, text: str) -> None:
        """오른쪽 보조 글자(지금, 학습률)."""
        self.hot.setText(text)
        self.hot.setVisible(bool(text))

    def mousePressEvent(self, event: QMouseEvent | None) -> None:  # noqa: N802
        """줄을 고른다."""
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self)
        super().mousePressEvent(event)


class EmptyState(QWidget):
    """조회 전·빈 목록 안내. 웹 tt-empty / todo-pregrid."""

    action_clicked = pyqtSignal()

    def __init__(self, icon: str, title: str, desc: str, action: str = "", parent: QWidget | None = None) -> None:
        """아이콘·제목·설명·선택 버튼을 가운데 놓는다."""
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(28, 40, 28, 40)
        lay.setSpacing(10)
        lay.setAlignment(Qt.AlignmentFlag.AlignCenter)
        ico = QLabel(icon)
        ico.setObjectName("emptyIcon")
        ico.setFixedSize(72, 72)
        ico.setAlignment(Qt.AlignmentFlag.AlignCenter)
        t = QLabel(title)
        t.setObjectName("emptyTitle")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        t.setWordWrap(True)
        d = QLabel(desc)
        d.setObjectName("emptyDesc")
        d.setAlignment(Qt.AlignmentFlag.AlignCenter)
        d.setWordWrap(True)
        d.setMaximumWidth(440)
        lay.addWidget(ico, 0, Qt.AlignmentFlag.AlignHCenter)
        lay.addWidget(t)
        lay.addWidget(d)
        self.btn = QPushButton(action)
        self.btn.setObjectName("primary")
        self.btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn.setVisible(bool(action))
        self.btn.clicked.connect(self.action_clicked.emit)
        if action:
            lay.addSpacing(8)
            lay.addWidget(self.btn, 0, Qt.AlignmentFlag.AlignHCenter)


class JobList(QFrame):
    """웹 .job-list. 헤더·행·빈 화면을 한 카드에 담는다."""

    row_clicked = pyqtSignal(object)
    row_acted = pyqtSignal(object)

    def __init__(self, parent: QWidget | None = None) -> None:
        """빈 안내를 넣은 카드."""
        super().__init__(parent)
        self.setObjectName("jobList")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self._rows: list[JobRow] = []
        self._selected: JobRow | None = None
        self._shadow = QGraphicsDropShadowEffect(self)
        self.setGraphicsEffect(self._shadow)
        self.apply_shadow()

        self._box = QVBoxLayout(self)
        self._box.setContentsMargins(0, 0, 0, 0)
        self._box.setSpacing(0)
        self._empty = EmptyState("🗂️", "아직 목록이 없습니다", "조회 버튼을 눌러 불러오세요.")
        self._box.addWidget(self._empty)

    def apply_shadow(self) -> None:
        """테마 그림자를 다시 칠한다."""
        self._shadow.setBlurRadius(28)
        self._shadow.setOffset(0, 6)
        self._shadow.setColor(QColor(0, 0, 0, CURRENT.shadow_a))

    def selected(self) -> JobRow | None:
        """지금 고른 행."""
        return self._selected

    def clear(self) -> None:
        """헤더·행·빈 화면을 모두 지운다."""
        self._rows.clear()
        self._selected = None
        while self._box.count():
            item = self._box.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()

    def show_empty(self, icon: str, title: str, desc: str, action: str = "") -> None:
        """빈 안내만 남긴다."""
        self.clear()
        empty = EmptyState(icon, title, desc, action)
        empty.action_clicked.connect(lambda: self.row_acted.emit(None))
        self._empty = empty
        self._box.addWidget(empty)

    def add_header(self, text: str) -> None:
        """과목명 같은 구역 제목."""
        lab = QLabel(text)
        lab.setObjectName("jobTitle")
        lab.setContentsMargins(24, 18, 24, 8)
        self._box.addWidget(lab)

    def add_row(self, row: JobRow) -> None:
        """행을 붙이고 클릭·액션을 연결한다."""
        row.clicked.connect(self._on_click)
        row.acted.connect(self.row_acted.emit)
        self._rows.append(row)
        self._box.addWidget(row)

    def finish(self) -> None:
        """남는 공간을 밀어 카드 높이를 채운다."""
        self._box.addStretch(1)

    def _on_click(self, row: JobRow) -> None:
        """한 줄만 선택한다."""
        if self._selected is not None:
            self._selected.set_selected(False)
        self._selected = row
        row.set_selected(True)
        self.row_clicked.emit(row)


class FeatureCard(QFrame):
    """웹 홈의 파란·검정·흰 기능 카드."""

    clicked = pyqtSignal()

    def __init__(self, icon: str, title: str, sub: str, action: str, variant: str = "surface", parent: QWidget | None = None) -> None:
        """홈/현황용 큰 카드. variant 는 blue/dark/surface."""
        super().__init__(parent)
        names = {"blue": "featBlue", "dark": "featDark", "surface": "featSurface"}
        self.setObjectName(names.get(variant, "featSurface"))
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(200)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

        ico = QLabel(icon)
        ico.setObjectName("featIcon")
        t = QLabel(title)
        t.setObjectName("featTitle")
        s = QLabel(sub)
        s.setObjectName("featSub")
        s.setWordWrap(True)
        btn = QPushButton(action)
        btn.setObjectName("pillBtn" if variant != "blue" else "ghost")
        if variant == "blue":
            btn.setStyleSheet("background:#FFFFFF; color:#0147FF; border:none; border-radius:999px; padding:10px 20px; font-weight:700;")
        elif variant == "dark":
            btn.setObjectName("pillBtn")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(self.clicked.emit)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(26, 24, 26, 22)
        lay.setSpacing(8)
        lay.addWidget(ico)
        lay.addWidget(t)
        lay.addWidget(s)
        lay.addStretch(1)
        lay.addWidget(btn, 0, Qt.AlignmentFlag.AlignRight)

    def mousePressEvent(self, event: QMouseEvent | None) -> None:  # noqa: N802
        """카드 전체를 누를 수 있게 한다."""
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(event)


class StatBox(QFrame):
    """현황 숫자 칸. 웹 score-stat-box."""

    def __init__(self, label: str, parent: QWidget | None = None) -> None:
        """라벨과 숫자 칸."""
        super().__init__(parent)
        self.setObjectName("statBox")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(4)
        lab = QLabel(label)
        lab.setObjectName("statLabel")
        lab.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.value = QLabel("0")
        self.value.setObjectName("statValue")
        self.value.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(lab)
        lay.addWidget(self.value)


class NavButton(QPushButton):
    """사이드바 메뉴. 접으면 이모지, 펼치면 글자."""

    def __init__(self, emoji: str, label: str, parent: QWidget | None = None) -> None:
        """이모지 + 글자. 접으면 글자를 숨긴다."""
        super().__init__(parent)
        self.setObjectName("navBtn")
        self.setCheckable(True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedHeight(44)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        self.emoji = QLabel(emoji)
        self.emoji.setObjectName("navEmoji")
        self.emoji.setFixedSize(44, 44)
        self.emoji.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.emoji.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.lab = QLabel(label)
        self.lab.setObjectName("navLabel")
        self.lab.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.lab.hide()
        lay.addWidget(self.emoji)
        lay.addWidget(self.lab)
        lay.addStretch(1)

    def set_expanded(self, on: bool) -> None:
        """펼치면 글자를 보이고 너비를 늘린다."""
        self.lab.setVisible(on)
        if on:
            self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            self.setMinimumWidth(0)
            self.setMaximumWidth(16777215)
            self.setFixedHeight(44)
        else:
            self.setFixedSize(44, 44)


class Sidebar(QWidget):
    """웹처럼 64px 아이콘 바. 올리면 236px 로 펼친다."""

    nav_clicked = pyqtSignal(int)
    logout_clicked = pyqtSignal()
    COLLAPSED = 64
    EXPANDED = 236

    def __init__(self, items: list[tuple[str, str]], parent: QWidget | None = None) -> None:
        """접힌 아이콘 바와 메뉴·칩·로그아웃."""
        super().__init__(parent)
        self.setObjectName("sidebar")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setFixedWidth(self.COLLAPSED)
        self._expanded: bool = False
        self._leave = QTimer(self)
        self._leave.setSingleShot(True)
        self._leave.timeout.connect(self._collapse)
        self._anim = QPropertyAnimation(self, b"minimumWidth", self)
        self._anim.setDuration(220)
        self._anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim.valueChanged.connect(self._on_width)

        self.lay = QVBoxLayout(self)
        self.lay.setContentsMargins(10, 20, 10, 18)
        self.lay.setSpacing(6)

        self.logo = QLabel("서")
        self.logo.setObjectName("avatar")
        self.logo.setFixedSize(36, 36)
        self.logo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.logo.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.brand_text = QLabel("서원대 몰아보기")
        self.brand_text.setObjectName("brandText")
        self.brand_text.hide()
        brand_row = QHBoxLayout()
        brand_row.setContentsMargins(4, 0, 0, 0)
        brand_row.addWidget(self.logo, 0, Qt.AlignmentFlag.AlignLeft)
        brand_row.addWidget(self.brand_text, 1)
        self.lay.addLayout(brand_row)

        self.brand_sub = QWidget()
        sub_l = QHBoxLayout(self.brand_sub)
        sub_l.setContentsMargins(4, 0, 4, 8)
        sub_l.setSpacing(6)
        ver = QLabel("Ver. 1.0.0")
        ver.setObjectName("brandVersion")
        badge = QLabel("조회 전용")
        badge.setObjectName("queryBadge")
        badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sub_l.addWidget(ver)
        sub_l.addWidget(badge)
        sub_l.addStretch(1)
        self.brand_sub.hide()
        self.lay.addWidget(self.brand_sub)

        self.nav_btns: list[NavButton] = []
        for i, (emoji, name) in enumerate(items):
            btn = NavButton(emoji, name)
            btn.clicked.connect(lambda _=False, idx=i: self.nav_clicked.emit(idx))
            self.nav_btns.append(btn)
            self.lay.addWidget(btn, 0, Qt.AlignmentFlag.AlignHCenter)
        if self.nav_btns:
            self.nav_btns[0].setChecked(True)
        self.lay.addStretch(1)

        self.chip = QFrame()
        self.chip.setObjectName("chip")
        self.chip.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        chip_l = QHBoxLayout(self.chip)
        chip_l.setContentsMargins(6, 6, 8, 6)
        chip_l.setSpacing(10)
        self.avatar = QLabel("?")
        self.avatar.setObjectName("avatar")
        self.avatar.setFixedSize(32, 32)
        self.avatar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.avatar.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        who = QVBoxLayout()
        who.setContentsMargins(0, 0, 0, 0)
        who.setSpacing(0)
        self.chip_name = QLabel("로그인 전")
        self.chip_name.setObjectName("chipName")
        self.chip_sub = QLabel("세션 없음")
        self.chip_sub.setObjectName("chipSub")
        who.addWidget(self.chip_name)
        who.addWidget(self.chip_sub)
        self.chip_who = QWidget()
        self.chip_who.setLayout(who)
        self.chip_who.hide()
        chip_l.addWidget(self.avatar)
        chip_l.addWidget(self.chip_who, 1)
        self.lay.addWidget(self.chip)

        self.logout_btn = NavButton("🚪", "로그아웃")
        self.logout_btn.setObjectName("sideLogout")
        self.logout_btn.setCheckable(False)
        self.logout_btn.clicked.connect(self.logout_clicked.emit)
        self.logout_btn.hide()
        self.lay.addWidget(self.logout_btn, 0, Qt.AlignmentFlag.AlignHCenter)

    def enterEvent(self, event: QEnterEvent | None) -> None:  # noqa: N802
        """마우스가 들어오면 펼친다."""
        self._leave.stop()
        self._expand()
        super().enterEvent(event)

    def leaveEvent(self, event: QEvent | None) -> None:  # noqa: N802
        """잠깐 뒤 접는다."""
        self._leave.start(140)
        super().leaveEvent(event)

    def _on_width(self, value: object) -> None:
        """애니메이션 너비를 고정 폭에 반영한다."""
        w = int(value) if not isinstance(value, int) else value
        self.setFixedWidth(max(self.COLLAPSED, w))

    def _expand(self) -> None:
        """236px 로 늘리고 글자를 켠다."""
        if self._expanded:
            return
        self._expanded = True
        self._set_labels(True)
        self._anim.stop()
        self._anim.setStartValue(self.width())
        self._anim.setEndValue(self.EXPANDED)
        self._anim.start()
        self.setMaximumWidth(self.EXPANDED)

    def _collapse(self) -> None:
        """64px 로 줄이고 글자를 끈다."""
        if not self._expanded:
            return
        self._expanded = False
        self._set_labels(False)
        self._anim.stop()
        self._anim.setStartValue(self.width())
        self._anim.setEndValue(self.COLLAPSED)
        self._anim.start()
        self.setMaximumWidth(self.EXPANDED)

    def _set_labels(self, on: bool) -> None:
        """로고·글자·칩·버튼 정렬을 접힘에 맞춘다."""
        self.logo.setVisible(not on)
        self.brand_text.setVisible(on)
        self.brand_sub.setVisible(on)
        self.chip_who.setVisible(on)
        self.lay.setContentsMargins(14 if on else 10, 20, 14 if on else 10, 18)
        align = Qt.AlignmentFlag.AlignLeft if on else Qt.AlignmentFlag.AlignHCenter
        for btn in self.nav_btns:
            btn.set_expanded(on)
            self.lay.setAlignment(btn, align)
        self.logout_btn.set_expanded(on)
        self.lay.setAlignment(self.logout_btn, align)
        if on:
            self.chip.setMinimumHeight(50)
        else:
            self.chip.setMinimumHeight(44)

    def set_current(self, index: int) -> None:
        """지금 페이지 메뉴만 체크한다."""
        for i, btn in enumerate(self.nav_btns):
            btn.setChecked(i == index)

    def set_profile(self, name: str, sub: str, letter: str) -> None:
        """아래 칩의 이름·보조·이니셜."""
        self.chip_name.setText(name)
        self.chip_sub.setText(sub)
        self.avatar.setText(letter)

    def set_logged_in(self, on: bool) -> None:
        """로그아웃 버튼을 보여 준다."""
        self.logout_btn.setVisible(on)


class FnThread(QThread):
    """조회·로그인을 UI 스레드 밖에서 돌린다."""

    ok = pyqtSignal(object)
    err = pyqtSignal(str)

    def __init__(self, fn: Callable[[], Any]) -> None:
        """백그라운드에서 실행할 함수."""
        super().__init__()
        self._fn = fn

    def run(self) -> None:
        """GUI 스레드 밖에서 fn 을 돌리고 ok/err 를 보낸다."""
        try:
            self.ok.emit(self._fn())
        except BackendError as e:
            self.err.emit(str(e))
        except Exception as e:  # noqa: BLE001
            self.err.emit(str(e))
