import type { AxiosInstance } from "axios";
import type { LoginEncryptOptions } from "./crypto.js";

/** e-campus 클라이언트 생성 옵션 */
export interface EcampusClientOptions {
  baseUrl?: string; // e-campus 기본 URL
  axios?: AxiosInstance; // 커스텀 Axios 인스턴스
  loginCredentials?: LoginCredentials; // 자동 재로그인 계정 정보
}

/** 로그인 계정 정보 */
export interface LoginCredentials extends LoginEncryptOptions {
  userId: string; // 로그인 ID
  password: string; // 로그인 비밀번호
}

/** 암호화 패킷 로그인 옵션 */
export interface LoginWithEncryptDataOptions {
  encryptData: string; // 암호화된 로그인 패킷
}

/** 강의실 리소스 조회 옵션 */
export interface GetClassroomResourcesOptions {
  crsCreCd: string; // 과목/강의실 코드
  userNo: string; // 사용자 번호
  userName?: string; // 사용자 이름
  listScale?: number; // 조회 개수
}

/** 게시판 목록 조회 옵션 */
export interface GetClassroomBoardListOptions {
  crsCreCd: string; // 과목/강의실 코드
  listScale?: number; // 조회 개수
}

/** 과제 목록 조회 옵션 */
export interface GetClassroomAssignmentListOptions extends GetClassroomBoardListOptions {
  userNo: string; // 사용자 번호
  userName?: string; // 사용자 이름
}

/** 온라인 강의 목록 조회 옵션 */
export interface GetElearningLessonListOptions {
  crsCreCd: string; // 과목/강의실 코드
  mcd?: string; // 메뉴 코드
  progressTypeCd?: string; // 진도 방식 코드
}

/** 온라인 강의 시청 창 열기 옵션 */
export interface OpenElearningLessonOptions {
  crsCreCd: string; // 과목/강의실 코드
  lessonCntsId: string; // 강의 콘텐츠 ID
  progressTypeCd?: string; // 진도 방식 코드
  seekFile?: string; // 재생 위치 값
  downloadYn?: string; // 다운로드 여부 값
}

/** 로그인 처리 결과 */
export type LoginResult =
  | { type: "redirect"; data: EcampusLoginResponse; url: string }
  | { type: "reload"; data: EcampusLoginResponse }
  | { type: "error"; data?: EcampusLoginResponse; message: string };

/** 로그인 API 응답 */
export interface EcampusLoginResponse {
  redirectUrl?: string; // 로그인 후 이동 URL
  otpLogin?: "Y" | "N" | string; // OTP 로그인 필요 여부
  otpUserYn?: "Y" | "N" | string; // OTP 사용자 여부
  otpUserType?: string; // OTP 사용자 유형
  userId?: string; // 사용자 ID
  userNo?: string; // 사용자 번호
  message?: string; // 서버 메시지
  [key: string]: unknown; // 추가 응답 필드
}
