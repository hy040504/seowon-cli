// @ts-nocheck
/**
 * CLI에서 수행하는 쓰기 동작: 다운로드 · 과제 제출/삭제 · 이러닝 시청.
 */
import fs from "node:fs";
import path from "node:path";

/** 저장 파일명에서 경로에 쓸 수 없는 문자를 뺀다. */
function safeName(name) {
  return String(name || "download")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "download";
}

export function makeActions(deps) {
  const { ROOT, c, A, choose, pickFromList, confirm, ask, pickFile, spin, failLine, box, clearScreen, waitEnter, theme } = deps;
  let lastDir = path.join(ROOT, "downloads");

  /** 저장 폴더를 고른다. 직전 폴더에서 이어서 연다. */
  async function chooseSavePath(ctx, fileName) {
    const name = safeName(fileName);
    fs.mkdirSync(lastDir, { recursive: true });
    const folder = await pickFile(ctx.rl, {
      title: "저장 위치",
      startDir: lastDir,
      mode: "dir",
      fileName: name
    });
    if (!folder) return null;
    lastDir = folder;
    const dest = path.join(folder, name);
    if (fs.existsSync(dest)) {
      const ok = await confirm(ctx.rl, `이미 있는 파일을 덮어쓸까요?\n${dest}`, {
        affirmative: "덮어쓰기",
        negative: "취소"
      });
      if (!ok) return null;
    }
    return dest;
  }

  async function saveCampus(ctx, file, extra = {}) {
    if (!file?.url) {
      console.log(c("  받을 URL이 없습니다.", A.red));
      if (typeof waitEnter === "function") await waitEnter(ctx.rl, "Enter 이전 메뉴로 · Esc 이전");
      return;
    }
    const dest = await chooseSavePath(ctx, file.title || "file");
    if (!dest) return;
    const r = await spin(file.title || "file", () =>
      ctx.api.downloadCampusFile({
        url: file.url,
        savePath: dest,
        timeoutMs: 180000,
        ...extra
      })
    );
    if (!r.ok) return console.log(c(`  ${failLine(r)}`, A.red));
    console.log(c(`  저장 ${r.saved || dest}  (${r.bytes || 0}B)`, A.green));
    return r.saved || dest;
  }

  async function pickAndSaveFiles(ctx, files, extra) {
    if (!files.length) {
      console.log(c("  다운로드할 첨부파일이 없습니다.", A.red));
      if (typeof waitEnter === "function") await waitEnter(ctx.rl, "Enter 이전 메뉴로 · Esc 이전");
      return null;
    }
    const f = await pickFromList(ctx.rl, "파일", files, (x) => x.title || x.url, [
      { key: "title", head: "파일", width: 40, get: (x) => x.title || "file" }
    ]);
    if (!f) return;
    return saveCampus(ctx, f, extra);
  }

  async function downloadLesson(ctx, row) {
    const title = safeName(`${row.title || "lecture"}.mp4`);
    const name = title.endsWith(".mp4") ? title : `${title}.mp4`;
    const dest = await chooseSavePath(ctx, name);
    if (!dest) return;
    const r = await spin(path.basename(dest), () =>
      ctx.api.downloadLessonVideo({
        crsCreCd: row.crsCreCd,
        lessonCntsId: row.lessonCntsId,
        savePath: dest,
        timeoutMs: 600000
      })
    );
    if (!r.ok) return console.log(c(`  ${failLine(r)}`, A.red));
    console.log(c(`  저장 ${r.saved || dest}  (${r.bytes || 0}B)`, A.green));
  }

  async function loadDetail(ctx, row) {
    const d = await spin("상세", () =>
      ctx.api.fetchAssignmentDetail({ crsCreCd: row.crsCreCd, id: row.id })
    );
    if (!d.ok) {
      console.log(c(`  ${failLine(d)}`, A.red));
      return null;
    }
    return d.data;
  }

  async function submitAssignment(ctx, row, detail, { filePath, deletedFileUrls = [], keepFileUrls = [], renamedFiles = [] } = {}) {
    const r = await spin("과제 제출", () =>
      ctx.api.submitAssignment({
        crsCreCd: row.crsCreCd || "",
        id: row.id || "",
        asmntSendCd: row.asmntSendCd || detail?.asmntSendCd || "",
        filePath,
        deletedFileUrls,
        keepFileUrls,
        renamedFiles,
        timeoutMs: 120000
      })
    );
    if (!r.ok) return console.log(c(`  ${failLine(r)}`, A.red));
    console.log(c("  학교에 반영했습니다.", A.green));
  }

  async function asgActions(ctx, row) {
    let detail = await loadDetail(ctx, row);
    if (!detail) return;
    const show = () => {
      const text = String(detail.text || "").trim();
      const files = detail.submittedAttachments || [];
      const done = files.length > 0;
      const st = done ? c("제출완료", A.green, A.bold) : c("미제출", A.yellow, A.bold);
      row.hasSubmittedFile = done;
      row.submittedAttachments = files;
      row.submittedFilesLoaded = true;
      console.log(box(row.title, [
        row.courseTitle || "",
        `기간 ${row.period || "-"} · ${st} · 제출파일 ${files.length}개`,
        "",
        ...(text ? text.split(/\r?\n/).slice(0, 12) : ["(본문 없음)"]),
        "",
        `참고첨부 ${(detail.attachments || []).length} · 제출파일 ${files.length}`
      ], theme?.accent256));
    };
    while (true) {
      if (typeof clearScreen === "function") clearScreen();
      show();
      const a = await choose(ctx, "과제 동작", [
        ["v", "상세 다시 보기", "v"],
        ["a", "참고첨부 다운로드", "a"],
        ["s", "제출파일 다운로드", "s"],
        ["u", "파일 제출 · 업로드", "u"],
        ["x", "제출파일 삭제 후 반영", "x"],
        ["n", "제출파일 이름 변경 후 반영", "n"],
        ["b", "뒤로", "b"]
      ]);
      if (!a || a === "b") return;
      if (a === "v") {
        detail = (await loadDetail(ctx, row)) || detail;
        show();
        continue;
      }
      if (a === "a") {
        await pickAndSaveFiles(ctx, detail.attachments || [], { crsCreCd: row.crsCreCd, id: row.id });
        continue;
      }
      if (a === "s") {
        const saved = await pickAndSaveFiles(ctx, detail.submittedAttachments || [], { crsCreCd: row.crsCreCd, id: row.id });
        if (saved && typeof waitEnter === "function") await waitEnter(ctx.rl, "Enter를 누르면 과제 상세 화면으로 돌아갑니다.");
        continue;
      }
      if (a === "u") {
        const fp = await pickFile(ctx.rl, { title: "제출 파일 등록", startDir: process.cwd() });
        if (!fp) continue;
        if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
          console.log(c("  파일을 찾지 못했습니다.", A.red));
          continue;
        }
        if (!(await confirm(ctx.rl, `이 과제를 제출할까요? ${path.basename(fp)}`, { affirmative: "제출", negative: "취소" }))) continue;
        const keep = (detail.submittedAttachments || []).map((f) => f.url).filter(Boolean);
        await submitAssignment(ctx, row, detail, { filePath: fp, keepFileUrls: keep });
        detail = (await loadDetail(ctx, row)) || detail;
        continue;
      }
      if (a === "x") {
        const files = detail.submittedAttachments || [];
        if (!files.length) {
          console.log(c("  지울 제출파일이 없습니다.", A.red));
          if (typeof waitEnter === "function") await waitEnter(ctx.rl, "Enter 이전 메뉴로 · Esc 이전");
          continue;
        }
        const f = await pickFromList(ctx.rl, "삭제할 제출파일", files, (x) => x.title || x.url, [
          { key: "title", head: "파일", width: 40, get: (x) => x.title || "file" }
        ]);
        if (!f?.url) continue;
        if (!(await confirm(ctx.rl, `「${f.title}」을 빼고 학교에 반영할까요?`, { affirmative: "반영", negative: "취소" }))) continue;
        const keep = files.filter((x) => x.url && x.url !== f.url).map((x) => x.url);
        await submitAssignment(ctx, row, detail, { deletedFileUrls: [f.url], keepFileUrls: keep });
        detail = (await loadDetail(ctx, row)) || detail;
        continue;
      }
      if (a === "n") {
        const files = detail.submittedAttachments || [];
        if (!files.length) {
          console.log(c("  이름을 바꿀 제출파일이 없습니다.", A.red));
          if (typeof waitEnter === "function") await waitEnter(ctx.rl, "Enter 이전 메뉴로 · Esc 이전");
          continue;
        }
        const f = await pickFromList(ctx.rl, "이름 변경", files, (x) => x.title || x.url, [
          { key: "title", head: "파일", width: 40, get: (x) => x.title || "file" }
        ]);
        if (!f?.url) continue;
        const newName = (await ask(ctx.rl, "새 파일 이름", f.title || "")).trim();
        if (!newName) continue;
        if (!(await confirm(ctx.rl, `이름을 ${newName} 으로 바꿔 제출할까요?`, { affirmative: "제출", negative: "취소" }))) continue;
        const keep = files.map((x) => x.url).filter(Boolean);
        await submitAssignment(ctx, row, detail, { keepFileUrls: keep, renamedFiles: [{ url: f.url, newName }] });
        detail = (await loadDetail(ctx, row)) || detail;
      }
    }
  }

  async function fileListActions(ctx, files, extra) {
    if (!files.length) {
      console.log(c("  다운로드할 첨부파일이 없습니다.", A.red));
      return;
    }
    await pickAndSaveFiles(ctx, files, extra);
  }

  /** 시간표 PNG 를 고른 폴더에 쓴다. SVG·HTML 은 저장하지 않는다. */
  async function saveTimetable(ctx) {
    const dest = await chooseSavePath(ctx, "timetable.png");
    if (!dest) return;
    const r = await spin("시간표.png", () =>
      ctx.api.saveTimetableFile({ savePath: dest, timeoutMs: 30000 })
    );
    if (!r.ok) return console.log(c(`  ${failLine(r)}`, A.red));
    console.log(c(`  저장 ${r.saved || dest}`, A.green));
  }

  return {
    chooseSavePath,
    saveCampus,
    pickAndSaveFiles,
    downloadLesson,
    asgActions,
    fileListActions,
    saveTimetable
  };
}
