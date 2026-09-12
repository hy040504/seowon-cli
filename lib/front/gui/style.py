"""스마트홈 태블릿 UI 톤. 연한 라벤더 레일 + 파랑/핑크 타일."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Theme:
    """라이트는 태블릿 목업, 다크는 같은 구조를 남색으로.

    Attributes:
        name: ``light`` 또는 ``dark``.
        blue: 기본 포인트.
        pink: 강조 포인트.
        bg: 창 배경.
        surface: 카드 배경.
        text: 본문 색.
        sidebar: 왼쪽 레일.
    """

    name: str
    blue: str
    blue_hover: str
    blue_press: str
    blue_soft: str
    accent: str
    pink: str
    pink_soft: str
    bg: str
    surface: str
    text: str
    text_2: str
    text_3: str
    line: str
    red: str
    green: str
    input_bg: str
    table_alt: str
    overlay: str
    track: str
    handle: str
    check_border: str
    spinner_track: str
    att_miss: str
    att_ing: str
    att_done: str
    shadow_a: int
    sidebar: str
    sidebar_text: str


LIGHT = Theme(
    name="light",
    blue="#6B7CFF",
    blue_hover="#5A6BF0",
    blue_press="#4C5BE0",
    blue_soft="#E8ECFF",
    accent="#6B7CFF",
    pink="#FF6B9D",
    pink_soft="#FFE4EE",
    bg="#EEF2FF",
    surface="#FFFFFF",
    text="#2F3B8F",
    text_2="#5A6799",
    text_3="#8B95C2",
    line="#E3E8F8",
    red="#F06292",
    green="#3DDC84",
    input_bg="#F4F6FF",
    table_alt="#F7F9FF",
    overlay="rgba(238, 242, 255, 210)",
    track="#DDE3F7",
    handle="#FFFFFF",
    check_border="#C9D2F0",
    spinner_track="#E8ECFF",
    att_miss="#F06292",
    att_ing="#6B7CFF",
    att_done="#3DDC84",
    shadow_a=22,
    sidebar="#D9E4FF",
    sidebar_text="#4A5BB5",
)

DARK = Theme(
    name="dark",
    blue="#8B9BFF",
    blue_hover="#A0ADFF",
    blue_press="#6B7CFF",
    blue_soft="#2A3360",
    accent="#8B9BFF",
    pink="#FF8FB5",
    pink_soft="#4A2A38",
    bg="#1A1F3A",
    surface="#252C52",
    text="#F0F2FF",
    text_2="#C2C8E8",
    text_3="#8B93C0",
    line="#343C68",
    red="#FF8FB5",
    green="#3DDC84",
    input_bg="#2E3660",
    table_alt="#22284A",
    overlay="rgba(16, 20, 40, 210)",
    track="#3A4270",
    handle="#F0F2FF",
    check_border="#4A5280",
    spinner_track="#2A3360",
    att_miss="#FF8FB5",
    att_ing="#8B9BFF",
    att_done="#3DDC84",
    shadow_a=70,
    sidebar="#22284A",
    sidebar_text="#C2C8E8",
)

CURRENT = LIGHT


def set_current(theme: Theme) -> None:
    """위젯 paint 가 읽을 현재 테마를 바꾼다.

    Args:
        theme: ``LIGHT`` 또는 ``DARK``.
    """
    global CURRENT
    CURRENT = theme


def qss(t: Theme) -> str:
    """태블릿 목업처럼 둥근 카드와 파랑/핑크 포인트를 입힌다.

    Args:
        t: 적용할 테마.

    Returns:
        ``QApplication.setStyleSheet`` 에 넣을 QSS.
    """
    ghost_bg = "#EEF2FF" if t.name == "light" else t.input_bg
    ghost_border = "#D5DCF5" if t.name == "light" else "#4A5280"
    combo_border = "#C9D2F0" if t.name == "light" else "#5A6490"
    pill_bg = t.surface
    pill_border = "rgba(47, 59, 143, 0.08)" if t.name == "light" else "rgba(255, 255, 255, 0.12)"
    toast_bg = t.blue
    toast_err = t.pink
    toast_ok = "#2E9B57"
    return f"""
QMainWindow {{
    background: {t.bg};
    color: {t.text};
    font-family: 'Malgun Gothic', 'Segoe UI', sans-serif;
    font-size: 14px;
}}
QWidget {{
    color: {t.text};
    font-family: 'Malgun Gothic', 'Segoe UI', sans-serif;
    font-size: 14px;
}}
QWidget#sidebar {{
    background: {t.sidebar};
    border-right: none;
}}
QWidget#sidebar QLabel {{
    background: transparent;
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
    border-radius: 24px;
}}
QFrame#chip {{
    background: transparent;
    border: none;
}}
QLabel#brand, QLabel#brandText {{
    font-size: 13px;
    font-weight: 800;
    color: {t.sidebar_text};
    letter-spacing: -0.2px;
}}
QLabel#brandSub, QLabel#brandVersion {{
    font-size: 10px;
    color: {t.sidebar_text};
    font-weight: 600;
}}
QLabel#queryBadge {{
    background: {t.pink_soft};
    color: {t.pink};
    border: none;
    border-radius: 8px;
    font-size: 9px;
    font-weight: 800;
    padding: 2px 6px;
}}
QLabel#hello {{
    font-size: 28px;
    font-weight: 800;
    color: {t.text};
    letter-spacing: -0.6px;
}}
QLabel#successTitle {{
    font-size: 26px;
    font-weight: 800;
    color: {t.green};
}}
QLabel#pageTitle {{
    font-size: 26px;
    font-weight: 800;
    color: {t.text};
    letter-spacing: -0.4px;
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
    font-size: 12px;
}}
QLabel#profileName, QLabel#chipName {{
    font-size: 13px;
    font-weight: 700;
    color: {t.text};
}}
QLabel#chipSub {{
    font-size: 11px;
    color: {t.text_3};
}}
QLabel#avatar {{
    background: {t.pink};
    color: #FFFFFF;
    border-radius: 999px;
    font-weight: 800;
    qproperty-alignment: AlignCenter;
}}
QLabel#brandLogo {{
    background: transparent;
    border: none;
}}
QLabel#navEmoji, QLabel#navIconWell {{
    font-size: 18px;
    background: transparent;
    color: {t.sidebar_text};
    qproperty-alignment: AlignCenter;
}}
QLabel#navLabel {{
    font-size: 11px;
    font-weight: 700;
    color: {t.sidebar_text};
    background: transparent;
    qproperty-alignment: AlignCenter;
}}
QPushButton#navBtn {{
    text-align: center;
    padding: 0;
    border: none;
    border-radius: 28px;
    background: transparent;
    color: {t.sidebar_text};
}}
QPushButton#navBtn:hover {{
    background: rgba(255, 255, 255, 0.35);
}}
QPushButton#navBtn:checked {{
    background: transparent;
}}
QPushButton#sideLogout {{
    border: none;
    border-radius: 12px;
    background: transparent;
    color: {t.sidebar_text};
    font-weight: 700;
    font-size: 11px;
    padding: 6px 4px;
}}
QPushButton#sideLogout:hover {{
    color: {t.pink};
}}
QPushButton#primary {{
    background: {t.blue};
    color: #FFFFFF;
    border: none;
    border-radius: 18px;
    padding: 12px 18px;
    font-size: 14px;
    font-weight: 800;
}}
QPushButton#primary:hover {{ background: {t.blue_hover}; color: #FFFFFF; }}
QPushButton#primary:pressed {{ background: {t.blue_press}; color: #FFFFFF; }}
QPushButton#primary:disabled {{ background: #A8B2F0; color: #FFFFFF; }}
QPushButton#ghost {{
    background: {ghost_bg};
    color: {t.text};
    border: 1px solid {ghost_border};
    border-radius: 18px;
    padding: 12px 18px;
    font-size: 14px;
    font-weight: 700;
}}
QPushButton#ghost:hover {{
    background: {t.surface};
    border: 1px solid {t.blue};
    color: {t.text};
}}
QPushButton#ghost:disabled {{ color: {t.text_3}; }}
QPushButton#heroBtn {{
    background: {t.pink};
    color: #FFFFFF;
    border: none;
    border-radius: 999px;
    padding: 10px 18px;
    font-size: 13px;
    font-weight: 800;
}}
QPushButton#heroBtn:hover {{ background: #FF5A90; color: #FFFFFF; }}
QPushButton#pillBtn {{
    background: rgba(255, 255, 255, 0.28);
    color: #FFFFFF;
    border: none;
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 11px;
    font-weight: 800;
}}
QPushButton#shortBtn {{
    background: {t.blue};
    color: #FFFFFF;
    border: none;
    border-radius: 14px;
    padding: 4px 16px;
    font-size: 12px;
    font-weight: 800;
    min-width: 64px;
    min-height: 32px;
}}
QPushButton#shortBtn:hover {{ background: {t.blue_hover}; color: #FFFFFF; }}
QPushButton#jobAct {{
    background: {t.blue};
    color: #FFFFFF;
    border: none;
    border-radius: 14px;
    font-size: 13px;
    font-weight: 800;
    padding: 6px 14px;
    min-width: 72px;
}}
QPushButton#jobAct:hover {{ background: {t.blue_hover}; color: #FFFFFF; }}
QPushButton#roundAct {{
    background: {t.pink};
    color: #FFFFFF;
    border: none;
    border-radius: 26px;
    padding: 0;
    font-size: 18px;
    font-weight: 800;
}}
QPushButton#roundAct:hover {{ background: #FF5A90; }}
QLineEdit, QTextEdit {{
    background: {t.input_bg};
    border: 1px solid transparent;
    border-radius: 18px;
    padding: 11px 16px;
    color: {t.text};
    font-size: 14px;
    selection-background-color: {t.blue_soft};
    selection-color: {t.text};
}}
QLineEdit:focus, QTextEdit:focus {{
    background: {t.surface};
    border: 1px solid {t.blue};
    color: {t.text};
}}
QComboBox {{
    background: {t.surface};
    border: 1.5px solid {combo_border};
    border-radius: 18px;
    padding: 10px 14px;
    color: {t.text};
    font-size: 14px;
    min-width: 200px;
}}
QComboBox:focus {{
    border: 1.5px solid {t.blue};
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
QLabel#loadPill {{
    background: {pill_bg};
    color: {t.text};
    border: 1px solid {pill_border};
    border-radius: 18px;
    padding: 8px 18px;
    font-size: 14px;
    font-weight: 700;
}}
QFrame#toast {{
    background: {toast_bg};
    border: none;
    border-radius: 16px;
}}
QFrame#toast[kind="error"] {{
    background: {toast_err};
}}
QFrame#toast[kind="success"] {{
    background: {toast_ok};
}}
QLabel#toastMsg {{
    font-size: 14px;
    font-weight: 700;
    color: #FFFFFF;
}}
QFrame#jobList {{
    background: {t.surface};
    border-radius: 24px;
    border: none;
}}
QFrame#jobRow {{
    background: transparent;
    border: none;
    border-bottom: 1px solid {t.line};
}}
QFrame#jobRow:hover {{
    background: {t.input_bg};
}}
QFrame#jobRow[selected="true"] {{
    background: {t.blue_soft};
}}
QFrame#jobItem {{
    background: transparent;
    border: none;
}}
QWidget#jobExpand {{
    background: {t.surface};
    border: none;
    border-bottom: 1px solid {t.line};
}}
QTextEdit#jobBody {{
    min-height: 88px;
    max-height: 180px;
}}
QLabel#jobTitle {{
    font-size: 16px;
    font-weight: 700;
    color: {t.text};
}}
QLabel#jobMeta {{
    font-size: 13px;
    color: {t.text_3};
}}
QLabel#jobHot {{
    font-size: 13px;
    font-weight: 700;
    color: {t.text};
}}
QLabel#badge {{
    border-radius: 8px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 800;
    background: {t.blue_soft};
    color: {t.blue};
}}
QLabel#badge[kind="due"] {{
    background: {t.blue_soft};
    color: {t.blue};
}}
QLabel#badge[kind="miss"] {{
    background: {t.pink_soft};
    color: {t.pink};
}}
QLabel#badge[kind="done"] {{
    background: rgba(61, 220, 132, 0.16);
    color: {t.green};
}}
QLabel#badge[kind="watch"] {{
    background: {t.blue_soft};
    color: {t.blue};
}}
QLabel#badge[kind="demo"] {{
    background: {t.input_bg};
    color: {t.text_2};
}}
QFrame#courseCard {{
    background: {t.surface};
    border: none;
    border-radius: 24px;
}}
QLabel#emptyIcon, QFrame#emptyIcon {{
    font-size: 28px;
    background: {t.blue_soft};
    color: {t.blue};
    border-radius: 36px;
    qproperty-alignment: AlignCenter;
}}
QLabel#emptyTitle {{
    font-size: 18px;
    font-weight: 800;
    color: {t.text};
}}
QLabel#emptyDesc {{
    font-size: 13px;
    color: {t.text_2};
}}
QFrame#homeHero {{
    background: transparent;
    border: none;
}}
QLabel#heroTitle {{
    font-size: 28px;
    font-weight: 800;
    color: {t.text};
    letter-spacing: -0.6px;
}}
QLabel#heroSub {{
    font-size: 14px;
    color: {t.text_3};
}}
QLabel#topDate {{
    font-size: 13px;
    font-weight: 700;
    color: {t.text_2};
}}
QFrame#featBlue, QFrame#dashBlue {{
    background: {t.blue};
    border: none;
    border-radius: 24px;
}}
QFrame#featDark, QFrame#dashPink {{
    background: {t.pink};
    border: none;
    border-radius: 24px;
}}
QFrame#featSurface, QFrame#dashWhite {{
    background: {t.surface};
    border: none;
    border-radius: 24px;
}}
QLabel#featIcon {{
    font-size: 26px;
    background: transparent;
}}
QLabel#featTitle {{
    font-size: 15px;
    font-weight: 800;
    background: transparent;
}}
QLabel#featSub {{
    font-size: 12px;
    background: transparent;
}}
QFrame#featBlue QLabel#featTitle, QFrame#featBlue QLabel#featIcon,
QFrame#dashBlue QLabel#featTitle, QFrame#dashBlue QLabel#featIcon {{
    color: #FFFFFF;
}}
QFrame#featBlue QLabel#featSub, QFrame#dashBlue QLabel#featSub {{
    color: rgba(255, 255, 255, 0.90);
}}
QFrame#featDark QLabel#featTitle, QFrame#featDark QLabel#featIcon,
QFrame#dashPink QLabel#featTitle, QFrame#dashPink QLabel#featIcon {{
    color: #FFFFFF;
}}
QFrame#featDark QLabel#featSub, QFrame#dashPink QLabel#featSub {{
    color: rgba(255, 255, 255, 0.92);
}}
QFrame#featSurface QLabel#featTitle, QFrame#featSurface QLabel#featIcon,
QFrame#dashWhite QLabel#featTitle, QFrame#dashWhite QLabel#featIcon {{
    color: {t.text};
}}
QFrame#featSurface QLabel#featSub, QFrame#dashWhite QLabel#featSub {{
    color: {t.text_2};
}}
QFrame#statBox {{
    background: {t.surface};
    border-radius: 20px;
}}
QLabel#statLabel {{
    font-size: 12px;
    font-weight: 700;
    color: {t.pink};
    background: transparent;
}}
QLabel#statValue {{
    font-size: 26px;
    font-weight: 800;
    color: {t.text};
    background: transparent;
}}
QFrame#infoNotice {{
    background: {t.pink_soft};
    border-left: 4px solid {t.pink};
    border-radius: 14px;
}}
QLabel#infoNoticeText {{
    font-size: 13px;
    color: {t.text};
    font-weight: 500;
    background: transparent;
}}
QLabel#infoPill {{
    background: {t.input_bg};
    color: {t.text_2};
    border: none;
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 700;
}}
QLabel#infoPill[accent="true"] {{
    background: {t.blue_soft};
    color: {t.blue};
}}
QFrame#todoSummary, QFrame#sidePanel {{
    background: {t.surface};
    border: none;
    border-radius: 24px;
}}
QLabel#todoBadge {{
    background: {t.blue_soft};
    color: {t.blue};
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 800;
}}
QLabel#todoBadge[done="true"] {{
    background: rgba(61, 220, 132, 0.16);
    color: {t.green};
}}
QLabel#panelTitle {{
    font-size: 15px;
    font-weight: 800;
    color: {t.text};
}}
QLabel#shortName {{
    font-size: 14px;
    font-weight: 700;
    color: {t.text};
}}
QLabel#memberName {{
    font-size: 15px;
    font-weight: 800;
    color: {t.text};
}}
QLabel#memberMeta {{
    font-size: 12px;
    color: {t.text_2};
}}
QLabel#memberHint {{
    font-size: 11px;
    color: {t.text_3};
}}
QScrollArea {{
    border: none;
    background: transparent;
}}
QScrollArea > QWidget > QWidget {{
    background: transparent;
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
QScrollBar:horizontal {{
    background: transparent;
    height: 10px;
    margin: 2px 4px;
}}
QScrollBar::handle:horizontal {{
    background: {t.check_border};
    border-radius: 4px;
    min-width: 32px;
}}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{ width: 0; }}
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
    border-radius: 14px;
    padding: 8px 16px;
    font-weight: 800;
    min-width: 72px;
}}
"""
