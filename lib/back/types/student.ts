/** 화면에 보여줄 학생 요약. 학번·userNo는 e-campus 로그인, 이름·학과는 시간표 SSO에서 채운다 */
export interface WebStudent {
  studentId: string; // 학번
  userNo: string; // e-campus userNo. 없으면 학번
  studentName: string; // 이름. SSO 전엔 빈 문자열
  deptName: string; // 학과명
  deptCd: string; // 학과 코드
}

/** 시간표 SSO용으로만 메모리에 두는 자격. 디스크에 쓰지 않는다 */
export interface SugangCredentials {
  stuno: string; // 학번
  password: string; // 비밀번호
}
