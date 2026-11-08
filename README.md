# Jessy James Helping Hands Foundation – website

Plain HTML, CSS, JavaScript, Tailwind and PocketBase. Upload the folder to any static host. Tailwind is pre-built into `tailwind.css` (no CDN), so pages load fast even on cheap phones.

## Pages

- `index.html` homepage (plans load live from PocketBase)
- `auth.html` log in / sign up
- `dashboard.html` member area: wallet (deposit with Flutterwave, ₦100 tax charge), browse/join plans (optional plan code), my contributions with plan codes, transaction history with PDF invoices, fees, payouts, rules, profile
- `admin.html` admin area: overview, users, plans (length in weeks + plan-code days), contributions, plan codes (usable / used / expired), payments, deposits, wallet ledger, fees, payouts
- `terms.html` Terms and Conditions

## Setup (2 edits)

Open `app.js`, top of the file:

1. `PB_URL`: your PocketBase URL on Railway, e.g. `https://jjhhf-backend-production.up.railway.app` (no trailing slash).
2. Contact details (already filled in from the flyer): `SUPPORT_PHONE` (also the WhatsApp button), `SUPPORT_PHONE_2`, `SUPPORT_EMAIL`, `OFFICE_ADDRESS`, `RC_NUMBER`, `TAGLINE`. Every page, the footer, the Terms and the PDF receipts read them from here.

The logo is `logo.png` (tab icons: `favicon.png`, `apple-touch-icon.png`). To change it, replace those files with a square image of the same name.

## Changing colours or adding new styles

Colours are in `tailwind.config.js` (`brand` and `accent`). After changing them, or after adding Tailwind classes that are not used anywhere yet, rebuild the CSS (needs Node.js):

```
npx tailwindcss@3.4.17 -i ./src/input.css -o ./tailwind.css --minify
```

`src/` and `tailwind.config.js` are only used for that rebuild. There is deliberately no `package.json`: Vercel would then try to "build" the site and fail looking for a `public` folder. `vercel.json` tells Vercel to publish the files as they are.

## Go live on Vercel

Push these files (the folder's contents, not a folder) to the root of the GitHub repo connected to Vercel. `vercel.json` makes Vercel publish them as they are, with no build step. If the project's Settings > Build and Deployment has a Build Command, Output Directory or Framework set, clear them (or set Framework to "Other").

## Go live (replacing the old site)

1. Deploy the backend first (see `jjhhf-backend/README.md`) and set `PB_URL`.
2. Upload this folder to your host (Vercel, Netlify, cPanel `public_html`, etc.), replacing the old files.
3. Point `www.jessyjameshhf.com.ng` at it (same as the old site if you keep the same host).
4. Sign up, make yourself admin in the PocketBase panel, log in, add plans.

## Offline demo

Set `USE_MOCK = true` in `app.js` to try everything without a server (data stays in the browser).
Demo logins: `admin@jjhhf.test` / `admin12345`, `user@jjhhf.test` / `user12345`.
