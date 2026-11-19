// End-to-end test of SlideOBS with Playwright (Chromium).
// Usage: node e2e.mjs [path/to/binary]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { makePdf, COLORS } from "./make-pdf.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultBin = {
  darwin: process.arch === "arm64" ? "SlideOBS-mac-arm64" : "SlideOBS-mac-intel",
  linux: "SlideOBS-linux-amd64",
  win32: "SlideOBS.exe",
}[process.platform];
const BIN = resolve(process.argv[2] || join(here, "..", "dist", defaultBin));
const SHOTS = join(here, "screenshots");
mkdirSync(SHOTS, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "slideobs-e2e-"));
const docsDir = join(work, "docs");
const pdfPath = join(work, "prova-5-slide.pdf");
makePdf(pdfPath);
const pptxPath = join(work, "presentazione.pptx");
writeFileSync(pptxPath, Buffer.from("PK\x03\x04 finto pptx", "latin1"));

let failures = 0, passes = 0;
function check(cond, name, extra = "") {
  if (cond) { passes++; console.log("  ✓ " + name); }
  else { failures++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 5000, step = 50) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { last = await fn(); if (last) return last; } catch (_) { /* retry */ }
    await sleep(step);
  }
  return last;
}

function start(args = []) {
  return new Promise((resolveP, reject) => {
    const p = spawn(BIN, ["--no-browser", "--dir", docsDir, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const onData = (d) => {
      out += d.toString();
      const m = out.match(/http:\/\/localhost:(\d+)\/output/);
      if (m && /spegnere/.test(out)) { p.stdout.off("data", onData); resolveP({ proc: p, port: +m[1], out }); }
      else if (/già in esecuzione/.test(out)) { resolveP({ proc: p, port: 0, out, existing: true }); }
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("exit", (code) => { if (!/localhost:\d+\/output/.test(out)) resolveP({ proc: p, port: 0, out, code }); });
    setTimeout(() => reject(new Error("timeout avvio: " + out)), 8000);
  });
}
function stop(proc) {
  return new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once("exit", r); proc.kill("SIGINT"); });
}
async function get(port, path, method = "GET") {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Colour of the slide currently shown in /output (sampled from the front canvas).
async function outColor(out) {
  return out.evaluate(() => {
    const c = document.querySelector("#stage canvas.front");
    if (!c || c.width < 4) return null;
    const d = c.getContext("2d").getImageData(Math.floor(c.width * 0.08), Math.floor(c.height * 0.12), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  });
}
const near = (a, rgb) => a && rgb.every((v, i) => Math.abs(a[i] - Math.round(v * 255)) < 12) && a[3] > 240;
async function expectSlide(out, n, label) {
  const ok = await until(async () => near(await outColor(out), COLORS[n - 1]), 5000);
  check(!!ok, `${label}: /output mostra la slide ${n}`, JSON.stringify(await outColor(out)));
}
async function counter(ctl) { return (await ctl.textContent("#counter")).trim(); }

const consoleErrors = [];
let expectNetErrors = false;
function watch(page, name) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (expectNetErrors && /ERR_CONNECTION_REFUSED|Failed to load resource|EventSource/.test(t)) return;
    consoleErrors.push(`[${name}] ${t}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`[${name}] pageerror ${e.message}`));
}

console.log("Binario:", BIN);
console.log("Cartella di prova:", work);
if (!existsSync(BIN)) { console.error("binario non trovato"); process.exit(2); }

let app = await start();
check(app.port === 8765, "avvio sulla porta 8765", app.out);
const P = app.port;
check(/REGIA/.test(app.out) && /URL DA INCOLLARE IN OBS/.test(app.out) && /CARTELLA DEI DOCUMENTI/.test(app.out), "messaggio di avvio in italiano");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const ctl = await ctx.newPage();
watch(ctl, "control");
const outCtx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const out = await outCtx.newPage();
watch(out, "output");

await ctl.goto(`http://localhost:${P}/control`);
await out.goto(`http://localhost:${P}/output`);
check(await until(() => ctl.getAttribute("#conn", "data-on").then((v) => v === "1")), "regia connessa (SSE)");
check((await out.evaluate(() => getComputedStyle(document.body).backgroundColor)) === "rgba(0, 0, 0, 0)", "uscita: sfondo trasparente di default");
check((await out.evaluate(() => document.body.innerText.trim())) === "", "uscita: nessun elemento UI");

console.log("\n# Caricamento");
await ctl.setInputFiles("#fileInput", pptxPath);
const toastPptx = await until(async () => { const t = await ctl.textContent("#toast"); return /Esporta la presentazione in PDF/.test(t) ? t : null; });
check(!!toastPptx, "PPTX rifiutato con il messaggio di esportazione", await ctl.textContent("#toast"));
const apiPptx = await fetch(`http://127.0.0.1:${P}/api/upload`, { method: "POST", headers: { "X-Filename": encodeURIComponent("slide.pptx") }, body: "PK" });
check(apiPptx.status === 415 && /Esporta la presentazione in PDF/.test((await apiPptx.json()).error), "API: PPTX rifiutato con 415 e messaggio");
await ctl.setInputFiles("#fileInput", pdfPath);
check(await until(async () => (await counter(ctl)) === "1 / 5"), "PDF caricato: contatore 1 / 5", await counter(ctl));
check(await until(async () => (await ctl.locator(".thumb").count()) === 5), "5 miniature");
check(await until(() => ctl.locator(".docs li").count().then((n) => n === 1)), "documento in elenco");
await expectSlide(out, 1, "dopo il caricamento");

console.log("\n# Navigazione");
await ctl.keyboard.press("ArrowRight");
await expectSlide(out, 2, "→");
check((await counter(ctl)) === "2 / 5", "contatore 2 / 5");
await ctl.keyboard.press("Space");
await expectSlide(out, 3, "Spazio");
await ctl.click('[data-cmd="prev"]');
await expectSlide(out, 2, "pulsante indietro");
await ctl.fill("#gotoInput", "4");
await ctl.press("#gotoInput", "Enter");
await expectSlide(out, 4, "vai a 4");
await ctl.keyboard.press("End");
await expectSlide(out, 5, "Fine");
await ctl.keyboard.press("PageDown");
await sleep(300);
check((await counter(ctl)) === "5 / 5", "non va oltre l'ultima");
await ctl.keyboard.press("Home");
await expectSlide(out, 1, "Home");
await ctl.locator('.thumb[data-page="3"]').click();
await expectSlide(out, 3, "clic su miniatura 3");
check(await until(() => ctl.locator(".thumb.cur").getAttribute("data-page").then((v) => v === "3")), "miniatura corrente evidenziata");
let r = await get(P, "/api/next");
check(r.status === 200 && r.body.page === 4, "GET /api/next (Stream Deck)");
await expectSlide(out, 4, "API next");
r = await get(P, "/api/prev", "POST");
check(r.body.page === 3, "POST /api/prev");
r = await get(P, "/api/goto?p=2");
check(r.body.page === 2, "GET /api/goto?p=2");
await expectSlide(out, 2, "API goto");
r = await get(P, "/api/goto?p=99");
check(r.body.page === 5, "goto oltre la fine → ultima");
r = await get(P, "/api/first");
r = await get(P, "/api/last");
check(r.body.page === 5, "/api/last");
r = await get(P, "/api/first");
check(r.body.page === 1, "/api/first");

console.log("\n# Schermo nero");
await ctl.keyboard.press("b");
check(await until(() => out.evaluate(() => document.getElementById("black").classList.contains("on"))), "B → nero in uscita");
check(await until(() => out.evaluate(() => getComputedStyle(document.getElementById("black")).opacity === "1"), 2000), "overlay nero opaco");
check(await ctl.evaluate(() => document.getElementById("blackBtn").classList.contains("on")), "pulsante nero attivo in regia");
await ctl.keyboard.press(".");
check(await until(() => out.evaluate(() => !document.getElementById("black").classList.contains("on"))), ". → nero spento");
r = await get(P, "/api/black?on=1");
check(r.body.black === true, "/api/black?on=1");
r = await get(P, "/api/black?on=1");
check(r.body.black === true, "/api/black?on=1 è idempotente");
r = await get(P, "/api/black", "POST");
check(r.body.black === false, "/api/black alterna");

console.log("\n# Impostazioni in tempo reale");
const bodyBg = () => out.evaluate(() => getComputedStyle(document.body).backgroundColor);
await ctl.click('.seg[data-key="background"] button[data-v="green"]');
check(await until(async () => (await bodyBg()) === "rgb(0, 177, 64)"), "sfondo verde chroma", await bodyBg());
await ctl.click('.seg[data-key="background"] button[data-v="color"]');
await ctl.locator("#colorInput").fill("#336699");
check(await until(async () => (await bodyBg()) === "rgb(51, 102, 153)"), "sfondo colore personalizzato", await bodyBg());
await ctl.click('.seg[data-key="background"] button[data-v="white"]');
check(await until(async () => (await bodyBg()) === "rgb(255, 255, 255)"), "sfondo bianco");

const rect = () => out.evaluate(() => { const c = document.querySelector("#stage canvas.front"); const b = c.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, pw: c.width, ph: c.height }; });
await out.setViewportSize({ width: 800, height: 600 }); // 4:3 window, 16:9 slide
await sleep(500);
let rc = await until(async () => { const x = await rect(); return Math.abs(x.w - 800) < 2 && Math.abs(x.h - 450) < 2 ? x : null; }, 3000);
check(!!rc, "ridimensionamento + adattamento intera (800×450 centrato)", JSON.stringify(await rect()));
await ctl.click('.seg[data-key="fit"] button[data-v="cover"]');
rc = await until(async () => { const x = await rect(); return Math.abs(x.w - 800) < 2 && Math.abs(x.h - 600) < 2 ? x : null; }, 3000);
check(!!rc, "adattamento riempi (copre 800×600)", JSON.stringify(await rect()));
await ctl.click('.seg[data-key="fit"] button[data-v="width"]');
rc = await until(async () => { const x = await rect(); return Math.abs(x.w - 800) < 2 && Math.abs(x.h - 450) < 2 ? x : null; }, 3000);
check(!!rc, "adattamento larghezza");
await out.setViewportSize({ width: 960, height: 540 });
await ctl.click('.seg[data-key="fit"] button[data-v="contain"]');
await ctl.fill("#marginNum", "40");
// 960×540 window − 40 px margin → 880×460 box; a 16:9 slide fits as 818×460 at y=40.
rc = await until(async () => { const x = await rect(); return Math.abs(x.y - 40) < 2 && Math.abs(x.h - 460) < 2 && Math.abs(x.x + x.w / 2 - 480) < 2 ? x : null; }, 3000);
check(!!rc, "margine 40 px", JSON.stringify(await rect()));
await ctl.click('.seg[data-key="quality"] button[data-v="2"]');
rc = await until(async () => { const x = await rect(); return Math.abs(x.pw - x.w * 2) < 3 ? x : null; }, 3000);
check(!!rc, "qualità 2x (canvas a doppia risoluzione)", JSON.stringify(await rect()));
await ctl.click('.seg[data-key="transition"] button[data-v="cut"]');
await until(() => out.evaluate(() => true));
await get(P, "/api/next");
const t0 = Date.now();
await expectSlide(out, 2, "transizione taglio");
console.log("    (cambio con taglio in " + (Date.now() - t0) + " ms)");
const trans = await out.evaluate(() => getComputedStyle(document.querySelector("#stage canvas.front")).transitionDuration);
check(trans === "0s", "transizione taglio: durata 0", trans);
await ctl.click('.seg[data-key="transition"] button[data-v="fade600"]');
await sleep(200);
await get(P, "/api/next");
const dur = await until(() => out.evaluate(() => getComputedStyle(document.querySelector("#stage canvas.front")).transitionDuration).then((d) => (d === "0.6s" ? d : null)), 3000);
check(dur === "0.6s", "dissolvenza 600 ms", dur);
await expectSlide(out, 3, "dopo dissolvenza");
await ctl.click('.seg[data-key="blackMode"] button[data-v="hide"]');
await get(P, "/api/black?on=1");
check(await until(() => out.evaluate(() => document.getElementById("stage").classList.contains("hidden") && !document.getElementById("black").classList.contains("on"))), "modalità nero: nascondi slide");
await get(P, "/api/black?on=0");
check(await until(() => out.evaluate(() => !document.getElementById("stage").classList.contains("hidden"))), "slide di nuovo visibile");

// Rapid changes: only the last one must end up on screen.
for (let i = 0; i < 6; i++) get(P, i % 2 ? "/api/prev" : "/api/next");
await sleep(400);
await get(P, "/api/goto?p=5");
await expectSlide(out, 5, "cambi rapidi → solo l'ultimo");

await ctl.screenshot({ path: join(SHOTS, "regia-1400.png"), fullPage: false });

console.log("\n# Ripristino dopo il riavvio");
await get(P, "/api/goto?p=4");
await get(P, "/api/black?on=1");
await get(P, "/api/settings?background=green&margin=24&transition=fade300&quality=1&blackMode=black&fit=contain");
const before = (await get(P, "/api/state")).body;
expectNetErrors = true;
await stop(app.proc);
check(await until(() => ctl.getAttribute("#conn", "data-on").then((v) => v === "0"), 5000), "regia segnala la disconnessione");
app = await start();
check(app.port === 8765, "riavvio sulla stessa porta");
const after = (await get(P, "/api/state")).body;
check(after.doc === before.doc && after.page === 4 && after.black === true, "documento, pagina e nero ripristinati", JSON.stringify(after));
check(JSON.stringify(after.settings) === JSON.stringify(before.settings), "impostazioni ripristinate", JSON.stringify(after.settings));
check(await until(() => ctl.getAttribute("#conn", "data-on").then((v) => v === "1"), 8000), "regia si riconnette da sola");
await get(P, "/api/black?on=0");
await get(P, "/api/goto?p=2");
await expectSlide(out, 2, "uscita riconnessa da sola dopo il riavvio");
check(await until(async () => (await counter(ctl)) === "2 / 5"), "regia aggiornata dopo il riavvio");
expectNetErrors = false;

console.log("\n# Seconda istanza e porta occupata");
const second = await start();
check(second.existing === true, "seconda istanza: rileva SlideOBS già in esecuzione", second.out);
await stop(second.proc);
await stop(app.proc);
const blocker = http.createServer((q, s) => s.end("altro programma")).listen(8765, "127.0.0.1");
await new Promise((r) => blocker.once("listening", r));
const fb = await start();
check(fb.port === 8766, "porta 8765 occupata → usa 8766", fb.out.match(/localhost:\d+/)?.[0]);
check(/ATTENZIONE: la porta 8765 era occupata/.test(fb.out), "avviso porta cambiata nel messaggio");
const s2 = (await get(8766, "/api/state")).body;
check(s2 && s2.page === 2, "stato servito anche sulla porta di riserva");
await stop(fb.proc);
blocker.close();

console.log("\n# Sicurezza di base");
app = await start();
const evil = await new Promise((r) => http.get({ host: "127.0.0.1", port: P, path: "/api/state", headers: { Host: "evil.example:8765" } }, (res) => { res.resume(); r(res.statusCode); }));
check(evil === 403, "Host estraneo rifiutato (anti DNS rebinding)");
const xsite = await fetch(`http://127.0.0.1:${P}/api/next`, { headers: { "Sec-Fetch-Site": "cross-site" } }).then((x) => x.status);
check(xsite === 403, "richiesta cross-site rifiutata");
const trav = await fetch(`http://127.0.0.1:${P}/docs/..%2fslideobs-stato.json`).then((x) => x.status);
check(trav === 404, "nessun accesso fuori dalla cartella documenti");

console.log("\n# Screenshot");
await ctl.reload();
await until(async () => (await counter(ctl)) === "2 / 5");
await sleep(800);
await ctl.screenshot({ path: join(SHOTS, "regia-1400.png") });
const narrow = await browser.newContext({ viewport: { width: 350, height: 900 }, deviceScaleFactor: 2 });
const ctlN = await narrow.newPage();
watch(ctlN, "control-350");
await ctlN.goto(`http://localhost:${P}/control`);
await until(async () => (await counter(ctlN)) === "2 / 5");
await sleep(1000);
const overflow = await ctlN.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 0, "350px: nessuno scroll orizzontale", "overflow " + overflow);
await ctlN.screenshot({ path: join(SHOTS, "regia-350.png"), fullPage: true });
await out.setViewportSize({ width: 1920, height: 1080 });
await get(P, "/api/settings?background=transparent&margin=0");
await sleep(1200);
await out.screenshot({ path: join(SHOTS, "uscita-1920.png"), omitBackground: true });
await get(P, "/api/settings?background=green");

await browser.close();
await stop(app.proc);

console.log("\n# Errori in console");
check(consoleErrors.length === 0, "nessun errore in console", consoleErrors.join("\n      "));

console.log(`\n${passes} superati, ${failures} falliti`);
process.exit(failures ? 1 : 0);
