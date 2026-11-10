/// <reference path="../pb_data/types.d.ts" />
// Credit first, check after: receipts credit the wallet as soon as they are uploaded; the admin confirms or reverses them.
//   deposits.ai_state  "" | "queued" | "done" | "failed"  background reading of the receipt (flags for the admin only)
//   app_settings: no automatic limit by default any more (auto_max = 0), crediting on upload turned on
//   receipts still waiting in the old reading queue are moved to the new one
migrate((app) => {
  const dep = app.findCollectionByNameOrId("deposits");
  if (!dep.fields.getByName("ai_state")) dep.fields.add(new TextField({ name: "ai_state" }));
  dep.indexes = (dep.indexes || []).filter(s => !/idx_dep_ai_state/.test(s)).concat(["CREATE INDEX idx_dep_ai_state ON deposits (ai_state)"]);
  app.save(dep);
  try {
    const s = app.findFirstRecordByFilter("app_settings", "id != ''");
    s.set("auto_max", 0); s.set("auto_approve", true); app.save(s);
  } catch (_) { }
  app.findRecordsByFilter("deposits", "verified = 'queued'", "", 0, 0).forEach(d => { d.set("verified", ""); d.set("ai_state", "queued"); app.saveNoValidate(d); });
}, (app) => {
  const dep = app.findCollectionByNameOrId("deposits");
  dep.fields.removeByName("ai_state");
  dep.indexes = (dep.indexes || []).filter(s => !/idx_dep_ai_state/.test(s));
  app.save(dep);
});
