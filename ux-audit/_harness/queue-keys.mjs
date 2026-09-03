import { chromium } from "@playwright/test";
const OUT="/tmp/claude-1000/-home-rayan-Desktop-TavrenOPS/cc516926-a772-4cbe-a2e0-6b5ea4ee3a75/scratchpad";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message.split("\n")[0]));
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(1400);

const cursorAt = () => p.evaluate(()=>{
  const rows=[...document.querySelectorAll(".attention-row")];
  const i=rows.findIndex(r=>r.getAttribute("aria-current")==="true");
  return {index:i, total:rows.length,
          title: i>=0 ? rows[i].querySelector("strong")?.textContent?.slice(0,34) : null};
});
console.log("1. at rest (mouse-only session):", JSON.stringify(await cursorAt()), "-> no cursor shown");

await p.keyboard.press("j"); await p.waitForTimeout(200);
console.log("2. after J:                     ", JSON.stringify(await cursorAt()));
await p.keyboard.press("j"); await p.waitForTimeout(200);
console.log("3. after J again:               ", JSON.stringify(await cursorAt()));
await p.keyboard.press("k"); await p.waitForTimeout(200);
console.log("4. after K:                     ", JSON.stringify(await cursorAt()));
await p.screenshot({path:`${OUT}/queue-cursor.png`});

// no animation on cursor movement (5.2 [FAIL IF])
console.log("5. row transition-duration:     ", await p.evaluate(()=>{
  const r=document.querySelector('.attention-row[aria-current="true"]');
  return r? getComputedStyle(r).transitionDuration : "n/a";}), "(must be 0s)");

const before=(await cursorAt()).total;
await p.keyboard.press("e"); await p.waitForTimeout(2500);
const after=await cursorAt();
console.log("6. E dismissed a row:           ", before, "->", after.total);

await p.keyboard.press("s"); await p.waitForTimeout(2500);
console.log("7. S snoozed a row:             ", after.total, "->", (await cursorAt()).total);
console.log("   snoozed list present:        ", ((await p.locator("body").textContent())??"").includes("snoozed"));

// r14: bare letters must not fire while typing
await p.goto("http://localhost:3000/projects",{waitUntil:"networkidle"});
await p.locator('input[name="q"]').first().fill("");
await p.locator('input[name="q"]').first().type("jokes");
console.log("8. typing 'jokes' in a field:   ", JSON.stringify(await p.locator('input[name="q"]').first().inputValue()));
console.log("page errors:", errs.length?errs:"none");
await b.close();
