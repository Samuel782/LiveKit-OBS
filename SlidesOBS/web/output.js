// Output page for the OBS Browser source.
import { loadDoc, renderPage, isCancel, connectEvents, transitionMs, backgroundColor, reportPages } from "/static/pdfcommon.js";

const stage = document.getElementById("stage");
const blackEl = document.getElementById("black");
const canvases = [document.getElementById("c0"), document.getElementById("c1")];
let front = 0;
let st = null;

// True crossfade (no dip in the middle) where the browser supports it.
if (window.CSS && CSS.supports && CSS.supports("mix-blend-mode", "plus-lighter")) stage.classList.add("plus");

// ---- target / cache -------------------------------------------------------

function target(page) {
  if (!st || !st.doc) return null;
  const s = st.settings || {};
  const m = Math.max(0, s.margin | 0);
  const bw = Math.max(16, window.innerWidth - 2 * m);
  const bh = Math.max(16, window.innerHeight - 2 * m);
  const k = (window.devicePixelRatio || 1) * (s.quality === 2 ? 2 : 1);
  let p = page || st.page || 1;
  if (st.pages > 0) p = Math.min(Math.max(1, p), st.pages);
  const content = st.doc + "|" + st.docVersion + "|" + p;
  return { doc: st.doc, ver: st.docVersion, page: p, bw, bh, m, fit: s.fit || "contain", k, content,
    key: content + "|" + bw + "x" + bh + "|" + m + "|" + (s.fit || "contain") + "|" + k };
}

const cache = new Map(); // key -> frame {canvas, rect}
const inflight = new Map(); // key -> {promise, cancel}
const CACHE_MAX = 4;

function cachePut(key, frame) {
  cache.delete(key);
  cache.set(key, frame);
  while (cache.size > CACHE_MAX) {
    const [k, f] = cache.entries().next().value;
    cache.delete(k);
    f.canvas.width = f.canvas.height = 0;
  }
}

class Cancelled extends Error { constructor() { super("cancelled"); this.name = "RenderingCancelledException"; } }

function getFrame(t) {
  if (cache.has(t.key)) {
    const f = cache.get(t.key);
    cachePut(t.key, f);
    return Promise.resolve(f);
  }
  if (inflight.has(t.key)) return inflight.get(t.key).promise;
  const entry = { cancelled: false, cancel: null };
  entry.cancel = () => { entry.cancelled = true; entry.task && entry.task.cancel(); };
  entry.promise = (async () => {
    try {
      const doc = await loadDoc(t.doc, t.ver);
      if (st && st.doc === t.doc) reportPages(st, doc.numPages);
      if (entry.cancelled) throw new Cancelled();
      const page = await doc.getPage(Math.min(t.page, doc.numPages));
      if (entry.cancelled) throw new Cancelled();
      const canvas = document.createElement("canvas");
      const r = renderPage(page, canvas, t.bw, t.bh, t.fit, t.k);
      entry.task = r;
      await r.promise;
      const frame = { canvas, rect: r.rect, m: t.m };
      cachePut(t.key, frame);
      return frame;
    } finally {
      inflight.delete(t.key);
    }
  })();
  inflight.set(t.key, entry);
  return entry.promise;
}

function cancelStale() {
  const keep = new Set();
  const t = target();
  if (t) keep.add(t.key);
  for (const [k, e] of inflight) if (!keep.has(k)) e.cancel();
}

// ---- display --------------------------------------------------------------

let shownKey = null, shownContent = null, gen = 0;

function show(frame, instant) {
  const dur = instant ? 0 : transitionMs(st && st.settings);
  const next = canvases[1 - front];
  const cur = canvases[front];
  const myGen = ++gen;

  next.style.transition = "none";
  next.classList.remove("front");
  next.style.zIndex = "2";
  cur.style.zIndex = "1";
  cur.classList.remove("top");
  next.classList.add("top");
  if (frame) {
    next.width = frame.canvas.width;
    next.height = frame.canvas.height;
    const ctx = next.getContext("2d", { alpha: true });
    ctx.clearRect(0, 0, next.width, next.height);
    ctx.drawImage(frame.canvas, 0, 0);
    next.style.left = frame.m + frame.rect.left + "px";
    next.style.top = frame.m + frame.rect.top + "px";
    next.style.width = frame.rect.width + "px";
    next.style.height = frame.rect.height + "px";
  } else {
    next.width = next.height = 1;
  }
  void next.offsetWidth; // commit the starting opacity before transitioning
  for (const c of canvases) c.style.transition = dur ? `opacity ${dur}ms linear` : "none";
  next.classList.add("front");
  cur.classList.remove("front");
  front = 1 - front;
  setTimeout(() => {
    if (gen === myGen) { cur.width = cur.height = 1; }
  }, dur + 80);
}

let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const t = target();
      const key = t ? t.key : "none";
      if (key === shownKey) break;
      if (!t) {
        show(null, false);
        shownKey = key;
        shownContent = null;
        continue;
      }
      let frame;
      try {
        frame = await getFrame(t);
      } catch (e) {
        if (isCancel(e)) continue;
        console.warn("SlideOBS: impossibile mostrare la pagina", e && e.message);
        show(null, false);
        shownKey = key;
        shownContent = null;
        break;
      }
      const now = target();
      if (!now || now.key !== key) continue; // a newer change arrived: skip
      show(frame, shownContent === t.content);
      shownKey = key;
      shownContent = t.content;
    }
  } finally {
    busy = false;
  }
  prefetch();
}

let prefetchTimer = null;
function prefetch() {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(async () => {
    const t = target();
    if (!t || busy) return;
    for (const d of [1, -1]) {
      const p = t.page + d;
      if (p < 1 || (st.pages > 0 && p > st.pages)) continue;
      const pt = target(p);
      if (!pt || cache.has(pt.key)) continue;
      try { await getFrame(pt); } catch (_) { return; }
      const again = target();
      if (!again || again.key !== t.key) return;
    }
  }, 120);
}

// ---- state ----------------------------------------------------------------

function applyLook() {
  const s = (st && st.settings) || {};
  const dur = transitionMs(s);
  document.body.style.backgroundColor = backgroundColor(s);
  blackEl.style.transitionDuration = dur + "ms";
  stage.style.transitionDuration = dur + "ms";
  const black = !!(st && st.black);
  blackEl.classList.toggle("on", black && s.blackMode !== "hide");
  stage.classList.toggle("hidden", black && s.blackMode === "hide");
}

function onState(next) {
  st = next;
  cancelStale(); // a prefetch that became the new target keeps running
  applyLook();
  pump();
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { cancelStale(); pump(); }, 150);
});

connectEvents({ onState, onStatus: () => {} });
