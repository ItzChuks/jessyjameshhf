/// <reference path="../pb_data/types.d.ts" />
// The payout clearance fee (₦3,500) is paid once per plan joined, before that plan's payout can be requested.
// subscriptions.clearance_paid_at = when it was paid for that membership (empty = not paid). Set by the server only (fees.js).
// Existing memberships that already paid it are filled in from the fees records.
migrate((app) => {
  const subs = app.findCollectionByNameOrId("subscriptions");
  if (!subs.fields.getByName("clearance_paid_at")) subs.fields.add(new DateField({ name: "clearance_paid_at" }));
  app.save(subs);
  app.findRecordsByFilter("fees", "type = 'clearance' && status = 'confirmed' && subscription != ''", "created", 0, 0).forEach(f => {
    try {
      const s = app.findRecordById("subscriptions", f.getString("subscription"));
      if (!s.getString("clearance_paid_at")) { s.set("clearance_paid_at", f.getString("created")); app.saveNoValidate(s); }
    } catch (_) { }
  });
}, (app) => {
  const subs = app.findCollectionByNameOrId("subscriptions");
  subs.fields.removeByName("clearance_paid_at");
  app.save(subs);
});
