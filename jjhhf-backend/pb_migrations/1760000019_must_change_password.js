/// <reference path="../pb_data/types.d.ts" />
// users.must_change_password: set when an admin gives a member a temporary password; the member must choose their own
// password at their next sign-in (POST /api/jjhhf/me/password clears it).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("must_change_password")) users.fields.add(new BoolField({ name: "must_change_password" }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("must_change_password");
  app.save(users);
});
