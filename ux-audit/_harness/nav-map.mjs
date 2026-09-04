import { chromium } from "@playwright/test";
const b=await chromium.launch();
for (const who of ["contact@tavren.io","ayan@tavren.io","saqlain@tavren.io"]) {
  const c=await b.newContext({viewport:{width:1440,height:900}}); const p=await c.newPage();
  await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
  await p.fill('input[name="email"]',who); await p.fill('input[name="password"]',"tavren123");
  await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
  await p.waitForTimeout(800);
  const nav = await p.evaluate(()=>[...document.querySelectorAll("aside nav a")].map(a=>a.getAttribute("href")));
  const role = (await p.locator("aside").textContent())?.match(/(Admin|Developer|Sales|Head|Collaborator)/i)?.[0] ?? "?";
  console.log(`${who.padEnd(22)} ${role.padEnd(11)} ${nav.length} nav items: ${nav.join(" ")}`);
  // which routes are reachable but NOT in the nav?
  const orphans=[];
  for (const r of ["/review","/admin/teams","/projects/new"]) {
    const res = await p.goto("http://localhost:3000"+r,{waitUntil:"domcontentloaded"}).catch(()=>null);
    if (res && res.status()<400 && !nav.includes(r)) orphans.push(r);
  }
  console.log(`${"".padEnd(22)} reachable but not in nav: ${orphans.join(", ")||"none"}`);
  await c.close();
}
await b.close();
