"""토스뱅크에 가까운 밝은 카드 UI."""

# Toss 컬러 (앱·웹에서 쓰는 톤)
BLUE = "#3182F6"
BLUE_HOVER = "#1B64DA"
BLUE_SOFT = "#E8F3FF"
BG = "#F2F4F6"
WHITE = "#FFFFFF"
TEXT = "#191F28"
TEXT_2 = "#4E5968"
TEXT_3 = "#8B95A1"
LINE = "#E5E8EB"
RED = "#F04452"
GREEN = "#00C73C"

QSS = f"""
QMainWindow {{
    background: {BG};
    color: {TEXT};
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Segoe UI', sans-serif;
    font-size: 14px;
}}
QWidget {{
    color: {TEXT};
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Segoe UI', sans-serif;
    font-size: 14px;
}}
QWidget#sidebar {{
    background: {WHITE};
}}
QWidget#canvas {{
    background: {BG};
}}
QWidget#card, QFrame#card {{
    background: {WHITE};
    border: none;
    border-radius: 20px;
}}
QWidget#loadCard {{
    background: {WHITE};
    border-radius: 20px;
}}
QLabel#brand {{
    font-size: 20px;
    font-weight: 800;
    color: {TEXT};
    letter-spacing: -0.6px;
}}
QLabel#brandSub {{
    font-size: 13px;
    color: {TEXT_3};
}}
QLabel#hello {{
    font-size: 26px;
    font-weight: 800;
    color: {TEXT};
    letter-spacing: -0.8px;
}}
QLabel#pageTitle {{
    font-size: 22px;
    font-weight: 800;
    color: {TEXT};
    letter-spacing: -0.6px;
}}
QLabel#caption {{
    font-size: 13px;
    color: {TEXT_3};
}}
QLabel#field {{
    font-size: 13px;
    font-weight: 700;
    color: {TEXT_2};
}}
QLabel#hint {{
    color: {TEXT_3};
    font-size: 13px;
}}
QLabel#profileName {{
    font-size: 14px;
    font-weight: 700;
    color: {TEXT};
}}
QLabel#avatar {{
    background: {BLUE_SOFT};
    color: {BLUE};
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
    color: {TEXT_2};
    font-size: 15px;
    font-weight: 700;
}}
QPushButton#navBtn:hover {{
    background: {BG};
    color: {TEXT};
}}
QPushButton#navBtn:checked {{
    background: {BLUE_SOFT};
    color: {BLUE};
}}
QPushButton#primary {{
    background: {BLUE};
    color: {WHITE};
    border: none;
    border-radius: 14px;
    padding: 14px 18px;
    font-size: 16px;
    font-weight: 800;
}}
QPushButton#primary:hover {{ background: {BLUE_HOVER}; }}
QPushButton#primary:pressed {{ background: #1957C2; }}
QPushButton#primary:disabled {{ background: #BFD4F8; color: {WHITE}; }}
QPushButton#ghost {{
    background: {BG};
    color: {TEXT};
    border: none;
    border-radius: 14px;
    padding: 14px 18px;
    font-size: 15px;
    font-weight: 700;
}}
QPushButton#ghost:hover {{ background: {LINE}; }}
QPushButton#ghost:disabled {{ color: {TEXT_3}; }}
QLineEdit, QComboBox, QTextEdit {{
    background: {BG};
    border: 1px solid transparent;
    border-radius: 14px;
    padding: 12px 14px;
    color: {TEXT};
    font-size: 15px;
    selection-background-color: {BLUE_SOFT};
    selection-color: {TEXT};
}}
QLineEdit:focus, QComboBox:focus, QTextEdit:focus {{
    background: {WHITE};
    border: 1px solid {BLUE};
}}
QComboBox::drop-down {{ border: none; width: 28px; }}
QComboBox QAbstractItemView {{
    background: {WHITE};
    border: 1px solid {LINE};
    selection-background-color: {BLUE_SOFT};
    selection-color: {TEXT};
    padding: 6px;
}}
QTableWidget {{
    background: {WHITE};
    border: none;
    gridline-color: transparent;
    font-size: 14px;
    alternate-background-color: #FAFBFC;
}}
QTableWidget::item {{
    padding: 10px 8px;
    border-bottom: 1px solid {BG};
    color: {TEXT};
}}
QTableWidget::item:selected {{
    background: {BLUE_SOFT};
    color: {TEXT};
}}
QHeaderView::section {{
    background: {WHITE};
    color: {TEXT_3};
    border: none;
    border-bottom: 1px solid {LINE};
    padding: 10px 8px;
    font-weight: 700;
    font-size: 12px;
}}
QHeaderView::section:horizontal {{
    border-right: none;
}}
QTableCornerButton::section {{ background: {WHITE}; border: none; }}
QScrollBar:vertical {{
    background: transparent;
    width: 10px;
    margin: 4px 2px;
}}
QScrollBar::handle:vertical {{
    background: #D1D6DB;
    border-radius: 4px;
    min-height: 32px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
QCheckBox {{
    spacing: 10px;
    color: {TEXT_2};
    font-size: 14px;
    font-weight: 600;
}}
QCheckBox::indicator {{
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1.5px solid #D1D6DB;
    background: {WHITE};
}}
QCheckBox::indicator:checked {{
    background: {BLUE};
    border: 1.5px solid {BLUE};
}}
QSplitter::handle {{ background: {LINE}; width: 1px; }}
QMessageBox {{
    background: {WHITE};
}}
QMessageBox QLabel {{
    color: {TEXT};
    font-size: 14px;
}}
QMessageBox QPushButton {{
    background: {BLUE};
    color: {WHITE};
    border: none;
    border-radius: 12px;
    padding: 8px 16px;
    font-weight: 700;
    min-width: 72px;
}}
"""
