import { chromium } from "@playwright/test";
const OUT="/tmp/claude-1000/-home-rayan-Desktop-TavrenOPS/cc516926-a772-4cbe-a2e0-6b5ea4ee3a75/scratchpad";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.goto("http://localhost:3000/projects",{waitUntil:"networkidle"});
await p.waitForTimeout(500);
console.log("1. default:", (await p.locator("article.panel").count())>0 ? "cards" : "list");

await p.locator('button[name="density"][value="compact"]').click();
await p.waitForTimeout(1400);
console.log("2. after choosing List:", (await p.locator("table").count())>0 ? "list" : "cards");
console.log("   row height:", await p.evaluate(()=>{
  const r=document.querySelector("tbody tr"); return r? Math.round(r.getBoundingClientRect().height)+"px" : "n/a";}), "(1.1 wants 32-40)");
await p.screenshot({path:`${OUT}/proj-list.png`, fullPage:true});

// does it survive a navigation and come back?
await p.goto("http://localhost:3000/reports",{waitUntil:"networkidle"});
await p.goto("http://localhost:3000/projects",{waitUntil:"networkidle"});
await p.waitForTimeout(400);
console.log("3. persists across navigation:", (await p.locator("table").count())>0);

// sticky header inside the scroller
console.log("4. header sticks:", await p.evaluate(()=>{
  const box=document.querySelector("div.overflow-auto"); const th=box?.querySelector("th");
  if(!box||!th) return "n/a";
  box.style.maxHeight="120px";
  const before=Math.round(th.getBoundingClientRect().top-box.getBoundingClientRect().top);
  box.scrollTop=200;
  const after=Math.round(th.getBoundingClientRect().top-box.getBoundingClientRect().top);
  return before===0 && after===0;
}));
await p.locator('button[name="density"][value="comfortable"]').click();
await p.waitForTimeout(1200);
console.log("5. back to cards:", (await p.locator("article.panel").count())>0);
await b.close();
