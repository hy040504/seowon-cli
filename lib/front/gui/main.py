"""GUI 진입점. python seowon_gui.py 또는 python lib/front/gui/main.py"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[3]  # seowon-cli 루트
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


def _fail(msg: str) -> int:
    """시작 실패를 콘솔·로그·알림창에 남긴다."""
    print(msg, file=sys.stderr, flush=True)
    log = ROOT / "seowon-gui.log"
    try:
        log.write_text(msg, encoding="utf-8")
    except OSError:
        pass
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, msg[:800], "seowon-gui", 0x10)
    except Exception:
        pass
    return 1


def main() -> int:
    """PyQt 창을 띄운다."""
    try:
        import os

        import PyQt6

        plug = Path(PyQt6.__file__).resolve().parent / "Qt6" / "plugins"
        if plug.is_dir():
            os.environ.setdefault("QT_PLUGIN_PATH", str(plug))
            os.environ.setdefault("QT_QPA_PLATFORM_PLUGIN_PATH", str(plug / "platforms"))
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
        app.setApplicationName("서원대 몰아보기")
        font = QFont("Malgun Gothic", 10)
        app.setFont(font)
        win = MainWindow()
        if "--demo" in sys.argv:
            win.demo_chk.setChecked(True)
        win.show()
        win.raise_()
        win.activateWindow()
        return int(app.exec())
    except Exception:
        return _fail("GUI 실행 중 오류가 났습니다.\n\n" + traceback.format_exc())


if __name__ == "__main__":
    raise SystemExit(main())
