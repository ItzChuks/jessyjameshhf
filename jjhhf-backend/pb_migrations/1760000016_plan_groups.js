/// <reference path="../pb_data/types.d.ts" />
// Plan groups: joining the same plan several times at once makes ONE group with ONE plan code.
//   subscriptions.group_id    shared by every membership joined together ("" for a single membership)
//   subscriptions.group_lead  the membership that holds the group's plan code and represents the group in lists
//   subscriptions.group_size  on the lead: how many memberships the group (and so its code) carries
//   payouts.group_id / group_lead / group_size  a group's payout requests, shown and handled as one
// Memberships joined before this change stay single (group_id "").
migrate((app) => {
  const subs = app.findCollectionByNameOrId("subscriptions");
  if (!subs.fields.getByName("group_id")) subs.fields.add(new TextField({ name: "group_id" }));
  if (!subs.fields.getByName("group_lead")) subs.fields.add(new BoolField({ name: "group_lead" }));
  if (!subs.fields.getByName("group_size")) subs.fields.add(new NumberField({ name: "group_size", min: 0 }));
  subs.indexes = (subs.indexes || []).filter(s => !/idx_subs_group/.test(s)).concat(["CREATE INDEX idx_subs_group ON subscriptions (group_id)"]);
  app.save(subs);
  const po = app.findCollectionByNameOrId("payouts");
  if (!po.fields.getByName("group_id")) po.fields.add(new TextField({ name: "group_id" }));
  if (!po.fields.getByName("group_lead")) po.fields.add(new BoolField({ name: "group_lead" }));
  if (!po.fields.getByName("group_size")) po.fields.add(new NumberField({ name: "group_size", min: 0 }));
  po.indexes = (po.indexes || []).filter(s => !/idx_po_group/.test(s)).concat(["CREATE INDEX idx_po_group ON payouts (group_id)"]);
  app.save(po);
}, (app) => {
  const subs = app.findCollectionByNameOrId("subscriptions");
  ["group_id", "group_lead", "group_size"].forEach(f => subs.fields.removeByName(f));
  subs.indexes = (subs.indexes || []).filter(s => !/idx_subs_group/.test(s)); app.save(subs);
  const po = app.findCollectionByNameOrId("payouts");
  ["group_id", "group_lead", "group_size"].forEach(f => po.fields.removeByName(f));
  po.indexes = (po.indexes || []).filter(s => !/idx_po_group/.test(s)); app.save(po);
});
