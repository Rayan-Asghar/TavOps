import { chromium } from "@playwright/test";
const OUT="/tmp/claude-1000/-home-rayan-Desktop-TavrenOPS/cc516926-a772-4cbe-a2e0-6b5ea4ee3a75/scratchpad";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(1200);

const visible = async () => (await p.locator("div.pointer-events-auto").count()) > 0;

// 1. dismiss a blocker -> toast appears, animates in
await p.locator('button:has-text("Dismiss")').first().click();
await p.waitForTimeout(90);
const anim = await p.evaluate(()=>{
  const el=document.querySelector("div.pointer-events-auto");
  if(!el) return null; const cs=getComputedStyle(el);
  return { name: cs.animationName, dur: cs.animationDuration, ease: cs.animationTimingFunction };
});
console.log("1. on appear:", JSON.stringify(anim));
await p.screenshot({path:`${OUT}/toast.png`});

// 2. how long does it live, untouched?
const t0 = Date.now();
for (let i=0;i<40;i++){ await p.waitForTimeout(120); if(!(await visible())) break; }
console.log("2. lived for ~", Math.round((Date.now()-t0)/100)*100, "ms  (asked: 2000 max)");

// 3. hovering holds it open
await p.locator('button:has-text("Dismiss")').first().click();
await p.waitForTimeout(300);
await p.locator("div.pointer-events-auto").first().hover();
await p.waitForTimeout(3200);
console.log("3. still there after 3.2s of hover:", await visible(), "(undo stays reachable)");
await p.mouse.move(10,10);
await p.waitForTimeout(2600);
console.log("4. clears once the pointer leaves:", !(await visible()));
await b.close();
