import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { makeKit } from "../../lib/front/tui/tui-kit.js";
import { sanitizeTerminalText } from "../../lib/back/utils.js";

// Synthetic streams exercise raw keyboard handling without a university connection or OS echo.
const captured: string[] = [];
const writer = stdout.write;
Object.defineProperty(stdin, "isTTY", { configurable: true, value: true });
Object.defineProperty(stdout, "isTTY", { configurable: true, value: true });
Object.defineProperty(stdout, "columns", { configurable: true, value: 88 });
Object.defineProperty(stdin, "setRawMode", { configurable: true, value: (raw: boolean) => { Object.defineProperty(stdin, "isRaw", { configurable: true, value: raw }); } });
stdout.write = ((chunk: unknown) => { captured.push(String(chunk)); return true; }) as typeof stdout.write;
const kit = makeKit({
  TTY: true, colorEnabled: false, c: (text: unknown) => sanitizeTerminalText(text, { multiline: true }),
  A: { bold: "", dim: "", gray: "", green: "", red: "", blue: "", yellow: "", reset: "" }, accent: ""
});
const rl = { pause() {}, resume() {}, setPrompt() {}, question() { throw new Error("Unmasked input fallback used"); } };
const send = (text: string, ms = 100) => setTimeout(() => stdin.emit("data", text), ms);
const lastFrame = (chunks: string[]) => sanitizeTerminalText(chunks.join("").split("\x1b8\x1b[J").at(-1), { multiline: true });
const screenshots: { title: string; text: string }[] = [];
try {
  const password = "DEMO_PASSWORD_NOT_REAL";
  const input = kit.promptField(rl, { label: "비밀번호", secret: true });
  send(password);
  setTimeout(() => screenshots.push({ title: "NO_COLOR 비밀번호 입력 중", text: lastFrame(captured) }), 160);
  send("\r", 200);
  assert.equal(await input, password);
  assert.doesNotMatch(captured.join(""), /DEMO_PASSWORD_NOT_REAL/);
  assert.match(captured.join(""), /\*{22}/);
  screenshots.push({ title: "비밀번호 입력 완료", text: lastFrame(captured) });

  const start = captured.length;
  const select = kit.tableSelect(rl, "안내 자료 선택", [
    { title: "안전한 자료.pdf" },
    { title: "제어 문자\x1b]52;c;PRIVATE_CLIPBOARD\x07\x1b[2J\u202e 제거.pdf" }
  ], [{ key: "title", head: "파일 이름", width: 38 }]);
  setTimeout(() => screenshots.push({ title: "외부 제목 목록", text: sanitizeTerminalText(captured.slice(start).join(""), { multiline: true }) }), 70);
  send("\x1b[B\r");
  assert.equal((await select)?.title.startsWith("제어 문자"), true);
  assert.doesNotMatch(captured.join(""), /PRIVATE_CLIPBOARD|\u202e/);
  screenshots.push({ title: "방향키와 Enter 선택 완료", text: sanitizeTerminalText(captured.slice(start).join(""), { multiline: true }).split("\n").at(-2) || "제어 문자 제거.pdf" });

  // Short selected labels must pass through the same sanitizer as long marquee labels.
  const menuStart = captured.length;
  const maliciousLabel = "예시\x9d52;c;PRIVATE_MENU_CLIPBOARD\x9c\u202e 항목";
  const menu = kit.expandSelect(rl, "선택 항목", [{ key: "1", name: maliciousLabel, value: "DEMO_ORIGINAL_VALUE" }]);
  send("\r");
  assert.equal(await menu, "DEMO_ORIGINAL_VALUE");
  assert.doesNotMatch(captured.slice(menuStart).join(""), /PRIVATE_MENU_CLIPBOARD|\x9d|\x9c|\u202e/);

  const coloredKit = makeKit({
    TTY: true, colorEnabled: true,
    c: (text: unknown, ...codes: string[]) => `${codes.join("")}${sanitizeTerminalText(text, { multiline: true })}\x1b[0m`,
    A: { bold: "\x1b[1m", dim: "\x1b[2m", gray: "\x1b[90m", green: "\x1b[32m", red: "\x1b[31m", blue: "\x1b[34m", yellow: "\x1b[33m", reset: "\x1b[0m" },
    accent: "\x1b[36m"
  });
  const coloredStart = captured.length;
  const coloredMenu = coloredKit.expandSelect(rl, "색상 유지", [{ key: "1", name: maliciousLabel, value: "DEMO_COLORED_VALUE" }]);
  send("\r");
  assert.equal(await coloredMenu, "DEMO_COLORED_VALUE");
  assert.ok(captured.slice(coloredStart).join("").includes("\x1b[36m\x1b[1m1) 예시 항목\x1b[0m"));
  assert.doesNotMatch(captured.slice(coloredStart).join(""), /PRIVATE_MENU_CLIPBOARD|\x9d|\x9c|\u202e/);

  // C1 control characters are valid filename characters on both Windows and POSIX.
  // Display cleanup must not alter the selected on-disk path.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "seowon-tui-security-"));
  try {
    const originalName = "example\x9d52;c;PRIVATE_FILE_CLIPBOARD\x9c\u202e.txt";
    const originalPath = path.join(directory, originalName);
    await fs.writeFile(originalPath, "DEMO_FILE", { flag: "wx", mode: 0o600 });
    const treeStart = captured.length;
    const tree = kit.directoryTree(rl, { startDir: directory });
    send("\x1b[B\x1b[B\r");
    assert.equal(await tree, originalPath);
    assert.doesNotMatch(captured.slice(treeStart).join(""), /PRIVATE_FILE_CLIPBOARD|\x9d|\x9c|\u202e/);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("seowon-tui-security-"));
    await fs.rm(directory, { recursive: true, force: true });
  }

  const downloadStart = captured.length;
  await kit.withDownloadBar("example.pdf", async (report: (loaded: number, total: number) => void) => {
    report(2, 2);
    return { ok: true };
  });
  assert.doesNotMatch(captured.slice(downloadStart).join(""), /\x1b\[[0-9;]*m/);

  const cancel = kit.promptField(rl, { label: "비밀번호", secret: true });
  send("\x1b");
  assert.equal(await cancel, "");
  assert.equal(stdin.isRaw, false);
  stdout.write = writer;
  process.stdout.write(JSON.stringify({ passed: true, screenshots }));
} catch {
  stdout.write = writer;
  process.stderr.write("Synthetic terminal verification failed\n");
  process.exitCode = 1;
} finally { stdin.pause(); }
