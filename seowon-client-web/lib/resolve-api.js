/**
 * seowon-client-api 패키지 로더.
 *
 * 웹 서비스는 형제 폴더 또는 SEOWON_CLIENT_API 환경 변수에서
 * 빌드된 dist/index.js 를 찾아 동적 import 한다.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** seowon-client-web/ 디렉터리 절대 경로 */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 후보 경로 중에서 dist/index.js 가 있는 API 루트를 고른다.
 * @returns {string | null} API 패키지 루트. 없으면 null
 */
export function findApiRoot() {
    const extra = process.env.SEOWON_CLIENT_API;
    const home = os.homedir();
    const candidates = [
        extra,
        path.join(home, "Desktop", "개인 개발 프로젝트", "seowon-client-api"),
        path.join(home, "Desktop", "개인 개발 프로젝트", "seowon-client-api-main"),
        path.resolve(WEB_DIR, "..", "..", "..", "..", "..", "개인 개발 프로젝트", "seowon-client-api")
    ].filter(Boolean);

    for (const root of candidates) {
        try {
            if (fs.existsSync(path.join(root, "dist", "index.js"))) return root;
        } catch {
            // 다음 후보
        }
    }
    return null;
}

/**
 * 빌드된 EcampusClient 등을 동적 import 한다.
 * @returns {Promise<{ root: string, api: object }>} 패키지 루트와 공개 모듈
 */
export async function loadClientApi() {
    const root = findApiRoot();
    if (!root) {
        throw new Error(
            "seowon-client-api 를 찾지 못했습니다. SEOWON_CLIENT_API 환경 변수에 폴더 경로를 넣으세요."
        );
    }
    const href = pathToFileURL(path.join(root, "dist", "index.js")).href;
    const api = await import(href);
    return { root, api };
}
