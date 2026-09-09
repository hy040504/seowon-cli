"""Nexacro SSV (수강신청 findStunoInfo 등)."""

from __future__ import annotations

RS = "\x1e"
US = "\x1f"
EMPTY = "\x03"


class SsvBuf:
    """Nexacro SSV 요청 본문."""
    def __init__(self) -> None:
        self.parts: list[str] = []

    def begin(self) -> None:
        """헤더부터 다시 쓴다."""
        self.parts = ["SSV:utf-8"]

    def add_param(self, key: str, value: str = "") -> None:
        """요청 파라미터 한 줄."""
        self.parts.append(RS)
        self.parts.append(f"{key}={value}")

    def dataset_begin(self, ident: str, cols: list[str]) -> None:
        """데이터셋 이름과 열."""
        self.parts.append(RS)
        self.parts.append(f"Dataset:{ident}")
        self.parts.append(RS)
        self.parts.append("_RowType_")
        for col in cols:
            self.parts.append(US)
            self.parts.append(f"{col}:STRING(256)")

    def row(self, row_type: str, cells: list[str]) -> None:
        """데이터 행. 빈 칸은 0x03."""
        self.parts.append(RS)
        self.parts.append(row_type or "N")
        for cell in cells:
            self.parts.append(US)
            self.parts.append(EMPTY if not cell else cell)

    def dataset_end(self) -> None:
        """데이터셋 끝 RS."""
        self.parts.append(RS)

    def dumps(self) -> str:
        """완성된 SSV 문자열."""
        return "".join(self.parts)


def _col_index(header: str, col: str) -> int:
    """헤더 행에서 열 이름 위치. `_RowType_` 이 0번."""
    idx = 0
    rest = header
    while rest:
        us_pos = rest.find(US)
        chunk = rest if us_pos < 0 else rest[:us_pos]
        name = chunk.split(":", 1)[0]
        if name == col:
            return idx
        if us_pos < 0:
            break
        rest = rest[us_pos + 1 :]
        idx += 1
    return -1


def ssv_field(body: str, dataset: str, col: str) -> str:
    """첫 데이터 행에서 열 값을 읽는다."""
    mark = f"Dataset:{dataset}"
    ds = body.find(mark)
    if ds < 0:
        raise ValueError("ssv dataset")
    hdr_i = body.find(RS, ds)
    if hdr_i < 0:
        raise ValueError("ssv header")
    hdr = body[hdr_i + 1 :]
    want = _col_index(hdr, col)
    if want < 0:
        raise ValueError("ssv column")
    row_i = hdr.find(RS)
    if row_i < 0:
        raise ValueError("ssv row")
    row = hdr[row_i + 1 :]
    if row.startswith("Dataset:") or not row:
        raise ValueError("ssv row")
    cell = row
    for _ in range(want):
        u = cell.find(US)
        if u < 0:
            raise ValueError("ssv cell")
        cell = cell[u + 1 :]
    rs1 = cell.find(RS)
    u = cell.find(US)
    end = len(cell)
    if u >= 0 and (rs1 < 0 or u < rs1):
        end = u
    elif rs1 >= 0:
        end = rs1
    val = cell[:end]
    if val == EMPTY:
        return ""
    return val
