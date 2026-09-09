"""GUI 진입점. python seowon_gui.py [--demo]"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "lib" / "front" / "gui" / "main.py"


def main() -> int:
    """lib/front/gui/main.py 를 실행한다."""
    if not SCRIPT.is_file():
        print(f"화면 파일을 찾지 못했습니다.\n{SCRIPT}", file=sys.stderr)
        return 1
    sys.argv[0] = str(SCRIPT)
    runpy.run_path(str(SCRIPT), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
