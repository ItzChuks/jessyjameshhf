/// <reference path="../pb_data/types.d.ts" />
// 1) users: t-shirt registration flag (shirt_paid) + terms acceptance. Members cannot set these themselves;
//    the server sets shirt_paid when the Flutterwave payment is verified (admins can also set it by hand).
// 2) plans: a third category, "foodie".
// 3) fees collection: t-shirt (5000), joining fee (3000 per plan joined), payout clearance fee (3000 per payout request).
// 4) subscriptions and payouts are now created by the server only (after the matching fee is paid and verified).
migrate((app) => {
  const admin = '@request.auth.role = "admin"';
  const mine = 'user = @request.auth.id || ' + admin;

  // ---- users ----
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("shirt_paid")) users.fields.add(new BoolField({ name: "shirt_paid" }));
  if (!users.fields.getByName("shirt_paid_at")) users.fields.add(new DateField({ name: "shirt_paid_at" }));
  if (!users.fields.getByName("terms_accepted")) users.fields.add(new BoolField({ name: "terms_accepted" }));
  if (!users.fields.getByName("terms_accepted_at")) users.fields.add(new DateField({ name: "terms_accepted_at" }));
  const locked = '@request.body.role:isset = false && @request.body.shirt_paid:isset = false && @request.body.shirt_paid_at:isset = false && @request.body.terms_accepted_at:isset = false';
  users.createRule = locked;
  users.updateRule = '(id = @request.auth.id && ' + locked + ' && @request.body.terms_accepted:isset = false) || ' + admin;
  app.save(users);

  // ---- plans: add "foodie" ----
  const plans = app.findCollectionByNameOrId("plans");
  const cat = plans.fields.getByName("category");
  cat.values = ["cash", "grocery", "foodie"];
  app.save(plans);

  // ---- subscriptions / payouts: server only ----
  const subs = app.findCollectionByNameOrId("subscriptions");
  subs.createRule = null;
  app.save(subs);
  const payouts = app.findCollectionByNameOrId("payouts");
  payouts.createRule = null;
  app.save(payouts);

  // ---- fees ----
  const stamps = () => [
    new AutodateField({ name: "created", onCreate: true }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ];
  const fees = new Collection({ type: "base", name: "fees" });
  [
    new RelationField({ name: "user", collectionId: users.id, maxSelect: 1, required: true }),
    new SelectField({ name: "type", values: ["shirt", "join", "clearance"], maxSelect: 1, required: true }),
    new NumberField({ name: "amount", required: true, min: 1 }),
    new SelectField({ name: "status", values: ["pending", "confirmed", "rejected"], maxSelect: 1, required: true }),
    new RelationField({ name: "plan", collectionId: plans.id, maxSelect: 1 }),
    new RelationField({ name: "subscription", collectionId: subs.id, maxSelect: 1 }),
    new TextField({ name: "details" }),
    new TextField({ name: "note" }),
    new TextField({ name: "tx_ref" }),
    new TextField({ name: "flw_id" }),
    ...stamps(),
  ].forEach(f => fees.fields.add(f));
  fees.listRule = mine; fees.viewRule = mine;
  fees.createRule = null;              // created by the server only (/api/jjhhf/fee/init)
  fees.updateRule = admin; fees.deleteRule = admin;
  fees.addIndex("idx_fees_tx_ref", true, "tx_ref", "tx_ref != ''");
  app.save(fees);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("fees")); } catch (e) {}
  const admin = '@request.auth.role = "admin"';
  const subs = app.findCollectionByNameOrId("subscriptions");
  subs.createRule = '@request.auth.id != "" && @request.body.user = @request.auth.id';
  app.save(subs);
  const payouts = app.findCollectionByNameOrId("payouts");
  payouts.createRule = '@request.body.user = @request.auth.id && @request.body.status = "pending"';
  app.save(payouts);
  const plans = app.findCollectionByNameOrId("plans");
  plans.fields.getByName("category").values = ["cash", "grocery"];
  app.save(plans);
  const users = app.findCollectionByNameOrId("users");
  for (const f of ["shirt_paid", "shirt_paid_at", "terms_accepted", "terms_accepted_at"]) users.fields.removeByName(f);
  users.createRule = '@request.body.role:isset = false';
  users.updateRule = '(id = @request.auth.id && @request.body.role:isset = false) || ' + admin;
  app.save(users);
});
