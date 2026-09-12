"""Nexacro SSV (수강신청 findStunoInfo 등).

요청 본문은 ``SsvBuf``, 응답은 ``ssv_field`` / ``ssv_rows`` 로 읽는다.
"""

from __future__ import annotations

RS = "\x1e"
US = "\x1f"
EMPTY = "\x03"


class SsvBuf:
    """Nexacro SSV 요청 본문.

    Attributes:
        parts: 아직 붙이지 않은 조각.
    """

    def __init__(self) -> None:
        """빈 버퍼를 만든다."""
        self.parts: list[str] = []

    def begin(self) -> None:
        """헤더부터 다시 쓴다."""
        self.parts = ["SSV:utf-8"]

    def add_param(self, key: str, value: str = "") -> None:
        """요청 파라미터 한 줄을 붙인다.

        Args:
            key: 파라미터 이름.
            value: 값. 기본 빈 문자열.
        """
        self.parts.append(RS)
        self.parts.append(f"{key}={value}")

    def dataset_begin(self, ident: str, cols: list[str]) -> None:
        """데이터셋 이름과 열을 연다.

        Args:
            ident: Dataset 이름.
            cols: 열 이름 목록.
        """
        self.parts.append(RS)
        self.parts.append(f"Dataset:{ident}")
        self.parts.append(RS)
        self.parts.append("_RowType_")
        for col in cols:
            self.parts.append(US)
            self.parts.append(f"{col}:STRING(256)")

    def row(self, row_type: str, cells: list[str]) -> None:
        """데이터 행을 붙인다. 빈 칸은 0x03.

        Args:
            row_type: ``N`` / ``U`` / ``O`` 등.
            cells: 열 값. 빈 값은 EMPTY 마커.
        """
        self.parts.append(RS)
        self.parts.append(row_type or "N")
        for cell in cells:
            self.parts.append(US)
            self.parts.append(EMPTY if not cell else cell)

    def dataset_end(self) -> None:
        """데이터셋 끝 RS 를 붙인다."""
        self.parts.append(RS)

    def dumps(self) -> str:
        """완성된 SSV 문자열.

        Returns:
            전송용 본문.
        """
        return "".join(self.parts)


def _col_index(header: str, col: str) -> int:
    """헤더 행에서 열 이름 위치. ``_RowType_`` 이 0번.

    Args:
        header: Dataset 다음 헤더 줄.
        col: 찾을 열 이름.

    Returns:
        0부터의 인덱스. 없으면 -1.
    """
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
    """첫 데이터 행에서 열 값을 읽는다.

    Parameters
    ----------
    body : str
        SSV 응답 본문.
    dataset : str
        Dataset 이름.
    col : str
        열 이름.

    Returns
    -------
    str
        셀 값. EMPTY 마커면 빈 문자열.

    Raises
    ------
    ValueError
        데이터셋·헤더·열·행이 없을 때.
    """
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


def ssv_rows(body: str, dataset: str) -> list[dict[str, str]]:
    """데이터셋의 모든 행을 열 이름 dict 로 돌린다.

    Parameters
    ----------
    body : str
        SSV 응답 본문.
    dataset : str
        Dataset 이름.

    Returns
    -------
    list of dict
        각 행. 데이터셋이 없으면 빈 목록.
    """
    mark = f"Dataset:{dataset}"
    ds = body.find(mark)
    if ds < 0:
        return []
    hdr_i = body.find(RS, ds)
    if hdr_i < 0:
        return []
    hdr_end = body.find(RS, hdr_i + 1)
    if hdr_end < 0:
        return []
    header = body[hdr_i + 1 : hdr_end]
    cols: list[str] = []
    for chunk in header.split(US):
        cols.append(chunk.split(":", 1)[0])
    rows: list[dict[str, str]] = []
    pos = hdr_end
    while pos >= 0:
        nxt = body.find(RS, pos + 1)
        line = body[pos + 1 : nxt if nxt >= 0 else len(body)]
        if line.startswith("Dataset:"):
            break
        if line:
            cells = line.split(US)
            rec: dict[str, str] = {}
            for i, col in enumerate(cols):
                if not col:
                    continue
                val = cells[i] if i < len(cells) else ""
                rec[col] = "" if val == EMPTY else val
            if any(v for k, v in rec.items() if k != "_RowType_"):
                rows.append(rec)
        if nxt < 0:
            break
        pos = nxt
    return rows
