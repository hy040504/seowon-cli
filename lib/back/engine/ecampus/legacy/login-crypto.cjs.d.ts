/** CommonJS 로그인 암호화 모듈의 TypeScript 호출 인터페이스. */
declare const legacyCrypto: {
  /**
   * 학교 로그인 API의 encryptData에 넣을 전송 문자열을 만든다.
   * @param userId - 로그인 ID 또는 학번
   * @param encodedPassword - URI 인코딩한 비밀번호
   * @param reason - 로그인 사유 코드
   * @param foreigner - 내·외국인 구분 값
   * @returns 로그인 요청에 전달할 암호화 문자열
   */
  makeSendInfo(
    userId: string,
    encodedPassword: string,
    reason?: string,
    foreigner?: string
  ): string;
};

export = legacyCrypto;
