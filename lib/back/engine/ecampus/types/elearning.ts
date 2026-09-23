/** 학습 기록 상태 코드 */
export type EcampusLessonStudyStatus = "STUDY" | "COMPLETE" | string;

/** 온라인 강의 POST 요청 정보 */
export interface EcampusLessonPostRequest {
  method: "POST"; // HTTP 메서드
  url: string; // 요청 URL
  body: Record<string, string>; // 전송할 form 필드
}

/** 온라인 강의 GET 요청 정보 */
export interface EcampusLessonGetRequest {
  method: "GET"; // HTTP 메서드
  url: string; // 요청 URL
  query: Record<string, string>; // URL 쿼리 값
}

/** 온라인 강의 차시 정보 */
export interface EcampusLessonItem {
  lessonScheduleId: string; // 주차/차시 묶음 ID
  scheduleTitle?: string; // 주차/차시 묶음 제목
  lessonCntsId: string; // 강의 콘텐츠 ID
  title: string; // 강의 제목
  typeLabel?: string; // 콘텐츠 유형 라벨
  period?: string; // 정규 학습 기간
  extraPeriod?: string; // 추가 학습 기간
  durationText?: string; // 재생 시간 텍스트
  durationSeconds?: number; // 재생 시간(초)
  attendanceStatus?: string; // 출결 상태
  lessonStartDttm?: string; // 강의 시작 일시
  viewRequest: EcampusLessonPostRequest; // 상세 진입 요청
  studyWindowRequest: EcampusLessonPostRequest; // 시청 창 요청
}

/** 주차/차시별 강의 묶음 */
export interface EcampusLessonSchedule {
  lessonScheduleId: string; // 주차/차시 묶음 ID
  title: string; // 묶음 제목
  period?: string; // 학습 기간
  summary?: string; // 수업 내용 요약
  lessons: EcampusLessonItem[]; // 포함된 강의 목록
}

/** 온라인 강의 시청 창 정보 */
export interface EcampusLessonStudyWindow {
  crsCreCd: string; // 과목/강의실 코드
  lessonCntsId: string; // 강의 콘텐츠 ID
  stdNo?: string; // 사용자 번호
  studyDetailId?: string; // 학습 상세 ID
  currentStudyStatusCd?: EcampusLessonStudyStatus; // 현재 학습 상태
  contentUrl?: string; // 실제 콘텐츠 URL
  contentKind: "mp4" | "hls" | "youtube" | "ted" | "doczoom" | "url" | "unknown"; // 콘텐츠 유형
  recordRequest?: EcampusLessonGetRequest; // 학습 기록 요청
}

/** 학습 기록 스냅샷 입력값 */
export interface EcampusStudyRecordSnapshotInput {
  baseUrl?: string; // e-campus 기본 URL
  crsCreCd?: string; // 과목/강의실 코드
  lessonCntsId?: string; // 강의 콘텐츠 ID
  contentUrl?: string; // 실제 콘텐츠 URL
  contentKind?: EcampusLessonStudyWindow["contentKind"]; // 콘텐츠 유형
  lessonScheduleId?: string; // 주차/차시 묶음 ID
  stdNo?: string; // 사용자 번호
  studyDetailId?: string; // 학습 상세 ID
  studyStatusCd?: EcampusLessonStudyStatus; // 기록할 학습 상태
  studyTotalTm?: number | string; // 누적 학습 시간
  studyAfterTm?: number | string; // 추가 학습 시간
  studySessionLoc?: number | string; // 마지막 재생 위치
  studyMaxLoc?: number | string; // 최대 재생 위치
  playerTm?: number | string; // 플레이어 현재 시간
  progressTm?: number | string; // 진도 계산 시간
}

/** 정규화된 학습 기록 스냅샷 */
export interface EcampusStudyRecordSnapshot {
  baseUrl: string; // e-campus 기본 URL
  lessonScheduleId?: string; // 주차/차시 묶음 ID
  lessonCntsId: string; // 강의 콘텐츠 ID
  crsCreCd: string; // 과목/강의실 코드
  stdNo?: string; // 사용자 번호
  studyDetailId?: string; // 학습 상세 ID
  currentStudyStatusCd?: EcampusLessonStudyStatus; // 현재 학습 상태
  contentUrl?: string; // 실제 콘텐츠 URL
  contentKind: EcampusLessonStudyWindow["contentKind"]; // 콘텐츠 유형
  recordRequest?: EcampusLessonGetRequest; // 학습 기록 요청
}

/** 학습 기록 갱신 옵션 */
export interface EcampusLessonRecordOptions {
  crsCreCd: string; // 과목/강의실 코드
  lessonCntsId: string; // 강의 콘텐츠 ID
  stdNo: string; // 사용자 번호
  studyDetailId?: string; // 학습 상세 ID
  studyTotalTm?: number | string; // 누적 학습 시간
  studyAfterTm?: number | string; // 추가 학습 시간
  studyStatusCd?: EcampusLessonStudyStatus; // 기록할 학습 상태
  studySessionLoc?: number | string; // 마지막 재생 위치
  studyMaxLoc?: number | string; // 최대 재생 위치
  playerTm?: number | string; // 플레이어 현재 시간
  progressTm?: number | string; // 진도 계산 시간
}

/** 온라인 강의 파싱 옵션 */
export interface EcampusLessonParseOptions {
  baseUrl?: string; // e-campus 기본 URL
  crsCreCd?: string; // 과목/강의실 코드
  progressTypeCd?: string; // 진도 방식 코드
}

/** 온라인 강의 요청 묶음 생성 옵션 */
export interface EcampusLessonRequestBundleOptions extends EcampusStudyRecordSnapshotInput {
  baseUrl?: string; // e-campus 기본 URL
  progressTypeCd?: string; // 진도 방식 코드
}

/** 온라인 강의 요청 묶음 */
export interface EcampusLessonRequestBundle {
  viewRequest: EcampusLessonPostRequest; // 상세 진입 요청
  studyWindowRequest: EcampusLessonPostRequest; // 시청 창 요청
  recordRequest?: EcampusLessonGetRequest; // 학습 기록 요청
  snapshot: EcampusStudyRecordSnapshot; // 학습 상태 스냅샷
}

/** MP4 URL 추출 결과 */
export interface ElearningMp4UrlResult {
  success: boolean; // 추출 성공 여부
  mp4Url?: string; // 추출된 MP4 URL
  message?: string; // 처리 메시지
  debugInfo?: {
    crsCreCd: string; // 과목/강의실 코드
    lessonCntsId: string; // 강의 콘텐츠 ID
    contentUrl?: string; // 분석 대상 URL
    contentKind?: string; // 콘텐츠 유형
    htmlSnippets?: string[]; // HTML 일부
    [key: string]: unknown; // 추가 디버그 필드
  }; // 디버그 정보
}

/** MP4 다운로드 결과 */
export interface ElearningDownloadResult {
  success: boolean; // 다운로드 성공 여부
  filePath?: string; // 저장된 파일 경로
  message?: string; // 처리 메시지
}
