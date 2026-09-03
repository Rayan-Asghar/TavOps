import { chromium } from "@playwright/test";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.goto("http://localhost:3000/reports",{waitUntil:"networkidle"});
await p.waitForTimeout(400);
console.log(await p.evaluate(()=>{
  const box=[...document.querySelectorAll("div.overflow-auto")].pop();
  const th=box.querySelector("th");
  // Seeded data is only 10 rows, so force overflow to exercise the mechanism.
  box.style.maxHeight="160px";
  const before=Math.round(th.getBoundingClientRect().top-box.getBoundingClientRect().top);
  box.scrollTop=300;
  const after=Math.round(th.getBoundingClientRect().top-box.getBoundingClientRect().top);
  return {maxHeightApplied:getComputedStyle(box).maxHeight, scrolled:box.scrollTop,
          headerOffsetBefore:before, headerOffsetAfter:after,
          sticks: before===0 && after===0,
          headerBg:getComputedStyle(th).backgroundColor};
}));
await b.close();
