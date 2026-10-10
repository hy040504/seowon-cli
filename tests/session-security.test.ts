import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import tls from "node:tls";
import { Campus } from "../lib/back/campus.js";
import { EcampusClient, CourseRegistrationClient, HopeBasketClient } from "../lib/back/engine/index.js";
import { liveLogin } from "../lib/back/services/ecampus/login.js";
import type { LoginResult } from "../lib/back/engine/ecampus/types/login.js";

const credentials = { studentId: "DEMO_STUDENT", password: "DEMO_PASSWORD_NOT_REAL" };
const completed = { type: "reload", data: { userNo: "DEMO_USER" } } as LoginResult;

function offline(t: Parameters<Parameters<typeof test>[1]>[0]) {
  t.mock.method(net.Socket.prototype, "connect", () => { throw new Error("Unexpected network connection"); });
  t.mock.method(tls, "connect", () => { throw new Error("Unexpected TLS connection"); });
  t.mock.method(CourseRegistrationClient.prototype, "login", async () => ({ success: true, student: { stdntNm: "DEMO_NAME", deprtNm: "DEMO_DEPT", deptCd: "DEMO" } }));
  t.mock.method(HopeBasketClient.prototype, "login", async () => { throw new Error("Unexpected fallback login"); });
}

test("service and Campus reject an OTP redirect before SSO or session installation", async (t) => {
  offline(t);
  const sso = t.mock.method(CourseRegistrationClient.prototype, "login", async () => { throw new Error("Unexpected SSO login"); });
  t.mock.method(EcampusClient.prototype, "login", async () => ({ type: "redirect", url: "/otp", data: { otpUseYn: "Y" } }));
  await assert.rejects(liveLogin(credentials.studentId, credentials.password), /추가 인증/);
  const campus = new Campus();
  const result = await campus.liveLogin(credentials);
  assert.equal(result.ok, false);
  assert.equal(campus.loggedIn(), false);
  assert.equal(campus.student, null);
  assert.equal(sso.mock.callCount(), 0);
});

test("a failed new account login cannot retain the previous Campus account", async (t) => {
  offline(t);
  const login = t.mock.method(EcampusClient.prototype, "login", async () => completed);
  const campus = new Campus();
  assert.equal((await campus.liveLogin(credentials)).ok, true);
  assert.equal(campus.loggedIn(), true);
  login.mock.mockImplementation(async () => ({ type: "redirect", url: "/otp" }));
  const result = await campus.liveLogin({ studentId: "DEMO_OTHER", password: credentials.password });
  assert.equal(result.ok, false);
  assert.equal(campus.loggedIn(), false);
  assert.equal(campus.student, null);
});

test("logout prevents a delayed successful login from restoring its session", async (t) => {
  offline(t);
  let finish!: (value: LoginResult) => void;
  const delayed = new Promise<LoginResult>((resolve) => { finish = resolve; });
  t.mock.method(EcampusClient.prototype, "login", () => delayed);
  const campus = new Campus();
  const pending = campus.liveLogin(credentials);
  assert.equal((await campus.logout()).ok, true);
  finish(completed);
  assert.equal((await pending).ok, false);
  assert.equal(campus.loggedIn(), false);
  assert.equal(campus.student, null);
});

test("a timed out login cannot install a session when the school response arrives later", async (t) => {
  offline(t);
  let finish!: (value: LoginResult) => void;
  const delayed = new Promise<LoginResult>((resolve) => { finish = resolve; });
  t.mock.method(EcampusClient.prototype, "login", () => delayed);
  const campus = new Campus();
  assert.equal((await campus.liveLogin({ ...credentials, timeoutMs: 10 })).ok, false);
  finish(completed);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(campus.loggedIn(), false);
  assert.equal(campus.student, null);
});

test("logout prevents a delayed SSO response from restoring the student profile", async (t) => {
  offline(t);
  t.mock.method(EcampusClient.prototype, "login", async () => completed);
  const campus = new Campus();
  assert.equal((await campus.liveLogin(credentials)).ok, true);
  let finish!: (value: unknown) => void;
  const delayed = new Promise((resolve) => { finish = resolve; });
  t.mock.method(CourseRegistrationClient.prototype, "login", () => delayed);
  const pending = campus.ensureSugang();
  await campus.logout();
  finish({ success: true, student: { stdntNm: "DEMO_OTHER_NAME", deprtNm: "DEMO_DEPT", deptCd: "DEMO" } });
  assert.equal((await pending).ok, false);
  assert.equal(campus.loggedIn(), false);
  assert.equal(campus.student, null);
});

test("an old SSO response cannot replace the newly logged in account profile", async (t) => {
  offline(t);
  t.mock.method(EcampusClient.prototype, "login", async () => completed);
  const campus = new Campus();
  assert.equal((await campus.liveLogin(credentials)).ok, true);
  let finish!: (value: unknown) => void;
  const delayed = new Promise((resolve) => { finish = resolve; });
  let calls = 0;
  t.mock.method(CourseRegistrationClient.prototype, "login", () => ++calls === 1 ? delayed : Promise.resolve({ success: true, student: { stdntNm: "DEMO_NEW_NAME", deprtNm: "DEMO_DEPT", deptCd: "DEMO" } }));
  const old = campus.ensureSugang();
  assert.equal((await campus.liveLogin({ studentId: "DEMO_NEW_STUDENT", password: credentials.password })).ok, true);
  finish({ success: true, student: { stdntNm: "DEMO_OLD_NAME", deprtNm: "DEMO_DEPT", deptCd: "DEMO" } });
  assert.equal((await old).ok, false);
  assert.equal(campus.student?.studentId, "DEMO_NEW_STUDENT");
  assert.equal(campus.student?.studentName, "DEMO_NEW_NAME");
});
