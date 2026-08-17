/**
 * 학생별 인메모리 세션 저장소.
 *
 * 비밀번호는 디스크에 쓰지 않고 시간표 SSO 용으로만 잠시 둔다.
 * 유휴 시간이 지나면 클라이언트 참조와 자격 증명을 지운다.
 */
import crypto from "node:crypto";

/** 세션 유휴 만료(밀리초). 기본 30분 */
const IDLE_MS = Number(process.env.SEOWON_WEB_IDLE_MS || 30 * 60 * 1000);

/** 세션 ID → 세션 객체 */
const sessions = new Map();

/**
 * 새 세션을 만들고 저장소에 넣는다.
 * @param {object} init - 학생 정보·클라이언트·SSO 자격
 * @returns {object} 생성된 세션
 */
export function createSession(init) {
    const id = crypto.randomBytes(24).toString("hex");
    const now = Date.now();
    const sess = {
        id,
        createdAt: now,
        lastSeen: now,
        student: init.student,
        client: init.client || null,
        courseReg: init.courseReg || null,
        hope: init.hope || null,
        sugangCreds: init.sugangCreds || null,
        snapshot: init.snapshot || null,
        rawAssignments: init.rawAssignments || new Map(),
        rawMaterials: init.rawMaterials || new Map(),
        materials: null,
        timetable: null,
        scores: null
    };
    sessions.set(id, sess);
    return sess;
}

/**
 * 쿠키 값으로 세션을 찾는다. 유휴 만료면 지우고 null 을 반환한다.
 * @param {string | undefined} id - 세션 쿠키 값
 * @returns {object | null} 유효한 세션 또는 null
 */
export function getSession(id) {
    if (!id) return null;
    const sess = sessions.get(id);
    if (!sess) return null;
    if (Date.now() - sess.lastSeen > IDLE_MS) {
        destroySession(id);
        return null;
    }
    sess.lastSeen = Date.now();
    return sess;
}

/**
 * 세션을 지운다. 클라이언트 자격과 비밀번호 참조도 끊는다.
 * @param {string} id - 세션 ID
 * @returns {void}
 */
export function destroySession(id) {
    const sess = sessions.get(id);
    if (!sess) {
        sessions.delete(id);
        return;
    }
    for (const key of ["client", "courseReg", "hope"]) {
        const c = sess[key];
        if (!c) continue;
        try {
            c.setCredentials?.({ userId: "", password: "", stuno: "" });
        } catch {
            // 자격 초기화 실패여도 세션은 제거한다
        }
        sess[key] = null;
    }
    if (sess.sugangCreds) {
        sess.sugangCreds.password = "";
        sess.sugangCreds = null;
    }
    sessions.delete(id);
}

/**
 * 만료된 세션을 주기적으로 비운다.
 * @returns {void}
 */
export function sweepSessions() {
    const now = Date.now();
    for (const [id, sess] of sessions) {
        if (now - sess.lastSeen > IDLE_MS) destroySession(id);
    }
}

setInterval(sweepSessions, 60 * 1000).unref();
