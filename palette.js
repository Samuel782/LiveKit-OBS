/* =====================================================================
   PALETTE COLORI CONDIVISA
   Tutti i file di ObsTools leggono i colori da qui.

   Ordine di priorità (vince il primo trovato):
     1. URL della Fonte Browser   ?tema=tramonto  oppure  ?c1=ff0000&c2=00ff00&c3=0000ff&sfondo=000000
     2. Blocco PALETTE_FILE in cima al singolo file html (solo quel file)
     3. Le impostazioni qui sotto (valgono per tutti i file)

   Ruoli dei colori:
     c1     = colore principale     (blu nel tema predefinito)
     c2     = colore secondario     (verde)
     c3     = colore d'accento      (ciano)
     sfondo = colore di fondo scuro
   ===================================================================== */
{ // (le graffe tengono queste variabili separate da quelle degli altri file)

/* ====== PERSONALIZZA QUI: palette di tutti i file ====== */
const TEMA_PREDEFINITO = "blu-verde";
const COLORI_PERSONALIZZATI = {
  // c1: "#1d4ed8",
  // c2: "#10b981",
  // c3: "#06b6d4",
  // sfondo: "#040914",
};
/* ======================================================= */

const TEMI = {
  "blu-verde":  { c1: "#1d4ed8", c2: "#10b981", c3: "#06b6d4", sfondo: "#040914" },
  "viola-rosa": { c1: "#7c3aed", c2: "#ec4899", c3: "#a855f7", sfondo: "#0b0617" },
  "tramonto":   { c1: "#ea580c", c2: "#e11d48", c3: "#f59e0b", sfondo: "#120706" },
  "cyberpunk":  { c1: "#c026d3", c2: "#06b6d4", c3: "#f472b6", sfondo: "#07040f" },
  "foresta":    { c1: "#15803d", c2: "#84cc16", c3: "#14b8a6", sfondo: "#030f08" },
  "oro":        { c1: "#b45309", c2: "#eab308", c3: "#f97316", sfondo: "#0d0904" },
  "fuoco":      { c1: "#b91c1c", c2: "#f97316", c3: "#facc15", sfondo: "#110404" },
  "oceano":     { c1: "#0369a1", c2: "#0d9488", c3: "#38bdf8", sfondo: "#020c14" },
  "ghiaccio":   { c1: "#2563eb", c2: "#a5f3fc", c3: "#e0e7ff", sfondo: "#060b16" },
  "monocromo":  { c1: "#475569", c2: "#cbd5e1", c3: "#94a3b8", sfondo: "#09090b" },
};

(function () {
  const Q = new URLSearchParams(location.search);
  const FILE = window.PALETTE_FILE || {};
  const pulisci = (v) => (v ? "#" + String(v).trim().replace(/^#/, "") : "");

  // 3 → 2 → 1
  const nomeTema = Q.get("tema") || FILE.tema || TEMA_PREDEFINITO;
  const p = { ...TEMI["blu-verde"], ...(TEMI[nomeTema] || {}) };
  if (!Q.get("tema") && !FILE.tema) Object.assign(p, COLORI_PERSONALIZZATI);
  for (const k of ["c1", "c2", "c3", "sfondo"]) if (FILE[k]) p[k] = pulisci(FILE[k]);
  for (const k of ["c1", "c2", "c3", "sfondo"]) if (Q.get(k)) p[k] = pulisci(Q.get(k));

  const rgb = (hex) => {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
  };
  const hex = (a) => "#" + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

  // varianti calcolate in automatico
  const tutti = { ...p };
  for (const k of ["c1", "c2", "c3"]) {
    tutti[k + "-chiaro"] = mix(p[k], "#ffffff", 0.45);
    tutti[k + "-scuro"] = mix(p[k], "#000000", 0.35);
  }
  tutti["sfondo-chiaro"] = mix(p.sfondo, p.c1, 0.16);

  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(tutti)) {
    root.setProperty("--" + k, v);
    root.setProperty("--" + k + "-rgb", rgb(v).join(","));
  }

  // per gli script (canvas ecc.)
  window.PAL = {
    ...tutti,
    tema: nomeTema,
    temi: TEMI,
    rgb: (k) => rgb(tutti[k] || k),
    rgba: (k, a) => `rgba(${rgb(tutti[k] || k).join(",")},${a})`,
    mix: (a, b, t) => mix(tutti[a] || a, tutti[b] || b, t),
  };
})();
}
