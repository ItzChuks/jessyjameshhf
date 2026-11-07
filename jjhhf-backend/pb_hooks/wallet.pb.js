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

// 5) Safety net every 5 minutes: new periods open (a new day, Monday, the 1st of the month), so instalments become ready to collect.
cronAdd("jjhhf_wallet_collect", "*/5 * * * *", () => {
  const W = require(`${__hooks}/wallet.js`);
  const seen = {};
  $app.findRecordsByFilter("subscriptions", "status = 'active'", "", 0, 0).forEach(s => {
    const uid = s.getString("user");
    if (seen[uid]) return; seen[uid] = true;
    try { $app.runInTransaction((tx) => { W.collect(tx, uid); }); } catch (err) { console.log("jjhhf collect:", uid, String(err)); }
  });
});
