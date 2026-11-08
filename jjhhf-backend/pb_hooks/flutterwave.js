// Flutterwave (v3) helpers for wallet deposits through Flutterwave Checkout. Secrets come from environment variables:
//   FLW_SECRET_KEY    your Flutterwave secret key (FLWSECK-...)
//   FLW_WEBHOOK_HASH  the "secret hash" you set in Flutterwave > Settings > Webhooks (any long random string)
const CURRENCY = "NGN";
const base = () => $os.getenv("FLW_BASE_URL") || "https://api.flutterwave.com/v3"; // override only for local testing

const cfg = () => ({ secret: $os.getenv("FLW_SECRET_KEY"), hash: $os.getenv("FLW_WEBHOOK_HASH") });

function api(method, path, payload) {
  const c = cfg();
  if (!c.secret) throw new BadRequestError("Payments are not set up yet (FLW_SECRET_KEY is missing on the server).");
  const r = $http.send({
    url: base() + path, method, timeout: 30,
    headers: { Authorization: "Bearer " + c.secret, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : "",
  });
  if (r.statusCode >= 500) throw new Error("Flutterwave is unavailable right now (" + r.statusCode + ").");
  return r.json || {};
}

// Every deposit gets its own reference; Flutterwave sends it back on the redirect and in the webhook.
const depRef = uid => "JJHHF-DEP-" + uid + "-" + $security.randomStringWithAlphabet(10, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");

// Creates a Flutterwave Checkout page for one deposit and returns its link. The member pays "total" (amount + tax charge).
function createCheckout(user, txRef, total, redirect, title) {
  const body = {
    tx_ref: txRef, amount: total, currency: CURRENCY, redirect_url: redirect,
    customer: { email: user.getString("email"), name: user.getString("name") || user.getString("email"), phonenumber: user.getString("phone") || undefined },
    customizations: { title: title || "Wallet deposit", description: "Wallet deposit (includes ₦100 tax charge)" },
    meta: { user: user.id },
  };
  const j = api("POST", "/payments", body);
  if (j.status !== "success" || !j.data || !j.data.link) throw new BadRequestError("Could not start the payment: " + (j.message || "unknown error from Flutterwave"));
  return j.data.link;
}

// Asks Flutterwave directly about a transaction (never trusts the browser or the webhook body). Returns Flutterwave's data object, or null.
function verifyTransaction(id) {
  const j = api("GET", "/transactions/" + encodeURIComponent(String(id)) + "/verify");
  return j.status === "success" && j.data ? j.data : null;
}
function verifyByRef(txRef) {
  const j = api("GET", "/transactions/verify_by_reference?tx_ref=" + encodeURIComponent(String(txRef)));
  return j.status === "success" && j.data ? j.data : null;
}

module.exports = { cfg, api, createCheckout, verifyTransaction, verifyByRef, depRef, CURRENCY };
