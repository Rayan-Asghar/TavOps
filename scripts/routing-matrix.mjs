import { resolveBlockerRouting, CATEGORY_LABELS } from '../src/lib/blocker-routing.ts';

const NAMES = {
  hammad:'Hammad (PM)', hozefa:'Hozefa (Delivery Lead)', saqlain:'Saqlain (Sales Owner)',
  ahmed:'Ahmed (QA)', abdur:'Abdur (other dev)', ayan:'Ayan (reporter)', muz:'Muzammil (BD Lead)',
};
const n = id => NAMES[id] ?? (id ?? '—');

const ctx = (category, extra={}) => ({
  category, severity:'normal', reporterId:'ayan',
  project:{ pmId:'hammad', deliveryLeadId:'hozefa', salesOwnerId:'saqlain' },
  projectRoles:{ tech_lead:'hozefa', qa:'ahmed', sales_owner:'saqlain' },
  ...extra,
});

const cats = Object.keys(CATEGORY_LABELS);
console.log('CATEGORY'.padEnd(21), 'ASSIGNEE'.padEnd(24), 'WATCHERS'.padEnd(30), 'SIDE'.padEnd(9), 'SLA');
console.log('-'.repeat(96));
for (const c of cats) {
  const extra = c === 'dependency_dev' ? { blockedOnUserId:'abdur', blockedOnUserLeadId:'hozefa' } : {};
  const r = resolveBlockerRouting(ctx(c, extra));
  console.log(
    c.padEnd(21),
    n(r.assigneeId).padEnd(24),
    (r.watcherIds.map(n).join(', ') || '—').padEnd(30),
    r.ownerSide.padEnd(9),
    r.slaHours + 'h',
  );
}
console.log('\n--- severity drives the SLA ---');
for (const sev of ['low','normal','high','critical']) {
  const r = resolveBlockerRouting({ ...ctx('technical'), severity: sev });
  console.log('  technical /', sev.padEnd(9), '->', r.slaHours + 'h');
}
console.log('\n--- production incident is forced critical even if ticked "low" ---');
console.log('  ->', resolveBlockerRouting({ ...ctx('production_incident'), severity:'low' }).slaHours + 'h');
console.log('\n--- project-scoped tech_lead overrides the project delivery lead ---');
const r2 = resolveBlockerRouting({ ...ctx('technical'), projectRoles:{ tech_lead:'abdur' } });
console.log('  tech_lead=Abdur ->', n(r2.assigneeId));
console.log('\n--- reporter is never their own watcher ---');
const r3 = resolveBlockerRouting({ ...ctx('scope_conflict'), reporterId:'hozefa' });
console.log('  reporter=Hozefa, watchers =', r3.watcherIds.map(n).join(', ') || '(none)');
