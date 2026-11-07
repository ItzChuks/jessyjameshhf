// Wallet: every member has a balance (users.wallet_balance) and a ledger (wallet_txs).
// Money comes in through the member's virtual account (see flutterwave.js + the webhook in wallet.pb.js) and goes out for
// fees, joining plans and contributions. All functions here expect to run INSIDE a transaction ($app.runInTransaction),
// so a balance and its ledger line can never disagree.
const R = require(`${__hooks}/rules.js`);
const FEES = { shirt: 5000, join: 3000, clearance: 3000 };   // KEEP IN SYNC with FEES in the frontend app.js
// NOTE: PocketBase's JS engine does not support toLocaleString(locale), so numbers and dates are formatted by hand.
const naira = n => "₦" + String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLagos = d => { const l = new Date(d.getTime() + 36e5); return l.getUTCDate() + " " + MONTHS[l.getUTCMonth()]; };

// Adds a ledger line and moves the balance. amount > 0 credits, amount < 0 debits. Throws if the balance would go negative.
function post(app, uid, amount, kind, note, extra = {}) {
  const u = app.findRecordById("users", uid);
  const bal = u.getFloat("wallet_balance") + amount;
  if (bal < 0) throw new BadRequestError("Not enough money in your wallet.");
  u.set("wallet_balance", bal);
  app.save(u);
  const tx = new Record(app.findCollectionByNameOrId("wallet_txs"));
  tx.set("user", uid); tx.set("type", amount >= 0 ? "credit" : "debit"); tx.set("amount", Math.abs(amount));
  tx.set("balance", bal); tx.set("kind", kind); tx.set("note", note || "");
  if (extra.ref) tx.set("ref", extra.ref);
  if (extra.plan) tx.set("plan", extra.plan);
  if (extra.subscription) tx.set("subscription", extra.subscription);
  app.save(tx);
  return bal;
}
const balanceOf = (app, uid) => app.findRecordById("users", uid).getFloat("wallet_balance");

// Records a verified money-in (top-up). Safe to call twice with the same ref: the second call does nothing. Returns true if credited.
function credit(app, uid, amount, ref, note) {
  if (ref) { try { app.findFirstRecordByData("wallet_txs", "ref", ref); return false; } catch (_) { /* new */ } }
  post(app, uid, amount, "topup", note, { ref });
  return true;
}

// Takes every instalment that is ready from the wallet, oldest deadline first, plan by plan.
// An instalment is ready from the start of its period (daily: midnight, weekly: Monday, monthly: the 1st) and is "late" after its
// deadline, in which case it costs double. When the money runs out, the remaining plans simply wait for the next top-up.
// Returns the number of instalments collected.
function collect(app, uid) {
  const now = new Date();
  const subs = app.findRecordsByFilter("subscriptions", "user = {:u} && status = 'active'", "created", 0, 0, { u: uid });
  const items = [];
  subs.forEach(s => {
    let plan; try { plan = app.findRecordById("plans", s.getString("plan")); } catch (_) { return; }
    const pl = R.planObj(plan), sub = { id: s.id, created: s.getString("created") };
    const paid = app.findRecordsByFilter("payments", "subscription = {:s} && status != 'rejected'", "", 0, 0, { s: s.id }).reduce((a, p) => a + (p.getInt("installments") || 1), 0);
    items.push({ sub, pl, plan, paid, blocked: false });
  });
  let bal = balanceOf(app, uid), done = 0;
  for (;;) {
    let best = null, bestDue = null;
    items.forEach(it => {
      if (it.blocked) return;
      const st = R.stateFromPaid(it.sub, it.pl, it.paid, now);
      if (!st.left || R.collectAt(it.sub, it.pl, it.paid) > now) return;
      if (!best || st.next < bestDue) { best = it; bestDue = st.next; }
    });
    if (!best) break;
    const st = R.stateFromPaid(best.sub, best.pl, best.paid, now), cost = st.cost(0), late = st.overdue > 0 ? 1 : 0;
    if (bal < cost) { best.blocked = true; continue; }          // this plan waits for a top-up; the others carry on
    const p = new Record(app.findCollectionByNameOrId("payments"));
    p.set("user", uid); p.set("subscription", best.sub.id); p.set("amount", cost); p.set("status", "confirmed");
    p.set("penalty", late ? st.pen : 0); p.set("installments", 1); p.set("late_count", late);
    p.set("note", "Wallet" + (late ? " · late" : ""));
    app.save(p);
    bal = post(app, uid, -cost, "contribution", best.pl.name + (late ? " (late, includes " + naira(st.pen) + " penalty)" : ""), { plan: best.plan.id, subscription: best.sub.id });
    best.paid++; done++;
  }
  return done;
}

// Joins a plan: takes the joining fee and, for cash/foodie plans joined mid-season, the catch-up for every instalment
// that fell due since 1 January (no penalty). All or nothing: if the wallet cannot cover it, nothing is created.
function joinPlan(app, uid, planId) {
  let plan; try { plan = app.findRecordById("plans", String(planId || "")); } catch (_) { throw new BadRequestError("That plan does not exist."); }
  if (!plan.getBool("active")) throw new BadRequestError("That plan is not open for enrolment.");
  const pl = R.planObj(plan);
  const sub = new Record(app.findCollectionByNameOrId("subscriptions"));
  sub.set("user", uid); sub.set("plan", plan.id); sub.set("status", "active");
  app.save(sub);                                                 // "created" is now the joined time
  const s = { id: sub.id, created: sub.getString("created") };
  const c = R.catchupCount(s, pl), catchup = c * pl.amount, total = FEES.join + catchup, bal = balanceOf(app, uid);
  if (bal < total) {
    throw new BadRequestError("Your wallet needs " + naira(total) + " to join this plan (joining fee " + naira(FEES.join) + (c ? " + catch-up " + naira(catchup) + " for " + c + " instalment" + (c === 1 ? "" : "s") + " since the season began" : "") + "). You have " + naira(bal) + ". Please top up " + naira(total - bal) + ".");
  }
  post(app, uid, -FEES.join, "join", "Joining fee · " + pl.name, { plan: plan.id, subscription: sub.id });
  const fee = new Record(app.findCollectionByNameOrId("fees"));
  fee.set("user", uid); fee.set("type", "join"); fee.set("amount", FEES.join); fee.set("status", "confirmed"); fee.set("plan", plan.id); fee.set("subscription", sub.id); fee.set("note", "Wallet");
  app.save(fee);
  if (c) {
    const S = R.sched(s, pl), upTo = dayLagos(S.due(c - 1));
    const p = new Record(app.findCollectionByNameOrId("payments"));
    p.set("user", uid); p.set("subscription", sub.id); p.set("amount", catchup); p.set("status", "confirmed"); p.set("penalty", 0);
    p.set("installments", c); p.set("late_count", 0); p.set("note", "Catch-up · " + c + " instalment" + (c === 1 ? "" : "s") + " up to " + upTo);
    app.save(p);
    post(app, uid, -catchup, "catchup", "Catch-up · " + pl.name + " (" + c + " instalment" + (c === 1 ? "" : "s") + ")", { plan: plan.id, subscription: sub.id });
  }
  collect(app, uid);                                             // today's instalment, if the wallet still has enough
  return { subscription: sub.id, catchup, instalments: c };
}

// Runs fn inside a transaction. A BadRequestError thrown inside loses its message on the way out of the transaction, so it is re-thrown here
// with the same message (the member sees e.g. "Your wallet needs ₦149,000 ...").
function inTx(fn) {
  try { $app.runInTransaction(fn); }
  catch (err) {
    const raw = String((err && ((err.value && err.value.message) || err.message)) || err);
    throw new BadRequestError(raw.replace(/^[\s\S]*?BadRequestError:\s*/, ""));
  }
}

module.exports = { FEES, naira, post, credit, collect, joinPlan, balanceOf, inTx };
