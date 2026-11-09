// Wallet deposits through the member's payment provider (Flutterwave, Paystack or Monnify, see gateways.js).
// Every deposit carries a ₦100 tax charge on top: a member who wants ₦3,000 in the wallet pays ₦3,100; the wallet gets ₦3,000 and the
// ₦100 is recorded as a "tax" fee. KEEP IN SYNC with FEES.tax in the frontend app.js.
const TAX = 100;
const MIN = 100, MAX = 5000000;

// Starts a deposit: picks the member's provider, records the deposit as pending and returns the provider's checkout link.
function start(app, uid, amount, redirect) {
  const G = require(`${__hooks}/gateways.js`);
  amount = Math.round(Number(amount));
  if (!(amount >= MIN)) throw new BadRequestError("The smallest deposit is ₦" + MIN + ".");
  if (amount > MAX) throw new BadRequestError("That amount is too large for one deposit.");
  if (!/^https?:\/\/[^\s]+$/.test(String(redirect || ""))) throw new BadRequestError("Missing return address.");
  const gw = G.pick(app, uid), user = app.findRecordById("users", uid);
  const ref = "JJHHF-DEP-" + uid + "-" + $security.randomStringWithAlphabet(10, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"), total = amount + TAX;
  const d = new Record(app.findCollectionByNameOrId("deposits"));
  d.set("user", uid); d.set("amount", amount); d.set("fee", TAX); d.set("total", total); d.set("tx_ref", ref); d.set("status", "pending"); d.set("gateway", gw);
  app.save(d);
  const link = G.get(gw).checkout(user, ref, total, redirect);
  return { link, tx_ref: ref, amount, fee: TAX, total, gateway: gw, gateway_name: G.NAMES[gw] };
}

// Settles a deposit once its provider confirms it: credits the wallet exactly once, records the tax fee, then runs the collector so plans
// waiting for money are paid at once. Safe to call many times (redirect, webhook and the re-check cron may all call it).
// providerId: the provider's own transaction id when known (Flutterwave). Returns "successful", "pending" or "failed".
function settle(txRef, providerId) {
  const G = require(`${__hooks}/gateways.js`), W = require(`${__hooks}/wallet.js`);
  let d; try { d = $app.findFirstRecordByData("deposits", "tx_ref", String(txRef || "")); } catch (_) { throw new BadRequestError("Deposit not found."); }
  if (d.getString("status") !== "pending") return d.getString("status");
  const gw = d.getString("gateway") || "flutterwave";                       // deposits made before providers were shuffled used Flutterwave

  const v = G.get(gw).verify(d.getString("tx_ref"), providerId || "");
  if (v.status === "pending" || (v.ref && v.ref !== d.getString("tx_ref"))) return "pending";
  const mark = (status, note, id) => $app.runInTransaction((tx) => { const x = tx.findRecordById("deposits", d.id); if (x.getString("status") !== "pending") return; x.set("status", status); x.set("flw_id", String(id || "")); x.set("note", note); tx.save(x); });
  if (v.status === "failed") { mark("failed", "Payment not completed", v.id); return "failed"; }
  if ((v.currency || "NGN") !== "NGN" || !(Number(v.amount) >= d.getFloat("total"))) {
    mark("failed", "Amount or currency did not match (paid " + (v.currency || "") + " " + v.amount + "). Contact support.", v.id);
    return "failed";
  }
  let done = false;
  W.inTx((tx) => {
    const x = tx.findRecordById("deposits", d.id);
    if (x.getString("status") !== "pending") return;
    const uid = x.getString("user");
    if (W.credit(tx, uid, x.getFloat("amount"), gw.toUpperCase() + "-" + (v.id || x.getString("tx_ref")), G.NAMES[gw] + " deposit")) {
      const fee = new Record(tx.findCollectionByNameOrId("fees"));
      fee.set("user", uid); fee.set("type", "tax"); fee.set("amount", x.getFloat("fee")); fee.set("status", "confirmed"); fee.set("note", "Tax charge on deposit"); fee.set("tx_ref", x.getString("tx_ref")); fee.set("flw_id", String(v.id || ""));
      tx.save(fee);
    }
    x.set("status", "successful"); x.set("flw_id", String(v.id || "")); tx.save(x);
    W.collect(tx, uid);
    done = true;
  });
  return done ? "successful" : $app.findRecordById("deposits", d.id).getString("status");
}

module.exports = { TAX, MIN, start, settle };
