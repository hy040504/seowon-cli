declare const legacyCrypto: {
  makeSendInfo(
    userId: string,
    encodedPassword: string,
    reason?: string,
    foreigner?: string
  ): string;
};

export = legacyCrypto;
