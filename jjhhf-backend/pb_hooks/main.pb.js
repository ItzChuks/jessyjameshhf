/// <reference path="../pb_data/types.d.ts" />
// Server-side enforcement for Jessy James Helping Hands Foundation. The browser calculates penalties for display only;
// these hooks recompute everything, so editing the page (or calling the API directly) cannot dodge a penalty.

// New accounts are always plain members, unregistered (t-shirt fee unpaid: only needed to request a payout), and must accept the Terms and Conditions.
// (Only a superuser can create or promote an admin.)
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    if (!e.record.getBool("terms_accepted")) throw new BadRequestError("You must accept the Terms and Conditions to create an account.");
    e.record.set("role", "user");
    e.record.set("shirt_paid", false);
    e.record.set("wallet_balance", 0);
    e.record.set("terms_accepted_at", new Date().toISOString().replace("T", " "));
  }
  e.next();
}, "users");

// Every new member is given a payment provider automatically (balanced random draw, see gateways.js). If no provider is set up yet,
// the member is picked up later by the 15-minute job (wallet.pb.js) or at their first deposit.
onRecordAfterCreateSuccess((e) => {
  e.next();
  try { require(`${__hooks}/gateways.js`).assign(e.app, e.record.id); } catch (err) { console.log("jjhhf gateway assign:", e.record.id, String(err)); }
}, "users");

// Wallet fields can only be changed by the server (top-ups, fees, collections), never through the API, not even by an admin.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const o = e.record.original();
  for (const f of ["wallet_balance", "va_number", "va_bank", "va_ref"]) {
    if (f === "wallet_balance" ? e.record.getFloat(f) !== o.getFloat(f) : e.record.getString(f) !== o.getString(f)) throw new BadRequestError("That field cannot be changed.");
  }
  // the payment provider is given by the server (or changed by an admin), never chosen by the member
  if (e.record.getString("gateway") !== o.getString("gateway") || e.record.getBool("gateway_manual") !== o.getBool("gateway_manual")) {
    if (!e.auth || e.auth.getString("role") !== "admin") throw new BadRequestError("That field cannot be changed.");
    if (e.record.getString("gateway") && !["flutterwave", "paystack", "monnify"].includes(e.record.getString("gateway"))) throw new BadRequestError("Unknown payment provider.");
  }
  // payout details from the Profile page: tidy them and check the account number
  const acct = e.record.getString("bank_account_number").replace(/\D/g, "");
  if (e.record.getString("bank_account_number") && acct.length !== 10) throw new BadRequestError("Enter your 10-digit account number.");
  e.record.set("bank_account_number", acct);
  for (const f of ["bank_name", "bank_account_name", "address"]) e.record.set(f, e.record.getString(f).trim().slice(0, 300));
  e.next();
}, "users");

// Joining a plan: only open plans, always starts "active".
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  let plan;
  try { plan = $app.findRecordById("plans", e.record.getString("plan")); } catch (_) { throw new BadRequestError("That plan does not exist."); }
  if (!plan.getBool("active")) throw new BadRequestError("That plan is not open for enrolment.");
  e.record.set("status", "active");
  e.next();
}, "subscriptions");

// Payout requests are created by the server once the 3000 clearance fee is verified (see fees.js). This guard is a safety net:
// the collection rule already blocks direct member requests, and the same checks apply to anything that gets through
// (saving period over, plan fully paid, ANOTHER plan actively running, t-shirt fee paid).
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const X = require(`${__hooks}/fees.js`), uid = e.auth.id;
  const why = X.payoutProblem($app, uid, e.record.getString("subscription"));
  if (why) throw new BadRequestError(why);
  e.record.set("user", uid);
  e.record.set("status", "pending");
  e.next();
}, "payouts");

// When an admin confirms, rejects or deletes a payment, the plan's stored progress (paid_count / next_collect) is worked out again.
// (Payments the server creates itself keep the plan up to date directly, see wallet.js.)
// (Handlers are isolated, so the code is written out in each one.)
onRecordAfterUpdateSuccess((e) => {
  e.next();
  const sid = e.record.getString("subscription");
  if (sid) try { require(`${__hooks}/wallet.js`).syncSub(e.app, sid); } catch (err) { console.log("jjhhf resync:", sid, String(err)); }
}, "payments");
onRecordAfterDeleteSuccess((e) => {
  e.next();
  const sid = e.record.getString("subscription");
  if (sid) try { require(`${__hooks}/wallet.js`).syncSub(e.app, sid); } catch (err) { console.log("jjhhf resync:", sid, String(err)); }
}, "payments");
