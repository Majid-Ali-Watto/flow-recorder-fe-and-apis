// Regenerates html/privacy.html and html/terms.html from PRIVACY.md / TERMS.md.
// Run after editing either Markdown file:  node scripts/build-legal-pages.mjs
// Supports the small Markdown subset those files use: headings, paragraphs,
// bold, inline code, links, tables and lists.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(text) {
  let t = escape(text);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    href = { "PRIVACY.md": "privacy.html", "TERMS.md": "terms.html" }[href] || href;
    const ext = href.startsWith("http") ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${href}"${ext}>${label}</a>`;
  });
  return t;
}

function convert(md) {
  const lines = md.split("\n");
  const out = [];
  let title = "";
  let i = 0;
  const isList = (l) => /^(- |\d+\. )/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("# ")) {
      title = l.slice(2);
      out.push(`<h1>${inline(title)}</h1>`);
    } else if (l.startsWith("## ")) out.push(`<h2>${inline(l.slice(3))}</h2>`);
    else if (l.startsWith("### ")) out.push(`<h3>${inline(l.slice(4))}</h3>`);
    else if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i].replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      const [head, , ...body] = rows;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
          body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
          "</tbody></table></div>",
      );
      continue;
    } else if (isList(l)) {
      const tag = /^\d/.test(l) ? "ol" : "ul";
      const items = [];
      while (i < lines.length && isList(lines[i])) items.push(lines[i++].replace(/^(- |\d+\. )/, ""));
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${tag}>`);
      continue;
    } else if (l.trim()) {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#|\||- |\d+\. )/.test(lines[i])) para.push(lines[i++]);
      out.push(`<p>${para.map(inline).join("<br />")}</p>`);
      continue;
    }
    i++;
  }
  return { title, body: out.join("\n      ") };
}

function build(src, dst, otherHref, otherLabel) {
  const { title, body } = convert(readFileSync(join(ROOT, src), "utf8"));
  const pageTitle = title.split("—").pop().trim();
  writeFileSync(
    join(ROOT, dst),
    `<!doctype html>
<!-- Generated from ${src} by scripts/build-legal-pages.mjs — edit the Markdown, then rerun the script. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escape(pageTitle)} · Flow Recorder</title>
    <script src="../js/theme-init.js"></script>
    <link rel="stylesheet" href="../styles/base.css" />
    <link rel="stylesheet" href="../styles/legal.css" />
  </head>
  <body>
    <header class="legal-header">
      <div class="brand">
        <img class="brand-logo" src="../icons/icon48.png" alt="" />
        <span class="brand-name">Flow <span class="grad">Recorder</span></span>
      </div>
      <nav class="legal-nav">
        <a href="privacy.html"${dst.endsWith("privacy.html") ? ' aria-current="page"' : ""}>Privacy Policy</a>
        <a href="terms.html"${dst.endsWith("terms.html") ? ' aria-current="page"' : ""}>Terms of Use</a>
      </nav>
    </header>
    <main class="legal">
      ${body}
    </main>
    <footer class="dev-footer">
      <span class="dev-name">Majid Ali</span>
      <span class="dev-role">Full Stack Web Developer</span>
      <div class="dev-links">
        <a href="https://majidev.netlify.app" target="_blank" rel="noopener noreferrer">majidev.netlify.app</a>
        <span class="dev-sep">·</span>
        <a href="https://github.com/Majid-Ali-Watto" target="_blank" rel="noopener noreferrer">github.com/Majid-Ali-Watto</a>
        <span class="dev-sep">·</span>
        <a href="${otherHref}">${otherLabel}</a>
      </div>
    </footer>
  </body>
</html>
`,
  );
  console.log(`wrote ${dst}`);
}

build("PRIVACY.md", "html/privacy.html", "terms.html", "Terms of Use");
build("TERMS.md", "html/terms.html", "privacy.html", "Privacy Policy");
