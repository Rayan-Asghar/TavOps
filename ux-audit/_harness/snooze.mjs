import { chromium } from "@playwright/test";
const OUT="/tmp/claude-1000/-home-rayan-Desktop-TavrenOPS/cc516926-a772-4cbe-a2e0-6b5ea4ee3a75/scratchpad";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message.split("\n")[0]));
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(1200);

const body = async () => (await p.locator("body").textContent()) ?? "";
console.log("1. item in queue:        ", (await body()).includes("brand assets"));
console.log("   inbox badge:          ", (await p.locator('a[href="/"] span').last().textContent().catch(()=>"?"))?.trim());

await p.locator('button:has-text("Snooze")').first().click();
await p.waitForTimeout(350);
const choices = await p.locator('button:has-text("In 3 hours"), button:has-text("Tomorrow"), button:has-text("Next week")').count();
console.log("2. presets offered:      ", choices, "(click-activated, not hover)");
await p.screenshot({path:`${OUT}/snooze-open.png`});

await p.locator('button:has-text("Tomorrow")').first().click();
await p.waitForTimeout(2200);
console.log("3. after snoozing:");
console.log("   gone from queue:      ", !(await p.locator('.attention-row').filter({hasText:"brand assets"}).count()));
console.log("   toast offers undo:    ", (await body()).includes("Bring it back"));
console.log("   snoozed list shows:   ", (await body()).includes("1 snoozed"));
console.log("   badge now:            ", (await p.locator('a[href="/"] span').last().textContent().catch(()=>"none"))?.trim() || "none");
await p.screenshot({path:`${OUT}/snooze-after.png`, fullPage:true});

// bring it back from the snoozed list
await p.locator("summary:has-text('snoozed')").click();
await p.waitForTimeout(300);
await p.locator('button:has-text("Bring back")').first().click();
await p.waitForTimeout(2200);
console.log("4. brought back to queue:", (await p.locator('.attention-row').filter({hasText:"brand assets"}).count())>0);
console.log("page errors:", errs.length?errs:"none");
await b.close();
