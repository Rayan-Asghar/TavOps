import { chromium } from "@playwright/test";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(1200);
await p.locator('button:has-text("Dismiss")').first().click();
// poll until it mounts, then read the animation immediately
for (let i=0;i<60;i++){
  const r = await p.evaluate(()=>{
    const el=document.querySelector("div.pointer-events-auto");
    if(!el) return null; const cs=getComputedStyle(el);
    return {cls: el.className.match(/animate-toast-\w+/)?.[0] ?? "(none)",
            name: cs.animationName, dur: cs.animationDuration, ease: cs.animationTimingFunction};
  });
  if (r) { console.log("on appear:", JSON.stringify(r)); break; }
  await p.waitForTimeout(50);
}
// and on the way out
await p.locator("div.pointer-events-auto").first().hover();
await p.waitForTimeout(400);
await p.locator('button[aria-label="Dismiss notification"]').first().click();
await p.waitForTimeout(60);
console.log("on exit:", JSON.stringify(await p.evaluate(()=>{
  const el=document.querySelector("div.pointer-events-auto");
  if(!el) return "already gone"; const cs=getComputedStyle(el);
  return {cls: el.className.match(/animate-toast-\w+/)?.[0] ?? "(none)", name: cs.animationName, dur: cs.animationDuration};
})));
await b.close();
