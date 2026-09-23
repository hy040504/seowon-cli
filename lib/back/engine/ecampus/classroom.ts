/**
 * e-campus 강의실 HTML 파서.
 *
 * 과제·공지·자료 목록과 제출 폼을 읽는다.
 * HTTP 는 login.ts 클라이언트가 보낸다.
 */
import type {
  EcampusAssignmentSubmitForm,
  EcampusClassroomAttachment,
  EcampusClassroomItem,
  EcampusClassroomResourceOptions,
  EcampusClassroomResources,
  EcampusClassroomSection
} from "./types/classroom.js";

export type {
  EcampusAssignmentDetail,
  EcampusAssignmentSubmitForm,
  EcampusClassroomAttachment,
  EcampusClassroomItem,
  EcampusClassroomResourceOptions,
  EcampusClassroomResources,
  EcampusClassroomSection,
  EcampusDownloadedFile,
  EcampusPostRequest
} from "./types/classroom.js";

import * as cheerio from "cheerio";
import { absoluteUrl, normalizeSpace, parseFunctionArguments } from "./utils.js";

const DEFAULT_BASE_URL = "https://ecampus.seowon.ac.kr";
const VIEW_ATCL_PATH = "/bbs/bbsLect/Form/viewAtclForm";
const VIEW_ATCL_CONTENT_PATH = "/bbs/bbsLect/viewAtcl";
const VIEW_ASMNT_PATH = "/asmnt/asmntLect/Form/asmntStuMain";
const VIEW_ASMNT_CONTENT_PATH = "/asmnt/asmntLect/asmntStuMain";
const GENERIC_ATTACHMENT_TITLE = /^(다운로드|download|down|첨부|첨부파일|파일|보기|열기|file)$/i;
const FILENAME_IN_TEXT =
  /([\w가-힣()[\]{}.+\- ]+\.(pdf|hwp|hwpx|docx?|pptx?|xlsx?|zip|rar|7z|txt|jpg|jpeg|png|gif|mp4|hwpx?))/i;

/**
 * 강의실 리소스 수집 결과의 기본 컨테이너를 만든다.
 * @returns {EcampusClassroomResources} 빈 공지/과제/자료 배열을 가진 객체
 */
export function createEmptyEcampusClassroomResources(): EcampusClassroomResources {
  return { notices: [], assignments: [], materials: [] };
}

/**
 * 공지사항 게시판 HTML을 공통 항목 구조로 파싱한다.
 * @param {string} html - 게시판 목록 HTML
 * @param {EcampusClassroomResourceOptions} options - 파싱 옵션
 * @returns {EcampusClassroomItem[]} 공지사항 항목 배열
 */
export function parseEcampusNoticeListHtml(
  html: string,
  options: EcampusClassroomResourceOptions = {}
): EcampusClassroomItem[] {
  return parseBbsListHtml(html, "notices", options);
}

/**
 * 강의자료실 게시판 HTML을 공통 항목 구조로 파싱한다.
 * @param {string} html - 게시판 목록 HTML
 * @param {EcampusClassroomResourceOptions} options - 파싱 옵션
 * @returns {EcampusClassroomItem[]} 강의자료 항목 배열
 */
export function parseEcampusMaterialListHtml(
  html: string,
  options: EcampusClassroomResourceOptions = {}
): EcampusClassroomItem[] {
  return parseBbsListHtml(html, "materials", options);
}

/**
 * 목록 행에 실제 첨부 아이콘/다운로드 링크가 있는지 본다.
 * `.file` 클래스나 "파일" 문구는 화면 장식에도 쓰여서 쓰지 않는다.
 */
function listItemHasAttachment($el: cheerio.Cheerio<any>): boolean {
  if (!$el || !$el.length) return false;
  if ($el.find(".paperclip, .ico-paperclip, img[src*='paperclip'], img[alt*='첨부']").length > 0) return true;
  if ($el.find("[href*='fileDown'], [onclick*='fileDown']").length > 0) return true;
  return false;
}

/**
 * 과제함 HTML의 특수한 테이블 구조를 분석하여 목록과 제출 정보를 추출한다.
 * 일반 게시판과 달리 진행 상태(제출 여부)를 포함하는 복합 로직을 수행한다.
 * @param {string} html - 응답 소스
 * @param {EcampusClassroomResourceOptions} options - 설정
 * @returns {EcampusClassroomItem[]} 파싱된 과제 항목 배열
 */
export function parseEcampusAssignmentListHtml(
  html: string,
  options: EcampusClassroomResourceOptions = {}
): EcampusClassroomItem[] {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const $ = cheerio.load(html);

  // 제출 처리에 필요한 모든 기본 폼 데이터(token 등) 수집
  const formValues = getFormValues($, "form#asmntListForm");
  const crsCreCd = options.crsCreCd ?? formValues.crsCreCd ?? "";

  return $("a[href^='javascript:asmntView']")
    .toArray()
    .map((link) => {
      const $link = $(link);
      // "javascript:asmntView('CD')" 에서 고유 코드 추출
      const asmntCd = parseFunctionArguments($link.attr("href") ?? "")[0] ?? "";
      const card = $link.closest(".card");
      const text = normalizeSpace(card.text());
      const title = normalizeSpace($link.text());

      // 제출 기간 및 현재 상태(제출완료/미제출) 정규식 매칭
      const period = text.match(/제출기간\s*([0-9.() :~]+)/)?.[1]?.trim();
      const status = text.match(/(과제를 제출하였습니다|미제출|종료|진행중)/)?.[1];

      const hasAttachment = listItemHasAttachment(card);

      // 개별 과제 조회를 위한 맞춤형 요청 정보 구성
      const body = { ...formValues, crsCreCd, asmntCd };

      return {
        id: asmntCd,
        title,
        url: absoluteUrl(VIEW_ASMNT_PATH, baseUrl),
        request: {
          method: "POST" as const,
          url: absoluteUrl(VIEW_ASMNT_PATH, baseUrl),
          body
        },
        period,
        status,
        hasAttachment
      };
    })
    .filter((item) => item.id && item.title);
}

/**
 * 통합 리소스 데이터를 CLI 출력에 적합한 JSON으로 직렬화한다.
 * @param {EcampusClassroomResources} resources - 통합 리소스 데이터
 * @returns {string} 들여쓰기된 JSON 문자열
 */
export function stringifyEcampusClassroomResources(resources: EcampusClassroomResources): string {
  return JSON.stringify(resources, null, 2);
}

/**
 * 강의실 항목 배열을 CLI 출력에 적합한 JSON으로 직렬화한다.
 * @param {EcampusClassroomItem[]} items - 강의실 항목 배열
 * @returns {string} 들여쓰기된 JSON 문자열
 */
export function stringifyEcampusClassroomItems(items: EcampusClassroomItem[]): string {
  return JSON.stringify(items, null, 2);
}

/**
 * 강의실 상세 HTML에서 다운로드 가능한 첨부파일 링크를 추출한다.
 * @param {string} html - 상세 화면 HTML
 * @param {EcampusClassroomResourceOptions} options - URL 보정 옵션
 * @returns {EcampusClassroomAttachment[]} 첨부파일 제목과 URL 배열
 */
export function parseEcampusClassroomAttachmentsHtml(
  html: string,
  options: EcampusClassroomResourceOptions = {}
): EcampusClassroomAttachment[] {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const $ = cheerio.load(html);
  const attachments: EcampusClassroomAttachment[] = [];
  const seen = new Set<string>();

  $("script, style, noscript").remove();

  $("a[href], a[onclick], button[onclick], [data-url], [data-href]").each((_, element) => {
    const node = $(element);
    const url = extractAttachmentUrl(node, baseUrl);
    if (!url) return;

    const rawText = normalizeSpace(
      [
        node.text(),
        node.attr("href") ?? "",
        node.attr("onclick") ?? "",
        node.attr("data-url") ?? "",
        node.attr("data-href") ?? "",
        node
          .closest(
            ".inline.field, .file, .filebox, .attach, .attachment, .paperclip, li, tr, td, dd"
          )
          .text()
      ]
        .filter(Boolean)
        .join(" ")
    );

    if (!looksLikeAttachmentCandidate(rawText) && !looksLikeAttachmentUrl(url)) return;

    const title = extractAttachmentTitle(node, url);
    const key = `${title}::${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    attachments.push({ title, url });
  });

  if (attachments.length === 0) {
    $("a[href], button[onclick], [data-url], [data-href]").each((_, element) => {
      const node = $(element);
      const url = extractAttachmentUrl(node, baseUrl);
      if (!url || !looksLikeAttachmentUrl(url)) return;

      const title = extractAttachmentTitle(node, url);
      const key = `${title}::${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      attachments.push({ title, url });
    });
  }

  return attachments;
}

/**
 * 과제 상세 HTML이 본문·첨부·제출 칸을 가졌는지 본다.
 * Form 껍데기만 온 경우는 false 다.
 * @param {string} html - 과제 화면 HTML
 * @returns {boolean} 상세로 쓸 수 있으면 true
 */
/**
 * 내려받은 본문이 HTML 오류 페이지인지 본다.
 * @param {Buffer} data - 응답 본문
 * @param {string} [contentType] - Content-Type 헤더
 * @returns {boolean} HTML 이면 true
 */
export function isHtmlFileBody(data: Buffer, contentType = ""): boolean {
  if (/text\/html/i.test(contentType)) return true;
  const head = data.subarray(0, 256).toString("utf8").trimStart();
  return /^<!DOCTYPE html/i.test(head) || /^<html/i.test(head);
}

/**
 * 과제 상세 HTML이 본문·첨부·제출 칸을 가졌는지 본다.
 * Form 껍데기만 온 경우는 false 다.
 * @param {string} html - 과제 화면 HTML
 * @returns {boolean} 상세로 쓸 수 있으면 true
 */
export function looksLikeAssignmentDetailHtml(html: string): boolean {
  if (!html) return false;
  return /fileDown|sendAsmnt|asmntSend|asmntListForm|sendType|과제내용|참고자료|제출하기|saveStu|asmntCnts|sbmsn|type\s*=\s*["']file["']|<textarea|input[^>]*type=["']file["']/i.test(
    html
  );
}

/**
 * 과제 상세 요청 URL 후보를 만든다. /Form/ 껍데기와 AJAX 본문 경로를 같이 시도한다.
 * @param {string} url - 목록 request.url
 * @param {string} [baseUrl] - 상대 경로 보정
 * @returns {string[]} 중복 없는 절대 URL 목록
 */
export function assignmentDetailCandidateUrls(url: string, baseUrl = DEFAULT_BASE_URL): string[] {
  const abs = absoluteUrl(url || VIEW_ASMNT_PATH, baseUrl);
  const parsed = new URL(abs);
  const path = parsed.pathname;
  const out: string[] = [abs];
  if (path.includes("/Form/")) {
    parsed.pathname = path.replace("/Form/", "/");
    out.push(parsed.toString());
  } else if (path.endsWith("/asmntStuMain")) {
    parsed.pathname = path.replace(/\/asmntStuMain$/, "/Form/asmntStuMain");
    out.push(parsed.toString());
  }
  const content = new URL(VIEW_ASMNT_CONTENT_PATH, baseUrl).toString();
  const form = new URL(VIEW_ASMNT_PATH, baseUrl).toString();
  for (const extra of [content, form]) {
    if (!out.includes(extra)) out.push(extra);
  }
  return out;
}

/**
 * 과제 상세 HTML에서 제출 폼 action·숨은 필드·파일 필드명을 읽는다.
 * @param {string} html - 과제 화면 HTML
 * @param {EcampusClassroomResourceOptions} [options] - baseUrl
 * @returns {EcampusAssignmentSubmitForm | null} 제출 폼. 없으면 null
 */
export function parseEcampusAssignmentSubmitForm(
  html: string,
  options: EcampusClassroomResourceOptions = {}
): EcampusAssignmentSubmitForm | null {
  if (!html) return null;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const $ = cheerio.load(html);
  let best: EcampusAssignmentSubmitForm | null = null;

  $("form").each((_, el) => {
    const $form = $(el);
    const actionAttr = $form.attr("action") || "";
    const ident = `${actionAttr} ${$form.attr("id") || ""} ${$form.attr("name") || ""}`;
    const hasFile = $form.find("input[type='file']").length > 0;
    const hasText = $form.find("textarea").length > 0;
    const looks = /asmnt|saveStu|submit|제출/i.test(ident) || hasFile || hasText;
    if (!looks) return;

    const fields: Record<string, string> = {};
    $form.find("input[name]").each((__, input) => {
      const $input = $(input);
      const name = $input.attr("name");
      if (!name) return;
      const type = ($input.attr("type") || "text").toLowerCase();
      if (type === "file" || type === "button" || type === "submit") return;
      fields[name] = $input.attr("value") ?? "";
    });

    let textField = "";
    $form.find("textarea[name]").each((__, area) => {
      const name = $(area).attr("name");
      if (!name) return;
      if (!textField || /ans|cnts|content|desc|내용|sbmsn/i.test(name)) textField = name;
      fields[name] = $(area).text();
    });

    const $file = $form.find("input[type='file'][name]").first();
    const fileField = $file.attr("name") || "";
    let actionAbs = "";
    try {
      if (actionAttr) actionAbs = new URL(actionAttr, baseUrl).toString();
    } catch {
      actionAbs = "";
    }

    const candidate: EcampusAssignmentSubmitForm = {
      action: actionAbs,
      fields,
      textField,
      fileField,
      hasFile: Boolean(fileField || hasFile)
    };
    best = candidate;
    if (hasFile || /save|submit/i.test(actionAttr)) return false;
  });

  if (!best) {
    const $file = $("input[type='file'][name]").first();
    const $area = $("textarea[name]").first();
    if ($file.length || $area.length) {
      const fields: Record<string, string> = {};
      $("input[name]").each((_, input) => {
        const $input = $(input);
        const name = $input.attr("name");
        if (!name) return;
        const type = ($input.attr("type") || "text").toLowerCase();
        if (type === "file" || type === "button" || type === "submit") return;
        fields[name] = $input.attr("value") ?? "";
      });
      const textField = $area.attr("name") || "";
      if (textField) fields[textField] = $area.text();
      best = {
        action: "",
        fields,
        textField,
        fileField: $file.attr("name") || "",
        hasFile: $file.length > 0
      };
    }
  }

  if (best && !best.action) {
    const save =
      html.match(/["'](\/asmnt\/[^"'\\\s<>]*(?:save|submit)[^"'\\\s<>]*)["']/i)?.[1] ||
      html.match(/["'](\/asmnt\/[^"'\\\s<>]+)["']/i)?.[1] ||
      "";
    if (save) {
      try {
        best.action = new URL(save, baseUrl).toString();
      } catch {
        // 상대 경로 보정 실패 시 action 비움
      }
    }
  }

  return best;
}

/** 신규 과제 제출 */
export const SEND_ASMNT_PATH = "/asmnt/asmntHome/sendAsmnt";
/** 기제출 과제 수정 제출 */
export const EDIT_SEND_ASMNT_PATH = "/asmnt/asmntHome/editSendAsmnt";
/** 구형 과제 수정 경로 */
export const EDIT_STD_ASMNT_PATH = "/em/asmnt/editStdAsmnt.do";
/** 과제 상세 우측 칸 */
export const ASMNT_RIGHT_VIEW_PATH = "/asmnt/asmntHome/asmntRightView";
/** 기제출 과제 수정 화면 */
export const ASMNT_SEND_VIEW_PATH = "/asmnt/asmntHome/asmntSendView";

/**
 * 과제 HTML에서 제출 형식(F=파일, T=텍스트)을 읽는다.
 * 패킷은 `"sendType" : "F"` 와 `if("F" == "T")` 둘 다 쓴다.
 * @param {string} html - 상세 또는 우측 칸 HTML
 * @returns {"F"|"T"|""} 제출 형식
 */
export function parseEcampusAssignmentSendType(html: string): "F" | "T" | "" {
  if (!html) return "";
  const patterns = [
    /["']sendType["']\s*[:=]\s*["']([FT])["']/,
    /if\s*\(\s*"([FT])"\s*==\s*"T"/,
    /name\s*=\s*["']sendType["'][^>]*value\s*=\s*["']([FT])["']/i,
    /value\s*=\s*["']([FT])["'][^>]*name\s*=\s*["']sendType["']/i
  ];
  for (const re of patterns) {
    const v = html.match(re)?.[1];
    if (v === "F" || v === "T") return v;
  }
  return "";
}

/**
 * sendAsmnt 제출에 쓸 폼 정보를 만든다. e-campus 상세 화면에 file input 이 없다.
 * @param {Record<string, string>} fields - hidden 필드
 * @param {"F"|"T"|""} sendType - 제출 형식
 * @param {string} [baseUrl]
 * @returns {EcampusAssignmentSubmitForm} 제출 엔드포인트
 */
export function buildEcampusAssignmentSubmitForm(
  fields: Record<string, string>,
  sendType: "F" | "T" | "",
  baseUrl = DEFAULT_BASE_URL
): EcampusAssignmentSubmitForm {
  const file = sendType !== "T";
  return {
    action: absoluteUrl(SEND_ASMNT_PATH, baseUrl),
    fields,
    textField: sendType === "T" ? "sendCts" : "",
    fileField: file ? "attachFileSns" : "",
    hasFile: file
  };
}

/**
 * 과제 상세·목록 HTML의 fileDown('TOKEN') 링크만 첨부 목록으로 읽는다.
 * 링크 텍스트가 실제 파일명이다.
 * @param {string} html - 과제 화면 HTML
 * @param {EcampusClassroomResourceOptions} [options] - baseUrl
 * @returns {EcampusClassroomAttachment[]} 참고자료 첨부
 */
export function parseEcampusAssignmentFileLinks(
  html: string,
  options: EcampusClassroomResourceOptions = {}
): EcampusClassroomAttachment[] {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const $ = cheerio.load(html);
  const attachments: EcampusClassroomAttachment[] = [];
  const seen = new Set<string>();

  $("a[href*='fileDown'], a[onclick*='fileDown']").each((_, el) => {
    const $el = $(el);
    const call = `${$el.attr("href") || ""} ${$el.attr("onclick") || ""}`;
    const args = parseFunctionArguments(call);
    const token = args[0];
    if (!token) return;
    const url = absoluteUrl(`/file/download/${token}`, baseUrl);
    $el.find("i, svg").remove();
    const named = args.find((a, i) => i > 0 && FILENAME_IN_TEXT.test(a));
    const title = normalizeSpace(named || $el.text()) || "첨부파일";
    const key = `${title}::${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    attachments.push({ title, url });
  });

  return attachments;
}

/**
 * 과제 HTML에서 fileDown·다운로드 링크를 중복 없이 모은다.
 * @param {string} html
 * @param {EcampusClassroomResourceOptions} [options]
 * @returns {EcampusClassroomAttachment[]}
 */
export function collectEcampusAssignmentDownloadLinks(
  html: string,
  options: EcampusClassroomResourceOptions = {}
): EcampusClassroomAttachment[] {
  if (!html) return [];
  const seen = new Set<string>();
  const out: EcampusClassroomAttachment[] = [];
  for (const it of [
    ...parseEcampusAssignmentFileLinks(html, options),
    ...parseEcampusClassroomAttachmentsHtml(html, options)
  ]) {
    const url = String(it.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: it.title && it.title !== "attachment" ? it.title : "첨부파일",
      url
    });
  }
  return out;
}

/**
 * 제출 파일 칸으로 보이는 블록 HTML만 골라낸다.
 * @param {string} html
 * @returns {string}
 */
function extractLabeledSubmitBlocks(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];
  $("label, th, dt, h2, h3, h4, legend, strong, p, span").each((_, el) => {
    const t = normalizeSpace($(el).text());
    if (!/(제출\s*파일|제출한\s*파일|제출\s*자료|제출\s*첨부|내가\s*제출)/.test(t)) return;
    const block = $(el).closest(".field, .inline.field, .card, tr, li, section, div").first();
    const inner = block.html();
    if (inner) parts.push(inner);
  });
  return parts.join("\n");
}

/**
 * 학생이 이미 낸 과제 파일 링크를 읽는다.
 * requireLabel 이면 「제출 파일」 칸만 보고, 아니면 페이지 전체 첨부 링크를 본다.
 * @param {string} html
 * @param {EcampusClassroomResourceOptions} [options]
 * @param {boolean} [requireLabel]
 * @returns {EcampusClassroomAttachment[]}
 */
export function parseEcampusAssignmentSubmittedFiles(
  html: string,
  options: EcampusClassroomResourceOptions = {},
  requireLabel = false
): EcampusClassroomAttachment[] {
  if (!html) return [];
  if (requireLabel) {
    const labeled = extractLabeledSubmitBlocks(html);
    if (!labeled) return [];
    return collectEcampusAssignmentDownloadLinks(labeled, options);
  }
  return collectEcampusAssignmentDownloadLinks(html, options);
}

/**
 * 과제 상세 HTML에서 본문·제출형식·제출 엔드포인트를 읽는다.
 * 실제 화면은 form 파일 필드가 없고 sendAsmnt AJAX 를 쓴다.
 * @param {string} html - /asmnt/asmntLect/Form/asmntStuMain 응답
 * @param {EcampusClassroomResourceOptions} [options] - baseUrl
 * @returns 본문·첨부·제출 정보
 */
export function parseEcampusAssignmentDetailHtml(
  html: string,
  options: EcampusClassroomResourceOptions = {}
): {
  text: string;
  sendType: "F" | "T" | "";
  attachments: EcampusClassroomAttachment[];
  submitForm: EcampusAssignmentSubmitForm | null;
  canSubmit: boolean;
} {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const $ = cheerio.load(html);
  const sendType = parseEcampusAssignmentSendType(html);

  const content = normalizeSpace(
    $("label.label-title")
      .filter((_, el) => /과제내용/.test($(el).text()))
      .first()
      .closest(".inline.field, .field, div")
      .find(".note-editable")
      .text()
  ) || normalizeSpace($(".note-editable").first().text());

  const fields: Record<string, string> = {};
  $("#asmntListForm input[name], form#asmntListForm input[name], input[name='asmntCd'], input[name='crsCreCd']").each(
    (_, input) => {
      const name = $(input).attr("name");
      if (name && fields[name] === undefined) fields[name] = $(input).attr("value") ?? "";
    }
  );
  const title = normalizeSpace($("h2.page-title").first().text() || $("#hiddenAsmntTitle").attr("value") || "");
  if (title) fields.asmntTitle = title;

  // e-campus 상세에는 file input 이 없다. 제출은 항상 sendAsmnt AJAX 다.
  const submitForm = buildEcampusAssignmentSubmitForm(fields, sendType, baseUrl);
  const canSubmit = true;

  return {
    text: content,
    sendType,
    attachments: parseEcampusAssignmentFileLinks(html, options),
    submitForm,
    canSubmit
  };
}

/**
 * 우측 제출 칸 HTML에 제출하기 버튼이 있는지 본다.
 * @param {string} html - /asmnt/asmntHome/asmntRightView 응답
 * @returns {boolean} 제출 가능
 */
export function parseEcampusAssignmentRightViewCanSubmit(html: string): boolean {
  return /sendAsmnt\s*\(|id=["']sendAsmntBtn["']|제출하기/.test(html || "");
}

/**
 * 제출 화면 HTML에서 파일 업로드 URL을 찾는다.
 * @param {string} html - /asmnt/asmntHome/asmntSendView 응답
 * @param {string} [baseUrl]
 * @returns {string} 업로드 절대 URL. 없으면 빈 문자열
 */
export function parseEcampusAssignmentUploadUrl(html: string, baseUrl = DEFAULT_BASE_URL): string {
  if (!html) return "";
  const paths = [
    html.match(/FILE_UPLOAD\s*[:=]\s*["']([^"']+)["']/i)?.[1],
    html.match(/["'](\/[^"'\\\s<>]*(?:ajaxupload|fileUpload|uploadFile|file\/upload)[^"'\\\s<>]*)["']/i)?.[1],
    html.match(/uploadUrl\s*[:=]\s*["']([^"']+)["']/i)?.[1],
    html.match(/url\s*:\s*cUrl\(\s*["']([^"']+)["']\s*\)/i)?.[1]
  ].filter((p): p is string => Boolean(p));
  for (const path of paths) {
    try {
      return new URL(path, baseUrl).toString();
    } catch {
      // 다음 후보
    }
  }
  return "";
}

/**
 * 일반적인 게시판(NOTICE, PDS) 형태의 HTML 리스트를 공통 파싱한다.
 * @param {string} html - 게시판 목록 HTML
 * @param {Exclude<EcampusClassroomSection, "assignments">} section - 공지 또는 강의자료 섹션
 * @param {EcampusClassroomResourceOptions} options - 파싱 옵션
 * @returns {EcampusClassroomItem[]} 게시판 항목 배열
 */
function parseBbsListHtml(
  html: string,
  section: Exclude<EcampusClassroomSection, "assignments">,
  options: EcampusClassroomResourceOptions
): EcampusClassroomItem[] {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const $ = cheerio.load(html);
  const items: EcampusClassroomItem[] = [];
  const seenIds = new Set<string>();

  // 구버전 화면과 SAZ fixture에는 링크 자체에 viewAtcl 호출이 들어간다.
  $("a[href^='javascript:viewAtcl']").each((_, link) => {
    const $link = $(link);
    const args = parseFunctionArguments($link.attr("href") ?? "");
    let bbsId = args[0] ?? "";
    let atclId = args[1] ?? "";
    // 방어: 첫 arg가 ATCL이면 순서가 반대인 경우 처리 (일부 onclick 변형)
    if (atclId && atclId.startsWith("ATCL_") && bbsId.startsWith("ATCL_")) {
      [bbsId, atclId] = [atclId, bbsId];
    }
    if (!atclId && bbsId.startsWith("ATCL_")) {
      atclId = bbsId;
      bbsId = "";
    }
    const li = $link.closest("li");
    const title = normalizeSpace($link.find("span").first().text() || $link.text());
    const date = extractDate(li.text() || $link.closest("li, tr, .item").text());
    const crsCreCd = options.crsCreCd ?? extractCrsCreCdFromBbsId(bbsId);
    const resolvedBbsId =
      bbsId ||
      options.bbsId ||
      (crsCreCd ? `BBS_${crsCreCd}_${section === "materials" ? "P" : "N"}` : "");
    const bbsCd = resolvedBbsId.endsWith("_P")
      ? "PDS"
      : resolvedBbsId.endsWith("_N")
        ? "NOTICE"
        : "";
    const body = {
      formType: "VIEW",
      bbsId: resolvedBbsId,
      atclId,
      bbsCd,
      crsCreCd: crsCreCd || ""
    };

    if (atclId && title && !seenIds.has(atclId)) {
      seenIds.add(atclId);
      items.push({
        id: atclId,
        title,
        url: absoluteUrl(VIEW_ATCL_PATH, baseUrl),
        request: {
          method: "POST" as const,
          url: absoluteUrl(VIEW_ATCL_CONTENT_PATH, baseUrl),
          body
        },
        date,
        hasAttachment: listItemHasAttachment(li)
      });
    }
  });

  // 현재 AJAX fragment는 li onclick에만 게시글 식별자를 담는다.
  $("li[onclick*='viewAtcl'], li[onclick*=\"viewAtcl\"]").each((_, li) => {
    const $li = $(li);
    const onclick = $li.attr("onclick") || $li.attr("onClick") || "";
    const args = parseFunctionArguments(onclick);
    let bbsIdFromArg = "";
    let atclId = "";
    if (args.length > 0) {
      if (args[0] && args[0].startsWith("BBS_")) {
        bbsIdFromArg = args[0];
        atclId = args[1] || "";
      } else if (args[0] && args[0].startsWith("ATCL_")) {
        atclId = args[0];
        bbsIdFromArg = args[1] && args[1].startsWith("BBS_") ? args[1] : "";
      } else {
        atclId = args.find((a) => a.startsWith("ATCL_")) || "";
        bbsIdFromArg = args.find((a) => a.startsWith("BBS_")) || "";
      }
    }
    const resolvedBbsId =
      bbsIdFromArg ||
      options.bbsId ||
      (options.crsCreCd ? `BBS_${options.crsCreCd}_${section === "materials" ? "P" : "N"}` : "");
    if (!atclId || !resolvedBbsId) return;
    const crsCreCd = options.crsCreCd ?? extractCrsCreCdFromBbsId(resolvedBbsId);
    const bbsCd = resolvedBbsId.endsWith("_P")
      ? "PDS"
      : resolvedBbsId.endsWith("_N")
        ? "NOTICE"
        : "";
    const body = {
      formType: "VIEW",
      bbsId: resolvedBbsId,
      atclId,
      bbsCd,
      crsCreCd: crsCreCd || ""
    };

    const title = normalizeSpace(
      $li.find("a span").first().text() || $li.find("span").last().text() || $li.text()
    );
    const date = extractDate($li.text());
    const hasAttachment = listItemHasAttachment($li);

    if (title && !seenIds.has(atclId)) {
      seenIds.add(atclId);
      items.push({
        id: atclId,
        title,
        url: absoluteUrl(VIEW_ATCL_PATH, baseUrl),
        request: {
          method: "POST" as const,
          url: absoluteUrl(VIEW_ATCL_CONTENT_PATH, baseUrl),
          body
        },
        date,
        hasAttachment
      });
    }
  });

  return items.filter((item) => item.id && item.title);
}

/**
 * 링크 속성 후보에서 첨부파일 URL을 추출한다.
 * @param {cheerio.Cheerio<any>} node - URL 후보를 가진 DOM 노드
 * @param {string} baseUrl - 상대 경로 보정용 기준 URL
 * @returns {string | undefined} 다운로드 URL
 */
function extractAttachmentUrl(node: cheerio.Cheerio<any>, baseUrl: string): string | undefined {
  const attributes = [
    node.attr("data-url"),
    node.attr("data-href"),
    node.attr("href"),
    node.attr("onclick")
  ].filter((value): value is string => !!value);

  for (const attribute of attributes) {
    const url = extractUrlCandidate(attribute, baseUrl);
    if (url) return url;
  }

  return undefined;
}

/**
 * href, onclick, data 속성에서 실제 다운로드 후보 URL을 찾아낸다.
 * @param {string} source - URL 또는 JavaScript 호출 문자열
 * @param {string} baseUrl - 상대 경로 보정용 기준 URL
 * @returns {string | undefined} 절대 URL 문자열
 */
function extractUrlCandidate(source: string, baseUrl: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed) return undefined;

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    return absoluteUrl(trimmed, baseUrl);
  }

  // javascript:fileDown('TOKEN') 패턴 지원 (실제 브라우저 캡처에서 확인된 첨부 다운로드 트리거)
  const fileDownMatch = trimmed.match(/fileDown\s*\(\s*['"]([^'"]+)['"]/i);
  if (fileDownMatch?.[1]) {
    const token = fileDownMatch[1];
    return absoluteUrl(`/file/download/${token}`, baseUrl);
  }

  const directMatch = trimmed.match(/(?:https?:\/\/[^"'`\s<>]+|\/[^"'`\s<>]+(?:\?[^"'`\s<>]*)?)/i);
  if (directMatch?.[0]) {
    return absoluteUrl(directMatch[0], baseUrl);
  }

  const quotedMatches = Array.from(trimmed.matchAll(/["'`]([^"'`]+)["'`]/g)).map((m) => m[1]!);
  for (const quoted of quotedMatches) {
    if (/^(https?:\/\/|\/)/i.test(quoted)) {
      return absoluteUrl(quoted, baseUrl);
    }
    if (/\.(pdf|hwp|docx?|pptx?|xlsx?|zip|rar|txt|jpg|jpeg|png|gif)(\?|$)/i.test(quoted)) {
      return absoluteUrl(quoted, baseUrl);
    }
    if (
      /(download|down|file|attach|첨부|fileNo|fileId|fileSn|fileSeq|atch|attachNo|downFile|downloadFile)/i.test(
        quoted
      )
    ) {
      return absoluteUrl(quoted, baseUrl);
    }
  }

  return undefined;
}

/**
 * 화면 텍스트와 URL 메타데이터를 조합해 첨부파일 제목을 결정한다.
 * @param {cheerio.Cheerio<any>} node - 첨부파일 링크 DOM 노드
 * @param {string} url - 추출된 첨부파일 URL
 * @returns {string} 첨부파일 표시 제목
 */
function extractAttachmentTitle(node: cheerio.Cheerio<any>, url: string): string {
  const downloadAttr = node.attr("download");
  if (downloadAttr && downloadAttr.trim() !== "true" && !GENERIC_ATTACHMENT_TITLE.test(downloadAttr.trim())) {
    return downloadAttr.trim();
  }

  const call = `${node.attr("href") || ""} ${node.attr("onclick") || ""}`;
  if (/fileDown/i.test(call)) {
    const args = parseFunctionArguments(call);
    const named = args.find((a) => FILENAME_IN_TEXT.test(a));
    if (named) return named.trim();
  }

  const text = normalizeSpace(node.text());
  if (text && !GENERIC_ATTACHMENT_TITLE.test(text)) {
    return text;
  }

  const nearby = normalizeSpace(
    node
      .closest(".inline.field, .file, .filebox, .attach, .attachment, .paperclip, li, tr, td, dd, p, div")
      .text()
  );
  const fromNearby = nearby.match(FILENAME_IN_TEXT)?.[1];
  if (fromNearby) return fromNearby.trim();

  try {
    const parsed = new URL(url);
    const fileNameKeys = ["fileName", "filename", "fileNm", "oriFileNm", "saveFileNm", "name"];
    for (const key of fileNameKeys) {
      const value = parsed.searchParams.get(key);
      if (value) return value;
    }

    const lastPath = parsed.pathname.split("/").filter(Boolean).pop();
    if (lastPath && lastPath !== "download" && !/^[A-Za-z0-9._~+=/-]{8,}$/.test(lastPath)) {
      return decodeURIComponent(lastPath);
    }
  } catch {}

  return "첨부파일";
}

/**
 * 링크 주변 텍스트가 첨부파일 UI인지 판별한다.
 * @param {string} text - 링크와 주변 영역에서 모은 텍스트
 * @returns {boolean} 첨부파일 후보 여부
 */
function looksLikeAttachmentCandidate(text: string): boolean {
  return /(첨부|첨부파일|파일|download|다운로드|down|attach|paperclip|자료|fileDown)/i.test(text);
}

/**
 * URL 패턴만으로 첨부파일 다운로드 가능성을 판별한다.
 * @param {string} url - 검사할 URL
 * @returns {boolean} 첨부파일 URL 후보 여부
 */
function looksLikeAttachmentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const query = parsed.searchParams;

    if (/\.(pdf|hwp|docx?|pptx?|xlsx?|zip|rar|txt|jpg|jpeg|png|gif)(\?|$)/i.test(pathname)) {
      return true;
    }

    if (/(download|down|file|attach|paperclip|자료)/i.test(pathname)) {
      return true;
    }
    if (/^\/file\/download\//i.test(pathname)) {
      return true;
    }

    const queryKeys = [
      "fileNo",
      "fileId",
      "fileSn",
      "fileSeq",
      "atchFileId",
      "atchFileNo",
      "attachNo",
      "attachId",
      "downFile",
      "downloadFile",
      "fileName",
      "filename",
      "oriFileNm",
      "saveFileNm"
    ];
    return queryKeys.some((key) => query.has(key));
  } catch {
    return false;
  }
}

/**
 * 상세 조회에 필요한 HTML 폼 필드를 수집한다.
 * @param {cheerio.CheerioAPI} $ - cheerio 파서 인스턴스
 * @param {string} selector - 폼 선택자
 * @returns {Record<string, string>} input name/value 맵
 */
function getFormValues($: cheerio.CheerioAPI, selector: string): Record<string, string> {
  const values: Record<string, string> = {};
  $(`${selector} input[name]`).each((_, input) => {
    const name = $(input).attr("name");
    if (name) values[name] = $(input).attr("value") ?? "";
  });
  return values;
}

/**
 * 게시판 식별 코드에서 과목 고유 ID를 분리한다.
 * @param {string} bbsId - BBS_로 시작하는 게시판 식별자
 * @returns {string} 과목 고유 ID 또는 빈 문자열
 */
function extractCrsCreCdFromBbsId(bbsId: string): string {
  return bbsId.match(/^BBS_(.+)_[A-Z]$/)?.[1] ?? "";
}

/**
 * 게시글 텍스트에서 e-campus 날짜 리터럴을 추출한다.
 * @param {string} text - 게시글 행 텍스트
 * @returns {string | undefined} yyyy.MM.dd 형식의 날짜 문자열
 */
function extractDate(text: string): string | undefined {
  return text.match(/\b20\d{2}\.\d{2}\.\d{2}\b/)?.[0];
}
