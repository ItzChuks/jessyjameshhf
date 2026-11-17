/// <reference path="../pb_data/types.d.ts" />
// Forgotten password by email code: a 6-digit code is emailed to the member; these hidden fields hold its hash, expiry and tries.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("reset_code")) users.fields.add(new TextField({ name: "reset_code", hidden: true }));
  if (!users.fields.getByName("reset_until")) users.fields.add(new TextField({ name: "reset_until", hidden: true }));
  if (!users.fields.getByName("reset_tries")) users.fields.add(new NumberField({ name: "reset_tries", hidden: true }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  ["reset_code", "reset_until", "reset_tries"].forEach(f => users.fields.removeByName(f));
  app.save(users);
});
