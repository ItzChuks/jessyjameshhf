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
// Database timestamps: PocketBase stores dates as "YYYY-MM-DD HH:MM:SS.sssZ", so they compare correctly as text.
const ts = d => d.toISOString().replace("T", " ");
const DONE = "2999-12-31 00:00:00.000Z";          // next_collect of a fully paid plan: the collector never looks at it again
const RECHECK_MS = 6 * 36e5;                      // a plan waiting for a top-up is re-checked after 6 hours (a top-up re-runs collect at once anyway)

// instalments covered by a subscription, counted from its payment history (only used to repair or back-fill paid_count)
const countPaid = (app, sid) => app.findRecordsByFilter("payments", "subscription = {:s} && status != 'rejected'", "", 0, 0, { s: sid }).reduce((a, p) => a + (p.getInt("installments") || 1), 0);
// when the collector should next look at a plan that has "paid" instalments covered
function nextCollect(sub, pl, paid) {
  const n = R.sched(sub, pl).n;
  return paid >= n ? DONE : ts(R.collectAt(sub, pl, paid));
}
// Re-works out paid_count and next_collect from the payment history. Called for plans the collector has never seen (next_collect empty)
// and whenever an admin changes or deletes a payment.
function syncSub(app, subOrId) {
  const s = typeof subOrId === "string" ? app.findRecordById("subscriptions", subOrId) : subOrId;
  let plan; try { plan = app.findRecordById("plans", s.getString("plan")); } catch (_) { return s; }
  const paid = countPaid(app, s.id);
  s.set("paid_count", paid);
  s.set("next_collect", nextCollect({ id: s.id, created: s.getString("created") }, R.planObj(plan), paid));
  app.save(s);
  return s;
}

// Takes every instalment that is ready from the wallet, oldest deadline first, plan by plan.
// An instalment is ready from the start of its period (daily: midnight, weekly: Monday, monthly: the 1st) and is "late" after its
// deadline, in which case it costs double. When the money runs out, the remaining plans simply wait for the next top-up.
// Uses the stored paid_count (no payment history is read) and moves next_collect forward. Returns the number of instalments collected.
function collect(app, uid) {
  const now = new Date();
  const subs = app.findRecordsByFilter("subscriptions", "user = {:u} && status = 'active'", "created", 0, 0, { u: uid });
  const items = [];
  subs.forEach(s => {
    if (s.getString("next_collect") === "") s = syncSub(app, s);           // first visit for this plan
    if (s.getString("next_collect") === DONE) return;                       // fully paid
    let plan; try { plan = app.findRecordById("plans", s.getString("plan")); } catch (_) { return; }
    const pl = R.planObj(plan), sub = { id: s.id, created: s.getString("created") };
    items.push({ rec: s, sub, pl, plan, paid: s.getInt("paid_count"), start: s.getInt("paid_count"), blocked: false });
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
  // store where each plan now stands; a plan waiting for money is looked at again later (or straight away when the member tops up)
  items.forEach(it => {
    let next = nextCollect(it.sub, it.pl, it.paid);
    if (it.blocked) next = ts(new Date(now.getTime() + RECHECK_MS));
    if (it.paid === it.start && it.rec.getString("next_collect") === next) return;
    it.rec.set("paid_count", it.paid); it.rec.set("next_collect", next);
    app.save(it.rec);
  });
  return done;
}

// ---- plan codes ----
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";                      // no 0/O or 1/I, so codes are easy to read out
const normCode = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(JJ)?([A-Z0-9]{4})([A-Z0-9]{4})$/, "JJ-$2-$3");
function newCode(app) {
  for (let i = 0; i < 20; i++) {
    const c = "JJ-" + $security.randomStringWithAlphabet(4, CODE_ABC) + "-" + $security.randomStringWithAlphabet(4, CODE_ABC);
    try { app.findFirstRecordByData("subscriptions", "code", c); } catch (_) { return c; }
  }
  throw new Error("Could not create a unique code.");
}
const lastDayLagos = until => { const l = new Date(until.getTime() + 36e5 - 1); return "the end of " + l.getUTCDate() + " " + MONTHS[l.getUTCMonth()] + " " + l.getUTCFullYear(); };   // "until" is the first moment after the last valid day
const whenLagos = d => { const l = new Date(d.getTime() + 36e5); return l.getUTCDate() + " " + MONTHS[l.getUTCMonth()] + " " + l.getUTCFullYear() + ", " + String(l.getUTCHours()).padStart(2, "0") + ":" + String(l.getUTCMinutes()).padStart(2, "0"); };
// Where a code stands: { status: valid | used | expired | not_yet | invalid, rec, from, until, message }
function codeState(app, code, now = new Date()) {
  const c = normCode(code);
  let rec; try { rec = app.findFirstRecordByData("subscriptions", "code", c); } catch (_) { return { status: "invalid", code: c, message: "That code does not exist. Check it and try again." }; }
  const from = R.parseTs(rec.getString("code_from")), until = R.parseTs(rec.getString("code_until"));
  let planName = ""; try { planName = app.findRecordById("plans", rec.getString("plan")).getString("name"); } catch (_) { }
  const base = { rec, code: c, from, until, plan: planName };
  if (rec.getString("code_used_at")) return Object.assign(base, { status: "used", message: "This code has already been used." });
  if (rec.getString("code_admin") === "used") return Object.assign(base, { status: "used", message: "This code has already been used." });
  if (rec.getString("code_admin") === "expired") return Object.assign(base, { status: "expired", message: "This code has expired." });
  if (rec.getString("status") === "cancelled") return Object.assign(base, { status: "invalid", message: "This code is no longer valid (its plan was cancelled)." });
  if (now >= until) return Object.assign(base, { status: "expired", message: "This code expired at " + lastDayLagos(until) + "." });
  if (now < from) return Object.assign(base, { status: "not_yet", message: "This code can only be used from " + whenLagos(from) + "." });
  return Object.assign(base, { status: "valid", message: "Code accepted. It can be used until " + lastDayLagos(until) + "." });
}

// Joins a plan: takes the joining fee and, for cash/foodie plans joined mid-season, the catch-up for every instalment
// that fell due since 1 January (no penalty). All or nothing: if the wallet cannot cover it, nothing is created.
// An optional plan code (from any member's plan, including one shared by another member) can be given; it must be open
// (between its start and expiry) and unused, and is then marked as used by this member. Every new membership gets its own code.
function joinPlan(app, uid, planId, code, opts = {}) {
  let plan; try { plan = app.findRecordById("plans", String(planId || "")); } catch (_) { throw new BadRequestError("That plan does not exist."); }
  if (!plan.getBool("active")) throw new BadRequestError("That plan is not open for enrolment.");
  const pl = R.planObj(plan);
  const cs = String(code || "").trim() ? codeState(app, code) : null;
  if (cs && cs.status !== "valid") throw new BadRequestError(cs.message);
  const sub = new Record(app.findCollectionByNameOrId("subscriptions"));
  sub.set("user", uid); sub.set("plan", plan.id); sub.set("status", "active");
  if (cs) sub.set("joined_code", cs.code);
  app.save(sub);                                                 // "created" is now the joined time
  const win = R.codeWindow(sub.getString("created"), plan.getInt("code_from_day"), plan.getInt("code_until_day"));
  if (win) { sub.set("code", newCode(app)); sub.set("code_from", ts(win.from)); sub.set("code_until", ts(win.until)); app.save(sub); }
  const s = { id: sub.id, created: sub.getString("created") };
  // joining = the joining fee + the first payment (due today), all or nothing
  const c = R.catchupCount(s, pl), catchup = c * pl.amount, first = R.isSeasonal(pl) ? 0 : pl.amount, total = FEES.join + catchup + first, bal = balanceOf(app, uid);
  if (bal < total) {
    throw new BadRequestError("Your wallet needs " + naira(total) + " to join this plan (joining fee " + naira(FEES.join) + (first ? " + first payment " + naira(first) : "") + (c ? " + catch-up " + naira(catchup) + " for " + c + " instalment" + (c === 1 ? "" : "s") + " since the season began" : "") + "). You have " + naira(bal) + ". Please deposit " + naira(total - bal) + ".");
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
  sub.set("paid_count", c); sub.set("next_collect", nextCollect(s, pl, c));
  app.save(sub);
  if (cs) {                                                      // mark the code as used (the owner and the admin see who used it and when)
    const owner = app.findRecordById("subscriptions", cs.rec.id), me = app.findRecordById("users", uid);
    if (owner.getString("code_used_at") || owner.getString("code_admin")) throw new BadRequestError("This code can no longer be used.");
    owner.set("code_used_by", uid); owner.set("code_used_name", me.getString("name") || me.getString("email"));
    owner.set("code_used_at", ts(new Date())); owner.set("code_used_sub", sub.id);
    app.save(owner);
  }
  if (!opts.noCollect) collect(app, uid);                        // today's instalment, if the wallet still has enough
  return { subscription: sub.id, catchup, instalments: c };
}

// ---- joining the same plan several times at once ----
// A member may hold up to MAX_SLOTS running (active) memberships of the same plan, and can add several in one go.
// Each one is a separate membership with its own joining fee, payments, payout and plan code. A plan code entered when
// joining is used once, on the first of them. All or nothing: if the wallet cannot cover every one, none is created.
const MAX_SLOTS = 50;
function joinMany(app, uid, planId, code, qty) {
  const n = Math.floor(Number(qty || 1));
  if (!(n >= 1 && n <= MAX_SLOTS)) throw new BadRequestError("You can join a plan 1 to " + MAX_SLOTS + " times at once.");
  let plan; try { plan = app.findRecordById("plans", String(planId || "")); } catch (_) { throw new BadRequestError("That plan does not exist."); }
  if (!plan.getBool("active")) throw new BadRequestError("That plan is not open for enrolment.");
  const have = app.findRecordsByFilter("subscriptions", "user = {:u} && plan = {:p} && status = 'active'", "", 0, 0, { u: uid, p: plan.id }).length;
  if (have + n > MAX_SLOTS) {
    const left = Math.max(0, MAX_SLOTS - have);
    throw new BadRequestError("You already have " + have + " running " + plan.getString("name") + " membership" + (have === 1 ? "" : "s") + ". The limit is " + MAX_SLOTS + " per plan, so you can " + (left ? "add up to " + left + " more." : "not add more until one ends."));
  }
  const pl = R.planObj(plan), s = { id: "", created: ts(new Date()) };
  const c = R.catchupCount(s, pl), first = R.isSeasonal(pl) ? 0 : pl.amount, each = FEES.join + c * pl.amount + first, total = each * n, bal = balanceOf(app, uid);
  if (n > 1 && bal < total) {
    throw new BadRequestError("Your wallet needs " + naira(total) + " to join this plan " + n + " times (" + naira(each) + " each: joining fee " + naira(FEES.join) + (first ? " + first payment " + naira(first) : "") + (c ? " + catch-up " + naira(c * pl.amount) : "") + "). You have " + naira(bal) + ". Please deposit " + naira(total - bal) + ".");
  }
  const subs = [];
  for (let i = 0; i < n; i++) subs.push(joinPlan(app, uid, plan.id, i === 0 ? code : "", { noCollect: true }).subscription);
  collect(app, uid);                                             // today's instalments, if the wallet still has enough
  return { subscription: subs[0], subscriptions: subs, count: n };
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

module.exports = { FEES, MAX_SLOTS, naira, post, credit, collect, joinPlan, joinMany, balanceOf, inTx, syncSub, ts, DONE, codeState, normCode };
