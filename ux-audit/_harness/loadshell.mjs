import { chromium } from "@playwright/test";
const OUT="/tmp/claude-1000/-home-rayan-Desktop-TavrenOPS/cc516926-a772-4cbe-a2e0-6b5ea4ee3a75/scratchpad";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(1000);
const cdp = await c.newCDPSession(p);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:600,downloadThroughput:20*1024,uploadThroughput:20*1024});
await cdp.send("Emulation.setCPUThrottlingRate",{rate:6});
await p.click('a[href="/reports"]');
for (let i=0;i<25;i++){
  await p.waitForTimeout(160);
  const r = await p.evaluate(()=>({
    sk: !!document.querySelector(".animate-sk-appear"),
    asides: document.querySelectorAll("aside").length,
    headers: document.querySelectorAll("header").length,
  }));
  const op = r.sk ? await p.evaluate(()=>getComputedStyle(document.querySelector(".animate-sk-appear")).opacity) : "0";
  if (r.sk && parseFloat(op) > 0.9) {
    console.log("during loading:", JSON.stringify({...r, opacity: op}));
    await p.screenshot({path:`${OUT}/loading-nested.png`}); break; }
}
await b.close();
