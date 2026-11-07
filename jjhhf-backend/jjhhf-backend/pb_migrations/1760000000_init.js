/// <reference path="../pb_data/types.d.ts" />
// Creates everything the foundation needs: extra user fields + plans, subscriptions, payments, payouts.
migrate((app) => {
  const admin = '@request.auth.role = "admin"';
  const mine = 'user = @request.auth.id || ' + admin;
  const stamps = () => [
    new AutodateField({ name: "created", onCreate: true }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ];

  const make = (name, rules, fields) => {
    const c = new Collection({ type: "base", name });
    fields.forEach(f => c.fields.add(f));
    Object.assign(c, rules);
    app.save(c);
    return c;
  };

  // ---- users (built-in auth collection) ----
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "country" }));
  users.fields.add(new TextField({ name: "phone" }));
  users.fields.add(new SelectField({ name: "role", values: ["user", "admin"], maxSelect: 1 }));
  users.listRule = 'id = @request.auth.id || ' + admin;
  users.viewRule = 'id = @request.auth.id || ' + admin;
  users.createRule = '@request.body.role:isset = false';
  users.updateRule = '(id = @request.auth.id && @request.body.role:isset = false) || ' + admin;
  app.save(users);

  // ---- plans ----
  const plans = make("plans", {
    listRule: '@request.auth.id != ""', viewRule: '@request.auth.id != ""',
    createRule: admin, updateRule: admin, deleteRule: admin,
  }, [
    new TextField({ name: "name", required: true }),
    new SelectField({ name: "category", values: ["cash", "grocery"], maxSelect: 1, required: true }),
    new SelectField({ name: "frequency", values: ["daily", "weekly", "monthly"], maxSelect: 1, required: true }),
    new NumberField({ name: "amount", required: true, min: 1 }),
    new NumberField({ name: "duration", required: true, min: 1 }),
    new NumberField({ name: "payout" }),
    new TextField({ name: "description" }),
    new BoolField({ name: "active" }),
    ...stamps(),
  ]);

  // ---- subscriptions ----
  const subs = make("subscriptions", {
    listRule: mine, viewRule: mine,
    createRule: '@request.auth.id != "" && @request.body.user = @request.auth.id',
    updateRule: admin, deleteRule: admin,
  }, [
    new RelationField({ name: "user", collectionId: users.id, maxSelect: 1, required: true }),
    new RelationField({ name: "plan", collectionId: plans.id, maxSelect: 1, required: true }),
    new SelectField({ name: "status", values: ["active", "completed", "cancelled"], maxSelect: 1, required: true }),
    ...stamps(),
  ]);

  // ---- payments ----
  make("payments", {
    listRule: mine, viewRule: mine,
    createRule: '@request.body.user = @request.auth.id && @request.body.status = "pending"',
    updateRule: admin, deleteRule: admin,
  }, [
    new RelationField({ name: "user", collectionId: users.id, maxSelect: 1, required: true }),
    new RelationField({ name: "subscription", collectionId: subs.id, maxSelect: 1, required: true }),
    new NumberField({ name: "amount", required: true, min: 1 }),
    new TextField({ name: "note" }),
    new SelectField({ name: "status", values: ["pending", "confirmed", "rejected"], maxSelect: 1, required: true }),
    new NumberField({ name: "penalty" }),
    new NumberField({ name: "installments" }),
    new NumberField({ name: "late_count" }),
    ...stamps(),
  ]);

  // ---- payouts ----
  make("payouts", {
    listRule: mine, viewRule: mine,
    createRule: '@request.body.user = @request.auth.id && @request.body.status = "pending"',
    updateRule: admin, deleteRule: admin,
  }, [
    new RelationField({ name: "user", collectionId: users.id, maxSelect: 1, required: true }),
    new RelationField({ name: "subscription", collectionId: subs.id, maxSelect: 1, required: true }),
    new TextField({ name: "note" }),
    new SelectField({ name: "status", values: ["pending", "confirmed", "rejected"], maxSelect: 1, required: true }),
    ...stamps(),
  ]);
}, (app) => {
  for (const n of ["payouts", "payments", "subscriptions", "plans"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (e) {}
  }
  const users = app.findCollectionByNameOrId("users");
  for (const f of ["country", "phone", "role"]) users.fields.removeByName(f);
  app.save(users);
});
