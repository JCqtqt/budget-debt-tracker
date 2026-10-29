/* Budget & Debt Tracker
 * All data is stored in this browser (localStorage). Nothing is sent anywhere.
 * Use Settings → Backup to move your data to another device.
 */
(() => {
  'use strict';

  const KEY = 'budget-debt-tracker:v1';
  const OWE = 'I owe';
  const OWED = 'Owed to me';
  const ACCOUNT_TYPES = ['Bank', 'E-wallet', 'Cash', 'Savings', 'Other'];

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => pesoFmt.format(Math.round((+n || 0) * 100) / 100);
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[₱,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const fmtDate = (s) => {
    if (!s) return '';
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }); };
  const shiftMonth = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const inMonth = (date, ym) => !!date && date.slice(0, 7) === ym;
  const sum = (arr, f = (x) => x.amount) => arr.reduce((a, x) => a + num(f(x)), 0);
  const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

  const DEFAULT_CATEGORIES = [
    ['Salary', 'Income'], ['Side Income', 'Income'], ['Other Income', 'Income'],
    ['Food & Groceries', 'Expense'], ['Rent / Housing', 'Expense'], ['Electricity', 'Expense'], ['Water', 'Expense'],
    ['Internet & Load', 'Expense'], ['Transportation & Gas', 'Expense'], ['Debt Payments', 'Expense'], ['Savings', 'Expense'],
    ['Shopping', 'Expense'], ['Health', 'Expense'], ['Entertainment', 'Expense'], ['Family / Gifts', 'Expense'], ['Others', 'Expense'],
  ];

  function blank() {
    return {
      version: 1,
      nextId: 1,
      categories: DEFAULT_CATEGORIES.map(([name, type]) => ({ name, type, budget: 0 })),
      accounts: [],
      transactions: [],
      debts: [],
      payments: [],
      transfers: [],
      settings: { debtCategory: 'Debt Payments' },
    };
  }

  // ---------- storage ----------
  let S = blank();
  let UI = { tab: 'summary', month: todayStr().slice(0, 7), showPaid: false };
  let storageOK = true;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) S = normalize(JSON.parse(raw));
    } catch (e) { storageOK = false; }
    try { Object.assign(UI, JSON.parse(localStorage.getItem(KEY + ':ui') || '{}')); } catch (e) { /* ignore */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; } catch (e) { storageOK = false; }
  }
  function saveUI() { try { localStorage.setItem(KEY + ':ui', JSON.stringify(UI)); } catch (e) { /* ignore */ } }

  function normalize(d) {
    const out = Object.assign(blank(), d || {});
    for (const k of ['categories', 'accounts', 'transactions', 'debts', 'payments', 'transfers']) if (!Array.isArray(out[k])) out[k] = [];
    out.settings = Object.assign({ debtCategory: 'Debt Payments' }, out.settings || {});
    let max = 0;
    for (const k of ['accounts', 'transactions', 'debts', 'payments', 'transfers', 'categories']) {
      for (const x of out[k]) { if (x.uid) max = Math.max(max, x.uid); }
    }
    out.nextId = Math.max(out.nextId || 1, max + 1);
    for (const k of ['accounts', 'transactions', 'debts', 'payments', 'transfers', 'categories']) {
      for (const x of out[k]) if (!x.uid) x.uid = out.nextId++;
    }
    // older entries: turn "₱5,000/month" in the notes into a monthly installment plan
    for (const d of out.debts) {
      if (d.plan) continue;
      const m = String(d.notes || '').match(/₱?\s*([\d,]+(?:\.\d+)?)\s*\/\s*mo(?:nth)?/i);
      const mo = m ? num(m[1]) : 0;
      const n = mo ? num(d.amount) / mo : 0;
      if (mo > 0 && n >= 1 && Math.abs(n - Math.round(n)) < 0.001 && d.date) {
        Object.assign(d, { plan: 'Monthly installment', monthly: mo, months: Math.round(n), dueDay: +d.date.slice(8) });
      } else d.plan = 'One-time';
    }
    return out;
  }
  const newUid = () => S.nextId++;
  const hasData = () => S.debts.length || S.transactions.length || S.payments.length || S.accounts.length;

  // ---------- calculations (same rules as the Excel tracker) ----------
  const catType = (name) => (S.categories.find((c) => c.name === name) || {}).type || '';
  const debtById = (id) => S.debts.find((d) => d.id === +id);
  const payType = (p) => { const d = debtById(p.debtId); return d ? d.type : ''; };

  // ----- monthly installments -----
  const INSTALLMENT = 'Monthly installment';
  const isInst = (d) => d.plan === INSTALLMENT && num(d.monthly) > 0 && +d.months > 0;
  const ordinal = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
  // due date of installment number k (0 = first). The first one is in the start month,
  // or the month after if the due day comes before the start day.
  function installmentDue(d, k) {
    const [y, m, sd] = (d.date || todayStr()).split('-').map(Number);
    const day = +d.dueDay || sd;
    const off = day >= sd ? 0 : 1;
    const first = new Date(y, m - 1 + off + k, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return ymd(new Date(first.getFullYear(), first.getMonth(), Math.min(day, last)));
  }

  function debtCalc(d) {
    const pays = S.payments.filter((p) => +p.debtId === d.id);
    const paid = sum(pays);
    const balance = num(d.amount) - paid;
    let status = 'Unpaid';
    if (isInst(d)) {
      const n = +d.months, mo = num(d.monthly), today = todayStr();
      let expected = 0;
      while (expected < n && installmentDue(d, expected) <= today) expected++;
      const monthsPaid = Math.min(n, Math.floor((paid + 0.005) / mo));
      const next = balance > 0.004 && monthsPaid < n ? installmentDue(d, monthsPaid) : '';
      if (balance <= 0.004) status = 'Paid';
      else if (paid < expected * mo - 0.005) status = 'Overdue';
      else if (paid > 0) status = 'Partial';
      return { paid, balance, status, count: pays.length, inst: true, monthsPaid, months: n, monthly: mo, next, expected };
    }
    if (balance <= 0) status = 'Paid';
    else if (d.due && d.due < todayStr()) status = 'Overdue';
    else if (paid > 0) status = 'Partial';
    return { paid, balance, status, count: pays.length, inst: false, next: d.due || '' };
  }
  const planText = (d, c) => (c.inst ? `${money(c.monthly)}/mo · ${c.monthsPaid} of ${c.months} months · due every ${ordinal(+d.dueDay || +d.date.slice(8))}` : '');

  function catActual(c, ym) {
    let a = sum(S.transactions.filter((t) => t.category === c.name && inMonth(t.date, ym)));
    if (c.name === S.settings.debtCategory) a += sum(S.payments.filter((p) => payType(p) === OWE && inMonth(p.date, ym)));
    return a;
  }
  function catStatus(c, actual) {
    const b = num(c.budget);
    if (!b) return { diff: null, status: '' };
    if (c.type === 'Income') { const diff = actual - b; return { diff, status: diff >= 0 ? 'On track' : 'Short' }; }
    const diff = b - actual;
    return { diff, status: diff < 0 ? 'Over budget' : actual >= b * 0.9 ? 'Near limit' : 'OK' };
  }

  function accountCalc(a) {
    const since = (x) => !a.asOf || (x.date || '') >= a.asOf;
    const mine = (x) => x.account === a.name && since(x);
    const inc = sum(S.transactions.filter((t) => mine(t) && catType(t.category) === 'Income'))
      + sum(S.payments.filter((p) => mine(p) && payType(p) === OWED));
    const out = sum(S.transactions.filter((t) => mine(t) && catType(t.category) === 'Expense'))
      + sum(S.payments.filter((p) => mine(p) && payType(p) === OWE));
    const tr = sum(S.transfers.filter((t) => t.to === a.name && since(t))) - sum(S.transfers.filter((t) => t.from === a.name && since(t)));
    return { inc, out, tr, current: num(a.start) + inc - out + tr };
  }

  function totals() {
    let iOwe = 0, owedMe = 0, odOwe = 0, odMe = 0;
    const people = {};
    for (const d of S.debts) {
      const c = debtCalc(d);
      const p = people[d.person] || (people[d.person] = { owe: 0, me: 0 });
      if (d.type === OWED) { owedMe += c.balance; p.me += c.balance; if (c.status === 'Overdue') odMe += c.balance; }
      else { iOwe += c.balance; p.owe += c.balance; if (c.status === 'Overdue') odOwe += c.balance; }
    }
    const cash = S.accounts.reduce((a, x) => a + accountCalc(x).current, 0);
    return { iOwe, owedMe, odOwe, odMe, people, cash, net: cash + owedMe - iOwe };
  }
  function monthTotals(ym) {
    let bi = 0, be = 0, ai = 0, ae = 0;
    for (const c of S.categories) {
      const a = catActual(c, ym);
      if (c.type === 'Income') { bi += num(c.budget); ai += a; } else { be += num(c.budget); ae += a; }
    }
    return { bi, be, ai, ae };
  }

  // ---------- small render pieces ----------
  const statusPill = (s) => {
    const cls = { Paid: 'good', OK: 'good', 'On track': 'good', Partial: 'warn', 'Near limit': 'warn', Overdue: 'bad', 'Over budget': 'bad', Short: 'bad', Unpaid: '' }[s];
    return s ? `<span class="pill ${cls || ''}">${esc(s)}</span>` : '';
  };
  const typePill = (t) => `<span class="pill ${t === OWED ? 'good' : 'blue'}">${esc(t)}</span>`;
  const bar = (p, cls = '') => `<div class="bar ${cls}"><span style="width:${p.toFixed(1)}%"></span></div>`;
  const stat = (label, value, sub = '', cls = '') => `<div class="card stat"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const emptyRow = (cols, text) => `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;
  const rowAttrs = (kind, uid) => `class="row" data-edit="${kind}" data-uid="${uid}" tabindex="0"`;
  const debtLabel = (d) => `#${d.id} ${d.person}${d.description ? ' — ' + d.description : ''}`;

  // ---------- views ----------
  const TABS = [['summary', 'Summary'], ['budget', 'Budget'], ['accounts', 'Accounts'], ['debts', 'Debts'], ['payments', 'Payments'], ['settings', 'Settings']];

  function recentItems(limit) {
    const items = [];
    for (const t of S.transactions) {
      const inc = catType(t.category) === 'Income';
      items.push({ date: t.date, uid: t.uid, kind: 'tx', dir: inc ? 'in' : 'out', title: t.description || t.category,
        sub: [t.category, t.account, fmtDate(t.date)].filter(Boolean).join(' · '), amt: (inc ? '+' : '−') + money(t.amount) });
    }
    for (const p of S.payments) {
      const d = debtById(p.debtId), owe = payType(p) !== OWED;
      const what = d ? (d.description || '').replace(/\s*\(.*\)\s*$/, '').replace(/\s+installment$/i, '') : '';
      items.push({ date: p.date, uid: p.uid, kind: 'payment', dir: owe ? 'out' : 'in', title: d ? d.person + (what ? ' · ' + what : '') : 'Debt payment',
        sub: [owe ? 'Debt payment' : 'Paid back to me', p.account, fmtDate(p.date)].filter(Boolean).join(' · '), amt: (owe ? '−' : '+') + money(p.amount) });
    }
    for (const t of S.transfers) {
      items.push({ date: t.date, uid: t.uid, kind: 'transfer', dir: 'move', title: `${t.from} → ${t.to}`, sub: ['Transfer', fmtDate(t.date)].join(' · '), amt: money(t.amount) });
    }
    items.sort((x, y) => (y.date || '').localeCompare(x.date || '') || y.uid - x.uid);
    return items.slice(0, limit);
  }
  const ICON = {
    out: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    in: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 7L7 17M15 17H7V9"/></svg>',
    move: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h12l-3-3M17 17H5l3 3"/></svg>',
  };

  function viewSummary() {
    if (!hasData()) {
      return `<section class="card">
        <h2>Welcome</h2>
        <p>Start by loading your Excel tracker (<b>Budget_Debt_Tracker.xlsx</b>). Your accounts, debts, payments and budget will be copied in.</p>
        <p class="muted small">Your data is saved only in this browser on this device. It is never uploaded, and it is not in the GitHub repo.</p>
        <div class="btn-row"><button class="btn primary" data-act="importXlsx">Import Excel file</button>
        <button class="btn" data-act="restoreJson">Restore a backup</button>
        <button class="btn" data-act="goSettings">Start from scratch</button></div>
      </section>`;
    }
    const t = totals();
    const ym = todayStr().slice(0, 7);
    const m = monthTotals(ym);
    const left = m.ai - m.ae;
    const overdue = S.debts.filter((d) => debtCalc(d).status === 'Overdue');
    const open = S.debts.filter((d) => debtCalc(d).balance > 0);
    const people = Object.entries(t.people).filter(([, p]) => Math.abs(p.owe) > 0.004 || Math.abs(p.me) > 0.004);
    const accts = S.accounts.map((a) => ({ a, bal: accountCalc(a).current })).sort((x, y) => y.bal - x.bal);
    const dots = Math.min(5, Math.max(1, Math.ceil((accts.length + 1) / 2)));
    const recent = recentItems(6);

    return `
      ${overdue.length ? `<div class="alert"><b>${overdue.length} overdue:</b> ${overdue.map((d) => esc(debtLabel(d))).join(', ')}</div>` : ''}
      <section class="card hero">
        <div class="main">
          <div class="label">Net worth</div>
          <div class="big">${money(t.net).replace(/^-/, '−')}</div>
          <div class="cap">Money + owed to me − what I owe · ${esc(fmtDate(todayStr()))}</div>
        </div>
        <div class="side"><div class="label small">Total money</div><div class="v">${money(t.cash)}</div></div>
        <div class="side"><div class="label small">I still owe</div><div class="v bad">${money(t.iOwe)}</div>${t.owedMe ? `<div class="small muted">Others owe me ${money(t.owedMe)}</div>` : ''}</div>
      </section>

      <section>
        <div class="sec-head"><h2>Accounts <span class="muted">· ${S.accounts.length}</span></h2><button class="link" data-act="addAccount">+ Add</button></div>
        <div class="acct-strip" id="acctStrip" aria-label="Accounts">
          ${accts.map(({ a, bal }) => `<button type="button" class="acct${Math.abs(bal) < 0.005 ? ' zero' : ''}" data-edit="account" data-uid="${a.uid}">
            <span class="head"><span class="name">${esc(a.name)}</span><span class="dot"></span></span>
            <span><span class="bal${bal < 0 ? ' bad' : ''}">${money(bal)}</span><br><span class="type">${esc(a.type || '')}</span></span>
          </button>`).join('')}
          <div class="acct total"><span class="head"><span class="name">Total money</span></span><span><span class="bal">${money(t.cash)}</span><br><span class="type">${S.accounts.length} accounts</span></span></div>
        </div>
        <div class="strip-dots" id="stripDots" aria-hidden="true">${Array.from({ length: dots }, (_, i) => `<span${i === 0 ? ' class="on"' : ''}></span>`).join('')}</div>
      </section>

      <section>
        <div class="sec-head"><h2>Recent transactions</h2><button class="link" data-act="goBudget">See all</button></div>
        <div class="card pad0"><div class="tx-list">
          ${recent.length ? recent.map((r) => `<div class="tx-item" data-edit="${r.kind}" data-uid="${r.uid}" tabindex="0" role="button">
            <span class="tx-ico ${r.dir === 'out' ? 'out' : ''}">${ICON[r.dir]}</span>
            <span class="tx-main"><b>${esc(r.title)}</b><span>${esc(r.sub)}</span></span>
            <span class="tx-amt">${esc(r.amt)}</span>
          </div>`).join('') : '<p class="empty">Nothing logged yet.</p>'}
        </div></div>
      </section>

      <section class="cols">
        <div class="card">
          <div class="sec-head"><h2>Open debts</h2><button class="link" data-act="addPayment">+ Payment</button></div>
          ${open.length ? `<div class="dlist">${open.map((d) => {
            const c = debtCalc(d);
            const what = (d.description || '').replace(/\s*\(.*\)\s*$/, '').replace(/\s+installment$/i, '');
            return `<div class="ditem">
              <div class="top-line"><span>${esc(d.person)}${what ? ` <span class="muted">· ${esc(what)}</span>` : ''}</span><b>${money(c.balance)}</b></div>
              ${bar(pct(c.paid, num(d.amount)))}
              <div class="meta"><span>${c.inst ? `${money(c.monthly)}/mo · ${c.monthsPaid} of ${c.months} months` : `${money(c.paid)} of ${money(d.amount)} paid`}</span><span>${d.type === OWED ? 'Owed to me · ' : ''}${statusPill(c.status)}</span></div>
              ${c.next ? `<div class="meta"><span>Next due <b class="due">${esc(fmtDate(c.next))}</b></span><span>${c.inst ? `${money(c.paid)} of ${money(d.amount)} paid` : ''}</span></div>` : ''}
            </div>`;
          }).join('')}</div>` : '<p class="empty">No open debts.</p>'}
        </div>
        <div class="card">
          <div class="sec-head"><h2>${esc(monthLabel(ym))}</h2><button class="link" data-act="goBudget">Budget</button></div>
          <div class="grid">
            ${stat('Income', money(m.ai), `of ${money(m.bi)} expected`)}
            ${stat('Spent', money(m.ae), `of ${money(m.be)} budget`)}
          </div>
          <div style="margin-top:14px" class="small muted">Money left this month</div>
          <div class="stat"><div class="value ${left < 0 ? 'bad' : ''}">${money(left).replace(/^-/, '−')}</div></div>
          ${m.be ? bar(pct(m.ae, m.be)) : ''}
        </div>
      </section>

      ${people.length > 1 ? `<section>
        <div class="sec-head"><h2>By person</h2></div>
        <div class="card pad0 table-wrap"><table>
          <thead><tr><th>Person</th><th class="num">I owe</th><th class="num">Owes me</th><th class="num">Net</th></tr></thead>
          <tbody>${people.map(([n, p]) => `<tr><td>${esc(n)}</td><td class="num">${money(p.owe)}</td><td class="num">${money(p.me)}</td><td class="num ${p.me - p.owe < 0 ? 'bad' : ''}">${money(p.me - p.owe)}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>` : ''}`;
  }

  function viewBudget() {
    const ym = UI.month;
    const m = monthTotals(ym);
    const rows = S.categories.map((c) => {
      const a = catActual(c, ym);
      const st = catStatus(c, a);
      const b = num(c.budget);
      const cls = st.status === 'Over budget' || st.status === 'Short' ? 'bad' : st.status === 'Near limit' ? 'warn' : 'good';
      return `<tr ${rowAttrs('category', c.uid)}>
        <td>${esc(c.name)}${c.name === S.settings.debtCategory ? '<div class="desc">includes Payments tab</div>' : ''}</td>
        <td class="hide-sm"><span class="pill ${c.type === 'Income' ? 'good' : ''}">${esc(c.type)}</span></td>
        <td class="num">${b ? money(b) : '<span class="muted">—</span>'}</td>
        <td class="num">${money(a)}${b ? bar(pct(a, b), cls) : ''}</td>
        <td class="num hide-sm ${st.diff != null && st.diff < 0 ? 'bad' : ''}">${st.diff == null ? '' : money(st.diff)}</td>
        <td>${statusPill(st.status)}</td></tr>`;
    }).join('');

    const tx = S.transactions.filter((t) => inMonth(t.date, ym)).map((t) => ({ kind: 'tx', date: t.date, t }));
    const pays = S.payments.filter((p) => inMonth(p.date, ym)).map((p) => ({ kind: 'pay', date: p.date, p }));
    const list = tx.concat(pays).sort((a, b) => (b.date || '').localeCompare(a.date || '') || 0);
    const txRows = list.map((x) => {
      if (x.kind === 'tx') {
        const t = x.t, ty = catType(t.category);
        return `<tr ${rowAttrs('tx', t.uid)}>
          <td>${esc(fmtDate(t.date))}</td>
          <td>${esc(t.description || '')}<div class="desc">${esc(t.category)}${t.notes ? ' · ' + esc(t.notes) : ''}</div></td>
          <td class="hide-sm">${esc(t.account || '')}</td>
          <td class="num ${ty === 'Income' ? 'good' : ''}">${ty === 'Income' ? '+' : '−'}${money(t.amount)}</td></tr>`;
      }
      const p = x.p, d = debtById(p.debtId), owe = payType(p) === OWE;
      return `<tr class="row ro" data-edit="payment" data-uid="${p.uid}" tabindex="0" title="Edit on the Payments tab">
        <td>${esc(fmtDate(p.date))}</td>
        <td>${esc(d ? (owe ? 'Paid ' : 'Received from ') + d.person : 'Debt payment')}<div class="desc">${owe ? esc(S.settings.debtCategory) : 'Debt repaid to me'} · from Payments tab</div></td>
        <td class="hide-sm">${esc(p.account || '')}</td>
        <td class="num ${owe ? '' : 'good'}">${owe ? '−' : '+'}${money(p.amount)}</td></tr>`;
    }).join('');

    return `
      <section class="sec-head">
        <div class="monthbar">
          <button class="btn sm" data-act="prevMonth" aria-label="Previous month">‹</button>
          <input type="month" id="monthPick" value="${esc(ym)}" aria-label="Month">
          <button class="btn sm" data-act="nextMonth" aria-label="Next month">›</button>
        </div>
        <button class="btn primary" data-act="addTx">+ Income / Expense</button>
      </section>
      <section class="grid">
        ${stat('Income', money(m.ai), `of ${money(m.bi)} expected`, 'good')}
        ${stat('Expenses', money(m.ae), `of ${money(m.be)} budget`)}
        ${stat('Money left', money(m.ai - m.ae), `planned: ${money(m.bi - m.be)}`, m.ai - m.ae < 0 ? 'bad' : '')}
      </section>
      <section>
        <div class="sec-head"><h2>Categories</h2><span class="muted small">Tap a row to set its budget</span></div>
        <div class="card pad0 table-wrap"><table>
          <thead><tr><th>Category</th><th class="hide-sm">Type</th><th class="num">Budget</th><th class="num">Actual</th><th class="num hide-sm">Difference</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>
      <section>
        <div class="sec-head"><h2>Transactions · ${esc(monthLabel(ym))}</h2></div>
        <div class="card pad0 table-wrap"><table>
          <thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Account</th><th class="num">Amount</th></tr></thead>
          <tbody>${txRows || emptyRow(4, 'Nothing logged this month yet.')}</tbody>
        </table></div>
        <p class="muted small">Debt payments come from the Payments tab automatically. Don't log them here too.</p>
      </section>`;
  }

  function viewAccounts() {
    const t = totals();
    const rows = S.accounts.map((a) => {
      const c = accountCalc(a);
      return `<tr ${rowAttrs('account', a.uid)}>
        <td>${esc(a.name)}<div class="desc">${esc(a.type || '')}${a.notes ? ' · ' + esc(a.notes) : ''}</div></td>
        <td class="num hide-sm">${money(a.start)}<div class="desc">as of ${esc(fmtDate(a.asOf) || '—')}</div></td>
        <td class="num hide-sm good">${c.inc ? '+' + money(c.inc) : ''}</td>
        <td class="num hide-sm">${c.out ? '−' + money(c.out) : ''}</td>
        <td class="num hide-sm">${c.tr ? (c.tr > 0 ? '+' : '−') + money(Math.abs(c.tr)) : ''}</td>
        <td class="num ${c.current < 0 ? 'bad' : ''}"><b>${money(c.current)}</b></td></tr>`;
    }).join('');
    const tr = [...S.transfers].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((x) => `<tr ${rowAttrs('transfer', x.uid)}>
        <td>${esc(fmtDate(x.date))}</td><td>${esc(x.from)} → ${esc(x.to)}${x.notes ? `<div class="desc">${esc(x.notes)}</div>` : ''}</td><td class="num">${money(x.amount)}</td></tr>`).join('');
    return `
      <section class="sec-head"><h2>My accounts</h2><button class="btn primary" data-act="addAccount">+ Account</button></section>
      <section class="card pad0 table-wrap"><table>
        <thead><tr><th>Account</th><th class="num hide-sm">Starting</th><th class="num hide-sm">Money in</th><th class="num hide-sm">Money out</th><th class="num hide-sm">Transfers</th><th class="num">Balance</th></tr></thead>
        <tbody>${rows || emptyRow(6, 'Add your banks, e-wallets and cash.')}</tbody>
        <tfoot><tr><td>Total money</td><td class="hide-sm"></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="num">${money(t.cash)}</td></tr></tfoot>
      </table></section>
      <p class="muted small">Balance = starting balance on the "as of" date + income − expenses − debt payments + money paid back to you ± transfers, all from that date on.</p>
      <section>
        <div class="sec-head"><h2>Transfers between accounts</h2><button class="btn" data-act="addTransfer" ${S.accounts.length < 2 ? 'disabled' : ''}>+ Transfer</button></div>
        <div class="card pad0 table-wrap"><table>
          <thead><tr><th>Date</th><th>From → To</th><th class="num">Amount</th></tr></thead>
          <tbody>${tr || emptyRow(3, 'ATM withdrawals, GCash cash-ins, moving money to savings…')}</tbody>
        </table></div>
      </section>`;
  }

  function viewDebts() {
    const list = S.debts.filter((d) => UI.showPaid || debtCalc(d).status !== 'Paid');
    const hidden = S.debts.length - list.length;
    const t = totals();
    const rows = list.map((d) => {
      const c = debtCalc(d);
      return `<tr ${rowAttrs('debt', d.uid)}>
        <td class="muted">#${d.id}</td>
        <td><b>${esc(d.person)}</b><div class="desc">${esc(d.description || '')}</div>${c.inst ? `<div class="desc">${esc(planText(d, c))}</div>` : ''}</td>
        <td class="hide-sm">${typePill(d.type)}</td>
        <td class="num hide-sm">${money(d.amount)}</td>
        <td class="num hide-sm">${money(c.paid)}${bar(pct(c.paid, num(d.amount)), 'good')}</td>
        <td class="num"><b>${money(c.balance)}</b></td>
        <td class="hide-sm">${esc(fmtDate(c.next))}${c.inst && c.next ? '<div class="desc">next payment</div>' : ''}</td>
        <td>${statusPill(c.status)}</td></tr>`;
    }).join('');
    return `
      <section class="grid">
        ${stat('I still owe', money(t.iOwe), '', t.iOwe > 0 ? 'bad' : '')}
        ${stat('Others owe me', money(t.owedMe), '', 'good')}
        ${stat('Net', money(t.owedMe - t.iOwe), 'owed to me − I owe', t.owedMe - t.iOwe < 0 ? 'bad' : 'good')}
      </section>
      <section>
        <div class="sec-head"><h2>Debts</h2>
          <div class="btn-row">
            <button class="btn sm" data-act="togglePaid">${UI.showPaid ? 'Hide paid' : `Show paid${hidden ? ` (${hidden})` : ''}`}</button>
            <button class="btn primary" data-act="addDebt">+ Debt</button>
          </div>
        </div>
        <div class="card pad0 table-wrap"><table>
          <thead><tr><th>ID</th><th>Person</th><th class="hide-sm">Type</th><th class="num hide-sm">Amount</th><th class="num hide-sm">Paid</th><th class="num">Balance</th><th class="hide-sm">Due</th><th>Status</th></tr></thead>
          <tbody>${rows || emptyRow(8, 'No debts. Add an utang (I owe) or pautang (owed to me).')}</tbody>
        </table></div>
        <p class="muted small">Paid and Balance come from the Payments tab.</p>
      </section>`;
  }

  function viewPayments() {
    const rows = [...S.payments].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((p) => {
      const d = debtById(p.debtId);
      return `<tr ${rowAttrs('payment', p.uid)}>
        <td>${esc(fmtDate(p.date))}</td>
        <td>${d ? `<b>${esc(d.person)}</b> <span class="muted">#${d.id}</span><div class="desc">${esc(d.description || '')}</div>` : `<span class="bad">Debt #${esc(p.debtId)} not found</span>`}</td>
        <td class="hide-sm">${d ? typePill(d.type) : ''}</td>
        <td class="hide-sm">${esc(p.account || '')}${p.notes ? `<div class="desc">${esc(p.notes)}</div>` : ''}</td>
        <td class="num"><b>${money(p.amount)}</b></td></tr>`;
    }).join('');
    return `
      <section class="sec-head"><h2>Payments log</h2><button class="btn primary" data-act="addPayment" ${S.debts.length ? '' : 'disabled'}>+ Payment</button></section>
      <div class="info small">One entry per payment. It lowers the debt, counts as <b>${esc(S.settings.debtCategory)}</b> in that month's budget, and updates the account you pick.</div>
      <section class="card pad0 table-wrap"><table>
        <thead><tr><th>Date</th><th>Debt</th><th class="hide-sm">Type</th><th class="hide-sm">Account</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows || emptyRow(5, 'No payments yet.')}</tbody>
        <tfoot><tr><td colspan="2">Total paid</td><td class="hide-sm"></td><td class="hide-sm"></td><td class="num">${money(sum(S.payments))}</td></tr></tfoot>
      </table></section>`;
  }

  function viewSettings() {
    const cats = S.categories.map((c) => `<tr ${rowAttrs('category', c.uid)}><td>${esc(c.name)}</td><td><span class="pill ${c.type === 'Income' ? 'good' : ''}">${esc(c.type)}</span></td><td class="num">${num(c.budget) ? money(c.budget) : '<span class="muted">—</span>'}</td></tr>`).join('');
    return `
      <section>
        <div class="sec-head"><h2>Your data</h2></div>
        <div class="card">
          <p class="small" style="margin-top:0">Everything is saved in <b>this browser on this device</b> only. To use it on your phone too, make a backup here and restore it there.</p>
          ${storageOK ? '' : '<p class="bad small">This browser is blocking storage (private mode?). Changes will be lost when you close the page. Make a backup before leaving.</p>'}
          <div class="btn-row">
            <button class="btn primary" data-act="importXlsx">Import Excel file</button>
            <button class="btn" data-act="backupJson">Download backup</button>
            <button class="btn" data-act="restoreJson">Restore backup</button>
            <button class="btn" data-act="exportCsv">Export CSV</button>
            <button class="btn danger" data-act="eraseAll">Erase all data</button>
          </div>
          <p class="muted small" style="margin-bottom:0">Import Excel reads Budget_Debt_Tracker.xlsx (Ledger, Payments, Budget and Accounts tabs) and replaces what's here.</p>
        </div>
      </section>
      <section>
        <div class="sec-head"><h2>Budget categories</h2><button class="btn" data-act="addCategory">+ Category</button></div>
        <div class="card pad0 table-wrap"><table>
          <thead><tr><th>Category</th><th>Type</th><th class="num">Monthly budget</th></tr></thead>
          <tbody>${cats || emptyRow(3, 'No categories.')}</tbody>
        </table></div>
      </section>
      <section>
        <div class="sec-head"><h2>Appearance</h2></div>
        <div class="card btn-row">
          <button class="btn sm" data-act="setTheme" data-v="light">Light</button>
          <button class="btn sm" data-act="setTheme" data-v="dark">Dark</button>
        </div>
      </section>`;
  }

  const VIEWS = { summary: viewSummary, budget: viewBudget, accounts: viewAccounts, debts: viewDebts, payments: viewPayments, settings: viewSettings };

  function render() {
    if (!VIEWS[UI.tab]) UI.tab = 'summary';
    $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab${UI.tab === k ? ' on' : ''}" data-tab="${k}" ${UI.tab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('');
    $('#view').innerHTML = VIEWS[UI.tab]();
    $('#drawerNav').innerHTML = TABS.map(([k, l]) => `<button type="button" class="${UI.tab === k ? 'on' : ''}" data-tab="${k}" ${UI.tab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('');
    $('#pageTitle').textContent = (TABS.find(([k]) => k === UI.tab) || [, ''])[1];
    syncThemeButton();
    if (!storageOK && !render.warned) { render.warned = true; toast('Browser storage is blocked — changes will not be saved.', 5000); }
  }

  // ---------- dialog forms ----------
  const dlg = $('#dlg');
  const form = $('#dlgForm');

  function fieldHTML(f, v) {
    const val = v[f.key] ?? f.default ?? '';
    const id = 'f_' + f.key;
    const req = f.required ? ' required' : '';
    let input;
    if (f.type === 'select') {
      const opts = (typeof f.options === 'function' ? f.options() : f.options).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
      input = `<select id="${id}" name="${f.key}"${req}>${f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : ''}${opts.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(val) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'money') {
      input = `<input id="${id}" name="${f.key}" type="text" inputmode="decimal" autocomplete="off" value="${val === '' ? '' : esc(val)}" placeholder="0.00"${req}>`;
    } else {
      input = `<input id="${id}" name="${f.key}" type="${f.type || 'text'}" value="${esc(val)}"${f.list ? ` list="${id}_l"` : ''} autocomplete="off"${req}>`
        + (f.list ? `<datalist id="${id}_l">${f.list().map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : '');
    }
    return `<div class="field${f.full ? ' full' : ''}" data-field="${f.key}"><label for="${id}">${esc(f.label)}${f.required ? '' : ' <span class="muted">(optional)</span>'}</label>${input}${f.hint ? `<div class="hint">${f.hint}</div>` : ''}</div>`;
  }

  function openForm({ title, note = '', fields, values = {}, onSave, onDelete, deleteLabel = 'Delete', saveLabel = 'Save', onChange }) {
    form.innerHTML = `<h2>${esc(title)}</h2>${note ? `<p class="muted small" style="margin:0">${note}</p>` : ''}
      <div class="fields">${fields.map((f) => fieldHTML(f, values)).join('')}</div>
      <p class="err" id="dlgErr"></p>
      <div class="actions">${onDelete ? `<button type="button" class="btn danger" data-dlg="del">${esc(deleteLabel)}</button>` : ''}<span class="sp"></span>
        <button type="button" class="btn" data-dlg="cancel">Cancel</button>${onSave ? `<button type="submit" class="btn primary">${esc(saveLabel)}</button>` : ''}</div>`;
    const shown = (f) => !f.showIf || (form.elements[f.showIf.key] && form.elements[f.showIf.key].value === f.showIf.value);
    const sync = (e) => {
      for (const f of fields) if (f.showIf) form.querySelector(`[data-field="${f.key}"]`).hidden = !shown(f);
      if (onChange) onChange(form, e);
    };
    form.onchange = sync;
    form.oninput = (e) => { if (onChange) onChange(form, e); };
    sync();
    form.onsubmit = (e) => {
      e.preventDefault();
      const vals = {};
      for (const f of fields) {
        if (!shown(f)) { vals[f.key] = f.type === 'money' ? 0 : ''; continue; }
        const el = form.elements[f.key];
        let v = el ? el.value.trim() : '';
        if (f.required && !v) return showErr(`${f.label} is required.`);
        if (f.type === 'money') {
          if (v && !Number.isFinite(parseFloat(v.replace(/[₱,\s]/g, '')))) return showErr(`${f.label} must be a number.`);
          v = v ? num(v) : 0;
        }
        vals[f.key] = v;
      }
      const err = onSave(vals);
      if (err) return showErr(err);
      commit();
      dlg.close();
    };
    form.onclick = (e) => {
      const b = e.target.closest('[data-dlg]');
      if (!b) return;
      if (b.dataset.dlg === 'cancel') dlg.close();
      if (b.dataset.dlg === 'del') {
        if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Tap again to confirm'; return; }
        const err = onDelete();
        if (err) return showErr(err);
        commit();
        dlg.close();
      }
    };
    dlg.showModal();
    const first = form.querySelector('input,select');
    if (first && window.matchMedia('(pointer:fine)').matches) first.focus();
  }
  const showErr = (m) => { $('#dlgErr').textContent = m; };
  function confirmBox(title, message, yesLabel, onYes) {
    openForm({ title, note: message, fields: [], onSave: () => { onYes(); }, saveLabel: yesLabel });
  }
  function commit() { save(); render(); }

  // ---------- option lists ----------
  const accountOpts = () => S.accounts.map((a) => a.name);
  const personList = () => [...new Set(S.debts.map((d) => d.person))];
  const catOpts = (current) => S.categories.filter((c) => c.name !== S.settings.debtCategory || c.name === current).map((c) => ({ value: c.name, label: `${c.name} (${c.type})` }));
  const debtOpts = (current) => S.debts
    .filter((d) => debtCalc(d).balance > 0 || d.id === +current)
    .map((d) => ({ value: d.id, label: `${debtLabel(d)} · ${money(debtCalc(d).balance)} left` }));
  const defaultDate = () => (UI.tab === 'budget' && UI.month !== todayStr().slice(0, 7) ? UI.month + '-01' : todayStr());

  // ---------- editors ----------
  const find = (arr, uid) => arr.find((x) => x.uid === +uid);
  const removeFrom = (key, uid) => { S[key] = S[key].filter((x) => x.uid !== +uid); };

  function editTx(uid) {
    const t = uid ? find(S.transactions, uid) : null;
    if (!S.accounts.length) { toast('Add an account first (Accounts tab).'); UI.tab = 'accounts'; render(); return; }
    openForm({
      title: t ? 'Edit entry' : 'Add income / expense',
      fields: [
        { key: 'date', label: 'Date', type: 'date', required: true, default: defaultDate() },
        { key: 'amount', label: 'Amount (₱)', type: 'money', required: true },
        { key: 'category', label: 'Category', type: 'select', required: true, placeholder: 'Choose…', options: () => catOpts(t && t.category), full: true, hint: 'Debt payments go on the Payments tab instead.' },
        { key: 'description', label: 'Description', full: true },
        { key: 'account', label: 'Account', type: 'select', required: true, placeholder: 'Choose…', options: accountOpts },
        { key: 'notes', label: 'Notes' },
      ],
      values: t || {},
      onSave: (v) => {
        if (v.amount <= 0) return 'Amount must be more than 0.';
        if (t) Object.assign(t, v); else S.transactions.push({ uid: newUid(), ...v });
        toast(t ? 'Saved' : 'Added');
      },
      onDelete: t ? () => { removeFrom('transactions', uid); toast('Deleted'); } : null,
    });
  }

  function editDebt(uid) {
    const d = uid ? find(S.debts, uid) : null;
    const pc = d ? debtCalc(d).count : 0;
    const instOnly = { key: 'plan', value: INSTALLMENT };
    const oneOnly = { key: 'plan', value: 'One-time' };
    openForm({
      title: d ? `Edit debt #${d.id}` : 'Add debt',
      fields: [
        { key: 'person', label: 'Person / lender', required: true, list: personList },
        { key: 'type', label: 'Type', type: 'select', options: [OWE, OWED], default: OWE, required: true },
        { key: 'plan', label: 'Payment', type: 'select', options: ['One-time', INSTALLMENT], default: 'One-time', required: true, full: true },
        { key: 'description', label: 'Description', full: true, hint: 'e.g. Yamaha XMAX, iPhone 17, lunch money' },
        { key: 'amount', label: 'Total amount (₱)', type: 'money', required: true, showIf: oneOnly },
        { key: 'due', label: 'Due date', type: 'date', showIf: oneOnly, hint: 'Shows Overdue after this date if not fully paid.' },
        { key: 'monthly', label: 'Monthly amount (₱)', type: 'money', required: true, showIf: instOnly },
        { key: 'months', label: 'How many months', type: 'number', required: true, showIf: instOnly },
        { key: 'dueDay', label: 'Due every (day of month)', type: 'number', required: true, showIf: instOnly, hint: 'e.g. 10 = every 10th' },
        { key: 'date', label: 'Start date', type: 'date', default: todayStr(), hint: 'For installments: the month of the first payment.' },
        { key: 'notes', label: 'Notes', full: true },
      ],
      values: d || {},
      onChange: (f) => {
        const hint = f.querySelector('[data-field="months"] .hint') || (() => { const h = document.createElement('div'); h.className = 'hint'; f.querySelector('[data-field="months"]').appendChild(h); return h; })();
        const mo = num(f.elements.monthly.value), n = parseInt(f.elements.months.value, 10);
        hint.textContent = mo > 0 && n > 0 ? `Total: ${money(mo * n)}` : '';
      },
      onSave: (v) => {
        if (v.plan === INSTALLMENT) {
          const n = parseInt(v.months, 10), day = parseInt(v.dueDay, 10);
          if (!(v.monthly > 0)) return 'Monthly amount must be more than 0.';
          if (!(n >= 1 && n <= 600)) return 'How many months must be a whole number from 1 to 600.';
          if (!(day >= 1 && day <= 31)) return 'Due day must be from 1 to 31.';
          if (!v.date) return 'Start date is required for installments.';
          Object.assign(v, { months: n, dueDay: day, amount: Math.round(v.monthly * n * 100) / 100, due: '' });
        } else {
          if (!(v.amount > 0)) return 'Amount must be more than 0.';
          Object.assign(v, { monthly: 0, months: 0, dueDay: 0 });
        }
        if (d) Object.assign(d, v);
        else { const id = S.debts.reduce((m, x) => Math.max(m, x.id), 0) + 1; S.debts.push({ uid: newUid(), id, ...v }); }
        toast(d ? 'Saved' : 'Debt added');
      },
      onDelete: d ? () => { S.payments = S.payments.filter((p) => +p.debtId !== d.id); removeFrom('debts', uid); toast('Deleted'); } : null,
      deleteLabel: pc ? `Delete (+${pc} payment${pc > 1 ? 's' : ''})` : 'Delete',
    });
  }

  function editPayment(uid) {
    const p = uid ? find(S.payments, uid) : null;
    if (!S.debts.length) { toast('Add a debt first.'); return; }
    openForm({
      title: p ? 'Edit payment' : 'Add payment',
      note: 'Lowers the debt, counts in this month\'s budget and updates the account.',
      fields: [
        { key: 'debtId', label: 'Debt', type: 'select', required: true, placeholder: 'Choose…', options: () => debtOpts(p && p.debtId), full: true },
        { key: 'date', label: 'Date', type: 'date', required: true, default: todayStr() },
        { key: 'amount', label: 'Amount (₱)', type: 'money', required: true },
        { key: 'account', label: 'Account', type: 'select', required: !!S.accounts.length, placeholder: 'Choose…', options: accountOpts, hint: 'Paid from (I owe) or received into (owed to me).' },
        { key: 'notes', label: 'Notes' },
      ],
      values: p || {},
      onChange: (f, e) => {
        if (!e || e.type !== 'change' || e.target.name !== 'debtId') return;
        const d = debtById(f.elements.debtId.value);
        if (d && isInst(d) && !f.elements.amount.value) f.elements.amount.value = num(d.monthly).toFixed(2);
      },
      onSave: (v) => {
        if (v.amount <= 0) return 'Amount must be more than 0.';
        v.debtId = +v.debtId;
        if (p) Object.assign(p, v); else S.payments.push({ uid: newUid(), ...v });
        toast(p ? 'Saved' : 'Payment added');
      },
      onDelete: p ? () => { removeFrom('payments', uid); toast('Deleted'); } : null,
    });
  }

  function renameRefs(field, oldName, newName, lists) {
    if (!oldName || oldName === newName) return;
    for (const k of lists) for (const x of S[k]) for (const f of field) if (x[f] === oldName) x[f] = newName;
  }

  function editAccount(uid) {
    const a = uid ? find(S.accounts, uid) : null;
    openForm({
      title: a ? `Edit ${a.name}` : 'Add account',
      fields: [
        { key: 'name', label: 'Name', required: true, hint: 'e.g. BDO, GCash, Cash on hand' },
        { key: 'type', label: 'Type', type: 'select', options: ACCOUNT_TYPES, default: 'Bank', required: true },
        { key: 'start', label: 'Balance (₱)', type: 'money', required: true, hint: 'What the account has on the date →' },
        { key: 'asOf', label: 'As of', type: 'date', required: true, default: todayStr(), hint: 'Entries from this date on update the balance.' },
        { key: 'notes', label: 'Notes', full: true },
      ],
      values: a || {},
      onSave: (v) => {
        if (S.accounts.some((x) => x !== a && x.name.toLowerCase() === v.name.toLowerCase())) return 'You already have an account with that name.';
        if (a) {
          renameRefs(['account'], a.name, v.name, ['transactions', 'payments']);
          renameRefs(['from', 'to'], a.name, v.name, ['transfers']);
          Object.assign(a, v);
        } else S.accounts.push({ uid: newUid(), ...v });
        toast(a ? 'Saved' : 'Account added');
      },
      onDelete: a ? () => {
        const used = S.transactions.filter((t) => t.account === a.name).length + S.payments.filter((p) => p.account === a.name).length + S.transfers.filter((t) => t.from === a.name || t.to === a.name).length;
        if (used) return `${a.name} is used by ${used} entr${used > 1 ? 'ies' : 'y'}. Rename it instead, or delete those entries first.`;
        removeFrom('accounts', uid); toast('Deleted');
      } : null,
    });
  }

  function editTransfer(uid) {
    const t = uid ? find(S.transfers, uid) : null;
    openForm({
      title: t ? 'Edit transfer' : 'Move money between accounts',
      fields: [
        { key: 'from', label: 'From', type: 'select', required: true, placeholder: 'Choose…', options: accountOpts },
        { key: 'to', label: 'To', type: 'select', required: true, placeholder: 'Choose…', options: accountOpts },
        { key: 'amount', label: 'Amount (₱)', type: 'money', required: true },
        { key: 'date', label: 'Date', type: 'date', required: true, default: todayStr() },
        { key: 'notes', label: 'Notes', full: true, hint: 'e.g. ATM withdrawal, GCash cash-in. Add any fee as an expense.' },
      ],
      values: t || {},
      onSave: (v) => {
        if (v.from === v.to) return 'From and To must be different accounts.';
        if (v.amount <= 0) return 'Amount must be more than 0.';
        if (t) Object.assign(t, v); else S.transfers.push({ uid: newUid(), ...v });
        toast(t ? 'Saved' : 'Transfer added');
      },
      onDelete: t ? () => { removeFrom('transfers', uid); toast('Deleted'); } : null,
    });
  }

  function editCategory(uid) {
    const c = uid ? find(S.categories, uid) : null;
    const isDebt = c && c.name === S.settings.debtCategory;
    openForm({
      title: c ? `Edit ${c.name}` : 'Add category',
      note: isDebt ? 'This category also counts every "I owe" payment from the Payments tab.' : '',
      fields: [
        { key: 'name', label: 'Name', required: true },
        { key: 'type', label: 'Type', type: 'select', options: ['Income', 'Expense'], default: 'Expense', required: true },
        { key: 'budget', label: 'Monthly budget (₱)', type: 'money', full: true, hint: 'For Income, this is what you expect to earn.' },
      ],
      values: c || {},
      onSave: (v) => {
        if (S.categories.some((x) => x !== c && x.name.toLowerCase() === v.name.toLowerCase())) return 'That category already exists.';
        if (c) {
          renameRefs(['category'], c.name, v.name, ['transactions']);
          if (isDebt) S.settings.debtCategory = v.name;
          Object.assign(c, v);
        } else S.categories.push({ uid: newUid(), ...v });
        toast('Saved');
      },
      onDelete: c && !isDebt ? () => {
        const used = S.transactions.filter((t) => t.category === c.name).length;
        if (used) return `${used} entr${used > 1 ? 'ies use' : 'y uses'} this category. Rename it instead.`;
        removeFrom('categories', uid); toast('Deleted');
      } : null,
    });
  }

  const EDIT = { tx: editTx, debt: editDebt, payment: editPayment, account: editAccount, transfer: editTransfer, category: editCategory };

  // ---------- Excel import (reads the .xlsx directly with JSZip) ----------
  async function readXlsx(buf) {
    const zip = await JSZip.loadAsync(buf);
    const parse = async (path) => { const f = zip.file(path); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
    const byTag = (doc, tag) => Array.from(doc.getElementsByTagNameNS('*', tag));
    const shared = [];
    const ss = await parse('xl/sharedStrings.xml');
    if (ss) for (const si of byTag(ss, 'si')) shared.push(byTag(si, 't').map((t) => t.textContent).join(''));
    const wbDoc = await parse('xl/workbook.xml');
    const rels = await parse('xl/_rels/workbook.xml.rels');
    const relMap = {};
    for (const r of byTag(rels, 'Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
    const sheets = {};
    for (const s of byTag(wbDoc, 'sheet')) {
      const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
      let target = relMap[rid] || '';
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const doc = await parse(target);
      if (!doc) continue;
      const cells = {};
      for (const c of byTag(doc, 'c')) {
        const ref = c.getAttribute('r'), t = c.getAttribute('t');
        const vEl = byTag(c, 'v')[0];
        let v;
        if (t === 's') v = vEl ? shared[+vEl.textContent] : undefined;
        else if (t === 'inlineStr') v = byTag(c, 't').map((x) => x.textContent).join('');
        else if (t === 'str' || t === 'e') v = vEl ? vEl.textContent : undefined;
        else if (t === 'b') v = vEl ? vEl.textContent === '1' : undefined;
        else v = vEl && vEl.textContent !== '' ? Number(vEl.textContent) : undefined;
        if (v !== undefined && v !== '') cells[ref] = v;
      }
      sheets[s.getAttribute('name')] = cells;
    }
    return sheets;
  }

  function serialToDate(n) {
    const ms = Math.round((n - 25569) * 86400000);
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  function asDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return v > 0 && v < 2958466 ? serialToDate(v) : '';
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) { const d = new Date(+m[3], +m[1] - 1, Math.min(+m[2], new Date(+m[3], +m[1], 0).getDate())); return ymd(d); }
    const t = Date.parse(s);
    return Number.isNaN(t) ? '' : ymd(new Date(t));
  }

  function fromWorkbook(sheets) {
    const out = blank();
    out.categories = [];
    const str = (ws, a) => (ws && ws[a] != null ? String(ws[a]).trim() : '');
    const val = (ws, a) => (ws ? ws[a] : undefined);
    const amt = (ws, a) => { const v = val(ws, a); return typeof v === 'number' ? v : num(v); };
    const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const maxRow = (ws) => Object.keys(ws || {}).reduce((m, k) => Math.max(m, +k.replace(/^[A-Z]+/, '')), 0);
    // find a header row (within first 15 rows) where `col` has `text`; return {row, map: header -> col}
    const header = (ws, col, text, from = 1, to = 15) => {
      for (let r = from; r <= to; r++) {
        if (str(ws, col + r).toLowerCase() === text.toLowerCase()) {
          const map = {};
          for (const c of COLS) { const h = str(ws, c + r).toLowerCase(); if (h && !(h in map)) map[h] = c; }
          return { row: r, map };
        }
      }
      return null;
    };
    const pick = (map, ...names) => { for (const n of names) if (map[n.toLowerCase()]) return map[n.toLowerCase()]; return null; };
    const counts = {};

    // Ledger → debts
    const L = sheets['Ledger'];
    const lh = L && header(L, 'A', 'ID');
    if (lh) {
      const m = lh.map;
      const cDate = pick(m, 'date'), cPer = pick(m, 'person'), cType = pick(m, 'type'), cDesc = pick(m, 'description'),
        cAmt = pick(m, 'amount'), cDue = pick(m, 'due date'), cNotes = pick(m, 'notes');
      for (let r = lh.row + 1, end = maxRow(L); r <= end; r++) {
        const person = str(L, cPer + r);
        if (!person) continue;
        const ty = str(L, cType + r);
        out.debts.push({
          id: r - lh.row, date: asDate(val(L, cDate + r)), person,
          type: /owed to me|pautang/i.test(ty) ? OWED : OWE,
          description: cDesc ? str(L, cDesc + r) : '', amount: amt(L, cAmt + r),
          due: cDue ? asDate(val(L, cDue + r)) : '', notes: cNotes ? str(L, cNotes + r) : '',
        });
      }
    }
    counts.debts = out.debts.length;

    // Payments
    const P = sheets['Payments'];
    const ph = P && header(P, 'A', 'Date');
    if (ph) {
      const m = ph.map;
      const cId = pick(m, 'ledger id'), cAmt = pick(m, 'amount'), cAcc = pick(m, 'account', 'method', 'method / notes'), cNotes = pick(m, 'notes');
      for (let r = ph.row + 1, end = maxRow(P); r <= end; r++) {
        const id = val(P, cId + r);
        if (id == null || id === '') continue;
        out.payments.push({ date: asDate(val(P, 'A' + r)), debtId: Math.round(num(id)), amount: amt(P, cAmt + r), account: cAcc ? str(P, cAcc + r) : '', notes: cNotes && cNotes !== cAcc ? str(P, cNotes + r) : '' });
      }
    }
    counts.payments = out.payments.length;

    // Budget → categories, transactions, month
    const B = sheets['Budget'];
    const bh = B && header(B, 'A', 'Category');
    if (bh) {
      for (let r = bh.row + 1; r <= bh.row + 60; r++) {
        const name = str(B, 'A' + r), ty = str(B, 'B' + r);
        if (/^(this month|blank yellow)/i.test(name)) break;
        if (!name || !/^(income|expense)$/i.test(ty)) continue;
        out.categories.push({ name, type: /^income$/i.test(ty) ? 'Income' : 'Expense', budget: amt(B, 'C' + r) });
      }
      // the transactions table sits to the right of the category table, starting at its "Date" column
      const cDate = pick(bh.map, 'date');
      const m = {};
      if (cDate) for (const c of COLS.slice(COLS.indexOf(cDate))) { const h = str(B, c + bh.row).toLowerCase(); if (h && !(h in m)) m[h] = c; }
      const cDesc = pick(m, 'description'), cCat = pick(m, 'category'), cAmt = pick(m, 'amount'), cAcc = pick(m, 'account', 'method'), cNotes = pick(m, 'notes');
      if (cDate && cDate !== 'A' && cCat && cAmt) {
        for (let r = bh.row + 1, end = maxRow(B); r <= end; r++) {
          const date = asDate(val(B, cDate + r)), cat = str(B, cCat + r), a = amt(B, cAmt + r);
          if (!date && !cat && !a) continue;
          if (cat === out.settings.debtCategory) continue; // debt payments come from the Payments tab
          out.transactions.push({ date, description: cDesc ? str(B, cDesc + r) : '', category: cat, amount: a, account: cAcc ? str(B, cAcc + r) : '', notes: cNotes ? str(B, cNotes + r) : '' });
        }
      }
      const mm = asDate(val(B, 'B3'));
      if (mm) UI.month = mm.slice(0, 7);
    }
    if (!out.categories.length) out.categories = blank().categories;
    if (!out.categories.some((c) => c.name === out.settings.debtCategory)) out.categories.push({ name: out.settings.debtCategory, type: 'Expense', budget: 0 });
    counts.transactions = out.transactions.length;

    // Accounts + transfers
    const A = sheets['Accounts'];
    const ah = A && header(A, 'A', 'Account');
    if (ah) {
      const m = ah.map;
      const cType = pick(m, 'type'), cStart = pick(m, 'starting balance'), cAsOf = pick(m, 'as of'), cNotes = pick(m, 'notes');
      let r = ah.row + 1;
      for (; r <= ah.row + 60; r++) {
        const name = str(A, 'A' + r);
        if (/^total money/i.test(name) || /^transfers/i.test(name)) break;
        if (!name) continue;
        out.accounts.push({ name, type: cType ? str(A, cType + r) || 'Other' : 'Other', start: cStart ? amt(A, cStart + r) : 0, asOf: cAsOf ? asDate(val(A, cAsOf + r)) : '', notes: cNotes ? str(A, cNotes + r) : '' });
      }
      const th = header(A, 'B', 'From', r, r + 20);
      if (th) {
        for (let k = th.row + 1, end = maxRow(A); k <= end; k++) {
          const from = str(A, 'B' + k), to = str(A, 'C' + k);
          if (!from || !to) continue;
          out.transfers.push({ date: asDate(val(A, 'A' + k)), from, to, amount: amt(A, 'D' + k), notes: str(A, 'E' + k) });
        }
      }
    }
    counts.accounts = out.accounts.length;
    counts.transfers = out.transfers.length;
    return { data: normalize(out), counts };
  }

  async function importXlsxFile(file) {
    try {
      if (typeof JSZip === 'undefined') throw new Error('The Excel reader did not load (vendor/jszip.min.js missing?).');
      const sheets = await readXlsx(await file.arrayBuffer());
      if (!sheets['Ledger'] && !sheets['Budget'] && !sheets['Accounts']) throw new Error('This file does not look like the Budget & Debt Tracker (no Ledger, Budget or Accounts tab).');
      const { data, counts } = fromWorkbook(sheets);
      const apply = () => {
        S = data; save(); saveUI(); UI.tab = 'summary'; render();
        toast(`Imported ${counts.accounts} accounts, ${counts.debts} debts, ${counts.payments} payments, ${counts.transactions} transactions`);
      };
      if (hasData()) {
        confirmBox('Replace current data?', `Importing <b>${esc(file.name)}</b> will replace everything saved here (${counts.accounts} accounts, ${counts.debts} debts, ${counts.payments} payments found in the file). Download a backup first if you're not sure.`, 'Replace', apply);
      } else apply();
    } catch (e) {
      console.error(e);
      toast('Could not import: ' + e.message, 6000);
    }
  }

  // ---------- backup / restore / export ----------
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function backupJson() { download(`budget-backup-${todayStr()}.json`, JSON.stringify(S, null, 2), 'application/json'); toast('Backup downloaded'); }
  async function restoreJsonFile(file) {
    try {
      const d = JSON.parse(await file.text());
      if (!d || !Array.isArray(d.debts) || !Array.isArray(d.accounts)) throw new Error('Not a tracker backup file.');
      const apply = () => { S = normalize(d); save(); UI.tab = 'summary'; render(); toast('Backup restored'); };
      if (hasData()) confirmBox('Restore backup?', 'This replaces everything saved here with the backup.', 'Restore', apply); else apply();
    } catch (e) { toast('Could not restore: ' + e.message, 6000); }
  }
  function exportCsv() {
    const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['Kind', 'Date', 'Description', 'Category / Debt', 'Type', 'Amount', 'Account', 'Notes']];
    for (const t of S.transactions) rows.push(['Transaction', t.date, t.description, t.category, catType(t.category), t.amount, t.account, t.notes]);
    for (const p of S.payments) { const d = debtById(p.debtId); rows.push(['Debt payment', p.date, d ? d.description : '', d ? `#${d.id} ${d.person}` : p.debtId, d ? d.type : '', p.amount, p.account, p.notes]); }
    for (const t of S.transfers) rows.push(['Transfer', t.date, `${t.from} → ${t.to}`, '', '', t.amount, '', t.notes]);
    rows.sort((a, b) => (a === rows[0] ? -1 : b === rows[0] ? 1 : String(a[1]).localeCompare(String(b[1]))));
    download(`budget-transactions-${todayStr()}.csv`, '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv');
    toast('CSV downloaded');
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- theme ----------
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  function setTheme(th) {
    document.documentElement.setAttribute('data-theme', th);
    try { localStorage.setItem(KEY + ':theme', th); } catch (e) { /* ignore */ }
    syncThemeButton();
  }
  function syncThemeButton() {
    const b = $('#themeBtn');
    if (b) b.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark() ? '#0A0F16' : '#FFFFFF');
  }

  // ---------- phone menu ----------
  function openMenu() {
    $('#drawer').hidden = false;
    document.querySelector('.burger').setAttribute('aria-expanded', 'true');
    const on = $('#drawerNav .on'); if (on) on.focus();
  }
  function closeMenu() {
    if ($('#drawer').hidden) return;
    $('#drawer').hidden = true;
    document.querySelector('.burger').setAttribute('aria-expanded', 'false');
  }

  // ---------- events ----------
  const ACTIONS = {
    importXlsx: () => $('#fileXlsx').click(),
    restoreJson: () => $('#fileJson').click(),
    backupJson, exportCsv,
    eraseAll: () => confirmBox('Erase all data?', 'This deletes everything saved in this browser. It cannot be undone. Download a backup first if you might need it.', 'Erase everything', () => { S = blank(); save(); toast('All data erased'); }),
    goSettings: () => { UI.tab = 'settings'; saveUI(); render(); },
    goBudget: () => { UI.tab = 'budget'; UI.month = todayStr().slice(0, 7); saveUI(); render(); },
    prevMonth: () => { UI.month = shiftMonth(UI.month, -1); saveUI(); render(); },
    nextMonth: () => { UI.month = shiftMonth(UI.month, 1); saveUI(); render(); },
    togglePaid: () => { UI.showPaid = !UI.showPaid; saveUI(); render(); },
    addTx: () => editTx(), addDebt: () => editDebt(), addPayment: () => editPayment(), addAccount: () => editAccount(),
    addTransfer: () => editTransfer(), addCategory: () => editCategory(),
    toggleTheme: () => setTheme(isDark() ? 'light' : 'dark'),
    setTheme: (el) => setTheme(el.dataset.v),
    openMenu, closeMenu,
  };

  document.addEventListener('click', (e) => {
    if (e.target.closest('dialog')) return;
    const el = e.target.closest('[data-tab],[data-act],[data-edit]');
    if (!el || el.disabled) return;
    if (el.dataset.tab) { closeMenu(); UI.tab = el.dataset.tab; saveUI(); render(); window.scrollTo(0, 0); return; }
    if (el.dataset.edit) closeMenu();
    if (el.dataset.edit) { EDIT[el.dataset.edit](el.dataset.uid); return; }
    const fn = ACTIONS[el.dataset.act];
    if (fn) fn(el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-edit],.tx-item[data-edit]')) EDIT[e.target.dataset.edit](e.target.dataset.uid);
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'monthPick' && e.target.value) { UI.month = e.target.value; saveUI(); render(); }
  });
  $('#fileXlsx').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importXlsxFile(f); });
  $('#fileJson').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreJsonFile(f); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  // swipe dots under the accounts row
  document.addEventListener('scroll', (e) => {
    if (!e.target || e.target.id !== 'acctStrip') return;
    const el = e.target, dots = document.querySelectorAll('#stripDots span');
    if (!dots.length) return;
    const max = el.scrollWidth - el.clientWidth;
    const i = max > 0 ? Math.round((el.scrollLeft / max) * (dots.length - 1)) : 0;
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
  }, true);

  load();
  render();

  // exposed for testing in the browser console
  window.tracker = { get state() { return S; }, totals, monthTotals, accountCalc, debtCalc };
})();
