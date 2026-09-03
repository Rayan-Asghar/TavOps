import { chromium } from "@playwright/test";
const b=await chromium.launch(); const c=await b.newContext(); const p=await c.newPage();
for (const theme of ["light","dark"]) {
  await c.addCookies([{name:"tavren_theme",value:theme,url:"http://localhost:3000"}]);
  await p.goto("http://localhost:3000/login",{waitUntil:"networkidle"});
  const r = await p.evaluate(()=>{
    const cs=getComputedStyle(document.documentElement);
    const g=n=>cs.getPropertyValue(n).trim()||"(EMPTY)";
    // The real test: what does a shadcn-style utility actually PAINT?
    const probe=document.createElement("div");
    probe.className="bg-background text-foreground border-input";
    document.body.appendChild(probe);
    const pcs=getComputedStyle(probe);
    const painted={bg:pcs.backgroundColor, fg:pcs.color, border:pcs.borderColor};
    probe.remove();
    return {theme:document.documentElement.dataset.theme??"(none)",
            aliasBackground:g("--color-background"), aliasMutedFg:g("--color-muted-foreground"),
            painted};
  });
  console.log(JSON.stringify(r,null,1));
}
await b.close();
