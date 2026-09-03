/**
 * UX audit capture harness — implements uxaudit.md Phase 2.
 * Writes only into ux-audit/. Changes no application code.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = process.env.EMAIL ?? "contact@tavren.io";
const PASS = process.env.PASS ?? "tavren123";
const OUT = resolve(process.argv[2] ?? "ux-audit");
const VIEW = { width: 1440, height: 900 };

const ROUTES = [
  ["/", "01-needs-attention"],
  ["/log", "02-log-work"],
  ["/timesheet", "03-timesheet"],
  ["/projects", "04-projects"],
  ["/reports", "05-reports"],
  ["/review", "06-review"],
  ["/sales", "07-sales"],
  ["/audit", "08-audit"],
  ["/admin/users", "09-admin-users"],
  ["/admin/teams", "10-admin-teams"],
  ["/admin/sheets", "11-admin-sheets"],
  ["/projects/new", "12-project-new"],
];

for (const d of ["screens", "states", "flows"]) mkdirSync(`${OUT}/${d}`, { recursive: true });

/* ---------- in-page measurement (uxaudit.md Phase 2 step 5) ---------- */
const MEASURE = () => {
  const px = (v) => parseFloat(v) || 0;
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const parse = (s) => { const m = String(s).match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : null; };
  const alphaOf = (s) => { const p = parse(s); return p && p.length === 4 ? p[3] : 1; };
  const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  // effective background: walk ancestors until a non-transparent bg
  const bgOf = (el) => {
    let n = el, stack = [];
    while (n && n.nodeType === 1) {
      const c = getComputedStyle(n).backgroundColor, a = alphaOf(c), p = parse(c);
      if (p && a > 0) { stack.push([p.slice(0, 3), a]); if (a >= 1) break; }
      n = n.parentElement;
    }
    let base = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i][0], base, stack[i][1]);
    return base;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

  const out = {
    fontSizes: {}, fontWeights: {}, spacings: {}, radii: {}, transitions: {},
    contrast: [], rowMetrics: [], hitTargets: [], focusRing: null, tabularNums: { with: 0, without: 0, numericLooking: [] },
  };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  // sr-only text is clipped to a 1x1 box and never painted, so its contrast is
  // meaningless -- but a naive width/height check counts it. Excluding it here
  // rather than filtering downstream, so the reported number is the real one.
  const VISIBLE = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    if (cs.clipPath && cs.clipPath !== "none" && /inset\(\s*50%/.test(cs.clipPath)) return false;
    return true;
  };

  for (const el of document.querySelectorAll("body *")) {
    if (!VISIBLE(el)) continue;
    const cs = getComputedStyle(el);
    bump(out.fontSizes, cs.fontSize);
    bump(out.fontWeights, cs.fontWeight);
    if (cs.borderRadius !== "0px") bump(out.radii, cs.borderRadius);
    for (const p of ["paddingTop", "paddingLeft", "marginBottom", "gap"]) {
      const v = cs[p]; if (v && v !== "0px" && v !== "normal") bump(out.spacings, v);
    }
    if (cs.transitionDuration !== "0s")
      bump(out.transitions, `${cs.transitionProperty} ${cs.transitionDuration} ${cs.transitionTimingFunction}`);

    // contrast for text-bearing leaf-ish nodes
    const txt = (el.textContent || "").trim();
    if (txt && txt.length < 200 && el.children.length === 0) {
      const fg = parse(cs.color);
      if (fg) {
        const r = ratio(over(fg.slice(0, 3), bgOf(el), alphaOf(cs.color)), bgOf(el));
        const size = px(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
        const large = size >= 24 || (bold && size >= 18.66);
        out.contrast.push({
          text: txt.slice(0, 40), ratio: +r.toFixed(2), fontSize: size, weight: cs.fontWeight,
          large, required: large ? 3 : 4.5, pass: r >= (large ? 3 : 4.5),
          cls: (el.className || "").toString().slice(0, 60),
        });
      }
      // tabular-nums coverage on numeric-looking content
      if (/^[\s$£€]*[\d.,:]+\s*(h|hrs?|%|m)?$/i.test(txt)) {
        const fv = cs.fontVariantNumeric || "";
        if (/tabular-nums/.test(fv)) out.tabularNums.with++;
        else { out.tabularNums.without++; if (out.tabularNums.numericLooking.length < 25)
          out.tabularNums.numericLooking.push({ text: txt.slice(0, 20), cls: (el.className || "").toString().slice(0, 60), font: cs.fontFamily.split(",")[0] }); }
      }
    }
  }

  // table row heights + cell padding
  for (const tb of document.querySelectorAll("table")) {
    const rows = tb.querySelectorAll("tbody tr");
    if (!rows.length) continue;
    const cs = getComputedStyle(rows[0].querySelector("td") || rows[0]);
    out.rowMetrics.push({
      rows: rows.length,
      rowHeight: +rows[0].getBoundingClientRect().height.toFixed(1),
      padY: cs.paddingTop, padX: cs.paddingLeft,
      headSticky: getComputedStyle(tb.querySelector("th") || tb).position,
    });
  }

  // hit targets for small interactive elements
  for (const el of document.querySelectorAll("button, a, [role=button], input[type=checkbox]")) {
    if (!VISIBLE(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) out.hitTargets.push({
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
      inRow: !!el.closest("tr, li"), passAA: r.width >= 24 && r.height >= 24,
    });
  }
  return out;
};

/* ---------- run ---------- */
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
const page = await ctx.newPage();

// login
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
if (await page.locator('input[name="password"]').count()) {
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), page.click('button[type="submit"]')]);
}
console.log("logged in ->", page.url());

const results = { capturedAt: new Date().toISOString(), viewport: VIEW, routes: {} };

for (const theme of ["light", "dark"]) {
  await ctx.addCookies([{ name: "tavren_theme", value: theme, url: BASE }]);
  for (const [path, name] of ROUTES) {
    try {
      await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/screens/${name}.${theme}.png`, fullPage: true });
      if (theme === "light") {
        results.routes[path] = await page.evaluate(MEASURE);
        results.routes[path].title = await page.title();
        results.routes[path].h1 = await page.locator("h1").first().textContent().catch(() => null);
        results.routes[path].activeNav = await page.locator('a[aria-current="page"]').count();
      }
      console.log(`  ${theme} ${path}`);
    } catch (e) { console.log(`  FAIL ${theme} ${path}: ${e.message.split("\n")[0]}`); }
  }
}

writeFileSync(`${OUT}/measurements.json`, JSON.stringify(results, null, 2));
console.log("wrote measurements.json");
await browser.close();
