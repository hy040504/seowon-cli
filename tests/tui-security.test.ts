import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { browserLaunchEnvironment, loadLoginEnv, parseArgs, formatTraceCall, takeLoginCredentials } from "../lib/front/tui/security.js";
import { makeKit } from "../lib/front/tui/tui-kit.js";

const fixtureSid = "DEMO_STUDENT";
const fixturePassword = "DEMO_PASSWORD_NOT_REAL";

test("login settings load only login keys and preserve existing environment", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seowon-env-"));
  try {
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, `SEOWON_SID=${fixtureSid}\nSEOWON_PW='${fixturePassword}'\nNODE_OPTIONS=--require attacker\nHTTP_PROXY=http://invalid.test\nPATH=invalid\nSEOWON_ADMIN_PW=DEMO_FAKE\n`, { mode: 0o600 });
    const env = { SEOWON_SID: "existing" } as NodeJS.ProcessEnv;
    loadLoginEnv(file, env);
    assert.deepEqual(env, { SEOWON_SID: "existing", SEOWON_PW: fixturePassword });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("missing or oversized login files do not populate the environment", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seowon-env-"));
  try {
    const env = {};
    loadLoginEnv(path.join(dir, "absent"), env);
    const file = path.join(dir, "oversized");
    fs.writeFileSync(file, `SEOWON_PW=${fixturePassword}\n${"#".repeat(65536)}`);
    loadLoginEnv(file, env);
    loadLoginEnv(dir, env);
    assert.deepEqual(env, {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("command line credentials and unknown options fail without echoing their values", () => {
  for (const argv of [["--pw", fixturePassword], [`--pw=${fixturePassword}`], ["--sid", fixtureSid], [`--sid=${fixtureSid}`], [`--unknown=${fixturePassword}`]]) {
    assert.throws(() => parseArgs(argv, {}), (error: unknown) => error instanceof Error && !error.message.includes(fixturePassword) && !error.message.includes(fixtureSid));
  }
});

test("command line limits are bounded and require values", () => {
  for (const argv of [["--timeout", "Infinity"], ["--timeout=0"], ["--timeout=300001"], ["--depth=101"], ["--depth=1.5"], ["--depth"], ["--suite", "--write"]]) {
    assert.throws(() => parseArgs(argv, {}));
  }
  const out = parseArgs(["--suite=all", "--depth", "5", "--timeout=1000", "--write"], { SEOWON_SID: fixtureSid, SEOWON_PW: fixturePassword });
  assert.equal(out.pw, fixturePassword);
  assert.equal(out.depth, "5");
  assert.equal(out.write, true);
});

test("cached and explicit environment login do not retain passwords in CLI options", () => {
  const options = { sid: "DEMO_PREVIOUS", pw: fixturePassword };
  assert.equal(takeLoginCredentials(options, { authenticated: true }), undefined);
  assert.equal(options.pw, "");
  const explicit = { studentId: fixtureSid, password: fixturePassword };
  const attempt = takeLoginCredentials(options, { authenticated: true, explicit });
  assert.deepEqual(attempt, explicit);
  assert.equal(options.pw, "");
  assert.equal(options.sid, "DEMO_PREVIOUS");
  assert.deepEqual(takeLoginCredentials({ sid: fixtureSid, pw: fixturePassword }, { force: true }), { studentId: "", password: "" });
  const initial = { sid: fixtureSid, pw: fixturePassword };
  assert.deepEqual(takeLoginCredentials(initial), explicit);
  assert.equal(initial.pw, "");
});

test("browser environment excludes every casing of login variables", () => {
  const result = browserLaunchEnvironment({
    SEOWON_SID: fixtureSid, seowon_pw: fixturePassword,
    SeOwOn_Pw: fixturePassword, SEOWON_SESSION: "DEMO_SESSION",
    PATH: "DEMO_SYSTEM_PATH", TERM: "xterm", NO_COLOR: "1"
  });
  assert.deepEqual(result, { PATH: "DEMO_SYSTEM_PATH", TERM: "xterm", NO_COLOR: "1" });
  assert.doesNotMatch(JSON.stringify(result), /DEMO_PASSWORD|DEMO_STUDENT|DEMO_SESSION/);
});

test("API tracing prints method names without sensitive arguments or saved paths", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(" ")); };
  try {
    const kit = makeKit({ TTY: false, c: (value: unknown) => String(value), A: {} });
    const api = kit.bindApi({
      results: [],
      liveLogin: async (_: unknown) => ({ ok: true, ms: 1, saved: `C:/private/${fixtureSid}` })
    });
    await api.liveLogin({ studentId: fixtureSid, password: fixturePassword, text: "PRIVATE_ASSIGNMENT_BODY", cookie: "DEMO_SESSION" });
    assert.match(lines.join("\n"), /liveLogin\(\)/);
    assert.doesNotMatch(lines.join("\n"), /DEMO_STUDENT|DEMO_PASSWORD|PRIVATE_ASSIGNMENT_BODY|DEMO_SESSION|C:\/private/);
    assert.equal(formatTraceCall("submitAssignment"), "submitAssignment()");
  } finally { console.log = original; }
});

test("unmaskable password entry never falls back to readline question", async () => {
  let asked = false;
  const kit = makeKit({ TTY: false, c: (value: unknown) => String(value), A: {} });
  await assert.rejects(kit.promptField({ question: async () => { asked = true; return fixturePassword; } }, { label: "비밀번호", secret: true }), /마스킹 가능한 터미널/);
  assert.equal(asked, false);
});

test("CLI help and invalid credentials remain offline with NO_COLOR", () => {
  const env = { ...process.env, NO_COLOR: "1", SEOWON_SID: fixtureSid, SEOWON_PW: fixturePassword };
  const help = spawnSync(process.execPath, ["--import", "tsx", "lib/front/tui/cli.ts", "--help"], { env, encoding: "utf8", timeout: 10000 });
  assert.equal(help.status, 0, help.stderr);
  assert.doesNotMatch(help.stdout, /--pw|--sid|DEMO_STUDENT|DEMO_PASSWORD|\x1b\[/);
  const invalid = spawnSync(process.execPath, ["--import", "tsx", "lib/front/tui/cli.ts", `--pw=${fixturePassword}`], { env, encoding: "utf8", timeout: 10000 });
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /DEMO_PASSWORD/);
});

test("raw password input, sanitized lists, selection, and Escape work with NO_COLOR", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "tests/helpers/tui-input-driver.ts"], {
    env: { ...process.env, NO_COLOR: "1" }, encoding: "utf8", timeout: 10000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).passed, true);
});
