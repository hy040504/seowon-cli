"""TUI 진입점. python seowon_tui.py [--demo|--test|--rpc ...]"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lib.seowon import LOGIN_FILE, SW_OK, VERSION, find_testdata  # noqa: E402
from lib.back.data_manager import App  # noqa: E402
from lib.back.fs import config_paths, login_file_load, login_file_wipe  # noqa: E402
from lib.front.tui.prompt import run_menu  # noqa: E402
from lib.front.tui.ui import ui_banner, ui_warn  # noqa: E402
from lib.test_runner import run_tests  # noqa: E402
from lib.util import enable_console, load_spin, term_clear  # noqa: E402


def usage() -> None:
    """명령줄 도움말."""
    print(f"seowon-cli {VERSION} — 서원대 e-campus 과제·이러닝 현황 (Python CLI)\n")
    print("사용법:")
    print("  python seowon_tui.py            대화형 TUI 메뉴")
    print("  python seowon_tui.py --demo     testdata 로 오프라인 시연")
    print("  python seowon_tui.py --test     파서·필터·암호 단위 테스트")
    print("  python seowon_tui.py --rpc ...  JSON stdout (스크립트용)")
    print("  python seowon_gui.py            PyQt GUI")
    print("  python seowon_tui.py --help     이 도움말\n")
    print("저장 파일 (JSON만):")
    print("  config.json           마지막 학번, 저장 옵션, dataDir")
    print("  login.json            학번·비밀번호 (둘 다 있으면 입력 생략)")
    print("  db/session.json       쿠키 (비밀번호 없음)")
    print("  db/result.json        최근 조회 결과")


def _rpc_print_file(path: Path) -> int:
    """result.json 내용을 stdout 에 그대로 쓴다."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        print('{"ok":false,"error":"result.json 을 읽지 못했습니다."}')
        return 1
    sys.stdout.write(raw)
    if not raw.endswith("\n"):
        sys.stdout.write("\n")
    return 0


def run_rpc(app: App, argv: list[str]) -> int:
    """스크립트용 JSON stdout. GUI 가 아닌 외부 도구용."""
    cmd = None
    idx = 0
    for i, a in enumerate(argv):
        if a == "--rpc" and i + 1 < len(argv):
            cmd = argv[i + 1]
            idx = i
            break
    if not cmd:
        print('{"ok":false,"error":"--rpc 명령이 없습니다."}')
        return 1

    app.quiet = True
    app.boot()
    _spath, rpath = config_paths(app.cfg)

    if cmd == "login":
        sid = os.environ.get("SEOWON_ID") or ""
        pw = os.environ.get("SEOWON_PW") or ""
        if len(argv) > idx + 2 and argv[idx + 2]:
            sid = argv[idx + 2]
        if len(argv) > idx + 3 and argv[idx + 3]:
            pw = argv[idx + 3]
        if not sid or not pw:
            try:
                lf = login_file_load(app.root / LOGIN_FILE)
                if not sid:
                    sid = lf.student_id
                if not pw:
                    pw = lf.password
                login_file_wipe(lf)
            except Exception:
                pass
        rc = app.login_with(sid, pw)
        print(
            json.dumps(
                {
                    "ok": rc == SW_OK,
                    "studentId": app.sess.student_id,
                    "studentName": app.sess.student_name,
                    "deptName": app.sess.dept_name,
                    "deptCd": app.sess.dept_cd,
                    "error": app.last_error,
                },
                ensure_ascii=False,
            )
        )
        return 0 if rc == SW_OK else 1

    if cmd == "session":
        rc = app.try_session()
        print(
            json.dumps(
                {
                    "ok": rc == SW_OK,
                    "studentId": app.sess.student_id,
                    "studentName": app.sess.student_name,
                    "deptName": app.sess.dept_name,
                    "deptCd": app.sess.dept_cd,
                    "error": "" if rc == SW_OK else "세션이 없거나 만료되었습니다.",
                },
                ensure_ascii=False,
            )
        )
        return 0 if rc == SW_OK else 1

    if cmd == "fetch":
        if not app.demo and not app.logged_in:
            if app.try_session() != SW_OK:
                print('{"ok":false,"error":"먼저 로그인하세요."}')
                return 1
        if app.demo:
            app.login_with("", "")
        if app.fetch_assignments(True) != SW_OK or app.fetch_lessons(True) != SW_OK:
            err = app.last_error or "조회에 실패했습니다."
            print(json.dumps({"ok": False, "error": err}, ensure_ascii=False))
            return 1
        if app.save_result() != SW_OK:
            print('{"ok":false,"error":"result.json 저장 실패"}')
            return 1
        return _rpc_print_file(rpath)

    if cmd == "load":
        if app.load_result() != SW_OK:
            print('{"ok":false,"error":"result.json 을 읽지 못했습니다."}')
            return 1
        return _rpc_print_file(rpath)

    if cmd == "detail":
        if len(argv) <= idx + 3:
            print('{"ok":false,"error":"detail 과목번호 과제번호"}')
            return 1
        if not app.demo and not app.logged_in:
            app.try_session()
        if app.demo:
            app.login_with("", "")
        if not app.courses:
            app.fetch_assignments(True)
        try:
            ci = int(argv[idx + 2])
            ai = int(argv[idx + 3])
            detail = app.fetch_assignment_detail(ci, ai)
        except Exception:
            print('{"ok":false,"error":"상세를 찾지 못했습니다."}')
            return 1
        print(json.dumps({"ok": True, "detail": detail}, ensure_ascii=False))
        return 0

    if cmd == "progress":
        if len(argv) <= idx + 3:
            print('{"ok":false,"error":"progress 과목번호 차시번호"}')
            return 1
        if not app.demo and not app.logged_in:
            app.try_session()
        if app.demo:
            app.login_with("", "")
        if not app.courses:
            app.fetch_lessons(True)
        try:
            ci = int(argv[idx + 2])
            li = int(argv[idx + 3])
            pct = app.fetch_progress(ci, li)
        except Exception:
            print('{"ok":false,"error":"학습률을 조회하지 못했습니다."}')
            return 1
        print(json.dumps({"ok": True, "percent": pct}, ensure_ascii=False))
        return 0

    print('{"ok":false,"error":"알 수 없는 rpc 명령"}')
    return 1


def main(argv: list[str] | None = None) -> int:
    """TUI · 데모 · 테스트 · RPC 진입점."""
    argv = list(sys.argv if argv is None else argv)
    enable_console()
    os.chdir(ROOT)

    demo = False
    rpc = False
    for a in argv[1:]:
        if a in ("--help", "-h"):
            usage()
            return 0
        if a == "--version":
            print(VERSION)
            return 0
        if a == "--demo":
            demo = True
        if a == "--rpc":
            rpc = True
        if a == "--test":
            td = find_testdata(ROOT)
            return run_tests(td)

    app = App(ROOT, demo=demo, quiet=rpc)
    if rpc:
        return run_rpc(app, argv)

    term_clear()
    ui_banner()
    load_spin(150, "")
    if demo:
        ui_warn("데모 모드입니다. e-campus 에 접속하지 않고 testdata 를 씁니다.")
    app.boot()
    run_menu(app)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
