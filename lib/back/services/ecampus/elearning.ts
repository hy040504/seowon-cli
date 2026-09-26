/**
 * 이러닝 학습률 조회와 영상 받기.
 *
 * 시청 기록 적재(watchLesson) 는 부르지 않는다.
 */
import type { Readable } from "node:stream";
import type { EcampusClient } from "../../engine/index.js";
import { COMMON_AJAX_HEADERS } from "../../engine/utils.js";
import { findProgressPercent } from "../../filters.js";

/** 영상 스트림 결과 */
export interface LessonVideoStream {
  stream: Readable;
  contentType: string;
  contentLength: string;
  filename: string;
}

/** 학습 이력 표에서 인정 시간을 합산한다. 서버별 퍼센트 필드가 없을 때 사용한다. */
function studySecondsFromHtml(raw: unknown): number | null {
  const html = String(raw ?? "");
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  let timeIndex = -1;
  let total = 0;
  let foundTable = false;
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      String(m[1] || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim()
    );
    if (!cells.length) continue;
    const header = cells.findIndex((cell) => /학습\s*인정\s*시간|학습시간|study\s*time/i.test(cell));
    if (header >= 0) {
      timeIndex = header;
      foundTable = true;
      continue;
    }
    if (timeIndex < 0) continue;
    const value = cells[timeIndex] || "";
    const h = value.match(/(\d+)\s*시간/);
    const m = value.match(/(\d+)\s*분/);
    const s = value.match(/(\d+)\s*초/);
    if (!h && !m && !s) continue;
    total += Number(h?.[1] || 0) * 3600 + Number(m?.[1] || 0) * 60 + Number(s?.[1] || 0);
  }
  return foundTable ? total : null;
}

/** 영상 길이와 인정 시간을 비교해 화면에 표시할 학습률을 계산한다. */
function progressFromStudyHistory(raw: unknown, durationSeconds?: number): number | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  const seconds = studySecondsFromHtml(raw);
  if (seconds == null) return null;
  return Math.max(0, Math.min(100, Math.round((seconds / durationSeconds) * 100)));
}

/**
 * 이러닝 영상 주소를 찾아 스트림으로 연다. 시청 기록은 보내지 않는다.
 * @param client - e-campus 클라이언트
 * @param crsCreCd - 강의실 코드
 * @param lessonCntsId - 차시 콘텐츠 ID
 */
export async function downloadLessonVideo(
  client: EcampusClient,
  crsCreCd: string,
  lessonCntsId: string
): Promise<LessonVideoStream> {
  const r = await client.getElearningMp4Url(crsCreCd, lessonCntsId);
  if (!r?.success || !r.mp4Url) {
    throw new Error(r?.message || "영상 주소를 찾지 못했습니다. e-campus 에서 확인해 보세요.");
  }
  const response = await client.http.get(r.mp4Url, {
    responseType: "stream",
    headers: { Accept: "*/*" },
    maxContentLength: 800 * 1024 * 1024,
    timeout: 180000
  });
  return {
    stream: response.data as Readable,
    contentType: String(response.headers["content-type"] || "video/mp4"),
    contentLength: String(response.headers["content-length"] || ""),
    filename: `${lessonCntsId}.mp4`
  };
}

/**
 * 선택한 차시 학습률만 조회한다. 시청 기록은 보내지 않는다.
 * @param client - e-campus 클라이언트
 * @param crsCreCd - 강의실 코드
 * @param lessonCntsId - 차시 콘텐츠 ID
 * @param studentId - 학번
 * @returns 학습률 퍼센트
 */
export async function fetchProgress(
  client: EcampusClient,
  crsCreCd: string,
  lessonCntsId: string,
  studentId: string,
  durationSeconds?: number
): Promise<number> {
  // 강의실에 따라 목록 폼이 로그인 화면/빈 조각으로 반환되는 경우가 있다.
  // 이때 폼 조회 자체를 실패로 처리하면 학습률의 대체 조회도 못 하므로
  // 기본 식별자와 진도 방식으로 계속 시도한다.
  let form: { stdNo: string; prgrRatioTypeCd: string; referer: string } = {
    stdNo: "",
    prgrRatioTypeCd: "",
    referer: new URL(`/lesson/lessonLect/Form/lessonListForm?crsCreCd=${encodeURIComponent(crsCreCd)}`, client.baseUrl).toString()
  };
  try {
    form = await client.readLessonFormFields(crsCreCd);
  } catch {
    // 아래의 표준 진도 방식 순회에서 계속한다.
  }

  const stdNo = form.stdNo || studentId || `${crsCreCd}_${studentId}`;
  const types = [...new Set([form.prgrRatioTypeCd, "STUDY_TOTAL_TM", "WEEK", "PAGE"].filter(Boolean))];
  const preferred = types[0] || "";
  let best: number | null = null;
  for (const prgrRatioTypeCd of types) {
    try {
      const response = await client.http.post(
        "/lesson/lessonLect/viewLessonStudyDetail",
        new URLSearchParams({
          lessonCntsId,
          prgrRatioTypeCd,
          stdNo,
          crsCreCd,
          pageIndex: "1",
          // 이력 행이 여러 개일 수 있으므로 첫 10개에서 끊지 않는다.
          listScale: "100"
        }),
        {
          headers: {
            ...COMMON_AJAX_HEADERS,
            Accept: "text/html, application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Origin: client.baseUrl.replace(/\/$/, ""),
            Referer: form.referer
          },
          responseType: "text",
          timeout: 60000
        }
      );
      const historyPct = progressFromStudyHistory(response.data, durationSeconds);
      const parsedPct = findProgressPercent(response.data);
      const pct = historyPct ?? parsedPct;
      if (pct == null || (pct === 0 && durationSeconds)) continue;
      if (best == null || pct > best) best = pct;
      if (prgrRatioTypeCd === preferred && pct > 0) break;
    } catch {
      // 서버가 특정 진도 방식만 거부하는 과목이 있어 다음 방식으로 폴백한다.
    }
  }
  if (best == null) {
    const fallback = await client.viewLessonStudyDetail(lessonCntsId, crsCreCd);
    best = progressFromStudyHistory(fallback, durationSeconds) ?? findProgressPercent(fallback);
  }
  if (best == null) throw new Error("학습률 응답을 해석하지 못했습니다.");
  return best;
}
