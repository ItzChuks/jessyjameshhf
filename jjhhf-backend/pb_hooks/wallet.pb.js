/// <reference path="../pb_data/types.d.ts" />
// Wallet routes. NOTE: PocketBase handlers are isolated, so shared code is loaded with require() inside each handler.

// 1) The member asks for their fixed virtual account (created once; Flutterwave needs a BVN or NIN for it, which is not stored).
routerAdd("POST", "/api/jjhhf/wallet/account", (e) => {
  const F = require(`${__hooks}/flutterwave.js`);
  const body = e.requestInfo().body || {};
  const user = $app.findRecordById("users", e.auth.id);
  if (user.getString("va_number")) return e.json(200, { number: user.getString("va_number"), bank: user.getString("va_bank") });

  const idType = String(body.id_type || "bvn").toLowerCase() === "nin" ? "nin" : "bvn";
  const idNumber = String(body.id_number || "").replace(/\s+/g, "");
  if (!/^\d{11}$/.test(idNumber)) throw new BadRequestError("Enter your 11-digit " + idType.toUpperCase() + ".");

  const acct = F.createAccount(user, idType, idNumber);
  const fresh = $app.findRecordById("users", e.auth.id);
  fresh.set("va_number", acct.number); fresh.set("va_bank", acct.bank); fresh.set("va_ref", acct.ref);
  $app.save(fresh);
  return e.json(200, { number: acct.number, bank: acct.bank });
}, $apis.requireAuth());

// 2) Webhook: Flutterwave calls this when a transfer lands in a member's virtual account. This is what tops the wallet up in real time.
//    The body is never trusted: we check the signature, ask Flutterwave to verify the transaction, then credit the wallet exactly once.
routerAdd("POST", "/api/jjhhf/flw-webhook", (e) => {
  const F = require(`${__hooks}/flutterwave.js`), W = require(`${__hooks}/wallet.js`);
  const c = F.cfg();
  const sig = e.request.header.get("verif-hash") || "";
  if (!c.hash || !$security.equal(sig, c.hash)) return e.json(401, { message: "Invalid signature" });

  const body = e.requestInfo().body || {};
  const d = body.data || {};
  if (body.event !== "charge.completed" || !d.id || typeof d.tx_ref !== "string" || !d.tx_ref.startsWith("JJHHF-VA-")) return e.json(200, { ok: true });

  const v = F.verifyTransaction(d.id);                 // throws on a Flutterwave outage -> 500 -> Flutterwave retries the webhook later
  if (!v || v.status !== "successful" || v.currency !== F.CURRENCY || v.tx_ref !== d.tx_ref) return e.json(200, { ok: true });

  let user;
  try { user = $app.findFirstRecordByData("users", "va_ref", v.tx_ref); } catch (_) { console.log("jjhhf wallet: transfer for unknown account", v.tx_ref, v.id); return e.json(200, { ok: true }); }

  const amount = Number(v.amount);
  if (!(amount > 0)) return e.json(200, { ok: true });
  $app.runInTransaction((tx) => {
    if (W.credit(tx, user.id, amount, "FLW-" + v.id, "Bank transfer" + (v.narration ? " · " + v.narration : ""))) W.collect(tx, user.id);   // plans waiting for money are served at once
  });
  return e.json(200, { ok: true });
});

// 3) Admin fallback: credit a member's wallet by hand (for example a transfer whose webhook never arrived). Needs a unique reference.
routerAdd("POST", "/api/jjhhf/wallet/credit", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, amount = Number(b.amount), ref = String(b.ref || "").trim(), uid = String(b.user || "");
  if (!(amount > 0)) throw new BadRequestError("Enter an amount.");
  if (!ref) throw new BadRequestError("Enter the bank transfer reference, so the same transfer cannot be credited twice.");
  let ok = false;
  W.inTx((tx) => {
    try { tx.findRecordById("users", uid); } catch (_) { throw new BadRequestError("Member not found."); }
    ok = W.credit(tx, uid, amount, "MANUAL-" + ref, "Credited by admin · " + ref);
    if (ok) W.collect(tx, uid);
  });
  if (!ok) throw new BadRequestError("That reference has already been credited.");
  return e.json(200, { ok: true });
}, $apis.requireAuth());

// 4) Pay a fee or join a plan from the wallet: t-shirt (once), joining fee (per plan joined, plus the catch-up on a mid-season cash/foodie plan),
//    payout clearance fee (per payout request). The amount is decided here, never by the browser.
routerAdd("POST", "/api/jjhhf/fee/pay", (e) => {
  const X = require(`${__hooks}/fees.js`), W = require(`${__hooks}/wallet.js`);
  const body = e.requestInfo().body || {}, uid = e.auth.id, type = String(body.type || "");
  let out = {};
  W.inTx((tx) => { out = X.pay(tx, uid, type, body) || {}; });
  return e.json(200, Object.assign({ ok: true }, out));
}, $apis.requireAuth());

// 5) The collector. Runs every minute but only visits members who have a plan due (next_collect has passed), oldest first,
//    within a 50-second budget; whatever is left is picked up on the next run. A lock stops two runs overlapping.
cronAdd("jjhhf_wallet_collect", "* * * * *", () => {
  const W = require(`${__hooks}/wallet.js`);
  const store = $app.store(), KEY = "jjhhf_collect_lock", t0 = Date.now();
  const held = store.get(KEY);
  if (held && t0 - Number(held) < 10 * 60e3) return;           // a previous run is still going
  store.set(KEY, t0);
  try {
    const rows = arrayOf(new DynamicModel({ uid: "" }));
    $app.db().newQuery("SELECT [[user]] AS uid FROM {{subscriptions}} WHERE [[status]] = 'active' AND ([[next_collect]] = '' OR [[next_collect]] <= {:now}) GROUP BY [[user]] ORDER BY MIN([[next_collect]]) LIMIT 50000")
      .bind({ now: W.ts(new Date()) }).all(rows);
    let n = 0;
    for (const r of rows) {
      if (Date.now() - t0 > 50e3) break;
      try { $app.runInTransaction((tx) => { W.collect(tx, r.uid); }); n++; } catch (err) { console.log("jjhhf collect:", r.uid, String(err)); }
    }
    if (rows.length) console.log("jjhhf collect: visited", n, "of", rows.length, "members with a plan due in", Date.now() - t0, "ms");
  } finally { store.remove(KEY); }
});

// 6) Admin overview totals, worked out by the database (no need to download every record into the browser).
routerAdd("GET", "/api/jjhhf/admin/stats", (e) => {
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const one = (sql, fields) => { const m = new DynamicModel(fields); $app.db().newQuery(sql).one(m); return m; };
  const u = one("SELECT COUNT(*) AS members, COALESCE(SUM(CASE WHEN [[shirt_paid]] THEN 1 ELSE 0 END), 0) AS registered, COALESCE(SUM(CASE WHEN [[va_number]] != '' THEN 1 ELSE 0 END), 0) AS withAccount FROM {{users}} WHERE [[role]] != 'admin'", { members: 0, registered: 0, withAccount: 0 });
  const all = one("SELECT COUNT(*) AS users, COALESCE(SUM([[wallet_balance]]), 0) AS held FROM {{users}}", { users: 0, held: -0 });
  const s = one("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN [[status]] = 'active' THEN 1 ELSE 0 END), 0) AS active FROM {{subscriptions}}", { n: 0, active: 0 });
  const p = one("SELECT COALESCE(SUM(CASE WHEN [[status]] = 'pending' THEN 1 ELSE 0 END), 0) AS pending, COALESCE(SUM(CASE WHEN [[status]] = 'confirmed' THEN [[amount]] ELSE 0 END), 0) AS confirmed, COALESCE(SUM(CASE WHEN [[status]] = 'confirmed' THEN [[penalty]] ELSE 0 END), 0) AS penalties FROM {{payments}}", { pending: 0, confirmed: -0, penalties: -0 });
  const f = one("SELECT COALESCE(SUM([[amount]]), 0) AS fees FROM {{fees}} WHERE [[status]] = 'confirmed'", { fees: -0 });
  const po = one("SELECT COALESCE(SUM(CASE WHEN [[status]] = 'pending' THEN 1 ELSE 0 END), 0) AS pending FROM {{payouts}}", { pending: 0 });
  const pl = one("SELECT COUNT(*) AS n FROM {{plans}}", { n: 0 });
  const tu = one("SELECT COUNT(*) AS n, COALESCE(SUM([[amount]]), 0) AS total FROM {{wallet_txs}} WHERE [[kind]] = 'topup'", { n: 0, total: -0 });
  return e.json(200, {
    users: all.users, members: u.members, registered: u.registered, unregistered: u.members - u.registered, withAccount: u.withAccount, admins: all.users - u.members,
    held: all.held, subscriptions: s.n, activeSubscriptions: s.active, pendingPayments: p.pending, confirmedTotal: p.confirmed, penalties: p.penalties,
    fees: f.fees, pendingPayouts: po.pending, plans: pl.n, topups: tu.n, topupTotal: tu.total,
  });
}, $apis.requireAuth());
