import { chromium } from "@playwright/test";
const OUT="/tmp/claude-1000/-home-rayan-Desktop-TavrenOPS/cc516926-a772-4cbe-a2e0-6b5ea4ee3a75/scratchpad";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"ayan@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(1200);
console.log("Ayan's dashboard streams:");
for (const sec of await p.locator("main section.panel").all()) {
  const eyebrow = (await sec.locator(".eyebrow").first().textContent().catch(()=>null))?.trim();
  if (!eyebrow) continue;
  const h = (await sec.locator("h3").first().textContent().catch(()=>""))?.trim();
  const rows = await sec.locator("li.attention-row strong").allTextContents();
  console.log(`  ${eyebrow.padEnd(22)} ${h}   ${rows.map(r=>`"${r.slice(0,34)}"`).join(", ")}`);
}
await p.screenshot({path:`${OUT}/ayan.png`, fullPage:true});
await b.close();
