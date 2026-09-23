/**
 * ERP 지난(전체학기) 성적 조회.
 *
 * e-campus 교과 성적(`/crs/scoreLect/*`)과 다른 호스트·API다.
 * 학기 목록·합계를 먼저 읽고, 과목 상세는 선택한 학기만 조회한다.
 */
import type { ErpClient } from "../../engine/index.js";
import type { ErpGradeSubject, ErpGradeTermTotal, ErpGradeYear } from "../../engine/erp/types/grades.js";
import type {
  WebErpGradeSubject,
  WebErpGradeTerm,
  WebErpGradeTotal,
  WebErpOverallGrades
} from "../../types/grades.js";
import { errorMessage } from "../../utils.js";

/** 학기 코드 → 화면 라벨 */
const SMT_NAME: Record<string, string> = {
  "10": "1학기",
  "20": "2학기",
  "11": "여름계절학기",
  "21": "겨울계절학기"
};

/** 이수구분 코드 폴백 이름 */
const DIV_FALLBACK: Record<string, string> = {
  "01": "전공필수",
  "02": "전공선택",
  "03": "교양필수",
  "04": "교양선택",
  "05": "교직",
  "06": "일반선택"
};

/**
 * 학년도·학기 코드를 화면 라벨로 만든다.
 * @param syy - 학년도
 * @param smtCd - 학기 코드
 * @param smtNm - 학기명
 * @returns 화면 라벨
 */
export function formatErpTermLabel(syy: string, smtCd: string, smtNm = ""): string {
  const name = smtNm || SMT_NAME[smtCd] || smtCd;
  return syy ? `${syy}학년도 ${name}`.trim() : name;
}

/**
 * 이수학기 목록과 학기별 평점 합계만 가져온다. 과목 상세는 비워 둔다.
 * @param client - ERP 클라이언트
 * @returns 학기 목록·누계 요약
 */
export async function fetchGradeOverview(client: ErpClient): Promise<WebErpOverallGrades> {
  let years: ErpGradeYear[] = [];
  let totals: ErpGradeTermTotal[] = [];
  let yearError: unknown;
  let totalError: unknown;

  try {
    years = await client.getGradeYears();
  } catch (err) {
    yearError = err;
  }
  try {
    totals = await client.getGradeTotals();
  } catch (err) {
    totalError = err;
  }
  if (!years.length && !totals.length && yearError && totalError) {
    throw new Error(errorMessage(totalError || yearError) || "지난 성적을 불러오지 못했습니다.");
  }

  const divisions = await loadDivMap(client);
  const sourceYears =
    years.length > 0
      ? years
      : totals.map((item) => ({
          syy: item.syy,
          smtCd: item.smtCd,
          smtNm: item.smtNm,
          raw: item.raw
        }));
  const totalsByTerm = new Map(totals.map((item) => [`${item.syy}:${item.smtCd}`, item]));
  const terms: WebErpGradeTerm[] = sourceYears.map((year) => {
    const total = totalsByTerm.get(`${year.syy}:${year.smtCd}`);
    return {
      syy: year.syy,
      smtCd: year.smtCd,
      smtNm: year.smtNm,
      label: formatErpTermLabel(year.syy, year.smtCd, year.smtNm),
      total: total ? toTotal(total) : null,
      subjects: [],
      subjectsLoaded: false
    };
  });
  const latest = pickLatestTotal(totals);

  return {
    summary: {
      gpa: latest?.gpaTtl ?? latest?.fnpGpa ?? null,
      fnpGpa: latest?.fnpGpa ?? latest?.gpaTtl ?? null,
      aplyCdt: latest?.aplyCdtTtl ?? null,
      acqsCdt: latest?.acqsCdtTtl ?? null,
      percnSco: latest?.percnScoTtl ?? null,
      termCount: terms.length,
      subjectCount: 0
    },
    terms,
    subjects: [],
    divisions
  };
}

/**
 * 선택한 학기의 과목 성적 상세를 가져와 기존 결과에 붙인다.
 * @param client - ERP 클라이언트
 * @param term - 학년도/학기
 * @param existing - 이미 받은 학기 목록
 * @returns 선택한 학기 과목이 채워진 성적
 */
export async function fetchGradeTermDetails(
  client: ErpClient,
  term: { syy: string; smtCd: string },
  existing: WebErpOverallGrades
): Promise<WebErpOverallGrades> {
  const rawSubjects = await client.getGradeDetails({ syy: term.syy, smtCd: term.smtCd });
  const divisions = existing.divisions && Object.keys(existing.divisions).length ? existing.divisions : DIV_FALLBACK;
  const mapped = rawSubjects.map((item) => toSubject(item, divisions));
  let found = false;
  const terms: WebErpGradeTerm[] = existing.terms.map((item) => {
    if (item.syy !== term.syy || item.smtCd !== term.smtCd) return item;
    found = true;
    return { ...item, subjects: mapped, subjectsLoaded: true };
  });
  if (!found) {
    terms.push({
      syy: term.syy,
      smtCd: term.smtCd,
      smtNm: mapped[0]?.smtNm || "",
      label: formatErpTermLabel(term.syy, term.smtCd, mapped[0]?.smtNm || ""),
      total: null,
      subjects: mapped,
      subjectsLoaded: true
    });
  }
  const subjects = terms.flatMap((item) => item.subjects);
  return {
    ...existing,
    divisions,
    terms,
    subjects,
    summary: {
      ...existing.summary,
      termCount: terms.length,
      subjectCount: subjects.length
    }
  };
}

/**
 * ERP 전체학기 성적을 가져와 화면용으로 정규화한다.
 * 학기 상세 실패는 건너뛴다.
 * @param client - ERP 클라이언트
 * @returns 전 학기 과목까지 채운 성적
 */
export async function fetchOverallGrades(client: ErpClient): Promise<WebErpOverallGrades> {
  let overview = await fetchGradeOverview(client);
  for (const term of overview.terms) {
    if (!term.syy || !term.smtCd) continue;
    try {
      overview = await fetchGradeTermDetails(client, { syy: term.syy, smtCd: term.smtCd }, overview);
    } catch {
      // 한 학기 실패해도 나머지 학기는 유지
    }
  }
  return overview;
}

/**
 * ERP 과목 행을 화면용으로 얇게 만든다.
 * @param item - ERP 과목 성적
 * @param divMap - 이수구분 코드 → 이름
 */
function toSubject(item: ErpGradeSubject, divMap: Record<string, string>): WebErpGradeSubject {
  return {
    syy: item.syy,
    smtCd: item.smtCd,
    smtNm: item.smtNm,
    termLabel: formatErpTermLabel(item.syy, item.smtCd, item.smtNm),
    subjtCd: item.subjtCd,
    subjtNm: item.subjtNm,
    corseDvclsNo: item.corseDvclsNo,
    cmpsjDivCd: item.cmpsjDivCd,
    cmpsjDivNm: divMap[item.cmpsjDivCd] || item.cmpsjDivCd || "",
    cmpsjCdt: item.cmpsjCdt,
    cmpsjGradeGrdCd: item.cmpsjGradeGrdCd,
    cmpsjGp: item.cmpsjGp,
    absncHrs: item.absncHrs
  };
}

/**
 * ERP 학기 합계를 화면용으로 얇게 만든다.
 * @param item - ERP 학기 합계
 */
function toTotal(item: ErpGradeTermTotal): WebErpGradeTotal {
  return {
    syy: item.syy,
    smtCd: item.smtCd,
    smtNm: item.smtNm,
    cmpsjHy: item.cmpsjHy,
    aplyCdt: item.aplyCdt,
    acqsCdt: item.acqsCdt,
    gpa: item.gpa,
    tgp: item.tgp,
    percnSco: item.percnSco,
    smtStnd: item.smtStnd,
    aplyCdtTtl: item.aplyCdtTtl,
    acqsCdtTtl: item.acqsCdtTtl,
    gpaTtl: item.gpaTtl,
    percnScoTtl: item.percnScoTtl,
    fnpGpa: item.fnpGpa,
    acprbYn: item.acprbYn
  };
}

/**
 * 이수구분 코드표를 가져온다. 실패하면 폴백만 쓴다.
 * @param client - ERP 클라이언트
 */
async function loadDivMap(client: ErpClient): Promise<Record<string, string>> {
  const divMap: Record<string, string> = { ...DIV_FALLBACK };
  try {
    const combos = await client.getGradeCodeCombos();
    for (const item of combos.courseDivisions) {
      const name = item.fullNm || item.abnm;
      if (item.code && name) divMap[item.code] = name;
    }
  } catch {
    // 이수구분 이름은 없어도 성적 조회는 유지
  }
  return divMap;
}

/**
 * 가장 최근 학기 합계를 고른다 (누계 필드가 여기 있다).
 * @param totals - 학기 합계 목록
 */
function pickLatestTotal(totals: ErpGradeTermTotal[]): ErpGradeTermTotal | undefined {
  if (!totals.length) return undefined;
  return [...totals].sort((a, b) => {
    const byYear = String(b.syy).localeCompare(String(a.syy));
    if (byYear) return byYear;
    return String(b.smtCd).localeCompare(String(a.smtCd));
  })[0];
}
