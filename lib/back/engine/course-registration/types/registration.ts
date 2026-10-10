import type { AxiosInstance } from "axios";
import type { SsvDocument, SsvParams, SsvRow } from "../../hope-basket/ssv.js";
import type {
  SugangHopeBasketTimetable,
  SugangStudentInfo,
  SugangSubject
} from "../../hope-basket/types/basket.js";
import type { CourseRegErrorType } from "../errors.js";

/**
 * 수강신청 본신청 전용 타입 정의.
 * 본신청 전용 — 수강희망바구니(Sugang* 접두어)와 혼용하지 않는다.
 *
 * 공유 재사용 타입 (희망바구니 모듈에서 import):
 *  - SugangStudentInfo, SugangSubject (검색 결과), SsvDocument, SsvRow
 */

/** 수강신청 본신청 클라이언트 생성 옵션 */
export interface CourseRegistrationClientOptions {
  baseUrl?: string; // 기본 URL (기본: https://sugangh.seowon.ac.kr)
  axios?: AxiosInstance; // 커스텀 Axios 인스턴스
  credentials?: CourseRegLoginCredentials; // 자동 재로그인 계정 정보
  defaultSyy?: string; // 기본 학년도
  defaultSmtCd?: string; // 기본 학기 코드
  unvfrStdrDeptCd?: string; // 대학 기준 부서 코드 (기본: 20000)
  requestTimeoutMs?: number; // 요청 타임아웃(ms) (기본: 30000)
  maxRetries?: number; // 네트워크 오류 재시도 횟수 (기본: 3)
  /** 로그인 flag=0(허위 실패 가능) 시 재시도 횟수 (기본: 5) */
  loginMaxRetries?: number;
  onProgress?: (message: string) => void; // 진행 메시지 콜백
}

/**
 * 수강신청 본신청 로그인 계정 정보.
 * appcsKindCd 없음 — 본신청 로그인은 appcsKindCd 파라미터를 전송하지 않는다.
 */
export interface CourseRegLoginCredentials {
  stuno: string; // 학번 (SSV 파라미터: stuno)
  password: string; // 비밀번호 (SSV 파라미터: password)
  notcClCd?: string; // 로그인 공지 구분 (기본 L)
}

/**
 * 로그인 동작 옵션 (예약/매크로용 간소화 지원).
 *
 * - `full`(기본): 브라우저와 유사 — 학생정보 + 일정체크 + 메뉴 진입
 * - `fast`: 신청에 필요한 최소 단계만
 *   세션 → 학년도/학기 → findAppcsLogin → findStunoInfo(신청 SSV 문맥)
 *   생략: findAppcsLoginChk(일정 확인), findMenu(메뉴 진입)
 */
export interface CourseRegLoginOptions {
  mode?: "full" | "fast";
}

/** 수강신청 로그인 결과 */
export interface CourseRegLoginResult {
  success: boolean; // 로그인 성공 여부 (dsFlag.flag=1이면 true)
  flag: string; // 서버 dsFlag.flag 원본값 (1=성공, 0=실패)
  message: string; // 사용자 표시 메시지
  /**
   * 서버 과부하로 인한 허위 로그인 실패 가능성 플래그.
   * flag=0이어도 올바른 자격증명인 경우 재시도하면 성공할 수 있다.
   * 패킷 분석에서 실제 확인된 현상이다.
   */
  mayBeFalseError: boolean;
  session?: CourseRegSessionInfo; // 로그인 성공 시 세션 정보
  student?: SugangStudentInfo; // 학생 정보 (findStunoInfo, 구조 동일)
  termCode?: string; // 학년도+학기 코드 (예: 202620)
  errorCode?: number; // SSV ErrorCode
  errorType?: CourseRegErrorType; // 분류된 에러 유형
  raw: {
    login?: SsvDocument; // findAppcsLogin 원본
    student?: SsvDocument; // findStunoInfo 원본
    loginCheck?: SsvDocument; // findAppcsLoginChk 원본
  };
}

/** 수강신청 세션 정보 (dsSession) */
export interface CourseRegSessionInfo {
  msg: string; // 로그인 메시지 (success 등)
  userNm: string; // 사용자 이름
  persNo: string; // 개인번호 (학번)
  encStr: string; // 암호화 문자열
  deptNm: string; // 학과명
  wasInfo: string; // WAS 정보
  initPswdYn: string; // 초기 비밀번호 여부
  needChangePwd: string; // 비밀번호 변경 필요 여부
  userSupport: string; // 지원 정보 원문
  locale: string; // 로케일
  raw: SsvRow; // 원본 행
}

/** 수강신청 학년도/학기 문맥 */
export interface CourseRegTermContext {
  syy: string; // 학년도
  smtCd: string; // 학기 코드
  unvfrStdrDeptCd?: string; // 대학 기준 부서 코드
  stuno?: string; // 학번
  asignDeprtCd?: string; // 배정 학과 코드
}

/** 학사일정 코드 조회 결과 (예: 202620) */
export interface CourseRegTermCodeInfo {
  termCode: string; // 결합 코드 (YYYY + smtCd)
  syy: string; // 학년도
  smtCd: string; // 학기 코드
  raw: SsvRow; // 원본 행
  params: SsvParams; // 응답 파라미터
}

/** SSV POST 요청 정보 */
export interface CourseRegSsvPostRequest {
  method: "POST"; // HTTP 메서드
  url: string; // 요청 URL
  query: Record<string, string>; // 쿼리 파라미터
  body: string; // SSV 본문
  contentType: "text/xml"; // Content-Type
  accept: string; // Accept 헤더
}

/** GET 요청 정보 */
export interface CourseRegGetRequest {
  method: "GET"; // HTTP 메서드
  url: string; // 요청 URL
  query?: Record<string, string>; // 쿼리 파라미터
}

/**
 * 수강신청 등록/취소 파라미터.
 * 패킷에서 확인된 dsParam 컬럼 구조 기반.
 * 희망바구니 전용 필드(appcsKindCd=100 등) 없음.
 */
export interface CourseRegMutationOptions extends Partial<CourseRegTermContext> {
  subjtCd: string; // 과목코드 (예: 736012)
  corseDvclsNo: string; // 분반번호 (예: 01, KO)
  cmpsjDivCd?: string; // 이수 구분 코드 (01=전필, 02=전선, 03=교필, 04=교선)
  ceckTrgetGbn?: string; // 검증 대상 구분 (H 또는 빈값)
  hiPass?: string; // hiPass 값 (0 또는 빈값)
  ttcMapngNo?: string; // 시간표 매핑번호 (없으면 SSV_EMPTY)
  gschSubjtYn?: string; // 대학원 과목 여부 (0 또는 SSV_EMPTY)
  stdntChngLmttYn?: string; // 학생 변경 제한 여부 (SSV_EMPTY)
  bchdmCntcSubjtYn?: string; // 학부-대학원 연계 과목 여부 (SSV_EMPTY)
  menuId?: string; // 메뉴 ID 덮어쓰기
  pgmId?: string; // 프로그램 ID 덮어쓰기
  /**
   * true면 등록 전 경고장학생 체크(findWarnStdrInqryCscnt→saveWarnStdrInqrtCscnt) 생략.
   * 기본 false — 패킷에서 매 신청 전 선행됨.
   * (예약 매크로 스크립트 등에서만 명시적으로 true)
   */
  skipWarnCheck?: boolean;
  /**
   * true면 findMyGLIOList / findSysdate 선행 호출 생략.
   * 자동화 시 기본 true 권장. 브라우저 동일 흐름은 false.
   */
  skipAuxRequests?: boolean;
}

/** 수강신청/취소 결과 */
export interface CourseRegMutationResult {
  success: boolean; // 성공 여부 (ErrorCode=0이면 true)
  errorCode?: number; // SSV ErrorCode (-20001 등)
  errorMsg?: string; // SSV ErrorMsg (한글 서버 메시지)
  errorType?: CourseRegErrorType; // 분류된 에러 유형
  message: string; // 사용자 표시 메시지
  action: "register" | "cancel"; // 수행 동작
  subjtCd: string; // 대상 과목 코드
  corseDvclsNo: string; // 대상 분반
  raw: SsvDocument; // 원본 SSV 응답
}

/** 내 수강신청 목록 조회 옵션 (findAppcsDtlsList dsParam 기반) */
export interface CourseRegMyListOptions extends Partial<CourseRegTermContext> {
  cmpsjHyDivCd?: string; // 이수 학년 구분
  cmpsjDivCd?: string; // 이수 구분
  serchDiv?: string; // 검색 구분 (기본 0)
  estblCrseDivCd?: string; // 개설 과정 구분
  subjtCd?: string; // 과목코드 필터
  corseDvclsNo?: string; // 분반 필터
  menuId?: string; // 메뉴 ID
  pgmId?: string; // 프로그램 ID
}

/** 개설 과목 검색 옵션 (findEstblSubjtGnrlList, menuId=M100780) */
export interface CourseRegSearchOptions extends Partial<CourseRegTermContext> {
  serchDiv?: string; // 검색 구분
  cmpsjHyDivCd?: string; // 이수 학년 구분
  cmpsjDivCd?: string; // 이수 구분
  estblCrseDivCd?: string; // 개설 과정 구분
  keyword?: string; // 과목명/코드 검색어
  subjtCd?: string; // 과목 코드
  subjtNm?: string; // 과목 이름
  corseDvclsNo?: string; // 분반
  menuId?: string; // 메뉴 ID
  pgmId?: string; // 프로그램 ID
}

/**
 * 수강신청된 과목 항목 (findAppcsDtlsList 응답, Dataset:dsSapl231 기반).
 * 희망바구니 SugangSubject 의 sourceList 개념을 상속하지 않는다.
 */
export interface CourseRegRegisteredSubject {
  subjtCd: string; // 과목코드
  subjtNm: string; // 과목명
  orgSubjtNm: string; // 원본 과목명
  corseDvclsNo: string; // 분반
  estblDeprtCd: string; // 개설 학과 코드
  estblDeprtNm: string; // 개설 학과명
  asignDeprtNm: string; // 배정 학과명
  univCd: string; // 대학 코드
  univNm: string; // 대학명
  cmpsjCdt: string; // 학점
  cmpsjDivCd: string; // 이수 구분 코드
  estblCrseDivCd: string; // 개설 과정 구분 코드
  estblCrseDivNm: string; // 개설 과정 구분명
  cmpsjHyDivCd: string; // 이수 학년 구분
  dghtDivCd: string; // 주야 구분
  timtbNm: string; // 시간표 문자열
  syy: string; // 학년도
  smtCd: string; // 학기 코드
  unvfrStdrDeptCd: string; // 대학 기준 부서 코드
  stuno: string; // 학번
  chrgInstrEmpno: string; // 담당 교원 사번
  chrgInstrEmpnm: string; // 담당 교원명
  appcsLmttPcnt: string; // 수강 제한 인원
  appcsPcnt: string; // 현재 신청 인원
  ttCmpsjCdt: string; // 총 신청 학점
  applyCrseCd: string; // 신청 과정 코드
  chk: string; // 체크값
  ttcMapngNo: string; // 시간표 매핑번호
  lessnChoicAttrbItemVal114: string; // 평가속성 114
  lessnChoicAttrbItemVal115: string; // 평가속성 115
  lessnChoicAttrbItemVal116: string; // 평가속성 116
  lessnChoicAttrbItemVal119: string; // 평가속성 119
  lessnChoicAttrbItemVal121: string; // 평가속성 121
  lessnChoicAttrbItemVal125: string; // 평가속성 125
  glioDeptCd: string; // GLIO 학과 코드
  raw: SsvRow; // 원본 행
}

/** 본신청 확정 과목으로 그린 간이 시간표 */
export type CourseRegRegisteredTimetable = SugangHopeBasketTimetable<CourseRegRegisteredSubject>;

/** 연속 재시도 모드 옵션 */
export interface CourseRegRetryRegisterOptions extends CourseRegMutationOptions {
  /** 재시도 간격(ms), 기본 500 */
  intervalMs?: number;
  /** 최대 시도 횟수 (0 또는 미지정 = 무한, Ctrl+C 로 중단) */
  maxAttempts?: number;
  /** 시도마다 호출되는 콜백 */
  onAttempt?: (info: {
    attempt: number;
    result: CourseRegMutationResult;
    elapsedMs: number;
  }) => void;
  /** 중단 여부 검사 (true 반환 시 루프 종료) */
  shouldStop?: () => boolean;
}

/** 연속 재시도 결과 */
export interface CourseRegRetryRegisterResult {
  success: boolean; // 최종 성공 여부
  attempts: number; // 시도 횟수
  elapsedMs: number; // 소요 시간
  lastResult: CourseRegMutationResult; // 마지막 응답
  stoppedByUser: boolean; // 사용자 중단 여부
}

/** 검색 결과 과목 타입 별칭 (개설 검색은 SugangSubject 재사용) */
export type CourseRegSearchSubject = SugangSubject;
