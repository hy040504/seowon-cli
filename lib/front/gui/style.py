"""토스뱅크 톤. 라이트는 흰 카드, 다크는 앱 다크모드에 가까운 짙은 회색."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Theme:
    name: str                   # light / dark
    blue: str                   # 포인트 파랑
    blue_hover: str             # 버튼 호버
    blue_press: str             # 버튼 누름
    blue_soft: str              # 선택·아바타 배경
    bg: str                     # 창 바탕
    surface: str                # 카드·사이드바
    text: str                   # 본문
    text_2: str                 # 보조
    text_3: str                 # 캡션
    line: str                   # 구분선
    red: str                    # 오류
    green: str                  # 성공
    input_bg: str               # 입력칸·고스트 버튼
    table_alt: str              # 표 줄무늬
    overlay: str                # 로딩 막
    track: str                  # 스위치 꺼짐
    handle: str                 # 스위치 원
    check_border: str           # 체크 테두리
    spinner_track: str          # 스피너 바탕 원
    shadow_a: int               # 카드 그림자 알파


# 라이트: Toss grey100 배경 + 흰 카드 + blue500
LIGHT = Theme(
    name="light",
    blue="#3182F6",
    blue_hover="#1B64DA",
    blue_press="#1957C2",
    blue_soft="#E8F3FF",
    bg="#F2F4F6",
    surface="#FFFFFF",
    text="#191F28",
    text_2="#4E5968",
    text_3="#8B95A1",
    line="#E5E8EB",
    red="#F04452",
    green="#00C73C",
    input_bg="#F2F4F6",
    table_alt="#FAFBFC",
    overlay="rgba(25, 31, 40, 72)",
    track="#E5E8EB",
    handle="#FFFFFF",
    check_border="#D1D6DB",
    spinner_track="#E8F3FF",
    shadow_a=20,
)

# 다크: Toss 앱처럼 순흑이 아니라 #17171C 바탕, 카드는 한 단계 밝은 #202027
DARK = Theme(
    name="dark",
    blue="#3182F6",
    blue_hover="#4B93F7",
    blue_press="#1B64DA",
    blue_soft="#1B3358",
    bg="#17171C",
    surface="#202027",
    text="#F4F4F5",
    text_2="#B0B3BA",
    text_3="#8B8E97",
    line="#2E2E36",
    red="#F04452",
    green="#00D66B",
    input_bg="#2C2C35",
    table_alt="#25252D",
    overlay="rgba(0, 0, 0, 150)",
    track="#3A3A44",
    handle="#F4F4F5",
    check_border="#4A4A54",
    spinner_track="#1B3358",
    shadow_a=70,
)

CURRENT = LIGHT                # 지금 화면에 쓰는 테마


def set_current(theme: Theme) -> None:
    """위젯 paint 가 읽을 현재 테마를 바꾼다."""
    global CURRENT
    CURRENT = theme


def qss(t: Theme) -> str:
    """메인 창에 입힐 스타일시트."""
    return f"""
QMainWindow {{
    background: {t.bg};
    color: {t.text};
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Segoe UI', sans-serif;
    font-size: 14px;
}}
QWidget {{
    color: {t.text};
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Segoe UI', sans-serif;
    font-size: 14px;
}}
QWidget#sidebar {{
    background: {t.surface};
}}
QWidget#canvas {{
    background: {t.bg};
}}
QStackedWidget {{
    background: transparent;
}}
QWidget#card, QFrame#card {{
    background: {t.surface};
    border: none;
    border-radius: 20px;
}}
QWidget#loadCard {{
    background: {t.surface};
    border-radius: 20px;
}}
QLabel#brand {{
    font-size: 20px;
    font-weight: 800;
    color: {t.text};
    letter-spacing: -0.6px;
}}
QLabel#brandSub {{
    font-size: 13px;
    color: {t.text_3};
}}
QLabel#hello {{
    font-size: 26px;
    font-weight: 800;
    color: {t.text};
    letter-spacing: -0.8px;
}}
QLabel#successTitle {{
    font-size: 28px;
    font-weight: 800;
    color: {t.text};
    letter-spacing: -0.8px;
}}
QLabel#pageTitle {{
    font-size: 22px;
    font-weight: 800;
    color: {t.text};
    letter-spacing: -0.6px;
}}
QLabel#caption {{
    font-size: 13px;
    color: {t.text_3};
}}
QLabel#field {{
    font-size: 13px;
    font-weight: 700;
    color: {t.text_2};
}}
QLabel#hint {{
    color: {t.text_3};
    font-size: 13px;
}}
QLabel#profileName {{
    font-size: 14px;
    font-weight: 700;
    color: {t.text};
}}
QLabel#avatar {{
    background: {t.blue_soft};
    color: {t.blue};
    border-radius: 16px;
    font-weight: 800;
    qproperty-alignment: AlignCenter;
}}
QPushButton#navBtn {{
    text-align: left;
    padding: 13px 16px;
    border: none;
    border-radius: 14px;
    background: transparent;
    color: {t.text_2};
    font-size: 15px;
    font-weight: 700;
}}
QPushButton#navBtn:hover {{
    background: {t.bg};
    color: {t.text};
}}
QPushButton#navBtn:checked {{
    background: {t.blue_soft};
    color: {t.blue};
}}
QPushButton#primary {{
    background: {t.blue};
    color: #FFFFFF;
    border: none;
    border-radius: 14px;
    padding: 14px 18px;
    font-size: 16px;
    font-weight: 800;
}}
QPushButton#primary:hover {{ background: {t.blue_hover}; }}
QPushButton#primary:pressed {{ background: {t.blue_press}; }}
QPushButton#primary:disabled {{ background: #5A7FBF; color: #FFFFFF; }}
QPushButton#ghost {{
    background: {t.input_bg};
    color: {t.text};
    border: none;
    border-radius: 14px;
    padding: 14px 18px;
    font-size: 15px;
    font-weight: 700;
}}
QPushButton#ghost:hover {{ background: {t.line}; }}
QPushButton#ghost:disabled {{ color: {t.text_3}; }}
QLineEdit, QComboBox, QTextEdit {{
    background: {t.input_bg};
    border: 1px solid transparent;
    border-radius: 14px;
    padding: 12px 14px;
    color: {t.text};
    font-size: 15px;
    selection-background-color: {t.blue_soft};
    selection-color: {t.text};
}}
QLineEdit:focus, QComboBox:focus, QTextEdit:focus {{
    background: {t.surface};
    border: 1px solid {t.blue};
}}
QComboBox::drop-down {{ border: none; width: 28px; }}
QComboBox QAbstractItemView {{
    background: {t.surface};
    border: 1px solid {t.line};
    color: {t.text};
    selection-background-color: {t.blue_soft};
    selection-color: {t.text};
    padding: 6px;
}}
QTableWidget {{
    background: {t.surface};
    border: none;
    gridline-color: transparent;
    font-size: 14px;
    alternate-background-color: {t.table_alt};
    color: {t.text};
}}
QTableWidget::item {{
    padding: 10px 8px;
    border-bottom: 1px solid {t.bg};
    color: {t.text};
}}
QTableWidget::item:selected {{
    background: {t.blue_soft};
    color: {t.text};
}}
QHeaderView::section {{
    background: {t.surface};
    color: {t.text_3};
    border: none;
    border-bottom: 1px solid {t.line};
    padding: 10px 8px;
    font-weight: 700;
    font-size: 12px;
}}
QHeaderView::section:horizontal {{
    border-right: none;
}}
QTableCornerButton::section {{ background: {t.surface}; border: none; }}
QScrollBar:vertical {{
    background: transparent;
    width: 10px;
    margin: 4px 2px;
}}
QScrollBar::handle:vertical {{
    background: {t.check_border};
    border-radius: 4px;
    min-height: 32px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
QSplitter::handle {{ background: {t.line}; width: 1px; }}
QMessageBox {{
    background: {t.surface};
}}
QMessageBox QLabel {{
    color: {t.text};
    font-size: 14px;
}}
QMessageBox QPushButton {{
    background: {t.blue};
    color: #FFFFFF;
    border: none;
    border-radius: 12px;
    padding: 8px 16px;
    font-weight: 700;
    min-width: 72px;
}}
"""
