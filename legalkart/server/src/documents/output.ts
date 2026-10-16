// Output writers: HTML → PDF (headless Chromium), e-stamp certificate merge +
// per-page footer/QR (pdf-lib), and an editable DOCX (docx).
import { createHash } from "node:crypto";
import {
  AlignmentType, BorderStyle, Document, Footer, Header, Packer, PageNumber, Paragraph, Table, TableCell, TableRow,
  TextRun, WidthType,
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import type { DocModel } from "./render.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const paras = (s: string) => s.split("\n").map((l) => esc(l)).join("<br>");

export function toHtml(doc: DocModel, pageSize: "A4" | "LEGAL" = "A4"): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)} ${esc(doc.referenceNo)}</title>
<style>
  @page { size: ${pageSize === "A4" ? "A4" : "legal"}; margin: 25mm 20mm 28mm 30mm; }
  body { font-family: "Noto Serif", "DejaVu Serif", Georgia, serif; font-size: 11.5pt; line-height: 1.6; color: #111; }
  h1 { text-align: center; font-size: 15pt; letter-spacing: .08em; text-decoration: underline; margin: 0 0 18pt; }
  p { margin: 0 0 9pt; text-align: justify; }
  .clause-h { font-weight: bold; }
  .center { text-align: center; font-weight: bold; margin: 12pt 0; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28pt 40pt; margin-top: 36pt; page-break-inside: avoid; }
  .sig { border-top: 1px solid #000; padding-top: 4pt; min-height: 80pt; }
  .sig .cap { font-weight: bold; }
  .sig .ver { font-size: 8.5pt; color: #1b5e20; }
  .photo { float: right; margin: 0 0 4pt 8pt; width: 60pt; height: 72pt; border: 1px dashed #777; font-size: 7pt; color: #777; text-align: center; padding-top: 28pt; box-sizing: border-box; }
  .wm { position: fixed; top: 40%; left: 0; right: 0; text-align: center; transform: rotate(-30deg); font-size: 54pt; color: rgba(200,0,0,.12); font-weight: bold; z-index: -1; }
</style></head><body>
${doc.watermark ? `<div class="wm">${esc(doc.watermark)}</div>` : ""}
<h1>${esc(doc.title)}</h1>
${doc.preamble.map((p) => `<p${/^(BETWEEN|AND)$/.test(p) ? ' class="center"' : ""}>${paras(p)}</p>`).join("\n")}
${doc.recitals.map((r) => `<p>${paras(r)}</p>`).join("\n")}
<p class="center">NOW THIS AGREEMENT WITNESSETH AS UNDER:</p>
${doc.clauses.map((c) => `<p><span class="clause-h">${c.number}. ${c.heading ? `${esc(c.heading)}.` : ""}</span> ${paras(c.text)}</p>`).join("\n")}
<p>IN WITNESS WHEREOF the parties have signed this Agreement on the day, month and year first above written.</p>
<div class="sig-grid" style="break-before: avoid">
${doc.signatures.map((s) => `<div class="sig">${s.photoBox ? '<div class="photo">Affix photo</div>' : ""}<div class="cap">${esc(s.caption)}</div><div>${esc(s.name)}</div>${s.verifiedLine ? `<div class="ver">✔ ${esc(s.verifiedLine)}</div>` : ""}</div>`).join("\n")}
</div>
${doc.schedules.map((s) => `<p class="center" style="margin-top:24pt">${esc(s.heading ?? "SCHEDULE")}</p><p>${paras(s.text)}</p>`).join("\n")}
</body></html>`;
}

/** HTML → PDF with headless Chromium (playwright-core; no browser download). */
export async function htmlToPdf(html: string, executablePath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium"): Promise<Uint8Array> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await browser.close();
  }
}

/**
 * Final stamped PDF: [e-stamp certificate] + [agreement pages], with the
 * certificate number, page x/y and a verification QR on every agreement page.
 */
export async function assembleStampedPdf(
  bodyPdf: Uint8Array,
  doc: DocModel,
  opts: { certificatePdf: Uint8Array | null; verifyUrl: string },
): Promise<{ pdf: Uint8Array; sha256: string }> {
  const out = await PDFDocument.create();
  out.setTitle(`${doc.title} ${doc.referenceNo}`);
  out.setProducer("LegalKart Paper Generator");
  if (opts.certificatePdf) {
    const cert = await PDFDocument.load(opts.certificatePdf);
    for (const p of await out.copyPages(cert, cert.getPageIndices())) out.addPage(p);
  }
  const body = await PDFDocument.load(bodyPdf);
  const bodyPages = await out.copyPages(body, body.getPageIndices());
  bodyPages.forEach((p) => out.addPage(p));

  const font = await out.embedFont(StandardFonts.Helvetica);
  const qr = await out.embedPng(await QRCode.toBuffer(opts.verifyUrl, { margin: 0, width: 160 }));
  bodyPages.forEach((page, i) => {
    // Standard fonts are WinAnsi-only: keep footer text ASCII.
    const text = doc.footerText.replace("[[page]]", String(i + 1)).replace("[[pages]]", String(bodyPages.length)).replace(/[^\x20-\x7E]/g, "");
    page.drawText(text, { x: 40, y: 22, size: 7.5, font, color: rgb(0.25, 0.25, 0.25) });
    page.drawImage(qr, { x: page.getWidth() - 62, y: 12, width: 40, height: 40 });
  });
  const pdf = await out.save();
  return { pdf, sha256: createHash("sha256").update(pdf).digest("hex") };
}

/** Editable DOCX with the same content and signature table. */
export async function toDocx(doc: DocModel): Promise<Uint8Array> {
  const p = (text: string, o: { bold?: boolean; center?: boolean; heading?: string } = {}) =>
    new Paragraph({
      alignment: o.center ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
      spacing: { after: 160, line: 320 },
      children: [
        ...(o.heading ? [new TextRun({ text: o.heading, bold: true })] : []),
        ...text.split("\n").map((line, i) => new TextRun({ text: line, bold: o.bold, break: i > 0 ? 1 : 0 })),
      ],
    });
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const sigCells = doc.signatures.map((s) => new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    borders: { top: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, bottom: noBorder, left: noBorder, right: noBorder },
    children: [
      new Paragraph({ spacing: { before: 600 }, children: [new TextRun({ text: s.caption, bold: true })] }),
      new Paragraph({ children: [new TextRun(s.name)] }),
      ...(s.verifiedLine ? [new Paragraph({ children: [new TextRun({ text: `✔ ${s.verifiedLine}`, size: 16, color: "1B5E20" })] })] : []),
    ],
  }));
  const rows: TableRow[] = [];
  for (let i = 0; i < sigCells.length; i += 2) {
    rows.push(new TableRow({ children: [sigCells[i]!, sigCells[i + 1] ?? new TableCell({ borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, children: [new Paragraph("")] })] }));
  }
  const footerText = doc.footerText.split(/\[\[page\]\]|\[\[pages\]\]/);
  const document = new Document({
    creator: "LegalKart Paper Generator",
    title: `${doc.title} ${doc.referenceNo}`,
    styles: { default: { document: { run: { font: "Times New Roman", size: 23 } } } },
    sections: [{
      properties: { page: { margin: { top: 1418, bottom: 1418, left: 1701, right: 1134 } } },
      headers: { default: new Header({ children: doc.watermark ? [p(doc.watermark, { center: true, bold: true })] : [] }) },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: footerText[0] ?? "", size: 15 }),
              new TextRun({ children: [PageNumber.CURRENT], size: 15 }),
              new TextRun({ text: footerText[1] ?? "", size: 15 }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15 }),
              new TextRun({ text: footerText[2] ?? "", size: 15 }),
            ],
          })],
        }),
      },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: doc.title, bold: true, underline: {}, size: 30 })] }),
        ...doc.preamble.map((t) => p(t, { center: /^(BETWEEN|AND)$/.test(t), bold: /^(BETWEEN|AND)$/.test(t) })),
        ...doc.recitals.map((t) => p(t)),
        p("NOW THIS AGREEMENT WITNESSETH AS UNDER:", { center: true, bold: true }),
        ...doc.clauses.map((c) => p(c.text, { heading: `${c.number}. ${c.heading ? `${c.heading}. ` : ""}` })),
        p("IN WITNESS WHEREOF the parties have signed this Agreement on the day, month and year first above written."),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
        ...doc.schedules.flatMap((s) => [p(s.heading ?? "SCHEDULE", { center: true, bold: true }), p(s.text)]),
      ],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
