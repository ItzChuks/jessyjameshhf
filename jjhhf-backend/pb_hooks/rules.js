// Server-side copy of the payment rules in app.js (RULES, firstDue, dueAt, sched, planState).
// KEEP IN SYNC with app.js: if you change RULES or the season there, change it here too.
//
// Two kinds of plan:
//   * grocery plans run from the moment the member joins (first deadline is worked out from the join time);
//   * cash and foodie plans are SEASONAL: the saving season is fixed, 1 January to 30 November. A member who joins
//     mid-season owes the instalments whose deadline has already passed (the "catch-up", no penalty) when they join.
const RULES = { cutoffHour: 12, lateMultiplier: 2, weeklyDay: 5, monthlyGraceDay: 2 };
const SEASON = { endMonth: 10 /* November (0-based) */, endDay: 30 };
const LAGOS = 1;
const toL = d => new Date(d.getTime() + LAGOS * 36e5);
const fromL = (y, m, d, h = 0, mi = 0, s = 0) => new Date(Date.UTC(y, m, d, h, mi, s) - LAGOS * 36e5);
const parseTs = s => { if (s instanceof Date) return s; const t = String(s).trim().replace(' ', 'T'); return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(t) ? t : t + 'Z'); };

function firstDue(freq, joined) {
  const L = toL(joined), y = L.getUTCFullYear(), m = L.getUTCMonth(), d = L.getUTCDate();
  if (freq === 'daily') { const t = fromL(y, m, d, RULES.cutoffHour); return joined < t ? t : fromL(y, m, d + 1, RULES.cutoffHour); }
  if (freq === 'weekly') { const add = (RULES.weeklyDay - L.getUTCDay() + 7) % 7; let t = fromL(y, m, d + add, RULES.cutoffHour); if (joined >= t) t = fromL(y, m, d + add + 7, RULES.cutoffHour); return t; }
  return fromL(y, m + 1, RULES.monthlyGraceDay, 23, 59, 59);
}
function dueAt(freq, first, i) {
  const L = toL(first), y = L.getUTCFullYear(), m = L.getUTCMonth(), d = L.getUTCDate();
  if (freq === 'daily') return fromL(y, m, d + i, RULES.cutoffHour);
  if (freq === 'weekly') return fromL(y, m, d + 7 * i, RULES.cutoffHour);
  return fromL(y, m + i, RULES.monthlyGraceDay, 23, 59, 59);
}
const instOf = (p, pl) => p.installments || Math.max(1, Math.round(((p.amount || 0) - (p.penalty || 0)) / (pl.amount || 1)));

// ---- seasons (cash and foodie) ----
const isSeasonal = pl => pl.category === 'cash' || pl.category === 'foodie';
function seasonFirst(freq, y) {
  if (freq === 'daily') return fromL(y, 0, 1, RULES.cutoffHour);
  if (freq === 'weekly') { const w = new Date(Date.UTC(y, 0, 1)).getUTCDay(); return fromL(y, 0, 1 + (RULES.weeklyDay - w + 7) % 7, RULES.cutoffHour); }
  return fromL(y, 1, RULES.monthlyGraceDay, 23, 59, 59);          // January's instalment, due 2 February
}
function seasonCount(freq, y) {
  const days = Math.round((Date.UTC(y, SEASON.endMonth, SEASON.endDay) - Date.UTC(y, 0, 1)) / 864e5);   // days from 1 Jan to 30 Nov
  if (freq === 'daily') return days + 1;
  if (freq === 'weekly') { const w = new Date(Date.UTC(y, 0, 1)).getUTCDay(), add = (RULES.weeklyDay - w + 7) % 7; return Math.floor((days - add) / 7) + 1; }
  return SEASON.endMonth + 1;                                       // 11 months
}
// the season a member joining at "joined" belongs to: this year's, unless every instalment of it is already due
function seasonYear(freq, joined) {
  const y = toL(joined).getUTCFullYear();
  return dueAt(freq, seasonFirst(freq, y), seasonCount(freq, y) - 1) > joined ? y : y + 1;
}
// the schedule of one subscription: { first, n (number of instalments), due(i) }
function sched(sub, pl) {
  const f = pl.frequency, joined = parseTs(sub.created);
  if (!isSeasonal(pl)) { const first = firstDue(f, joined); return { first, n: pl.duration, due: i => dueAt(f, first, i) }; }
  const y = seasonYear(f, joined), first = seasonFirst(f, y);
  return { first, n: seasonCount(f, y), due: i => dueAt(f, first, i), season: y };
}
// instalments whose deadline has already passed at the moment of joining = the catch-up a seasonal joiner owes
const catchupCount = (sub, pl) => { if (!isSeasonal(pl)) return 0; const S = sched(sub, pl), t = parseTs(sub.created); let c = 0; while (c < S.n && S.due(c) <= t) c++; return c; };

// when an instalment may be collected from the wallet: from the start of its period (it is late only after its deadline)
function collectFrom(freq, due) {
  const L = toL(due), y = L.getUTCFullYear(), m = L.getUTCMonth(), d = L.getUTCDate();
  if (freq === 'daily') return fromL(y, m, d, 0);
  if (freq === 'weekly') return fromL(y, m, d - 4, 0);              // Monday 00:00 of the due week
  return fromL(y, m, 1, 0);                                         // the 1st of the month the deadline falls in
}

// the moment instalment i becomes collectable for a subscription (never before the season's 1 January)
function collectAt(sub, pl, i) {
  const S = sched(sub, pl), t = collectFrom(pl.frequency, S.due(i));
  if (!S.season) return t;
  const start = fromL(S.season, 0, 1, 0);
  return t < start ? start : t;
}

function stateFromPaid(sub, pl, paid, now = new Date()) {
  const A = pl.amount, pen = A * (RULES.lateMultiplier - 1), S = sched(sub, pl), due = S.due;
  const left = Math.max(0, S.n - paid);
  let overdue = 0; while (overdue < left && due(paid + overdue) <= now) overdue++;
  return { A, pen, paid, left, duration: S.n, due, overdue, next: left ? due(paid) : null, cost: k => A + (k < overdue ? pen : 0) };
}
function planState(sub, pl, pays, now = new Date()) {
  const paid = pays.filter(p => p.subscription === sub.id && p.status !== 'rejected').reduce((a, p) => a + instOf(p, pl), 0);
  return stateFromPaid(sub, pl, paid, now);
}

// when a plan's saving period ends = the deadline of its last instalment (payouts open after this moment)
const termEnd = (sub, pl) => { const S = sched(sub, pl); return S.due(S.n - 1); };
// plain object from a PocketBase plan record
const planObj = r => ({ amount: r.getFloat("amount"), duration: r.getInt("duration"), frequency: r.getString("frequency"), category: r.getString("category"), name: r.getString("name") });

module.exports = { RULES, parseTs, isSeasonal, sched, catchupCount, collectFrom, collectAt, stateFromPaid, planState, termEnd, planObj, instOf, seasonCount, seasonYear, seasonFirst, dueAt };
