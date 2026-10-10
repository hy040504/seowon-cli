/**
 * 과목별(현재) 성적 요약.
 *
 * EcampusClient 성적 API를 따른다. 공개 안 된 과목은 페이지를 억지로 열지 않고
 * 접근 상태 메시지만 둔다.
 */
import type { EcampusClient } from "../../engine/index.js";

import { FETCH_LIMIT } from "../../constants.js";
import type { ScoreRow } from "../../types/score.js";
import { errorMessage, mapLimit } from "../../utils.js";

/**
 * 과목별 성적 요약을 가져온다.
 * @param client - e-campus 클라이언트
 * @returns 성적 행 목록
 */
export async function fetchScores(client: EcampusClient): Promise<ScoreRow[]> {
  const list = await client.getCourseList();
  return mapLimit(list, FETCH_LIMIT, async (c) => {
    try {
      const access = await client.getScoreAccessInfo({ crsCreCd: c.crsCreCd });
      if (!access.canViewScore) {
        return {
          courseTitle: c.title,
          crsCreCd: c.crsCreCd,
          canView: false,
          status: access.status,
          message: access.message || "성적을 열 수 없습니다.",
          total: "",
          grade: "",
          items: []
        };
      }
      const sum = await client.getScoreSummary({ crsCreCd: c.crsCreCd });
      return {
        courseTitle: c.title,
        crsCreCd: c.crsCreCd,
        canView: true,
        status: access.status,
        message: "",
        total: sum.total || "",
        grade: sum.grade || "",
        items: (sum.items || []).map((it) => ({
          title: it.title || "",
          value: it.value || "",
          kind: it.kind || "item"
        }))
      };
    } catch (err) {
      return {
        courseTitle: c.title,
        crsCreCd: c.crsCreCd,
        canView: false,
        status: "unavailable",
        message: errorMessage(err) || "성적을 열 수 없습니다.",
        total: "",
        grade: "",
        items: []
      };
    }
  });
}
