/// <reference path="../pb_data/types.d.ts" />
// 1) Bank-transfer deposits with a receipt (online payment partners are paused for now):
//    app_settings  one record: the account members transfer to, and the automatic-approval settings (Admin > Receipts > Settings)
//    deposits      + receipt (protected file), what was read from it, why it passed or not, who reviewed it; status + "reversed"
//    wallet_txs    kind + "reversal" (money taken back by an admin when a transfer turned out not to have arrived)
// 2) Account suspension: users.suspended, suspended_reason, suspended_at
// 3) Plans brought over from manual records: subscriptions.imported, import_note
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const admin = '@request.auth.role = "admin"';

  // ---- settings ----
  let st; try { st = app.findCollectionByNameOrId("app_settings"); } catch (_) { st = null; }
  if (!st) {
    st = new Collection({ type: "base", name: "app_settings" });
    st.fields.add(
      new TextField({ name: "bank_name" }),
      new TextField({ name: "account_number" }),
      new TextField({ name: "account_name" }),
      new TextField({ name: "transfer_note" }),                 // extra instructions shown to members
      new BoolField({ name: "auto_approve" }),                  // credit automatically when the receipt checks out
      new NumberField({ name: "auto_max", min: 0 }),            // largest transfer credited automatically (0 = no limit)
      new NumberField({ name: "max_age_days", min: 0 }),        // a receipt older than this many days is sent to review
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    );
    st.listRule = '@request.auth.id != ""'; st.viewRule = '@request.auth.id != ""';
    st.createRule = null; st.updateRule = admin; st.deleteRule = null;
    app.save(st);
    const r = new Record(st);
    r.set("auto_approve", true); r.set("auto_max", 200000); r.set("max_age_days", 2);
    app.save(r);
  }

  // ---- deposits: receipts ----
  const dep = app.findCollectionByNameOrId("deposits");
  const add = (f) => { if (!dep.fields.getByName(f.name)) dep.fields.add(f); };
  add(new FileField({ name: "receipt", maxSelect: 1, maxSize: 6 * 1024 * 1024, protected: true,
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"], thumbs: ["300x0"] }));
  add(new TextField({ name: "sender_name" }));          // as typed by the member
  add(new JSONField({ name: "check", maxSize: 20000 })); // what was read from the receipt and each check's result
  add(new TextField({ name: "check_note" }));           // short reason shown to the member and the admin
  add(new TextField({ name: "verified" }));             // "" | "auto" (credited automatically, not yet looked at) | "admin"
  add(new RelationField({ name: "reviewed_by", collectionId: users.id, maxSelect: 1 }));
  add(new DateField({ name: "reviewed_at" }));
  add(new TextField({ name: "receipt_hash" }));
  add(new TextField({ name: "receipt_ref" }));
  const ds = dep.fields.getByName("status");
  if (!ds.values.includes("reversed")) ds.values = [...ds.values, "reversed"];
  dep.indexes = (dep.indexes || []).filter(s => !/idx_dep_hash|idx_dep_rref|idx_dep_verified/.test(s)).concat([
    "CREATE INDEX idx_dep_hash ON deposits (receipt_hash)",
    "CREATE INDEX idx_dep_rref ON deposits (receipt_ref)",
    "CREATE INDEX idx_dep_verified ON deposits (status, verified, created)",
  ]);
  app.save(dep);

  const wt = app.findCollectionByNameOrId("wallet_txs");
  const k = wt.fields.getByName("kind");
  if (!k.values.includes("reversal")) { k.values = [...k.values, "reversal"]; app.save(wt); }

  // ---- suspension ----
  if (!users.fields.getByName("suspended")) users.fields.add(new BoolField({ name: "suspended" }));
  if (!users.fields.getByName("suspended_reason")) users.fields.add(new TextField({ name: "suspended_reason" }));
  if (!users.fields.getByName("suspended_at")) users.fields.add(new DateField({ name: "suspended_at" }));
  app.save(users);

  // ---- imported plans ----
  const subs = app.findCollectionByNameOrId("subscriptions");
  if (!subs.fields.getByName("imported")) subs.fields.add(new BoolField({ name: "imported" }));
  if (!subs.fields.getByName("import_note")) subs.fields.add(new TextField({ name: "import_note" }));
  app.save(subs);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("app_settings")); } catch (_) { }
  const dep = app.findCollectionByNameOrId("deposits");
  for (const f of ["receipt", "sender_name", "check", "check_note", "verified", "reviewed_by", "reviewed_at", "receipt_hash", "receipt_ref"]) dep.fields.removeByName(f);
  dep.indexes = (dep.indexes || []).filter(s => !/idx_dep_hash|idx_dep_rref|idx_dep_verified/.test(s));
  app.save(dep);
  const users = app.findCollectionByNameOrId("users");
  for (const f of ["suspended", "suspended_reason", "suspended_at"]) users.fields.removeByName(f);
  app.save(users);
  const subs = app.findCollectionByNameOrId("subscriptions");
  for (const f of ["imported", "import_note"]) subs.fields.removeByName(f);
  app.save(subs);
});
