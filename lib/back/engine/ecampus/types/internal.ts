/** 레거시 암호화 모듈 인터페이스 */
export interface LegacyScrypto {
  /**
   * 레거시 모듈로 학교 로그인 패킷의 암호화 문자열을 생성한다.
   * @param userId - 로그인 ID 또는 학번
   * @param encodedPassword - URI 인코딩한 비밀번호
   * @param reason - 로그인 사유 코드
   * @param foreigner - 내·외국인 구분 값
   * @returns encryptData 필드에 넣을 문자열
   */
  makeSendInfo(
    userId: string, // 로그인 ID
    encodedPassword: string, // 인코딩된 비밀번호
    reason?: string, // 로그인 사유 코드
    foreigner?: string // 내/외국인 구분 값
  ): string;
}
