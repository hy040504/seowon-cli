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
  studentId: string
): Promise<number> {
  const form = await client.readLessonFormFields(crsCreCd);
  const stdNo = form.stdNo || `${crsCreCd}_${studentId}`;
  const types = [...new Set([form.prgrRatioTypeCd, "STUDY_TOTAL_TM", "WEEK", "PAGE"].filter(Boolean))];
  const preferred = types[0] || "";
  let best: number | null = null;
  for (const prgrRatioTypeCd of types) {
    const response = await client.http.post(
      "/lesson/lessonLect/viewLessonStudyDetail",
      new URLSearchParams({
        lessonCntsId,
        prgrRatioTypeCd,
        stdNo,
        crsCreCd,
        pageIndex: "1",
        listScale: "10"
      }),
      {
        headers: {
          ...COMMON_AJAX_HEADERS,
          Accept: "text/html, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: client.baseUrl.replace(/\/$/, ""),
          Referer: form.referer
        },
        responseType: "text",
        timeout: 60000
      }
    );
    const pct = findProgressPercent(response.data);
    if (pct == null) continue;
    if (best == null || pct > best) best = pct;
    if (prgrRatioTypeCd === preferred && pct > 0) break;
  }
  if (best == null) {
    const fallback = await client.viewLessonStudyDetail(lessonCntsId, crsCreCd);
    best = findProgressPercent(fallback);
  }
  if (best == null) throw new Error("학습률 응답을 해석하지 못했습니다.");
  return best;
}
