// Flutterwave (v3) helpers, used ONLY for members' fixed virtual accounts and to verify transfers. Secrets come from environment variables:
//   FLW_SECRET_KEY    your Flutterwave secret key (FLWSECK-...)
//   FLW_WEBHOOK_HASH  the "secret hash" you set in Flutterwave > Settings > Webhooks (any long random string)
const CURRENCY = "NGN";
const base = () => $os.getenv("FLW_BASE_URL") || "https://api.flutterwave.com/v3"; // override only for local testing

const cfg = () => ({ secret: $os.getenv("FLW_SECRET_KEY"), hash: $os.getenv("FLW_WEBHOOK_HASH") });

function api(method, path, payload) {
  const c = cfg();
  if (!c.secret) throw new Error("FLW_SECRET_KEY is not set on the server.");
  const r = $http.send({
    url: base() + path, method, timeout: 30,
    headers: { Authorization: "Bearer " + c.secret, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : "",
  });
  if (r.statusCode >= 500) throw new Error("Flutterwave is unavailable right now (" + r.statusCode + ").");
  return r.json || {};
}

// The reference we give Flutterwave when creating a member's account. Flutterwave sends it back as tx_ref on every transfer into that account.
const vaRef = uid => "JJHHF-VA-" + uid;

// Creates the member's permanent NGN virtual account. Flutterwave requires the holder's BVN or NIN for static accounts;
// it is passed straight through and never stored.
function createAccount(user, idType, idNumber) {
  const name = (user.getString("name") || "").trim().split(/\s+/).filter(Boolean);
  const first = name[0] || "Member", last = name.slice(1).join(" ") || first;
  const body = { email: user.getString("email"), tx_ref: vaRef(user.id), is_permanent: true, firstname: first, lastname: last, narration: "JJHHF Savings", currency: CURRENCY };
  body[idType] = idNumber;
  if (user.getString("phone")) body.phonenumber = user.getString("phone");
  const j = api("POST", "/virtual-account-numbers", body);
  if (j.status !== "success" || !j.data || !j.data.account_number) throw new BadRequestError("Could not create your account number: " + (j.message || "unknown error from Flutterwave"));
  return { number: String(j.data.account_number), bank: String(j.data.bank_name || ""), ref: body.tx_ref };
}

// Asks Flutterwave directly about a transaction id (never trusts the webhook body). Returns Flutterwave's data object, or null.
function verifyTransaction(id) {
  const j = api("GET", "/transactions/" + encodeURIComponent(String(id)) + "/verify");
  return j.status === "success" && j.data ? j.data : null;
}

module.exports = { cfg, api, createAccount, verifyTransaction, vaRef, CURRENCY };
