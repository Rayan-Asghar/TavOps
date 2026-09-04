import { chromium } from "@playwright/test";
const who = process.argv[2] ?? "contact@tavren.io";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',who); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(900);
const routes=["/","/log","/timesheet","/projects","/reports","/sales","/audit","/admin/users"];
console.log(`as ${who}`);
console.log("route".padEnd(15),"panels","headings","links","buttons","pageH","screens");
for (const r of routes){
  const res = await p.goto("http://localhost:3000"+r,{waitUntil:"networkidle"}).catch(()=>null);
  if(!res || res.status()>=400){ console.log(r.padEnd(15),"— not available at this role"); continue; }
  await p.waitForTimeout(400);
  const m = await p.evaluate(()=>({
    panels: document.querySelectorAll("main .panel").length,
    headings: document.querySelectorAll("main h1, main h2, main h3").length,
    links: document.querySelectorAll("main a").length,
    buttons: document.querySelectorAll("main button").length,
    h: Math.round(document.querySelector("main").scrollHeight),
  }));
  console.log(r.padEnd(15), String(m.panels).padEnd(6), String(m.headings).padEnd(8),
              String(m.links).padEnd(5), String(m.buttons).padEnd(7),
              String(m.h).padEnd(5), (m.h/900).toFixed(1));
}
await b.close();
