import fs from "node:fs";

/** Load only login settings. Other .env keys must not change child processes or networking. */
export function loadLoginEnv(file: string, env: NodeJS.ProcessEnv = process.env): void {
  let text: string;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 64 * 1024) return;
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
    if (key !== "SEOWON_SID" && key !== "SEOWON_PW") continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[key] == null || env[key] === "") env[key] = value;
  }
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env) {
  const out = {
    suite: "", sid: env.SEOWON_SID || "", pw: env.SEOWON_PW || "",
    timeout: "90000", depth: "3", verbose: false, list: false,
    help: false, write: false, heavy: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] || "";
    if (/^--(?:sid|pw)(?:=|$)/.test(a)) {
      throw new Error("학번·비밀번호 명령행 옵션은 지원하지 않습니다. 로그인 입력창 또는 .env를 사용하세요.");
    }
    const next = () => {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("명령행 옵션의 값이 필요합니다. --help를 확인하세요.");
      return value;
    };
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--list") out.list = true;
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (a === "--write") out.write = true;
    else if (a === "--heavy") out.heavy = true;
    else if (a === "--suite") out.suite = next();
    else if (a.startsWith("--suite=")) out.suite = a.slice(8);
    else if (a === "--timeout") out.timeout = next();
    else if (a.startsWith("--timeout=")) out.timeout = a.slice(10);
    else if (a === "--depth") out.depth = next();
    else if (a.startsWith("--depth=")) out.depth = a.slice(8);
    else throw new Error("지원하지 않는 명령행 옵션입니다. --help를 확인하세요.");
  }
  const timeout = Number(out.timeout);
  const depth = Number(out.depth);
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 300000) {
    throw new Error("--timeout은 1000~300000ms 범위여야 합니다.");
  }
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 100) {
    throw new Error("--depth는 1~100 범위의 정수여야 합니다.");
  }
  return out;
}

/** Arguments can include student IDs, assignment bodies, credentials and local paths. */
export function formatTraceCall(name: string): string {
  return `${name}()`;
}

/** Explicit login attempts replace a cached account without retaining passwords in CLI options. */
export function takeLoginCredentials(
  options: { sid: string; pw: string },
  settings: {
    authenticated?: boolean;
    force?: boolean;
    explicit?: { studentId: string; password: string };
  } = {}
): { studentId: string; password: string } | undefined {
  const previousPassword = options.pw;
  options.pw = "";
  if (settings.authenticated && !settings.force && !settings.explicit) return undefined;
  return {
    studentId: settings.explicit?.studentId ?? (settings.force ? "" : options.sid),
    password: settings.explicit?.password ?? (settings.force ? "" : previousPassword)
  };
}

/** Windows environment names are case insensitive; do not forward any login variable spelling. */
export function browserLaunchEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith("SEOWON_")));
}
