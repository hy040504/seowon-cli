"""GUI 진입점. seowon-gui.exe 또는 python lib/front/gui/main.py"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]  # seowon-cli 루트 (exe 옆)
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


def _fail(msg: str) -> int:
    """시작 실패를 로그와 알림창으로 남긴다."""
    log = ROOT / "seowon-gui.log"
    try:
        log.write_text(msg, encoding="utf-8")
    except OSError:
        pass
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, msg[:800], "seowon-gui", 0x10)
    except Exception:
        print(msg, file=sys.stderr)
    return 1


def main() -> int:
    """PyQt 창을 띄운다. seowon-gui.exe 는 이미 콘솔 없이 이 파일을 연다."""
    try:
        from PyQt6.QtGui import QFont
        from PyQt6.QtWidgets import QApplication
        from window import MainWindow
    except Exception:
        return _fail(
            "PyQt6 를 불러오지 못했습니다.\n\n"
            "pip install -r requirements.txt\n\n" + traceback.format_exc()
        )

    try:
        app = QApplication(sys.argv)
        app.setStyle("Fusion")
        app.setApplicationName("e-campus")
        font = QFont("Malgun Gothic", 10)
        app.setFont(font)
        win = MainWindow()
        if "--demo" in sys.argv:
            win.demo_chk.setChecked(True)
        win.show()
        return int(app.exec())
    except Exception:
        return _fail("GUI 실행 중 오류가 났습니다.\n\n" + traceback.format_exc())


if __name__ == "__main__":
    raise SystemExit(main())
