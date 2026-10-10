import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_TEXT_BYTES = 8 * 1024 * 1024;

function safeReportPath(file) {
  return file.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

// Report locations and rule names only. Never print matched credentials or personal data.
const demoValue =
  /^(?:your[_ -]|demo(?:[_ -]|$)|example(?:[_ -]|$)|test(?:[_ -]|$)|offline(?:[_ -]|$)|password$|\*+$|\.+$|<|\[|\$\{[A-Za-z_][A-Za-z0-9_]*\}$|202612345$|0+$|undefined$|null$|비어있음$)/i;
const rules = [
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    id: "service-token",
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/g
  },
  {
    id: "credential",
    pattern:
      /(?<![\w/@.-])(?:password|passwd|pwd|SEOWON_PASSWORD|SEOWON_PW|api[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']([^"'\r\n]+)["']/gi,
    value: 1
  },
  {
    id: "unquoted-credential",
    pattern:
      /(?<![\w/@.-])(?:password|passwd|pwd|SEOWON_PASSWORD|SEOWON_PW|api[_-]?key|client[_-]?secret)\s*=\s*([^\s"'`|;&<>,)]+)/gi,
    value: 1
  },
  {
    id: "session-token",
    pattern:
      /\b(?:JSESSIONID|SESSIONID|access_token|refresh_token)["']?\s*[:=]\s*["']?([A-Za-z0-9._~+/-]{12,})/gi,
    value: 1
  },
  {
    id: "student-identifier",
    pattern: /\b(?:stuno|userId|userNo|persNo|stdNo|SEOWON_ID|SEOWON_SID)["']?\s*[:=]\s*["']?(\d{8,10})\b/gi,
    value: 1
  },
  {
    id: "student-name",
    pattern: /\b(?:stdntNm|studentName)["']?\s*[:=]\s*["']([^"'\r\n]+)["']/gi,
    value: 1
  },
  {
    id: "personal-email",
    pattern:
      /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b|[^\s@]*\.invalid\b|users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
  },
  { id: "personal-phone", pattern: /\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g },
  { id: "resident-number", pattern: /\b\d{6}-[1-4]\d{6}\b/g },
  {
    id: "developer-home-path",
    pattern:
      /(?:[A-Za-z]:[\\/]+Users[\\/]+(?!Coding\b|Public\b|Default\b|<|your_|example)[^\s\\/"'`<>]+|\/(?:home|Users)\/(?!main(?:Home|Pop)\b|user\b|runner\b|example\b|<)[^\s/"'`<>]+)/g
  },
  {
    id: "database-credential",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:]+:[^\s@]+@/gi
  }
];

export function scanPublicText(source, file) {
  const findings = [];
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      const value = match[rule.value ?? 0];
      // Expressions and declared types are not embedded credentials.
      if (rule.value && demoValue.test(value)) continue;
      if (rule.id === "unquoted-credential" && /\.(?:[cm]?[jt]sx?)$/.test(file)) continue;
      if (
        rule.id === "session-token" &&
        /\.(?:[cm]?[jt]sx?)$/.test(file) &&
        !/["']/.test(source[(match.index ?? 0) + match[0].lastIndexOf(value) - 1] ?? "")
      )
        continue;
      if (rule.id === "unquoted-credential" && /^[A-Za-z_$][\w$.]*\(/.test(value)) continue;
      if (
        rule.id === "unquoted-credential" &&
        value === "await" &&
        /^\s+[A-Za-z_$][\w$.]*\s*\(/.test(source.slice(match.index + match[0].length))
      )
        continue;
      if (
        /^tests?\//.test(file) &&
        rule.id === "credential" &&
        /^(?:[xyp]|pw|pass|secret|old secret|new secret| {2}new secret {2}| {2}pw {2}| password | secret |secret with spaces|bad)$/.test(
          value
        )
      )
        continue;
      if (/^tests?\//.test(file) && rule.id === "credential" && /\\x(?:1e|1f)/i.test(value)) continue;
      findings.push({ file, line: source.slice(0, match.index).split("\n").length, rule: rule.id });
    }
  }
  return findings;
}

function git(args, options = {}) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 128 * 1024 * 1024,
    ...options
  });
}

const privateArtifact =
  /^(?:(?:research\/)?(?:captures|saz|files|SAZ)\/|\.local\/|node_modules\/|downloads\/|data\/|output\/)|(?:^|\/)\.env(?:$|\.(?!example$)[^/]+)|(?:^|\/)(?:cookies|session|credentials)\.json$|\.(?:saz|har|pcap(?:ng)?|pem|key|p12|pfx|sql|sqlite3?|db)$|\.(?:cookies(?:\.[^/]+)?|session)\.json$/i;
const textFile =
  /(?:^|\/)(?:\.env[^/]*|\.gitconfig|\.git-credentials)$|\.(?:[cm]?[jt]sx?|json|md|txt|ya?ml|html?|env|example|config|bat|cmd|ps1|sh|sql)$/i;
const publicMedia = /\.(?:gif|png|jpe?g|webp|mp4|webm|mov)$/i;

function reviewedMediaFiles() {
  try {
    const manifest = JSON.parse(fs.readFileSync("docs/media/sources.json", "utf8"));
    return new Map(
      (manifest.assets ?? [])
        .filter(
          (asset) =>
            typeof asset.file === "string" &&
            !asset.file.includes("/") &&
            !asset.file.includes("\\") &&
            asset.mode === "demo" &&
            asset.privacy_review === "synthetic" &&
            /^[a-f0-9]{64}$/.test(asset.sha256)
        )
        .map((asset) => [`docs/media/${asset.file}`, asset.sha256])
    );
  } catch {
    return new Map();
  }
}

function historicalMediaObjects() {
  // rev-list --objects names each blob only once. Inspect tree paths as well so a
  // reviewed image cannot conceal the same blob at another, unreviewed path.
  const media = new Map();
  for (const commit of git(["rev-list", "--all"]).trim().split("\n").filter(Boolean)) {
    for (const entry of git(["ls-tree", "-r", "-z", "--full-tree", commit]).split("\0")) {
      const separator = entry.indexOf("\t");
      if (separator < 0) continue;
      const [, type, oid] = entry.slice(0, separator).split(" ");
      const file = entry.slice(separator + 1);
      if (type === "blob" && publicMedia.test(file)) media.set(`${oid}\0${file}`, { oid, file });
    }
  }
  return [...media.values()];
}

function scanHistoricalMedia() {
  const media = historicalMediaObjects();
  const reviewedMedia = reviewedMediaFiles();
  const candidates = media.filter(({ file }) => reviewedMedia.has(file));
  const accepted = new Set();
  if (candidates.length) {
    const info = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
      input: candidates.map(({ oid }) => oid).join("\n") + "\n"
    }).trim().split("\n");
    const boundedCandidates = candidates.filter((_, index) =>
      info[index]?.split(" ")[1] === "blob" && Number(info[index]?.split(" ")[2]) <= MAX_TEXT_BYTES
    );
    if (boundedCandidates.length) {
      const batch = git(["cat-file", "--batch"], {
        input: boundedCandidates.map(({ oid }) => oid).join("\n") + "\n",
        encoding: null
      });
      let offset = 0;
      for (const { oid, file } of boundedCandidates) {
        const newline = batch.indexOf(10, offset);
        const size = Number(batch.subarray(offset, newline).toString("utf8").split(" ")[2]);
        const body = batch.subarray(newline + 1, newline + 1 + size);
        offset = newline + 1 + size + 1;
        if (createHash("sha256").update(body).digest("hex") === reviewedMedia.get(file)) {
          accepted.add(`${oid}\0${file}`);
        }
      }
    }
  }
  return media.filter(({ oid, file }) => !accepted.has(`${oid}\0${file}`))
    .map(({ file, oid }) => ({ file, line: 1, rule: "historical-media-review", blob: oid.slice(0, 12) }));
}

function scanGitMetadata() {
  const records = git(["log", "--all", "--format=%H%x00%ae%x00%ce%x00%B%x00"]).split("\0");
  const findings = [];
  for (let index = 0; index + 3 < records.length; index += 4) {
    const oid = records[index].trim();
    const file = `git-metadata/${oid.slice(0, 12)}`;
    for (const [offset, rule] of [[1, "git-author-email"], [2, "git-committer-email"]]) {
      const email = records[index + offset].trim();
      if (email && !/@(?:users\.noreply\.github\.com|example\.(?:com|org|net)|[^@]*\.invalid)$/.test(email)) {
        findings.push({ file, line: 1, rule, blob: oid.slice(0, 12) });
      }
    }
    findings.push(...scanPublicText(records[index + 3], file).map((finding) => ({ ...finding, blob: oid.slice(0, 12) })));
  }
  return findings;
}

export function scanWorkingTree() {
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean);
  const findings = tracked
    .filter(
      (file) =>
        privateArtifact.test(file) && !/^test\/integration\/captures\/.*\.test\.ts$/.test(file)
    )
    .map((file) => ({ file, line: 1, rule: "private-artifact" }));
  const reviewedMedia = reviewedMediaFiles();
  for (const file of new Set(files)) {
    if (!fs.existsSync(file)) continue;
    const metadata = fs.lstatSync(file);
    if (publicMedia.test(file)) {
      const expectedHash = reviewedMedia.get(file);
      const actualHash = metadata.isFile() && metadata.size <= MAX_TEXT_BYTES
        ? createHash("sha256").update(fs.readFileSync(file)).digest("hex")
        : undefined;
      if (!expectedHash || actualHash !== expectedHash) {
        findings.push({ file, line: 1, rule: "unreviewed-public-media" });
      }
    }
    if (!textFile.test(file) || !metadata.isFile() || metadata.size > MAX_TEXT_BYTES) continue;
    findings.push(...scanPublicText(fs.readFileSync(file, "utf8"), file));
  }
  return findings;
}

export function scanHistory() {
  const objects = git(["rev-list", "--objects", "--all"])
    .trim()
    .split("\n")
    .map((line) => {
      const separator = line.indexOf(" ");
      return { oid: line.slice(0, separator), file: line.slice(separator + 1) };
    })
    .filter(({ file, oid }) => oid && (textFile.test(file) || privateArtifact.test(file) || publicMedia.test(file)));
  const metadataFindings = [...scanGitMetadata(), ...scanHistoricalMedia()];
  if (!objects.length) return metadataFindings;
  const info = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
    input: objects.map(({ oid }) => oid).join("\n") + "\n"
  })
    .trim()
    .split("\n");
  const allBlobs = objects.filter((_, i) => info[i]?.split(" ")[1] === "blob");
  const findings = metadataFindings.concat(allBlobs
    .filter(({ file }) => privateArtifact.test(file))
    .map(({ file, oid }) => ({ file, line: 1, rule: "private-artifact", blob: oid.slice(0, 12) })));
  const blobs = objects.filter(
    ({ file }, i) =>
      info[i]?.split(" ")[1] === "blob" &&
      textFile.test(file) &&
      !/^node_modules\//.test(file) &&
      Number(info[i]?.split(" ")[2]) <= MAX_TEXT_BYTES
  );
  if (!blobs.length) return findings;
  const batch = git(["cat-file", "--batch"], {
    input: blobs.map(({ oid }) => oid).join("\n") + "\n",
    encoding: null
  });
  let offset = 0;
  for (const { oid, file } of blobs) {
    const newline = batch.indexOf(10, offset);
    const size = Number(batch.subarray(offset, newline).toString("utf8").split(" ")[2]);
    const body = batch.subarray(newline + 1, newline + 1 + size).toString("utf8");
    offset = newline + 1 + size + 1;
    findings.push(
      ...scanPublicText(body, file).map((finding) => ({ ...finding, blob: oid.slice(0, 12) }))
    );
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const history = process.argv.includes("--history");
    const findings = (history ? scanHistory() : scanWorkingTree())
      .map((finding) => ({ ...finding, file: safeReportPath(finding.file) }));
    const scope = history ? "reachable-git-blobs" : "working-tree";
    const report = process.argv.includes("--summary")
      ? {
          scope,
          total: findings.length,
          byRule: Object.fromEntries(
            [...new Set(findings.map(({ rule }) => rule))].map((rule) => [
              rule,
              findings.filter((finding) => finding.rule === rule).length
            ])
          ),
          byDirectory: Object.fromEntries(
            [
              ...new Set(
                findings.map(({ file }) => (file.includes("/") ? file.split("/")[0] : "root"))
              )
            ].map((directory) => [
              directory,
              findings.filter(
                ({ file }) => (file.includes("/") ? file.split("/")[0] : "root") === directory
              ).length
            ])
          ),
          files: [
            ...new Set(
              findings
                .filter(({ file }) => !/^(?:SAZ|files|FILES|research|node_modules)\//.test(file))
                .map(({ file }) => file)
            )
          ].slice(0, 40)
        }
      : { scope, findings };
    console.log(
      JSON.stringify(
        {
          ...report,
          classification: "candidate-findings",
          limitations: {
            detection: "Heuristic patterns; candidates require review",
            textContent:
              "Known text file types up to 8 MiB; symlink targets and nontext contents are not inspected",
            media:
              "Media content is not decoded or OCR scanned; current and historical media require an exact path/SHA-256 match in the current synthetic-review manifest, and all other media requires manual review",
            metadata:
              "Reachable commit email addresses and messages are checked; author names, file paths, and arbitrary identifier formats still require manual privacy review",
            history:
              "Reachable Git objects only; unreachable and rewritten history is not inspected"
          }
        },
        null,
        2
      )
    );
    if (findings.length) process.exitCode = 1;
  } catch {
    // Child-process errors may carry raw stdout; never serialize or inspect them.
    console.error(
      JSON.stringify({
        error: "Public-data scan failed; no completeness claim",
        scope: process.argv.includes("--history") ? "reachable-git-blobs" : "working-tree"
      })
    );
    process.exitCode = 2;
  }
}
