#!/usr/bin/env node
// @ts-nocheck
/**
 * seowon-cli API TUI.
 * 학교 서버에 직접 붙는 학생 메뉴. 웹 API는 쓰지 않는다.
 *
 *   npm run api-cli
 *   npm run api-cli -- --suite all
 *
 * 환경변수: SEOWON_BASE_URL, SEOWON_SID, SEOWON_PW, SEOWON_ADMIN_ID, SEOWON_ADMIN_PW
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { makeKit } from "./tui-kit.js";
import { makeActions } from "./tui-actions.js";
import { FETCH_LIMIT } from "../../back/constants.js";
import { Campus } from "../../back/campus.js";
import { watchListEmptyMessage } from "../../back/filters.js";
import { mapLimit } from "../../back/utils.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/** .env 의 SEOWON_SID · SEOWON_PW. 이미 있는 환경변수는 덮지 않는다. */
function loadDotEnv(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT, ".env"));
const APP_TITLE = "서원대 모아보기";

const TTY = Boolean(output.isTTY) && !process.env.NO_COLOR;
const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  under: "\x1b[4m",
  red: "\x1b[31m",
  brightRed: "\x1b[91m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m"
};
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const WAVE = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"];
const WAVE_MS = 320;
const CFG_PATH = path.join(ROOT, "data", "tui-config.json");

/** ANSI 색을 붙인다. TTY 가 아니면 그대로 둔다. */
function c(text, ...codes) {
  if (!TTY) return String(text);
  return `${codes.join("")}${text}${A.reset}`;
}
function fg256(n) {
  return `\x1b[38;5;${n}m`;
}

const THEME_LIST = [
  { id: "seowon", group: "차가운 색", name: "서원 블루", hint: "파랑 · 하늘색", accent: 33, banner: 25, palette: [27, 33, 39, 45, 75, 45, 39, 33], pill: 33, treeBg: 24, blend: [27, 33, 39, 45, 81, 117] },
  { id: "sky", group: "차가운 색", name: "스카이", hint: "밝은 하늘 · 시안", accent: 45, banner: 39, palette: [39, 45, 51, 87, 117, 87, 51, 45], pill: 45, treeBg: 24, blend: [39, 45, 51, 87, 117] },
  { id: "ocean", group: "차가운 색", name: "딥 오션", hint: "남색 · 인디고", accent: 39, banner: 17, palette: [17, 18, 24, 25, 31, 32, 39, 45], pill: 25, treeBg: 17, blend: [17, 25, 32, 39, 45] },
  { id: "ice", group: "차가운 색", name: "아이스", hint: "청백 · 서리", accent: 81, banner: 67, palette: [67, 74, 81, 87, 123, 159, 195, 159], pill: 81, treeBg: 23, blend: [74, 81, 87, 123, 159] },
  { id: "mint", group: "차가운 색", name: "민트", hint: "민트 · 에메랄드", accent: 43, banner: 29, palette: [29, 36, 43, 49, 50, 86, 122, 86], pill: 43, treeBg: 22, blend: [36, 43, 49, 50, 86] },
  { id: "teal", group: "차가운 색", name: "틸", hint: "청록 · 바다", accent: 37, banner: 23, palette: [23, 30, 37, 44, 51, 44, 37, 30], pill: 37, treeBg: 23, blend: [23, 30, 37, 44, 51] },
  { id: "forest", group: "자연", name: "포레스트", hint: "숲 · 초록", accent: 40, banner: 22, palette: [22, 28, 34, 40, 46, 71, 77, 40], pill: 40, treeBg: 22, blend: [22, 28, 34, 40, 46] },
  { id: "aurora", group: "자연", name: "오로라", hint: "초록 · 보라", accent: 48, banner: 23, palette: [36, 42, 48, 84, 98, 135, 141, 48], pill: 48, treeBg: 23, blend: [36, 48, 84, 135, 141] },
  { id: "moss", group: "자연", name: "모스", hint: "이끼 · 올리브", accent: 70, banner: 58, palette: [58, 64, 70, 106, 107, 148, 107, 70], pill: 70, treeBg: 22, blend: [58, 64, 70, 106, 148] },
  { id: "sunset", group: "따뜻한 색", name: "선셋", hint: "주황 · 석양", accent: 208, banner: 130, palette: [130, 166, 172, 208, 209, 216, 209, 172], pill: 208, treeBg: 52, blend: [166, 172, 208, 209, 216] },
  { id: "coral", group: "따뜻한 색", name: "코랄", hint: "산호 · 살구", accent: 209, banner: 131, palette: [167, 173, 209, 210, 217, 210, 173, 167], pill: 209, treeBg: 52, blend: [173, 209, 210, 217] },
  { id: "ruby", group: "따뜻한 색", name: "루비", hint: "빨강 · 진홍", accent: 196, banner: 52, palette: [88, 124, 160, 196, 197, 203, 197, 160], pill: 160, treeBg: 52, blend: [88, 124, 160, 196, 203] },
  { id: "gold", group: "따뜻한 색", name: "골드", hint: "금색 · 노랑", accent: 220, banner: 94, palette: [136, 178, 184, 220, 221, 227, 221, 184], pill: 178, treeBg: 58, blend: [136, 178, 220, 221, 227] },
  { id: "amber", group: "따뜻한 색", name: "앰버", hint: "호박 · 오렌지", accent: 214, banner: 94, palette: [130, 166, 172, 178, 214, 215, 220, 214], pill: 214, treeBg: 94, blend: [166, 178, 214, 215, 220] },
  { id: "sakura", group: "포인트", name: "사쿠라", hint: "벚꽃 · 분홍", accent: 211, banner: 132, palette: [175, 181, 211, 218, 225, 219, 218, 211], pill: 211, treeBg: 89, blend: [175, 211, 218, 225] },
  { id: "magenta", group: "포인트", name: "마젠타", hint: "자홍 · 핫핑크", accent: 199, banner: 90, palette: [127, 163, 164, 199, 200, 206, 200, 163], pill: 199, treeBg: 53, blend: [127, 163, 199, 200, 206] },
  { id: "violet", group: "포인트", name: "바이올렛", hint: "보라 · 남보라", accent: 141, banner: 54, palette: [54, 55, 92, 93, 99, 135, 141, 99], pill: 99, treeBg: 54, blend: [54, 92, 99, 135, 141] },
  { id: "lavender", group: "포인트", name: "라벤더", hint: "연보라 · 라일락", accent: 147, banner: 60, palette: [60, 97, 104, 140, 147, 183, 189, 147], pill: 147, treeBg: 54, blend: [97, 140, 147, 183, 189] },
  { id: "cyber", group: "포인트", name: "사이버", hint: "네온 시안 · 마젠타", accent: 51, banner: 17, palette: [46, 51, 87, 201, 213, 201, 87, 51], pill: 201, treeBg: 17, blend: [46, 51, 87, 201, 213] },
  { id: "watermelon", group: "포인트", name: "수박", hint: "빨강 · 초록", accent: 197, banner: 52, palette: [160, 196, 197, 204, 41, 47, 77, 41], pill: 197, treeBg: 52, blend: [160, 197, 41, 47] },
  { id: "slate", group: "무채", name: "슬레이트", hint: "회청 · 스틸", accent: 250, banner: 238, palette: [240, 242, 244, 247, 250, 252, 250, 244], pill: 240, treeBg: 236, blend: [240, 244, 247, 250, 255] },
  { id: "mono", group: "무채", name: "모노크롬", hint: "흰 · 회색", accent: 255, banner: 235, palette: [255, 252, 249, 246, 243, 240, 243, 249], pill: 238, treeBg: 235, blend: [238, 244, 249, 252, 255] }
];
const THEMES = Object.fromEntries(THEME_LIST.map((t) => [t.id, t]));

const theme = {
  id: "seowon",
  TTY,
  c,
  A,
  accent: fg256(33),
  accent256: 33,
  banner256: 25,
  palette: THEMES.seowon.palette,
  pill: 33,
  treeBg: 24,
  blend: THEMES.seowon.blend,
  clearOnNav: true
};

/** 테마 색과 화면 지우기 설정을 data/tui-config.json 에 남긴다. */
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
    fs.writeFileSync(
      CFG_PATH,
      `${JSON.stringify({ theme: theme.id, clearOnNav: theme.clearOnNav !== false }, null, 2)}\n`
    );
  } catch {
    /* */
  }
}

/** 테마 id 를 현재 색으로 적용한다. persist 면 파일에도 쓴다. */
function applyTheme(id, persist = true) {
  const spec = THEMES[id] || THEMES.seowon;
  theme.id = THEMES[id] ? id : "seowon";
  theme.accent = fg256(spec.accent);
  theme.accent256 = spec.accent;
  theme.banner256 = spec.banner;
  theme.palette = spec.palette;
  theme.pill = spec.pill;
  theme.treeBg = spec.treeBg;
  theme.blend = spec.blend;
  if (persist) saveConfig();
}

/** 저장된 테마가 있으면 읽고, 없으면 서원 블루를 쓴다. */
function loadTheme() {
  try {
    const raw = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
    if (raw && THEMES[raw.theme]) applyTheme(raw.theme, false);
    if (raw && typeof raw.clearOnNav === "boolean") theme.clearOnNav = raw.clearOnNav;
  } catch {
    /* */
  }
}

loadTheme();

const { expandSelect, tableSelect, confirmButtons, directoryTree, withDownloadBar, trace, bindApi, question, promptField, waitEnter, clearScreen } = makeKit(theme);
function doClear() {
  if (theme.clearOnNav === false) return;
  clearScreen();
}
function paint256(text, n) {
  return TTY ? `${fg256(n)}${text}${A.reset}` : text;
}
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}
/** 한글은 2칸으로 보는 화면 너비. ANSI 색 코드는 빼 둔다. */
function dw(s) {
  let n = 0;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0) || 0;
    n += cp > 0x2e80 || (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0xac00 && cp <= 0xd7a3) ? 2 : 1;
  }
  return n;
}
function pad(s, w) {
  return `${s}${" ".repeat(Math.max(0, w - dw(s)))}`;
}
function trunc(s, w) {
  const raw = String(s);
  if (dw(raw) <= w) return raw;
  let out = "";
  for (const ch of raw) {
    if (dw(out + ch) > w - 1) break;
    out += ch;
  }
  return `${out}…`;
}
function cols() {
  return Math.max(56, Math.min(output.columns || 88, 120));
}
function gradientLine(text) {
  if (!TTY) return text;
  const pal = theme.palette;
  return [...text].map((ch, i) => `${fg256(pal[i % pal.length])}${ch}`).join("") + A.reset;
}
function box(title, lines, accent) {
  const col = accent ?? theme.accent256;
  const width = Math.max(48, Math.min(cols() - 2, 96));
  const inner = width - 2;
  const t = trunc(title, inner - 4);
  const edge = (L, fill, R) => `${paint256(L, col)}${paint256(fill.repeat(inner), col)}${paint256(R, col)}`;
  const body = (lines || []).map((ln) => `${paint256("║", col)} ${pad(trunc(String(ln), inner - 2), inner - 2)} ${paint256("║", col)}`);
  return [edge("╔", "═", "╗"), `${paint256("║", col)} ${c(pad(t, inner - 2), A.bold)} ${paint256("║", col)}`, edge("╠", "─", "╣"), ...body, edge("╚", "═", "╝")].join("\n");
}
function hr(ch = "─") {
  return c(ch.repeat(Math.min(cols() - 1, 88)), A.gray);
}
function waveGlyphs(offset) {
  const n = WAVE.length;
  const pal = theme.palette;
  const off = ((Number(offset) % n) + n) % n;
  return WAVE.map((_, i) => paint256(WAVE[(i - off + n) % n], pal[i % pal.length])).join("");
}
function themeSwatch(spec) {
  return (spec.palette || []).slice(0, 8).map((n) => paint256("█", n)).join("");
}
function hudLines(api) {
  const who = api.student
    ? `${c(api.student.studentName || "학생", A.bold)} ${c(api.student.studentId || "", A.gray)} · ${api.student.deptName || ""}`
    : api.loggedIn()
      ? c("세션 있음 · 프로필 미수신", A.yellow)
      : c("로그인 전", A.gray);
  return [`  연결   ${c("● 학교 서버 직접", A.green)}`, `  사용자  ${who}`];
}
function bannerLines(api, waveOff = 0) {
  const w = Math.min(cols() - 1, 96);
  const title = pad(`  ${waveGlyphs(waveOff)}  ${c(APP_TITLE, A.bold, theme.accent)}`, w);
  const sub = gradientLine(pad(`  학생 CLI  ·  ${PKG.name} v${PKG.version}  ·  조회·제출`, w));
  const top = paint256("▄".repeat(w), theme.banner256);
  const bot = paint256("▀".repeat(w), theme.banner256);
  const lines = ["", top, title, sub, bot];
  if (api) lines.push(...hudLines(api));
  lines.push("");
  return lines;
}
function bar(pct, width = 28) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const fill = Math.round((p / 100) * width);
  const col = p >= 80 ? A.green : p >= 40 ? theme.accent : A.yellow;
  return `${c("|", A.gray)}${c("█".repeat(fill) + "░".repeat(width - fill), col)}${c("|", A.gray)} ${c(`${p.toFixed(0)}%`.padStart(4), A.bold)}`;
}
/** 조회가 끝나는 동안 같은 줄에 대기 표시를 둔다. 결과 로그와 붙지 않게 지우고 쓴다. */
async function spin(label, work) {
  if (!TTY) {
    process.stdout.write(`${label} ...\n`);
    return work();
  }
  let i = 0;
  let painting = false;
  const origWrite = process.stdout.write.bind(process.stdout);
  const paint = () => {
    painting = true;
    try {
      origWrite(`\r${c(SPIN[i++ % SPIN.length], theme.accent)} ${c(label, A.dim)}\x1b[K`);
    } finally {
      painting = false;
    }
  };
  process.stdout.write = function (chunk, encoding, cb) {
    if (painting) return origWrite(chunk, encoding, cb);
    painting = true;
    try {
      origWrite("\r\x1b[K");
      return origWrite(chunk, encoding, cb);
    } finally {
      painting = false;
    }
  };
  origWrite("\x1b[?25l");
  paint();
  const t = setInterval(paint, 70);
  try {
    return await work();
  } finally {
    clearInterval(t);
    process.stdout.write = origWrite;
    origWrite("\r\x1b[K\x1b[?25h");
  }
}
async function ask(rl, label, fallback = "", opt = {}) {
  const a = (
    await promptField(rl, {
      label,
      fallback,
      secret: Boolean(opt.secret)
    })
  ).trim();
  return a || fallback;
}
/** 브라우저에서 이캠퍼스 메인을 연다. CLI 세션 쿠키는 넘기지 않는다. */
function openCampusMain() {
  const url = "https://ecampus.seowon.ac.kr/home/mainHome/Form/main";
  const opener = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(opener, [url], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return { ok: true, url, error: "" };
}

async function emptyNotice(ctx, message, color = A.red) {
  console.log(c(`  ${message}`, color));
  await waitEnter(ctx.rl, "Enter 이전 메뉴로 · Esc 이전");
}
function cleanSid(s) {
  const t = String(s || "").replace(/[\x00-\x1f\x7f]/g, "").trim();
  const first = (t.split(/\s+/)[0] || "").trim();
  const digits = first.replace(/\D/g, "");
  return digits.length >= 8 ? digits : first;
}
function cleanPw(s) {
  return String(s || "").replace(/[\x00-\x08\x0a-\x1f\x7f]/g, "").trim();
}
async function confirm(rl, q, opt) {
  return confirmButtons(rl, q, opt);
}
async function pickFromList(rl, title, items, labelOf, columns) {
  return tableSelect(rl, title, items, columns, { labelOf });
}
async function pickFile(rl, opt) {
  return directoryTree(rl, opt);
}

function parseArgs(argv) {
  const out = {
    suite: "",
    sid: process.env.SEOWON_SID || "",
    pw: process.env.SEOWON_PW || "",
    timeout: "90000",
    depth: "3",
    verbose: false,
    list: false,
    help: false,
    write: false,
    heavy: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] || "";
    const next = () => argv[++i] || "";
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--list") out.list = true;
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (a === "--write") out.write = true;
    else if (a === "--heavy") out.heavy = true;
    else if (a === "--suite") out.suite = next();
    else if (a.startsWith("--suite=")) out.suite = a.slice(8);
    else if (a === "--sid") out.sid = next();
    else if (a.startsWith("--sid=")) out.sid = a.slice(6);
    else if (a === "--pw") out.pw = next();
    else if (a.startsWith("--pw=")) out.pw = a.slice(5);
    else if (a === "--timeout") out.timeout = next();
    else if (a.startsWith("--timeout=")) out.timeout = a.slice(10);
    else if (a === "--depth") out.depth = next();
    else if (a.startsWith("--depth=")) out.depth = a.slice(8);
  }
  return out;
}

function helpText() {
  return `
${c(APP_TITLE, A.bold, theme.accent)}
학교 서버에 이 프로세스가 직접 접속합니다. 웹 API 서버는 쓰지 않습니다.

  npm run api-cli
  npm run api-cli -- --suite all --sid 학번 --pw 비번

옵션  --sid --pw --suite all --depth 3 --heavy --write --timeout --verbose --list --help
`.trim();
}

const SIDEBAR = [
  { key: "login", num: "1", emoji: "🔑", label: "로그인", need: false, group: "사이드바" },
  { key: "todo", num: "2", emoji: "🔥", label: "지금 할 것", need: true, group: "사이드바" },
  { key: "asg", num: "3", emoji: "📝", label: "과제", need: true, group: "사이드바" },
  { key: "ntc", num: "4", emoji: "📢", label: "공지", need: true, group: "사이드바" },
  { key: "mat", num: "5", emoji: "📁", label: "강의실 자료", need: true, group: "사이드바" },
  { key: "les", num: "6", emoji: "💻", label: "이러닝", need: true, group: "사이드바" },
  { key: "tt", num: "7", emoji: "🗓️", label: "시간표", need: true, group: "사이드바" },
  { key: "score", num: "8", emoji: "📊", label: "성적", need: true, group: "사이드바" },
  { key: "sum", num: "9", emoji: "📌", label: "전체 현황", need: true, group: "사이드바" },
  { key: "cfg", num: "C", emoji: "⚙️", label: "설정", need: true, group: "사이드바" },
  { key: "info", num: "I", emoji: "🔬", label: "프로그램 정보", need: false, group: "사이드바" },
  { key: "test", num: "T", emoji: "🧪", label: "함수 전수 조사 (Dev)", need: true, group: "도구" },
  { key: "exit", num: "0", emoji: "🚪", label: "종료", need: false, group: "도구" }
];

const ALIAS = {
  login: "login",
  로그인: "login",
  todo: "todo",
  지금할것: "todo",
  할일: "todo",
  asg: "asg",
  과제: "asg",
  ntc: "ntc",
  공지: "ntc",
  mat: "mat",
  자료: "mat",
  les: "les",
  이러닝: "les",
  tt: "tt",
  시간표: "tt",
  score: "score",
  성적: "score",
  sum: "sum",
  현황: "sum",
  cfg: "cfg",
  설정: "cfg",
  info: "info",
  정보: "info",
  test: "test",
  테스트: "test",
  전수: "test",
  전수조사: "test",
  exit: "exit",
  종료: "exit"
};

function menuChoices(api) {
  const out = [];
  let group = "";
  for (const it of SIDEBAR) {
    if (it.group !== group) {
      group = it.group;
      out.push({ sep: true, name: group });
    }
    const locked = it.need && !api.loggedIn();
    out.push({
      key: String(it.num).toLowerCase(),
      name: `${it.emoji}  ${it.label}${locked ? "  (로그인)" : ""}`,
      value: it.key
    });
  }
  return out;
}

async function choose(ctx, message, pairs) {
  return expandSelect(
    ctx.rl,
    message,
    pairs.map(([key, name, value]) => ({ key, name, value: value ?? key }))
  );
}

const actions = makeActions({ ROOT, c, A, choose, pickFromList, confirm, ask, pickFile, spin, withDownloadBar, failLine, box, clearScreen: doClear, waitEnter, theme });

function resolveMenu(answer) {
  const a = String(answer || "").trim();
  if (a === "0") return "exit";
  const missing = { 희망바구니: 1, 바구니: 1, basket: 1, 자동시청: 1, watch: 1 };
  if (missing[a] || missing[a.replace(/\s+/g, "")]) return "missing";
  const byNum = SIDEBAR.find((it) => String(it.num).toLowerCase() === a.toLowerCase());
  if (byNum) return byNum.key;
  return ALIAS[a] || ALIAS[a.replace(/\s+/g, "")] || "";
}

function failLine(res, fallback) {
  if (res.ok) return "";
  return res.error || fallback || "실패";
}
function printKv(pairs) {
  const w = Math.max(...pairs.map((p) => dw(p[0])), 6);
  for (const [k, v] of pairs) {
    if (Array.isArray(v)) {
      console.log(`  ${c(pad(k, w), A.gray)}`);
      for (const ln of v) console.log(`    ${ln}`);
      continue;
    }
    console.log(`  ${c(pad(k, w), A.gray)}  ${v}`);
  }
}

function beginScreen(title, color) {
  doClear();
  if (theme.clearOnNav === false) console.log("");
  if (!title) return;
  const col = !color || color === A.blue ? theme.accent : color;
  console.log(c(`  ${title}`, A.bold, col));
}

function assignmentHasFile(r) {
  if (!r) return false;
  if (r.hasSubmittedFile) return true;
  return Array.isArray(r.submittedAttachments) && r.submittedAttachments.length > 0;
}

function asgStatusLabel(r) {
  if (r?.submittedFilesLoaded === true) return assignmentHasFile(r) ? "제출완료" : "미제출";
  if (assignmentHasFile(r)) return "제출완료";
  const s = String(r?.status || "");
  if (/제출/.test(s) && !/미제출/.test(s)) return "제출완료";
  return "미제출";
}

function asgStatusPaint(text, row) {
  return asgStatusLabel(row) === "제출완료" ? c(text, A.green, A.bold) : c(text, A.yellow, A.bold);
}

function missingAssignmentCount(course) {
  return (course?.assignments || []).filter((x) => asgStatusLabel(x) === "미제출").length;
}

function pendingLessonCount(course) {
  return (course?.elearning || []).filter((x) => x.needsWatch).length;
}

/** 차시 목록 상태. 기간이 지난 미학습은 완료로 치지 않는다. */
function lessonRowStatus(row) {
  const attendance = String(row?.attendanceStatus || "").trim();
  if (row?.needsWatch) return "미학습";
  if (/미학습|학습중/.test(attendance)) return "기간 외";
  if (/학습완료|출석|수료|완료/.test(attendance)) return "완료";
  return attendance || "완료";
}

function lessonRowPaint(text, row) {
  const label = lessonRowStatus(row);
  if (label === "완료") return c(text, A.green, A.bold);
  return c(text, A.yellow, A.bold);
}

/** 미완 건수. 0은 회색, 1 이상은 밝은 빨강. 표 칸의 뒤 공백은 유지한다. */
function alertCount(n) {
  const text = String(n);
  const value = Number(text.trim());
  if (!Number.isFinite(value) || value === 0) return c(text, A.gray);
  return c(text, A.bold, A.brightRed);
}

function asgFileLabel(r) {
  if (r?.submittedFilesLoaded !== true && !assignmentHasFile(r)) return "-";
  return assignmentHasFile(r) ? "있음" : "없음";
}

function asgFilePaint(text) {
  if (String(text).includes("있음")) return c(text, A.green);
  if (String(text).includes("없음")) return c(text, A.gray);
  return text;
}

function asgColumns() {
  return [
    { key: "title", head: "제목", width: 24 },
    { key: "courseTitle", head: "과목", width: 14 },
    { key: "status", head: "상태", width: 8, get: asgStatusLabel, paint: asgStatusPaint },
    { key: "file", head: "제출파일", width: 8, get: asgFileLabel, paint: asgFilePaint },
    { key: "period", head: "기간", width: 14 }
  ];
}

/** 세션이 없으면 로그인한다. force 면 학번을 다시 묻는다. */
async function ensureLogin(ctx, force = false) {
  const { api, rl, opt } = ctx;
  if (api.loggedIn() && api.student && !force) return true;
  let sid = force ? "" : opt.sid;
  let pw = force ? "" : opt.pw;
  if (!sid) sid = await ask(rl, "학번", opt.sid || "");
  if (!pw) pw = await ask(rl, "비밀번호", "");
  sid = cleanSid(sid);
  pw = cleanPw(pw);
  if (!sid || !pw) {
    console.log(c("  학번/비밀번호가 필요합니다.", A.red));
    return false;
  }
  opt.sid = sid;
  const res = await spin("학교 서버에 로그인 중", () =>
    api.liveLogin({ studentId: sid, password: pw, timeoutMs: 60000 })
  );
  if (!res.ok) {
    opt.pw = "";
    console.log(c(`  로그인 실패: ${failLine(res, "학번 또는 비밀번호")}`, A.red));
    return false;
  }
  opt.pw = pw;
  api.student = res.data?.student || null;
  const prof = await api.ensureSugang({ timeoutMs: 25000 });
  if (prof.ok && prof.data?.student) api.student = prof.data.student;
  console.log(c(`  ✓ ${api.student?.studentName || ""} ${api.student?.deptName || ""}`, A.green));
  return true;
}
async function needAuth(ctx) {
  if (ctx.api.loggedIn()) return true;
  console.log(c("  이 페이지는 학번 로그인이 필요합니다.", A.yellow));
  return ensureLogin(ctx);
}

/** 학번 로그인, .env 로그인, 로그아웃. */
async function pageLogin(ctx) {
  const { api, rl } = ctx;
  while (true) {
    beginScreen("🔑 로그인", A.blue);
    console.log(c("  학번으로 로그인합니다. 2번은 .env 의 SEOWON_SID · SEOWON_PW 를 사용합니다.", A.dim));
    const envSid = cleanSid(process.env.SEOWON_SID || "");
    const envPw = cleanPw(process.env.SEOWON_PW || "");
    const a = await choose(ctx, "로그인", [
      ["1", "학번 로그인", "1"],
      ["2", envSid && envPw ? `.env 로 로그인 · ${envSid}` : ".env 로 로그인 · 값 없음", "2"],
      ["3", "로그아웃", "3"],
      ["4", "지금 할 것 보러 가기", "4"]
    ]);
    if (!a) return;
    if (a === "1") {
      if (await ensureLogin(ctx, true)) return;
      continue;
    }
    if (a === "2") {
      if (!envSid || !envPw) {
        console.log(c("  .env 에 SEOWON_SID 와 SEOWON_PW 를 넣어 주세요.", A.yellow));
        await waitEnter(ctx.rl);
        continue;
      }
      ctx.opt.sid = envSid;
      ctx.opt.pw = envPw;
      if (await ensureLogin(ctx, false)) return;
      continue;
    }
    if (a === "3") {
      if (!(await confirm(rl, "학생 세션을 로그아웃할까요?", { affirmative: "로그아웃", negative: "취소" }))) continue;
      await api.logout();
      api.student = null;
      console.log(c("  학생 세션을 지웠습니다. (학교 e-campus 로그아웃 요청은 없음)", A.yellow));
      await waitEnter(ctx.rl);
      continue;
    }
    if (a === "4") {
      if (!(await needAuth(ctx))) continue;
      await pageTodo(ctx);
    }
  }
}

function flattenSnapshot(snap) {
  const courses = snap?.courses || [];
  let asg = 0;
  let les = 0;
  let dueA = 0;
  let dueL = 0;
  for (const c0 of courses) {
    asg += (c0.assignments || []).filter((x) => x.dueNow).length;
    les += (c0.elearning || []).filter((x) => x.needsWatch).length;
    dueA += (c0.assignments || []).filter((x) => x.dueNow).length;
    dueL += (c0.elearning || []).filter((x) => x.needsWatch).length;
  }
  return { courses, asg, les, dueA, dueL, semester: snap?.semester || "-" };
}

/** 지금 제출 기간의 미제출 과제와, 지금 학습 기간의 미학습 차시. */
async function pageTodo(ctx) {
  beginScreen("🔥 지금 할 것", A.red);
    const snap = await spin("fetchSnapshot", () => ctx.api.fetchSnapshot({ refresh: true, timeoutMs: 90000 }));
    if (!snap.ok) {
      console.log(c(`  ${failLine(snap)}`, A.red));
      await waitEnter(ctx.rl);
      return;
    }
    const list = await spin("listAssignments", () => ctx.api.listAssignments({ filter: "due", timeoutMs: 60000 }));
    const s = flattenSnapshot(snap.data.snapshot);
    let dueNowAsg = list.ok ? list.data?.rows || [] : [];
    if (!list.ok) {
      dueNowAsg = [];
      for (const c0 of s.courses) {
        for (const a of c0.assignments || []) {
          if (!a.dueNow) continue;
          dueNowAsg.push({ ...a, courseTitle: a.courseTitle || c0.courseTitle });
        }
      }
    }
    const dueA = dueNowAsg.length;
    printKv([
      ["학기", s.semester],
      ["과목", `${s.courses.length}개`],
      ["미제출 과제", c(String(dueA), dueA ? A.yellow : A.green)],
      ["미학습 차시", c(String(s.dueL), s.dueL ? A.yellow : A.green)]
    ]);
    const lessons = [];
    for (const c0 of s.courses) {
      for (const l of c0.elearning || []) {
        if (!l.needsWatch) continue;
        lessons.push({ ...l, courseTitle: l.courseTitle || c0.courseTitle, _kind: "les" });
      }
    }
    const items = [...dueNowAsg.map((r) => ({ ...r, _kind: "asg" })), ...lessons];
    if (!items.length) {
      await emptyNotice(ctx, "현재 기간 안에 미제출 과제나 미학습 차시가 없습니다.");
      return;
    }
    const picked = await pickFromList(ctx.rl, "지금 할 것", items, (r) => `${r.title || ""} ${r.courseTitle || ""}`, [
      { key: "kind", head: "구분", width: 6, get: (r) => (r._kind === "les" ? "이러닝" : "과제") },
      { key: "title", head: "제목", width: 22, get: (r) => r.title || r.week || "" },
      { key: "courseTitle", head: "과목", width: 14 },
      {
        key: "status",
        head: "상태",
        width: 8,
        get: (r) => (r._kind === "les" ? "미학습" : asgStatusLabel(r)),
        paint: (t, r) => (r._kind === "les" ? c(t, A.yellow, A.bold) : asgStatusPaint(t, r))
      },
      { key: "file", head: "제출파일", width: 8, get: (r) => (r._kind === "les" ? "-" : asgFileLabel(r)), paint: asgFilePaint },
      { key: "period", head: "기간", width: 14 }
    ]);
    if (!picked) return;
    if (picked._kind === "asg") await actions.asgActions(ctx, picked);
    else {
      const p = await spin("학습률", () =>
        ctx.api.fetchProgress({ crsCreCd: picked.crsCreCd, lessonCntsId: picked.lessonCntsId })
      );
      if (p.ok) console.log(`  학습률 ${bar(p.data.progressPercent)}`);
      else console.log(c(`  ${failLine(p)}`, A.red));
      await waitEnter(ctx.rl);
  }
}

function asgDue(r) {
  if (r.dueNow) return true;
  return asgStatusLabel(r) === "미제출" && !/마감|종료|지남/.test(String(r.status || "") + String(r.period || ""));
}

/** 과제 목록. 미제출은 기간과 관계없이 제출 파일이 없는 과제다. */
async function pageAsg(ctx) {
  while (true) {
    beginScreen("📝 과제", A.blue);
    console.log(c("  조회 · 제출 · 삭제 · 다운로드가 됩니다.", A.dim));
    const f = await choose(ctx, "과제 필터", [
      ["1", "전체 과제", "1"],
      ["2", "지금 할 수 있는 과제", "2"],
      ["3", "미제출 과제", "3"],
      ["4", "제출한 과제", "4"]
    ]);
    if (!f) return;
    const apiFilter = f === "2" ? "due" : f === "3" ? "missing" : f === "4" ? "submitted" : "curricular";
    const list = await spin("listAssignments", () => ctx.api.listAssignments({
      filter: apiFilter,
      category: apiFilter === "curricular" ? undefined : "curricular",
      refresh: true,
      timeoutMs: 60000
    }));
    if (!list.ok) {
      console.log(c(`  ${failLine(list)}`, A.red));
      await waitEnter(ctx.rl);
      continue;
    }
    let rows = list.data?.rows || [];
    if (f === "2") rows = rows.filter((r) => Boolean(r.dueNow));
    else if (f === "3") rows = rows.filter((r) => asgStatusLabel(r) === "미제출");
    else if (f === "4") rows = rows.filter((r) => asgStatusLabel(r) === "제출완료");
    if (!rows.length) {
      await emptyNotice(ctx, "선택한 조건에 맞는 과제가 없습니다.");
      return;
    }
    while (true) {
      beginScreen("📝 과제", A.blue);
      console.log(c(`  ${rows.length}건 · Esc 필터로`, A.gray));
      const picked = await pickFromList(ctx.rl, "과제", rows, (r) => `${r.title} ${r.courseTitle || ""} ${asgStatusLabel(r)}`, asgColumns());
      if (!picked) break;
      await actions.asgActions(ctx, picked);
    }
  }
}

/** 공지 목록과 본문. */
async function pageNtc(ctx) {
  beginScreen("📢 공지", A.blue);
  const list = await spin("fetchNotices", () => ctx.api.fetchNotices({ refresh: true, timeoutMs: 60000 }));
  if (!list.ok) {
    console.log(c(`  ${failLine(list)}`, A.red));
    await waitEnter(ctx.rl);
    return;
  }
  const rows = list.data?.rows || [];
  if (!rows.length) {
    await emptyNotice(ctx, "조회된 공지가 없습니다.");
    return;
  }
  while (true) {
    beginScreen("📢 공지", A.blue);
    console.log(c(`  ${rows.length}건`, A.gray));
    const picked = await pickFromList(ctx.rl, "공지", rows, (r) => `${r.title} ${r.courseTitle || ""}`, [
      { key: "title", head: "제목", width: 32 },
      { key: "courseTitle", head: "과목", width: 16 },
      { key: "date", head: "날짜", width: 12 }
    ]);
    if (!picked) return;
    const d = await spin("공지 본문", () =>
      ctx.api.fetchNoticeDetail({ crsCreCd: picked.crsCreCd, id: picked.id })
    );
    beginScreen("📢 공지", A.blue);
    if (!d.ok) {
      console.log(c(`  ${failLine(d)}`, A.red));
      await waitEnter(ctx.rl);
      continue;
    }
    console.log(box(picked.title, String(d.data.text || "(본문 없음)").split(/\r?\n/).slice(0, 18), 39));
    await actions.fileListActions(ctx, d.data.attachments || [], { crsCreCd: picked.crsCreCd, id: picked.id });
    await waitEnter(ctx.rl);
  }
}

/** 자료 목록과 첨부. 저장 위치는 고른 폴더다. */
async function pageMat(ctx) {
  beginScreen("📁 자료", A.yellow);
  const list = await spin("fetchMaterials", () => ctx.api.fetchMaterials({ refresh: true, timeoutMs: 60000 }));
  if (!list.ok) {
    console.log(c(`  ${failLine(list)}`, A.red));
    await waitEnter(ctx.rl);
    return;
  }
  const rows = list.data?.rows || [];
  if (!rows.length) {
    await emptyNotice(ctx, "조회된 강의실 자료가 없습니다.");
    return;
  }
  while (true) {
    beginScreen("📁 자료", A.yellow);
    console.log(c(`  ${rows.length}건`, A.gray));
    const picked = await pickFromList(ctx.rl, "자료", rows, (r) => `${r.title} ${r.courseTitle || ""}`, [
      { key: "title", head: "제목", width: 32 },
      { key: "courseTitle", head: "과목", width: 16 },
      { key: "attach", head: "첨부", width: 6, get: (r) => (r.hasAttachment ? "있음" : "") }
    ]);
    if (!picked) return;
    const d = await spin("첨부 목록", () =>
      ctx.api.fetchMaterialAttachments({ crsCreCd: picked.crsCreCd, id: picked.id })
    );
    beginScreen("📁 자료", A.yellow);
    if (!d.ok) {
      console.log(c(`  ${failLine(d)}`, A.red));
      await waitEnter(ctx.rl);
      continue;
    }
    await actions.fileListActions(ctx, d.data.files || [], { crsCreCd: picked.crsCreCd, id: picked.id });
    await waitEnter(ctx.rl);
  }
}

/** 이러닝. 전체 조회는 기간이 지난 차시도 포함하고, 들을 차시만 지금 기간이다. */
async function pageLes(ctx) {
  while (true) {
    beginScreen("💻 이러닝", A.blue);
    console.log(c("  전체 조회는 수강 기간이 지난 차시도 포함합니다. 학습률은 그 차시의 퍼센트만 다릅니다.", A.dim));
    const a = await choose(ctx, "이러닝", [
      ["1", "전체 조회 · 기간 지난 차시 포함", "1"],
      ["2", "들을 차시 · 지금 기간의 미학습만", "2"],
      ["3", "학습률 · 차시마다 퍼센트 조회", "3"]
    ]);
    if (!a) return;
    const filter = a === "2" ? "watch" : "all";
    const list = await spin("listLessons", () => ctx.api.listLessons({ filter, refresh: true, timeoutMs: 60000 }));
    if (!list.ok) {
      console.log(c(`  ${failLine(list)}`, A.red));
      await waitEnter(ctx.rl);
      continue;
    }
    const rows = list.data?.rows || [];
      if (!rows.length) {
        if (a === "2") {
          const note = watchListEmptyMessage(list.data?.facts || { total: 0, unwatched: 0, unknown: 0, periodClosed: 0, periodUnknown: 0 });
          await emptyNotice(ctx, note.text, note.done ? A.green : A.yellow);
        } else {
          await emptyNotice(ctx, "등록된 이러닝 차시가 없습니다.");
        }
        continue;
      }
      if (a === "3") {
        let failed = 0;
        let firstError = "";
        console.log(c(`  학습률 ${rows.length}건 · 동시에 ${Math.min(FETCH_LIMIT, rows.length)}개까지`, A.dim));
        await mapLimit(rows, FETCH_LIMIT, async (row) => {
          const p = await ctx.api.fetchProgress({ crsCreCd: row.crsCreCd, lessonCntsId: row.lessonCntsId, timeoutMs: 60000 });
          if (p.ok) row.progressPercent = p.data.progressPercent;
          else {
            failed += 1;
            row.progressError = failLine(p);
            if (!firstError) firstError = row.progressError;
          }
        });
        if (failed) console.log(c(`  학습률 실패 ${failed}/${rows.length} · ${firstError}`, A.red));
      }
      while (true) {
      beginScreen("💻 이러닝", A.blue);
      const listTitle = a === "3" ? "학습률" : a === "2" ? "들을 차시" : "전체 조회";
      console.log(c(`  ${listTitle} · ${rows.length}건 · Esc 이러닝 메뉴로`, A.gray));
      const columns = [
        { key: "title", head: "제목", width: 28 },
        { key: "courseTitle", head: "과목", width: 16 },
        { key: "need", head: "상태", width: 8, get: lessonRowStatus, paint: lessonRowPaint }
      ];
      if (a === "3") {
        columns.push({
          key: "progressPercent",
          head: "학습률",
          width: 8,
          get: (r) => (r.progressError ? "실패" : r.progressPercent == null ? "-" : `${r.progressPercent}%`),
          paint: (t, r) => (r.progressError ? c(t, A.red, A.bold) : t)
        });
      }
      const picked = await pickFromList(ctx.rl, listTitle, rows, (r) => `${r.title} ${r.courseTitle || ""}`, columns);
      if (!picked) break;
      beginScreen("💻 이러닝", A.blue);
      console.log(`  ${c(picked.courseTitle || "과목", A.bold)}  ${picked.title || ""}`);
      console.log(c(`  ${picked.needsWatch ? "미학습" : "수강"} · ${picked.period || "-"}`, A.dim));
      if (a === "3") {
        const p = await spin("학습률", () =>
          ctx.api.fetchProgress({ crsCreCd: picked.crsCreCd, lessonCntsId: picked.lessonCntsId, timeoutMs: 60000 })
        );
        if (p.ok) {
          picked.progressPercent = p.data.progressPercent;
          picked.progressError = "";
          console.log(`  학습률 ${bar(p.data.progressPercent)}`);
        } else {
          picked.progressError = failLine(p);
          console.log(c(`  ${picked.progressError}`, A.red));
        }
      } else if (picked.progressPercent != null) {
        console.log(`  학습률 ${bar(picked.progressPercent)}`);
      }
      const act = await choose(ctx, "차시 동작", [
        ["s", "수강하기", "s"],
        ["d", "영상 다운로드", "d"],
        ["b", "뒤로", "b"]
      ]);
      if (!act || act === "b") continue;
      if (act === "s") {
        const opened = openCampusMain();
        if (!opened.ok) console.log(c(`  ${opened.error}`, A.red));
        else {
          console.log(c("  브라우저에서 이캠퍼스 메인을 열었습니다.", A.green));
          console.log(c("  브라우저에 학교 로그인이 되어 있어야 메인으로 들어갑니다.", A.dim));
        }
        await waitEnter(ctx.rl);
        continue;
      }
      if (act === "d") await actions.downloadLesson(ctx, picked);
    }
  }
}

/** 수강 과목과 시간. 그림은 PNG 로만 저장한다. */
async function pageTt(ctx) {
  beginScreen("🗓️ 시간표", A.blue);
  const t = await spin("fetchTimetable", () => ctx.api.fetchTimetable({ refresh: true, timeoutMs: 60000 }));
  if (!t.ok) {
    console.log(c(`  ${failLine(t)}`, A.red));
    await waitEnter(ctx.rl);
    return;
  }
  const tt = t.data.timetable || {};
  if (!(tt.subjects || []).length) {
    await emptyNotice(ctx, "조회된 수강 시간표가 없습니다.");
    return;
  }
  while (true) {
    beginScreen("🗓️ 시간표", A.blue);
    printKv([
      ["라벨", tt.label || "-"],
      ["과목", String(tt.courseCount || tt.subjects?.length || 0)],
      ["학점", String(tt.totalCredits || 0)],
      ["충돌", String(tt.conflictCount || 0)]
    ]);
    const a = await choose(ctx, "시간표", [
      ["1", "과목 목록", "1"],
      ["2", "PNG 저장", "png"]
    ]);
    if (!a) return;
    if (a === "png") {
      await actions.saveTimetable(ctx);
      await waitEnter(ctx.rl);
      continue;
    }
    while (true) {
      beginScreen("🗓️ 시간표", A.blue);
      const picked = await pickFromList(ctx.rl, "수강 과목", tt.subjects || [], (it) => `${it.subjtNm || it.title || ""} ${subjectTimeText(it)}`, [
        { key: "name", head: "과목", width: 24, get: (it) => it.subjtNm || it.title || it.courseTitle || "과목" },
        { key: "time", head: "시간", width: 28, get: subjectTimeText }
      ]);
      if (!picked) break;
      beginScreen("🗓️ 시간표", A.blue);
      printKv([
        ["과목", picked.subjtNm || picked.title || picked.courseTitle || "과목"],
        ["시간", subjectTimeText(picked)],
        ["교수", picked.chrgInstrEmpnm || "-"],
        ["학점", picked.cmpsjCdt || "-"],
        ["구분", picked.kind || "-"]
      ]);
      await waitEnter(ctx.rl, "Enter 목록으로 · Esc 이전");
    }
  }
}

/** 과목의 시간표 문자열. 없으면 요일·교시 슬롯을 이어 붙인다. */
function subjectTimeText(it) {
  const raw = String(it?.timtbNm || it?.tmRms || it?.time || "").replace(/\s+/g, " ").trim();
  if (raw) return raw;
  const slots = Array.isArray(it?.slots) ? it.slots : [];
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const groups = new Map();
  for (const slot of slots) {
    const day = days[Number(slot?.day)] || "";
    const period = Number(slot?.period);
    if (!day || !period) continue;
    const list = groups.get(day) || [];
    if (!list.includes(period)) list.push(period);
    groups.set(day, list);
  }
  const parts = [];
  for (const [day, periods] of groups) {
    periods.sort((a, b) => a - b);
    parts.push(`${day} ${periods.join(",")}`);
  }
  return parts.join(" · ") || "-";
}

function gradeNum(value) {
  if (value == null || value === "") return "-";
  return String(value);
}

function subjectLetter(row) {
  return String(row?.cmpsjGradeGrdCd || row?.grade || "").trim();
}

function subjectTitle(row) {
  const name = row?.subjtNm || row?.title || "과목";
  const letter = subjectLetter(row);
  return letter ? `${name}  ${letter}` : name;
}

function letterPaint(text, row) {
  const letter = subjectLetter(row).toUpperCase();
  const color = letter.startsWith("A") || letter === "P"
    ? A.green
    : letter.startsWith("B")
      ? A.cyan
      : letter.startsWith("C")
        ? A.yellow
        : letter.startsWith("D") || letter.startsWith("F")
          ? A.brightRed
          : A.gray;
  return c(text, A.bold, color);
}

/** 이번 학기 e-campus 성적과 지난 학기 ERP 등급. */
async function pageScore(ctx) {
  while (true) {
    beginScreen("📊 성적", A.green);
    const a = await choose(ctx, "성적", [
      ["1", "현재 성적 (e-campus)", "1"],
      ["2", "지난 성적 (ERP)", "2"]
    ]);
    if (!a) return;
    if (a !== "2") {
      const cur = await spin("fetchScores", () => ctx.api.fetchScores({ refresh: true, timeoutMs: 90000 }));
      beginScreen("📊 성적", A.green);
      if (!cur.ok) {
        console.log(c(`  ${failLine(cur)}`, A.red));
        await waitEnter(ctx.rl);
        continue;
      }
      const rows = cur.data.scores || cur.data.rows || [];
      if (!rows.length) {
        await emptyNotice(ctx, "현재 학기 성적 조회 결과가 없습니다. 성적 공개 기간이 아니거나 수강 과목을 확인하지 못했을 수 있습니다.");
        continue;
      }
      const picked = await pickFromList(ctx.rl, "현재 성적", rows, (r) => `${r.courseTitle || "과목"} ${r.grade || r.total || r.status || ""}`, [
        { key: "course", head: "과목", width: 24, get: (r) => r.courseTitle || "과목" },
        { key: "grade", head: "등급", width: 8, get: (r) => r.grade || "-" },
        { key: "total", head: "총점", width: 8, get: (r) => r.total || "-" },
        { key: "status", head: "상태", width: 14, get: (r) => r.canView ? "조회 가능" : (r.message || r.status || "조회 불가") }
      ]);
      if (picked && !picked.canView) await emptyNotice(ctx, `${picked.courseTitle || "이 과목"} 성적을 조회할 수 없습니다: ${picked.message || picked.status || "공개되지 않았습니다."}`);
      continue;
    }
    const erp = await spin("fetchErpGrades", () => ctx.api.fetchErpGrades({ refresh: true, timeoutMs: 45000 }));
    beginScreen("📊 성적", A.green);
    if (!erp.ok) {
      console.log(c(`  ${failLine(erp)}`, A.red));
      await waitEnter(ctx.rl);
      continue;
    }
    const g = erp.data.grades || {};
    printKv([
      ["누계 GPA", c(String(g.summary?.gpa ?? "-"), A.bold, A.blue)],
      ["학기 수", String((g.terms || []).length)]
    ]);
    const terms = [...(g.terms || [])].sort((x, y) => String(y.syy || "").localeCompare(String(x.syy || "")));
    if (!terms.length) {
      await emptyNotice(ctx, "지난 성적 학기 정보가 없습니다.");
      continue;
    }
    const picked = await pickFromList(ctx.rl, "학기", terms, (t) => t.label || `${t.syy} ${t.smtNm || t.smtCd}`, [
      { key: "term", head: "학기", width: 22, get: (t) => t.label || `${t.syy} ${t.smtNm || t.smtCd}` },
      { key: "gpa", head: "GPA", width: 6, get: (t) => gradeNum(t.total?.gpa) },
      { key: "acqs", head: "취득", width: 6, get: (t) => gradeNum(t.total?.acqsCdt) }
    ]);
    if (!picked) continue;
    const det = await spin("학기 상세", () =>
      ctx.api.fetchErpGrades({ syy: picked.syy, smtCd: picked.smtCd, timeoutMs: 30000 })
    );
    beginScreen("📊 성적", A.green);
    const term = det.data?.term;
    if (!det.ok) {
      await emptyNotice(ctx, `선택한 학기 성적을 불러오지 못했습니다: ${failLine(det)}`);
      continue;
    }
    if (!term || !(term.subjects || []).length) {
      await emptyNotice(ctx, "선택한 학기의 과목 성적이 비어 있습니다.");
      continue;
    }
    const total = term.total;
    const graded = (term.subjects || []).filter((s) => subjectLetter(s)).length;
    printKv([
      ["학기", term.label || `${term.syy || ""} ${term.smtNm || ""}`.trim()],
      ["학기 GPA", c(gradeNum(total?.gpa), A.bold, A.blue)],
      ["신청 학점", gradeNum(total?.aplyCdt)],
      ["취득 학점", gradeNum(total?.acqsCdt)],
      ["석차", total?.smtStnd || "-"],
      ["등급 있는 과목", `${graded}/${term.subjects.length}`]
    ]);
    if (!graded) {
      console.log(c("  과목 이름은 왔지만 등급 문자는 응답에 없습니다.", A.yellow));
    }
    while (true) {
      const row = await pickFromList(ctx.rl, "과목 성적", term.subjects, (s) => subjectTitle(s), [
        { key: "subjtNm", head: "과목", width: 24, get: (s) => subjectTitle(s) },
        { key: "div", head: "구분", width: 8, get: (s) => s.cmpsjDivNm || s.cmpsjDivCd || "-" },
        { key: "cdt", head: "학점", width: 4, get: (s) => gradeNum(s.cmpsjCdt) },
        { key: "grade", head: "등급", width: 6, get: (s) => subjectLetter(s) || "-", paint: letterPaint },
        { key: "gp", head: "평점", width: 6, get: (s) => gradeNum(s.cmpsjGp ?? s.gpa) }
      ]);
      if (!row) break;
      beginScreen("📊 성적", A.green);
      printKv([
        ["과목", row.subjtNm || row.title || "과목"],
        ["등급", letterPaint(subjectLetter(row) || "-", row)],
        ["평점", gradeNum(row.cmpsjGp ?? row.gpa)],
        ["학점", gradeNum(row.cmpsjCdt)],
        ["구분", row.cmpsjDivNm || row.cmpsjDivCd || "-"],
        ["과목코드", row.subjtCd || "-"]
      ]);
      await waitEnter(ctx.rl, "Enter 목록으로 · Esc 이전");
      beginScreen("📊 성적", A.green);
    }
  }
}

/** 과목별 미제출 과제와 기간 안 미완료 차시. 0이 아니면 밝은 빨강. */
async function pageSum(ctx) {
  while (true) {
    beginScreen("📌 전체 현황", A.blue);
    const a = await choose(ctx, "전체 현황 필터", [
      ["1", "전체 과목 (교과+비교과)", "1"],
      ["2", "교과 과목만", "2"],
      ["3", "비교과 과목만", "3"]
    ]);
    if (!a) return;
    const snap = await spin("fetchSnapshot", () => ctx.api.fetchSnapshot({ refresh: true, timeoutMs: 90000 }));
    beginScreen("📌 전체 현황", A.blue);
    if (!snap.ok) {
      console.log(c(`  ${failLine(snap)}`, A.red));
      await waitEnter(ctx.rl);
      continue;
    }
    const s = flattenSnapshot(snap.data.snapshot);
    let courses = s.courses;
    if (a === "2") courses = courses.filter((x) => /교과/.test(x.label || x.category || "") && !/비교과/.test(x.label || x.category || ""));
    if (a === "3") courses = courses.filter((x) => /비교과/.test(x.label || x.category || ""));
    if (!courses.length) {
      await emptyNotice(ctx, "선택한 구분에 해당하는 과목이 없습니다.");
      return;
    }
    const missing = courses.reduce((n, c0) => n + missingAssignmentCount(c0), 0);
    const pending = courses.reduce((n, c0) => n + pendingLessonCount(c0), 0);
    console.log(c("  미제출 과제는 기간과 관계없이 제출하지 않은 과제입니다. 차시는 현재 학습 기간 안의 미학습·학습중입니다.", A.dim));
    printKv([
      ["학기", s.semester],
      ["과목", String(courses.length)],
      ["미제출 과제", alertCount(missing)],
      ["미완료 차시", alertCount(pending)]
    ]);
    const picked = await pickFromList(ctx.rl, "과목 현황", courses, (c0) => c0.courseTitle, [
      { key: "courseTitle", head: "과목", width: 28 },
      { key: "label", head: "구분", width: 10, get: (c0) => c0.label || c0.category || "" },
      { key: "asg", head: "미제출 과제", width: 10, get: (c0) => missingAssignmentCount(c0), paint: (t) => alertCount(t) },
      { key: "les", head: "미완료 차시", width: 10, get: (c0) => pendingLessonCount(c0), paint: (t) => alertCount(t) }
    ]);
    if (!picked) continue;
  }
}

/** 테마 색 목록. */
async function pageTheme(ctx) {
  doClear();
  const keys = "123456789abcdefghijklmnopqrstuvwxyz";
  const choices = [];
  let live = 0;
  let group = "";
  for (const spec of THEME_LIST) {
    if (spec.group !== group) {
      group = spec.group;
      choices.push({ sep: true, name: group });
    }
    const cur = spec.id === theme.id ? c("  ← 현재", A.bold, theme.accent) : "";
    choices.push({
      key: keys[live] || String(live + 1),
      name: `${themeSwatch(spec)}  ${spec.name}  ${c(spec.hint, A.dim)}${cur}`,
      value: spec.id
    });
    live += 1;
  }
  const prev = theme.id;
  let waveOff = 0;
  const picked = await expandSelect(ctx.rl, "테마 색 구성", choices, {
    initial: prev,
    header: () => [
      ...bannerLines(null, waveOff),
      c("  배너 · 메뉴 포인터 · 확인 버튼에 바로 적용됩니다.", A.dim, A.gray)
    ],
    onTick: () => {
      waveOff += 1;
    },
    tickMs: WAVE_MS,
    onMove: (id) => {
      if (id) applyTheme(id, false);
    }
  });
  if (!picked) {
    applyTheme(prev, false);
    return;
  }
  applyTheme(picked);
  const spec = THEMES[theme.id];
  console.log(`  ${themeSwatch(spec)}  ${c(`${spec.name}  ·  ${spec.hint}`, A.bold, theme.accent)}`);
  await waitEnter(ctx.rl);
}

/** 테마, 화면 지우기, 캐시 비우기. */
async function pageCfg(ctx) {
  while (true) {
    const cur = THEMES[theme.id] || THEMES.seowon;
    beginScreen("⚙️ 설정");
    const wipe = theme.clearOnNav !== false;
    console.log(`  TUI 테마  ${themeSwatch(cur)}  ${c(cur.name, theme.accent)}  ${c(cur.hint, A.dim)}`);
    console.log(`  화면 지우기  ${c(wipe ? "켜짐" : "꺼짐", wipe ? A.green : A.yellow)}  ${c("메뉴를 바꿀 때 터미널을 지울지", A.dim)}`);
    const a = await choose(ctx, "설정", [
      ["1", "캐시 비우고 다시 조회 (clearCache)", "1"],
      ["2", "로그아웃", "2"],
      ["3", `TUI 테마 색  (${cur.name})`, "3"],
      ["4", `메뉴 전환 시 화면 지우기  (${wipe ? "켜짐" : "꺼짐"})`, "4"]
    ]);
    if (!a) return;
    if (a === "1") {
      if (!ctx.api.loggedIn()) {
        console.log(c("  전체 메뉴 조회는 로그인이 필요합니다.", A.yellow));
        await waitEnter(ctx.rl);
        continue;
      }
      const ok = await confirm(
        ctx.rl,
        "캐시를 비울까요? 지금 할 것·과제·공지·자료·이러닝·시간표·성적·현황을 다시 칩니다.",
        { affirmative: "조회", negative: "취소" }
      );
      if (!ok) continue;
      const r = await ctx.api.clearCache();
      console.log(r.ok ? c("  캐시를 비웠습니다.", A.green) : c(`  ${failLine(r)}`, A.red));
      await waitEnter(ctx.rl);
    } else if (a === "2") {
      if (!ctx.api.loggedIn()) {
        console.log(c("  로그인된 세션이 없습니다.", A.yellow));
        await waitEnter(ctx.rl);
        continue;
      }
      if (!(await confirm(ctx.rl, "학생 세션을 로그아웃할까요?", { affirmative: "로그아웃", negative: "취소" }))) continue;
      await ctx.api.logout();
      ctx.api.student = null;
      console.log(c("  로그아웃", A.yellow));
      await waitEnter(ctx.rl);
    } else if (a === "3") {
      await pageTheme(ctx);
    } else if (a === "4") {
      theme.clearOnNav = theme.clearOnNav === false;
      saveConfig();
      const on = theme.clearOnNav !== false;
      console.log(c(`  메뉴 전환 시 화면 지우기: ${on ? "켜짐" : "꺼짐"}`, on ? A.green : A.yellow));
      if (on) doClear();
      await waitEnter(ctx.rl);
    }
  }
}

/** 패키지, 언어, 로그인 상태. */
async function pageInfo(ctx) {
  beginScreen("🔬 프로그램 정보", A.blue);
  const me = ctx.api.loggedIn() ? await ctx.api.currentStudent() : null;
  printKv([
    ["패키지", `${PKG.name} v${PKG.version}`],
    ["언어", "TypeScript · Node.js 20"],
    ["화면", "자체 터미널 메뉴 · 웹 프레임워크 없음"],
    ["통신", "axios로 학교 페이지 · cheerio로 HTML"],
    ["연결", "학교 서버 직접 · 내부 함수"],
    ["로그인", me?.data?.loggedIn ? c(me.data.student?.studentName || "됨", A.green) : c("전", A.gray)]
  ]);
  console.log(c("  TypeScript로 작성한 Node.js 프로그램입니다. 화면은 별도 UI 프레임워크 없이 이 터미널 메뉴로 그립니다.", A.dim));
  console.log(c("  확정 수강 목록·과제·이러닝·시간표·성적을 이 프로세스에서 조회합니다.", A.dim));
  await waitEnter(ctx.rl, "Enter 메뉴로 · Esc 이전");
}

const SURVEY_FUNCTIONS = [
  ["currentStudent", "지금 로그인된 학생인지 확인"],
  ["ensureSugang", "시간표 시스템에 맞추고 이름·학과를 가져옴"],
  ["clearCache", "메모리에 둔 과제·공지·자료·이러닝·성적 캐시를 비움"],
  ["fetchSnapshot", "과목별 과제와 이러닝을 한 번에 조회"],
  ["listAssignments", "과제 목록. 전체·교과·지금 할 일·미제출·제출완료"],
  ["fetchAssignmentDetail", "과제 하나의 본문과 제출 파일"],
  ["fetchNotices", "공지 목록"],
  ["fetchNoticeDetail", "공지 하나의 본문"],
  ["fetchMaterials", "강의실 자료 목록"],
  ["fetchMaterialAttachments", "자료 하나의 첨부 파일"],
  ["listLessons", "이러닝 차시. all은 전체, watch는 지금 들을 차시"],
  ["fetchProgress", "차시 하나의 학습률. 시청 기록은 보내지 않음"],
  ["fetchTimetable", "확정 수강 시간표"],
  ["fetchScores", "이번 학기 e-campus 성적"],
  ["fetchErpGrades", "지난 학기 ERP 성적. 학기를 고르면 과목 등급"],
  ["saveTimetableFile", "시간표 PNG를 고른 폴더에 저장. --write"],
  ["downloadCampusFile", "자료 첨부 하나를 고른 폴더에 저장. --write"],
  ["downloadLessonVideo", "이러닝 영상 하나를 저장. --write --heavy"],
  ["submitAssignment", "과제 제출. 조사에서는 호출하지 않음"],
  ["logout", "세션 종료. 조사에서는 호출하지 않음"]
];

const ASSIGNMENT_FILTER_ABOUT = {
  all: "전체 과제",
  curricular: "교과 과제",
  due: "지금 제출 기간의 미제출 과제",
  missing: "제출하지 않은 과제",
  submitted: "제출한 과제"
};

/** 같은 함수를 여러 번 부를 때, 그 호출이 고른 대상을 한 줄로 적는다. */
function surveyAbout(name) {
  const text = String(name || "");
  const listFilter = text.match(/^listAssignments\(([^)]+)\)$/);
  if (listFilter) return `과제 목록 · ${ASSIGNMENT_FILTER_ABOUT[listFilter[1]] || listFilter[1]}`;
  if (text.startsWith("listLessons(watch")) return "지금 학습 기간의 미학습·학습중 차시";
  if (text.startsWith("listLessons(")) return "등록된 이러닝 차시 전체";
  if (text.startsWith("fetchErpGrades(")) return "고른 학기의 과목 등급·평점";
  if (text.startsWith("fetchAssignmentDetail")) return "과제 하나의 본문과 제출 파일";
  if (text.startsWith("fetchNoticeDetail")) return "공지 하나의 본문";
  if (text.startsWith("fetchMaterialAttachments")) return "자료 하나의 첨부 파일";
  const base = text.split(/[ (]/)[0];
  const hit = SURVEY_FUNCTIONS.find((row) => row[0] === base);
  return hit ? hit[1] : "";
}

/** 함수 전수 조사 확인 화면. 각 함수가 하는 일을 먼저 보여 준다. */
async function pageTest(ctx) {
  beginScreen("🧪 함수 전수 조사 (Dev)", A.yellow);
  console.log(c("  Campus 함수를 순서대로 부릅니다. 과제 제출과 로그아웃은 호출하지 않습니다.", A.dim));
  console.log(c(`  상세 ${ctx.opt.heavy ? "전체" : `${ctx.opt.depth || 3}건`} · 파일 저장 ${ctx.opt.write ? "켬" : "끔"}`, A.gray));
  console.log("");
  for (const [name, about] of SURVEY_FUNCTIONS) {
    console.log(`  ${c(pad(name, 26), A.bold)}  ${c(about, A.dim)}`);
  }
  console.log("");
  const ok = await confirm(ctx.rl, "로그인된 세션으로 함수 전수 조사를 시작할까요?", {
    affirmative: "시작",
    negative: "취소"
  });
  if (!ok) return;
  ctx.api.results = [];
  const skips = await runReadSweep(ctx);
  const ran = ctx.api.results;
  const bad = ran.filter((r) => !r.ok);
  console.log(hr());
  console.log(`  ${c(`${ran.length - bad.length} OK`, A.green)}  ${bad.length ? c(`${bad.length} FAIL`, A.red) : "0 FAIL"}  ${c(`${skips.length} SKIP`, A.yellow)}`);
  for (const r of bad) console.log(c(`    FAIL  ${r.name}  ${r.detail}`, A.red));
  for (const s of skips) console.log(c(`    SKIP  ${s.name}  ${s.why}`, A.yellow));
  await waitEnter(ctx.rl);
}

/** 조회 함수만 순서대로 실행한다. 과제 제출과 로그아웃은 부르지 않는다. */
async function runReadSweep(ctx) {
  const { api, opt } = ctx;
  const depth = opt.heavy ? 1000 : Math.max(1, Number(opt.depth) || 3);
  const skips = [];
  const log = (name, res) => {
    const mark = res?.ok ? c("OK", A.green) : c("FAIL", A.red);
    const about = surveyAbout(name);
    console.log(`  ${mark}  ${c(`${res?.ms || 0}ms`.padStart(7), A.dim)}  ${c(name, A.bold)}`);
    if (about) console.log(c(`           ${about}`, A.dim));
  };
  const skip = (name, why) => {
    skips.push({ name, why });
    const about = surveyAbout(name);
    console.log(`  ${c("SKIP", A.yellow)}  ${"".padStart(7)}  ${c(name, A.bold)}  ${c(why, A.dim)}`);
    if (about) console.log(c(`           ${about}`, A.dim));
  };
  const take = (rows) => (rows || []).slice(0, depth);

  log("currentStudent", await api.currentStudent());
  log("ensureSugang", await api.ensureSugang({ timeoutMs: 25000 }));
  log("clearCache", await api.clearCache());
  log("fetchSnapshot", await api.fetchSnapshot({ refresh: true, timeoutMs: 90000 }));

  let assignments = [];
  for (const filter of ["all", "curricular", "due", "missing", "submitted"]) {
    const list = await api.listAssignments({
      filter,
      category: filter === "all" ? undefined : "curricular",
      timeoutMs: 90000
    });
    log(`listAssignments(${filter})`, list);
    if (filter === "all" && list.ok) assignments = list.data?.rows || [];
  }
  for (const row of take(assignments)) {
    log(
      `fetchAssignmentDetail ${String(row.title || "").slice(0, 24)}`,
      await api.fetchAssignmentDetail({ crsCreCd: row.crsCreCd, id: row.id, timeoutMs: 60000 })
    );
  }
  if (!assignments.length) skip("fetchAssignmentDetail", "과제 행이 없습니다");

  const notices = await api.fetchNotices({ refresh: true, timeoutMs: 90000 });
  log("fetchNotices", notices);
  const noticeRows = notices.ok ? notices.data?.rows || [] : [];
  for (const row of take(noticeRows)) {
    log(
      `fetchNoticeDetail ${String(row.title || "").slice(0, 24)}`,
      await api.fetchNoticeDetail({ crsCreCd: row.crsCreCd, id: row.id, timeoutMs: 60000 })
    );
  }
  if (!noticeRows.length) skip("fetchNoticeDetail", "공지 행이 없습니다");

  const materials = await api.fetchMaterials({ refresh: true, timeoutMs: 90000 });
  log("fetchMaterials", materials);
  const materialRows = materials.ok ? materials.data?.rows || [] : [];
  let firstFile = null;
  for (const row of take(materialRows)) {
    const files = await api.fetchMaterialAttachments({ crsCreCd: row.crsCreCd, id: row.id, timeoutMs: 60000 });
    log(`fetchMaterialAttachments ${String(row.title || "").slice(0, 20)}`, files);
    if (!firstFile && files.ok) firstFile = (files.data?.files || []).find((file) => file?.url) || null;
  }
  if (!materialRows.length) skip("fetchMaterialAttachments", "자료 행이 없습니다");

  const lessons = await api.listLessons({ filter: "all", timeoutMs: 90000 });
  log("listLessons(all)", lessons);
  const watchLessons = await api.listLessons({ filter: "watch", timeoutMs: 60000 });
  log("listLessons(watch)", watchLessons);
  const lessonRows = lessons.ok ? lessons.data?.rows || [] : [];
  const lesson = lessonRows.find((row) => row.crsCreCd && row.lessonCntsId) || null;
  if (lesson) {
    log(
      "fetchProgress",
      await api.fetchProgress({ crsCreCd: lesson.crsCreCd, lessonCntsId: lesson.lessonCntsId, timeoutMs: 60000 })
    );
  } else skip("fetchProgress", "차시 행이 없습니다");

  const timetable = await api.fetchTimetable({ refresh: true, timeoutMs: 90000 });
  log("fetchTimetable", timetable);
  log("fetchScores", await api.fetchScores({ refresh: true, timeoutMs: 90000 }));
  const grades = await api.fetchErpGrades({ refresh: true, timeoutMs: 90000 });
  log("fetchErpGrades", grades);
  const term = grades.ok ? (grades.data?.grades?.terms || [])[0] : null;
  if (term?.syy && term?.smtCd) {
    log(
      `fetchErpGrades(${term.syy}/${term.smtCd})`,
      await api.fetchErpGrades({ syy: term.syy, smtCd: term.smtCd, timeoutMs: 60000 })
    );
  } else skip("fetchErpGrades(term)", "학기 행이 없습니다");

  if (opt.write && timetable.ok) {
    const dest = await actions.chooseSavePath(ctx, "survey-timetable.png");
    if (dest) {
      log(
        "saveTimetableFile",
        await withDownloadBar(path.basename(dest), (report) =>
          api.saveTimetableFile({
            savePath: dest,
            timeoutMs: 30000,
            onProgress: (loaded, total) => report(loaded, total)
          })
        )
      );
    }
    else skip("saveTimetableFile", "저장 위치를 고르지 않았습니다");
  } else skip("saveTimetableFile", opt.write ? "시간표가 없습니다" : "--write 일 때만 저장합니다");

  if (opt.write && firstFile?.url) {
    const dest = await actions.chooseSavePath(ctx, firstFile.title || "survey-file.bin");
    if (dest) {
      log(
        "downloadCampusFile",
        await withDownloadBar(path.basename(dest), (report) =>
          api.downloadCampusFile({
            url: firstFile.url,
            savePath: dest,
            timeoutMs: 180000,
            onProgress: (loaded, total) => report(loaded, total)
          })
        )
      );
    } else skip("downloadCampusFile", "저장 위치를 고르지 않았습니다");
  } else skip("downloadCampusFile", opt.write ? "받을 첨부가 없습니다" : "--write 일 때만 저장합니다");

  if (opt.write && opt.heavy && lesson) {
    const dest = await actions.chooseSavePath(ctx, "survey-lesson.mp4");
    if (dest) {
      log(
        "downloadLessonVideo",
        await withDownloadBar(path.basename(dest), (report) =>
          api.downloadLessonVideo({
            crsCreCd: lesson.crsCreCd,
            lessonCntsId: lesson.lessonCntsId,
            savePath: dest,
            timeoutMs: 600000,
            onProgress: (loaded, total) => report(loaded, total)
          })
        )
      );
    } else skip("downloadLessonVideo", "저장 위치를 고르지 않았습니다");
  } else skip("downloadLessonVideo", "--write --heavy 일 때만 영상을 받습니다");

  skip("submitAssignment", "학교에 과제를 제출하지 않습니다");
  skip("logout", "조사 끝에 로그인 세션을 끊지 않습니다");
  return skips;
}

const PAGES = {
  login: pageLogin,
  todo: pageTodo,
  asg: pageAsg,
  ntc: pageNtc,
  mat: pageMat,
  les: pageLes,
  tt: pageTt,
  score: pageScore,
  sum: pageSum,
  cfg: pageCfg,
  info: pageInfo,
  test: pageTest
};

/** 사이드바 메뉴를 반복한다. Esc 나 q 면 끝난다. */
async function tuiLoop(ctx) {
  let waveOff = 0;
  while (true) {
    doClear();
    let key;
    try {
      key = await expandSelect(ctx.rl, "메뉴", menuChoices(ctx.api), {
        header: () => bannerLines(ctx.api, waveOff),
        onTick: () => {
          waveOff += 1;
        },
        tickMs: WAVE_MS
      });
    } catch (err) {
      if (err && err.cancelled) {
        console.log(c("\n  CLI를 종료합니다.\n", theme.accent));
        break;
      }
      throw err;
    }
    if (!key || key === "exit") {
      console.log(c("\n  CLI를 종료합니다.\n", theme.accent));
      break;
    }
    const item = SIDEBAR.find((x) => x.key === key);
    if (item?.need && !(await needAuth(ctx))) continue;
    try {
      trace(`${item?.label || key}()`);
      await PAGES[key](ctx);
    } catch (err) {
      if (err && err.cancelled) {
        console.log(c("\n  CLI를 종료합니다.\n", theme.accent));
        break;
      }
      console.log(c(`  ${err instanceof Error ? err.message : err}`, A.red));
    }
  }
}

function openReadline() {
  const rl = readline.createInterface({
    input,
    ...(TTY ? {} : { output }),
    terminal: false,
    prompt: "",
    historySize: 0
  });
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
  return rl;
}

/** 인자 해석 후 메뉴 또는 함수 전수 조사로 들어간다. */
async function main() {
  let opt;
  try {
    opt = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(c(err instanceof Error ? err.message : String(err), A.red));
    process.exitCode = 1;
    return;
  }
  if (opt.help || opt.list) {
    console.log(helpText());
    console.log(c("\n사이드바: login todo asg ntc mat les tt score sum cfg info", A.gray));
    console.log(c("도구: test  함수 전수 조사 (Dev)", A.gray));
    console.log(c("\n조사 함수", A.bold));
    for (const [name, about] of SURVEY_FUNCTIONS) {
      console.log(`  ${name.padEnd(26)}  ${about}`);
    }
    return;
  }

  const api = bindApi(new Campus({
    timeoutMs: Number(opt.timeout) || 90000,
    verbose: Boolean(opt.verbose)
  }));

  if (opt.suite) {
    if (!["all", "read", "test"].includes(opt.suite)) {
      console.error(c(`알 수 없는 조사입니다: ${opt.suite}. all 을 쓰세요.`, A.red));
      process.exitCode = 1;
      return;
    }
    const rl = openReadline();
    const ctx = { api, rl, opt };
    try {
      if (!(await ensureLogin(ctx))) process.exitCode = 1;
      else await runReadSweep(ctx);
    } finally {
      rl.close();
    }
    return;
  }

  if (!input.isTTY || !output.isTTY) {
    console.error(c("대화형 TUI 는 TTY 가 필요합니다. --suite all 을 쓰거나 터미널에서 실행하세요.", A.red));
    process.exitCode = 1;
    return;
  }

  const rl = openReadline();
  try {
    await tuiLoop({ api, rl, opt });
  } finally {
    try {
      process.stdout.write("\x1b[?25h");
    } catch {
      /* */
    }
    rl.close();
  }
}

main();
