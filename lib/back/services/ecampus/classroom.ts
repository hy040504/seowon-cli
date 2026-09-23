/**
 * 강의실 과제·공지·자료 조회와 과제 제출.
 *
 * 목록·첨부는 내장 engine 클라이언트를 쓰고,
 * 상세 HTML 재전송·제출 폼만 웹에서 감싼다.
 */
import {
  parseEcampusClassroomAttachmentsHtml,
  type EcampusClassroomItem,
  type EcampusClient
} from "../../engine/index.js";
import {
  assignmentDetailText,
  buildSummary,
  markAssignment,
  markLesson,
  noticeDetailText,
  refreshAssignmentDue,
  semesterFromCode
} from "../../filters.js";
import { FETCH_LIMIT, LIST_SCALE } from "../../constants.js";
import type {
  AssignmentDetail,
  AssignmentSubmitPayload,
  AttachmentRow,
  MaterialRow,
  NoticeDetail,
  NoticeRow
} from "../../types/classroom.js";
import type { AssignmentListRow, Snapshot, SnapshotCourse } from "../../types/snapshot.js";
import type { WebStudent } from "../../types/student.js";
import { mapLimit } from "../../utils.js";

/**
 * 목록 raw 가 없으면 과제 식별자로 상세 요청 항목을 만든다.
 * @param raw - 목록 원본
 * @param ids - 과제 식별자
 * @param baseUrl - e-campus 기본 URL
 */
function assignmentItem(
  raw: EcampusClassroomItem | undefined,
  ids: { id?: string; crsCreCd?: string },
  baseUrl: string
): EcampusClassroomItem {
  if (raw?.request?.url) return raw;
  const id = ids.id || raw?.id || "";
  const crsCreCd = ids.crsCreCd || raw?.request?.body?.crsCreCd || "";
  if (!id || !crsCreCd) throw new Error("과제 상세를 열 정보가 없습니다.");
  const url = new URL("/asmnt/asmntLect/Form/asmntStuMain", baseUrl).toString();
  return {
    id,
    title: raw?.title || "",
    url,
    request: {
      method: "POST",
      url,
      body: { ...(raw?.request?.body || {}), asmntCd: id, crsCreCd }
    }
  };
}

/**
 * 전 과목 과제·이러닝을 모아 스냅샷을 만든다.
 * @param client - e-campus 클라이언트
 * @param student - 학번·userNo 가 있는 학생 정보
 * @returns 스냅샷과 제출용 원본 맵
 */
export async function fetchSnapshot(
  client: EcampusClient,
  student: WebStudent
): Promise<{ snapshot: Snapshot; rawAssignments: Map<string, EcampusClassroomItem> }> {
  const now = new Date();
  const list = await client.getCourseList();
  const courses = await mapLimit(list, FETCH_LIMIT, async (c) => {
    let assignments: EcampusClassroomItem[] = [];
    let lessons: Array<{
      lessonCntsId?: string;
      scheduleTitle?: string;
      title?: string;
      period?: string;
      attendanceStatus?: string;
    }> = [];
    try {
      assignments = await client.getAssignmentList({
        crsCreCd: c.crsCreCd,
        userNo: student.userNo,
        userName: student.studentName || "",
        listScale: LIST_SCALE
      });
    } catch {
      assignments = [];
    }
    try {
      lessons = await client.getElearningLessonList({ crsCreCd: c.crsCreCd });
    } catch {
      lessons = [];
    }
    const course: SnapshotCourse & { _rawAssignments: EcampusClassroomItem[] } = {
      courseTitle: c.title || (c as any).courseTitle || "",
      crsCreCd: c.crsCreCd,
      category: c.crsTypeCd === "CO" ? "extracurricular" : "curricular",
      label: c.label || "",
      professor: String(c.professor || "").trim(),
      assignments: assignments.map((a) =>
        markAssignment(
          {
            id: a.id,
            title: a.title || "",
            period: a.period || "",
            status: a.status || "",
            crsCreCd: c.crsCreCd,
            hasAttachment: Boolean(a.hasAttachment)
          },
          now
        )
      ),
      elearning: lessons.map((l) =>
        markLesson(
          {
            id: String(l.lessonCntsId || ""),
            week: l.scheduleTitle || "",
            title: l.title || "",
            period: l.period || "",
            attendanceStatus: String(l.attendanceStatus || "")
              .replace(/강의보기/g, "")
              .replace(/\s*[xX×]\s*$/g, "")
              .replace(/\s{2,}/g, " ")
              .trim(),
            progressPercent: null,
            lessonCntsId: String(l.lessonCntsId || ""),
            crsCreCd: c.crsCreCd
          },
          now
        )
      ),
      _rawAssignments: assignments
    };
    return course;
  });

  const rawAssignments = new Map<string, EcampusClassroomItem>();
  for (const c of courses) {
    for (const raw of c._rawAssignments || []) {
      rawAssignments.set(`${c.crsCreCd}::${raw.id}`, raw);
    }
    delete (c as { _rawAssignments?: EcampusClassroomItem[] })._rawAssignments;
  }

  const snapshot: Snapshot = {
    savedAt: new Date().toISOString(),
    semester: semesterFromCode(courses[0]?.crsCreCd),
    courses,
    summary: buildSummary(courses)
  };
  return { snapshot, rawAssignments };
}

/**
 * 과제 상세 본문·첨부·제출 폼을 읽는다.
 * @param client - e-campus 클라이언트
 * @param raw - 목록 원본 과제
 * @param ids - 과제 식별자
 */
export async function fetchAssignmentDetail(
  client: EcampusClient,
  raw: EcampusClassroomItem | undefined,
  ids: { id?: string; crsCreCd?: string } = {}
): Promise<AssignmentDetail> {
  const item = assignmentItem(raw, ids, client.baseUrl);
  const detail = await client.getAssignmentDetail(item);
  const form = detail.submitForm;
  const mapFile = (a: { title?: string; url: string }) => ({
    title: a.title && a.title !== "attachment" ? a.title : "첨부파일",
    url: a.url
  });
  return {
    text: detail.text || assignmentDetailText(detail.html),
    attachments: (detail.attachments || []).map(mapFile),
    submittedAttachments: (detail.submittedAttachments || []).map(mapFile),
    canSubmit: Boolean(item.id),
    sendType: detail.sendType || "F",
    formAction: form?.action || "",
    asmntSendCd: detail.submitForm?.fields?.asmntSendCd || ""
  };
}

/**
 * 이미 낸 과제 파일만 우측 제출 칸에서 읽는다.
 * @param client - e-campus 클라이언트
 * @param raw - 목록 원본 과제
 * @param ids - 과제 식별자
 */
export async function fetchAssignmentSubmittedFiles(
  client: EcampusClient,
  raw: EcampusClassroomItem | undefined,
  ids: { id?: string; crsCreCd?: string } = {}
): Promise<AttachmentRow[]> {
  const item = assignmentItem(raw, ids, client.baseUrl);
  const files = await client.getAssignmentSubmittedFiles(item);
  return (files || []).map((a) => ({
    title: a.title && a.title !== "attachment" ? a.title : "첨부파일",
    url: a.url
  }));
}

/**
 * 제출한 과제 행에 제출 파일 목록을 붙인다. 한 번 조회한 행은 스냅샷에 남겨 둔다.
 * @param client - e-campus 클라이언트
 * @param rawAssignments - 과제 원본 맵
 * @param rows - 목록 API 행
 * @param snapshot - 세션 스냅샷. 있으면 캐시로 쓴다
 */
export async function attachSubmittedFilesToRows(
  client: EcampusClient,
  rawAssignments: Map<string, EcampusClassroomItem>,
  rows: AssignmentListRow[],
  snapshot?: Snapshot | null
): Promise<void> {
  const pending = rows.filter((r) => !r.submittedFilesLoaded);
  if (!pending.length) return;
  await mapLimit(pending, FETCH_LIMIT, async (row) => {
    const raw = rawAssignments.get(`${row.crsCreCd}::${row.id}`);
    try {
      const files = await fetchAssignmentSubmittedFiles(client, raw, { id: row.id, crsCreCd: row.crsCreCd });
      row.submittedAttachments = files;
      row.hasSubmittedFile = files.length > 0;
      try {
        const detail = await fetchAssignmentDetail(client, raw, { id: row.id, crsCreCd: row.crsCreCd });
        if (!files.length && detail.submittedAttachments.length) {
          row.submittedAttachments = detail.submittedAttachments;
          row.hasSubmittedFile = true;
        }
      } catch {}
    } catch {
      row.submittedAttachments = [];
      row.hasSubmittedFile = false;
    }
    row.submittedFilesLoaded = true;
    refreshAssignmentDue(row);
    if (!snapshot) return;
    for (const c of snapshot.courses) {
      for (const a of c.assignments) {
        if (a.id !== row.id) continue;
        if ((a.crsCreCd || c.crsCreCd) !== row.crsCreCd) continue;
        a.submittedAttachments = row.submittedAttachments;
        a.hasSubmittedFile = row.hasSubmittedFile;
        a.submittedFilesLoaded = true;
        a.status = row.status;
        a.dueNow = row.dueNow;
      }
    }
  });
  if (snapshot) snapshot.summary = buildSummary(snapshot.courses);
}

/**
 * 상세 화면 폼으로 과제를 제출한다. 수강신청이 아니다.
 * action 호스트가 seowon.ac.kr 인지 확인한 뒤 전송한다.
 * @param client - e-campus 클라이언트
 * @param raw - 목록 원본 과제
 * @param payload - 제출 파일
 */
export async function submitAssignment(
  client: EcampusClient,
  raw: EcampusClassroomItem | undefined,
  payload: AssignmentSubmitPayload
): Promise<{ ok: true; status: number; hasSubmittedFile: boolean }> {
  const item = assignmentItem(raw, payload, client.baseUrl);
  return client.submitAssignment(item, {
    file: payload.file,
    asmntSendCd: payload.asmntSendCd,
    deletedEncFileSns: payload.deletedEncFileSns,
    deletedFileUrls: payload.deletedFileUrls,
    keepFileUrls: payload.keepFileUrls,
    renamedFiles: payload.renamedFiles
  });
}

/**
 * 전 과목 강의자료실 목록을 모은다.
 * @param client - e-campus 클라이언트
 */
export async function fetchMaterials(
  client: EcampusClient
): Promise<{ rows: MaterialRow[]; rawMaterials: Map<string, EcampusClassroomItem> }> {
  const list = await client.getCourseList();
  const rawMaterials = new Map<string, EcampusClassroomItem>();
  const rows: MaterialRow[] = [];
  await mapLimit(list, FETCH_LIMIT, async (c) => {
    let items: EcampusClassroomItem[] = [];
    try {
      items = await client.getMaterialList({ crsCreCd: c.crsCreCd, listScale: 100 });
    } catch {
      items = [];
    }
    for (const it of items) {
      rawMaterials.set(`${c.crsCreCd}::${it.id}`, it);
      rows.push({
        id: it.id,
        title: it.title || "",
        date: it.date || "",
        hasAttachment: Boolean(it.hasAttachment),
        crsCreCd: c.crsCreCd,
        courseTitle: c.title
      });
    }
  });
  return { rows, rawMaterials };
}

/**
 * 전 과목 공지사항 목록을 모은다. prompt:client 의 getNoticeList 와 같다.
 * @param client - e-campus 클라이언트
 */
export async function fetchNotices(
  client: EcampusClient
): Promise<{ rows: NoticeRow[]; rawNotices: Map<string, EcampusClassroomItem> }> {
  const list = await client.getCourseList();
  const rawNotices = new Map<string, EcampusClassroomItem>();
  const rows: NoticeRow[] = [];
  await mapLimit(list, FETCH_LIMIT, async (c) => {
    let items: EcampusClassroomItem[] = [];
    try {
      items = await client.getNoticeList({ crsCreCd: c.crsCreCd, listScale: LIST_SCALE });
    } catch {
      items = [];
    }
    for (const it of items) {
      rawNotices.set(`${c.crsCreCd}::${it.id}`, it);
      rows.push({
        id: it.id,
        title: it.title || "",
        date: it.date || "",
        hasAttachment: Boolean(it.hasAttachment),
        crsCreCd: c.crsCreCd,
        courseTitle: c.title
      });
    }
  });
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { rows, rawNotices };
}

/**
 * 공지 한 건의 본문·첨부를 가져온다.
 * 목록 raw 요청이 있으면 그대로 재전송하고, 없으면 자료 첨부와 같은 경로를 쓴다.
 * @param client - e-campus 클라이언트
 * @param raw - 목록 원본 공지
 */
export async function fetchNoticeDetail(
  client: EcampusClient,
  raw: EcampusClassroomItem | undefined
): Promise<NoticeDetail> {
  if (!raw) throw new Error("공지를 고르세요.");
  let html = "";
  if (raw.request?.url) {
    const requestUrl = new URL(raw.request.url, client.baseUrl);
    const response = await client.http.post(
      requestUrl.pathname + requestUrl.search,
      new URLSearchParams(raw.request.body || {}),
      {
        headers: {
          Accept: "text/html, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        }
      }
    );
    html = typeof response.data === "string" ? response.data : "";
  }
  const attachments = html
    ? parseEcampusClassroomAttachmentsHtml(html, { baseUrl: client.baseUrl }) || []
    : await client.getMaterialAttachments(raw);
  return {
    text: html ? noticeDetailText(html) : "",
    attachments: (attachments || []).map((a: { title?: string; url: string }) => ({
      title: a.title || "첨부파일",
      url: a.url
    }))
  };
}

/**
 * 강의자료 한 건의 첨부 목록을 가져온다.
 * @param client - e-campus 클라이언트
 * @param raw - 자료 원본
 */
export async function fetchMaterialAttachments(
  client: EcampusClient,
  raw: EcampusClassroomItem | undefined
): Promise<AttachmentRow[]> {
  if (!raw) throw new Error("자료를 고르세요.");
  const list = await client.getMaterialAttachments(raw);
  return (list || []).map((a) => ({ title: a.title || "첨부파일", url: a.url }));
}

/**
 * e-campus 첨부 파일을 받아 버퍼로 돌려준다.
 * seowon.ac.kr 호스트만 허용한다.
 * @param client - e-campus 클라이언트
 * @param url - 첨부 절대·상대 URL
 */
export async function downloadCampusFile(
  client: EcampusClient,
  url: string
): Promise<{ data: Buffer; contentType: string; disposition: string }> {
  return client.downloadClassroomFile(url);
}

/**
 * e-campus 첨부파일의 용량(Content-Length)을 조회한다.
 * @param client - e-campus 클라이언트
 * @param url - 첨부파일 URL
 */
export async function fetchFileSize(
  client: EcampusClient,
  url: string
): Promise<number> {
  return client.getClassroomFileSize(url);
}
