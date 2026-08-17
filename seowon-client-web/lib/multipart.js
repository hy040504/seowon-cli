/**
 * 브라우저 multipart/form-data 파서.
 *
 * 과제 제출 파일과 필드 값을 나눈다.
 * 상세 HTML 에서 제출 폼 action·숨은 필드도 읽는다.
 */

/**
 * Buffer 안에서 needle 의 시작 인덱스를 찾는다.
 * @param {Buffer} buf - 검색 대상
 * @param {Buffer} needle - 찾을 바이트열
 * @param {number} [from=0] - 검색 시작 위치
 * @returns {number} 인덱스. 없으면 -1
 */
function indexOf(buf, needle, from = 0) {
    return buf.indexOf(needle, from);
}

/**
 * Content-Disposition 의 name/filename 값을 디코딩한다.
 * @param {string} raw - 원본 이름
 * @returns {string} 디코딩된 이름
 */
function decodeName(raw) {
    if (!raw) return "";
    try {
        if (raw.includes("%")) return decodeURIComponent(raw);
    } catch {
        // 퍼센트 디코딩 실패 시 원문 유지
    }
    return raw;
}

/**
 * HTTP 요청 본문을 필드와 파일로 나눈다.
 * @param {import("node:http").IncomingMessage} req - 들어온 요청
 * @param {number} [maxBytes] - 허용 본문 크기. 기본 25MB
 * @returns {Promise<{ fields: Record<string, string>, files: Record<string, object> }>}
 */
export function parseMultipart(req, maxBytes = 25 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const ctype = String(req.headers["content-type"] || "");
        const m = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!m) {
            reject(new Error("파일 전송 형식이 아닙니다."));
            return;
        }
        const boundary = (m[1] || m[2] || "").trim();
        const chunks = [];
        let n = 0;
        req.on("data", (c) => {
            n += c.length;
            if (n > maxBytes) {
                reject(new Error("파일이 너무 큽니다. 25MB 이하로 보내세요."));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => {
            try {
                resolve(splitParts(Buffer.concat(chunks), boundary));
            } catch (err) {
                reject(err);
            }
        });
        req.on("error", reject);
    });
}

/**
 * boundary 기준으로 파트를 잘라 필드·파일 맵을 만든다.
 * @param {Buffer} buf - 전체 본문
 * @param {string} boundary - multipart boundary
 * @returns {{ fields: Record<string, string>, files: Record<string, object> }}
 */
function splitParts(buf, boundary) {
    const sep = Buffer.from(`--${boundary}`);
    const fields = {};
    const files = {};
    let idx = indexOf(buf, sep);
    while (idx >= 0) {
        const next = indexOf(buf, sep, idx + sep.length);
        if (next < 0) break;
        let part = buf.subarray(idx + sep.length, next);
        // 파트 앞뒤 CRLF 제거
        if (part[0] === 13 && part[1] === 10) part = part.subarray(2);
        if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
            part = part.subarray(0, -2);
        }
        const headerEnd = indexOf(part, Buffer.from("\r\n\r\n"));
        if (headerEnd >= 0) {
            const header = part.subarray(0, headerEnd).toString("utf8");
            const body = part.subarray(headerEnd + 4);
            const name = decodeName((header.match(/name="([^"]+)"/i) || [])[1] || "");
            const filename = decodeName((header.match(/filename="([^"]*)"/i) || [])[1] || "");
            const mime = ((header.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || "").trim();
            if (name) {
                if (filename) {
                    files[name] = {
                        filename,
                        mime: mime || "application/octet-stream",
                        data: body
                    };
                } else {
                    fields[name] = body.toString("utf8");
                }
            }
        }
        idx = next;
    }
    return { fields, files };
}

/**
 * 과제 상세 HTML 에서 제출 폼 action·숨은 필드·파일 필드명을 읽는다.
 * @param {string} html - 과제 화면 HTML
 * @param {string} baseUrl - action 상대경로를 절대 URL 로 만들 기준
 * @returns {object | null} 제출 폼 정보. 없으면 null
 */
export function parseAssignmentSubmitForm(html, baseUrl) {
    if (!html) return null;
    const forms = [...String(html).matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
    let best = null;
    for (const m of forms) {
        const attrs = m[1] || "";
        const body = m[2] || "";
        const action = (attrs.match(/action=["']([^"']*)["']/i) || [])[1] || "";
        const hasFile = /type=["']file["']/i.test(body);
        const looks =
            /asmnt|saveStu|submit|제출/i.test(attrs + body + action) ||
            hasFile ||
            /textarea/i.test(body);
        if (!looks) continue;
        const fields = {};
        for (const inp of body.matchAll(/<input\b([^>]*)>/gi)) {
            const a = inp[1] || "";
            const name = (a.match(/\bname=["']([^"']+)["']/i) || [])[1];
            if (!name) continue;
            const type = ((a.match(/\btype=["']([^"']+)["']/i) || [])[1] || "text").toLowerCase();
            if (type === "file" || type === "button" || type === "submit") continue;
            fields[name] = (a.match(/\bvalue=["']([^"']*)["']/i) || [])[1] || "";
        }
        let textField = "";
        for (const t of body.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
            const name = (t[1].match(/\bname=["']([^"']+)["']/i) || [])[1];
            if (!name) continue;
            if (!textField || /ans|cnts|content|desc|내용/i.test(name)) textField = name;
            fields[name] = String(t[2] || "")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&amp;/g, "&");
        }
        const fileField =
            (body.match(/<input\b[^>]*type=["']file["'][^>]*name=["']([^"']+)["']/i) || [])[1] ||
            (body.match(/<input\b[^>]*name=["']([^"']+)["'][^>]*type=["']file["']/i) || [])[1] ||
            "";
        let actionAbs = "";
        try {
            if (action) actionAbs = new URL(action, baseUrl).toString();
        } catch {
            actionAbs = "";
        }
        best = {
            action: actionAbs,
            fields,
            textField,
            fileField,
            hasFile: Boolean(fileField || hasFile)
        };
        if (hasFile || /save|submit/i.test(action)) break;
    }
    return best;
}
