/// <reference path="../pb_data/types.d.ts" />
// Forgotten password: the website asks PocketBase to email a reset link (POST /api/collections/users/request-password-reset).
// PocketBase's own email links to its admin dashboard, so we replace it with a branded email that links to the website:
//   {SITE_URL}/auth.html?reset=<token>   (the page then asks for the new password and confirms it).
// Railway variables: SITE_URL (e.g. https://jessyjameshhf.com.ng, no trailing slash). Mail is sent with the SMTP
// settings in the PocketBase dashboard (Settings > Mail settings); without SMTP no email can be sent.
onMailerRecordPasswordResetSend((e) => {
  const site = ($os.getenv("SITE_URL") || "https://jessyjameshhf.com.ng").replace(/\/+$/, "");
  const token = String((e.meta && e.meta.token) || "");
  if (!token) return e.next();                       // unexpected: keep PocketBase's default email
  const link = site + "/auth.html?reset=" + encodeURIComponent(token);
  const name = String(e.record.getString("name") || "").split(" ")[0] || "there";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  e.message.subject = "Reset your Jessy James HHF password";
  e.message.html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">' +
    '<h2 style="color:#065f46;margin:0 0 12px">Reset your password</h2>' +
    '<p>Hello ' + esc(name) + ',</p>' +
    '<p>We received a request to reset the password for your Jessy James Helping Hands Foundation account. Click the button below to choose a new password.</p>' +
    '<p style="margin:24px 0"><a href="' + esc(link) + '" style="background:#065f46;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:bold">Choose a new password</a></p>' +
    '<p style="font-size:13px;color:#475569">Or copy this link into your browser:<br><a href="' + esc(link) + '" style="color:#065f46;word-break:break-all">' + esc(link) + '</a></p>' +
    '<p style="font-size:13px;color:#475569">The link works once and expires in 30 minutes. If you did not ask for this, ignore this email; your password stays the same.</p>' +
    '<p style="font-size:13px;color:#475569">Jessy James Helping Hands Foundation</p></div>';
  e.message.text = "Hello " + name + ",\n\nReset your Jessy James HHF password here (works once, expires in 30 minutes):\n" + link + "\n\nIf you did not ask for this, ignore this email.";
  return e.next();
}, "users");
