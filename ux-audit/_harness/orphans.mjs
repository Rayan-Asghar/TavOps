import { chromium } from "@playwright/test";
const b=await chromium.launch();
for (const who of ["ayan@tavren.io","contact@tavren.io"]) {
  const c=await b.newContext({viewport:{width:1440,height:900}}); const p=await c.newPage();
  await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
  await p.fill('input[name="email"]',who); await p.fill('input[name="password"]',"tavren123");
  await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
  for (const r of ["/review","/admin/teams"]) {
    const res = await p.goto("http://localhost:3000"+r,{waitUntil:"networkidle"}).catch(()=>null);
    await p.waitForTimeout(300);
    const h1 = (await p.locator("main h1").first().textContent().catch(()=>null))?.trim() ?? "(none)";
    const activeNav = await p.locator('aside a[aria-current="page"]').count();
    console.log(`${who.padEnd(20)} ${r.padEnd(15)} http=${res?.status()} h1="${h1.slice(0,28)}" activeNavItems=${activeNav}`);
  }
  await c.close();
}
await b.close();
