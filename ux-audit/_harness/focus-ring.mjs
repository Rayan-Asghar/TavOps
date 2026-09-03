import { chromium } from "@playwright/test";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.goto("http://localhost:3000/reports",{waitUntil:"networkidle"});
const read=(el)=>el.evaluate(e=>getComputedStyle(e).outlineColor);
for (const sel of ['a[href="/projects"]','button[type="submit"]','input[name="from"]']){
  const el=p.locator(sel).first(); await el.evaluate(e=>e.blur());
  await el.focus();
  const t0=await read(el);
  await p.waitForTimeout(400);
  const t400=await read(el);
  console.log(`${sel.padEnd(26)} at focus: ${t0.padEnd(22)} after 400ms: ${t400}   ${t0!==t400?"<-- RING ANIMATES IN":"stable"}`);
}
await b.close();
