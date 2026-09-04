import { chromium } from "@playwright/test";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
let fullLoads=0;
p.on("load", () => fullLoads++);
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(1200);

// Tag the sidebar node. If it survives navigation, the shell persisted.
await p.evaluate(()=>{ const a=document.querySelector("aside"); if(a) a.dataset.tag="original"; });
const before = fullLoads;

await p.click('a[href="/projects"]');
await p.waitForURL("**/projects"); await p.waitForTimeout(900);

const r = await p.evaluate(()=>{
  const a=document.querySelector("aside");
  return { sidebarSurvived: a?.dataset.tag === "original",
           sidebarExists: !!a };
});
console.log("navigating dashboard -> /projects");
console.log("  full page loads during nav:", fullLoads - before, "(0 = client-side routing works)");
console.log("  sidebar DOM node survived: ", r.sidebarSurvived, r.sidebarExists?"":"(no aside found!)");
console.log("  => the sidebar is", r.sidebarSurvived ? "PERSISTENT" : "REMOUNTED on every navigation");
await b.close();
