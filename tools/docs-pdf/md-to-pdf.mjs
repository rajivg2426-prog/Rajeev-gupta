// Markdown → branded A4 PDF (cover page, page numbers, Mermaid diagrams), via headless Chromium.
// Setup (once, in this folder): PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
// Rebuild all PDFs: npm run pdf   (needs Chromium; set CHROMIUM_PATH if not at /opt/pw-browsers/chromium)
// Usage: node build.mjs <input.md> <output.pdf> "<subtitle>"
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Marked } from "marked";
import { chromium } from "playwright-core";

const [, , input, output, subtitle] = process.argv;
const require = createRequire(import.meta.url);
const mermaidJs = readFileSync(require.resolve("mermaid/dist/mermaid.min.js"), "utf8");

const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");
const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
    code({ text, lang }) {
      if (lang === "mermaid") return `<div class="diagram${/^flowchart TD/.test(text) ? " tall" : ""}"><pre class="mermaid">${text}</pre></div>`;
      const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return `<pre><code>${esc}</code></pre>`;
    },
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (href.startsWith("#") || /^https?:/.test(href)) return `<a href="${href}">${inner}</a>`;
      return `<span class="xref">${inner}</span>`; // repo-relative link: not resolvable inside a PDF
    },
  },
});

let md = readFileSync(input, "utf8");
const title = md.match(/^# (.+)$/m)[1];
md = md.replace(/^# .+\n/, ""); // title goes on the cover
const body = marked.parse(md).replace(/<input (checked="" )?disabled="" type="checkbox">/g, (m, c) => `<span class="cb">${c ? "☑" : "☐"}</span>`);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
  @page { size: A4; margin: 20mm 16mm 20mm 16mm; }
  :root { --ink:#1a1f1c; --muted:#5b6660; --brand:#1b5e20; --line:#d9e0dc; --tint:#f2f7f3; }
  body { font-family: "DejaVu Sans", "Noto Sans", Arial, sans-serif; font-size: 9.6pt; line-height: 1.5; color: var(--ink); }
  .cover { height: 247mm; display:flex; flex-direction:column; justify-content:center; page-break-after: always; border-left: 6px solid var(--brand); padding-left: 14mm; }
  .cover .brand { color: var(--brand); font-weight: 700; letter-spacing: .14em; font-size: 10pt; text-transform: uppercase; }
  .cover h1 { font-size: 26pt; line-height: 1.15; margin: 6mm 0 4mm; }
  .cover .sub { color: var(--muted); font-size: 12pt; max-width: 140mm; }
  .cover .meta { margin-top: 18mm; color: var(--muted); font-size: 9pt; }
  h2 { font-size: 15pt; color: var(--brand); border-bottom: 2px solid var(--line); padding-bottom: 2mm; margin: 9mm 0 3mm; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 6mm 0 2mm; break-after: avoid; }
  h4 { font-size: 10pt; margin: 4mm 0 1mm; break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  a { color: var(--brand); text-decoration: none; }
  .xref { font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 8.6pt; break-inside: auto; }
  tr { break-inside: avoid; }
  th { background: var(--tint); text-align: left; }
  th, td { border: 1px solid var(--line); padding: 1.6mm 2mm; vertical-align: top; }
  code { font-family: "DejaVu Sans Mono", monospace; font-size: 8.2pt; background: var(--tint); padding: 0 1mm; border-radius: 2px; }
  pre { background: var(--tint); border: 1px solid var(--line); padding: 3mm; white-space: pre-wrap; word-break: break-word; font-size: 7.8pt; break-inside: avoid; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 3mm 0; padding: 2mm 4mm; border-left: 4px solid var(--brand); background: var(--tint); color: #2b332e; break-inside: avoid; }
  blockquote p { margin: 1mm 0; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 6mm 0; }
  .diagram { break-inside: avoid; text-align: center; margin: 4mm 0; }
  .diagram pre { background: none; border: 0; }
  .diagram svg { max-width: 100%; max-height: 228mm; height: auto; }
  .diagram.tall { break-before: page; }
  .cb { font-size: 11pt; margin-right: 1mm; }
  ul.contains-task-list, li.task-list-item { list-style: none; }
</style></head><body>
<section class="cover"><div class="brand">LegalKart Paper Generator</div><h1>${title.replace(/^LegalKart Paper Generator:\s*/, "")}</h1>
<div class="sub">${subtitle}</div><div class="meta">Version 1.0 · October 2026 · India</div></section>
${body}
<script>${mermaidJs}</script>
<script>mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose", flowchart: { htmlLabels: true, rankSpacing: 18, nodeSpacing: 22, padding: 6, wrappingWidth: 260 }, themeVariables: { fontSize: "15px" } });
mermaid.run({ querySelector: ".mermaid" }).then(() => { window.__done = true; }).catch(e => { window.__err = String(e); window.__done = true; });</script>
</body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
const err = await page.evaluate(() => window.__err);
if (err) console.error("mermaid:", err);
const footer = `<div style="font-family:DejaVu Sans,Arial;font-size:7pt;color:#5b6660;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>${title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
writeFileSync(output, await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer }));
await browser.close();
console.log("wrote", output);
