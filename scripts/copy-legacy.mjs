/**
 * tsc 가 복사하지 않는 로그인 암호화 CJS 를 dist 로 옮긴다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 빌드 스크립트 위치를 기준으로 계산한 프로젝트 루트. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** TypeScript 빌드가 복사하지 않는 레거시 암호화 소스 폴더. */
const src = path.join(root, "lib", "back", "engine", "ecampus", "legacy");
/** 빌드 결과에서 레거시 모듈을 읽을 대상 폴더. */
const dest = path.join(root, "dist", "back", "engine", "ecampus", "legacy");

if (!fs.existsSync(src)) {
  console.error("legacy crypto 소스가 없습니다:", src);
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
}
