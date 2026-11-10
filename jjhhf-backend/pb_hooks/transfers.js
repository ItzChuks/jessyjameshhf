// Bank-transfer deposits with a receipt: CREDIT FIRST, CHECK AFTER.
//
// 1. The member types how much they want in the wallet, transfers that amount + the ₦100 charge to the foundation's account
//    (Admin > Receipts > Account and settings) and uploads the receipt (photo, screenshot or PDF).
// 2. The wallet is credited AT ONCE ("Account credited, payment confirmation under review"), and plans waiting for money are paid.
//    Two exceptions wait for an admin instead: the exact same receipt file was uploaded before, or the amount is above the
//    "largest amount credited at once" setting (0 = no limit). With "Credit as soon as a receipt is uploaded" turned off in the
//    settings, every receipt waits for an admin (the old way).
// 3. Every credited receipt is listed in Admin > Receipts > To check. The admin compares it with the bank statement and CONFIRMS it,
//    or REVERSES it (the money is taken back from the wallet; the balance may go below zero if it was already spent, and plans
//    then wait until the member tops up again).
// 4. If an AI key is set (see "which AI reads the receipts"), each receipt is also read in the background to help the admin:
//    amount exactly right, paid into our account number, dated within max_age_days, transaction reference not used before,
//    successful and not edited. It only adds ✓/✗ flags in Admin > Receipts; it never delays or blocks the credit.
const W = require(`${__hooks}/wallet.js`);
const TAX = 100, MIN = 100, MAX = 5000000, PER_DAY = 15;
const env = k => $os.getenv(k) || "";
const nowTs = () => new Date().toISOString().replace("T", " ");

function settings(app) {
  try { return app.findFirstRecordByFilter("app_settings", "id != ''"); } catch (_) { return null; }
}
function settingsObj(app) {
  const s = settings(app);
  return s ? { bank_name: s.getString("bank_name"), account_number: s.getString("account_number"), account_name: s.getString("account_name"),
    transfer_note: s.getString("transfer_note"), auto_approve: s.getBool("auto_approve"), auto_max: s.getFloat("auto_max"), max_age_days: s.getInt("max_age_days") }
    : { bank_name: "", account_number: "", account_name: "", transfer_note: "", auto_approve: false, auto_max: 0, max_age_days: 2 };
}

// base64 of a byte array (the hooks engine has no btoa / Buffer)
function b64(bytes) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", n = bytes.length, out = [];
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i] & 255, b = i + 1 < n ? bytes[i + 1] & 255 : 0, c = i + 2 < n ? bytes[i + 2] & 255 : 0, t = (a << 16) | (b << 8) | c;
    out.push(A[(t >> 18) & 63] + A[(t >> 12) & 63] + (i + 1 < n ? A[(t >> 6) & 63] : "=") + (i + 2 < n ? A[t & 63] : "="));
  }
  return out.join("");
}
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf" };
const extOf = name => String(name || "").toLowerCase().split(".").pop();

// the stored receipt file as { data (base64), media }
function receiptData(app, rec) {
  const name = rec.getString("receipt");
  const fsys = $app.newFilesystem();
  try {
    const r = fsys.getReader(rec.baseFilesPath() + "/" + name);
    try { return { data: b64(toBytes(r, 8 * 1024 * 1024)), media: MIME[extOf(name)] || "image/jpeg" }; } finally { r.close(); }
  } finally { fsys.close(); }
}

const PROMPT = `You are checking a payment receipt uploaded to a Nigerian savings website. It should be a bank transfer receipt or a banking-app screenshot.
Read it carefully and reply with ONLY a JSON object, no other text:
{"is_receipt": true/false, "status": "successful" | "pending" | "failed" | "unknown", "amount": number in naira without commas (the amount transferred, not fees or balance), "currency": "NGN",
 "date": "YYYY-MM-DD" (the transaction date), "time": "HH:MM" or "", "beneficiary_account_number": "the RECEIVING account number exactly as shown, digits and * for any masked digits",
 "beneficiary_account_name": "", "beneficiary_bank": "", "sender_name": "", "sender_bank": "", "reference": "transaction reference or session ID, as shown",
 "looks_edited": true/false (true if text looks pasted over, misaligned, inconsistent fonts, or anything suggests the image was altered), "notes": "anything unusual, short"}
Use "" or null for anything you cannot see. Never guess numbers.`;

// ---- which AI reads the receipts ----
// Set ONE key in Railway > Variables (the first one found is used, or choose with RECEIPT_AI):
//   GEMINI_API_KEY     Google Gemini (aistudio.google.com; has a free tier)        RECEIPT_AI=gemini
//   XAI_API_KEY        Grok (console.x.ai)                                          RECEIPT_AI=xai
//   OPENAI_API_KEY     OpenAI (platform.openai.com)                                 RECEIPT_AI=openai
//   ANTHROPIC_API_KEY  Anthropic Claude (console.anthropic.com)                     RECEIPT_AI=anthropic
// Optional: RECEIPT_AI_MODEL to use another model of that provider.
const PROVIDERS = {
  gemini: { name: "Google Gemini", key: "GEMINI_API_KEY", model: "gemini-3.8-flash", pdf: true },
  xai: { name: "Grok (xAI)", key: "XAI_API_KEY", model: "grok-4", pdf: false },
  openai: { name: "OpenAI", key: "OPENAI_API_KEY", model: "gpt-5-mini", pdf: false },
  anthropic: { name: "Anthropic Claude", key: "ANTHROPIC_API_KEY", model: "claude-haiku-5-5", pdf: true },
};
function provider() {
  const want = env("RECEIPT_AI").toLowerCase();
  if (PROVIDERS[want] && env(PROVIDERS[want].key)) return want;
  return ["gemini", "xai", "openai", "anthropic"].find(p => env(PROVIDERS[p].key)) || "";
}
const providerName = () => { const p = provider(); return p ? PROVIDERS[p].name : ""; };

// one request to the chosen provider; returns the model's text answer
function askAI(p, file, timeout) {
  const P = PROVIDERS[p], key = env(P.key), model = env("RECEIPT_AI_MODEL") || P.model, data = "data:" + file.media + ";base64," + file.data;
  let req, pick;
  if (p === "gemini") {
    req = { url: env("RECEIPT_AI_URL") || "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      // receipts need no deep reasoning: "low" thinking answers much faster (RECEIPT_AI_THINKING to change; "off" leaves the model's default)
      body: { contents: [{ parts: [{ inline_data: { mime_type: file.media, data: file.data } }, { text: PROMPT }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } } };
    const lvl = (env("RECEIPT_AI_THINKING") || "low").toLowerCase();
    if (lvl !== "off") req.body.generationConfig.thinkingConfig = { thinkingLevel: lvl };
    pick = j => (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(x => x.text || "").join("");
  } else if (p === "xai" || p === "openai") {
    req = { url: env("RECEIPT_AI_URL") || (p === "xai" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions"),
      headers: { "content-type": "application/json", "authorization": "Bearer " + key },
      body: { model, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: data, detail: "high" } }, { type: "text", text: PROMPT }] }] } };
    pick = j => ((((j.choices || [])[0] || {}).message || {}).content) || "";
  } else {
    const block = file.media === "application/pdf" ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data } } : { type: "image", source: { type: "base64", media_type: file.media, data: file.data } };
    req = { url: env("RECEIPT_AI_URL") || "https://api.anthropic.com/v1/messages",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: { model, max_tokens: 700, messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }] } };
    pick = j => ((j.content || []).map(c => c.text || "").join(""));
  }
  const send = () => $http.send({ url: req.url, method: "POST", timeout: timeout || 25, headers: req.headers, body: JSON.stringify(req.body) });
  let r = send();
  if (r.statusCode === 400 && req.body.generationConfig && req.body.generationConfig.thinkingConfig) {   // a model that does not accept that thinking level
    delete req.body.generationConfig.thinkingConfig; r = send();
  }
  if (r.statusCode !== 200) { console.log("jjhhf receipt AI (" + p + "):", r.statusCode, toString(r.body).slice(0, 300)); const e = new Error(P.name + " is unavailable right now (" + r.statusCode + ")."); e.retry = r.statusCode === 429 || r.statusCode >= 500; throw e; }
  return pick(r.json || {});
}

// Reads the receipt with the chosen AI. Returns { ok: true, data } or { ok: false, error }.
function readReceipt(app, rec, timeout) {
  const p = provider();
  if (!p) return { ok: false, error: "Automatic receipt reading is not set up." };
  let file; try { file = receiptData(app, rec); } catch (err) { return { ok: false, error: "Could not open the receipt file." }; }
  if (file.media === "application/pdf" && !PROVIDERS[p].pdf) return { ok: false, error: PROVIDERS[p].name + " cannot read PDF receipts; an admin will check it." };
  if (p === "xai" && !/^image\/(jpeg|png)$/.test(file.media)) return { ok: false, error: "Grok reads only JPG and PNG receipts; an admin will check it." };
  let text;
  try { text = askAI(p, file, timeout); }
  catch (err) {
    const msg = String((err && err.message) || err);
    // slow or busy (timeout, rate limit, server error): try again in the background instead of keeping the member waiting
    const retry = !!(err && err.retry) || /deadline|timeout|timed out|EOF|connection|reset|refused/i.test(msg);
    const plain = /deadline|timeout|timed out/i.test(msg) ? PROVIDERS[p].name + " took too long to answer." : /EOF|connection|reset|refused/i.test(msg) ? PROVIDERS[p].name + " could not be reached." : msg.replace(/^[\s\S]*?Error:\s*/, "");
    return { ok: false, retry, error: plain };
  }
  const m = String(text || "").match(/\{[\s\S]*\}/);
  try { return { ok: true, data: JSON.parse(m ? m[0] : text) }; } catch (_) { return { ok: false, error: "The receipt could not be read clearly." }; }
}

const digits = s => String(s || "").replace(/[^0-9*xX]/g, "").replace(/[xX]/g, "*");
// the receipt's account number matches ours: equal, or masked with every visible digit in place (at least 4 visible)
function accountMatches(seen, ours) {
  const a = digits(seen), b = String(ours || "").replace(/\D/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.indexOf("*") < 0 || a.length !== b.length) return false;
  let shown = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] === "*") continue; if (a[i] !== b[i]) return false; shown++; }
  return shown >= 4;
}
// Lagos calendar day number (days since 1970) of a Date / "YYYY-MM-DD"
const lagosDay = d => Math.floor((d.getTime() + 36e5) / 864e5);
const ymdDay = s => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null; };

// Runs every check. Returns { pass, reasons[], checks{} }.
function evaluate(app, rec, ai, S) {
  const reasons = [], checks = {};
  const total = rec.getFloat("total");
  checks.receipt = !!ai.is_receipt && ai.status !== "failed" && ai.status !== "pending";
  if (!ai.is_receipt) reasons.push("This does not look like a transfer receipt.");
  else if (ai.status === "failed" || ai.status === "pending") reasons.push("The receipt shows the transfer as " + ai.status + ".");
  checks.edited = !ai.looks_edited;
  if (ai.looks_edited) reasons.push("The receipt may have been edited.");
  const amt = Number(String(ai.amount == null ? "" : ai.amount).replace(/[^0-9.]/g, ""));
  checks.amount = amt > 0 && Math.abs(amt - total) < 0.01 && (!ai.currency || String(ai.currency).toUpperCase() === "NGN");
  if (!checks.amount) reasons.push(amt > 0 ? "Amount on the receipt is " + W.naira(amt) + "; expected exactly " + W.naira(total) + "." : "The amount could not be read.");
  checks.account = !!S.account_number && accountMatches(ai.beneficiary_account_number, S.account_number);
  if (!S.account_number) reasons.push("No receiving account is set up yet.");
  else if (!checks.account) reasons.push(ai.beneficiary_account_number ? "Paid to account " + ai.beneficiary_account_number + ", not our account." : "The receiving account number could not be read.");
  const day = ymdDay(ai.date), today = lagosDay(new Date()), maxAge = S.max_age_days > 0 ? S.max_age_days : 2;
  checks.date = day !== null && day <= today && today - day <= maxAge;
  if (day === null) reasons.push("The payment date could not be read.");
  else if (day > today) reasons.push("The payment date is in the future.");
  else if (today - day > maxAge) reasons.push("The payment is dated " + ai.date + ", more than " + maxAge + " day" + (maxAge === 1 ? "" : "s") + " ago.");
  // the same receipt used before (same file or same transaction reference)
  const ref = String(ai.reference || "").replace(/\s+/g, "").toUpperCase();
  const dup = (f, v) => v ? app.findRecordsByFilter("deposits", f + " = {:v} && id != {:id}", "", 1, 0, { v, id: rec.id }) : [];
  const d1 = dup("receipt_hash", rec.getString("receipt_hash")), d2 = ref.length >= 6 ? dup("receipt_ref", ref) : [];
  checks.unique = !d1.length && !d2.length;
  if (d1.length) reasons.push("This receipt file was already uploaded before.");
  else if (d2.length) reasons.push("A receipt with the same transaction reference (" + ref + ") was already uploaded.");
  return { pass: reasons.length === 0, reasons, checks, ref };
}

// Credits a deposit (inside a transaction): wallet + the ₦100 tax fee, then pays plans that are waiting.
function creditDeposit(tx, dep, how) {
  const uid = dep.getString("user");
  if (W.credit(tx, uid, dep.getFloat("amount"), "TRANSFER-" + dep.id, "Bank transfer" + (how === "auto" ? " (receipt checked automatically)" : " (approved by admin)"))) {
    const fee = new Record(tx.findCollectionByNameOrId("fees"));
    fee.set("user", uid); fee.set("type", "tax"); fee.set("amount", dep.getFloat("fee")); fee.set("status", "confirmed"); fee.set("note", "Tax charge on deposit"); fee.set("tx_ref", dep.getString("tx_ref"));
    tx.save(fee);
  }
  dep.set("status", "successful"); dep.set("verified", how);
  tx.save(dep);
  W.collect(tx, uid);
}

// A member submits a transfer: amount (what goes into the wallet), the receipt file, and the sender name on the bank account.
function submit(app, uid, amount, file, senderName) {
  amount = Math.round(Number(amount));
  if (!(amount >= MIN)) throw new BadRequestError("The smallest deposit is ₦" + MIN + ".");
  if (amount > MAX) throw new BadRequestError("That amount is too large for one deposit.");
  if (!file) throw new BadRequestError("Upload your payment receipt.");
  if (!MIME[extOf(file.originalName || file.name)]) throw new BadRequestError("Upload the receipt as a photo, screenshot (JPG, PNG) or PDF.");
  if (file.size > 6 * 1024 * 1024) throw new BadRequestError("The receipt file is too large (6 MB at most).");
  const since = new Date(Date.now() - 864e5).toISOString().replace("T", " ");
  if (app.findRecordsByFilter("deposits", "user = {:u} && created >= {:t} && receipt != ''", "", PER_DAY + 1, 0, { u: uid, t: since }).length >= PER_DAY)
    throw new BadRequestError("Too many receipts today. Please contact customer care.");
  const S = settingsObj(app);
  if (!S.account_number) throw new BadRequestError("Deposits are not open yet: no account has been set up. Please contact customer care.");

  const d = new Record(app.findCollectionByNameOrId("deposits"));
  d.set("user", uid); d.set("amount", amount); d.set("fee", TAX); d.set("total", amount + TAX); d.set("status", "pending"); d.set("gateway", "transfer");
  d.set("tx_ref", "JJHHF-TRF-" + $security.randomStringWithAlphabet(12, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"));
  d.set("sender_name", String(senderName || "").trim().slice(0, 120));
  d.set("receipt", file);
  app.save(d);

  // fingerprint of the file, to catch the same receipt uploaded twice
  let hash = "";
  try { const f = receiptData(app, d); hash = $security.sha256(f.data); } catch (_) { }
  d.set("receipt_hash", hash);

  // the same file uploaded before is never credited twice: it waits for an admin
  const dup = hash ? app.findRecordsByFilter("deposits", "receipt_hash = {:h} && id != {:id}", "", 1, 0, { h: hash, id: d.id }) : [];
  const tooBig = S.auto_max > 0 && d.getFloat("total") > S.auto_max;
  d.set("ai_state", provider() ? "queued" : "");                 // read in the background to help the admin (processQueue)
  d.set("check", { read: false });
  if (dup.length || tooBig || !S.auto_approve) {
    d.set("check_note", dup.length ? "This receipt file was already uploaded before; an admin will check it." : tooBig ? "Large deposit: an admin will check it and credit your wallet." : "An admin will check your receipt and credit your wallet.");
    app.save(d);
    return { status: "pending", id: d.id, message: dup.length ? "This receipt was already uploaded before, so it was not credited again. An admin will check it." : "Receipt received. An admin will check it and credit your wallet." };
  }
  d.set("check_note", "Account credited. Payment confirmation under review.");
  app.save(d);
  W.inTx((tx) => { const x = tx.findRecordById("deposits", d.id); if (x.getString("status") === "pending") creditDeposit(tx, x, "auto"); });
  return { status: "successful", id: d.id, amount, message: "Account credited with " + W.naira(amount) + ". Payment confirmation under review." };
}

// Background reading of receipts (every minute, wallet.pb.js): stores what was read and the ✓/✗ checks for the admin. Never moves money.
// A slow or busy reader is retried up to 5 times; after that the receipt shows "not read" and the admin checks it by eye.
function processQueue(app, budgetMs) {
  if (!provider()) return 0;
  const t0 = Date.now(), S = settingsObj(app);
  const list = app.findRecordsByFilter("deposits", "ai_state = 'queued'", "created", 20, 0);
  let n = 0;
  for (const d of list) {
    if (Date.now() - t0 > budgetMs) break;
    const c = d.get("check") || {}, tries = (Number(c.tries) || 0) + 1;
    const read = readReceipt(app, d, 40);
    const x = app.findRecordById("deposits", d.id);
    if (!read.ok && read.retry && tries < 5) { x.set("check", { read: false, tries, error: read.error }); app.save(x); continue; }
    if (!read.ok) { x.set("check", { read: false, error: read.error }); x.set("ai_state", "failed"); app.save(x); n++; continue; }
    const ev = evaluate(app, x, read.data, S);
    x.set("receipt_ref", ev.ref || ""); x.set("check", { read: true, ai: read.data, checks: ev.checks, reasons: ev.reasons }); x.set("ai_state", "done");
    app.save(x); n++;
  }
  return n;
}

// Admin actions on a transfer deposit: approve | reject | confirm | reverse
function review(app, adminId, depId, action, note) {
  note = String(note || "").trim().slice(0, 300);
  let out = {};
  W.inTx((tx) => {
    let d; try { d = tx.findRecordById("deposits", String(depId || "")); } catch (_) { throw new BadRequestError("Deposit not found."); }
    const st = d.getString("status"), uid = d.getString("user");
    const stamp = () => { d.set("reviewed_by", adminId); d.set("reviewed_at", nowTs()); };
    if (action === "approve") {
      if (st !== "pending" && st !== "failed") throw new BadRequestError("Only a waiting or rejected receipt can be approved.");
      stamp(); d.set("check_note", note || "Approved by admin."); creditDeposit(tx, d, "admin");
      out = { status: "successful" };
    } else if (action === "reject") {
      if (st !== "pending") throw new BadRequestError("Only a waiting receipt can be rejected. To take back money already credited, use Reverse.");
      stamp(); d.set("status", "failed"); d.set("verified", ""); d.set("check_note", note || "Rejected: payment not received."); tx.save(d);
      out = { status: "failed" };
    } else if (action === "reread") {
      if (!d.getString("receipt")) throw new BadRequestError("This deposit has no receipt.");
      if (!provider()) throw new BadRequestError("Automatic receipt reading is not set up.");
      d.set("ai_state", "queued"); d.set("check", { read: false, tries: 0 }); tx.save(d);
      out = { status: st, queued: true };
    } else if (action === "confirm") {
      if (st !== "successful") throw new BadRequestError("Only a credited deposit can be confirmed.");
      stamp(); d.set("verified", "admin"); if (note) d.set("check_note", note); tx.save(d);
      out = { status: "successful" };
    } else if (action === "reverse") {
      if (st !== "successful") throw new BadRequestError("Only a credited deposit can be reversed.");
      W.post(tx, uid, -d.getFloat("amount"), "reversal", "Deposit reversed by admin" + (note ? " · " + note : " · payment not received"), { ref: "REVERSAL-" + d.id, allowNegative: true });
      tx.findRecordsByFilter("fees", "tx_ref = {:r} && type = 'tax'", "", 0, 0, { r: d.getString("tx_ref") }).forEach(f => { f.set("status", "rejected"); tx.save(f); });
      stamp(); d.set("status", "reversed"); d.set("check_note", note || "Reversed: payment not received."); tx.save(d);
      out = { status: "reversed", balance: W.balanceOf(tx, uid) };
    } else throw new BadRequestError("Unknown action.");
  });
  return out;
}

module.exports = { TAX, MIN, MAX, settingsObj, submit, review, processQueue, accountMatches, evaluate, b64, providerName };
