/**
 * 기간·제출·출결 필터.
 *
 * C 쪽 parse.c / util.c 와 같은 뜻으로 dueNow·needsWatch 를 붙인다.
 * 웹 목록·현황 집계가 이 모듈의 판별만 사용한다.
 */
import { htmlToText } from "./utils.js";
import type { Snapshot, SnapshotAssignment, SnapshotCourse, SnapshotLesson, SummaryRow } from "./types/snapshot.js";

/**
 * "2026.08.10 ~ 2026.08.20" 같은 문자열에서 날짜 두 개를 읽는다.
 * 괄호 안 요일 표시는 파싱을 방해하므로 제거한다.
 * @param raw - 기간 문자열
 * @returns [시작 00:00, 종료 23:59:59.999] 또는 없음
 */
export function periodRange(raw: string): [Date, Date] | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/\([^)]*\)/g, " ");
  const found = [...cleaned.matchAll(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g)];
  const first = found[0];
  const second = found[1];
  if (!first || !second) return null;
  const a = new Date(Number(first[1]), Number(first[2]) - 1, Number(first[3]), 0, 0, 0, 0);
  const b = new Date(Number(second[1]), Number(second[2]) - 1, Number(second[3]), 23, 59, 59, 999);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return [a, b];
}

/**
 * 지금이 제출·학습 기간 안인지 판별한다.
 * @param period - 기간 문자열
 * @param now - 기준 시각
 * @returns 기간 안이면 true
 */
export function periodActive(period: string | undefined, now = new Date()): boolean {
  const range = periodRange(period || "");
  if (!range) return false;
  return range[0] <= now && now <= range[1];
}

/**
 * 아직 제출하지 않은 과제인지 판별한다.
 * @param status - 제출 상태 문구
 * @returns 미제출이면 true
 */
export function assignmentUnsubmitted(status: string | undefined): boolean {
  const s = status || "";
  if (!s) return true;
  if (s.includes("과제를 제출") || s.includes("제출하")) return false;
  return true;
}

/**
 * 이미 제출한 과제인지 판별한다.
 * @param status - 제출 상태 문구
 * @returns 제출했으면 true
 */
export function assignmentSubmitted(status: string | undefined): boolean {
  return !assignmentUnsubmitted(status);
}

/** 제출 파일 목록을 이미 본 과제 행 */
type FileAwareAssignment = {
  status?: string;
  period?: string;
  submittedFilesLoaded?: boolean;
  hasSubmittedFile?: boolean;
  submittedAttachments?: unknown[];
};

/**
 * 제출 파일이 실제로 남아 있는지 본다.
 * @param row - 과제 행
 */
export function assignmentHasLoadedFiles(row: FileAwareAssignment | undefined): boolean {
  if (!row) return false;
  if (row.hasSubmittedFile) return true;
  return Array.isArray(row.submittedAttachments) && row.submittedAttachments.length > 0;
}

/**
 * 학교 문구가 제출이어도 파일이 없으면 미제출로 본다.
 * @param row - 과제 행
 */
export function assignmentEffectivelyUnsubmitted(row: FileAwareAssignment): boolean {
  if (row.submittedFilesLoaded === true) return !assignmentHasLoadedFiles(row);
  return assignmentUnsubmitted(row.status);
}

/**
 * 파일 유무를 반영해 dueNow·상태 문구를 다시 붙인다.
 * @param row - 스냅샷 과제
 * @param now - 기준 시각
 */
export function refreshAssignmentDue<T extends SnapshotAssignment>(row: T, now = new Date()): T {
  if (row.submittedFilesLoaded === true && !assignmentHasLoadedFiles(row) && !assignmentUnsubmitted(row.status)) {
    row.status = "미제출";
  }
  row.dueNow = periodActive(row.period, now) && assignmentEffectivelyUnsubmitted(row);
  return row;
}

/**
 * 이 세션에서 제출 파일을 비운 과제를 스냅샷에 미제출·지금 할 일로 되돌린다.
 * @param snapshot - 세션 스냅샷
 * @param emptyKeys - crsCreCd::id 집합
 * @param now - 기준 시각
 */
export function applyEmptyFileAssignments(snapshot: Snapshot, emptyKeys: Iterable<string>, now = new Date()): void {
  const keys = emptyKeys instanceof Set ? emptyKeys : new Set(emptyKeys);
  if (!keys.size) return;
  for (const c of snapshot.courses) {
    for (const a of c.assignments) {
      const key = `${a.crsCreCd || c.crsCreCd}::${a.id}`;
      if (!keys.has(key)) continue;
      a.submittedAttachments = [];
      a.hasSubmittedFile = false;
      a.submittedFilesLoaded = true;
      a.status = "미제출";
      refreshAssignmentDue(a, now);
    }
  }
  snapshot.summary = buildSummary(snapshot.courses);
}

/**
 * 미제출·진행중 전수 조사 대상인지 판별한다.
 * @param status - 제출 상태 문구
 * @returns 조사 대상이면 true
 */
export function assignmentMissingOrProgress(status: string | undefined): boolean {
  const s = status || "";
  if (s === "미제출") return true;
  if (s.includes("진행중")) return true;
  return false;
}

/**
 * 미학습·학습중 차시인지 판별한다.
 * @param attendance - 출결 상태 문구
 * @returns 아직 들을 차시면 true
 */
export function lessonUnwatched(attendance: string | undefined): boolean {
  const s = attendance || "";
  if (!s) return false;
  return s.includes("학습중") || s.includes("미학습");
}

/**
 * 과제에 dueNow 플래그를 붙인다.
 * 기간이 열려 있고 미제출일 때만 true 다.
 * @param row - 과제 행
 * @param now - 기준 시각
 * @returns 플래그가 붙은 같은 객체
 */
export function markAssignment(row: Omit<SnapshotAssignment, "dueNow">, now = new Date()): SnapshotAssignment {
  return refreshAssignmentDue({ ...row, dueNow: false }, now);
}

/**
 * 차시에 needsWatch 플래그를 붙인다.
 * 기간이 열려 있고 미학습·학습중일 때만 true 다.
 * @param row - 차시 행
 * @param now - 기준 시각
 * @returns 플래그가 붙은 같은 객체
 */
export function markLesson(row: Omit<SnapshotLesson, "needsWatch">, now = new Date()): SnapshotLesson {
  return {
    ...row,
    needsWatch: periodActive(row.period, now) && lessonUnwatched(row.attendanceStatus)
  };
}

/** 들을 차시가 비었을 때 이유를 세기 위한 차시 집계 */
export interface LessonWatchFacts {
  total: number;
  unwatched: number;
  unknown: number;
  periodClosed: number;
  periodUnknown: number;
}

/**
 * 전체 차시에서 미학습·기간 밖 건수를 센다.
 * @param lessons - 필터 전 차시
 */
export function lessonWatchFacts(lessons: SnapshotLesson[]): LessonWatchFacts {
  let unwatched = 0;
  let unknown = 0;
  let periodClosed = 0;
  let periodUnknown = 0;
  for (const lesson of lessons) {
    const status = String(lesson.attendanceStatus || "").trim();
    if (!status) {
      unknown += 1;
      continue;
    }
    if (!lessonUnwatched(status)) continue;
    unwatched += 1;
    if (!periodRange(lesson.period || "")) periodUnknown += 1;
    else if (!periodActive(lesson.period)) periodClosed += 1;
  }
  return { total: lessons.length, unwatched, unknown, periodClosed, periodUnknown };
}

/**
 * 들을 차시 목록이 비었을 때 보여줄 문장.
 * @param facts - 전체 차시 집계
 * @returns 문장과, 전부 수강했으면 true
 */
export function watchListEmptyMessage(facts: LessonWatchFacts): { text: string; done: boolean } {
  if (!facts.total) return { text: "등록된 이러닝 차시가 없습니다.", done: false };
  if (!facts.unwatched && !facts.unknown) {
    return { text: `차시 ${facts.total}건을 전부 수강하였습니다.`, done: true };
  }
  if (!facts.unwatched && facts.unknown) {
    return { text: `들을 차시가 없습니다. 출결 상태를 확인하지 못한 차시가 ${facts.unknown}건 있습니다.`, done: false };
  }
  if (facts.periodUnknown && facts.periodUnknown === facts.unwatched) {
    return { text: `미학습 차시 ${facts.unwatched}건은 학습 기간을 확인하지 못했습니다.`, done: false };
  }
  if (facts.periodClosed || facts.periodUnknown) {
    const outside = facts.periodClosed + facts.periodUnknown;
    return { text: `지금은 들을 차시가 없습니다. 미학습 ${outside}건은 수강 기간이 아닙니다.`, done: false };
  }
  return { text: "들을 차시가 없습니다.", done: false };
}

/**
 * 과목별 기간 내 미제출 과제·미완료 이러닝 수를 집계한다.
 * @param courses - 스냅샷 과목 목록
 * @returns 현황 행
 */
export function buildSummary(courses: SnapshotCourse[]): SummaryRow[] {
  return courses.map((c) => ({
    courseTitle: c.courseTitle,
    crsCreCd: c.crsCreCd,
    category: c.category === "extracurricular" ? "extracurricular" : "curricular",
    dueAssignments: c.assignments.filter((a) => a.dueNow).length,
    pendingLessons: c.elearning.filter((l) => l.needsWatch).length
  }));
}

/**
 * 과목 코드에서 학기를 읽는다. 예: 2026_2_... → 2026-2
 * 코드가 없으면 현재 월 기준으로 추정한다.
 * @param crsCreCd - 강의실 코드
 * @returns 학기 문자열
 */
export function semesterFromCode(crsCreCd: string | undefined): string {
  const m = String(crsCreCd || "").match(/^(\d{4})_(\d)/);
  if (m) return `${m[1]}-${m[2]}`;
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1 >= 8 ? 2 : 1}`;
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** "80", "80%", 80 만 학습률로 받는다. */
function percentToken(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return clampPercent(raw);
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{1,3}(?:\.\d+)?)\s*%?$/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return clampPercent(n);
}

const PROGRESS_KEYS = [
  "prgrRatio",
  "progressPercent",
  "studyPrgrRatio",
  "prgrRate",
  "progressRatio",
  "progressRate",
  "studyRate",
  "studyProgress",
  "completionRate",
  "learnRate",
  "prgrRt"
] as const;

function isProgressKey(key: string): boolean {
  return /^(?:prgr|progress|study).*(?:ratio|rate|percent|per|value)$/i.test(key);
}

function cellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 칸 글자가 퍼센트인지. 번호·날짜는 % 가 없다. */
function percentCell(raw: string): number | null {
  if (!/\d/.test(raw) || !/%|％/.test(raw)) return null;
  const m = raw.match(/(\d{1,3}(?:\.\d+)?)\s*[%％]/);
  if (!m?.[1]) return null;
  return clampPercent(Number(m[1]));
}

/** 진도율 칸의 퍼센트를 모은다. 앞 행이 0이어도 뒤 행의 값을 버린다. */
function collectHtmlPercents(html: string, found: number[]): void {
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  let ratioIndex = -1;
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cellText(m[1] || ""));
    if (!cells.length) continue;
    for (const cell of cells) {
      const marked = percentCell(cell);
      if (marked != null) found.push(marked);
    }
    if (ratioIndex < 0) {
      ratioIndex = cells.findIndex((cell) => /진도|학습률|진행률|prgrRatio|prgrRate/i.test(cell));
      continue;
    }
    const raw = cells[ratioIndex];
    if (raw == null) continue;
    const n = percentToken(raw) ?? percentCell(raw);
    if (n != null) found.push(n);
  }

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  for (const match of text.matchAll(/(?:진도율|진도|학습률|진행률|prgrRatio|prgrRate|studyPrgrRatio|progressPercent)[^%]{0,80}?(\d{1,3}(?:\.\d+)?)\s*[%％]/gi)) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) found.push(clampPercent(n));
  }
  for (const match of html.matchAll(/["']?(?:prgrRatio|progressPercent|studyPrgrRatio|prgrRate)["']?\s*[:=]\s*["']?(\d{1,3}(?:\.\d+)?)/gi)) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) found.push(clampPercent(n));
  }
  for (const match of html.matchAll(/class=["'][^"']*(?:progress|prgr|ratio)[^"']*["'][^>]*style=["'][^"']*width\s*:\s*(\d{1,3}(?:\.\d+)?)%/gi)) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) found.push(clampPercent(n));
  }
  for (const match of html.matchAll(/(?:data-(?:progress|prgr-ratio|progress-ratio)|aria-valuenow)\s*=\s*["']?(\d{1,3}(?:\.\d+)?)\s*%?["']?/gi)) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) found.push(clampPercent(n));
  }
  for (const match of text.matchAll(/(?:진도율|진도|학습률|진행률|prgrRatio|prgrRate|studyPrgrRatio|progressPercent|progressRate|progressRatio)\s*[:：=]?\s*(\d{1,3}(?:\.\d+)?)\s*%?/gi)) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) found.push(clampPercent(n));
  }
}

/**
 * 학습 이력 HTML 에서 진도율을 읽는다.
 * 이력 행이 여러 개면 가장 높은 진도율을 쓴다. 이력이 없을 때만 0 이다.
 */
function progressFromHtml(html: string): number | null {
  const found: number[] = [];
  collectHtmlPercents(html, found);
  if (found.length) return Math.max(...found);
  const text = html.replace(/<[^>]+>/g, " ");
  if (/조회된\s*데이터가\s*없습니다|학습\s*이력이\s*없|내역이\s*없습니다/.test(text)) return 0;
  const login = /name=["']encryptData["']|id=["']loginForm["']|type=["']password["']/i.test(html) && /로그인/.test(text);
  if (login) return null;
  return null;
}

function collectProgressPercents(obj: unknown, found: number[], depth: number): void {
  if (obj == null || depth > 8) return;
  if (typeof obj === "string") {
    const trimmed = obj.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length > 1) {
      try {
        collectProgressPercents(JSON.parse(trimmed), found, depth + 1);
        return;
      } catch {
        /* HTML 또는 일반 문자열 */
      }
    }
    const jsonp = trimmed.match(/^[\w$]+\s*\(([\s\S]*)\)\s*;?$/);
    if (jsonp?.[1]) {
      try {
        collectProgressPercents(JSON.parse(jsonp[1]), found, depth + 1);
        return;
      } catch {
        /* JSONP or plain text */
      }
    }
    const token = percentToken(trimmed);
    if (token != null && trimmed.length <= 8) {
      found.push(token);
      return;
    }
    const fromHtml = progressFromHtml(trimmed);
    if (fromHtml != null) found.push(fromHtml);
    return;
  }
  if (typeof obj === "number") {
    const n = percentToken(obj);
    if (n != null) found.push(n);
    return;
  }
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectProgressPercents(item, found, depth + 1);
    return;
  }
  const rec = obj as Record<string, unknown>;
  let keyed = false;
  for (const key of Object.keys(rec)) {
    if (!(PROGRESS_KEYS as readonly string[]).includes(key) && !isProgressKey(key)) continue;
    const value = rec[key];
    if (value == null || value === "") continue;
    keyed = true;
    const n = percentToken(value);
    if (n != null) found.push(n);
    else collectProgressPercents(value, found, depth + 1);
  }
  for (const [key, val] of Object.entries(rec)) {
    if ((PROGRESS_KEYS as readonly string[]).includes(key) || isProgressKey(key)) continue;
    if (typeof val === "string" && /[<>]|진도율|prgrRatio/i.test(val)) collectHtmlPercents(val, found);
    else if (val && typeof val === "object") collectProgressPercents(val, found, depth + 1);
    else if (!keyed && typeof val === "number") continue;
  }
}

/**
 * 학습률 응답에서 퍼센트를 찾는다.
 * prgrRatio / progressPercent 와 진도율 칸만 보고, 그 중 가장 높은 값을 쓴다.
 * 페이지 번호 같은 다른 숫자는 쓰지 않는다.
 * @param obj - 서버 응답 트리 또는 HTML
 * @returns 반올림된 퍼센트. 없으면 null
 */
export function findProgressPercent(obj: unknown): number | null {
  const found: number[] = [];
  collectProgressPercents(obj, found, 0);
  if (!found.length) return null;
  return Math.max(...found);
}

/**
 * 과제 상세 HTML 에서 본문만 남긴다.
 * @param html - 과제 화면 HTML
 * @returns 태그를 걷어 낸 본문
 */
export function assignmentDetailText(html: string): string {
  if (!html) return "";
  let chunk = html;
  const start = html.indexOf("과제내용");
  if (start >= 0) {
    const rest = html.slice(start);
    const end = rest.indexOf("label-title", 8);
    chunk = end >= 0 ? rest.slice(0, end) : rest.slice(0, 4000);
  }
  return htmlToText(chunk);
}

/**
 * 공지 상세 HTML 에서 본문만 남긴다.
 * 게시글 본문 영역을 찾고, 없으면 화면 전체를 평문으로 돌린다.
 * @param html - 공지 화면 HTML
 * @returns 태그를 걷어 낸 본문
 */
export function noticeDetailText(html: string): string {
  if (!html) return "";
  const regions = [
    html.match(/id=["']atclCn["'][^>]*>([\s\S]*?)<\/div>/i)?.[1],
    html.match(/class=["'][^"']*view[-_]?cont[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1],
    html.match(/class=["'][^"']*bbs[-_]?view[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
  ];
  for (const region of regions) {
    const text = region ? htmlToText(region) : "";
    if (text.length >= 8) return text;
  }
  const markers = ["게시글내용", "공지내용", "글내용"];
  for (const mark of markers) {
    const start = html.indexOf(mark);
    if (start < 0) continue;
    const rest = html.slice(start);
    const end = rest.search(/label-title|첨부파일|file-list/i);
    const chunk = end >= 0 ? rest.slice(0, end) : rest.slice(0, 6000);
    const text = htmlToText(chunk);
    if (text) return text;
  }
  return htmlToText(html);
}
