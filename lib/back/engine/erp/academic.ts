/**
 * ERP 학적·코드·학사일정·강의평가·투표 요청 생성/응답 파싱.
 *
 * 성적 상세는 grades.ts, 포털 로그인은 portal.ts.
 */

import {
  ERP_BASE_URL,
  ERP_DEFAULT_DEPT_CD,
  ERP_GRADE_CODE_REQUEST,
  ERP_GRADE_SCHEDULE_CD,
  ERP_LECTURE_EVAL_MENU_ID,
  ERP_LECTURE_EVAL_PGM_ID,
  ERP_PATHS,
  ERP_VOTE_PGM_ID,
  ERP_VOTE_VUE_MENU_ID
} from "./constants.js";
import {
  createSsvRequestTimeStr,
  encodeSsvRequest,
  parseSsv,
  readSsvErrorCode
} from "../hope-basket/ssv.js";
import { absoluteUrl } from "../ecampus/utils.js";
import { cellNumber, cellString, createErpJsonPost, parseJsonBody, readJsonDataset } from "./json.js";
import { erpGradeQuery } from "./grades.js";
import type { ErpJsonPostRequest } from "./types/portal.js";
import type { ErpGradeQueryOptions } from "./types/grades.js";
import type { SugangSsvPostRequest } from "../hope-basket/types/basket.js";
import type {
  ErpAcademicProfile,
  ErpCodeComboSet,
  ErpCodeItem,
  ErpLectureEvalCheck,
  ErpLectureEvalCheckOptions,
  ErpScheduleWindow,
  ErpVoteInfo
} from "./types/academic.js";

export type {
  ErpAcademicProfile,
  ErpCodeComboSet,
  ErpCodeItem,
  ErpLectureEvalCheck,
  ErpLectureEvalCheckOptions,
  ErpScheduleWindow,
  ErpVoteInfo
} from "./types/academic.js";

/**
 * 학생 학적 기본정보 조회 요청을 만든다
 * @param {ErpGradeQueryOptions} [options={}] - 메뉴 문맥. 본문은 패킷대로 빈 값
 * @returns {ErpJsonPostRequest} findSchrgBassInfoStud 요청
 */
export function createErpAcademicProfileRequest(
  options: ErpGradeQueryOptions = {}
): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.findSchrgBassInfoStud,
    { stuno: options.stuno ?? "", univCd: "", syy: "", smtCd: "", flag: "" },
    erpGradeQuery(options),
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * 성적 화면 코드콤보(학기/이수구분/등급) 조회 요청을 만든다
 * @param {ErpGradeQueryOptions} [options={}] - 메뉴 문맥
 * @returns {ErpJsonPostRequest} findCodeComboList 요청
 */
export function createErpGradeCodeComboRequest(
  options: ErpGradeQueryOptions = {}
): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.findCodeComboList,
    { ...ERP_GRADE_CODE_REQUEST },
    erpGradeQuery(options),
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * 성적 공개 학사일정 조회 요청을 만든다
 * @param {{ regDeptCd?: string; scheduleCd?: string } & ErpGradeQueryOptions} [options] - 일정 코드
 * @returns {ErpJsonPostRequest} findScomUnvfrSchdlInfo 요청
 */
export function createErpGradeScheduleRequest(
  options: ErpGradeQueryOptions & { regDeptCd?: string; scheduleCd?: string } = {}
): ErpJsonPostRequest {
  const dept = options.regDeptCd ?? ERP_DEFAULT_DEPT_CD;
  return createErpJsonPost(
    ERP_PATHS.findScomUnvfrSchdlInfo,
    {
      flag: "2",
      univunvfrSchdlCd: options.scheduleCd ?? ERP_GRADE_SCHEDULE_CD,
      regDeptCd: dept,
      applcDeptCd: dept,
      applyCrseCd: "",
      dgriCrseCd: "",
      hy: "",
      syy: "",
      smtCd: ""
    },
    erpGradeQuery(options),
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * 온라인투표 목록 조회 요청을 만든다
 * @param {{ syy: string; smtCd: string; menuId?: string; pgmId?: string; baseUrl?: string }} options - 학년도/학기
 * @returns {ErpJsonPostRequest} findVoteYyElecInfoRegList 요청
 */
export function createErpVoteListRequest(options: {
  syy: string;
  smtCd: string;
  menuId?: string;
  pgmId?: string;
  baseUrl?: string;
}): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.findVoteYyElecInfoRegList,
    { dsParam: { syy: options.syy, smtCd: options.smtCd } },
    {
      menuId: options.menuId ?? ERP_VOTE_VUE_MENU_ID,
      pgmId: options.pgmId ?? ERP_VOTE_PGM_ID
    },
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * 강의평가 기간 체크 SSV 요청을 만든다 (Nexacro 화면 패킷)
 * @param {ErpLectureEvalCheckOptions} [options={}] - 학년도/학기/학번
 * @returns {SugangSsvPostRequest} executeUnvfcCheck 요청
 */
export function createErpLectureEvalCheckRequest(
  options: ErpLectureEvalCheckOptions = {}
): SugangSsvPostRequest {
  const baseUrl = options.baseUrl ?? ERP_BASE_URL;
  const menuId = options.menuId ?? ERP_LECTURE_EVAL_MENU_ID;
  const pgmId = options.pgmId ?? ERP_LECTURE_EVAL_PGM_ID;
  const body = encodeSsvRequest({ requestTimeStr: createSsvRequestTimeStr() }, [
    {
      id: "dsParam",
      columns: ["syy", "smtCd", "lessnEvlEraDivCd", "stuno", "menuId"],
      rows: [
        {
          _rowType: "U",
          syy: options.syy ?? "",
          smtCd: options.smtCd ?? "",
          lessnEvlEraDivCd: options.lessnEvlEraDivCd ?? "",
          stuno: options.stuno ?? "",
          menuId
        },
        {
          _rowType: "O",
          syy: "",
          smtCd: "",
          lessnEvlEraDivCd: "",
          stuno: "",
          menuId: ""
        }
      ]
    }
  ]);

  const url = new URL(absoluteUrl(ERP_PATHS.executeUnvfcCheck, baseUrl));
  url.searchParams.set("menuId", menuId);
  url.searchParams.set("pgmId", pgmId);

  return {
    method: "POST",
    url: url.toString(),
    query: { menuId, pgmId },
    body,
    contentType: "text/xml",
    accept: "application/xml, text/xml, */*"
  };
}

/**
 * 학적 기본정보를 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpAcademicProfile | undefined} 학적. 없으면 undefined
 */
export function parseErpAcademicProfileResponse(body: string): ErpAcademicProfile | undefined {
  const row = readJsonDataset(body, "dsResult")[0];
  if (!row) return undefined;
  return {
    stuno: cellString(row, "stuno"),
    stdntNm: cellString(row, "stdntNm"),
    stdntPerslNo: cellString(row, "stdntPerslNo"),
    hy: cellString(row, "hy"),
    hy2: cellString(row, "hy2"),
    deptCd: cellString(row, "deptCd"),
    deptNm: cellString(row, "deptNm"),
    deprtCd: cellString(row, "deprtCd"),
    deprtNm: cellString(row, "deprtNm"),
    univCd: cellString(row, "univCd"),
    univNm: cellString(row, "univNm"),
    deptFullNm: cellString(row, "deptFullNm"),
    schrgSttusCd: cellString(row, "schrgSttusCd"),
    schrgSttusNm: cellString(row, "schrgSttusNm"),
    dghtDivCd: cellString(row, "dghtDivCd"),
    dghtDivNm: cellString(row, "dghtDivNm"),
    dgriCrseCd: cellString(row, "dgriCrseCd"),
    dgriCrseNm: cellString(row, "dgriCrseNm"),
    applyCrseCd: cellString(row, "applyCrseCd"),
    applyCrseNm: cellString(row, "applyCrseNm"),
    entnsDt: cellString(row, "entnsDt"),
    entnsDtF: cellString(row, "entnsDtF"),
    entnsDivCd: cellString(row, "entnsDivCd"),
    entnsDivNm: cellString(row, "entnsDivNm"),
    entnsTypeCd: cellString(row, "entnsTypeCd"),
    entnsTypeNm: cellString(row, "entnsTypeNm"),
    crclmApplcYy: cellString(row, "crclmApplcYy"),
    cmpsjSecnt: cellNumber(row, "cmpsjSecnt"),
    acqsCdt: cellNumber(row, "acqsCdt"),
    acdadNm: cellString(row, "acdadNm"),
    majorNmMain: cellString(row, "majorNmMain"),
    majorCdMain: cellString(row, "majorCdMain"),
    photoAttflUuid: cellString(row, "photoAttflUuid"),
    raw: row
  };
}

/**
 * 코드콤보 묶음을 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpCodeComboSet} 학기/이수구분/등급
 */
export function parseErpGradeCodeComboResponse(body: string): ErpCodeComboSet {
  const parsed = parseJsonBody(body);
  const raw =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return {
    semesters: readJsonDataset(body, "dsSmtCd").map(mapCodeItem),
    courseDivisions: readJsonDataset(body, "dsCmpsjDivCd").map(mapCodeItem),
    gradeLetters: readJsonDataset(body, "dsCmpsjGradeGrdCd").map(mapCodeItem),
    raw
  };
}

/**
 * 학사일정 창을 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpScheduleWindow | undefined} 일정. 없으면 undefined
 */
export function parseErpGradeScheduleResponse(body: string): ErpScheduleWindow | undefined {
  const row = readJsonDataset(body, "dsUnvfc")[0];
  if (!row) return undefined;
  const reslt = cellString(row, "reslt");
  return {
    reslt,
    beginDt: reslt.slice(0, 14),
    endDt: reslt.slice(14, 28),
    raw: row
  };
}

/**
 * 온라인투표 목록을 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpVoteInfo[]} 투표 목록
 */
export function parseErpVoteListResponse(body: string): ErpVoteInfo[] {
  return readJsonDataset(body, "dsSstd300").map((row) => ({ raw: row }));
}

/**
 * 강의평가 기간 체크 SSV 응답을 파싱한다
 * @param {string} body - SSV 본문
 * @returns {ErpLectureEvalCheck} 기간 여부
 */
export function parseErpLectureEvalCheckResponse(body: string): ErpLectureEvalCheck {
  const raw = parseSsv(body);
  const errorCode = readSsvErrorCode(raw) ?? null;
  const errorMsg = raw.params.ErrorMsg ?? raw.params.errorMsg ?? "";
  return {
    allowed: errorCode === 0,
    errorCode,
    errorMsg: String(errorMsg),
    raw: body
  };
}

/**
 * 학적 요약을 한 줄로 만든다 (생년월일 등 민감 필드는 제외)
 * @param {ErpAcademicProfile} profile - 학적
 * @returns {string} 표시용 문자열
 */
export function stringifyErpAcademicProfile(profile: ErpAcademicProfile): string {
  return [
    profile.stuno,
    profile.stdntNm,
    profile.univNm,
    profile.deptNm,
    `${profile.hy}학년`,
    profile.schrgSttusNm,
    `취득 ${profile.acqsCdt ?? "-"}학점`
  ]
    .filter(Boolean)
    .join(" / ");
}

/**
 * 코드 행을 정규화한다
 * @param {Record<string, unknown>} row - JSON 행
 * @returns {ErpCodeItem} 코드 항목
 */
function mapCodeItem(row: Record<string, unknown>): ErpCodeItem {
  return {
    code: cellString(row, "code"),
    abnm: cellString(row, "abnm"),
    fullNm: cellString(row, "fullNm"),
    useYn: cellString(row, "useYn"),
    groupId: cellString(row, "groupId"),
    raw: row
  };
}
