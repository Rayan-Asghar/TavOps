import { chromium } from "@playwright/test";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message.split("\n")[0]));
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);

await p.goto("http://localhost:3000/log",{waitUntil:"networkidle"});
await p.waitForTimeout(600);
await p.locator("main button").filter({hasText:/General work/}).first().click();
await p.waitForTimeout(400);

const notes = p.locator('textarea[name="internalNotes"]').first();
const hours = p.locator('input[name="hours"]').first();
if (!(await notes.count())) { console.log("no log row found"); await b.close(); process.exit(0); }

await hours.fill("3.5");
await notes.fill("Hero section done, nav still flaky on Safari");
await p.waitForTimeout(400);
console.log("1. typed:                 hours=3.5, note set");

// client-side navigation away and back
await p.click('a[href="/projects"]'); await p.waitForTimeout(1200);
await p.goto("http://localhost:3000/log",{waitUntil:"networkidle"}); await p.waitForTimeout(700);
await p.locator("main button").filter({hasText:/General work/}).first().click();
await p.waitForTimeout(500);
console.log("2. after navigating away and back:");
console.log("   hours restored:        ", JSON.stringify(await p.locator('input[name="hours"]').first().inputValue()));
console.log("   note restored:         ", JSON.stringify((await p.locator('textarea[name="internalNotes"]').first().inputValue()).slice(0,44)));

// a hard reload, not just a client nav
await p.reload({waitUntil:"networkidle"}); await p.waitForTimeout(700);
await p.locator("main button").filter({hasText:/General work/}).first().click();
await p.waitForTimeout(500);
console.log("3. after a hard reload:");
console.log("   note still there:      ", JSON.stringify((await p.locator('textarea[name="internalNotes"]').first().inputValue()).slice(0,44)));

console.log("4. single column (r24):   ", (await p.locator('form .grid.grid-cols-2').count())===0);
console.log("page errors:", errs.length?errs:"none");
await b.close();
