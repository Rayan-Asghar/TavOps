import { chromium } from "@playwright/test";
const OUT="/tmp/claude-1000/-home-rayan-Desktop-TavrenOPS/cc516926-a772-4cbe-a2e0-6b5ea4ee3a75/scratchpad";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
const errs=[]; p.on("pageerror",e=>errs.push(e.message.split("\n")[0]));
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(1200);

const dlg = () => p.locator('[role="dialog"]');
const seen = async () => (await dlg().count()) > 0 && await dlg().first().isVisible();

console.log("1. closed at rest:            ", !(await seen()));

// remember what had focus, to check it comes back
await p.locator('a[href="/projects"]').first().focus();
await p.keyboard.press("Control+k");
await p.waitForTimeout(500);
console.log("2. ctrl+K opens:              ", await seen());

const rows = await p.locator('[cmdk-item]').allTextContents();
console.log("3. rows:                      ", rows.length);
console.log("   groups:                    ", (await p.locator('[cmdk-group-heading]').allTextContents()).join(" | "));
console.log("   shows shortcuts (2.1):     ", rows.some(r=>/G\s?[A-Z]/.test(r)));
console.log("   sample:", rows.slice(0,4).map(r=>r.replace(/\s+/g," ").trim()).join(" // "));
await p.screenshot({path:`${OUT}/palette.png`});

// filtering
await p.keyboard.type("rep");
await p.waitForTimeout(400);
console.log("4. filters to:                ", (await p.locator('[cmdk-item]').allTextContents()).map(r=>r.replace(/\s+/g," ").trim()));

await p.keyboard.press("Escape");
await p.waitForTimeout(400);
console.log("5. Escape closes:             ", !(await seen()));
console.log("   focus restored to opener:  ", await p.evaluate(()=>document.activeElement?.getAttribute("href")));

// G-then-letter, and that it does NOT fire while typing
await p.keyboard.press("g"); await p.keyboard.press("r");
await p.waitForTimeout(1200);
console.log("6. 'G R' jumped to:           ", new URL(p.url()).pathname);

await p.goto("http://localhost:3000/projects",{waitUntil:"networkidle"});
await p.locator('input[name="q"]').first().focus().catch(()=>{});
await p.keyboard.type("gr");
await p.waitForTimeout(700);
console.log("7. typing 'gr' in a field:    ", new URL(p.url()).pathname, "(must stay /projects)");
console.log("   field kept the text:       ", JSON.stringify(await p.locator('input[name="q"]').first().inputValue().catch(()=>"n/a")));
console.log("page errors:", errs.length? errs : "none");
await b.close();
