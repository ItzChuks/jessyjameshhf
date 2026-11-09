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

## Rules summary

- **Plans:** Grocery only, 4, 8, 12 or 25 weeks (admin can type any length), daily or weekly contributions, running from the day of joining. (Migration `1760000007` hides any old Cash/Foodie plans; existing memberships keep working.)
- **Plan codes:** every membership gets a code (`JJ-XXXX-XXXX`). It is usable from day `code_from_day` to the end of day `code_until_day` after joining (set per plan; day 1 = joining day). Any member can enter it, once, when joining a plan; it is then marked used (who and when). Unused codes become expired.
- **Deposits:** through the member's provider (Flutterwave, Paystack or Monnify, shuffled per member), no BVN/NIN. ₦100 tax charge per deposit, added at checkout.
- **Schedule** (Lagos time): the first payment is taken on the joining day together with the joining fee; then every 7 days from that day (weekly) or every day (daily). Each payment is taken from midnight on its due day and must be paid **before 12:00 noon**; still unpaid at noon, it costs double. The penalty never counts as savings.
- **Payout date:** `plans.payout_after_days` (e.g. 30 for a 4-week plan; migration `1760000009` sets weeks × 7.5 on existing plans).
- **Fees** from the wallet: joining ₦3,000 per plan, t-shirt ₦5,000 once (only needed for payouts), clearance ₦3,000 per payout request.
- **Payout:** plan fully paid, its length ended, **another plan active and running for at least 2 weeks**, t-shirt fee paid, and **payout details saved on the Profile** (account name, bank, 10-digit account number, address; migration `1760000008`). The request stores a copy of those details; the admin sees them on Payouts and on the member page.

**Keep in sync with the website's `app.js`:** `RULES` (`rules.js`), `FEES` (`wallet.js`), the tax charge (`deposits.js` `TAX`) and the 2-week payout rule (`rules.js` `PAYOUT_MIN_RUNNING_DAYS`).
