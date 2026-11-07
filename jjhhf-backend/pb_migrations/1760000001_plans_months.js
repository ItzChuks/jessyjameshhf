/// <reference path="../pb_data/types.d.ts" />
// Adds "months" to plans, so an admin can define a plan's saving period in months (1, 2, 3, ... any number).
migrate((app) => {
  const plans = app.findCollectionByNameOrId("plans");
  if (!plans.fields.getByName("months")) {
    plans.fields.add(new NumberField({ name: "months", min: 0 }));
    app.save(plans);
  }
}, (app) => {
  const plans = app.findCollectionByNameOrId("plans");
  plans.fields.removeByName("months");
  app.save(plans);
});
