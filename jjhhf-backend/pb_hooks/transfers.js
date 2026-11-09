// Bank-transfer deposits with a receipt.
//
// 1. The member types how much they want in the wallet. They transfer that amount + the ₦100 charge to the foundation's account
//    (Admin > Receipts > Settings) and upload the receipt (photo, screenshot or PDF).
// 2. The receipt is read automatically by an AI model (Anthropic Claude, ANTHROPIC_API_KEY on Railway). The server checks:
//      * it really is a successful transfer receipt that does not look edited
//      * the amount is EXACTLY what the member had to pay (amount + charge)
//      * it was paid INTO the foundation's account number (masked numbers like 01****6789 must match on every digit shown)
//      * the payment date is today or within the last few days (Settings: max_age_days) and not in the future
//      * the same receipt (same file, or same transaction reference / session ID) has not been used before
//    If every check passes and automatic approval is on (and the amount is within the automatic limit), the wallet is credited at once
//    and the deposit is marked "credited automatically": an admin should still compare it with the bank statement (Admin > Receipts).
//    Otherwise the deposit waits for an admin, with the reasons.
// 3. An admin can approve a waiting receipt, reject it, confirm an automatic one, or REVERSE a credited one (money taken back from the
//    wallet; the balance may go below zero if it was already spent, and plans then wait until it is topped up again).
//
// A receipt is only a picture: it can never prove money arrived. Automatic approval is a convenience; the admin check against the
// bank statement is what makes it safe. Without ANTHROPIC_API_KEY every receipt simply waits for an admin.
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

// Reads the receipt with the AI model. Returns { ok: true, data } or { ok: false, error }.
function readReceipt(app, rec) {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return { ok: false, error: "Automatic receipt reading is not set up." };
  let file; try { file = receiptData(app, rec); } catch (err) { return { ok: false, error: "Could not open the receipt file." }; }
  const block = file.media === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data } }
    : { type: "image", source: { type: "base64", media_type: file.media, data: file.data } };
  let r;
  try {
    r = $http.send({ url: env("RECEIPT_AI_URL") || "https://api.anthropic.com/v1/messages", method: "POST", timeout: 90,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: env("RECEIPT_AI_MODEL") || "claude-haiku-5-5", max_tokens: 700, messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }] }) });
  } catch (err) { return { ok: false, error: "The receipt reader could not be reached." }; }
  if (r.statusCode !== 200) { console.log("jjhhf receipt AI:", r.statusCode, toString(r.body).slice(0, 300)); return { ok: false, error: "The receipt reader is unavailable right now (" + r.statusCode + ")." }; }
  const text = ((r.json && r.json.content) || []).map(c => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
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

  const read = readReceipt(app, d);
  if (!read.ok) {
    d.set("check", { read: false, error: read.error }); d.set("check_note", "Waiting for an admin to check your receipt.");
    app.save(d);
    return { status: "pending", id: d.id, message: "Receipt received. An admin will check it and credit your wallet." };
  }
  const ev = evaluate(app, d, read.data, S);
  d.set("receipt_ref", ev.ref || "");
  d.set("check", { read: true, ai: read.data, checks: ev.checks, reasons: ev.reasons });
  const tooBig = S.auto_max > 0 && d.getFloat("total") > S.auto_max;
  if (ev.pass && S.auto_approve && !tooBig) {
    d.set("check_note", "Receipt checked automatically.");
    app.save(d);
    let ok = false;
    W.inTx((tx) => { const x = tx.findRecordById("deposits", d.id); if (x.getString("status") !== "pending") return; creditDeposit(tx, x, "auto"); ok = true; });
    if (ok) return { status: "successful", id: d.id, amount, message: W.naira(amount) + " has been added to your wallet." };
  }
  d.set("check_note", ev.pass ? (tooBig ? "Amount is above the automatic limit; waiting for an admin." : "Waiting for an admin to check your receipt.") : ev.reasons.join(" "));
  app.save(d);
  return { status: "pending", id: d.id, message: ev.pass ? "Receipt received. An admin will check it and credit your wallet." : "We could not confirm this receipt automatically: " + ev.reasons.join(" ") + " An admin will check it." };
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
      stamp(); d.set("status", "failed"); d.set("check_note", note || "Rejected: payment not received."); tx.save(d);
      out = { status: "failed" };
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

module.exports = { TAX, MIN, MAX, settingsObj, submit, review, accountMatches, evaluate, b64 };
