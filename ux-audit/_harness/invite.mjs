import { chromium } from "@playwright/test";
const OUT="/tmp/claude-1000/-home-rayan-Desktop-TavrenOPS/cc516926-a772-4cbe-a2e0-6b5ea4ee3a75/scratchpad";
const B="http://localhost:3000";
const stamp = Date.now();
const EMAIL = `invitee.${stamp}@example.test`;
const PASSWORD = "correct-horse-battery-staple";

const b = await chromium.launch();
const errs=[];

// ---- 1. admin creates the account -----------------------------------------
const admin = await b.newContext({viewport:{width:1440,height:900}});
const p = await admin.newPage();
p.on("pageerror", e => errs.push("admin: " + e.message.split("\n")[0]));
await p.goto(`${B}/login`, {waitUntil:"networkidle"});
await p.fill('input[name="email"]', "contact@tavren.io");
await p.fill('input[name="password"]', "tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}), p.click('button[type="submit"]')]);
await p.goto(`${B}/admin/users`, {waitUntil:"networkidle"});

await p.fill('input[name="name"]', `Invitee ${stamp}`);
await p.fill('input[name="email"]', EMAIL);
await p.click('form button[type="submit"]:has-text("Create")').catch(async () => {
  await p.locator('form').filter({has: p.locator('input[name="email"]')}).locator('button[type="submit"]').first().click();
});
await p.waitForTimeout(2500);

// CopyField renders the value in a <code>, not an input.
const inviteUrl = await p.locator('code').filter({hasText:'/invite/'}).first()
  .textContent().catch(()=>null);
console.log("1. admin created the account");
console.log("   still offers a password:", ((await p.locator('[role="status"]').first().textContent().catch(()=>"")) ?? "").toLowerCase().includes("password"));
console.log("   invite link handed over:", inviteUrl ? inviteUrl.replace(/\/invite\/.*/, "/invite/<token>") : "NONE");
await p.screenshot({path:`${OUT}/invite-created.png`});

if (!inviteUrl) { console.log("no link — stopping"); await b.close(); process.exit(1); }

// ---- 2. the invitee, with no session ---------------------------------------
const guest = await b.newContext({viewport:{width:1440,height:900}});
const g = await guest.newPage();
g.on("pageerror", e => errs.push("guest: " + e.message.split("\n")[0]));
await g.goto(inviteUrl, {waitUntil:"networkidle"});
console.log("2. invitee opens the link with no session");
console.log("   stayed on /invite (not bounced to login):", new URL(g.url()).pathname.startsWith("/invite"));
const gbody = (await g.locator("main").textContent()) ?? "";
console.log("   greets them by name: ", /Welcome/i.test(gbody));
await g.screenshot({path:`${OUT}/invite-page.png`});

// ---- 3. set a password ------------------------------------------------------
await g.fill('input[name="password"]', PASSWORD);
await g.fill('input[name="confirm"]', PASSWORD);
await g.click('button[type="submit"]');
await g.waitForTimeout(2500);
console.log("3. password set:", ((await g.locator("main").textContent()) ?? "").includes("sign in"));

// ---- 4. the link is spent ----------------------------------------------------
const g2 = await (await b.newContext()).newPage();
await g2.goto(inviteUrl, {waitUntil:"networkidle"});
console.log("4. same link a second time:", /no longer valid|expired/i.test((await g2.locator("main").textContent()) ?? "") ? "refused" : "STILL WORKS (bad)");

// ---- 5. they can actually sign in -------------------------------------------
const u = await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await u.goto(`${B}/login`, {waitUntil:"networkidle"});
await u.fill('input[name="email"]', EMAIL);
await u.fill('input[name="password"]', PASSWORD);
await Promise.all([u.waitForURL(x=>!x.pathname.startsWith("/login"),{timeout:15000}).catch(()=>{}), u.click('button[type="submit"]')]);
console.log("5. signs in with the new password:", new URL(u.url()).pathname === "/" ? "yes" : `no (${new URL(u.url()).pathname})`);

console.log("page errors:", errs.length ? errs : "none");
console.log("EMAIL", EMAIL);
await b.close();
