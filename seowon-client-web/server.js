/**
 * 조회·과제 제출·자료 받기 HTTP 서버.
 *
 * Node 내장 http 만 사용한다. 시청 기록·수강신청 등록은 부르지 않는다.
 * 세션은 메모리 쿠키 sw_sid 로 유지한다.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assignmentMissingOrProgress } from "./lib/filters.js";
import { parseMultipart } from "./lib/multipart.js";
import {
    downloadCampusFile,
    downloadLessonVideo,
    fetchAssignmentDetail,
    fetchMaterialAttachments,
    fetchMaterials,
    fetchProgress,
    fetchScores,
    fetchSnapshot,
    fetchTimetable,
    ensureSugang,
    liveLogin,
    submitAssignment
} from "./lib/query.js";
import { findApiRoot } from "./lib/resolve-api.js";
import { createSession, destroySession, getSession } from "./lib/session.js";

/** 이 파일(seowon-client-web/) 디렉터리 */
const ROOT = path.dirname(fileURLToPath(import.meta.url));
/** 정적 파일 루트 */
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3780);
const HOST = process.env.HOST || "0.0.0.0";
/** 세션 쿠키 이름 */
const COOKIE = "sw_sid";

/** 확장자 → Content-Type */
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png"
};

/** IP → 최근 로그인 시각 목록. 5분 창 제한용 */
const loginHits = new Map();

// --- 요청 도우미 ---

/**
 * 요청 소켓의 원격 IP 를 읽는다.
 * @param {import("node:http").IncomingMessage} req
 * @returns {string}
 */
function clientIp(req) {
    return String(req.socket.remoteAddress || "unknown");
}

/**
 * 같은 IP 의 로그인 시도가 5분에 12회를 넘는지 본다.
 * @param {string} ip - 원격 주소
 * @returns {boolean} 제한이면 true
 */
function tooManyLogins(ip) {
    const now = Date.now();
    const arr = (loginHits.get(ip) || []).filter((t) => now - t < 5 * 60 * 1000);
    arr.push(now);
    loginHits.set(ip, arr);
    return arr.length > 12;
}

/**
 * Cookie 헤더를 이름-값 객체로 푼다.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Record<string, string>}
 */
function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || "").split(";")) {
        const i = part.indexOf("=");
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (!k) continue;
        try {
            out[k] = decodeURIComponent(v);
        } catch {
            out[k] = v;
        }
    }
    return out;
}

/**
 * 요청 본문을 JSON 객체로 읽는다.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<object>}
 */
function readJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let n = 0;
        req.on("data", (c) => {
            n += c.length;
            if (n > 200_000) {
                reject(new Error("요청이 너무 큽니다."));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => {
            if (!chunks.length) return resolve({});
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                reject(new Error("JSON 형식이 아닙니다."));
            }
        });
        req.on("error", reject);
    });
}

/**
 * JSON 응답을 보낸다.
 * @param {import("node:http").ServerResponse} res
 * @param {number} code - HTTP 상태
 * @param {object} obj - 본문 객체
 * @param {Record<string, string>} [extra] - 추가 헤더
 * @returns {void}
 */
function sendJson(res, code, obj, extra = {}) {
    const body = Buffer.from(JSON.stringify(obj), "utf8");
    res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": body.length,
        ...extra
    });
    res.end(body);
}

/**
 * HttpOnly 세션 쿠키 문자열을 만든다. 수명 30분.
 * @param {string} id - 세션 ID
 * @returns {string} Set-Cookie 값
 */
function setSessionCookie(id) {
    return `${COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax; Max-Age=1800`;
}

/**
 * 세션 쿠키를 지우는 Set-Cookie 문자열을 만든다.
 * @returns {string}
 */
function clearSessionCookie() {
    return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

/**
 * 요청 쿠키에서 세션을 찾는다.
 * @param {import("node:http").IncomingMessage} req
 * @returns {object | null}
 */
function sessionOf(req) {
    return getSession(parseCookies(req)[COOKIE]);
}

/**
 * 로그인된 세션이 없으면 401 을 보내고 null 을 반환한다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {object | null}
 */
function needSession(req, res) {
    const sess = sessionOf(req);
    if (!sess) {
        sendJson(res, 401, { ok: false, error: "로그인이 필요합니다." });
        return null;
    }
    return sess;
}

/**
 * 스냅샷 과제를 한 목록으로 펼친다.
 * @param {object} snapshot - 조회 스냅샷
 * @param {string} filter - all | due | missing
 * @returns {object[]}
 */
function flattenAssignments(snapshot, filter) {
    const rows = [];
    for (const c of snapshot.courses || []) {
        for (const a of c.assignments || []) {
            if (filter === "due" && !a.dueNow) continue;
            if (filter === "missing" && !assignmentMissingOrProgress(a.status)) continue;
            rows.push({ ...a, courseTitle: c.courseTitle });
        }
    }
    return rows;
}

/**
 * 스냅샷 차시를 한 목록으로 펼치고 재생 URL 을 붙인다.
 * @param {object} snapshot - 조회 스냅샷
 * @param {string} filter - all | watch
 * @returns {object[]}
 */
function flattenLessons(snapshot, filter) {
    const rows = [];
    for (const c of snapshot.courses || []) {
        for (const l of c.elearning || []) {
            if (filter === "watch" && !l.needsWatch) continue;
            const playUrl =
                `https://ecampus.seowon.ac.kr/lesson/lessonOpen/lessonNewWindow?crsCreCd=${encodeURIComponent(l.crsCreCd)}` +
                `&lessonCntsId=${encodeURIComponent(l.lessonCntsId || "")}`;
            rows.push({ ...l, courseTitle: c.courseTitle, playUrl });
        }
    }
    return rows;
}

/**
 * 세션에 스냅샷이 없으면 학교 서버에서 채운다.
 * @param {object} sess - 웹 세션
 * @returns {Promise<object>}
 */
async function ensureSnapshot(sess) {
    if (sess.snapshot) return sess.snapshot;
    if (!sess.client) throw new Error("세션이 만료되었습니다.");
    const { snapshot, rawAssignments } = await fetchSnapshot(sess.client, sess.student);
    sess.snapshot = snapshot;
    sess.rawAssignments = rawAssignments;
    return snapshot;
}

/**
 * public/ 아래 정적 파일 절대 경로를 고른다. 디렉터리 탈출은 막는다.
 * @param {string} urlPath - 요청 경로
 * @returns {string | null}
 */
function publicFile(urlPath) {
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const abs = path.normalize(path.join(PUBLIC, rel));
    if (!abs.startsWith(PUBLIC)) return null;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return abs;
}

/**
 * 기기의 비루프백 IPv4 주소를 모은다. 시작 로그용.
 * @returns {string[]}
 */
function lanAddresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const it of list || []) {
            if (it.family === "IPv4" && !it.internal) out.push(it.address);
        }
    }
    return out;
}

// --- API 핸들러 ---

/**
 * e-campus 로그인 후 세션 쿠키를 발급한다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleLogin(req, res) {
    const ip = clientIp(req);
    if (tooManyLogins(ip)) {
        sendJson(res, 429, { ok: false, error: "로그인을 너무 자주 시도했습니다. 잠시 뒤에 다시 하세요." });
        return;
    }
    const body = await readJson(req);
    const studentId = String(body.studentId || "").trim();
    const password = String(body.password || "");

    if (!studentId || !password) {
        sendJson(res, 400, { ok: false, error: "학번과 비밀번호를 입력하세요." });
        return;
    }
    if (!findApiRoot()) {
        sendJson(res, 500, {
            ok: false,
            error: "seowon-client-api 를 찾지 못했습니다. SEOWON_CLIENT_API 에 경로를 넣으세요."
        });
        return;
    }

    const { client, student, sugangCreds } = await liveLogin(studentId, password);
    const prev = sessionOf(req);
    if (prev) destroySession(prev.id);
    const sess = createSession({ student, client, sugangCreds });
    sendJson(res, 200, { ok: true, student }, { "Set-Cookie": setSessionCookie(sess.id) });
}

/**
 * 세션을 지우고 쿠키를 만료한다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {void}
 */
function handleLogout(req, res) {
    const sess = sessionOf(req);
    if (sess) destroySession(sess.id);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
}

/**
 * 현재 로그인 여부와 학생 요약을 돌려준다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {void}
 */
function handleMe(req, res) {
    const sess = sessionOf(req);
    if (!sess) {
        sendJson(res, 200, { ok: true, loggedIn: false });
        return;
    }
    sendJson(res, 200, { ok: true, loggedIn: true, student: sess.student });
}

/**
 * SSO 로 이름·학과를 채운 뒤 학생 정보를 돌려준다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleProfile(req, res) {
    const sess = needSession(req, res);
    if (!sess) return;
    try {
        await ensureSugang(sess);
    } catch {
        // 이름·학과를 못 가져와도 세션은 유지
    }
    sendJson(res, 200, { ok: true, student: sess.student });
}

/**
 * 캐시된 과제·이러닝 스냅샷을 돌려준다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleSnapshot(req, res) {
    const sess = needSession(req, res);
    if (!sess) return;
    const snapshot = await ensureSnapshot(sess);
    sendJson(res, 200, { ok: true, snapshot });
}

/**
 * 스냅샷·시간표·성적·자료 캐시를 비우고 다시 조회한다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleRefresh(req, res) {
    const sess = needSession(req, res);
    if (!sess) return;
    const { snapshot, rawAssignments } = await fetchSnapshot(sess.client, sess.student);
    sess.snapshot = snapshot;
    sess.rawAssignments = rawAssignments;
    sess.timetable = null;
    sess.scores = null;
    sess.materials = null;
    sess.rawMaterials = new Map();
    sendJson(res, 200, { ok: true, snapshot });
}

/**
 * 시간표 메타(목록·학점)를 JSON 으로 돌려준다. svg/html 본문은 넣지 않는다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url - refresh=1 이면 캐시를 버린다
 * @returns {Promise<void>}
 */
async function handleTimetable(req, res, url) {
    const sess = needSession(req, res);
    if (!sess) return;
    if (!sess.timetable || url.searchParams.get("refresh") === "1") {
        sess.timetable = await fetchTimetable(sess);
    }
    sendJson(res, 200, {
        ok: true,
        timetable: {
            ...sess.timetable,
            svg: Boolean(sess.timetable.svg),
            html: Boolean(sess.timetable.html)
        }
    });
}

/**
 * HTML 문서를 그대로 보낸다.
 * @param {import("node:http").ServerResponse} res
 * @param {string} html
 * @returns {void}
 */
function sendHtml(res, html) {
    const buf = Buffer.from(String(html || ""), "utf8");
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": buf.length
    });
    res.end(buf);
}

/**
 * 시간표 그림용 HTML 을 iframe 에 보낸다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleTimetableHtml(req, res) {
    try {
        const sess = sessionOf(req);
        if (!sess) {
            sendHtml(res, "<!DOCTYPE html><meta charset=utf-8><p>로그인이 필요합니다.</p>");
            return;
        }
        if (!sess.timetable) sess.timetable = await fetchTimetable(sess);
        if (!sess.timetable?.html) {
            sendHtml(res, "<!DOCTYPE html><meta charset=utf-8><p>시간표 그림을 만들지 못했습니다.</p>");
            return;
        }
        sendHtml(res, sess.timetable.html);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "시간표를 열 수 없습니다.";
        sendHtml(res, `<!DOCTYPE html><meta charset=utf-8><p>${msg}</p>`);
    }
}

/**
 * SVG 를 보낸다. 본문에 <svg> 가 없으면 안내 그림을 만든다.
 * @param {import("node:http").ServerResponse} res
 * @param {string} svg
 * @returns {void}
 */
function sendSvg(res, svg) {
    const raw = String(svg || "");
    const safe = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const body = raw.includes("<svg")
        ? raw
        : `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="720" height="160"><rect width="100%" height="100%" fill="#f2f4f6"/><text x="24" y="88" font-size="16" fill="#191f28">${safe || "시간표 없음"}</text></svg>`;
    const buf = Buffer.from(body, "utf8");
    res.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": buf.length
    });
    res.end(buf);
}

/**
 * 시간표 SVG 원문을 보낸다. 사진 경로로는 HTML 을 쓰는 편이 안전하다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleTimetableSvg(req, res) {
    try {
        const sess = sessionOf(req);
        if (!sess) {
            sendSvg(res, "로그인이 필요합니다. 웹에서 로그인한 뒤 다시 조회하세요.");
            return;
        }
        if (!sess.timetable) sess.timetable = await fetchTimetable(sess);
        if (!sess.timetable?.svg) {
            sendSvg(res, "시간표 그림을 만들지 못했습니다.");
            return;
        }
        sendSvg(res, sess.timetable.svg);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "시간표 그림을 열 수 없습니다.";
        sendSvg(res, msg);
    }
}

/**
 * 과목별 성적 요약을 돌려준다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @returns {Promise<void>}
 */
async function handleScores(req, res, url) {
    const sess = needSession(req, res);
    if (!sess) return;
    if (!sess.scores || url.searchParams.get("refresh") === "1") {
        sess.scores = await fetchScores(sess.client);
    }
    sendJson(res, 200, { ok: true, rows: sess.scores });
}

/**
 * 필터된 과제 목록을 돌려준다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @returns {Promise<void>}
 */
async function handleAssignments(req, res, url) {
    const sess = needSession(req, res);
    if (!sess) return;
    const snapshot = await ensureSnapshot(sess);
    const filter = url.searchParams.get("filter") || "all";
    sendJson(res, 200, { ok: true, rows: flattenAssignments(snapshot, filter) });
}

/**
 * 필터된 이러닝 차시 목록을 돌려준다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @returns {Promise<void>}
 */
async function handleLessons(req, res, url) {
    const sess = needSession(req, res);
    if (!sess) return;
    const snapshot = await ensureSnapshot(sess);
    const filter = url.searchParams.get("filter") || "all";
    sendJson(res, 200, { ok: true, rows: flattenLessons(snapshot, filter) });
}

/**
 * 과목별 미제출·미완료 현황을 돌려준다. 교과/비교과 필터를 받는다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @returns {Promise<void>}
 */
async function handleSummary(req, res, url) {
    const sess = needSession(req, res);
    if (!sess) return;
    const snapshot = await ensureSnapshot(sess);
    const filter = url.searchParams.get("filter") || "all";
    let rows = snapshot.summary || [];
    if (filter === "curricular") {
        rows = rows.filter((r) => r.category !== "extracurricular");
    } else if (filter === "extracurricular") {
        rows = rows.filter((r) => r.category === "extracurricular");
    }
    sendJson(res, 200, { ok: true, rows });
}

/**
 * 과제 상세 본문·첨부·제출 가능 여부를 돌려준다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleDetail(req, res) {
    const sess = needSession(req, res);
    if (!sess) return;
    const body = await readJson(req);
    const crsCreCd = String(body.crsCreCd || "");
    const id = String(body.id || "");
    if (!crsCreCd || !id) {
        sendJson(res, 400, { ok: false, error: "과제를 고르세요." });
        return;
    }
    const raw = sess.rawAssignments?.get(`${crsCreCd}::${id}`);
    const detail = await fetchAssignmentDetail(sess.client, raw, { crsCreCd, id });
    sendJson(res, 200, { ok: true, ...detail });
}

/**
 * multipart 로 받은 과제 제출을 e-campus 폼에 올린다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleSubmit(req, res) {
    const sess = needSession(req, res);
    if (!sess) return;
    const mp = await parseMultipart(req);
    const crsCreCd = String(mp.fields.crsCreCd || "");
    const id = String(mp.fields.id || "");
    const text = String(mp.fields.text || "");
    if (!crsCreCd || !id) {
        sendJson(res, 400, { ok: false, error: "과제를 고르세요." });
        return;
    }
    const raw = sess.rawAssignments?.get(`${crsCreCd}::${id}`);
    const file = mp.files.file;
    await submitAssignment(sess.client, raw, {
        id,
        crsCreCd,
        text,
        file: file
            ? { filename: file.filename, mime: file.mime, data: file.data }
            : undefined
    });
    sess.snapshot = null;
    sendJson(res, 200, { ok: true });
}

/**
 * 강의실 자료 목록을 돌려준다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleMaterials(req, res) {
    const sess = needSession(req, res);
    if (!sess) return;
    if (!sess.materials) {
        const { rows, rawMaterials } = await fetchMaterials(sess.client);
        sess.materials = rows;
        sess.rawMaterials = rawMaterials;
    }
    sendJson(res, 200, { ok: true, rows: sess.materials });
}

/**
 * 자료 한 건의 첨부 목록을 돌려준다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleMaterialFiles(req, res) {
    const sess = needSession(req, res);
    if (!sess) return;
    const body = await readJson(req);
    const crsCreCd = String(body.crsCreCd || "");
    const id = String(body.id || "");
    const raw = sess.rawMaterials?.get(`${crsCreCd}::${id}`);
    const files = await fetchMaterialAttachments(sess.client, raw);
    sendJson(res, 200, { ok: true, files });
}

/**
 * Content-Disposition 에서 파일 이름을 읽는다.
 * @param {string} disp - Content-Disposition 헤더
 * @param {string} fallback - 헤더가 없을 때 쓸 이름
 * @returns {string}
 */
function filenameFromDisposition(disp, fallback) {
    const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disp || "");
    if (star) {
        try {
            return decodeURIComponent(star[1].trim());
        } catch {
            // RFC 5987 디코딩 실패 시 일반 filename 으로
        }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disp || "");
    return (plain && plain[1].trim()) || fallback || "download";
}

/**
 * e-campus 첨부 파일을 받아 브라우저로 흘린다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleDownload(req, res) {
    const sess = needSession(req, res);
    if (!sess) return;
    const body = await readJson(req);
    const url = String(body.url || "");
    if (!url) {
        sendJson(res, 400, { ok: false, error: "받을 파일이 없습니다." });
        return;
    }
    const file = await downloadCampusFile(sess.client, url);
    const name = filenameFromDisposition(file.disposition, body.title || "download");
    const safe = name.replace(/[\r\n"]/g, "_");
    res.writeHead(200, {
        "Content-Type": file.contentType,
        "Content-Length": file.data.length,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safe)}`,
        "Cache-Control": "no-store"
    });
    res.end(file.data);
}

/**
 * 차시 학습률만 조회해 스냅샷에 반영한다. 시청 기록은 보내지 않는다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleProgress(req, res) {
    const sess = needSession(req, res);
    if (!sess) return;
    const body = await readJson(req);
    const crsCreCd = String(body.crsCreCd || "");
    const lessonCntsId = String(body.lessonCntsId || "");
    if (!crsCreCd || !lessonCntsId) {
        sendJson(res, 400, { ok: false, error: "차시를 고르세요." });
        return;
    }
    const pct = await fetchProgress(sess.client, crsCreCd, lessonCntsId, sess.student.studentId);
    if (sess.snapshot) {
        for (const c of sess.snapshot.courses) {
            for (const l of c.elearning) {
                if (l.crsCreCd === crsCreCd && l.lessonCntsId === lessonCntsId) {
                    l.progressPercent = pct;
                }
            }
        }
    }
    sendJson(res, 200, { ok: true, progressPercent: pct });
}

/**
 * 이러닝 영상을 스트림으로 보낸다. 클라이언트가 끊으면 학교 쪽 스트림도 닫는다.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleLessonDownload(req, res) {
    const sess = needSession(req, res);
    if (!sess) return;
    const body = await readJson(req);
    const crsCreCd = String(body.crsCreCd || "");
    const lessonCntsId = String(body.lessonCntsId || "");
    const title = String(body.title || lessonCntsId || "lecture");
    if (!crsCreCd || !lessonCntsId) {
        sendJson(res, 400, { ok: false, error: "차시를 고르세요." });
        return;
    }
    const file = await downloadLessonVideo(sess.client, crsCreCd, lessonCntsId);
    const safe = `${title}.mp4`.replace(/[\\/:*?"<>|\r\n]/g, "_");
    const headers = {
        "Content-Type": file.contentType || "video/mp4",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safe)}`,
        "Cache-Control": "no-store"
    };
    if (file.contentLength) headers["Content-Length"] = String(file.contentLength);
    res.writeHead(200, headers);
    file.stream.on("error", () => {
        if (!res.writableEnded) res.end();
    });
    const stop = () => {
        if (file.stream && !file.stream.destroyed) file.stream.destroy();
    };
    req.on("close", stop);
    res.on("close", stop);
    file.stream.pipe(res);
}

/** METHOD + 경로 → 핸들러 */
const routes = {
    "POST /api/login": handleLogin,
    "POST /api/logout": handleLogout,
    "GET /api/me": handleMe,
    "GET /api/profile": handleProfile,
    "GET /api/snapshot": handleSnapshot,
    "POST /api/refresh": handleRefresh,
    "GET /api/assignments": handleAssignments,
    "GET /api/lessons": handleLessons,
    "GET /api/summary": handleSummary,
    "POST /api/assignment-detail": handleDetail,
    "POST /api/assignment-submit": handleSubmit,
    "GET /api/materials": handleMaterials,
    "POST /api/material-files": handleMaterialFiles,
    "POST /api/download": handleDownload,
    "POST /api/progress": handleProgress,
    "GET /api/timetable": handleTimetable,
    "GET /api/timetable.html": handleTimetableHtml,
    "GET /api/timetable.svg": handleTimetableSvg,
    "POST /api/lesson-download": handleLessonDownload,
    "GET /api/scores": handleScores
};

// --- HTTP 서버 ---

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const key = `${req.method} ${url.pathname}`;
    try {
        if (url.pathname === "/api/health") {
            sendJson(res, 200, { ok: true, api: Boolean(findApiRoot()), queryOnly: true });
            return;
        }
        const fn = routes[key];
        if (fn) {
            await fn(req, res, url);
            return;
        }
        if (req.method === "GET") {
            const file = publicFile(url.pathname);
            if (file) {
                const ext = path.extname(file);
                const buf = fs.readFileSync(file);
                res.writeHead(200, {
                    "Content-Type": MIME[ext] || "application/octet-stream",
                    "Content-Length": buf.length,
                    "Cache-Control":
                        ext === ".html" || ext === ".js" || ext === ".css"
                            ? "no-store"
                            : "public, max-age=3600"
                });
                res.end(buf);
                return;
            }
        }
        if (url.pathname.startsWith("/api/")) {
            sendJson(res, 404, { ok: false, error: "없는 API 입니다." });
            return;
        }
        const index = path.join(PUBLIC, "index.html");
        const buf = fs.readFileSync(index);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(buf);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: msg });
    }
});

server.listen(PORT, HOST, () => {
    const api = findApiRoot();
    console.log("");
    console.log("  서원대 e-campus 웹  (조회 · 제출 · 받기)");
    console.log(`  로컬     http://127.0.0.1:${PORT}`);
    for (const ip of lanAddresses()) {
        console.log(`  같은망   http://${ip}:${PORT}`);
    }
    console.log(api ? `  API      ${api}` : "  API      없음 — SEOWON_CLIENT_API 를 지정하세요.");
    console.log("  자동 시청 · 수강신청 등록은 없습니다.");
    console.log("");
});
