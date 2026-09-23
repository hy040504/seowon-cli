/**
 * e-campus 로그인과 시간표용 SSO.
 *
 * 웹은 e-campus 를 먼저 연다. 본신청/희망바구니 로그인은 시간표를 열 때만 붙는다.
 * 수강신청 등록·취소는 부르지 않는다.
 */
import {
  createCourseRegistrationClient,
  createEcampusClient,
  createErpClient,
  createHopeBasketClient,
  type EcampusClient,
  type ErpClient
} from "../../engine/index.js";
import type { WebSession } from "../../types/session.js";
import type { SugangCredentials, WebStudent } from "../../types/student.js";
import { withTimeout } from "../../utils.js";

/** liveLogin 결과 */
export interface LiveLoginResult {
  client: EcampusClient;
  student: WebStudent;
  sugangCreds: SugangCredentials;
}

/**
 * SSO 응답에서 이름·학과를 학생 객체에 채운다.
 * @param student - 세션 학생 정보
 * @param sugang - 수강신청·희망바구니 로그인 결과
 */
function applyStudent(student: WebStudent, sugang: unknown): void {
  const rec = (sugang && typeof sugang === "object" ? sugang : {}) as {
    student?: { stdntNm?: string; deprtNm?: string; deptCd?: string; deprtCd?: string };
    session?: { userNm?: string; deptNm?: string };
  };
  if (rec.student) {
    student.studentName = rec.student.stdntNm || rec.session?.userNm || student.studentName;
    student.deptName = rec.student.deprtNm || rec.session?.deptNm || student.deptName;
    student.deptCd = rec.student.deptCd || rec.student.deprtCd || student.deptCd;
    return;
  }
  if (rec.session) {
    student.studentName = rec.session.userNm || student.studentName;
    student.deptName = rec.session.deptNm || student.deptName;
  }
}

/**
 * e-campus 만 먼저 로그인한다. 시간표용 SSO 는 나중에 연다.
 * @param studentId - 학번
 * @param password - 비밀번호
 * @returns 클라이언트·학생 요약·SSO 자격
 */
export async function liveLogin(studentId: string, password: string): Promise<LiveLoginResult> {
  const client = createEcampusClient();
  const result = await withTimeout(client.login({ userId: studentId, password }), 20000, "e-campus 로그인");

  if (result.type === "error") {
    throw new Error(result.message || "아이디 또는 비밀번호가 맞지 않습니다.");
  }

  const userNo = String(result.data?.userNo || studentId);
  const student: WebStudent = {
    studentId,
    userNo,
    studentName: "",
    deptName: "",
    deptCd: ""
  };

  const sugangCreds = { stuno: studentId, password };

  // e-campus 로그인 직후 시간표 SSO를 연동하여 학생 프로필(이름·학과)을 즉시 동기화
  try {
    const courseReg = createCourseRegistrationClient();
    const sugang = await withTimeout(
      courseReg.login({ stuno: studentId, password }, { mode: "fast" }),
      10000,
      "시간표 로그인"
    );
    if (sugang?.success) {
      applyStudent(student, sugang);
    } else {
      const hope = createHopeBasketClient();
      const basket = await withTimeout(hope.login({ stuno: studentId, password }), 8000, "희망바구니 로그인");
      if (basket?.success) {
        applyStudent(student, basket);
      }
    }
  } catch {
    // SSO 실패 시에도 e-campus 로그인은 유지
  }

  return {
    client,
    student,
    sugangCreds
  };
}

/**
 * 시간표를 열 때만 수강신청 SSO 에 붙는다. 등록·취소는 부르지 않는다.
 * 본신청 실패 시 희망바구니로 넘긴다.
 * @param sess - 웹 세션
 */
export async function ensureSugang(sess: WebSession): Promise<void> {
  if (sess.courseReg || sess.hope) return;
  const creds = sess.sugangCreds;
  if (!creds?.stuno || !creds.password) {
    throw new Error("다시 로그인하세요.");
  }
  try {
    const courseReg = createCourseRegistrationClient();
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
    const hope = createHopeBasketClient();
    const basket = await withTimeout(hope.login({ stuno: creds.stuno, password: creds.password }), 12000, "시간표 로그인");
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

/**
 * 필요 시 희망바구니 클라이언트에 SSO 로그인하여 리턴한다.
 * @param sess - 웹 세션
 */
export async function ensureHope(sess: WebSession) {
  if (sess.hope) return sess.hope;
  const creds = sess.sugangCreds;
  if (!creds?.stuno || !creds.password) {
    throw new Error("다시 로그인하세요.");
  }
  const hope = createHopeBasketClient();
  const basket = await withTimeout(hope.login({ stuno: creds.stuno, password: creds.password }), 12000, "희망바구니 로그인");
  if (basket?.success) {
    applyStudent(sess.student, basket);
    sess.hope = hope;
    return hope;
  }
  throw new Error("희망바구니 서버에 연결하지 못했습니다.");
}

/**
 * 지난 성적 조회용 통합정보시스템 ERP 클라이언트에 로그인한다.
 * 쿠키는 세션 메모리에만 두고 디스크에 쓰지 않는다.
 * @param sess - 웹 세션
 * @returns ERP 클라이언트
 */
export async function ensureErp(sess: WebSession): Promise<ErpClient> {
  if (sess.erp) return sess.erp;
  const creds = sess.sugangCreds;
  if (!creds?.stuno || !creds.password) {
    throw new Error("다시 로그인하세요.");
  }
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const erp = createErpClient();
      const result = await withTimeout(
        erp.login({ uid: creds.stuno, password: creds.password }),
        25000,
        "ERP 로그인"
      );
      if (!result?.success) {
        lastError = new Error(result?.message || "통합정보시스템에 연결하지 못했습니다.");
        continue;
      }
      if (result.student) {
        sess.student.studentName = result.student.stdntNm || sess.student.studentName;
        sess.student.deptName = result.student.deptNm || result.student.deprtNm || sess.student.deptName;
        sess.student.deptCd = result.student.deptCd || result.student.deprtCd || sess.student.deptCd;
      } else if (result.session) {
        sess.student.studentName = result.session.userNm || sess.student.studentName;
        sess.student.deptName = result.session.deptNm || sess.student.deptName;
      }
      sess.erp = erp;
      return erp;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError || new Error("통합정보시스템에 연결하지 못했습니다.");
}

