// pdf.js - draws invoices, payout receipts and statements with jsPDF (loaded on demand by app.js).
// Text is kept to plain ASCII on purpose: jsPDF's built-in fonts have no naira sign, so amounts are written as "NGN 1,500".
(function (root) {
  const K = { dark: [20, 33, 90], ink: [30, 41, 59], mute: [100, 116, 139], line: [226, 232, 240], soft: [241, 245, 249], white: [255, 255, 255], mint: [245, 183, 42] };
  const ST = { confirmed: { bg: [220, 252, 231], fg: [21, 128, 61] }, pending: { bg: [254, 243, 199], fg: [180, 83, 9] }, rejected: { bg: [254, 226, 226], fg: [185, 28, 28] } };

  // make any text safe for the built-in PDF fonts (accents are dropped, anything else unusual becomes "?")
  const txt = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7E]/g, '?');
  const ngn = n => 'NGN ' + Number(n || 0).toLocaleString('en-US');
  const fdate = d => d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', year: 'numeric' });
  const ftime = d => d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' });
  const fiso = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  const fill = (d, c) => d.setFillColor(c[0], c[1], c[2]);
  const ink = (d, c) => d.setTextColor(c[0], c[1], c[2]);
  const font = (d, style, size, c) => { d.setFont('helvetica', style); d.setFontSize(size); if (c) ink(d, c); };
  const fit = (d, s, w) => { s = txt(s); if (d.getTextWidth(s) <= w) return s; while (s.length > 1 && d.getTextWidth(s + '...') > w) s = s.slice(0, -1); return s + '...'; };
  const lbl = (d, s, x, y, align) => { font(d, 'bold', 8, K.mute); d.text(s, x, y, align ? { align } : undefined); };
  const word = t => t.status === 'confirmed' ? (t.kind === 'payment' ? 'PAID' : 'PAID OUT') : String(t.status || 'pending').toUpperCase();

  function header(d, title, sub, logo, co) {
    fill(d, K.dark); d.rect(0, 0, 210, 36, 'F');
    let x = 14;
    if (logo) { try { d.addImage(logo, 'PNG', 14, 7, 22, 22); x = 41; } catch (e) { /* logo is optional */ } }
    font(d, 'bold', 12, K.white); d.text(fit(d, co.name, 92), x, 17.5);
    font(d, 'normal', 9, K.mint); d.text(txt(co.tagline || 'Community savings foundation') + (co.rc ? '  |  RC ' + txt(co.rc) : ''), x, 24.5);
    font(d, 'bold', 20, K.white); d.text(title, 196, 17, { align: 'right' });
    font(d, 'normal', 9, K.mint); d.text(txt(sub), 196, 24.5, { align: 'right' });
  }
  function footer(d, co) {
    const N = d.getNumberOfPages(), now = new Date();
    for (let i = 1; i <= N; i++) {
      d.setPage(i); d.setDrawColor(K.line[0], K.line[1], K.line[2]); d.line(14, 284, 196, 284);
      font(d, 'normal', 8, K.mute);
      d.text(fit(d, txt(co.name) + (co.phone ? '   |   Customer care: ' + txt(co.phone) : '') + (co.email ? '   |   ' + txt(co.email) : ''), 182), 14, 288.5);
      d.text('Computer-generated document; no signature needed.', 14, 293);
      d.text('Generated ' + fdate(now) + ', ' + ftime(now) + ' (Lagos time)   |   Page ' + i + ' of ' + N, 196, 293, { align: 'right' });
    }
  }
  function chip(d, t, rightX, y) {
    const st = ST[t.status] || ST.pending, w = (font(d, 'bold', 9), d.getTextWidth(word(t))) + 9;
    fill(d, st.bg); d.roundedRect(rightX - w, y, w, 7, 1.5, 1.5, 'F');
    ink(d, st.fg); d.text(word(t), rightX - w / 2, y + 4.9, { align: 'center' });
  }

  // ---------- one invoice (payment) or receipt (payout) ----------
  function buildInvoice(J, t, c, logo, co) {
    const d = new J({ unit: 'mm', format: 'a4' }), pay = t.kind === 'payment';
    c = c || {};
    d.setProperties({ title: t.no + ' - ' + co.name });
    header(d, pay ? 'INVOICE' : 'PAYOUT RECEIPT', t.no, logo, co);

    let y = 50;
    lbl(d, pay ? 'BILLED TO' : 'PAID TO', 14, y);
    font(d, 'bold', 12, K.ink); d.text(fit(d, c.name || c.email || 'Member', 95), 14, y + 7);
    font(d, 'normal', 9.5, K.mute);
    [c.email, c.phone, c.country].filter(Boolean).forEach((l, i) => d.text(fit(d, l, 95), 14, y + 13 + i * 5));

    [['Document no.', t.no], ['Date', fdate(t.at)], ['Time', ftime(t.at) + ' (Lagos)']].forEach(([k, v], i) => {
      font(d, 'normal', 9, K.mute); d.text(k, 120, y + 2 + i * 6);
      font(d, 'bold', 9, K.ink); d.text(txt(v), 196, y + 2 + i * 6, { align: 'right' });
    });
    font(d, 'normal', 9, K.mute); d.text('Status', 120, y + 22.9);
    chip(d, t, 196, y + 18);

    // line items
    const ty = 86;
    fill(d, K.soft); d.rect(14, ty, 182, 9, 'F');
    font(d, 'bold', 8, K.mute); d.text('DESCRIPTION', 17, ty + 6); d.text('COVERS', 128, ty + 6); d.text('AMOUNT', 193, ty + 6, { align: 'right' });
    let ry = ty + 9;
    const item = (title, sub, covers, amt) => {
      font(d, 'bold', 10, K.ink); d.text(fit(d, title, 104), 17, ry + 6.5);
      font(d, 'normal', 8.5, K.mute); d.text(fit(d, sub, 104), 17, ry + 11.5);
      font(d, 'normal', 9.5, K.ink); d.text(fit(d, covers || '-', 40), 128, ry + 8.5);
      font(d, 'bold', 10, K.ink); d.text(ngn(amt), 193, ry + 8.5, { align: 'right' });
      d.setDrawColor(K.line[0], K.line[1], K.line[2]); d.line(14, ry + 15, 196, ry + 15); ry += 15;
    };
    if (pay) {
      item(t.plan, cap(t.frequency) + ' savings contribution', t.covers, t.amount - t.penalty);
      if (t.penalty) item('Late payment penalty', (t.late || 1) + ' late instalment' + ((t.late || 1) === 1 ? '' : 's') + ' (a fee, not counted as savings)', '-', t.penalty);
    } else item('Payout - ' + t.plan, 'Total payout value of the plan', 'Payout', t.amount);

    // totals
    ry += 6;
    if (pay && t.penalty) {
      [['Savings', t.amount - t.penalty], ['Late penalty', t.penalty]].forEach(([k, v]) => {
        font(d, 'normal', 9.5, K.mute); d.text(k, 122, ry + 4); font(d, 'normal', 9.5, K.ink); d.text(ngn(v), 193, ry + 4, { align: 'right' }); ry += 7;
      });
      ry += 1;
    }
    fill(d, K.dark); d.roundedRect(118, ry, 78, 12, 1.5, 1.5, 'F');
    font(d, 'bold', 10, K.white); d.text(pay ? 'TOTAL PAID' : 'PAYOUT VALUE', 123, ry + 7.8);
    font(d, 'bold', 11.5, K.white); d.text(ngn(t.amount), 192, ry + 8, { align: 'right' });
    ry += 12;

    // reference / note
    if (t.note) {
      ry += 10;
      const lines = d.splitTextToSize(txt(t.note), 170).slice(0, 4), h = 11 + lines.length * 4.6;
      fill(d, K.soft); d.roundedRect(14, ry, 182, h, 2, 2, 'F');
      lbl(d, pay ? 'PAYMENT REFERENCE / NOTE' : 'DELIVERY / BANK DETAILS', 18, ry + 6.5);
      font(d, 'normal', 9.5, K.ink); d.text(lines, 18, ry + 12.5);
      ry += h;
    }

    // plain-language status
    ry += 12;
    const M = pay
      ? { confirmed: 'This payment has been confirmed by ' + co.name + ' and counts towards your savings.', pending: 'This payment is awaiting confirmation. It counts towards your savings once an administrator confirms it; this invoice then shows as paid.', rejected: 'This payment was not accepted. Please contact customer support if you think this is a mistake.' }
      : { confirmed: 'This payout has been marked as paid by ' + co.name + '.', pending: 'This payout request is awaiting processing.', rejected: 'This payout request was not approved. Please contact customer support for details.' };
    let msg = M[t.status] || M.pending;
    if (pay && t.penalty) msg += ' Late penalties are fees: they do not count towards your savings or payout.';
    font(d, 'normal', 9, K.mute); d.text(d.splitTextToSize(txt(msg), 182), 14, ry);

    footer(d, co);
    return d;
  }

  // ---------- statement: a list of transactions (already filtered by the page) ----------
  function buildStatement(J, o, logo, co) {
    const { txs, cust, showUser, from, to } = o, d = new J({ unit: 'mm', format: 'a4' });
    d.setProperties({ title: 'Statement - ' + co.name });
    header(d, 'STATEMENT', 'Transaction history', logo, co);

    let y = 50;
    lbl(d, cust ? 'MEMBER' : 'SCOPE', 14, y);
    font(d, 'bold', 12, K.ink); d.text(fit(d, cust ? (cust.name || cust.email || 'Member') : 'All members', 100), 14, y + 7);
    font(d, 'normal', 9.5, K.mute);
    if (cust) [cust.email, cust.phone, cust.country].filter(Boolean).forEach((l, i) => d.text(fit(d, l, 100), 14, y + 13 + i * 5));
    lbl(d, 'PERIOD', 196, y, 'right');
    font(d, 'bold', 11, K.ink); d.text((from || to) ? (from ? fiso(from) : 'Start') + '  to  ' + (to ? fiso(to) : 'today') : 'All time', 196, y + 7, { align: 'right' });
    font(d, 'normal', 9, K.mute); d.text(txs.length + ' transaction' + (txs.length === 1 ? '' : 's'), 196, y + 13, { align: 'right' });

    // summary boxes
    const pays = txs.filter(t => t.kind === 'payment'), sum = (l, f) => l.reduce((a, t) => a + f(t), 0);
    const box = [
      ['CONFIRMED SAVINGS', ngn(sum(pays.filter(t => t.status === 'confirmed'), t => t.amount - t.penalty))],
      ['LATE PENALTIES', ngn(sum(pays.filter(t => t.status === 'confirmed'), t => t.penalty))],
      ['AWAITING CONFIRMATION', ngn(sum(pays.filter(t => t.status === 'pending'), t => t.amount))],
      ['PAYOUTS PAID', ngn(sum(txs.filter(t => t.kind === 'payout' && t.status === 'confirmed'), t => t.amount))]
    ], bw = (182 - 3 * 3) / 4;
    box.forEach(([k, v], i) => {
      const x = 14 + i * (bw + 3);
      fill(d, K.soft); d.roundedRect(x, 76, bw, 19, 2, 2, 'F');
      font(d, 'bold', 6.5, K.mute); d.text(k, x + 3, 82);
      font(d, 'bold', 10.5, K.ink); d.text(fit(d, v, bw - 6), x + 3, 90);
    });

    // table
    const cols = showUser
      ? [['DATE', 22, 'l'], ['MEMBER', 30, 'l'], ['PLAN', 36, 'l'], ['TYPE', 18, 'l'], ['AMOUNT', 26, 'r'], ['PENALTY', 22, 'r'], ['STATUS', 28, 'l']]
      : [['DATE', 22, 'l'], ['INVOICE NO.', 38, 'l'], ['PLAN', 39, 'l'], ['TYPE', 18, 'l'], ['AMOUNT', 25, 'r'], ['PENALTY', 20, 'r'], ['STATUS', 20, 'l']];
    const place = (i) => { let x = 14; for (let k = 0; k < i; k++) x += cols[k][1]; return cols[i][2] === 'r' ? x + cols[i][1] - 2 : x + 2; };
    const thead = ty => {
      fill(d, K.soft); d.rect(14, ty, 182, 8, 'F'); font(d, 'bold', 7.5, K.mute);
      cols.forEach((c, i) => d.text(c[0], place(i), ty + 5.4, c[2] === 'r' ? { align: 'right' } : undefined));
    };
    let ry = 102; thead(ry); ry += 8;
    txs.forEach(t => {
      if (ry + 8 > 279) { d.addPage(); ry = 18; thead(ry); ry += 8; }
      const vals = [fdate(t.at), showUser ? (t.user && (t.user.name || t.user.email)) || '-' : t.no, t.plan, t.kind === 'payment' ? 'Payment' : 'Payout', ngn(t.amount), t.penalty ? ngn(t.penalty) : '-', cap(t.status)];
      font(d, 'normal', 8, K.ink);
      vals.forEach((v, i) => d.text(fit(d, v, cols[i][1] - 4), place(i), ry + 5.4, cols[i][2] === 'r' ? { align: 'right' } : undefined));
      d.setDrawColor(K.line[0], K.line[1], K.line[2]); d.line(14, ry + 8, 196, ry + 8); ry += 8;
    });
    font(d, 'normal', 8, K.mute); d.text('End of statement. Penalties are fees and are not counted as savings.', 14, ry + 7);

    footer(d, co);
    return d;
  }

  root.buildInvoice = buildInvoice; root.buildStatement = buildStatement;
  if (typeof module !== 'undefined') module.exports = { buildInvoice, buildStatement };
})(typeof window !== 'undefined' ? window : globalThis);
