// Wallet: every member has a balance (users.wallet_balance) and a ledger (wallet_txs).
// Money comes in through the member's virtual account (see flutterwave.js + the webhook in wallet.pb.js) and goes out for
// fees, joining plans and contributions. All functions here expect to run INSIDE a transaction ($app.runInTransaction),
// so a balance and its ledger line can never disagree.
const R = require(`${__hooks}/rules.js`);
const FEES = { shirt: 5000, join: 3000, clearance: 3500 };   // KEEP IN SYNC with FEES in the frontend app.js
// NOTE: PocketBase's JS engine does not support toLocaleString(locale), so numbers and dates are formatted by hand.
const naira = n => "₦" + String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLagos = d => { const l = new Date(d.getTime() + 36e5); return l.getUTCDate() + " " + MONTHS[l.getUTCMonth()]; };

// Adds a ledger line and moves the balance. amount > 0 credits, amount < 0 debits. Throws if the balance would go negative.
function post(app, uid, amount, kind, note, extra = {}) {
  const u = app.findRecordById("users", uid);
  const bal = u.getFloat("wallet_balance") + amount;
  if (bal < 0 && !extra.allowNegative) throw new BadRequestError("Not enough money in your wallet.");   // allowNegative: an admin reversing a deposit
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
    const pl = R.planObj(plan), sub = { id: s.id, created: s.getString("created"), no_penalty_before: s.getString("no_penalty_before") };
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
    const st = R.stateFromPaid(best.sub, best.pl, best.paid, now), cost = st.cost(0), late = cost > st.A ? 1 : 0;   // overdue but penalty-free (imported plan) counts as on time
    if (bal < cost) { best.blocked = true; continue; }          // this plan waits for a top-up; the others carry on
    const p = new Record(app.findCollectionByNameOrId("payments"));
    p.set("user", uid); p.set("subscription", best.sub.id); p.set("amount", cost); p.set("status", "confirmed");
    p.set("penalty", late ? cost - st.A : 0); p.set("installments", 1); p.set("late_count", late);
    p.set("note", "Wallet" + (late ? " · late" : ""));
    app.save(p);
    bal = post(app, uid, -cost, "contribution", best.pl.name + (late ? " (late, includes " + naira(cost - st.A) + " penalty)" : st.overdue > 0 ? " (overdue, no penalty)" : ""), { plan: best.plan.id, subscription: best.sub.id });
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
// Bulk code reuse: "codes" is a list of plan codes (e.g. a member's own codes from earlier plans, or ones shared with them).
// Each new membership uses one code, in order; joining fewer times than the number of codes is raised to that number.
const MAX_SLOTS = 50;
function joinMany(app, uid, planId, code, qty, codes) {
  const list = [];
  [code].concat(Array.isArray(codes) ? codes : []).forEach(c => { if (String(c || "").trim()) { const k = normCode(c); if (!list.includes(k)) list.push(k); } });
  if (list.length > MAX_SLOTS) throw new BadRequestError("You can use at most " + MAX_SLOTS + " codes at once.");
  let n = Math.floor(Number(qty || 1));
  if (n >= 1 && list.length > n) n = list.length;
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
  list.forEach(k => { const cs = codeState(app, k); if (cs.status !== "valid") throw new BadRequestError(k + ": " + cs.message); });
  const subs = [];
  for (let i = 0; i < n; i++) subs.push(joinPlan(app, uid, plan.id, list[i] || "", { noCollect: true }).subscription);
  collect(app, uid);                                             // today's instalments, if the wallet still has enough
  return { subscription: subs[0], subscriptions: subs, count: n, codesUsed: list.length };
}

// ---- plans brought over from manual records (admin) ----
// Adds a plan to a member as if they had joined it "days" days ago (0 = today), with "amountPaid" already paid (a whole number of
// contributions). No joining fee is taken and the wallet is not touched for what was paid before. From then on the plan runs exactly
// like any other: the next payments are collected from the wallet automatically. Payments that are already due but not covered by
// amountPaid are collected at once if the wallet can pay them (late ones with the usual penalty).
function importPlan(app, uid, planId, days, amountPaid, note, opts = {}) {   // opts.chargePenalty: charge the late penalty on payments already overdue
  let plan; try { plan = app.findRecordById("plans", String(planId || "")); } catch (_) { throw new BadRequestError("That plan does not exist."); }
  try { app.findRecordById("users", String(uid || "")); } catch (_) { throw new BadRequestError("Member not found."); }
  const pl = R.planObj(plan);
  days = Math.floor(Number(days));
  if (!(days >= 0 && days <= 3650)) throw new BadRequestError("Enter how many days the plan has been running (0 if it starts today).");
  const paid = Math.round(Number(amountPaid || 0));
  if (paid < 0 || paid % Math.round(pl.amount)) throw new BadRequestError("Amount paid must be a multiple of the contribution, " + naira(pl.amount) + ".");
  const k = paid / Math.round(pl.amount);
  // the joining moment: 08:00 Lagos time, "days" days ago
  const L = new Date(Date.now() + 36e5), start = new Date(Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() - days, 8) - 36e5);
  const n = R.sched({ id: "", created: ts(start) }, pl).n;
  if (k > n) throw new BadRequestError("This plan has only " + n + " payments (" + naira(n * pl.amount) + " in total).");

  const sub = new Record(app.findCollectionByNameOrId("subscriptions"));
  sub.set("user", uid); sub.set("plan", plan.id); sub.set("status", "active"); sub.set("imported", true);
  sub.set("import_note", String(note || "").trim().slice(0, 300) || "Brought over from manual records");
  if (!opts.chargePenalty) sub.set("no_penalty_before", ts(new Date()));   // payments overdue at this moment are collected without the penalty
  app.save(sub);
  // "created" is filled in automatically on save; move it back to the real joining day
  app.db().newQuery("UPDATE {{subscriptions}} SET [[created]] = {:c} WHERE [[id]] = {:id}").bind({ c: ts(start), id: sub.id }).execute();
  const rec = app.findRecordById("subscriptions", sub.id), s = { id: rec.id, created: rec.getString("created"), no_penalty_before: rec.getString("no_penalty_before") };
  const win = R.codeWindow(s.created, plan.getInt("code_from_day"), plan.getInt("code_until_day"));
  if (win) { rec.set("code", newCode(app)); rec.set("code_from", ts(win.from)); rec.set("code_until", ts(win.until)); }
  if (k > 0) {
    const p = new Record(app.findCollectionByNameOrId("payments"));
    p.set("user", uid); p.set("subscription", rec.id); p.set("amount", paid); p.set("status", "confirmed"); p.set("penalty", 0);
    p.set("installments", k); p.set("late_count", 0); p.set("note", "Brought over from manual records · " + k + " payment" + (k === 1 ? "" : "s"));
    app.save(p);
  }
  rec.set("paid_count", k); rec.set("next_collect", nextCollect(s, pl, k));
  app.save(rec);
  const before = R.stateFromPaid(s, pl, k, new Date());
  const took = opts.noCollect ? 0 : collect(app, uid);
  return { subscription: rec.id, paid: k, payments: n, dueNow: before.overdue, collected: took };
}

// Several at once: items = [{ plan, days, amount_paid, count (how many of that same plan, default 1), note }].
// All or nothing (run inside a transaction). Respects the limit of MAX_SLOTS running memberships per plan.
function importMany(app, uid, items, note, chargePenalty) {
  if (!Array.isArray(items) || !items.length) throw new BadRequestError("Add at least one plan.");
  const total = items.reduce((a, it) => a + Math.max(0, Math.floor(Number(it.count || 1))), 0);
  if (total < 1) throw new BadRequestError("Add at least one plan.");
  if (total > 500) throw new BadRequestError("Add at most 500 memberships at once.");
  const perPlan = {};
  items.forEach((it, i) => {
    const c = Math.floor(Number(it.count || 1));
    if (!(c >= 1 && c <= MAX_SLOTS)) throw new BadRequestError("Row " + (i + 1) + ": how many times must be 1 to " + MAX_SLOTS + ".");
    perPlan[it.plan] = (perPlan[it.plan] || 0) + c;
  });
  Object.keys(perPlan).forEach(pid => {
    let plan; try { plan = app.findRecordById("plans", String(pid || "")); } catch (_) { throw new BadRequestError("One of the plans does not exist."); }
    const have = app.findRecordsByFilter("subscriptions", "user = {:u} && plan = {:p} && status = 'active'", "", 0, 0, { u: uid, p: plan.id }).length;
    if (have + perPlan[pid] > MAX_SLOTS) throw new BadRequestError(plan.getString("name") + ": the member already has " + have + " running, and the limit is " + MAX_SLOTS + " per plan (you are adding " + perPlan[pid] + ").");
  });
  const out = { added: 0, paid: 0, subscriptions: [] };
  items.forEach((it, i) => {
    for (let k = 0; k < Math.floor(Number(it.count || 1)); k++) {
      let r;
      try { r = importPlan(app, uid, it.plan, it.days, it.amount_paid, it.note || note, { noCollect: true, chargePenalty: !!chargePenalty }); }
      catch (err) { const m = String((err && err.message) || err).replace(/^[\s\S]*?BadRequestError:\s*/, ""); throw new BadRequestError("Row " + (i + 1) + ": " + m); }
      out.added++; out.paid += r.paid; out.subscriptions.push(r.subscription);
    }
  });
  out.collected = collect(app, uid);                              // payments already due, if the wallet can pay them
  return out;
}

// ---- admin: edit a running plan ----
// changes = { days (how long it has been running), amount_paid, charge_penalty, note }; any of them may be left out.
// Payments made through the website wallet stay as they are: amount_paid can only be raised or lowered in what was recorded by hand
// (plans brought over, or earlier admin edits). Afterwards the schedule is worked out again and anything due is collected.
const MANUAL = /^(Brought over|Adjusted by admin)/;
function editPlan(app, sid, changes) {
  let rec; try { rec = app.findRecordById("subscriptions", String(sid || "")); } catch (_) { throw new BadRequestError("Plan not found."); }
  if (rec.getString("status") !== "active") throw new BadRequestError("Only a running (active) plan can be edited.");
  if (app.findRecordsByFilter("payouts", "subscription = {:s} && status != 'rejected'", "", 1, 0, { s: rec.id }).length) throw new BadRequestError("This plan already has a payout request, so it cannot be edited.");
  const plan = app.findRecordById("plans", rec.getString("plan")), pl = R.planObj(plan), A = Math.round(pl.amount), uid = rec.getString("user");
  // 1) start date
  if (changes.days !== undefined && changes.days !== null && changes.days !== "") {
    const days = Math.floor(Number(changes.days));
    if (!(days >= 0 && days <= 3650)) throw new BadRequestError("Enter how many days the plan has been running (0 = today).");
    const L = new Date(Date.now() + 36e5), start = new Date(Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() - days, 8) - 36e5);
    app.db().newQuery("UPDATE {{subscriptions}} SET [[created]] = {:c} WHERE [[id]] = {:id}").bind({ c: ts(start), id: rec.id }).execute();
    rec = app.findRecordById("subscriptions", rec.id);
    // an unused plan code moves with the plan
    if (rec.getString("code") && !rec.getString("code_used_at") && !rec.getString("code_admin")) {
      const win = R.codeWindow(rec.getString("created"), plan.getInt("code_from_day"), plan.getInt("code_until_day"));
      if (win) { rec.set("code_from", ts(win.from)); rec.set("code_until", ts(win.until)); }
    }
  }
  const s = { id: rec.id, created: rec.getString("created") }, n = R.sched(s, pl).n;
  // 2) amount paid
  if (changes.amount_paid !== undefined && changes.amount_paid !== null && changes.amount_paid !== "") {
    const paid = Math.round(Number(changes.amount_paid));
    if (!(paid >= 0) || paid % A) throw new BadRequestError("Amount paid must be a multiple of the contribution, " + naira(A) + ".");
    const k = paid / A;
    const pays = app.findRecordsByFilter("payments", "subscription = {:s} && status != 'rejected'", "created", 0, 0, { s: rec.id });
    const manual = pays.filter(p => MANUAL.test(p.getString("note")));
    const site = pays.filter(p => !MANUAL.test(p.getString("note"))).reduce((a, p) => a + (p.getInt("installments") || 1), 0);
    if (k < site) throw new BadRequestError(site + " payment" + (site === 1 ? " was" : "s were") + " made through the website (" + naira(site * A) + "); the amount paid cannot be less than that.");
    if (k > n) throw new BadRequestError("This plan has only " + n + " payments (" + naira(n * A) + " in total).");
    const cur = manual.reduce((a, p) => a + (p.getInt("installments") || 1), 0);
    if (k - site !== cur) {
      manual.forEach(p => app.delete(p));                       // never touched the wallet: replaced by one record with the new amount
      if (k - site > 0) {
        const p = new Record(app.findCollectionByNameOrId("payments"));
        p.set("user", uid); p.set("subscription", rec.id); p.set("amount", (k - site) * A); p.set("status", "confirmed"); p.set("penalty", 0);
        p.set("installments", k - site); p.set("late_count", 0); p.set("note", "Adjusted by admin · " + (k - site) + " payment" + (k - site === 1 ? "" : "s") + " recorded by hand");
        app.save(p);
      }
    }
  }
  // 3) penalty on what is overdue right now, and the note
  if (changes.charge_penalty !== undefined && changes.charge_penalty !== null) rec.set("no_penalty_before", changes.charge_penalty ? "" : ts(new Date()));
  if (changes.note !== undefined && changes.note !== null) rec.set("import_note", String(changes.note || "").trim().slice(0, 300));
  app.save(rec);
  syncSub(app, rec.id);                                           // paid_count and next_collect from the payment history
  const took = collect(app, uid);
  const after = app.findRecordById("subscriptions", rec.id);
  return { subscription: rec.id, paid: after.getInt("paid_count"), payments: n, collected: took };
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

module.exports = { FEES, MAX_SLOTS, naira, post, credit, collect, joinPlan, joinMany, importPlan, importMany, editPlan, balanceOf, inTx, syncSub, ts, DONE, codeState, normCode };
