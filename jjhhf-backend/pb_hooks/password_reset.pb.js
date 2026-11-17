/// <reference path="../pb_data/types.d.ts" />
// Forgotten passwords without email: an admin gives the member a temporary password (shared on WhatsApp), and the member
// must choose their own password the next time they sign in.

// Admin: make a temporary password for a member. Signs the member out everywhere (their old sessions stop working).
// body { user } -> { password }  (shown once to the admin)
routerAdd("POST", "/api/jjhhf/admin/reset-password", (e) => {
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only.");
  const id = String((e.requestInfo().body || {}).user || "");
  let u; try { u = $app.findRecordById("users", id); } catch (_) { throw new BadRequestError("Member not found."); }
  if (u.id === e.auth.id) throw new BadRequestError("Use Change password on your own profile instead.");
  // easy to read out and type: no 0/O or 1/I/l
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", pw = "JJ-" + $security.randomStringWithAlphabet(4, A) + "-" + $security.randomStringWithAlphabet(4, A);
  u.setPassword(pw);
  u.set("must_change_password", true);
  $app.save(u);
  console.log("jjhhf: admin", e.auth.id, "gave a temporary password to", u.id);
  return e.json(200, { ok: true, password: pw, email: u.getString("email"), name: u.getString("name") });
}, $apis.requireAuth());

// Anyone signed in: change your own password. body { current, password, passwordConfirm }
routerAdd("POST", "/api/jjhhf/me/password", (e) => {
  const b = e.requestInfo().body || {}, cur = String(b.current || ""), pw = String(b.password || "");
  if (e.auth.collection().name !== "users") throw new ForbiddenError("Members only.");
  const u = $app.findRecordById("users", e.auth.id);
  if (!u.validatePassword(cur)) throw new BadRequestError("Your current password is not correct.");
  if (pw.length < 8) throw new BadRequestError("The new password must be at least 8 characters.");
  if (pw !== String(b.passwordConfirm || "")) throw new BadRequestError("The new passwords do not match.");
  if (pw === cur) throw new BadRequestError("Choose a password different from the current one.");
  u.setPassword(pw);
  u.set("must_change_password", false);
  $app.save(u);
  return e.json(200, { ok: true });
}, $apis.requireAuth());

// Forgotten password by email code (no link). 1) POST /api/jjhhf/password/code { email } emails a 6-digit code, valid 15 minutes.
// The answer is the same whether or not the email has an account. A new code can be asked for after 60 seconds.
routerAdd("POST", "/api/jjhhf/password/code", (e) => {
  const email = String((e.requestInfo().body || {}).email || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestError("Enter the email address on your account.");
  let u = null; try { u = $app.findAuthRecordByEmail("users", email); } catch (_) { try { u = $app.findAuthRecordByEmail("users", email.toLowerCase()); } catch (_) { } }
  if (u) {
    const until = Date.parse(String(u.getString("reset_until")));
    if (!isNaN(until) && until - 14 * 60e3 > Date.now()) throw new BadRequestError("A code was sent less than a minute ago. Check your inbox (and spam), or try again in a minute.");
    const code = String(100000 + Math.floor(Math.random() * 900000));   // 6 digits
    u.set("reset_code", $security.sha256(u.id + ":" + code));
    u.set("reset_until", new Date(Date.now() + 15 * 60e3).toISOString());
    u.set("reset_tries", 0);
    $app.save(u);
    const meta = $app.settings().meta, name = (u.getString("name") || "").split(" ")[0] || "there";
    const msg = new MailerMessage({
      from: { address: meta.senderAddress, name: meta.senderName || "Jessy James HHF" },
      to: [{ address: u.getString("email"), name: u.getString("name") }],
      subject: "Your password reset code: " + code,
      html: '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#0f172a"><h2 style="color:#065f46;margin:0 0 12px">Reset your password</h2>'
        + '<p>Hello ' + name + ',</p><p>Use this code to choose a new password for your Jessy James Helping Hands Foundation account:</p>'
        + '<p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:20px 0;color:#065f46">' + code + '</p>'
        + '<p style="font-size:13px;color:#475569">The code works for 15 minutes. If you did not ask for it, ignore this email; your password stays the same.</p></div>',
      text: "Your Jessy James HHF password reset code is " + code + ". It works for 15 minutes.",
    });
    try { $app.newMailClient().send(msg); }
    catch (err) { console.log("jjhhf: reset code email failed for", u.id, String(err)); u.set("reset_until", ""); $app.save(u); throw new BadRequestError("We could not send the email right now. Please contact customer care on WhatsApp."); }
  }
  return e.json(200, { ok: true });
});

// 2) POST /api/jjhhf/password/reset { email, code, password, passwordConfirm } sets the new password (5 tries per code).
routerAdd("POST", "/api/jjhhf/password/reset", (e) => {
  const b = e.requestInfo().body || {}, email = String(b.email || "").trim(), code = String(b.code || "").replace(/\D/g, ""), pw = String(b.password || "");
  const bad = () => new BadRequestError("That code is not correct or has expired. Check the latest email, or ask for a new code.");
  let u; try { u = $app.findAuthRecordByEmail("users", email); } catch (_) { try { u = $app.findAuthRecordByEmail("users", email.toLowerCase()); } catch (_) { throw bad(); } }
  const until = Date.parse(String(u.getString("reset_until")));
  if (!u.getString("reset_code") || isNaN(until) || until < Date.now()) throw bad();
  if (u.getInt("reset_tries") >= 5) throw new BadRequestError("Too many wrong codes. Ask for a new code.");
  if ($security.sha256(u.id + ":" + code) !== u.getString("reset_code")) { u.set("reset_tries", u.getInt("reset_tries") + 1); $app.save(u); throw bad(); }
  if (pw.length < 8) throw new BadRequestError("The new password must be at least 8 characters.");
  if (pw !== String(b.passwordConfirm || "")) throw new BadRequestError("The new passwords do not match.");
  u.setPassword(pw);
  u.set("reset_code", ""); u.set("reset_until", ""); u.set("reset_tries", 0); u.set("must_change_password", false);
  $app.save(u);
  return e.json(200, { ok: true });
});
