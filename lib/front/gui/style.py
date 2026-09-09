"""seowon-client-web 과 같은 토스 톤. 라이트는 흰 카드, 다크는 #17171C."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Theme:
    name: str                   # light / dark
    blue: str                   # 포인트 파랑 (#3182F6)
    blue_hover: str             # 버튼 호버
    blue_press: str             # 버튼 누름
    blue_soft: str              # 선택·아바타 배경
    accent: str                 # 홈 카드 강조선 (#0147FF)
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
    att_miss: str               # 출결 미학습
    att_ing: str                # 출결 진행
    att_done: str               # 출결 완료
    shadow_a: int               # 카드 그림자 알파


# 웹 public/style.css :root 와 같은 값
LIGHT = Theme(
    name="light",
    blue="#3182F6",
    blue_hover="#1B64DA",
    blue_press="#1957C2",
    blue_soft="#E8F3FF",
    accent="#0147FF",
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
    overlay="rgba(242, 244, 246, 210)",
    track="#E5E8EB",
    handle="#FFFFFF",
    check_border="#D1D6DB",
    spinner_track="#E8F3FF",
    att_miss="#FF2D2D",
    att_ing="#12B886",
    att_done="#00C73C",
    shadow_a=20,
)

# 웹 html[data-theme="dark"] 와 같은 값
DARK = Theme(
    name="dark",
    blue="#3182F6",
    blue_hover="#4B93F7",
    blue_press="#1B64DA",
    blue_soft="#1B3358",
    accent="#0147FF",
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
    overlay="rgba(15, 23, 42, 210)",
    track="#3A3A44",
    handle="#F4F4F5",
    check_border="#4A4A54",
    spinner_track="#1B3358",
    att_miss="#FF6B6B",
    att_ing="#2EE6C4",
    att_done="#39FF14",
    shadow_a=70,
)

CURRENT = LIGHT                # 지금 화면에 쓰는 테마


def set_current(theme: Theme) -> None:
    """위젯 paint 가 읽을 현재 테마를 바꾼다."""
    global CURRENT
    CURRENT = theme


def qss(t: Theme) -> str:
    """메인 창에 입힐 스타일시트. 웹 style.css 의 클래스명을 objectName 으로 옮겼다."""
    ghost_bg = "#E8ECEF" if t.name == "light" else t.input_bg
    ghost_border = "#D0D5DC" if t.name == "light" else "#3F3F4C"
    combo_border = "#B0B8C1" if t.name == "light" else "#6B6B76"
    pill_bg = t.surface
    pill_border = "rgba(0, 0, 0, 0.08)" if t.name == "light" else "rgba(255, 255, 255, 0.15)"
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
    border-right: 1px solid {t.line};
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
QFrame#chip {{
    background: {t.surface};
    border: 1px solid {t.line};
    border-radius: 16px;
}}
QLabel#brand, QLabel#brandText {{
    font-size: 18px;
    font-weight: 900;
    color: {t.text};
    letter-spacing: -0.5px;
}}
QLabel#brandSub, QLabel#brandVersion {{
    font-size: 12px;
    color: {t.text_3};
    font-weight: 600;
}}
QLabel#queryBadge {{
    background: rgba(239, 68, 68, 0.12);
    color: #EF4444;
    border: 1px solid rgba(239, 68, 68, 0.30);
    border-radius: 6px;
    font-size: 10px;
    font-weight: 800;
    padding: 2px 7px;
}}
QLabel#hello {{
    font-size: 22px;
    font-weight: 800;
    color: {t.text};
    letter-spacing: -0.4px;
}}
QLabel#successTitle {{
    font-size: 28px;
    font-weight: 800;
    color: {t.green};
    letter-spacing: -0.8px;
}}
QLabel#pageTitle {{
    font-size: 28px;
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
    font-size: 12px;
}}
QLabel#profileName, QLabel#chipName {{
    font-size: 13px;
    font-weight: 700;
    color: {t.text};
}}
QLabel#chipSub {{
    font-size: 12px;
    color: {t.text_3};
}}
QLabel#avatar {{
    background: {t.blue_soft};
    color: {t.blue};
    border-radius: 16px;
    font-weight: 800;
    qproperty-alignment: AlignCenter;
}}
QLabel#navEmoji {{
    font-size: 18px;
    background: transparent;
    qproperty-alignment: AlignCenter;
}}
QLabel#navLabel {{
    font-size: 15px;
    font-weight: 700;
    background: transparent;
}}
QPushButton#navBtn {{
    text-align: left;
    padding: 0;
    border: none;
    border-radius: 14px;
    background: transparent;
    color: {t.text};
    font-size: 15px;
    font-weight: 700;
}}
QPushButton#navBtn:hover {{
    background: {t.blue_soft};
    color: {t.blue};
}}
QPushButton#navBtn:checked {{
    background: {t.blue_soft};
    color: {t.blue};
    font-weight: 800;
}}
QPushButton#navBtn:checked QLabel#navLabel {{
    color: {t.blue};
    font-weight: 800;
}}
QPushButton#sideLogout {{
    border: none;
    border-radius: 14px;
    background: {t.input_bg};
    color: {t.text_2};
    font-weight: 700;
    padding: 0;
}}
QPushButton#sideLogout:hover {{
    background: rgba(239, 68, 68, 0.12);
    color: {t.red};
}}
QPushButton#primary {{
    background: {t.blue};
    color: #FFFFFF;
    border: none;
    border-radius: 14px;
    padding: 13px 16px;
    font-size: 15px;
    font-weight: 700;
}}
QPushButton#primary:hover {{ background: {t.blue_hover}; }}
QPushButton#primary:pressed {{ background: {t.blue_press}; }}
QPushButton#primary:disabled {{ background: #5A7FBF; color: #FFFFFF; }}
QPushButton#ghost {{
    background: {ghost_bg};
    color: {t.text};
    border: 1px solid {ghost_border};
    border-radius: 14px;
    padding: 13px 16px;
    font-size: 15px;
    font-weight: 700;
}}
QPushButton#ghost:hover {{
    background: {t.surface};
    border: 1px solid {t.blue};
}}
QPushButton#ghost:disabled {{ color: {t.text_3}; }}
QPushButton#heroBtn {{
    background: {t.accent};
    color: #FFFFFF;
    border: none;
    border-radius: 999px;
    padding: 12px 22px;
    font-size: 14px;
    font-weight: 700;
}}
QPushButton#heroBtn:hover {{ background: {t.blue_hover}; }}
QPushButton#heroGhost {{
    background: rgba(255, 255, 255, 0.10);
    color: #F1F5F9;
    border: 1px solid rgba(255, 255, 255, 0.20);
    border-radius: 999px;
    padding: 12px 22px;
    font-size: 14px;
    font-weight: 700;
}}
QPushButton#heroGhost:hover {{ background: rgba(255, 255, 255, 0.20); }}
QPushButton#pillBtn {{
    background: {t.blue};
    color: #FFFFFF;
    border: none;
    border-radius: 999px;
    padding: 10px 20px;
    font-size: 13px;
    font-weight: 700;
}}
QPushButton#jobAct {{
    background: {t.blue};
    color: #FFFFFF;
    border: none;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 800;
    padding: 0;
}}
QPushButton#jobAct:hover {{ background: {t.blue_hover}; }}
QLineEdit, QTextEdit {{
    background: {t.input_bg};
    border: 1px solid transparent;
    border-radius: 12px;
    padding: 12px 14px;
    color: {t.text};
    font-size: 15px;
    selection-background-color: {t.blue_soft};
    selection-color: {t.text};
}}
QLineEdit:focus, QTextEdit:focus {{
    background: {t.surface};
    border: 1px solid {t.blue};
}}
QComboBox {{
    background: {t.surface};
    border: 1.5px solid {combo_border};
    border-radius: 12px;
    padding: 11px 14px;
    color: {t.text};
    font-size: 15px;
    min-width: 220px;
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
    border-radius: 20px;
    padding: 8px 18px;
    font-size: 15px;
    font-weight: 700;
}}
QFrame#toast {{
    background: {t.surface};
    border: 1px solid {t.line};
    border-radius: 14px;
}}
QFrame#toast[kind="error"] {{
    background: rgba(240, 68, 82, 0.12);
    border: 1px solid rgba(240, 68, 82, 0.35);
}}
QLabel#toastMsg {{
    font-size: 14px;
    font-weight: 700;
    color: {t.text};
}}
QFrame#jobList {{
    background: {t.surface};
    border-radius: 20px;
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
QLabel#jobTitle {{
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.4px;
    color: {t.text};
}}
QLabel#jobMeta {{
    font-size: 14px;
    color: {t.text_3};
}}
QLabel#jobHot {{
    font-size: 13px;
    font-weight: 700;
    color: {t.text};
}}
QLabel#badge {{
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 12px;
    font-weight: 700;
    background: {t.blue_soft};
    color: {t.blue};
}}
QLabel#badge[kind="due"] {{
    background: {t.blue_soft};
    color: {t.blue};
}}
QLabel#badge[kind="miss"] {{
    background: rgba(240, 68, 82, 0.12);
    color: {t.red};
}}
QLabel#badge[kind="done"] {{
    background: rgba(0, 199, 60, 0.12);
    color: {t.green};
}}
QLabel#badge[kind="watch"] {{
    background: rgba(18, 184, 134, 0.14);
    color: {t.att_ing};
}}
QLabel#badge[kind="demo"] {{
    background: {t.input_bg};
    color: {t.text_2};
}}
QFrame#courseCard {{
    background: {t.surface};
    border: 1.5px solid rgba(49, 130, 246, 0.40);
    border-radius: 24px;
}}
QLabel#emptyIcon {{
    font-size: 34px;
    background: {t.blue_soft};
    border-radius: 22px;
    qproperty-alignment: AlignCenter;
}}
QLabel#emptyTitle {{
    font-size: 20px;
    font-weight: 800;
    color: {t.text};
    letter-spacing: -0.4px;
}}
QLabel#emptyDesc {{
    font-size: 14px;
    color: {t.text_2};
}}
QFrame#homeHero {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #1E293B, stop:1 #0F172A);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 28px;
}}
QLabel#heroBadge {{
    background: rgba(49, 130, 246, 0.20);
    color: #60A5FA;
    border: 1px solid rgba(96, 165, 250, 0.30);
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 700;
}}
QLabel#heroTitle {{
    font-size: 26px;
    font-weight: 800;
    color: #FFFFFF;
    letter-spacing: -0.5px;
}}
QLabel#heroSub {{
    font-size: 15px;
    color: #94A3B8;
}}
QFrame#featBlue {{
    background: {t.accent};
    border: none;
    border-radius: 28px;
}}
QFrame#featDark {{
    background: #1A1A1A;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 28px;
}}
QFrame#featSurface {{
    background: {t.surface};
    border: 1px solid {t.line};
    border-radius: 28px;
}}
QLabel#featIcon {{ font-size: 32px; background: transparent; }}
QLabel#featTitle {{
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.4px;
    background: transparent;
}}
QLabel#featSub {{
    font-size: 13px;
    background: transparent;
}}
QFrame#featBlue QLabel#featTitle, QFrame#featBlue QLabel#featIcon {{ color: #FFFFFF; }}
QFrame#featBlue QLabel#featSub {{ color: rgba(255, 255, 255, 0.88); }}
QFrame#featDark QLabel#featTitle, QFrame#featDark QLabel#featIcon {{ color: #FFFFFF; }}
QFrame#featDark QLabel#featSub {{ color: #94A3B8; }}
QFrame#featSurface QLabel#featTitle, QFrame#featSurface QLabel#featIcon {{ color: {t.text}; }}
QFrame#featSurface QLabel#featSub {{ color: {t.text_2}; }}
QFrame#statBox {{
    background: {t.input_bg};
    border-radius: 10px;
}}
QLabel#statLabel {{
    font-size: 12px;
    color: {t.text_3};
    background: transparent;
}}
QLabel#statValue {{
    font-size: 22px;
    font-weight: 800;
    color: {t.text};
    background: transparent;
}}
QFrame#infoNotice {{
    background: {t.blue_soft};
    border-left: 4px solid {t.blue};
    border-radius: 10px;
}}
QLabel#infoNoticeText {{
    font-size: 13px;
    color: {t.text_2};
    font-weight: 500;
    background: transparent;
}}
QLabel#infoPill {{
    background: {t.input_bg};
    color: {t.text_2};
    border: 1px solid {t.line};
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
}}
QLabel#infoPill[accent="true"] {{
    background: {t.blue_soft};
    color: {t.blue};
    border: 1px solid rgba(49, 130, 246, 0.25);
}}
QFrame#todoSummary {{
    background: {t.surface};
    border: 1px solid {t.line};
    border-radius: 20px;
}}
QLabel#todoBadge {{
    background: rgba(49, 130, 246, 0.12);
    color: {t.blue};
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 13px;
    font-weight: 800;
}}
QLabel#todoBadge[done="true"] {{
    background: rgba(0, 199, 60, 0.12);
    color: {t.green};
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
    border-radius: 12px;
    padding: 8px 16px;
    font-weight: 700;
    min-width: 72px;
}}
"""
