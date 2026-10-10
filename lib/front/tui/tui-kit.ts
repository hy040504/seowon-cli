// @ts-nocheck
/**
 * seowon-cli TUI 공통 키트.
 * 메뉴 포인터, 표, API 추적, 파일 선택과 확인 버튼을 제공한다.
 * 키보드만 쓴다. 마우스 추적·클릭 선택은 넣지 않는다.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { sanitizeTerminalText } from "../../back/utils.js";
import { formatTraceCall } from "./security.js";

/** 터미널 제어 시퀀스를 시작하는 Escape 문자. */
const ESC = "\x1b";
/** 터미널의 마우스 이동·클릭 추적 모드를 해제하는 제어 시퀀스. */
const MOUSE_OFF = `${ESC}[?1003l${ESC}[?1006l${ESC}[?1002l${ESC}[?1000l`;

/** 아직 완성되지 않은 키보드 입력 시퀀스를 보관하는 버퍼. */
let acc = "";
/** 해석을 마친 키 입력을 소비할 때까지 보관하는 대기열. */
const queue = [];
/** 다음 키 입력을 기다리는 단일 소비자의 콜백. */
let waiter = null;
/** 단독 Escape와 분할 수신한 제어 시퀀스를 구분하는 대기 타이머. */
let escTimer = null;
/** 이전 raw 입력 작업의 정리가 새 작업을 덮지 않도록 구분하는 세대 번호. */
let rawEpoch = 0;
/** 불완전한 Escape 시퀀스를 단독 Escape로 확정하기까지 기다릴 시간(ms). */
const ESC_WAIT_MS = 50;
/** raw 입력 시작 직후 이전 화면의 잔여 입력을 비우기 위한 대기 시간(ms). */
const LEAD_MS = 40;
/** raw 입력 종료 시 뒤따르는 잔여 입력을 흡수할 대기 시간(ms). */
const TRAIL_MS = 80;

/** 키 입력을 문자열로 맞춘다. */
function toBinary(buf) {
  return Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
}

/**
 * Escape로 시작한 제어 시퀀스가 추가 입력을 기다려야 하는지 판별한다.
 * @param s - 누적한 입력 문자열
 * @returns 현재 버퍼만으로 키를 확정할 수 없으면 true
 */
function isIncomplete(s) {
  if (!s) return false;
  if (s[0] !== "\x1b") return false;
  if (s.length === 1) return true;
  if (s === "\x1b[" || s === "\x1bO") return true;
  if (s.startsWith("\x1b[<")) return /^\x1b\[<\d*(;\d*){0,2}$/.test(s);
  if (s.startsWith("\x1b[")) return /^\x1b\[[0-9;?]*$/.test(s);
  if (s.startsWith("\x1bO")) return s.length < 3;
  return false;
}

/**
 * 입력 문자열 앞에서 키 하나를 해석하고 남은 입력을 분리한다.
 * 마우스·커서 위치 응답은 무시할 키로 처리한다.
 * @param s - 해석할 입력 버퍼
 * @returns 키와 잔여 문자열. 비어 있거나 불완전하면 null
 */
function takeOne(s) {
  if (!s) return null;
  if (s[0] !== "\x1b") {
    const ch = Array.from(s)[0] || "";
    const rest = s.slice(ch.length);
    if (ch === "\u0003") return { key: { name: "ctrl-c" }, rest };
    if (ch === "\r" || ch === "\n") {
      let next = rest;
      if (ch === "\r" && next[0] === "\n") next = next.slice(1);
      return { key: { name: "enter" }, rest: next };
    }
    if (ch === "\u0008" || ch === "\u007f") return { key: { name: "backspace" }, rest };
    if (ch === "\t") return { key: { name: "tab" }, rest };
    return { key: { name: "char", ch }, rest };
  }
  if (isIncomplete(s)) return null;

  const mouse = s.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (mouse) {
    return { key: { name: "ignore" }, rest: s.slice(mouse[0].length) };
  }

  const dsr = s.match(/^\x1b\[(\d+);(\d+)R/);
  if (dsr) {
    return { key: { name: "ignore" }, rest: s.slice(dsr[0].length) };
  }

  const seq = [
    ["\u001b[A", "up"],
    ["\u001bOA", "up"],
    ["\u0000H", "up"],
    ["\xe0H", "up"],
    ["\u001b[B", "down"],
    ["\u001bOB", "down"],
    ["\u0000P", "down"],
    ["\xe0P", "down"],
    ["\u001b[C", "right"],
    ["\u001bOC", "right"],
    ["\u001b[D", "left"],
    ["\u001bOD", "left"],
    ["\u001b[5~", "pageup"],
    ["\u001b[6~", "pagedown"],
    ["\u001b[Z", "shift-tab"],
    ["\u001b[27~", "escape"]
  ];
  for (const [raw, name] of seq) {
    if (s.startsWith(raw)) return { key: { name }, rest: s.slice(raw.length) };
  }

  if (s.startsWith("\x1b\x1b")) return { key: { name: "escape" }, rest: s.slice(2) };

  if (s.length >= 2 && s[1] !== "[" && s[1] !== "O") {
    return { key: { name: "char", ch: s[1] }, rest: s.slice(2) };
  }

  const csi = s.match(/^\x1b\[[0-9;?]*[A-Za-z~]/);
  if (csi) return { key: { name: "unknown", raw: csi[0] }, rest: s.slice(csi[0].length) };

  return { key: { name: "escape" }, rest: s.slice(1) };
}

/** 대기열의 첫 유효 키를 대기 중인 소비자에게 전달한다. */
function deliver() {
  if (!waiter) return;
  while (queue.length) {
    const k = queue.shift();
    if (!k || k.name === "ignore") continue;
    const w = waiter;
    waiter = null;
    w(k);
    return;
  }
}

/** Escape 확정 타이머가 있으면 취소하고 상태를 비운다. */
function clearEscTimer() {
  if (!escTimer) return;
  clearTimeout(escTimer);
  escTimer = null;
}

/** 대기 시간이 지난 불완전 시퀀스를 비우고 Escape 키로 전달한다. */
function flushIncompleteEsc() {
  escTimer = null;
  if (!acc || acc[0] !== "\x1b") return;
  if (!isIncomplete(acc) && acc !== "\x1b") return;
  acc = "";
  queue.push({ name: "escape" });
  deliver();
}

/** 불완전한 Escape 입력이 있으면 단독 Escape 확정 타이머를 다시 건다. */
function scheduleEscFlush() {
  clearEscTimer();
  if (!acc || acc[0] !== "\x1b") return;
  if (isIncomplete(acc)) escTimer = setTimeout(flushIncompleteEsc, ESC_WAIT_MS);
}

/**
 * 입력 청크를 버퍼에 붙여 완성된 키를 대기열에 넣고 불완전 시퀀스는 기다린다.
 * @param chunk - 표준 입력에서 받은 청크
 */
function feed(chunk) {
  clearEscTimer();
  acc += toBinary(chunk);
  while (acc) {
    const r = takeOne(acc);
    if (!r) {
      if (!isIncomplete(acc)) acc = acc.slice(1);
      else if (acc.length > 96) acc = "";
      else break;
      continue;
    }
    acc = r.rest;
    const k = r.key;
    if (!k || k.name === "ignore" || k.name === "unknown") continue;
    queue.push(k);
  }
  scheduleEscFlush();
}

/**
 * 표준 입력 이벤트를 키 대기열로 해석한 뒤 기다리는 소비자에게 전달한다.
 * @param chunk - 표준 입력 data 이벤트의 청크
 */
function onStdinData(chunk) {
  feed(chunk);
  deliver();
}

/** 입력 버퍼·키 대기열·소비자와 Escape 타이머를 모두 초기화한다. */
function resetKeyState() {
  acc = "";
  queue.length = 0;
  waiter = null;
  clearEscTimer();
}

/** 표준 입력에 남은 데이터를 읽어 버리고 메뉴 간 키 상태를 초기화한다. */
function drainStdin() {
  try {
    let chunk;
    while ((chunk = input.read()) != null) {
      /* 잔여 키는 입력창으로 넘기지 않는다 */
    }
  } catch {
    /* */
  }
  resetKeyState();
}

/**
 * 입력 모드 전환을 안정화할 짧은 대기 Promise를 만든다.
 * @param ms - 대기할 밀리초
 * @returns 지정한 시간이 지나면 완료되는 Promise
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 이전 프로그램이 켰을 수 있는 터미널 마우스 추적을 해제한다. */
function disableMouse() {
  output.write(MOUSE_OFF);
}

/** 마우스·raw 모드를 해제하고 잔여 입력을 비워 readline 입력을 준비한다. */
async function preparePrompt() {
  disableMouse();
  drainStdin();
  if (typeof input.setRawMode === "function" && input.isRaw) input.setRawMode(false);
  input.setEncoding("utf8");
  await new Promise((r) => setTimeout(r, 25));
  drainStdin();
  try {
    input.resume();
  } catch {
    /* */
  }
}

/**
 * 입력 문자열에서 마우스·ANSI 제어 시퀀스를 제거한다.
 * @param s - 입력받은 문자열
 * @returns 제어 시퀀스가 없는 문자열
 */
function scrub(s) {
  return sanitizeTerminalText(s);
}

/**
 * raw 키 처리와 충돌하지 않도록 readline 프롬프트와 입력을 멈춘다.
 * @param rl - 멈출 readline 인터페이스
 */
function muteReadline(rl) {
  if (!rl) return;
  try {
    rl.setPrompt("");
  } catch {
    /* */
  }
  try {
    rl.pause();
  } catch {
    /* */
  }
}

/**
 * readline을 멈추고 raw 키 입력으로 작업을 실행한 뒤 입력·커서 상태를 복구한다.
 * 새 작업이 시작되었으면 이전 작업의 종료 처리가 새 입력 상태를 건드리지 않는다.
 * @param rl - 일시 정지할 readline 인터페이스
 * @param fn - raw 키 입력으로 실행할 작업
 * @param opt - cursor가 true면 작업 중 커서를 표시
 * @returns 작업 결과. 시작 중 다른 raw 작업으로 바뀌면 undefined
 */
async function withRaw(rl, fn, opt = {}) {
  muteReadline(rl);
  const epoch = ++rawEpoch;
  resetKeyState();
  try {
    input.resume();
  } catch {
    /* */
  }
  if (typeof input.setRawMode === "function") input.setRawMode(true);
  input.setEncoding("utf8");
  input.on("data", onStdinData);
  try {
    input.resume();
  } catch {
    /* */
  }
  output.write(opt.cursor ? `${ESC}[?25h` : `${ESC}[?25l`);
  disableMouse();
  await sleep(LEAD_MS);
  if (epoch !== rawEpoch) return undefined;
  resetKeyState();
  try {
    return await fn();
  } finally {
    if (epoch === rawEpoch) {
      disableMouse();
      await sleep(TRAIL_MS);
      resetKeyState();
      input.off("data", onStdinData);
      try {
        input.pause();
      } catch {
        /* */
      }
      drainStdin();
      output.write(`${ESC}[?25h`);
      if (typeof input.setRawMode === "function") input.setRawMode(false);
      input.setEncoding("utf8");
      muteReadline(rl);
    }
  }
}

/**
 * 대기열 또는 다음 입력에서 키 하나를 기다린다. Ctrl+C는 취소 오류로 거부한다.
 * @returns 해석한 키 객체
 */
function readKey() {
  return new Promise((resolve, reject) => {
    /** Ctrl+C를 취소 오류로 바꾸고 그 외 키는 입력 대기 Promise를 완료한다. */
    const take = (key) => {
      if (key.name === "ctrl-c") {
        reject(Object.assign(new Error("cancelled"), { cancelled: true }));
        return;
      }
      resolve(key);
    };
    while (queue.length) {
      const k = queue.shift();
      if (k.name === "ignore") continue;
      take(k);
      return;
    }
    waiter = take;
    scheduleEscFlush();
  });
}

/**
 * 다음 키 입력과 지정한 갱신 시간 중 먼저 도착한 이벤트를 기다린다.
 * @param ms - 화면 갱신까지 대기할 밀리초(최소 40ms)
 * @returns 키 이벤트 또는 tick 이벤트. Ctrl+C는 취소 오류
 */
function waitKeyOrTick(ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
    /** 키가 먼저 도착하면 갱신 타이머를 정리하고 키 또는 Ctrl+C 취소를 전달한다. */
    const take = (key) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (waiter === take) waiter = null;
      if (key.name === "ctrl-c") {
        reject(Object.assign(new Error("cancelled"), { cancelled: true }));
        return;
      }
      resolve({ key });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (waiter === take) waiter = null;
      resolve({ tick: true });
    }, Math.max(40, Number(ms) || 160));
    while (queue.length) {
      const k = queue.shift();
      if (k.name === "ignore") continue;
      take(k);
      return;
    }
    waiter = take;
    scheduleEscFlush();
  });
}

/** 한글은 2칸. 색 코드는 너비에서 뺀다. */
function dw(s) {
  const raw = String(s).replace(/\x1b\[[0-9;]*m/g, "");
  let n = 0;
  for (const ch of raw) {
    const cp = ch.codePointAt(0) || 0;
    n += cp > 0x2e80 || (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0xac00 && cp <= 0xd7a3) ? 2 : 1;
  }
  return n;
}

/**
 * 한글과 색 코드를 고려해 문자열의 오른쪽을 공백으로 채운다.
 * @param s - 표시 문자열
 * @param w - 목표 칸 너비
 * @returns 오른쪽 공백을 붙인 문자열
 */
function pad(s, w) {
  const n = Math.max(0, w - dw(s));
  return `${s}${" ".repeat(n)}`;
}

/**
 * 최대 표시 너비를 넘는 문자열을 자르고 말줄임표를 붙인다.
 * @param s - 표시 문자열
 * @param w - 최대 칸 너비
 * @returns 너비를 제한한 문자열
 */
function trunc(s, w) {
  const raw = sanitizeTerminalText(s);
  if (dw(raw) <= w) return raw;
  let out = "";
  for (const ch of raw) {
    if (dw(out + ch) > w - 1) break;
    out += ch;
  }
  return `${out}…`;
}

/** 칸보다 긴 글은 선택 줄에서만 옆으로 흘려 끝까지 보여 준다. */
function marquee(text, width, offset) {
  const raw = sanitizeTerminalText(text);
  if (width <= 0) return "";
  if (dw(raw) <= width) return pad(raw, width);
  const loop = `${raw}   `;
  const total = dw(loop) || 1;
  const skip = ((offset % total) + total) % total;
  let seen = 0;
  let built = "";
  const chars = [...loop, ...loop];
  for (const ch of chars) {
    const w = dw(ch);
    if (seen + w <= skip) {
      seen += w;
      continue;
    }
    if (seen < skip) {
      seen += w;
      continue;
    }
    if (dw(built) + w > width) break;
    built += ch;
    if (dw(built) >= width) break;
  }
  return pad(built, width);
}

/** 직전 메뉴 줄을 지우고 같은 자리에 다시 그린다. */
function paint(lines, state) {
  const count = state.count || 0;
  if (count > 0) output.write(`${ESC}[${count}A`);
  const max = Math.max(count, lines.length);
  for (let i = 0; i < max; i++) {
    output.write(`${ESC}[2K\r`);
    if (i < lines.length) output.write(`${lines[i]}\n`);
    else output.write("\n");
  }
  if (max > lines.length) output.write(`${ESC}[${max - lines.length}A`);
  state.count = lines.length;
}

/**
 * 직전에 그린 메뉴 줄을 지우고 커서를 메뉴 시작 위치로 되돌린다.
 * @param state - 그린 줄 수를 저장한 화면 상태
 */
function erase(state) {
  const count = state.count || 0;
  if (!count) return;
  output.write(`${ESC}[${count}A`);
  for (let i = 0; i < count; i++) output.write(`${ESC}[2K\r\n`);
  output.write(`${ESC}[${count}A`);
  state.count = 0;
}

/** TTY의 화면·스크롤 기록을 지우고 커서를 맨 위로 옮긴다. 일반 출력은 줄을 바꾼다. */
function clearScreen() {
  if (output.isTTY) output.write(`${ESC}[2J${ESC}[3J${ESC}[H`);
  else output.write("\n");
}

/**
 * 공통 키 대기 함수를 통해 다음 메뉴 조작 키를 받는다.
 * @returns 다음 키 객체
 */
async function nextKey() {
  return readKey();
}

/**
 * 현재 테마를 공유하는 키보드 메뉴·입력·파일 선택·진행 표시 도구를 만든다.
 * 색상은 호출할 때 읽어 설정 메뉴에서 바꾼 테마를 바로 반영한다.
 * @param {object} theme - TTY 여부, 색 함수와 변경 가능한 테마 색상
 * @returns {object} 선택기·입력창·API 추적·다운로드 표시와 화면 유틸리티
 */
export function makeKit(theme) {
  const { TTY, A } = theme;
  // Normalize every untrusted label before trusted color/cursor codes are added.
  const c = (text, ...codes) => theme.c(sanitizeTerminalText(text, { multiline: true }), ...codes);
  /** 현재 테마의 강조색을 읽고 없으면 기본 파랑을 사용한다. */
  const acc = () => theme.accent || A.blue;
  /** 현재 테마의 확인 버튼 배경색을 읽고 없으면 기본 색상 33을 사용한다. */
  const pillBg = () => theme.pill ?? 33;

  /**
   * API 추적에 사용할 현재 시각을 밀리초까지 표시한다.
   * @returns HH:mm:ss.SSS 시각 문자열
   */
  function stamp() {
    const d = new Date();
    /** 시각의 각 숫자를 지정한 자리 수에 맞춰 앞쪽 0으로 채운다. */
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  }

  /**
   * 시각을 붙인 흐린 회색 추적 로그를 출력한다.
   * @param line - 기록할 호출·응답 안내
   */
  function trace(line) {
    console.log(c(`  ${stamp()}  ${line}`, A.dim, A.gray));
  }

  /**
   * 인자를 남기지 않고 추적 로그용 함수 이름만 만든다.
   * @param name - Campus 메서드 이름
   * @param arg - 호출에 전달한 옵션
   * @returns 메서드 이름과 요약한 인자 문자열
   */
  function formatCall(name, arg) {
    return formatTraceCall(name);
  }

  /** Campus 메서드가 실제로 타는 lib/back 파일. 경로는 lib/back 기준. */
  const CALL_SOURCES = {
    liveLogin: {
      service: ["services/ecampus/login.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/crypto.ts"]
    },
    ensureSugang: {
      service: ["services/ecampus/login.ts"],
      engine: ["engine/course-registration/client.ts", "engine/hope-basket/client.ts"]
    },
    fetchAcademicOverview: {
      service: ["services/ecampus/classroom.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/courses.ts", "engine/ecampus/classroom.ts", "engine/ecampus/elearning.ts"]
    },
    listAssignments: {
      service: ["services/ecampus/classroom.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/classroom.ts", "engine/ecampus/courses.ts", "engine/ecampus/elearning.ts"]
    },
    fetchAssignmentDetail: {
      service: ["services/ecampus/classroom.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/classroom.ts"]
    },
    submitAssignment: {
      service: ["services/ecampus/classroom.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/classroom.ts"]
    },
    fetchNotices: {
      service: ["services/ecampus/classroom.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/classroom.ts"]
    },
    fetchNoticeDetail: {
      service: ["services/ecampus/classroom.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/classroom.ts"]
    },
    fetchMaterials: {
      service: ["services/ecampus/classroom.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/classroom.ts"]
    },
    fetchMaterialAttachments: {
      service: ["services/ecampus/classroom.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/classroom.ts"]
    },
    downloadCampusFile: {
      service: ["services/ecampus/classroom.ts"],
      engine: ["engine/ecampus/login.ts"]
    },
    listLessons: {
      service: ["services/ecampus/classroom.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/courses.ts", "engine/ecampus/elearning.ts"]
    },
    fetchProgress: {
      service: ["services/ecampus/elearning.ts"],
      engine: ["engine/ecampus/login.ts", "engine/utils.ts"]
    },
    downloadLessonVideo: {
      service: ["services/ecampus/elearning.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/elearning.ts"]
    },
    fetchTimetable: {
      service: ["services/timetable/timetable.ts", "services/ecampus/login.ts"],
      engine: ["engine/course-registration/client.ts", "engine/hope-basket/client.ts", "engine/hope-basket/timetable.ts"]
    },
    saveTimetableFile: {
      service: ["services/timetable/timetable.ts", "services/ecampus/login.ts"],
      engine: ["engine/course-registration/client.ts", "engine/hope-basket/client.ts", "engine/hope-basket/timetable.ts"]
    },
    fetchScores: {
      service: ["services/ecampus/score.ts"],
      engine: ["engine/ecampus/login.ts", "engine/ecampus/score.ts"]
    },
    fetchErpGrades: {
      service: ["services/erp/grades.ts", "services/ecampus/login.ts"],
      engine: ["engine/erp/client.ts", "engine/erp/grades.ts"]
    }
  };

  /**
   * Campus 호출에 연결된 서비스·엔진 구현 파일을 로그용 두 줄로 만든다.
   * @param name - Campus 메서드 이름
   * @returns 구현 파일 안내. 등록된 경로가 없으면 빈 문자열
   */
  function sourceLines(name) {
    const src = CALL_SOURCES[name];
    if (!src) return "";
    const pad = " ".repeat(16);
    const service = src.service.join(" · ");
    const engine = src.engine.join(" · ");
    return `\n${pad}service  ${service}\n${pad}engine   ${engine}`;
  }

  /**
   * Campus 메서드를 감싸 호출·결과·구현 경로를 출력하고 공통 호출 이력에 기록한다.
   * @param api - 추적을 붙일 Campus 인스턴스
   * @returns 메서드 추적을 적용한 같은 인스턴스
   */
  function bindApi(api) {
    const names = [
      "liveLogin",
      "logout",
      "currentStudent",
      "ensureSugang",
      "clearCache",
      "fetchAcademicOverview",
      "listAssignments",
      "fetchAssignmentDetail",
      "submitAssignment",
      "fetchNotices",
      "fetchNoticeDetail",
      "fetchMaterials",
      "fetchMaterialAttachments",
      "downloadCampusFile",
      "listLessons",
      "fetchProgress",
      "downloadLessonVideo",
      "fetchTimetable",
      "saveTimetableFile",
      "fetchScores",
      "fetchErpGrades"
    ];
    for (const name of names) {
      const orig = api[name]?.bind(api);
      if (!orig) continue;
      api[name] = async (arg) => {
        trace(`→ ${formatCall(name, arg)}${sourceLines(name)}`);
        const r = await orig(arg);
        if (r?.ok) {
          const extra = r.saved ? " 저장 완료" : "";
          trace(`← ${name}  ${r.ms}ms${extra}`);
        } else trace(`← ${name} 실패  ${r?.error || `${r?.ms || 0}ms`}`);
        if (Array.isArray(api.results) && r && typeof r.ok === "boolean") {
          api.results.push({ ok: r.ok, name, ms: r.ms || 0, detail: r.error || "" });
        }
        return r;
      };
    }
    return api;
  }

  /**
   * 커서를 처음 위치로 되돌려 같은 줄을 다시 그린다.
   * Windows 에서 Enter 가 줄을 내려도 원래 자리에서 덮어쓴다.
   * @param {(buf: string, done: boolean) => string} render
   * @param {{ fallback?: string, secret?: boolean }} [opt]
   */
  async function readAtSpot(rl, render, opt = {}) {
    if (!TTY || typeof input.setRawMode !== "function") {
      if (opt.secret) throw new Error("비밀번호 입력에는 마스킹 가능한 터미널이 필요합니다. .env를 사용하세요.");
      await preparePrompt();
      if (rl) {
        try {
          rl.resume();
        } catch {
          /* */
        }
      }
      const shown = render("", false);
      const line = await rl.question(shown);
      return scrub(line || opt.fallback || "");
    }

    const line = await withRaw(
      rl,
      async () => {
        output.write(`${ESC}7`);
        let buf = "";
        /** 저장한 커서 위치로 돌아가 입력값 또는 입력 완료 표시를 다시 그린다. */
        const paint = (done) => {
          output.write(`${ESC}8${ESC}[J${render(buf, done)}`);
        };
        paint(false);
        while (true) {
          const key = await nextKey();
          if (key.name === "enter") {
            if (!buf && opt.fallback) buf = String(opt.fallback);
            paint(true);
            output.write("\n");
            return buf;
          }
          if (key.name === "escape") {
            output.write("\n");
            return "";
          }
          if (key.name === "backspace") {
            buf = buf.slice(0, -1);
            paint(false);
            continue;
          }
          if (key.name !== "char") continue;
          const ch = String(key.ch || "");
          if (!ch || /[\x00-\x1f\x7f-\x9f]/.test(ch) || /[\u202a-\u202e\u2066-\u2069]/.test(ch)) continue;
          if ([...buf].length >= 4096) continue;
          buf += ch;
          paint(false);
        }
      },
      { cursor: true }
    );
    return scrub(line);
  }

  /**
   * 한 줄 입력. Windows 에서 메뉴 raw mode 뒤에 rl.question 이 Enter 를 삼키지 못하는 문제를 피한다.
   * @param {import("node:readline").Interface} rl
   * @param {string} prompt
   * @param {{ check?: boolean, secret?: boolean, fallback?: string }} [opt]
   */
  async function question(rl, prompt, opt = {}) {
    prompt = sanitizeTerminalText(prompt);
    return readAtSpot(
      rl,
      (buf, done) => {
        const shown = opt.secret ? "*".repeat([...buf].length) : sanitizeTerminalText(buf);
        const mark = done && opt.check && buf.length ? ` ${c("✓", A.green, A.bold)}` : "";
        return `${prompt}${shown}${mark}`;
      },
      opt
    );
  }

  /**
   * 학번·비밀번호처럼 라벨 필드. 엔터 시 같은 줄에서 › 와 입력값을 초록 입력완료로 바꾼다.
   * @param {import("node:readline").Interface} rl
   * @param {{ label: string, fallback?: string, secret?: boolean }} opt
   */
  async function promptField(rl, opt = {}) {
    const label = opt.label || "";
    return readAtSpot(
      rl,
      (buf, done) => {
        if (done) {
          return `${c("›", A.green, A.bold)} ${c(label, A.green)}: ${c("입력완료", A.green, A.bold)}`;
        }
        const shown = opt.secret ? "*".repeat([...buf].length) : sanitizeTerminalText(buf);
        return `${c("›", acc())} ${c(label, A.bold)}: ${shown}`;
      },
      { fallback: opt.fallback || "", secret: Boolean(opt.secret) }
    );
  }

  /**
   * 안내 화면을 유지한 채 Enter/Esc 를 기다린다. 입력창은 그리지 않는다.
   * @param {import("node:readline").Interface} rl
   * @param {string} [hint]
   */
  async function waitEnter(rl, hint = "Enter 메뉴로 · Esc 이전") {
    console.log(c(`  ${hint}`, A.dim, A.gray));
    if (!TTY || typeof input.setRawMode !== "function") {
      await question(rl, "");
      return;
    }
    await withRaw(rl, async () => {
      while (true) {
        const key = await readKey();
        if (key.name === "enter" || key.name === "escape") return;
      }
    });
  }

  /**
   * raw 키 입력을 쓸 수 없을 때 번호·단축키 텍스트로 메뉴를 선택한다.
   * @param rl - 입력용 readline 인터페이스
   * @param message - 메뉴 제목
   * @param choices - 구분선을 포함한 선택지
   * @returns 선택 값. 빈 입력·뒤로가기·알 수 없는 선택이면 null
   */
  async function fallbackPick(rl, message, choices) {
    const live = choices.filter((x) => !x.sep);
    console.log(c(`? ${message}`, A.bold));
    live.forEach((ch) => console.log(`  ${sanitizeTerminalText(ch.key)}) ${sanitizeTerminalText(ch.name)}`));
    const a = (await question(rl, "  번호: ")).trim().toLowerCase();
    if (!a || a === "b" || a === "q") return null;
    const hit = live.find((x) => String(x.key).toLowerCase() === a) || live[Number(a) - 1];
    return hit ? hit.value : null;
  }

  /**
   * 방향키·단축키로 메뉴를 선택하고 긴 선택지와 헤더를 주기적으로 갱신한다.
   * @param rl - 입력용 readline 인터페이스
   * @param message - 메뉴 제목
   * @param choices - 키·이름·값과 구분선 선택지
   * @param opt - 초기 선택·헤더·갱신 간격·이동 콜백 옵션
   * @returns 선택 값. Escape 또는 빈 목록이면 null
   */
  async function expandSelect(rl, message, choices, opt = {}) {
    if (!TTY || typeof input.setRawMode !== "function") return fallbackPick(rl, message, choices);
    const liveIdx = [];
    choices.forEach((ch, i) => {
      if (!ch.sep) liveIdx.push(i);
    });
    if (!liveIdx.length) return null;
    let cursor = 0;
    if (opt.initial != null) {
      const at = liveIdx.findIndex((i) => choices[i].value === opt.initial);
      if (at >= 0) cursor = at;
    }
    let marqueeOff = 0;
    const state = { count: 0, hits: [], pressLine: -1, needMarquee: false };

    /** 헤더·구분선·선택 포인터를 그리고 긴 항목의 가로 스크롤 필요 여부를 갱신한다. */
    const draw = async () => {
      const lines = [];
      state.hits = [];
      state.needMarquee = false;
      const maxW = Math.max(24, (output.columns || 80) - 8);
      const header = typeof opt.header === "function" ? opt.header() : opt.header;
      if (Array.isArray(header) && header.length) lines.push(...header);
      else if (header) lines.push(String(header));
      lines.push(`${c("?", acc(), A.bold)} ${c(message, A.bold)} ${c("(↑↓ Enter · Esc 이전)", A.dim)}`);
      choices.forEach((ch, i) => {
        if (ch.sep) {
          lines.push(c(`  ── ${ch.name} ──`, A.dim, A.italic));
          return;
        }
        const liveAt = liveIdx.indexOf(i);
        const on = liveAt === cursor;
        const key = String(ch.key ?? liveAt + 1);
        const bodyRaw = `${key}) ${ch.name}`;
        if (dw(bodyRaw) > maxW) state.needMarquee = true;
        const body = dw(bodyRaw) > maxW ? marquee(bodyRaw, maxW, on ? marqueeOff : 0) : bodyRaw;
        state.hits.push({ line: lines.length, index: liveAt });
        lines.push(on ? `${c("❯", acc(), A.bold)} ${markSelected(body)}` : `  ${c(body, A.white)}`);
      });
      paint(lines, state);
    };

    /** 메뉴를 지우고 고른 항목을 출력한 뒤 선택 값을 반환한다. */
    const confirm = (ch) => {
      erase(state);
      console.log(`${c("?", acc(), A.bold)} ${c(message, A.bold)} ${c(ch.name, acc())}`);
      return ch.value;
    };

    /** 지정한 간격 또는 긴 항목 스크롤 필요 여부에 맞춰 갱신 주기를 고른다. */
    const tickMs = () => {
      if (typeof opt.tickMs === "number") return opt.tickMs;
      return state.needMarquee ? 160 : 60000;
    };

    try {
      return await withRaw(rl, async () => {
        await draw();
        while (true) {
          const ev = await waitKeyOrTick(tickMs());
          if (ev.tick) {
            marqueeOff += 1;
            if (typeof opt.onTick === "function") opt.onTick();
            await draw();
            continue;
          }
          const key = ev.key;
          if (key.name === "up" || (key.name === "char" && key.ch === "k")) {
            cursor = (cursor - 1 + liveIdx.length) % liveIdx.length;
            marqueeOff = 0;
            if (typeof opt.onMove === "function") opt.onMove(choices[liveIdx[cursor]]?.value);
            await draw();
            continue;
          }
          if (key.name === "down" || (key.name === "char" && (key.ch === "j" || key.ch === " "))) {
            cursor = (cursor + 1) % liveIdx.length;
            marqueeOff = 0;
            if (typeof opt.onMove === "function") opt.onMove(choices[liveIdx[cursor]]?.value);
            await draw();
            continue;
          }
          if (key.name === "enter") return confirm(choices[liveIdx[cursor]]);
          if (key.name === "escape") {
            erase(state);
            return null;
          }
          if (key.name === "char") {
            const ch = key.ch.toLowerCase();
            const hit = choices.find((x) => !x.sep && String(x.key).toLowerCase() === ch);
            if (hit) return confirm(hit);
          }
        }
      });
    } catch (err) {
      erase(state);
      if (err && err.cancelled) throw err;
      throw err;
    }
  }

  /**
   * 표 칸 값을 문자열로 바꾸고 자르기·공백 채우기를 적용한다.
   * @param v - 표시할 값
   * @param w - 칸 너비
   * @returns 지정한 너비의 칸 문자열
   */
  function cell(v, w) {
    return pad(trunc(String(v ?? ""), w), w);
  }

  /**
   * 검색·페이지 이동·긴 칸 스크롤을 지원하는 표에서 행 하나를 선택한다.
   * @param rl - 입력용 readline 인터페이스
   * @param title - 표 제목
   * @param rows - 원본 행 목록
   * @param columns - 표 컬럼과 값·색상 함수
   * @param opt - 행 이름 함수와 페이지 크기
   * @returns 선택한 원본 행. 취소·빈 목록이면 null
   */
  async function tableSelect(rl, title, rows, columns, opt = {}) {
    if (!rows.length) {
      console.log(c(`  ${title} 목록이 비어 있습니다.`, A.gray));
      return null;
    }
    const cols = columns && columns.length
      ? columns
      : [{ key: "_label", head: title, width: 56, get: opt.labelOf }];
    const pageSize = Math.max(6, Number(opt.pageSize) || 12);
    const rawLabelOf = opt.labelOf || ((row) => cols.map((col) => String(row[col.key] ?? "")).join(" "));
    const labelOf = (row) => sanitizeTerminalText(rawLabelOf(row));
    /** 컬럼의 get 함수를 우선하고 기본 라벨 또는 행 필드에서 표 칸 값을 읽는다. */
    const getVal = (row, col) => {
      if (typeof col.get === "function") return col.get(row);
      if (col.key === "_label") return labelOf(row);
      return row[col.key];
    };

    if (!TTY || typeof input.setRawMode !== "function") {
      rows.forEach((row, i) => console.log(`  ${c(String(i + 1).padStart(2), A.yellow)}. ${labelOf(row)}`));
      const a = (await question(rl, "  번호: ")).trim();
      if (!a || a === "b" || a === "0" || a === "q") return null;
      return rows[Number(a) - 1] || null;
    }

    let cursor = 0;
    let scroll = 0;
    let filter = "";
    let mode = "nav";
    let marqueeOff = 0;
    const state = { count: 0, hits: [], pressLine: -1, needMarquee: false };

    /** 현재 검색어를 항목 이름과 대소문자 구분 없이 비교해 표시 행을 고른다. */
    const filtered = () => {
      if (!filter) return rows;
      const q = filter.toLowerCase();
      return rows.filter((row) => labelOf(row).toLowerCase().includes(q));
    };

    /** 검색 결과에 맞춰 포인터·스크롤을 보정하고 표 머리글·행·검색 안내를 다시 그린다. */
    const draw = async () => {
      const list = filtered();
      if (cursor >= list.length) cursor = Math.max(0, list.length - 1);
      if (cursor < scroll) scroll = cursor;
      if (cursor >= scroll + pageSize) scroll = cursor - pageSize + 1;
      const view = list.slice(scroll, scroll + pageSize);
      const widths = cols.map((col) => Math.max(dw(col.head), Number(col.width) || 10));
      const head = cols.map((col, i) => cell(col.head, widths[i])).join("  ");
      const rule = widths.map((w) => "─".repeat(w)).join("──");
      const lines = [];
      state.hits = [];
      state.needMarquee = false;
      const hint = mode === "search"
        ? c(`/${filter}█`, A.yellow)
        : c("(↑↓ Enter · /검색 · Esc 이전)", A.dim);
      lines.push(`${c("?", acc(), A.bold)} ${c(title, A.bold)}  ${c(`${list.length}/${rows.length}`, A.gray)}  ${hint}`);
      lines.push(`    ${c(head, acc(), A.bold)}`);
      lines.push(`    ${c(rule, A.dim)}`);
      if (!view.length) lines.push(c("    (검색 결과 없음)", A.gray));
      else {
        view.forEach((row, i) => {
          const abs = scroll + i;
          const on = abs === cursor;
          const cells = cols.map((col, ci) => {
            const raw = sanitizeTerminalText(getVal(row, col));
            if (dw(raw) > widths[ci]) state.needMarquee = true;
            const shown = marquee(raw, widths[ci], on ? marqueeOff : 0);
            return typeof col.paint === "function" ? col.paint(shown, row) : shown;
          }).join("  ");
          const num = String(abs + 1).padStart(2);
          const listText = `${c(num, A.gray)}  ${cells}`;
          state.hits.push({ line: lines.length, index: abs });
          lines.push(on ? `${c("❯", acc(), A.bold)} ${markSelected(listText)}` : `  ${listText}`);
        });
      }
      if (list.length > pageSize) {
        lines.push(c(`    ${scroll + 1}–${Math.min(list.length, scroll + pageSize)} / ${list.length}`, A.dim));
      }
      paint(lines, state);
    };

    try {
      return await withRaw(rl, async () => {
        await draw();
        while (true) {
          const ev = await waitKeyOrTick(mode === "search" ? 60000 : state.needMarquee ? 160 : 60000);
          if (ev.tick) {
            marqueeOff += 1;
            await draw();
            continue;
          }
          const key = ev.key;
          const list = filtered();
          if (mode === "search") {
            if (key.name === "enter") {
              mode = "nav";
              cursor = 0;
              scroll = 0;
              await draw();
              continue;
            }
            if (key.name === "escape") {
              mode = "nav";
              filter = "";
              await draw();
              continue;
            }
            if (key.name === "backspace") {
              filter = filter.slice(0, -1);
              await draw();
              continue;
            }
            if (key.name === "char" && key.ch && key.ch >= " ") {
              filter += key.ch;
              await draw();
              continue;
            }
            continue;
          }
          if (key.name === "up" || (key.name === "char" && key.ch === "k")) {
            cursor = list.length ? (cursor - 1 + list.length) % list.length : 0;
            marqueeOff = 0;
            await draw();
            continue;
          }
          if (key.name === "down" || (key.name === "char" && key.ch === "j")) {
            cursor = list.length ? (cursor + 1) % list.length : 0;
            marqueeOff = 0;
            await draw();
            continue;
          }
          if (key.name === "pageup") {
            cursor = Math.max(0, cursor - pageSize);
            await draw();
            continue;
          }
          if (key.name === "pagedown") {
            cursor = Math.min(list.length - 1, cursor + pageSize);
            await draw();
            continue;
          }
          if (key.name === "enter") {
            const hit = list[cursor] || null;
            erase(state);
            if (hit) console.log(`${c("?", acc(), A.bold)} ${c(title, A.bold)} ${c(trunc(labelOf(hit), 60), acc())}`);
            return hit;
          }
          if (key.name === "escape" || (key.name === "char" && (key.ch === "b" || key.ch === "q"))) {
            erase(state);
            return null;
          }
          if (key.name === "char" && key.ch === "/") {
            mode = "search";
            await draw();
            continue;
          }
        }
      });
    } catch (err) {
      erase(state);
      if (err && err.cancelled) throw err;
      throw err;
    }
  }

  /**
   * ANSI 256색 배경색 제어 코드를 만든다.
   * @param n - 0~255 배경색 번호
   * @returns 배경색 이스케이프 문자열
   */
  function bg256(n) {
    return `\x1b[48;5;${n}m`;
  }

  /** 목록에 이미 입힌 색 코드를 걷어 선택 색만 다시 칠할 수 있게 한다. */
  function stripAnsi(text) {
    return sanitizeTerminalText(text);
  }

  /**
   * 선택 효과. 목록 문자열과는 따로, 그 글자만 테마 색으로 바꾼다.
   * 배경을 깔거나 줄 끝까지 채우지 않는다.
   */
  function markSelected(text) {
    return `${acc()}${A.bold}${stripAnsi(text)}${A.reset}`;
  }

  /**
   * 확인 버튼을 선택 여부에 맞춰 테마 배경 또는 회색 배경으로 만든다.
   * @param label - 버튼 문구
   * @param on - 현재 선택한 버튼인지 여부
   * @returns 색·여백을 적용한 버튼 문자열
   */
  function pill(label, on) {
    const inner = ` ${sanitizeTerminalText(label)} `;
    if (theme.colorEnabled === false) return on ? `[${inner}]` : ` ${inner} `;
    if (on) return `${bg256(pillBg())}${A.bold}\x1b[97m${inner}${A.reset}`;
    return `${bg256(236)}\x1b[37m${inner}${A.reset}`;
  }

  /**
   * huh Confirm: 왼쪽에 │, 제목, 채워진/회색 알약 버튼 두 개.
   * @returns {Promise<boolean>}
   */
  async function confirmButtons(rl, title, opt = {}) {
    const aff = opt.affirmative || "예";
    const neg = opt.negative || "아니오";
    const defaultYes = Boolean(opt.defaultYes);
    if (!TTY || typeof input.setRawMode !== "function") {
      const a = (await question(rl, `${c("?", A.yellow)} ${title} ${c(`[${aff[0]}/${neg[0]}]`, A.gray)} `)).trim();
      const low = a.toLowerCase();
      if (!a) return defaultYes;
      return low === "y" || low === "yes" || a === "ㅇ" || a === aff || low === aff.toLowerCase();
    }

    let yes = defaultYes;
    const state = { count: 0, hits: [], pressLine: -1, btnLine: -1 };

    /** 확인 제목과 긍정·부정 버튼을 현재 선택에 맞춰 다시 그린다. */
    const draw = async () => {
      const width = Math.max(40, Math.min(output.columns || 80, 96));
      const lines = [];
      state.hits = [];
      lines.push(`${c("│", acc())} ${c(trunc(title, width - 4), acc(), A.bold)}`);
      lines.push(`${c("│", acc())}`);
      const yesP = pill(aff, yes);
      const noP = pill(neg, !yes);
      const btnLine = `${c("│", acc())}  ${yesP}  ${noP}`;
      state.btnLine = lines.length;
      let col = 1 + dw("│") + 2;
      const yesW = dw(` ${aff} `);
      const noW = dw(` ${neg} `);
      state.hits.push({ line: state.btnLine, x0: col, x1: col + yesW - 1, yes: true });
      col += yesW + 2;
      state.hits.push({ line: state.btnLine, x0: col, x1: col + noW - 1, yes: false });
      lines.push(btnLine);
      lines.push("");
      lines.push(c("  ←/→ 전환 · Enter 확인 · Esc 취소", A.dim, A.gray));
      paint(lines, state);
    };

    /** 확인 화면을 지우고 선택 결과를 출력한 뒤 동의 여부를 반환한다. */
    const finish = (ok) => {
      erase(state);
      const picked = ok ? aff : neg;
      console.log(`${c("│", acc())} ${c(trunc(title, 56), acc())}  ${c(picked, ok ? A.green : A.gray)}`);
      return ok;
    };

    try {
      return await withRaw(rl, async () => {
        await draw();
        while (true) {
          const key = await nextKey();
          if (key.name === "left" || key.name === "right" || key.name === "tab" || key.name === "shift-tab") {
            yes = !yes;
            await draw();
            continue;
          }
          if (key.name === "enter") return finish(yes);
          if (key.name === "escape") return finish(false);
          if (key.name === "char") {
            const ch = String(key.ch || "");
            const low = ch.toLowerCase();
            if (low === "y" || ch === "ㅇ" || ch === aff[0] || low === String(aff[0] || "").toLowerCase()) return finish(true);
            if (low === "n" || ch === "ㄴ" || ch === neg[0] || low === String(neg[0] || "").toLowerCase()) return finish(false);
          }
        }
      });
    } catch (err) {
      erase(state);
      if (err && err.cancelled) throw err;
      throw err;
    }
  }

  /**
   * 폴더의 하위 항목을 읽어 디렉터리 우선·한국어 이름순으로 트리 노드를 만든다.
   * @param dirPath - 읽을 폴더 경로
   * @returns 폴더·파일 노드. 폴더를 읽을 수 없으면 빈 배열
   */
  function loadDirChildren(dirPath) {
    let ents = [];
    try {
      ents = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const dirs = [];
    const files = [];
    for (const ent of ents) {
      const name = ent.name;
      if (!name || name === "." || name === "..") continue;
      const full = path.join(dirPath, name);
      let isDir = false;
      try {
        isDir = ent.isDirectory() || (ent.isSymbolicLink() && fs.statSync(full).isDirectory());
      } catch {
        continue;
      }
      const node = { name, path: full, isDir, expanded: false, children: null };
      if (isDir) dirs.push(node);
      else files.push(node);
    }
    /** 파일·폴더 이름을 한국어 로케일 기준으로 비교해 정렬한다. */
    const cmp = (a, b) => a.name.localeCompare(b.name, "ko");
    dirs.sort(cmp);
    files.sort(cmp);
    return [...dirs, ...files];
  }

  /**
   * 시작 폴더를 절대 경로로 바꾸고 첫 하위 목록을 읽어 열린 루트 노드를 만든다.
   * @param dirPath - 트리 시작 폴더
   * @returns 하위 노드를 포함한 루트 디렉터리 노드
   */
  function makeTreeRoot(dirPath) {
    const abs = path.resolve(dirPath);
    return { name: abs, path: abs, isDir: true, expanded: true, children: loadDirChildren(abs) };
  }

  /**
   * 펼친 디렉터리만 순회해 트리 표시 순서와 가지 연결 정보를 만든다.
   * @param root - 루트 디렉터리 노드
   * @returns 노드·깊이·마지막 가지 여부·연결선을 담은 행 목록
   */
  function flattenTree(root) {
    const out = [];
    /** 트리 노드를 표시 목록에 넣고 펼쳐진 하위 노드의 가지 연결 정보를 재귀적으로 만든다. */
    const walk = (node, depth, isLast, continues) => {
      out.push({ node, depth, isLast, continues });
      if (node.isDir && node.expanded && Array.isArray(node.children) && node.children.length) {
        const n = node.children.length;
        node.children.forEach((ch, i) => {
          const last = i === n - 1;
          walk(ch, depth + 1, last, [...continues, !last]);
        });
      }
    };
    walk(root, 0, true, []);
    return out;
  }

  /**
   * 깊이와 형제 노드 위치에 맞춰 디렉터리 트리 연결선을 만든다.
   * @param depth - 노드 깊이
   * @param isLast - 같은 부모 아래의 마지막 노드인지 여부
   * @param continues - 상위 깊이별로 연결선을 이어야 하는지 여부
   * @returns 노드 이름 앞에 붙일 트리 선 문자열
   */
  function treePrefix(depth, isLast, continues) {
    if (depth <= 0) return "";
    let s = "";
    for (let i = 0; i < depth; i++) {
      if (i < depth - 1) s += continues[i] ? "│ " : "  ";
      else s += isLast ? "└─" : "├─";
    }
    return s;
  }

  /**
   * Textual DirectoryTree: 폴더를 펼치거나 접어 파일을 고른다.
   * @returns {Promise<string|null>} 고른 파일의 절대 경로
   */
  async function directoryTree(rl, opt = {}) {
    const title = opt.title || "파일 선택";
    const startDir = opt.startDir || process.cwd();
    const saveDir = opt.mode === "dir";
    if (!TTY || typeof input.setRawMode !== "function") {
      const a = (await question(rl, `${c("›", acc())} ${title} 경로: `)).trim().replace(/^["']|["']$/g, "");
      if (!a) return null;
      try {
        const abs = path.resolve(a);
        if (saveDir) {
          fs.mkdirSync(abs, { recursive: true });
          if (fs.statSync(abs).isDirectory()) return abs;
        } else if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
      } catch {
        /* */
      }
      return null;
    }

    let root = makeTreeRoot(startDir);
    let cursor = 0;
    let scroll = 0;
    let marqueeOff = 0;
    /** 터미널 높이에 맞춰 파일 트리에 표시할 행 수를 8~18행으로 제한한다. */
    const termRows = () => Math.max(8, Math.min(18, (output.rows || 24) - 8));
    const state = { count: 0, hits: [], pressLine: -1, needMarquee: false };

    /** 폴더의 상위 절대 경로를 읽는다. 파일시스템 루트이면 null을 반환한다. */
    const parentOf = (dirPath) => {
      const abs = path.resolve(dirPath);
      const parent = path.dirname(abs);
      return parent !== abs ? parent : null;
    };

    /** 펼친 트리 목록에 상위 폴더 이동용 .. 행을 덧붙인다. */
    const visibleRows = () => {
      const rows = flattenTree(root);
      const parent = parentOf(root.path);
      if (!parent) return rows;
      return [
        {
          node: { name: "..", path: parent, isDir: true, expanded: false, children: null, isUp: true },
          depth: 0,
          isLast: false,
          continues: []
        },
        ...rows
      ];
    };

    /** 현재 폴더·파일 트리와 선택 모드별 안내를 스크롤 위치에 맞춰 다시 그린다. */
    const draw = async () => {
      const rows = visibleRows();
      if (cursor >= rows.length) cursor = Math.max(0, rows.length - 1);
      if (cursor < 0) cursor = 0;
      const pageSize = termRows();
      if (cursor < scroll) scroll = cursor;
      if (cursor >= scroll + pageSize) scroll = cursor - pageSize + 1;
      const view = rows.slice(scroll, scroll + pageSize);
      const width = Math.max(48, Math.min(output.columns || 88, 100));
      const nameW = width - 4;
      const lines = [];
      state.hits = [];
      state.needMarquee = false;
      lines.push(`${c("?", acc(), A.bold)} ${c(title, A.bold)}`);
      if (saveDir) {
        const shownName = opt.fileName ? ` · ${trunc(String(opt.fileName), 36)}` : "";
        lines.push(c(`  저장할 폴더를 연 뒤 s 로 이 위치에 저장합니다${shownName}`, A.dim, A.gray));
      } else {
        lines.push(c("  폴더를 펼치거나 접어 제출할 파일을 고릅니다.  .. 는 상위 폴더입니다.", A.dim, A.gray));
      }
      lines.push(c(`  ${trunc(root.path, width - 4)}`, A.dim));
      if (!view.length) lines.push(c("    (비어 있음)", A.gray));
      view.forEach((row, i) => {
        const abs = scroll + i;
        const on = abs === cursor;
        const glyph = row.node.isUp ? "▲ " : row.node.isDir ? (row.node.expanded ? "▼ " : "▶ ") : "  ";
        const pref = treePrefix(row.depth, row.isLast, row.continues);
        const raw = `${pref}${glyph}${row.node.name}`;
        if (dw(raw) > nameW) state.needMarquee = true;
        const body = dw(raw) > nameW ? marquee(raw, nameW, on ? marqueeOff : 0) : raw;
        state.hits.push({ line: lines.length, index: abs, file: !row.node.isDir, dir: row.node.isDir, up: Boolean(row.node.isUp) });
        if (on) {
          lines.push(`${c("❯", acc(), A.bold)} ${markSelected(body)}`);
        } else if (row.node.isDir) {
          lines.push(`  ${c(pref, A.dim)}${c(glyph, acc())}${c(row.node.name, A.white)}`);
        } else {
          lines.push(`  ${c(pref, A.dim)}${glyph}${sanitizeTerminalText(row.node.name)}`);
        }
      });
      const cur = rows[cursor];
      const kind = saveDir
        ? cur?.node?.isUp
          ? "상위로"
          : cur?.node?.isDir
            ? "이 폴더로"
            : "파일"
        : cur?.node?.isUp
          ? "상위"
          : cur?.node?.isDir
            ? cur.node.expanded
              ? "접기"
              : "열기"
            : "선택";
      lines.push(
        saveDir
          ? c(`  Enter ${kind} · s 이 폴더에 저장 · .. 상위 · Backspace 상위 · Esc 취소`, A.dim, A.gray)
          : c(`  Enter ${kind} · → 열기 · ← 접기 · .. 상위 · Backspace 상위 · Esc 이전`, A.dim, A.gray)
      );
      if (rows.length > pageSize) {
        lines.push(c(`  ${scroll + 1}–${Math.min(rows.length, scroll + pageSize)} / ${rows.length}`, A.dim));
      }
      paint(lines, state);
    };

    /** 디렉터리를 접거나 펼친다. 처음 펼칠 때만 하위 목록을 읽는다. */
    const toggle = (row) => {
      if (!row?.node?.isDir || row.node.isUp) return;
      if (!row.node.expanded) {
        if (!row.node.children) row.node.children = loadDirChildren(row.node.path);
        row.node.expanded = true;
      } else {
        row.node.expanded = false;
      }
    };

    /** 트리 루트를 다른 폴더로 바꾸고 이전 폴더가 보이면 그 행을 선택한다. */
    const rebase = (dirPath) => {
      try {
        const abs = path.resolve(dirPath);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return;
        const prev = root.path;
        root = makeTreeRoot(abs);
        cursor = 0;
        scroll = 0;
        const rows = visibleRows();
        const idx = rows.findIndex((r) => !r.node.isUp && r.node.path === prev);
        if (idx >= 0) cursor = idx;
      } catch {
        /* */
      }
    };

    /** 상위 폴더가 있으면 그 폴더를 트리 루트로 바꾼다. */
    const goUp = () => {
      const parent = parentOf(root.path);
      if (parent) rebase(parent);
    };

    /** 트리 화면을 지우고 선택한 경로를 출력한다. 경로가 없으면 null을 반환한다. */
    const finish = (filePath) => {
      erase(state);
      if (filePath) console.log(`${c("?", acc(), A.bold)} ${c(title, A.bold)} ${c(trunc(filePath, 64), acc())}`);
      return filePath || null;
    };

    try {
      return await withRaw(rl, async () => {
        await draw();
        while (true) {
          const ev = await waitKeyOrTick(state.needMarquee ? 160 : 60000);
          if (ev.tick) {
            marqueeOff += 1;
            await draw();
            continue;
          }
          const key = ev.key;
          const rows = visibleRows();
          const cur = rows[cursor];
          if (key.name === "up" || (key.name === "char" && key.ch === "k")) {
            cursor = rows.length ? (cursor - 1 + rows.length) % rows.length : 0;
            marqueeOff = 0;
            await draw();
            continue;
          }
          if (key.name === "down" || (key.name === "char" && key.ch === "j")) {
            cursor = rows.length ? (cursor + 1) % rows.length : 0;
            marqueeOff = 0;
            await draw();
            continue;
          }
          if (key.name === "pageup") {
            cursor = Math.max(0, cursor - termRows());
            await draw();
            continue;
          }
          if (key.name === "pagedown") {
            cursor = Math.min(rows.length - 1, cursor + termRows());
            await draw();
            continue;
          }
          if (key.name === "right") {
            if (cur?.node?.isUp) goUp();
            else if (cur?.node?.isDir && !cur.node.expanded) toggle(cur);
            await draw();
            continue;
          }
          if (key.name === "left") {
            if (cur?.node?.isUp) goUp();
            else if (cur?.node?.isDir && cur.node.expanded) toggle(cur);
            else if (cur && cur.depth > 0) {
              const parentPath = path.dirname(cur.node.path);
              const idx = rows.findIndex((r) => r.node.path === parentPath);
              if (idx >= 0) cursor = idx;
            } else goUp();
            await draw();
            continue;
          }
          if (key.name === "enter") {
            if (!cur) continue;
            if (cur.node.isUp) {
              goUp();
              await draw();
              continue;
            }
            if (cur.node.isDir) {
              if (saveDir) rebase(cur.node.path);
              else toggle(cur);
              await draw();
              continue;
            }
            if (saveDir) continue;
            return finish(cur.node.path);
          }
          if (key.name === "backspace") {
            goUp();
            await draw();
            continue;
          }
          if (key.name === "escape") return finish(null);
          if (key.name === "char") {
            const ch = key.ch;
            if (ch === "b" || ch === "q") return finish(null);
            if (ch === "h" || ch === "~") {
              rebase(os.homedir());
              await draw();
              continue;
            }
            if (ch === ".") {
              rebase(process.cwd());
              await draw();
              continue;
            }
            if (saveDir && (ch === "s" || ch === "S")) return finish(root.path);
            if (ch === " ") {
              if (cur?.node?.isUp) goUp();
              else if (cur?.node?.isDir) {
                if (saveDir) rebase(cur.node.path);
                else toggle(cur);
              } else if (!saveDir && cur?.node?.path) return finish(cur.node.path);
              await draw();
            }
          }
        }
      });
    } catch (err) {
      erase(state);
      if (err && err.cancelled) throw err;
      throw err;
    }
  }

  /**
   * 바이트 수를 읽기 쉬운 B·KB·MB·GB 문자열로 바꾼다.
   * @param n - 표시할 바이트 수
   * @returns 1024 기준 단위를 적용한 크기 문자열
   */
  function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
    return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  /**
   * 0~1 위치에 가장 가까운 테마 진행 막대 색을 고른다.
   * @param t - 막대 안의 상대 위치
   * @returns ANSI 256색 번호
   */
  function blend256(t) {
    const stops = theme.blend || [27, 33, 39, 45, 81, 177, 213];
    const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    return stops[Math.min(stops.length - 1, Math.round(x))];
  }

  /** 받은 비율만큼 채우는 색 막대. 빈 칸은 회색이다. */
  function progressBarView(percent, width) {
    const p = Math.max(0, Math.min(1, percent));
    const tw = Math.max(8, width);
    const fw = Math.round(tw * p);
    if (theme.colorEnabled === false) return "█".repeat(fw) + "░".repeat(tw - fw);
    let bar = "";
    for (let i = 0; i < tw; i++) {
      const col = blend256(i / Math.max(tw - 1, 1));
      bar += i < fw ? `\x1b[38;5;${col}m█` : "\x1b[38;5;240m░";
    }
    return `${bar}${A.reset}`;
  }

  /**
   * 다운로드 진행 막대. 한 줄만 다시 그린다.
   * 끝나면 100%까지 채운 뒤 그 줄을 지워서 막대 글자가 남지 않게 한다.
   * work 에는 (받은 바이트, 전체 바이트) 를 알리는 함수를 넘긴다.
   */
  async function withDownloadBar(label, work) {
    if (!TTY) return work(() => {});
    let received = 0;
    let total = 0;
    let shown = 0;
    let ticking = true;
    const origWrite = output.write.bind(output);

    /** 터미널 너비에 맞춰 파일명·진행 막대·퍼센트·받은 크기를 한 줄로 만든다. */
    const renderLine = () => {
      const limit = Math.max(20, (output.columns || 80) - 1);
      let barW = 24;
      let nameW = 24;
      let line = "";
      const p = Math.max(0, Math.min(1, shown));
      const pctTxt = total > 0 ? `${String(Math.round(p * 100)).padStart(3)}%` : " · ·";
      const size = total > 0
        ? `${formatBytes(received)} / ${formatBytes(total)}`
        : received ? formatBytes(received) : "받는 중";
      do {
        const name = trunc(String(label || "다운로드"), nameW);
        line = `  ${c("⬇", acc(), A.bold)} ${c(name, A.bold)} ${progressBarView(p, barW)} ${c(pctTxt, A.bold)} ${c(size, A.dim)}`;
        if (dw(line) <= limit || (barW <= 8 && nameW <= 4)) break;
        if (barW > 8) barW -= 2;
        else nameW -= 2;
      } while (barW >= 8);
      return line;
    };

    /** 다운로드가 진행 중이면 현재 진행 표시를 같은 줄에 다시 그린다. */
    const draw = () => {
      if (!ticking) return;
      origWrite(`\r\x1b[2K${renderLine()}`);
    };

    /** 진행 막대가 있는 현재 줄을 지우고 커서를 줄 처음으로 옮긴다. */
    const clearLine = () => {
      origWrite("\r\x1b[2K");
    };

    output.write = function (chunk, encoding, cb) {
      if (!ticking) return origWrite(chunk, encoding, cb);
      clearLine();
      const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
      const ret = origWrite(chunk, encoding, cb);
      if (text && !text.endsWith("\n")) origWrite("\n");
      return ret;
    };

    /** 작업이 알린 받은 크기·전체 크기를 정규화해 진행 표시 상태를 갱신한다. */
    const report = (got, tot) => {
      received = Math.max(0, Number(got) || 0);
      total = Math.max(0, Number(tot) || 0);
      if (total > 0 && received > total) received = total;
    };

    /** 진행 갱신 타이머를 종료하고 원래 표준 출력 함수를 복구한다. */
    const stop = () => {
      ticking = false;
      clearInterval(iv);
      output.write = origWrite;
    };

    origWrite(`${ESC}[?25l`);
    const iv = setInterval(() => {
      if (!ticking) return;
      const target = total > 0 ? Math.min(1, received / Math.max(total, 1)) : Math.min(0.9, shown + 0.02);
      shown += (target - shown) * 0.35;
      if (shown < 0) shown = 0;
      draw();
    }, 32);
    draw();

    /** 진행 갱신을 멈추고 성공 시 100%까지 채운 뒤 표시 줄과 커서 상태를 정리한다. */
    const finishVisual = async (fill) => {
      stop();
      if (fill) {
        if (total <= 0) total = Math.max(received, 1);
        if (received < total) received = total;
        const until = Date.now() + 480;
        while (shown < 0.999 && Date.now() < until) {
          shown += (1 - shown) * 0.45;
          if (shown > 1) shown = 1;
          origWrite(`\r\x1b[2K${renderLine()}`);
          await new Promise((r) => setTimeout(r, 32));
        }
        shown = 1;
        origWrite(`\r\x1b[2K${renderLine()}`);
        await new Promise((r) => setTimeout(r, 90));
      }
      clearLine();
      origWrite(`${ESC}[?25h`);
    };

    try {
      const result = await work(report);
      const failed = Boolean(result && result.ok === false);
      await finishVisual(!failed);
      return result;
    } catch (err) {
      await finishVisual(false);
      throw err;
    }
  }

  return {
    expandSelect,
    tableSelect,
    confirmButtons,
    directoryTree,
    withDownloadBar,
    trace,
    bindApi,
    pad,
    trunc,
    dw,
    question,
    promptField,
    waitEnter,
    scrub,
    preparePrompt,
    clearScreen
  };
}
