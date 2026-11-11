/// <reference path="../pb_data/types.d.ts" />
// Sends every PocketBase email (password reset, test emails, ...) through Brevo's HTTPS API instead of SMTP.
// Railway's Hobby plan blocks outbound SMTP (ports 25/465/587), so SMTP times out there.
// Railway variables:
//   BREVO_API_KEY  your Brevo API key (Brevo > SMTP & API > API keys). Without it, PocketBase's normal mail settings are used.
//   MAIL_FROM      optional sender address (must be a verified sender in Brevo); default: the sender in PocketBase Mail settings
//   MAIL_FROM_NAME optional sender name; default: the sender name in PocketBase Mail settings
onMailerSend((e) => {
  const key = $os.getenv("BREVO_API_KEY");
  if (!key) return e.next();                                     // not set up: PocketBase sends as usual
  const m = e.message, meta = $app.settings().meta;
  const addr = a => ({ email: String(a.address || ""), name: String(a.name || "") || undefined });
  const to = (m.to || []).map(addr).filter(a => a.email);
  if (!to.length) return;                                        // nobody to send to
  const body = {
    sender: { email: $os.getenv("MAIL_FROM") || String((m.from && m.from.address) || meta.senderAddress), name: $os.getenv("MAIL_FROM_NAME") || String((m.from && m.from.name) || meta.senderName || "Jessy James HHF") },
    to, subject: String(m.subject || ""),
    htmlContent: String(m.html || "") || undefined, textContent: String(m.text || "") || undefined,
  };
  if ((m.cc || []).length) body.cc = m.cc.map(addr);
  if ((m.bcc || []).length) body.bcc = m.bcc.map(addr);
  const res = $http.send({
    url: $os.getenv("BREVO_API_URL") || "https://api.brevo.com/v3/smtp/email",
    method: "POST", timeout: 20,
    headers: { "api-key": key, "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const why = (res.json && (res.json.message || res.json.code)) || ("HTTP " + res.statusCode);
    $app.logger().error("Brevo email failed", "status", res.statusCode, "message", String(why), "to", to.map(a => a.email).join(","));
    throw new Error("Email could not be sent (Brevo: " + why + ").");
  }
  // sent by Brevo; do not call e.next(), so PocketBase does not also try SMTP
});
