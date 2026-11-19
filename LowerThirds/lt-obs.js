// Collegamento tra pannello di controllo e lower third.
// Usa il server WebSocket integrato in OBS (28+), più un BroadcastChannel
// come canale di riserva (utile anche per provare tutto in un normale browser).
function ltConnect({ onCommand, onStatus } = {}) {
  const cfg = window.LT_CONFIG || {};
  const seen = new Set();
  let ws = null, identified = false, reqId = 0;
  const status = (s, detail) => onStatus && onStatus(s, detail);

  function deliver(data) {
    if (!data || data.app !== "lower-third" || seen.has(data.id)) return;
    seen.add(data.id);
    if (seen.size > 200) seen.delete(seen.values().next().value);
    onCommand && onCommand(data);
  }

  // Canale locale (stesso browser / stesso OBS)
  let bc = null;
  try {
    bc = new BroadcastChannel("lower-third");
    bc.onmessage = (e) => deliver(e.data);
  } catch (e) {}

  // La Fonte Browser di OBS carica i file locali come "http://absolute/...",
  // dove crypto.subtle non esiste: in quel caso usiamo un SHA-256 in puro JS.
  async function sha256b64(text) {
    const bytes = new TextEncoder().encode(text);
    let out;
    if (window.crypto && crypto.subtle) {
      out = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    } else {
      out = sha256(bytes);
    }
    return btoa(String.fromCharCode(...out));
  }

  function sha256(msg) {
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const len = msg.length, total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(msg); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    dv.setUint32(total - 4, (len << 3) >>> 0);
    const W = new Uint32Array(64);
    const ror = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = ror(W[i-15], 7) ^ ror(W[i-15], 18) ^ (W[i-15] >>> 3);
        const s1 = ror(W[i-2], 17) ^ ror(W[i-2], 19) ^ (W[i-2] >>> 10);
        W[i] = (W[i-16] + s0 + W[i-7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    H.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
    return out;
  }
  window.__ltSha256 = sha256;

  function open() {
    try {
      ws = new WebSocket(`ws://${cfg.host || "localhost"}:${cfg.port || 4455}`);
    } catch (e) { status("off"); return setTimeout(open, 3000); }

    ws.onmessage = async (m) => {
      const msg = JSON.parse(m.data);
      if (msg.op === 0) {                       // Hello
        const d = { rpcVersion: 1, eventSubscriptions: 1 }; // General (CustomEvent)
        const auth = msg.d.authentication;
        if (auth) {
          const secret = await sha256b64((cfg.password || "") + auth.salt);
          d.authentication = await sha256b64(secret + auth.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d }));
      } else if (msg.op === 2) {                // Identified
        identified = true;
        status("ok");
      } else if (msg.op === 5 && msg.d.eventType === "CustomEvent") {
        deliver(msg.d.eventData);
      }
    };
    ws.onclose = (e) => {
      identified = false;
      status(e.code === 4009 ? "auth" : "off");
      setTimeout(open, 3000);
    };
  }
  open();

  return {
    send(data) {
      const payload = { app: "lower-third", id: Date.now() + "-" + Math.random().toString(36).slice(2), ...data };
      if (bc) bc.postMessage(payload);
      if (ws && identified) {
        ws.send(JSON.stringify({
          op: 6,
          d: { requestType: "BroadcastCustomEvent", requestId: "lt" + (++reqId), requestData: { eventData: payload } }
        }));
      }
      return identified;
    }
  };
}
