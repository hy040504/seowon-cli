"""GUI 진입점. python seowon_gui.py [--demo]"""

from __future__ import annotations

import runpy
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "lib" / "front" / "gui" / "main.py"


def _ensure_pyqt() -> str:
    """PyQt6 가 없으면 지금 쓰는 python 에 설치한다."""
    try:
        import PyQt6  # noqa: F401

        return ""
    except ImportError:
        pass
    print("PyQt6 가 없습니다. 설치합니다…", flush=True)
    cmd = [sys.executable, "-m", "pip", "install", "PyQt6"]
    r = subprocess.run(cmd, check=False)
    if r.returncode != 0:
        return (
            "PyQt6 설치에 실패했습니다.\n\n"
            f"{sys.executable} -m pip install -r requirements.txt"
        )
    try:
        import PyQt6  # noqa: F401

        return ""
    except ImportError:
        return "PyQt6 를 설치했지만 불러오지 못했습니다. Python 을 다시 실행하세요."


def main() -> int:
    """lib/front/gui/main.py 를 실행한다."""
    if not SCRIPT.is_file():
        print(f"화면 파일을 찾지 못했습니다.\n{SCRIPT}", file=sys.stderr)
        return 1
    err = _ensure_pyqt()
    if err:
        print(err, file=sys.stderr, flush=True)
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(None, err[:800], "seowon-gui", 0x10)
        except Exception:
            pass
        return 1
    sys.argv[0] = str(SCRIPT)
    runpy.run_path(str(SCRIPT), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
