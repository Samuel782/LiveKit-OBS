// Generates a 5-slide 16:9 test PDF with solid colours (no dependencies).
import { writeFileSync } from "node:fs";
export const COLORS = [[0.90, 0.20, 0.20], [0.15, 0.55, 0.95], [0.20, 0.75, 0.35], [0.95, 0.75, 0.10], [0.55, 0.25, 0.80]];
export function makePdf(path, colors = COLORS) {
  const W = 960, H = 540, objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null), pages = add(null), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const kids = [];
  colors.forEach(([r, g, b], i) => {
    const txt = `Slide ${i + 1}`;
    const stream = `${r} ${g} ${b} rg 0 0 ${W} ${H} re f\n1 1 1 rg 0 0 0 RG\nBT /F1 110 Tf ${W / 2 - 230} ${H / 2 - 40} Td (${txt}) Tj ET\n1 1 1 rg ${W - 120} 30 80 80 re f\n`;
    const c = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(path, Buffer.from(out, "latin1"));
}
if (process.argv[2]) makePdf(process.argv[2]);
