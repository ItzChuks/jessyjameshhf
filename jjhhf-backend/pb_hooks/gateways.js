// Payment providers for wallet deposits: Flutterwave, Paystack and Monnify, all through their hosted checkout pages.
// Each member is given one provider at random the first time they deposit (only providers whose keys are set are used), and keeps it.
// An admin can move a member to another provider (Admin > Users > member).
//
// Environment variables (Railway > Variables):
//   Flutterwave  FLW_SECRET_KEY, FLW_WEBHOOK_HASH                       webhook: /api/jjhhf/flw-webhook
//   Paystack     PAYSTACK_SECRET_KEY                                     webhook: /api/jjhhf/paystack-webhook
//   Monnify      MONNIFY_API_KEY, MONNIFY_SECRET_KEY, MONNIFY_CONTRACT_CODE,
//                MONNIFY_BASE_URL (https://sandbox.monnify.com for testing; default https://api.monnify.com)   webhook: /api/jjhhf/monnify-webhook
//   GATEWAYS     optional, e.g. "paystack,monnify" to use only some of the configured providers
//
// Every provider returns the same shape from verify(): { status: "successful" | "failed" | "pending", amount (naira), currency, id, ref }.
// The amount, currency and reference are always checked by deposits.js against the deposit we recorded; a browser or webhook is never trusted.
const NAMES = { flutterwave: "Flutterwave", paystack: "Paystack", monnify: "Monnify" };
const env = k => $os.getenv(k) || "";

function call(method, url, headers, payload) {
  const r = $http.send({ url, method, timeout: 30, headers: Object.assign({ "Content-Type": "application/json" }, headers), body: payload ? JSON.stringify(payload) : "" });
  if (r.statusCode >= 500) throw new Error("The payment provider is unavailable right now (" + r.statusCode + ").");
  return { status: r.statusCode, json: r.json || {} };
}

// ---------- Flutterwave (helpers in flutterwave.js) ----------
const flutterwave = {
  configured: () => !!env("FLW_SECRET_KEY"),
  checkout(user, ref, total, redirect) { return require(`${__hooks}/flutterwave.js`).createCheckout(user, ref, total, redirect, "Wallet deposit"); },
  verify(ref, id) {
    const F = require(`${__hooks}/flutterwave.js`);
    const v = id ? F.verifyTransaction(id) : F.verifyByRef(ref);
    if (!v) return { status: "pending" };
    const st = v.status === "successful" ? "successful" : (v.status === "failed" || v.status === "cancelled") ? "failed" : "pending";
    return { status: st, amount: Number(v.amount), currency: v.currency, id: String(v.id || ""), ref: v.tx_ref };
  },
};

// ---------- Paystack ----------
const PS = () => env("PAYSTACK_BASE_URL") || "https://api.paystack.co";
const psHead = () => { if (!env("PAYSTACK_SECRET_KEY")) throw new BadRequestError("Paystack is not set up yet (PAYSTACK_SECRET_KEY is missing)."); return { Authorization: "Bearer " + env("PAYSTACK_SECRET_KEY") }; };
const paystack = {
  configured: () => !!env("PAYSTACK_SECRET_KEY"),
  checkout(user, ref, total, redirect) {
    const r = call("POST", PS() + "/transaction/initialize", psHead(), {
      email: user.getString("email"), amount: Math.round(total * 100), currency: "NGN", reference: ref, callback_url: redirect,
      metadata: { user: user.id, purpose: "Wallet deposit (includes ₦100 tax charge)" },
    });
    if (!r.json.status || !r.json.data || !r.json.data.authorization_url) throw new BadRequestError("Could not start the payment: " + (r.json.message || "unknown error from Paystack"));
    return r.json.data.authorization_url;
  },
  verify(ref) {
    const r = call("GET", PS() + "/transaction/verify/" + encodeURIComponent(ref), psHead());
    const d = r.json.data;
    if (!r.json.status || !d) return { status: "pending" };
    const st = d.status === "success" ? "successful" : (d.status === "failed" || d.status === "abandoned" || d.status === "reversed") ? "failed" : "pending";
    return { status: st, amount: Number(d.amount) / 100, currency: d.currency, id: String(d.id || ""), ref: d.reference };
  },
};

// ---------- Monnify ----------
// base64 of an ASCII string (API key and secret), written out because the hooks engine has no btoa()
function b64(str) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; let out = "";
  for (let i = 0; i < str.length; i += 3) {
    const a = str.charCodeAt(i), b = str.charCodeAt(i + 1), c = str.charCodeAt(i + 2), n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (isNaN(b) ? "=" : A[(n >> 6) & 63]) + (isNaN(c) ? "=" : A[n & 63]);
  }
  return out;
}
const MN = () => (env("MONNIFY_BASE_URL") || "https://api.monnify.com").replace(/\/+$/, "");
function mnToken() {
  const key = env("MONNIFY_API_KEY"), secret = env("MONNIFY_SECRET_KEY");
  if (!key || !secret || !env("MONNIFY_CONTRACT_CODE")) throw new BadRequestError("Monnify is not set up yet (MONNIFY_API_KEY / MONNIFY_SECRET_KEY / MONNIFY_CONTRACT_CODE missing).");
  let cached = null; try { cached = JSON.parse(String($app.store().get("jjhhf_monnify_token") || "null")); } catch (_) { }
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const basic = b64(key + ":" + secret);
  const r = call("POST", MN() + "/api/v1/auth/login", { Authorization: "Basic " + basic }, {});
  const b = r.json.responseBody;
  if (!r.json.requestSuccessful || !b || !b.accessToken) throw new BadRequestError("Monnify login failed: " + (r.json.responseMessage || r.status));
  $app.store().set("jjhhf_monnify_token", JSON.stringify({ token: b.accessToken, exp: Date.now() + (Number(b.expiresIn) || 3000) * 1000 }));
  return b.accessToken;
}
const monnify = {
  configured: () => !!(env("MONNIFY_API_KEY") && env("MONNIFY_SECRET_KEY") && env("MONNIFY_CONTRACT_CODE")),
  checkout(user, ref, total, redirect) {
    const r = call("POST", MN() + "/api/v1/merchant/transactions/init-transaction", { Authorization: "Bearer " + mnToken() }, {
      amount: total, customerName: user.getString("name") || user.getString("email"), customerEmail: user.getString("email"),
      paymentReference: ref, paymentDescription: "Wallet deposit (includes ₦100 tax charge)", currencyCode: "NGN",
      contractCode: env("MONNIFY_CONTRACT_CODE"), redirectUrl: redirect, paymentMethods: ["CARD", "ACCOUNT_TRANSFER", "USSD"],
    });
    const b = r.json.responseBody;
    if (!r.json.requestSuccessful || !b || !b.checkoutUrl) throw new BadRequestError("Could not start the payment: " + (r.json.responseMessage || "unknown error from Monnify"));
    return b.checkoutUrl;
  },
  verify(ref) {
    const r = call("GET", MN() + "/api/v2/merchant/transactions/query?paymentReference=" + encodeURIComponent(ref), { Authorization: "Bearer " + mnToken() });
    const b = r.json.responseBody;
    if (!r.json.requestSuccessful || !b) return { status: "pending" };
    const p = String(b.paymentStatus || "").toUpperCase();
    const st = p === "PAID" || p === "OVERPAID" ? "successful" : ["FAILED", "EXPIRED", "CANCELLED", "REVERSED", "ABANDONED"].includes(p) ? "failed" : "pending";
    return { status: st, amount: Number(b.amountPaid || 0), currency: b.currency || b.currencyCode || "NGN", id: String(b.transactionReference || ""), ref: b.paymentReference };
  },
};

const ALL = { flutterwave, paystack, monnify };
// the providers that can be used right now: configured, and (if GATEWAYS is set) listed there
function enabled() {
  const only = env("GATEWAYS").toLowerCase().split(/[\s,]+/).filter(Boolean);
  return Object.keys(ALL).filter(k => ALL[k].configured() && (!only.length || only.includes(k)));
}
const get = name => { const g = ALL[name]; if (!g) throw new BadRequestError("Unknown payment provider."); return g; };

// The member's provider: kept once given; a new one is drawn at random if they have none or theirs has been switched off.
function pick(app, uid) {
  const list = enabled();
  if (!list.length) throw new BadRequestError("Payments are not set up yet. Please contact customer care.");
  const u = app.findRecordById("users", uid), cur = u.getString("gateway");
  if (cur && list.includes(cur)) return cur;
  const g = list[Math.floor(Math.random() * list.length)];
  u.set("gateway", g); app.save(u);
  return g;
}

module.exports = { NAMES, ALL, enabled, get, pick };
