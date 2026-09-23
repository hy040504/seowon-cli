/**
 * 한 학생의 학교 조회·제출.
 * HTTP 라우트 없이 서비스 함수를 직접 부른다.
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  attachSubmittedFilesToRows,
  downloadCampusFile as downloadCampusFileBytes,
  fetchAssignmentDetail as readAssignmentDetail,
  fetchMaterials as readMaterials,
  fetchMaterialAttachments as readMaterialAttachments,
  fetchNoticeDetail as readNoticeDetail,
  fetchNotices as readNotices,
  fetchSnapshot as readSnapshot,
  submitAssignment as sendAssignment
} from "./services/ecampus/classroom.js";
import { downloadLessonVideo as openLessonVideo, fetchProgress as readProgress } from "./services/ecampus/elearning.js";
import { ensureErp, ensureSugang as openSugang, liveLogin as openEcampus } from "./services/ecampus/login.js";
import { fetchScores as readScores } from "./services/ecampus/score.js";
import { fetchGradeOverview, fetchGradeTermDetails } from "./services/erp/grades.js";
import { applyEmptyFileAssignments, assignmentEffectivelyUnsubmitted, lessonWatchFacts, refreshAssignmentDue } from "./filters.js";
import { fetchTimetable as readTimetable } from "./services/timetable/timetable.js";
import type { EcampusClient } from "./engine/index.js";
import type { AssignmentListRow, LessonListRow, Snapshot } from "./types/snapshot.js";
import type { WebSession } from "./types/session.js";
import type { WebStudent } from "./types/student.js";
import { errorMessage, withTimeout } from "./utils.js";

export interface CallResult<T = unknown> {
  ok: boolean;
  data: T | null;
  error: string;
  ms: number;
  saved: string;
  bytes: number;
}

interface Timed {
  timeoutMs?: number;
}

export class Campus {
  timeoutMs: number;
  verbose: boolean;
  student: WebStudent | null = null;
  results: { ok: boolean; name: string; ms: number; detail: string }[] = [];
  private session: WebSession | null = null;

  constructor(opt: { timeoutMs?: number; verbose?: boolean } = {}) {
    this.timeoutMs = opt.timeoutMs ?? 90000;
    this.verbose = Boolean(opt.verbose);
  }

  loggedIn(): boolean {
    return Boolean(this.session?.client);
  }

  private async run<T>(work: () => Promise<T>, timeoutMs?: number): Promise<CallResult<T>> {
    const t0 = Date.now();
    try {
      const data = await withTimeout(work(), timeoutMs ?? this.timeoutMs, "요청");
      const saved = data && typeof data === "object" && "saved" in data ? String((data as { saved?: string }).saved || "") : "";
      const bytes = data && typeof data === "object" && "bytes" in data ? Number((data as { bytes?: number }).bytes || 0) : 0;
      const result: CallResult<T> = { ok: true, data, error: "", ms: Date.now() - t0, saved, bytes };
      if (this.verbose && data) console.log(JSON.stringify(data, null, 2).split("\n").slice(0, 40).join("\n"));
      return result;
    } catch (err) {
      return { ok: false, data: null, error: errorMessage(err), ms: Date.now() - t0, saved: "", bytes: 0 };
    }
  }

  private requireSession(): WebSession {
    if (!this.session?.client) throw new Error("로그인이 필요합니다.");
    this.session.lastSeen = Date.now();
    return this.session;
  }

  private client(sess: WebSession): EcampusClient {
    if (!sess.client) throw new Error("세션이 만료되었습니다.");
    return sess.client;
  }

  async liveLogin(input: { studentId: string; password: string } & Timed): Promise<CallResult<{ student: WebStudent }>> {
    const studentId = String(input.studentId || "").trim();
    const password = String(input.password || "");
    if (!studentId || !password) {
      return { ok: false, data: null, error: "학번과 비밀번호를 입력하세요.", ms: 0, saved: "", bytes: 0 };
    }
    const result = await this.run(async () => {
      const logged = await openEcampus(studentId, password);
      this.session = {
        id: "local",
        createdAt: Date.now(),
        lastSeen: Date.now(),
        student: logged.student,
        client: logged.client,
        courseReg: null,
        hope: null,
        erp: null,
        sugangCreds: logged.sugangCreds,
        snapshot: null,
        rawAssignments: new Map(),
        rawMaterials: new Map(),
        materials: null,
        rawNotices: new Map(),
        notices: null,
        timetable: null,
        scores: null,
        erpGrades: null,
        clientIp: "local",
        emptyFileAssignments: new Set()
      };
      this.student = logged.student;
      return { student: logged.student };
    }, input.timeoutMs);
    return result;
  }

  async logout(): Promise<CallResult<{ ok: true }>> {
    this.session = null;
    this.student = null;
    return { ok: true, data: { ok: true }, error: "", ms: 0, saved: "", bytes: 0 };
  }

  async currentStudent(): Promise<CallResult<{ loggedIn: boolean; student?: WebStudent }>> {
    if (!this.session) return { ok: true, data: { loggedIn: false }, error: "", ms: 0, saved: "", bytes: 0 };
    return { ok: true, data: { loggedIn: true, student: this.session.student }, error: "", ms: 0, saved: "", bytes: 0 };
  }

  async ensureSugang(input: Timed = {}): Promise<CallResult<{ student: WebStudent }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      await openSugang(sess);
      this.student = sess.student;
      return { student: sess.student };
    }, input.timeoutMs);
  }

  async clearCache(): Promise<CallResult<{ ok: true }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      sess.snapshot = null;
      sess.timetable = null;
      sess.scores = null;
      sess.erpGrades = null;
      sess.notices = null;
      sess.materials = null;
      sess.rawAssignments.clear();
      sess.rawNotices.clear();
      sess.rawMaterials.clear();
      return { ok: true as const };
    });
  }

  private dropSnapshot(sess: WebSession): void {
    sess.snapshot = null;
    sess.rawAssignments.clear();
  }

  private noteFile(sess: WebSession, crsCreCd: string, id: string, hasFile: boolean): void {
    if (!sess.emptyFileAssignments) sess.emptyFileAssignments = new Set();
    const key = `${crsCreCd}::${id}`;
    if (hasFile) sess.emptyFileAssignments.delete(key);
    else sess.emptyFileAssignments.add(key);
  }

  private async ensureSnapshot(sess: WebSession): Promise<Snapshot> {
    if (sess.snapshot) {
      applyEmptyFileAssignments(sess.snapshot, sess.emptyFileAssignments || []);
      return sess.snapshot;
    }
    const loaded = await readSnapshot(this.client(sess), sess.student);
    sess.snapshot = loaded.snapshot;
    sess.rawAssignments = loaded.rawAssignments;
    applyEmptyFileAssignments(sess.snapshot, sess.emptyFileAssignments || []);
    return loaded.snapshot;
  }

  async fetchSnapshot(input: { refresh?: boolean } & Timed = {}): Promise<CallResult<{ snapshot: Snapshot }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (input.refresh) this.dropSnapshot(sess);
      return { snapshot: await this.ensureSnapshot(sess) };
    }, input.timeoutMs);
  }

  async listAssignments(input: { filter?: string; category?: string; refresh?: boolean } & Timed = {}): Promise<CallResult<{ rows: AssignmentListRow[] }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const filter = input.filter || "all";
      const category = filter === "curricular" || filter === "extracurricular"
        ? filter
        : input.category === "curricular" || input.category === "extracurricular"
          ? input.category
          : "all";
      const statusFilter = filter === "curricular" || filter === "extracurricular" ? "all" : filter;
      if (input.refresh) this.dropSnapshot(sess);
      const snapshot = await this.ensureSnapshot(sess);
      let rows = this.flattenAssignments(snapshot);
      if (category !== "all") rows = rows.filter((row) => (row.category || "curricular") === category);
      try {
        await attachSubmittedFilesToRows(this.client(sess), sess.rawAssignments, rows, sess.snapshot);
      } catch {
        /* 목록은 유지 */
      }
      for (const row of rows) {
        if (row.submittedFilesLoaded !== true) continue;
        this.noteFile(sess, row.crsCreCd, row.id, Boolean(row.hasSubmittedFile));
        refreshAssignmentDue(row);
      }
      if (sess.snapshot) applyEmptyFileAssignments(sess.snapshot, sess.emptyFileAssignments || []);
      if (statusFilter === "due") rows = rows.filter((row) => Boolean(row.dueNow));
      if (statusFilter === "missing") rows = rows.filter((row) => assignmentEffectivelyUnsubmitted(row));
      if (statusFilter === "submitted") rows = rows.filter((row) => Boolean(row.hasSubmittedFile));
      return { rows };
    }, input.timeoutMs);
  }

  async fetchAssignmentDetail(input: { crsCreCd: string; id: string } & Timed): Promise<CallResult<Record<string, unknown>>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const crsCreCd = String(input.crsCreCd || "");
      const id = String(input.id || "");
      const detail = await readAssignmentDetail(this.client(sess), sess.rawAssignments.get(`${crsCreCd}::${id}`), { id, crsCreCd });
      const hasFile = (detail.submittedAttachments || []).length > 0;
      this.noteFile(sess, crsCreCd, id, hasFile);
      if (sess.snapshot) {
        for (const course of sess.snapshot.courses) {
          for (const assignment of course.assignments) {
            if (assignment.id !== id) continue;
            if ((assignment.crsCreCd || course.crsCreCd) !== crsCreCd) continue;
            assignment.submittedAttachments = detail.submittedAttachments;
            assignment.hasSubmittedFile = hasFile;
            assignment.submittedFilesLoaded = true;
            refreshAssignmentDue(assignment);
          }
        }
        applyEmptyFileAssignments(sess.snapshot, sess.emptyFileAssignments || []);
      }
      return { ...detail, hasSubmittedFile: hasFile };
    }, input.timeoutMs);
  }

  async submitAssignment(input: {
    crsCreCd: string;
    id: string;
    asmntSendCd?: string;
    filePath?: string;
    deletedFileUrls?: string[];
    keepFileUrls?: string[];
    renamedFiles?: { url: string; newName: string }[];
  } & Timed): Promise<CallResult<{ hasSubmittedFile: boolean }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const crsCreCd = input.crsCreCd || "";
      const id = input.id || "";
      let file: { filename: string; mime: string; data: Buffer } | undefined;
      if (input.filePath) {
        file = {
          filename: path.basename(input.filePath),
          mime: "application/octet-stream",
          data: fs.readFileSync(input.filePath)
        };
      }
      const result = await sendAssignment(this.client(sess), sess.rawAssignments.get(`${crsCreCd}::${id}`), {
        id,
        crsCreCd,
        asmntSendCd: input.asmntSendCd || "",
        deletedFileUrls: input.deletedFileUrls || [],
        keepFileUrls: input.keepFileUrls || [],
        renamedFiles: input.renamedFiles || [],
        file
      });
      const hasSubmittedFile = result.hasSubmittedFile !== false;
      this.noteFile(sess, crsCreCd, id, hasSubmittedFile);
      sess.snapshot = null;
      return { hasSubmittedFile };
    }, input.timeoutMs);
  }

  async fetchNotices(input: { refresh?: boolean; crsCreCd?: string } & Timed = {}): Promise<CallResult<{ rows: unknown[] }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (input.refresh) {
        sess.notices = null;
        sess.rawNotices.clear();
      }
      if (!sess.notices) {
        const loaded = await readNotices(this.client(sess));
        sess.notices = loaded.rows;
        sess.rawNotices = loaded.rawNotices;
      }
      const rows = input.crsCreCd ? sess.notices.filter((row) => row.crsCreCd === input.crsCreCd) : sess.notices;
      return { rows };
    }, input.timeoutMs);
  }

  async fetchNoticeDetail(input: { crsCreCd: string; id: string } & Timed): Promise<CallResult<Record<string, unknown>>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const detail = await readNoticeDetail(this.client(sess), sess.rawNotices.get(`${input.crsCreCd}::${input.id}`));
      return { ...detail };
    }, input.timeoutMs);
  }

  async fetchMaterials(input: { refresh?: boolean } & Timed = {}): Promise<CallResult<{ rows: unknown[] }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (input.refresh) {
        sess.materials = null;
        sess.rawMaterials.clear();
      }
      if (!sess.materials) {
        const loaded = await readMaterials(this.client(sess));
        sess.materials = loaded.rows;
        sess.rawMaterials = loaded.rawMaterials;
      }
      return { rows: sess.materials };
    }, input.timeoutMs);
  }

  async fetchMaterialAttachments(input: { crsCreCd: string; id: string } & Timed): Promise<CallResult<{ files: unknown[] }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const files = await readMaterialAttachments(this.client(sess), sess.rawMaterials.get(`${input.crsCreCd}::${input.id}`));
      return { files };
    }, input.timeoutMs);
  }

  async downloadCampusFile(input: { url: string; savePath?: string } & Timed): Promise<CallResult<{ saved?: string; bytes: number }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (!input.url) throw new Error("받을 파일이 없습니다.");
      const file = await downloadCampusFileBytes(this.client(sess), input.url);
      if (!input.savePath) return { bytes: file.data.length };
      fs.mkdirSync(path.dirname(input.savePath), { recursive: true });
      fs.writeFileSync(input.savePath, file.data);
      return { saved: input.savePath, bytes: file.data.length };
    }, input.timeoutMs);
  }

  async listLessons(input: { filter?: string; refresh?: boolean } & Timed = {}): Promise<CallResult<{ rows: LessonListRow[]; facts: ReturnType<typeof lessonWatchFacts> }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (input.refresh) this.dropSnapshot(sess);
      const snapshot = await this.ensureSnapshot(sess);
      const all = this.flattenLessons(snapshot, "all");
      const filter = input.filter || "all";
      return {
        rows: filter === "watch" ? all.filter((lesson) => lesson.needsWatch) : all,
        facts: lessonWatchFacts(all)
      };
    }, input.timeoutMs);
  }

  async fetchProgress(input: { crsCreCd: string; lessonCntsId: string } & Timed): Promise<CallResult<{ progressPercent: number; snapshot: Snapshot }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const crsCreCd = String(input.crsCreCd || "");
      const lessonCntsId = String(input.lessonCntsId || "");
      if (!crsCreCd || !lessonCntsId) throw new Error("차시 정보가 부족합니다.");
      const studentId = sess.student.studentId || sess.student.userNo || "";
      const pct = await readProgress(this.client(sess), crsCreCd, lessonCntsId, studentId);
      const snapshot = await this.ensureSnapshot(sess);
      for (const course of snapshot.courses) {
        if (course.crsCreCd !== crsCreCd) continue;
        for (const lesson of course.elearning) {
          if (lesson.lessonCntsId === lessonCntsId) lesson.progressPercent = pct;
        }
      }
      return { progressPercent: pct, snapshot };
    }, input.timeoutMs);
  }

  async downloadLessonVideo(input: {
    crsCreCd: string;
    lessonCntsId: string;
    savePath: string;
  } & Timed): Promise<CallResult<{ saved: string; bytes: number }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (!input.crsCreCd || !input.lessonCntsId) throw new Error("차시 정보가 부족합니다.");
      if (!input.savePath) throw new Error("저장 경로가 없습니다.");
      const video = await openLessonVideo(this.client(sess), input.crsCreCd, input.lessonCntsId);
      fs.mkdirSync(path.dirname(input.savePath), { recursive: true });
      try {
        await pipeline(video.stream, fs.createWriteStream(input.savePath));
      } catch (err) {
        video.stream.destroy();
        throw err;
      }
      return { saved: input.savePath, bytes: fs.statSync(input.savePath).size };
    }, input.timeoutMs);
  }

  async fetchTimetable(input: { refresh?: boolean } & Timed = {}): Promise<CallResult<{ timetable: WebSession["timetable"] }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (input.refresh) sess.timetable = null;
      if (!sess.timetable) sess.timetable = await readTimetable(sess);
      return { timetable: sess.timetable };
    }, input.timeoutMs);
  }

  async saveTimetableFile(input: { kind: "svg" | "html"; savePath: string } & Timed): Promise<CallResult<{ saved: string; bytes: number }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (!sess.timetable) sess.timetable = await readTimetable(sess);
      const text = input.kind === "svg" ? sess.timetable?.svg || "" : sess.timetable?.html || "";
      if (!text) throw new Error("시간표 그림을 만들지 못했습니다.");
      fs.mkdirSync(path.dirname(input.savePath), { recursive: true });
      fs.writeFileSync(input.savePath, text);
      return { saved: input.savePath, bytes: Buffer.byteLength(text) };
    }, input.timeoutMs);
  }

  async fetchScores(input: { refresh?: boolean } & Timed = {}): Promise<CallResult<{ scores: WebSession["scores"] }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (input.refresh) sess.scores = null;
      if (!sess.scores) sess.scores = await readScores(this.client(sess));
      return { scores: sess.scores };
    }, input.timeoutMs);
  }

  async fetchErpGrades(input: { refresh?: boolean; syy?: string; smtCd?: string } & Timed = {}): Promise<CallResult<{ grades: WebSession["erpGrades"]; term?: unknown }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const syy = String(input.syy || "").trim();
      const smtCd = String(input.smtCd || "").trim();
      if (input.refresh) sess.erpGrades = null;
      const erp = await ensureErp(sess);
      if (!sess.erpGrades) sess.erpGrades = await fetchGradeOverview(erp);
      if (syy && smtCd) {
        const cached = sess.erpGrades.terms.find((term) => term.syy === syy && term.smtCd === smtCd);
        if (input.refresh || !cached?.subjectsLoaded) {
          sess.erpGrades = await fetchGradeTermDetails(erp, { syy, smtCd }, sess.erpGrades);
        }
        const term = sess.erpGrades.terms.find((item) => item.syy === syy && item.smtCd === smtCd) || null;
        return { grades: sess.erpGrades, term };
      }
      return { grades: sess.erpGrades };
    }, input.timeoutMs);
  }

  private flattenAssignments(snapshot: Snapshot): AssignmentListRow[] {
    const rows: AssignmentListRow[] = [];
    for (const course of snapshot.courses) {
      const category = course.category === "extracurricular" || String(course.label || "").includes("비교과")
        ? "extracurricular"
        : "curricular";
      for (const assignment of course.assignments) {
        rows.push({
          ...assignment,
          crsCreCd: assignment.crsCreCd || course.crsCreCd,
          courseTitle: course.courseTitle,
          category
        });
      }
    }
    return rows.sort((a, b) => {
      if (Boolean(a.dueNow) !== Boolean(b.dueNow)) return a.dueNow ? -1 : 1;
      return String(b.period || "").localeCompare(String(a.period || ""));
    });
  }

  private flattenLessons(snapshot: Snapshot, filter: string): LessonListRow[] {
    const rows: LessonListRow[] = [];
    for (const course of snapshot.courses) {
      for (const lesson of course.elearning) {
        if (filter === "watch" && !lesson.needsWatch) continue;
        const playUrl =
          `https://ecampus.seowon.ac.kr/lesson/lessonOpen/lessonNewWindow?crsCreCd=${encodeURIComponent(lesson.crsCreCd)}` +
          `&lessonCntsId=${encodeURIComponent(lesson.lessonCntsId || "")}`;
        rows.push({ ...lesson, courseTitle: course.courseTitle, playUrl });
      }
    }
    return rows;
  }
}
