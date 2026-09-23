/** 레거시 암호화 모듈 인터페이스 */
export interface LegacyScrypto {
  makeSendInfo(
    userId: string, // 로그인 ID
    encodedPassword: string, // 인코딩된 비밀번호
    reason?: string, // 로그인 사유 코드
    foreigner?: string // 내/외국인 구분 값
  ): string;
}
