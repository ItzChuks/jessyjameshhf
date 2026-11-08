// Wallet deposits through Flutterwave Checkout. Every deposit carries a ₦100 tax charge on top:
// a member who wants ₦3,000 in the wallet pays ₦3,100; the wallet gets ₦3,000 and the ₦100 is recorded as a "tax" fee.
// KEEP IN SYNC with FEES.tax in the frontend app.js.
const TAX = 100;
const MIN = 100, MAX = 5000000;

// Starts a deposit: records it as pending and returns the Flutterwave Checkout link.
function start(app, uid, amount, redirect) {
  const F = require(`${__hooks}/flutterwave.js`);
  amount = Math.round(Number(amount));
  if (!(amount >= MIN)) throw new BadRequestError("The smallest deposit is ₦" + MIN + ".");
  if (amount > MAX) throw new BadRequestError("That amount is too large for one deposit.");
  if (!/^https?:\/\/[^\s]+$/.test(String(redirect || ""))) throw new BadRequestError("Missing return address.");
  const user = app.findRecordById("users", uid);
  const ref = F.depRef(uid), total = amount + TAX;
  const d = new Record(app.findCollectionByNameOrId("deposits"));
  d.set("user", uid); d.set("amount", amount); d.set("fee", TAX); d.set("total", total); d.set("tx_ref", ref); d.set("status", "pending");
  app.save(d);
  const link = F.createCheckout(user, ref, total, redirect, "Wallet deposit");
  return { link, tx_ref: ref, amount, fee: TAX, total };
}

// Settles a deposit once Flutterwave confirms it: credits the wallet exactly once, records the tax fee, then runs the collector
// so plans waiting for money are paid at once. Safe to call many times (redirect, webhook and the re-check cron may all call it).
// Returns the deposit's status: "successful", "pending" or "failed".
function settle(txRef, flwId) {
  const F = require(`${__hooks}/flutterwave.js`), W = require(`${__hooks}/wallet.js`);
  let d; try { d = $app.findFirstRecordByData("deposits", "tx_ref", String(txRef || "")); } catch (_) { throw new BadRequestError("Deposit not found."); }
  if (d.getString("status") !== "pending") return d.getString("status");

  const v = flwId ? F.verifyTransaction(flwId) : F.verifyByRef(txRef);
  if (!v || v.tx_ref !== d.getString("tx_ref")) return "pending";
  if (v.status === "failed" || v.status === "cancelled") {
    $app.runInTransaction((tx) => { const x = tx.findRecordById("deposits", d.id); if (x.getString("status") === "pending") { x.set("status", "failed"); x.set("flw_id", String(v.id || "")); x.set("note", "Payment " + v.status); tx.save(x); } });
    return "failed";
  }
  if (v.status !== "successful") return "pending";
  if (v.currency !== F.CURRENCY || Number(v.amount) < d.getFloat("total")) {
    $app.runInTransaction((tx) => { const x = tx.findRecordById("deposits", d.id); x.set("status", "failed"); x.set("flw_id", String(v.id)); x.set("note", "Amount or currency did not match (paid " + v.currency + " " + v.amount + "). Contact support."); tx.save(x); });
    return "failed";
  }
  let done = false;
  W.inTx((tx) => {
    const x = tx.findRecordById("deposits", d.id);
    if (x.getString("status") !== "pending") return;
    const uid = x.getString("user");
    if (W.credit(tx, uid, x.getFloat("amount"), "FLW-" + v.id, "Flutterwave deposit")) {
      const fee = new Record(tx.findCollectionByNameOrId("fees"));
      fee.set("user", uid); fee.set("type", "tax"); fee.set("amount", x.getFloat("fee")); fee.set("status", "confirmed"); fee.set("note", "Tax charge on deposit"); fee.set("tx_ref", x.getString("tx_ref")); fee.set("flw_id", String(v.id));
      tx.save(fee);
    }
    x.set("status", "successful"); x.set("flw_id", String(v.id)); tx.save(x);
    W.collect(tx, uid);
    done = true;
  });
  return done ? "successful" : $app.findRecordById("deposits", d.id).getString("status");
}

module.exports = { TAX, MIN, start, settle };
