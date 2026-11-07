# JJHHF backend (PocketBase on Railway)

PocketBase for Jessy James Helping Hands Foundation. Tested with PocketBase **v0.40.5** (pinned in `Dockerfile`).

## Deploy on Railway

1. Push this folder to a new GitHub repo (e.g. `jjhhf-backend`).
2. Railway > New Project > Deploy from GitHub repo > pick it. Railway builds the `Dockerfile`.
3. **Add a Volume** to the service, mount path `/pb/pb_data` (otherwise the database is wiped on every redeploy).
4. Settings > Networking > **Generate Domain**. Copy the URL (e.g. `https://jjhhf-backend-production.up.railway.app`).
5. Open `https://<your-domain>/_/` and create the superuser (Railway logs show a one-time setup link on first start).
6. Variables (for wallets / virtual accounts):
   - `FLW_SECRET_KEY`: Flutterwave > Settings > API keys (use the test key first)
   - `FLW_WEBHOOK_HASH`: any long random string; put the same value in Flutterwave > Settings > Webhooks as the **Secret hash**
   - Flutterwave webhook URL: `https://<your-domain>/api/jjhhf/flw-webhook`, with "Receive webhook for successful charges" on.
7. Settings > Application (in the PocketBase panel): set the app name and URL; optionally restrict allowed origins to your website domain.

Migrations run automatically on start and create every collection and rule.

## First admin

Sign up on the website, then in the PocketBase panel open **users**, edit yourself and set `role` to `admin`. Log in again: you land on the admin page. Then Admin > Overview > **Add default plans** (or add your own under Plans).

## What is in here

- `pb_migrations/`: users fields, plans, subscriptions, payments, payouts, fees, wallet ledger (`wallet_txs`); `1760000005_public_plans.js` lets the public homepage list open plans.
- `pb_hooks/main.pb.js`: sign-up rules (terms required, always `role = user`), wallet fields locked, plan joining and payout guards.
- `pb_hooks/wallet.js`, `wallet.pb.js`: wallet ledger, top-ups, automatic collection, joining a plan. Routes:
  - `POST /api/jjhhf/wallet/account` member's fixed account number (BVN/NIN sent to Flutterwave, never stored)
  - `POST /api/jjhhf/flw-webhook` transfer received (signature + Flutterwave verification, credited once)
  - `POST /api/jjhhf/wallet/credit` admin manual credit (unique bank reference)
  - `POST /api/jjhhf/fee/pay` joining fee + catch-up, t-shirt fee, payout clearance fee
  - cron `jjhhf_wallet_collect` every 5 minutes
- `pb_hooks/rules.js`: deadlines, penalties, seasons. `pb_hooks/fees.js`: fee and payout rules.

**Keep in sync with the website's `app.js`:** `RULES`/season (`rules.js`) and `FEES` (`wallet.js`). The server values are the ones charged.

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

- Deadlines in Lagos time: daily before 12:00 noon, weekly Friday 12:00 noon, monthly the 2nd of the next month. Late = double; the penalty never counts as savings.
- Cash and Foodie plans run 1 January to 30 November; joining mid-season collects the contributions already due (no penalty). Grocery plans run from the day of joining.
- Fees: joining ₦3,000 per plan, t-shirt ₦5,000 once (only needed for payouts), clearance ₦3,000 per payout request. All from the wallet.
- Payout: plan fully paid, saving period ended, another plan actively running, t-shirt fee paid.
