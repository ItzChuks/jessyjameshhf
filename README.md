# Jessy James Helping Hands Foundation – website

Plain HTML, CSS, JavaScript, Tailwind and PocketBase. Upload the folder to any static host. Tailwind is pre-built into `tailwind.css` (no CDN), so pages load fast even on cheap phones.

## Pages

- `index.html` homepage (plans load live from PocketBase)
- `auth.html` log in / sign up
- `dashboard.html` member area: wallet, browse/join plans, my contributions, transaction history with PDF invoices, fees, payouts, rules, profile
- `admin.html` admin area: overview, users (register, credit wallet, make admin), plans (add/edit/bulk delete), contributions, payments, wallet ledger, fees, payouts
- `terms.html` Terms and Conditions

## Setup (2 edits)

Open `app.js`, top of the file:

1. `PB_URL`: your PocketBase URL on Railway, e.g. `https://jjhhf-backend-production.up.railway.app` (no trailing slash).
2. `SUPPORT_PHONE`: the foundation's support/WhatsApp number.

## Changing colours or adding new styles

Colours are in `tailwind.config.js` (`brand` and `accent`). After changing them, or after adding Tailwind classes that are not used anywhere yet, rebuild the CSS (needs Node.js):

```
npx tailwindcss@3.4.17 -i ./src/input.css -o ./tailwind.css --minify
```

(`npm install` then `npm run build` does the same; `npm run watch` rebuilds as you edit.) `src/`, `package.json` and `tailwind.config.js` don't need to be uploaded, but keeping them there does no harm.

## Go live (replacing the old site)

1. Deploy the backend first (see `jjhhf-backend/README.md`) and set `PB_URL`.
2. Upload this folder to your host (Vercel, Netlify, cPanel `public_html`, etc.), replacing the old files.
3. Point `www.jessyjameshhf.com.ng` at it (same as the old site if you keep the same host).
4. Sign up, make yourself admin in the PocketBase panel, log in, add plans.

## Offline demo

Set `USE_MOCK = true` in `app.js` to try everything without a server (data stays in the browser).
Demo logins: `admin@jjhhf.test` / `admin12345`, `user@jjhhf.test` / `user12345`.
