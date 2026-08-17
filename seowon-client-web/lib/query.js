/**
 * seowon-client-api 조회·제출 계층.
 *
 * 과제·자료·이러닝·시간표·성적을 다룬다.
 * 시청 기록 적재와 수강신청 등록·취소는 부르지 않는다.
 */
import { loadClientApi } from "./resolve-api.js";
import { parseAssignmentSubmitForm } from "./multipart.js";
import {
    assignmentDetailText,
    buildSummary,
    findProgressPercent,
    mapLimit,
    markAssignment,
    markLesson,
    semesterFromCode
} from "./filters.js";

/** 과제·자료 목록 페이지 크기 */
const LIST_SCALE = "100";
/** 과목별 조회 동시 실행 수 */
const FETCH_LIMIT = 3;

/**
 * Promise 에 시간 제한을 건다.
 * @param {Promise<unknown>} promise - 대기할 작업
 * @param {number} ms - 제한 밀리초
 * @param {string} label - 초과 시 메시지에 붙일 이름
 * @returns {Promise<unknown>} 원본 결과 또는 시간 초과 거부
 */
function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label} 시간이 초과되었습니다.`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/**
 * SSO 응답에서 이름·학과를 학생 객체에 채운다.
 * @param {object} student - 세션 학생 정보
 * @param {object} sugang - 수강신청·희망바구니 로그인 결과
 * @returns {void}
 */
function applyStudent(student, sugang) {
    if (sugang?.student) {
        student.studentName = sugang.student.stdntNm || sugang.session?.userNm || student.studentName;
        student.deptName = sugang.student.deprtNm || sugang.session?.deptNm || student.deptName;
        student.deptCd = sugang.student.deptCd || sugang.student.deprtCd || student.deptCd;
        return;
    }
    if (sugang?.session) {
        student.studentName = sugang.session.userNm || student.studentName;
        student.deptName = sugang.session.deptNm || student.deptName;
    }
}

/**
 * e-campus 만 먼저 로그인한다. 시간표용 SSO 는 나중에 연다.
 * @param {string} studentId - 학번
 * @param {string} password - 비밀번호
 * @returns {Promise<{ client: object, student: object, sugangCreds: object }>}
 */
export async function liveLogin(studentId, password) {
    const { api } = await loadClientApi();
    const client = api.createEcampusClient();
    const result = await withTimeout(client.login({ userId: studentId, password }), 20000, "e-campus 로그인");

    if (result.type === "error") {
        throw new Error(result.message || "아이디 또는 비밀번호가 맞지 않습니다.");
    }

    const userNo = String(result.data?.userNo || studentId);
    const student = {
        studentId,
        userNo,
        studentName: "",
        deptName: "",
        deptCd: ""
    };

    return {
        client,
        student,
        sugangCreds: { stuno: studentId, password }
    };
}

/**
 * 시간표를 열 때만 수강신청 SSO 에 붙는다. 등록·취소는 부르지 않는다.
 * 본신청 실패 시 희망바구니로 넘긴다.
 * @param {object} sess - 웹 세션
 * @returns {Promise<void>}
 */
export async function ensureSugang(sess) {
    if (sess.courseReg || sess.hope) return;
    const creds = sess.sugangCreds;
    if (!creds?.stuno || !creds.password) {
        throw new Error("다시 로그인하세요.");
    }
    const { api } = await loadClientApi();

    try {
        const courseReg = api.createCourseRegistrationClient({ cookieFilePath: "" });
        const sugang = await withTimeout(
            courseReg.login({ stuno: creds.stuno, password: creds.password }, { mode: "fast" }),
            18000,
            "시간표 로그인"
        );
        if (sugang?.success) {
            applyStudent(sess.student, sugang);
            sess.courseReg = courseReg;
            return;
        }
    } catch {
        // 본신청 실패 시 희망바구니로 넘긴다
    }

    try {
        const hope = api.createHopeBasketClient();
        const basket = await withTimeout(
            hope.login({ stuno: creds.stuno, password: creds.password }),
            12000,
            "시간표 로그인"
        );
        if (basket?.success) {
            applyStudent(sess.student, basket);
            sess.hope = hope;
            return;
        }
    } catch {
        // 두 SSO 모두 실패하면 아래 throw
    }

    throw new Error("시간표 서버에 연결하지 못했습니다.");
}

/** 서원대 학부 교시 → [시작분, 종료분] (자정 기준) */
const PERIOD_MIN = {
    1: [9 * 60, 9 * 60 + 50],
    2: [10 * 60, 10 * 60 + 50],
    3: [11 * 60, 11 * 60 + 50],
    4: [12 * 60, 12 * 60 + 50],
    5: [13 * 60, 13 * 60 + 50],
    6: [14 * 60, 14 * 60 + 50],
    7: [15 * 60, 15 * 60 + 50],
    8: [16 * 60, 16 * 60 + 50],
    9: [17 * 60, 17 * 60 + 50],
    10: [18 * 60, 18 * 60 + 50],
    11: [19 * 60, 19 * 60 + 50],
    12: [20 * 60, 20 * 60 + 50],
    13: [21 * 60, 21 * 60 + 50],
    14: [22 * 60, 22 * 60 + 50]
};

/** 요일 한글 → Date.getDay() 값 */
const DAY_NUM = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

/**
 * "월 1,2,3 공학관" / "화1-2" 같은 문자열을 요일·분 단위 슬롯으로 푼다.
 * @param {string} raw - timtbNm 원문
 * @returns {{ day: number, period: number, startMin: number, endMin: number }[]}
 */
export function parseLectureSlots(raw) {
    const slots = [];
    const text = String(raw || "");
    const re = /(월|화|수|목|금|토|일)\s*([0-9,\s~\-–]+)/g;
    let m;
    while ((m = re.exec(text))) {
        const day = DAY_NUM[m[1]];
        if (day == null) continue;
        const parts = String(m[2] || "").split(/[,\s]+/).filter(Boolean);
        for (const part of parts) {
            const range = part.match(/^(\d+)\s*[~\-–]\s*(\d+)$/);
            const nums = [];
            if (range) {
                const a = Number(range[1]);
                const b = Number(range[2]);
                for (let p = Math.min(a, b); p <= Math.max(a, b); p++) nums.push(p);
            } else if (/^\d+$/.test(part)) {
                nums.push(Number(part));
            }
            for (const p of nums) {
                const t = PERIOD_MIN[p];
                if (!t) continue;
                slots.push({ day, period: p, startMin: t[0], endMin: t[1] });
            }
        }
    }
    return slots;
}

/**
 * 이수 구분 코드·명칭에서 전공/교양 표기를 만든다.
 * @param {object} s - 과목 행
 * @returns {string} 전공 · 교양 · 기타
 */
function courseKind(s) {
    const cd = String(s.cmpsjDivCd || "");
    const nm = String(s.estblCrseDivNm || s.cmpsjDivNm || "");
    const blob = `${cd} ${nm}`;
    if (/교양|교필|교선/.test(blob) || ["03", "04", "21", "22"].includes(cd)) return "교양";
    if (/전공|전필|전선/.test(blob) || ["01", "02", "11", "12"].includes(cd)) return "전공";
    return nm || "기타";
}

/**
 * API 시간표를 화면용 과목 목록으로 얇게 직렬화한다.
 * @param {object} tt - getMyRegisteredTimetable / 희망바구니 시간표
 * @returns {object} 과목 수·학점·슬롯이 포함된 요약
 */
function serializeTimetable(tt) {
    return {
        courseCount: tt.courseCount || 0,
        totalCredits: tt.totalCredits || 0,
        conflictCount: Array.isArray(tt.conflicts) ? tt.conflicts.length : 0,
        subjects: (tt.subjects || []).map((s) => ({
            subjtCd: s.subjtCd || "",
            subjtNm: s.subjtNm || "",
            corseDvclsNo: s.corseDvclsNo || "",
            cmpsjCdt: s.cmpsjCdt || "",
            chrgInstrEmpnm: s.chrgInstrEmpnm || "",
            timtbNm: String(s.timtbNm || "").replace(/\s+/g, " ").trim(),
            kind: courseKind(s),
            slots: parseLectureSlots(s.timtbNm)
        }))
    };
}

/** 격자 SVG 에 쓰는 평일 */
const GRID_DAYS = ["월", "화", "수", "목", "금"];

/**
 * 시간표 셀을 요일:교시 키로 모은다.
 * cells 가 없으면 timtbNm 슬롯으로 채운다.
 * @param {object} timetable - API 시간표
 * @returns {Map<string, { name: string, place: string }[]>}
 */
function collectGridCells(timetable) {
    const map = new Map();
    const push = (day, period, name, place) => {
        if (!GRID_DAYS.includes(day) || !period) return;
        const key = `${day}:${period}`;
        const arr = map.get(key) || [];
        arr.push({ name: name || "", place: place || "" });
        map.set(key, arr);
    };
    for (const cell of timetable.cells || []) {
        for (const sub of cell.subjects || []) {
            push(cell.day, cell.period, sub.subjtNm, sub.place);
        }
    }
    if (!map.size) {
        for (const s of timetable.subjects || []) {
            for (const sl of parseLectureSlots(s.timtbNm)) {
                const day = ["일", "월", "화", "수", "목", "금", "토"][sl.day];
                push(day, sl.period, s.subjtNm, "");
            }
        }
    }
    return map;
}

/**
 * 공식 SVG 가 없을 때 쓰는 흰 배경 격자 그림.
 * @param {object} _api - 미사용. 호출 형태 맞춤
 * @param {object} timetable - 직렬화 전 시간표
 * @param {string} title - 그림 제목
 * @returns {string} SVG 문자열
 */
function renderTimetableSvg(_api, timetable, title) {
    const cells = collectGridCells(timetable);
    let maxPeriod = 10;
    for (const key of cells.keys()) {
        const p = Number(String(key).split(":")[1]);
        if (p > maxPeriod) maxPeriod = p;
    }
    const colW = 148;
    const rowH = 52;
    const left = 64;
    const top = 72;
    const width = left + GRID_DAYS.length * colW + 16;
    const height = top + maxPeriod * rowH + 16;
    const parts = [];
    parts.push(
        `<?xml version="1.0" encoding="UTF-8"?>` +
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    );
    parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
    parts.push(
        `<text x="16" y="32" font-family="Malgun Gothic, sans-serif" font-size="18" font-weight="700" fill="#191f28">${escapeXml(title)}</text>`
    );
    parts.push(
        `<text x="16" y="52" font-family="Malgun Gothic, sans-serif" font-size="12" fill="#8b95a1">${(timetable.subjects || []).length}과목 · ${timetable.totalCredits || 0}학점</text>`
    );
    parts.push(`<rect x="8" y="${top - 28}" width="${left}" height="28" fill="#191f28"/>`);
    parts.push(
        `<text x="${8 + left / 2}" y="${top - 10}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="12" fill="#fff">교시</text>`
    );
    GRID_DAYS.forEach((d, i) => {
        const x = 8 + left + i * colW;
        parts.push(`<rect x="${x}" y="${top - 28}" width="${colW}" height="28" fill="#191f28"/>`);
        parts.push(
            `<text x="${x + colW / 2}" y="${top - 10}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="13" font-weight="700" fill="#fff">${d}</text>`
        );
    });
    for (let p = 1; p <= maxPeriod; p++) {
        const y = top + (p - 1) * rowH;
        parts.push(`<rect x="8" y="${y}" width="${left}" height="${rowH}" fill="#ffffff" stroke="#e5e8eb"/>`);
        parts.push(
            `<text x="${8 + left / 2}" y="${y + 30}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="12" fill="#4e5968">${p}</text>`
        );
        GRID_DAYS.forEach((d, i) => {
            const x = 8 + left + i * colW;
            const items = cells.get(`${d}:${p}`) || [];
            parts.push(`<rect x="${x}" y="${y}" width="${colW}" height="${rowH}" fill="#ffffff" stroke="#e5e8eb"/>`);
            if (items[0]) {
                parts.push(`<rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" rx="8" fill="#e8f3ff"/>`);
                parts.push(
                    `<text x="${x + colW / 2}" y="${y + 24}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="12" font-weight="700" fill="#191f28">${escapeXml((items[0].name || "").slice(0, 10))}</text>`
                );
                if (items[0].place) {
                    parts.push(
                        `<text x="${x + colW / 2}" y="${y + 40}" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="10" fill="#8b95a1">${escapeXml(items[0].place.slice(0, 12))}</text>`
                    );
                }
            }
        });
    }
    parts.push(`</svg>`);
    return parts.join("");
}

/**
 * SVG/HTML 텍스트에 넣을 문자열을 이스케이프한다.
 * @param {string} s - 원문
 * @returns {string} 이스케이프된 문자열
 */
function escapeXml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * 공식 SVG 의 연보라 캔버스·좌우/하단 여백을 잘라 흰 표만 남긴다.
 * 공식 렌더 padX=20, footerH=40 을 viewBox 로 자른다.
 * @param {string} svg - 원본 SVG
 * @returns {string} 잘린 SVG
 */
function tightenOfficialSvg(svg) {
    let out = String(svg || "")
        .replace(/fill="#f4f6fb"/gi, 'fill="#ffffff"')
        .replace(/fill="#eef2ff"/gi, 'fill="#ffffff"');

    out = out.replace(
        /<svg([^>]*?)\bwidth="(\d+(?:\.\d+)?)"([^>]*?)\bheight="(\d+(?:\.\d+)?)"([^>]*?)\bviewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/i,
        (_, a1, w, a2, h, a3, vw, vh) => {
            const padX = 20;
            const footerH = 40;
            const nw = Math.max(80, Number(w) - padX * 2);
            const nh = Math.max(80, Number(h) - footerH);
            const nvw = Math.max(80, Number(vw) - padX * 2);
            const nvh = Math.max(80, Number(vh) - footerH);
            return `<svg${a1}width="${nw}"${a2}height="${nh}"${a3}viewBox="${padX} 0 ${nvw} ${nvh}"`;
        }
    );
    return out;
}

/**
 * 시간표 SVG 를 iframe 용 흰 HTML 로 감싼다.
 * 로드·리사이즈 시 부모에게 tt-size 를 보낸다.
 * @param {string} title - 문서 제목
 * @param {string} svg - 본문 SVG
 * @returns {string} HTML 문서
 */
function wrapOfficialHtml(title, svg) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeXml(title)}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #ffffff; }
    .wrap { display: inline-block; background: #ffffff; line-height: 0; }
    svg { display: block; max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <div class="wrap" id="timetable-root">${svg}</div>
  <script>
    function reportSize() {
      var root = document.getElementById("timetable-root");
      if (!root || !parent) return;
      var r = root.getBoundingClientRect();
      parent.postMessage({ type: "tt-size", w: Math.ceil(r.width), h: Math.ceil(r.height) }, "*");
    }
    window.addEventListener("load", reportSize);
    window.addEventListener("resize", reportSize);
  </script>
</body>
</html>`;
}

/**
 * 공식 렌더가 있으면 쓰고, 실패하면 격자 SVG 로 대체한다.
 * @param {object} api - seowon-client-api 모듈
 * @param {object} timetable - API 시간표
 * @param {string} title - 그림 제목
 * @returns {string} SVG 문자열
 */
function officialSvg(api, timetable, title) {
    try {
        if (typeof api.renderHopeBasketTimetableSvg === "function") {
            const svg = api.renderHopeBasketTimetableSvg(timetable, { title });
            if (svg && String(svg).includes("<svg")) return tightenOfficialSvg(String(svg));
        }
    } catch {
        // 우리 격자 SVG 로 대체
    }
    return renderTimetableSvg(api, timetable, title);
}

/**
 * 확정 수강 시간표를 가져온다. 없으면 희망바구니 시간표.
 * 이미지는 API SVG 렌더를 HTML 로 감싼 값이다.
 * @param {{ courseReg?: object, hope?: object, student: object }} sess - 웹 세션
 * @returns {Promise<object>} 목록·svg·html 이 포함된 시간표
 */
export async function fetchTimetable(sess) {
    await ensureSugang(sess);
    const { api } = await loadClientApi();
    const name = sess.student?.studentName || "";

    if (sess.courseReg) {
        const timetable = await sess.courseReg.getMyRegisteredTimetable();
        const title = name ? `${name} 수강 시간표` : "수강 시간표";
        const svg = officialSvg(api, timetable, title);
        return {
            source: "registered",
            label: "수강 시간표",
            title,
            ...serializeTimetable(timetable),
            svg,
            html: wrapOfficialHtml(title, svg)
        };
    }

    if (sess.hope) {
        const timetable = await sess.hope.getMyHopeBasketTimetable();
        const title = name ? `${name} 희망바구니 시간표` : "희망바구니 시간표";
        const svg = officialSvg(api, timetable, title);
        return {
            source: "basket",
            label: "희망바구니 시간표",
            title,
            ...serializeTimetable(timetable),
            svg,
            html: wrapOfficialHtml(title, svg)
        };
    }

    throw new Error("시간표를 열 세션이 없습니다. 다시 로그인하세요.");
}

/**
 * 과목별 성적 요약을 가져온다. 공개 안 된 과목은 메시지만 둔다.
 * @param {object} client - e-campus 클라이언트
 * @returns {Promise<object[]>} 성적 행 목록
 */
export async function fetchScores(client) {
    const list = await client.getCourseList();
    return mapLimit(list, FETCH_LIMIT, async (c) => {
        try {
            const sum = await client.getScoreSummary({ crsCreCd: c.crsCreCd });
            return {
                courseTitle: c.title,
                crsCreCd: c.crsCreCd,
                canView: true,
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
                message: err instanceof Error ? err.message : "성적을 열 수 없습니다.",
                total: "",
                grade: "",
                items: []
            };
        }
    });
}

/**
 * 전 과목 과제·이러닝을 모아 스냅샷을 만든다.
 * @param {object} client - e-campus 클라이언트
 * @param {object} student - 학번·userNo 가 있는 학생 정보
 * @returns {Promise<{ snapshot: object, rawAssignments: Map<string, object> }>}
 */
export async function fetchSnapshot(client, student) {
    const now = new Date();
    const list = await client.getCourseList();
    const courses = await mapLimit(list, FETCH_LIMIT, async (c) => {
        let assignments = [];
        let lessons = [];
        try {
            assignments = await client.getAssignmentList({
                crsCreCd: c.crsCreCd,
                userNo: student.userNo,
                userName: student.studentName || "",
                listScale: Number(LIST_SCALE)
            });
        } catch {
            assignments = [];
        }
        try {
            lessons = await client.getElearningLessonList({ crsCreCd: c.crsCreCd });
        } catch {
            lessons = [];
        }
        return {
            courseTitle: c.title,
            crsCreCd: c.crsCreCd,
            category: c.crsTypeCd === "CO" ? "extracurricular" : "curricular",
            assignments: assignments.map((a) =>
                markAssignment(
                    {
                        id: a.id,
                        title: a.title || "",
                        period: a.period || "",
                        status: a.status || "",
                        crsCreCd: c.crsCreCd
                    },
                    now
                )
            ),
            elearning: lessons.map((l) =>
                markLesson(
                    {
                        id: l.lessonCntsId,
                        week: l.scheduleTitle || "",
                        title: l.title || "",
                        period: l.period || "",
                        attendanceStatus: String(l.attendanceStatus || "")
                            .replace(/강의보기/g, "")
                            .replace(/\s*[xX×]\s*$/g, "")
                            .replace(/\s{2,}/g, " ")
                            .trim(),
                        progressPercent: null,
                        lessonCntsId: l.lessonCntsId,
                        crsCreCd: c.crsCreCd
                    },
                    now
                )
            ),
            _rawAssignments: assignments
        };
    });

    const rawAssignments = new Map();
    for (const c of courses) {
        for (const raw of c._rawAssignments || []) {
            rawAssignments.set(`${c.crsCreCd}::${raw.id}`, raw);
        }
        delete c._rawAssignments;
    }

    const snapshot = {
        savedAt: new Date().toISOString(),
        semester: semesterFromCode(courses[0]?.crsCreCd),
        courses,
        summary: buildSummary(courses)
    };
    return { snapshot, rawAssignments };
}

/**
 * 과제 상세 HTML 을 연다. 목록 raw 요청이 있으면 그대로 재전송한다.
 * @param {object} client - e-campus 클라이언트
 * @param {object} [raw] - 목록에서 온 과제 원본
 * @param {{ id?: string, crsCreCd?: string }} [ids] - 과제 식별자
 * @returns {Promise<string>} HTML 본문
 */
async function postAssignmentPage(client, raw, ids) {
    if (raw?.request?.url) {
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
        return typeof response.data === "string" ? response.data : "";
    }
    if (ids?.id && ids?.crsCreCd) {
        const response = await client.http.post(
            "/asmnt/asmntLect/Form/asmntStuMain",
            new URLSearchParams({ asmntCd: ids.id, crsCreCd: ids.crsCreCd }),
            {
                headers: {
                    Accept: "text/html, */*; q=0.01",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
                }
            }
        );
        return typeof response.data === "string" ? response.data : "";
    }
    throw new Error("과제 상세를 열 정보가 없습니다.");
}

/**
 * 과제 상세 본문·첨부·제출 폼을 읽는다.
 * @param {object} client - e-campus 클라이언트
 * @param {object} raw - 목록 원본 과제
 * @param {{ id?: string, crsCreCd?: string }} [ids] - 과제 식별자
 * @returns {Promise<{ text: string, attachments: object[], canSubmit: boolean, formAction: string }>}
 */
export async function fetchAssignmentDetail(client, raw, ids = {}) {
    const html = await postAssignmentPage(client, raw, ids);
    const { api } = await loadClientApi();
    const attachments = api.parseEcampusClassroomAttachmentsHtml(html, { baseUrl: client.baseUrl }) || [];
    const form = parseAssignmentSubmitForm(html, client.baseUrl);
    return {
        text: assignmentDetailText(html),
        attachments: attachments.map((a) => ({ title: a.title, url: a.url })),
        canSubmit: Boolean(form && (form.action || form.textField || form.fileField)),
        formAction: form?.action || ""
    };
}

/**
 * 상세 화면 폼으로 과제를 제출한다. 수강신청이 아니다.
 * action 호스트가 seowon.ac.kr 인지 확인한 뒤 전송한다.
 * @param {object} client - e-campus 클라이언트
 * @param {object} raw - 목록 원본 과제
 * @param {{ id: string, crsCreCd: string, text: string, file?: { filename: string, mime: string, data: Buffer } }} payload - 제출 내용
 * @returns {Promise<{ ok: true, status: number }>}
 */
export async function submitAssignment(client, raw, payload) {
    const html = await postAssignmentPage(client, raw, payload);
    const form = parseAssignmentSubmitForm(html, client.baseUrl);
    if (!form) {
        throw new Error("이 과제 화면에서 제출 양식을 찾지 못했습니다. e-campus 에서 직접 제출하세요.");
    }
    let action = form.action;
    if (!action) {
        throw new Error("제출 주소를 읽지 못했습니다.");
    }
    const actionUrl = new URL(action, client.baseUrl);
    if (!actionUrl.hostname.endsWith("seowon.ac.kr")) {
        throw new Error("허용되지 않은 제출 주소입니다.");
    }

    const fields = { ...form.fields };
    if (payload.id) fields.asmntCd = payload.id;
    if (payload.crsCreCd) fields.crsCreCd = payload.crsCreCd;
    if (form.textField) fields[form.textField] = payload.text || "";

    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
        fd.append(k, v == null ? "" : String(v));
    }
    if (payload.file && form.fileField) {
        const blob = new Blob([payload.file.data], { type: payload.file.mime || "application/octet-stream" });
        fd.append(form.fileField, blob, payload.file.filename || "upload.bin");
    }

    const response = await client.http.post(actionUrl.pathname + actionUrl.search, fd, {
        headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true
    });
    const body = typeof response.data === "string" ? response.data : "";
    const ok =
        response.status >= 200 &&
        response.status < 400 &&
        !/오류|실패|error|권한이 없/i.test(body.slice(0, 2000));
    if (!ok) {
        throw new Error("제출 응답이 성공으로 보이지 않습니다. e-campus 에서 확인하세요.");
    }
    return { ok: true, status: response.status };
}

/**
 * 전 과목 강의자료실 목록을 모은다.
 * @param {object} client - e-campus 클라이언트
 * @returns {Promise<{ rows: object[], rawMaterials: Map<string, object> }>}
 */
export async function fetchMaterials(client) {
    const list = await client.getCourseList();
    const rawMaterials = new Map();
    const rows = [];
    await mapLimit(list, FETCH_LIMIT, async (c) => {
        let items = [];
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
 * 강의자료 한 건의 첨부 목록을 가져온다.
 * @param {object} client - e-campus 클라이언트
 * @param {object} raw - 자료 원본
 * @returns {Promise<{ title: string, url: string }[]>}
 */
export async function fetchMaterialAttachments(client, raw) {
    if (!raw) throw new Error("자료를 고르세요.");
    const list = await client.getMaterialAttachments(raw);
    return (list || []).map((a) => ({ title: a.title || "첨부파일", url: a.url }));
}

/**
 * 이러닝 영상 주소를 찾아 스트림으로 연다. 시청 기록은 보내지 않는다.
 * @param {object} client - e-campus 클라이언트
 * @param {string} crsCreCd - 강의실 코드
 * @param {string} lessonCntsId - 차시 콘텐츠 ID
 * @returns {Promise<{ stream: import("node:stream").Readable, contentType: string, contentLength: string, filename: string }>}
 */
export async function downloadLessonVideo(client, crsCreCd, lessonCntsId) {
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
        stream: response.data,
        contentType: String(response.headers["content-type"] || "video/mp4"),
        contentLength: response.headers["content-length"] || "",
        filename: `${lessonCntsId}.mp4`
    };
}

/**
 * e-campus 첨부 파일을 받아 버퍼로 돌려준다.
 * seowon.ac.kr 호스트만 허용한다.
 * @param {object} client - e-campus 클라이언트
 * @param {string} url - 첨부 절대·상대 URL
 * @returns {Promise<{ data: Buffer, contentType: string, disposition: string }>}
 */
export async function downloadCampusFile(client, url) {
    const abs = new URL(url, client.baseUrl);
    if (!abs.hostname.endsWith("seowon.ac.kr")) {
        throw new Error("허용되지 않은 주소입니다.");
    }
    const response = await client.http.get(abs.pathname + abs.search, {
        responseType: "arraybuffer",
        headers: { Accept: "*/*" },
        maxContentLength: 50 * 1024 * 1024
    });
    return {
        data: Buffer.from(response.data),
        contentType: String(response.headers["content-type"] || "application/octet-stream"),
        disposition: String(response.headers["content-disposition"] || "")
    };
}

/**
 * 선택한 차시 학습률만 조회한다. 시청 기록은 보내지 않는다.
 * @param {object} client - e-campus 클라이언트
 * @param {string} crsCreCd - 강의실 코드
 * @param {string} lessonCntsId - 차시 콘텐츠 ID
 * @param {string} studentId - 학번
 * @returns {Promise<number>} 학습률 퍼센트
 */
export async function fetchProgress(client, crsCreCd, lessonCntsId, studentId) {
    const stdNo = `${crsCreCd}_${studentId}`;
    const response = await client.http.post(
        "/lesson/lessonLect/viewLessonStudyDetail",
        new URLSearchParams({
            lessonCntsId,
            prgrRatioTypeCd: "STUDY_TOTAL_TM",
            stdNo,
            crsCreCd,
            pageIndex: "1",
            listScale: "10"
        }),
        {
            headers: {
                Accept: "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            }
        }
    );
    let data = response.data;
    if (typeof data === "string") {
        try {
            data = JSON.parse(data);
        } catch {
            // JSON 이 아니면 문자열 트리에서 숫자를 찾는다
        }
    }
    const pct = findProgressPercent(data);
    if (pct == null) throw new Error("학습률을 읽지 못했습니다.");
    return pct;
}

/** @see {@link findApiRoot} — 구현은 resolve-api.js */
export { findApiRoot } from "./resolve-api.js";
