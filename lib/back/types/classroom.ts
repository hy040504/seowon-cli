/** 첨부파일 정보. e-campus 첨부 URL만 허용한다 */
export interface AttachmentRow {
  title: string; // 첨부파일명
  url: string; // 다운로드 URL
}

/** 강의자료실 목록 행 */
export interface MaterialRow {
  id: string; // 게시글 서버 ID
  title: string; // 자료 제목
  date: string; // 게시일
  hasAttachment: boolean; // 첨부파일 존재 여부
  crsCreCd: string; // 과목/강의실 코드
  courseTitle: string; // 과목명
}

/** 과목 공지 목록 행. getNoticeList 항목 */
export interface NoticeRow {
  id: string; // 게시글 서버 ID (atclId)
  title: string; // 공지 제목
  date: string; // 게시일
  hasAttachment: boolean; // 첨부파일 존재 여부
  crsCreCd: string; // 과목/강의실 코드
  courseTitle: string; // 과목명
}

/** 공지 상세. 목록 raw 요청을 재전송해 HTML에서 읽는다 */
export interface NoticeDetail {
  text: string; // 공지 본문(태그 제거)
  attachments: AttachmentRow[]; // 첨부 목록
}

/** 과제 상세. 목록 raw 요청을 재전송해 HTML에서 읽는다 */
export interface AssignmentDetail {
  text: string; // 과제 본문(태그 제거)
  attachments: AttachmentRow[]; // 교수 참고자료 첨부
  submittedAttachments: AttachmentRow[]; // 학생이 제출한 파일
  canSubmit: boolean; // sendAsmnt 제출 가능(과제 식별자 있음)
  sendType: "F" | "T" | ""; // F=파일 T=텍스트
  formAction: string; // 제출 action 절대 URL
  asmntSendCd: string; // 기제출 과제 수정 코드 (비어있으면 신규 제출)
}

/** 과제 제출 파일. multipart에서 받은 버퍼 */
export interface AssignmentUploadFile {
  filename: string; // 원본 파일명
  mime: string; // Content-Type
  data: Buffer; // 파일 본문
}

/** 이미 제출한 파일의 이름만 바꿀 때. 서버가 e-campus에서 받아 새 이름으로 다시 올린다 */
export interface AssignmentRenameFile {
  url: string; // 기존 파일 다운로드 URL
  newName: string; // 바꿀 파일명 (확장자 포함)
}

/** 과제 제출 본문. 수강신청이 아니라 e-campus 과제 폼이다 */
export interface AssignmentSubmitPayload {
  id: string; // 과제 서버 ID (asmntCd)
  crsCreCd: string; // 과목/강의실 코드
  file?: AssignmentUploadFile; // 첨부 파일. 폼에 file 필드가 있을 때만 씀
  asmntSendCd?: string; // 기제출 과제의 edit 코드. 있으면 editSendAsmnt 사용
  deletedEncFileSns?: string[]; // 제외/삭제할 이전 제출 파일들의 encFileSn 목록
  deletedFileUrls?: string[]; // X 한 파일 다운로드 URL. encFileSn 파싱 보조용
  keepFileUrls?: string[]; // X 하지 않고 남긴 기존 제출 파일 URL
  renamedFiles?: AssignmentRenameFile[]; // 이름만 바꿀 기존 제출 파일
}

/** 과제 상세 HTML에서 읽은 제출 폼 */
export interface AssignmentSubmitForm {
  action: string; // 제출 절대 URL (seowon.ac.kr만 허용)
  fields: Record<string, string>; // hidden·텍스트 필드
  textField: string; // textarea name. 없으면 빈 문자열
  fileField: string; // file input name. 없으면 빈 문자열
  hasFile: boolean; // 파일 필드 존재 여부
}

/** multipart 파일 파트 */
export interface MultipartFile {
  filename: string; // Content-Disposition filename
  mime: string; // 파트 Content-Type
  data: Buffer; // 파트 본문
}

/** 브라우저 multipart/form-data 파싱 결과 */
export interface MultipartBody {
  fields: Record<string, string>; // 일반 필드
  files: Record<string, MultipartFile>; // 파일 필드 (name → 파일)
}
