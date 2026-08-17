/**
 * 브라우저 화면 로직.
 *
 * 조회·제출·다운로드는 /api 만 부른다.
 * 페이지별 overlay 로 메뉴 전환과 병렬 조회를 허용한다.
 */

/**
 * 요소 ID 로 DOM 을 찾는다.
 * @param {string} id
 * @returns {HTMLElement | null}
 */
const $ = (id) => document.getElementById(id);

/** 화면 전역 상태 */
const state = {
  page: "login",
  student: null,
  asgRows: [],
  lesRows: [],
  scoreRows: [],
  matRows: [],
  asgSel: -1,
  lesSel: -1,
  scoreSel: -1,
  matSel: -1,
  timetable: null,
  ttTimer: null,
  downloads: {}
};

/**
 * 밝은/어두운 테마를 적용하고 localStorage 에 남긴다.
 * @param {boolean} dark
 * @returns {void}
 */
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("dark").checked = dark;
  $("themeCap").textContent = dark
    ? "어두운 바탕과 밝은 글자로 봅니다."
    : "밝은 카드 화면으로 봅니다.";
  localStorage.setItem("seowon-web-dark", dark ? "1" : "0");
}

/**
 * 지정한 페이지를 보이고 사이드 메뉴 활성 표시를 맞춘다.
 * @param {string} name - login | asg | mat | les | tt | score | sum | cfg
 * @returns {void}
 */
function showPage(name) {
  state.page = name;
  for (const el of document.querySelectorAll(".page")) el.classList.add("hidden");
  $(`page-${name}`).classList.remove("hidden");
  for (const btn of document.querySelectorAll(".nav button")) {
    btn.classList.toggle("active", btn.dataset.page === name);
  }
}

/**
 * 사이드바 칩에 이름·학과를 그린다.
 * @returns {void}
 */
function chip() {
  if (!state.student) {
    $("chipName").textContent = "로그인 전";
    $("chipSub").textContent = "세션 없음";
    $("avatar").textContent = "?";
    const out = $("btnLogoutSide");
    if (out) out.classList.add("hidden");
    return;
  }
  const who = state.student.studentName || "이름 없음";
  $("chipName").textContent = who;
  $("chipSub").textContent = state.student.deptName || "학과 없음";
  $("avatar").textContent = who[0];
  const out = $("btnLogoutSide");
  if (out) out.classList.toggle("hidden", false);
}

/**
 * 로그아웃 후 목록·다운로드·시간표 타이머를 비우고 로그인 화면으로 돌린다.
 * @returns {void}
 */
function resetSessionUi() {
  state.student = null;
  state.asgRows = [];
  state.lesRows = [];
  state.scoreRows = [];
  state.matRows = [];
  if (state.ttTimer) {
    clearInterval(state.ttTimer);
    state.ttTimer = null;
  }
  state.timetable = null;
  state.downloads = {};
  closeTtLightbox();
  state.asgSel = -1;
  state.lesSel = -1;
  state.scoreSel = -1;
  state.matSel = -1;
  const out = $("btnLogoutSide");
  if (out) out.classList.add("hidden");
  chip();
  showLoginForm();
  showPage("login");
}

/** 페이지별 진행 중 요청 수 */
const inflight = {};

/**
 * 페이지 안 overlay 표시를 켠다.
 * @param {string} page - 페이지 키
 * @param {boolean} on
 * @param {string} [msg] - overlay 문구
 * @returns {void}
 */
function setPageBusy(page, on, msg) {
  const ov = $(`ov-${page}`);
  if (!ov) return;
  ov.classList.toggle("hidden", !on);
  const label = ov.querySelector(".page-ov-msg");
  if (label && msg) label.textContent = msg;
}

/**
 * 페이지 overlay 를 켠 채 비동기 작업을 실행한다. 중첩 호출을 센다.
 * @param {string} page
 * @param {string} msg
 * @param {() => (void | Promise<unknown>)} fn
 * @returns {Promise<unknown>}
 */
function busy(page, msg, fn) {
  inflight[page] = (inflight[page] || 0) + 1;
  setPageBusy(page, true, msg);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      inflight[page] = Math.max(0, (inflight[page] || 1) - 1);
      if (!inflight[page]) setPageBusy(page, false);
    });
}

/**
 * /api JSON 요청. 쿠키를 포함하고 실패 시 error 메시지를 던진다.
 * @param {string} path
 * @param {RequestInit & { timeoutMs?: number }} [opt]
 * @returns {Promise<object>}
 */
async function api(path, opt = {}) {
  const { timeoutMs = 35000, headers, ...rest } = opt;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      signal: ctrl.signal
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("응답이 없습니다. 다시 눌러 보세요.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  return data;
}

/**
 * 로그인 입력 폼을 보이고 완료 카드를 숨긴다.
 * @returns {void}
 */
function showLoginForm() {
  $("loginForm").classList.remove("hidden");
  $("loginOk").classList.add("hidden");
}

/**
 * 로그인 완료 카드에 이름·학과를 채운다.
 * @returns {void}
 */
function showLoginOk() {
  const s = state.student || {};
  $("okWho").textContent = s.studentName || "이름을 불러오는 중";
  $("okSub").textContent = s.deptName || (s.studentName ? "" : "학과를 불러오는 중");
  $("loginForm").classList.add("hidden");
  $("loginOk").classList.remove("hidden");
}

/**
 * SSO 로 이름·학과를 가져와 칩과 완료 카드를 갱신한다.
 * @returns {Promise<void>}
 */
async function loadProfile() {
  try {
    const data = await api("/api/profile", { timeoutMs: 25000 });
    if (data.student) {
      state.student = data.student;
      chip();
      if (!$("loginOk").classList.contains("hidden")) showLoginOk();
    }
  } catch {
    if (!state.student?.studentName) {
      $("okWho").textContent = "이름을 가져오지 못했습니다";
      $("okSub").textContent = "과제 조회는 그대로 할 수 있습니다";
    }
  }
}

/**
 * 학번·비밀번호로 로그인한다. 성공 후 프로필을 비동기로 채운다.
 * @returns {Promise<void>}
 */
async function doLogin() {
  const btn = $("btnLogin");
  const err = $("loginErr");
  const studentId = $("sid").value.trim();
  const password = $("pw").value;
  err.style.color = "var(--red)";
  if (!studentId || !password) {
    err.textContent = "학번과 비밀번호를 입력하세요.";
    return;
  }
  if (btn.dataset.busy === "1") return;
  btn.dataset.busy = "1";
  btn.disabled = true;
  btn.textContent = "로그인 중...";
  err.style.color = "var(--text-3)";
  err.textContent = "학교 서버에 연결하는 중입니다.";
  try {
    const data = await api("/api/login", {
      method: "POST",
      timeoutMs: 25000,
      body: JSON.stringify({ studentId, password })
    });
    state.student = data.student;
    err.textContent = "";
    chip();
    showLoginOk();
    loadProfile();
  } catch (e) {
    err.style.color = "var(--red)";
    err.textContent = e.message || "로그인에 실패했습니다.";
  } finally {
    btn.dataset.busy = "";
    btn.disabled = false;
    btn.textContent = "로그인";
  }
}

/**
 * Toss 스타일 카드 목록을 그린다.
 * @param {HTMLElement} el - 목록 컨테이너
 * @param {object[]} rows
 * @param {(row: object) => object} mapRow - title/meta/actions 매핑
 * @param {number} selIndex - 선택된 행
 * @param {(index: number) => void} onSel
 * @returns {void}
 */
function fillJobList(el, rows, mapRow, selIndex, onSel) {
  el.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "job-empty";
    empty.textContent = "표시할 항목이 없습니다.";
    el.appendChild(empty);
    return;
  }
  rows.forEach((row, i) => {
    const info = mapRow(row) || {};
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "job-row" + (i === selIndex ? " sel" : "") + (info.live ? " live-class" : "");
    const main = document.createElement("div");
    main.className = "job-main";
    const title = document.createElement("p");
    title.className = "job-title";
    title.textContent = info.title || "-";
    const meta = document.createElement("p");
    meta.className = "job-meta";
    if (info.metaParts) {
      info.metaParts.forEach((p, idx) => {
        if (idx) meta.append(" · ");
        const s = document.createElement("span");
        s.textContent = p.text;
        if (p.cls) s.className = p.cls;
        else s.className = p.hot ? "meta-hot" : "meta-dim";
        meta.appendChild(s);
      });
    } else {
      meta.textContent = info.meta || "";
    }
    main.appendChild(title);
    main.appendChild(meta);
    btn.appendChild(main);
    if (info.right || info.actions) {
      const right = document.createElement("div");
      right.className = "job-right";
      if (info.right) {
        const tag = document.createElement("span");
        tag.textContent = info.right;
        right.appendChild(tag);
      }
      if (info.actions) {
        const acts = document.createElement("div");
        acts.className = "job-actions";
        for (const act of info.actions) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "job-act" + (act.kind ? ` act-${act.kind}` : "");
          if (act.icon) b.innerHTML = act.icon;
          else b.textContent = act.label;
          if (act.title) b.title = act.title;
          b.addEventListener("click", (ev) => {
            ev.stopPropagation();
            act.onClick();
          });
          acts.appendChild(b);
        }
        right.appendChild(acts);
      }
      btn.appendChild(right);
    }
    btn.addEventListener("click", () => onSel(i));
    el.appendChild(btn);
  });
}

/**
 * 표 본문을 행으로 채운다.
 * @param {HTMLElement} tbody
 * @param {object[]} rows
 * @param {(string | ((row: object) => unknown))[]} cols
 * @param {number} selIndex
 * @param {(index: number) => void} onSel
 * @returns {void}
 */
function fillTable(tbody, rows, cols, selIndex, onSel) {
  tbody.replaceChildren();
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (i === selIndex) tr.classList.add("sel");
    for (const col of cols) {
      const td = document.createElement("td");
      const val = typeof col === "function" ? col(row) : row[col];
      if (val instanceof Node) td.appendChild(val);
      else td.textContent = val == null || val === "" ? "-" : String(val);
      tr.appendChild(td);
    }
    tr.addEventListener("click", () => onSel(i));
    tbody.appendChild(tr);
  });
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = cols.length;
    td.textContent = "표시할 항목이 없습니다.";
    td.style.color = "var(--text-3)";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

/**
 * 과제 목록을 그리고 선택된 행 아래 상세·제출 칸을 펼친다.
 * @returns {void}
 */
function paintAssignments() {
  const el = $("asgList");
  el.replaceChildren();
  if (!state.asgRows.length) {
    const empty = document.createElement("div");
    empty.className = "job-empty";
    empty.textContent = "표시할 항목이 없습니다.";
    el.appendChild(empty);
    return;
  }
  state.asgRows.forEach((row, i) => {
    const item = document.createElement("div");
    item.className = "job-item" + (i === state.asgSel ? " open" : "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "job-row" + (i === state.asgSel ? " sel" : "");
    const main = document.createElement("div");
    main.className = "job-main";
    const title = document.createElement("p");
    title.className = "job-title";
    title.textContent = row.title || "-";
    const meta = document.createElement("p");
    meta.className = "job-meta";
    meta.textContent = [row.courseTitle, row.status, row.period].filter(Boolean).join(" · ");
    main.appendChild(title);
    main.appendChild(meta);
    btn.appendChild(main);
    if (row.dueNow) {
      const right = document.createElement("div");
      right.className = "job-right";
      right.textContent = "지금";
      btn.appendChild(right);
    }
    btn.addEventListener("click", () => {
      if (state.asgSel === i) {
        state.asgSel = -1;
        paintAssignments();
        return;
      }
      state.asgSel = i;
      paintAssignments();
      showDetail();
    });
    item.appendChild(btn);
    if (i === state.asgSel) {
      const exp = document.createElement("div");
      exp.className = "asg-expand";
      exp.innerHTML =
        `<p class="field">상세 내용</p>` +
        `<pre id="asgDetail">불러오는 중…</pre>` +
        `<p class="field">첨부파일</p>` +
        `<div class="file-list" id="asgFiles"></div>` +
        `<div id="asgSubmitBox">` +
        `<p class="field">제출 내용</p>` +
        `<textarea id="asgText" rows="5" placeholder="제출할 내용을 적으세요"></textarea>` +
        `<p class="field">제출 파일</p>` +
        `<input id="asgFile" type="file">` +
        `<button type="button" class="primary" id="btnAsgSubmit">제출</button>` +
        `</div>`;
      item.appendChild(exp);
    }
    el.appendChild(item);
  });
}

/**
 * 과제 목록을 서버에서 받아 그린다.
 * @returns {Promise<void>}
 */
async function loadAssignments() {
  const filter = $("asgFilter").value;
  const data = await busy("asg", "과제를 불러오는 중", () => api(`/api/assignments?filter=${encodeURIComponent(filter)}`));
  state.asgRows = data.rows || [];
  state.asgSel = -1;
  paintAssignments();
}

/**
 * 첨부 파일 버튼을 만들고 클릭 시 캠퍼스 다운로드를 연다.
 * @param {HTMLElement} el
 * @param {{ title?: string, url: string }[]} files
 * @param {object} [extra] - crsCreCd 등 추적 필드
 * @returns {void}
 */
function renderFileButtons(el, files, extra = {}) {
  el.replaceChildren();
  for (const f of files || []) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "file-btn";
    b.textContent = f.title || "첨부파일";
    b.addEventListener("click", () => downloadCampus(f.url, f.title, extra));
    el.appendChild(b);
  }
}

/**
 * 선택된 과제의 상세·첨부·제출 칸을 채운다.
 * @returns {Promise<void>}
 */
async function showDetail() {
  const row = state.asgRows[state.asgSel];
  if (!row || !$("asgDetail")) return;
  try {
    const data = await busy("asg", "상세를 여는 중", () =>
      api("/api/assignment-detail", {
        method: "POST",
        body: JSON.stringify({ crsCreCd: row.crsCreCd, id: row.id })
      })
    );
    if ($("asgDetail")) $("asgDetail").textContent = data.text || "(내용 없음)";
    if ($("asgFiles")) {
      renderFileButtons($("asgFiles"), data.attachments || [], { crsCreCd: row.crsCreCd, id: row.id });
    }
    if ($("asgSubmitBox") && !data.canSubmit) {
      $("asgSubmitBox").innerHTML = `<p class="hint">이 과제는 웹에서 제출 양식을 찾지 못했습니다. e-campus 에서 제출하세요.</p>`;
    }
    const sub = $("btnAsgSubmit");
    if (sub) sub.onclick = () => submitCurrent().catch((e) => alert(e.message));
  } catch (e) {
    if ($("asgDetail")) $("asgDetail").textContent = e.message || "상세를 열지 못했습니다.";
  }
}

/**
 * 펼쳐진 과제를 multipart 로 제출한다.
 * @returns {Promise<void>}
 */
async function submitCurrent() {
  const row = state.asgRows[state.asgSel];
  if (!row) return;
  if (!window.confirm("이 과제를 제출할까요? 학교 과제함에 올라갑니다.")) return;
  const fd = new FormData();
  fd.append("crsCreCd", row.crsCreCd);
  fd.append("id", row.id);
  fd.append("text", $("asgText").value);
  const file = $("asgFile").files[0];
  if (file) fd.append("file", file);
  await busy("asg", "제출하는 중", async () => {
    const res = await fetch("/api/assignment-submit", { method: "POST", credentials: "same-origin", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || "제출에 실패했습니다.");
  });
  $("asgDetail").textContent = "제출했습니다. e-campus 에서도 한 번 확인하세요.";
}

/**
 * 강의실 자료 목록을 받아 그린다.
 * @returns {Promise<void>}
 */
async function loadMaterials() {
  const data = await busy("mat", "자료를 불러오는 중", () => api("/api/materials"));
  state.matRows = data.rows || [];
  state.matSel = -1;
  $("matPickTitle").textContent = "자료를 고르세요";
  $("matFiles").replaceChildren();
  paintMaterials();
}

/**
 * 자료 카드 목록을 다시 그린다.
 * @returns {void}
 */
function paintMaterials() {
  fillJobList(
    $("matList"),
    state.matRows,
    (r) => ({
      title: r.title,
      meta: [r.courseTitle, r.date].filter(Boolean).join(" · "),
      right: r.hasAttachment ? "첨부" : ""
    }),
    state.matSel,
    (i) => {
      state.matSel = i;
      paintMaterials();
      showMaterial();
    }
  );
}

/**
 * 선택된 자료의 첨부 버튼을 연다.
 * @returns {Promise<void>}
 */
async function showMaterial() {
  const row = state.matRows[state.matSel];
  if (!row) return;
  $("matPickTitle").textContent = row.title || "자료";
  const data = await busy("mat", "첨부를 여는 중", () =>
    api("/api/material-files", {
      method: "POST",
      body: JSON.stringify({ crsCreCd: row.crsCreCd, id: row.id })
    })
  );
  if (!data.files || !data.files.length) {
    $("matFiles").textContent = "첨부 파일이 없습니다.";
    return;
  }
  renderFileButtons($("matFiles"), data.files, { crsCreCd: row.crsCreCd, id: row.id });
}

/**
 * e-campus 첨부 URL 을 받아 브라우저 저장으로 연다.
 * @param {string} url
 * @param {string} title - 저장 파일 이름
 * @param {object} [extra]
 * @returns {Promise<void>}
 */
async function downloadCampus(url, title, extra = {}) {
  await busy(state.page === "asg" ? "asg" : "mat", "파일을 받는 중", async () => {
    const res = await fetch("/api/download", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title, ...extra })
    });
    if (!res.ok) {
      let msg = "다운로드에 실패했습니다.";
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch {
        // JSON 오류 본문이 아니면 기본 문구
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = title || "download";
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

/**
 * 이러닝 차시 목록을 받아 그린다.
 * @returns {Promise<void>}
 */
async function loadLessons() {
  const filter = $("lesFilter").value;
  const data = await busy("les", "이러닝을 불러오는 중", () => api(`/api/lessons?filter=${encodeURIComponent(filter)}`));
  state.lesRows = data.rows || [];
  state.lesSel = -1;
  paintLessons();
}

/**
 * 차시 다운로드 상태를 구분하는 키를 만든다.
 * @param {{ crsCreCd?: string, lessonCntsId?: string }} row
 * @returns {string}
 */
function lessonKey(row) {
  return `${row.crsCreCd || ""}::${row.lessonCntsId || ""}`;
}

/**
 * 출결 문구에 맞는 색상 클래스를 고른다.
 * 학습완료=록색, 학습중=민트, 미학습·결석=밝은 빨강.
 * @param {string} status
 * @returns {string}
 */
function attendanceClass(status) {
  const s = String(status || "");
  if (s.includes("학습완료")) return "att-done";
  if (s.includes("학습중")) return "att-ing";
  if (s.includes("미학습") || s.includes("결석")) return "att-miss";
  return "meta-dim";
}

/**
 * 학교 출결 문구에서 화면 버튼 잔여 글자를 걷어 낸다.
 * 예: "미학습(결석) X 강의보기" → "미학습(결석)"
 * @param {string} status
 * @returns {string}
 */
function cleanAttendanceLabel(status) {
  return String(status || "")
    .replace(/강의보기/g, "")
    .replace(/\s*[xX×]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 이러닝 카드와 다운로드 진행 칸을 그린다.
 * @returns {void}
 */
function paintLessons() {
  const el = $("lesList");
  if (!el) return;
  el.replaceChildren();
  if (!state.lesRows.length) {
    const empty = document.createElement("div");
    empty.className = "job-empty";
    empty.textContent = "표시할 항목이 없습니다.";
    el.appendChild(empty);
    return;
  }
  state.lesRows.forEach((row, i) => {
    const item = document.createElement("div");
    item.className = "job-item";
    const wrap = document.createElement("div");
    fillJobList(
      wrap,
      [row],
      (r) => ({
        title: r.title,
        metaParts: [
          { text: r.courseTitle },
          { text: r.week },
          { text: cleanAttendanceLabel(r.attendanceStatus), cls: attendanceClass(r.attendanceStatus) },
          { text: r.period }
        ].filter((p) => p.text),
        right: r.progressPercent == null ? (r.needsWatch ? "들을 차시" : "") : `${r.progressPercent}%`,
        actions: [
          {
            kind: "play",
            title: "재생",
            icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
            onClick: () => playLesson(r)
          },
          {
            kind: "down",
            title: "다운로드",
            icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/></svg>',
            onClick: () => downloadLesson(r)
          }
        ]
      }),
      i === state.lesSel ? 0 : -1,
      () => {
        state.lesSel = i;
        paintLessons();
      }
    );
    const inner = wrap.firstChild;
    if (inner) item.appendChild(inner);
    item.appendChild(makeDlPanel(row));
    el.appendChild(item);
  });
}

/**
 * 차시 아래 다운로드 진행 줄(문구·X·막대)을 만든다.
 * @param {object} row
 * @returns {HTMLDivElement}
 */
function makeDlPanel(row) {
  const key = lessonKey(row);
  const d = state.downloads[key];
  const box = document.createElement("div");
  box.className = "dl-panel" + (d ? "" : " hidden");
  box.dataset.dlKey = key;
  if (!d) return box;
  const line = document.createElement("div");
  line.className = "dl-line";
  const msg = document.createElement("p");
  msg.className = "dl-msg" + dlMsgClass(d.status);
  msg.textContent = d.msg || (d.status === "done" ? "다운로드 완료" : "받는 중");
  line.appendChild(msg);
  if (d.status === "run") line.appendChild(makeDlCancel(key));
  const track = document.createElement("div");
  track.className = "dl-track";
  const bar = document.createElement("div");
  bar.className = "dl-bar" + (d.status === "done" ? " dl-bar-ok" : "");
  const pct = d.pct >= 0 ? Math.min(100, d.pct) : 15;
  bar.style.width = `${d.status === "run" && d.pct < 0 ? 30 : pct}%`;
  if (d.status === "run" && d.pct < 0) bar.classList.add("dl-bar-ind");
  track.appendChild(bar);
  box.appendChild(line);
  box.appendChild(track);
  return box;
}

/**
 * 다운로드 상태별 문구 색상 클래스를 고른다.
 * @param {string} status - run | done | error | cancel
 * @returns {string}
 */
function dlMsgClass(status) {
  if (status === "done") return " dl-ok";
  if (status === "error") return " dl-err";
  if (status === "cancel") return " dl-stop";
  return "";
}

/**
 * 받는 중 문구 오른쪽 X 버튼을 만든다.
 * @param {string} key - lessonKey
 * @returns {HTMLButtonElement}
 */
function makeDlCancel(key) {
  const x = document.createElement("button");
  x.type = "button";
  x.className = "dl-cancel";
  x.textContent = "X";
  x.title = "다운로드 중지";
  x.addEventListener("click", (ev) => {
    ev.stopPropagation();
    cancelDownload(key);
  });
  return x;
}

/**
 * 진행 중 XHR 을 abort 하고 중지 문구를 남긴다.
 * @param {string} key
 * @returns {void}
 */
function cancelDownload(key) {
  const d = state.downloads[key];
  if (!d || d.status !== "run") return;
  d.status = "cancel";
  if (d.xhr) {
    try {
      d.xhr.abort();
    } catch {
      // abort 실패여도 상태는 중지로 둔다
    }
  }
  updateDl(key, { status: "cancel", pct: 0, msg: "다운로드를 중지했습니다.", xhr: null });
}

/**
 * 다운로드 상태를 갱신하고 이미 그려진 패널만 고친다.
 * @param {string} key
 * @param {object} patch
 * @returns {void}
 */
function updateDl(key, patch) {
  const prev = state.downloads[key] || {};
  state.downloads[key] = { ...prev, ...patch };
  if (patch.xhr === undefined) state.downloads[key].xhr = prev.xhr;
  const d = state.downloads[key];
  const box = document.querySelector(`[data-dl-key="${CSS.escape(key)}"]`);
  if (!box) return;
  box.classList.remove("hidden");
  const msg = box.querySelector(".dl-msg");
  const bar = box.querySelector(".dl-bar");
  const line = box.querySelector(".dl-line");
  if (msg) {
    msg.className = "dl-msg" + dlMsgClass(d.status);
    msg.textContent = d.msg || "";
  }
  let x = box.querySelector(".dl-cancel");
  if (d.status === "run") {
    if (!x && line) line.appendChild(makeDlCancel(key));
  } else if (x) {
    x.remove();
  }
  if (bar) {
    bar.classList.toggle("dl-bar-ok", d.status === "done");
    bar.classList.toggle("dl-bar-ind", d.status === "run" && !(d.pct >= 0));
    if (d.status === "done") bar.style.width = "100%";
    else if (d.status === "cancel") bar.style.width = "0%";
    else if (d.pct >= 0) bar.style.width = `${Math.min(100, d.pct)}%`;
    else bar.style.width = "30%";
  }
}

/**
 * 서원대 e-campus 강의 창을 새 탭으로 연다.
 * @param {{ playUrl?: string, crsCreCd?: string, lessonCntsId?: string }} row
 * @returns {void}
 */
function playLesson(row) {
  const url =
    row.playUrl ||
    `https://ecampus.seowon.ac.kr/lesson/lessonOpen/lessonNewWindow?crsCreCd=${encodeURIComponent(row.crsCreCd || "")}&lessonCntsId=${encodeURIComponent(row.lessonCntsId || "")}`;
  window.open(url, "_blank", "noopener");
}

/**
 * 차시 영상을 XHR 로 병렬 받는다. 진행률은 행 아래 막대에 그린다.
 * @param {object} row
 * @returns {void}
 */
function downloadLesson(row) {
  const key = lessonKey(row);
  const cur = state.downloads[key];
  if (cur && cur.status === "run") return;
  state.downloads[key] = { status: "run", pct: -1, msg: "주소를 찾는 중…", xhr: null };
  paintLessons();

  const xhr = new XMLHttpRequest();
  if (state.downloads[key]) state.downloads[key].xhr = xhr;
  xhr.open("POST", "/api/lesson-download");
  xhr.responseType = "blob";
  xhr.withCredentials = true;
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onprogress = (e) => {
    if (state.downloads[key]?.status === "cancel") return;
    if (e.lengthComputable && e.total > 0) {
      const pct = Math.round((e.loaded / e.total) * 100);
      updateDl(key, { status: "run", pct, msg: `받는 중 ${pct}%` });
    } else {
      const mb = (e.loaded / (1024 * 1024)).toFixed(1);
      updateDl(key, { status: "run", pct: -1, msg: `받는 중 ${mb}MB` });
    }
  };
  xhr.onload = () => {
    if (state.downloads[key]?.status === "cancel") return;
    const type = xhr.getResponseHeader("Content-Type") || "";
    if (xhr.status >= 200 && xhr.status < 300 && !type.includes("application/json")) {
      const blob = xhr.response;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${row.title || "lecture"}.mp4`;
      a.click();
      URL.revokeObjectURL(a.href);
      updateDl(key, { status: "done", pct: 100, msg: "다운로드 완료", xhr: null });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (state.downloads[key]?.status === "cancel") return;
      let msg = "영상을 받지 못했습니다.";
      try {
        const j = JSON.parse(String(reader.result || ""));
        if (j.error) msg = j.error;
      } catch {
        // JSON 오류 본문이 아니면 기본 문구
      }
      updateDl(key, { status: "error", pct: 0, msg, xhr: null });
    };
    reader.readAsText(xhr.response || new Blob());
  };
  xhr.onabort = () => {
    updateDl(key, { status: "cancel", pct: 0, msg: "다운로드를 중지했습니다.", xhr: null });
  };
  xhr.onerror = () => {
    if (state.downloads[key]?.status === "cancel") return;
    updateDl(key, { status: "error", pct: 0, msg: "네트워크 오류로 받지 못했습니다.", xhr: null });
  };
  xhr.send(
    JSON.stringify({
      crsCreCd: row.crsCreCd,
      lessonCntsId: row.lessonCntsId,
      title: row.title || "lecture"
    })
  );
}

/**
 * 선택된 차시 학습률만 조회해 목록에 반영한다.
 * @returns {Promise<void>}
 */
async function showProgress() {
  const row = state.lesRows[state.lesSel];
  if (!row) return;
  const data = await busy("les", "학습률을 조회하는 중", () =>
    api("/api/progress", {
      method: "POST",
      body: JSON.stringify({ crsCreCd: row.crsCreCd, lessonCntsId: row.lessonCntsId })
    })
  );
  row.progressPercent = data.progressPercent;
  paintLessons();
}

/**
 * 과목별 미제출 과제·미완료 이러닝 현황을 그린다.
 * 기간 안 건수는 밝은 글씨로 표시한다.
 * @returns {Promise<void>}
 */
async function loadSummary() {
  const filter = $("sumFilter") ? $("sumFilter").value : "all";
  const data = await busy("sum", "현황을 불러오는 중", () =>
    api(`/api/summary?filter=${encodeURIComponent(filter)}`)
  );
  fillJobList(
    $("sumList"),
    data.rows || [],
    (r) => {
      const due = Number(r.dueAssignments) || 0;
      const pending = Number(r.pendingLessons) || 0;
      return {
        title: r.courseTitle,
        metaParts: [
          { text: r.category === "extracurricular" ? "비교과" : "교과", hot: false },
          { text: `미제출 과제 ${due}`, hot: due > 0 },
          { text: `미완료 이러닝 ${pending}`, hot: pending > 0 }
        ],
        right: r.category === "extracurricular" ? "비교과" : "교과"
      };
    },
    -1,
    () => {}
  );
}

/**
 * 시간표 목록과 HTML 사진을 불러온다. iframe 높이는 postMessage 로 맞춘다.
 * @returns {Promise<void>}
 */
async function loadTimetable() {
  const data = await busy("tt", "시간표를 불러오는 중", () => api("/api/timetable?refresh=1"));
  state.timetable = data.timetable || null;
  const tt = state.timetable;
  if (!tt) {
    $("ttMeta").textContent = "";
    setTtPhoto(null, "시간표가 없습니다.");
    if ($("ttList")) $("ttList").replaceChildren();
    return;
  }
  $("ttMeta").textContent = `${tt.label || "시간표"} · ${tt.courseCount || 0}과목 · ${tt.totalCredits || 0}학점` +
    (tt.conflictCount ? ` · 충돌 ${tt.conflictCount}건` : "");
  const frame = document.createElement("iframe");
  frame.className = "tt-frame";
  frame.title = tt.title || "시간표";
  frame.src = `/api/timetable.html?t=${Date.now()}`;
  const fitFrame = () => {
    try {
      const doc = frame.contentDocument;
      const root = doc && (doc.getElementById("timetable-root") || doc.body);
      if (!root) return;
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h > 0) frame.style.height = `${h}px`;
    } catch {
      // iframe 내부 접근 실패 시 postMessage 높이로 대체
    }
  };
  frame.addEventListener("load", fitFrame);
  if (state.ttMsgHandler) window.removeEventListener("message", state.ttMsgHandler);
  state.ttMsgHandler = (e) => {
    if (e.data?.type !== "tt-size" || e.source !== frame.contentWindow) return;
    if (e.data.h > 0) frame.style.height = `${e.data.h}px`;
  };
  window.addEventListener("message", state.ttMsgHandler);
  setTtPhoto(frame);
  paintTtList();
  if (state.ttTimer) clearInterval(state.ttTimer);
  state.ttTimer = setInterval(paintTtList, 30000);
}

/**
 * SVG 사진 대신 쓸 요일×교시 HTML 격자.
 * @param {object} tt - 시간표 요약
 * @returns {void}
 */
function paintTtGrid(tt) {
  const days = ["월", "화", "수", "목", "금"];
  const dayName = ["일", "월", "화", "수", "목", "금", "토"];
  const map = {};
  let maxP = 10;
  for (const s of tt.subjects || []) {
    for (const sl of s.slots || []) {
      const d = dayName[sl.day];
      if (!days.includes(d)) continue;
      if (sl.period > maxP) maxP = sl.period;
      const k = `${d}:${sl.period}`;
      (map[k] = map[k] || []).push(s);
    }
  }
  const table = document.createElement("table");
  table.className = "tt-grid";
  const head = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = "교시";
  head.appendChild(corner);
  for (const d of days) {
    const th = document.createElement("th");
    th.textContent = d;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (let p = 1; p <= maxP; p++) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = String(p);
    tr.appendChild(th);
    for (const d of days) {
      const td = document.createElement("td");
      const items = map[`${d}:${p}`] || [];
      if (items[0]) {
        const box = document.createElement("div");
        box.className = "tt-cell";
        box.textContent = items[0].subjtNm || "";
        td.appendChild(box);
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  setTtPhoto(table);
}

/**
 * 지금이 해당 과목 수업 중이거나 시작 30분 전인지 본다.
 * @param {{ slots?: { day: number, startMin: number, endMin: number }[] }} s
 * @returns {boolean}
 */
function subjectIsLive(s) {
  const slots = s.slots && s.slots.length ? s.slots : [];
  if (!slots.length) return false;
  const now = new Date();
  const day = now.getDay();
  const min = now.getHours() * 60 + now.getMinutes();
  return slots.some((sl) => sl.day === day && min >= sl.startMin - 30 && min <= sl.endMin);
}

/**
 * 시간표 과목 목록을 사진 위에 그린다. 수업 직전·중이면 깜빡인다.
 * @returns {void}
 */
function paintTtList() {
  const tt = state.timetable;
  if (!tt || !$("ttList")) return;
  fillJobList(
    $("ttList"),
    tt.subjects || [],
    (s) => {
      const live = subjectIsLive(s);
      return {
        title: s.subjtNm,
        meta: [
          s.kind || "",
          s.corseDvclsNo ? `${s.corseDvclsNo}분반` : "",
          s.cmpsjCdt ? `${s.cmpsjCdt}학점` : "",
          s.chrgInstrEmpnm || "",
          s.timtbNm || "",
          live ? "지금 수업" : ""
        ]
          .filter(Boolean)
          .join(" · "),
        right: live ? "지금" : s.kind || "",
        live
      };
    },
    -1,
    () => {}
  );
}

/**
 * 시간표 사진 칸에 그림(또는 안내 문구)을 넣고, 그림이 있으면 확대 버튼을 얹는다.
 * @param {HTMLElement | null} node - iframe 또는 격자
 * @param {string} [emptyText] - 그림이 없을 때 문구
 * @returns {void}
 */
function setTtPhoto(node, emptyText) {
  const wrap = $("ttWrap");
  if (!wrap) return;
  wrap.replaceChildren();
  wrap.classList.toggle("tt-zoomable", Boolean(node));
  if (!node) {
    wrap.textContent = emptyText || "시간표를 조회하세요.";
    return;
  }
  wrap.appendChild(node);
  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "tt-zoom-hit";
  hit.title = "크게 보기";
  hit.addEventListener("click", openTtLightbox);
  wrap.appendChild(hit);
}

/**
 * 시간표 사진을 전체 화면 가까이 확대한다.
 * @returns {void}
 */
function openTtLightbox() {
  const lb = $("ttLb");
  const frame = $("ttLbFrame");
  if (!lb || !frame || !state.timetable) return;
  if (state.ttLbHandler) window.removeEventListener("message", state.ttLbHandler);
  state.ttLbHandler = (e) => {
    if (e.data?.type !== "tt-size" || e.source !== frame.contentWindow) return;
    if (e.data.h > 0) frame.style.height = `${Math.max(320, e.data.h)}px`;
  };
  window.addEventListener("message", state.ttLbHandler);
  frame.src = `/api/timetable.html?t=${Date.now()}`;
  lb.classList.remove("hidden");
  document.body.classList.add("tt-lb-open");
}

/**
 * 시간표 확대를 닫는다.
 * @returns {void}
 */
function closeTtLightbox() {
  const lb = $("ttLb");
  const frame = $("ttLbFrame");
  if (lb) lb.classList.add("hidden");
  if (frame) {
    frame.src = "about:blank";
    frame.style.height = "";
  }
  if (state.ttLbHandler) {
    window.removeEventListener("message", state.ttLbHandler);
    state.ttLbHandler = null;
  }
  document.body.classList.remove("tt-lb-open");
}

/**
 * 시간표 HTML 그림을 파일로 받는다.
 * @returns {void}
 */
function downloadTimetable() {
  const tt = state.timetable;
  if (!tt?.svg) return;
  const a = document.createElement("a");
  a.href = `/api/timetable.html?t=${Date.now()}`;
  a.download = `${tt.title || "시간표"}.html`;
  a.click();
}

/**
 * 과목별 성적 목록을 받아 그린다.
 * @returns {Promise<void>}
 */
async function loadScores() {
  const data = await busy("score", "성적을 불러오는 중", () => api("/api/scores?refresh=1"));
  state.scoreRows = data.rows || [];
  state.scoreSel = -1;
  $("scoreDetail").textContent = "과목을 고르면 항목별 점수를 보여 줍니다.";
  paintScores();
}

/**
 * 성적 카드와 선택 과목의 항목별 점수를 그린다.
 * @returns {void}
 */
function paintScores() {
  fillJobList(
    $("scoreList"),
    state.scoreRows,
    (r) => ({
      title: r.courseTitle,
      meta: r.canView ? "공개" : r.message || "조회 불가",
      right: r.grade || r.total || ""
    }),
    state.scoreSel,
    (i) => {
      state.scoreSel = i;
      paintScores();
      const row = state.scoreRows[i];
      if (!row) return;
      if (!row.canView) {
        $("scoreDetail").textContent = row.message || "이 과목 성적은 아직 볼 수 없습니다.";
        return;
      }
      const lines = (row.items || []).map((it) => `${it.title}: ${it.value}`);
      $("scoreDetail").textContent = lines.join("\n") || "(항목 없음)";
    }
  );
}

/**
 * 서버 스냅샷 캐시를 비우고 다시 조회한다.
 * @returns {Promise<void>}
 */
async function refreshAll() {
  await busy("cfg", "다시 조회하는 중", () => api("/api/refresh", { method: "POST", body: "{}" }));
}

/**
 * 서버 세션을 지우고 화면을 로그인 전으로 돌린다.
 * @returns {Promise<void>}
 */
async function logout() {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } catch {
    // 네트워크 실패여도 화면은 비운다
  }
  resetSessionUi();
}

/**
 * 요소가 있을 때만 이벤트를 붙인다.
 * @param {string} id
 * @param {string} ev
 * @param {EventListener} fn
 * @returns {void}
 */
function on(id, ev, fn) {
  const el = $(id);
  if (el) el.addEventListener(ev, fn);
}

/**
 * 메뉴·버튼 클릭을 한곳에서 연결한다.
 * @returns {void}
 */
function bind() {
  for (const btn of document.querySelectorAll(".nav button")) {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  }
  on("btnLogin", "click", doLogin);
  on("pw", "keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
  on("btnGoAsg", "click", () => showPage("asg"));
  on("btnAgain", "click", logout);
  on("btnAsg", "click", loadAssignments);
  on("btnMat", "click", loadMaterials);
  on("btnLes", "click", loadLessons);
  on("btnProg", "click", showProgress);
  on("btnSum", "click", loadSummary);
  on("btnTt", "click", loadTimetable);
  on("btnTtDl", "click", downloadTimetable);
  on("ttLbClose", "click", closeTtLightbox);
  on("ttLbBg", "click", closeTtLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTtLightbox();
  });
  on("btnScore", "click", loadScores);
  on("btnRefresh", "click", refreshAll);
  on("btnLogout", "click", logout);
  on("btnLogoutSide", "click", logout);
  on("dark", "change", () => applyTheme($("dark").checked));
}

/**
 * 테마·이벤트를 붙이고 기존 세션이 있으면 로그인 완료 화면을 연다.
 * @returns {Promise<void>}
 */
async function boot() {
  applyTheme(localStorage.getItem("seowon-web-dark") === "1");
  bind();
  try {
    const me = await api("/api/me");
    if (me.loggedIn) {
      state.student = me.student;
      chip();
      showLoginOk();
      loadProfile();
    }
  } catch {
    // 세션 조회 실패는 첫 방문과 같다
  }
}

boot();
