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

const ESC = "\x1b";
const MOUSE_OFF = `${ESC}[?1003l${ESC}[?1006l${ESC}[?1002l${ESC}[?1000l`;

let acc = "";
const queue = [];
let waiter = null;
let escTimer = null;
let rawEpoch = 0;
const ESC_WAIT_MS = 50;
const LEAD_MS = 40;
const TRAIL_MS = 80;

/** 키 입력을 문자열로 맞춘다. */
function toBinary(buf) {
  return Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
}

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

function clearEscTimer() {
  if (!escTimer) return;
  clearTimeout(escTimer);
  escTimer = null;
}

function flushIncompleteEsc() {
  escTimer = null;
  if (!acc || acc[0] !== "\x1b") return;
  if (!isIncomplete(acc) && acc !== "\x1b") return;
  acc = "";
  queue.push({ name: "escape" });
  deliver();
}

function scheduleEscFlush() {
  clearEscTimer();
  if (!acc || acc[0] !== "\x1b") return;
  if (isIncomplete(acc)) escTimer = setTimeout(flushIncompleteEsc, ESC_WAIT_MS);
}

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

function onStdinData(chunk) {
  feed(chunk);
  deliver();
}

function resetKeyState() {
  acc = "";
  queue.length = 0;
  waiter = null;
  clearEscTimer();
}

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function disableMouse() {
  output.write(MOUSE_OFF);
}

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

function scrub(s) {
  return String(s ?? "")
    .replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, "")
    .replace(/\x1b./g, "");
}

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

function readKey() {
  return new Promise((resolve, reject) => {
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

function waitKeyOrTick(ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
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

function pad(s, w) {
  const n = Math.max(0, w - dw(s));
  return `${s}${" ".repeat(n)}`;
}

function trunc(s, w) {
  const raw = String(s ?? "");
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
  const raw = String(text ?? "");
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

function erase(state) {
  const count = state.count || 0;
  if (!count) return;
  output.write(`${ESC}[${count}A`);
  for (let i = 0; i < count; i++) output.write(`${ESC}[2K\r\n`);
  output.write(`${ESC}[${count}A`);
  state.count = 0;
}

function clearScreen() {
  if (output.isTTY) output.write(`${ESC}[2J${ESC}[3J${ESC}[H`);
  else output.write("\n");
}

async function nextKey() {
  return readKey();
}

/**
 * @param {object} theme
 */
export function makeKit(theme) {
  const { TTY, c, A } = theme;
  const acc = () => theme.accent || A.blue;
  const pillBg = () => theme.pill ?? 33;
  const treeBg = () => theme.treeBg ?? 24;

  function stamp() {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  }

  function trace(line) {
    console.log(c(`  ${stamp()}  ${line}`, A.dim, A.gray));
  }

  function formatCall(name, arg) {
    if (arg == null || typeof arg !== "object") return `${name}()`;
    const brief = {};
    for (const [key, value] of Object.entries(arg)) {
      if (key === "password" || key === "timeoutMs") continue;
      if (typeof value === "function") continue;
      brief[key] = value;
    }
    return Object.keys(brief).length ? `${name}(${JSON.stringify(brief)})` : `${name}()`;
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
    fetchSnapshot: {
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
      engine: ["engine/utils.ts"]
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

  function sourceLines(name) {
    const src = CALL_SOURCES[name];
    if (!src) return "";
    const pad = " ".repeat(16);
    const service = src.service.join(" · ");
    const engine = src.engine.join(" · ");
    return `\n${pad}service  ${service}\n${pad}engine   ${engine}`;
  }

  function bindApi(api) {
    const names = [
      "liveLogin",
      "logout",
      "currentStudent",
      "ensureSugang",
      "clearCache",
      "fetchSnapshot",
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
          const extra = r.saved ? ` 저장 ${r.saved}` : "";
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
          if (!ch || ch < " ") continue;
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
    return readAtSpot(
      rl,
      (buf, done) => {
        const shown = opt.secret ? "*".repeat([...buf].length) : buf;
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
        const shown = opt.secret ? "*".repeat([...buf].length) : buf;
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

  async function fallbackPick(rl, message, choices) {
    const live = choices.filter((x) => !x.sep);
    console.log(c(`? ${message}`, A.bold));
    live.forEach((ch) => console.log(`  ${ch.key}) ${ch.name}`));
    const a = (await question(rl, "  번호: ")).trim().toLowerCase();
    if (!a || a === "b" || a === "q") return null;
    const hit = live.find((x) => String(x.key).toLowerCase() === a) || live[Number(a) - 1];
    return hit ? hit.value : null;
  }

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
        if (on) lines.push(`${c("❯", acc(), A.bold)} ${rowBar(body)}`);
        else lines.push(`  ${c(body, A.white)}`);
      });
      paint(lines, state);
    };

    const confirm = (ch) => {
      erase(state);
      console.log(`${c("?", acc(), A.bold)} ${c(message, A.bold)} ${c(ch.name, acc())}`);
      return ch.value;
    };

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

  function cell(v, w) {
    return pad(trunc(String(v ?? ""), w), w);
  }

  async function tableSelect(rl, title, rows, columns, opt = {}) {
    if (!rows.length) {
      console.log(c(`  ${title} 목록이 비어 있습니다.`, A.gray));
      return null;
    }
    const cols = columns && columns.length
      ? columns
      : [{ key: "_label", head: title, width: 56, get: opt.labelOf }];
    const pageSize = Math.max(6, Number(opt.pageSize) || 12);
    const labelOf = opt.labelOf || ((row) => cols.map((col) => String(row[col.key] ?? "")).join(" "));
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

    const filtered = () => {
      if (!filter) return rows;
      const q = filter.toLowerCase();
      return rows.filter((row) => labelOf(row).toLowerCase().includes(q));
    };

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
            const raw = String(getVal(row, col) ?? "");
            if (dw(raw) > widths[ci]) state.needMarquee = true;
            const shown = marquee(raw, widths[ci], on ? marqueeOff : 0);
            return typeof col.paint === "function" ? col.paint(shown, row) : shown;
          }).join("  ");
          const num = String(abs + 1).padStart(2);
          state.hits.push({ line: lines.length, index: abs });
          if (on) lines.push(`${c("❯", acc(), A.bold)} ${rowBar(`${num}  ${cells}`)}`);
          else lines.push(`  ${c(num, A.gray)}  ${cells}`);
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

  function bg256(n) {
    return `\x1b[48;5;${n}m`;
  }

  /**
   * 선택 줄 배경. 글자색(등급·미제출 빨강)은 유지하고, 칸이 짧으면 화면 끝까지 채운다.
   * 줄바꿈으로 다시 그리기가 어긋나지 않게 터미널 너비 안쪽에서 멈춘다.
   */
  function rowBar(text) {
    const limit = Math.max(16, (output.columns || 80) - 4);
    const width = dw(text) >= limit ? dw(text) : limit;
    const bg = bg256(treeBg());
    const padded = pad(String(text ?? ""), width);
    const kept = `${bg}\x1b[97m${padded.split(A.reset).join(`${A.reset}${bg}\x1b[97m`)}`;
    return `${kept}${A.reset}`;
  }

  function pill(label, on) {
    const inner = ` ${label} `;
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
    const cmp = (a, b) => a.name.localeCompare(b.name, "ko");
    dirs.sort(cmp);
    files.sort(cmp);
    return [...dirs, ...files];
  }

  function makeTreeRoot(dirPath) {
    const abs = path.resolve(dirPath);
    return { name: abs, path: abs, isDir: true, expanded: true, children: loadDirChildren(abs) };
  }

  function flattenTree(root) {
    const out = [];
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
    const termRows = () => Math.max(8, Math.min(18, (output.rows || 24) - 8));
    const state = { count: 0, hits: [], pressLine: -1, needMarquee: false };

    const parentOf = (dirPath) => {
      const abs = path.resolve(dirPath);
      const parent = path.dirname(abs);
      return parent !== abs ? parent : null;
    };

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
        const body = dw(raw) > nameW ? marquee(raw, nameW, on ? marqueeOff : 0) : pad(raw, nameW);
        state.hits.push({ line: lines.length, index: abs, file: !row.node.isDir, dir: row.node.isDir, up: Boolean(row.node.isUp) });
        if (on) {
          lines.push(`${c("❯", acc(), A.bold)} ${rowBar(body)}`);
        } else if (row.node.isDir) {
          lines.push(`  ${c(pref, A.dim)}${c(glyph, acc())}${c(row.node.name, A.white)}`);
        } else {
          lines.push(`  ${c(pref, A.dim)}${glyph}${row.node.name}`);
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

    const toggle = (row) => {
      if (!row?.node?.isDir || row.node.isUp) return;
      if (!row.node.expanded) {
        if (!row.node.children) row.node.children = loadDirChildren(row.node.path);
        row.node.expanded = true;
      } else {
        row.node.expanded = false;
      }
    };

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

    const goUp = () => {
      const parent = parentOf(root.path);
      if (parent) rebase(parent);
    };

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

  return {
    expandSelect,
    tableSelect,
    confirmButtons,
    directoryTree,
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
