import { chromium } from "@playwright/test";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.goto("http://localhost:3000/reports?from=2026-09-01&to=2026-09-30",{waitUntil:"networkidle"});
await p.waitForTimeout(600);
console.log(await p.evaluate(()=>{
  const out=[];
  document.querySelectorAll("main section").forEach((sec)=>{
    const head=sec.querySelector("h3,.eyebrow")?.textContent?.trim().slice(0,26) ?? "(no head)";
    const row=sec.querySelector("tbody tr, ul > li");
    if(row) out.push({section:head, rowHeight:+row.getBoundingClientRect().height.toFixed(1), rows:sec.querySelectorAll("tbody tr, ul > li").length});
  });
  return out;
}));
await b.close();
