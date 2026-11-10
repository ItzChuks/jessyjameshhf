/// <reference path="../pb_data/types.d.ts" />
// wallet_txs.kind + "deduction": money taken out of a member's wallet by an admin (Admin > Users > member > Deduct).
migrate((app) => {
  const wt = app.findCollectionByNameOrId("wallet_txs");
  const k = wt.fields.getByName("kind");
  if (!k.values.includes("deduction")) { k.values = [...k.values, "deduction"]; app.save(wt); }
}, (app) => { });
