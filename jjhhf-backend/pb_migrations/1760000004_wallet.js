/// <reference path="../pb_data/types.d.ts" />
// Wallet + virtual accounts.
// 1) users: wallet_balance and the member's fixed virtual account (va_number, va_bank, va_ref). Nobody can write these through the API;
//    the server changes them (top-ups, fees, collections).
// 2) wallet_txs: the wallet ledger (every credit and debit, with the balance after it). Members can read their own; only the server writes.
// 3) Old Flutterwave checkout payments / fees still "pending" are flagged REVIEW so an admin can confirm or reject them by hand
//    (the checkout flow no longer exists, so nothing would settle them automatically).
migrate((app) => {
  const admin = '@request.auth.role = "admin"';
  const mine = 'user = @request.auth.id || ' + admin;

  // ---- users ----
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("wallet_balance")) users.fields.add(new NumberField({ name: "wallet_balance" }));
  for (const f of ["va_number", "va_bank", "va_ref"]) if (!users.fields.getByName(f)) users.fields.add(new TextField({ name: f }));
  const locked = '@request.body.role:isset = false && @request.body.shirt_paid:isset = false && @request.body.shirt_paid_at:isset = false && @request.body.terms_accepted_at:isset = false'
    + ' && @request.body.wallet_balance:isset = false && @request.body.va_number:isset = false && @request.body.va_bank:isset = false && @request.body.va_ref:isset = false';
  const walletLocked = '@request.body.wallet_balance:isset = false && @request.body.va_number:isset = false && @request.body.va_bank:isset = false && @request.body.va_ref:isset = false';
  users.createRule = locked;
  users.updateRule = '(id = @request.auth.id && ' + locked + ' && @request.body.terms_accepted:isset = false) || (' + admin + ' && ' + walletLocked + ')';
  users.addIndex("idx_users_va_ref", true, "va_ref", "va_ref != ''");
  app.save(users);

  // ---- wallet_txs ----
  const plans = app.findCollectionByNameOrId("plans"), subs = app.findCollectionByNameOrId("subscriptions");
  const c = new Collection({ type: "base", name: "wallet_txs" });
  [
    new RelationField({ name: "user", collectionId: users.id, maxSelect: 1, required: true }),
    new SelectField({ name: "type", values: ["credit", "debit"], maxSelect: 1, required: true }),
    new NumberField({ name: "amount", required: true, min: 0 }),
    new NumberField({ name: "balance" }),
    new SelectField({ name: "kind", values: ["topup", "contribution", "join", "catchup", "shirt", "clearance"], maxSelect: 1, required: true }),
    new TextField({ name: "note" }),
    new TextField({ name: "ref" }),
    new RelationField({ name: "plan", collectionId: plans.id, maxSelect: 1 }),
    new RelationField({ name: "subscription", collectionId: subs.id, maxSelect: 1 }),
    new AutodateField({ name: "created", onCreate: true }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ].forEach(f => c.fields.add(f));
  c.listRule = mine; c.viewRule = mine;
  c.createRule = null; c.updateRule = null; c.deleteRule = null;       // the server only
  c.addIndex("idx_wallet_txs_ref", true, "ref", "ref != ''");
  c.addIndex("idx_wallet_txs_user", false, "user, created", "");
  app.save(c);

  // ---- leftovers from the old checkout ----
  for (const coll of ["payments", "fees"]) {
    let rows = [];
    try { rows = app.findRecordsByFilter(coll, "status = 'pending' && tx_ref != ''", "", 0, 0); } catch (_) { /* nothing */ }
    rows.forEach(r => {
      if (r.getString("note").startsWith("REVIEW")) return;
      r.set("note", "REVIEW: old Flutterwave checkout, check it on Flutterwave then confirm or reject");
      app.save(r);
    });
  }
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("wallet_txs")); } catch (e) {}
  const admin = '@request.auth.role = "admin"';
  const users = app.findCollectionByNameOrId("users");
  users.removeIndex("idx_users_va_ref");
  for (const f of ["wallet_balance", "va_number", "va_bank", "va_ref"]) users.fields.removeByName(f);
  const locked = '@request.body.role:isset = false && @request.body.shirt_paid:isset = false && @request.body.shirt_paid_at:isset = false && @request.body.terms_accepted_at:isset = false';
  users.createRule = locked;
  users.updateRule = '(id = @request.auth.id && ' + locked + ' && @request.body.terms_accepted:isset = false) || ' + admin;
  app.save(users);
});
