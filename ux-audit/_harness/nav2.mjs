import { chromium } from "@playwright/test";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(1200);
await p.evaluate(()=>{ document.querySelector("aside").dataset.tag="original"; });
for (const href of ["/projects","/reports","/timesheet","/log","/"]) {
  await p.click(`a[href="${href}"]`);
  await p.waitForTimeout(900);
  const r = await p.evaluate(()=>({
    survived: document.querySelector("aside")?.dataset.tag === "original",
    asides: document.querySelectorAll("aside").length,
  }));
  console.log(`  -> ${href.padEnd(11)} sidebar kept: ${r.survived}   <aside> count: ${r.asides}`);
}
await b.close();
