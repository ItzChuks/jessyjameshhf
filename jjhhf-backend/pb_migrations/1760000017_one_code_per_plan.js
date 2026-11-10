/// <reference path="../pb_data/types.d.ts" />
// Back to one plan code per plan: memberships in a group that were created without a code of their own get one now, with the same
// opening and expiry as their group's code (or none if the group has no code). A code always joins exactly one plan again.
migrate((app) => {
  const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const fresh = () => {
    for (let i = 0; i < 30; i++) {
      const c = "JJ-" + $security.randomStringWithAlphabet(4, ABC) + "-" + $security.randomStringWithAlphabet(4, ABC);
      try { app.findFirstRecordByData("subscriptions", "code", c); } catch (_) { return c; }
    }
    throw new Error("Could not create a unique code.");
  };
  const leads = {};
  app.findRecordsByFilter("subscriptions", "group_id != '' && group_lead = true && code != ''", "", 0, 0).forEach(l => { leads[l.getString("group_id")] = l; });
  app.findRecordsByFilter("subscriptions", "group_id != '' && code = ''", "created", 0, 0).forEach(m => {
    const l = leads[m.getString("group_id")];
    if (!l) return;
    m.set("code", fresh()); m.set("code_from", l.getString("code_from")); m.set("code_until", l.getString("code_until"));
    app.saveNoValidate(m);
  });
}, (app) => { });
