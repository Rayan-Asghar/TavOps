import { chromium } from "@playwright/test";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.goto("http://localhost:3000/log",{waitUntil:"networkidle"}); await p.waitForTimeout(700);
console.log("buttons on /log:");
for (const t of (await p.locator("main button").allTextContents()).slice(0,8))
  console.log("  ", JSON.stringify(t.replace(/\s+/g," ").trim().slice(0,60)));
console.log("textareas before expanding:", await p.locator("textarea").count());
await b.close();
