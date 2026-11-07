// Frontend-only demo backend: mimics the PocketBase calls the pages use, stored in localStorage.
function createMockPB() {
  const mem = {};
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return mem[k] ?? null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }, del: k => { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } } };
  const KEY = 'jjhhf_db_v1', REL = { user: 'users', plan: 'plans', subscription: 'subscriptions' };
  let db = JSON.parse(ls.get(KEY) || 'null');
  const save = () => ls.set(KEY, JSON.stringify(db));
  // real-time emulation: listeners per collection; other open tabs are told through a BroadcastChannel
  const L = {}, bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('jjhhf_mock') : null;
  const fire = (c, action, record) => (L[c] || []).forEach(cb => setTimeout(() => cb({ action, record }), 0));
  const emit = (c, action, record) => { fire(c, action, record); if (bc) bc.postMessage({ c, action, record }); };
  if (bc) bc.onmessage = e => { db = JSON.parse(ls.get(KEY) || 'null') || db; fire(e.data.c, e.data.action, e.data.record); };
  const uid = () => Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  const now = (age = 0) => new Date(Date.now() - age * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  const add = (c, o, age = 0) => { const r = { id: uid(), created: now(age), ...o }; db[c].push(r); return r; };
  if (!db) {
    db = { users: [], plans: [], subscriptions: [], payments: [], payouts: [], fees: [], wallet_txs: [] };
    add('users', { email: 'admin@jjhhf.test', password: 'admin12345', name: 'JJHHF Admin', country: 'Nigeria', phone: '08026701578', role: 'admin', shirt_paid: true }, 60);
    const u = add('users', { email: 'user@jjhhf.test', password: 'user12345', name: 'Ada Okafor', country: 'Nigeria', phone: '08012345678', role: 'user', shirt_paid: true }, 40);
    add('users', { email: 'chidi@example.com', password: 'pass12345', name: 'Chidi Eze', country: 'Ghana', phone: '0244000111', role: 'user', shirt_paid: false }, 15);
    const n = a => '₦' + a.toLocaleString();
    [['Grocery Plan 1', 250, ' 50kg Rice, 5L Groundnut Oil, 1 Carton of Indomitable'], ['Grocery Plan 2', 500, '2 Bags of 50kg Rice, 10kg Semo, 5L Groundnut Oil, 1 Carton of Indomitable, 2 Packets of Knorr Cubes'], ['Grocery Plan 3', 800, '3 Bags of 50kg Rice, 5L Groundnut Oil, 3 Cartons of Indomitable, 2 Cartons of Spaghetti, 2 Packets of Knorr Cubes'], ['Grocery Plan 4', 1000, '4 Bags of 50kg Rice, 10kg Groundnut Oil, 10kg Semo, 4 Cartons of Indomitable, 1 Carton of Spaghetti']]
      .forEach(([name, a, d]) => add('plans', { name, category: 'grocery', frequency: 'daily', amount: a, duration: 365, payout: a * 365, description: d.trim(), active: true }, 50));
    [['daily', 365, [100, 200, 300, 400, 500, 1000, 1500, 2000, 2500, 3000]], ['weekly', 53, [500, 1000, 1500, 2000, 2500, 3000]], ['monthly', 12, [2000, 2500, 3000, 5000, 10000, 15000, 20000]]]
      .forEach(([f, d, l]) => l.forEach(a => add('plans', { name: f[0].toUpperCase() + f.slice(1) + ' Savings ' + n(a), category: 'cash', frequency: f, amount: a, duration: d, payout: a * d, description: '', active: true }, 50)));
    const pl = nm => db.plans.find(p => p.name === nm).id;
    const s1 = add('subscriptions', { user: u.id, plan: pl('Daily Savings ₦500'), status: 'active' }, 11);
    const s2 = add('subscriptions', { user: u.id, plan: pl('Grocery Plan 2'), status: 'active' }, 3);
    // s1: 12 instalments covered; payment #10 was made after the deadline, so it carries a ₦500 penalty
    for (let i = 0; i < 12; i++) { const late = i === 10; add('payments', { user: u.id, subscription: s1.id, amount: late ? 1000 : 500, penalty: late ? 500 : 0, installments: 1, late_count: late ? 1 : 0, note: 'TRF' + (1000 + i), status: i < 10 ? 'confirmed' : 'pending' }, 11 - i); }
    for (let i = 0; i < 4; i++) add('payments', { user: u.id, subscription: s2.id, amount: 500, penalty: 0, installments: 1, late_count: 0, note: 'TRF' + (2000 + i), status: 'confirmed' }, 3 - i);
    save();
  }
  if (!db.fees) { db.fees = []; db.users.forEach(u => { if (u.shirt_paid === undefined) u.shirt_paid = true; }); save(); }   // demo data saved before fees existed
  if (!db.wallet_txs) { db.wallet_txs = []; db.users.forEach(u => { if (u.wallet_balance === undefined) u.wallet_balance = u.email === 'user@jjhhf.test' ? 20000 : 0; }); save(); }   // demo data saved before wallets existed
  const test = (r, f) => !f || f.split('&&').every(c => { const m = c.trim().match(/^(\w+)\s*=\s*(?:"([^"]*)"|(true|false))$/); if (!m) return true; return r[m[1]] === (m[2] !== undefined ? m[2] : m[3] === 'true'); });
  const sortBy = (l, s) => { const k = (s || '-created').split(','); return [...l].sort((a, b) => { for (let x of k) { x = x.trim(); const d = x[0] === '-', f = d ? x.slice(1) : x; if (a[f] < b[f]) return d ? 1 : -1; if (a[f] > b[f]) return d ? -1 : 1; } return 0; }); };
  const expand = (r, paths) => { if (!paths) return r; const o = { ...r, expand: {} }; paths.split(',').forEach(p => { const [f, ...rest] = p.trim().split('.'); const x = db[REL[f]].find(z => z.id === r[f]); if (x) o.expand[f] = rest.length ? expand(x, rest.join('.')) : x; }); return o; };
  let aid = null; try { const a = JSON.parse(ls.get('pocketbase_auth') || 'null'); aid = a && a.model && a.model.id; } catch (e) {}
  const authStore = { get model() { return db.users.find(u => u.id === aid) || null; }, get record() { return this.model; }, get isValid() { return !!this.model; }, clear() { aid = null; ls.del('pocketbase_auth'); } };
  const list = (c, o = {}) => sortBy(db[c].filter(r => test(r, o.filter)), o.sort).map(r => expand(r, o.expand));
  const col = c => ({
    async getFullList(o) { return list(c, o); },
    async getList(p, n, o) { const l = list(c, o); return { items: l.slice((p - 1) * n, p * n), totalItems: l.length, page: p, perPage: n }; },
    async getOne(id) { const r = db[c].find(x => x.id === id); if (!r) throw new Error('Record not found.'); return r; },
    async create(d) {
      d = { ...d }; delete d.passwordConfirm;
      if (c === 'users') { if (db.users.some(u => u.email === d.email)) throw new Error('That email is already registered.'); if (!d.terms_accepted) throw new Error('You must accept the Terms and Conditions to create an account.'); d.role = 'user'; d.shirt_paid = false; d.terms_accepted_at = now(); }
      const r = { id: uid(), created: now(), ...d }; db[c].push(r); save(); emit(c, 'create', r); return r;
    },
    async update(id, d) { const r = db[c].find(x => x.id === id); if (!r) throw new Error('Record not found.'); Object.assign(r, d); save(); emit(c, 'update', r); return r; },
    async delete(id) {
      const r = db[c].find(x => x.id === id);
      if (c === 'plans' && db.subscriptions.some(x => x.plan === id)) throw new Error('Failed to delete record. Make sure that the record is not part of a required relation reference.');
      db[c] = db[c].filter(x => x.id !== id); save(); if (r) emit(c, 'delete', r); return true;
    },
    async subscribe(topic, cb) { (L[c] = L[c] || []).push(cb); return () => { L[c] = (L[c] || []).filter(x => x !== cb); }; },
    async unsubscribe() { L[c] = []; },
    async authRefresh() { return { record: authStore.model }; },
    async authWithPassword(e, p) {
      const u = db.users.find(x => x.email === e && x.password === p); if (!u) throw new Error('Invalid email or password.');
      aid = u.id; ls.set('pocketbase_auth', JSON.stringify({ token: 'mock', model: { id: u.id, role: u.role } })); return { record: u };
    }
  });
  // ---- demo stand-in for the server's wallet routes (the real logic lives in pb_hooks/wallet.js) ----
  const post = (uidv, amount, kind, note, extra = {}) => {
    const u = db.users.find(x => x.id === uidv), bal = (u.wallet_balance || 0) + amount;
    if (bal < 0) throw new Error('Not enough money in your wallet.');
    u.wallet_balance = bal; emit('users', 'update', u);
    const t = { id: uid(), created: now(), user: uidv, type: amount >= 0 ? 'credit' : 'debit', amount: Math.abs(amount), balance: bal, kind, note: note || '', ...extra };
    db.wallet_txs.push(t); emit('wallet_txs', 'create', t); return bal;
  };
  const collect = uidv => {
    const t = new Date(), items = db.subscriptions.filter(s => s.user === uidv && s.status === 'active').map(s => ({ sub: s, pl: db.plans.find(p => p.id === s.plan), blocked: false })).filter(i => i.pl);
    for (;;) {
      let best = null, bd = null;
      items.forEach(i => { if (i.blocked) return; const st = planState(i.sub, i.pl, db.payments.filter(p => p.subscription === i.sub.id), t); if (!st.left || collectAt(i.sub, i.pl, st.paid) > t) return; if (!best || st.next < bd) { best = i; bd = st.next; } });
      if (!best) break;
      const st = planState(best.sub, best.pl, db.payments.filter(p => p.subscription === best.sub.id), t), cost = st.cost(0), late = st.overdue > 0;
      if ((db.users.find(x => x.id === uidv).wallet_balance || 0) < cost) { best.blocked = true; continue; }
      const p = { id: uid(), created: now(), user: uidv, subscription: best.sub.id, amount: cost, penalty: late ? st.pen : 0, installments: 1, late_count: late ? 1 : 0, note: 'Wallet' + (late ? ' · late' : ''), status: 'confirmed' };
      db.payments.push(p); emit('payments', 'create', p);
      post(uidv, -cost, 'contribution', best.pl.name + (late ? ' (late)' : ''), { plan: best.pl.id, subscription: best.sub.id });
    }
    save();
  };
  const send = async (path, o = {}) => {
    const b = o.body || {};
    const me = db.users.find(u => u.id === aid), NEED = 'Please pay the one-time ₦5,000 t-shirt fee before you request a payout.', n = x => '₦' + Number(x).toLocaleString();
    if (path.endsWith('/admin/stats')) {                 // same totals the real server works out with SQL
      const U = db.users, M = U.filter(u => u.role !== 'admin'), P = db.payments, sum = (l, f) => l.reduce((x, r) => x + (+r[f] || 0), 0), conf = P.filter(p => p.status === 'confirmed'), tops = (db.wallet_txs || []).filter(t => t.kind === 'topup');
      const reg = M.filter(u => u.shirt_paid).length;
      return { users: U.length, members: M.length, registered: reg, unregistered: M.length - reg, withAccount: M.filter(u => u.va_number).length, admins: U.length - M.length, held: sum(U, 'wallet_balance'), subscriptions: db.subscriptions.length, activeSubscriptions: db.subscriptions.filter(x => x.status === 'active').length, pendingPayments: P.filter(p => p.status === 'pending').length, confirmedTotal: sum(conf, 'amount'), penalties: sum(conf, 'penalty'), fees: sum((db.fees || []).filter(f => f.status === 'confirmed'), 'amount'), pendingPayouts: db.payouts.filter(p => p.status === 'pending').length, plans: db.plans.length, topups: tops.length, topupTotal: sum(tops, 'amount') };
    }
    if (path.endsWith('/wallet/account')) {
      if (!/^\d{11}$/.test(String(b.id_number || ''))) throw new Error('Enter your 11-digit ' + String(b.id_type || 'bvn').toUpperCase() + '.');
      if (!me.va_number) { me.va_number = '9' + Math.floor(Math.random() * 1e9).toString().padStart(9, '0'); me.va_bank = 'Demo Bank'; me.va_ref = 'JJHHF-VA-' + me.id; save(); }
      return { number: me.va_number, bank: me.va_bank };
    }
    if (path.endsWith('/wallet/demo-topup')) {            // demo only: pretend a bank transfer arrived
      post(aid, +b.amount, 'topup', 'Bank transfer (demo)', { ref: 'DEMO-' + uid() }); collect(aid); save(); return { ok: true };
    }
    if (path.endsWith('/wallet/credit')) {
      if (me.role !== 'admin') throw new Error('Admins only.');
      post(b.user, +b.amount, 'topup', 'Credited by admin · ' + b.ref, { ref: 'MANUAL-' + b.ref }); collect(b.user); save(); return { ok: true };
    }
    if (path.endsWith('/fee/pay')) {
      const t = b.type, amt = { shirt: 5000, join: 3000, clearance: 3000 }[t];
      if (!amt) throw new Error('Unknown fee.');
      const short = need => { const bal = me.wallet_balance || 0; if (bal < need) throw new Error('Your wallet needs ' + n(need) + ' for this. You have ' + n(bal) + '. Please top up ' + n(need - bal) + '.'); };
      let out = {};
      if (t === 'shirt') { if (me.shirt_paid) throw new Error('You have already paid the t-shirt fee.'); short(amt); post(aid, -amt, 'shirt', 'T-shirt registration fee'); me.shirt_paid = true; me.shirt_paid_at = now(); emit('users', 'update', me); }
      else if (t === 'join') {
        const pl = db.plans.find(p => p.id === b.plan); if (!pl || pl.active === false) throw new Error('That plan is not open for enrolment.');
        const s = { id: uid(), created: now(), user: aid, plan: pl.id, status: 'active' }, c = catchupCount(s, pl), total = amt + c * pl.amount;
        short(total);
        db.subscriptions.push(s); emit('subscriptions', 'create', s);
        post(aid, -amt, 'join', 'Joining fee · ' + pl.name, { plan: pl.id, subscription: s.id });
        if (c) { const p = { id: uid(), created: now(), user: aid, subscription: s.id, amount: c * pl.amount, penalty: 0, installments: c, late_count: 0, note: 'Catch-up · ' + c + ' instalments', status: 'confirmed' }; db.payments.push(p); emit('payments', 'create', p); post(aid, -c * pl.amount, 'catchup', 'Catch-up · ' + pl.name, { plan: pl.id, subscription: s.id }); }
        out = { subscription: s.id, catchup: c * pl.amount, instalments: c }; collect(aid);
      } else {
        const planOf = s => db.plans.find(p => p.id === s.plan) || {};
        if (!runningOthers(db.subscriptions.filter(s => s.user === aid), b.subscription, planOf).length) throw new Error(PAYOUT_NEEDS_PLAN);
        if (!me.shirt_paid) throw new Error(NEED);
        if (!String(b.details || '').trim()) throw new Error('Enter your delivery or bank details.');
        short(amt); post(aid, -amt, 'clearance', 'Payout clearance fee', { subscription: b.subscription });
        const p = { id: uid(), created: now(), user: aid, subscription: b.subscription, note: b.details, status: 'pending' }; db.payouts.push(p); emit('payouts', 'create', p);
      }
      if (t !== 'join') { const f = { id: uid(), created: now(), user: aid, type: t, amount: amt, status: 'confirmed', plan: b.plan || '', subscription: b.subscription || '', details: b.details || '', note: 'Wallet' }; db.fees.push(f); emit('fees', 'create', f); }
      else { const f = { id: uid(), created: now(), user: aid, type: 'join', amount: amt, status: 'confirmed', plan: b.plan, subscription: out.subscription, note: 'Wallet' }; db.fees.push(f); emit('fees', 'create', f); }
      save(); return out;
    }
    return { status: 'confirmed' };
  };
  const filter = (expr, params = {}) => expr.replace(/\{:(\w+)\}/g, (_, k) => JSON.stringify(String(params[k] ?? '')));   // same as pb.filter (the demo ignores complex filters)
  return { collection: col, authStore, send, filter };
}
