import { chromium } from "@playwright/test";
const OUT="/tmp/claude-1000/-home-rayan-Desktop-TavrenOPS/cc516926-a772-4cbe-a2e0-6b5ea4ee3a75/scratchpad";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message.split("\n")[0]));
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
const R="from=2026-09-01&to=2026-09-30";
for (const [q,name] of [["","reports-A-tables"],["&v=visual","reports-B-visual"]]) {
  await p.goto(`http://localhost:3000/reports?${R}${q}`,{waitUntil:"networkidle"});
  await p.waitForTimeout(700);
  await p.screenshot({path:`${OUT}/${name}.png`, fullPage:true});
  console.log(name, "· svg elements:", await p.locator("main svg").count());
}
console.log("page errors:", errs.length?errs:"none");
await b.close();
