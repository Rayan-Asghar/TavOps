import { chromium } from "@playwright/test";
const OUT="/tmp/claude-1000/-home-rayan-Desktop-TavrenOPS/cc516926-a772-4cbe-a2e0-6b5ea4ee3a75/scratchpad";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(800);

const cdp = await c.newCDPSession(p);
await cdp.send("Network.enable");
// Throttle rather than block: the loading UI arrives early in the RSC stream, so
// blocking the request suppresses the very thing under test.
await cdp.send("Network.emulateNetworkConditions",
  {offline:false, latency:600, downloadThroughput:20*1024, uploadThroughput:20*1024});
await cdp.send("Emulation.setCPUThrottlingRate",{rate:6});

await p.click('a[href="/reports"]');
let best=null;
for (let i=0;i<24;i++){
  await p.waitForTimeout(180);
  const st = await p.evaluate(()=>{
    const sk=document.querySelector(".animate-sk-appear");
    return {path:location.pathname, sk:!!sk, op: sk?getComputedStyle(sk).opacity:null,
            tiles:document.querySelectorAll(".animate-sk-appear .bg-surface-2").length};
  });
  if (st.sk && parseFloat(st.op)>0.9 && !best){ best=st; await p.screenshot({path:`${OUT}/loading-reports.png`}); }
  if (st.tiles===0 && best) break;
}
console.log(best ? `SKELETON RENDERED: ${JSON.stringify(best)}` : "skeleton never appeared");
await b.close();
