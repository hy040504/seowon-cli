/** 교과 / 비교과. e-campus crsTypeCd=CO 이면 extracurricular */
export type CourseCategory = "curricular" | "extracurricular";

/** 스냅샷 과제 행. dueNow는 기간 안 + 미제출일 때만 true */
export interface SnapshotAssignment {
  id: string; // 과제 서버 ID (asmntCd)
  title: string; // 과제 제목
  period: string; // 제출 기간 원문
  status: string; // 제출 상태 문구
  crsCreCd: string; // 과목/강의실 코드
  dueNow: boolean; // 지금 제출할 수 있는지
  hasAttachment: boolean; // 교수 참고자료 첨부 여부
  submittedAttachments?: { title: string; url: string }[]; // 학생이 제출한 파일
  hasSubmittedFile?: boolean; // 제출 파일이 있는지
  submittedFilesLoaded?: boolean; // 제출 파일을 이미 조회했는지
}

/** 스냅샷 이러닝 차시 행. needsWatch는 기간 안 + 미학습·학습중일 때만 true */
export interface SnapshotLesson {
  id: string; // 차시 식별값 (lessonCntsId 와 동일)
  week: string; // 주차/차시 묶음 제목
  title: string; // 강의 제목
  period: string; // 정규 학습 기간 원문
  attendanceStatus: string; // 출결 상태. 학교 화면의 강의보기·끝 X 는 제거
  progressPercent: number | null; // 학습률(%). 목록에 없어서 고른 차시만 채움
  lessonCntsId: string; // 강의 콘텐츠 ID
  crsCreCd: string; // 과목/강의실 코드
  needsWatch: boolean; // 지금 들어야 하는지
}

/** 스냅샷 과목. 과제·이러닝을 과목 단위로 묶는다 */
export interface SnapshotCourse {
  courseTitle: string; // 과목명
  crsCreCd: string; // 과목/강의실 코드
  category: CourseCategory; // 교과 / 비교과
  label?: string; // 과목 구분 라벨 (예: 전공, 교양, 비교과 등)
  professor?: string; // 담당 교수명
  assignments: SnapshotAssignment[]; // 과제 목록
  elearning: SnapshotLesson[]; // 이러닝 차시 목록
}

/** 현황 한 줄. 기간 내 미제출 과제·들을 차시 수 */
export interface SummaryRow {
  courseTitle: string; // 과목명
  crsCreCd: string; // 과목/강의실 코드
  category: CourseCategory; // 교과 / 비교과
  dueAssignments: number; // 지금 할 수 있는 과제 수
  pendingLessons: number; // 지금 들어야 하는 차시 수
}

/** 전 과목 조회 스냅샷. 세션에 캐시하고 다시 조회 시 갈아끼운다 */
export interface Snapshot {
  savedAt: string; // 조회 시각 ISO
  semester: string; // 학기 표시값 (예: 2026-2)
  courses: SnapshotCourse[]; // 과목 목록
  summary: SummaryRow[]; // 현황 집계
}

/** 목록 API에 펼친 과제 행. 과목명을 붙인다 */
export interface AssignmentListRow extends SnapshotAssignment {
  courseTitle: string; // 과목명
  category?: CourseCategory; // 교과 / 비교과. 목록 필터에 씀
}

/** 목록 API에 펼친 차시 행. 학교 재생 URL을 붙인다 */
export interface LessonListRow extends SnapshotLesson {
  courseTitle: string; // 과목명
  playUrl: string; // e-campus 강의 창 URL
}
