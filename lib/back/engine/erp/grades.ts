/**
 * ERP 전체학기성적조회 요청 생성/응답 파싱.
 *
 * e-campus `/crs/scoreLect/*` (교과 성적 공개) 가 아니다.
 * 통합정보시스템 `/sch/sgra/SgradcCtr/*` JSON API 다.
 */

import { absoluteUrl } from "../ecampus/utils.js";
import {
  ERP_BASE_URL,
  ERP_GRADE_OVERALL_PORTAL_MENU_ID,
  ERP_GRADE_OVERALL_PORTAL_PGM_ID,
  ERP_GRADE_OVERALL_VUE_MENU_ID,
  ERP_GRADE_OVERALL_VUE_PGM_ID,
  ERP_GRADE_UNDERGRAD_PORTAL_MENU_ID,
  ERP_GRADE_UNDERGRAD_PORTAL_PGM_ID,
  ERP_GRADE_UNDERGRAD_VUE_MENU_ID,
  ERP_GRADE_UNDERGRAD_VUE_PGM_ID,
  ERP_PATHS
} from "./constants.js";
import { cellNumber, cellString, createErpJsonPost, readJsonDataset } from "./json.js";
import type { ErpFormPostRequest, ErpJsonPostRequest } from "./types/portal.js";
import type {
  ErpGradeMenuContext,
  ErpGradeMenuKind,
  ErpGradeQueryOptions,
  ErpGradeReportOptions,
  ErpGradeSubject,
  ErpGradeTermBundle,
  ErpGradeTermTotal,
  ErpGradeYear,
  ErpOverallGrades
} from "./types/grades.js";

export type {
  ErpGradeMenuContext,
  ErpGradeMenuKind,
  ErpGradeQueryOptions,
  ErpGradeReportOptions,
  ErpGradeSubject,
  ErpGradeTermBundle,
  ErpGradeTermTotal,
  ErpGradeYear,
  ErpOverallGrades
} from "./types/grades.js";

/**
 * 성적 메뉴 종류에 해당하는 Vue/포털 ID 를 반환한다
 * @param {ErpGradeMenuKind} [kind="overall"] - overall | undergrad
 * @returns {ErpGradeMenuContext} 메뉴 문맥
 */
export function resolveErpGradeMenu(kind: ErpGradeMenuKind = "overall"): ErpGradeMenuContext {
  if (kind === "undergrad") {
    return {
      kind,
      portalMenuId: ERP_GRADE_UNDERGRAD_PORTAL_MENU_ID,
      vueMenuId: ERP_GRADE_UNDERGRAD_VUE_MENU_ID,
      portalPgmId: ERP_GRADE_UNDERGRAD_PORTAL_PGM_ID,
      vuePgmId: ERP_GRADE_UNDERGRAD_VUE_PGM_ID
    };
  }
  return {
    kind: "overall",
    portalMenuId: ERP_GRADE_OVERALL_PORTAL_MENU_ID,
    vueMenuId: ERP_GRADE_OVERALL_VUE_MENU_ID,
    portalPgmId: ERP_GRADE_OVERALL_PORTAL_PGM_ID,
    vuePgmId: ERP_GRADE_OVERALL_VUE_PGM_ID
  };
}

/**
 * 성적 API 쿼리(menuId/pgmId)를 채운다
 * @param {ErpGradeQueryOptions} [options={}] - 부분 옵션
 * @param {ErpGradeMenuKind} [kind="overall"] - 기본 메뉴
 * @returns {{ menuId: string; pgmId: string }} 쿼리
 */
export function erpGradeQuery(
  options: ErpGradeQueryOptions = {},
  kind: ErpGradeMenuKind = "overall"
): { menuId: string; pgmId: string } {
  const menu = resolveErpGradeMenu(kind);
  return {
    menuId: options.menuId ?? menu.vueMenuId,
    pgmId: options.pgmId ?? menu.vuePgmId
  };
}

/**
 * 이수학기 목록 조회 요청을 만든다
 * @param {ErpGradeQueryOptions} [options={}] - 학번/메뉴
 * @returns {ErpJsonPostRequest} findStdntGradeSyyList 요청
 */
export function createErpGradeYearListRequest(
  options: ErpGradeQueryOptions = {}
): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.findStdntGradeSyyList,
    { dsParam: { stuno: options.stuno ?? "" } },
    erpGradeQuery(options),
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * 학기별 평점 합계 조회 요청을 만든다
 * @param {ErpGradeQueryOptions} [options={}] - syy/smtCd 비우면 전체 학기
 * @returns {ErpJsonPostRequest} findGradeTotalDtlsStuList 요청
 */
export function createErpGradeTotalListRequest(
  options: ErpGradeQueryOptions = {}
): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.findGradeTotalDtlsStuList,
    { dsParam: { syy: options.syy ?? "", smtCd: options.smtCd ?? "" } },
    erpGradeQuery(options),
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * 학기 과목 성적 상세 조회 요청을 만든다
 * @param {ErpGradeQueryOptions & { syy: string; smtCd: string }} options - 학년도/학기 필수
 * @returns {ErpJsonPostRequest} findGradeMastrDtlsStuList 요청
 */
export function createErpGradeDetailListRequest(
  options: ErpGradeQueryOptions & { syy: string; smtCd: string }
): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.findGradeMastrDtlsStuList,
    { dsParam: { syy: options.syy, smtCd: options.smtCd } },
    erpGradeQuery(options),
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * ClipReport 성적표 인쇄 폼 요청을 만든다 (HTML 뷰어, JSON 데이터 아님)
 * @param {ErpGradeReportOptions} options - 과목/학기
 * @returns {ErpFormPostRequest} callReport.jsp 요청
 */
export function createErpGradeReportRequest(options: ErpGradeReportOptions): ErpFormPostRequest {
  const params = new URLSearchParams();
  params.set("filePath", options.filePath ?? "sch/sgra/sgradc/sgradc0150_prn02");
  const reportParams = {
    syy: options.syy,
    smtCd: options.smtCd,
    subjtCd: options.subjtCd,
    corseDvclsNo: options.corseDvclsNo,
    ...(options.reportParams ?? {})
  };
  params.set("reportParams", Buffer.from(JSON.stringify(reportParams), "utf8").toString("base64"));
  params.set("paramType", "query");
  params.set("reportBtn", "PX");
  params.set("scrollView", "false");
  params.set("persInfo", "0");
  params.set("toolbar", "false");
  params.set("useGlio", "true");

  return {
    method: "POST",
    url: absoluteUrl(ERP_PATHS.callReportJsp, options.baseUrl ?? ERP_BASE_URL),
    body: params.toString(),
    contentType: "application/x-www-form-urlencoded",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  };
}

/**
 * 이수학기 목록을 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpGradeYear[]} 이수학기 목록
 */
export function parseErpGradeYearListResponse(body: string): ErpGradeYear[] {
  return readJsonDataset(body, "dsSgra251").map((row) => ({
    syy: cellString(row, "syy"),
    smtCd: cellString(row, "smtCd"),
    smtNm: cellString(row, "smtNm"),
    raw: row
  }));
}

/**
 * 학기별 평점 합계를 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpGradeTermTotal[]} 학기 합계 목록
 */
export function parseErpGradeTotalListResponse(body: string): ErpGradeTermTotal[] {
  return readJsonDataset(body, "dsSgra251").map((row) => ({
    stuno: cellString(row, "stuno"),
    syy: cellString(row, "syy"),
    smtCd: cellString(row, "smtCd"),
    smtNm: cellString(row, "smtNm"),
    cmpsjHy: cellString(row, "cmpsjHy"),
    aplyCdt: cellNumber(row, "aplyCdt"),
    acqsCdt: cellNumber(row, "acqsCdt"),
    gpa: cellNumber(row, "gpa"),
    tgp: cellNumber(row, "tgp"),
    percnSco: cellNumber(row, "percnSco"),
    fcdtExclsTgp: cellNumber(row, "fcdtExclsTgp"),
    smtStnd: cellString(row, "smtStnd"),
    aplyCdtTtl: cellNumber(row, "aplyCdtTtl"),
    acqsCdtTtl: cellNumber(row, "acqsCdtTtl"),
    gpaTtl: cellNumber(row, "gpaTtl"),
    tgpTtl: cellNumber(row, "tgpTtl"),
    percnScoTtl: cellNumber(row, "percnScoTtl"),
    fcdtExclsTgpTtl: cellNumber(row, "fcdtExclsTgpTtl"),
    fcdtInclsTgpTtl: cellNumber(row, "fcdtInclsTgpTtl"),
    fnpGpa: cellNumber(row, "fnpGpa"),
    fnpAplyCdt: cellNumber(row, "fnpAplyCdt"),
    fnpMjPercnSco: cellString(row, "fnpMjPercnSco"),
    ratlcAccmlCnt: cellNumber(row, "ratlcAccmlCnt"),
    fcdtSubjcCnt: cellNumber(row, "fcdtSubjcCnt"),
    acprbYn: cellString(row, "acprbYn"),
    raw: row
  }));
}

/**
 * 학기 과목 성적 상세를 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpGradeSubject[]} 과목 성적 목록
 */
export function parseErpGradeDetailListResponse(body: string): ErpGradeSubject[] {
  return readJsonDataset(body, "dsSgra211").map((row) => ({
    stuno: cellString(row, "stuno"),
    syy: cellString(row, "syy"),
    smtCd: cellString(row, "smtCd"),
    smtNm: cellString(row, "smtNm"),
    subjtCd: cellString(row, "subjtCd"),
    subjtNm: cellString(row, "subjtNm"),
    corseDvclsNo: cellString(row, "corseDvclsNo"),
    cmpsjDivCd: cellString(row, "cmpsjDivCd"),
    cmpsjCdt: cellNumber(row, "cmpsjCdt"),
    cmpsjGradeGrdCd: pickGradeLetter(row),
    cmpsjGp: cellNumber(row, "cmpsjGp") ?? cellNumberLoose(row, ["gp", "cmpsjGp", "gradeGp"]),
    cmpsjSco: cellNumber(row, "cmpsjSco"),
    absncHrs: cellNumber(row, "absncHrs"),
    absncGradeGrdCd: cellString(row, "absncGradeGrdCd"),
    gradeSubjtCmpsjNo: cellString(row, "gradeSubjtCmpsjNo"),
    raw: row
  }));
}

/** 등급 문자. 필드 이름 대소문자가 달라도 A+, B, P 를 찾는다. */
function pickGradeLetter(row: Record<string, unknown>): string {
  const named = pickCell(row, ["cmpsjGradeGrdCd", "cmpsjGradeGrdNm", "gradeGrdCd", "cmpsjGrdNm", "grdNm"]);
  if (named) return named;
  for (const [key, value] of Object.entries(row)) {
    if (!/grd|grade/i.test(key)) continue;
    const text = String(value ?? "").trim();
    if (/^(?:[A-D][+-]?|F|P|NP|Pass|Fail)$/i.test(text)) return text;
  }
  return "";
}

function pickCell(row: Record<string, unknown>, keys: string[]): string {
  const folded = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) folded.set(key.toLowerCase(), value);
  for (const key of keys) {
    const value = row[key] ?? folded.get(key.toLowerCase());
    if (value == null || value === "") continue;
    return String(value).trim();
  }
  return "";
}

function cellNumberLoose(row: Record<string, unknown>, keys: string[]): number | null {
  const text = pickCell(row, keys);
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * 이수학기·합계·상세를 학기 단위로 묶는다
 * @param {ErpGradeYear[]} years - 이수학기
 * @param {ErpGradeTermTotal[]} totals - 합계
 * @param {ErpGradeSubject[]} subjects - 과목 상세
 * @returns {ErpOverallGrades} 전체 성적
 */
export function composeErpOverallGrades(
  years: ErpGradeYear[],
  totals: ErpGradeTermTotal[],
  subjects: ErpGradeSubject[]
): ErpOverallGrades {
  const totalsByTerm = new Map(totals.map((item) => [`${item.syy}:${item.smtCd}`, item]));
  const subjectsByTerm = new Map<string, ErpGradeSubject[]>();
  for (const subject of subjects) {
    const key = `${subject.syy}:${subject.smtCd}`;
    const list = subjectsByTerm.get(key) ?? [];
    list.push(subject);
    subjectsByTerm.set(key, list);
  }

  const sourceYears =
    years.length > 0
      ? years
      : totals.map((item) => ({
          syy: item.syy,
          smtCd: item.smtCd,
          smtNm: item.smtNm,
          raw: item.raw
        }));

  const terms: ErpGradeTermBundle[] = sourceYears.map((year) => {
    const key = `${year.syy}:${year.smtCd}`;
    return {
      year,
      total: totalsByTerm.get(key),
      subjects: subjectsByTerm.get(key) ?? []
    };
  });

  return { years: sourceYears, totals, terms, subjects };
}

/**
 * 과목 성적 목록을 한 줄 요약 문자열로 만든다
 * @param {ErpGradeSubject[]} subjects - 과목 목록
 * @returns {string} 표시용 문자열
 */
export function stringifyErpGradeSubjects(subjects: ErpGradeSubject[]): string {
  return subjects
    .map(
      (item) =>
        `${item.syy}-${item.smtNm} ${item.subjtCd} ${item.subjtNm} ${item.cmpsjCdt ?? "-"}학점 ${item.cmpsjGradeGrdCd}`
    )
    .join("\n");
}

/**
 * 학기 합계 목록을 한 줄 요약 문자열로 만든다
 * @param {ErpGradeTermTotal[]} totals - 합계 목록
 * @returns {string} 표시용 문자열
 */
export function stringifyErpGradeTotals(totals: ErpGradeTermTotal[]): string {
  return totals
    .map(
      (item) =>
        `${item.syy}-${item.smtNm} 신청 ${item.aplyCdt ?? "-"} / 취득 ${item.acqsCdt ?? "-"} GPA ${item.gpa ?? "-"} 누계GPA ${item.gpaTtl ?? "-"}`
    )
    .join("\n");
}
