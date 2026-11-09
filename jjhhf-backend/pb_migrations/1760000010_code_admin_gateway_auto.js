/// <reference path="../pb_data/types.d.ts" />
// 1) Admin can mark a plan code as used or expired:  subscriptions.code_admin ("" | "used" | "expired") and code_admin_at.
//    Clearing code_admin ("Restore") puts the code back on its normal dates. A code actually used by a member stays used.
// 2) Payment providers are given out automatically: users.gateway_manual = true when an admin picked the provider by hand
//    (an automatic reshuffle leaves those members alone).
migrate((app) => {
  const subs = app.findCollectionByNameOrId("subscriptions");
  if (!subs.fields.getByName("code_admin")) subs.fields.add(new TextField({ name: "code_admin" }));
  if (!subs.fields.getByName("code_admin_at")) subs.fields.add(new DateField({ name: "code_admin_at" }));
  subs.indexes = (subs.indexes || []).filter(s => !/idx_subs_user_plan_status/.test(s)).concat(["CREATE INDEX idx_subs_user_plan_status ON subscriptions (user, plan, status)"]);
  app.save(subs);

  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("gateway_manual")) users.fields.add(new BoolField({ name: "gateway_manual" }));
  users.indexes = (users.indexes || []).filter(s => !/idx_users_gateway/.test(s)).concat(["CREATE INDEX idx_users_gateway ON users (gateway)"]);
  app.save(users);
}, (app) => {
  const subs = app.findCollectionByNameOrId("subscriptions");
  subs.fields.removeByName("code_admin"); subs.fields.removeByName("code_admin_at");
  subs.indexes = (subs.indexes || []).filter(s => !/idx_subs_user_plan_status/.test(s));
  app.save(subs);
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("gateway_manual");
  users.indexes = (users.indexes || []).filter(s => !/idx_users_gateway/.test(s));
  app.save(users);
});
