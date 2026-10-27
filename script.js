// ===== Supabase 연결 정보 (공개 키만 쓴다) =====
const SUPABASE_URL = "https://akvjqeshtqaxcsxyasjt.supabase.co";
const SUPABASE_KEY = "sb_publishable_hZ8ph-CRf2mkYxkjlndDLw_E908UZX1";

// Supabase 표를 브라우저 fetch로 직접 부른다.
async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = new Error(`Supabase 오류 ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// ===== 브라우저에 저장하는 값 (좋아요용 번호, 누른 카드 목록) =====
function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 저장이 막힌 브라우저면 넘어간다 */ }
}

function getClientId() {
  let id = readStorage("resume_client_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2)}`;
    writeStorage("resume_client_id", id);
  }
  return id;
}

function getLikedIds() {
  try { return new Set(JSON.parse(readStorage("resume_liked") || "[]")); } catch { return new Set(); }
}

function saveLikedIds(ids) {
  writeStorage("resume_liked", JSON.stringify([...ids]));
}

// ===== 작은 도우미 =====
const $ = (id) => document.getElementById(id);

function setText(id, value) {
  $(id).textContent = value || "";
}

// 줄바꿈이나 쉼표로 나눠 목록으로 만든다.
function fillList(id, text, separator) {
  const list = $(id);
  list.replaceChildren();
  (text || "").split(separator).map((s) => s.trim()).filter(Boolean).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  });
}

function showError() {
  $("load-error").hidden = false;
}

// ===== 프로필 =====
async function loadProfile() {
  const rows = await supabase("profile?select=*&id=eq.1");
  const p = rows[0];
  if (!p) return;

  document.title = `${p.name} | ${p.title} 포트폴리오`;
  setText("profile-name", p.name);
  setText("profile-title", p.title);
  setText("contact-name", p.name);
  setText("contact-email", p.email);
  setText("contact-phone", p.phone);
  setText("contact-location", p.location);
  setText("profile-intro", p.intro);
  setText("profile-quote", p.quote);

  const badge = $("profile-career");
  badge.textContent = p.career_badge;
  badge.hidden = !p.career_badge;

  // 사진이 있으면 보여 주고, 없으면 회색 자리 표시를 그대로 둔다.
  const photo = $("profile-photo");
  if (p.photo_url) {
    photo.src = p.photo_url;
    photo.alt = `${p.name} 프로필 사진`;
    photo.hidden = false;
    $("photo-placeholder").hidden = true;
    photo.onerror = () => {
      photo.hidden = true;
      $("photo-placeholder").hidden = false;
    };
  }

  // 한 줄 소개 안의 이름에 파란 밑줄을 그린다.
  const headline = $("profile-headline");
  headline.replaceChildren();
  const at = p.name ? p.headline.indexOf(p.name) : -1;
  if (at >= 0) {
    const mark = document.createElement("span");
    mark.className = "name-mark";
    mark.textContent = p.name;
    headline.append(p.headline.slice(0, at), mark, p.headline.slice(at + p.name.length));
  } else {
    headline.textContent = p.headline;
  }

  fillList("profile-education", p.education, /\n/);
  fillList("profile-skills", p.skills, /[,\n]/);
  fillList("profile-experience", p.experience, /\n/);
}

// ===== 포트폴리오 카드와 좋아요 =====
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.3C1.1 8.3 3.3 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.7 0 5.9 3.8 4.5 7.2C19.5 16.4 12 21 12 21z"/></svg>';

async function loadProjects() {
  const [projects, likes] = await Promise.all([
    supabase("projects?select=*&order=sort_order.asc,id.asc"),
    supabase("likes?select=project_id"),
  ]);

  const counts = {};
  likes.forEach((like) => {
    counts[like.project_id] = (counts[like.project_id] || 0) + 1;
  });

  const list = $("card-list");
  list.replaceChildren();
  $("card-empty").hidden = projects.length > 0;

  const liked = getLikedIds();
  projects.forEach((project) => list.append(makeCard(project, counts[project.id] || 0, liked.has(project.id))));
}

function makeCard(project, likeCount, alreadyLiked) {
  const card = document.createElement("li");
  card.className = "card";

  // 카드 본문 버튼: 누르면 첨부 파일, 없으면 썸네일을 새 탭으로 연다.
  const open = document.createElement("button");
  open.type = "button";
  open.className = "card-open";
  const link = project.file_url || project.thumbnail_url;
  if (link) {
    open.addEventListener("click", () => window.open(link, "_blank", "noopener"));
    open.title = "새 탭에서 열기";
  } else {
    open.disabled = true;
  }

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  thumb.innerHTML = '<div class="thumb-bar"><span></span><span></span><span></span></div>';
  const thumbBody = document.createElement("div");
  thumbBody.className = "thumb-body";
  if (project.thumbnail_url) {
    const img = document.createElement("img");
    img.src = project.thumbnail_url;
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => img.remove();
    thumbBody.append(img);
  }
  thumb.append(thumbBody);

  const text = document.createElement("div");
  text.className = "card-text";

  const meta = document.createElement("span");
  meta.className = "card-meta";
  const no = document.createElement("span");
  no.className = "card-no";
  no.textContent = project.number;
  meta.append(no, project.category);

  const title = document.createElement("strong");
  title.className = "card-title";
  title.textContent = project.title;

  const desc = document.createElement("span");
  desc.className = "card-desc";
  desc.textContent = project.description;

  const tags = document.createElement("ul");
  tags.className = "card-tags";
  (project.tags || []).forEach((tag) => {
    const li = document.createElement("li");
    li.textContent = tag;
    tags.append(li);
  });

  text.append(meta, title, desc, tags);
  open.append(thumb, text);

  // 좋아요 버튼과 숫자
  const likeRow = document.createElement("div");
  likeRow.className = "card-like";
  const likeButton = document.createElement("button");
  likeButton.type = "button";
  likeButton.className = "like-button";
  likeButton.innerHTML = HEART;
  const count = document.createElement("span");
  count.className = "like-count";
  count.textContent = likeCount;

  const markLiked = () => {
    likeButton.classList.add("liked");
    likeButton.setAttribute("aria-pressed", "true");
    likeButton.setAttribute("aria-label", "좋아요를 눌렀어요");
  };
  likeButton.setAttribute("aria-pressed", "false");
  likeButton.setAttribute("aria-label", `${project.title} 좋아요`);
  if (alreadyLiked) markLiked();

  likeButton.addEventListener("click", async () => {
    if (likeButton.classList.contains("liked") || likeButton.disabled) return;
    likeButton.disabled = true;
    try {
      await supabase("likes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ project_id: project.id, client_id: getClientId() }),
      });
      count.textContent = Number(count.textContent) + 1;
      markLiked();
    } catch (error) {
      // 409: 이 브라우저가 이미 누른 카드 (다른 탭 등에서). 숫자는 그대로 두고 눌린 상태로 표시.
      if (error.status === 409) markLiked();
      else alert("좋아요를 저장하지 못했어요. 잠시 후 다시 눌러 주세요.");
    }
    if (likeButton.classList.contains("liked")) {
      const liked = getLikedIds();
      liked.add(project.id);
      saveLikedIds(liked);
    }
    likeButton.disabled = false;
  });

  likeRow.append(likeButton, count);
  card.append(open, likeRow);
  return card;
}

// ===== 방명록 =====
function makeGuestItem(entry) {
  const li = document.createElement("li");
  li.className = "guest-item";

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

  li.append(head, message);
  return li;
}

async function loadGuestbook() {
  const entries = await supabase("resume_guestbook?select=*&order=created_at.desc");
  const list = $("guest-list");
  list.replaceChildren(...entries.map(makeGuestItem));
  $("guest-empty").hidden = entries.length > 0;
}

function setGuestStatus(message, isError) {
  const status = $("guest-status");
  status.textContent = message;
  status.classList.toggle("error", Boolean(isError));
}

async function submitGuestbook() {
  const nickname = $("guest-nickname").value.trim();
  const message = $("guest-message").value.trim();
  if (!nickname || !message) {
    setGuestStatus("별명과 한마디를 모두 적어 주세요.", true);
    return;
  }

  const button = $("guest-submit");
  button.disabled = true;
  setGuestStatus("남기는 중…");
  try {
    const rows = await supabase("resume_guestbook", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ nickname, message }),
    });
    $("guest-list").prepend(makeGuestItem(rows[0]));
    $("guest-empty").hidden = true;
    $("guest-nickname").value = "";
    $("guest-message").value = "";
    setGuestStatus("남겼어요. 고마워요!");
  } catch {
    setGuestStatus("저장하지 못했어요. 잠시 후 다시 눌러 주세요.", true);
  }
  button.disabled = false;
}

$("guest-submit").addEventListener("click", submitGuestbook);
// 별명 칸에서 Enter를 눌러도 페이지가 새로고침되지 않고 남기기가 되게 한다.
$("guest-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitGuestbook();
});

// ===== 시작 =====
loadProfile().catch(showError);
loadProjects().catch(showError);
loadGuestbook().catch(showError);
