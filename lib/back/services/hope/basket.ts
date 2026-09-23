/**
 * 희망바구니 검색·담기·취소·전공 자동담기·일정.
 *
 * sugangh SSV(로그인·쿠키·SSV POST) 는 HopeBasketClient 가 맡는다.
 * 이 계층은 화면 JSON 직렬화와 검색 구분 합치기만 한다. 본신청 등록은 부르지 않는다.
 * e-campus HTML 기능과 달리 SSV 엔진을 여기 복제하지 않는다.
 */
import type { HopeBasketClient } from "../../engine/index.js";

import { ensureHope } from "../ecampus/login.js";
import type {
  HopeBatchItem,
  HopeDepartmentRow,
  HopeMajorPreview,
  HopeMutationRow,
  HopeScheduleRow,
  HopeSubjectRow,
  HopeTarget
} from "../../types/hope.js";
import type { WebSession } from "../../types/session.js";
import { errorMessage, mapLimit } from "../../utils.js";

/** 전체 조회 시 쓰는 검색 구분. hope-basket:manager 와 같다 */
const SEARCH_DIVS = ["0", "1", "2", "3", "4", "5", "6"] as const;

/** API 과목 한 줄. 검색·바구니·전공 시간표 필드가 섞여 있다 */
interface SubjectLike {
  subjtCd?: string;
  subjtNm?: string;
  corseDvclsNo?: string;
  estblDeprtNm?: string;
  asignDeprtCd?: string;
  cmpsjCdt?: string | number;
  cmpsjDivCd?: string;
  cmpsjDivNm?: string;
  estblCrseDivNm?: string;
  cmpsjHyDivCd?: string;
  chrgInstrEmpnm?: string;
  timtbNm?: string;
  hopeAppcsCnt?: string;
  appcsLmttPcnt?: string;
  atnlcPosblPcnt?: string;
  slesLessnItem?: string;
  remrk?: string;
}

/** 담기·취소 API 결과 */
interface MutationLike {
  success?: boolean;
  message?: string;
  action?: string;
  subjtCd?: string;
  corseDvclsNo?: string;
}

/**
 * 이수학년 코드를 화면 문구로 바꾼다.
 * 0 · 00 · 99 · 빈 값은 전체학년이다.
 * @param cd - cmpsjHyDivCd
 */
function formatYearLabel(cd: string | undefined): string {
  const s = String(cd || "").trim();
  if (!s || s === "0" || s === "00" || s === "99") return "전체학년";
  const num = parseInt(s, 10);
  if (!isNaN(num) && num >= 1 && num <= 6) return `${num}학년`;
  return `${s}학년`;
}

/**
 * SSV 객체를 화면에 보낼 희망바구니 표준 구조로 바꾼다.
 * @param s - 수강/희망바구니 과목
 */
function serializeSubject(s: SubjectLike): HopeSubjectRow {
  const subjtCd = String(s.subjtCd || "").trim();
  const corseDvclsNo = String(s.corseDvclsNo || "01").trim();
  const cmpsjDivNm = String(s.cmpsjDivNm || s.estblCrseDivNm || "").trim();
  const cmpsjHyDivCd = String(s.cmpsjHyDivCd || "").trim();
  return {
    subjtCd,
    subjtNm: String(s.subjtNm || "").trim(),
    corseDvclsNo,
    estblDeprtNm: String(s.estblDeprtNm || "").trim(),
    asignDeprtCd: String(s.asignDeprtCd || "").trim(),
    cmpsjCdt: String(s.cmpsjCdt ?? ""),
    cmpsjDivCd: String(s.cmpsjDivCd || "").trim(),
    cmpsjDivNm,
    cmpsjHyDivCd,
    yearLabel: formatYearLabel(cmpsjHyDivCd),
    chrgInstrEmpnm: String(s.chrgInstrEmpnm || "").trim(),
    timtbNm: String(s.timtbNm || "").trim(),
    hopeAppcsCnt: String(s.hopeAppcsCnt ?? ""),
    appcsLmttPcnt: String(s.appcsLmttPcnt ?? s.atnlcPosblPcnt ?? ""),
    slesLessnItem: String(s.slesLessnItem || "").trim(),
    remrk: String(s.remrk || "").trim()
  };
}

/**
 * 처리 결과를 화면용 구조로 보낸다.
 * @param r - 바구니 담기/취소 결과
 * @param fallback - 실패 시 대상 정보
 */
function serializeMutation(r: MutationLike, fallback: HopeTarget): HopeMutationRow {
  return {
    success: Boolean(r.success),
    message: String(r.message || (r.success ? "완료" : "실패")),
    action: String(r.action || ""),
    subjtCd: String(r.subjtCd || fallback.subjtCd),
    corseDvclsNo: String(r.corseDvclsNo || fallback.corseDvclsNo)
  };
}

/**
 * 요청 본문에서 과목코드-분반 목록을 걷어 낸다.
 * @param raw - 배열 후보
 */
export function hopeTargetsOf(raw: unknown): HopeTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: HopeTarget[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const subjtCd = String(rec.subjtCd || "").trim();
    const corseDvclsNo = String(rec.corseDvclsNo || "").trim();
    if (!subjtCd || !corseDvclsNo) continue;
    const key = `${subjtCd}-${corseDvclsNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ subjtCd, corseDvclsNo });
  }
  return out;
}

/**
 * 전공·교양 등 조회 구분을 모아 검색한다. 학과가 있으면 한 번만 조회한다.
 * 동시 POST 가 빈 응답을 내는 경우가 있어 병렬도는 2 로 제한한다.
 * @param hope - 희망바구니 클라이언트
 * @param keyword - 과목명/코드
 * @param asignDeprtCd - 개설 학과. 없으면 전체
 */
async function searchAllSubjects(
  hope: HopeBasketClient,
  keyword: string,
  asignDeprtCd: string | undefined
): Promise<SubjectLike[]> {
  if (asignDeprtCd) {
    return (await hope.searchSubjects({ keyword, asignDeprtCd })) as SubjectLike[];
  }
  const lists = await mapLimit([...SEARCH_DIVS], 2, async (div) => {
    try {
      return (await hope.searchSubjects({ keyword, serchDiv: div })) as SubjectLike[];
    } catch {
      return [] as SubjectLike[];
    }
  });
  const map = new Map<string, SubjectLike>();
  for (const list of lists) {
    for (const s of list) {
      const key = `${s.subjtCd || ""}-${s.corseDvclsNo || ""}`;
      if (key === "-") continue;
      if (!map.has(key)) map.set(key, s);
    }
  }
  return [...map.values()];
}

/**
 * 개설 강의를 검색한다.
 * @param sess - 웹 세션
 * @param keyword - 과목명/코드
 * @param dept - mine | all | 학과 코드
 */
export async function searchHopeSubjects(
  sess: WebSession,
  keyword: string,
  dept: string
): Promise<{ rows: HopeSubjectRow[]; deptCd: string }> {
  const hope = await ensureHope(sess);
  const mine = hope.getStudentInfo()?.deptCd || sess.student.deptCd || "";
  let asignDeprtCd: string | undefined;
  if (dept === "all" || dept === "") asignDeprtCd = undefined;
  else if (dept === "mine") asignDeprtCd = mine || undefined;
  else asignDeprtCd = dept;
  const rows = await searchAllSubjects(hope, keyword, asignDeprtCd);
  return { rows: rows.map(serializeSubject), deptCd: asignDeprtCd || "" };
}

/**
 * 내가 담은 희망바구니 목록을 조회한다.
 * @param sess - 웹 세션
 */
export async function listMyHopeBasket(sess: WebSession): Promise<{
  rows: HopeSubjectRow[];
  totalCredits: number;
}> {
  const hope = await ensureHope(sess);
  const subjects = (await hope.getMyHopeBasketList()) as SubjectLike[];
  const rows = subjects.map(serializeSubject);
  const totalCredits = rows.reduce((sum, r) => sum + (Number(r.cmpsjCdt) || 0), 0);
  return { rows, totalCredits };
}
