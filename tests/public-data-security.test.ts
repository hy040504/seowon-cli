import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, test } from "node:test";
import { scanPublicText } from "../scripts/security/public-data.mjs";

const directories: string[] = [];
const scanner = resolve("scripts/security/public-data.mjs");
const syntheticSecret = ["Generated", "Credential", "42!"].join("");

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});

async function createRepository() {
  const directory = await mkdtemp(join(tmpdir(), "seowon-cli-public-data-"));
  directories.push(directory);
  execFileSync("git", ["init", "--quiet", directory], { stdio: "pipe" });
  return directory;
}

function git(directory: string, ...args: string[]) {
  return execFileSync("git", [
    "-c", `core.hooksPath=${join(directory, ".disabled-hooks")}`,
    "-c", "commit.gpgsign=false",
    "-c", "user.name=Security Test",
    "-c", "user.email=tests@example.invalid",
    ...args
  ], { cwd: directory, stdio: "pipe" });
}

function scan(directory: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [scanner, ...args], {
    cwd: directory, encoding: "utf8"
  });
  assert.equal(result.error, undefined);
  assert.ok(!(result.stdout + result.stderr).includes(syntheticSecret));
  return result;
}

const samples = [
  { rule: "credential", source: `password = "${syntheticSecret}"` },
  { rule: "credential", source: `SEOWON_PW = "${syntheticSecret}"` },
  { rule: "unquoted-credential", source: `SEOWON_PW=${syntheticSecret}` },
  { rule: "session-token", source: `${["JS", "ESSIONID"].join("")}=${"S".repeat(24)}` },
  { rule: "student-identifier", source: `SEOWON_SID=${["2099", "8877"].join("")}` },
  { rule: "student-name", source: ["std", "ntNm", "=\"", ["Synthetic", "Student"].join(" "), "\""].join("") },
  { rule: "private-key", source: ["-----BEGIN", "PRIVATE KEY-----"].join(" ") },
  { rule: "personal-email", source: ["synthetic.maintainer", "@", "mail", ".test"].join("") },
  { rule: "personal-phone", source: ["010", "9876", "5432"].join("") },
  { rule: "resident-number", source: ["990101", "-", "1234567"].join("") },
  { rule: "developer-home-path", source: ["C:", "Users", "SyntheticDeveloper"].join("\\") },
  { rule: "service-token", source: ["gh", "p_", "A".repeat(36)].join("") },
  { rule: "database-credential", source: `${["my", "sql", "://"].join("")}account:${syntheticSecret}@db.invalid/catalog` }
];

for (const { rule, source } of samples) {
  test(`public-data reports only a location and rule for ${rule}`, () => {
    const findings = scanPublicText(`safe first line\n${source}\n`, "configuration.txt");
    assert.deepEqual(findings, [{ file: "configuration.txt", line: 2, rule }]);
    assert.ok(!JSON.stringify(findings).includes(source));
  });
}

test("public-data permits explicit placeholders and trusted test email domains", () => {
  const source = [
    'password = "your_password"', 'client_secret = "<REDACTED>"',
    "SEOWON_PW=DEMO_PASSWORD", "SEOWON_SID=DEMO_STUDENT_ID",
    'studentName = "DEMO_STUDENT"', 'api_key = "example-key"',
    "stuno=202612345", "maintainer@example.com", "tests@example.invalid"
  ].join("\n");
  assert.deepEqual(scanPublicText(source, "README.md"), []);
});

test("public-data continues checking literal tokens while allowing code references", () => {
  const source = [
    "password: string;", "password = options.password;",
    "clientSecret = process.env.SERVICE_SECRET;", "access_token = process.env.SESSION_VALUE;",
    'import password from "@inquirer/password";', 'const userRoute = "/user/userHome";',
    'const homeRoute = "/home/mainHome";'
  ].join("\n");
  for (const file of ["client.ts", "client.mts", "client.cjs", "client.d.mts"]) {
    assert.deepEqual(scanPublicText(source, file), []);
    assert.deepEqual(scanPublicText(`const access_token = "${"S".repeat(24)}";`, file), [
      { file, line: 1, rule: "session-token" }
    ]);
  }
});

test("public-data does not exempt passwords solely because they start with a dollar sign", () => {
  const source = ["pass", "word", " = \"", "$", syntheticSecret, "\""].join("");
  assert.deepEqual(scanPublicText(source, "configuration.txt"), [
    { file: "configuration.txt", line: 1, rule: "credential" }
  ]);
  assert.deepEqual(scanPublicText("SEOWON_PW=${SEOWON_PW}", ".env.example"), []);
});

test("public-data rejects tracked credentials without printing their values", async () => {
  const directory = await createRepository();
  await writeFile(join(directory, ".env"), `SEOWON_PW=${syntheticSecret}\n`);
  git(directory, "add", ".env");
  const result = scan(directory);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout).findings, [
    { file: ".env", line: 1, rule: "private-artifact" },
    { file: ".env", line: 1, rule: "unquoted-credential" }
  ]);
});

test("public-data finds deleted secrets and binary private artifacts in reachable history", async () => {
  const directory = await createRepository();
  await writeFile(join(directory, ".env"), `SEOWON_PW=${syntheticSecret}\n`);
  await writeFile(join(directory, "capture.saz"), Buffer.from([0, 1, 2, 3, 255]));
  await mkdir(join(directory, "research/captures"), { recursive: true });
  await writeFile(join(directory, "research/captures/oversized.json"), " ".repeat(8 * 1024 * 1024 + 1));
  git(directory, "add", ".env", "capture.saz", "research/captures/oversized.json");
  git(directory, "commit", "--quiet", "-m", "Synthetic private artifacts");
  git(directory, "rm", "--quiet", ".env", "capture.saz", "research/captures/oversized.json");
  git(directory, "commit", "--quiet", "-m", "Remove synthetic artifacts");
  assert.equal(scan(directory).status, 0);
  const result = scan(directory, "--history");
  assert.equal(result.status, 1);
  const findings = JSON.parse(result.stdout).findings;
  for (const [file, rule] of [
    [".env", "unquoted-credential"], ["capture.saz", "private-artifact"],
    ["research/captures/oversized.json", "private-artifact"]
  ]) {
    assert.ok(findings.some((finding: { file: string; rule: string; blob: string }) =>
      finding.file === file && finding.rule === rule && finding.blob.length === 12));
  }
});

test("public-data checks nested environment files and declaration-file secrets", async () => {
  const directory = await createRepository();
  await mkdir(join(directory, "frontend"));
  await writeFile(join(directory, "frontend/.env"), "");
  await writeFile(join(directory, "client.d.mts"), `const password = "${syntheticSecret}";`);
  git(directory, "add", "frontend/.env", "client.d.mts");
  const result = scan(directory);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout).findings, [
    { file: "frontend/.env", line: 1, rule: "private-artifact" },
    { file: "client.d.mts", line: 1, rule: "credential" }
  ]);
});

test("public-data requires an exact reviewed synthetic media hash and mode", async () => {
  const directory = await createRepository();
  await mkdir(join(directory, "docs/media"), { recursive: true });
  const data = Buffer.from([0, 1, 2, 3, 255]);
  const media = join(directory, "docs/media/synthetic.png");
  await writeFile(media, data);
  const manifest = join(directory, "docs/media/sources.json");
  const asset = { file: "synthetic.png", mode: "demo", privacy_review: "synthetic", sha256: createHash("sha256").update(data).digest("hex") };
  assert.equal(scan(directory).status, 1);
  await writeFile(manifest, JSON.stringify({ assets: [asset] }));
  assert.equal(scan(directory).status, 0);
  await writeFile(manifest, JSON.stringify({ assets: [{ ...asset, mode: "real" }] }));
  assert.equal(scan(directory).status, 1);
  await writeFile(manifest, JSON.stringify({ assets: [asset] }));
  await writeFile(media, Buffer.from([9, 8, 7]));
  const result = scan(directory);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout).findings, [
    { file: "docs/media/synthetic.png", line: 1, rule: "unreviewed-public-media" }
  ]);
});

test("public-data marks deleted unreviewed historical media for manual review", async () => {
  const directory = await createRepository();
  await writeFile(join(directory, "recording.gif"), Buffer.from([0, 1, 2, 255]));
  git(directory, "add", "recording.gif");
  git(directory, "commit", "--quiet", "-m", "Synthetic recording");
  git(directory, "rm", "--quiet", "recording.gif");
  git(directory, "commit", "--quiet", "-m", "Delete recording");
  const result = scan(directory, "--history");
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).findings[0].rule, "historical-media-review");
});

test("public-data trusts only the reviewed historical media path and exact blob", async () => {
  const directory = await createRepository();
  await mkdir(join(directory, "docs/media"), { recursive: true });
  const file = "docs/media/synthetic.png";
  const previousData = Buffer.from([0, 1, 2, 255]);
  const reviewedData = Buffer.from([9, 8, 7, 255]);
  await writeFile(join(directory, file), previousData);
  git(directory, "add", file);
  git(directory, "commit", "--quiet", "-m", "Unreviewed synthetic recording");
  const previousOid = git(directory, "rev-parse", `HEAD:${file}`).toString("utf8").trim();
  await writeFile(join(directory, file), reviewedData);
  const asset = {
    file: "synthetic.png", mode: "demo", privacy_review: "synthetic",
    sha256: createHash("sha256").update(reviewedData).digest("hex")
  };
  await writeFile(join(directory, "docs/media/sources.json"), JSON.stringify({ assets: [asset] }));
  git(directory, "add", file, "docs/media/sources.json");
  git(directory, "commit", "--quiet", "-m", "Reviewed synthetic replacement");
  assert.equal(scan(directory).status, 0);
  const expectedPrevious = {
    file, line: 1, rule: "historical-media-review", blob: previousOid.slice(0, 12)
  };
  const replaced = scan(directory, "--history");
  assert.equal(replaced.status, 1);
  // The exact reviewed replacement is accepted; its earlier bytes at the same
  // path stay visible even though the current working tree is fully reviewed.
  assert.deepEqual(JSON.parse(replaced.stdout).findings, [expectedPrevious]);

  const copy = "docs/media/unreviewed-copy.png";
  await writeFile(join(directory, copy), reviewedData);
  git(directory, "add", copy);
  git(directory, "commit", "--quiet", "-m", "Unreviewed path alias");
  const reviewedOid = git(directory, "rev-parse", `HEAD:${file}`).toString("utf8").trim();
  const aliased = scan(directory, "--history");
  assert.equal(aliased.status, 1);
  assert.deepEqual(JSON.parse(aliased.stdout).findings, [
    { file: copy, line: 1, rule: "historical-media-review", blob: reviewedOid.slice(0, 12) },
    expectedPrevious
  ]);
});

test("public-data checks commit messages and masks personal metadata emails", async () => {
  const directory = await createRepository();
  const email = ["synthetic", "@mail", ".test"].join("");
  execFileSync("git", [
    "-c", `core.hooksPath=${join(directory, ".disabled-hooks")}`, "-c", "commit.gpgsign=false",
    "-c", "user.name=Security Test", "-c", `user.email=${email}`,
    "commit", "--quiet", "--allow-empty", "-m", `SEOWON_PW=${syntheticSecret}`
  ], { cwd: directory, stdio: "pipe" });
  const result = scan(directory, "--history");
  assert.equal(result.status, 1);
  const rules = JSON.parse(result.stdout).findings.map((finding: { rule: string }) => finding.rule);
  assert.deepEqual(rules.sort(), ["git-author-email", "git-committer-email", "unquoted-credential"].sort());
  assert.ok(!result.stdout.includes(email));
});

test("public-data returns a generic failure outside a repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seowon-cli-no-git-"));
  directories.push(directory);
  const result = scan(directory);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    error: "Public-data scan failed; no completeness claim", scope: "working-tree"
  });
  assert.ok(!result.stderr.includes(directory));
  assert.ok(!result.stderr.includes("fatal:"));
});

test("public-data escapes directional controls in reported filenames", async () => {
  const directory = await createRepository();
  const filename = `synthetic-${String.fromCharCode(0x202e)}.txt`;
  await writeFile(join(directory, filename), `SEOWON_PW=${syntheticSecret}\n`);
  const result = scan(directory);
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes(String.fromCharCode(0x202e)));
  assert.equal(JSON.parse(result.stdout).findings[0].file, "synthetic-\\u202e.txt");
});
