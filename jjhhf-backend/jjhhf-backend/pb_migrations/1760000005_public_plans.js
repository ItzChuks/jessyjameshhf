/// <reference path="../pb_data/types.d.ts" />
// Lets the public landing page list plans that are open for enrolment (active = true) without logging in.
// Signed-in users (members and admins) still see every plan, hidden ones included, exactly as before.
migrate((app) => {
  const plans = app.findCollectionByNameOrId("plans");
  plans.listRule = 'active = true || @request.auth.id != ""';
  plans.viewRule = 'active = true || @request.auth.id != ""';
  app.save(plans);
}, (app) => {
  const plans = app.findCollectionByNameOrId("plans");
  plans.listRule = '@request.auth.id != ""';
  plans.viewRule = '@request.auth.id != ""';
  app.save(plans);
});
