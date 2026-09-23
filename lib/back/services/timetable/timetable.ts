/**
 * 수강 시간표 조회와 그림.
 *
 * 웹에는 희망바구니 담기·취소가 없다.
 * 확정 수강 목록을 먼저 쓰고, SSO가 본신청에 안 붙으면 그때만
 * API 시간표 조회 폴백으로 바구니 목록을 읽는다.
 * 그림은 엔진 SVG 렌더를 재사용하고, 실패하면 격자 SVG 로 대체한다.
 */
import { Resvg } from "@resvg/resvg-js";
import { renderHopeBasketTimetableSvg } from "../../engine/index.js";
import { ensureSugang } from "../ecampus/login.js";
import type { WebSession } from "../../types/session.js";
import type {
  LectureSlot,
  TimetableLike,
  TimetableSubjectLike,
  WebTimetable
} from "../../types/timetable.js";
import { escapeXml } from "../../utils.js";

/** 서원대 학부 교시 → [시작분, 종료분] (자정 기준) */
const PERIOD_MIN: Record<number, [number, number]> = {
  1: [9 * 60, 9 * 60 + 50],
  2: [10 * 60, 10 * 60 + 50],
  3: [11 * 60, 11 * 60 + 50],
  4: [12 * 60, 12 * 60 + 50],
  5: [13 * 60, 13 * 60 + 50],
  6: [14 * 60, 14 * 60 + 50],
  7: [15 * 60, 15 * 60 + 50],
  8: [16 * 60, 16 * 60 + 50],
  9: [17 * 60, 17 * 60 + 50],
  10: [18 * 60, 18 * 60 + 50],
  11: [19 * 60, 19 * 60 + 50],
  12: [20 * 60, 20 * 60 + 50],
  13: [21 * 60, 21 * 60 + 50],
  14: [22 * 60, 22 * 60 + 50]
};

/** 요일 한글 → Date.getDay() 값 */
const DAY_NUM: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

/** 격자 SVG 에 쓰는 평일 */
const GRID_DAYS = ["월", "화", "수", "목", "금"] as const;

/**
 * "월 1,2,3 공학관" / "화1-2" 같은 문자열을 요일·분 단위 슬롯으로 푼다.
 * @param raw - timtbNm 원문
 */
export function parseLectureSlots(raw: string): LectureSlot[] {
  const slots: LectureSlot[] = [];
  const text = String(raw || "");
  const re = /(월|화|수|목|금|토|일)\s*([0-9,\s~\-–]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const day = DAY_NUM[m[1] || ""];
    if (day == null) continue;
    const parts = String(m[2] || "")
      .split(/[,\s]+/)
      .filter(Boolean);
    for (const part of parts) {
      const range = part.match(/^(\d+)\s*[~\-–]\s*(\d+)$/);
      const nums: number[] = [];
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        for (let p = Math.min(a, b); p <= Math.max(a, b); p++) nums.push(p);
      } else if (/^\d+$/.test(part)) {
        nums.push(Number(part));
      }
      for (const p of nums) {
        const t = PERIOD_MIN[p];
        if (!t) continue;
        slots.push({ day, period: p, startMin: t[0], endMin: t[1] });
      }
    }
  }
  return slots;
}

/**
 * 이수 구분 코드·명칭에서 전공/교양 표기를 만든다.
 * @param s - 과목 행
 */
function courseKind(s: TimetableSubjectLike): string {
  const cd = String(s.cmpsjDivCd || "");
  const nm = String(s.estblCrseDivNm || s.cmpsjDivNm || "");
  const blob = `${cd} ${nm}`;
  if (/교양|교필|교선/.test(blob) || ["03", "04", "21", "22"].includes(cd)) return "교양";
  if (/전공|전필|전선/.test(blob) || ["01", "02", "11", "12"].includes(cd)) return "전공";
  return nm || "기타";
}

/**
 * API 시간표를 화면용 과목 목록으로 얇게 직렬화한다.
 * @param tt - getMyRegisteredTimetable / 희망바구니 시간표
 */
function serializeTimetable(tt: TimetableLike) {
  return {
    courseCount: tt.courseCount || 0,
    totalCredits: tt.totalCredits || 0,
    conflictCount: Array.isArray(tt.conflicts) ? tt.conflicts.length : 0,
    subjects: (tt.subjects || []).map((s) => ({
      subjtCd: s.subjtCd || "",
      subjtNm: s.subjtNm || "",
      corseDvclsNo: s.corseDvclsNo || "",
      cmpsjCdt: String(s.cmpsjCdt ?? ""),
      chrgInstrEmpnm: s.chrgInstrEmpnm || "",
      timtbNm: String(s.timtbNm || "")
        .replace(/\s+/g, " ")
        .trim(),
      kind: courseKind(s),
      slots: parseLectureSlots(s.timtbNm || "")
    }))
  };
}

/**
 * 시간표 셀을 요일:교시 키로 모은다.
 * cells 가 없으면 timtbNm 슬롯으로 채운다.
 */
function collectGridCells(timetable: TimetableLike): Map<string, { name: string; place: string }[]> {
  const map = new Map<string, { name: string; place: string }[]>();
  /** 요일과 교시별 셀 데이터 목록에 과목/강의실 정보를 저장하는 헬퍼 */
  const push = (day: string, period: number, name: string, place: string) => {
    if (!(GRID_DAYS as readonly string[]).includes(day) || !period) return;
    const key = `${day}:${period}`;
    const arr = map.get(key) || [];
    arr.push({ name: name || "", place: place || "" });
    map.set(key, arr);
  };
  for (const cell of timetable.cells || []) {
    for (const sub of cell.subjects || []) {
      push(String(cell.day || ""), Number(cell.period), sub.subjtNm || "", sub.place || "");
    }
  }
  if (!map.size) {
    const names = ["일", "월", "화", "수", "목", "금", "토"];
    for (const s of timetable.subjects || []) {
      for (const sl of parseLectureSlots(s.timtbNm || "")) {
        const day = names[sl.day] || "";
        push(day, sl.period, s.subjtNm || "", "");
      }
    }
  }
  return map;
}

/**
 * 공식 SVG 가 없을 때 쓰는 흰 배경 격자 그림.
 */
function renderTimetableSvg(timetable: TimetableLike, title: string): string {
  const cells = collectGridCells(timetable);
  let maxPeriod = 10;
  for (const key of cells.keys()) {
    const p = Number(String(key).split(":")[1]);
    if (p > maxPeriod) maxPeriod = p;
  }
  const colW = 196;
  const rowH = 78;
  const left = 80;
  const top = 88;
  const width = left + GRID_DAYS.length * colW + 16;
  const height = top + maxPeriod * rowH + 16;
  const parts: string[] = [];
  parts.push(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  parts.push(
    `<text x="16" y="36" font-family="Malgun Gothic, sans-serif" font-size="22" font-weight="700" fill="#191f28">${escapeXml(title)}</text>`
  );
  parts.push(
    `<text x="16" y="60" font-family="Malgun Gothic, sans-serif" font-size="14" fill="#8b95a1">${(timetable.subjects || []).length}과목 · ${timetable.totalCredits || 0}학점</text>`
  );
  parts.push(`<rect x="8" y="${top - 28}" width="${left}" height="28" fill="#191f28"/>`);
  parts.push(
    `<text x="${8 + left / 2}" y="${top - 10}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="12" fill="#fff">교시</text>`
  );
  GRID_DAYS.forEach((d, i) => {
    const x = 8 + left + i * colW;
    parts.push(`<rect x="${x}" y="${top - 28}" width="${colW}" height="28" fill="#191f28"/>`);
    parts.push(
      `<text x="${x + colW / 2}" y="${top - 10}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="13" font-weight="700" fill="#fff">${d}</text>`
    );
  });
  for (let p = 1; p <= maxPeriod; p++) {
    const y = top + (p - 1) * rowH;
    parts.push(`<rect x="8" y="${y}" width="${left}" height="${rowH}" fill="#ffffff" stroke="#e5e8eb"/>`);
    parts.push(
      `<text x="${8 + left / 2}" y="${y + 30}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="12" fill="#4e5968">${p}</text>`
    );
    GRID_DAYS.forEach((d, i) => {
      const x = 8 + left + i * colW;
      const items = cells.get(`${d}:${p}`) || [];
      parts.push(`<rect x="${x}" y="${y}" width="${colW}" height="${rowH}" fill="#ffffff" stroke="#e5e8eb"/>`);
      const first = items[0];
      if (first) {
        parts.push(
          `<rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" rx="8" fill="#e8f3ff"/>`
        );
        parts.push(
          `<text x="${x + colW / 2}" y="${y + 32}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="15" font-weight="700" fill="#191f28">${escapeXml((first.name || "").slice(0, 12))}</text>`
        );
        if (first.place) {
          parts.push(
            `<text x="${x + colW / 2}" y="${y + 54}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="12" fill="#8b95a1">${escapeXml(first.place.slice(0, 16))}</text>`
          );
        }
      }
    });
  }
  parts.push(`</svg>`);
  return parts.join("");
}

/**
 * SVG 의 width/height 만 배율로 키운다. viewBox 는 그대로라 레이아웃은 같고 래스터가 선명해진다.
 */
function scaleSvgPixels(svg: string, factor: number): string {
  const n = Number(factor) || 1;
  if (n === 1) return String(svg || "");
  return String(svg || "").replace(
    /<svg([^>]*?)\bwidth="(\d+(?:\.\d+)?)"([^>]*?)\bheight="(\d+(?:\.\d+)?)"/i,
    (_, a1: string, w: string, a2: string, h: string) =>
      `<svg${a1}width="${Math.round(Number(w) * n)}"${a2}height="${Math.round(Number(h) * n)}"`
  );
}

/**
 * 공식 SVG 의 연보라 캔버스·좌우/하단 여백을 잘라 흰 표만 남긴다.
 */
function tightenOfficialSvg(svg: string): string {
  let out = String(svg || "")
    .replace(/fill="#f4f6fb"/gi, 'fill="#ffffff"')
    .replace(/fill="#eef2ff"/gi, 'fill="#ffffff"');

  return scaleSvgPixels(out, 2);
}

/**
 * 시간표 SVG 를 iframe 용 흰 HTML 로 감싼다.
 */
function wrapOfficialHtml(title: string, svg: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeXml(title)}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #ffffff; overflow: hidden; }
    .wrap { display: inline-block; background: #ffffff; line-height: 0; }
    svg { display: block; max-width: 100%; height: auto; shape-rendering: geometricPrecision; text-rendering: geometricPrecision; }
  </style>
</head>
<body>
  <div class="wrap" id="timetable-root">${svg}</div>
  <script>
    /** iframe 크기 변경 시 부모 창에 높이/너비를 전송하는 헬퍼 */
    function reportSize() {
      var root = document.getElementById("timetable-root");
      if (!root || !parent) return;
      var r = root.getBoundingClientRect();
      parent.postMessage({ type: "tt-size", w: Math.ceil(r.width), h: Math.ceil(r.height) }, "*");
    }
    window.addEventListener("load", reportSize);
    window.addEventListener("resize", reportSize);
    // 확대 iframe은 모바일에서 탭 한 번으로 원래 화면으로 돌아가게 한다.
    if (new URLSearchParams(location.search).get("zoom") === "1") {
      document.addEventListener("click", function () {
        parent.postMessage({ type: "tt-close" }, "*");
      });
    }
  </script>
</body>
</html>`;
}

/**
 * 공식 렌더가 있으면 쓰고, 실패하면 격자 SVG 로 대체한다.
 */
async function officialSvg(timetable: TimetableLike, title: string): Promise<string> {
  try {
    const svg = renderHopeBasketTimetableSvg(timetable as never, { title });
    if (svg && String(svg).includes("<svg")) return tightenOfficialSvg(String(svg));
  } catch {
    // 우리 격자 SVG 로 대체
  }
  return scaleSvgPixels(renderTimetableSvg(timetable, title), 2);
}

/**
 * 확정 수강 시간표를 가져온다. 없으면 희망바구니 시간표.
 * 이미지는 API SVG 렌더를 HTML 로 감싼 값이다.
 * @param sess - 웹 세션
 */
export async function fetchTimetable(sess: WebSession): Promise<WebTimetable> {
  await ensureSugang(sess);
  const name = sess.student?.studentName || "";

  if (sess.courseReg) {
    const timetable = (await sess.courseReg.getMyRegisteredTimetable()) as TimetableLike;
    const title = name ? `${name} 수강 시간표` : "수강 시간표";
    const svg = await officialSvg(timetable, title);
    return {
      source: "registered",
      label: "수강 시간표",
      title,
      ...serializeTimetable(timetable),
      svg,
      html: wrapOfficialHtml(title, svg)
    };
  }

  if (sess.hope) {
    const timetable = (await sess.hope.getMyHopeBasketTimetable()) as TimetableLike;
    const title = name ? `${name} 희망바구니 시간표` : "희망바구니 시간표";
    const svg = await officialSvg(timetable, title);
    return {
      source: "basket",
      label: "희망바구니 시간표",
      title,
      ...serializeTimetable(timetable),
      svg,
      html: wrapOfficialHtml(title, svg)
    };
  }

  throw new Error("시간표를 열 세션이 없습니다. 다시 로그인하세요.");
}

/** 시간표 SVG 를 PNG 로 바꾼다. 화면 저장은 이 그림만 쓴다. */
export function renderTimetablePng(svg: string): Buffer {
  const text = String(svg || "").trim();
  if (!text.includes("<svg")) throw new Error("시간표 그림을 만들지 못했습니다.");
  const resvg = new Resvg(text, {
    fitTo: { mode: "width", value: 1400 },
    font: { loadSystemFonts: true, defaultFontFamily: "Malgun Gothic" }
  });
  return Buffer.from(resvg.render().asPng());
}
