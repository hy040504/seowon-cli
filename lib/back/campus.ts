/**
 * 한 학생의 학교 조회·제출.
 * HTTP 라우트 없이 서비스 함수를 직접 부른다.
 */
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { inspect } from "node:util";
import {
  attachSubmittedFilesToRows,
  downloadCampusFile as downloadCampusFileBytes,
  fetchAssignmentDetail as readAssignmentDetail,
  fetchMaterials as readMaterials,
  fetchMaterialAttachments as readMaterialAttachments,
  fetchNoticeDetail as readNoticeDetail,
  fetchNotices as readNotices,
  fetchAcademicOverview as readAcademicOverview,
  submitAssignment as sendAssignment
} from "./services/ecampus/classroom.js";
import { downloadLessonVideo as openLessonVideo, fetchProgress as readProgress } from "./services/ecampus/elearning.js";
import { ensureErp, ensureSugang as openSugang, liveLogin as openEcampus } from "./services/ecampus/login.js";
import { fetchScores as readScores } from "./services/ecampus/score.js";
import { fetchGradeOverview, fetchGradeTermDetails } from "./services/erp/grades.js";
import { applyEmptyFileAssignments, assignmentEffectivelyUnsubmitted, lessonWatchFacts, refreshAssignmentDue } from "./filters.js";
import { fetchTimetable as readTimetable, renderTimetablePng } from "./services/timetable/timetable.js";
import type { EcampusClient } from "./engine/index.js";
import type { AssignmentListRow, LessonListRow, AcademicOverview } from "./types/academic-overview.js";
import type { WebSession } from "./types/session.js";
import type { WebStudent } from "./types/student.js";
import { errorMessage, UserFacingError, withTimeout } from "./utils.js";
import { readUploadFile, safeDownloadName, savePrivateStream, writePrivateFile } from "./files/private-files.js";

/** 서비스 호출의 성공 여부·결과·소요 시간·파일 저장 정보를 담는 공통 응답. */
export interface CallResult<T = unknown> {
  /** 작업이 오류 없이 끝났는지 여부 */
  ok: boolean;
  /** 성공 시 작업 결과. 실패하면 null */
  data: T | null;
  /** 실패 원인. 성공하면 빈 문자열 */
  error: string;
  /** 호출 시작부터 응답까지 걸린 밀리초 */
  ms: number;
  /** 저장한 파일 경로. 저장하지 않았으면 빈 문자열 */
  saved: string;
  /** 다운로드하거나 저장한 파일의 바이트 수 */
  bytes: number;
}

/** 호출별로 Campus의 기본 시간 제한을 덮어쓰는 옵션. */
interface Timed {
  /** 응답 대기 제한 밀리초. 생략하면 Campus.timeoutMs 사용 */
  timeoutMs?: number;
}

/**
 * 한 학생의 로그인 세션과 조회 캐시를 관리하는 CLI 진입점.
 * 서비스 결과와 오류를 CallResult로 통일하고, 파일 저장은 로컬에서 수행한다.
 */
export class Campus {
  /** 호출별 제한을 지정하지 않았을 때 사용하는 대기 시간(ms) */
  timeoutMs: number;
  /** 결과 데이터 없이 성공 여부·소요 시간·바이트 수만 출력할지 여부 */
  verbose: boolean;
  /** 로그인·수강 시스템 조회로 갱신한 학생 요약 */
  student: WebStudent | null = null;
  /** TUI의 bindApi가 기록하는 호출 성공 여부와 소요 시간 */
  results: { ok: boolean; name: string; ms: number; detail: string }[] = [];
  /** 인증 클라이언트와 과제·공지·성적 등의 캐시를 담는 메모리 세션 */
  #session: WebSession | null = null;
  #loginEpoch = 0;
  #controllers = new Set<AbortController>();

  /** 메모리에서 보유한 자격·쿠키·조회 캐시를 비우고 진행 중인 로컬 저장을 중단한다. */
  #clearSession(): void {
    for (const controller of this.#controllers) controller.abort();
    const session = this.#session;
    this.#session = null;
    this.student = null;
    if (!session) return;
    if (session.sugangCreds) session.sugangCreds.password = "";
    session.sugangCreds = null;
    session.client?.setCredentials({ userId: "", password: "" });
    session.courseReg?.setCredentials({ stuno: "", password: "" });
    session.hope?.setCredentials({ stuno: "", password: "" });
    session.erp?.setCredentials({ uid: "", password: "" });
    for (const client of [session.client, session.courseReg, session.hope, session.erp]) client?.cookieJar.removeAllCookiesSync();
    session.client = null;
    session.courseReg = null;
    session.hope = null;
    session.erp = null;
    session.rawAssignments.clear();
    session.rawMaterials.clear();
    session.rawNotices.clear();
    session.academicOverview = null;
    session.materials = null;
    session.notices = null;
    session.timetable = null;
    session.scores = null;
    session.erpGrades = null;
    session.emptyFileAssignments.clear();
  }

  /** console/JSON 디버깅에 학생 프로필·비밀번호·쿠키·조회 캐시를 내보내지 않는다. */
  toJSON(): { type: string; loggedIn: boolean } {
    return { type: "Campus", loggedIn: this.loggedIn() };
  }

  [inspect.custom](): ReturnType<Campus["toJSON"]> {
    return this.toJSON();
  }

  /**
   * 기본 시간 제한과 결과 출력 옵션을 설정한다.
   * @param opt - timeoutMs는 기본 90초, verbose는 기본 false
   */
  constructor(opt: { timeoutMs?: number; verbose?: boolean } = {}) {
    this.timeoutMs = opt.timeoutMs ?? 90000;
    this.verbose = Boolean(opt.verbose);
  }

  /**
   * 메모리에 e-campus 클라이언트가 있는지 확인한다. 서버 세션은 조회하지 않는다.
   * @returns 클라이언트가 있으면 true
   */
  loggedIn(): boolean {
    return Boolean(this.#session?.client);
  }

  /**
   * 작업에 시간 제한을 걸고 결과·오류·파일 정보를 공통 응답으로 감싼다.
   * 시간 초과·로그아웃은 늦은 결과 반영과 로컬 저장을 중단한다. 이미 학교에서 접수한 제출은 되돌리지 않는다.
   * @param work - 실행할 비동기 작업
   * @param timeoutMs - 호출별 대기 제한 밀리초
   * @returns 성공 데이터 또는 오류 메시지와 소요 시간
   */
  private async run<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs?: number): Promise<CallResult<T>> {
    const t0 = Date.now();
    const controller = new AbortController();
    this.#controllers.add(controller);
    try {
      const data = await withTimeout(work(controller.signal), timeoutMs ?? this.timeoutMs, "요청");
      controller.signal.throwIfAborted();
      const saved = data && typeof data === "object" && "saved" in data ? String((data as { saved?: string }).saved || "") : "";
      const bytes = data && typeof data === "object" && "bytes" in data ? Number((data as { bytes?: number }).bytes || 0) : 0;
      const result: CallResult<T> = { ok: true, data, error: "", ms: Date.now() - t0, saved, bytes };
      if (this.verbose) console.log(JSON.stringify({ ok: true, ms: result.ms, bytes }));
      return result;
    } catch (err) {
      return { ok: false, data: null, error: errorMessage(err), ms: Date.now() - t0, saved: "", bytes: 0 };
    } finally {
      // 학교에서 이미 접수한 제출을 되돌리지는 못한다. 로컬 저장·늦은 로그인 반영은 중단한다.
      controller.abort();
      this.#controllers.delete(controller);
    }
  }

  /**
   * 로그인 세션을 확인하고 마지막 접근 시각을 갱신한다.
   * @returns 현재 메모리 세션
   * @throws 로그인 클라이언트가 없으면 오류
   */
  private requireSession(): WebSession {
    if (!this.#session?.client) throw new UserFacingError("로그인이 필요합니다.");
    this.#session.lastSeen = Date.now();
    return this.#session;
  }

  /**
   * 세션에서 e-campus 클라이언트를 꺼낸다.
   * @param sess - 현재 학생 세션
   * @returns 인증 요청에 사용할 클라이언트
   * @throws 클라이언트가 없으면 세션 만료 오류
   */
  private client(sess: WebSession): EcampusClient {
    if (!sess.client) throw new UserFacingError("세션이 만료되었습니다.");
    return sess.client;
  }

  /**
   * 학번·비밀번호로 로그인하고 학생 정보와 빈 조회 캐시를 가진 세션을 만든다.
   * @param input - 로그인 자격과 호출별 시간 제한
   * @returns 로그인한 학생 정보 또는 입력·인증 오류
   */
  async liveLogin(input: { studentId: string; password: string } & Timed): Promise<CallResult<{ student: WebStudent }>> {
    const studentId = String(input.studentId || "").trim();
    const password = String(input.password || "");
    if (!studentId || !password) {
      return { ok: false, data: null, error: "학번과 비밀번호를 입력하세요.", ms: 0, saved: "", bytes: 0 };
    }
    const epoch = ++this.#loginEpoch;
    this.#clearSession();
    const result = await this.run(async (signal) => {
      const logged = await openEcampus(studentId, password);
      if (signal.aborted || epoch !== this.#loginEpoch) {
        logged.sugangCreds.password = "";
        logged.client.setCredentials({ userId: "", password: "" });
        logged.client.cookieJar.removeAllCookiesSync();
      }
      signal.throwIfAborted();
      if (epoch !== this.#loginEpoch) throw new UserFacingError("로그인이 취소되었습니다.");
      this.#session = {
        id: "local",
        createdAt: Date.now(),
        lastSeen: Date.now(),
        student: logged.student,
        client: logged.client,
        courseReg: null,
        hope: null,
        erp: null,
        sugangCreds: logged.sugangCreds,
        academicOverview: null,
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

  /**
   * 로컬 세션과 학생 정보를 비운다. 학교 서버에 로그아웃 요청은 보내지 않는다.
   * @returns 세션 제거 성공 응답
   */
  async logout(): Promise<CallResult<{ ok: true }>> {
    this.#loginEpoch++;
    this.#clearSession();
    return { ok: true, data: { ok: true }, error: "", ms: 0, saved: "", bytes: 0 };
  }

  /**
   * 서버 요청 없이 메모리의 로그인 여부와 학생 정보를 읽는다.
   * @returns 로그인 여부와, 세션이 있으면 학생 정보
   */
  async currentStudent(): Promise<CallResult<{ loggedIn: boolean; student?: WebStudent }>> {
    if (!this.#session) return { ok: true, data: { loggedIn: false }, error: "", ms: 0, saved: "", bytes: 0 };
    return { ok: true, data: { loggedIn: true, student: this.#session.student }, error: "", ms: 0, saved: "", bytes: 0 };
  }

  /**
   * 수강 시스템 클라이언트를 준비하고 학생 이름·학과 등 프로필을 보완한다.
   * @param input - 호출별 시간 제한
   * @returns 수강 시스템 조회를 반영한 학생 정보
   */
  async ensureSugang(input: Timed = {}): Promise<CallResult<{ student: WebStudent }>> {
    return this.run(async (signal) => {
      const sess = this.requireSession();
      await openSugang(sess);
      signal.throwIfAborted();
      if (this.#session !== sess) throw new UserFacingError("로그인이 취소되었습니다.");
      this.student = sess.student;
      return { student: sess.student };
    }, input.timeoutMs);
  }

  /**
   * 인증 세션을 유지하면서 현황·목록·성적·시간표 캐시와 상세 조회용 원본을 비운다.
   * 제출 파일을 비운 과제의 판별 기록은 유지한다.
   * @returns 캐시 초기화 결과
   */
  async clearCache(): Promise<CallResult<{ ok: true }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      sess.academicOverview = null;
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

  /**
   * 과목 현황과 과제 원본을 비워 다음 현황 조회가 서버에서 다시 읽게 한다.
   * @param sess - 초기화할 학생 세션
   */
  private dropAcademicOverview(sess: WebSession): void {
    sess.academicOverview = null;
    sess.rawAssignments.clear();
  }

  /**
   * 제출 파일이 없는 과제 키를 기록하고, 파일이 생기면 기록에서 제거한다.
   * @param sess - 판별 기록을 보관할 세션
   * @param crsCreCd - 과목 강의실 코드
   * @param id - 과제 식별자
   * @param hasFile - 실제 제출 파일이 있는지 여부
   */
  private noteFile(sess: WebSession, crsCreCd: string, id: string, hasFile: boolean): void {
    if (!sess.emptyFileAssignments) sess.emptyFileAssignments = new Set();
    const key = `${crsCreCd}::${id}`;
    if (hasFile) sess.emptyFileAssignments.delete(key);
    else sess.emptyFileAssignments.add(key);
  }

  /**
   * 과목 현황 캐시를 사용하거나 서버에서 조회하고 제출 파일이 없는 과제를 반영한다.
   * @param sess - 현황과 과제 원본을 저장할 세션
   * @returns 파일 유무 판별을 반영한 과목 현황
   */
  private async ensureAcademicOverview(sess: WebSession): Promise<AcademicOverview> {
    if (sess.academicOverview) {
      applyEmptyFileAssignments(sess.academicOverview, sess.emptyFileAssignments || []);
      return sess.academicOverview;
    }
    const loaded = await readAcademicOverview(this.client(sess), sess.student);
    sess.academicOverview = loaded.academicOverview;
    sess.rawAssignments = loaded.rawAssignments;
    applyEmptyFileAssignments(sess.academicOverview, sess.emptyFileAssignments || []);
    return loaded.academicOverview;
  }

  /**
   * 과목별 과제·이러닝과 할 일 집계를 조회한다.
   * @param input - refresh가 true면 캐시를 비운 뒤 조회, 호출별 시간 제한
   * @returns 학생의 과목 현황
   */
  async fetchAcademicOverview(input: { refresh?: boolean } & Timed = {}): Promise<CallResult<{ academicOverview: AcademicOverview }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (input.refresh) this.dropAcademicOverview(sess);
      return { academicOverview: await this.ensureAcademicOverview(sess) };
    }, input.timeoutMs);
  }

  /**
   * 과제를 목록으로 펼치고 실제 제출 파일을 확인한 뒤 분류·제출 상태로 거른다.
   * 파일 조회에 실패하면 기존 목록을 유지하며, 지금 할 과제를 먼저 정렬한다.
   * @param input - filter(all/due/missing/submitted/curricular/extracurricular), category, 새로고침 여부와 시간 제한
   * @returns 필터를 통과한 과제 행
   */
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
      if (input.refresh) this.dropAcademicOverview(sess);
      const academicOverview = await this.ensureAcademicOverview(sess);
      let rows = this.flattenAssignments(academicOverview);
      if (category !== "all") rows = rows.filter((row) => (row.category || "curricular") === category);
      try {
        await attachSubmittedFilesToRows(this.client(sess), sess.rawAssignments, rows, sess.academicOverview);
      } catch {
        /* 목록은 유지 */
      }
      for (const row of rows) {
        if (row.submittedFilesLoaded !== true) continue;
        this.noteFile(sess, row.crsCreCd, row.id, Boolean(row.hasSubmittedFile));
        refreshAssignmentDue(row);
      }
      if (sess.academicOverview) applyEmptyFileAssignments(sess.academicOverview, sess.emptyFileAssignments || []);
      if (statusFilter === "due") rows = rows.filter((row) => Boolean(row.dueNow));
      if (statusFilter === "missing") rows = rows.filter((row) => assignmentEffectivelyUnsubmitted(row));
      if (statusFilter === "submitted") rows = rows.filter((row) => Boolean(row.hasSubmittedFile));
      return { rows };
    }, input.timeoutMs);
  }

  /**
   * 과제 본문·첨부·제출 파일을 읽고 현황 캐시의 파일 유무와 할 일 상태를 갱신한다.
   * @param input - 강의실 코드, 과제 식별자와 시간 제한
   * @returns 상세 정보와 실제 제출 파일 존재 여부
   */
  async fetchAssignmentDetail(input: { crsCreCd: string; id: string } & Timed): Promise<CallResult<Record<string, unknown>>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const crsCreCd = String(input.crsCreCd || "");
      const id = String(input.id || "");
      const detail = await readAssignmentDetail(this.client(sess), sess.rawAssignments.get(`${crsCreCd}::${id}`), { id, crsCreCd });
      const hasFile = (detail.submittedAttachments || []).length > 0;
      this.noteFile(sess, crsCreCd, id, hasFile);
      if (sess.academicOverview) {
        for (const course of sess.academicOverview.courses) {
          for (const assignment of course.assignments) {
            if (assignment.id !== id) continue;
            if ((assignment.crsCreCd || course.crsCreCd) !== crsCreCd) continue;
            assignment.submittedAttachments = detail.submittedAttachments;
            assignment.hasSubmittedFile = hasFile;
            assignment.submittedFilesLoaded = true;
            refreshAssignmentDue(assignment);
          }
        }
        applyEmptyFileAssignments(sess.academicOverview, sess.emptyFileAssignments || []);
      }
      return { ...detail, hasSubmittedFile: hasFile };
    }, input.timeoutMs);
  }

  /**
   * 로컬 파일 업로드와 기존 제출 파일의 유지·삭제·이름 변경을 학교에 반영한다.
   * 성공하면 제출 파일 판별 기록을 갱신하고 과목 현황 캐시를 비운다.
   * @param input - 과제 식별자, 제출 코드, 업로드 경로와 기존 파일 변경 목록, 시간 제한
   * @returns 반영 후 제출 파일이 남아 있는지 여부
   */
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
          filename: safeDownloadName(path.basename(input.filePath)),
          mime: "application/octet-stream",
          data: await readUploadFile(input.filePath)
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
      sess.academicOverview = null;
      return { hasSubmittedFile };
    }, input.timeoutMs);
  }

  /**
   * 과목 공지 목록과 상세 조회용 원본을 캐시하고 필요하면 특정 과목만 반환한다.
   * @param input - 새로고침 여부, 선택할 강의실 코드와 시간 제한
   * @returns 전체 또는 선택한 과목의 공지 행
   */
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

  /**
   * 공지 목록에 저장된 원본 항목으로 상세 본문과 첨부를 조회한다.
   * @param input - 강의실 코드, 공지 식별자와 시간 제한
   * @returns 공지 상세 정보
   */
  async fetchNoticeDetail(input: { crsCreCd: string; id: string } & Timed): Promise<CallResult<Record<string, unknown>>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const detail = await readNoticeDetail(this.client(sess), sess.rawNotices.get(`${input.crsCreCd}::${input.id}`));
      return { ...detail };
    }, input.timeoutMs);
  }

  /**
   * 강의자료실 목록을 조회하고 첨부 조회용 원본과 함께 캐시한다.
   * @param input - 새로고침 여부와 시간 제한
   * @returns 강의자료 행
   */
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

  /**
   * 자료 목록에 저장된 원본 항목에서 다운로드할 첨부 파일을 읽는다.
   * @param input - 강의실 코드, 자료 식별자와 시간 제한
   * @returns 자료의 첨부 파일 목록
   */
  async fetchMaterialAttachments(input: { crsCreCd: string; id: string } & Timed): Promise<CallResult<{ files: unknown[] }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const files = await readMaterialAttachments(this.client(sess), sess.rawMaterials.get(`${input.crsCreCd}::${input.id}`));
      return { files };
    }, input.timeoutMs);
  }

  /**
   * 학교 첨부 파일을 받고 저장 경로가 있으면 상위 폴더를 만든 뒤 파일로 쓴다.
   * @param input - 파일 URL, 선택적 저장 경로·진행 콜백과 시간 제한
   * @returns 받은 바이트 수와, 파일로 저장했으면 저장 경로
   */
  async downloadCampusFile(input: {
    url: string;
    savePath?: string;
    onProgress?: (loaded: number, total: number) => void;
  } & Timed): Promise<CallResult<{ saved?: string; bytes: number }>> {
    return this.run(async (signal) => {
      const sess = this.requireSession();
      if (!input.url) throw new UserFacingError("받을 파일이 없습니다.");
      const file = await downloadCampusFileBytes(this.client(sess), input.url, input.onProgress);
      signal.throwIfAborted();
      if (!input.savePath) return { bytes: file.data.length };
      await writePrivateFile(input.savePath, file.data, signal);
      input.onProgress?.(file.data.length, file.data.length);
      return { saved: input.savePath, bytes: file.data.length };
    }, input.timeoutMs);
  }

  /**
   * 이러닝 차시 목록과 전체 차시의 미학습·기간 집계를 반환한다.
   * @param input - filter가 watch면 지금 들을 차시만 선택, 새로고침 여부와 시간 제한
   * @returns 선택한 차시와 필터 적용 전 전체 차시의 집계
   */
  async listLessons(input: { filter?: string; refresh?: boolean } & Timed = {}): Promise<CallResult<{ rows: LessonListRow[]; facts: ReturnType<typeof lessonWatchFacts> }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (input.refresh) this.dropAcademicOverview(sess);
      const academicOverview = await this.ensureAcademicOverview(sess);
      const all = this.flattenLessons(academicOverview, "all");
      const filter = input.filter || "all";
      return {
        rows: filter === "watch" ? all.filter((lesson) => lesson.needsWatch) : all,
        facts: lessonWatchFacts(all)
      };
    }, input.timeoutMs);
  }

  /**
   * 목록에 학습률이 있으면 사용하고, 없으면 학습 이력을 조회해 현황에 반영한다.
   * 0%도 유효한 값으로 사용하며 시청 기록은 전송하지 않는다.
   * @param input - 강의실 코드, 차시 콘텐츠 식별자와 시간 제한
   * @returns 차시 학습률과 갱신한 과목 현황
   */
  async fetchProgress(input: { crsCreCd: string; lessonCntsId: string } & Timed): Promise<CallResult<{ progressPercent: number; academicOverview: AcademicOverview }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      const crsCreCd = String(input.crsCreCd || "");
      const lessonCntsId = String(input.lessonCntsId || "");
      if (!crsCreCd || !lessonCntsId) throw new UserFacingError("차시 정보가 부족합니다.");
      const studentId = sess.student.studentId || sess.student.userNo || "";
      const academicOverview = await this.ensureAcademicOverview(sess);
      const lessonRow = academicOverview.courses
        .find((course) => course.crsCreCd === crsCreCd)
        ?.elearning.find((lesson) => lesson.lessonCntsId === lessonCntsId);
      const listed = lessonRow?.progressPercent;
      const pct = listed != null
        ? listed
        : await readProgress(this.client(sess), crsCreCd, lessonCntsId, studentId, lessonRow?.durationSeconds);
      for (const course of academicOverview.courses) {
        if (course.crsCreCd !== crsCreCd) continue;
        for (const lesson of course.elearning) {
          if (lesson.lessonCntsId === lessonCntsId) lesson.progressPercent = pct;
        }
      }
      return { progressPercent: pct, academicOverview };
    }, input.timeoutMs);
  }

  /**
   * 차시 영상 스트림을 파일로 저장하면서 받은 바이트 수를 알린다.
   * 스트림 저장에 실패하면 입력 스트림을 종료하고 오류를 공통 응답으로 반환한다.
   * @param input - 강의실·차시 식별자, 저장 경로·진행 콜백과 시간 제한
   * @returns 저장 경로와 파일 바이트 수
   */
  async downloadLessonVideo(input: {
    crsCreCd: string;
    lessonCntsId: string;
    savePath: string;
    onProgress?: (loaded: number, total: number) => void;
  } & Timed): Promise<CallResult<{ saved: string; bytes: number }>> {
    return this.run(async (signal) => {
      const sess = this.requireSession();
      if (!input.crsCreCd || !input.lessonCntsId) throw new UserFacingError("차시 정보가 부족합니다.");
      if (!input.savePath) throw new UserFacingError("저장 경로가 없습니다.");
      const video = await openLessonVideo(this.client(sess), input.crsCreCd, input.lessonCntsId);
      const total = Number(video.contentLength) || 0;
      let loaded = 0;
      const counter = new Transform({
        /**
         * 받은 청크의 크기를 누적해 진행률을 알리고 원본 바이트를 저장 스트림으로 넘긴다.
         * @param chunk - 영상 데이터 청크
         * @param _enc - 스트림 인코딩 인자
         * @param cb - 변환 결과를 다음 스트림으로 전달할 콜백
         */
        transform(chunk, _enc, cb) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          loaded += buf.length;
          if (loaded > 800 * 1024 * 1024) {
            cb(new UserFacingError("영상은 800 MiB 이하여야 합니다."));
            return;
          }
          try { input.onProgress?.(loaded, total); } catch (error) { cb(error instanceof Error ? error : new Error("진행률 표시 오류")); return; }
          cb(null, buf);
        }
      });
      const forwardError = (error: Error) => counter.destroy(error);
      video.stream.on("error", forwardError);
      try {
        await savePrivateStream(video.stream.pipe(counter), input.savePath, signal);
      } catch (err) {
        video.stream.destroy();
        throw err;
      } finally {
        video.stream.off("error", forwardError);
      }
      input.onProgress?.(loaded, total || loaded);
      return { saved: input.savePath, bytes: loaded || fs.statSync(input.savePath).size };
    }, input.timeoutMs);
  }

  /**
   * 확정 수강 시간표를 캐시에서 읽거나 수강 시스템에서 조회한다.
   * @param input - 새로고침 여부와 시간 제한
   * @returns 시간표 데이터와 표시용 SVG
   */
  async fetchTimetable(input: { refresh?: boolean } & Timed = {}): Promise<CallResult<{ timetable: WebSession["timetable"] }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (input.refresh) sess.timetable = null;
      if (!sess.timetable) sess.timetable = await readTimetable(sess);
      return { timetable: sess.timetable };
    }, input.timeoutMs);
  }

  /**
   * 캐시 또는 서버에서 시간표를 준비하고 SVG를 PNG로 변환해 로컬에 저장한다.
   * @param input - 저장 경로, 완료 시 진행 콜백과 시간 제한
   * @returns PNG 저장 경로와 바이트 수
   */
  async saveTimetableFile(input: {
    savePath: string;
    onProgress?: (loaded: number, total: number) => void;
  } & Timed): Promise<CallResult<{ saved: string; bytes: number }>> {
    return this.run(async (signal) => {
      const sess = this.requireSession();
      if (!input.savePath) throw new UserFacingError("저장 경로가 없습니다.");
      if (!sess.timetable) sess.timetable = await readTimetable(sess);
      const png = renderTimetablePng(sess.timetable?.svg || "");
      await writePrivateFile(input.savePath, png, signal);
      input.onProgress?.(png.length, png.length);
      return { saved: input.savePath, bytes: png.length };
    }, input.timeoutMs);
  }

  /**
   * 이번 학기의 e-campus 성적을 캐시에서 읽거나 서버에서 조회한다.
   * @param input - 새로고침 여부와 시간 제한
   * @returns 과목별 현재 성적
   */
  async fetchScores(input: { refresh?: boolean } & Timed = {}): Promise<CallResult<{ scores: WebSession["scores"] }>> {
    return this.run(async () => {
      const sess = this.requireSession();
      if (input.refresh) sess.scores = null;
      if (!sess.scores) sess.scores = await readScores(this.client(sess));
      return { scores: sess.scores };
    }, input.timeoutMs);
  }

  /**
   * ERP 인증을 준비해 전체 학기 성적을 읽고, 지정한 학기의 과목 상세를 추가 조회한다.
   * 상세를 이미 읽은 학기는 캐시를 사용하며 refresh면 다시 조회한다.
   * @param input - 새로고침 여부, 학년도 syy·학기 코드 smtCd와 시간 제한
   * @returns 전체 성적과, 학년도를 포함한 학기 지정 시 해당 학기 상세
   */
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

  /**
   * 과목별 과제에 과목명·분류를 붙여 펼치고 할 일 우선, 기간 문자열 내림차순으로 정렬한다.
   * @param academicOverview - 과목별 과제 현황
   * @returns CLI 과제 목록에 사용할 행
   */
  private flattenAssignments(academicOverview: AcademicOverview): AssignmentListRow[] {
    const rows: AssignmentListRow[] = [];
    for (const course of academicOverview.courses) {
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

  /**
   * 과목별 차시에 과목명과 브라우저 재생 URL을 붙여 목록으로 펼친다.
   * @param academicOverview - 과목별 차시 현황
   * @param filter - watch면 needsWatch가 true인 차시만 포함
   * @returns CLI 이러닝 목록에 사용할 행
   */
  private flattenLessons(academicOverview: AcademicOverview, filter: string): LessonListRow[] {
    const rows: LessonListRow[] = [];
    for (const course of academicOverview.courses) {
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
