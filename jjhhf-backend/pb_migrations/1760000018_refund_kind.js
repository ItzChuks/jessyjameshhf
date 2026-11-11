/// <reference path="../pb_data/types.d.ts" />
// wallet_txs.kind + "refund": money given back when an admin deletes a plan (or a member's plan) and ticks "Refund".
migrate((app) => {
  const wt = app.findCollectionByNameOrId("wallet_txs");
  const k = wt.fields.getByName("kind");
  if (!k.values.includes("refund")) { k.values = [...k.values, "refund"]; app.save(wt); }
}, (app) => { });
