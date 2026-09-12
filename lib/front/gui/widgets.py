"""스마트홈 태블릿 톤 위젯. 원형 메뉴와 파랑/핑크 타일."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from PyQt6.QtCore import (
    QEasingCurve,
    QEvent,
    QObject,
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
    QIcon,
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
    QGraphicsOpacityEffect,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from backend import BackendError
from icons import LineIcon, lerp_color
from style import CURRENT, Theme

ASSETS = Path(__file__).resolve().parent / "assets"
SPIN_PNG = ASSETS / "loading_e1.png"
LOGO_SVG = ASSETS / "seowon-logo.svg"


def logo_pixmap(size: int = 36) -> QPixmap:
    """서원대 로고. 없으면 빈 그림."""
    if not LOGO_SVG.is_file():
        return QPixmap()
    pix = QIcon(str(LOGO_SVG)).pixmap(size, size)
    return pix if not pix.isNull() else QPixmap()


def _refresh(widget: QWidget) -> None:
    """objectName / property 를 바꾼 뒤 QSS 를 다시 입힌다."""
    widget.style().unpolish(widget)
    widget.style().polish(widget)
    widget.update()


def _keep_anim(widget: QWidget, key: str, anim: QPropertyAnimation | QVariantAnimation) -> None:
    """애니메이션이 GC 되지 않게 위젯에 붙인다."""
    setattr(widget, key, anim)


def fade_opacity(
    widget: QWidget,
    start: float,
    end: float,
    duration: int,
    done: Callable[[], None] | None = None,
    easing: QEasingCurve.Type = QEasingCurve.Type.OutCubic,
) -> QPropertyAnimation:
    """투명도를 바꾼다. 끝나면 이펙트를 떼지 않고 1이면 정리한다."""
    prev = getattr(widget, "_op_anim", None)
    if isinstance(prev, QPropertyAnimation):
        prev.stop()
    fx = widget.graphicsEffect()
    if not isinstance(fx, QGraphicsOpacityEffect):
        fx = QGraphicsOpacityEffect(widget)
        widget.setGraphicsEffect(fx)
    fx.setOpacity(start)
    anim = QPropertyAnimation(fx, b"opacity", widget)
    anim.setDuration(max(1, duration))
    anim.setStartValue(start)
    anim.setEndValue(end)
    anim.setEasingCurve(easing)

    def _finish() -> None:
        if end >= 0.99:
            widget.setGraphicsEffect(None)
        if done is not None:
            done()

    anim.finished.connect(_finish)
    _keep_anim(widget, "_op_anim", anim)
    anim.start()
    return anim


class FadeStack(QStackedWidget):
    """이전 화면 스냅샷이 투명해지며 새 페이지가 드러난다."""

    def __init__(self, parent: QWidget | None = None, duration: int = 240) -> None:
        """duration 은 스냅샷이 사라지는 시간(ms)."""
        super().__init__(parent)
        self._duration = duration
        self._busy = False
        self._pending: int | None = None
        self._ghost: QLabel | None = None

    def setCurrentIndex(self, index: int) -> None:  # noqa: N802
        """같은 페이지면 넘어가고, 바쁠 때는 다음 인덱스를 기억한다."""
        if index < 0 or index >= self.count():
            return
        cur = QStackedWidget.currentIndex(self)
        if index == cur and not self._busy:
            return
        if self._busy:
            self._pending = index
            return
        if cur < 0 or not self.isVisible() or self.width() < 8:
            QStackedWidget.setCurrentIndex(self, index)
            return
        self._busy = True
        self._pending = None
        snap = self.grab()
        QStackedWidget.setCurrentIndex(self, index)
        ghost = QLabel(self)
        ghost.setPixmap(snap)
        ghost.setScaledContents(True)
        ghost.setGeometry(self.rect())
        ghost.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        ghost.show()
        ghost.raise_()
        self._ghost = ghost
        fx = QGraphicsOpacityEffect(ghost)
        ghost.setGraphicsEffect(fx)
        fx.setOpacity(1.0)
        anim = QPropertyAnimation(fx, b"opacity", ghost)
        anim.setDuration(self._duration)
        anim.setStartValue(1.0)
        anim.setEndValue(0.0)
        anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        anim.finished.connect(self._clear_ghost)
        _keep_anim(ghost, "_fade", anim)
        anim.start()

    def setCurrentWidget(self, widget: QWidget) -> None:  # noqa: N802
        """위젯으로 바꿀 때도 같은 페이드를 쓴다."""
        idx = self.indexOf(widget)
        if idx >= 0:
            self.setCurrentIndex(idx)

    def _clear_ghost(self) -> None:
        """스냅샷을 지우고 대기 중인 전환을 이어 한다."""
        if self._ghost is not None:
            self._ghost.hide()
            self._ghost.deleteLater()
            self._ghost = None
        self._busy = False
        if self._pending is not None and self._pending != QStackedWidget.currentIndex(self):
            nxt = self._pending
            self._pending = None
            self.setCurrentIndex(nxt)


class HoverLift(QObject):
    """카드에 마우스를 올리면 그림자가 커지고, 누르면 살짝 가라앉는다."""

    def __init__(self, host: QWidget, *, rest_blur: int = 10, rest_y: int = 3, hot_blur: int = 24, hot_y: int = 10) -> None:
        """host 에 그림자 이펙트와 enter/leave 필터를 붙인다."""
        super().__init__(host)
        self._host = host
        self._rest_blur = rest_blur
        self._rest_y = rest_y
        self._hot_blur = hot_blur
        self._hot_y = hot_y
        self._t = 0.0
        self._want = 0.0
        self._fx = QGraphicsDropShadowEffect(host)
        self._fx.setBlurRadius(rest_blur)
        self._fx.setOffset(0, rest_y)
        self._fx.setColor(QColor(47, 59, 143, 28))
        host.setGraphicsEffect(self._fx)
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(180)
        self._anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim.valueChanged.connect(self._apply)
        host.installEventFilter(self)
        self._apply(0.0)

    def eventFilter(self, obj: QObject, event: QEvent) -> bool:  # noqa: N802
        """올리면 뜨고, 누르면 조금 내리고, 떠나면 원래대로."""
        if obj is not self._host:
            return False
        kind = event.type()
        if kind == QEvent.Type.Enter:
            self._go(1.0)
        elif kind == QEvent.Type.Leave:
            self._go(0.0)
        elif kind == QEvent.Type.MouseButtonPress:
            self._go(0.35)
        elif kind == QEvent.Type.MouseButtonRelease:
            self._go(1.0 if self._host.underMouse() else 0.0)
        return False

    def _go(self, want: float) -> None:
        """목표 높이로 그림자 애니메이션."""
        self._want = want
        self._anim.stop()
        self._anim.setStartValue(self._t)
        self._anim.setEndValue(want)
        self._anim.start()

    def _apply(self, value: object) -> None:
        """진행도에 맞춰 블러와 오프셋."""
        self._t = float(value)
        t = self._t
        blur = self._rest_blur + (self._hot_blur - self._rest_blur) * t
        y = self._rest_y + (self._hot_y - self._rest_y) * t
        alpha = int(22 + 26 * t)
        self._fx.setBlurRadius(blur)
        self._fx.setOffset(0, y)
        self._fx.setColor(QColor(47, 59, 143, alpha))


class RoundIconButton(QPushButton):
    """분홍 원에 흰 선 아이콘. 올리면 살짝 커진 것처럼 그림자가 생긴다."""

    def __init__(self, name: str, parent: QWidget | None = None) -> None:
        """아이콘 이름만 받는 원형 바로가기."""
        super().__init__(parent)
        self.setObjectName("roundAct")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedSize(52, 52)
        self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        self.icon = LineIcon(name, size=22, color="#FFFFFF", stroke=1.9)
        lay.addWidget(self.icon, 0, Qt.AlignmentFlag.AlignCenter)
        self._fx = QGraphicsDropShadowEffect(self)
        self._fx.setBlurRadius(0)
        self._fx.setOffset(0, 0)
        self._fx.setColor(QColor(255, 107, 157, 0))
        self.setGraphicsEffect(self._fx)
        self._glow = 0.0
        self._want = 0.0
        self._timer = QTimer(self)
        self._timer.setInterval(16)
        self._timer.timeout.connect(self._tick)

    def enterEvent(self, event: QEnterEvent | None) -> None:  # noqa: N802
        """분홍 글로우를 켠다."""
        self._want = 1.0
        if not self._timer.isActive():
            self._timer.start()
        super().enterEvent(event)

    def leaveEvent(self, event: QEvent | None) -> None:  # noqa: N802
        """글로우를 끈다."""
        self._want = 0.0
        if not self._timer.isActive():
            self._timer.start()
        super().leaveEvent(event)

    def _tick(self) -> None:
        """글로우 양을 보간한다."""
        self._glow += (self._want - self._glow) * 0.22
        if abs(self._glow - self._want) < 0.01:
            self._glow = self._want
            if self._glow <= 0.01:
                self._timer.stop()
        a = int(120 * self._glow)
        self._fx.setBlurRadius(18 * self._glow)
        self._fx.setOffset(0, 4 * self._glow)
        self._fx.setColor(QColor(255, 107, 157, a))


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
        self._hiding = False
        self.apply_theme(CURRENT)

    def apply_theme(self, theme: Theme) -> None:
        """막 색을 라이트/다크에 맞춘다."""
        self.setStyleSheet(f"background: {theme.overlay};")

    def show_msg(self, text: str) -> None:
        """알약 문구를 넣고 스피너를 켠 뒤 페이드 인."""
        self.lab.setText(text)
        self.spin.start()
        self._hiding = False
        if self.isVisible():
            self.raise_()
            return
        fx = QGraphicsOpacityEffect(self)
        self.setGraphicsEffect(fx)
        fx.setOpacity(0.0)
        self.show()
        self.raise_()
        fade_opacity(self, 0.0, 1.0, 180)

    def hide_msg(self) -> None:
        """페이드 아웃 후 스피너를 끈다."""
        if not self.isVisible() or self._hiding:
            self.hide()
            self.spin.stop()
            return
        self._hiding = True

        def _done() -> None:
            self.hide()
            self.spin.stop()
            self._hiding = False
            self.setGraphicsEffect(None)

        fade_opacity(self, 1.0, 0.0, 160, _done, QEasingCurve.Type.InCubic)


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
        self._timer.timeout.connect(self._dismiss)
        self._hiding = False

        row = QHBoxLayout(self)
        row.setContentsMargins(14, 10, 14, 10)
        row.setSpacing(10)
        self.icon = LineIcon("info", size=18, color="#FFFFFF", stroke=1.9)
        self.msg = QLabel("")
        self.msg.setObjectName("toastMsg")
        self.msg.setWordWrap(True)
        row.addWidget(self.icon, 0, Qt.AlignmentFlag.AlignVCenter)
        row.addWidget(self.msg, 1)

    def show_msg(self, text: str, err: bool = False) -> None:
        """문구를 페이드 인하고 잠깐 뒤 페이드 아웃."""
        self._hiding = False
        self.msg.setText(text)
        self.icon.set_name("warn" if err else "info")
        self.setProperty("kind", "error" if err else "info")
        _refresh(self)
        was = self.isVisible()
        self.show()
        self.raise_()
        if not was:
            fade_opacity(self, 0.0, 1.0, 200)
        self._timer.start(3200)

    def _dismiss(self) -> None:
        """위에서 내려온 안내를 투명하게 지운다."""
        if self._hiding or not self.isVisible():
            return
        self._hiding = True

        def _done() -> None:
            self.hide()
            self._hiding = False
            self.setGraphicsEffect(None)

        fade_opacity(self, 1.0, 0.0, 180, _done, QEasingCurve.Type.InCubic)


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
        self.act = QPushButton(action or "열기")
        self.act.setObjectName("jobAct")
        self.act.setCursor(Qt.CursorShape.PointingHandCursor)
        self.act.setMinimumSize(80, 32)
        self.act.setFixedHeight(32)
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
        well = QFrame()
        well.setObjectName("emptyIcon")
        well.setFixedSize(72, 72)
        well.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        well_l = QHBoxLayout(well)
        well_l.setContentsMargins(0, 0, 0, 0)
        ico = LineIcon(icon, size=28, color=CURRENT.blue, stroke=1.8)
        well_l.addWidget(ico, 0, Qt.AlignmentFlag.AlignCenter)
        t = QLabel(title)
        t.setObjectName("emptyTitle")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        t.setWordWrap(True)
        d = QLabel(desc)
        d.setObjectName("emptyDesc")
        d.setAlignment(Qt.AlignmentFlag.AlignCenter)
        d.setWordWrap(True)
        d.setMaximumWidth(440)
        lay.addWidget(well, 0, Qt.AlignmentFlag.AlignHCenter)
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
        self._empty = EmptyState("todo", "아직 목록이 없습니다", "조회 버튼을 눌러 불러오세요.")
        self._box.addWidget(self._empty)
        self._fade_i = 0

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
        self._fade_i = 0
        while self._box.count():
            item = self._box.takeAt(0)
            w = item.widget()
            if w is not None:
                w.hide()
                w.setParent(None)
                w.deleteLater()

    def show_empty(self, icon: str, title: str, desc: str, action: str = "") -> None:
        """빈 안내만 남긴다."""
        self.clear()
        empty = EmptyState(icon, title, desc, action)
        empty.action_clicked.connect(lambda: self.row_acted.emit(None))
        self._empty = empty
        self._box.addWidget(empty)
        fade_opacity(empty, 0.0, 1.0, 260)

    def add_header(self, text: str) -> None:
        """과목명 같은 구역 제목."""
        lab = QLabel(text)
        lab.setObjectName("jobTitle")
        lab.setContentsMargins(24, 18, 24, 8)
        self._box.addWidget(lab)
        self._stagger(lab)

    def add_row(self, row: JobRow) -> None:
        """행을 붙이고 클릭·액션을 연결한다."""
        row.clicked.connect(self._on_click)
        row.acted.connect(self.row_acted.emit)
        self._rows.append(row)
        self._box.addWidget(row)
        self._stagger(row)

    def _stagger(self, widget: QWidget) -> None:
        """목록이 위에서부터 차례로 나타난다."""
        delay = min(self._fade_i * 28, 220)
        self._fade_i += 1
        fx = QGraphicsOpacityEffect(widget)
        widget.setGraphicsEffect(fx)
        fx.setOpacity(0.0)

        def _run() -> None:
            fade_opacity(widget, 0.0, 1.0, 280)

        QTimer.singleShot(delay, _run)

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
    """태블릿 타일. 파랑/핑크/흰 둥근 사각형."""

    clicked = pyqtSignal()

    def __init__(self, icon: str, title: str, sub: str, action: str, variant: str = "surface", parent: QWidget | None = None) -> None:
        """홈/정보용 타일. variant 는 blue/dark/surface. dark 는 핑크."""
        super().__init__(parent)
        names = {"blue": "featBlue", "dark": "featDark", "pink": "featDark", "surface": "featSurface"}
        self.setObjectName(names.get(variant, "featSurface"))
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(148)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        HoverLift(self)

        ico_color = "#FFFFFF" if variant in ("blue", "dark", "pink") else CURRENT.blue
        ico = LineIcon(icon, size=30, color=ico_color, stroke=1.8)
        ico.setObjectName("featIcon")
        t = QLabel(title)
        t.setObjectName("featTitle")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        t.setWordWrap(True)
        s = QLabel(sub)
        s.setObjectName("featSub")
        s.setAlignment(Qt.AlignmentFlag.AlignCenter)
        s.setWordWrap(True)
        btn = QPushButton(action)
        btn.setObjectName("pillBtn")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(self.clicked.emit)
        if variant == "surface":
            btn.setObjectName("primary")

        lay = QVBoxLayout(self)
        lay.setContentsMargins(18, 18, 18, 16)
        lay.setSpacing(6)
        lay.addStretch(1)
        lay.addWidget(ico, 0, Qt.AlignmentFlag.AlignHCenter)
        lay.addWidget(t)
        lay.addWidget(s)
        lay.addSpacing(6)
        lay.addWidget(btn, 0, Qt.AlignmentFlag.AlignHCenter)
        lay.addStretch(1)

    def mousePressEvent(self, event: QMouseEvent | None) -> None:  # noqa: N802
        """카드 전체를 누를 수 있게 한다."""
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(event)


class DashTile(QFrame):
    """목업의 Blinds/Lights 같은 색 타일."""

    clicked = pyqtSignal()

    def __init__(self, icon: str, title: str, variant: str = "blue", parent: QWidget | None = None) -> None:
        """파랑 또는 핑크 정사각에 가까운 타일."""
        super().__init__(parent)
        self.setObjectName("dashBlue" if variant == "blue" else "dashPink")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(132)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        HoverLift(self)
        ico = LineIcon(icon, size=30, color="#FFFFFF", stroke=1.8)
        ico.setObjectName("featIcon")
        t = QLabel(title)
        t.setObjectName("featTitle")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        t.setWordWrap(True)
        pill = QLabel("조회")
        pill.setObjectName("featSub")
        pill.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 16, 12, 14)
        lay.addWidget(pill)
        lay.addStretch(1)
        lay.addWidget(ico, 0, Qt.AlignmentFlag.AlignHCenter)
        lay.addWidget(t)
        lay.addStretch(1)

    def mousePressEvent(self, event: QMouseEvent | None) -> None:  # noqa: N802
        """타일을 누르면 해당 메뉴로 간다."""
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(event)


class InquiryGauge(QAbstractButton):
    """목업 온도 원처럼 가운데에 조회를 그린다."""

    def __init__(self, parent: QWidget | None = None) -> None:
        """클릭하면 할 일을 불러온다."""
        super().__init__(parent)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumSize(180, 180)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self._hover = 0.0
        self._pulse = 0.0
        self._timer = QTimer(self)
        self._timer.setInterval(16)
        self._timer.timeout.connect(self._tick)
        self._timer.start()

    def mousePressEvent(self, event: QMouseEvent | None) -> None:  # noqa: N802
        """누르면 링이 한 번 퍼진다."""
        self._pulse = 1.0
        super().mousePressEvent(event)

    def _tick(self) -> None:
        """호버 시 링이 커지고, 클릭 펄스는 가라앉는다."""
        want = 1.0 if self.underMouse() else 0.0
        self._hover += (want - self._hover) * 0.18
        self._pulse += (0.0 - self._pulse) * 0.12
        self.update()

    def paintEvent(self, event: QPaintEvent | None) -> None:  # noqa: N802
        """흰 원과 파란 호, 가운데 글자."""
        del event
        t = CURRENT
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        grow = 6 * self._hover + 10 * self._pulse
        side = min(self.width(), self.height()) - 8 + grow
        x = (self.width() - side) / 2
        y = (self.height() - side) / 2
        rect = QRectF(x, y, side, side)
        painter.setPen(Qt.PenStyle.NoPen)
        inner = rect.adjusted(10, 10, -10, -10)
        painter.setBrush(QColor("#FFFFFF") if t.name == "light" else QColor(t.surface))
        painter.drawEllipse(inner)
        pen = QPen(QColor(t.pink), 5, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        span = int(-270 * 16 * (0.92 + 0.08 * self._hover))
        painter.drawArc(inner.adjusted(8, 8, -8, -8), 90 * 16, span)
        painter.setPen(QColor(t.text))
        font = QFont(self.font())
        font.setPixelSize(22)
        font.setWeight(QFont.Weight.Black)
        painter.setFont(font)
        painter.drawText(inner, int(Qt.AlignmentFlag.AlignCenter), "조회")


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
        self._n = 0
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(420)
        self._anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim.valueChanged.connect(self._tick_n)

    def set_value(self, n: int) -> None:
        """숫자가 올라가거나 내려가는 모습을 보여 준다."""
        target = int(n)
        self._anim.stop()
        self._anim.setStartValue(float(self._n))
        self._anim.setEndValue(float(target))
        self._anim.start()

    def _tick_n(self, value: object) -> None:
        """보간된 정수를 칸에 쓴다."""
        self._n = int(round(float(value)))
        self.value.setText(str(self._n))


class NavButton(QPushButton):
    """태블릿 레일 메뉴. 흰 선 아이콘 + 작은 글자를 항상 보여 준다."""

    def __init__(self, icon: str, label: str, parent: QWidget | None = None) -> None:
        """세로로 원과 라벨을 쌓는다."""
        super().__init__(parent)
        self.setObjectName("navBtn")
        self.setCheckable(True)
        self.setFlat(True)
        self.setAutoFillBackground(False)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedSize(76, 78)
        self._icon_name = icon
        self._sel = 0.0
        self._hov = 0.0
        self._want_hov = 0.0
        lay = QVBoxLayout(self)
        lay.setContentsMargins(4, 4, 4, 2)
        lay.setSpacing(2)
        self.icon = LineIcon(icon, size=48, color=CURRENT.sidebar_text, stroke=1.7)
        self.lab = QLabel(label)
        self.lab.setObjectName("navLabel")
        self.lab.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lab.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.lab.setWordWrap(False)
        lay.addWidget(self.icon, 0, Qt.AlignmentFlag.AlignHCenter)
        lay.addWidget(self.lab)
        self._sel_anim = QVariantAnimation(self)
        self._sel_anim.setDuration(240)
        self._sel_anim.setEasingCurve(QEasingCurve.Type.OutBack)
        self._sel_anim.valueChanged.connect(self._set_sel)
        self._hov_timer = QTimer(self)
        self._hov_timer.setInterval(16)
        self._hov_timer.timeout.connect(self._tick_hov)
        self.toggled.connect(lambda _: self.apply_state())
        self.apply_state(animate=False)

    def enterEvent(self, event: QEnterEvent | None) -> None:  # noqa: N802
        """아이콘이 살짝 진해진다."""
        self._want_hov = 1.0
        if not self._hov_timer.isActive():
            self._hov_timer.start()
        super().enterEvent(event)

    def leaveEvent(self, event: QEvent | None) -> None:  # noqa: N802
        """호버를 되돌린다."""
        self._want_hov = 0.0
        if not self._hov_timer.isActive():
            self._hov_timer.start()
        super().leaveEvent(event)

    def _tick_hov(self) -> None:
        """호버 양을 보간한다."""
        self._hov += (self._want_hov - self._hov) * 0.22
        if abs(self._hov - self._want_hov) < 0.01:
            self._hov = self._want_hov
            if self._hov <= 0.01:
                self._hov_timer.stop()
        self._paint_mix()

    def _set_sel(self, value: object) -> None:
        """선택 원 등장 진행도."""
        self._sel = float(value)
        self._paint_mix()

    def set_caption(self, icon: str, label: str) -> None:
        """로그인↔홈처럼 메뉴 아이콘과 글자를 바꾼다."""
        self._icon_name = icon
        self.icon.set_name(icon)
        self.lab.setText(label)
        self.apply_state(animate=False)

    def apply_state(self, animate: bool = True) -> None:
        """선택되면 파란 원 + 흰 선, 아니면 라벤더 선."""
        target = 1.0 if self.isChecked() else 0.0
        if not animate:
            self._sel_anim.stop()
            self._sel = target
            self._paint_mix()
            return
        self._sel_anim.stop()
        self._sel_anim.setStartValue(self._sel)
        self._sel_anim.setEndValue(target)
        self._sel_anim.start()

    def _paint_mix(self) -> None:
        """선택·호버를 섞어 원과 선 색을 칠한다."""
        t = CURRENT
        idle = QColor(t.sidebar_text)
        white = QColor("#FFFFFF")
        color = lerp_color(idle, white, self._sel)
        if self._sel > 0.02:
            self.icon.set_well(t.blue, self._sel)
        elif self._hov > 0.02:
            wash = "#FFFFFF" if t.name == "light" else "#3A4270"
            self.icon.set_well(wash, 0.42 * self._hov)
        else:
            self.icon.set_well(t.blue, 0.0)
        self.icon.set_color(color)
        lab_col = lerp_color(idle, QColor(t.blue), max(self._sel, self._hov * 0.4))
        weight = 800 if self._sel > 0.5 else 700
        self.lab.setStyleSheet(
            f"color:{lab_col.name()}; font-size:11px; font-weight:{weight}; background:transparent;"
        )


class Sidebar(QWidget):
    """태블릿처럼 고정 폭 파스텔 레일. 메뉴 글자는 아이콘 아래 항상 보인다."""

    nav_clicked = pyqtSignal(int)
    logout_clicked = pyqtSignal()
    WIDTH = 88

    def __init__(self, items: list[tuple[str, str]], parent: QWidget | None = None) -> None:
        """원형 홈 마크·메뉴·아바타·로그아웃."""
        super().__init__(parent)
        self.setObjectName("sidebar")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setFixedWidth(self.WIDTH)

        self.lay = QVBoxLayout(self)
        self.lay.setContentsMargins(6, 18, 6, 14)
        self.lay.setSpacing(4)

        self.logo = QLabel()
        self.logo.hide()
        self.lay.addSpacing(4)

        self.nav_btns: list[NavButton] = []
        for i, (icon, name) in enumerate(items):
            btn = NavButton(icon, name)
            btn.clicked.connect(lambda _=False, idx=i: self.nav_clicked.emit(idx))
            self.nav_btns.append(btn)
            self.lay.addWidget(btn, 0, Qt.AlignmentFlag.AlignHCenter)
        if self.nav_btns:
            self.nav_btns[0].setChecked(True)
            self.nav_btns[0].apply_state()
        self.lay.addStretch(1)

        self.chip = QFrame()
        self.chip.setObjectName("chip")
        chip_l = QVBoxLayout(self.chip)
        chip_l.setContentsMargins(0, 0, 0, 0)
        chip_l.setSpacing(4)
        self.avatar = QLabel("?")
        self.avatar.setObjectName("avatar")
        self.avatar.setFixedSize(36, 36)
        self.avatar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.avatar.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.avatar.setStyleSheet("background:#FF6B9D; color:#FFFFFF; border-radius:18px; font-weight:800;")
        self.chip_name = QLabel("로그인 전")
        self.chip_name.setObjectName("chipName")
        self.chip_name.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.chip_name.setWordWrap(True)
        self.chip_sub = QLabel("세션 없음")
        self.chip_sub.setObjectName("chipSub")
        self.chip_sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        chip_l.addWidget(self.avatar, 0, Qt.AlignmentFlag.AlignHCenter)
        chip_l.addWidget(self.chip_name)
        chip_l.addWidget(self.chip_sub)
        self.lay.addWidget(self.chip)

        self.logout_btn = QPushButton("Log out")
        self.logout_btn.setObjectName("sideLogout")
        self.logout_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.logout_btn.clicked.connect(self.logout_clicked.emit)
        self.logout_btn.hide()
        self.lay.addWidget(self.logout_btn, 0, Qt.AlignmentFlag.AlignHCenter)

    def apply_theme(self) -> None:
        """테마가 바뀌면 원 색을 다시 넣는다."""
        for btn in self.nav_btns:
            btn.apply_state(animate=False)
        self.avatar.setStyleSheet(
            f"background:{CURRENT.pink}; color:#FFFFFF; border-radius:18px; font-weight:800;"
        )

    def set_current(self, index: int) -> None:
        """지금 페이지 메뉴만 체크한다."""
        for i, btn in enumerate(self.nav_btns):
            btn.setChecked(i == index)
            btn.apply_state()

    def set_profile(self, name: str, sub: str, letter: str) -> None:
        """아래 아바타의 이름·보조·이니셜."""
        self.chip_name.setText(name)
        self.chip_sub.setText(sub)
        self.avatar.setText(letter)

    def set_logged_in(self, on: bool) -> None:
        """로그아웃을 보여 주고 첫 메뉴를 홈으로 바꾼다."""
        self.logout_btn.setVisible(on)
        if self.nav_btns:
            if on:
                self.nav_btns[0].set_caption("home", "홈")
            else:
                self.nav_btns[0].set_caption("login", "로그인")


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
