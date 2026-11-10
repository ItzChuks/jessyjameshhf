// Frontend-only demo backend: mimics the PocketBase calls the pages use, stored in localStorage.
function createMockPB() {
  const mem = {};
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return mem[k] ?? null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }, del: k => { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } } };
  const KEY = 'jjhhf_db_v3', REL = { user: 'users', plan: 'plans', subscription: 'subscriptions', code_used_by: 'users' };
  let db = JSON.parse(ls.get(KEY) || 'null');
  const save = () => ls.set(KEY, JSON.stringify(db));
  // real-time emulation: listeners per collection; other open tabs are told through a BroadcastChannel
  const L = {}, bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('jjhhf_mock') : null;
  const fire = (c, action, record) => (L[c] || []).forEach(cb => setTimeout(() => cb({ action, record }), 0));
  const emit = (c, action, record) => { fire(c, action, record); if (bc) bc.postMessage({ c, action, record }); };
  if (bc) bc.onmessage = e => { db = JSON.parse(ls.get(KEY) || 'null') || db; fire(e.data.c, e.data.action, e.data.record); };
  const mToL = d => new Date(d.getTime() + 36e5), mFromL = (y, m, d, h = 0) => new Date(Date.UTC(y, m, d, h) - 36e5), mTs = x => new Date(String(x).replace(' ', 'T') + (/Z$/.test(String(x)) ? '' : 'Z'));   // Lagos date helpers (app.js loads later)
  const uid = () => Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  const now = (age = 0) => new Date(Date.now() - age * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  const add = (c, o, age = 0) => { const r = { id: uid(), created: now(age), ...o }; db[c].push(r); return r; };
  if (!db) {
    db = { users: [], plans: [], subscriptions: [], payments: [], payouts: [], fees: [], wallet_txs: [], deposits: [] };
    add('users', { email: 'admin@jjhhf.test', password: 'admin12345', name: 'JJHHF Admin', country: 'Nigeria', phone: '08026701578', role: 'admin', shirt_paid: true }, 60);
    const u = add('users', { email: 'user@jjhhf.test', password: 'user12345', name: 'Ada Okafor', country: 'Nigeria', phone: '08012345678', role: 'user', shirt_paid: true }, 40);
    add('users', { email: 'chidi@example.com', password: 'pass12345', name: 'Chidi Eze', country: 'Ghana', phone: '0244000111', role: 'user', shirt_paid: false }, 15);
    // grocery plans of 4, 8, 12 and 25 weeks (code usable from day 4 to day 7 after joining)
    [[4, 2000], [8, 2000], [12, 1500], [25, 1000]].forEach(([w, a]) => add('plans', { name: 'Grocery ' + w + ' weeks', category: 'grocery', frequency: 'weekly', amount: a, weeks: w, duration: w, payout: a * w, payout_after_days: Math.round(w * 7.5), description: 'Rice, oil, semo and noodles', code_from_day: 4, code_until_day: 7, active: true }, 50));
    add('plans', { name: 'Daily grocery 4 weeks', category: 'grocery', frequency: 'daily', amount: 300, weeks: 4, duration: 28, payout: 8400, description: '', code_from_day: 3, code_until_day: 6, active: true }, 50);
    const pl = nm => db.plans.find(p => p.name === nm);
    const mk = (p, age) => { const s = add('subscriptions', { user: u.id, plan: p.id, status: 'active' }, age); const L = mToL(mTs(s.created)), y = L.getUTCFullYear(), m = L.getUTCMonth(), d = L.getUTCDate(); s.code = 'JJ-DEMO-' + String(age).padStart(4, '0').slice(-4); s.code_from = mFromL(y, m, d + p.code_from_day - 1).toISOString().replace('T', ' '); s.code_until = mFromL(y, m, d + p.code_until_day).toISOString().replace('T', ' '); return s; };
    const s1 = mk(pl('Grocery 8 weeks'), 20), s2 = mk(pl('Daily grocery 4 weeks'), 4);
    for (let i = 0; i < 3; i++) add('payments', { user: u.id, subscription: s1.id, amount: 2000, penalty: 0, installments: 1, late_count: 0, note: 'Wallet', status: 'confirmed' }, 20 - i * 7);
    for (let i = 0; i < 4; i++) add('payments', { user: u.id, subscription: s2.id, amount: 300, penalty: 0, installments: 1, late_count: 0, note: 'Wallet', status: 'confirmed' }, 4 - i);
    save();
  }
  if (!db.deposits) { db.deposits = []; save(); }
  if (!db.fees) { db.fees = []; db.users.forEach(u => { if (u.shirt_paid === undefined) u.shirt_paid = true; }); save(); }   // demo data saved before fees existed
  if (!db.wallet_txs) { db.wallet_txs = []; db.users.forEach(u => { if (u.wallet_balance === undefined) u.wallet_balance = u.email === 'user@jjhhf.test' ? 20000 : 0; }); save(); }   // demo data saved before wallets existed
  const test = (r, f) => !f || f.split('&&').every(c => { const m = c.trim().match(/^(\w+)\s*=\s*(?:"([^"]*)"|(true|false))$/); if (!m) return true; return m[2] !== undefined ? (r[m[1]] ?? '') === m[2] : !!r[m[1]] === (m[3] === 'true'); });
  const sortBy = (l, s) => { const k = (s || '-created').split(','); return [...l].sort((a, b) => { for (let x of k) { x = x.trim(); const d = x[0] === '-', f = d ? x.slice(1) : x; if (a[f] < b[f]) return d ? 1 : -1; if (a[f] > b[f]) return d ? -1 : 1; } return 0; }); };
  const expand = (r, paths) => { if (!paths) return r; const o = { ...r, expand: {} }; paths.split(',').forEach(p => { const [f, ...rest] = p.trim().split('.'); const x = db[REL[f]].find(z => z.id === r[f]); if (x) o.expand[f] = rest.length ? expand(x, rest.join('.')) : x; }); return o; };
  let aid = null; try { const a = JSON.parse(ls.get('pocketbase_auth') || 'null'); aid = a && a.model && a.model.id; } catch (e) {}
  const authStore = { get model() { return db.users.find(u => u.id === aid) || null; }, get record() { return this.model; }, get isValid() { return !!this.model; }, clear() { aid = null; ls.del('pocketbase_auth'); } };
  const list = (c, o = {}) => sortBy(db[c].filter(r => test(r, o.filter)), o.sort).map(r => expand(r, o.expand));
  const col = c => ({
    async getFullList(o) { return list(c, o); },
    async getFirstListItem(f, o = {}) { const r = list(c, { ...o, filter: f })[0]; if (!r) { const e = new Error("The requested resource wasn't found."); e.status = 404; throw e; } return r; },
    async getList(p, n, o) { const l = list(c, o); return { items: l.slice((p - 1) * n, p * n), totalItems: l.length, page: p, perPage: n }; },
    async getOne(id, o = {}) { const r = db[c].find(x => x.id === id); if (!r) throw new Error('Record not found.'); return expand(r, o.expand); },
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
      if (u.suspended && u.role !== 'admin') throw new Error('Your account has been suspended: ' + (u.suspended_reason || '').replace(/[.!?\s]*$/, '') + '. Please contact customer care.');
      aid = u.id; ls.set('pocketbase_auth', JSON.stringify({ token: 'mock', model: { id: u.id, role: u.role } })); return { record: u };
    }
  });
  // ---- demo stand-in for the server's wallet routes (the real logic lives in pb_hooks/wallet.js) ----
  const post = (uidv, amount, kind, note, extra = {}) => {
    const u = db.users.find(x => x.id === uidv), bal = (u.wallet_balance || 0) + amount;
    if (bal < 0 && !extra.allowNegative) throw new Error('Not enough money in your wallet.'); delete extra.allowNegative;
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
      const st = planState(best.sub, best.pl, db.payments.filter(p => p.subscription === best.sub.id), t), cost = st.cost(0), late = cost > st.A;   // overdue but penalty-free (imported plan) counts as on time
      if ((db.users.find(x => x.id === uidv).wallet_balance || 0) < cost) { best.blocked = true; continue; }
      const p = { id: uid(), created: now(), user: uidv, subscription: best.sub.id, amount: cost, penalty: late ? st.pen : 0, installments: 1, late_count: late ? 1 : 0, note: 'Wallet' + (late ? ' · late' : ''), status: 'confirmed' };
      db.payments.push(p); emit('payments', 'create', p);
      post(uidv, -cost, 'contribution', best.pl.name + (late ? ' (late)' : ''), { plan: best.pl.id, subscription: best.sub.id });
    }
    save();
  };
  // ---- plan codes (demo copy of pb_hooks/wallet.js codeState) ----
  const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(JJ)?([A-Z0-9]{4})([A-Z0-9]{4})$/, 'JJ-$2-$3');
  const codeState = c => {
    c = norm(c); const r = db.subscriptions.find(x => x.code === c), t = Date.now();
    if (!r) return { status: 'invalid', code: c, message: 'That code does not exist. Check it and try again.' };
    const pl = db.plans.find(p => p.id === r.plan) || {}, last = new Date(parseTs(r.code_until).getTime() - 1).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' });
    if (r.code_used_at || r.code_admin === 'used') return { status: 'used', code: c, plan: pl.name, rec: r, message: 'This code has already been used.' };
    if (r.code_admin === 'expired') return { status: 'expired', code: c, plan: pl.name, rec: r, message: 'This code has expired.' };
    if (t >= parseTs(r.code_until).getTime()) return { status: 'expired', code: c, plan: pl.name, rec: r, message: 'This code expired at the end of ' + last + '.' };
    if (t < parseTs(r.code_from).getTime()) return { status: 'not_yet', code: c, plan: pl.name, rec: r, message: 'This code can only be used from ' + new Date(parseTs(r.code_from)).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) + '.' };
    return { status: 'valid', code: c, plan: pl.name, rec: r, message: 'Code accepted. It can be used until the end of ' + last + '.' };
  };
  const giveCode = (s, pl) => {
    if (!(pl.code_from_day >= 1) || !(pl.code_until_day >= pl.code_from_day)) return;
    const L = mToL(mTs(s.created)), y = L.getUTCFullYear(), m = L.getUTCMonth(), d = L.getUTCDate(), A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r4 = () => Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
    s.code = 'JJ-' + r4() + '-' + r4(); s.code_from = mFromL(y, m, d + pl.code_from_day - 1).toISOString().replace('T', ' '); s.code_until = mFromL(y, m, d + pl.code_until_day).toISOString().replace('T', ' ');
  };
  const send = async (path, o = {}) => {
    const b = o.body || {};
    const me = db.users.find(u => u.id === aid), NEED = 'Please pay the one-time ₦5,000 t-shirt fee before you request a payout.', n = x => '₦' + Number(x).toLocaleString();
    if (path.endsWith('/admin/stats')) {                 // same totals the real server works out with SQL
      const U = db.users, M = U.filter(u => u.role !== 'admin'), P = db.payments, sum = (l, f) => l.reduce((x, r) => x + (+r[f] || 0), 0), conf = P.filter(p => p.status === 'confirmed'), tops = (db.wallet_txs || []).filter(t => t.kind === 'topup');
      const reg = M.filter(u => u.shirt_paid).length;
      return { users: U.length, members: M.length, registered: reg, unregistered: M.length - reg, withAccount: 0, tax: sum((db.fees || []).filter(f => f.type === 'tax' && f.status === 'confirmed'), 'amount'), deposits: (db.deposits || []).filter(d => d.status === 'successful').length, depositTotal: sum((db.deposits || []).filter(d => d.status === 'successful'), 'amount'), pendingDeposits: 0, codesUsed: db.subscriptions.filter(x => x.code_used_at).length, codesOpen: db.subscriptions.filter(x => x.code && !x.code_used_at && Date.now() >= parseTs(x.code_from).getTime() && Date.now() < parseTs(x.code_until).getTime()).length, admins: U.length - M.length, held: sum(U, 'wallet_balance'), subscriptions: db.subscriptions.length, activeSubscriptions: db.subscriptions.filter(x => x.status === 'active').length, pendingPayments: P.filter(p => p.status === 'pending').length, confirmedTotal: sum(conf, 'amount'), penalties: sum(conf, 'penalty'), fees: sum((db.fees || []).filter(f => f.status === 'confirmed'), 'amount'), pendingPayouts: db.payouts.filter(p => p.status === 'pending').length, plans: db.plans.length, topups: tops.length, topupTotal: sum(tops, 'amount') };
    }
    if (path.endsWith('/wallet/deposit')) {               // demo: the deposit succeeds at once (the real site sends you to the member's payment partner)
      const a = Math.round(+b.amount || 0); if (a < 100) throw new Error('The smallest deposit is ₦100.');
      db.deposits = db.deposits || []; const d = { id: uid(), created: now(), user: aid, amount: a, fee: 100, total: a + 100, tx_ref: 'JJHHF-DEP-DEMO-' + uid(), status: 'successful', flw_id: 'DEMO' };
      db.deposits.push(d); emit('deposits', 'create', d);
      post(aid, a, 'topup', 'Online deposit (demo)', { ref: d.tx_ref });
      const f = { id: uid(), created: now(), user: aid, type: 'tax', amount: 100, status: 'confirmed', note: 'Tax charge on deposit' }; db.fees.push(f); emit('fees', 'create', f);
      collect(aid); save(); return { demo: true, amount: a, fee: 100, total: a + 100 };
    }
    if (path.endsWith('/wallet/verify')) { const d = (db.deposits || []).find(x => x.tx_ref === b.tx_ref); return d ? { status: d.status, amount: d.amount, fee: d.fee, total: d.total } : { status: 'pending' }; }
    if (path.endsWith('/code/check')) { const r = codeState(b.code); return Object.assign({}, r, { rec: undefined, count: r.rec && r.rec.group_size > 1 ? r.rec.group_size : 1 }); }
    // ---- bank transfers with a receipt (demo: every receipt "matches" and is credited at once; the real check is in pb_hooks/transfers.js) ----
    db.settings = db.settings || { bank_name: 'GTBank (demo)', account_number: '0123456789', account_name: 'Jessy James Helping Hands Foundation', transfer_note: '', auto_approve: true, auto_max: 200000, max_age_days: 2 };
    db.deposits = db.deposits || [];
    if (path.endsWith('/transfer/info')) return { ...db.settings, tax: 100, min: 100, auto: db.settings.auto_approve };
    if (path.endsWith('/admin/settings')) { if (me.role !== 'admin') throw new Error('Admins only.'); if ((o.method || 'GET') === 'POST') { Object.assign(db.settings, b, { auto_max: +b.auto_max || 0, max_age_days: +b.max_age_days || 0 }); save(); } return { ...db.settings, ai: false }; }
    if (path.endsWith('/api/jjhhf/transfer')) {
      const amount = Math.round(+b.get('amount') || 0), file = b.get('receipt');
      if (amount < 100) throw new Error('The smallest deposit is ₦100.'); if (!file || !file.size) throw new Error('Upload your payment receipt.');
      const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
      const today = new Date(Date.now() + 36e5).toISOString().slice(0, 10), ref = 'DEMO' + uid().toUpperCase();
      const d = { id: uid(), created: now(), user: aid, amount, fee: 100, total: amount + 100, tx_ref: 'JJHHF-TRF-' + ref, status: 'successful', verified: 'auto', gateway: 'transfer', sender_name: b.get('sender_name') || '', receipt: file.name, receipt_data: data, receipt_ref: ref, check_note: 'Receipt checked automatically.',
        check: { read: true, ai: { is_receipt: true, status: 'successful', amount: amount + 100, date: today, beneficiary_account_number: db.settings.account_number, beneficiary_account_name: db.settings.account_name, reference: ref, sender_name: b.get('sender_name') || '', looks_edited: false }, checks: { receipt: true, edited: true, amount: true, account: true, date: true, unique: true }, reasons: [] } };
      db.deposits.push(d); emit('deposits', 'create', d);
      post(aid, amount, 'topup', 'Bank transfer (receipt checked automatically)', { ref: 'TRANSFER-' + d.id });
      const f = { id: uid(), created: now(), user: aid, type: 'tax', amount: 100, status: 'confirmed', note: 'Tax charge on deposit', tx_ref: d.tx_ref }; db.fees.push(f); emit('fees', 'create', f);
      collect(aid); save(); return { status: 'successful', id: d.id, amount, message: 'Account credited with ' + n(amount) + '. Payment confirmation under review (demo).' };
    }
    if (path.endsWith('/admin/transfer')) {
      if (me.role !== 'admin') throw new Error('Admins only.');
      const d = db.deposits.find(x => x.id === b.id); if (!d) throw new Error('Deposit not found.'); const stamp = () => { d.reviewed_by = aid; d.reviewed_at = now(); };
      const act = b.action === 'confirm' ? 'approve' : b.action === 'reverse' ? 'reject' : b.action;
      if (act === 'approve') {
        if (d.status === 'successful') { d.verified = 'admin'; d.check_note = b.note || 'Payment approved.'; stamp(); }                     // money stays
        else { post(d.user, d.amount, 'topup', 'Bank transfer (approved by admin)', { ref: 'TRANSFER-' + d.id }); d.status = 'successful'; d.verified = 'admin'; d.check_note = b.note || 'Payment approved.'; stamp(); collect(d.user); }
      } else if (act === 'reject') {
        if (d.status === 'successful') { post(d.user, -d.amount, 'reversal', 'Deposit rejected, money withdrawn · ' + (b.note || ''), { allowNegative: true }); d.status = 'reversed'; }   // money withdrawn
        else d.status = 'failed';
        d.check_note = b.note || 'Payment not received.'; stamp();
      }
      emit('deposits', 'update', d); save(); return { status: d.status, balance: db.users.find(u => u.id === d.user).wallet_balance };
    }
    if (path.includes('/admin/delete-user')) {
      if (me.role !== 'admin') throw new Error('Admins only.');
      const C = ['payments', 'payouts', 'fees', 'wallet_txs', 'deposits', 'subscriptions'];
      if ((o.method || 'GET') === 'GET') { const id = new URLSearchParams(path.split('?')[1] || '').get('user'); return Object.fromEntries(C.map(c => [c, (db[c] || []).filter(r => r.user === id).length])); }
      const u = db.users.find(x => x.id === b.user); if (!u) throw new Error('Member not found.'); if (u.role === 'admin') throw new Error('An admin account cannot be deleted here.');
      if (!u.suspended) throw new Error('Suspend the account first.'); if (b.confirm !== 'DELETE') throw new Error('Type DELETE to confirm.');
      db.subscriptions.forEach(r => { if (r.code_used_by === u.id && r.user !== u.id) { r.code_used_by = ''; r.code_used_name = 'Deleted member'; } });
      const removed = {}; C.forEach(c => { const before = (db[c] || []).length; db[c] = (db[c] || []).filter(r => r.user !== u.id); removed[c] = before - db[c].length; });
      db.users = db.users.filter(x => x.id !== u.id); save(); return { ok: true, name: u.name || u.email, removed };
    }
    if (path.endsWith('/admin/suspend')) {
      if (me.role !== 'admin') throw new Error('Admins only.'); const u = db.users.find(x => x.id === b.user);
      if (u.role === 'admin') throw new Error('An admin account cannot be suspended.'); if (b.suspended && !b.reason) throw new Error('Give a reason.');
      Object.assign(u, { suspended: !!b.suspended, suspended_reason: b.suspended ? b.reason : '', suspended_at: b.suspended ? now() : '' }); emit('users', 'update', u); save(); return { suspended: u.suspended };
    }
    if (path.endsWith('/admin/import-plan')) {
      if (me.role !== 'admin') throw new Error('Admins only.');
      const items = Array.isArray(b.items) ? b.items : [{ plan: b.plan, days: b.days, amount_paid: b.amount_paid, count: 1 }];
      let added = 0; const ids = [];
      items.forEach((it, i) => {
        const pl = db.plans.find(p => p.id === it.plan), days = Math.floor(+it.days || 0), paid = Math.round(+it.amount_paid || 0), k = paid / pl.amount;
        if (!Number.isInteger(k) || k < 0) throw new Error('Row ' + (i + 1) + ': amount paid must be a multiple of the contribution, ' + n(pl.amount) + '.');
        const L = new Date(Date.now() + 36e5), start = new Date(Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() - days, 8) - 36e5);
        for (let c = 0; c < Math.max(1, Math.floor(+it.count || 1)); c++) {
          const s = { id: uid(), created: start.toISOString().replace('T', ' '), user: b.user, plan: pl.id, status: 'active', imported: true, import_note: it.note || b.note || 'Brought over from manual records', no_penalty_before: b.charge_penalty ? '' : now() };
          if (b.code_mode === 'custom') { giveCode(s, pl); if (s.code || true) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r4 = () => Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
            s.code = s.code || 'JJ-' + r4() + '-' + r4(); s.code_from = new Date(Date.parse(b.code_from + 'T00:00:00Z') - 36e5).toISOString().replace('T', ' '); s.code_until = new Date(Date.parse(b.code_until + 'T00:00:00Z') + 864e5 - 36e5).toISOString().replace('T', ' '); } }
          else if (b.code_mode !== 'none') giveCode(s, pl);
          db.subscriptions.push(s); emit('subscriptions', 'create', s); ids.push(s.id); added++;
          if (k) { const p = { id: uid(), created: now(), user: b.user, subscription: s.id, amount: paid, penalty: 0, installments: k, late_count: 0, note: 'Brought over from manual records · ' + k + ' payments', status: 'confirmed' }; db.payments.push(p); emit('payments', 'create', p); }
        }
      });
      const before = db.payments.length; collect(b.user); save(); return { added, subscriptions: ids, subscription: ids[0], collected: db.payments.length - before };
    }
    if (path.endsWith('/admin/code-status')) {
      if (me.role !== 'admin') throw new Error('Admins only.');
      const r = db.subscriptions.find(x => x.id === b.subscription); if (!r || !r.code) throw new Error('Plan code not found.');
      if (r.code_used_at) throw new Error('This code was used by ' + (r.code_used_name || 'a member') + ', so its status cannot be changed.');
      if (b.status === 'open') { r.code_from = now(); emit('subscriptions', 'update', r); save(); return { ok: true }; }
      r.code_admin = b.status === 'auto' ? '' : b.status; r.code_admin_at = b.status === 'auto' ? '' : now(); emit('subscriptions', 'update', r); save(); return { ok: true };
    }
    // demo: every provider counts as set up; the draw goes to the provider with the fewest members
    const GWS = ['flutterwave', 'paystack', 'monnify'], drawGw = () => { const c = Object.fromEntries(GWS.map(g => [g, db.users.filter(u => u.gateway === g).length])), min = Math.min(...GWS.map(g => c[g])), low = GWS.filter(g => c[g] === min); return low[Math.floor(Math.random() * low.length)]; };
    if (path.endsWith('/admin/gateway')) {
      if (me.role !== 'admin') throw new Error('Admins only.');
      const u = db.users.find(x => x.id === b.user); if (!u) throw new Error('Member not found.');
      u.gateway = b.gateway || drawGw(); u.gateway_manual = !!b.gateway; emit('users', 'update', u); save(); return { gateway: u.gateway, manual: u.gateway_manual };
    }
    if (path.endsWith('/admin/gateway/shuffle')) {
      if (me.role !== 'admin') throw new Error('Admins only.');
      const l = db.users.filter(u => u.role !== 'admin' && (b.mode === 'all' ? !u.gateway_manual : !GWS.includes(u.gateway)));
      if (b.mode === 'all') l.forEach(u => u.gateway = '');
      let changed = 0; l.sort(() => Math.random() - .5).forEach(u => { const g = drawGw(); if (u.gateway !== g) changed++; u.gateway = g; u.gateway_manual = false; emit('users', 'update', u); });
      save(); return { changed, total: l.length };
    }
    if (path.endsWith('/wallet/deduct')) {
      if (me.role !== 'admin') throw new Error('Admins only.');
      const u = db.users.find(x => x.id === b.user), amt = +b.amount; if (!(amt > 0)) throw new Error('Enter an amount.'); if (!b.note) throw new Error('Give a reason.');
      if (amt > (u.wallet_balance || 0)) throw new Error('The wallet only has ' + n(u.wallet_balance || 0) + '.');
      const bal = post(b.user, -amt, 'deduction', 'Deducted by admin · ' + b.note); save(); return { ok: true, balance: bal };
    }
    if (path.endsWith('/wallet/credit')) {
      if (me.role !== 'admin') throw new Error('Admins only.');
      post(b.user, +b.amount, 'topup', ['Credited by admin', b.ref && 'ref ' + b.ref, b.note].filter(Boolean).join(' · '), { ref: 'MANUAL-' + uid() }); collect(b.user); save(); return { ok: true, balance: db.users.find(x => x.id === b.user).wallet_balance };
    }
    if (path.endsWith('/fee/pay')) {
      const t = b.type, amt = { shirt: 5000, join: 3000, clearance: 3500 }[t]; db.deposits = db.deposits || [];
      if (!amt) throw new Error('Unknown fee.');
      const short = need => { const bal = me.wallet_balance || 0; if (bal < need) throw new Error('Your wallet needs ' + n(need) + ' for this. You have ' + n(bal) + '. Please top up ' + n(need - bal) + '.'); };
      let out = {};
      if (t === 'shirt') { if (me.shirt_paid) throw new Error('You have already paid the t-shirt fee.'); short(amt); post(aid, -amt, 'shirt', 'T-shirt registration fee'); me.shirt_paid = true; me.shirt_paid_at = now(); emit('users', 'update', me); }
      else if (t === 'join') {
        const pl = db.plans.find(p => p.id === b.plan); if (!pl || pl.active === false) throw new Error('That plan is not open for enrolment.');
        const L = [...new Set([b.code, ...(b.codes || [])].filter(x => String(x || '').trim()).map(norm))];
        const CS = L.map(k => { const x = codeState(k); if (x.status !== 'valid') throw new Error(k + ': ' + x.message); return x; });
        const fromCodes = CS.reduce((a, x) => a + ((x.rec.group_size > 1) ? x.rec.group_size : 1), 0);
        const q = CS.length ? fromCodes : Math.floor(+b.qty || 1); if (!(q >= 1 && q <= 50)) throw new Error('You can join a plan 1 to 50 times at once.');
        const c = catchupCount({ created: now() }, pl), each = amt + c * pl.amount + (isSeasonal(pl) ? 0 : pl.amount);   // fee + first payment
        short(each * q);
        const joinedWith = []; CS.forEach(x => { for (let k = 0; k < ((x.rec.group_size > 1) ? x.rec.group_size : 1); k++) joinedWith.push(x.code); });
        const gid = q > 1 ? uid() : '', ids = [];
        for (let i = 0; i < q; i++) {
          const s = { id: uid(), created: now(), user: aid, plan: pl.id, status: 'active', group_id: gid, group_lead: !!gid && i === 0, group_size: gid && i === 0 ? q : 0 };
          if (joinedWith[i]) s.joined_code = joinedWith[i]; if (i === 0) giveCode(s, pl);
          db.subscriptions.push(s); emit('subscriptions', 'create', s); ids.push(s.id);
          post(aid, -amt, 'join', 'Joining fee · ' + pl.name, { plan: pl.id, subscription: s.id });
          const f = { id: uid(), created: now(), user: aid, type: 'join', amount: amt, status: 'confirmed', plan: pl.id, subscription: s.id, note: 'Wallet' }; db.fees.push(f); emit('fees', 'create', f);
          if (c) { const p = { id: uid(), created: now(), user: aid, subscription: s.id, amount: c * pl.amount, penalty: 0, installments: c, late_count: 0, note: 'Catch-up · ' + c + ' instalments', status: 'confirmed' }; db.payments.push(p); emit('payments', 'create', p); post(aid, -c * pl.amount, 'catchup', 'Catch-up · ' + pl.name, { plan: pl.id, subscription: s.id }); }
        }
        let k = 0; CS.forEach(x => { Object.assign(x.rec, { code_used_by: aid, code_used_name: me.name || me.email, code_used_at: now(), code_used_sub: ids[k] }); emit('subscriptions', 'update', x.rec); k += (x.rec.group_size > 1 ? x.rec.group_size : 1); });
        out = { subscription: ids[0], subscriptions: ids, count: q, codesUsed: CS.length }; collect(aid);
      } else {
        const planOf = s => db.plans.find(p => p.id === s.plan) || {};
        if (!runningOthers(db.subscriptions.filter(s => s.user === aid), b.subscription, planOf).length) throw new Error(PAYOUT_NEEDS_PLAN);
        if (!me.shirt_paid) throw new Error(NEED);
        if (!payoutReady(me)) throw new Error('Add your payout details (account name, bank, 10-digit account number and address) on your Profile page before requesting a payout.');
        b.details = [me.bank_account_name, me.bank_name, me.bank_account_number, me.address].join(' · ');
        const sub = db.subscriptions.find(x => x.id === b.subscription) || {}; b.cleared = !!sub.clearance_paid_at;
        if (!b.cleared) { short(amt); post(aid, -amt, 'clearance', 'Payout clearance fee', { subscription: b.subscription }); sub.clearance_paid_at = now(); emit('subscriptions', 'update', sub); }
        const p = { id: uid(), created: now(), user: aid, subscription: b.subscription, note: b.details, status: 'pending' }; db.payouts.push(p); emit('payouts', 'create', p);
      }
      if (t !== 'join' && !b.cleared) { const f = { id: uid(), created: now(), user: aid, type: t, amount: amt, status: 'confirmed', plan: b.plan || '', subscription: b.subscription || '', details: b.details || '', note: 'Wallet' }; db.fees.push(f); emit('fees', 'create', f); }
      save(); return out;
    }
    return { status: 'confirmed' };
  };
  const filter = (expr, params = {}) => expr.replace(/\{:(\w+)\}/g, (_, k) => JSON.stringify(String(params[k] ?? '')));   // same as pb.filter (the demo ignores complex filters)
  // protected receipt files: the demo keeps them as data URLs on the record
  const files = { getToken: async () => 'demo', getURL: (r, name) => (r && r.receipt_data) || '' };
  return { collection: col, authStore, send, filter, files };
}
