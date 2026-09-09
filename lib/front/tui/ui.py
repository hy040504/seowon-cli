"""터미널 표 · 메시지."""

from __future__ import annotations

from lib.seowon import VERSION, Assignment, CourseData, Lesson
from lib.back.parse import assignment_missing_or_progress
from lib.util import read_line

R = "\x1b[0m"
B = "\x1b[1m"
C = "\x1b[36m"
Y = "\x1b[33m"
G = "\x1b[32m"
RED = "\x1b[31m"
DIM = "\x1b[2m"


def ui_banner() -> None:
    """시작 화면 배너."""
    print(f"\n{B}{C}============================================{R}")
    print(f"{B}{C}  서원대 e-campus 과제·이러닝 현황  {R} v{VERSION}")
    print(f"{B}{C}  조회 전용 · Python · JSON 저장            {R}")
    print(f"{B}{C}============================================{R}")


def ui_info(msg: str) -> None:
    """흐린 안내."""
    print(f"{DIM}{msg}{R}")


def ui_ok(msg: str) -> None:
    """성공 메시지."""
    print(f"{G}{msg}{R}")


def ui_warn(msg: str) -> None:
    """경고 메시지."""
    print(f"{Y}{msg}{R}")


def ui_err(msg: str) -> None:
    """오류 메시지."""
    print(f"{RED}{msg}{R}")


def print_courses(list_: list[CourseData]) -> None:
    """수강 과목 표."""
    print(f"\n{B}[수강 과목]{R}")
    print(f"  {'번호':<4} {'과목명':<36} {'강의실 코드':<22} 구분")
    print("  " + "-" * 64)
    cur = ext = 0
    for i, item in enumerate(list_):
        cat = "비교과" if item.course.category == "extracurricular" else "교과"
        print(f"  {i + 1:<4} {item.course.title:<36} {item.course.crs_cre_cd:<22} {cat}")
        if item.course.category == "extracurricular":
            ext += 1
        else:
            cur += 1
    print(f"  {DIM}교과 {cur} · 비교과 {ext} · 합 {len(list_)}{R}")


def _asg_row(course: str, a: Assignment) -> None:
    """과제 한 줄."""
    mark = "지금" if a.due_now else "    "
    color = Y if a.due_now else ""
    print(f"  [{course}] {a.title} | {a.period or '-'} | {color}{a.status or '-'}{R} {mark}")


def print_assignments(list_: list[CourseData], only_due: bool = False, only_missing: bool = False) -> None:
    """과제 목록. only_due 는 기간 안 미제출, only_missing 은 미제출·진행중."""
    tag = " 기간 안 미제출" if only_due else " 미제출·진행중" if only_missing else " 전체"
    print(f"\n{B}[과제]{R}{tag}")
    shown = 0
    for item in list_:
        header = False
        for a in item.assignments:
            if only_due and not a.due_now:
                continue
            if only_missing and not assignment_missing_or_progress(a):
                continue
            if not header:
                print(f"\n  {Y}{item.course.title}{R}")
                header = True
            _asg_row(item.course.title, a)
            shown += 1
    if shown == 0:
        ui_ok("  해당하는 과제가 없습니다.")
    else:
        print(f"\n  {DIM}총 {shown}건{R}")


def print_lessons(list_: list[CourseData], only_watch: bool = False) -> None:
    """이러닝 차시 목록. only_watch 는 들을 차시만."""
    print(f"\n{B}[이러닝]{R}{' 들을 차시' if only_watch else ' 차시 목록'}")
    shown = 0
    for item in list_:
        header = False
        for l in item.lessons:
            if only_watch and not l.needs_watch:
                continue
            if not header:
                print(f"\n  {Y}{item.course.title}{R}")
                header = True
            prog = f"{l.progress_percent}%" if l.progress_percent >= 0 else "-"
            color = Y if l.needs_watch else ""
            print(
                f"  [{item.course.title}] {l.week} {l.title} | {l.period or '-'} | "
                f"{l.attendance or '-'} | 진행 {color}{prog}{R}"
            )
            shown += 1
    if shown == 0:
        ui_ok("  해당하는 차시가 없습니다.")
    else:
        print(f"\n  {DIM}총 {shown}건{R}")


def print_summary(list_: list[CourseData]) -> None:
    """과목별 미제출 과제 · 미완료 이러닝."""
    print(f"\n{B}[현황 한 표]{R}")
    print(f"  {'과목':<28} {'미제출':>8} {'미완료':>8}")
    print("  " + "-" * 46)
    td = tp = 0
    for item in list_:
        due = sum(1 for a in item.assignments if a.due_now)
        pend = sum(1 for l in item.lessons if l.needs_watch)
        print(f"  {item.course.title:<28} {due:8d} {pend:8d}")
        td += due
        tp += pend
    print("  " + "-" * 46)
    print(f"  {'합계':<28} {td:8d} {tp:8d}")


def pick_assignment(list_: list[CourseData], only_due: bool = False) -> tuple[int, int] | None:
    """과제 번호 선택. (과목 인덱스, 과제 인덱스)."""
    print(f"\n{B}과제를 고르세요{R}")
    mapping: list[tuple[int, int]] = []
    for i, item in enumerate(list_):
        for j, a in enumerate(item.assignments):
            if only_due and not a.due_now:
                continue
            print(f"  {Y}{len(mapping) + 1}.{R} [{item.course.title}] {a.title} ({a.status or '-'})")
            mapping.append((i, j))
            if len(mapping) >= 256:
                break
    if not mapping:
        ui_warn("선택할 과제가 없습니다.")
        return None
    line = read_line("번호 (취소는 빈 칸): ")
    if not line:
        return None
    try:
        sel = int(line)
    except ValueError:
        ui_err("잘못된 번호입니다.")
        return None
    if sel < 1 or sel > len(mapping):
        ui_err("잘못된 번호입니다.")
        return None
    return mapping[sel - 1]


def pick_lesson(list_: list[CourseData], only_watch: bool = False) -> tuple[int, int] | None:
    """차시 번호 선택. (과목 인덱스, 차시 인덱스)."""
    print(f"\n{B}차시를 고르세요{R}")
    mapping: list[tuple[int, int]] = []
    for i, item in enumerate(list_):
        for j, l in enumerate(item.lessons):
            if only_watch and not l.needs_watch:
                continue
            print(f"  {Y}{len(mapping) + 1}.{R} [{item.course.title}] {l.week} {l.title} ({l.attendance or '-'})")
            mapping.append((i, j))
            if len(mapping) >= 256:
                break
    if not mapping:
        ui_warn("선택할 차시가 없습니다.")
        return None
    line = read_line("번호 (취소는 빈 칸): ")
    if not line:
        return None
    try:
        sel = int(line)
    except ValueError:
        ui_err("잘못된 번호입니다.")
        return None
    if sel < 1 or sel > len(mapping):
        ui_err("잘못된 번호입니다.")
        return None
    return mapping[sel - 1]
