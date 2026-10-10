/** 과목 성적 항목. kind는 API EcampusScoreItemKind (item/total/grade) */
export interface ScoreItemRow {
  title: string; // 항목명
  value: string; // 화면 표시값
  kind: string; // 항목 종류
}

/** 과목별 성적 요약. 미공개·설문 게이트면 canView=false 이고 메시지만 둔다 */
export interface ScoreRow {
  courseTitle: string; // 과목명
  crsCreCd: string; // 과목/강의실 코드
  canView: boolean; // 성적 조회 가능 여부
  status: string; // EcampusScoreAccessStatus 또는 unavailable
  message: string; // 미공개 이유 또는 빈 문자열
  total: string; // 총점 표시값
  grade: string; // 등급 표시값
  items: ScoreItemRow[]; // 성적 항목 목록
}
