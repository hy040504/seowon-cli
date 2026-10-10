/** 과목 학사 분류 */
export type EcampusCourseCategory = "curricular" | "extracurricular";

/** 서버 과목 타입 코드 */
export type EcampusCourseTypeCode = "UNI" | "CO" | string;

/** 과목 목록 기본 항목 */
export interface EcampusCourseListItem {
  title: string; // 과목명
  crsCreCd: string; // 강의실/개설 과목 코드
  crsTypeCd: EcampusCourseTypeCode; // 서버 과목 타입 코드
  label?: string; // 과목 유형 라벨
  professor?: string; // 담당 교수명
}

/** 확장 과목 정보 */
export interface EcampusCourse extends EcampusCourseListItem {
  id: string; // 클라이언트 식별 ID
  category: EcampusCourseCategory; // 교과/비교과 분류
  label: string; // 화면 표시 라벨
  section?: string; // 분반 정보
  rawTypeCode: EcampusCourseTypeCode; // 원본 서버 타입 코드
}

/** 과목 그룹화 결과 */
export interface EcampusCourseGroups {
  curricular: EcampusCourse[]; // 교과 과목 목록
  extracurricular: EcampusCourse[]; // 비교과 과목 목록
  curricularCourseNames: string[]; // 교과 과목명 목록
  extracurricularCourseNames: string[]; // 비교과 과목명 목록
}

/** 과목명 JSON 구조 */
export interface EcampusCourseNamesJson {
  curricularCourseNames: string[]; // 교과 과목명 목록
  extracurricularCourseNames: string[]; // 비교과 과목명 목록
}
