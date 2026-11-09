// Payment providers for wallet deposits: Flutterwave, Paystack and Monnify, all through their hosted checkout pages.
// Providers are given out AUTOMATICALLY: every new member is given one at random when they sign up (members without one are picked up
// every 15 minutes, and at their first deposit at the latest). The draw is balanced: it picks at random among the providers that
// currently have the fewest members, so members end up spread evenly across Flutterwave, Paystack and Monnify.
// An admin can still set a member's provider by hand (Admin > Users > member), set it back to Automatic, or reshuffle everyone.
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

// How many members each enabled provider has right now.
function counts(app, list) {
  const c = {}; list.forEach(g => c[g] = 0);
  const rows = arrayOf(new DynamicModel({ g: "", n: 0 }));
  app.db().newQuery("SELECT [[gateway]] AS g, COUNT(*) AS n FROM {{users}} WHERE [[gateway]] != '' GROUP BY [[gateway]]").all(rows);
  rows.forEach(r => { if (r.g in c) c[r.g] = r.n; });
  return c;
}
// A balanced random draw: one of the providers with the fewest members, chosen at random.
function draw(app, list) {
  list = list || enabled();
  if (!list.length) return "";
  const c = counts(app, list), min = Math.min(...list.map(g => c[g]));
  const low = list.filter(g => c[g] === min);
  return low[Math.floor(Math.random() * low.length)];
}
// Gives a member a provider automatically (clears any manual choice). Returns the provider, or "" if none is set up yet.
function assign(app, uid) {
  const g = draw(app); if (!g) return "";
  const u = app.findRecordById("users", uid);
  u.set("gateway", g); u.set("gateway_manual", false); app.save(u);
  return g;
}

// The member's provider: kept once given; a new one is drawn if they have none or theirs has been switched off.
function pick(app, uid) {
  const list = enabled();
  if (!list.length) throw new BadRequestError("Payments are not set up yet. Please contact customer care.");
  const u = app.findRecordById("users", uid), cur = u.getString("gateway");
  if (cur && list.includes(cur)) return cur;
  const g = draw(app, list);
  u.set("gateway", g); u.set("gateway_manual", false); app.save(u);
  return g;
}

// Reshuffles members across the enabled providers, evenly and at random.
//   mode "unassigned": only members with no provider (or one that is switched off), keeping the totals balanced
//   mode "all":        every member except those an admin set by hand
// Returns { changed, total }.
function shuffle(app, mode) {
  const list = enabled();
  if (!list.length) throw new BadRequestError("No payment provider is set up yet. Add the provider keys in Railway first.");
  const known = list.map(g => "'" + g + "'").join(",");          // provider names are fixed strings from ALL, never user input
  const where = mode === "all" ? "[[role]] != 'admin' AND ([[gateway_manual]] = FALSE OR [[gateway_manual]] IS NULL)"
    : "[[role]] != 'admin' AND ([[gateway]] = '' OR [[gateway]] IS NULL OR [[gateway]] NOT IN (" + known + "))";
  const ids = arrayOf(new DynamicModel({ id: "" }));
  app.db().newQuery("SELECT [[id]] FROM {{users}} WHERE " + where).all(ids);
  const order = ids.map(r => r.id);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  // start from the current counts of the members NOT being reshuffled, then always hand the next member to the emptiest provider
  const c = {}; list.forEach(g => c[g] = 0);
  if (mode !== "all") Object.assign(c, counts(app, list));
  else {
    const rows = arrayOf(new DynamicModel({ g: "", n: 0 }));
    app.db().newQuery("SELECT [[gateway]] AS g, COUNT(*) AS n FROM {{users}} WHERE [[gateway_manual]] = TRUE AND [[gateway]] != '' GROUP BY [[gateway]]").all(rows);
    rows.forEach(r => { if (r.g in c) c[r.g] = r.n; });
  }
  let changed = 0;
  for (let k = 0; k < order.length; k += 500) {
    app.runInTransaction((tx) => {
      order.slice(k, k + 500).forEach(id => {
        const min = Math.min(...list.map(g => c[g])), low = list.filter(g => c[g] === min);
        const g = low[Math.floor(Math.random() * low.length)]; c[g]++;
        const u = tx.findRecordById("users", id);
        if (u.getString("gateway") !== g) changed++;
        u.set("gateway", g); u.set("gateway_manual", false); tx.save(u);
      });
    });
  }
  return { changed, total: order.length, counts: c };
}

module.exports = { NAMES, ALL, enabled, get, pick, draw, assign, shuffle };
