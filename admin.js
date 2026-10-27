// ===== Supabase 연결 정보 (공개 키만 쓴다) =====
const SUPABASE_URL = "https://akvjqeshtqaxcsxyasjt.supabase.co";
const SUPABASE_KEY = "sb_publishable_hZ8ph-CRf2mkYxkjlndDLw_E908UZX1";
const BUCKET = "resume";
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const FILE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

const $ = (id) => document.getElementById(id);

// ===== 로그인 정보 보관 (새로고침해도 로그인이 유지되게) =====
let session = null;

function loadSession() {
  try { session = JSON.parse(localStorage.getItem("resume_admin_session")); } catch { session = null; }
}

function saveSession(data) {
  session = data
    ? {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
        email: data.user ? data.user.email : session && session.email,
      }
    : null;
  try {
    if (session) localStorage.setItem("resume_admin_session", JSON.stringify(session));
    else localStorage.removeItem("resume_admin_session");
  } catch { /* 저장이 막힌 브라우저면 이번 탭에서만 로그인 유지 */ }
}

// ===== Supabase Auth (fetch로 직접) =====
async function authRequest(path, body, token) {
  const headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error((data && (data.error_description || data.msg || data.message)) || "로그인 오류");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function login(email, password) {
  saveSession(await authRequest("token?grant_type=password", { email, password }));
}

async function refreshSession() {
  if (!session || !session.refresh_token) throw new Error("다시 로그인해 주세요.");
  saveSession(await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token }));
}

async function logout() {
  if (session) {
    try { await authRequest("logout", null, session.access_token); } catch { /* 이미 만료됐으면 넘어간다 */ }
  }
  saveSession(null);
  showView("login");
}

// 받은 토큰을 붙여 요청한다. 토큰이 곧 만료되면 먼저 새로 받는다.
async function authorizedFetch(url, options = {}) {
  if (!session) throw new Error("다시 로그인해 주세요.");
  if (Date.now() > session.expires_at - 60 * 1000) await refreshSession();

  const send = () => fetch(url, {
    ...options,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, ...options.headers },
  });
  let response = await send();
  if (response.status === 401) {
    await refreshSession();
    response = await send();
  }
  if (!response.ok) {
    let detail = "";
    try { const data = await response.json(); detail = data.message || data.error || ""; } catch { /* 내용 없음 */ }
    const error = new Error(detail || `오류 ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

// 데이터베이스 표 요청. 결과 줄들을 돌려준다.
async function db(path, options = {}) {
  const response = await authorizedFetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Prefer: "return=representation", ...options.headers },
  });
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

// 고치기·지우기는 실제로 바뀐 줄이 있어야 성공이다 (규칙에 막히면 0줄이 바뀐다).
function mustChange(rows) {
  if (!rows || rows.length === 0) throw new Error("바뀐 내용이 없어요. 관리자 권한을 확인해 주세요.");
  return rows;
}

// ===== 보관함(Storage) =====
function checkFile(file, imagesOnly) {
  const ext = FILE_TYPES[file.type];
  if (!ext || (imagesOnly && ext === "pdf")) {
    return imagesOnly ? "이미지 파일(PNG·JPG·WEBP·GIF)만 올릴 수 있어요." : "이미지(PNG·JPG·WEBP·GIF)나 PDF만 올릴 수 있어요.";
  }
  if (file.size > MAX_SIZE) return "10MB보다 큰 파일은 올릴 수 없어요.";
  return "";
}

// 파일 이름은 영어·숫자로 새로 짓는다. 예: projects/20261027-0251-k3x9a2.pdf
function newFileName(folder, file) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const random = Math.random().toString(36).slice(2, 8);
  return `${folder}/${stamp}-${random}.${FILE_TYPES[file.type]}`;
}

async function uploadFile(folder, file) {
  const path = newFileName(folder, file);
  await authorizedFetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { "Content-Type": file.type, "x-upsert": "false" },
    body: file,
  });
  return PUBLIC_PREFIX + path;
}

// 우리 보관함에 있는 파일이면 지운다. 실패해도 화면 작업은 계속한다.
async function removeStoredFile(url) {
  if (!url || !url.startsWith(PUBLIC_PREFIX)) return;
  const path = url.slice(PUBLIC_PREFIX.length);
  try {
    await authorizedFetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { method: "DELETE" });
  } catch { /* 이미 없는 파일 등 */ }
}

// ===== 화면 전환 =====
function showView(name) {
  $("login-view").hidden = name !== "login";
  $("denied-view").hidden = name !== "denied";
  $("admin-view").hidden = name !== "admin";
}

function setMessage(id, text, kind) {
  const el = $(id);
  el.textContent = text || "";
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("error", kind === "error");
}

async function start() {
  loadSession();
  if (!session) {
    showView("login");
    return;
  }
  try {
    const rows = await db("admins?select=user_id");
    if (rows.length === 0) {
      showView("denied");
      return;
    }
  } catch {
    saveSession(null);
    showView("login");
    setMessage("login-message", "로그인이 끝났어요. 다시 로그인해 주세요.", "error");
    return;
  }
  $("admin-email").textContent = session.email || "";
  showView("admin");
  loadProfile();
  loadProjects();
  loadGuestbook();
}

async function handleLogin() {
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) {
    setMessage("login-message", "이메일과 비밀번호를 적어 주세요.", "error");
    return;
  }
  const button = $("login-button");
  button.disabled = true;
  setMessage("login-message", "로그인 중…");
  try {
    await login(email, password);
    $("login-password").value = "";
    setMessage("login-message", "");
    await start();
  } catch (error) {
    setMessage("login-message", error.status === 400 ? "이메일이나 비밀번호가 맞지 않아요." : "로그인하지 못했어요. 잠시 후 다시 해 주세요.", "error");
  }
  button.disabled = false;
}

$("login-button").addEventListener("click", handleLogin);
$("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  handleLogin();
});
$("logout-button").addEventListener("click", logout);
$("denied-logout").addEventListener("click", logout);

// ===== 프로필 =====
const PROFILE_FIELDS = ["name", "title", "career_badge", "email", "phone", "location", "headline", "intro", "education", "skills", "experience", "quote"];
let profilePhotoUrl = null;

function showPhoto(url) {
  profilePhotoUrl = url || null;
  $("photo-preview").hidden = !url;
  $("photo-empty").hidden = Boolean(url);
  $("photo-remove").hidden = !url;
  if (url) $("photo-preview").src = url;
}

async function loadProfile() {
  try {
    const rows = await db("profile?select=*&id=eq.1");
    const p = rows[0] || {};
    const form = $("profile-form");
    PROFILE_FIELDS.forEach((key) => { form.elements[key].value = p[key] || ""; });
    showPhoto(p.photo_url);
  } catch (error) {
    setMessage("profile-message", `프로필을 불러오지 못했어요. (${error.message})`, "error");
  }
}

async function saveProfile(extra) {
  const form = $("profile-form");
  const data = { id: 1, updated_at: new Date().toISOString(), photo_url: profilePhotoUrl, ...extra };
  PROFILE_FIELDS.forEach((key) => { data[key] = form.elements[key].value.trim(); });
  // 한 줄뿐인 프로필을 덮어쓴다 (없으면 새로 만든다).
  return mustChange(await db("profile?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(data),
  }));
}

$("profile-save").addEventListener("click", async () => {
  const button = $("profile-save");
  button.disabled = true;
  setMessage("profile-message", "저장 중…");
  try {
    await saveProfile();
    setMessage("profile-message", "저장했어요. 방문자 화면에 바로 보여요.", "ok");
  } catch (error) {
    setMessage("profile-message", `저장하지 못했어요. (${error.message})`, "error");
  }
  button.disabled = false;
});

$("photo-file").addEventListener("change", async () => {
  const input = $("photo-file");
  const file = input.files[0];
  if (!file) return;
  const problem = checkFile(file, true);
  if (problem) {
    setMessage("photo-message", problem, "error");
    input.value = "";
    return;
  }
  setMessage("photo-message", "올리는 중…");
  const oldUrl = profilePhotoUrl;
  try {
    const url = await uploadFile("profile", file);
    await saveProfile({ photo_url: url });
    showPhoto(url);
    removeStoredFile(oldUrl);
    setMessage("photo-message", "사진을 바꿨어요. (다른 칸에 고친 글이 있었다면 함께 저장됐어요)", "ok");
  } catch (error) {
    setMessage("photo-message", `사진을 올리지 못했어요. (${error.message})`, "error");
  }
  input.value = "";
});

$("photo-remove").addEventListener("click", async () => {
  if (!confirm("프로필 사진을 뺄까요? 방문자 화면에는 회색 자리가 보여요.")) return;
  const oldUrl = profilePhotoUrl;
  try {
    await saveProfile({ photo_url: null });
    showPhoto(null);
    removeStoredFile(oldUrl);
    setMessage("photo-message", "사진을 뺐어요.", "ok");
  } catch (error) {
    setMessage("photo-message", `사진을 빼지 못했어요. (${error.message})`, "error");
  }
});

// ===== 포트폴리오 카드 =====
let projects = [];
let likeCounts = {};
let editing = null; // 고치는 중인 카드 (새 카드면 빈 객체)
let editorFiles = { thumbnail_url: null, file_url: null }; // 편집창에서 지금 쓰는 파일 주소

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.3C1.1 8.3 3.3 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.7 0 5.9 3.8 4.5 7.2C19.5 16.4 12 21 12 21z"/></svg>';

async function loadProjects() {
  try {
    const [rows, likes] = await Promise.all([
      db("projects?select=*&order=sort_order.asc,id.asc"),
      db("likes?select=project_id"),
    ]);
    projects = rows;
    likeCounts = {};
    likes.forEach((like) => { likeCounts[like.project_id] = (likeCounts[like.project_id] || 0) + 1; });
    renderProjects();
  } catch (error) {
    setMessage("projects-status", `카드를 불러오지 못했어요. (${error.message})`, "error");
  }
}

function smallButton(label, onClick, extraClass) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn btn-small ${extraClass || ""}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderProjects() {
  const list = $("admin-card-list");
  list.replaceChildren();
  setMessage("projects-status", projects.length ? "" : "아직 카드가 없어요. ‘+ 카드 추가’를 눌러 보세요.");

  projects.forEach((project, index) => {
    const li = document.createElement("li");
    li.className = "admin-card";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.innerHTML = '<div class="thumb-bar"><span></span><span></span><span></span></div>';
    const body = document.createElement("div");
    body.className = "thumb-body";
    if (project.thumbnail_url) {
      const img = document.createElement("img");
      img.src = project.thumbnail_url;
      img.alt = "";
      body.append(img);
    }
    thumb.append(body);

    const info = document.createElement("div");
    info.className = "admin-card-info";
    const meta = document.createElement("span");
    meta.className = "card-meta";
    meta.textContent = `${project.number} ${project.category}`;
    const title = document.createElement("strong");
    title.className = "card-title";
    title.textContent = project.title;
    const desc = document.createElement("span");
    desc.className = "card-desc";
    desc.textContent = project.description;
    const sub = document.createElement("span");
    sub.className = "admin-card-sub";
    sub.textContent = `순서 ${project.sort_order} · 태그 ${(project.tags || []).join(", ") || "없음"} · 첨부 ${project.file_url ? "있음" : "없음"}`;
    const like = document.createElement("span");
    like.className = "like-line";
    like.innerHTML = HEART;
    like.append(` 좋아요 ${likeCounts[project.id] || 0}`);
    info.append(meta, title, desc, sub, like);

    const buttons = document.createElement("div");
    buttons.className = "admin-card-buttons";
    const up = smallButton("▲ 위로", () => moveProject(index, -1));
    up.disabled = index === 0;
    const down = smallButton("▼ 아래로", () => moveProject(index, 1));
    down.disabled = index === projects.length - 1;
    const reset = smallButton("좋아요 초기화", () => resetLikes(project));
    reset.disabled = !likeCounts[project.id];
    buttons.append(
      up,
      down,
      smallButton("수정", () => openEditor(project)),
      smallButton("삭제", () => deleteProject(project), "btn-danger"),
      reset,
    );

    li.append(thumb, info, buttons);
    list.append(li);
  });
}

// 편집창에 지금 쓰는 파일을 보여 주고 "빼기" 버튼을 단다.
function renderFileNow(key, boxId) {
  const box = $(boxId);
  box.replaceChildren();
  const url = editorFiles[key];
  if (!url) {
    box.textContent = "지금: 없음";
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "지금 파일 보기";
  box.append(link, smallButton("빼기", () => {
    editorFiles[key] = null;
    renderFileNow(key, boxId);
  }, "btn-danger"));
}

function openEditor(project) {
  editing = project || {};
  const isNew = !project;
  $("editor-title").textContent = isNew ? "카드 추가" : "카드 수정";
  $("p-number").value = isNew ? String(projects.length + 1).padStart(2, "0") : project.number;
  $("p-category").value = isNew ? "" : project.category;
  $("p-title").value = isNew ? "" : project.title;
  $("p-description").value = isNew ? "" : project.description;
  $("p-tags").value = isNew ? "" : (project.tags || []).join(", ");
  const maxOrder = projects.reduce((max, p) => Math.max(max, p.sort_order), 0);
  $("p-order").value = isNew ? maxOrder + 1 : project.sort_order;
  $("p-thumb-file").value = "";
  $("p-file-file").value = "";
  editorFiles = { thumbnail_url: isNew ? null : project.thumbnail_url, file_url: isNew ? null : project.file_url };
  renderFileNow("thumbnail_url", "p-thumb-now");
  renderFileNow("file_url", "p-file-now");
  setMessage("project-message", "");
  $("project-editor").hidden = false;
  $("project-editor").scrollIntoView({ behavior: "smooth", block: "start" });
  $("p-title").focus({ preventScroll: true });
}

function closeEditor() {
  editing = null;
  $("project-editor").hidden = true;
}

$("project-add").addEventListener("click", () => openEditor(null));
$("project-cancel").addEventListener("click", closeEditor);
$("project-editor").addEventListener("submit", (event) => event.preventDefault());

$("project-save").addEventListener("click", async () => {
  const title = $("p-title").value.trim();
  if (!title) {
    setMessage("project-message", "제목을 적어 주세요.", "error");
    return;
  }
  const thumbFile = $("p-thumb-file").files[0];
  const attachFile = $("p-file-file").files[0];
  const problem = (thumbFile && checkFile(thumbFile, true)) || (attachFile && checkFile(attachFile, false));
  if (problem) {
    setMessage("project-message", problem, "error");
    return;
  }

  const button = $("project-save");
  button.disabled = true;
  setMessage("project-message", thumbFile || attachFile ? "파일 올리는 중…" : "저장 중…");
  const uploaded = [];
  try {
    const data = {
      number: $("p-number").value.trim(),
      category: $("p-category").value.trim(),
      title,
      description: $("p-description").value.trim(),
      tags: $("p-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
      sort_order: Number.parseInt($("p-order").value, 10) || 0,
      thumbnail_url: editorFiles.thumbnail_url,
      file_url: editorFiles.file_url,
    };
    if (thumbFile) uploaded.push((data.thumbnail_url = await uploadFile("projects", thumbFile)));
    if (attachFile) uploaded.push((data.file_url = await uploadFile("projects", attachFile)));

    if (editing.id) {
      mustChange(await db(`projects?id=eq.${editing.id}`, { method: "PATCH", body: JSON.stringify(data) }));
      // 바뀌었거나 뺀 예전 파일은 보관함에서 지운다.
      ["thumbnail_url", "file_url"].forEach((key) => {
        if (editing[key] && editing[key] !== data[key]) removeStoredFile(editing[key]);
      });
    } else {
      mustChange(await db("projects", { method: "POST", body: JSON.stringify(data) }));
    }
    closeEditor();
    setMessage("projects-status", "저장했어요. 방문자 화면에 바로 보여요.", "ok");
    await loadProjects();
  } catch (error) {
    uploaded.forEach(removeStoredFile); // 저장이 안 됐으면 방금 올린 파일도 치운다.
    setMessage("project-message", `저장하지 못했어요. (${error.message})`, "error");
  }
  button.disabled = false;
});

async function deleteProject(project) {
  if (!confirm(`‘${project.title}’ 카드를 지울까요?\n좋아요 기록과 올린 파일도 함께 지워지고, 되돌릴 수 없어요.`)) return;
  try {
    mustChange(await db(`projects?id=eq.${project.id}`, { method: "DELETE" }));
    removeStoredFile(project.thumbnail_url);
    removeStoredFile(project.file_url);
    if (editing && editing.id === project.id) closeEditor();
    setMessage("projects-status", "카드를 지웠어요.", "ok");
    await loadProjects();
  } catch (error) {
    setMessage("projects-status", `지우지 못했어요. (${error.message})`, "error");
  }
}

// 순서 바꾸기: 자리를 바꾼 뒤 1, 2, 3… 으로 다시 매긴다.
async function moveProject(index, step) {
  const target = index + step;
  if (target < 0 || target >= projects.length) return;
  const ordered = [...projects];
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  setMessage("projects-status", "순서 바꾸는 중…");
  try {
    for (let i = 0; i < ordered.length; i += 1) {
      if (ordered[i].sort_order !== i + 1) {
        mustChange(await db(`projects?id=eq.${ordered[i].id}`, { method: "PATCH", body: JSON.stringify({ sort_order: i + 1 }) }));
      }
    }
    setMessage("projects-status", "순서를 바꿨어요.", "ok");
  } catch (error) {
    setMessage("projects-status", `순서를 바꾸지 못했어요. (${error.message})`, "error");
  }
  await loadProjects();
}

async function resetLikes(project) {
  const count = likeCounts[project.id] || 0;
  if (!confirm(`‘${project.title}’ 카드의 좋아요 ${count}개를 모두 지울까요? 되돌릴 수 없어요.`)) return;
  try {
    mustChange(await db(`likes?project_id=eq.${project.id}`, { method: "DELETE" }));
    setMessage("projects-status", "좋아요를 초기화했어요.", "ok");
  } catch (error) {
    setMessage("projects-status", `초기화하지 못했어요. (${error.message})`, "error");
  }
  await loadProjects();
}

// ===== 방명록 =====
async function loadGuestbook() {
  try {
    const entries = await db("resume_guestbook?select=*&order=created_at.desc");
    const list = $("admin-guest-list");
    list.replaceChildren();
    setMessage("guest-admin-status", entries.length ? `글 ${entries.length}개` : "아직 남겨진 글이 없어요.");

    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "guest-item";
      const body = document.createElement("div");
      body.className = "guest-body";
      const head = document.createElement("div");
      head.className = "guest-head";
      const nick = document.createElement("strong");
      nick.className = "guest-nick";
      nick.textContent = entry.nickname;
      const date = document.createElement("span");
      date.className = "guest-date";
      date.textContent = new Date(entry.created_at).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
      head.append(nick, date);
      const message = document.createElement("p");
      message.className = "guest-message";
      message.textContent = entry.message;
      body.append(head, message);

      li.append(body, smallButton("삭제", () => deleteGuest(entry), "btn-danger"));
      list.append(li);
    });
  } catch (error) {
    setMessage("guest-admin-status", `방명록을 불러오지 못했어요. (${error.message})`, "error");
  }
}

async function deleteGuest(entry) {
  if (!confirm(`‘${entry.nickname}’님의 글을 지울까요? 되돌릴 수 없어요.`)) return;
  try {
    mustChange(await db(`resume_guestbook?id=eq.${entry.id}`, { method: "DELETE" }));
    await loadGuestbook();
  } catch (error) {
    setMessage("guest-admin-status", `지우지 못했어요. (${error.message})`, "error");
  }
}

// ===== 시작 =====
start();
