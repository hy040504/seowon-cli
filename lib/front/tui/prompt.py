"""계층 메뉴.

키 입력과 화면 전환만 담당한다. 조회·로그인은 ``App`` 이 한다.
"""

from __future__ import annotations

from lib.seowon import LOGIN_FILE, SW_OK
from lib.back.data_manager import App
from lib.back.fs import login_file_load, login_file_wipe, config_save
from lib.back.sugang import session_label
from lib.front.tui.ui import (
    pick_assignment,
    pick_board,
    pick_lesson,
    print_assignments,
    print_board,
    print_lessons,
    print_summary,
    print_timetable,
    ui_banner,
    ui_err,
    ui_info,
    ui_ok,
    ui_warn,
)
from lib.util import char_in, disappear_text, load_spin, pause, read_line, str_ieq, term_clear

MENU_OK = 0
MENU_BACK = 1
MENU_QUIT = 2


def _draw_head(app: App | None, title: str) -> None:
    """화면을 지우고 배너·로그인 줄을 다시 그린다.

    Args:
        app: 현재 앱. None 이면 로그인 줄을 생략.
        title: 메뉴 제목.
    """
    term_clear()
    ui_banner()
    if title:
        print(f"\n  {title}")
    if app:
        if app.demo:
            who = session_label(app.sess)
            print(f"  \x1b[2m[데모 모드 — {who or 'testdata'}]\x1b[0m")
        elif app.logged_in:
            who = session_label(app.sess)
            print(f"  \x1b[2m[로그인됨: {who}]\x1b[0m")


def _load_scene() -> None:
    """메뉴 전환 로딩."""
    load_spin(50, "")


def _read_key() -> str:
    """메뉴 한 글자. ``q`` 종료, ``z``/``0`` 뒤로.

    Returns:
        한 글자 키. 잘못 치면 빈 문자열.
    """
    line = read_line("\n메뉴 번호: ")
    if str_ieq(line, "quit") or str_ieq(line, "q"):
        return "q"
    if str_ieq(line, "z") or line == "0":
        return "0" if line == "0" else "z"
    if len(line) == 1 and "1" <= line <= "9":
        return line
    return ""


def _select_main(app: App) -> str:
    """메인 메뉴를 그리고 키를 받는다.

    Args:
        app: 현재 앱.

    Returns:
        고른 키.
    """
    _draw_head(app, "메인 메뉴")
    print("  1. 로그인 / 세션")
    print("  2. 과제 확인")
    print("  3. 공지 확인")
    print("  4. 강의실 자료")
    print("  5. 이러닝 확인")
    print("  6. 시간표")
    print("  7. 현황 한 표 요약")
    print("  8. 파일 / 설정")
    print("  0. 종료")
    key = _read_key()
    if char_in(key, "123456780q"):
        _load_scene()
    return key


def _select_assign() -> str:
    """과제 하위 메뉴.

    Returns:
        고른 키.
    """
    _draw_head(None, "과제 확인")
    print("  1. 전체 과제 조회")
    print("  2. 현재 수행 가능 과제")
    print("  3. 미제출 과제 전수 조사")
    print("  4. 과제 상세 보기")
    print("  z. 뒤로가기")
    print("  q. 종료")
    key = _read_key()
    if char_in(key, "1234z0q"):
        _load_scene()
    return key


def _select_elearn() -> str:
    """이러닝 하위 메뉴.

    Returns:
        고른 키.
    """
    _draw_head(None, "이러닝 확인")
    print("  1. 차시 목록 조회")
    print("  2. 들을 차시 조회")
    print("  3. 학습률(%) 조회")
    print("  z. 뒤로가기")
    print("  q. 종료")
    key = _read_key()
    if char_in(key, "123z0q"):
        _load_scene()
    return key


def _select_file() -> str:
    """파일 / 설정 하위 메뉴.

    Returns:
        고른 키.
    """
    _draw_head(None, "파일 / 설정")
    print("  1. 설정 저장 / 불러오기")
    print("  2. 조회 결과 저장")
    print("  3. 조회 결과 불러오기")
    print("  z. 뒤로가기")
    print("  q. 종료")
    key = _read_key()
    if char_in(key, "123z0q"):
        _load_scene()
    return key


def _need_assignments(app: App, err: bool = True) -> bool:
    """로그인 뒤 과제를 가져온다.

    Args:
        app: 현재 앱.
        err: 실패 시 오류를 찍을지.

    Returns:
        목록을 쓸 수 있으면 True.
    """
    if app.ensure_auth() != SW_OK:
        return False
    if app.fetch_assignments(True) != SW_OK:
        if err:
            ui_err("과제를 가져오지 못했습니다.")
        return False
    return True


def _need_lessons(app: App, err: bool = True) -> bool:
    """로그인 뒤 이러닝을 가져온다.

    Args:
        app: 현재 앱.
        err: 실패 시 오류를 찍을지.

    Returns:
        목록을 쓸 수 있으면 True.
    """
    if app.ensure_auth() != SW_OK:
        return False
    if app.fetch_lessons(True) != SW_OK:
        if err:
            ui_err("이러닝을 가져오지 못했습니다.")
        return False
    return True


def _do_all_asg(app: App) -> None:
    """전체 과제를 찍는다.

    Args:
        app: 현재 앱.
    """
    if _need_assignments(app):
        print_assignments(app.courses, False, False)


def _do_due_asg(app: App) -> None:
    """기간 안 미제출 과제를 찍는다.

    Args:
        app: 현재 앱.
    """
    if _need_assignments(app):
        print_assignments(app.courses, True, False)


def _do_missing_asg(app: App) -> None:
    """미제출·진행중 과제를 찍는다.

    Args:
        app: 현재 앱.
    """
    if _need_assignments(app):
        print_assignments(app.courses, False, True)


def _do_asg_detail(app: App) -> None:
    """고른 과제 본문을 찍는다.

    Args:
        app: 현재 앱.
    """
    if not _need_assignments(app, err=False):
        return
    picked = pick_assignment(app.courses, False)
    if not picked:
        return
    ci, ai = picked
    load_spin(50, "과제 상세 ")
    try:
        detail = app.fetch_assignment_detail(ci, ai)
    except Exception:
        ui_err("상세 내용을 찾지 못했습니다.")
        return
    print(f"\n\x1b[1m[과제내용]\x1b[0m\n{detail}")


def _do_lesson_list(app: App) -> None:
    """차시 목록을 찍는다.

    Args:
        app: 현재 앱.
    """
    if _need_lessons(app):
        print_lessons(app.courses, False)


def _do_watch_list(app: App) -> None:
    """들을 차시를 찍는다.

    Args:
        app: 현재 앱.
    """
    if _need_lessons(app):
        print_lessons(app.courses, True)


def _do_progress(app: App) -> None:
    """고른 차시 학습률을 찍는다.

    Args:
        app: 현재 앱.
    """
    if not _need_lessons(app, err=False):
        return
    picked = pick_lesson(app.courses, False)
    if not picked:
        return
    ci, li = picked
    ui_info("선택한 차시의 학습률만 추가로 조회합니다.")
    load_spin(50, "학습률 ")
    try:
        pct = app.fetch_progress(ci, li)
    except Exception:
        ui_err("학습률을 조회하지 못했습니다.")
        return
    print(f"  [{app.courses[ci].course.title}] {app.courses[ci].lessons[li].title} → \x1b[32m{pct}%\x1b[0m")


def _do_config(app: App) -> None:
    """``config.json`` · ``login.json`` 상태를 보여 주고 옵션을 바꾼다.

    Args:
        app: 현재 앱.
    """
    print("\n현재 설정")
    print(f"  lastStudentId : {app.cfg.last_student_id or '(없음)'}")
    print(f"  saveSession   : {'true' if app.cfg.save_session else 'false'}")
    print(f"  saveResult    : {'true' if app.cfg.save_result else 'false'}")
    print(f"  dataDir       : {app.cfg.data_dir}")
    try:
        lf = login_file_load(app.root / LOGIN_FILE)
        print(
            f"  login.json    : 학번 {lf.student_id or '(비어 있음)'}, "
            f"비밀번호 {'있음' if lf.password else '(비어 있음)'}"
        )
        login_file_wipe(lf)
    except Exception:
        print("  login.json    : (없음)")
    print("  1) 세션 저장 켜기/끄기")
    print("  2) 결과 저장 켜기/끄기")
    print("  3) 저장 폴더 바꾸기")
    print("  4) config.json 에 저장")
    print("  0) 뒤로")
    line = read_line("선택: ")
    key = line[:1] if line else ""
    if key == "1":
        app.cfg.save_session = not app.cfg.save_session
    elif key == "2":
        app.cfg.save_result = not app.cfg.save_result
    elif key == "3":
        folder = read_line("폴더 경로: ")
        if folder:
            app.cfg.data_dir = folder
    elif key == "4":
        try:
            config_save(app.cfg)
            ui_ok("config.json 을 저장했습니다.")
        except Exception:
            ui_err("설정 저장에 실패했습니다.")
        return
    else:
        return
    config_save(app.cfg)
    ui_ok("설정을 반영했습니다.")


def _do_save(app: App) -> None:
    """``result.json`` 에 저장한다.

    Args:
        app: 현재 앱.
    """
    if not app.courses:
        ui_warn("먼저 조회하세요. (4번 요약이 가장 편합니다)")
        return
    try:
        app.save_result()
        ui_ok("result.json 을 저장했습니다.")
    except Exception:
        ui_err("저장에 실패했습니다.")


def _do_load(app: App) -> None:
    """``result.json`` 을 다시 그린다.

    Args:
        app: 현재 앱.
    """
    if app.load_result() == SW_OK:
        ui_ok("저장된 조회 결과를 다시 그립니다.")
        print_summary(app.courses)
        print_assignments(app.courses, False, False)
        print_lessons(app.courses, False)
    else:
        ui_err("result.json 을 읽지 못했습니다.")


def _login_menu(app: App) -> int:
    """로그인 / 세션.

    Args:
        app: 현재 앱.

    Returns:
        ``MENU_OK`` / ``MENU_BACK`` / ``MENU_QUIT``.
    """
    if app.login_interactive() == SW_OK and not app.courses:
        app.fetch_courses()
    pause()
    return MENU_OK


def _assign_menu(app: App) -> int:
    """과제 확인 루프.

    Args:
        app: 현재 앱.

    Returns:
        ``MENU_OK`` / ``MENU_BACK`` / ``MENU_QUIT``.
    """
    while True:
        key = _select_assign()
        if key == "1":
            _do_all_asg(app)
            pause()
        elif key == "2":
            _do_due_asg(app)
            pause()
        elif key == "3":
            _do_missing_asg(app)
            pause()
        elif key == "4":
            _do_asg_detail(app)
            pause()
        elif key in ("z", "0"):
            return MENU_BACK
        elif key == "q":
            return MENU_QUIT
        else:
            ui_warn("없는 메뉴입니다.")


def _elearn_menu(app: App) -> int:
    """이러닝 확인 루프.

    Args:
        app: 현재 앱.

    Returns:
        ``MENU_OK`` / ``MENU_BACK`` / ``MENU_QUIT``.
    """
    while True:
        key = _select_elearn()
        if key == "1":
            _do_lesson_list(app)
            pause()
        elif key == "2":
            _do_watch_list(app)
            pause()
        elif key == "3":
            _do_progress(app)
            pause()
        elif key in ("z", "0"):
            return MENU_BACK
        elif key == "q":
            return MENU_QUIT
        else:
            ui_warn("없는 메뉴입니다.")


def _summary_menu(app: App) -> int:
    """현황 한 표.

    Args:
        app: 현재 앱.

    Returns:
        ``MENU_OK`` / ``MENU_BACK`` / ``MENU_QUIT``.
    """
    if app.ensure_auth() != SW_OK:
        return MENU_OK
    load_spin(50, "현황 모으는 중 ")
    app.fetch_assignments(True)
    app.fetch_lessons(True)
    print_summary(app.courses)
    if app.cfg.save_result:
        try:
            app.save_result()
            ui_ok("같은 내용을 result.json 에도 저장했습니다.")
        except Exception:
            pass
    pause()
    return MENU_OK


def _file_menu(app: App) -> int:
    """파일 / 설정 루프.

    Args:
        app: 현재 앱.

    Returns:
        ``MENU_OK`` / ``MENU_BACK`` / ``MENU_QUIT``.
    """
    while True:
        key = _select_file()
        if key == "1":
            _do_config(app)
            pause()
        elif key == "2":
            _do_save(app)
            pause()
        elif key == "3":
            _do_load(app)
            pause()
        elif key in ("z", "0"):
            return MENU_BACK
        elif key == "q":
            return MENU_QUIT
        else:
            ui_warn("없는 메뉴입니다.")


def _need_notices(app: App, err: bool = True) -> bool:
    """로그인 뒤 공지를 가져온다.

    Args:
        app: 현재 앱.
        err: 실패 시 오류를 찍을지.

    Returns:
        목록을 쓸 수 있으면 True.
    """
    if app.ensure_auth() != SW_OK:
        return False
    if app.fetch_notices(True) != SW_OK:
        if err:
            ui_err("공지를 가져오지 못했습니다.")
        return False
    return True


def _need_materials(app: App, err: bool = True) -> bool:
    """로그인 뒤 자료를 가져온다.

    Args:
        app: 현재 앱.
        err: 실패 시 오류를 찍을지.

    Returns:
        목록을 쓸 수 있으면 True.
    """
    if app.ensure_auth() != SW_OK:
        return False
    if app.fetch_materials(True) != SW_OK:
        if err:
            ui_err("자료를 가져오지 못했습니다.")
        return False
    return True


def _do_notices(app: App) -> None:
    """공지 목록을 찍는다.

    Args:
        app: 현재 앱.
    """
    if _need_notices(app):
        print_board(app.courses, "notices")


def _do_notice_detail(app: App) -> None:
    """공지 본문을 찍는다.

    Args:
        app: 현재 앱.
    """
    if not _need_notices(app, err=False):
        return
    picked = pick_board(app.courses, "notices")
    if not picked:
        return
    ci, pi = picked
    load_spin(50, "공지 상세 ")
    try:
        text = app.fetch_board_detail(ci, pi, "notices")
    except Exception:
        ui_err("상세 내용을 찾지 못했습니다.")
        return
    print(f"\n\x1b[1m[공지]\x1b[0m\n{text}")


def _do_materials(app: App) -> None:
    """자료 목록을 찍는다.

    Args:
        app: 현재 앱.
    """
    if _need_materials(app):
        print_board(app.courses, "materials")


def _do_material_detail(app: App) -> None:
    """자료 본문을 찍는다.

    Args:
        app: 현재 앱.
    """
    if not _need_materials(app, err=False):
        return
    picked = pick_board(app.courses, "materials")
    if not picked:
        return
    ci, pi = picked
    load_spin(50, "자료 상세 ")
    try:
        text = app.fetch_board_detail(ci, pi, "materials")
    except Exception:
        ui_err("상세 내용을 찾지 못했습니다.")
        return
    print(f"\n\x1b[1m[자료]\x1b[0m\n{text}")


def _do_timetable(app: App) -> None:
    """수강 시간표를 찍는다.

    Args:
        app: 현재 앱.
    """
    if app.ensure_auth() != SW_OK:
        return
    load_spin(50, "시간표 조회 ")
    if app.fetch_timetable() != SW_OK:
        ui_err(app.last_error or "시간표를 가져오지 못했습니다.")
        return
    print_timetable(app.timetable)


def _select_notice() -> str:
    """공지 하위 메뉴.

    Returns:
        고른 키.
    """
    _draw_head(None, "공지 확인")
    print("  1. 전체 공지 조회")
    print("  2. 공지 상세 보기")
    print("  z. 뒤로가기")
    print("  q. 종료")
    key = _read_key()
    if char_in(key, "12z0q"):
        _load_scene()
    return key


def _select_material() -> str:
    """자료 하위 메뉴.

    Returns:
        고른 키.
    """
    _draw_head(None, "강의실 자료")
    print("  1. 전체 자료 조회")
    print("  2. 자료 상세 보기")
    print("  z. 뒤로가기")
    print("  q. 종료")
    key = _read_key()
    if char_in(key, "12z0q"):
        _load_scene()
    return key


def _notice_menu(app: App) -> int:
    """공지 루프.

    Args:
        app: 현재 앱.

    Returns:
        ``MENU_OK`` / ``MENU_BACK`` / ``MENU_QUIT``.
    """
    while True:
        key = _select_notice()
        if key == "1":
            _do_notices(app)
            pause()
        elif key == "2":
            _do_notice_detail(app)
            pause()
        elif key in ("z", "0"):
            return MENU_BACK
        elif key == "q":
            return MENU_QUIT
        else:
            ui_warn("없는 메뉴입니다.")


def _material_menu(app: App) -> int:
    """자료 루프.

    Args:
        app: 현재 앱.

    Returns:
        ``MENU_OK`` / ``MENU_BACK`` / ``MENU_QUIT``.
    """
    while True:
        key = _select_material()
        if key == "1":
            _do_materials(app)
            pause()
        elif key == "2":
            _do_material_detail(app)
            pause()
        elif key in ("z", "0"):
            return MENU_BACK
        elif key == "q":
            return MENU_QUIT
        else:
            ui_warn("없는 메뉴입니다.")


def run_menu(app: App) -> int:
    """계층 메뉴 진입점.

    Args:
        app: 부팅된 앱.

    Returns:
        종료 코드. 보통 0.
    """
    while True:
        key = _select_main(app)
        if key == "1":
            _login_menu(app)
        elif key == "2":
            if _assign_menu(app) == MENU_QUIT:
                break
        elif key == "3":
            if _notice_menu(app) == MENU_QUIT:
                break
        elif key == "4":
            if _material_menu(app) == MENU_QUIT:
                break
        elif key == "5":
            if _elearn_menu(app) == MENU_QUIT:
                break
        elif key == "6":
            _do_timetable(app)
            pause()
        elif key == "7":
            _summary_menu(app)
        elif key == "8":
            if _file_menu(app) == MENU_QUIT:
                break
        elif key in ("0", "q"):
            break
        else:
            ui_warn("없는 메뉴입니다.")
    term_clear()
    ui_banner()
    print()
    disappear_text("이용해 주셔서 감사합니다.")
    return SW_OK
