// Fees and registration rules, enforced on the server. Every fee is now paid from the member's wallet (see wallet.js).
//   shirt      ₦5,000  one time. Members can use the dashboard, join plans and pay contributions without it;
//                      it is only required when they request a payout ("unregistered" members cannot request payouts)
//   join       ₦3,000  paid every time a member joins a plan; the plan is joined automatically once the payment is verified
//   clearance  ₦3,500  paid ONCE per plan joined, before that plan's payout can be requested; the request is sent at the same time.
//              If a payout request is rejected, the member can request again without paying the clearance fee a second time.
// A payout request also needs ANOTHER plan of the same member to be actively running (see runningElsewhere).
// KEEP IN SYNC with FEES in the frontend app.js (that copy is for display only).
const W = require(`${__hooks}/wallet.js`), FEES = W.FEES;
const R = require(`${__hooks}/rules.js`);
const SHIRT_MSG = "Please pay the one-time ₦5,000 t-shirt fee before you request a payout.";
const PROFILE_MSG = "Add your payout details (account name, bank, 10-digit account number and address) on your Profile page before requesting a payout.";
const NEED_PLAN_MSG = "To request a payout you must have another plan that has been actively running for at least 2 weeks. Join a new plan and request this payout once it has run for 2 weeks.";

const isRegistered = (app, uid) => app.findRecordById("users", uid).getBool("shirt_paid");

// True when the member has another plan (not the one being paid out) that is still running:
// status active, its saving period has not ended yet, and it was joined at least 2 weeks ago (R.PAYOUT_MIN_RUNNING_DAYS).
function runningElsewhere(app, uid, sid) {
  const now = new Date(), minAge = R.PAYOUT_MIN_RUNNING_DAYS * 864e5;
  return app.findRecordsByFilter("subscriptions", "user = {:u} && status = 'active' && id != {:s}", "", 0, 0, { u: uid, s: sid }).some(s => {
    try {
      const plan = app.findRecordById("plans", s.getString("plan"));
      return now < R.termEnd({ created: s.getString("created") }, R.planObj(plan)) && now - R.parseTs(s.getString("created")) >= minAge;
    } catch (_) { return false; }
  });
}

// Returns a member-facing reason why a payout cannot be requested right now, or "" when it can.
function payoutProblem(app, uid, sid) {
  let subRec;
  try { subRec = app.findRecordById("subscriptions", sid); } catch (_) { return "Subscription not found."; }
  if (subRec.getString("user") !== uid) return "That is not your plan.";
  if (subRec.getString("status") === "cancelled") return "This plan was cancelled.";
  const plan = app.findRecordById("plans", subRec.getString("plan"));

  const saved = app.findRecordsByFilter("payments", "subscription = {:s} && status = 'confirmed'", "", 0, 0, { s: sid })
    .reduce((a, r) => a + r.getFloat("amount") - r.getFloat("penalty"), 0);
  const pl = R.planObj(plan), sub = { created: subRec.getString("created") };
  if (saved < pl.amount * R.sched(sub, pl).n) return "This plan is not fully paid yet.";

  const end = R.termEnd(sub, pl);
  if (new Date() < end) { const l = new Date(end.getTime() + 36e5); return "Payouts for this plan open on " + l.getUTCDate() + "/" + (l.getUTCMonth() + 1) + "/" + l.getUTCFullYear() + "."; }

  if (app.findRecordsByFilter("payouts", "subscription = {:s} && status = 'confirmed'", "", 1, 0, { s: sid }).length) return "This plan has already been paid out.";
  if (app.findRecordsByFilter("payouts", "subscription = {:s} && status = 'pending'", "", 1, 0, { s: sid }).length) return "You already have a payout request waiting.";

  if (!runningElsewhere(app, uid, sid)) return NEED_PLAN_MSG;   // another plan must be actively running
  if (!isRegistered(app, uid)) return SHIRT_MSG;                // the t-shirt fee is only needed for payouts
  return "";
}

// True when the clearance fee has already been paid for this plan membership.
function clearancePaid(app, sid) {
  try { if (app.findRecordById("subscriptions", sid).getString("clearance_paid_at")) return true; } catch (_) { }
  return app.findRecordsByFilter("fees", "subscription = {:s} && type = 'clearance' && status = 'confirmed'", "", 1, 0, { s: sid }).length > 0;
}

// Pays a fee from the wallet, all or nothing. type: shirt | join | clearance. Throws a member-facing error when it is not allowed.
function pay(app, uid, type, body) {
  if (!FEES[type]) throw new BadRequestError("Unknown fee.");
  const fee = (amount, extra = {}) => {
    const rec = new Record(app.findCollectionByNameOrId("fees"));
    rec.set("user", uid); rec.set("type", type); rec.set("amount", amount); rec.set("status", "confirmed"); rec.set("note", "Wallet");
    if (extra.subscription) rec.set("subscription", extra.subscription);
    if (extra.details) rec.set("details", extra.details);
    app.save(rec);
  };
  const short = amt => { const bal = W.balanceOf(app, uid); if (bal < amt) throw new BadRequestError("Your wallet needs " + W.naira(amt) + " for this. You have " + W.naira(bal) + ". Please top up " + W.naira(amt - bal) + "."); };

  if (type === "join") return W.joinMany(app, uid, body.plan, body.code, body.qty, body.codes);   // qty: join the same plan 1-50 times at once

  if (type === "shirt") {
    const u = app.findRecordById("users", uid);
    if (u.getBool("shirt_paid")) throw new BadRequestError("You have already paid the t-shirt fee.");
    short(FEES.shirt);
    W.post(app, uid, -FEES.shirt, "shirt", "T-shirt registration fee");
    const u2 = app.findRecordById("users", uid);
    u2.set("shirt_paid", true); u2.set("shirt_paid_at", new Date().toISOString().replace("T", " "));
    app.save(u2); fee(FEES.shirt);
    return {};
  }

  // payout details come from the member's profile (Profile page), never from the request
  // A group (several memberships joined together) is paid out as a whole: one request covers every membership in it.
  const sid = String(body.subscription || ""), u = app.findRecordById("users", uid);
  let first; try { first = app.findRecordById("subscriptions", sid); } catch (_) { throw new BadRequestError("Subscription not found."); }
  if (first.getString("user") !== uid) throw new BadRequestError("That is not your plan.");
  const members = W.groupOf(app, first).filter(m => m.getString("status") !== "cancelled");
  const P = { name: u.getString("bank_account_name"), bank: u.getString("bank_name"), acct: u.getString("bank_account_number"), addr: u.getString("address") };
  members.forEach(m => { const why = payoutProblem(app, uid, m.id); if (why) throw new BadRequestError(members.length > 1 ? "Not every plan in this group can be paid out yet: " + why : why); });
  if (!P.name || !P.bank || !/^\d{10}$/.test(P.acct) || !P.addr) throw new BadRequestError(PROFILE_MSG);
  const details = P.name + " · " + P.bank + " · " + P.acct + " · " + P.addr;   // a copy kept on the request, in case the profile changes later
  // the clearance fee is paid once per plan: plans that already paid it (e.g. after a rejected request) are not charged again
  const unpaid = members.filter(m => !clearancePaid(app, m.id));
  short(FEES.clearance * unpaid.length);
  const pl = app.findRecordById("plans", first.getString("plan")).getString("name");
  const gid = members.length > 1 ? first.getString("group_id") : "";
  members.forEach((m, k) => {
    if (unpaid.includes(m)) {
      W.post(app, uid, -FEES.clearance, "clearance", "Payout clearance fee · " + pl, { subscription: m.id });
      const s2 = app.findRecordById("subscriptions", m.id);
      s2.set("clearance_paid_at", new Date().toISOString().replace("T", " ")); app.save(s2);   // shown to the admin as "Clearance paid"
      fee(FEES.clearance, { subscription: m.id, details });
    }
    const po = new Record(app.findCollectionByNameOrId("payouts"));
    po.set("user", uid); po.set("subscription", m.id); po.set("note", details); po.set("status", "pending");
    if (gid) { po.set("group_id", gid); po.set("group_lead", k === 0); po.set("group_size", k === 0 ? members.length : 0); }
    app.save(po);
  });
  return { clearanceCharged: unpaid.length, plans: members.length };
}

module.exports = { FEES, SHIRT_MSG, PROFILE_MSG, NEED_PLAN_MSG, payoutProblem, runningElsewhere, clearancePaid, pay };
