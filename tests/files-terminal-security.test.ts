import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { inspect } from "node:util";
import { Campus } from "../lib/back/campus.js";
import { readUploadFile, safeDownloadName, savePrivateStream, writePrivateFile } from "../lib/back/files/private-files.js";
import { errorMessage, sanitizeTerminalText, UserFacingError } from "../lib/back/utils.js";
import { assertSafeTimetableSvg, fetchTimetable, parseLectureSlots, renderTimetablePng } from "../lib/back/services/timetable/timetable.js";
import type { WebSession } from "../lib/back/types/session.js";

async function temporaryDirectory(t: { after(fn: () => Promise<void>): void }): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "seowon-cli-security-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("terminal text cannot set clipboard, hyperlinks, cursor, colors, or bidi overrides", () => {
  for (const payload of [
    "before\x1b]52;c;synthetic-secret\x07after",
    "before\x9d52;c;synthetic-secret\x9cafter",
    "before\x1bPsynthetic-secret\x1b\\after",
    "before\x1b[2J\x1b[31mafter\x1b[0m",
    "before\x1b]8;;https://example.invalid\x1b\\after\x1b]8;;\x1b\\",
    "before\u202e\u2066after\u2069"
  ]) assert.equal(sanitizeTerminalText(payload), "beforeafter");
  assert.equal(sanitizeTerminalText("visible\x1b]52;unterminated"), "visible");
  assert.equal(sanitizeTerminalText("line\r\n\ttwo", { multiline: true }), "line\n\ttwo");
  assert.equal(sanitizeTerminalText("line\r\n\ttwo"), "linetwo");
});

test("unexpected error messages and objects do not expose credentials or local paths", () => {
  const sensitive = "password=DEMO_PASSWORD /private/path request-body";
  assert.doesNotMatch(errorMessage(new Error(sensitive)), /DEMO_PASSWORD|private\/path|request-body/);
  assert.doesNotMatch(errorMessage({ credentials: sensitive }), /DEMO_PASSWORD|private\/path/);
  assert.equal(errorMessage(new UserFacingError("다시 로그인하세요.\x1b[2J")), "다시 로그인하세요.");
});

test("remote filenames remain single visible files and avoid Windows devices and streams", () => {
  for (const value of ["../private", "..\\private", "C:\\private:secret", "CON.txt", "nul", "COM1.log", "conin$", "LPT².dat", ".git", "..", "file. ", "\x1b]52;c;secret\x07safe.pdf", "report\u202egnp.exe"]) {
    const name = safeDownloadName(value);
    assert.ok(name.length > 0);
    assert.equal(path.basename(name), name);
    assert.doesNotMatch(name, /^[. ]|[. ]$|[<>:"/\\|?*\x00-\x1f\x7f-\x9f\u202e]/);
    assert.doesNotMatch(name, /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i);
  }
  assert.equal(safeDownloadName("안내자료.pdf"), "안내자료.pdf");
});

test("private atomic documents replace only after success and leave no temporary files", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, "private", "timetable.png");
  await writePrivateFile(file, Buffer.from("first"));
  await writePrivateFile(file, Buffer.from("second"));
  assert.equal(await fs.readFile(file, "utf8"), "second");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(writePrivateFile(file, "cancelled", controller.signal));
  assert.equal(await fs.readFile(file, "utf8"), "second");
  assert.deepEqual(await fs.readdir(path.dirname(file)), ["timetable.png"]);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
  }
});

test("failed video streams preserve existing files and remove incomplete downloads", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, "lesson.mp4");
  await fs.writeFile(file, "existing");
  const source = Readable.from((async function* () { yield Buffer.from("partial"); throw new Error("offline simulated failure"); })());
  await assert.rejects(savePrivateStream(source, file), /simulated failure/);
  assert.equal(await fs.readFile(file, "utf8"), "existing");
  assert.equal(source.destroyed, true);
  assert.deepEqual(await fs.readdir(directory), ["lesson.mp4"]);
  await savePrivateStream(Readable.from([Buffer.from("complete")]), file);
  assert.equal(await fs.readFile(file, "utf8"), "complete");
});

test("concurrent video destinations are rejected and cancellation preserves previous output", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, "lesson.mp4");
  await fs.writeFile(file, "existing");
  const controller = new AbortController();
  const pending = new Readable({ read() {} });
  const first = savePrivateStream(pending, file, controller.signal);
  const second = Readable.from(["second"]);
  await assert.rejects(savePrivateStream(second, file), /이미 저장/);
  assert.equal(second.destroyed, true);
  controller.abort();
  await assert.rejects(first);
  assert.equal(await fs.readFile(file, "utf8"), "existing");
  assert.deepEqual(await fs.readdir(directory), ["lesson.mp4"]);
});

test("output links cannot overwrite another file", async (t) => {
  const directory = await temporaryDirectory(t);
  const original = path.join(directory, "original.txt");
  const link = path.join(directory, "link.txt");
  await fs.writeFile(original, "keep");
  try { await fs.symlink(original, link); } catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") { t.skip("Windows symlink privilege unavailable"); return; }
    throw error;
  }
  await assert.rejects(writePrivateFile(link, "replace"), /일반 파일/);
  await assert.rejects(savePrivateStream(Readable.from(["replace"]), link), /일반 파일/);
  await assert.rejects(readUploadFile(link), /일반 파일/);
  assert.equal(await fs.readFile(original, "utf8"), "keep");
});

test("uploads accept regular files and reject directories and excessive sizes", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, "submission.txt");
  await fs.writeFile(file, "synthetic assignment");
  assert.equal((await readUploadFile(file)).toString(), "synthetic assignment");
  await assert.rejects(readUploadFile(directory), /일반 파일/);
  await fs.truncate(file, 100 * 1024 * 1024 + 1);
  await assert.rejects(readUploadFile(file), /100 MiB/);
});

test("Campus inspection and JSON omit student data and arbitrary added credentials", () => {
  const campus = new Campus();
  campus.student = { studentId: "DEMO_STUDENT", studentName: "DEMO_NAME", userNo: "DEMO_USER", deptName: "DEMO_DEPT", deptCd: "DEMO" };
  Object.assign(campus, { session: { sugangCreds: { password: "DEMO_PASSWORD" }, cookies: "DEMO_COOKIE" } });
  assert.deepEqual(JSON.parse(JSON.stringify(campus)), { type: "Campus", loggedIn: false });
  assert.doesNotMatch(inspect(campus), /DEMO_PASSWORD|DEMO_COOKIE|DEMO_STUDENT|DEMO_NAME/);
  assert.equal(campus.loggedIn(), false);
});

test("oversized timetable ranges cannot create unbounded loops or invalid periods", () => {
  assert.deepEqual(parseLectureSlots("월1-99999999999999999999999999").map((slot) => slot.period), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(parseLectureSlots("화99999999999999999999999999").length, 0);
  assert.deepEqual(parseLectureSlots("수2-3").map((slot) => slot.period), [2, 3]);
});

const inertSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="#ffffff"/><text x="5" y="20">안전한 예시</text></svg>';

test("timetable rasterization accepts inert text and rejects scripts, files, entities, and oversized canvases", () => {
  assert.equal(assertSafeTimetableSvg(inertSvg), inertSvg);
  assert.deepEqual([...renderTimetablePng(inertSvg).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  for (const unsafe of [
    inertSvg.replace("</svg>", '<script>alert(1)</script></svg>'),
    inertSvg.replace("</svg>", '<image href="file:///private"/></svg>'),
    inertSvg.replace("</svg>", '<foreignObject><div>unsafe</div></foreignObject></svg>'),
    inertSvg.replace('fill="#ffffff"', 'fill="url(file:///private)"'),
    inertSvg.replace('width="300"', 'width="1"'),
    inertSvg.replace('height="300"', 'height="999999999"'),
    inertSvg.replace('x="5"', 'onload="alert(1)" x="5"'),
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private">]>' + inertSvg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/><script/>'
  ]) assert.throws(() => renderTimetablePng(unsafe), /안전한 시간표/);
});

test("generated timetable HTML has a restrictive CSP, escaped school text, and no scripts", async () => {
  const malicious = '<img src="https://example.invalid" onerror="alert(1)">';
  const session = {
    student: { studentName: malicious },
    courseReg: { async getMyRegisteredTimetable() { return { courseCount: 1, totalCredits: 3, subjects: [{ subjtNm: malicious, timtbNm: "월1-2", subjtCd: "DEMO" }], cells: [], conflicts: [] }; } }
  } as unknown as WebSession;
  const result = await fetchTimetable(session);
  assert.match(result.html, /Content-Security-Policy/);
  assert.match(result.html, /default-src 'none'/);
  assert.doesNotMatch(result.html, /<script\b|<img\b|<iframe\b|postMessage/);
  assert.match(result.html, /&lt;img/);
  assertSafeTimetableSvg(result.svg);
});
