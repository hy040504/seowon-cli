import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { constants, createWriteStream } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sanitizeTerminalText, UserFacingError } from "../utils.js";

const activeDestinations = new Set<string>();
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** 원격 제목은 경로가 아니라 파일 이름이다. Windows 장치명·ADS·숨김 이름도 피한다. */
export function safeDownloadName(value: unknown): string {
  const name = sanitizeTerminalText(value)
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 180)
    .replace(/[. ]+$/g, "");
  if (!name) return "download";
  return /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name) ? `_${name}` : name;
}

function claimDestination(destination: string): { finalPath: string; key: string; temporary: string } {
  const finalPath = path.resolve(destination);
  const key = process.platform === "win32" ? finalPath.toLowerCase() : finalPath;
  if (activeDestinations.has(key)) throw new UserFacingError("같은 파일을 이미 저장하고 있습니다.");
  activeDestinations.add(key);
  return { finalPath, key, temporary: `${finalPath}.${randomUUID()}.part` };
}

async function prepareDestination(finalPath: string): Promise<void> {
  await fs.mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
  // rename은 링크 대상에 쓰지 않지만, 의도하지 않은 링크·디렉터리 교체 자체도 거부한다.
  try {
    const existing = await fs.lstat(finalPath);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new UserFacingError("일반 파일 경로에만 저장할 수 있습니다.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** 같은 폴더의 비공개 임시 파일을 완성한 뒤 교체한다. 실패 시 기존 파일을 보존한다. */
export async function writePrivateFile(destination: string, data: string | Uint8Array, signal?: AbortSignal): Promise<void> {
  const { finalPath, key, temporary } = claimDestination(destination);
  try {
    signal?.throwIfAborted();
    await prepareDestination(finalPath);
    await fs.writeFile(temporary, data, { flag: "wx", mode: 0o600, signal });
    signal?.throwIfAborted();
    await fs.rename(temporary, finalPath);
  } finally {
    activeDestinations.delete(key);
    await fs.rm(temporary, { force: true });
  }
}

/** 영상도 임시 파일에 기록한다. 취소·실패한 스트림은 기존 완성 파일을 건드리지 않는다. */
export async function savePrivateStream(source: Readable, destination: string, signal?: AbortSignal): Promise<void> {
  let claimed: ReturnType<typeof claimDestination> | undefined;
  let earlyError: Error | undefined;
  const observe = (error: Error) => { earlyError = error; };
  source.on("error", observe);
  try {
    claimed = claimDestination(destination);
    signal?.throwIfAborted();
    await prepareDestination(claimed.finalPath);
    if (earlyError) throw earlyError;
    await pipeline(source, createWriteStream(claimed.temporary, { flags: "wx", mode: 0o600 }), { signal });
    signal?.throwIfAborted();
    await fs.rename(claimed.temporary, claimed.finalPath);
  } catch (error) {
    source.destroy();
    throw error;
  } finally {
    source.off("error", observe);
    if (claimed) {
      activeDestinations.delete(claimed.key);
      await fs.rm(claimed.temporary, { force: true });
    }
  }
}

/** 사용자가 고른 일반 파일만 제한된 크기로 읽는다. 링크·장치·FIFO 업로드는 거부한다. */
export async function readUploadFile(filePath: string): Promise<Buffer> {
  const link = await fs.lstat(filePath);
  if (!link.isFile() || link.isSymbolicLink()) throw new UserFacingError("일반 파일만 제출할 수 있습니다.");
  if (link.size > MAX_UPLOAD_BYTES) throw new UserFacingError("제출 파일은 100 MiB 이하여야 합니다.");
  const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const handle = await fs.open(filePath, flags);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== link.dev || opened.ino !== link.ino || opened.size > MAX_UPLOAD_BYTES) {
      throw new UserFacingError("제출 파일이 변경되었습니다. 파일을 다시 선택하세요.");
    }
    // stat 이후 파일이 커져도 메모리 사용을 제한한다.
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      const data = Buffer.from(chunk);
      bytes += data.length;
      if (bytes > MAX_UPLOAD_BYTES) throw new UserFacingError("제출 파일은 100 MiB 이하여야 합니다.");
      chunks.push(data);
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    await handle.close();
  }
}
