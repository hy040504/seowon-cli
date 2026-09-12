"""흰 선(스트로크) 아이콘. 이모지 대신 태블릿 목업처럼 얇은 로고 선을 그린다."""

from __future__ import annotations

from PyQt6.QtCore import QPointF, QRectF, Qt
from PyQt6.QtGui import QColor, QPainter, QPainterPath, QPaintEvent, QPen
from PyQt6.QtWidgets import QWidget


def lerp_color(a: QColor, b: QColor, t: float) -> QColor:
    """두 색을 t 만큼 섞는다."""
    t = max(0.0, min(1.0, t))
    return QColor(
        int(a.red() + (b.red() - a.red()) * t),
        int(a.green() + (b.green() - a.green()) * t),
        int(a.blue() + (b.blue() - a.blue()) * t),
        int(a.alpha() + (b.alpha() - a.alpha()) * t),
    )


def _draw_home(p: QPainter) -> None:
    """집 윤곽."""
    path = QPainterPath()
    path.moveTo(4.0, 11.2)
    path.lineTo(12.0, 3.6)
    path.lineTo(20.0, 11.2)
    p.drawPath(path)
    p.drawLine(QPointF(6.4, 10.4), QPointF(6.4, 20.2))
    p.drawLine(QPointF(6.4, 20.2), QPointF(17.6, 20.2))
    p.drawLine(QPointF(17.6, 20.2), QPointF(17.6, 10.4))


def _draw_login(p: QPainter) -> None:
    """열쇠. 고리 + 막대 + 이빨."""
    p.drawEllipse(QRectF(3.2, 7.2, 9.6, 9.6))
    p.drawEllipse(QRectF(5.8, 9.8, 4.4, 4.4))
    p.drawLine(QPointF(12.8, 12.0), QPointF(20.8, 12.0))
    p.drawLine(QPointF(17.6, 12.0), QPointF(17.6, 15.8))
    p.drawLine(QPointF(20.8, 12.0), QPointF(20.8, 17.0))


def _draw_todo(p: QPainter) -> None:
    """체크 목록."""
    p.drawRoundedRect(QRectF(4.0, 3.4, 16.0, 17.2), 2.2, 2.2)
    p.drawLine(QPointF(6.6, 8.8), QPointF(8.2, 10.6))
    p.drawLine(QPointF(8.2, 10.6), QPointF(10.8, 7.4))
    p.drawLine(QPointF(12.4, 9.0), QPointF(18.0, 9.0))
    p.drawLine(QPointF(6.6, 14.0), QPointF(8.2, 15.8))
    p.drawLine(QPointF(8.2, 15.8), QPointF(10.8, 12.6))
    p.drawLine(QPointF(12.4, 14.2), QPointF(18.0, 14.2))


def _draw_assignment(p: QPainter) -> None:
    """접힌 문서."""
    path = QPainterPath()
    path.moveTo(7.0, 3.6)
    path.lineTo(14.2, 3.6)
    path.lineTo(19.0, 8.4)
    path.lineTo(19.0, 20.4)
    path.lineTo(7.0, 20.4)
    path.closeSubpath()
    p.drawPath(path)
    p.drawLine(QPointF(14.2, 3.6), QPointF(14.2, 8.4))
    p.drawLine(QPointF(14.2, 8.4), QPointF(19.0, 8.4))
    p.drawLine(QPointF(10.0, 12.2), QPointF(16.2, 12.2))
    p.drawLine(QPointF(10.0, 15.6), QPointF(16.2, 15.6))


def _draw_lesson(p: QPainter) -> None:
    """모니터."""
    p.drawRoundedRect(QRectF(3.2, 4.4, 17.6, 11.6), 2.0, 2.0)
    p.drawLine(QPointF(12.0, 16.0), QPointF(12.0, 19.4))
    p.drawLine(QPointF(8.0, 19.4), QPointF(16.0, 19.4))


def _draw_status(p: QPainter) -> None:
    """막대 그래프."""
    p.drawLine(QPointF(7.0, 18.4), QPointF(7.0, 11.0))
    p.drawLine(QPointF(12.0, 18.4), QPointF(12.0, 5.6))
    p.drawLine(QPointF(17.0, 18.4), QPointF(17.0, 8.4))


def _draw_settings(p: QPainter) -> None:
    """톱니바퀴. 해/반짝이와 구별되게 고리와 이빨을 그린다."""
    p.save()
    p.translate(12.0, 12.0)
    for i in range(6):
        p.save()
        p.rotate(i * 60.0)
        p.drawRoundedRect(QRectF(-1.2, -9.5, 2.4, 3.8), 0.6, 0.6)
        p.restore()
    p.drawEllipse(QRectF(-5.5, -5.5, 11.0, 11.0))
    p.drawEllipse(QRectF(-2.3, -2.3, 4.6, 4.6))
    p.restore()


def _draw_info(p: QPainter) -> None:
    """원 안 i."""
    p.drawEllipse(QRectF(3.4, 3.4, 17.2, 17.2))
    p.drawLine(QPointF(12.0, 11.0), QPointF(12.0, 16.6))
    p.drawEllipse(QRectF(11.15, 7.1, 1.7, 1.7))


def _draw_sparkle(p: QPainter) -> None:
    """네 방향 반짝임."""
    p.drawLine(QPointF(12.0, 3.4), QPointF(12.0, 20.6))
    p.drawLine(QPointF(3.4, 12.0), QPointF(20.6, 12.0))
    p.drawLine(QPointF(6.4, 6.4), QPointF(17.6, 17.6))
    p.drawLine(QPointF(17.6, 6.4), QPointF(6.4, 17.6))


def _draw_warn(p: QPainter) -> None:
    """경고 삼각형."""
    path = QPainterPath()
    path.moveTo(12.0, 3.8)
    path.lineTo(21.2, 19.6)
    path.lineTo(2.8, 19.6)
    path.closeSubpath()
    p.drawPath(path)
    p.drawLine(QPointF(12.0, 9.2), QPointF(12.0, 13.8))
    p.drawLine(QPointF(12.0, 16.4), QPointF(12.0, 17.2))


def _draw_user(p: QPainter) -> None:
    """사람."""
    p.drawEllipse(QRectF(8.0, 3.8, 8.0, 8.0))
    p.drawArc(QRectF(4.6, 13.2, 14.8, 12.0), 0, 180 * 16)


def _draw_logout(p: QPainter) -> None:
    """문과 나가는 화살표."""
    p.drawRoundedRect(QRectF(3.6, 4.2, 10.2, 15.6), 1.6, 1.6)
    p.drawLine(QPointF(12.4, 12.0), QPointF(20.6, 12.0))
    p.drawLine(QPointF(17.4, 8.8), QPointF(20.6, 12.0))
    p.drawLine(QPointF(17.4, 15.2), QPointF(20.6, 12.0))


def _draw_search(p: QPainter) -> None:
    """돋보기."""
    p.drawEllipse(QRectF(3.8, 3.8, 11.6, 11.6))
    p.drawLine(QPointF(13.4, 13.4), QPointF(20.2, 20.2))


def _draw_pin(p: QPainter) -> None:
    """핀."""
    p.drawEllipse(QRectF(8.6, 3.6, 6.8, 6.8))
    p.drawLine(QPointF(12.0, 10.4), QPointF(12.0, 20.4))
    p.drawLine(QPointF(8.4, 14.6), QPointF(15.6, 14.6))


_DRAW = {
    "home": _draw_home,
    "login": _draw_login,
    "todo": _draw_todo,
    "assignment": _draw_assignment,
    "lesson": _draw_lesson,
    "status": _draw_status,
    "settings": _draw_settings,
    "info": _draw_info,
    "sparkle": _draw_sparkle,
    "warn": _draw_warn,
    "user": _draw_user,
    "logout": _draw_logout,
    "search": _draw_search,
    "pin": _draw_pin,
}


class LineIcon(QWidget):
    """24 격자 기준의 흰 선 아이콘. 선택 원은 well 로 그린다."""

    def __init__(
        self,
        name: str,
        *,
        size: int = 24,
        color: str = "#FFFFFF",
        stroke: float = 1.75,
        parent: QWidget | None = None,
    ) -> None:
        """아이콘 이름과 크기, 선 색."""
        super().__init__(parent)
        self._name = name
        self._color = QColor(color)
        self._stroke = stroke
        self._well = QColor("#6B7CFF")
        self._well_on = 0.0
        self.setFixedSize(size, size)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)

    def set_name(self, name: str) -> None:
        """아이콘 종류를 바꾼다."""
        if name == self._name:
            return
        self._name = name
        self.update()

    def set_color(self, color: str | QColor) -> None:
        """선 색."""
        self._color = QColor(color)
        self.update()

    def set_well(self, color: str | QColor, amount: float) -> None:
        """뒤에 까는 원의 색과 진하기(0~1)."""
        self._well = QColor(color)
        self._well_on = max(0.0, min(1.0, amount))
        self.update()

    def paintEvent(self, event: QPaintEvent | None) -> None:  # noqa: N802
        """원형 웰이 있으면 그린 뒤, 가운데에 선 아이콘을 올린다."""
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        w, h = self.width(), self.height()
        side = min(w, h)
        if self._well_on > 0.01:
            fill = QColor(self._well)
            fill.setAlpha(int(255 * self._well_on))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(fill)
            scale = 0.84 + 0.16 * self._well_on
            well = side * scale
            painter.drawEllipse(QRectF((w - well) / 2, (h - well) / 2, well, well))

        pad = side * (0.27 if self._well_on > 0.2 else 0.16)
        box = max(8.0, side - 2 * pad)
        painter.translate(w / 2, h / 2)
        painter.scale(box / 24.0, box / 24.0)
        painter.translate(-12.0, -12.0)
        pen = QPen(self._color, self._stroke, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin)
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        fn = _DRAW.get(self._name, _draw_info)
        fn(painter)
