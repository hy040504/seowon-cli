/** 강의실 리소스 종류 */
export type EcampusClassroomSection = "notices" | "assignments" | "materials";

/** e-campus POST 요청 정보 */
export interface EcampusPostRequest {
  method: "POST"; // HTTP 메서드
  url: string; // 요청 URL
  body: Record<string, string>; // 전송할 form 필드
}

/** 강의실 게시판 항목 */
export interface EcampusClassroomItem {
  id: string; // 게시글/과제 서버 ID
  title: string; // 항목 제목
  url: string; // 상세 화면 URL
  request: EcampusPostRequest; // 상세 조회 요청 정보
  date?: string; // 게시일/작성일
  period?: string; // 제출/공개 기간
  status?: string; // 제출/진행 상태
  hasAttachment?: boolean; // 첨부파일 존재 여부
}

/** 첨부파일 정보 */
export interface EcampusClassroomAttachment {
  title: string; // 첨부파일명
  url: string; // 다운로드 URL
}

/** 강의실 리소스 통합 결과 */
export interface EcampusClassroomResources {
  notices: EcampusClassroomItem[]; // 공지사항 목록
  assignments: EcampusClassroomItem[]; // 과제 목록
  materials: EcampusClassroomItem[]; // 강의자료 목록
}

/** 강의실 리소스 파싱 옵션 */
export interface EcampusClassroomResourceOptions {
  baseUrl?: string; // e-campus 기본 URL
  crsCreCd?: string; // 과목/강의실 코드
  bbsId?: string; // 게시판 ID
}

/** 과제 상세 HTML에서 읽은 제출 폼 */
export interface EcampusAssignmentSubmitForm {
  action: string; // 제출 절대 URL
  fields: Record<string, string>; // hidden·텍스트 필드
  textField: string; // textarea name. 없으면 빈 문자열
  fileField: string; // file input name. 없으면 빈 문자열
  hasFile: boolean; // 파일 필드 존재 여부
}

/** 과제 상세 조회 결과 */
export interface EcampusAssignmentDetail {
  html: string; // 상세 화면 HTML
  text: string; // 과제내용 본문
  sendType: "F" | "T" | ""; // F=파일, T=텍스트
  attachments: EcampusClassroomAttachment[]; // 참고자료 첨부
  submittedAttachments: EcampusClassroomAttachment[]; // 학생이 제출한 파일
  submitForm: EcampusAssignmentSubmitForm | null; // 제출 엔드포인트 정보
  canSubmit: boolean; // 제출하기/sendAsmnt 존재
}

/** 첨부 파일 다운로드 결과 */
export interface EcampusDownloadedFile {
  data: Buffer; // 파일 본문
  contentType: string; // Content-Type
  disposition: string; // Content-Disposition
}
