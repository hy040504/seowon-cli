/**
 * 기간·제출·출결 필터.
 *
 * C 쪽 parse.c / util.c 와 같은 뜻으로 dueNow·needsWatch 를 붙인다.
 * 웹 목록·현황 집계가 이 모듈의 판별만 사용한다.
 */

/**
 * "2026.08.10 ~ 2026.08.20" 같은 문자열에서 날짜 두 개를 읽는다.
 * 괄호 안 요일 표시는 파싱을 방해하므로 제거한다.
 * @param {string} raw - 기간 문자열
 * @returns {[Date, Date] | null} [시작 00:00, 종료 23:59:59.999] 또는 없음
 */
export function periodRange(raw) {
    if (!raw) return null;
    const cleaned = String(raw).replace(/\([^)]*\)/g, " ");
    const found = [...cleaned.matchAll(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/g)];
    if (found.length < 2) return null;
    const a = new Date(Number(found[0][1]), Number(found[0][2]) - 1, Number(found[0][3]), 0, 0, 0, 0);
    const b = new Date(Number(found[1][1]), Number(found[1][2]) - 1, Number(found[1][3]), 23, 59, 59, 999);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    return [a, b];
}

/**
 * 지금이 제출·학습 기간 안인지 판별한다.
 * @param {string} period - 기간 문자열
 * @param {Date} [now] - 기준 시각
 * @returns {boolean} 기간 안이면 true
 */
export function periodActive(period, now = new Date()) {
    const range = periodRange(period);
    if (!range) return false;
    return range[0] <= now && now <= range[1];
}

/**
 * 아직 제출하지 않은 과제인지 판별한다.
 * @param {string} status - 제출 상태 문구
 * @returns {boolean} 미제출이면 true
 */
export function assignmentUnsubmitted(status) {
    const s = status || "";
    if (!s) return true;
    if (s.includes("과제를 제출") || s.includes("제출하")) return false;
    return true;
}

/**
 * 미제출·진행중 전수 조사 대상인지 판별한다.
 * @param {string} status - 제출 상태 문구
 * @returns {boolean} 조사 대상이면 true
 */
export function assignmentMissingOrProgress(status) {
    const s = status || "";
    if (s === "미제출") return true;
    if (s.includes("진행중")) return true;
    return false;
}

/**
 * 미학습·학습중 차시인지 판별한다.
 * @param {string} attendance - 출결 상태 문구
 * @returns {boolean} 아직 들을 차시면 true
 */
export function lessonUnwatched(attendance) {
    const s = attendance || "";
    if (!s) return false;
    return s.includes("학습중") || s.includes("미학습");
}

/**
 * 과제에 dueNow 플래그를 붙인다.
 * 기간이 열려 있고 미제출일 때만 true 다.
 * @param {{ period?: string, status?: string }} a - 과제 행
 * @param {Date} [now] - 기준 시각
 * @returns {object} 플래그가 붙은 같은 객체
 */
export function markAssignment(a, now = new Date()) {
    a.dueNow = periodActive(a.period, now) && assignmentUnsubmitted(a.status);
    return a;
}

/**
 * 차시에 needsWatch 플래그를 붙인다.
 * 기간이 열려 있고 미학습·학습중일 때만 true 다.
 * @param {{ period?: string, attendanceStatus?: string }} l - 차시 행
 * @param {Date} [now] - 기준 시각
 * @returns {object} 플래그가 붙은 같은 객체
 */
export function markLesson(l, now = new Date()) {
    l.needsWatch = periodActive(l.period, now) && lessonUnwatched(l.attendanceStatus);
    return l;
}

/**
 * 과목별 기간 내 미제출 과제·미완료 이러닝 수를 집계한다.
 * @param {object[]} courses - 스냅샷 과목 목록
 * @returns {object[]} 현황 행
 */
export function buildSummary(courses) {
    return courses.map((c) => ({
        courseTitle: c.courseTitle,
        crsCreCd: c.crsCreCd,
        category: c.category === "extracurricular" ? "extracurricular" : "curricular",
        dueAssignments: (c.assignments || []).filter((a) => a.dueNow).length,
        pendingLessons: (c.elearning || []).filter((l) => l.needsWatch).length
    }));
}

/**
 * 과목 코드에서 학기를 읽는다. 예: 2026_2_... → 2026-2
 * 코드가 없으면 현재 월 기준으로 추정한다.
 * @param {string} crsCreCd - 강의실 코드
 * @returns {string} 학기 문자열
 */
export function semesterFromCode(crsCreCd) {
    const m = String(crsCreCd || "").match(/^(\d{4})_(\d)/);
    if (m) return `${m[1]}-${m[2]}`;
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1 >= 8 ? 2 : 1}`;
}

/**
 * 배열을 동시에 최대 n개만 돌린다.
 * 학교 서버 부하를 막기 위해 조회 병렬도를 제한할 때 사용한다.
 * @template T, R
 * @param {T[]} items - 처리할 항목
 * @param {number} limit - 동시 실행 수
 * @param {(item: T, index: number) => Promise<R>} fn - 항목 처리 함수
 * @returns {Promise<R[]>} 원래 순서의 결과 배열
 */
export async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return out;
}

/**
 * JSON 트리에서 학습률 숫자를 찾는다.
 * prgrRatio / progressPercent 키를 우선한다.
 * @param {unknown} obj - 서버 응답 트리
 * @returns {number | null} 반올림된 퍼센트. 없으면 null
 */
export function findProgressPercent(obj) {
    if (obj == null) return null;
    if (typeof obj === "number" && Number.isFinite(obj)) return Math.round(obj);
    if (typeof obj === "string" && obj.trim() !== "" && !Number.isNaN(Number(obj))) {
        return Math.round(Number(obj));
    }
    if (typeof obj !== "object") return null;
    if (Array.isArray(obj)) {
        for (const it of obj) {
            const n = findProgressPercent(it);
            if (n != null) return n;
        }
        return null;
    }
    const rec = /** @type {Record<string, unknown>} */ (obj);
    for (const key of ["prgrRatio", "progressPercent"]) {
        if (key in rec && rec[key] != null) {
            const n = findProgressPercent(rec[key]);
            if (n != null) return n;
        }
    }
    for (const val of Object.values(rec)) {
        const n = findProgressPercent(val);
        if (n != null) return n;
    }
    return null;
}

/**
 * 과제 상세 HTML 에서 본문만 남긴다.
 * @param {string} html - 과제 화면 HTML
 * @returns {string} 태그를 걷어 낸 본문
 */
export function assignmentDetailText(html) {
    if (!html) return "";
    let chunk = html;
    const start = html.indexOf("과제내용");
    if (start >= 0) {
        const rest = html.slice(start);
        const end = rest.indexOf("label-title", 8);
        chunk = end >= 0 ? rest.slice(0, end) : rest.slice(0, 4000);
    }
    return htmlToText(chunk);
}

/**
 * HTML 태그를 걷어 낸 평문을 만든다.
 * @param {string} html - 원본 HTML
 * @returns {string} 공백이 정리된 텍스트
 */
export function htmlToText(html) {
    return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/<[^>]*$/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}
