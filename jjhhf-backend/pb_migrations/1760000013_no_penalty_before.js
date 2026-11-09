/// <reference path="../pb_data/types.d.ts" />
// subscriptions.no_penalty_before: payments whose deadline is on or before this moment are collected WITHOUT the late penalty.
// Set when an admin adds a plan from manual records and chooses not to charge penalties on payments that were already overdue.
migrate((app) => {
  const subs = app.findCollectionByNameOrId("subscriptions");
  if (!subs.fields.getByName("no_penalty_before")) subs.fields.add(new DateField({ name: "no_penalty_before" }));
  app.save(subs);
}, (app) => {
  const subs = app.findCollectionByNameOrId("subscriptions");
  subs.fields.removeByName("no_penalty_before");
  app.save(subs);
});
