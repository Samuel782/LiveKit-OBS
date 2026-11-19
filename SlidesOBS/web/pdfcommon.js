// Shared helpers for the control and output pages.
import * as pdfjsLib from "/static/vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/pdf.worker.min.mjs";

const V = "/static/vendor/pdfjs/";
const docCache = new Map(); // key -> Promise<PDFDocumentProxy>

export function docUrl(name, ver) {
  return "/docs/" + encodeURIComponent(name) + "?v=" + (ver || 0);
}

/** Loads (and caches) a PDF document. Only the most recent key is kept. */
export function loadDoc(name, ver) {
  const key = name + "|" + ver;
  if (docCache.has(key)) return docCache.get(key);
  for (const [k, p] of docCache) {
    docCache.delete(k);
    p.then((d) => d.destroy()).catch(() => {});
  }
  const task = pdfjsLib.getDocument({
    url: docUrl(name, ver),
    cMapUrl: V + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: V + "standard_fonts/",
    wasmUrl: V + "wasm/",
    iccUrl: V + "iccs/",
    isEvalSupported: false,
    verbosity: 0,
  });
  const p = task.promise;
  p.catch(() => docCache.delete(key));
  docCache.set(key, p);
  return p;
}

/**
 * Computes where a page goes inside a box (CSS px).
 * fit: contain | cover | width. Returns the visible rect (relative to the
 * box) and the scale/offset to use for the viewport (CSS px).
 */
export function layout(pw, ph, bw, bh, fit) {
  let s;
  if (fit === "cover") s = Math.max(bw / pw, bh / ph);
  else if (fit === "width") s = bw / pw;
  else s = Math.min(bw / pw, bh / ph);
  const dw = pw * s, dh = ph * s;
  const ox = (bw - dw) / 2, oy = (bh - dh) / 2;
  return {
    scale: s,
    left: Math.max(ox, 0),
    top: Math.max(oy, 0),
    width: Math.min(dw, bw),
    height: Math.min(dh, bh),
    offX: Math.min(ox, 0),
    offY: Math.min(oy, 0),
  };
}

const MAX_PIXELS = 33_000_000;

/**
 * Renders a page into a canvas. k = device pixels per CSS px.
 * Returns { promise, cancel, rect } where rect is the CSS placement.
 */
export function renderPage(page, canvas, bw, bh, fit, k) {
  const base = page.getViewport({ scale: 1 });
  const L = layout(base.width, base.height, bw, bh, fit);
  let w = Math.max(1, Math.round(L.width * k));
  let h = Math.max(1, Math.round(L.height * k));
  if (w * h > MAX_PIXELS) {
    const r = Math.sqrt(MAX_PIXELS / (w * h));
    k *= r;
    w = Math.max(1, Math.round(L.width * k));
    h = Math.max(1, Math.round(L.height * k));
  }
  canvas.width = w;
  canvas.height = h;
  const viewport = page.getViewport({ scale: L.scale * k, offsetX: L.offX * k, offsetY: L.offY * k });
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.clearRect(0, 0, w, h);
  const task = page.render({
    canvasContext: ctx,
    canvas,
    viewport,
    background: "rgba(0,0,0,0)",
    annotationMode: pdfjsLib.AnnotationMode.ENABLE,
  });
  return {
    promise: task.promise,
    cancel: () => task.cancel(),
    rect: { left: L.left, top: L.top, width: w / k, height: h / k },
  };
}

export function isCancel(err) {
  return err && (err.name === "RenderingCancelledException" || err instanceof pdfjsLib.RenderingCancelledException);
}

/**
 * Server-Sent Events with robust reconnection: the native EventSource retry
 * plus a watchdog (the server pings every 15 s) and a manual restart when the
 * browser gives up (e.g. the program was closed and restarted).
 */
export function connectEvents({ onState, onStatus }) {
  let es = null, watchdog = null, retry = null, delay = 1000;
  const kick = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(restart, 40000);
  };
  const restart = () => {
    clearTimeout(retry);
    if (es) es.close();
    es = null;
    onStatus && onStatus(false);
    retry = setTimeout(open, delay);
    delay = Math.min(delay * 1.5, 5000);
  };
  const open = () => {
    es = new EventSource("/api/events");
    es.addEventListener("open", () => { delay = 1000; onStatus && onStatus(true); kick(); });
    es.addEventListener("state", (e) => {
      kick();
      onStatus && onStatus(true);
      try { onState(JSON.parse(e.data)); } catch (err) { console.warn(err); }
    });
    es.addEventListener("ping", () => kick());
    es.addEventListener("error", () => {
      onStatus && onStatus(false);
      if (es.readyState === EventSource.CLOSED) restart();
      else kick();
    });
  };
  open();
  return { reconnect: restart };
}

export function transitionMs(settings) {
  switch (settings && settings.transition) {
    case "cut": return 0;
    case "fade600": return 600;
    default: return 300;
  }
}

export function backgroundColor(settings) {
  switch (settings && settings.background) {
    case "black": return "#000000";
    case "white": return "#ffffff";
    case "green": return "#00b140";
    case "color": return settings.color || "#000000";
    default: return "transparent";
  }
}

export async function reportPages(st, n) {
  if (!st.doc || st.pages === n) return;
  try {
    await fetch("/api/pages?name=" + encodeURIComponent(st.doc) + "&n=" + n, { method: "POST" });
  } catch (_) { /* offline: ignore */ }
}
