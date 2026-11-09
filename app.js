// ===== CONFIG (edit these) =====
const PB_URL = 'https://YOUR-POCKETBASE-SERVICE.up.railway.app';   // your PocketBase on Railway (no trailing slash)
const USE_MOCK = false; // false = real PocketBase (default). true = offline demo using localStorage + mock.js.
const BRAND = 'Jessy James Helping Hands Foundation';   // full name (invoices, terms, page titles)
const BRAND_SHORT = 'JJHHF';                            // short name (sidebar, small screens)
const SUPPORT_PHONE = '09055556235';                    // customer care line 1 (also the WhatsApp button)
const SUPPORT_PHONE_2 = '08110900549';                  // customer care line 2
const SUPPORT_EMAIL = 'jessyjameshhf@gmail.com';
const OFFICE_ADDRESS = 'Omo-Oye Bus Stop, Abaranje Road, Ikotun, Lagos';
const RC_NUMBER = '9770763';                            // CAC registration number
const TAGLINE = 'Empowering Lives, Feeding Hope';
// Fees (naira). Display only: the amounts that are actually charged are set on the server (pb_hooks/wallet.js, keep them in sync).
const FEES = { shirt: 5000, join: 3000, clearance: 3000, tax: 100 };   // tax = added to every deposit (pb_hooks/deposits.js)
// ===== end config =====

const pb = USE_MOCK ? createMockPB() : new PocketBase(PB_URL);
pb.autoCancellation?.(false);   // the pages fire several identical requests in parallel; don't let the SDK cancel them
const SUPPORT_WHATSAPP = '234' + SUPPORT_PHONE.slice(1);  // same number in international form for WhatsApp

// ===== helpers =====
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const naira = n => '₦' + Number(n || 0).toLocaleString();
const date = d => d ? new Date(d.replace(' ', 'T')).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const inp = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-700 focus:ring-1 focus:ring-emerald-700';
const btn = 'inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg bg-emerald-800 text-white hover:bg-emerald-900 transition';
const btn2 = 'inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition';
const refresh = () => dispatchEvent(new Event('hashchange'));
const FEE_LABEL = { shirt: 'T-shirt registration', join: 'Joining fee', clearance: 'Payout clearance fee', tax: 'Tax charge (deposit)' };
const FQ = { daily: 'day', weekly: 'week', monthly: 'month' };
// A plan's saving period is set in months; the number of payments follows from the frequency (daily ~30.4/month, weekly ~4.35/month, monthly 1/month)
const paymentsFor = (months, f) => f === 'daily' ? Math.round(months * 365 / 12) : f === 'weekly' ? Math.round(months * 52.14 / 12) : months;
const monthsOf = p => p.months > 0 ? p.months : Math.max(1, Math.round(p.duration * (p.frequency === 'daily' ? 12 / 365 : p.frequency === 'weekly' ? 12 / 52.14 : 1)));
// Grocery plans run for a number of weeks (4, 8, 12, 25...). Older plans without "weeks" are estimated from their payments.
const weeksOf = p => p.weeks > 0 ? p.weeks : Math.max(1, Math.round(p.frequency === 'daily' ? p.duration / 7 : p.frequency === 'weekly' ? p.duration : p.duration * 4.345));
const PLAN_WEEKS = [4, 8, 12, 25];
const monthsLabel = p => { if (isSeasonal(p)) return 'Jan 1 – Nov 30'; const w = weeksOf(p); return w + ' week' + (w === 1 ? '' : 's'); };
const codeDays = p => p.code_from_day > 0 && p.code_until_day >= p.code_from_day ? `day ${p.code_from_day} to day ${p.code_until_day}` : '';
const ic = d => `<svg class="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const WA_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z';
const waIcon = (cls = 'w-[18px] h-[18px]') => `<svg class="${cls} shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${WA_PATH}"/></svg>`;
const waLink = () => {
  const u = pb.authStore.record;
  const t = "Hello " + BRAND + " support, I need some help." + (u ? '\nName: ' + (u.name || '') + '\nEmail: ' + (u.email || '') : '');
  return 'https://wa.me/' + SUPPORT_WHATSAPP + '?text=' + encodeURIComponent(t);
};
const IC = { overview: 'M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-3H4z', plans: 'M4 6h16M4 12h16M4 18h10', mine: 'M4 20V10M10 20V4M16 20v-7M22 20H2', payments: 'M3 6h18v12H3zM3 10h18', fees: 'M3 6h18v12H3zM3 10h18', payouts: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14', profile: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', users: 'M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-1a4 4 0 00-3-3.9', subs: 'M9 12l2 2 4-4M5 4h14v16H5z', out: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h9', menu: 'M4 6h16M4 12h16M4 18h16', moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z', sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4', rules: 'M9 12h6M9 16h6M7 3h8l4 4v14H7zM15 3v4h4', wallet: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l2-3h12v3M16 13.5h2', search: 'M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z', codes: 'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01', deposits: 'M12 20V9m0 0l-4 4m4-4l4 4M5 4h14' };

// ===== theme (light / dark) =====
const THEME_KEY = 'jjhhf_theme';
const getTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } };
const applyTheme = t => { document.documentElement.classList.toggle('dark', t === 'dark'); };
applyTheme(getTheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
window.toggleTheme = () => {
  const t = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  applyTheme(t);
  const b = $('#tg'); if (b) b.innerHTML = ic(t === 'dark' ? IC.sun : IC.moon);
};
document.head.insertAdjacentHTML('beforeend', `<style>
html.dark{color-scheme:dark}
html.dark *{border-color:#263049}
.dark body.bg-slate-50{background-color:#0a0f1e;color:#e3e8f4}
.dark .bg-white{background-color:#111a2e}
.dark .bg-slate-50{background-color:#0d1426}
.dark .bg-slate-100{background-color:#1a2440}
.dark .bg-slate-900{background-color:#1c2747}
.dark .bg-slate-50\\/95{background-color:rgba(10,15,30,.95)}
.dark .bg-white\\/90{background-color:rgba(17,26,46,.9)}
.dark .hover\\:bg-slate-50:hover,.dark .hover\\:bg-slate-100:hover,.dark .hover\\:bg-slate-50\\/60:hover{background-color:#1a2440}
.dark .text-slate-900{color:#f2f5fb}
.dark .text-slate-800{color:#e3e8f4}
.dark .text-slate-700{color:#ccd4e6}
.dark .text-slate-600{color:#b3bdd4}
.dark .text-slate-500{color:#8e99b5}
.dark .text-slate-400,.dark input::placeholder{color:#6c7895}
.dark .text-emerald-800{color:#8fb0ff}
.dark .text-amber-800{color:#fbbf24}
.dark .text-red-700,.dark .text-red-600{color:#f87171}
.dark .text-blue-700{color:#60a5fa}
.dark .bg-emerald-50{background-color:rgba(93,134,247,.16)}
.dark .bg-amber-50{background-color:rgba(245,158,11,.14)}
.dark .bg-red-50{background-color:rgba(239,68,68,.14)}
.dark .bg-blue-50{background-color:rgba(59,130,246,.14)}
.dark .ring-emerald-200{--tw-ring-color:rgba(143,176,255,.3)}
.dark .ring-amber-200{--tw-ring-color:rgba(251,191,36,.3)}
.dark .ring-red-200{--tw-ring-color:rgba(248,113,113,.3)}
.dark .ring-blue-200{--tw-ring-color:rgba(96,165,250,.3)}
.dark .ring-slate-200{--tw-ring-color:#2c3756}
.nl-on::before{content:'';position:absolute;left:-12px;top:8px;bottom:8px;width:4px;border-radius:0 4px 4px 0;background:#f5b72a}
.dark select option{background-color:#111a2e;color:#e3e8f4}
.dark .border-emerald-200{border-color:rgba(143,176,255,.3)}
.dark .text-emerald-200{color:#bccdfe}
</style>`);

// ===== payment rules (all deadlines use Lagos time, WAT = UTC+1, no daylight saving) =====
// lateMultiplier 2 = a late instalment costs double (e.g. ₦100 becomes ₦200).
const RULES = { cutoffHour: 12, lateMultiplier: 2, weeklyDay: 5 /* Friday */, monthlyGraceDay: 2 };
const LAGOS = 1;
const toL = d => new Date(d.getTime() + LAGOS * 36e5);                       // read Lagos wall-clock with getUTC*()
const fromL = (y, m, d, h = 0, mi = 0, s = 0) => new Date(Date.UTC(y, m, d, h, mi, s) - LAGOS * 36e5);
const parseTs = s => { if (s instanceof Date) return s; const t = String(s).trim().replace(' ', 'T'); return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(t) ? t : t + 'Z'); };
const unit = (n, f) => FQ[f] + (n === 1 ? '' : 's');
const plural = (n, f) => n + ' ' + unit(n, f);
// a deadline at 12:00 is shown as "before 12:00 noon" on that day; a midnight deadline (the joining-day payment) as "by end of" the day before
const fmtDue = (f, d) => { if (!d) return 'Fully paid'; const o = { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }, noon = toL(d).getUTCHours() === RULES.cutoffHour;
  return noon ? d.toLocaleDateString('en-GB', o) + ', before ' + RULES.cutoffHour + ':00 noon' : new Date(d.getTime() - 1).toLocaleDateString('en-GB', o) + ', by end of day'; };

// deadline of the very first instalment, from the moment the user joined
function firstDue(freq, joined) {
  const L = toL(joined), y = L.getUTCFullYear(), m = L.getUTCMonth(), d = L.getUTCDate();
  if (freq === 'daily') { const t = fromL(y, m, d, RULES.cutoffHour); return joined < t ? t : fromL(y, m, d + 1, RULES.cutoffHour); }
  if (freq === 'weekly') { const add = (RULES.weeklyDay - L.getUTCDay() + 7) % 7; let t = fromL(y, m, d + add, RULES.cutoffHour); if (joined >= t) t = fromL(y, m, d + add + 7, RULES.cutoffHour); return t; }
  return fromL(y, m + 1, RULES.monthlyGraceDay, 23, 59, 59);               // monthly: 2nd of next month
}
// deadline of instalment number i (0-based)
function dueAt(freq, first, i) {
  const L = toL(first), y = L.getUTCFullYear(), m = L.getUTCMonth(), d = L.getUTCDate();
  if (freq === 'daily') return fromL(y, m, d + i, RULES.cutoffHour);
  if (freq === 'weekly') return fromL(y, m, d + 7 * i, RULES.cutoffHour);
  return fromL(y, m + i, RULES.monthlyGraceDay, 23, 59, 59);
}
// ---- seasons: cash and foodie plans run on a fixed season, 1 January to 30 November. Someone who joins mid-season owes (as a catch-up, no penalty)
//      every instalment whose deadline has already passed. Grocery plans simply run from the day the member joins. ----
const SEASON = { endMonth: 10 /* November */, endDay: 30 };
const isSeasonal = p => p.category === 'cash' || p.category === 'foodie';
function seasonFirst(freq, y) {
  if (freq === 'daily') return fromL(y, 0, 1, RULES.cutoffHour);
  if (freq === 'weekly') { const w = new Date(Date.UTC(y, 0, 1)).getUTCDay(); return fromL(y, 0, 1 + (RULES.weeklyDay - w + 7) % 7, RULES.cutoffHour); }
  return fromL(y, 1, RULES.monthlyGraceDay, 23, 59, 59);                  // January's instalment, due 2 February
}
function seasonCount(freq, y) {
  const days = Math.round((Date.UTC(y, SEASON.endMonth, SEASON.endDay) - Date.UTC(y, 0, 1)) / 864e5);
  if (freq === 'daily') return days + 1;
  if (freq === 'weekly') { const w = new Date(Date.UTC(y, 0, 1)).getUTCDay(), add = (RULES.weeklyDay - w + 7) % 7; return Math.floor((days - add) / 7) + 1; }
  return SEASON.endMonth + 1;
}
// the season someone joining at "joined" belongs to: this year's, unless every instalment of it is already due
const seasonYear = (freq, joined) => { const y = toL(joined).getUTCFullYear(); return dueAt(freq, seasonFirst(freq, y), seasonCount(freq, y) - 1) > joined ? y : y + 1; };
// ---- joining-day schedule (grocery plans), same as pb_hooks/rules.js: the first payment is due on the day the member joins,
//      then every 7 days (weekly) or every day (daily) counted from that day. A payment can be taken from the start of its due day
//      and is late if still unpaid at 12:00 noon that day (the first payment is taken on joining, so never late).
//      Payouts open "payout_after_days" days after joining (e.g. 30 for a 4-week plan).
const STEP = { daily: 1, weekly: 7 };
const dayStart = (joined, k, h = 0) => { const L = toL(parseTs(joined)); return fromL(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() + k, h); };
const joinSched = (sub, pl) => { const step = STEP[pl.frequency] || 7, j = sub.created; return { first: dayStart(j, 1), n: pl.duration, step, due: i => i === 0 ? dayStart(j, 1) : dayStart(j, i * step, RULES.cutoffHour), opens: i => dayStart(j, i * step) }; };
const payoutDays = pl => pl.payout_after_days > 0 ? pl.payout_after_days : (pl.duration - 1) * (STEP[pl.frequency] || 7) + 1;
// the schedule of one subscription: { first, n (number of instalments), due(i), season? }
function sched(sub, pl) {
  const f = pl.frequency, joined = parseTs(sub.created);
  if (!isSeasonal(pl)) return joinSched(sub, pl);
  const y = seasonYear(f, joined), first = seasonFirst(f, y);
  return { first, n: seasonCount(f, y), due: i => dueAt(f, first, i), season: y };
}
// instalments already due at the moment of joining = the catch-up owed by someone who joins a cash/foodie plan mid-season
const catchupCount = (sub, pl) => { if (!isSeasonal(pl)) return 0; const S = sched(sub, pl), t = parseTs(sub.created); let c = 0; while (c < S.n && S.due(c) <= t) c++; return c; };
// what a plan looks like to someone about to join it right now (used on plan cards and in the join window)
const planNow = p => isSeasonal(p) ? sched({ created: new Date().toISOString() }, p) : { n: p.duration };
const nPay = p => planNow(p).n;
const totalOf = p => p.amount * nPay(p);
const payoutOf = p => isSeasonal(p) ? totalOf(p) : p.payout;
// when an instalment becomes collectable from the wallet: from the start of its period (daily: midnight, weekly: Monday, monthly: the 1st), never before the season starts
function collectAt(sub, pl, i) {
  if (!isSeasonal(pl)) return joinSched(sub, pl).opens(i);
  const S = sched(sub, pl), L = toL(S.due(i)), y = L.getUTCFullYear(), m = L.getUTCMonth(), d = L.getUTCDate();
  const t = pl.frequency === 'daily' ? fromL(y, m, d, 0) : pl.frequency === 'weekly' ? fromL(y, m, d - 4, 0) : fromL(y, m, 1, 0);
  if (!S.season) return t;
  const start = fromL(S.season, 0, 1, 0); return t < start ? start : t;
}
// when the saving period ends = deadline of the last instalment; payouts open after this moment
const termEnd = (sub, pl) => { if (!isSeasonal(pl)) return dayStart(sub.created, payoutDays(pl)); const S = sched(sub, pl); return S.due(S.n - 1); };
const PAYOUT_MIN_DAYS = 14;   // the other running plan must have been joined at least this long ago (pb_hooks/rules.js)
const PAYOUT_NEEDS_PLAN = 'To request a payout you must have another plan that has been actively running for at least 2 weeks. Join a new plan and request this payout once it has run for 2 weeks.';
// the member's OTHER plans that are still running: active, saving period not ended, and joined at least 2 weeks ago (plOf gives a subscription's plan)
const runningOthers = (subs, sid, plOf, minDays = PAYOUT_MIN_DAYS) => subs.filter(o => o.id !== sid && o.status === 'active' && plOf(o).frequency && Date.now() < termEnd(o, plOf(o)).getTime() && Date.now() - parseTs(o.created).getTime() >= minDays * 864e5);
// when the soonest of those other plans reaches 2 weeks (for the hint on the payout button), or null
const payoutOpensAt = (subs, sid, plOf) => { const l = runningOthers(subs, sid, plOf, 0).map(o => parseTs(o.created).getTime() + PAYOUT_MIN_DAYS * 864e5); return l.length ? new Date(Math.min(...l)) : null; };
const fmtDay = d => d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' });
// how many instalments a payment record covers (older records without the field are estimated)
const instOf = (p, pl) => p.installments || Math.max(1, Math.round(((p.amount || 0) - (p.penalty || 0)) / (pl.amount || 1)));

// where a subscription stands right now: instalments covered, overdue count, next deadline, cost of each next instalment
function planState(sub, pl, pays, now = new Date()) {
  const A = pl.amount, pen = A * (RULES.lateMultiplier - 1), S = sched(sub, pl), due = S.due;
  const paid = pays.filter(p => p.subscription === sub.id && p.status !== 'rejected').reduce((a, p) => a + instOf(p, pl), 0);
  const left = Math.max(0, S.n - paid);
  let overdue = 0; while (overdue < left && due(paid + overdue) <= now) overdue++;
  return { A, pen, paid, left, duration: S.n, due, overdue, next: left ? due(paid) : null, cost: k => A + (k < overdue ? pen : 0) };
}
// Wallet view of one subscription: is its next instalment ready to be collected, and is the wallet able to cover it?
//   'done' fully paid | 'scheduled' not collectable yet (shows when) | 'waiting' ready but the wallet is short (shows how much to add)
function walletStatus(sub, pl, st, bal, now = new Date()) {
  if (!st.left) return { s: 'done' };
  const at = collectAt(sub, pl, st.paid);
  if (at > now) return { s: 'scheduled', at };
  const cost = st.cost(0);
  return bal >= cost ? { s: 'ready', cost } : { s: 'waiting', cost, short: cost - bal };
}
// ===== end payment rules =====

const penBadge = p => p.penalty > 0 ? `<span class="inline-flex px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset bg-amber-50 text-amber-800 ring-amber-200">Late · +${naira(p.penalty)}</span>` : '<span class="text-slate-400">—</span>';
const covers = p => { const pl = p.expand?.subscription?.expand?.plan || {}; return pl.frequency ? plural(instOf(p, pl), pl.frequency) : '—'; };
// The fees and registration rules, shown on the landing page, sign-up page, rules pages and the terms page.
const feeRulesHTML = () => {
  const c = (t, d) => `<div class="bg-white border rounded-xl p-5"><h3 class="font-semibold text-slate-900 text-sm">${t}</h3><p class="text-sm text-slate-600 mt-1.5 leading-relaxed">${d}</p></div>`;
  return '<div class="grid md:grid-cols-2 gap-4 max-w-4xl">'
    + c('Your wallet', `Every member has a <b>wallet</b> on the dashboard. Open <b>Wallet</b>, enter an amount and pay online through our payment partner (<b>Flutterwave, Paystack or Monnify</b>; card, bank transfer or USSD). No BVN or NIN is needed. Your wallet is credited as soon as the payment is confirmed, and every fee and contribution is taken from it.`)
    + c(`Tax charge · ${naira(FEES.tax)} per deposit`, `Every payment into your wallet carries a <b>${naira(FEES.tax)} tax charge</b>, added at checkout. To put ${naira(3000)} in your wallet you pay <b>${naira(3000 + FEES.tax)}</b>; your wallet receives the full ${naira(3000)}.`)
    + c(`Joining fee · ${naira(FEES.join)}`, `Taken from your wallet each time you join a plan, separately from your contributions. If your wallet is short, you are asked to deposit the difference first.`)
    + c('Plan codes', `Every plan you join gives you a <b>plan code</b>. It becomes usable on a set day after you join and expires on a later day (both shown on the plan). Use it, or share it with someone else, in the optional <b>Plan code</b> box when joining a new plan. A code works <b>once only</b>; after that it shows as used, with who used it. An unused code shows as expired after its last day.`)
    + c(`T-shirt registration · ${naira(FEES.shirt)}`, `A <b>one-time</b> payment for your foundation t-shirt, taken from your wallet. It is only required <b>when you request a payout</b>. Once it is paid you become a <b>registered</b> member.`)
    + c(`Payout clearance fee · ${naira(FEES.clearance)}`, `Every payout request carries a ${naira(FEES.clearance)} clearance fee, taken from your wallet. Your request is sent to the admin as soon as it is paid.`)
    + c('Payout details on your Profile', `Save your <b>account name, bank, 10-digit account number and address</b> on the Profile page (you can edit them any time). Every payout is paid into that account; you don't type them with each request.`)
    + c('Another plan must be running for 2 weeks', `Before you can request a payout from a plan, you must have <b>another plan that has been actively running for at least 2 weeks</b> (a plan you joined at least 14 days ago whose saving period has not ended).`)
    + '</div>';
};
const termsHTML = () => {
  const m = RULES.lateMultiplier, S = (n, t, body) => `<section class="bg-white border rounded-xl p-5 sm:p-6"><h2 class="font-semibold text-slate-900">${n}. ${t}</h2><div class="text-sm text-slate-600 mt-2 leading-relaxed space-y-2">${body}</div></section>`;
  return '<div class="space-y-4">'
    + S(1, 'About these terms', `<p>${BRAND} is a community savings foundation where members contribute daily or weekly towards a grocery payout. By creating an account you confirm that you have read, understood and accepted these Terms and Conditions, including every fee listed below.</p>`)
    + S(2, 'Your wallet and deposits', `<p>Every member has a <b>wallet</b> on their dashboard. You fund it from the Wallet page by paying online through one of our payment partners, <b>Flutterwave, Paystack or Monnify</b> (card, bank transfer or USSD). Each member is assigned one partner, which is shown on the Wallet page. No BVN or NIN is required. Your wallet is credited once the partner confirms the payment, usually within moments.</p><p>Every deposit carries a <b>tax charge of ${naira(FEES.tax)}</b>, added to the amount you pay at checkout (for example, to deposit ${naira(3000)} you pay ${naira(3000 + FEES.tax)}). The tax charge is not added to your wallet and is not refundable.</p><p>All fees and contributions are paid <b>from your wallet</b>. Money in your wallet stays yours until a fee or contribution is taken from it under these terms.</p>`)
    + S(3, 'Plans', `<p>We offer <b>Grocery plans</b> of <b>4, 8, 12 and 25 weeks</b>. Every plan shows its contribution amount, how often you pay (daily or weekly), its length, the number of payments, the day payouts open and the payout. A plan runs from the day you join.</p><p>A joining fee of <b>${naira(FEES.join)}</b> is taken from your wallet each time you join a plan, separately from your contributions.</p>`)
    + S(4, 'Plan codes', `<p>Each time you join a plan, a unique <b>plan code</b> is created for that plan. The code becomes usable on a set day after you join and expires at the end of a later day; both are chosen by the foundation for each plan and shown on the plan.</p><p>While the code is usable, it can be entered (optionally) when joining a new plan, by you or by anyone you share it with. Each code can be used <b>once only</b>. Once used, it is marked as used, and both you and the foundation can see who used it and when. A code that is not used in time is marked as expired and cannot be used afterwards.</p>`)
    + S(5, 'Payment schedule, automatic payments and late penalties', `<p><b>Your first payment is made on the day you join</b>, together with the joining fee. After that, weekly plans are paid <b>every 7 days</b> counted from the day you join, and daily plans every day. For example, on a 4-week plan joined on the 1st of the month, payments fall on the 1st, 8th, 15th and 22nd.</p><p>You do not pay each contribution by hand: on each due day the contribution is taken from your wallet automatically. If you have several plans and your wallet cannot cover them all, plans are served from the oldest due date first; a plan that cannot be covered <b>waits</b> and is paid automatically as soon as you deposit.</p><p>All times are Lagos time (WAT). On each due day the contribution is taken from your wallet from midnight; it must be paid <b>before ${RULES.cutoffHour}:00 noon</b>. A contribution still unpaid at ${RULES.cutoffHour}:00 noon on its due day costs double when it is collected (for example ${naira(1000)} becomes ${naira(1000 * m)}). Your first payment is taken when you join, so it never carries a penalty. The extra amount is a penalty: it does not count towards your savings or payout. Keep enough in your wallet to avoid it.</p>`)
    + S(6, 'The t-shirt fee', `<p>Every member pays a one-time fee of <b>${naira(FEES.shirt)}</b> for the foundation t-shirt, taken from the wallet. You can use your dashboard, join plans and make contributions without paying it. It only becomes payable <b>when you want to request a payout</b>. It is paid once only.</p>`)
    + S(7, 'Payouts and the clearance fee', `<p>You can request a payout from a plan only when <b>all</b> of the following are true:</p><ul class="list-disc pl-5 space-y-1"><li>the plan is fully paid and its payout date has been reached (each plan shows how many days after joining payouts open; for example 30 days for a 4-week plan);</li><li><b>you have another plan that has been actively running for at least 2 weeks</b>: a plan you joined at least 14 days earlier, other than the one you are collecting, whose saving period has not yet ended;</li><li>you have paid the one-time ${naira(FEES.shirt)} t-shirt fee (see section 6);</li><li>your <b>payout details</b> (account name, bank, account number and address) are saved on your Profile page. Payouts are paid into that account, so keep it up to date.</li></ul><p>Every payout request also carries a clearance fee of <b>${naira(FEES.clearance)}</b>, taken from your wallet. Your request is sent as soon as it is paid.</p>`)
    + S(8, 'Records', `<p>Every deposit, fee and contribution is recorded in your wallet history on your dashboard, and you can see every payment, payout and plan code there.</p>`)
    + S(9, 'Contact', `<p>For any question about these terms, contact customer care on <b>${SUPPORT_PHONE}</b> or <b>${SUPPORT_PHONE_2}</b>, email <b>${SUPPORT_EMAIL}</b>, or visit us at <b>${OFFICE_ADDRESS}</b>.</p><p>${BRAND} · RC ${RC_NUMBER}.</p>`)
    + '</div>';
};
const rulesHTML = () => {
  const m = RULES.lateMultiplier, c = (t, d) => `<div class="bg-white border rounded-xl p-5"><h3 class="font-semibold text-slate-900 text-sm">${t}</h3><p class="text-sm text-slate-600 mt-1.5 leading-relaxed">${d}</p></div>`;
  return '<h2 class="text-sm font-semibold text-slate-900 mb-3">Wallet, fees and plan codes</h2>' + feeRulesHTML() + '<h2 class="text-sm font-semibold text-slate-900 mt-8 mb-3">Plans, automatic payments and deadlines</h2><div class="grid md:grid-cols-2 gap-4 max-w-4xl">'
    + c('Grocery plans', `Plans run for <b>4, 8, 12 or 25 weeks</b> from the day you join, with daily or weekly contributions. Each plan shows its amount, number of payments, payout, and how many days after joining payouts open (for example 30 days for a 4-week plan).`)
    + c('Paid from your wallet', `You never pay a contribution by hand. When a payment period opens, the contribution is taken from your wallet. Keep your wallet funded and your plans run by themselves.`)
    + c('Not enough in the wallet?', `If you have, say, three plans of ${naira(2000)} a week and ${naira(5000)} in your wallet, two plans are paid and the third <b>waits</b>. The moment you deposit, it is paid automatically.`)
    + c('Your first payment', `Made on the day you join, together with the ${naira(FEES.join)} joining fee. Your wallet must hold both before you can join.`)
    + c('Weekly plans', `After the first payment, every <b>7 days</b> counted from the day you join. A 4-week plan joined on the 1st is paid on the 1st, 8th, 15th and 22nd, and its payout opens after 30 days.`)
    + c('Daily plans', `After the first payment, every day. Each day's contribution is taken from your wallet from midnight and must be paid before ${RULES.cutoffHour}:00 noon.`)
    + c('Pay before 12 noon', `Each due day's contribution is taken from your wallet from midnight. If it is still unpaid at <b>${RULES.cutoffHour}:00 noon</b> that day (because your wallet was short), it costs double when collected (${naira(500)} becomes ${naira(500 * m)}). A penalty is a fee: it does not count towards your savings or payout.`)
    + c('Time and confirmation', `All dates use Lagos time (WAT), whatever your device clock says. Deposits are confirmed automatically by our payment partner (Flutterwave, Paystack or Monnify).`) + '</div>' + contactHTML();
};

// contact card (Rules pages); the homepage and footer show the same details
const telLink = n => `<a href="tel:${n}" class="text-emerald-800 font-medium hover:underline">${n}</a>`;
const contactHTML = () => `<h2 class="text-sm font-semibold text-slate-900 mt-8 mb-3">Contact us</h2><div class="bg-white border rounded-xl p-5 max-w-4xl grid sm:grid-cols-2 gap-4 text-sm"><div><p class="text-xs uppercase tracking-wide text-slate-500">Customer care</p><p class="mt-1">${telLink(SUPPORT_PHONE)} · ${telLink(SUPPORT_PHONE_2)}</p><p class="mt-1"><a href="https://wa.me/${SUPPORT_WHATSAPP}" target="_blank" rel="noopener" class="text-emerald-800 font-medium hover:underline">Chat on WhatsApp</a></p></div><div><p class="text-xs uppercase tracking-wide text-slate-500">Email</p><p class="mt-1"><a href="mailto:${SUPPORT_EMAIL}" class="text-emerald-800 font-medium hover:underline">${SUPPORT_EMAIL}</a></p></div><div><p class="text-xs uppercase tracking-wide text-slate-500">Office</p><p class="mt-1 text-slate-700">${OFFICE_ADDRESS}</p><p class="mt-1"><a href="${MAP_URL}" target="_blank" rel="noopener" class="text-emerald-800 font-medium hover:underline">Open in Google Maps</a></p></div><div><p class="text-xs uppercase tracking-wide text-slate-500">Registration</p><p class="mt-1 text-slate-700">RC ${RC_NUMBER}</p></div></div>`;
const MAP_URL = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(OFFICE_ADDRESS + ', Nigeria');

// ===== payout details (kept on the member's profile, used for every payout request) =====
const NG_BANKS = ['Access Bank', 'Citibank', 'Ecobank', 'Fidelity Bank', 'First Bank of Nigeria', 'First City Monument Bank (FCMB)', 'Globus Bank', 'Guaranty Trust Bank (GTBank)', 'Heritage Bank', 'Jaiz Bank', 'Keystone Bank', 'Kuda Bank', 'Lotus Bank', 'Moniepoint MFB', 'OPay', 'PalmPay', 'Parallex Bank', 'Polaris Bank', 'Providus Bank', 'Stanbic IBTC Bank', 'Standard Chartered', 'Sterling Bank', 'SunTrust Bank', 'Taj Bank', 'Titan Trust Bank', 'Union Bank', 'United Bank for Africa (UBA)', 'Unity Bank', 'VFD Microfinance Bank', 'Wema Bank (ALAT)', 'Zenith Bank'];
const payoutReady = u => !!(u && u.bank_account_name && u.bank_name && /^\d{10}$/.test(u.bank_account_number || '') && u.address);
// the details block shown to members (payout pop-up) and admins (payouts, member page)
const payoutDetails = u => payoutReady(u) ? `<dl class="text-sm divide-y">${[['Account name', u.bank_account_name], ['Bank', u.bank_name], ['Account number', '<span class="font-mono tracking-wider">' + esc(u.bank_account_number) + '</span>'], ['Address', u.address]].map(([k, v]) => `<div class="flex justify-between gap-4 py-1.5"><dt class="text-slate-500 shrink-0">${k}</dt><dd class="font-medium text-slate-900 text-right break-words min-w-0">${k === 'Account number' ? v : esc(v)}</dd></div>`).join('')}</dl>` : '<p class="text-sm text-amber-800">No payout details on the profile yet.</p>';

// ===== plan codes (display) =====
// where a membership's code stands right now: none | soon | open | used | expired
const codeStatus = (sub, now = Date.now()) => !sub.code ? 'none' : sub.code_used_at ? 'used' : now >= parseTs(sub.code_until).getTime() ? 'expired' : now < parseTs(sub.code_from).getTime() ? 'soon' : 'open';
const lastDay = sub => fmtDay(new Date(parseTs(sub.code_until).getTime() - 1));            // code_until is the first moment after the last valid day
const codeBadge = sub => ({ soon: '<span class="inline-flex px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset bg-slate-50 text-slate-600 ring-slate-200">Not open yet</span>', open: '<span class="inline-flex px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset bg-emerald-50 text-emerald-800 ring-emerald-200">Usable</span>', used: '<span class="inline-flex px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset bg-blue-50 text-blue-700 ring-blue-200">Used</span>', expired: '<span class="inline-flex px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset bg-red-50 text-red-700 ring-red-200">Expired</span>' })[codeStatus(sub)] || '<span class="text-slate-400">—</span>';
// the code panel shown on a member's plan card
function codePanel(sub) {
  const st = codeStatus(sub); if (st === 'none') return '';
  const code = `<span class="font-mono font-semibold tracking-wider ${st === 'expired' || st === 'used' ? 'line-through text-slate-400' : 'text-slate-900'}">${esc(sub.code)}</span>`;
  const body = {
    soon: `<p class="text-sm text-slate-600">Your plan code opens on <b>${fmtDay(parseTs(sub.code_from))}</b> and can be used until the end of <b>${lastDay(sub)}</b>.</p>`,
    open: `<div class="flex flex-wrap items-center gap-3">${code}<button type="button" onclick="copyCode('${esc(sub.code)}')" class="${btn2} !py-1 !px-2.5 text-xs">Copy</button></div><p class="text-xs text-slate-500 mt-1.5">Use it (or share it) when joining a new plan, before the end of <b class="text-slate-700">${lastDay(sub)}</b>. It works once.</p>`,
    used: `<div class="flex flex-wrap items-center gap-3">${code}${codeBadge(sub)}</div><p class="text-xs text-slate-500 mt-1.5">Used by <b class="text-slate-700">${esc(sub.code_used_name || 'a member')}</b> on ${date(sub.code_used_at)}.</p>`,
    expired: `<div class="flex flex-wrap items-center gap-3">${code}${codeBadge(sub)}</div><p class="text-xs text-slate-500 mt-1.5">Expired at the end of ${lastDay(sub)} without being used.</p>`,
  }[st];
  return `<div class="mt-4 rounded-lg border ${st === 'open' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50'} p-3"><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Plan code</p>${body}</div>`;
}
window.copyCode = c => navigator.clipboard?.writeText(c).then(() => toast('Code copied: ' + c), () => toast(c));

// ===== deposits through the member's payment provider (Flutterwave, Paystack or Monnify; amount + ₦100 tax charge) =====
const GATEWAY_NAME = { flutterwave: 'Flutterwave', paystack: 'Paystack', monnify: 'Monnify' };
// Starts a deposit and sends the member to Flutterwave; they come back to this page and dashboard.html settles it.
async function startDeposit(amount) {
  amount = Math.round(Number(amount) || 0);
  if (amount < 100) throw new Error('The smallest deposit is ' + naira(100) + '.');
  const r = await pb.send('/api/jjhhf/wallet/deposit', { method: 'POST', body: { amount, redirect: location.origin + location.pathname } });
  if (r.demo) { toast(naira(amount) + ' added to your wallet (demo).'); refresh(); return; }
  location.href = r.link;
}
// the "you pay" summary under an amount box
const depositSummary = a => { a = Math.max(0, Math.round(+a || 0)); return `<div class="flex justify-between py-1"><span class="text-slate-500">Into your wallet</span><span class="font-medium">${naira(a)}</span></div><div class="flex justify-between py-1"><span class="text-slate-500">Tax charge</span><span class="font-medium">${naira(FEES.tax)}</span></div><div class="flex justify-between py-1.5 border-t mt-1 text-base"><span class="font-semibold text-slate-900">You pay</span><span class="font-semibold text-slate-900">${naira(a + FEES.tax)}</span></div>`; };
// pop-up used when the wallet is short (e.g. joining a plan): prefilled with the shortfall
window.depositBox = (amount = '') => {
  modal('Deposit', `<label class="block text-sm"><span class="text-slate-600">Amount to add to your wallet (₦)</span><input name="amount" type="number" min="100" step="1" value="${esc(amount)}" required class="${inp} mt-1"></label><div id="dsum" class="text-sm rounded-lg border bg-slate-50 px-3 py-2">${depositSummary(amount)}</div><p class="text-xs text-slate-500">A ${naira(FEES.tax)} tax charge is added to every deposit. You pay on our payment partner's secure page (card, bank transfer or USSD) and come back here.</p>`,
    async d => { await startDeposit(d.amount); }, 'Continue to payment');
  const i = document.querySelector('[data-ui="modal"] [name="amount"]'); i.oninput = () => { $('#dsum').innerHTML = depositSummary(i.value); }; i.focus();
};

// Pays a fee (or joins a plan) from the member's wallet: the server decides the amount and checks the balance (see pb_hooks/wallet.js and fees.js).
// body: { type: 'shirt' } | { type: 'join', plan } | { type: 'clearance', subscription, details }
const payFee = body => pb.send('/api/jjhhf/fee/pay', { method: 'POST', body });
// the signed-in member's wallet balance, read fresh from the server
const walletBal = async () => (await pb.collection('users').getOne(pb.authStore.record.id)).wallet_balance || 0;

function toast(m, err, ms = 3000) {
  const t = document.createElement('div');
  t.className = 'fixed bottom-24 right-4 sm:bottom-6 sm:right-24 z-[60] px-4 py-2.5 rounded-lg text-sm text-white shadow-lg ' + (err ? 'bg-red-700' : 'bg-slate-900');
  t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function guard(role) {
  if (!pb.authStore.isValid) { location.href = 'auth.html'; return false; }
  if (role === 'admin' && pb.authStore.record.role !== 'admin') { location.href = 'dashboard.html'; return false; }
  // re-check with the server: picks up role changes and deleted accounts, and renews the token
  pb.collection('users').authRefresh().then(() => {
    if (role === 'admin' && pb.authStore.record.role !== 'admin') location.href = 'dashboard.html';
  }).catch(e => { if ([401, 403, 404].includes(e.status)) { pb.authStore.clear(); location.href = 'auth.html'; } });
  return true;
}
function logout() { pb.authStore.clear(); location.href = 'index.html'; }

const badge = s => `<span class="inline-flex px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${({ active: 'bg-emerald-50 text-emerald-800 ring-emerald-200', confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200', pending: 'bg-amber-50 text-amber-800 ring-amber-200', rejected: 'bg-red-50 text-red-700 ring-red-200', cancelled: 'bg-slate-50 text-slate-600 ring-slate-200', completed: 'bg-blue-50 text-blue-700 ring-blue-200' })[s] || 'bg-slate-50 text-slate-600 ring-slate-200'}">${cap(s)}</span>`;
const head = (t, sub, action = '') => `<div class="flex flex-wrap items-end justify-between gap-3 mb-6"><div><h1 class="text-xl font-semibold text-slate-900">${t}</h1><p class="text-sm text-slate-500 mt-0.5">${sub || ''}</p></div><div class="flex gap-2">${action}</div></div>`;
const stat = (l, v, s = '') => `<div class="bg-white border rounded-xl p-4 sm:p-5 min-w-0 shadow-[inset_0_3px_0_0_theme(colors.accent.400)]"><p class="text-[11px] sm:text-xs font-medium uppercase tracking-wide text-slate-500">${l}</p><p class="text-xl sm:text-2xl font-semibold text-slate-900 mt-1.5 sm:mt-2 break-words">${v}</p>${s ? `<p class="text-xs text-slate-500 mt-1">${s}</p>` : ''}</div>`;
const table = (heads, rows) => {
  if (!rows.length) return `<div class="bg-white border border-dashed rounded-xl p-10 text-center text-slate-500 text-sm">Nothing here yet.</div>`;
  const desk = `<div class="hidden md:block bg-white border rounded-xl overflow-x-auto"><table class="w-full text-sm text-left"><thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>${heads.map(h => h === 'SEL' ? '<th class="pl-4 pr-0 py-3 w-8"></th>' : `<th class="px-4 py-3 font-medium whitespace-nowrap">${h}</th>`).join('')}</tr></thead><tbody class="divide-y">${rows.map(r => `<tr class="hover:bg-slate-50/60">${r.map(c => `<td class="px-4 py-3 whitespace-nowrap">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const cards = `<div class="md:hidden space-y-3">${rows.map(r => {
    const si = heads.indexOf('SEL');
    const body = r.map((c, i) => heads[i] && i !== si && c !== '' ? `<div class="flex items-start justify-between gap-4 py-1.5 text-sm"><dt class="text-slate-500 shrink-0">${heads[i]}</dt><dd class="text-right min-w-0 break-words text-slate-800">${c}</dd></div>` : '').join('');
    const acts = r.filter((c, i) => !heads[i] && c !== '').join('');
    return `<div class="bg-white border rounded-xl p-4">${si >= 0 ? `<div class="flex items-center justify-between pb-2 mb-1 border-b text-xs font-medium text-slate-500"><span>Select</span>${r[si]}</div>` : ''}<dl class="divide-y">${body}</dl>${acts ? `<div class="flex flex-wrap gap-2 pt-3 mt-2 border-t">${acts}</div>` : ''}</div>`;
  }).join('')}</div>`;
  return desk + cards;
};
// ===== server-side paging: only one page of records is downloaded at a time =====
// pagedTable(el, { col, heads, row, filter, sort, expand, per, key }) draws a table plus Previous/Next and re-draws only itself.
// The page number survives live refreshes (window._pg[key]) and is forgotten when you move to another page of the app.
const pgBtn = 'px-3 py-1.5 rounded-lg border bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white';
async function pagedTable(el, o) {
  const { col, heads, row, filter = '', sort = '-created', expand = '', per = 50, key = col, empty = '' } = o;
  window._pg = window._pg || {};
  let page = window._pg[key] || 1, r;
  r = await pb.collection(col).getList(page, per, { filter, sort, ...(expand ? { expand } : {}) });
  const pages = Math.max(1, Math.ceil(r.totalItems / per));
  if (page > pages && r.totalItems) { window._pg[key] = pages; return pagedTable(el, o); }
  const from = r.totalItems ? (page - 1) * per + 1 : 0, to = Math.min(page * per, r.totalItems);
  el.innerHTML = (r.items.length || !empty ? table(heads, r.items.map(row)) : empty)
    + (r.totalItems > per ? `<div class="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-slate-500"><span>Showing <b class="text-slate-700">${from.toLocaleString()}–${to.toLocaleString()}</b> of <b class="text-slate-700">${r.totalItems.toLocaleString()}</b></span><span class="flex items-center gap-2"><button data-pg="${page - 1}" ${page > 1 ? '' : 'disabled'} class="${pgBtn}">← Previous</button><span>Page ${page} of ${pages.toLocaleString()}</span><button data-pg="${page + 1}" ${page < pages ? '' : 'disabled'} class="${pgBtn}">Next →</button></span></div>` : '');
  el.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { window._pg[key] = +b.dataset.pg; pagedTable(el, o).then(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' })); });
  return r;
}
// a search box that re-runs fn (debounced) without re-drawing the whole page, so typing is never interrupted
const searchBox = (id, val, ph) => `<div class="relative flex-1 min-w-[220px]"><span class="absolute left-3 top-2.5 text-slate-400">${ic(IC.search)}</span><input id="${id}" value="${esc(val || '')}" placeholder="${ph}" class="${inp} pl-10"></div>`;
const onSearch = (id, fn) => { let t; const el = $('#' + id); if (el) el.oninput = () => { clearTimeout(t); t = setTimeout(() => fn(el.value.trim()), 350); }; };
// Lagos calendar day "YYYY-MM-DD" -> database timestamp of its first moment (for date filters)
const dayStartTs = iso => { const [y, m, d] = iso.split('-').map(Number); return fromL(y, m - 1, d).toISOString().replace('T', ' '); };

const fld = (label, name, val = '', type = 'text', extra = '') => `<label class="block text-sm"><span class="text-slate-600">${label}</span><input name="${name}" type="${type}" value="${esc(val)}" ${extra} class="${inp} mt-1"></label>`;
const sel = (label, name, opts, val) => `<label class="block text-sm"><span class="text-slate-600">${label}</span><select name="${name}" class="${inp} mt-1">${opts.map(o => `<option ${o == val ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;

function modal(title, body, onSubmit, cta = 'Save') {
  const d = document.createElement('div');
  d.className = 'fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4'; d.setAttribute('data-ui', 'modal');
  d.innerHTML = `<form class="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-3 max-h-[90dvh] overflow-y-auto"><h3 class="font-semibold text-slate-900">${title}</h3>${body}<div class="flex justify-end gap-2 pt-2"><button type="button" class="c ${btn2}">Cancel</button><button class="${btn}">${cta}</button></div></form>`;
  document.body.appendChild(d);
  const close = () => { removeEventListener('keydown', esc, true); d.remove(); };
  const esc = e => { if (e.key === 'Escape' && document.body.contains(d)) { e.stopPropagation(); close(); } };
  addEventListener('keydown', esc, true);
  d.onclick = e => { if (e.target === d) close(); };                     // click outside the box closes it
  $('.c', d).onclick = close;
  $('form', d).onsubmit = async e => {
    e.preventDefault();
    try { await onSubmit(Object.fromEntries(new FormData(e.target))); close(); refresh(); }
    catch (x) { toast(x.message, 1); }
  };
}

// Styled replacement for the browser's confirm(). Resolves true when confirmed, false when cancelled (button, Esc or click outside).
function confirmBox({ title, message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, items = [] }) {
  return new Promise(res => {
    const d = document.createElement('div');
    d.setAttribute('data-ui', 'confirm'); d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-modal', 'true');
    d.className = 'fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4 opacity-0 transition-opacity duration-150';
    const list = items.length ? `<ul class="mt-4 text-sm text-slate-700 bg-slate-50 border rounded-lg divide-y max-h-36 overflow-y-auto">${items.slice(0, 6).map(x => `<li class="px-3 py-1.5 truncate">${esc(x)}</li>`).join('')}${items.length > 6 ? `<li class="px-3 py-1.5 text-slate-500">and ${items.length - 6} more…</li>` : ''}</ul>` : '';
    d.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 scale-95 transition-transform duration-150"><div class="flex items-start gap-4"><div class="w-10 h-10 rounded-full grid place-items-center shrink-0 ${danger ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-800'}">${ic(danger ? 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5' : 'M12 8v5M12 16h.01M12 3a9 9 0 100 18 9 9 0 000-18z')}</div><div class="min-w-0"><h3 class="font-semibold text-slate-900">${esc(title)}</h3><p class="text-sm text-slate-500 mt-1 leading-relaxed">${esc(message)}</p></div></div>${list}<div class="flex justify-end gap-2 mt-6"><button type="button" data-no class="${btn2}">${esc(cancelText)}</button><button type="button" data-yes class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg text-white transition ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-800 hover:bg-emerald-900'}">${esc(confirmText)}</button></div></div>`;
    const done = v => { removeEventListener('keydown', key, true); d.classList.add('opacity-0'); setTimeout(() => d.remove(), 150); res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    addEventListener('keydown', key, true);
    d.onclick = e => { if (e.target === d) done(false); };
    $('[data-no]', d).onclick = () => done(false); $('[data-yes]', d).onclick = () => done(true);
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.classList.remove('opacity-0'); d.firstElementChild.classList.remove('scale-95'); });
    $('[data-no]', d).focus();
  });
}

// ===== plan explorer: search, filters, sort, detail drawer with previous/next =====
const PS = { q: '', wk: 'all', freq: 'all', bud: 'all', sort: 'amount-asc' };
const BUD = { all: ['Any budget', () => true], a: ['Up to ₦500', p => p.amount <= 500], b: ['₦501 – ₦2,000', p => p.amount > 500 && p.amount <= 2000], c: ['Above ₦2,000', p => p.amount > 2000] };
const SORT = { 'amount-asc': ['Amount: low to high', (a, b) => a.amount - b.amount], 'amount-desc': ['Amount: high to low', (a, b) => b.amount - a.amount], 'payout-desc': ['Payout: high to low', (a, b) => payoutOf(b) - payoutOf(a)], name: ['Name: A to Z', (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })] };
const matchQ = (p, q) => [p.name, p.description, p.category, p.frequency, p.amount].join(' ').toLowerCase().includes(q.toLowerCase());
const filterPlans = l => l.filter(p => (PS.wk === 'all' || String(weeksOf(p)) === PS.wk) && (PS.freq === 'all' || p.frequency === PS.freq) && BUD[PS.bud][1](p) && (!PS.q.trim() || matchQ(p, PS.q.trim()))).sort(SORT[PS.sort][1]);
const opts = (o, v) => Object.entries(o).map(([k, x]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${Array.isArray(x) ? x[0] : x}</option>`).join('');

const planCard = (p, i, quick = '') => `<div onclick="openPlan(${i})" class="cursor-pointer bg-white border rounded-xl p-5 flex flex-col hover:border-emerald-700 hover:shadow-sm transition">
  <div class="flex items-center justify-between"><span class="text-xs font-medium uppercase tracking-wide text-slate-500">${p.category} · ${p.frequency}</span>${p.active === false ? badge('cancelled').replace('Cancelled', 'Hidden') : ''}</div>
  <h3 class="font-semibold text-slate-900 mt-2">${esc(p.name)}</h3>
  <p class="mt-3 text-2xl font-semibold text-slate-900">${naira(p.amount)}<span class="text-sm font-normal text-slate-500"> / ${FQ[p.frequency]}</span></p>
  <dl class="mt-3 text-sm space-y-1"><div class="flex justify-between"><dt class="text-slate-500">Length</dt><dd class="text-right">${monthsLabel(p)} · ${nPay(p)} payments</dd></div><div class="flex justify-between"><dt class="text-slate-500">Total payout</dt><dd class="font-medium">${naira(payoutOf(p))}</dd></div></dl>
  ${p.description ? `<p class="mt-3 text-xs text-slate-500 line-clamp-2">${esc(p.description)}</p>` : ''}
  <div class="mt-auto pt-4 flex gap-2" onclick="event.stopPropagation()">${quick}</div></div>`;

function explorer(m, all, o = {}) {
    m.innerHTML = `<div class="md:sticky md:top-16 md:z-10 -mx-4 sm:-mx-8 px-4 sm:px-8 py-3 mb-5 bg-slate-50/95 backdrop-blur border-b space-y-3">
    <div class="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
      <div class="relative col-span-2 sm:flex-1 sm:min-w-[220px]"><span class="absolute left-3 top-2.5 text-slate-400">${ic(IC.search)}</span><input id="pq" value="${esc(PS.q)}" placeholder="Search by name, amount or item…" class="${inp} pl-10"></div>
      <select id="pf" class="${inp} sm:!w-auto">${opts({ all: 'All frequencies', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }, PS.freq)}</select>
      <select id="pb" class="${inp} sm:!w-auto">${opts(BUD, PS.bud)}</select>
      <select id="ps" class="${inp} col-span-2 sm:col-auto sm:!w-auto">${opts(SORT, PS.sort)}</select></div>
    <div class="flex items-center justify-between gap-3"><div id="pt" class="flex gap-1.5 overflow-x-auto min-w-0">${[['all', 'All lengths', all.length], ...[...new Set([...PLAN_WEEKS, ...all.map(weeksOf)])].sort((a, b) => a - b).filter(w => all.some(p => weeksOf(p) === w)).map(w => [String(w), w + ' weeks', all.filter(p => weeksOf(p) === w).length])].map(c => `<button data-c="${c[0]}" class="whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium border">${c[1]} <span class="opacity-60">${c[2]}</span></button>`).join('')}</div>
    <p class="text-sm text-slate-500 whitespace-nowrap"><span id="pc"></span> <button id="px" class="ml-2 text-emerald-800 font-medium hover:underline">Clear</button></p></div></div><div id="pr"></div>`;
  const paint = () => {
    const l = window._pl = filterPlans(all);
    document.querySelectorAll('#pt button').forEach(b => { const on = b.dataset.c === PS.wk; b.className = 'whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium border ' + (on ? 'bg-emerald-800 text-white border-emerald-800' : 'bg-white text-slate-600 hover:bg-slate-100'); });
    $('#pc').textContent = `Showing ${l.length} of ${all.length}`;
    $('#px').classList.toggle('hidden', !PS.q && PS.wk === 'all' && PS.freq === 'all' && PS.bud === 'all');
    $('#pr').innerHTML = !l.length ? '<div class="bg-white border border-dashed rounded-xl p-12 text-center text-sm text-slate-500">No plans match your search. Try clearing a filter.</div>'
      : o.cols ? table(o.cols.heads, l.map(o.cols.row))
      : `<div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">${l.map((p, i) => planCard(p, i, o.quick ? o.quick(p) : '')).join('')}</div>`;
    if (o.onPaint) o.onPaint(l);
  };
  $('#pq').oninput = e => { PS.q = e.target.value; paint(); };
  [['pf', 'freq'], ['pb', 'bud'], ['ps', 'sort']].forEach(([id, k]) => $('#' + id).onchange = e => { PS[k] = e.target.value; paint(); });
  $('#pt').onclick = e => { const b = e.target.closest('button'); if (b) { PS.wk = b.dataset.c; paint(); } };
  $('#px').onclick = () => { Object.assign(PS, { q: '', wk: 'all', freq: 'all', bud: 'all' }); explorer(m, all, o); };
  paint();
}

const dBtn = 'w-9 h-9 rounded-lg border grid place-items-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-white';
window.closePlan = () => $('#dr')?.remove();
window.openPlan = i => {
  const L = window._pl || [], p = L[i]; if (!p) return;
  closePlan();
  const d = document.createElement('div'); d.id = 'dr'; d.className = 'fixed inset-0 z-50 flex justify-end';
  const row = (k, v) => `<div class="flex justify-between py-3 text-sm"><dt class="text-slate-500">${k}</dt><dd class="font-medium text-slate-900 text-right">${v}</dd></div>`;
  const nb = (j, lab) => L[j] ? `<button onclick="openPlan(${j})" class="text-left flex-1 border rounded-lg p-3 hover:bg-slate-50"><span class="block text-xs text-slate-500">${lab}</span><span class="block text-sm font-medium truncate">${esc(L[j].name)}</span></button>` : '<span class="flex-1"></span>';
  d.innerHTML = `<div class="absolute inset-0 bg-slate-900/40" onclick="closePlan()"></div><aside class="relative w-full max-w-md bg-white h-full shadow-xl flex flex-col">
    <div class="h-16 px-5 border-b flex items-center justify-between shrink-0"><div class="flex items-center gap-2"><button onclick="openPlan(${i - 1})" ${i ? '' : 'disabled'} class="${dBtn}" aria-label="Previous plan">‹</button><button onclick="openPlan(${i + 1})" ${i < L.length - 1 ? '' : 'disabled'} class="${dBtn}" aria-label="Next plan">›</button><span class="ml-1 text-sm text-slate-500">Plan ${i + 1} of ${L.length}</span></div><button onclick="closePlan()" class="${dBtn}" aria-label="Close">✕</button></div>
    <div class="flex-1 overflow-y-auto p-6"><p class="text-xs font-medium uppercase tracking-wide text-slate-500">${p.category} · ${p.frequency}</p><h2 class="text-xl font-semibold text-slate-900 mt-1">${esc(p.name)}</h2>
      <p class="mt-4 text-3xl font-semibold">${naira(p.amount)}<span class="text-base font-normal text-slate-500"> / ${FQ[p.frequency]}</span></p>
      <dl class="mt-5 divide-y border-y">${row('Plan length', monthsLabel(p))}${codeDays(p) ? row('Plan code usable', codeDays(p) + ' after joining') : ''}${row('Number of payments', nPay(p))}${row('Total you contribute', naira(totalOf(p)))}${row('Total payout', naira(payoutOf(p)))}${row('Status', p.active === false ? 'Hidden' : 'Open for enrolment')}</dl>
      ${p.description ? `<h3 class="mt-6 text-sm font-semibold">What's included</h3><p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(p.description)}</p>` : ''}
      <div class="mt-8 flex gap-2">${nb(i - 1, '← Previous')}${nb(i + 1, 'Next →')}</div></div>
    <div class="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t shrink-0">${(window.PLAN_ACTION || (() => ''))(p)}</div></aside>`;
  document.body.appendChild(d);
};

// ===== app shell: sidebar, top bar with global plan search, keyboard shortcuts =====
// deps: { viewId: [collections it shows] }; a live change to any other collection does not re-draw that view. minGap: least ms between two re-draws.
// search: { placeholder, run: async q => [{ label, sub, href }] } replaces the header's plan search (the admin panel uses it to find members)
function layout({ brand, sub = 'Helping Hands Foundation', nav, views, alias = {}, support = false, badges = null, live = [], onLive = null, chip = null, deps = {}, minGap = 1500, search = null }) {
  const u = pb.authStore.record, ini = (u.name || u.email || '?').trim()[0].toUpperCase();
  $('#app').innerHTML = `<div class="min-h-screen lg:flex">
  <div id="ov" class="fixed inset-0 bg-slate-900/40 z-30 hidden lg:hidden"></div>
  <aside id="sb" class="fixed lg:sticky top-0 z-40 h-[100dvh] w-64 shrink-0 bg-brand-950 text-white flex flex-col -translate-x-full lg:translate-x-0 transition-transform" style="background-image:radial-gradient(28rem 18rem at 0% 0%,rgba(93,134,247,.22),transparent)">
    <a href="index.html" class="h-16 px-5 flex items-center gap-3 border-b !border-white/10"><img src="logo.png" alt="" class="w-10 h-10 rounded-lg bg-white"><span class="leading-tight"><span class="block font-semibold text-white text-[15px]">${brand}</span><span class="block text-[11px] text-brand-200/80">${sub}</span></span></a>
    <nav class="flex-1 p-3 space-y-0.5 overflow-y-auto">${nav.map(n => `<a href="#${n[0]}" data-id="${n[0]}" class="nl relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-brand-100/75 hover:bg-white/10 hover:text-white">${ic(IC[n[0]] || IC.overview)}${n[1]}<span data-b="${n[0]}" class="hidden ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-semibold items-center justify-center"></span></a>`).join('')}</nav>
    <div class="p-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:pb-3 border-t !border-white/10 space-y-0.5">${support ? `<a href="${waLink()}" target="_blank" rel="noopener" class="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-brand-100/75 hover:bg-white/10 hover:text-white"><span class="text-[#25D366]">${waIcon()}</span>Customer support</a>` : ''}<button onclick="logout()" class="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg text-brand-100/75 hover:bg-white/10 hover:text-white">${ic(IC.out)}Log out</button></div>
  </aside>
  <div class="flex-1 min-w-0">
    <header class="sticky top-0 z-20 h-16 bg-white/90 backdrop-blur border-b flex items-center gap-3 px-4 sm:px-8">
      <button id="mb" class="relative lg:hidden p-2 -ml-2 text-slate-600" aria-label="Menu">${ic(IC.menu)}<span id="mbd" class="hidden absolute top-1.5 right-1 w-2.5 h-2.5 rounded-full bg-red-600"></span></button>
      <span id="ttl" class="hidden md:block text-sm font-medium text-slate-900 w-44 shrink-0"></span>
      <div class="relative flex-1 max-w-md"><span class="absolute left-3 top-2.5 text-slate-400">${ic(IC.search)}</span><input id="gs" autocomplete="off" placeholder="${esc(search?.placeholder || 'Jump to a plan…  ( / )')}" class="${inp} pl-10 bg-slate-50"><div id="gr" class="hidden absolute left-0 right-0 top-11 bg-white border rounded-xl shadow-lg overflow-hidden divide-y"></div></div>
      <div class="ml-auto flex items-center gap-3">${chip ? '<a href="#wallet" id="wchip" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-white text-sm font-medium text-slate-700 hover:bg-slate-50" title="Your wallet"><span class="text-slate-500">Wallet</span><span id="wbal">…</span></a>' : ''}<button id="tg" onclick="toggleTheme()" class="p-2 rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Switch between light and dark mode" title="Light / dark mode">${ic(document.documentElement.classList.contains('dark') ? IC.sun : IC.moon)}</button><div class="hidden sm:block text-right leading-tight"><p class="text-sm font-medium text-slate-900">${esc(u.name || u.email)}</p><p class="text-xs text-slate-500">${u.role === 'admin' ? 'Administrator' : 'Member'}</p></div><div class="w-9 h-9 rounded-full bg-accent-400 text-brand-950 grid place-items-center text-sm font-bold">${esc(ini)}</div></div>
    </header>
    <main id="main" class="p-4 pb-28 sm:p-8 sm:pb-10 max-w-6xl mx-auto"></main>
  </div></div>${support ? `<a href="${waLink()}" target="_blank" rel="noopener" aria-label="Customer support on WhatsApp" title="Customer support" class="fixed right-4 sm:right-6 bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6 z-[25] h-14 w-14 sm:w-auto sm:px-5 rounded-full bg-[#25D366] text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition flex items-center justify-center gap-2">${waIcon('w-7 h-7')}<span class="hidden sm:inline text-sm font-semibold">Customer support</span></a>` : ''}`;
  const tog = () => { $('#sb').classList.toggle('-translate-x-full'); $('#ov').classList.toggle('hidden'); };
  $('#mb').onclick = tog; $('#ov').onclick = tog;

  let ALL = null;
  const loadAll = async () => ALL || (ALL = (await pb.collection('plans').getFullList({ sort: 'category,frequency,amount' })).filter(p => u.role === 'admin' || p.active !== false));
  const gs = $('#gs'), gr = $('#gr');
  let gt;
  if (search) gs.oninput = () => {
    clearTimeout(gt); const q = gs.value.trim(); if (!q) return gr.classList.add('hidden');
    gt = setTimeout(async () => {
      let m = []; try { m = await search.run(q); } catch (e) { }
      if (gs.value.trim() !== q) return;
      gr.innerHTML = m.length ? m.map(x => `<a href="${x.href}" class="block px-4 py-2.5 hover:bg-slate-50 text-sm"><span class="block font-medium text-slate-900 truncate">${esc(x.label)}</span>${x.sub ? `<span class="block text-xs text-slate-500 truncate">${esc(x.sub)}</span>` : ''}</a>`).join('') : '<p class="px-4 py-3 text-sm text-slate-500">No matches</p>';
      gr.classList.remove('hidden');
      gr.querySelectorAll('a').forEach(a => a.onclick = () => { gr.classList.add('hidden'); gs.value = ''; });
    }, 300);
  };
  else gs.oninput = async () => {
    const q = gs.value.trim(); if (!q) return gr.classList.add('hidden');
    const all = await loadAll(), m = all.filter(p => matchQ(p, q)).slice(0, 8);
    gr.innerHTML = m.length ? m.map(p => `<button data-id="${p.id}" class="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex justify-between gap-3 text-sm"><span class="truncate">${esc(p.name)}</span><span class="text-slate-500 whitespace-nowrap">${naira(p.amount)}/${FQ[p.frequency]}</span></button>`).join('') : '<p class="px-4 py-3 text-sm text-slate-500">No matching plans</p>';
    gr.classList.remove('hidden');
    gr.querySelectorAll('button').forEach(b => b.onclick = () => { window._pl = all; openPlan(all.findIndex(p => p.id === b.dataset.id)); gr.classList.add('hidden'); gs.value = ''; });
  };
  gs.onkeydown = e => { if (e.key === 'Enter') gr.querySelector('button,a')?.click(); if (e.key === 'Escape') { gr.classList.add('hidden'); gs.blur(); } };
  addEventListener('click', e => { if (!e.target.closest('#gs,#gr')) gr.classList.add('hidden'); });
  addEventListener('keydown', e => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName), cur = window._cur;
    if (e.key === '/' && !typing) { e.preventDefault(); ($('#pq') || gs).focus(); }
    if (!$('#dr')) return;
    if (e.key === 'Escape') closePlan();
    if (!typing && e.key === 'ArrowLeft' && cur > 0) openPlan(cur - 1);
    if (!typing && e.key === 'ArrowRight') openPlan(cur + 1);
  });
  const _open = window.openPlan; window.openPlan = i => { if ((window._pl || [])[i]) { window._cur = i; _open(i); } };

  const go = async () => {
    const [rawId, qs = ''] = (location.hash || '#' + nav[0][0]).slice(1).split('?'), v = views[rawId] ? rawId : nav[0][0], navId = alias[v] || v;
    const same = location.hash === window._lh, y = scrollY; window._view = v;                       // refresh() keeps the page where it was
    if (!same) { window._lh = location.hash; window._hf = {}; window._pg = {}; window._sel = new Set(); }                   // moving to another page forgets its filters
    document.querySelectorAll('.nl').forEach(a => { const on = a.dataset.id === navId; a.classList.toggle('bg-white/10', on); a.classList.toggle('!text-white', on); a.classList.toggle('nl-on', on); });
    $('#ttl').textContent = (nav.find(n => n[0] === navId) || nav[0])[1];
    ALL = null; closePlan(); if (!same) { scrollTo(0, 0); document.querySelectorAll('[data-ui="modal"]').forEach(x => x.remove()); }   // leaving a page closes its pop-ups
    if (!$('#ov').classList.contains('hidden')) tog();
    const m = $('#main'); if (!same) m.innerHTML = '<p class="text-sm text-slate-400">Loading…</p>';
    try { await views[v](m, new URLSearchParams(qs)); if (same) scrollTo(0, y); } catch (e) { m.innerHTML = `<p class="text-red-600 text-sm">${esc(e.message)}</p>`; }
    updBadges(); updChip();
  };
  const updChip = async () => { if (!chip) return; try { const t = await chip(); const el = $('#wbal'); if (el) el.textContent = t; } catch (e) { /* the balance chip is a convenience */ } };

  // red counters beside navigation links (e.g. pending payments) + a dot on the phone menu button + a count in the tab title
  const updBadges = async () => {
    if (!badges) return;
    try {
      const c = await badges(); let tot = 0;
      document.querySelectorAll('[data-b]').forEach(el => { const n = c[el.dataset.b] || 0; tot += n; el.textContent = n > 99 ? '99+' : n; el.classList.toggle('hidden', !n); el.classList.toggle('inline-flex', !!n); });
      $('#mbd').classList.toggle('hidden', !tot);
      document.title = (tot ? '(' + tot + ') ' : '') + document.title.replace(/^[(]\d+[)]\s*/, '');
    } catch (e) { /* counters are a convenience; never break the page */ }
  };

  // real time: PocketBase pushes every change; the page re-renders itself, but never while someone is typing or has a pop-up open
  let lt = null, bt = null, lastRun = 0;
  const jit = (a, b) => a + Math.random() * (b - a);
  const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|number|tel|email|password|url)$/.test(a.type))); };
  const busyUI = () => $('[data-ui]') || $('#dr') || typing();
  // One re-draw is scheduled at a time (later changes ride along with it), never more often than minGap, and never while typing or in a pop-up.
  const kick = (delay = jit(300, 1200)) => {
    if (lt) return;
    lt = setTimeout(function run() { if (busyUI()) { lt = setTimeout(run, 2000); return; } lt = null; lastRun = Date.now(); refresh(); }, Math.max(delay, minGap - (Date.now() - lastRun)));
  };
  const side = () => { if (bt) return; bt = setTimeout(() => { bt = null; updBadges(); updChip(); }, 1500); };   // counters and wallet chip, at most every 1.5 s
  live.forEach(c => { const p = pb.collection(c).subscribe?.('*', e => {
    try { onLive?.(c, e); } catch (x) { }
    side();
    const d = deps[window._view]; if (d && !d.includes(c)) return;                          // this page does not show that collection
    kick(c === 'plans' && u.role !== 'admin' ? jit(1000, 8000) : undefined);                // a plan change reaches every member: spread their reloads out
  }); p?.catch?.(() => { }); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(jit(500, 4000)); });   // catch up after the tab slept
  setInterval(() => { if (!document.hidden) kick(jit(0, 60000)); }, 300000);                             // safety net every ~5 min if a network blocks the live connection

  addEventListener('hashchange', go); go();
}

// ===== transaction history: payments + payouts in one list, date filters, PDF invoices and statements =====
const CO = { name: BRAND, phone: SUPPORT_PHONE + ' / ' + SUPPORT_PHONE_2, email: SUPPORT_EMAIL, tagline: TAGLINE, rc: RC_NUMBER };
const lagosDay = s => toL(parseTs(s)).toISOString().slice(0, 10);                      // YYYY-MM-DD on the Lagos calendar
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const todayL = () => lagosDay(new Date().toISOString());
const uname = x => esc(x?.name || x?.email || '—');
const ulink = x => x ? `<a href="#user?id=${x.id}" class="font-medium text-emerald-800 hover:underline">${uname(x)}</a>` : '—';

// one normalised record for a payment or a payout (payouts carry the plan's payout value as their amount)
const txFrom = (r, kind) => {
  const pay = kind === 'payment', pl = r.expand?.subscription?.expand?.plan || {};
  return { key: kind + ':' + r.id, kind, id: r.id, created: r.created, at: parseTs(r.created), status: r.status, plan: pl.name || '—', frequency: pl.frequency || '',
    amount: pay ? r.amount : (payoutOf(pl) || 0), penalty: pay ? (r.penalty || 0) : 0, late: pay ? (r.late_count || 0) : 0,
    covers: pay && pl.frequency ? plural(instOf(r, pl), pl.frequency) : '', note: r.note || '', ref: r.tx_ref || '', user: r.expand?.user || null };
};
const invNo = t => (t.kind === 'payment' ? 'INV' : 'PAYOUT') + '-' + lagosDay(t.created).replace(/-/g, '') + '-' + String(t.id).slice(-5).toUpperCase();
window.TX = {};

// jsPDF is fetched only when someone asks for a PDF; pdf.js (this folder) draws the documents
let _logo;
const logoData = () => _logo || (_logo = fetch('logo.png').then(r => r.blob()).then(b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); })).catch(() => null));
const loadPDF = async () => {
  if (!window.jspdf) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF tool. Check your internet connection and try again.')); document.head.appendChild(s); });
  return window.jspdf.jsPDF;
};
window.dlInvoice = async key => {
  const t = TX[key]; if (!t) return;
  try { toast('Preparing your PDF…'); const [J, logo] = await Promise.all([loadPDF(), logoData()]); buildInvoice(J, t, t.user || window.TXCUST || {}, logo, CO).save(t.no + '.pdf'); }
  catch (e) { toast(e.message, 1); }
};

// o: { txs, cust (the member the history belongs to, or null for everyone), showUser, key (remembers filters across refreshes), extra(t) (extra action buttons), kinds,
//      remote: async (F, page, per) => ({ txs, total })  -> filters run on the server and only one page is downloaded (used for large lists) }
function txHistory(m, o) {
  const { txs = [], cust = null, showUser = false, key = 'tx', extra = () => '', kinds = ['payment', 'payout'], remote = null } = o, multi = kinds.length > 1, PER = 50;
  const reg = l => l.forEach(t => { t.no = invNo(t); TX[t.key] = t; });
  window.TXCUST = cust; reg(txs);
  if (!remote && !txs.length) { m.innerHTML = table([], []); return; }
  window._hf = window._hf || {};
  const F = window._hf[key] || (window._hf[key] = { from: '', to: '', status: 'all', kind: 'all', q: '' });
  const PRE = { all: ['All time', () => ['', '']], today: ['Today', () => [todayL(), todayL()]], 7: ['Last 7 days', () => [addDays(todayL(), -6), todayL()]], 30: ['Last 30 days', () => [addDays(todayL(), -29), todayL()]], month: ['This month', () => [todayL().slice(0, 8) + '01', todayL()]] };
  const lab = 'block text-xs font-medium text-slate-500';
  m.innerHTML = `<div class="bg-white border rounded-xl p-4 mb-4 space-y-3">
    <div id="hp" class="flex gap-1.5 overflow-x-auto pb-0.5">${Object.entries(PRE).map(([k, v]) => `<button type="button" data-p="${k}" class="whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium border">${v[0]}</button>`).join('')}</div>
    <div class="grid grid-cols-2 ${multi ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-2">
      <label class="${lab}">From<input id="hf" type="date" value="${F.from}" class="${inp} mt-1"></label>
      <label class="${lab}">To<input id="ht" type="date" value="${F.to}" class="${inp} mt-1"></label>
      ${multi ? `<label class="${lab}">Type<select id="hk" class="${inp} mt-1">${opts({ all: 'All types', payment: 'Payments', payout: 'Payouts' }, F.kind)}</select></label>` : ''}
      <label class="${lab}">Status<select id="hs" class="${inp} mt-1">${opts({ all: 'All statuses', pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected' }, F.status)}</select></label>
    </div>
    <div class="flex flex-wrap items-center gap-3"><div class="relative flex-1 min-w-[200px]"><span class="absolute left-3 top-2.5 text-slate-400">${ic(IC.search)}</span><input id="hq" value="${esc(F.q)}" placeholder="Search plan, reference or invoice no…" class="${inp} pl-10"></div><button type="button" id="hx" class="text-sm font-medium text-emerald-800 hover:underline">Clear filters</button></div></div>
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3"><p id="hc" class="text-sm text-slate-500"></p><button type="button" id="hd" class="${btn2}">Download statement (PDF)</button></div><div id="hr"></div>`;
  const heads = ['Date', ...(showUser ? ['Member'] : []), ...(multi ? ['Type'] : []), 'Plan', 'Amount', 'Covers', 'Penalty', 'Note', 'Status', ''];
  const row = t => [date(t.created), ...(showUser ? [ulink(t.user)] : []), ...(multi ? [t.kind === 'payment' ? 'Payment' : 'Payout'] : []), esc(t.plan), naira(t.amount), t.covers || '—', t.penalty ? penBadge({ penalty: t.penalty }) : '—', esc(t.note) || '—', badge(t.status),
    extra(t) + `<button type="button" onclick="dlInvoice('${t.key}')" class="px-2.5 py-1 text-xs rounded-md border font-medium bg-white text-slate-700 hover:bg-slate-50">${t.kind === 'payment' ? 'Invoice' : 'Receipt'} (PDF)</button>`];
  let cur = [], page = 1, seq = 0;
  const paintRemote = async () => {
    const my = ++seq; $('#hr').innerHTML = '<p class="text-sm text-slate-400 py-6">Loading…</p>';
    let r; try { r = await remote(F, page, PER); } catch (e) { if (my === seq) $('#hr').innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`; return; }
    if (my !== seq) return;                                    // a newer search has started
    reg(r.txs); cur = r.txs; const pages = Math.max(1, Math.ceil(r.total / PER));
    document.querySelectorAll('#hp button').forEach(b => { const [f, t] = PRE[b.dataset.p][1](), on = f === F.from && t === F.to; b.className = 'whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium border ' + (on ? 'bg-emerald-800 text-white border-emerald-800' : 'bg-white text-slate-600 hover:bg-slate-100'); });
    $('#hc').innerHTML = `<b class="text-slate-700">${r.total.toLocaleString()}</b> transactions match`;
    $('#hr').innerHTML = (cur.length ? table(heads, cur.map(row)) : '<div class="bg-white border border-dashed rounded-xl p-10 text-center text-slate-500 text-sm">No transactions match. Try a wider date range or clear the filters.</div>')
      + (r.total > PER ? `<div class="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-slate-500"><span>Page ${page} of ${pages.toLocaleString()}</span><span class="flex gap-2"><button data-pg="${page - 1}" ${page > 1 ? '' : 'disabled'} class="${pgBtn}">← Previous</button><button data-pg="${page + 1}" ${page < pages ? '' : 'disabled'} class="${pgBtn}">Next →</button></span></div>` : '');
    $('#hr').querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { page = +b.dataset.pg; paintRemote(); });
  };
  let qt;
  const paint = (fromSearch) => {
    if (remote) { page = 1; clearTimeout(qt); if (fromSearch) qt = setTimeout(paintRemote, 350); else paintRemote(); return; }
    const q = F.q.trim().toLowerCase();
    cur = txs.filter(t => { const d = lagosDay(t.created); return (!F.from || d >= F.from) && (!F.to || d <= F.to) && (F.status === 'all' || t.status === F.status) && (F.kind === 'all' || t.kind === F.kind) && (!q || [t.plan, t.note, t.no, t.user?.name, t.user?.email].join(' ').toLowerCase().includes(q)); });
    document.querySelectorAll('#hp button').forEach(b => { const [f, t] = PRE[b.dataset.p][1](), on = f === F.from && t === F.to; b.className = 'whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium border ' + (on ? 'bg-emerald-800 text-white border-emerald-800' : 'bg-white text-slate-600 hover:bg-slate-100'); });
    const saved = cur.filter(t => t.kind === 'payment' && t.status === 'confirmed').reduce((a, t) => a + t.amount - t.penalty, 0);
    $('#hc').innerHTML = `<b class="text-slate-700">${cur.length}</b> of ${txs.length} transactions` + (cur.some(t => t.kind === 'payment') ? ` · Confirmed savings <b class="text-slate-700">${naira(saved)}</b>` : '');
    $('#hr').innerHTML = cur.length ? table(heads, cur.map(row)) : '<div class="bg-white border border-dashed rounded-xl p-10 text-center text-slate-500 text-sm">No transactions match. Try a wider date range or clear the filters.</div>';
  };
  $('#hp').onclick = e => { const b = e.target.closest('button'); if (!b) return; [F.from, F.to] = PRE[b.dataset.p][1](); $('#hf').value = F.from; $('#ht').value = F.to; paint(); };
  $('#hf').onchange = e => { F.from = e.target.value; if (F.to && F.from > F.to) { F.to = F.from; $('#ht').value = F.to; } paint(); };
  $('#ht').onchange = e => { F.to = e.target.value; if (F.from && F.from > F.to && F.to) { F.from = F.to; $('#hf').value = F.from; } paint(); };
  $('#hs').onchange = e => { F.status = e.target.value; paint(); };
  if (multi) $('#hk').onchange = e => { F.kind = e.target.value; paint(); };
  $('#hq').oninput = e => { F.q = e.target.value; paint(true); };
  $('#hx').onclick = () => { Object.assign(F, { from: '', to: '', status: 'all', kind: 'all', q: '' }); txHistory(m, o); };
  $('#hd').onclick = async () => {
    let list = cur;
    try {
      if (remote) {                                              // the statement covers every match, not just this page (up to 5,000)
        toast('Gathering transactions…'); const r = await remote(F, 1, 5000); list = r.txs; reg(list);
        if (r.total > 5000) toast('Only the first 5,000 transactions fit in one statement. Narrow the dates for the rest.', 1, 6000);
      }
      if (!list.length) return toast('There are no transactions in this range to download.', 1);
      toast('Preparing your PDF…'); const [J, logo] = await Promise.all([loadPDF(), logoData()]);
      buildStatement(J, { txs: list, cust, showUser, from: F.from, to: F.to }, logo, CO).save('Statement-' + (cust?.name || 'all-members').replace(/[^a-z0-9]+/gi, '-') + '-' + todayL() + '.pdf');
    } catch (e) { toast(e.message, 1); }
  };
  paint();
}
