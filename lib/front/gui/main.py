"""GUI 진입점. seowon-gui.exe 또는 python lib/front/gui/main.py"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from PyQt6.QtWidgets import QApplication

from window import MainWindow


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("seowon-gui")
    win = MainWindow()
    if "--demo" in sys.argv:
        win.demo_chk.setChecked(True)
    win.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
