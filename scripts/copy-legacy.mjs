/**
 * tsc 가 복사하지 않는 로그인 암호화 CJS 를 dist 로 옮긴다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "lib", "back", "engine", "ecampus", "legacy");
const dest = path.join(root, "dist", "back", "engine", "ecampus", "legacy");

if (!fs.existsSync(src)) {
  console.error("legacy crypto 소스가 없습니다:", src);
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
}
