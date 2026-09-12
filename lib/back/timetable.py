"""수강 시간표. ``timtbNm`` 파싱 · 격자 · SVG. 신청·취소는 하지 않는다."""

from __future__ import annotations

import re
from typing import Any

from lib.seowon import TimetableSlot, TimetableSubject

WEEKDAYS = ("월", "화", "수", "목", "금", "토", "일")
GRID_DAYS = ("월", "화", "수", "목", "금")

PERIOD_TIMES: dict[int, tuple[str, str]] = {
    1: ("09:00", "09:50"),
    2: ("10:00", "10:50"),
    3: ("11:00", "11:50"),
    4: ("12:00", "12:50"),
    5: ("13:00", "13:50"),
    6: ("14:00", "14:50"),
    7: ("15:00", "15:50"),
    8: ("16:00", "16:50"),
    9: ("17:00", "17:50"),
    10: ("18:00", "18:50"),
    11: ("19:00", "19:50"),
    12: ("20:00", "20:50"),
    13: ("21:00", "21:50"),
    14: ("22:00", "22:50"),
}

SUBJECT_PALETTE = (
    ("#dbeafe", "#2563eb", "#1e3a8a"),
    ("#dcfce7", "#16a34a", "#14532d"),
    ("#fef3c7", "#d97706", "#78350f"),
    ("#fce7f3", "#db2777", "#831843"),
    ("#e0e7ff", "#4f46e5", "#312e81"),
    ("#ffedd5", "#ea580c", "#7c2d12"),
    ("#ccfbf1", "#0d9488", "#134e4a"),
    ("#ede9fe", "#7c3aed", "#4c1d95"),
    ("#fee2e2", "#dc2626", "#7f1d1d"),
    ("#ecfccb", "#65a30d", "#365314"),
)

_LINE = re.compile(r"^(월|화|수|목|금|토|일)\s+([\d,\s~\-–]+)\s*(.*)$")
_INLINE = re.compile(r"(월|화|수|목|금|토|일)\s*([0-9,\s~\-–]+)")


def period_start(period: int) -> str:
    """교시 시작 시각.

    Args:
        period: 1부터의 교시.

    Returns:
        ``HH:MM``. 모르면 09:00 부터 1시간 간격.
    """
    known = PERIOD_TIMES.get(period)
    if known:
        return known[0]
    if period < 1:
        return ""
    minutes = 9 * 60 + (period - 1) * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def period_end(period: int) -> str:
    """교시 종료 시각.

    Args:
        period: 1부터의 교시.

    Returns:
        ``HH:MM``. 시작 + 50분.
    """
    known = PERIOD_TIMES.get(period)
    if known:
        return known[1]
    start = period_start(period)
    if not start:
        return ""
    hh, mm = start.split(":")
    total = int(hh) * 60 + int(mm) + 50
    return f"{total // 60:02d}:{total % 60:02d}"


def _periods(token_blob: str) -> list[int]:
    """``1,2,3`` / ``1-3`` 을 교시 번호로.

    Args:
        token_blob: 교시 토큰.

    Returns:
        교시 정수 목록.
    """
    out: list[int] = []
    for part in re.split(r"[,\s]+", token_blob.strip()):
        if not part:
            continue
        rng = re.match(r"^(\d+)\s*[~\-–]\s*(\d+)$", part)
        if rng:
            a, b = int(rng.group(1)), int(rng.group(2))
            lo, hi = (a, b) if a <= b else (b, a)
            out.extend(range(lo, hi + 1))
            continue
        if part.isdigit():
            n = int(part)
            if n > 0:
                out.append(n)
    return out


def parse_timtb_nm(raw: str) -> list[TimetableSlot]:
    """``월 1,2,3 공학관`` / 여러 줄을 요일·교시 슬롯으로 푼다.

    Parameters
    ----------
    raw : str
        ``timtbNm`` 원문.

    Returns
    -------
    list of TimetableSlot
        요일·교시·강의실. 못 읽으면 빈 목록.
    """
    text = (raw or "").strip()
    if not text:
        return []
    slots: list[TimetableSlot] = []
    lines = [ln.strip() for ln in re.split(r"\r?\n", text) if ln.strip()]
    parsed_any = False
    for line in lines:
        m = _LINE.match(line)
        if not m:
            continue
        day, nums, place = m.group(1), m.group(2), (m.group(3) or "").strip()
        parsed_any = True
        for period in _periods(nums):
            slots.append(TimetableSlot(day=day, period=period, place=place))
    if parsed_any:
        return slots
    for m in _INLINE.finditer(text):
        day, nums = m.group(1), m.group(2)
        rest = text[m.end() :].strip()
        place = rest.split("\n", 1)[0].strip()
        for period in _periods(nums):
            slots.append(TimetableSlot(day=day, period=period, place=place))
    return slots


def course_kind(cd: str, nm: str) -> str:
    """이수 구분을 전공/교양으로 줄인다.

    Args:
        cd: 이수 구분 코드.
        nm: 이수 구분 이름.

    Returns:
        ``전공``, ``교양``, 또는 원문.
    """
    blob = f"{cd} {nm}"
    if re.search(r"교양|교필|교선", blob) or cd in ("03", "04", "21", "22"):
        return "교양"
    if re.search(r"전공|전필|전선", blob) or cd in ("01", "02", "11", "12"):
        return "전공"
    return nm or "기타"


def build_timetable(subjects: list[TimetableSubject]) -> dict[str, Any]:
    """과목 목록으로 격자·충돌·학점을 집계한다.

    Parameters
    ----------
    subjects : list of TimetableSubject
        확정 수강 과목.

    Returns
    -------
    dict
        ``courseCount``, ``cells``, ``subjects``, ``unparsed`` 등 GUI/TUI 공용 JSON.
    """
    slots: list[TimetableSlot] = []
    unparsed: list[dict[str, str]] = []
    total = 0.0
    for sub in subjects:
        try:
            total += float(sub.cmpsj_cdt or 0)
        except (TypeError, ValueError):
            pass
        parsed = parse_timtb_nm(sub.timtb_nm)
        if not parsed and (sub.timtb_nm or "").strip():
            unparsed.append({"subjtNm": sub.subjt_nm, "timtbNm": sub.timtb_nm})
            continue
        for sl in parsed:
            sl.subjt_cd = sub.subjt_cd
            sl.subjt_nm = sub.subjt_nm
            sl.corse_dvcls_no = sub.corse_dvcls_no
            sl.chrg_instr = sub.chrg_instr
            sl.cmpsj_cdt = sub.cmpsj_cdt
            slots.append(sl)

    cell_map: dict[tuple[str, int], list[TimetableSlot]] = {}
    for sl in slots:
        cell_map.setdefault((sl.day, sl.period), []).append(sl)

    cells = []
    conflicts = 0
    max_period = 10
    for (day, period), items in sorted(cell_map.items(), key=lambda kv: (WEEKDAYS.index(kv[0][0]) if kv[0][0] in WEEKDAYS else 9, kv[0][1])):
        max_period = max(max_period, period)
        has_conflict = len(items) > 1
        if has_conflict:
            conflicts += 1
        cells.append(
            {
                "day": day,
                "period": period,
                "hasConflict": has_conflict,
                "subjects": [
                    {
                        "subjtCd": it.subjt_cd,
                        "subjtNm": it.subjt_nm,
                        "corseDvclsNo": it.corse_dvcls_no,
                        "place": it.place,
                        "chrgInstrEmpnm": it.chrg_instr,
                        "cmpsjCdt": it.cmpsj_cdt,
                    }
                    for it in items
                ],
            }
        )

    color_of: dict[str, int] = {}
    for i, sub in enumerate(subjects):
        color_of[f"{sub.subjt_cd}-{sub.corse_dvcls_no}"] = i % len(SUBJECT_PALETTE)

    return {
        "courseCount": len(subjects),
        "totalCredits": int(total) if total == int(total) else total,
        "conflictCount": conflicts,
        "maxPeriod": max_period,
        "unparsed": unparsed,
        "subjects": [
            {
                "subjtCd": s.subjt_cd,
                "subjtNm": s.subjt_nm,
                "corseDvclsNo": s.corse_dvcls_no,
                "cmpsjCdt": s.cmpsj_cdt,
                "chrgInstrEmpnm": s.chrg_instr,
                "timtbNm": s.timtb_nm,
                "kind": s.kind,
                "color": color_of.get(f"{s.subjt_cd}-{s.corse_dvcls_no}", 0),
            }
            for s in subjects
        ],
        "cells": cells,
        "slots": [
            {
                "day": sl.day,
                "period": sl.period,
                "place": sl.place,
                "subjtNm": sl.subjt_nm,
                "chrgInstrEmpnm": sl.chrg_instr,
            }
            for sl in slots
        ],
    }


def format_timetable_grid(data: dict[str, Any], weekdays: tuple[str, ...] = GRID_DAYS) -> str:
    """콘솔용 ASCII 격자.

    Args:
        data: ``build_timetable`` 결과.
        weekdays: 열로 쓸 요일. 기본 월~금.

    Returns:
        여러 줄 문자열.
    """
    max_period = int(data.get("maxPeriod") or 10)
    lookup: dict[str, dict[str, Any]] = {}
    for cell in data.get("cells") or []:
        lookup[f"{cell.get('day')}:{cell.get('period')}"] = cell
    col_w = 16
    lines = [
        f"수강 {data.get('courseCount') or 0}과목 · {data.get('totalCredits') or 0}학점"
        + (f" · 충돌 {data.get('conflictCount')}건" if data.get("conflictCount") else ""),
        "시각   " + " ".join(d.ljust(col_w) for d in weekdays),
    ]
    for period in range(1, max_period + 1):
        row = [period_start(period).ljust(7)]
        for day in weekdays:
            cell = lookup.get(f"{day}:{period}")
            if not cell or not cell.get("subjects"):
                row.append("".ljust(col_w))
                continue
            names = "/".join(str(s.get("subjtNm") or "")[:10] for s in cell["subjects"])
            if cell.get("hasConflict"):
                names = "!" + names
            row.append(names[:col_w].ljust(col_w))
        lines.append(" ".join(row))
    return "\n".join(lines)


def _esc(text: str) -> str:
    """SVG 텍스트 이스케이프.

    Args:
        text: 원문.

    Returns:
        ``& < > "`` 를 엔티티로 바꾼 문자열.
    """
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_timetable_svg(data: dict[str, Any], title: str = "수강 시간표") -> str:
    """데이터 기반 격자 SVG. 연속 교시는 한 블록.

    Parameters
    ----------
    data : dict
        ``build_timetable`` 결과.
    title : str
        상단 제목.

    Returns
    -------
    str
        SVG 마크업.
    """
    weekdays = GRID_DAYS
    max_period = int(data.get("maxPeriod") or 10)
    lookup: dict[str, dict[str, Any]] = {}
    for cell in data.get("cells") or []:
        lookup[f"{cell.get('day')}:{cell.get('period')}"] = cell
    pad_x, left, header_h, day_h, col_w, row_h = 20, 96, 84, 40, 168, 72
    table_w = len(weekdays) * col_w
    table_h = max_period * row_h
    width = pad_x + left + table_w + pad_x
    height = header_h + day_h + table_h + 36
    top = header_h + day_h
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#ffffff"/>',
        f'<text x="{pad_x}" y="36" font-family="Malgun Gothic, sans-serif" font-size="22" font-weight="700" fill="#111827">{_esc(title)}</text>',
        f'<text x="{pad_x}" y="62" font-family="Malgun Gothic, sans-serif" font-size="14" fill="#2563eb">{data.get("courseCount") or 0}과목 · {data.get("totalCredits") or 0}학점'
        + (f' · 충돌 {data.get("conflictCount")}건' if data.get("conflictCount") else "")
        + "</text>",
        f'<rect x="{pad_x}" y="{header_h}" width="{left}" height="{day_h}" fill="#111827"/>',
        f'<text x="{pad_x + left / 2}" y="{header_h + 26}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="13" fill="#fff">시각</text>',
        f'<rect x="{pad_x + left}" y="{header_h}" width="{table_w}" height="{day_h}" fill="#111827"/>',
    ]
    for i, day in enumerate(weekdays):
        x = pad_x + left + i * col_w + col_w / 2
        parts.append(
            f'<text x="{x}" y="{header_h + 26}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="15" font-weight="700" fill="#fff">{day}</text>'
        )
    for period in range(1, max_period + 1):
        y = top + (period - 1) * row_h
        bg = "#ffffff" if period % 2 == 0 else "#f8fafc"
        parts.append(
            f'<rect x="{pad_x}" y="{y}" width="{left}" height="{row_h}" fill="{bg}" stroke="#e5e7eb"/>'
        )
        parts.append(
            f'<text x="{pad_x + left / 2}" y="{y + row_h / 2 - 2}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="14" font-weight="700" fill="#111827">{period_start(period)}</text>'
        )
        parts.append(
            f'<text x="{pad_x + left / 2}" y="{y + row_h / 2 + 14}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="10" fill="#9ca3af">~{period_end(period)}</text>'
        )
        for i in range(len(weekdays)):
            x = pad_x + left + i * col_w
            parts.append(
                f'<rect x="{x}" y="{y}" width="{col_w}" height="{row_h}" fill="{bg}" stroke="#e5e7eb"/>'
            )

    color_of: dict[str, int] = {}
    for sub in data.get("subjects") or []:
        color_of[f"{sub.get('subjtCd')}-{sub.get('corseDvclsNo')}"] = int(sub.get("color") or 0)

    for di, day in enumerate(weekdays):
        period = 1
        while period <= max_period:
            cell = lookup.get(f"{day}:{period}")
            if not cell or not cell.get("subjects"):
                period += 1
                continue
            key = "|".join(f"{s.get('subjtCd')}-{s.get('corseDvclsNo')}" for s in cell["subjects"])
            end = period
            while end + 1 <= max_period:
                nxt = lookup.get(f"{day}:{end + 1}")
                if not nxt or not nxt.get("subjects"):
                    break
                nkey = "|".join(f"{s.get('subjtCd')}-{s.get('corseDvclsNo')}" for s in nxt["subjects"])
                if nkey != key:
                    break
                end += 1
            fill, stroke, text_c = SUBJECT_PALETTE[color_of.get(key.split("|")[0], 0) % len(SUBJECT_PALETTE)]
            if cell.get("hasConflict"):
                stroke = "#dc2626"
            x = pad_x + left + di * col_w + 5
            y = top + (period - 1) * row_h + 4
            h = (end - period + 1) * row_h - 8
            w = col_w - 10
            parts.append(
                f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="1.4"/>'
            )
            names = " / ".join(str(s.get("subjtNm") or "") for s in cell["subjects"])
            profs = ", ".join(
                dict.fromkeys(str(s.get("chrgInstrEmpnm") or "") for s in cell["subjects"] if s.get("chrgInstrEmpnm"))
            )
            places = " / ".join(
                dict.fromkeys(str(s.get("place") or "") for s in cell["subjects"] if s.get("place"))
            )
            ty = y + 22
            parts.append(
                f'<text x="{x + w / 2}" y="{ty}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="12" font-weight="700" fill="{text_c}">{_esc(names[:18])}</text>'
            )
            if profs:
                parts.append(
                    f'<text x="{x + w / 2}" y="{ty + 16}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="11" fill="{text_c}">{_esc(profs[:18])}</text>'
                )
            if places:
                parts.append(
                    f'<text x="{x + w / 2}" y="{ty + 32}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="10" fill="{text_c}">{_esc(places[:20])}</text>'
                )
            period = end + 1
    parts.append("</svg>")
    return "".join(parts)
