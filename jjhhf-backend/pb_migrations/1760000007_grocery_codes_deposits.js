/// <reference path="../pb_data/types.d.ts" />
// Grocery-only plans, plan codes, and Flutterwave checkout deposits.
//   plans:          weeks (4, 8, 12, 25...), code_from_day / code_until_day (the code a member gets on joining can be used
//                   from day N to the end of day M after joining; day 1 = the day they join)
//   subscriptions:  the code generated for that membership, its window, who used it, and the code this membership was joined with
//   deposits:       each Flutterwave checkout (amount for the wallet + the ₦100 tax charge); written by the server only
//   fees.type:      + "tax" (the ₦100 charge on every deposit)
// Cash and Foodie plans are no longer offered: any that exist are hidden (not deleted, so existing memberships keep working).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const admin = '@request.auth.role = "admin"', mine = 'user = @request.auth.id || ' + admin;

  const plans = app.findCollectionByNameOrId("plans");
  if (!plans.fields.getByName("weeks")) plans.fields.add(new NumberField({ name: "weeks", min: 0 }));
  if (!plans.fields.getByName("code_from_day")) plans.fields.add(new NumberField({ name: "code_from_day", min: 0 }));
  if (!plans.fields.getByName("code_until_day")) plans.fields.add(new NumberField({ name: "code_until_day", min: 0 }));
  app.save(plans);
  app.findRecordsByFilter("plans", "category != 'grocery'", "", 0, 0).forEach(p => { p.set("active", false); app.saveNoValidate(p); });

  const subs = app.findCollectionByNameOrId("subscriptions");
  const add = (f) => { if (!subs.fields.getByName(f.name)) subs.fields.add(f); };
  add(new TextField({ name: "code" }));
  add(new DateField({ name: "code_from" }));
  add(new DateField({ name: "code_until" }));
  add(new RelationField({ name: "code_used_by", collectionId: users.id, maxSelect: 1 }));
  add(new TextField({ name: "code_used_name" }));
  add(new DateField({ name: "code_used_at" }));
  add(new TextField({ name: "code_used_sub" }));
  add(new TextField({ name: "joined_code" }));
  subs.indexes = (subs.indexes || []).filter(s => !/idx_subs_code/.test(s)).concat([
    "CREATE UNIQUE INDEX idx_subs_code ON subscriptions (code) WHERE code != ''",
    "CREATE INDEX idx_subs_code_window ON subscriptions (code_until, code_used_at)",
  ]);
  app.save(subs);

  const fees = app.findCollectionByNameOrId("fees");
  const ft = fees.fields.getByName("type");
  if (!ft.values.includes("tax")) { ft.values = [...ft.values, "tax"]; app.save(fees); }

  const d = new Collection({ type: "base", name: "deposits" });
  d.fields.add(
    new RelationField({ name: "user", collectionId: users.id, maxSelect: 1, required: true }),
    new NumberField({ name: "amount", required: true, min: 1 }),     // what goes into the wallet
    new NumberField({ name: "fee" }),                                // the ₦100 tax charge
    new NumberField({ name: "total", required: true, min: 1 }),      // what the member pays at checkout
    new TextField({ name: "tx_ref", required: true }),
    new SelectField({ name: "status", values: ["pending", "successful", "failed"], maxSelect: 1, required: true }),
    new TextField({ name: "flw_id" }),
    new TextField({ name: "note" }),
    new AutodateField({ name: "created", onCreate: true }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  );
  d.listRule = mine; d.viewRule = mine;
  d.createRule = null; d.updateRule = null; d.deleteRule = null;     // the server only
  d.indexes = [
    "CREATE UNIQUE INDEX idx_dep_ref ON deposits (tx_ref)",
    "CREATE INDEX idx_dep_user_created ON deposits (user, created)",
    "CREATE INDEX idx_dep_status_created ON deposits (status, created)",
  ];
  app.save(d);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("deposits")); } catch (_) { }
  const subs = app.findCollectionByNameOrId("subscriptions");
  for (const f of ["code", "code_from", "code_until", "code_used_by", "code_used_name", "code_used_at", "code_used_sub", "joined_code"]) subs.fields.removeByName(f);
  subs.indexes = (subs.indexes || []).filter(s => !/idx_subs_code/.test(s));
  app.save(subs);
  const plans = app.findCollectionByNameOrId("plans");
  for (const f of ["weeks", "code_from_day", "code_until_day"]) plans.fields.removeByName(f);
  app.save(plans);
});
