import type { AxiosInstance } from "axios";
import type { ErpAcademicProfile } from "./academic.js";
import type { ErpGradeMenuKind } from "./grades.js";

/**
 * 서원대 통합정보시스템 ERP 클라이언트 생성 옵션.
 * e-campus / 희망바구니 / 본신청 클라이언트와 혼용하지 않는다.
 */
export interface ErpClientOptions {
  baseUrl?: string; // 기본 URL (기본: https://info.seowon.ac.kr)
  axios?: AxiosInstance; // 커스텀 Axios 인스턴스
  credentials?: ErpLoginCredentials; // 자동 재로그인 계정 정보
  /** 성적 조회 기본 메뉴. overall=전체학기성적조회*, undergrad=학부* */
  gradeMenu?: ErpGradeMenuKind;
  requestTimeoutMs?: number; // 요청 타임아웃(ms) (기본: 30000)
  maxRetries?: number; // 네트워크 오류 재시도 횟수 (기본: 3)
  onProgress?: (message: string) => void; // 진행 메시지 콜백
}

/** ERP 포털 로그인 계정. 필드명은 패킷의 uid (학번) */
export interface ErpLoginCredentials {
  uid: string; // 학번 (POST /por/lgin uid)
  password: string; // 비밀번호
}

/** JSON POST 요청 정보 */
export interface ErpJsonPostRequest {
  method: "POST";
  url: string;
  query: Record<string, string>;
  body: string;
  contentType: "application/json";
  accept: string;
}

/** form-urlencoded POST 요청 정보 */
export interface ErpFormPostRequest {
  method: "POST";
  url: string;
  body: string;
  contentType: "application/x-www-form-urlencoded";
  accept: string;
}

/** GET 요청 정보 */
export interface ErpGetRequest {
  method: "GET";
  url: string;
  query?: Record<string, string>;
}

/** 포털 로그인 결과 */
export interface ErpLoginResult {
  success: boolean; // 로그인 성공 여부
  message: string; // 사용자 표시 메시지
  persNo?: string; // 학번 (PT.globalVars.userInfo.persNo)
  session?: ErpSessionInfo; // isLogin DS_SESSIONINFO
  glio?: ErpGlioInfo; // findMyGLIOList DS_GLIO
  student?: ErpAcademicProfile; // 학적 기본정보 (로그인 후 조회 시)
  raw: {
    mainHtml?: string; // /por/mn HTML
    isLogin?: unknown; // isLogin JSON
    glio?: unknown; // findMyGLIOList JSON
  };
}

/** isLogin DS_SESSIONINFO */
export interface ErpSessionInfo {
  msg: string; // success 등
  userNm: string; // 이름
  persNo: string; // 학번
  deptNm: string; // 학과명
  locale: string; // 로케일
  needChangePwd: string; // 비밀번호 변경 필요
  wasInfo: string; // WAS 구분
  encStr: string; // 암호화 문자열
  userSupport: string; // 지원 정보
  isLogin: boolean; // DS_LOGINCONFIRM.isLogin === "1"
  raw: Record<string, unknown>;
}

/** findMyGLIOList DS_GLIO */
export interface ErpGlioInfo {
  persNo: string; // 학번
  loginId: string; // 로그인 ID
  userNm: string; // 이름
  deptCd: string; // 학과 코드
  deptNm: string; // 학과명
  deptId: string; // 학과 ID
  univCd: string; // 단과대 코드
  univNm: string; // 단과대명
  acntYy: string; // 회계연도
  locale: string; // 로케일
  socpsCd: string; // 신분 코드
  userDivCd: string; // 사용자 구분
  menuId: string; // 현재 메뉴
  logNo: string; // 로그 번호
  loginIp: string; // 로그인 IP
  raw: Record<string, unknown>;
}

/** 포털/Vue 메뉴 항목 (SVC0100, findMenu, SVC0101) */
export interface ErpMenuItem {
  menuId: string; // 메뉴 ID
  menuNm: string; // 메뉴명
  upperMenuId: string; // 상위 메뉴 ID
  menuLevel: number | null; // 메뉴 레벨
  menuDivCd: string; // F=폴더, P=프로그램
  pgmId: string; // 프로그램 ID
  pgmNm: string; // 프로그램명
  pgmPathNm: string; // Vue/경로
  menuPath: string; // 표시 경로
  sysCd: string; // 시스템 코드
  vueYn: string; // Vue 여부
  mobYn: string; // 모바일 여부
  useYn: string; // 사용 여부
  raw: Record<string, unknown>;
}

/** 포털 공지 목록 조회 옵션 */
export interface ErpNoticeListOptions {
  startRowIndex?: number;
  startRowNum?: number;
  endRowNum?: number;
  countPerPage?: number;
  notcCatgrCd?: string;
  menuId?: string;
}

/** 포털 공지 목록 항목 */
export interface ErpNoticeListItem {
  notcNo: number | null; // 공지 번호
  notcTitle: string; // 제목
  notcCatgrCd: string; // 분류 코드
  notcCatgrNm: string; // 분류명
  writngUserNm: string; // 작성자
  writngUserDeptNm: string; // 작성 부서
  inqryCnt: number | null; // 조회수
  gopubDt: string; // 게시 일시 원문
  frstInputDttm: string; // 최초 입력
  attflUuid: string; // 첨부 UUID
  totalCount: number | null; // 전체 건수
  raw: Record<string, unknown>;
}

/** 포털 공지 상세 */
export interface ErpNoticeDetail extends ErpNoticeListItem {
  noticeSntncCn: string; // 본문 HTML
  portaNotcPrscgNm: string; // 게시자
  portaNotcPrscgDeptNm: string; // 게시 부서
  portaNotcPrscgEmail: string; // 이메일
}

/** SAZ 복원 요약 */
export interface ErpSazSummary {
  logins: ErpLoginResult[];
  menus: ErpMenuItem[];
  sessions: ErpSessionInfo[];
  glios: ErpGlioInfo[];
  notices: ErpNoticeListItem[];
  noticeDetails: ErpNoticeDetail[];
  gradeYears: import("./grades.js").ErpGradeYear[];
  gradeTotals: import("./grades.js").ErpGradeTermTotal[];
  gradeDetails: import("./grades.js").ErpGradeSubject[];
  academicProfiles: ErpAcademicProfile[];
  codeCombos: import("./academic.js").ErpCodeComboSet[];
  lectureEvalChecks: import("./academic.js").ErpLectureEvalCheck[];
  votes: import("./academic.js").ErpVoteInfo[];
}
