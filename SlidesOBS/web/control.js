// Control page (regia).
import { loadDoc, renderPage, isCancel, connectEvents, backgroundColor, reportPages } from "/static/pdfcommon.js";

const $ = (s) => document.querySelector(s);
const el = {
  conn: $("#conn"), docName: $("#docName"), counter: $("#counter"),
  pvAir: $("#pvAir"), pvNext: $("#pvNext"), pvAirNum: $("#pvAirNum"), pvNextNum: $("#pvNextNum"),
  thumbs: $("#thumbs"), docs: $("#docs"), docsDir: $("#docsDir"), drop: $("#drop"), file: $("#fileInput"),
  blackBtn: $("#blackBtn"), gotoForm: $("#gotoForm"), gotoInput: $("#gotoInput"),
  outUrl: $("#outUrl"), copyBtn: $("#copyBtn"), toast: $("#toast"), settings: $("#settings"),
  color: $("#colorInput"), marginRange: $("#marginRange"), marginNum: $("#marginNum"), marginOut: $("#marginOut"),
};

let st = null;
let pdf = null, pdfKey = "", numPages = 0;
let docsRev = -1;

// ---- helpers --------------------------------------------------------------

let toastTimer = null;
function toast(msg, isErr) {
  el.toast.textContent = msg;
  el.toast.classList.toggle("err", !!isErr);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), isErr ? 6000 : 2500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { method: "POST", ...opts });
  let body = null;
  try { body = await res.json(); } catch (_) { /* empty */ }
  if (!res.ok) throw new Error((body && body.error) || "Errore " + res.status);
  return body;
}

async function cmd(path) {
  try {
    const s = await api(path);
    if (s && s.app) applyState(s);
  } catch (e) {
    toast(e.message, true);
  }
}

function fmtSize(n) {
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " KB";
  return (n / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
}

// ---- state ----------------------------------------------------------------

function applyState(next) {
  if (st && next.rev < st.rev) return; // stale response
  const prev = st;
  st = next;
  const docChanged = !prev || prev.doc !== st.doc || prev.docVersion !== st.docVersion;

  el.docName.textContent = st.doc || "Nessun documento";
  el.docName.title = st.doc || "";
  const total = st.pages || numPages || 0;
  el.counter.textContent = st.doc ? `${st.page} / ${total || "?"}` : "– / –";
  el.gotoInput.max = total || "";
  el.blackBtn.classList.toggle("on", st.black);
  el.blackBtn.textContent = st.black ? "Nero attivo" : "Schermo nero";
  el.blackBtn.setAttribute("aria-pressed", st.black ? "true" : "false");
  for (const b of document.querySelectorAll(".nav .btn")) b.disabled = !st.doc;

  syncSettings(st.settings);

  if (st.docsRev !== docsRev) { docsRev = st.docsRev; refreshDocs(); }
  else markCurrentDoc();

  if (docChanged) openPdf();
  else updateLive(prev);
}

async function openPdf() {
  const key = st.doc ? st.doc + "|" + st.docVersion : "";
  if (key === pdfKey) return;
  pdfKey = key;
  pdf = null;
  numPages = 0;
  buildThumbs();
  if (!st.doc) { updateLive(null); return; }
  try {
    const d = await loadDoc(st.doc, st.docVersion);
    if (pdfKey !== key) return;
    pdf = d;
    numPages = d.numPages;
    reportPages(st, numPages);
    buildThumbs();
    el.counter.textContent = `${st.page} / ${st.pages || numPages}`;
    updateLive(null);
  } catch (e) {
    if (pdfKey !== key) return;
    toast("Impossibile aprire il PDF: " + (e && e.message), true);
  }
}

// ---- previews -------------------------------------------------------------

const pvTasks = new Map();
async function renderPreview(box, pageNum, fit) {
  const prevTask = pvTasks.get(box);
  if (prevTask) prevTask.cancel();
  pvTasks.delete(box);
  const canvas = box.querySelector("canvas");
  const empty = !pdf || !pageNum || pageNum > numPages;
  box.classList.toggle("is-empty", empty);
  if (empty) return;
  const page = await pdf.getPage(pageNum);
  const bw = box.clientWidth, bh = box.clientHeight;
  if (!bw || !bh) return;
  const off = document.createElement("canvas");
  const r = renderPage(page, off, bw, bh, fit, window.devicePixelRatio || 1);
  pvTasks.set(box, r);
  try {
    await r.promise;
  } catch (e) {
    if (!isCancel(e)) console.warn(e);
    return;
  }
  if (pvTasks.get(box) !== r) return;
  pvTasks.delete(box);
  canvas.width = off.width;
  canvas.height = off.height;
  canvas.getContext("2d").drawImage(off, 0, 0);
  Object.assign(canvas.style, { left: r.rect.left + "px", top: r.rect.top + "px", width: r.rect.width + "px", height: r.rect.height + "px" });
}

let lastPreviewKey = "";
function updateLive(prev, force) {
  const total = st.pages || numPages;
  const s = st.settings || {};
  // Previews mirror the output background and fit.
  for (const box of [el.pvAir, el.pvNext]) {
    const bg = backgroundColor(s);
    box.classList.toggle("checker", bg === "transparent");
    box.style.backgroundColor = bg === "transparent" ? "" : bg;
  }
  el.pvAir.classList.toggle("is-black", !!st.black);
  el.pvAir.querySelector(".pv-mask").classList.toggle("hide", s.blackMode === "hide");
  el.pvAir.querySelector(".pv-mask").textContent = s.blackMode === "hide" ? "NASCOSTA" : "NERO";
  el.pvAirNum.textContent = st.doc && total ? `${st.page} / ${total}` : "";
  const nextNum = st.page < total ? st.page + 1 : 0;
  el.pvNextNum.textContent = nextNum ? `${nextNum} / ${total}` : st.doc ? "ultima slide" : "";

  const key = [pdfKey, numPages, st.page, s.fit, el.pvAir.clientWidth, el.pvNext.clientWidth].join("|");
  if (key !== lastPreviewKey || force) {
    lastPreviewKey = key;
    renderPreview(el.pvAir, pdf ? st.page : 0, s.fit);
    renderPreview(el.pvNext, pdf ? nextNum : 0, s.fit);
  }
  markThumbs();
}

// ---- thumbnails -----------------------------------------------------------

let thumbObserver = null;
function buildThumbs() {
  if (thumbObserver) thumbObserver.disconnect();
  el.thumbs.textContent = "";
  if (!pdf) return;
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= numPages; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "thumb";
    b.dataset.page = i;
    b.title = "Vai alla slide " + i;
    b.innerHTML = `<span class="tb"><canvas></canvas></span><span class="n">${i}</span>`;
    frag.appendChild(b);
  }
  el.thumbs.appendChild(frag);
  const myPdf = pdf;
  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      thumbObserver.unobserve(en.target);
      renderThumb(myPdf, en.target);
    }
  }, { root: el.thumbs, rootMargin: "300px" });
  for (const b of el.thumbs.children) thumbObserver.observe(b);
  markThumbs(true);
}

const thumbQueue = [];
let thumbBusy = false;
function renderThumb(doc, btn) {
  thumbQueue.push([doc, btn]);
  if (thumbBusy) return;
  thumbBusy = true;
  (async () => {
    while (thumbQueue.length) {
      const [d, b] = thumbQueue.shift();
      if (d !== pdf) continue;
      try {
        const page = await d.getPage(+b.dataset.page);
        const box = b.querySelector(".tb");
        const canvas = b.querySelector("canvas");
        const bw = box.clientWidth || 128, bh = box.clientHeight || 72;
        const r = renderPage(page, canvas, bw, bh, "contain", Math.min(2, window.devicePixelRatio || 1));
        canvas.style.width = r.rect.width + "px";
        canvas.style.height = r.rect.height + "px";
        await r.promise;
      } catch (e) {
        if (!isCancel(e)) console.warn(e);
      }
    }
    thumbBusy = false;
  })();
}

let lastMarked = 0;
function markThumbs(forceScroll) {
  if (!st) return;
  const total = st.pages || numPages;
  for (const b of el.thumbs.querySelectorAll(".thumb.cur, .thumb.next")) b.classList.remove("cur", "next");
  const cur = el.thumbs.querySelector(`.thumb[data-page="${st.page}"]`);
  const nxt = st.page < total ? el.thumbs.querySelector(`.thumb[data-page="${st.page + 1}"]`) : null;
  if (cur) cur.classList.add("cur");
  if (nxt) nxt.classList.add("next");
  if (cur && (forceScroll || lastMarked !== st.page)) {
    const c = el.thumbs;
    const top = cur.offsetTop - c.clientHeight / 2 + cur.offsetHeight / 2;
    c.scrollTo({ top: Math.max(0, top), behavior: forceScroll ? "auto" : "smooth" });
  }
  lastMarked = st.page;
}

el.thumbs.addEventListener("click", (e) => {
  const b = e.target.closest(".thumb");
  if (!b) return;
  b.blur();
  cmd("/api/goto?p=" + b.dataset.page);
});

// ---- documents ------------------------------------------------------------

async function refreshDocs() {
  try {
    const res = await fetch("/api/list", { cache: "no-store" });
    const data = await res.json();
    renderDocs(data.docs || []);
    el.docsDir.textContent = data.dir ? "Cartella: " + data.dir : "";
  } catch (_) { /* offline */ }
}

function renderDocs(docs) {
  el.docs.textContent = "";
  for (const d of docs) {
    const li = document.createElement("li");
    li.dataset.name = d.name;
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = d.name;
    name.title = d.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = (d.pages ? d.pages + (d.pages === 1 ? " pagina · " : " pagine · ") : "") + fmtSize(d.size);
    info.append(name, meta);

    const live = document.createElement("span");
    live.className = "live-tag";
    live.textContent = "IN ONDA";
    const open = document.createElement("button");
    open.className = "btn small";
    open.textContent = "Apri";
    open.addEventListener("click", () => cmd("/api/open?name=" + encodeURIComponent(d.name)));
    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Elimina";
    let armed = null;
    del.addEventListener("click", () => {
      if (!armed) {
        del.textContent = "Conferma";
        armed = setTimeout(() => { armed = null; del.textContent = "Elimina"; }, 3000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      cmd("/api/delete?name=" + encodeURIComponent(d.name));
    });
    li.append(info, live, open, del);
    el.docs.appendChild(li);
  }
  markCurrentDoc();
}

function markCurrentDoc() {
  for (const li of el.docs.children) {
    const cur = st && li.dataset.name === st.doc;
    li.classList.toggle("cur", cur);
    li.querySelector(".live-tag").hidden = !cur;
    li.querySelector(".btn:not(.danger)").hidden = cur;
  }
}

// ---- upload ---------------------------------------------------------------

const progress = el.drop.querySelector(".drop-progress");
const dropMain = el.drop.querySelector(".drop-main");
function uploadOne(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = Math.round((e.loaded / e.total) * 100);
      progress.querySelector(".bar").style.setProperty("--p", p + "%");
      progress.querySelector(".ptext").textContent = `${file.name} — ${p}%`;
    };
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch (_) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error((body && body.error) || "Errore " + xhr.status));
    };
    xhr.onerror = () => reject(new Error("Connessione persa durante il caricamento"));
    xhr.send(file);
  });
}

const EXPORT_MSG = "Esporta la presentazione in PDF (File > Esporta > PDF)";
async function checkPdf(file) {
  if (/\.(pptx?|ppsx?|key|odp|otp)$/i.test(file.name)) return EXPORT_MSG;
  if (!/\.pdf$/i.test(file.name)) return "Sono accettati solo file PDF. " + EXPORT_MSG;
  const head = new TextDecoder("latin1").decode(await file.slice(0, 1024).arrayBuffer());
  return head.includes("%PDF-") ? null : "Il file non è un PDF valido.";
}

async function uploadFiles(files) {
  files = [...files];
  if (!files.length) return;
  dropMain.hidden = true;
  progress.hidden = false;
  for (const f of files) {
    progress.querySelector(".bar").style.setProperty("--p", "0%");
    progress.querySelector(".ptext").textContent = f.name;
    try {
      const bad = await checkPdf(f);
      if (bad) throw new Error(bad);
      const r = await uploadOne(f);
      toast(r && r.opened ? `“${r.name}” caricato e aperto` : `“${r.name}” caricato. Premi Apri per mandarlo in onda.`);
      if (r && r.state) applyState(r.state);
    } catch (e) {
      toast(`${f.name}: ${e.message}`, true);
    }
  }
  progress.hidden = true;
  dropMain.hidden = false;
  el.file.value = "";
}

el.file.addEventListener("change", () => uploadFiles(el.file.files));
for (const ev of ["dragenter", "dragover"]) {
  el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add("over"); });
}
for (const ev of ["dragleave", "drop"]) {
  el.drop.addEventListener(ev, () => el.drop.classList.remove("over"));
}
el.drop.addEventListener("drop", (e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); });
// Dropping anywhere else on the page also uploads, instead of navigating away.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!el.drop.contains(e.target) && e.dataTransfer && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});

// ---- settings -------------------------------------------------------------

let editingUntil = 0;
function syncSettings(s) {
  if (!s) return;
  for (const seg of el.settings.querySelectorAll(".seg")) {
    const v = String(s[seg.dataset.key]);
    for (const b of seg.children) b.classList.toggle("sel", b.dataset.v === v);
  }
  el.color.hidden = s.background !== "color";
  if (Date.now() > editingUntil) {
    el.color.value = s.color;
    el.marginRange.value = s.margin;
    el.marginNum.value = s.margin;
    el.marginOut.textContent = s.margin + " px";
  }
}

async function saveSettings(patch) {
  try {
    await api("/api/settings", { headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  } catch (e) {
    toast(e.message, true);
  }
}

el.settings.addEventListener("click", (e) => {
  const b = e.target.closest(".seg button");
  if (!b) return;
  const key = b.parentElement.dataset.key;
  const v = key === "quality" ? +b.dataset.v : b.dataset.v;
  for (const x of b.parentElement.children) x.classList.toggle("sel", x === b);
  if (key === "background") el.color.hidden = v !== "color";
  saveSettings({ [key]: v });
});

let debounce = null;
function later(patch) {
  editingUntil = Date.now() + 800;
  clearTimeout(debounce);
  debounce = setTimeout(() => saveSettings(patch), 120);
}
el.color.addEventListener("input", () => later({ background: "color", color: el.color.value }));
el.marginRange.addEventListener("input", () => {
  el.marginNum.value = el.marginRange.value;
  el.marginOut.textContent = el.marginRange.value + " px";
  later({ margin: +el.marginRange.value });
});
el.marginNum.addEventListener("input", () => {
  const v = Math.max(0, Math.min(400, +el.marginNum.value || 0));
  el.marginRange.value = v;
  el.marginOut.textContent = v + " px";
  later({ margin: v });
});

// ---- transport & keyboard -------------------------------------------------

document.querySelector(".transport").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cmd]");
  if (!b) return;
  b.blur();
  cmd("/api/" + b.dataset.cmd);
});
el.gotoForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const n = parseInt(el.gotoInput.value, 10);
  if (!n) return;
  cmd("/api/goto?p=" + n);
  el.gotoInput.value = "";
  el.gotoInput.blur();
});

const KEYS = {
  ArrowRight: "next", " ": "next", Spacebar: "next", PageDown: "next", Enter: "next",
  ArrowLeft: "prev", PageUp: "prev",
  Home: "first", End: "last",
  b: "black", B: "black", ".": "black",
};
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
    if (e.key === "Escape") t.blur();
    return;
  }
  const action = KEYS[e.key];
  if (!action) return;
  e.preventDefault();
  if (t && t.blur && t !== document.body) t.blur(); // avoid also "clicking" a focused button
  if (!e.repeat || action !== "black") cmd("/api/" + action);
});
document.addEventListener("keyup", (e) => {
  if ((e.key === " " || e.key === "Enter") && e.target && e.target.tagName === "BUTTON") e.preventDefault();
});

// ---- output URL -----------------------------------------------------------

el.outUrl.value = location.origin + "/output";
el.copyBtn.addEventListener("click", async () => {
  let ok = false;
  try { await navigator.clipboard.writeText(el.outUrl.value); ok = true; } catch (_) { /* fallback */ }
  if (!ok) {
    el.outUrl.select();
    try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
  }
  el.copyBtn.textContent = ok ? "Copiato" : "Selezionato";
  setTimeout(() => (el.copyBtn.textContent = "Copia"), 1500);
});
el.outUrl.addEventListener("focus", () => el.outUrl.select());

// ---- connection -----------------------------------------------------------

function setConn(on) {
  el.conn.dataset.on = on ? "1" : "0";
  el.conn.querySelector(".label").textContent = on ? "Connesso" : "Disconnesso – riconnessione…";
  el.conn.title = on ? "Connesso a SlideOBS" : "SlideOBS non risponde: riprovo…";
}
let wasOn = false;
connectEvents({
  onState: applyState,
  onStatus: (on) => {
    if (on && !wasOn) {
      // After a reconnect (maybe the program restarted): refresh everything.
      docsRev = -1;
      if (st) st = { ...st, rev: -1 };
    }
    wasOn = on;
    setConn(on);
  },
});

let resizeT = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => st && updateLive(null), 150);
});
