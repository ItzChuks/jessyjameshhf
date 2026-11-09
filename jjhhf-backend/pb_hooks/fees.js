// Fees and registration rules, enforced on the server. Every fee is now paid from the member's wallet (see wallet.js).
//   shirt      ₦5,000  one time. Members can use the dashboard, join plans and pay contributions without it;
//                      it is only required when they request a payout ("unregistered" members cannot request payouts)
//   join       ₦3,000  paid every time a member joins a plan; the plan is joined automatically once the payment is verified
//   clearance  ₦3,000  paid with every payout request; the request is sent automatically once the payment is verified
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

  if (type === "join") return W.joinMany(app, uid, body.plan, body.code, body.qty);   // qty: join the same plan 1-50 times at once

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
  const sid = String(body.subscription || ""), u = app.findRecordById("users", uid);
  const P = { name: u.getString("bank_account_name"), bank: u.getString("bank_name"), acct: u.getString("bank_account_number"), addr: u.getString("address") };
  const why = payoutProblem(app, uid, sid);
  if (why) throw new BadRequestError(why);
  if (!P.name || !P.bank || !/^\d{10}$/.test(P.acct) || !P.addr) throw new BadRequestError(PROFILE_MSG);
  const details = P.name + " · " + P.bank + " · " + P.acct + " · " + P.addr;   // a copy kept on the request, in case the profile changes later
  short(FEES.clearance);
  W.post(app, uid, -FEES.clearance, "clearance", "Payout clearance fee", { subscription: sid });
  const po = new Record(app.findCollectionByNameOrId("payouts"));
  po.set("user", uid); po.set("subscription", sid); po.set("note", details); po.set("status", "pending");
  app.save(po); fee(FEES.clearance, { subscription: sid, details });
  return {};
}

module.exports = { FEES, SHIRT_MSG, PROFILE_MSG, NEED_PLAN_MSG, payoutProblem, runningElsewhere, pay };
