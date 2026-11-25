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
    // also members with a fully paid plan still owing the clearance fee who now have enough in the wallet
    const rows2 = arrayOf(new DynamicModel({ uid: "" }));
    $app.db().newQuery("SELECT s.[[user]] AS uid FROM {{subscriptions}} s JOIN {{users}} u ON u.[[id]] = s.[[user]] WHERE s.[[status]] = 'active' AND s.[[clearance_paid_at]] = '' AND s.[[next_collect]] = {:done} AND u.[[wallet_balance]] >= {:fee} AND NOT EXISTS (SELECT 1 FROM {{payouts}} p WHERE p.[[subscription]] = s.[[id]] AND p.[[status]] != 'rejected') GROUP BY s.[[user]] LIMIT 50000")
      .bind({ done: W.DONE, fee: W.FEES.clearance }).all(rows2);
    const seen = {}; rows.forEach(r => seen[r.uid] = 1); rows2.forEach(r => { if (!seen[r.uid]) { seen[r.uid] = 1; rows.push(r); } });
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
  return e.json(200, { status: c.status, code: c.code, count: c.count || 1, message: c.message, plan: c.plan || "", from: c.from ? c.from.toISOString() : "", until: c.until ? c.until.toISOString() : "" });
}, $apis.requireAuth());

// 8b) How the plans joined with your plan codes are going. ids = the referred plans (code_used_sub of the codes), comma separated.
//     A member gets only plans joined with their own codes; an admin gets any. Returns { id: { plan, status, paid, total, overdue, next } }.
routerAdd("GET", "/api/jjhhf/code/referred", (e) => {
  const R = require(`${__hooks}/rules.js`);
  const admin = e.auth.getString("role") === "admin";
  const ids = String(e.request.url.query().get("ids") || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 200);
  const out = {};
  ids.forEach(id => {
    if (!admin) {   // must be a plan joined with one of this member's codes
      if (!$app.findRecordsByFilter("subscriptions", "user = {:u} && code_used_sub = {:s}", "", 1, 0, { u: e.auth.id, s: id }).length) return;
    }
    let s; try { s = $app.findRecordById("subscriptions", id); } catch (_) { out[id] = { gone: true }; return; }
    let plan; try { plan = $app.findRecordById("plans", s.getString("plan")); } catch (_) { out[id] = { gone: true }; return; }
    const pl = R.planObj(plan), sub = { id: s.id, created: s.getString("created"), no_penalty_before: s.getString("no_penalty_before") };
    const paid = s.getInt("paid_count"), total = R.sched(sub, pl).n, st = R.stateFromPaid(sub, pl, paid, new Date());
    out[id] = { plan: plan.getString("name"), amount: pl.amount, frequency: plan.getString("frequency"), status: s.getString("status"), paid, total,
      overdue: s.getString("status") === "active" ? (st.overdue || 0) : 0, next: st.left && s.getString("status") === "active" && st.next ? st.next.toISOString() : "", started: s.getString("created") };
  });
  return e.json(200, out);
}, $apis.requireAuth());

// 9) Admin: change a plan code's status. status: "used" | "expired" (marked by the foundation) | "auto" (restore: back to its normal dates)
//    | "open" (a code that is not open yet becomes usable now; its last day stays the same).
//    A code that a member actually used cannot be changed.
// Plan code fields an admin action can change; every change returns a snapshot of them before and after, so the admin
// dashboard can undo / redo it (POST /api/jjhhf/admin/code-restore puts a snapshot back).
routerAdd("POST", "/api/jjhhf/admin/code-status", (e) => {
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, st = String(b.status || "");
  if (!["used", "expired", "auto", "open", "reopen", "relink"].includes(st)) throw new BadRequestError("Choose open, used, expired, restore, reopen or relink.");
  const CODE_FIELDS = ["code_from", "code_until", "code_admin", "code_admin_at", "code_used_by", "code_used_name", "code_used_at", "code_used_sub"];
  const snap = rec => { const o = { id: rec.id, code: rec.getString("code") }; CODE_FIELDS.forEach(f => o[f] = rec.getString(f)); return o; };
  const iso = d => d.toISOString().replace("T", " ");
  let until = null;
  if (st === "reopen") {
    const m = String(b.until || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) throw new BadRequestError("Choose the code's new last day.");
    until = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 36e5 + 864e5); if (!(until > new Date())) throw new BadRequestError("The new last day must be today or later.");
  }
  // one change; returns null when it does not apply to this code (it is then skipped in a bulk change, an error when alone)
  const apply = (app, rec, alone) => {
    const no = msg => { if (alone) throw new BadRequestError(msg); return null; };
    if (!rec.getString("code")) return no("This membership has no plan code.");
    const now = new Date(), before = snap(rec);
    if (st === "relink") {
      // used, then reopened by mistake: link the code back to the plan that joined with it (the latest one if several) and mark it used
      const joined = app.findRecordsByFilter("subscriptions", "joined_code = {:c} && id != {:id}", "-created", 1, 0, { c: rec.getString("code"), id: rec.id });
      if (!joined.length) return no("No plan was joined with " + rec.getString("code") + ", so there is nothing to link it to.");
      const j = joined[0]; let who = "a member"; try { const u = app.findRecordById("users", j.getString("user")); who = u.getString("name") || u.getString("email"); } catch (_) { }
      if (rec.getString("code_used_sub") === j.id) return no(rec.getString("code") + " is already linked to that plan.");
      rec.set("code_used_by", j.getString("user")); rec.set("code_used_name", who); rec.set("code_used_at", j.getString("created")); rec.set("code_used_sub", j.id);
      rec.set("code_admin", ""); rec.set("code_admin_at", "");
    } else if (st === "reopen") {
      for (const f of ["code_used_by", "code_used_name", "code_used_at", "code_used_sub", "code_admin", "code_admin_at"]) rec.set(f, "");
      if (!(new Date(String(rec.getString("code_from")).replace(" ", "T")) <= now)) rec.set("code_from", iso(now));
      rec.set("code_until", iso(until));
    } else {
      if (rec.getString("code_used_at")) return no("This code was used by " + (rec.getString("code_used_name") || "a member") + ", so its status cannot be changed (use Reopen).");
      if (st === "open") {
        if (rec.getString("code_admin")) return no("Restore the code first.");
        if (!(new Date(String(rec.getString("code_until")).replace(" ", "T")) > now)) return no("This code has already expired, so it cannot be opened (use Reopen).");
        if (new Date(String(rec.getString("code_from")).replace(" ", "T")) <= now) return no("This code is already open.");
        rec.set("code_from", iso(now));
      } else if (st === "auto") {
        if (!rec.getString("code_admin")) return no("This code was not marked by an admin.");
        rec.set("code_admin", ""); rec.set("code_admin_at", "");
      } else {
        if (rec.getString("code_admin") === st) return no("This code is already marked as " + st + ".");
        rec.set("code_admin", st); rec.set("code_admin_at", iso(now));
      }
    }
    app.save(rec);
    return { before, after: snap(rec) };
  };
  // several at once: { subscriptions: [ids], status, until } in one go; codes it does not apply to are skipped
  if (Array.isArray(b.subscriptions)) {
    const ids = [...new Set(b.subscriptions.map(String).filter(Boolean))];
    if (!ids.length) throw new BadRequestError("Select the codes first.");
    if (ids.length > 1000) throw new BadRequestError("Change at most 1000 codes at once.");
    const changes = []; let skipped = 0, wasUsed = 0;
    $app.runInTransaction((tx) => ids.forEach(id => {
      let rec; try { rec = tx.findRecordById("subscriptions", id); } catch (_) { skipped++; return; }
      const c = apply(tx, rec, false); if (!c) { skipped++; return; }
      if (c.before.code_used_at) wasUsed++;
      changes.push(c);
    }));
    console.log("jjhhf: admin", e.auth.id, "set", changes.length, "plan codes to", st, skipped ? "(" + skipped + " skipped)" : "");
    return e.json(200, { ok: true, changed: changes.length, reopened: st === "reopen" ? changes.length : 0, skipped, was_used: wasUsed, before: changes.map(c => c.before), after: changes.map(c => c.after) });
  }
  let rec; try { rec = $app.findRecordById("subscriptions", String(b.subscription || "")); } catch (_) { throw new BadRequestError("Plan code not found."); }
  const c = apply($app, rec, true);
  return e.json(200, { ok: true, code: rec.getString("code"), status: st === "reopen" ? "open" : st, was_used_by: c.before.code_used_name, before: [c.before], after: [c.after] });
}, $apis.requireAuth());

// Codes that a plan was joined with but that are no longer marked as used (for example reopened by mistake): candidates for "relink".
// GET -> [{ id, code, owner, owner_name, joined: { id, user, name, plan, at } }] (the latest plan joined with each code)
routerAdd("GET", "/api/jjhhf/admin/code-relink", (e) => {
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const rows = arrayOf(new DynamicModel({ cid: "", code: "", owner: "", jid: "", juser: "", jplan: "", jat: "" }));
  $app.db().newQuery("SELECT c.id AS cid, c.code AS code, c.user AS owner, j.id AS jid, j.user AS juser, j.plan AS jplan, j.created AS jat FROM {{subscriptions}} c JOIN {{subscriptions}} j ON j.joined_code = c.code AND j.id != c.id WHERE c.code != '' AND c.code_used_at = '' ORDER BY j.created DESC LIMIT 5000").all(rows);
  const seen = {}, out = [], name = id => { try { const u = $app.findRecordById("users", id); return u.getString("name") || u.getString("email"); } catch (_) { return ""; } };
  const plan = id => { try { return $app.findRecordById("plans", id).getString("name"); } catch (_) { return ""; } };
  rows.forEach(r => { if (seen[r.cid]) return; seen[r.cid] = 1;
    out.push({ id: r.cid, code: r.code, owner: r.owner, owner_name: name(r.owner), joined: { id: r.jid, user: r.juser, name: name(r.juser), plan: plan(r.jplan), at: r.jat } }); });
  return e.json(200, out);
}, $apis.requireAuth());

// Undo / redo of plan code changes: puts saved code fields back (only the plan code fields above can be written).
routerAdd("POST", "/api/jjhhf/admin/code-restore", (e) => {
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const F = ["code_from", "code_until", "code_admin", "code_admin_at", "code_used_by", "code_used_name", "code_used_at", "code_used_sub"];
  const items = Array.isArray((e.requestInfo().body || {}).items) ? e.requestInfo().body.items : [];
  if (!items.length || items.length > 1000) throw new BadRequestError("Nothing to restore.");
  let n = 0;
  $app.runInTransaction((tx) => items.forEach(it => {
    let rec; try { rec = tx.findRecordById("subscriptions", String(it.id || "")); } catch (_) { return; }
    if (it.code && rec.getString("code") !== it.code) return;
    F.forEach(f => { if (it[f] !== undefined) rec.set(f, String(it[f] || "")); });
    tx.save(rec); n++;
  }));
  return e.json(200, { ok: true, restored: n });
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
  // b.code_mode: "custom" (b.code_from / b.code_until, "YYYY-MM-DD") | "none" | left out (the plan's usual code days)
  const code = b.code_mode === "custom" ? { from: String(b.code_from || ""), until: String(b.code_until || "") } : b.code_mode === "none" ? "none" : undefined;
  W.inTx((tx) => { out = Array.isArray(b.items) ? W.importMany(tx, String(b.user || ""), b.items, b.note, !!b.charge_penalty, code, !!b.charge_join_fee, !!b.charge_paid) : W.importPlan(tx, String(b.user || ""), b.plan, b.days, b.amount_paid, b.note, { chargePenalty: !!b.charge_penalty, chargeJoinFee: !!b.charge_join_fee, chargePaid: !!b.charge_paid, code }); });
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
  W.inTx((tx) => { out = W.editGroup(tx, String(b.subscription || ""), { days: b.days, amount_paid: b.amount_paid, charge_penalty: b.charge_penalty === undefined ? undefined : !!b.charge_penalty, charge_difference: !!b.charge_difference, note: b.note,
    plan: b.plan, status: b.status, code_from: b.code_from, code_until: b.code_until, give_code: !!b.give_code, move_code: !!b.move_code, penalty_mode: b.penalty_mode, clearance_paid: b.clearance_paid === undefined ? undefined : !!b.clearance_paid }); });
  return e.json(200, out);
}, $apis.requireAuth());

// 21) Admin: permanently delete a SUSPENDED member and everything about them (plans, plan codes, payments, payouts, fees, wallet
//     history, deposits and their receipt files, profile and bank details). Cannot be undone. Other members who used one of their
//     plan codes keep their plans; the "used by" name on those codes becomes "Deleted member".
//     GET  ?user=ID  -> how many records would be deleted (for the confirmation window)
//     POST {user, confirm: "DELETE"}
routerAdd("GET", "/api/jjhhf/admin/delete-user", (e) => {
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const uid = String(e.request.url.query().get("user") || ""), out = {};
  ["payments", "payouts", "fees", "wallet_txs", "deposits", "subscriptions"].forEach(c => {
    const m = new DynamicModel({ n: 0 });
    $app.db().newQuery("SELECT COUNT(*) AS n FROM {{" + c + "}} WHERE [[user]] = {:u}").bind({ u: uid }).one(m);
    out[c] = m.n;
  });
  return e.json(200, out);
}, $apis.requireAuth());
routerAdd("POST", "/api/jjhhf/admin/delete-user", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, uid = String(b.user || "");
  if (String(b.confirm || "") !== "DELETE") throw new BadRequestError("Type DELETE to confirm.");
  let removed = {}, name = "";
  W.inTx((tx) => {
    let u; try { u = tx.findRecordById("users", uid); } catch (_) { throw new BadRequestError("Member not found."); }
    if (u.getString("role") === "admin") throw new BadRequestError("An admin account cannot be deleted here.");
    if (!u.getBool("suspended")) throw new BadRequestError("Suspend the account first; only suspended accounts can be deleted.");
    name = u.getString("name") || u.getString("email");
    removed = W.wipeMemberData(tx, uid, "Deleted member");
    tx.delete(u);
  });
  console.log("jjhhf: admin", e.auth.id, "permanently deleted member", uid, JSON.stringify(removed));
  return e.json(200, { ok: true, name, removed });
}, $apis.requireAuth());

// 21b) Admin: delete plans and every record linked to them (memberships, payments, payouts, fees, wallet history).
//      body: { plans: [ids] (plan types) | subscriptions: [ids] (a member's plan; takes its whole group), refund: bool,
//              preview: true (counts only) | confirm: "DELETE" }
routerAdd("POST", "/api/jjhhf/admin/delete-plan", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, target = { plans: [].concat(b.plans || []), subscriptions: [].concat(b.subscriptions || []) };
  if (b.preview) return e.json(200, W.deletePlans($app, target, !!b.refund, true));
  if (String(b.confirm || "") !== "DELETE") throw new BadRequestError("Type DELETE to confirm.");
  let out = {};
  W.inTx((tx) => { out = W.deletePlans(tx, target, !!b.refund, false); });
  console.log("jjhhf: admin", e.auth.id, "deleted plans", JSON.stringify(target), "refund", !!b.refund, JSON.stringify(out));
  return e.json(200, out);
}, $apis.requireAuth());

// 21c) Admin: reset a member's late-penalty record. Every confirmed payment that carried a penalty goes back to the normal
//      contribution amount and the penalties are refunded to the member's wallet as one "Refund" entry.
//      waive_now: also waive the penalty on payments that are overdue right now (they are then taken at the normal amount).
//      body { user, preview: true } -> counts only | { user, confirm: "RESET", waive_now }
routerAdd("POST", "/api/jjhhf/admin/reset-penalties", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, uid = String(b.user || "");
  try { $app.findRecordById("users", uid); } catch (_) { throw new BadRequestError("Member not found."); }
  const list = () => $app.findRecordsByFilter("payments", "user = {:u} && status = 'confirmed' && penalty > 0", "", 0, 0, { u: uid });
  const pays = list(), total = pays.reduce((a, p) => a + p.getFloat("penalty"), 0);
  if (b.preview) return e.json(200, { payments: pays.length, total });
  if (String(b.confirm || "") !== "RESET") throw new BadRequestError("Type RESET to confirm.");
  let out = {};
  W.inTx((tx) => {
    const ps = tx.findRecordsByFilter("payments", "user = {:u} && status = 'confirmed' && penalty > 0", "", 0, 0, { u: uid });
    let sum = 0;
    ps.forEach(p => { const pen = p.getFloat("penalty"); sum += pen;
      p.set("amount", p.getFloat("amount") - pen); p.set("penalty", 0); p.set("late_count", 0);
      p.set("note", (p.getString("note") || "Wallet") + " · penalty refunded"); tx.save(p); });
    if (sum > 0) W.post(tx, uid, sum, "refund", "Refund · late penalties reset by the foundation (" + ps.length + " payment" + (ps.length === 1 ? "" : "s") + ")");
    let waived = 0;
    if (b.waive_now) tx.findRecordsByFilter("subscriptions", "user = {:u} && status = 'active'", "", 0, 0, { u: uid }).forEach(r => {
      r.set("no_penalty_before", new Date().toISOString().replace("T", " ")); tx.save(r); waived++; });
    out = { payments: ps.length, refunded: sum, waived, collected: W.collect(tx, uid) };
  });
  console.log("jjhhf: admin", e.auth.id, "reset late penalties of", uid, JSON.stringify(out));
  return e.json(200, out);
}, $apis.requireAuth());

// 21d) Admin: link plan codes to plans that were joined with them but not recorded (or recorded wrongly).
//      Picks the plans in the group (a "× 10" card) that have no "joined with" code yet, oldest first, and gives each one code:
//      the plan shows "joined with CODE" and the code becomes "used" by this member, linked to that plan, dated when the plan
//      started. The other plans in the group stay as normal registrations; the group itself is not changed.
//      body { subscription (any plan of the group), codes: [..] | "text", preview: true } -> plan per code, problems
routerAdd("POST", "/api/jjhhf/admin/link-codes", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {};
  let lead; try { lead = $app.findRecordById("subscriptions", String(b.subscription || "")); } catch (_) { throw new BadRequestError("Plan not found."); }
  const raw = [].concat(Array.isArray(b.codes) ? b.codes : [b.codes || ""]).join(" ");
  const codes = []; raw.split(/[\s,;]+/).forEach(c => { if (c.trim()) { const k = W.normCode(c); if (!codes.includes(k)) codes.push(k); } });
  if (!codes.length) throw new BadRequestError("Enter the plan codes to link.");
  const plan = (app) => {
    const group = W.groupOf(app, app.findRecordById("subscriptions", lead.id)), uid = lead.getString("user");
    const free = group.filter(s => !s.getString("joined_code"));
    const rows = codes.map(c => {
      let rec = null; try { rec = app.findFirstRecordByData("subscriptions", "code", c); } catch (_) { }
      if (!rec) return { code: c, ok: false, msg: "does not exist" };
      if (rec.getString("user") === uid && group.some(g => g.id === rec.id)) return { code: c, ok: false, msg: "belongs to one of these same plans" };
      if (group.some(g => g.getString("joined_code") === c)) return { code: c, ok: false, msg: "already linked to one of these plans" };
      const usedSub = rec.getString("code_used_sub");
      if (usedSub) { try { app.findRecordById("subscriptions", usedSub); return { code: c, ok: false, msg: "already used by " + (rec.getString("code_used_name") || "another member") + " (reopen it first if that was a mistake)" }; } catch (_) { } }
      let owner = ""; try { const u = app.findRecordById("users", rec.getString("user")); owner = u.getString("name") || u.getString("email"); } catch (_) { }
      return { code: c, ok: true, rec, owner };
    });
    const good = rows.filter(r => r.ok);
    if (good.length > free.length) good.slice(free.length).forEach(r => { r.ok = false; r.msg = "no plan left without a code in this group (" + free.length + " free)"; });
    rows.filter(r => r.ok).forEach((r, i) => { r.sub = free[i]; });
    return { rows, group, free, uid };
  };
  if (b.preview) {
    const p = plan($app);
    return e.json(200, { group: p.group.length, free: p.free.length, rows: p.rows.map(r => ({ code: r.code, ok: r.ok, msg: r.msg || "", owner: r.owner || "", plan_started: r.sub ? r.sub.getString("created") : "" })) });
  }
  let out = {};
  W.inTx((tx) => {
    const p = plan(tx), bad = p.rows.filter(r => !r.ok);
    if (bad.length) throw new BadRequestError("Fix these codes first: " + bad.map(r => r.code + " (" + r.msg + ")").join("; "));
    let who = ""; try { const u = tx.findRecordById("users", p.uid); who = u.getString("name") || u.getString("email"); } catch (_) { }
    p.rows.forEach(r => {
      const sub = tx.findRecordById("subscriptions", r.sub.id), code = tx.findRecordById("subscriptions", r.rec.id);
      sub.set("joined_code", r.code); tx.save(sub);
      code.set("code_used_by", p.uid); code.set("code_used_name", who); code.set("code_used_at", sub.getString("created")); code.set("code_used_sub", sub.id);
      code.set("code_admin", ""); code.set("code_admin_at", ""); tx.save(code);
    });
    out = { linked: p.rows.length, group: p.group.length, left_without_code: p.free.length - p.rows.length };
  });
  console.log("jjhhf: admin", e.auth.id, "linked plan codes to group of", lead.id, JSON.stringify(out));
  return e.json(200, out);
}, $apis.requireAuth());

// 21e) Admin: reset EVERY member's late penalties at once.
//      Paid penalties: each payment goes back to the normal amount and the member gets one "Refund" with their total.
//      Unpaid penalties: the penalty on every payment overdue right now is waived (taken at the normal amount); later late payments
//      follow the usual rule. Plans set to "No penalty on this plan" keep that setting. Then anything due is collected.
//      body { preview: true } -> counts | { confirm: "RESET ALL" }
routerAdd("POST", "/api/jjhhf/admin/reset-penalties-all", (e) => {
  const W = require(`${__hooks}/wallet.js`), R = require(`${__hooks}/rules.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, now = new Date(), NEVER = "2999";
  // plans with a penalty waiting right now: an overdue instalment that would cost more than the contribution
  const owing = (app) => app.findRecordsByFilter("subscriptions", "status = 'active'", "", 0, 0).filter(s => {
    if (String(s.getString("no_penalty_before")) >= NEVER) return false;
    let plan; try { plan = app.findRecordById("plans", s.getString("plan")); } catch (_) { return false; }
    const sub = { id: s.id, created: s.getString("created"), no_penalty_before: s.getString("no_penalty_before") }, st = R.stateFromPaid(sub, R.planObj(plan), s.getInt("paid_count"), now);
    for (let k = 0; k < st.overdue; k++) if (st.cost(k) > st.A) return true;
    return false;
  });
  const paidList = (app) => app.findRecordsByFilter("payments", "status = 'confirmed' && penalty > 0", "", 0, 0);
  if (b.preview) {
    const pays = paidList($app), subs = owing($app), users = new Set(pays.map(p => p.getString("user")));
    const ou = new Set(subs.map(s => s.getString("user")));
    return e.json(200, { paid_payments: pays.length, paid_total: pays.reduce((a, p) => a + p.getFloat("penalty"), 0), paid_members: users.size, owing_plans: subs.length, owing_members: ou.size, members: new Set([...users, ...ou]).size });
  }
  if (String(b.confirm || "") !== "RESET ALL") throw new BadRequestError("Type RESET ALL to confirm.");
  let out = {};
  W.inTx((tx) => {
    const per = {}, touched = new Set();
    paidList(tx).forEach(p => { const u = p.getString("user"), pen = p.getFloat("penalty");
      per[u] = per[u] || { sum: 0, n: 0 }; per[u].sum += pen; per[u].n++;
      p.set("amount", p.getFloat("amount") - pen); p.set("penalty", 0); p.set("late_count", 0); p.set("note", (p.getString("note") || "Wallet") + " · penalty refunded"); tx.save(p); });
    let refunded = 0;
    Object.keys(per).forEach(u => { try { tx.findRecordById("users", u); } catch (_) { return; }
      W.post(tx, u, per[u].sum, "refund", "Refund · late penalties reset by the foundation (" + per[u].n + " payment" + (per[u].n === 1 ? "" : "s") + ")"); refunded += per[u].sum; touched.add(u); });
    const subs = owing(tx);
    subs.forEach(s => { s.set("no_penalty_before", now.toISOString().replace("T", " ")); tx.save(s); touched.add(s.getString("user")); });
    let collected = 0; touched.forEach(u => { try { collected += W.collect(tx, u); } catch (_) { } });
    out = { members: touched.size, refunded, refund_members: Object.keys(per).length, waived_plans: subs.length, collected };
  });
  console.log("jjhhf: admin", e.auth.id, "reset ALL late penalties", JSON.stringify(out));
  return e.json(200, out);
}, $apis.requireAuth());

// 22) Admin: complete / cancel / reactivate a plan; a group changes as a whole.
routerAdd("POST", "/api/jjhhf/admin/plan-status", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {};
  let out = {};
  W.inTx((tx) => { out = W.setGroupStatus(tx, String(b.subscription || ""), String(b.status || "")); });
  return e.json(200, out);
}, $apis.requireAuth());

// 23) Admin: mark a payout request paid or rejected; a group's requests change together.
routerAdd("POST", "/api/jjhhf/admin/payout-status", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, st = String(b.status || "");
  if (!["confirmed", "rejected"].includes(st)) throw new BadRequestError("Choose paid or rejected.");
  let n = 0;
  W.inTx((tx) => {
    let p; try { p = tx.findRecordById("payouts", String(b.payout || "")); } catch (_) { throw new BadRequestError("Payout request not found."); }
    const g = p.getString("group_id");
    const list = g ? tx.findRecordsByFilter("payouts", "group_id = {:g} && status = 'pending'", "", 0, 0, { g }) : [p];
    list.forEach(x => { if (x.getString("status") !== "pending") return; x.set("status", st); tx.save(x); n++; });
  });
  return e.json(200, { updated: n });
}, $apis.requireAuth());

// 24) Admin: reset a SUSPENDED member's account. Clears plans (and plan codes), payments, payouts, fees, wallet history, deposits and
//     receipt files, and sets the wallet to zero. Keeps the account with name, email, phone, country, address and payout details.
//     The account stays suspended; the admin can restore it later. b.clear_shirt also clears the t-shirt registration.
routerAdd("POST", "/api/jjhhf/admin/reset-user", (e) => {
  const W = require(`${__hooks}/wallet.js`);
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const b = e.requestInfo().body || {}, uid = String(b.user || "");
  if (String(b.confirm || "") !== "RESET") throw new BadRequestError("Type RESET to confirm.");
  let removed = {}, name = "";
  W.inTx((tx) => {
    let u; try { u = tx.findRecordById("users", uid); } catch (_) { throw new BadRequestError("Member not found."); }
    if (u.getString("role") === "admin") throw new BadRequestError("An admin account cannot be reset here.");
    if (!u.getBool("suspended")) throw new BadRequestError("Suspend the account first; only suspended accounts can be reset.");
    name = u.getString("name") || u.getString("email");
    removed = W.wipeMemberData(tx, uid, u.getString("name") || "Member (account reset)");
    const fresh = tx.findRecordById("users", uid);
    fresh.set("wallet_balance", 0);
    if (b.clear_shirt) { fresh.set("shirt_paid", false); fresh.set("shirt_paid_at", ""); }
    tx.save(fresh);
  });
  console.log("jjhhf: admin", e.auth.id, "reset member", uid, JSON.stringify(removed));
  return e.json(200, { ok: true, name, removed });
}, $apis.requireAuth());
