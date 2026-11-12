# JJHHF backend (PocketBase on Railway)

PocketBase for Jessy James Helping Hands Foundation. Tested with PocketBase **v0.40.5** (pinned in `Dockerfile`).

## Deploy on Railway

1. Push this folder to a new GitHub repo (e.g. `jjhhf-backend`).
2. Railway > New Project > Deploy from GitHub repo > pick it. Railway builds the `Dockerfile`.
3. **Add a Volume** to the service, mount path `/pb/pb_data` (otherwise the database is wiped on every redeploy).
4. Settings > Networking > **Generate Domain**. Copy the URL (e.g. `https://jjhhf-backend-production.up.railway.app`).
5. Open `https://<your-domain>/_/` and create the superuser (Railway logs show a one-time setup link on first start).
6. Variables for payments (Railway > Variables). Set the providers you want to use; each member is given one of the configured ones at random on their first deposit and keeps it (an admin can switch a member in Admin > Users > member > Payment partner). Use test keys first.
   - **Flutterwave:** `FLW_SECRET_KEY`, `FLW_WEBHOOK_HASH` (any long random string, also entered as the Secret hash in Flutterwave > Settings > Webhooks). Webhook URL: `https://<your-domain>/api/jjhhf/flw-webhook`
   - **Paystack:** `PAYSTACK_SECRET_KEY` (sk_test_… / sk_live_…). Webhook URL (Paystack > Settings > API Keys & Webhooks): `https://<your-domain>/api/jjhhf/paystack-webhook`
   - **Monnify:** `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE`, and `MONNIFY_BASE_URL` = `https://sandbox.monnify.com` while testing (leave it out for live, which uses `https://api.monnify.com`). Webhook URL (Monnify > Developer > Webhook URLs, transaction completion): `https://<your-domain>/api/jjhhf/monnify-webhook`
   - Optional `GATEWAYS`, e.g. `paystack,monnify`, to use only some of the configured providers.
   Members are credited when they return from the payment page; the webhooks cover anyone who closes the page early, and pending deposits are re-checked every 10 minutes.
7. Settings > Application (in the PocketBase panel): set the app name and URL; optionally restrict allowed origins to your website domain.

Migrations run automatically on start and create every collection and rule.

## First admin

Sign up on the website, then in the PocketBase panel open **users**, edit yourself and set `role` to `admin`. Log in again: you land on the admin page. Then Admin > Overview > **Add default plans** (or add your own under Plans).

## What is in here

- `pb_migrations/`: users fields, plans, subscriptions, payments, payouts, fees, wallet ledger (`wallet_txs`); `1760000005_public_plans.js` lets the public homepage list open plans.
- `pb_hooks/main.pb.js`: sign-up rules (terms required, always `role = user`), wallet fields locked, plan joining and payout guards.
- `pb_hooks/gateways.js`: Flutterwave, Paystack and Monnify checkout + verification, and the random per-member assignment.
- `pb_hooks/deposits.js`: deposits through the member's provider. The member pays amount + **₦100 tax charge**; the wallet gets the amount, the ₦100 is recorded as a `tax` fee. Each deposit is credited exactly once.
- `pb_hooks/wallet.js`, `wallet.pb.js`: wallet ledger, automatic collection, joining a plan, plan codes. Routes:
  - `POST /api/jjhhf/wallet/deposit` start a deposit, returns the Flutterwave Checkout link
  - `POST /api/jjhhf/wallet/verify` settle a deposit when the member returns (the server asks Flutterwave itself)
  - `POST /api/jjhhf/flw-webhook`, `/paystack-webhook`, `/monnify-webhook` payment completed (signature checked, then verified with the provider)
  - `POST /api/jjhhf/wallet/credit` admin manual credit (unique reference)
  - `POST /api/jjhhf/fee/pay` joining fee (with optional plan code), t-shirt fee, payout clearance fee
  - `POST /api/jjhhf/code/check` is this plan code valid / used / expired / not open yet
  - `GET /api/jjhhf/admin/stats` admin totals
  - cron `jjhhf_wallet_collect` every minute, cron `jjhhf_deposit_check` every 10 minutes (re-checks pending deposits)
- `pb_hooks/password.pb.js`: forgotten password. "Forgot password?" on the log-in page asks PocketBase to email a reset link;
  this hook replaces PocketBase's email with a branded one linking to `{SITE_URL}/auth.html?reset=<token>` (works once, 30 minutes).
  Needs: Railway variable `SITE_URL` (e.g. `https://jessyjameshhf.com.ng`).
- `pb_hooks/mail.pb.js`: sends all emails through Brevo's HTTPS API, because Railway's Hobby plan blocks outbound SMTP.
  Railway variable `BREVO_API_KEY` (optional `MAIL_FROM`, `MAIL_FROM_NAME`). The sender address must be a verified sender in Brevo.
  Without the key, PocketBase's own Mail settings (SMTP) are used.
- `pb_hooks/rules.js`: deadlines, penalties, plan-code windows, payout rule. `pb_hooks/fees.js`: fee and payout checks.


## Built for scale

- **Indexes** on every frequently searched field (migration `1760000006_scale.js`).
- **Stored progress:** each subscription keeps `paid_count` and `next_collect`, so the collector never re-reads payment history. They are updated automatically; if an admin confirms, rejects or deletes a payment, the plan is re-worked out.
- **Collector:** runs every minute, visits only members with a plan due, oldest first, within a 50-second budget (tested: about 1,500 members per second), and never overlaps itself. A plan waiting for a top-up is re-checked every 6 hours, and at once when the member tops up.
- **Admin totals** come from `GET /api/jjhhf/admin/stats` (worked out by the database), and admin lists load 50 records per page.

### Railway sizing

- Keep **1 replica**. PocketBase uses one database file, and two copies would corrupt it. Scale **up** (more CPU/RAM), not out.
- Starting point: 1 vCPU / 1 GB RAM covers a few hundred people online. For thousands online at once, raise the limits to about 4–8 vCPU / 4–8 GB (Railway Pro allows more). Logins and sign-ups use the most CPU (password hashing), and each open dashboard holds one live connection.
- Put the Volume in the same region as the service. Watch CPU and RAM in Railway's Metrics tab and raise the limits before they reach about 70%.

## Deposits by bank transfer (current): credit first, check after

Online payment partners (Flutterwave, Paystack, Monnify) are **paused**. Members transfer to the foundation account and upload the receipt.

1. Admin > Receipts > **Account and settings**: bank name, 10-digit account number, account name.
2. When a member uploads a receipt, the wallet is **credited at once** ("Account credited. Payment confirmation under review.").
   Always, even for a receipt file uploaded before (flagged in red for you). Receipts wait for you only if you set a
   "largest amount credited at once" (default 0 = no limit) or turn off "Credit the wallet as soon as a receipt is uploaded".
3. Admin > Receipts > **Under review**: compare each receipt with the bank statement, then **Approve** (the money stays in the wallet)
   or **Reject** (the money is withdrawn from the wallet; it may go below zero if it was already spent, and plans wait until the
   member tops up). The member sees "Credited · under review", then "Approved" or "Rejected · money withdrawn".
4. Optional ✓/✗ flags: add ONE AI key in Railway > Variables and each receipt is read in the background (amount, our account
   number, date, reference not reused, not edited). Flags only; never delays or blocks the credit.
   - `GEMINI_API_KEY` Google Gemini, from aistudio.google.com (free tier; free-tier data may be used by Google)
   - `XAI_API_KEY` Grok · `OPENAI_API_KEY` OpenAI (JPG/PNG only) · `ANTHROPIC_API_KEY` Anthropic Claude
   `RECEIPT_AI=gemini|xai|openai|anthropic` picks one if several are set; `RECEIPT_AI_MODEL` overrides the model.

To bring the online partners back later, set `ONLINE_PAYMENTS=on` (their code is still in gateways.js / deposits.js).

## Plan groups
Joining the same plan several times at once (or one "Add existing plans" row with How many times > 1) makes ONE group, shown as
one card (`subscriptions.group_id`, `group_lead`, `group_size`). Every plan in it has its own plan code and its own payments; a code
always joins one plan. Payout, Edit, Complete and Cancel act on the whole group; a group payout charges the clearance fee once per
plan and its payout requests are shown and marked paid together.

## Admin tools added
- **Add existing plans** (member page): for members who were saving manually. One row per plan (add as many rows as needed; pick the day it started from a calendar; and
  "How many times" for the same plan held several times): how long it has been running and the amount already paid. All rows are
  saved together or not at all; "Take the amount already paid from the wallet" (ticked by default) deducts what was paid,
  "Take the joining fee" deducts ₦3,000 per plan (all or nothing; untick to only record money received outside the website); "Give each plan a plan code" lets you choose the day the codes open and the day they expire
  (otherwise the plan's usual code days, counted from the backdated start, would make them expired already); no joining fee is taken and the plan carries on automatically. Payments already due and unpaid are
  collected from the wallet straight away (late ones with the usual penalty), as the preview warns.
  "Joined with plan codes" (per row, optional): paste several codes, or tick them from "Pick from this member's usable codes"
  (with Select all), e.g. the open codes of plans added earlier. Each code covers one plan in the row and is marked as used by
  this member; How many times goes up to match. Codes are checked as you type; a code used twice, already used, expired or not
  open yet is refused (`items[].use_codes` = array or text separated by spaces/commas).
- **Edit** (member page, Plans table, running plans): change how long the plan has been running, the amount paid (not below
  what was paid through the website wallet), whether payments overdue now carry the late penalty, and the note.
- **Suspend / Restore account** (member page): a suspended member cannot sign in or use the site and sees the reason.
  Their plans keep running.
- **Edit plan** (member page, any status): plan (switch to another plan; with website payments only to one with the same
  contribution), start date, amount paid, late penalty, status (running / completed / cancelled), plan code dates (a first day in
  the past = already open; a plan without a code can be given one), clearance fee paid (marks only, no money moves) and note.
  Changing the start date no longer moves the plan code's dates. Route: `POST /api/jjhhf/admin/edit-plan`.
- **Plans joined with a plan code**: wherever "used by" shows (Plan codes page, code page, member page, the member's own
  dashboard), the joined plan's status and payments so far are shown too (`GET /api/jjhhf/code/referred?ids=`; members only
  see plans joined with their own codes).
- **Copy several plan codes**: members get "Copy all my usable codes" on My contributions, plus tick boxes, Copy selected and
  Copy all on each group card; admins get "Copy usable codes" on a member's page and tick boxes, Copy selected and
  "Copy all … in this list" (all pages, follows the filter and search) on Plan codes. Codes are copied one per line.
- **Joining with pasted codes**: the member's Join window takes several codes pasted at once (one per line, or separated by
  spaces/commas; a Paste button reads the clipboard). Each is checked live; each valid code joins one plan and raises
  "How many times" to match. Codes go to `fee/pay` as `codes: [...]`.
- **Reopen a plan code** (Plan codes page, code page, member page): a used or expired code (also one marked used/expired by
  admin) becomes usable again from now until the chosen last day, once more. If a member used it, their plan keeps running.
  Route: `POST /api/jjhhf/admin/code-status` with `status: "reopen", until: "YYYY-MM-DD"`.
  Several at once: tick codes on Plan codes and click "Reopen selected", or "Reopen all used/expired codes in this list"
  (all pages, follows the search); the route takes `subscriptions: [ids]` instead of `subscription`.
- **Live updates**: pages update themselves only when nobody is using them; otherwise a "New updates" button appears.
- **Delete plan** (Plans page: Delete on a row, in the plan panel, or tick several; member page: Delete on a plan card):
  erases the plan(s) and everything linked: member plans (a group card goes as a whole; deleting a plan type removes every
  member's membership of it and then the plan), payments, payout requests, fees and wallet history. The window shows the counts
  first and needs DELETE typed. "Refund" (optional, chosen each time) credits back what those plans took from each wallet,
  minus what came back; plans already paid out are not refunded. Route: `POST /api/jjhhf/admin/delete-plan`
  (migration `1760000018` adds the wallet entry type "refund").
- **Reset account** (suspended members only): clears plans and plan codes, payments, payouts, fees, wallet history, deposits and
  receipt files, sets the wallet to ₦0; keeps name, email, phone, country, address and payout details (optionally also clears the
  t-shirt registration). The account stays suspended until restored. Type RESET to confirm.
- **Delete permanently** (suspended members only): wipes the account, profile and bank details, plans and plan codes, payments,
  payouts, fees, wallet history, deposits and receipt files from the database. Type DELETE to confirm; cannot be undone.

## Rules summary

- **Plans:** Grocery only, 4, 8, 12 or 25 weeks (admin can type any length), daily or weekly contributions, running from the day of joining. (Migration `1760000007` hides any old Cash/Foodie plans; existing memberships keep working.)
- **Plan codes:** every membership gets a code (`JJ-XXXX-XXXX`). It is usable from day `code_from_day` to the end of day `code_until_day` after joining (set per plan; day 1 = joining day). Any member can enter it, once, when joining a plan; it is then marked used (who and when). Unused codes become expired.
- **Deposits:** through the member's provider (Flutterwave, Paystack or Monnify, shuffled per member), no BVN/NIN. ₦100 tax charge per deposit, added at checkout.
- **Schedule** (Lagos time): the first payment is taken on the joining day together with the joining fee; then every 7 days from that day (weekly) or every day (daily). Each payment is taken from midnight on its due day and must be paid **before 12:00 noon**; still unpaid at noon, it costs double. The penalty never counts as savings.
- **Payout date:** `plans.payout_after_days` (e.g. 30 for a 4-week plan; migration `1760000009` sets weeks × 7.5 on existing plans).
- **Fees** from the wallet: joining ₦3,000 per plan, t-shirt ₦5,000 once (only needed for payouts), clearance ₦3,500 once per plan, before its payout request.
- **Payout:** plan fully paid, its length ended, **another plan active and running for at least 2 weeks**, t-shirt fee paid, and **payout details saved on the Profile** (account name, bank, 10-digit account number, address; migration `1760000008`). The request stores a copy of those details; the admin sees them on Payouts and on the member page.

**Keep in sync with the website's `app.js`:** `RULES` (`rules.js`), `FEES` (`wallet.js`), the tax charge (`deposits.js` `TAX`) and the 2-week payout rule (`rules.js` `PAYOUT_MIN_RUNNING_DAYS`).
