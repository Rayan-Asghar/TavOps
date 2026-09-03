import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const BASE="http://localhost:3000", OUT="ux-audit";
const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto(`${BASE}/login`,{waitUntil:"networkidle"});
await p.fill('input[name="email"]',"contact@tavren.io"); await p.fill('input[name="password"]',"tavren123");
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login")).catch(()=>{}),p.click('button[type="submit"]')]);

const res={};
for (const route of ["/","/log","/timesheet","/projects","/reports"]) {
  await p.goto(BASE+route,{waitUntil:"networkidle"}); await p.waitForTimeout(300);
  const seq=[];
  await p.evaluate(()=>document.body.focus());
  for (let i=0;i<28;i++){
    await p.keyboard.press("Tab");
    const info=await p.evaluate(()=>{
      const e=document.activeElement; if(!e||e===document.body)return null;
      const cs=getComputedStyle(e), r=e.getBoundingClientRect();
      return {tag:e.tagName.toLowerCase(),
        label:(e.getAttribute("aria-label")||e.textContent||e.getAttribute("name")||"").trim().slice(0,34),
        outlineW:cs.outlineWidth, outlineStyle:cs.outlineStyle, outlineColor:cs.outlineColor,
        boxShadow:cs.boxShadow==="none"?null:cs.boxShadow.slice(0,40),
        x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)};
    });
    if(!info) break; seq.push(info);
  }
  // focus order vs visual order (top-to-bottom, left-to-right)
  const visual=[...seq].sort((a,z)=>a.y-z.y||a.x-z.x);
  const orderOk=seq.every((s,i)=>visual[i]&&visual[i].x===s.x&&visual[i].y===s.y);
  const invisible=seq.filter(s=>(s.outlineStyle==="none"||parseFloat(s.outlineW)===0)&&!s.boxShadow);
  // does Escape / cmdK do anything?
  const beforeK=await p.evaluate(()=>document.body.innerHTML.length);
  await p.keyboard.press("Meta+k"); await p.waitForTimeout(250);
  const afterK=await p.evaluate(()=>document.body.innerHTML.length);
  res[route]={tabStops:seq.length, focusOrderMatchesVisual:orderOk,
    invisibleFocusCount:invisible.length,
    invisibleSamples:invisible.slice(0,4).map(s=>`${s.tag} "${s.label}"`),
    firstStop:seq[0]?`${seq[0].tag} "${seq[0].label}"`:null,
    skipToContentLink:seq[0]?/skip/i.test(seq[0].label):false,
    cmdKChangedDom:afterK!==beforeK};
  console.log(route,"tabStops",seq.length,"orderOk",orderOk,"invisibleFocus",invisible.length,"cmdK",afterK!==beforeK);
}
writeFileSync(`${OUT}/keyboard.json`,JSON.stringify(res,null,2));
await b.close();
