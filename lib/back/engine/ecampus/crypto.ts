import type { LoginEncryptOptions } from "./types/crypto.js";
import type { LegacyScrypto } from "./types/internal.js";

export type { LoginEncryptOptions } from "./types/crypto.js";

import { createRequire } from "node:module";

// ESM 환경에서 기존 CommonJS 기반의 복잡한 암호화 로직을 그대로 사용하기 위해 Require 생성
const require = createRequire(import.meta.url);
const legacyCrypto = require("./legacy/login-crypto.cjs") as LegacyScrypto;

/**
 * e-campus 서버의 자체 보안 규격에 맞는 'encryptData' 문자열을 생성한다.
 * @param {string} userId - 사용자 식별자 (학번/ID)
 * @param {string} password - 비밀번호 (평문)
 * @param {LoginEncryptOptions} [options={}] - 암호화 옵션
 * @returns {string} 서버 API 호출 시 encryptData 필드에 담을 암호문
 */
export function createLoginEncryptData(
  userId: string,
  password: string,
  options: LoginEncryptOptions = {}
): string {
  // 내부 라이브러리가 URI 인코딩된 비밀번호를 기대하므로 인코딩 후 전달
  return legacyCrypto.makeSendInfo(
    userId,
    encodeURIComponent(password),
    options.reason,
    options.foreigner
  );
}
