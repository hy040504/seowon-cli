/**
 * 간이 시간표 유틸 (희망바구니·본신청 확정 목록 공용).
 *
 * 서버 합산 시간표는 ClipReport(callReport.jsp) 이미지뿐이라,
 * 과목 목록의 timtbNm 문자열을 파싱해 요일×교시 그리드를 구성한다.
 * 이미지 출력은 AI 생성이 아니라 SVG/PNG 데이터 렌더다.
 */

import fsPromises from "node:fs/promises";
import path from "node:path";

import type {
  SugangHopeBasketTimetable,
  SugangHopeBasketTimetableCell,
  SugangStudentInfo,
  SugangTimetableSubjectLike,
  SugangTimtbSlot,
  SugangWeekdayCode
} from "./types/basket.js";

/** 월~일 순서 (dayIndex 기준) */
export const SUGANG_WEEKDAYS: readonly SugangWeekdayCode[] = [
  "월",
  "화",
  "수",
  "목",
  "금",
  "토",
  "일"
] as const;

/**
 * 서원대 학부 교시 → 시작/종료 시각 (24시간제).
 * 나무위키·학사 안내 기준: 1교시 09:00, 5교시 13:00 …
 */
export const SEOWON_PERIOD_TIMES: Readonly<Record<number, { start: string; end: string }>> = {
  1: { start: "09:00", end: "09:50" },
  2: { start: "10:00", end: "10:50" },
  3: { start: "11:00", end: "11:50" },
  4: { start: "12:00", end: "12:50" },
  5: { start: "13:00", end: "13:50" },
  6: { start: "14:00", end: "14:50" },
  7: { start: "15:00", end: "15:50" },
  8: { start: "16:00", end: "16:50" },
  9: { start: "17:00", end: "17:50" },
  10: { start: "18:00", end: "18:50" },
  11: { start: "19:00", end: "19:50" },
  12: { start: "20:00", end: "20:50" },
  13: { start: "21:00", end: "21:50" },
  14: { start: "22:00", end: "22:50" },
  15: { start: "23:00", end: "23:50" }
};

const WEEKDAY_SET = new Set<string>(SUGANG_WEEKDAYS);

/**
 * 교시 번호의 시작 시각(HH:mm)을 반환한다
 * @param {number} period - 교시 (1…)
 * @returns {string} 24시간제 시작 시각. 맵에 없으면 추정값
 */
export function getSeowonPeriodStartTime(period: number): string {
  const known = SEOWON_PERIOD_TIMES[period];
  if (known) return known.start;
  // 1교시 09:00 기준, 교시당 1시간 가정
  if (!Number.isFinite(period) || period < 1) return "";
  const minutes = 9 * 60 + (period - 1) * 60;
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * 교시 번호의 종료 시각(HH:mm)을 반환한다
 * @param {number} period - 교시 (1…)
 * @returns {string} 24시간제 종료 시각
 */
export function getSeowonPeriodEndTime(period: number): string {
  const known = SEOWON_PERIOD_TIMES[period];
  if (known) return known.end;
  const start = getSeowonPeriodStartTime(period);
  if (!start) return "";
  const [hh, mm] = start.split(":").map(Number);
  const total = (hh ?? 0) * 60 + (mm ?? 0) + 50;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 한 과목의 timtbNm 원문을 교시 슬롯 배열로 파싱한다
 *
 * 지원 예:
 * - `금 5,6,7,8 컴퓨터실습실3 …`
 * - `화 5,6 …\n수 5,6 …` (여러 줄)
 * - `수 10 컴퓨터실습실6 …`
 *
 * @param {string} timtbNm - 서버 시간표 문자열
 * @returns {SugangTimtbSlot[]} 요일·교시 단위 슬롯 (파싱 실패 시 빈 배열)
 */
export function parseTimtbNm(timtbNm: string): SugangTimtbSlot[] {
  if (!timtbNm || !String(timtbNm).trim()) return [];

  const lines = String(timtbNm)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const slots: SugangTimtbSlot[] = [];
  // 요일 + 교시(콤마/공백) + 나머지 장소
  const linePattern = /^(월|화|수|목|금|토|일)\s+([\d,\s]+)\s*(.*)$/u;

  for (const line of lines) {
    const match = line.match(linePattern);
    if (!match) continue;

    const day = match[1] as SugangWeekdayCode;
    if (!WEEKDAY_SET.has(day)) continue;

    const periodTokens = (match[2] ?? "")
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    const place = (match[3] ?? "").trim();
    const dayIndex = SUGANG_WEEKDAYS.indexOf(day);

    for (const token of periodTokens) {
      const period = Number(token);
      if (!Number.isFinite(period) || period <= 0) continue;
      slots.push({
        day,
        dayIndex,
        period,
        place,
        rawLine: line
      });
    }
  }

  return slots;
}

/**
 * 과목 목록의 timtbNm 으로 간이 시간표를 구성한다
 * (희망바구니·본신청 확정 목록 모두 사용 가능)
 * @param {T[]} subjects - timtbNm 을 가진 과목 목록
 * @returns {SugangHopeBasketTimetable<T>} 슬롯/셀/충돌/학점 합 집계
 */
export function buildHopeBasketTimetable<T extends SugangTimetableSubjectLike>(
  subjects: T[]
): SugangHopeBasketTimetable<T> {
  const slots: Array<SugangTimtbSlot & { subject: T }> = [];
  const unparsed: Array<{ subject: T; timtbNm: string }> = [];
  let totalCredits = 0;

  for (const subject of subjects) {
    const credit = Number(subject.cmpsjCdt);
    if (Number.isFinite(credit)) totalCredits += credit;

    const parsed = parseTimtbNm(subject.timtbNm);
    if (!parsed.length && subject.timtbNm?.trim()) {
      unparsed.push({ subject, timtbNm: subject.timtbNm });
      continue;
    }
    for (const slot of parsed) {
      slots.push({ ...slot, subject });
    }
  }

  const cellMap = new Map<string, SugangHopeBasketTimetableCell>();
  for (const slot of slots) {
    const key = `${slot.dayIndex}:${slot.period}`;
    let cell = cellMap.get(key);
    if (!cell) {
      cell = {
        day: slot.day,
        period: slot.period,
        subjects: [],
        hasConflict: false
      };
      cellMap.set(key, cell);
    }
    cell.subjects.push({
      subjtCd: slot.subject.subjtCd,
      subjtNm: slot.subject.subjtNm,
      corseDvclsNo: slot.subject.corseDvclsNo,
      place: slot.place,
      cmpsjCdt: slot.subject.cmpsjCdt,
      chrgInstrEmpnm: slot.subject.chrgInstrEmpnm ?? ""
    });
    cell.hasConflict = cell.subjects.length > 1;
  }

  const cells = [...cellMap.values()].sort((a, b) => {
    const dayDiff = SUGANG_WEEKDAYS.indexOf(a.day) - SUGANG_WEEKDAYS.indexOf(b.day);
    if (dayDiff !== 0) return dayDiff;
    return a.period - b.period;
  });

  return {
    subjects,
    slots,
    cells,
    totalCredits,
    courseCount: subjects.length,
    conflicts: cells.filter((cell) => cell.hasConflict),
    unparsed
  };
}

/**
 * 간이 시간표를 CLI용 ASCII 그리드 문자열로 만든다
 * @param {SugangHopeBasketTimetable} timetable - buildHopeBasketTimetable 결과
 * @param {{ maxPeriod?: number; weekdays?: SugangWeekdayCode[] }} [options] - 표시 옵션
 * @returns {string} 콘솔 출력용 그리드
 */
export function formatHopeBasketTimetableGrid<T extends SugangTimetableSubjectLike>(
  timetable: SugangHopeBasketTimetable<T>,
  options: {
    maxPeriod?: number;
    weekdays?: SugangWeekdayCode[];
  } = {}
): string {
  const weekdays = options.weekdays ?? (["월", "화", "수", "목", "금"] as SugangWeekdayCode[]);
  const periodFromSlots = timetable.slots.reduce((max, slot) => Math.max(max, slot.period), 0);
  const maxPeriod = Math.max(options.maxPeriod ?? 0, periodFromSlots, 10);

  const cellLookup = new Map<string, SugangHopeBasketTimetableCell>();
  for (const cell of timetable.cells) {
    cellLookup.set(`${cell.day}:${cell.period}`, cell);
  }

  const colWidth = 18;
  const header = ["시각", ...weekdays]
    .map((label, index) => (index === 0 ? pad(label, 7) : pad(label, colWidth)))
    .join(" ");

  const lines: string[] = [
    `신청과목수=${timetable.courseCount}  신청학점=${timetable.totalCredits}`,
    header,
    "-".repeat(header.length)
  ];

  for (let period = 1; period <= maxPeriod; period++) {
    const timeLabel = getSeowonPeriodStartTime(period);
    const row = [
      pad(timeLabel || String(period), 7),
      ...weekdays.map((day) => {
        const cell = cellLookup.get(`${day}:${period}`);
        if (!cell?.subjects.length) return pad("", colWidth);
        const label = cell.subjects
          .map((item) => {
            const room = item.place ? shortPlace(item.place, 8) : "";
            const prof = item.chrgInstrEmpnm ? `/${item.chrgInstrEmpnm}` : "";
            return `${shortSubjectLabel(item.subjtNm, item.corseDvclsNo)}${prof}${room ? `@${room}` : ""}`;
          })
          .join(" | ");
        const text = cell.hasConflict ? `!${label}` : label;
        return pad(text, colWidth);
      })
    ];
    lines.push(row.join(" "));
  }

  if (timetable.conflicts.length) {
    lines.push("");
    lines.push(`[시간 충돌 ${timetable.conflicts.length}건]`);
    for (const cell of timetable.conflicts) {
      const names = cell.subjects
        .map((item) => `${item.subjtNm}(${item.subjtCd}-${item.corseDvclsNo})`)
        .join(", ");
      lines.push(`  ${cell.day} ${cell.period}교시: ${names}`);
    }
  }

  if (timetable.unparsed.length) {
    lines.push("");
    lines.push(`[시간표 문자열 미파싱 ${timetable.unparsed.length}건]`);
    for (const item of timetable.unparsed) {
      lines.push(
        `  [${item.subject.subjtCd}-${item.subject.corseDvclsNo}] ${item.subject.subjtNm}: ${item.timtbNm.replace(/\s+/g, " ")}`
      );
    }
  }

  return lines.join("\n");
}

/**
 * 간이 시간표를 이미지용 SVG 문자열로 렌더링한다
 *
 * AI 이미지 생성이 아니라 데이터 기반 벡터 그리드라 과목명/시각이 정확하다.
 * 연속 동일 과목 교시는 세로로 합쳐 표시한다.
 * 좌측 축은 교시 번호가 아니라 24시간제 시작 시각(09:00, 13:00 …)이다.
 *
 * @param {SugangHopeBasketTimetable} timetable - 시간표 집계
 * @param {{ title?: string; subtitle?: string; maxPeriod?: number; weekdays?: SugangWeekdayCode[] }} [options] - 렌더 옵션
 * @returns {string} SVG 문서 문자열
 */
export function renderHopeBasketTimetableSvg<T extends SugangTimetableSubjectLike>(
  timetable: SugangHopeBasketTimetable<T>,
  options: {
    title?: string;
    subtitle?: string;
    maxPeriod?: number;
    weekdays?: SugangWeekdayCode[];
  } = {}
): string {
  const weekdays = options.weekdays ?? (["월", "화", "수", "목", "금"] as SugangWeekdayCode[]);
  const periodFromSlots = timetable.slots.reduce((max, slot) => Math.max(max, slot.period), 0);
  const maxPeriod = Math.max(options.maxPeriod ?? 0, periodFromSlots, 10);
  const title = options.title ?? "수강희망바구니 시간표";
  const subtitle =
    options.subtitle ??
    `신청 ${timetable.courseCount}과목 · ${timetable.totalCredits}학점` +
      (timetable.conflicts.length ? ` · 충돌 ${timetable.conflicts.length}건` : "");

  const cellLookup = new Map<string, SugangHopeBasketTimetableCell>();
  for (const cell of timetable.cells) {
    cellLookup.set(`${cell.day}:${cell.period}`, cell);
  }

  const colorByKey = new Map<string, { fill: string; stroke: string; text: string }>();
  const palette = SUBJECT_PALETTE;
  let paletteIndex = 0;

  // 상단 제목 영역을 표와 분리해 가리지 않도록 여유를 둔다
  // 강의실 전체 문구·교수명을 넣기 위해 칸을 넓고 높게 잡는다
  const padX = 20;
  const headerBandH = 92;
  const dayHeaderH = 40;
  const left = 96;
  const top = headerBandH + dayHeaderH;
  const colW = 196;
  const rowH = 78;
  const tableW = weekdays.length * colW;
  const tableH = maxPeriod * rowH;
  const width = padX + left + tableW + padX;
  const footerH = 40;
  const height = top + tableH + footerH;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  parts.push(`<rect width="100%" height="100%" fill="#f4f6fb"/>`);

  // 제목 밴드 (표 밖)
  parts.push(`<rect x="0" y="0" width="${width}" height="${headerBandH}" fill="#ffffff"/>`);
  parts.push(
    `<text x="${padX}" y="36" font-family="${FONT_FAMILY}" font-size="22" font-weight="700" fill="#111827">${escapeXml(title)}</text>`
  );
  parts.push(
    `<text x="${padX}" y="62" font-family="${FONT_FAMILY}" font-size="14" font-weight="600" fill="#2563eb">${escapeXml(subtitle)}</text>`
  );
  parts.push(
    `<text x="${padX}" y="82" font-family="${FONT_FAMILY}" font-size="11" fill="#6b7280">좌측=시작 시각(24시간제) · 블록=과목명 / 교수 / 강의실(전체)</text>`
  );
  parts.push(
    `<line x1="0" y1="${headerBandH}" x2="${width}" y2="${headerBandH}" stroke="#e5e7eb" stroke-width="1"/>`
  );

  // 요일 헤더
  const dayHeaderY = headerBandH;
  parts.push(
    `<rect x="${padX}" y="${dayHeaderY}" width="${left}" height="${dayHeaderH}" fill="#111827"/>`
  );
  parts.push(
    `<text x="${padX + left / 2}" y="${dayHeaderY + 26}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="13" font-weight="600" fill="#fff">시각</text>`
  );
  parts.push(
    `<rect x="${padX + left}" y="${dayHeaderY}" width="${tableW}" height="${dayHeaderH}" fill="#111827"/>`
  );
  weekdays.forEach((day, index) => {
    const x = padX + left + index * colW + colW / 2;
    parts.push(
      `<text x="${x}" y="${dayHeaderY + 26}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="#fff">${day}</text>`
    );
  });

  // 격자 배경 + 시각 라벨
  for (let period = 1; period <= maxPeriod; period++) {
    const y = top + (period - 1) * rowH;
    const bg = period % 2 === 0 ? "#ffffff" : "#f8fafc";
    const start = getSeowonPeriodStartTime(period);
    const end = getSeowonPeriodEndTime(period);

    parts.push(
      `<rect x="${padX}" y="${y}" width="${left}" height="${rowH}" fill="${bg}" stroke="#e5e7eb"/>`
    );
    parts.push(
      `<text x="${padX + left / 2}" y="${y + rowH / 2 - 2}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="14" font-weight="700" fill="#111827">${start}</text>`
    );
    parts.push(
      `<text x="${padX + left / 2}" y="${y + rowH / 2 + 14}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="10" fill="#9ca3af">~${end}</text>`
    );

    weekdays.forEach((_, dayIndex) => {
      const x = padX + left + dayIndex * colW;
      parts.push(
        `<rect x="${x}" y="${y}" width="${colW}" height="${rowH}" fill="${bg}" stroke="#e5e7eb"/>`
      );
    });
  }

  // 요일별 연속 블록
  weekdays.forEach((day, dayIndex) => {
    const blocks = buildDayBlocks(day, maxPeriod, cellLookup);
    for (const block of blocks) {
      const key = block.subjects.map((item) => `${item.subjtCd}-${item.corseDvclsNo}`).join("|");
      if (!colorByKey.has(key)) {
        const color = palette[paletteIndex % palette.length]!;
        paletteIndex += 1;
        colorByKey.set(key, color);
      }
      const color = colorByKey.get(key)!;
      const x = padX + left + dayIndex * colW + 5;
      const y = top + (block.startPeriod - 1) * rowH + 4;
      const h = (block.endPeriod - block.startPeriod + 1) * rowH - 8;
      const w = colW - 10;
      const stroke = block.hasConflict ? "#dc2626" : color.stroke;
      const strokeW = block.hasConflict ? 2.5 : 1.2;

      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${color.fill}" stroke="${stroke}" stroke-width="${strokeW}"/>`
      );

      const isShort = block.endPeriod === block.startPeriod;
      
      // 칸 너비 기준 대략 글자 수 (조금 여유 있게)
      const maxChars = Math.max(10, Math.floor((w - 10) / 10));
      const names = block.subjects.map((item) => isShort ? `${item.subjtNm} (${item.cmpsjCdt || "?"}학점)` : item.subjtNm).join(" / ");
      const profs = uniqueNonEmpty(block.subjects.map((item) => item.chrgInstrEmpnm)).join(", ");
      // 강의실은 자르지 않고 줄바꿈으로 전부 표시
      const placeText = uniqueNonEmpty(block.subjects.map((item) => item.place)).join(" / ");
      const creditsText = isShort ? "" : block.subjects.map((item) => `(${item.cmpsjCdt || "?"}학점)`).join(" / ");

      const lines: Array<{ text: string; size: number; weight: number; opacity: number }> = [];
      for (const piece of wrapText(names, maxChars)) {
        lines.push({ text: piece, size: 12, weight: 700, opacity: 1 });
      }
      if (profs) {
        for (const piece of wrapText(profs, maxChars)) {
          lines.push({ text: piece, size: 11, weight: 600, opacity: 0.95 });
        }
      } else {
        lines.push({ text: "(교수 미확인)", size: 10, weight: 500, opacity: 0.55 });
      }
      if (placeText) {
        for (const piece of wrapText(placeText, maxChars)) {
          lines.push({ text: piece, size: 10, weight: 500, opacity: 0.92 });
        }
      }
      if (creditsText) {
        lines.push({ text: creditsText, size: 11, weight: 600, opacity: 0.85 });
      }

      // 블록 높이에 맞춰 위에서부터 채움 (코드/과목번호는 표시하지 않음)
      const lineGap = 13;
      const maxLines = Math.max(1, Math.floor((h - 10) / lineGap));
      const visible = lines.slice(0, maxLines);
      const blockTextH = visible.length * lineGap;
      let textY = y + Math.max(14, (h - blockTextH) / 2 + 11);
      for (const line of visible) {
        parts.push(
          `<text x="${x + w / 2}" y="${textY}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${line.size}" font-weight="${line.weight}" fill="${color.text}" opacity="${line.opacity}">${escapeXml(line.text)}</text>`
        );
        textY += lineGap;
      }

      if (block.hasConflict) {
        parts.push(
          `<text x="${x + 8}" y="${y + 14}" font-family="${FONT_FAMILY}" font-size="10" font-weight="700" fill="#dc2626">충돌</text>`
        );
      }
    }
  });

  const footerY = height - 16;
  if (timetable.conflicts.length) {
    parts.push(
      `<text x="${padX}" y="${footerY}" font-family="${FONT_FAMILY}" font-size="11" fill="#dc2626">※ 빨간 테두리/충돌 = 같은 요일·시각에 과목이 겹침</text>`
    );
  } else {
    parts.push(
      `<text x="${padX}" y="${footerY}" font-family="${FONT_FAMILY}" font-size="11" fill="#9ca3af">문자 데이터 기반 간이 시간표 · 학교 공식 시간표와 다를 수 있음</text>`
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

/**
 * 시간표를 HTML로 저장하고, 가능하면 PNG 스크린샷도 만든다
 *
 * SVG 단독 파일은 뷰어 호환 문제로 만들지 않는다.
 * 내부 렌더는 SVG 마크업이지만 HTML에 임베드해서 브라우저로 연다.
 *
 * @param {SugangHopeBasketTimetable} timetable - 시간표 집계
 * @param {{ outputDir?: string; fileBaseName?: string; title?: string; tryPng?: boolean }} [options] - 저장 옵션
 * @returns {Promise<{ htmlPath: string; pngPath?: string }>} 생성된 파일 경로
 */
export async function exportHopeBasketTimetableImage<T extends SugangTimetableSubjectLike>(
  timetable: SugangHopeBasketTimetable<T>,
  options: {
    outputDir?: string;
    fileBaseName?: string;
    fileNamePrefix?: string;
    title?: string;
    subtitle?: string;
    tryPng?: boolean;
  } = {}
): Promise<{ htmlPath: string; pngPath?: string }> {
  const outputDir = path.resolve(options.outputDir ?? process.cwd());
  await fsPromises.mkdir(outputDir, { recursive: true });

  const base =
    options.fileBaseName ?? buildKoreanTimetableFileBaseName(options.fileNamePrefix);
  const htmlPath = path.join(outputDir, `${base}.html`);
  const pngPathCandidate = path.join(outputDir, `${base}.png`);

  const svg = renderHopeBasketTimetableSvg(timetable, { title: options.title, subtitle: options.subtitle });
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeXml(options.title ?? "수강희망바구니 시간표")}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #eef2ff; overflow: hidden; }
    .wrap { display: inline-block; background: #fff; border-radius: 12px; box-shadow: 0 8px 24px rgba(15,23,42,.12); padding: 8px; }
  </style>
</head>
<body>
  <div class="wrap" id="timetable-root">${svg}</div>
</body>
</html>`;

  await fsPromises.writeFile(htmlPath, html, "utf8");

  // 웹은 브라우저에서 SVG→PNG 를 그린다. puppeteer 는 가져오지 않는다.
  void pngPathCandidate;
  void options.tryPng;
  return { htmlPath };
}

/**
 * 한국어 시간표 파일 기본 이름(확장자 제외)을 만든다
 * 예: 희망바구니_시간표_2026-07-31_20-15-30
 * @param {string} [prefix="희망바구니_시간표"] - 파일명 접두어
 * @returns {string} 파일 기본 이름
 */
export function buildKoreanTimetableFileBaseName(prefix = "희망바구니_시간표"): string {
  const now = new Date();
  /** 숫자를 2자리 0 채움 문자열로 변환하는 헬퍼 */
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join("-") +
    "_" +
    [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("-");
  return `${prefix}_${stamp}`;
}

const SMT_DISPLAY_NAME: Record<string, string> = {
  "10": "1",
  "11": "여름",
  "20": "2",
  "21": "겨울"
};

/**
 * 시간표 이미지 부제(학번·학과·학기 + 과목/학점 집계)를 만든다
 * @param {Pick<SugangStudentInfo, "stuno" | "deprtNm" | "hy" | "syy" | "smtCd">} [student] - 학생 정보
 * @param {{ courseCount: number; totalCredits: number; conflicts: unknown[] }} timetable - 집계
 * @param {string} [countLabel="신청"] - 과목 수 앞 라벨
 * @returns {string} 부제 문자열
 */
export function formatStudentTimetableSubtitle(
  student:
    | Pick<SugangStudentInfo, "stuno" | "deprtNm" | "hy" | "syy" | "smtCd">
    | undefined,
  timetable: {
    courseCount: number;
    totalCredits: number;
    conflicts: unknown[];
  },
  countLabel = "신청"
): string {
  const stats =
    `${countLabel} ${timetable.courseCount}과목 · ${timetable.totalCredits}학점` +
    (timetable.conflicts.length ? ` · 충돌 ${timetable.conflicts.length}건` : "");
  if (!student) return stats;
  const smtName = SMT_DISPLAY_NAME[student.smtCd] || student.smtCd;
  const grade = student.hy ? `${student.hy}학년` : "";
  return `${student.stuno} · ${student.deprtNm || ""} ${grade} · ${student.syy}학년도 ${smtName}학기 | ${stats}`
    .replace(/\s+/g, " ")
    .trim();
}

const FONT_FAMILY = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Segoe UI',sans-serif";

/** 과목 카드 색상 팔레트 */
const SUBJECT_PALETTE: Array<{ fill: string; stroke: string; text: string }> = [
  { fill: "#dbeafe", stroke: "#2563eb", text: "#1e3a8a" },
  { fill: "#dcfce7", stroke: "#16a34a", text: "#14532d" },
  { fill: "#fef3c7", stroke: "#d97706", text: "#78350f" },
  { fill: "#fce7f3", stroke: "#db2777", text: "#831843" },
  { fill: "#e0e7ff", stroke: "#4f46e5", text: "#312e81" },
  { fill: "#ffedd5", stroke: "#ea580c", text: "#7c2d12" },
  { fill: "#ccfbf1", stroke: "#0d9488", text: "#134e4a" },
  { fill: "#ede9fe", stroke: "#7c3aed", text: "#4c1d95" },
  { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d" },
  { fill: "#ecfccb", stroke: "#65a30d", text: "#365314" }
];

/**
 * 그리드 칸에 들어갈 짧은 과목 라벨을 만든다
 * @param {string} name - 과목명
 * @param {string} section - 분반
 * @returns {string} 축약 라벨
 * @private
 */
function shortSubjectLabel(name: string, section: string): string {
  const base = name.length > 10 ? `${name.slice(0, 9)}…` : name;
  return section ? `${base}-${section}` : base;
}

/**
 * 고정 폭 패딩 (한글 폭은 대략 2칸으로 취급하지 않고 단순 slice)
 * @param {string} text - 원문
 * @param {number} width - 목표 폭
 * @returns {string} 패딩된 문자열
 * @private
 */
function pad(text: string, width: number): string {
  const value = text ?? "";
  if (value.length >= width) return value.slice(0, width);
  return value + " ".repeat(width - value.length);
}

/**
 * 한 요일 열에서 연속 동일 과목 블록을 만든다
 * @private
 */
function buildDayBlocks(
  day: SugangWeekdayCode,
  maxPeriod: number,
  cellLookup: Map<string, SugangHopeBasketTimetableCell>
): Array<{
  startPeriod: number;
  endPeriod: number;
  subjects: SugangHopeBasketTimetableCell["subjects"];
  hasConflict: boolean;
}> {
  const blocks: Array<{
    startPeriod: number;
    endPeriod: number;
    subjects: SugangHopeBasketTimetableCell["subjects"];
    hasConflict: boolean;
  }> = [];

  let period = 1;
  while (period <= maxPeriod) {
    const cell = cellLookup.get(`${day}:${period}`);
    if (!cell?.subjects.length) {
      period += 1;
      continue;
    }
    const key = cell.subjects.map((item) => `${item.subjtCd}-${item.corseDvclsNo}`).join("|");
    let end = period;
    while (end + 1 <= maxPeriod) {
      const next = cellLookup.get(`${day}:${end + 1}`);
      if (!next?.subjects.length) break;
      const nextKey = next.subjects.map((item) => `${item.subjtCd}-${item.corseDvclsNo}`).join("|");
      if (nextKey !== key) break;
      end += 1;
    }
    blocks.push({
      startPeriod: period,
      endPeriod: end,
      subjects: cell.subjects,
      hasConflict: cell.hasConflict
    });
    period = end + 1;
  }
  return blocks;
}

/**
 * XML 특수문자를 이스케이프한다
 * @private
 */
function escapeXml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 표시용 텍스트를 자른다
 * @private
 */
function truncateText(text: string, maxChars: number): string {
  const value = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if ([...value].length <= maxChars) return value;
  return `${[...value].slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

/**
 * 긴 문자열을 여러 줄로 나눈다 (말줄임 없음).
 * 공백이 있으면 단어 단위로 우선 끊고, 한 단어가 너무 길면 글자 단위로 자른다.
 * @param {string} text - 원문
 * @param {number} maxCharsPerLine - 줄당 최대 글자 수
 * @returns {string[]} 줄 배열
 * @private
 */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const value = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return [];
  const limit = Math.max(4, maxCharsPerLine);
  const words = value.split(" ");
  const lines: string[] = [];
  let current = "";

  /** 현재 조립 중인 줄을 결과 배열에 저장하는 헬퍼 */
  const flush = () => {
    if (current) {
      lines.push(current);
      current = "";
    }
  };

  /** 단어가 줄 바꿈 길이 제한을 초과할 때 분할하여 추가하는 헬퍼 */
  const pushChunked = (word: string) => {
    const chars = [...word];
    for (let i = 0; i < chars.length; i += limit) {
      lines.push(chars.slice(i, i + limit).join(""));
    }
  };

  for (const word of words) {
    if (!word) continue;
    if ([...word].length > limit) {
      flush();
      pushChunked(word);
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if ([...next].length <= limit) {
      current = next;
    } else {
      flush();
      current = word;
    }
  }
  flush();
  return lines;
}

/**
 * 장소 문자열을 짧게 줄인다 (ASCII 그리드용)
 * @param {string} place - 원문 장소
 * @param {number} [maxChars=14] - 최대 글자 수
 * @returns {string} 축약 장소
 * @private
 */
function shortPlace(place: string, maxChars = 14): string {
  const value = place.replace(/\s+/g, " ").trim();
  if ([...value].length <= maxChars) return value;
  return `${[...value].slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

/**
 * 빈 문자열을 제거하고 중복을 없앤다
 * @private
 */
function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}


