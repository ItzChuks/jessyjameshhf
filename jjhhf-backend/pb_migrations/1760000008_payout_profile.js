/// <reference path="../pb_data/types.d.ts" />
// Payout details live on the member's profile (filled in and edited on the Profile page) instead of being typed with each payout request:
//   address, bank_name, bank_account_number (10-digit NUBAN), bank_account_name
// Members can edit their own; admins can read them (users view/list rules already allow admins).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  for (const name of ["address", "bank_name", "bank_account_number", "bank_account_name"]) if (!users.fields.getByName(name)) users.fields.add(new TextField({ name }));
  users.indexes = (users.indexes || []).filter(s => !/idx_users_bank_acct/.test(s)).concat(["CREATE INDEX idx_users_bank_acct ON users (bank_account_number)"]);
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  for (const name of ["address", "bank_name", "bank_account_number", "bank_account_name"]) users.fields.removeByName(name);
  users.indexes = (users.indexes || []).filter(s => !/idx_users_bank_acct/.test(s));
  app.save(users);
});
