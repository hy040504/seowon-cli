import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import util from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import axios, { AxiosError, type AxiosAdapter, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import { EcampusClient, parseLoginResponse } from "../lib/back/engine/ecampus/login.js";
import type { EcampusClassroomItem } from "../lib/back/engine/ecampus/types/classroom.js";
import { HopeBasketClient } from "../lib/back/engine/hope-basket/client.js";
import { ErpClient } from "../lib/back/engine/erp/client.js";
import { CourseRegistrationClient } from "../lib/back/engine/course-registration/client.js";
import { createLoginEncryptData } from "../lib/back/engine/ecampus/crypto.js";
import { downloadElearningMp4, getElearningMp4Url } from "../lib/back/engine/ecampus/elearning.js";
import { buildHopeBasketTimetable, exportHopeBasketTimetableImage, parseTimtbNm, renderHopeBasketTimetableSvg } from "../lib/back/engine/hope-basket/timetable.js";
import { assertApprovedUrl, createIsolatedMediaHttp, ELEARNING_MEDIA_ORIGINS, protectHttpClient, sanitizeHttpError } from "../lib/back/engine/shared/http.js";

const ECAMPUS = "https://ecampus.seowon.ac.kr";
const MEDIA = "https://eplus.seowon.ac.kr";
const PRIVATE = "DEMO_PRIVATE_VALUE";
let networkAttempts = 0;

before(() => {
  const blocked = () => { networkAttempts++; throw new Error("Offline security test attempted network access"); };
  mock.method(http, "request", blocked);
  mock.method(https, "request", blocked);
  mock.method(net, "connect", blocked);
  mock.method(net.Socket.prototype, "connect", blocked);
  mock.method(tls, "connect", blocked);
});
after(() => {
  mock.restoreAll();
  assert.equal(networkAttempts, 0, "All adapters must remain offline");
});

function response(config: InternalAxiosRequestConfig, data: unknown = "ok", status = 200) {
  return { config, data, status, statusText: "OK", headers: {} };
}

async function removeTestDirectory(directory: string): Promise<void> {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.match(path.basename(directory), /^seowon-(?:engine|timetable)-security-/);
  await fs.rm(directory, { recursive: true, force: true });
}

const factories = [
  { name: "e-campus", origin: ECAMPUS, create: (baseUrl: string) => new EcampusClient({ baseUrl, loginCredentials: { userId: "DEMO_USER", password: PRIVATE } }) },
  { name: "hope basket", origin: "https://sugangh.seowon.ac.kr", create: (baseUrl: string) => new HopeBasketClient({ baseUrl, credentials: { stuno: "DEMO_USER", password: PRIVATE } }) },
  { name: "ERP", origin: "https://info.seowon.ac.kr", create: (baseUrl: string) => new ErpClient({ baseUrl, credentials: { uid: "DEMO_USER", password: PRIVATE } }) },
  { name: "course registration", origin: "https://sugangh.seowon.ac.kr", create: (baseUrl: string) => new CourseRegistrationClient({ baseUrl, credentials: { stuno: "DEMO_USER", password: PRIVATE } }) }
];

for (const factory of factories) {
  test(`${factory.name} only accepts its exact HTTPS service origin`, () => {
    for (const base of [factory.origin.replace("https:", "http:"), "https://example.invalid", MEDIA, `https://${PRIVATE}@${new URL(factory.origin).hostname}`, `${factory.origin}:444`]) {
      assert.throws(() => factory.create(base), /허용되지/);
    }
  });
  test(`${factory.name} JSON and inspection exclude credentials, cookies and base URL tokens`, async () => {
    const client = factory.create(`${factory.origin}/?secret=${PRIVATE}`);
    await client.cookieJar.setCookie(`SESSIONID=${PRIVATE}; Secure`, factory.origin);
    for (const output of [JSON.stringify(client), util.inspect(client)]) {
      assert.ok(!output.includes(PRIVATE));
      assert.ok(!output.includes("DEMO_USER"));
      assert.ok(!output.includes("SESSIONID"));
    }
    const copy = client.getCredentials()!;
    copy.password = "DEMO_MUTATED";
    assert.equal(client.getCredentials()!.password, PRIVATE);
  });
}

test("request guard blocks off-origin, HTTP, userinfo and local socket destinations before dispatch", async () => {
  let dispatched = 0;
  const instance = axios.create({ adapter: async (config) => { dispatched++; return response(config); } });
  protectHttpClient(instance, ECAMPUS);
  for (const url of ["http://ecampus.seowon.ac.kr/", MEDIA, "https://ecampus.seowon.ac.kr.evil.invalid/", `https://${PRIVATE}@ecampus.seowon.ac.kr/`, "https://127.0.0.1/"]) {
    await assert.rejects(instance.get(url), /허용되지/);
  }
  await assert.rejects(instance.get("/", { socketPath: "DEMO_SOCKET" }), /허용되지/);
  await assert.rejects(instance.get("/", { baseURL: MEDIA }), /허용되지/);
  assert.equal(dispatched, 0);
});

test("request guard prevents caller redirect overrides and preserves maxRedirects zero", async () => {
  const instance = axios.create({ adapter: async (config) => {
    assert.equal(config.maxRedirects, 0);
    assert.equal(config.proxy, false);
    assert.equal(config.url, `${ECAMPUS}/safe`);
    assert.equal(config.allowAbsoluteUrls, true);
    assert.equal(config.maxContentLength, 64 * 1024 * 1024);
    assert.equal(config.maxBodyLength, 128 * 1024 * 1024);
    const follow = config.beforeRedirect!;
    follow({ href: `${ECAMPUS}/next`, protocol: "https:", hostname: "ecampus.seowon.ac.kr" }, {} as never);
    for (const options of [
      { href: `${MEDIA}/`, protocol: "https:", hostname: "eplus.seowon.ac.kr" },
      { href: `${ECAMPUS}/`, protocol: "http:", hostname: "ecampus.seowon.ac.kr" },
      { href: `${ECAMPUS}/`, protocol: "https:", hostname: "ecampus.seowon.ac.kr", auth: PRIVATE }
    ]) assert.throws(() => follow(options, {} as never), /허용되지/);
    return response(config);
  } });
  protectHttpClient(instance, ECAMPUS);
  await instance.get("/safe", { maxRedirects: 0, maxContentLength: Infinity, maxBodyLength: Infinity, proxy: { host: "example.invalid", port: 8080 }, allowAbsoluteUrls: false, beforeRedirect: () => { throw new Error("Caller hook must be replaced"); } });
});

test("media redirects cannot cross between separately approved media origins", async () => {
  const source = axios.create({ adapter: async (config) => {
    assert.throws(() => config.beforeRedirect!({ href: `${ECAMPUS}/next`, protocol: "https:", hostname: "ecampus.seowon.ac.kr" }, {} as never), /허용되지/);
    return response(config);
  } });
  await createIsolatedMediaHttp(source).get(`${MEDIA}/content`);
});

test("HTTP errors retain safe status and known codes without request data, headers, response body or cause", async () => {
  const instance = axios.create({ adapter: async (config) => {
    const error = new AxiosError(PRIVATE, "ECONNRESET", config, { token: PRIVATE }, { ...response(config, PRIVATE, 503), headers: { cookie: PRIVATE } });
    error.cause = new Error(PRIVATE);
    throw error;
  } });
  protectHttpClient(instance, ECAMPUS);
  await assert.rejects(instance.post("/login", PRIVATE, { headers: { Authorization: PRIVATE } }), (error: unknown) => {
    const safe = error as AxiosError;
    assert.equal(safe.code, "ECONNRESET");
    assert.equal(safe.response?.status, 503);
    assert.equal(safe.config, undefined);
    assert.equal(safe.request, undefined);
    assert.equal(safe.response?.data, undefined);
    assert.equal(safe.cause, undefined);
    assert.ok(!JSON.stringify(safe).includes(PRIVATE));
    assert.ok(!util.inspect(safe).includes(PRIVATE));
    return true;
  });
  const safe = sanitizeHttpError({ code: PRIVATE, status: PRIVATE, message: PRIVATE });
  assert.ok(!JSON.stringify(safe).includes(PRIVATE));
  assert.ok(!util.inspect(safe).includes(PRIVATE));
});

test("OTP flags never become completed authentication even without learner fields", () => {
  for (const flags of [{ otpLogin: "Y" }, { otpUserYn: "Y" }, { otpLogin: "Y", otpUserType: "STAFF" }, { otpLogin: "Y", otpUserYn: "Y", userId: "DEMO_USER", userNo: "DEMO_NO" }]) {
    assert.equal(parseLoginResponse({ redirectUrl: "/otp", ...flags }).type, "redirect");
  }
  assert.equal(parseLoginResponse({ redirectUrl: "/", otpLogin: "N", otpUserYn: "N" }).type, "reload");
  for (const redirectUrl of ["https://example.invalid/otp", "http://ecampus.seowon.ac.kr/", `https://${PRIVATE}@ecampus.seowon.ac.kr/`]) {
    const result = parseLoginResponse({ redirectUrl });
    assert.equal(result.type, "error");
    assert.ok(!JSON.stringify(result).includes(PRIVATE));
  }
});

test("pre-login cookies alone cannot authorize e-campus operations", async () => {
  const client = new EcampusClient();
  await client.cookieJar.setCookie(`SESSIONID=${PRIVATE}; Secure`, ECAMPUS);
  await assert.rejects(client.ensureAuthenticated(), /로그인/);
  assert.equal(client.toJSON().authenticated, false);
});

test("encrypted account login clears old auto-login credentials and session before any request", async () => {
  let calls = 0;
  let client: EcampusClient;
  const instance = axios.create({ adapter: async (config) => {
    calls++;
    assert.equal((await client.cookieJar.getCookies(ECAMPUS)).length, 0);
    return response(config, config.method === "post" ? { redirectUrl: "/", otpLogin: "N" } : "");
  } });
  client = new EcampusClient({ axios: instance, loginCredentials: { userId: "DEMO_OLD", password: PRIVATE } });
  await client.cookieJar.setCookie(`SESSIONID=${PRIVATE}; Secure`, ECAMPUS);
  assert.equal((await client.loginWithEncryptData({ encryptData: "DEMO_PACKET" })).type, "reload");
  assert.equal(client.getCredentials(), undefined);
  assert.equal(calls, 2);
});

test("OTP session cookies cannot turn automatic e-campus login into authenticated access", async () => {
  const instance = axios.create({ adapter: async (config) => response(config, config.method === "post" ? { redirectUrl: "/otp", otpUserYn: "Y" } : "") });
  const client = new EcampusClient({ axios: instance, loginCredentials: { userId: "DEMO_USER", password: PRIVATE } });
  await client.cookieJar.setCookie(`SESSIONID=${PRIVATE}; Secure`, ECAMPUS);
  await assert.rejects(client.ensureAuthenticated(), /OTP/);
  assert.equal(client.toJSON().authenticated, false);
});

test("e-campus expires authenticated state on a login page response without exposing the HTML", async () => {
  const instance = axios.create({ adapter: async (config) => response(config, `<input type="password" value="${PRIVATE}">`) });
  const client = new EcampusClient({ axios: instance });
  Reflect.set(client, "authenticated", true);
  await client.cookieJar.setCookie(`SESSIONID=${PRIVATE}; Secure`, ECAMPUS);
  await assert.rejects(client.getMainPageHtml(), (error: unknown) => {
    assert.ok(!util.inspect(error).includes(PRIVATE));
    return (error as Error).message.includes("만료");
  });
  assert.equal(client.toJSON().authenticated, false);
});

test("assignment submission requires a successful classroom context before any mutation", async () => {
  const requests: string[] = [];
  const instance = axios.create({ adapter: async (config) => {
    requests.push(config.url!);
    throw new AxiosError(PRIVATE, "ECONNRESET", config);
  } });
  const client = new EcampusClient({ axios: instance });
  Reflect.set(client, "authenticated", true);
  await client.cookieJar.setCookie(`SESSIONID=${PRIVATE}; Secure`, ECAMPUS);
  const item = { id: "DEMO_ASSIGNMENT", title: "DEMO_TITLE", request: { url: "/asmnt/view", body: { crsCreCd: "DEMO_COURSE" } } } as unknown as EcampusClassroomItem;
  await assert.rejects(client.submitAssignment(item, { asmntSendCd: "DEMO_SEND", keepFileUrls: ["/file/download/DEMO_FILE"] }));
  assert.deepEqual(requests, [`${ECAMPUS}/crs/creCrsLect/Form/classRoomMainForm`]);
});

test("assignment submission never accepts a redirect status as success or logs private fields", async () => {
  const instance = axios.create({ adapter: async (config) => response(config, config.url?.includes("classRoomMainForm") ? "" : { success: true, message: PRIVATE }, config.url?.includes("classRoomMainForm") ? 200 : 302) });
  const client = new EcampusClient({ axios: instance });
  Reflect.set(client, "authenticated", true);
  await client.cookieJar.setCookie(`SESSIONID=${PRIVATE}; Secure`, ECAMPUS);
  const item = { id: "DEMO_ASSIGNMENT", title: PRIVATE, request: { url: "/asmnt/view", body: { crsCreCd: "DEMO_COURSE" } } } as unknown as EcampusClassroomItem;
  const outputs: unknown[][] = [];
  const log = mock.method(console, "log", (...args: unknown[]) => { outputs.push(args); });
  const warn = mock.method(console, "warn", (...args: unknown[]) => { outputs.push(args); });
  try {
    await assert.rejects(client.submitAssignment(item, { asmntSendCd: "DEMO_SEND", keepFileUrls: ["/file/download/DEMO_FILE"] }), (error: unknown) => {
      assert.ok(!util.inspect(error).includes(PRIVATE));
      return (error as Error).message.includes("제출에 실패");
    });
    assert.equal(outputs.length, 0);
  } finally { log.mock.restore(); warn.mock.restore(); }
});

test("changing credentials invalidates cookies across every service client", async () => {
  const clients = [
    new EcampusClient({ loginCredentials: { userId: "DEMO_OLD", password: PRIVATE } }),
    new HopeBasketClient({ credentials: { stuno: "DEMO_OLD", password: PRIVATE } }),
    new ErpClient({ credentials: { uid: "DEMO_OLD", password: PRIVATE } }),
    new CourseRegistrationClient({ credentials: { stuno: "DEMO_OLD", password: PRIVATE } })
  ];
  for (const client of clients) {
    await client.cookieJar.setCookie(`SESSIONID=${PRIVATE}; Secure`, client.baseUrl);
    client.setCredentials({ userId: "DEMO_NEW", stuno: "DEMO_NEW", uid: "DEMO_NEW", password: PRIVATE });
    assert.equal((await client.cookieJar.getCookies(client.baseUrl)).length, 0);
  }
});

test("legacy credential encryption does not depend on Math.random", () => {
  const random = mock.method(Math, "random", () => { throw new Error("Weak randomness used"); });
  try { assert.ok(createLoginEncryptData("DEMO_USER", "DEMO_PASSWORD").length > 0); }
  finally { random.mock.restore(); }
});

test("mutation requests are not automatically replayed after a connection error", async () => {
  const creates = [
    (adapter: AxiosAdapter) => new HopeBasketClient({ axios: axios.create({ adapter }), maxRetries: 3 }),
    (adapter: AxiosAdapter) => new ErpClient({ axios: axios.create({ adapter }), maxRetries: 3 }),
    (adapter: AxiosAdapter) => new CourseRegistrationClient({ axios: axios.create({ adapter }), maxRetries: 3 })
  ];
  for (const create of creates) {
    let calls = 0;
    const client = create(async (config) => { calls++; throw new AxiosError(PRIVATE, "ECONNRESET", config); });
    const transport = client as unknown as { requestWithRetry(config: AxiosRequestConfig): Promise<unknown> };
    await assert.rejects(transport.requestWithRetry({ method: "POST", url: "/saveMutation.do", data: PRIVATE }));
    assert.equal(calls, 1);
  }
});

test("maxRetries zero sends the initial request and invalid retry options are rejected", async () => {
  const creates = [
    (adapter: AxiosAdapter) => new HopeBasketClient({ axios: axios.create({ adapter }), maxRetries: 0 }),
    (adapter: AxiosAdapter) => new ErpClient({ axios: axios.create({ adapter }), maxRetries: 0 }),
    (adapter: AxiosAdapter) => new CourseRegistrationClient({ axios: axios.create({ adapter }), maxRetries: 0 })
  ];
  for (const create of creates) {
    let calls = 0;
    const client = create(async (config) => { calls++; return response(config); });
    const transport = client as unknown as { requestWithRetry(config: AxiosRequestConfig): Promise<unknown> };
    await transport.requestWithRetry({ method: "GET", url: "/safe" });
    assert.equal(calls, 1);
  }
  for (const maxRetries of [-1, Infinity, 1.5, NaN]) {
    assert.throws(() => new HopeBasketClient({ maxRetries }));
    assert.throws(() => new ErpClient({ maxRetries }));
    assert.throws(() => new CourseRegistrationClient({ maxRetries }));
  }
});

test("media requests exclude source and global cookie, authorization, auth, proxy and socket defaults", async () => {
  const previous = { headers: axios.defaults.headers.common, auth: axios.defaults.auth, socketPath: axios.defaults.socketPath };
  try {
    axios.defaults.headers.common = { Authorization: PRIVATE, Cookie: PRIVATE };
    axios.defaults.auth = { username: PRIVATE, password: PRIVATE };
    axios.defaults.socketPath = PRIVATE;
    const source = axios.create({ adapter: async (config) => {
      assert.equal(config.headers.get("Authorization"), undefined);
      assert.equal(config.headers.get("Cookie"), undefined);
      assert.equal(config.auth, undefined);
      assert.equal(config.socketPath, undefined);
      assert.equal(config.jar, undefined);
      assert.equal(config.withCredentials, false);
      return response(config, '<source type="video/mp4" src="../movie.mp4?token=DEMO_TOKEN">');
    }, headers: { Authorization: PRIVATE, Cookie: PRIVATE } });
    const result = await getElearningMp4Url(source, `${MEDIA}/folder/content`, { crsCreCd: "DEMO_COURSE", lessonCntsId: "DEMO_LESSON" });
    assert.equal(result.success, true);
    assert.equal(result.mp4Url, `${MEDIA}/movie.mp4?token=DEMO_TOKEN`);
  } finally {
    axios.defaults.headers.common = previous.headers;
    axios.defaults.auth = previous.auth;
    axios.defaults.socketPath = previous.socketPath;
  }
});

test("media URL extraction validates both the content and extracted MP4 destinations", async () => {
  let calls = 0;
  const source = axios.create({ adapter: async (config) => { calls++; return response(config, '<source type="video/mp4" src="https://example.invalid/movie.mp4">'); } });
  for (const contentUrl of ["https://example.invalid/page", "http://eplus.seowon.ac.kr/page"]) {
    assert.equal((await getElearningMp4Url(source, contentUrl, { crsCreCd: "DEMO_COURSE", lessonCntsId: "DEMO_LESSON" })).success, false);
  }
  assert.equal(calls, 0);
  assert.equal((await getElearningMp4Url(source, `${MEDIA}/page`, { crsCreCd: "DEMO_COURSE", lessonCntsId: "DEMO_LESSON" })).success, false);
  assert.equal(calls, 1);
  assert.throws(() => assertApprovedUrl(`https://${PRIVATE}@eplus.seowon.ac.kr/a.mp4`, ECAMPUS, ELEARNING_MEDIA_ORIGINS));
});

test("relative MP4 URL resolves from the validated final content response URL", async () => {
  const source = axios.create({ adapter: async (config) => ({ ...response(config, '<source type="video/mp4" src="movie.mp4">'), request: { res: { responseUrl: `${MEDIA}/final/page` } } }) });
  const result = await getElearningMp4Url(source, `${MEDIA}/initial`, { crsCreCd: "DEMO_COURSE", lessonCntsId: "DEMO_LESSON" });
  assert.equal(result.mp4Url, `${MEDIA}/final/movie.mp4`);
});

test("failed media stream preserves a previous complete file and leaves no partial file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "seowon-engine-security-"));
  try {
    await fs.mkdir(path.join(directory, "course"));
    const file = path.join(directory, "course", "lesson.mp4");
    await fs.writeFile(file, "DEMO_COMPLETE");
    const source = axios.create({ adapter: async (config) => response(config, new Readable({ read() { this.push("DEMO_PARTIAL"); this.destroy(new Error(PRIVATE)); } })) });
    const result = await downloadElearningMp4(source, `${MEDIA}/lesson.mp4`, "course", "lesson", directory);
    assert.equal(result.success, false);
    assert.ok(!JSON.stringify(result).includes(PRIVATE));
    assert.equal(await fs.readFile(file, "utf8"), "DEMO_COMPLETE");
    assert.deepEqual(await fs.readdir(path.join(directory, "course")), ["lesson.mp4"]);
  } finally { await removeTestDirectory(directory); }
});

test("timetable limits malformed periods and escapes untrusted text in inert local HTML", async () => {
  assert.equal(parseTimtbNm("월 9999999999999 교실").length, 0);
  const title = '<img src=x onerror=alert(1)> "예시"';
  const timetable = buildHopeBasketTimetable([{ subjtCd: "DEMO_COURSE", subjtNm: title, corseDvclsNo: "01", cmpsjCdt: "3", timtbNm: "월 1,2 예시 교실" }]);
  assert.ok(renderHopeBasketTimetableSvg(timetable, { maxPeriod: Infinity }).length < 100_000);
  assert.ok(renderHopeBasketTimetableSvg(timetable, { maxPeriod: 1e9 }).length < 100_000);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "seowon-timetable-security-"));
  try {
    const result = await exportHopeBasketTimetableImage(timetable, { outputDir: directory, fileBaseName: "../escaped", title });
    assert.equal(path.dirname(result.htmlPath), directory);
    const html = await fs.readFile(result.htmlPath, "utf8");
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("&lt;img"));
    assert.ok(html.includes("Content-Security-Policy"));
    assert.ok(html.includes("default-src 'none'"));
  } finally { await removeTestDirectory(directory); }
});
