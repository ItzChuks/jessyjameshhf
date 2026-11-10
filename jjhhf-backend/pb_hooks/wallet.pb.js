/// <reference path="../pb_data/types.d.ts" />
// Wallet routes. NOTE: PocketBase handlers are isolated, so shared code is loaded with require() inside each handler.

// 1) Deposit: the member chooses an amount; the server records it and returns a Flutterwave Checkout link (amount + ₦100 tax charge).
routerAdd("POST", "/api/jjhhf/wallet/deposit", (e) => {
  // online payment partners are paused: deposits are made by bank transfer with a receipt (transfers.js). Set ONLINE_PAYMENTS=on to bring them back.
  if (($os.getenv("ONLINE_PAYMENTS") || "").toLowerCase() !== "on") throw new BadRequestError("Online payments are paused. Please deposit by bank transfer and upload your receipt.");
  const D = require(`${__hooks}/deposits.js`);
  const body = e.requestInfo().body || {};
  return e.json(200, D.start($app, e.auth.id, body.amount, String(body.redirect || "")));
}, $apis.requireAuth());

// 2a) Back from Flutterwave: the browser passes the reference; the server asks Flutterwave itself and credits the wallet once.
routerAdd("POST", "/api/jjhhf/wallet/verify", (e) => {
  const D = require(`${__hooks}/deposits.js`);
  const body = e.requestInfo().body || {}, ref = String(body.tx_ref || "");
  let d; try { d = $app.findFirstRecordByData("deposits", "tx_ref", ref); } catch (_) { throw new BadRequestError("Deposit not found."); }
  if (d.getString("user") !== e.auth.id && e.auth.getString("role") !== "admin") throw new ForbiddenError("That is not your deposit.");
  const status = D.settle(ref, body.transaction_id ? String(body.transaction_id) : "");
  const x = $app.findRecordById("deposits", d.id);
  return e.json(200, { status, amount: x.getFloat("amount"), fee: x.getFloat("fee"), total: x.getFloat("total"), note: x.getString("note") });
}, $apis.requireAuth());

// 2b) Flutterwave webhook: called when a payment completes, even if the member closed the page before coming back.
//     The body is never trusted: we check the signature, then settle() asks Flutterwave to verify the transaction.
routerAdd("POST", "/api/jjhhf/flw-webhook", (e) => {
  const F = require(`${__hooks}/flutterwave.js`), D = require(`${__hooks}/deposits.js`);
  const c = F.cfg();
  const sig = e.request.header.get("verif-hash") || "";
  if (!c.hash || !$security.equal(sig, c.hash)) return e.json(401, { message: "Invalid signature" });
  const body = e.requestInfo().body || {}, d = body.data || {};
  if (body.event !== "charge.completed" || !d.id || typeof d.tx_ref !== "string" || !d.tx_ref.startsWith("JJHHF-DEP-")) return e.json(200, { ok: true });
  try { D.settle(d.tx_ref, String(d.id)); }
  catch (err) { if (String(err).includes("Deposit not found")) return e.json(200, { ok: true }); throw err; }   // other errors -> Flutterwave retries later
  return e.json(200, { ok: true });
});

// 2c) Paystack webhook (charge.success). The signature (HMAC-SHA512 of the raw body with the secret key) is checked, and settle()
//     then asks Paystack itself about the payment, so a forged call can never credit a wallet.
routerAdd("POST", "/api/jjhhf/paystack-webhook", (e) => {
  const D = require(`${__hooks}/deposits.js`);
  let raw = ""; try { raw = readerToString(e.request.body); } catch (_) { }
  const secret = $os.getenv("PAYSTACK_SECRET_KEY"), sig = e.request.header.get("x-paystack-signature") || "";
  if (!secret || !raw || !$security.equal(sig, $security.hs512(raw, secret))) return e.json(401, { message: "Invalid signature" });
  let body = {}; try { body = JSON.parse(raw); } catch (_) { return e.json(400, { message: "Bad body" }); }
  const ref = body.data && body.data.reference;
  if (body.event !== "charge.success" || typeof ref !== "string" || !ref.startsWith("JJHHF-DEP-")) return e.json(200, { ok: true });
  try { D.settle(ref, ""); } catch (err) { if (String(err).includes("Deposit not found")) return e.json(200, { ok: true }); throw err; }
  return e.json(200, { ok: true });
});

// 2d) Monnify webhook (SUCCESSFUL_TRANSACTION). Production webhooks carry "monnify-signature" (HMAC-SHA512 of the raw body with the
//     secret key); a wrong signature is rejected. Sandbox webhooks have no signature, which is safe because settle() always asks
//     Monnify itself about the payment before crediting anything.
routerAdd("POST", "/api/jjhhf/monnify-webhook", (e) => {
  const D = require(`${__hooks}/deposits.js`);
  let raw = ""; try { raw = readerToString(e.request.body); } catch (_) { }
  const secret = $os.getenv("MONNIFY_SECRET_KEY"), sig = e.request.header.get("monnify-signature") || "";
  if (!secret || !raw) return e.json(401, { message: "Not configured" });
  if (sig && !$security.equal(sig.toLowerCase(), $security.hs512(raw, secret).toLowerCase())) return e.json(401, { message: "Invalid signature" });
  let body = {}; try { body = JSON.parse(raw); } catch (_) { return e.json(400, { message: "Bad body" }); }
  const ref = body.eventData && body.eventData.paymentReference;
  if (body.eventType !== "SUCCESSFUL_TRANSACTION" || typeof ref !== "string" || !ref.startsWith("JJHHF-DEP-")) return e.json(200, { ok: true });
  try { D.settle(ref, ""); } catch (err) { if (String(err).includes("Deposit not found")) return e.json(200, { ok: true }); throw err; }
  return e.json(200, { ok: true });
});

// 3) Admin: credit a member's wallet by hand (for example cash, or a transfer made without a receipt). The payment reference is optional
//    and may be used again (it is kept as a note on the wallet history line).
routerAdd("POST", "/api/jjhhf/wallet/credit", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, amount = Math.round(Number(b.amount) * 100) / 100, ref = String(b.ref || "").trim().slice(0, 100), note = String(b.note || "").trim().slice(0, 200), uid = String(b.user || "");
  if (!(amount > 0)) throw new BadRequestError("Enter an amount.");
  let bal = 0;
  W.inTx((tx) => {
    try { tx.findRecordById("users", uid); } catch (_) { throw new BadRequestError("Member not found."); }
    const id = "MANUAL-" + Date.now() + "-" + $security.randomStringWithAlphabet(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");   // always unique, so a reference can repeat
    W.credit(tx, uid, amount, id, ["Credited by admin", ref && "ref " + ref, note].filter(Boolean).join(" · "));
    W.collect(tx, uid);
    bal = W.balanceOf(tx, uid);
  });
  return e.json(200, { ok: true, balance: bal });
}, $apis.requireAuth());

// 3b) Admin: take money out of a member's wallet (a correction, a refund paid out by hand, ...). It cannot take the balance below zero.
routerAdd("POST", "/api/jjhhf/wallet/deduct", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, amount = Math.round(Number(b.amount) * 100) / 100, ref = String(b.ref || "").trim().slice(0, 100), note = String(b.note || "").trim().slice(0, 200), uid = String(b.user || "");
  if (!(amount > 0)) throw new BadRequestError("Enter an amount.");
  if (!note) throw new BadRequestError("Give a reason; the member sees it in their wallet history.");
  let bal = 0;
  W.inTx((tx) => {
    let u; try { u = tx.findRecordById("users", uid); } catch (_) { throw new BadRequestError("Member not found."); }
    const have = u.getFloat("wallet_balance");
    if (amount > have) throw new BadRequestError("The wallet only has " + W.naira(have) + ", so at most " + W.naira(Math.max(0, have)) + " can be deducted.");
    bal = W.post(tx, uid, -amount, "deduction", ["Deducted by admin", note, ref && "ref " + ref].filter(Boolean).join(" · "));
  });
  return e.json(200, { ok: true, balance: bal });
}, $apis.requireAuth());

// 4) Pay a fee or join a plan from the wallet: t-shirt (once), joining fee (per plan joined, plus the catch-up on a mid-season cash/foodie plan),
//    payout clearance fee (once per plan, before its payout request). The amount is decided here, never by the browser.
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
  const dp = one("SELECT COALESCE(SUM(CASE WHEN [[status]] = 'successful' THEN 1 ELSE 0 END), 0) AS ok, COALESCE(SUM(CASE WHEN [[status]] = 'successful' THEN [[amount]] ELSE 0 END), 0) AS total, COALESCE(SUM(CASE WHEN [[status]] = 'pending' THEN 1 ELSE 0 END), 0) AS pending FROM {{deposits}}", { ok: 0, total: -0, pending: 0 });
  const tx = one("SELECT COALESCE(SUM([[amount]]), 0) AS tax FROM {{fees}} WHERE [[status]] = 'confirmed' AND [[type]] = 'tax'", { tax: -0 });
  const byGw = {}; ["flutterwave", "paystack", "monnify"].forEach(g => { const r = one("SELECT COUNT(*) AS n, COALESCE(SUM([[amount]]), 0) AS total FROM {{deposits}} WHERE [[status]] = 'successful' AND [[gateway]] = '" + g + "'", { n: 0, total: -0 }); byGw[g] = { n: r.n, total: r.total }; });
  const rc = one("SELECT COALESCE(SUM(CASE WHEN [[status]] = 'pending' AND [[gateway]] = 'transfer' THEN 1 ELSE 0 END), 0) AS waiting, COALESCE(SUM(CASE WHEN [[status]] = 'successful' AND [[verified]] = 'auto' THEN 1 ELSE 0 END), 0) AS tocheck, COALESCE(SUM(CASE WHEN [[status]] = 'reversed' THEN [[amount]] ELSE 0 END), 0) AS reversed FROM {{deposits}}", { waiting: 0, tocheck: 0, reversed: -0 });
  const sp = one("SELECT COUNT(*) AS n FROM {{users}} WHERE [[suspended]] = TRUE", { n: 0 });
  const cd = one("SELECT COALESCE(SUM(CASE WHEN [[code_used_at]] != '' OR [[code_admin]] = 'used' THEN 1 ELSE 0 END), 0) AS used, COALESCE(SUM(CASE WHEN [[code]] != '' AND [[code_used_at]] = '' AND [[code_admin]] = '' AND [[code_from]] <= {:now} AND [[code_until]] > {:now} THEN 1 ELSE 0 END), 0) AS open FROM {{subscriptions}}".replace(/\{:now\}/g, "'" + new Date().toISOString().replace("T", " ") + "'"), { used: 0, open: 0 });
  return e.json(200, {
    users: all.users, members: u.members, registered: u.registered, unregistered: u.members - u.registered, withAccount: u.withAccount, admins: all.users - u.members,
    held: all.held, subscriptions: s.n, activeSubscriptions: s.active, pendingPayments: p.pending, confirmedTotal: p.confirmed, penalties: p.penalties,
    fees: f.fees - tx.tax, tax: tx.tax, receiptsWaiting: rc.waiting, receiptsToCheck: rc.tocheck, reversedTotal: rc.reversed, suspended: sp.n, deposits: dp.ok, depositTotal: dp.total, pendingDeposits: dp.pending, codesUsed: cd.used, codesOpen: cd.open, byGateway: byGw, gateways: require(`${__hooks}/gateways.js`).enabled(), pendingPayouts: po.pending, plans: pl.n, topups: tu.n, topupTotal: tu.total,
  });
}, $apis.requireAuth());

// 7) Safety net every 10 minutes: deposits still pending after 3 minutes (member closed the page and the webhook was missed) are checked
//    with Flutterwave for up to 2 days.
cronAdd("jjhhf_deposit_check", "*/10 * * * *", () => {
  const D = require(`${__hooks}/deposits.js`), W = require(`${__hooks}/wallet.js`);
  const now = Date.now();
  // online payments paused: online checkouts that were opened but never finished are closed as "not completed"
  // (bank-transfer receipts are never touched here; they wait for an admin)
  if (($os.getenv("ONLINE_PAYMENTS") || "").toLowerCase() !== "on") {
    $app.findRecordsByFilter("deposits", "status = 'pending' && gateway != 'transfer' && created <= {:a}", "created", 500, 0, { a: W.ts(new Date(now - 30 * 60e3)) }).forEach(d => {
      try { d.set("status", "failed"); d.set("note", "Online checkout not completed"); $app.save(d); } catch (err) { console.log("jjhhf close checkout:", d.id, String(err)); }
    });
    return;
  }
  $app.findRecordsByFilter("deposits", "status = 'pending' && created <= {:a} && created >= {:b}", "created", 200, 0,
    { a: W.ts(new Date(now - 3 * 60e3)), b: W.ts(new Date(now - 2 * 864e5)) }).forEach(d => {
    try { D.settle(d.getString("tx_ref"), ""); } catch (err) { console.log("jjhhf deposit check:", d.getString("tx_ref"), String(err)); }
  });
});

// 8) Check a plan code before joining (shows the member whether it is valid, used, expired or not open yet).
routerAdd("POST", "/api/jjhhf/code/check", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  const c = W.codeState($app, (e.requestInfo().body || {}).code);
  return e.json(200, { status: c.status, code: c.code, message: c.message, plan: c.plan || "", from: c.from ? c.from.toISOString() : "", until: c.until ? c.until.toISOString() : "" });
}, $apis.requireAuth());

// 9) Admin: change a plan code's status. status: "used" | "expired" (marked by the foundation) | "auto" (restore: back to its normal dates).
//    A code that a member actually used cannot be changed.
routerAdd("POST", "/api/jjhhf/admin/code-status", (e) => {
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, st = String(b.status || "");
  if (!["used", "expired", "auto"].includes(st)) throw new BadRequestError("Choose used, expired or restore.");
  let rec; try { rec = $app.findRecordById("subscriptions", String(b.subscription || "")); } catch (_) { throw new BadRequestError("Plan code not found."); }
  if (!rec.getString("code")) throw new BadRequestError("This membership has no plan code.");
  if (rec.getString("code_used_at")) throw new BadRequestError("This code was used by " + (rec.getString("code_used_name") || "a member") + ", so its status cannot be changed.");
  rec.set("code_admin", st === "auto" ? "" : st);
  rec.set("code_admin_at", st === "auto" ? "" : new Date().toISOString().replace("T", " "));
  $app.save(rec);
  return e.json(200, { ok: true, code: rec.getString("code"), status: st });
}, $apis.requireAuth());

// 10) Admin: set a member's payment provider by hand, or "" for Automatic (a balanced random draw, see gateways.js).
routerAdd("POST", "/api/jjhhf/admin/gateway", (e) => {
  const G = require(`${__hooks}/gateways.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, g = String(b.gateway || "");
  let u; try { u = $app.findRecordById("users", String(b.user || "")); } catch (_) { throw new BadRequestError("Member not found."); }
  if (!g) {
    const got = G.assign($app, u.id);
    return e.json(200, { gateway: got, manual: false, message: got ? "" : "No payment provider is set up yet; one will be given automatically once it is." });
  }
  if (!G.NAMES[g]) throw new BadRequestError("Unknown payment provider.");
  u.set("gateway", g); u.set("gateway_manual", true); $app.save(u);
  return e.json(200, { gateway: g, manual: true, message: G.enabled().includes(g) ? "" : G.NAMES[g] + " is not set up yet, so their next deposit will use another provider until it is." });
}, $apis.requireAuth());

// 11) Admin: reshuffle payment providers across members, evenly and at random.
//     mode "unassigned": only members without a (working) provider; mode "all": everyone except members set by hand.
routerAdd("POST", "/api/jjhhf/admin/gateway/shuffle", (e) => {
  const G = require(`${__hooks}/gateways.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const mode = String((e.requestInfo().body || {}).mode || "unassigned") === "all" ? "all" : "unassigned";
  return e.json(200, G.shuffle($app, mode));
}, $apis.requireAuth());

// 12) Every 15 minutes: members still without a provider (signed up before any provider was set up, or theirs was switched off)
//     are given one automatically.
cronAdd("jjhhf_gateway_assign", "*/15 * * * *", () => {
  const G = require(`${__hooks}/gateways.js`);
  if (($os.getenv("ONLINE_PAYMENTS") || "").toLowerCase() !== "on" || !G.enabled().length) return;   // paused with online payments
  try { const r = G.shuffle($app, "unassigned"); if (r.total) console.log("jjhhf gateway assign: gave a provider to", r.total, "members"); }
  catch (err) { console.log("jjhhf gateway assign:", String(err)); }
});

// ===================== bank transfers with a receipt (transfers.js) =====================
// 13) The receiving account and the deposit rules, for the member's Wallet page.
routerAdd("GET", "/api/jjhhf/transfer/info", (e) => {
  const T = require(`${__hooks}/transfers.js`), S = T.settingsObj($app);
  return e.json(200, { bank_name: S.bank_name, account_number: S.account_number, account_name: S.account_name, transfer_note: S.transfer_note, tax: T.TAX, min: T.MIN, auto: S.auto_approve, max_age_days: S.max_age_days || 2 });
}, $apis.requireAuth());

// 14) A member submits a transfer: multipart form with amount, sender_name and the receipt file. The receipt is read and checked at once.
routerAdd("POST", "/api/jjhhf/transfer", (e) => {
  const T = require(`${__hooks}/transfers.js`);
  const body = e.requestInfo().body || {};
  let files = []; try { files = e.findUploadedFiles("receipt") || []; } catch (_) { }
  return e.json(200, T.submit($app, e.auth.id, body.amount, files[0], body.sender_name));
}, $apis.requireAuth(), $apis.bodyLimit(8 * 1024 * 1024));

// 15) Admin: approve | reject | confirm | reverse a transfer.
routerAdd("POST", "/api/jjhhf/admin/transfer", (e) => {
  const T = require(`${__hooks}/transfers.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {};
  return e.json(200, T.review($app, e.auth.id, b.id, String(b.action || ""), b.note));
}, $apis.requireAuth());

// 16) Admin: read / save the receiving account and the automatic-approval settings.
routerAdd("POST", "/api/jjhhf/admin/settings", (e) => {
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {};
  let r; try { r = $app.findFirstRecordByFilter("app_settings", "id != ''"); } catch (_) { r = new Record($app.findCollectionByNameOrId("app_settings")); }
  const acct = String(b.account_number || "").replace(/\D/g, "");
  if (acct && acct.length !== 10) throw new BadRequestError("Enter the 10-digit account number.");
  r.set("bank_name", String(b.bank_name || "").trim().slice(0, 100));
  r.set("account_number", acct);
  r.set("account_name", String(b.account_name || "").trim().slice(0, 150));
  r.set("transfer_note", String(b.transfer_note || "").trim().slice(0, 500));
  r.set("auto_approve", !!b.auto_approve);
  r.set("auto_max", Math.max(0, Math.round(Number(b.auto_max) || 0)));
  r.set("max_age_days", Math.min(30, Math.max(0, Math.round(Number(b.max_age_days) || 0))));
  $app.save(r);
  return e.json(200, require(`${__hooks}/transfers.js`).settingsObj($app));
}, $apis.requireAuth());
routerAdd("GET", "/api/jjhhf/admin/settings", (e) => {
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const T = require(`${__hooks}/transfers.js`);
  return e.json(200, Object.assign(T.settingsObj($app), { ai: !!T.providerName(), ai_name: T.providerName() }));
}, $apis.requireAuth());

// 17) Admin: add a plan a member was running manually (how long it has run and how much was paid); it carries on automatically.
routerAdd("POST", "/api/jjhhf/admin/import-plan", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {};
  let out = {};
  // b.items = [{ plan, days, amount_paid, count, note }] adds several at once; the single-plan form (plan, days, amount_paid) still works
  W.inTx((tx) => { out = Array.isArray(b.items) ? W.importMany(tx, String(b.user || ""), b.items, b.note, !!b.charge_penalty) : W.importPlan(tx, String(b.user || ""), b.plan, b.days, b.amount_paid, b.note, { chargePenalty: !!b.charge_penalty }); });
  return e.json(200, out);
}, $apis.requireAuth());

// 18) Admin: suspend / restore a member account. A suspended member cannot sign in or use the site (see main.pb.js).
routerAdd("POST", "/api/jjhhf/admin/suspend", (e) => {
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, on = !!b.suspended;
  let u; try { u = $app.findRecordById("users", String(b.user || "")); } catch (_) { throw new BadRequestError("Member not found."); }
  if (u.getString("role") === "admin") throw new BadRequestError("An admin account cannot be suspended. Make them a member first.");
  const reason = String(b.reason || "").trim().slice(0, 300);
  if (on && !reason) throw new BadRequestError("Give a reason; the member sees it when they try to sign in.");
  u.set("suspended", on); u.set("suspended_reason", on ? reason : ""); u.set("suspended_at", on ? new Date().toISOString().replace("T", " ") : "");
  $app.save(u);
  return e.json(200, { suspended: on });
}, $apis.requireAuth());

// 19) Receipts that were slow to read the first time are read again in the background, every minute (transfers.js).
cronAdd("jjhhf_receipt_queue", "* * * * *", () => {
  const T = require(`${__hooks}/transfers.js`);
  const store = $app.store(), KEY = "jjhhf_receipt_lock", t0 = Date.now(), held = store.get(KEY);
  if (held && t0 - Number(held) < 5 * 60e3) return;
  store.set(KEY, t0);
  try { const n = T.processQueue($app, 45e3); if (n) console.log("jjhhf receipts: finished", n, "in the background"); }
  catch (err) { console.log("jjhhf receipt queue:", String(err)); }
  finally { store.remove(KEY); }
});

// 20) Admin: edit a running plan (how long it has run, amount paid, penalty on overdue payments, note). See wallet.js editPlan.
routerAdd("POST", "/api/jjhhf/admin/edit-plan", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {};
  let out = {};
  W.inTx((tx) => { out = W.editPlan(tx, String(b.subscription || ""), { days: b.days, amount_paid: b.amount_paid, charge_penalty: b.charge_penalty === undefined ? undefined : !!b.charge_penalty, note: b.note }); });
  return e.json(200, out);
}, $apis.requireAuth());
