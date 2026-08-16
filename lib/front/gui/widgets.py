"""토스 톤 위젯 — V자 체크, 스위치, 성공 표시, 로딩."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from PyQt6.QtCore import (
    QEasingCurve,
    QRectF,
    Qt,
    QThread,
    QTimer,
    QVariantAnimation,
    pyqtSignal,
)
from PyQt6.QtGui import QColor, QFont, QPainter, QPainterPath, QPen
from PyQt6.QtWidgets import (
    QAbstractButton,
    QCheckBox,
    QFrame,
    QGraphicsDropShadowEffect,
    QHBoxLayout,
    QLabel,
    QVBoxLayout,
    QWidget,
)

from backend import BackendError
from style import CURRENT, Theme


class TossCheck(QCheckBox):
    """파란 칸 안에 V자 체크가 그려지는 토스형 체크박스."""

    def __init__(self, text: str = "", parent: QWidget | None = None) -> None:
        super().__init__(text, parent)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(26)
        self._tick = 1.0 if self.isChecked() else 0.0   # V자 그리는 진행도
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

    def sizeHint(self):  # noqa: N802
        hint = super().sizeHint()
        hint.setHeight(max(hint.height(), 26))
        hint.setWidth(hint.width() + 8)
        return hint

    def paintEvent(self, event) -> None:  # noqa: N802
        # 기본 체크 그림을 쓰지 않고 네모 + V자만 그린다
        del event
        t = CURRENT                                 # 현재 테마
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        box = 22                                    # 네모 한 변
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
        super().__init__(parent)
        self.setCheckable(True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedSize(50, 30)
        self._knob = 1.0 if self.isChecked() else 0.0   # 원 위치 (0=왼쪽)
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

    def paintEvent(self, event) -> None:  # noqa: N802
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
    """초록 원 안 V자. 로그인 성공 화면용."""

    def __init__(self, parent: QWidget | None = None, size: int = 72) -> None:
        super().__init__(parent)
        self.setFixedSize(size, size)
        self._tick = 0.0                            # 원·V자 등장 진행도
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(420)
        self._anim.setEasingCurve(QEasingCurve.Type.OutBack)
        self._anim.valueChanged.connect(self._set_tick)

    def _set_tick(self, value: object) -> None:
        self._tick = float(value)
        self.update()

    def play(self) -> None:
        """성공 화면이 열릴 때 V자를 처음부터 그린다."""
        self._anim.stop()
        self._tick = 0.0
        self._anim.setStartValue(0.0)
        self._anim.setEndValue(1.0)
        self._anim.start()
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        del event
        t = CURRENT
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        m = 3
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor(t.green))
        painter.setOpacity(0.2 + 0.8 * self._tick)
        painter.drawEllipse(m, m, self.width() - 2 * m, self.height() - 2 * m)
        painter.setOpacity(1.0)
        if self._tick < 0.15:
            return
        path = QPainterPath()
        w, h = self.width(), self.height()
        path.moveTo(w * 0.28, h * 0.52)
        path.lineTo(w * 0.44, h * 0.68)
        path.lineTo(w * 0.74, h * 0.34)
        pen = QPen(QColor("#FFFFFF"), 5.2, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin)
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.setOpacity(min(1.0, (self._tick - 0.15) / 0.85))
        painter.drawPath(path)


class TossSpinner(QWidget):
    """끝이 둥근 파란 원호가 돌아가는 로딩 표시."""

    def __init__(self, parent: QWidget | None = None, size: int = 40) -> None:
        super().__init__(parent)
        self._angle = 0
        self.setFixedSize(size, size)
        self._timer = QTimer(self)
        self._timer.setInterval(16)
        self._timer.timeout.connect(self._tick)

    def start(self) -> None:
        if not self._timer.isActive():
            self._timer.start()

    def stop(self) -> None:
        self._timer.stop()

    def _tick(self) -> None:
        self._angle = (self._angle + 8) % 360
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
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


class LoadingOverlay(QWidget):
    """반투명 막 + 가운데 카드. 조회 중 화면이 멈춘 것처럼 보이지 않게 한다."""

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.hide()

        card = QFrame()
        card.setObjectName("loadCard")
        card.setFixedWidth(280)
        self._card = card
        self._shadow = QGraphicsDropShadowEffect(card)
        card.setGraphicsEffect(self._shadow)

        self.spin = TossSpinner(card, 42)
        self.lab = QLabel("잠시만요")
        self.lab.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = QFont(self.lab.font())
        font.setPointSize(14)
        font.setBold(True)
        self.lab.setFont(font)
        self.sub = QLabel("화면이 멈추지 않았어요")
        self.sub.setAlignment(Qt.AlignmentFlag.AlignCenter)

        inner = QVBoxLayout(card)
        inner.setContentsMargins(28, 28, 28, 24)
        inner.setSpacing(12)
        inner.addWidget(self.spin, 0, Qt.AlignmentFlag.AlignHCenter)
        inner.addWidget(self.lab)
        inner.addWidget(self.sub)

        lay = QVBoxLayout(self)
        lay.addStretch(1)
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(card)
        row.addStretch(1)
        lay.addLayout(row)
        lay.addStretch(1)
        self.apply_theme(CURRENT)

    def apply_theme(self, theme: Theme) -> None:
        """라이트/다크에 맞춰 막과 글자색을 바꾼다."""
        self.setStyleSheet(f"background: {theme.overlay};")
        self.lab.setStyleSheet(f"color: {theme.text}; background: transparent;")
        self.sub.setStyleSheet(f"color: {theme.text_3}; background: transparent; font-size: 12px;")
        self._shadow.setBlurRadius(32)
        self._shadow.setOffset(0, 8)
        self._shadow.setColor(QColor(0, 0, 0, theme.shadow_a + 20))

    def show_msg(self, text: str) -> None:
        """로딩 카드를 띄운다."""
        self.lab.setText(text)
        self.spin.start()
        self.show()
        self.raise_()

    def hide_msg(self) -> None:
        """로딩 카드를 내린다."""
        self.spin.stop()
        self.hide()


class FnThread(QThread):
    """RPC 호출을 UI 스레드 밖에서 돌린다."""

    ok = pyqtSignal(object)                         # 성공 결과
    err = pyqtSignal(str)                           # 오류 문구

    def __init__(self, fn: Callable[[], Any]) -> None:
        super().__init__()
        self._fn = fn                               # 백그라운드에서 실행할 함수

    def run(self) -> None:
        # GUI 를 멈추지 않게 여기서만 네트워크·exe 호출을 한다
        try:
            self.ok.emit(self._fn())
        except BackendError as e:
            self.err.emit(str(e))
        except Exception as e:  # noqa: BLE001
            self.err.emit(str(e))
