/// <reference path="../pb_data/types.d.ts" />
// Scaling: database indexes for every hot query, and two fields on subscriptions so the collector no longer re-reads payment history:
//   paid_count    instalments covered so far (kept up to date by wallet.js)
//   next_collect  when the collector should next look at this plan; DONE (2999-12-31) once fully paid; empty = not worked out yet
//                 (existing plans are worked out by the collector on its first run, see wallet.js syncSub)
migrate((app) => {
  const subs = app.findCollectionByNameOrId("subscriptions");
  if (!subs.fields.getByName("paid_count")) subs.fields.add(new NumberField({ name: "paid_count", min: 0 }));
  if (!subs.fields.getByName("next_collect")) subs.fields.add(new DateField({ name: "next_collect" }));
  subs.indexes = [
    "CREATE INDEX idx_subs_user_status ON subscriptions (user, status)",
    "CREATE INDEX idx_subs_status_next ON subscriptions (status, next_collect)",
    "CREATE INDEX idx_subs_plan ON subscriptions (plan)",
    "CREATE INDEX idx_subs_created ON subscriptions (created)",
  ];
  app.save(subs);

  const idx = (name, list) => { const c = app.findCollectionByNameOrId(name); c.indexes = list; app.save(c); };
  idx("payments", [
    "CREATE INDEX idx_pay_sub_status ON payments (subscription, status)",
    "CREATE INDEX idx_pay_user_created ON payments (user, created)",
    "CREATE INDEX idx_pay_status_created ON payments (status, created)",
    "CREATE INDEX idx_pay_created ON payments (created)",
  ]);
  idx("payouts", [
    "CREATE INDEX idx_po_sub_status ON payouts (subscription, status)",
    "CREATE INDEX idx_po_user ON payouts (user)",
    "CREATE INDEX idx_po_status_created ON payouts (status, created)",
  ]);
  idx("fees", [
    "CREATE INDEX idx_fees_user ON fees (user)",
    "CREATE INDEX idx_fees_status ON fees (status)",
    "CREATE INDEX idx_fees_created ON fees (created)",
  ]);
  idx("wallet_txs", [
    "CREATE INDEX idx_wtx_user_created ON wallet_txs (user, created)",
    "CREATE INDEX idx_wtx_created ON wallet_txs (created)",
    "CREATE INDEX idx_wtx_kind ON wallet_txs (kind)",
    "CREATE UNIQUE INDEX idx_wtx_ref ON wallet_txs (ref) WHERE ref != ''",   // a bank transfer can never be credited twice
  ]);
  idx("plans", ["CREATE INDEX idx_plans_active ON plans (active)"]);

  const users = app.findCollectionByNameOrId("users");
  users.indexes = (users.indexes || []).filter(s => !/idx_users_(va_ref|role|created|shirt)/.test(s)).concat([
    "CREATE INDEX idx_users_va_ref ON users (va_ref)",
    "CREATE INDEX idx_users_role_shirt ON users (role, shirt_paid)",
    "CREATE INDEX idx_users_created ON users (created)",
  ]);
  app.save(users);
}, (app) => {
  const subs = app.findCollectionByNameOrId("subscriptions");
  subs.indexes = [];
  subs.fields.removeByName("paid_count"); subs.fields.removeByName("next_collect");
  app.save(subs);
  for (const n of ["payments", "payouts", "fees", "wallet_txs", "plans"]) { const c = app.findCollectionByNameOrId(n); c.indexes = []; app.save(c); }
  const users = app.findCollectionByNameOrId("users");
  users.indexes = (users.indexes || []).filter(s => !/idx_users_(va_ref|role|created)/.test(s));
  app.save(users);
});
