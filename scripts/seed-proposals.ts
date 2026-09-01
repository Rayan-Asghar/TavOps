import { db } from "../src/db";
import { proposals, users } from "../src/db/schema";


async function main() {
  const team = await db.select().from(users);
  const by = (n: string) => team.find((u) => u.name === n)!;
  const saqlain = by("Saqlain");
  const shahab = by("Shahab");
  const muz = by("Muzammil");

  const day = 864e5;
  const rows = [
    { o: saqlain, t: "Shopify store migration from WooCommerce", c: "Shopify", b: "4500", s: "won", d: 12, won: "4200" },
    { o: saqlain, t: "Klaviyo flows + segmentation setup", c: "Shopify", b: "1800", s: "meeting", d: 3 },
    { o: saqlain, t: "Headless Shopify storefront", c: "Shopify", b: "12000", s: "responded", d: 5 },
    { o: saqlain, t: "Product page speed optimisation", c: "Shopify", b: "900", s: "lost", d: 20 },
    { o: shahab, t: "WordPress blog redesign", c: "WordPress", b: "2200", s: "sent", d: 1 },
    { o: shahab, t: "WooCommerce checkout customisation", c: "WordPress", b: "1500", s: "sent", d: 2 },
    { o: shahab, t: "Membership site build", c: "WordPress", b: "6000", s: "viewed", d: 4 },
    { o: shahab, t: "Elementor to Gutenberg migration", c: "WordPress", b: "1200", s: "lost", d: 18 },
    { o: shahab, t: "Multisite maintenance retainer", c: "WordPress", b: "800", s: "sent", d: 6 },
    { o: muz, t: "GoHighLevel CRM buildout", c: "CRM / GHL", b: "5500", s: "won", d: 25, won: "5500" },
    { o: muz, t: "Zapier → Make migration", c: "Automation", b: "3000", s: "qualified", d: 2 },
    { o: muz, t: "AI support chatbot on docs", c: "AI / Chatbot", b: "7000", s: "responded", d: 4 },
    { o: saqlain, t: "Custom inventory sync service", c: "Automation", b: "9000", s: "sent", d: 1 },
  ];

  await db.insert(proposals).values(
    rows.map((r) => {
      const sentAt = new Date(Date.now() - r.d * day);
      const responded = ["responded", "meeting", "qualified", "won", "lost"].includes(r.s);
      return {
        ownerId: r.o.id,
        jobTitle: r.t,
        jobUrl: `https://www.upwork.com/jobs/~${Math.abs(r.t.length * 7919).toString(16)}`,
        category: r.c,
        source: "upwork",
        budgetAmount: r.b,
        status: r.s as never,
        sentAt,
        respondedAt: responded ? new Date(sentAt.getTime() + day) : null,
        meetingAt: ["meeting", "qualified", "won"].includes(r.s)
          ? new Date(sentAt.getTime() + 2 * day)
          : null,
        decidedAt: ["won", "lost"].includes(r.s)
          ? new Date(sentAt.getTime() + 5 * day)
          : null,
        wonValue: r.won ?? null,
      };
    }),
  );

  console.log(`seeded ${rows.length} proposals`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
