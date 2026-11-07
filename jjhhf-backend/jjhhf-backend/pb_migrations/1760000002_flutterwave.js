/// <reference path="../pb_data/types.d.ts" />
// Flutterwave support: payments get a unique reference (tx_ref) and Flutterwave's transaction id (flw_id).
// Members can no longer create payments straight through the API; they are created by the server
// (/api/jjhhf/pay/init) and confirmed automatically once Flutterwave reports them paid.
migrate((app) => {
  const c = app.findCollectionByNameOrId("payments");
  if (!c.fields.getByName("tx_ref")) c.fields.add(new TextField({ name: "tx_ref" }));
  if (!c.fields.getByName("flw_id")) c.fields.add(new TextField({ name: "flw_id" }));
  c.addIndex("idx_payments_tx_ref", true, "tx_ref", "tx_ref != ''");
  c.createRule = null; // superusers only; the server creates payments itself
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("payments");
  c.removeIndex("idx_payments_tx_ref");
  c.fields.removeByName("tx_ref");
  c.fields.removeByName("flw_id");
  c.createRule = '@request.body.user = @request.auth.id && @request.body.status = "pending"';
  app.save(c);
});
