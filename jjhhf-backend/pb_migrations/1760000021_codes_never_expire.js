/// <reference path="../pb_data/types.d.ts" />
// app_settings.codes_never_expire: the admin "Codes never expire" switch (Plan codes page). While it is on, a plan code that has
// not been used stays usable after its last day; switched off, every code goes back to its own dates.
migrate((app) => {
  const c = app.findCollectionByNameOrId("app_settings");
  if (!c.fields.getByName("codes_never_expire")) c.fields.add(new BoolField({ name: "codes_never_expire" }));
  if (!c.fields.getByName("codes_never_expire_at")) c.fields.add(new TextField({ name: "codes_never_expire_at" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("app_settings");
  c.fields.removeByName("codes_never_expire"); c.fields.removeByName("codes_never_expire_at");
  app.save(c);
});
