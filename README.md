# LiveKit-OBS 🎬

Sfondi animati, schermate, overlay e transizioni per dirette con **OBS Studio**.
Sono tutti file **HTML autonomi**: non servono plugin né programmi esterni.

Tutti gli elementi prendono i colori da **un'unica palette** ([`palette.js`](palette.js)), così stanno bene insieme nella stessa diretta. La palette si cambia in un attimo, per tutti i file o per uno solo: vedi [Colori e temi](#-colori-e-temi).

## Come si usano

1. In OBS: **Fonti → + → Browser**
2. Spunta **File locale** e scegli il file `.html`
3. Imposta **larghezza e altezza**: 1920×1080 per sfondi e schermate. Per gli overlay piccoli trovi la misura consigliata nella tabella.
4. OK. Lo sfondo trasparente funziona da solo.

**Personalizzazione.** Quasi tutti i file accettano parametri nell'URL. Per usarli togli la spunta da *File locale* e incolla l'indirizzo con i parametri:

```
file:///Users/TUO_UTENTE/Desktop/Background/Schermate/inizio-diretta.html?titolo=La%20mia%20live&minuti=10
```

(`%20` = spazio). In alternativa apri il file con un editor di testo e modifica il blocco **PERSONALIZZA QUI**.

```
📄 palette.js     colori condivisi da tutti i file (+ 10 temi pronti)
📁 Sfondi/        sfondi animati a schermo intero
📁 Schermate/     scene pronte: inizio, pausa, fine
📁 Overlay/       elementi trasparenti da sovrapporre (orologi, timer, badge, lower third…)
📁 Transizioni/   animazioni di passaggio tra scene
📁 Strumenti/     editor visuale della palette
📁 anteprime/     immagini usate in questo README
```

> Lascia `palette.js` nella cartella principale e non spostare i file fuori dalle loro cartelle: ogni file lo carica da lì.

---

## 🎨 Colori e temi

La palette ha quattro colori. Ogni elemento li usa sempre con lo stesso ruolo, quindi qualsiasi combinazione resta coerente:

| Ruolo | Nome | Predefinito |
|---|---|---|
| Principale | `c1` | `#1d4ed8` blu |
| Secondario | `c2` | `#10b981` verde |
| Accento | `c3` | `#06b6d4` ciano |
| Sfondo | `sfondo` | `#040914` blu notte |

Le varianti più chiare e più scure (bagliori, gradienti, testi) vengono calcolate in automatico.

**Temi pronti:** `blu-verde` · `viola-rosa` · `tramonto` · `cyberpunk` · `foresta` · `oro` · `fuoco` · `oceano` · `ghiaccio` · `monocromo`

<img src="anteprime/temi-esempio.png" width="800">

### Il modo più semplice: l'editor

Apri **[Strumenti/editor-palette.html](Strumenti/editor-palette.html)** nel browser (doppio clic). Scegli un elemento, prova i temi o i tuoi colori e vedi subito il risultato. Poi copia il codice pronto per uno dei tre livelli qui sotto.

<img src="anteprime/editor-palette.png" width="800">

### Tre livelli, dal più ampio al più specifico

**1. Tutti i file**: apri `palette.js` e modifica il blocco *PERSONALIZZA QUI*:
```js
const TEMA_PREDEFINITO = "tramonto";          // un tema pronto…
const COLORI_PERSONALIZZATI = {
  // c1: "#ff3366",                           // …e/o i tuoi colori
};
```

**2. Un solo file**: in cima a ogni `.html` c'è questa riga, compilala solo per quel file:
```html
<script>window.PALETTE_FILE = { tema: "cyberpunk", c1: "", c2: "", c3: "", sfondo: "" };</script>
```

**3. Una sola Fonte Browser** (senza toccare i file): aggiungi i parametri all'URL.
```
…/Sfondi/onde-luminose.html?tema=oceano
…/Sfondi/onde-luminose.html?c1=ff3366&c2=ffcc00&c3=00ccff&sfondo=0a0a0a
```
Così puoi usare lo stesso file in due scene con colori diversi.

Se più livelli sono impostati insieme, vince il più specifico: **URL → file → palette.js**.

> Restano fissi di proposito solo il rosso del badge "IN DIRETTA" e i colori ufficiali dei social. Le lower third partono dal colore principale della palette, ma dal pannello puoi sempre scegliere un colore per ogni ospite.

---

## 🌌 Sfondi

Formato 1920×1080. Si mettono in fondo alla scena, sotto webcam e contenuti.

| Anteprima | Nome | Descrizione |
|---|---|---|
| <img src="anteprime/aurora-blu-verde.png" width="320"> | [aurora-blu-verde](Sfondi/aurora-blu-verde.html) | Macchie di luce blu, verde e ciano che fluttuano lente. Lo sfondo "base". |
| <img src="anteprime/aurora-zona-testo.png" width="320"> | [aurora-zona-testo](Sfondi/aurora-zona-testo.html) | Come l'aurora, ma con il centro scuro e fermo: ideale sotto testi e sottotitoli. |
| <img src="anteprime/aurora-smeraldo.png" width="320"> | [aurora-smeraldo](Sfondi/aurora-smeraldo.html) | Variante più verde e petrolio, movimento ampio. |
| <img src="anteprime/aurora-dinamica.png" width="320"> | [aurora-dinamica](Sfondi/aurora-dinamica.html) | Aurora più rapida e contrastata, per contenuti energici. |
| <img src="anteprime/griglia-prospettiva.png" width="320"> | [griglia-prospettiva](Sfondi/griglia-prospettiva.html) | Pavimento a griglia in stile retro-futuristico che avanza verso l'orizzonte. `?velocita=6` |
| <img src="anteprime/costellazione.png" width="320"> | [costellazione](Sfondi/costellazione.html) | Particelle che si muovono e si collegano con linee sottili. `?numero=110&distanza=170` |
| <img src="anteprime/onde-luminose.png" width="320"> | [onde-luminose](Sfondi/onde-luminose.html) | Onde luminose sovrapposte che ondeggiano. `?altezza=0.62&velocita=1` |
| <img src="anteprime/campo-stellare.png" width="320"> | [campo-stellare](Sfondi/campo-stellare.html) | Viaggio tra le stelle con nebulose colorate. `?velocita=0` per stelle ferme che brillano |
| <img src="anteprime/bokeh-luci.png" width="320"> | [bokeh-luci](Sfondi/bokeh-luci.html) | Luci sfocate che salgono piano, effetto obiettivo fotografico. `?numero=45` |
| <img src="anteprime/esagoni-tech.png" width="320"> | [esagoni-tech](Sfondi/esagoni-tech.html) | Griglia di esagoni attraversata da un'onda di luce. Stile tech/gaming. `?lato=46` |
| <img src="anteprime/gradiente-fluido.png" width="320"> | [gradiente-fluido](Sfondi/gradiente-fluido.html) | Gradiente morbido che ruota lentamente, con una leggera grana. |

## 🖼️ Schermate

Scene complete in 1920×1080, con sfondo e testi già pronti.

| Anteprima | Nome | Descrizione |
|---|---|---|
| <img src="anteprime/inizio-diretta.png" width="320"> | [inizio-diretta](Schermate/inizio-diretta.html) | "La diretta inizia tra…" con conto alla rovescia e barra di avanzamento. `?titolo=…&minuti=5` oppure `?ora=21:00` |
| <img src="anteprime/pausa.png" width="320"> | [pausa](Schermate/pausa.html) | "Torniamo subito…" con onde animate e timer facoltativo. `?titolo=…&sottotitolo=…&minuti=3` |
| <img src="anteprime/fine-diretta.png" width="320"> | [fine-diretta](Schermate/fine-diretta.html) | "Grazie per la visione" con i tuoi social. `?social=YouTube:@canale,Instagram:@profilo` |

## ✨ Overlay

Elementi con sfondo trasparente da mettere sopra le altre fonti. Nelle anteprime compaiono su uno sfondo grigio.

| Anteprima | Nome | Descrizione | Misura consigliata |
|---|---|---|---|
| <img src="anteprime/lower-third.png" width="320"> | [lower-third](Overlay/lower-third/) | Lower third animata (nome + ruolo), **comandabile dal vivo** dal pannello qui sotto. Vedi [istruzioni](#lower-third-dal-vivo). | 1920×1080 |
| <img src="anteprime/pannello-lower-third.png" width="320"> | [pannello lower third](Overlay/lower-third/lower-third-control.html) | Pannello da aggiungere come dock in OBS: scrivi il nome, premi *Mostra*. Ha un elenco rapido degli ospiti. | dock |
| <img src="anteprime/orologio.png" width="320"> | [orologio](Overlay/orologio.html) | Orologio digitale con data in italiano. | 900×400 |
| <img src="anteprime/orologio-analogico.png" width="320"> | [orologio-analogico](Overlay/orologio-analogico.html) | Orologio a lancette fluide, con fuso orario a scelta. `?fuso=America/New_York&citta=New%20York` | 400×400 |
| <img src="anteprime/badge-in-diretta.png" width="320"> | [badge-in-diretta](Overlay/badge-in-diretta.html) | Badge rosso "IN DIRETTA" con punto pulsante e durata della live. `?testo=LIVE&inizio=20:30` | 600×150 |
| <img src="anteprime/conto-alla-rovescia.png" width="320"> | [conto-alla-rovescia](Overlay/conto-alla-rovescia.html) | Timer circolare con anello che si svuota. Clic = pausa, doppio clic = ricomincia. `?minuti=10&etichetta=Pausa` | 500×500 |
| <img src="anteprime/cronometro.png" width="320"> | [cronometro](Overlay/cronometro.html) | Cronometro con decimi. Clic = avvia/ferma, doppio clic = azzera, `L` = giro. `?avvio=1` | 700×200 |
| <img src="anteprime/testo-scorrevole.png" width="320"> | [testo-scorrevole](Overlay/testo-scorrevole.html) | Barra news con testo che scorre in loop. `?etichetta=ULTIME&testo=Notizia%201\|Notizia%202` | 1920×80 |
| <img src="anteprime/social-rotanti.png" width="320"> | [social-rotanti](Overlay/social-rotanti.html) | I tuoi social uno alla volta, con icona e colori di ciascuna piattaforma. `?social=YouTube:@canale,Twitch:canale&secondi=5` | 700×140 |
| <img src="anteprime/barra-obiettivo.png" width="320"> | [barra-obiettivo](Overlay/barra-obiettivo.html) | Barra di avanzamento verso un traguardo (iscritti, donazioni…). `?titolo=…&valore=742&obiettivo=1000&prefisso=€` | 900×160 |
| <img src="anteprime/cornice-webcam.png" width="320"> | [cornice-webcam](Overlay/cornice-webcam.html) | Bordo sfumato che ruota attorno alla webcam, con nome facoltativo. `?nome=Mario%20Rossi&raggio=28` | uguale alla webcam |
| <img src="anteprime/bagliore-inferiore.png" width="320"> | [bagliore-inferiore](Overlay/bagliore-inferiore.html) | Due bagliori sfocati che si muovono sul fondo dello schermo. | 1920×1080 |
| <img src="anteprime/grana-vignetta.png" width="320"> | [grana-vignetta](Overlay/grana-vignetta.html) | Grana della pellicola e bordi scuri per un look "cinema". Va sopra tutto. `?grana=0.1&vignetta=0.6` | 1920×1080 |

> Per i comandi a clic (conto alla rovescia, cronometro): in OBS fai **tasto destro sulla fonte → Interagisci**.

## 🔀 Transizioni

Animazioni che coprono lo schermo durante il cambio scena (a metà, intorno ai 600 ms, lo schermo è completamente coperto). Per provarle basta aprirle nel browser e cliccare.

| Anteprima | Nome | Descrizione |
|---|---|---|
| <img src="anteprime/pannelli-obliqui.png" width="320"> | [pannelli-obliqui](Transizioni/pannelli-obliqui.html) | Due pannelli inclinati blu e verde che attraversano lo schermo. |
| <img src="anteprime/cerchio-espansione.png" width="320"> | [cerchio-espansione](Transizioni/cerchio-espansione.html) | Cerchi concentrici che si espandono dal centro con un anello bianco. |
| <img src="anteprime/strisce-verticali.png" width="320"> | [strisce-verticali](Transizioni/strisce-verticali.html) | Strisce che cadono a cascata dal blu al verde. |

---

## Lower third dal vivo

Usa il **server WebSocket già incluso in OBS** (dalla versione 28 in poi).

1. OBS → **Strumenti → Impostazioni del server WebSocket** → attivalo e copia la password.
2. Copia `Overlay/lower-third/lt-config.example.js` in **`lt-config.js`** (nella stessa cartella) e incolla la password.
3. Aggiungi `lower-third.html` come Fonte Browser (1920×1080, *File locale*).
4. **Docks → Dock browser personalizzati** e usa come URL il percorso di `lower-third-control.html` (es. `file:///Users/…/Overlay/lower-third/lower-third-control.html`).
5. Nel pannello devono comparire **🟢 Collegato a OBS** e **🟢 Grafica collegata**. Se la grafica non risulta collegata, apri le proprietà della fonte e premi *Aggiorna la cache della pagina corrente*.

> `lt-config.js` contiene la password ed è escluso da git (`.gitignore`): non finisce su GitHub.
