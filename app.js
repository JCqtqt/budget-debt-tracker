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
    ['Salary', 'Income'], ['Side Income', 'Income'], ['Interest', 'Income'], ['Other Income', 'Income'],
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
      bills: [],
      log: [],
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
    snap = takeSnap();
    try { Object.assign(UI, JSON.parse(localStorage.getItem(KEY + ':ui') || '{}')); } catch (e) { /* ignore */ }
  }
  function save(opts) {
    if (opts && opts.fromCloud) snap = takeSnap(); else logChanges(opts && opts.label);
    try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; } catch (e) { storageOK = false; }
    if (!(opts && opts.fromCloud) && window.cloud && window.cloud.push) window.cloud.push(S);
  }
  // ---------- action log: every change is compared with the last saved state ----------
  const LOG_KEYS = ['accounts', 'transactions', 'debts', 'payments', 'transfers', 'bills', 'categories'];
  const LOG_MAX = 150, BULK = 25;
  let snap = null;
  function takeSnap() {
    const o = {};
    for (const k of LOG_KEYS) o[k] = new Map((S[k] || []).map((x) => [x.uid, JSON.stringify(x)]));
    return o;
  }
  function deviceName() {
    const u = navigator.userAgent || '';
    if (/iPhone/.test(u)) return 'iPhone';
    if (/iPad/.test(u)) return 'iPad';
    if (/Android/.test(u)) return /Mobile/.test(u) ? 'Android phone' : 'Android tablet';
    if (/Windows/.test(u)) return 'Windows PC';
    if (/Mac/.test(u)) return 'Mac';
    return 'Computer';
  }
  function logChanges(label) {
    const now = takeSnap();
    if (!snap) { snap = now; return; }
    const items = [];
    for (const k of LOG_KEYS) {
      const was = snap[k], is = now[k];
      for (const [uid, j] of is) {
        const old = was.get(uid);
        if (old === undefined) items.push({ a: 'add', k, uid, after: JSON.parse(j) });
        else if (old !== j) items.push({ a: 'edit', k, uid, before: JSON.parse(old), after: JSON.parse(j) });
      }
      for (const [uid, j] of was) if (!is.has(uid)) items.push({ a: 'del', k, uid, before: JSON.parse(j) });
    }
    snap = now;
    if (!items.length) return;
    const g = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), dev: deviceName() };
    if (label) g.label = label;
    if (items.length > BULK) { g.bulk = items.length; g.items = []; } else g.items = items;
    if (!Array.isArray(S.log)) S.log = [];
    S.log.unshift(g);
    if (S.log.length > LOG_MAX) S.log.length = LOG_MAX;
  }

  function saveUI() { try { localStorage.setItem(KEY + ':ui', JSON.stringify(UI)); } catch (e) { /* ignore */ } }

  function normalize(d) {
    const out = Object.assign(blank(), d || {});
    for (const k of ['categories', 'accounts', 'transactions', 'debts', 'payments', 'transfers', 'bills', 'log']) if (!Array.isArray(out[k])) out[k] = [];
    out.settings = Object.assign({ debtCategory: 'Debt Payments' }, out.settings || {});
    let max = 0;
    for (const k of ['accounts', 'transactions', 'debts', 'payments', 'transfers', 'categories', 'bills']) {
      for (const x of out[k]) { if (x.uid) max = Math.max(max, x.uid); }
    }
    out.nextId = Math.max(out.nextId || 1, max + 1);
    for (const k of ['accounts', 'transactions', 'debts', 'payments', 'transfers', 'categories', 'bills']) {
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
    if (out.accounts.some((a) => num(a.rate) > 0) && !out.categories.some((c) => c.name === INTEREST_CAT)) {
      out.categories.push({ uid: out.nextId++, name: INTEREST_CAT, type: 'Income', budget: 0 });
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

  // until = optional last date to count (used to know the balance at the end of a past month)
  function accountCalc(a, until) {
    const since = (x) => (!a.asOf || (x.date || '') >= a.asOf) && (!until || (x.date || '') <= until);
    const mine = (x) => x.account === a.name && since(x);
    const inc = sum(S.transactions.filter((t) => mine(t) && catType(t.category) === 'Income'))
      + sum(S.payments.filter((p) => mine(p) && payType(p) === OWED));
    const out = sum(S.transactions.filter((t) => mine(t) && catType(t.category) === 'Expense'))
      + sum(S.payments.filter((p) => mine(p) && payType(p) === OWE));
    const tr = sum(S.transfers.filter((t) => t.to === a.name && since(t))) - sum(S.transfers.filter((t) => t.from === a.name && since(t)));
    // money that moved when a debt was created: lending takes it out, borrowing cash puts it in
    const lent = sum(S.debts.filter((d) => mine(d) && d.type === OWED));
    const borrowed = sum(S.debts.filter((d) => mine(d) && d.type !== OWED));
    return { inc: inc + borrowed, out: out + lent, tr, current: num(a.start) + inc + borrowed - out - lent + tr };
  }

  // ----- interest on savings / digital bank accounts -----
  const INTEREST_CAT = 'Interest';
  const TAX_OPTS = [{ value: '20', label: '20% tax withheld (most PH banks)' }, { value: '0', label: 'No tax / already net' }];
  const taxOf = (a) => (a.tax === '' || a.tax == null ? 20 : num(a.tax));
  const rateText = (a) => `${+num(a.rate).toFixed(3)}% p.a.`;
  // estimated interest for one month, after tax
  const interestEst = (a, bal, days, dim) => {
    if (!(num(a.rate) > 0) || !(bal > 0)) return 0;
    const share = days && dim ? days / dim : 1;
    return Math.round(bal * (num(a.rate) / 100) / 12 * (1 - taxOf(a) / 100) * share * 100) / 100;
  };
  const interestEarned = (a, year) => sum(S.transactions.filter((t) => t.account === a.name && t.category === INTEREST_CAT && (t.date || '').slice(0, 4) === year));
  const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m, 0)); };

  // "Add interest automatically": at the end of every month, post the estimate as income
  function autoInterest() {
    const nowYm = todayStr().slice(0, 7);
    let added = 0;
    for (const a of S.accounts) {
      if (!a.autoInterest || !(num(a.rate) > 0) || !a.interestStart) continue;
      const startYm = [a.interestStart.slice(0, 7), (a.asOf || '').slice(0, 7)].sort().pop();
      for (let ym = startYm, guard = 0; ym < nowYm && guard < 36; ym = shiftMonth(ym, 1), guard++) {
        if (S.transactions.some((t) => t.account === a.name && t.interestFor === ym)) continue;
        const end = lastDay(ym);
        const dim = +end.slice(8);
        const from = [a.interestStart, a.asOf || ''].sort().pop();
        const days = from.slice(0, 7) === ym ? dim - +from.slice(8) + 1 : dim;
        const amt = interestEst(a, accountCalc(a, end).current, days, dim);
        if (amt < 0.01) continue;
        if (!S.categories.some((c) => c.name === INTEREST_CAT)) S.categories.push({ uid: newUid(), name: INTEREST_CAT, type: 'Income', budget: 0 });
        S.transactions.push({ uid: newUid(), date: end, amount: amt, category: INTEREST_CAT, description: `Interest · ${monthLabel(ym)}`, account: a.name, notes: 'Estimated automatically. Edit to match your bank.', interestFor: ym });
        added++;
      }
    }
    return added;
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
    for (const d of S.debts) {
      if (!d.account) continue;
      const owed = d.type === OWED;
      items.push({ date: d.date, uid: d.uid, kind: 'debt', dir: owed ? 'out' : 'in', title: `${owed ? 'Lent to' : 'Borrowed from'} ${d.person}`,
        sub: [d.description, d.account, fmtDate(d.date)].filter(Boolean).join(' · '), amt: (owed ? '−' : '+') + money(d.amount) });
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

  const EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  const secret = (text) => (UI.hideMoney ? '<span class="masked" aria-label="Hidden">₱ ••••••</span>' : text);
  // ---------- donut charts on the Summary page ----------
  // colors: CSS variables --c1..--c5 (validated for colorblind separation, light + dark), --c6 = "Other"
  let chartSel = { e: null, a: null };
  function chartData(key) {
    const ym = todayStr().slice(0, 7);
    let rows, title, sub, chip, center, empty;
    if (key === 'e') {
      rows = S.categories.map((c, i) => ({ n: c.name, v: c.type === 'Expense' ? catActual(c, ym) : 0, i })).filter((r) => r.v > 0.004);
      title = 'Spending this month'; sub = 'Expenses by category'; chip = monthLabel(ym).replace(/(\w{3})\w*/, '$1'); center = 'Total spent';
      empty = 'No expenses yet this month.';
    } else {
      rows = S.accounts.map((a, i) => ({ n: a.name, v: accountCalc(a).current, i })).filter((r) => r.v > 0.004);
      const neg = S.accounts.length - rows.length;
      title = 'Where my money is'; sub = 'Balance by account' + (neg ? ` · ${neg} empty or below zero not shown` : '');
      chip = `${S.accounts.length} account${S.accounts.length === 1 ? '' : 's'}`; center = 'Total money';
      empty = 'No money in your accounts yet.';
    }
    const sorted = [...rows].sort((a, b) => b.v - a.v);
    const top = sorted.slice(0, 5), rest = sorted.slice(5);
    // the color follows the item (its place in your list), not its size this month
    [...top].sort((a, b) => a.i - b.i).forEach((r, k) => { r.c = k + 1; });
    const items = top.map((r) => ({ n: r.n, v: r.v, c: r.c }));
    if (rest.length === 1) items.push({ n: rest[0].n, v: rest[0].v, c: 6 });
    else if (rest.length) items.push({ n: `Other (${rest.length})`, v: rest.reduce((a, r) => a + r.v, 0), c: 6, other: rest.map((r) => r.n).join(', ') });
    return { title, sub, chip, center, empty, items, total: items.reduce((a, x) => a + x.v, 0) };
  }
  function chartCard(key) {
    const d = chartData(key);
    const sel = chartSel[key] != null && chartSel[key] < d.items.length ? chartSel[key] : null;
    const R = 76, C = 2 * Math.PI * R, gap = d.items.length > 1 ? 2.5 : 0;
    let acc = 0;
    const segs = d.items.map((x, i) => {
      const len = (x.v / d.total) * C;
      const el = `<circle class="dn-seg${sel === i ? ' on' : ''}${sel != null && sel !== i ? ' dim' : ''}" cx="98" cy="98" r="${R}" style="stroke:var(--c${x.c})" stroke-dasharray="${Math.max(len - gap, 0.6).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 98 98)" data-act="chartPick" data-k="${key}" data-i="${i}"><title>${esc(x.n)}: ${UI.hideMoney ? 'hidden' : money(x.v)} (${Math.round((x.v / d.total) * 100)}%)</title></circle>`;
      acc += len;
      return el;
    }).join('');
    const s = sel != null ? d.items[sel] : null;
    const pct = (v) => (d.total ? Math.round((v / d.total) * 100) : 0) + '%';
    const legend = d.items.map((x, i) => `<button type="button" class="lg-row${sel === i ? ' on' : ''}${sel != null && sel !== i ? ' dim' : ''}" data-act="chartPick" data-k="${key}" data-i="${i}" aria-pressed="${sel === i}"${x.other ? ` title="${esc(x.other)}"` : ''}>
        <span class="lg-dot" style="background:var(--c${x.c})"></span><span class="lg-name">${esc(x.n)}</span><span class="lg-amt">${secret(money(x.v))}</span><span class="lg-pct">${pct(x.v)}</span></button>`).join('');
    return `<section class="card chart-card" data-chart="${key}" aria-label="${esc(d.title)}">
      <div class="ch-head"><div><h2>${esc(d.title)}</h2><div class="small muted">${esc(d.sub)}</div></div><span class="ch-chip">${esc(d.chip)}</span></div>
      ${d.items.length ? `<div class="donut"><svg viewBox="0 0 196 196" width="196" height="196" role="img" aria-label="${esc(d.title + ': ' + d.items.map((x) => x.n + ' ' + pct(x.v)).join(', '))}">
          <circle cx="98" cy="98" r="${R}" class="dn-track"/>${segs}</svg>
        <div class="dn-center"><span class="dn-l">${esc(s ? s.n : d.center)}</span><b>${secret(money(s ? s.v : d.total))}</b><span class="dn-s">${s ? pct(s.v) + ' of total' : 'Tap a slice'}</span></div></div>
      <div class="legend" role="list">${legend}</div>` : `<p class="empty">${esc(d.empty)}</p>`}
    </section>`;
  }
  function chartPick(el) {
    const k = el.dataset.k, i = +el.dataset.i;
    chartSel[k] = chartSel[k] === i ? null : i;
    const card = document.querySelector(`[data-chart="${k}"]`);
    if (card) card.outerHTML = chartCard(k);
  }

  // an amount that counts up when the page opens
  const countUp = (n) => (UI.hideMoney ? secret('') : `<span data-count="${(+n || 0).toFixed(2)}">${money(n).replace(/^-/, '−')}</span>`);

  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const u = window.cloud && window.cloud.user;
    const first = u && u.displayName ? u.displayName.trim().split(/\s+/)[0] : '';
    const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
    // the soonest upcoming payment you owe
    let next = null;
    {
      const ymNow = todayStr().slice(0, 7);
      const pool = upcoming(ymNow).concat(upcoming(shiftMonth(ymNow, 1))).filter((x) => !x.paid);
      const x = pool.find((p) => p.left < 0) || pool.find((p) => p.left >= 0);
      if (x) next = { date: x.due, label: x.name, amt: x.amount, varies: x.varies, overdue: x.left < 0 };
    }
    for (const d of (next ? [] : S.debts)) {
      if (d.type === OWED) continue;
      const c = debtCalc(d);
      if (c.balance > 0 && c.next && (!next || c.next < next.date)) {
        const what = (d.description || '').replace(/\s*\(.*\)\s*$/, '').replace(/\s+installment$/i, '');
        next = { date: c.next, label: what || d.person, amt: c.inst ? Math.min(c.monthly, c.balance) : c.balance, overdue: c.status === 'Overdue' };
      }
    }
    const nextTxt = next ? `${next.overdue ? '<b class="bad">Overdue</b>' : 'Next payment'}: ${esc(next.label)} · ${next.varies ? 'amount varies' : UI.hideMoney ? '₱ •••' : money(next.amt)} on ${esc(fmtDate(next.date).replace(/, \d{4}$/, ''))}` : '';
    return `<section class="greet">
      <div class="greet-text">
        <h1>${part}${first ? ', ' + esc(first) : ''}<i>.</i></h1>
        <p>${esc(today)}${nextTxt ? ' · ' + nextTxt : ''}</p>
      </div>
      <span class="add-pair"><button type="button" class="btn add-btn scan-btn" data-act="scanUpload">${SCAN_ICO} Scan receipt</button><button type="button" class="btn primary add-btn" data-act="addTx">+ Income / Expense</button></span>
    </section>`;
  }

  function viewSummary() {
    if (!hasData()) {
      return `<section class="card">
        <h2>Welcome</h2>
        <p>Start by loading your Excel tracker (<b>Budget_Debt_Tracker.xlsx</b>). Your accounts, debts, payments and budget will be copied in.</p>
        <p class="muted small">Your data is saved only in this browser on this device. It is never uploaded, and it is not in the GitHub repo.</p>
        ${window.cloud && window.cloud.enabled && !window.cloud.user ? `<div class="cloud-hero"><p style="margin:0"><b>Have a cloud account?</b> Sign in to load your data.</p><button class="btn gbtn" data-act="cloudSignIn">${GOOGLE_G} Sign in with Google</button></div>` : ''}
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
      ${greeting()}
      <section class="card hero">
        <div class="main">
          <div class="label eye-row">Net worth
            <button type="button" class="eye-btn" data-act="toggleHide" aria-pressed="${UI.hideMoney ? 'true' : 'false'}" aria-label="${UI.hideMoney ? 'Show amounts' : 'Hide amounts'}">${UI.hideMoney ? EYE_OFF : EYE}</button>
          </div>
          <div class="big">${countUp(t.net)}</div>
          <div class="cap">Money + owed to me − what I owe · ${esc(fmtDate(todayStr()))}</div>
        </div>
        <div class="side"><div class="label small">Total money</div><div class="v">${countUp(t.cash)}</div></div>
        <div class="side"><div class="label small">I still owe</div><div class="v bad">${countUp(t.iOwe)}</div>${t.owedMe ? `<div class="small muted">Others owe me ${secret(money(t.owedMe))}</div>` : ''}</div>
      </section>

      <section>
        <div class="sec-head"><h2>Accounts <span class="muted">· ${S.accounts.length}</span></h2><button class="link" data-act="addAccount">+ Add</button></div>
        <div class="acct-strip" id="acctStrip" aria-label="Accounts">
          ${accts.map(({ a, bal }, i) => `<button type="button" class="acct${Math.abs(bal) < 0.005 ? ' zero' : ''}" style="--i:${i}" data-edit="account" data-uid="${a.uid}">
            <span class="head"><span class="name">${esc(a.name)}</span><span class="dot"></span></span>
            <span><span class="bal${bal < 0 ? ' bad' : ''}">${money(bal)}</span><br><span class="type">${esc(a.type || '')}${num(a.rate) > 0 ? ` · <span class="rate">${rateText(a)}</span>` : ''}</span></span>
          </button>`).join('')}
          <div class="acct total"><span class="head"><span class="name">Total money</span></span><span><span class="bal">${secret(money(t.cash))}</span><br><span class="type">${S.accounts.length} accounts</span></span></div>
        </div>
        <div class="strip-dots" id="stripDots" aria-hidden="true">${Array.from({ length: dots }, (_, i) => `<span${i === 0 ? ' class="on"' : ''}></span>`).join('')}</div>
      </section>

      <div class="charts">${chartCard('e')}${chartCard('a')}</div>

      <section>
        <div class="sec-head"><h2>Recent transactions</h2><button class="link" data-act="goBudget">See all</button></div>
        <div class="card pad0"><div class="tx-list">
          ${recent.length ? recent.map((r, i) => `<div class="tx-item" style="--i:${i}" data-edit="${r.kind}" data-uid="${r.uid}" tabindex="0" role="button">
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

  // ----- bills & upcoming payments -----
  const REMIND_DAYS = 3;
  const MON = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('en-PH', { month: 'short' });
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  function billDue(b, ym) {
    if (!b.date) return '';
    if (b.repeat === 'Once') return b.date.slice(0, 7) === ym ? b.date : '';
    if (ym < b.date.slice(0, 7)) return '';
    const [y, m] = ym.split('-').map(Number);
    if (b.repeat === 'Yearly' && +b.date.slice(5, 7) !== m) return '';
    const last = new Date(y, m, 0).getDate();
    return `${ym}-${pad(Math.min(+b.date.slice(8, 10), last))}`;
  }
  const billPaidTx = (b, ym) => { const id = b.paid && b.paid[ym]; return id ? find(S.transactions, id) : null; };
  // every bill and installment due in a month, with its status
  function upcoming(ym) {
    const today = todayStr(), out = [];
    for (const b of S.bills) {
      const due = billDue(b, ym);
      if (!due) continue;
      const tx = billPaidTx(b, ym);
      out.push({ kind: 'bill', id: b.uid, b, due, name: b.name, amount: tx ? num(tx.amount) : num(b.amount), varies: !!b.varies && !tx,
        sub: tx ? `Paid ${fmtDate(tx.date).replace(/, \d{4}$/, '')} · ${tx.account || ''}` : `Bill${b.account ? ' · from ' + b.account : ''}${b.varies ? ' · amount varies' : ''}`,
        paid: !!tx, remind: b.remind !== false });
    }
    for (const d of S.debts) {
      if (d.type === OWED) continue;
      const c = debtCalc(d);
      const what = (d.description || '').replace(/\s*\(.*\)\s*$/, '').replace(/\s+installment$/i, '') || d.person;
      if (c.inst) {
        for (let k = 0; k < c.months; k++) {
          const due = installmentDue(d, k);
          if (due.slice(0, 7) > ym) break;
          if (due.slice(0, 7) !== ym) continue;
          out.push({ kind: 'debt', id: d.uid, d, due, name: what, amount: c.monthly, sub: `Installment ${k + 1} of ${c.months} · ${d.person}`, paid: k < c.monthsPaid, remind: true });
        }
      } else if (d.due && d.due.slice(0, 7) === ym && c.balance > 0) {
        out.push({ kind: 'debt', id: d.uid, d, due: d.due, name: what, amount: c.balance, sub: `Debt · ${d.person}`, paid: false, remind: true });
      }
    }
    for (const it of out) {
      const left = daysBetween(today, it.due);
      it.left = left;
      it.state = it.paid ? 'paid' : left < 0 ? 'late' : left <= REMIND_DAYS && it.remind ? 'soon' : 'later';
      it.when = it.paid ? 'Paid' : left < 0 ? `${-left} day${left === -1 ? '' : 's'} late` : left === 0 ? 'Today' : left === 1 ? 'Tomorrow' : `In ${left} days`;
    }
    return out.sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
  }
  function billsCard(ym) {
    const list = upcoming(ym);
    const total = list.reduce((a, x) => a + (x.varies ? 0 : x.amount), 0);
    const paidN = list.filter((x) => x.paid).length;
    const paidAmt = list.filter((x) => x.paid).reduce((a, x) => a + x.amount, 0);
    return `<section class="card bills">
      <div class="sec-head" style="margin-bottom:6px"><h2>Upcoming bills</h2><button class="link" data-act="addBill">+ Add bill</button></div>
      ${list.length ? `<div class="bills-sum"><span>Due this month <b>${money(total)}</b></span><span>Paid <b>${paidN} of ${list.length}</b></span></div>
      ${bar(pct(paidAmt, total))}
      <div class="bill-list">${list.map((x, i) => `<div class="bill ${x.state}" style="--i:${i}" data-act="billTap" data-kind="${x.kind}" data-uid="${x.id}" data-due="${x.due}" tabindex="0" role="button">
          <span class="bill-date"><b>${+x.due.slice(8)}</b><span>${esc(MON(x.due.slice(0, 7)))}</span></span>
          <span class="bill-main"><b>${esc(x.name)}</b><span>${esc(x.sub)}</span></span>
          <span class="bill-right"><b>${x.varies ? 'Varies' : money(x.amount)}</b><span class="chip ${x.state}">${esc(x.when)}</span></span>
        </div>`).join('')}</div>`
      : `<p class="muted small" style="margin:6px 0 4px">Add rent, electricity, internet and other regular bills. Your installments show up here on their own.</p>`}
    </section>`;
  }
  function editBill(uid) {
    const b = uid ? find(S.bills, uid) : null;
    const expenseCats = () => S.categories.filter((c) => c.type === 'Expense' && c.name !== S.settings.debtCategory).map((c) => c.name);
    openForm({
      title: b ? `Edit ${b.name}` : 'Add bill',
      fields: [
        { key: 'name', label: 'Bill name', required: true, full: true, hint: 'e.g. Rent, Electricity, Internet' },
        { key: 'amount', label: 'Amount (₱)', type: 'money', hint: 'Leave empty if it changes every month.' },
        { key: 'date', label: 'Next due date', type: 'date', required: true, default: todayStr() },
        { key: 'varies', label: 'Amount varies', type: 'check', full: true },
        { key: 'repeat', label: 'Repeats', type: 'select', options: ['Monthly', 'Yearly', 'Once'], default: 'Monthly', required: true },
        { key: 'category', label: 'Budget category', type: 'select', required: true, placeholder: 'Choose…', options: expenseCats },
        { key: 'account', label: 'Pay from', type: 'select', placeholder: 'Choose…', options: accountOpts, full: true },
        { key: 'remind', label: `Remind me ${REMIND_DAYS} days before`, type: 'check', default: true, full: true },
      ],
      values: b || {},
      onChange: (f, e) => {
        if (e && e.target && e.target.name === 'name' && !f.elements.category.value) {
          const n = f.elements.name.value.toLowerCase();
          const hit = expenseCats().find((c) => c.toLowerCase().split(/[^a-z]+/).some((w) => w.length > 3 && n.includes(w)));
          if (hit) f.elements.category.value = hit;
        }
      },
      onSave: (v) => {
        if (!v.varies && !(v.amount > 0)) return 'Enter the amount, or tick "Amount varies".';
        if (b) Object.assign(b, v); else S.bills.push({ uid: newUid(), paid: {}, ...v });
        toast(b ? 'Bill saved' : 'Bill added');
      },
      onDelete: b ? () => { removeFrom('bills', uid); toast('Bill deleted'); } : null,
    });
  }
  function payBill(b, ym) {
    const due = billDue(b, ym);
    openForm({
      title: `Pay ${b.name}`,
      note: `Logs an expense in <b>${esc(b.category || 'your budget')}</b> and takes it from the account.`,
      fields: [
        { key: 'amount', label: 'Amount (₱)', type: 'money', required: true, default: num(b.amount) ? num(b.amount).toFixed(2) : '' },
        { key: 'date', label: 'Date paid', type: 'date', required: true, default: todayStr() },
        { key: 'account', label: 'Paid from', type: 'select', required: true, placeholder: 'Choose…', options: accountOpts, default: b.account || '', full: true },
      ],
      saveLabel: 'Mark paid',
      onSave: (v) => {
        if (!(v.amount > 0)) return 'Amount must be more than 0.';
        const t = { uid: newUid(), date: v.date, description: b.name, category: b.category, amount: v.amount, account: v.account, notes: `Bill due ${fmtDate(due)}` };
        S.transactions.push(t);
        b.paid = b.paid || {}; b.paid[ym] = t.uid;
        toast(`${b.name} marked paid`);
      },
    });
  }
  function billTap(el) {
    const ym = el.dataset.due.slice(0, 7);
    if (el.dataset.kind === 'debt') {
      const d = find(S.debts, el.dataset.uid);
      if (!d) return;
      const c = debtCalc(d);
      if (c.balance <= 0) return toast('This debt is fully paid.');
      return editPayment(null, { debtId: d.id, amount: (c.inst ? Math.min(c.monthly, c.balance) : c.balance).toFixed(2), account: '' });
    }
    const b = find(S.bills, el.dataset.uid);
    if (!b) return;
    const tx = billPaidTx(b, ym);
    if (tx) {
      choose(`${b.name} is paid`, `Paid ${money(tx.amount)} on ${esc(fmtDate(tx.date))} from ${esc(tx.account || '')}.`, [
        { label: 'Undo paid', primary: true, fn: () => { removeFrom('transactions', tx.uid); delete b.paid[ym]; commit(); toast('Marked unpaid'); } },
        { label: 'Edit bill', fn: () => editBill(b.uid) },
        { label: 'Cancel', fn: () => {} },
      ]);
    } else {
      choose(b.name, `Due ${esc(fmtDate(billDue(b, ym)))}${num(b.amount) ? ' · ' + money(b.amount) : ''}`, [
        { label: 'Mark paid', primary: true, fn: () => payBill(b, ym) },
        { label: 'Edit bill', fn: () => editBill(b.uid) },
        { label: 'Cancel', fn: () => {} },
      ]);
    }
  }

  // ----- notifications -----
  function notifications() {
    const today = todayStr(), ym = today.slice(0, 7), prev = shiftMonth(ym, -1), next = shiftMonth(ym, 1);
    const items = [];
    for (const m of [prev, ym, next]) {
      for (const x of upcoming(m)) {
        if (x.paid) continue;
        if (x.left < 0 || (x.remind && x.left <= REMIND_DAYS) || (x.kind === 'debt' && x.left <= 7)) {
          items.push({ ...x, nid: `${x.kind}:${x.id}:${x.due}`,
            title: x.left < 0 ? `${x.name} is ${-x.left} day${x.left === -1 ? '' : 's'} late` : x.left === 0 ? `${x.name} is due today` : x.left === 1 ? `${x.name} is due tomorrow` : x.kind === 'debt' ? `${x.name} payment on ${fmtDate(x.due).replace(/, \d{4}$/, '')}` : `${x.name} is due in ${x.left} days`,
            text: `${x.varies ? 'Amount varies' : money(x.amount)} · ${fmtDate(x.due).replace(/, \d{4}$/, '')}${x.kind === 'debt' ? ' · ' + x.sub : x.b.account ? ' · from ' + x.b.account : ''}` });
        }
      }
    }
    return items.sort((a, b) => a.due.localeCompare(b.due));
  }
  let notesOpen = false;
  function renderBell() {
    const btn = $('#bellBtn'), panel = $('#notePanel');
    if (!btn) return;
    const items = notifications();
    const seen = new Set(UI.seenNotes || []);
    const fresh = items.filter((x) => !seen.has(x.nid)).length;
    btn.querySelector('.badge').textContent = fresh > 9 ? '9+' : fresh || '';
    btn.querySelector('.badge').hidden = !fresh;
    btn.setAttribute('aria-label', fresh ? `Notifications, ${fresh} new` : 'Notifications');
    btn.setAttribute('aria-expanded', notesOpen ? 'true' : 'false');
    panel.hidden = !notesOpen;
    if (!notesOpen) return;
    panel.innerHTML = `<div class="np-head"><h2>Notifications</h2>${fresh ? '<button type="button" class="link" data-act="readAll">Mark all read</button>' : ''}</div>
      <div class="np-list">${items.length ? items.map((x) => `<div class="np-item ${seen.has(x.nid) ? '' : 'new'} ${x.state}">
        <span class="np-ico k-${x.kind}">${x.kind === 'bill' ? ICON_CAL : ICON_RECEIPT}</span>
        <span class="np-body"><b>${esc(x.title)}</b><span>${esc(x.text)}</span>
          <span class="np-actions"><button type="button" class="btn sm primary" data-act="billTap" data-kind="${x.kind}" data-uid="${x.id}" data-due="${x.due}">${x.kind === 'bill' ? 'Mark paid' : 'Record payment'}</button></span>
        </span>
        ${seen.has(x.nid) ? '' : '<span class="np-dot"></span>'}
      </div>`).join('') : '<p class="empty">You\'re all caught up.</p>'}</div>`;
  }
  const ICON_CAL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>';
  const ICON_RECEIPT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>';

  // ----- phone bottom tab bar -----
  const TAB_ICONS = {
    summary: '<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    budget: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    accounts: '<path d="M3 7a2 2 0 0 1 2-2h14v4"/><path d="M3 7v11a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1.2"/>',
    debts: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    payments: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  };

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
          <label class="month-label"><span>${esc(new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('en-PH', +ym.slice(0, 4) === new Date().getFullYear() ? { month: 'short' } : { month: 'short', year: 'numeric' }))}</span><input type="month" id="monthPick" value="${esc(ym)}" aria-label="Choose month"></label>
          <button class="btn sm" data-act="nextMonth" aria-label="Next month">›</button>
        </div>
        <span class="add-pair"><button type="button" class="btn add-btn scan-btn" data-act="scanUpload">${SCAN_ICO} Scan receipt</button><button class="btn primary add-btn" data-act="addTx">+ Income / Expense</button></span>
      </section>
      ${billsCard(ym)}
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

  function interestCard() {
    const list = S.accounts.filter((a) => num(a.rate) > 0);
    const year = todayStr().slice(0, 4);
    if (!list.length) {
      return S.accounts.length ? `<section class="card int-empty"><b>Earning interest?</b> <span class="muted small">Edit a digital bank or savings account and enter its rate (% per year). We'll estimate what it earns each month.</span></section>` : '';
    }
    let mo = 0, yr = 0, got = 0;
    const rows = list.map((a) => {
      const bal = accountCalc(a).current;
      const m = interestEst(a, bal);
      const e = interestEarned(a, year);
      mo += m; yr += m * 12; got += e;
      return `<div class="int-row">
        <span class="int-main"><b>${esc(a.name)}</b><span>${rateText(a)}${a.autoInterest ? ' · <i class="auto">Auto</i>' : ''}</span></span>
        <span class="int-num"><b class="good">+${secret(money(m))}</b><span>a month</span></span>
        <span class="int-num hide-sm"><b>${secret(money(e))}</b><span>earned ${year}</span></span>
        <button type="button" class="btn sm" data-act="recordInterest" data-uid="${a.uid}">Record</button>
      </div>`;
    }).join('');
    return `<section>
      <div class="sec-head"><h2>Interest</h2></div>
      <div class="card int-card">
        <div class="int-stats">
          <div><div class="label small">Per month (est.)</div><div class="v good">+${secret(money(mo))}</div></div>
          <div><div class="label small">Per year (est.)</div><div class="v">+${secret(money(yr))}</div></div>
          <div><div class="label small">Earned in ${year}</div><div class="v">${secret(money(got))}</div></div>
        </div>
        <div class="int-list">${rows}</div>
        <p class="muted small" style="margin:0">Estimates use today's balance, after tax. Tap <b>Record</b> when your bank credits the interest, and type the exact amount from your app.</p>
      </div>
    </section>`;
  }

  function recordInterest(uid) {
    const a = find(S.accounts, uid);
    if (!a) return;
    const ym = todayStr().slice(0, 7);
    editTx(null, { date: todayStr(), amount: interestEst(a, accountCalc(a).current) || '', category: INTEREST_CAT, description: `Interest · ${monthLabel(ym)}`, account: a.name });
  }

  function viewAccounts() {
    const t = totals();
    const rows = S.accounts.map((a) => {
      const c = accountCalc(a);
      return `<tr ${rowAttrs('account', a.uid)}>
        <td>${esc(a.name)}<div class="desc">${esc(a.type || '')}${num(a.rate) > 0 ? ' · ' + rateText(a) : ''}${a.notes ? ' · ' + esc(a.notes) : ''}</div></td>
        <td class="num hide-sm">${money(a.start)}<div class="desc">as of ${esc(fmtDate(a.asOf) || '—')}</div></td>
        <td class="num hide-sm good">${c.inc ? '+' + money(c.inc) : ''}</td>
        <td class="num hide-sm">${c.out ? '−' + money(c.out) : ''}</td>
        <td class="num hide-sm">${c.tr ? (c.tr > 0 ? '+' : '−') + money(Math.abs(c.tr)) : ''}</td>
        <td class="num ${c.current < 0 ? 'bad' : ''}"><b>${money(c.current)}</b></td></tr>`;
    }).join('');
    const tr = [...S.transfers].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((x) => `<tr ${rowAttrs('transfer', x.uid)}>
        <td>${esc(fmtDate(x.date))}</td><td>${esc(x.from)} → ${esc(x.to)}${x.notes ? `<div class="desc">${esc(x.notes)}</div>` : ''}</td><td class="num">${money(x.amount)}</td></tr>`).join('');
    return `
      <section class="sec-head"><h2>My accounts</h2><span class="btn-row" style="margin:0"><button class="btn" data-act="statement">Statement</button><button class="btn" data-act="openLog">Action log</button><button class="btn primary" data-act="addAccount">+ Account</button></span></section>
      <section class="card pad0 table-wrap"><table>
        <thead><tr><th>Account</th><th class="num hide-sm">Starting</th><th class="num hide-sm">Money in</th><th class="num hide-sm">Money out</th><th class="num hide-sm">Transfers</th><th class="num">Balance</th></tr></thead>
        <tbody>${rows || emptyRow(6, 'Add your banks, e-wallets and cash.')}</tbody>
        <tfoot><tr><td>Total money</td><td class="hide-sm"></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="num">${money(t.cash)}</td></tr></tfoot>
      </table></section>
      <p class="muted small">Balance = starting balance on the "as of" date + income − expenses − debt payments + money paid back to you ± transfers, all from that date on.</p>
      ${interestCard()}
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

  const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  let acctOpen = false;
  function avatarHTML(u, size) {
    const initial = esc((u.displayName || u.email || '?').trim().charAt(0).toUpperCase());
    return u.photoURL
      ? `<img class="avatar-img" src="${esc(u.photoURL)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`
      : `<span class="avatar" style="width:${size}px;height:${size}px">${initial}</span>`;
  }
  function renderAuth() {
    const c = window.cloud, slot = $('#authSlot'), side = $('#drawerAuth');
    if (!c || !c.enabled) { slot.innerHTML = ''; side.innerHTML = ''; return; }
    if (!c.user) {
      acctOpen = false;
      slot.innerHTML = `<button type="button" class="btn gbtn" data-act="cloudSignIn">${GOOGLE_G} Sign in</button>`;
      side.innerHTML = `<p class="small muted" style="margin:0 0 10px">Sign in to save your data online and use it on all your devices.</p>
        <button type="button" class="btn gbtn wide" data-act="cloudSignIn">${GOOGLE_G} Sign in with Google</button>`;
      return;
    }
    const u = c.user;
    slot.innerHTML = `<div class="acct-menu">
        <button type="button" class="avatar-btn" data-act="toggleAcctMenu" aria-label="Account: ${esc(u.email || '')}" aria-expanded="${acctOpen}">${avatarHTML(u, 36)}<span class="sync-dot ${esc(c.status)} on-avatar"></span></button>
        <div class="pop" ${acctOpen ? '' : 'hidden'}>
          <div class="who">${avatarHTML(u, 40)}<div><b>${esc(u.displayName || 'Signed in')}</b><div class="small muted">${esc(u.email || '')}</div></div></div>
          <p class="small" style="margin:12px 0"><span class="sync-dot ${esc(c.status)}"></span>${esc(c.statusText())}</p>
          <button type="button" class="btn wide" data-act="cloudSignOut">Sign out</button>
        </div>
      </div>`;
    side.innerHTML = `<div class="who">${avatarHTML(u, 36)}<div style="min-width:0"><b>${esc(u.displayName || 'Signed in')}</b><div class="small muted ellip">${esc(u.email || '')}</div></div></div>
      <p class="small" style="margin:10px 0"><span class="sync-dot ${esc(c.status)}"></span>${esc(c.statusText())}</p>
      <button type="button" class="btn wide" data-act="cloudSignOut">Sign out</button>`;
  }

  function cloudCard() {
    const c = window.cloud;
    if (!c || !c.enabled) return '';
    if (!c.user) {
      return `<div class="sec-head"><h2>Cloud sync</h2></div>
        <div class="card cloud-card">
          <p style="margin-top:0">Sign in to save your data online and see it on your phone and computer. Only you can see it.</p>
          <button class="btn gbtn" data-act="cloudSignIn">${GOOGLE_G} Sign in with Google</button>
        </div>`;
    }
    const u = c.user;
    const initial = esc((u.displayName || u.email || '?').trim().charAt(0).toUpperCase());
    return `<div class="sec-head"><h2>Cloud sync</h2></div>
      <div class="card cloud-card">
        <div class="who">
          ${u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" width="40" height="40" referrerpolicy="no-referrer">` : `<span class="avatar">${initial}</span>`}
          <div><b>${esc(u.displayName || 'Signed in')}</b><div class="small muted">${esc(u.email || '')}</div></div>
        </div>
        <p class="small" style="margin:12px 0"><span class="sync-dot ${esc(c.status)}"></span>${esc(c.statusText())}</p>
        <button class="btn" data-act="cloudSignOut">Sign out</button>
        <p class="muted small" style="margin-bottom:0">Signing out removes your data from this browser. It stays safe in your cloud account.</p>
      </div>`;
  }

  // ---------- action log view ----------
  const KIND = { transactions: 'entry', accounts: 'account', debts: 'debt', payments: 'payment', transfers: 'transfer', bills: 'bill', categories: 'category' };
  const FIELD = { start: 'Balance', asOf: 'As of', amount: 'Amount', date: 'Date', account: 'Account', category: 'Category', description: 'Description', name: 'Name', rate: 'Interest', tax: 'Tax', autoInterest: 'Auto interest', notes: 'Notes', person: 'Person', type: 'Type', plan: 'Payment plan', monthly: 'Monthly', months: 'Months', dueDay: 'Due day', due: 'Due date', from: 'From', to: 'To', budget: 'Budget', debtId: 'Debt', method: 'Method', repeat: 'Repeat', remind: 'Reminder', varies: 'Amount varies' };
  const MONEYF = new Set(['start', 'amount', 'monthly', 'budget']);
  const DATEF = new Set(['asOf', 'date', 'due']);
  const SKIPF = new Set(['uid', 'id', 'paid', 'interestStart', 'interestFor', 'scanned']);
  // empty, zero, off and the default 20% tax all mean "nothing set"
  const blankV = (f, v) => v == null || v === '' || v === 0 || v === false || (f === 'tax' && String(v) === '20');
  const fval = (f, v) => {
    if (v === '' || v == null) return '—';
    if (MONEYF.has(f)) return money(v);
    if (DATEF.has(f)) return fmtDate(v);
    if (f === 'rate') return num(v) + '%';
    if (f === 'tax') return v + '%';
    if (typeof v === 'boolean') return v ? 'On' : 'Off';
    if (typeof v === 'object') return '…';
    const t = String(v); return t.length > 40 ? t.slice(0, 38) + '…' : t;
  };
  function itemName(k, x) {
    if (!x) return '';
    if (k === 'transactions') return `${catType(x.category) === 'Income' ? 'income' : 'expense'} ${money(x.amount)} · ${x.description || x.category || ''}${x.account ? ' · ' + x.account : ''}`;
    if (k === 'accounts') return `account ${x.name}`;
    if (k === 'debts') return `debt ${x.person}${x.description ? ' — ' + x.description : ''}`;
    if (k === 'payments') { const d = debtById(x.debtId); return `payment ${money(x.amount)}${d ? ' · ' + d.person : ''}${x.account ? ' · ' + x.account : ''}`; }
    if (k === 'transfers') return `transfer ${money(x.amount)} · ${x.from} → ${x.to}`;
    return `${KIND[k]} ${x.name || ''}`;
  }
  function itemLine(it) {
    const verb = { add: 'Added', edit: 'Edited', del: 'Deleted' }[it.a];
    let html = `<b>${verb}</b> ${esc(itemName(it.k, it.after || it.before))}`;
    if (it.a === 'edit') {
      const diffs = Object.keys(Object.assign({}, it.before, it.after))
        .filter((f) => !SKIPF.has(f) && !(blankV(f, it.before[f]) && blankV(f, it.after[f])) && JSON.stringify(it.before[f] ?? '') !== JSON.stringify(it.after[f] ?? ''))
        .map((f) => `<span class="chg">${esc(FIELD[f] || f)}: <s>${esc(fval(f, it.before[f]))}</s> → ${esc(fval(f, it.after[f]))}</span>`);
      if (diffs.length) html += `<span class="chgs">${diffs.slice(0, 4).join('')}</span>`;
    }
    return html;
  }
  const touches = (it, name) => [it.before, it.after].some((x) => x && (x.account === name || x.from === name || x.to === name || (it.k === 'accounts' && x.name === name)));
  function whenText(ms) {
    const d = new Date(ms), t = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    const day = ymd(d), today = todayStr(), yest = ymd(new Date(Date.now() - 864e5));
    return `${day === today ? 'Today' : day === yest ? 'Yesterday' : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}, ${t}`;
  }
  function logRow(g) {
    const items = g.items || [];
    const lines = g.bulk ? `<b>${esc(g.label || 'Big change')}</b> · ${g.bulk} items changed` : items.slice(0, 3).map((it) => `<div>${itemLine(it)}</div>`).join('') + (items.length > 3 ? `<div class="muted small">and ${items.length - 3} more change${items.length - 3 > 1 ? 's' : ''}</div>` : '');
    const tag = g.undoOf ? '<span class="pill">Undo</span>' : g.label && !g.bulk ? `<span class="pill">${esc(g.label)}</span>` : '';
    const btn = g.bulk ? '' : g.undone ? '<span class="muted small">Undone</span>' : `<button type="button" class="btn sm" data-act="undoLog" data-g="${g.id}">Undo</button>`;
    return `<div class="log-row${g.undone ? ' undone' : ''}">
      <div class="log-main"><div class="log-meta">${esc(whenText(g.at))} · ${esc(g.dev || '')} ${tag}</div><div class="log-lines">${lines}</div></div>
      <div class="log-act">${btn}</div></div>`;
  }
  function viewHistory() {
    const f = UI.logAcct && S.accounts.some((a) => a.name === UI.logAcct) ? UI.logAcct : '';
    const list = (S.log || []).filter((g) => !f || (g.items || []).some((it) => touches(it, f)));
    return `
      <section class="sec-head"><h2>Action log</h2>
        <select class="log-filter" aria-label="Show changes for">
          <option value="">All changes</option>${S.accounts.map((a) => `<option value="${esc(a.name)}"${a.name === f ? ' selected' : ''}>${esc(a.name)} only</option>`).join('')}
        </select></section>
      <p class="muted small" style="margin-top:0">Every add, edit and delete, newest first, from all your devices. <b>Undo</b> puts things back the way they were before that change. The last ${LOG_MAX} changes are kept.</p>
      <section class="card pad0 log-list">${list.length ? list.map(logRow).join('') : `<p class="empty">${f ? 'No changes for ' + esc(f) + ' yet.' : 'No changes yet. From now on, everything you add, edit or delete shows up here.'}</p>`}</section>
      <p><button class="link" data-tab="settings">← Back to Settings</button></p>`;
  }

  function undoLog(id) {
    const g = (S.log || []).find((x) => x.id === id);
    if (!g || g.undone || g.bulk) return;
    const items = g.items || [];
    const changedSince = items.some((it) => {
      const cur = (S[it.k] || []).find((x) => x.uid === it.uid);
      return it.a === 'del' ? !!cur : JSON.stringify(cur || null) !== JSON.stringify(it.after || null);
    });
    const go = () => {
      for (const it of [...items].reverse()) {
        const arr = S[it.k] || (S[it.k] = []);
        const ix = arr.findIndex((x) => x.uid === it.uid);
        if (it.a === 'add') { if (ix >= 0) arr.splice(ix, 1); }
        else if (it.a === 'del') { if (ix < 0) arr.push(JSON.parse(JSON.stringify(it.before))); }
        else if (ix >= 0) arr[ix] = JSON.parse(JSON.stringify(it.before));
        else arr.push(JSON.parse(JSON.stringify(it.before)));
      }
      g.undone = true;
      save({ label: 'Undo' });
      if (S.log[0] && S.log[0].label === 'Undo') S.log[0].undoOf = g.id;
      save({ fromCloud: false });
      render();
      toast('Undone. You can undo the undo too.');
    };
    if (changedSince) {
      choose('This was changed again later', 'Something in this change was edited or deleted after it. Undo will put it back exactly as it was before this change, and the later edits to it will be lost.', [
        { label: 'Undo anyway', primary: true, fn: go },
        { label: 'Cancel', fn: () => {} },
      ]);
    } else go();
  }

  // ---------- statement (printable, saved as PDF by the browser) ----------
  const prevDay = (d) => { const [y, m, dd] = d.split('-').map(Number); return ymd(new Date(y, m - 1, dd - 1)); };
  // every money movement of one account, signed (+ in, − out), same rules as accountCalc
  function acctEntries(a) {
    const since = (x) => !a.asOf || (x.date || '') >= a.asOf;
    const out = [];
    for (const t of S.transactions) if (t.account === a.name && since(t)) {
      const inc = catType(t.category) === 'Income';
      out.push({ date: t.date, what: t.description || t.category, cat: t.category, amt: inc ? num(t.amount) : -num(t.amount), acct: a.name, uid: 't' + t.uid });
    }
    for (const p of S.payments) if (p.account === a.name && since(p)) {
      const d = debtById(p.debtId), back = payType(p) === OWED;
      out.push({ date: p.date, what: (back ? 'Payment received' : 'Debt payment') + (d ? ' · ' + d.person + (d.description ? ' — ' + d.description : '') : ''), cat: back ? 'Paid back to me' : S.settings.debtCategory, amt: back ? num(p.amount) : -num(p.amount), acct: a.name, uid: 'p' + p.uid });
    }
    for (const d of S.debts) if (d.account === a.name && since(d)) {
      const lent = d.type === OWED;
      out.push({ date: d.date, what: (lent ? 'Lent to ' : 'Borrowed from ') + d.person + (d.description ? ' — ' + d.description : ''), cat: lent ? 'Loan given' : 'Loan received', amt: lent ? -num(d.amount) : num(d.amount), acct: a.name, uid: 'd' + d.uid });
    }
    for (const t of S.transfers) if (since(t) && (t.from === a.name || t.to === a.name)) {
      const inn = t.to === a.name;
      out.push({ date: t.date, what: inn ? 'Transfer from ' + t.from : 'Transfer to ' + t.to, cat: 'Transfer', amt: inn ? num(t.amount) : -num(t.amount), acct: a.name, uid: 'x' + t.uid, transfer: true, pair: t.uid });
    }
    return out;
  }

  function statementHTML({ acct, from, to, debts }) {
    const accts = acct ? S.accounts.filter((a) => a.name === acct) : S.accounts;
    const all = !acct;
    let opening = 0, rows = [];
    const notes = [];
    for (const a of accts) {
      opening += accountCalc(a, prevDay(from)).current;
      if (a.asOf && a.asOf > from) notes.push(`${a.name} is tracked from ${fmtDate(a.asOf)}; its starting balance is counted as of that date.`);
      rows.push(...acctEntries(a).filter((e) => e.date >= from && e.date <= to && !(all && e.transfer)));
    }
    rows.sort((x, y) => (x.date || '').localeCompare(y.date || '') || (y.amt - x.amt));
    let bal = opening, inn = 0, outt = 0;
    const cats = {};
    const body = rows.map((e) => {
      bal += e.amt;
      if (e.amt >= 0) inn += e.amt; else { outt -= e.amt; cats[e.cat] = (cats[e.cat] || 0) - e.amt; }
      return `<tr><td class="d">${esc(fmtDate(e.date))}</td><td>${esc(e.what || '')}<div class="c">${esc(e.cat || '')}${all ? ' · ' + esc(e.acct) : ''}</div></td>
        <td class="n in">${e.amt >= 0 ? money(e.amt) : ''}</td><td class="n">${e.amt < 0 ? money(-e.amt) : ''}</td><td class="n b">${money(bal)}</td></tr>`;
    }).join('');
    const closing = bal;
    const u = window.cloud && window.cloud.user;
    let logo = new URL('assets/sawada-logo.png?v=2', location.href).href;
    try { // embed the logo so it shows in the new tab and in the PDF
      const im = document.querySelector('header .brand img');
      if (im && im.naturalWidth) { const c = document.createElement('canvas'); c.width = c.height = 128; c.getContext('2d').drawImage(im, 0, 0, 128, 128); logo = c.toDataURL('image/png'); }
    } catch (e) { /* keep the link */ }
    const title = `SAWADA Statement - ${acct || 'All accounts'} - ${fmtDate(from)} to ${fmtDate(to)}`;
    const catRows = Object.entries(cats).sort((x, y) => y[1] - x[1]).map(([c, v]) => `<tr><td>${esc(c)}</td><td class="n">${money(v)}</td><td class="n">${outt ? Math.round(v / outt * 100) : 0}%</td></tr>`).join('');
    const openDebts = debts ? S.debts.map((d) => ({ d, c: debtCalc(d) })).filter(({ c }) => c.balance > 0.004) : [];
    const debtRows = openDebts.map(({ d, c }) => `<tr><td>${esc(d.person)}${d.description ? `<div class="c">${esc(d.description)}</div>` : ''}</td><td>${esc(d.type)}</td><td class="n">${money(d.amount)}</td><td class="n">${money(c.paid)}</td><td class="n b">${money(c.balance)}</td><td>${esc(c.status)}</td></tr>`).join('');
    const owe = sum(openDebts.filter(({ d }) => d.type !== OWED), (x) => x.c.balance), me = sum(openDebts.filter(({ d }) => d.type === OWED), (x) => x.c.balance);
    const perAcct = all && accts.length > 1 ? accts.map((a) => {
      const o = accountCalc(a, prevDay(from)).current, c = accountCalc(a, to).current;
      return `<tr><td>${esc(a.name)}<div class="c">${esc(a.type || '')}</div></td><td class="n">${money(o)}</td><td class="n">${money(c)}</td></tr>`;
    }).join('') : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Roboto, Arial, sans-serif; color: #0E1520; font-size: 12px; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: 820px; margin: 0 auto; padding: 24px 20px 40px; }
  .bar { position: sticky; top: 0; background: #0E1520; color: #fff; padding: 10px 16px; display: flex; gap: 10px; align-items: center; justify-content: space-between; font-size: 13px; }
  .bar button { font: inherit; font-weight: 700; border: 0; border-radius: 10px; padding: 10px 16px; background: #E11D2E; color: #fff; cursor: pointer; }
  .bar .x { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.4); font-weight: 500; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 3px solid #E11D2E; padding-bottom: 14px; }
  .brand { display: flex; gap: 10px; align-items: center; }
  .brand img { width: 44px; height: 44px; border-radius: 10px; }
  .brand b { font-size: 18px; letter-spacing: .3px; } .brand b i { color: #E11D2E; font-style: normal; }
  .brand span { display: block; color: #5B6472; font-size: 11px; }
  h1 { margin: 0; font-size: 20px; text-align: right; }
  .meta { text-align: right; color: #5B6472; font-size: 11px; line-height: 1.5; margin-top: 4px; }
  .sum { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0; }
  .sum div { border: 1px solid #E4E7EC; border-radius: 10px; padding: 10px 12px; }
  .sum small { display: block; color: #5B6472; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; }
  .sum b { font-size: 15px; font-variant-numeric: tabular-nums; }
  .sum .hl { background: #0E1520; color: #fff; border-color: #0E1520; } .sum .hl small { color: #C9CED6; }
  h2 { font-size: 13px; margin: 20px 0 6px; text-transform: uppercase; letter-spacing: .5px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: #5B6472; border-bottom: 1.5px solid #0E1520; padding: 6px; }
  td { padding: 6px; border-bottom: 1px solid #E4E7EC; vertical-align: top; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  .n { text-align: right; white-space: nowrap; } th.n { text-align: right; }
  .d { white-space: nowrap; color: #3A4250; }
  .c { color: #7A8291; font-size: 10.5px; margin-top: 1px; }
  .b { font-weight: 700; } .in { color: #0E1520; }
  .ob td { background: #F5F6F8; font-weight: 500; } .cb td { background: #F5F6F8; font-weight: 700; border-top: 1.5px solid #0E1520; }
  .empty { padding: 18px; text-align: center; color: #7A8291; }
  .note { color: #7A8291; font-size: 10.5px; margin-top: 18px; line-height: 1.5; }
  @media (max-width: 560px) { .sum { grid-template-columns: repeat(2, 1fr); } header { flex-direction: column; } h1, .meta { text-align: left; } .page { padding: 16px 10px 30px; } td, th { padding: 5px 3px; } body { font-size: 11px; } }
  @media print { .bar { display: none; } .page { padding: 0; max-width: none; } }
</style></head><body>
<div class="bar"><span>Statement ready</span><span><button class="x" onclick="window.close()">Close</button> <button onclick="window.print()">Save as PDF</button></span></div>
<div class="page">
  <header>
    <div class="brand"><img src="${logo}" alt=""><div><b>SAWADA<i>.</i></b> Budget Tracker<span>${esc(u && u.displayName ? u.displayName : 'Personal statement')}${u && u.email ? ' · ' + esc(u.email) : ''}</span></div></div>
    <div><h1>Account statement</h1><div class="meta">${esc(acct || 'All accounts')}<br>${esc(fmtDate(from))} – ${esc(fmtDate(to))}<br>Generated ${esc(new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }))}</div></div>
  </header>
  <div class="sum">
    <div><small>Opening balance</small><b>${money(opening)}</b></div>
    <div><small>Money in</small><b>+${money(inn)}</b></div>
    <div><small>Money out</small><b>−${money(outt)}</b></div>
    <div class="hl"><small>Closing balance</small><b>${money(closing)}</b></div>
  </div>
  ${perAcct ? `<h2>Accounts</h2><table><thead><tr><th>Account</th><th class="n">Opening</th><th class="n">Closing</th></tr></thead><tbody>${perAcct}</tbody></table>` : ''}
  <h2>Transactions · ${rows.length}</h2>
  <table><thead><tr><th>Date</th><th>Description</th><th class="n">In</th><th class="n">Out</th><th class="n">Balance</th></tr></thead>
  <tbody><tr class="ob"><td class="d">${esc(fmtDate(from))}</td><td>Opening balance</td><td></td><td></td><td class="n">${money(opening)}</td></tr>
  ${body || '<tr><td colspan="5" class="empty">No transactions in this period.</td></tr>'}
  <tr class="cb"><td class="d">${esc(fmtDate(to))}</td><td>Closing balance</td><td class="n">${money(inn)}</td><td class="n">${money(outt)}</td><td class="n">${money(closing)}</td></tr></tbody></table>
  ${catRows ? `<h2>Spending by category</h2><table><thead><tr><th>Category</th><th class="n">Amount</th><th class="n">Share</th></tr></thead><tbody>${catRows}</tbody></table>` : ''}
  ${debts ? `<h2>Open debts (as of today)</h2>${debtRows ? `<table><thead><tr><th>Person</th><th>Type</th><th class="n">Total</th><th class="n">Paid</th><th class="n">Balance</th><th>Status</th></tr></thead><tbody>${debtRows}</tbody></table>
    <p class="c" style="margin-top:6px">I still owe ${money(owe)} · Others owe me ${money(me)}</p>` : '<p class="c">No open debts.</p>'}` : ''}
  <p class="note">${all ? 'Transfers between your own accounts are left out of the all-accounts view because they don\'t change your total. ' : ''}${notes.map(esc).join(' ')} This statement is made from the entries in your SAWADA tracker. It is not an official bank document.</p>
</div>
<script>if (matchMedia('(pointer:fine)').matches) setTimeout(function(){ window.print(); }, 700);<\/script>
</body></html>`;
  }

  function editStatement() {
    if (!S.accounts.length) { toast('Add an account first.'); return; }
    const ym = todayStr().slice(0, 7), last = shiftMonth(ym, -1);
    const periods = [
      { value: 'this', label: `This month (${monthLabel(ym)})` },
      { value: 'last', label: `Last month (${monthLabel(last)})` },
      { value: '3m', label: 'Last 3 months' },
      { value: 'year', label: `This year (${ym.slice(0, 4)})` },
      { value: 'custom', label: 'Custom dates…' },
    ];
    const custom = { key: 'period', value: 'custom' };
    openForm({
      title: 'Statement (PDF)',
      note: 'Pick an account and period. The statement opens in a new tab: tap <b>Save as PDF</b> (on iPhone: Share → Save to Files).',
      fields: [
        { key: 'acct', label: 'Account', type: 'select', options: [{ value: '', label: 'All accounts' }, ...S.accounts.map((a) => ({ value: a.name, label: a.name }))], full: true },
        { key: 'period', label: 'Period', type: 'select', options: periods, default: UI.stmtPeriod || 'this', full: true },
        { key: 'from', label: 'From', type: 'date', default: ym + '-01', showIf: custom },
        { key: 'to', label: 'To', type: 'date', default: todayStr(), showIf: custom },
        { key: 'debts', label: 'Include my open debts', type: 'check', default: true, full: true },
      ],
      values: { acct: UI.stmtAcct || '' },
      saveLabel: 'Create statement',
      onSave: (v) => {
        let from, to;
        if (v.period === 'this') { from = ym + '-01'; to = todayStr(); }
        else if (v.period === 'last') { from = last + '-01'; to = lastDay(last); }
        else if (v.period === '3m') { from = shiftMonth(ym, -2) + '-01'; to = todayStr(); }
        else if (v.period === 'year') { from = ym.slice(0, 4) + '-01-01'; to = todayStr(); }
        else { from = v.from; to = v.to; if (!from || !to) return 'Pick both dates.'; if (from > to) return '"From" must be before "To".'; }
        UI.stmtAcct = v.acct; UI.stmtPeriod = v.period; saveUI();
        const html = statementHTML({ acct: v.acct, from, to, debts: v.debts });
        const w = window.open('', '_blank');
        if (w) { w.document.open(); w.document.write(html); w.document.close(); }
        else {
          // pop-ups blocked: print from a hidden frame instead
          const f = document.createElement('iframe');
          f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
          document.body.appendChild(f);
          f.contentDocument.open(); f.contentDocument.write(html.replace(/<script>[\s\S]*?<\/script>/, '')); f.contentDocument.close();
          setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 800);
        }
      },
    });
  }

  function logCard() {
    const recent = (S.log || []).slice(0, 3);
    return `<div class="sec-head"><h2>Action log</h2><button class="link" data-act="openLog">See all</button></div>
      <section class="card pad0 log-list">${recent.length ? recent.map(logRow).join('') : '<p class="empty">Your changes will show up here, with an Undo button.</p>'}</section>`;
  }

  function viewSettings() {
    const cats = S.categories.map((c) => `<tr ${rowAttrs('category', c.uid)}><td>${esc(c.name)}</td><td><span class="pill ${c.type === 'Income' ? 'good' : ''}">${esc(c.type)}</span></td><td class="num">${num(c.budget) ? money(c.budget) : '<span class="muted">—</span>'}</td></tr>`).join('');
    return `
      <section>
        ${cloudCard()}
        ${logCard()}
        <div class="sec-head"><h2>Your data</h2></div>
        <div class="card">
          <p class="small" style="margin-top:0">${window.cloud && window.cloud.user ? 'Saved in this browser <b>and in your cloud account</b>. Backups are still handy as an extra copy.' : 'Everything is saved in <b>this browser on this device</b> only. To use it on your phone too, ' + (window.cloud && window.cloud.enabled ? 'sign in above, or ' : '') + 'make a backup here and restore it there.'}</p>
          ${storageOK ? '' : '<p class="bad small">This browser is blocking storage (private mode?). Changes will be lost when you close the page. Make a backup before leaving.</p>'}
          <div class="btn-row">
            <button class="btn primary" data-act="importXlsx">Import Excel file</button>
            <button class="btn" data-act="statement">Statement (PDF)</button>
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
        <div class="card appear">
          <div class="small muted">Theme</div>
          <div class="seg"><button type="button" data-act="setTheme" data-v="light">Light</button><button type="button" data-act="setTheme" data-v="dark">Dark</button></div>
          <div class="small muted">Text size</div>
          <div class="seg seg3 textsize" role="radiogroup" aria-label="Text size">
            ${[['small', 'Small', 13], ['normal', 'Normal', 16], ['large', 'Large', 20]].map(([v, l, a]) => `<button type="button" role="radio" aria-checked="${textSize() === v}" class="${textSize() === v ? 'on' : ''}" data-act="setText" data-v="${v}"><span style="font-size:${a}px">A</span>${l}</button>`).join('')}
          </div>
        </div>
      </section>
      <section>
        <div class="sec-head"><h2>Bills &amp; reminders</h2><button class="btn" data-act="addBill">+ Bill</button></div>
        <div class="card pad0 table-wrap"><table>
          <thead><tr><th>Bill</th><th>Repeats</th><th class="num">Amount</th></tr></thead>
          <tbody>${S.bills.length ? S.bills.map((b) => `<tr ${rowAttrs('bill', b.uid)}><td>${esc(b.name)}<div class="desc">${esc(b.category || '')}${b.account ? ' · ' + esc(b.account) : ''}</div></td><td>${esc(b.repeat || 'Monthly')}${b.date && b.repeat !== 'Once' ? `<div class="desc">every ${ordinal(+b.date.slice(8))}</div>` : ''}</td><td class="num">${b.varies ? 'Varies' : money(b.amount)}</td></tr>`).join('') : emptyRow(3, 'No bills yet.')}</tbody>
        </table></div>
      </section>`;
  }

  const VIEWS = { summary: viewSummary, budget: viewBudget, accounts: viewAccounts, debts: viewDebts, payments: viewPayments, settings: viewSettings, history: viewHistory };

  // signed-out users see the sign-in page (unless they chose "this device only")
  function gateState() {
    const c = window.cloud;
    if (!c) return '';
    if (c.pending && !c.ready) return 'loading';
    if (c.enabled && c.ready && !c.user && !UI.localOnly) return 'signin';
    return '';
  }
  const LOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  function viewSignIn() {
    return `<div class="signin">
      <section class="si-hero">
        <div class="si-brand"><img src="assets/sawada-logo.png?v=2" alt="SAWADA logo" width="48" height="48"><span><b>SAWADA<i>.</i></b> Budget Tracker</span></div>
        <div class="si-copy">
          <h1>Know where every peso goes<i>.</i></h1>
          <p>Your accounts, budget and debts in one place. Track installments, see what's due next, and sync between your phone and computer.</p>
        </div>
        <div class="si-preview" aria-hidden="true">
          <div class="si-tile wide"><span>Net worth</span><b>₱ ••••••</b><div class="si-bar"><span></span></div></div>
          <div class="si-tile"><span>Next due</span><b>Installments</b></div>
          <div class="si-tile"><span>Accounts</span><b>Synced</b></div>
        </div>
      </section>
      <section class="si-panel">
        <div class="si-card">
          <img class="si-logo" src="assets/sawada-logo.png?v=2" alt="" width="56" height="56">
          <div class="si-kicker">SAWADA<i>.</i> Budget Tracker</div>
          <h2>Welcome back</h2>
          <p class="muted">Sign in to load your tracker on this device.</p>
          <button type="button" class="btn gbtn si-google" data-act="cloudSignIn">${GOOGLE_G} Continue with Google</button>
          <div class="si-or"><span></span>or<span></span></div>
          <button type="button" class="btn si-local" data-act="useLocal">Use on this device only</button>
          <div class="si-note">${LOCK}<span>Private to your Google account. Nobody else can see your data.</span></div>
        </div>
      </section>
    </div>`;
  }

  let shownPage = '';
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function enterAnimation(page) {
    const v = $('#view');
    if (page === shownPage) return;
    shownPage = page;
    v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    runCounters();
  }
  function runCounters() {
    const els = document.querySelectorAll('#view [data-count]');
    if (!els.length || reduceMotion()) return;
    const start = performance.now(), dur = 900;
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const tick = (now) => {
      const k = Math.min(1, (now - start) / dur);
      els.forEach((el) => { const n = +el.dataset.count * ease(k); el.textContent = money(n).replace(/^-/, '−'); });
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // loading screen: stays until we know whether you're signed in
  let splashReady = false, splashGone = false;
  function maybeHideSplash() {
    if (splashGone || !splashReady || gateState() === 'loading') return;
    splashGone = true;
    const el = $('#splash');
    if (!el) return;
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, Math.max(0, 900 - performance.now()));
  }
  document.addEventListener('DOMContentLoaded', () => { splashReady = true; maybeHideSplash(); });
  setTimeout(() => { splashReady = true; maybeHideSplash(); }, 0);

  function render() {
    const gate = gateState();
    document.body.classList.toggle('gated', !!gate);
    maybeHideSplash();
    if (gate) {
      closeMenu(); notesOpen = false;
      $('#view').innerHTML = gate === 'loading'
        ? '<div class="si-loading"><img src="assets/sawada-logo.png?v=2" alt="Loading" width="72" height="72"></div>'
        : viewSignIn();
      if (gate === 'signin') enterAnimation('signin');
      return;
    }
    if (!VIEWS[UI.tab]) UI.tab = 'summary';
    $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab${UI.tab === k ? ' on' : ''}" data-tab="${k}" ${UI.tab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('');
    $('#view').innerHTML = VIEWS[UI.tab]();
    enterAnimation(UI.tab + (hasData() ? '' : ':empty'));
    const navBtn = ([k, l]) => `<button type="button" class="${UI.tab === k ? 'on' : ''}" data-tab="${k}" ${UI.tab === k ? 'aria-current="page"' : ''}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICONS[k]}</svg><span>${l}</span></button>`;
    const navTabs = TABS.filter(([k]) => TAB_ICONS[k]);
    $('#bottomNav').innerHTML = navTabs.map(navBtn).join('');
    renderBell();
    $('#drawerNav').innerHTML = TABS.map(([k, l]) => `<button type="button" class="${UI.tab === k ? 'on' : ''}" data-tab="${k}" ${UI.tab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('');
    $('#pageTitle').textContent = UI.tab === 'history' ? 'Action log' : (TABS.find(([k]) => k === UI.tab) || [, ''])[1];
    renderAuth();
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
    if (f.type === 'check') {
      return `<div class="field${f.full ? ' full' : ''}" data-field="${f.key}"><label class="check"><input type="checkbox" id="${id}" name="${f.key}"${val === true || (val === '' && f.default) ? ' checked' : ''}> <span>${esc(f.label)}</span></label>${f.hint ? `<div class="hint">${f.hint}</div>` : ''}</div>`;
    }
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

  function openForm({ title, note = '', head = '', fields, values = {}, onSave, onDelete, deleteLabel = 'Delete', saveLabel = 'Save', onChange }) {
    form.innerHTML = `<h2>${esc(title)}</h2>${head}${note ? `<p class="muted small" style="margin:0">${note}</p>` : ''}
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
        if (f.type === 'check') { vals[f.key] = !!(el && el.checked); continue; }
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
  function choose(title, message, options) {
    form.innerHTML = `<h2>${esc(title)}</h2><p class="small" style="margin:0">${message}</p>
      <div class="actions" style="flex-direction:column;align-items:stretch">${options.map((o, i) => `<button type="button" class="btn ${o.primary ? 'primary' : ''}" data-choice="${i}" style="justify-content:center">${esc(o.label)}</button>`).join('')}</div>`;
    form.onsubmit = (e) => e.preventDefault();
    form.onchange = form.oninput = null;
    form.onclick = (e) => {
      const b = e.target.closest('[data-choice]');
      if (!b) return;
      dlg.close();
      options[+b.dataset.choice].fn();
    };
    dlg.showModal();
  }
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

  function editTx(uid, preset) {
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
      values: t || preset || {},
      onSave: (v) => {
        if (v.amount <= 0) return 'Amount must be more than 0.';
        if (t) Object.assign(t, v); else S.transactions.push({ uid: newUid(), ...v, ...(preset && preset.interestFor ? { interestFor: preset.interestFor } : {}) });
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
        { key: 'account', label: 'Account', type: 'select', placeholder: 'None — no money moved', options: accountOpts, full: true, hint: ' ' },
        { key: 'notes', label: 'Notes', full: true },
      ],
      values: d || {},
      onChange: (f) => {
        const ah = f.querySelector('[data-field="account"] .hint');
        if (ah) {
          const owed = f.elements.type.value === OWED, inst = f.elements.plan.value === INSTALLMENT;
          ah.textContent = owed
            ? 'The account you lent the money from. It goes down by the amount; their payments add it back.'
            : inst ? 'Leave empty for things bought on installment (no cash received). Your payments are deducted automatically.'
              : 'The account the borrowed cash went into. It goes up by the amount; your payments take it back out.';
        }
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

  function editPayment(uid, preset) {
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
      values: p || preset || {},
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
        { key: 'rate', label: 'Interest (% per year)', type: 'money', hint: 'e.g. 4 for a digital bank paying 4% p.a.' },
        { key: 'tax', label: 'Tax on interest', type: 'select', options: TAX_OPTS, default: '20' },
        { key: 'autoInterest', label: 'Add the interest automatically at the end of each month', type: 'check', full: true, hint: ' ' },
        { key: 'notes', label: 'Notes', full: true },
      ],
      values: a || {},
      onChange: (f) => {
        const r = num(f.elements.rate.value), bal = a ? accountCalc(a).current : num(f.elements.start.value);
        const tax = num(f.elements.tax.value);
        const est = interestEst({ rate: r, tax }, bal);
        const show = r > 0;
        f.querySelector('[data-field="tax"]').hidden = !show;
        f.querySelector('[data-field="autoInterest"]').hidden = !show;
        f.querySelector('[data-field="autoInterest"] .hint').textContent = show
          ? `About ${money(est)} a month on ${money(bal)}${tax ? ', after tax' : ''}. It's an estimate: your bank's figure can differ a little, and you can edit it.` : '';
      },
      onSave: (v) => {
        if (S.accounts.some((x) => x !== a && x.name.toLowerCase() === v.name.toLowerCase())) return 'You already have an account with that name.';
        if (v.rate < 0 || v.rate > 100) return 'Interest must be between 0 and 100%.';
        if (!(v.rate > 0)) { v.rate = 0; v.autoInterest = false; }
        if (v.autoInterest && !(a && a.autoInterest && a.interestStart)) v.interestStart = todayStr();
        if (!v.autoInterest) v.interestStart = '';
        if (v.rate > 0 && !S.categories.some((c) => c.name === INTEREST_CAT)) S.categories.push({ uid: newUid(), name: INTEREST_CAT, type: 'Income', budget: 0 });
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

  const EDIT = { bill: editBill, tx: editTx, debt: editDebt, payment: editPayment, account: editAccount, transfer: editTransfer, category: editCategory };

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
        data.log = S.log; S = data; save({ label: 'Imported Excel file' }); saveUI(); UI.tab = 'summary'; render();
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
      const apply = () => { const keep = S.log; S = normalize(d); S.log = keep; save({ label: 'Restored a backup' }); UI.tab = 'summary'; render(); toast('Backup restored'); };
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
  const TEXT_ZOOM = { small: 0.92, normal: 1, large: 1.12 };
  function textSize() { try { return localStorage.getItem(KEY + ':text') || 'normal'; } catch (e) { return 'normal'; } }
  function setTextSize(v) {
    if (!TEXT_ZOOM[v]) return;
    try { localStorage.setItem(KEY + ':text', v); } catch (e) { /* ignore */ }
    document.documentElement.style.zoom = TEXT_ZOOM[v];
    document.documentElement.setAttribute('data-text', v);
    render();
  }
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
  // ---------- Scan receipt (Gemini via Firebase AI Logic, see cloud.js) ----------
  const SCAN_ICO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 9h8M8 12h8M8 15h5"/></svg>';
  const CAM_ICO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>';
  const IMG_ICO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>';
  const PEN_ICO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const SPARK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.6L19.5 9l-5.7 1.4L12 16l-1.8-5.6L4.5 9l5.7-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  let addMenuOpen = false;
  function renderAddMenu() {
    let m = $('#addMenu');
    const fab = $('.fab');
    if (fab) { fab.classList.toggle('open', addMenuOpen); fab.setAttribute('aria-expanded', addMenuOpen ? 'true' : 'false'); }
    if (!addMenuOpen) { if (m) m.remove(); return; }
    if (!m) { m = document.createElement('div'); m.id = 'addMenu'; m.className = 'add-menu'; m.setAttribute('role', 'menu'); document.body.appendChild(m); }
    const item = (act, ico, title, sub, hot) => `<button type="button" role="menuitem" class="am-item${hot ? ' hot' : ''}" data-act="${act}"><span class="am-ico">${ico}</span><span class="am-txt"><b>${title}</b><span>${sub}</span></span></button>`;
    m.innerHTML = item('scanCamera', CAM_ICO, 'Scan receipt', 'Take a photo', true)
      + item('scanUpload', IMG_ICO, 'Upload receipt', 'Photo, screenshot or PDF')
      + item('addTx', PEN_ICO, 'Add manually', 'Income or expense');
  }
  function closeAddMenu() { if (addMenuOpen) { addMenuOpen = false; renderAddMenu(); } }

  function scanBlocked() {
    const c = window.cloud;
    if (!S.accounts.length) { toast('Add an account first (Accounts tab).'); return true; }
    if (!c || !c.enabled) { toast('The scanner needs the cloud connection. Check your internet and reload.', 5000); return true; }
    if (!c.scanReady) { toast('The scanner isn\'t set up yet. Add your reCAPTCHA key to firebase-config.js (see the setup steps).', 6000); return true; }
    return false;
  }
  function pickReceipt(camera) {
    closeAddMenu();
    if (scanBlocked()) return;
    const inp = $(camera ? '#fileCam' : '#fileImg');
    inp.value = '';
    inp.click();
  }

  // shrink big phone photos before sending (faster, and enough detail to read the text)
  async function prepImage(file) {
    if (file.type === 'application/pdf') {
      if (file.size > 15e6) throw new Error('That PDF is too big (max 15 MB).');
      return { data: await toBase64(file), mimeType: file.type, url: '' };
    }
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
      return { data: await toBase64(blob), mimeType: 'image/jpeg', url: URL.createObjectURL(blob) };
    } catch (e) {
      if (file.size > 15e6) throw new Error('That photo is too big. Try a screenshot instead.');
      return { data: await toBase64(file), mimeType: file.type || 'image/jpeg', url: URL.createObjectURL(file) };
    }
  }
  const toBase64 = (blob) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(blob); });

  let scanRun = 0;
  async function scanFile(file) {
    if (!file) return;
    const run = ++scanRun;
    let img;
    try { img = await prepImage(file); } catch (e) { toast(e.message, 5000); return; }
    const thumb = img.url ? `<img src="${img.url}" alt="">` : `<span class="pdf">PDF</span>`;
    form.innerHTML = `<div class="scan-wait">${thumb}<div class="scan-line"></div></div>
      <h2 style="text-align:center">Reading your receipt…</h2>
      <p class="muted small" style="margin:0;text-align:center">Gemini is finding the store, date, total and items. This takes a few seconds.</p>
      <div class="actions"><span class="sp"></span><button type="button" class="btn" data-dlg="cancel">Cancel</button></div>`;
    form.onsubmit = (e) => e.preventDefault();
    form.onchange = form.oninput = null;
    form.onclick = (e) => { if (e.target.closest('[data-dlg=cancel]')) { scanRun++; dlg.close(); } };
    if (!dlg.open) dlg.showModal();
    const cats = S.categories.filter((c) => c.type === 'Expense' && c.name !== S.settings.debtCategory).map((c) => c.name);
    let r;
    try {
      r = await window.cloud.readReceipt(img, cats);
    } catch (e) {
      if (run !== scanRun) return;
      dlg.close();
      choose('Couldn\'t read it', String(e.message || e), [
        { label: 'Try another photo', primary: true, fn: () => pickReceipt(false) },
        { label: 'Add it manually', fn: () => editTx() },
      ]);
      return;
    }
    if (run !== scanRun) return;
    showScanResult(r || {}, img, cats);
  }

  function showScanResult(r, img, cats) {
    if (r.isReceipt === false) {
      choose('That doesn\'t look like a receipt', 'Try again with the whole receipt in the photo, flat and in good light.', [
        { label: 'Try another photo', primary: true, fn: () => pickReceipt(false) },
        { label: 'Add it manually', fn: () => editTx() },
      ]);
      return;
    }
    const today = todayStr();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && r.date <= today ? r.date : today;
    const items = (Array.isArray(r.items) ? r.items : []).filter((x) => x && x.name).slice(0, 15);
    const total = num(r.total) || Math.round(sum(items) * 100) / 100;
    const cat = cats.includes(r.category) ? r.category : (cats.find((c) => /food|grocer/i.test(c)) || cats[0] || '');
    const acct = S.accounts.some((a) => a.name === UI.lastScanAcct) ? UI.lastScanAcct : (S.accounts[0] || {}).name;
    const itemsTxt = items.map((x) => `${x.name} ${money(x.amount)}`).join('; ');
    const thumb = img.url ? `<img src="${img.url}" alt="Receipt photo">` : '<span class="pdf">PDF</span>';
    const head = `<div class="scan-head"><span class="scan-thumb">${thumb}</span>
        <span class="ai-badge">${SPARK} Filled in by AI · please check</span></div>
      ${items.length ? `<details class="scan-items"${items.length <= 6 ? ' open' : ''}><summary>${items.length} item${items.length > 1 ? 's' : ''} found</summary>
        <div>${items.map((x) => `<div><span>${esc(x.name)}</span><span>${money(x.amount)}</span></div>`).join('')}
        <div class="tot"><span>Total</span><span>${money(total)}</span></div></div></details>` : ''}
      ${r.notes ? `<p class="muted small" style="margin:0">Note from Gemini: ${esc(r.notes)}</p>` : ''}`;
    openForm({
      title: r.store ? `${r.store}` : 'Receipt read',
      head,
      fields: [
        { key: 'amount', label: 'Amount (₱)', type: 'money', required: true },
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'description', label: 'Store / description', full: true },
        { key: 'category', label: 'Category', type: 'select', required: true, placeholder: 'Choose…', options: () => catOpts(), full: true },
        { key: 'account', label: 'Paid from', type: 'select', required: true, placeholder: 'Choose…', options: accountOpts },
        { key: 'notes', label: 'Notes' },
      ],
      values: { amount: total ? total.toFixed(2) : '', date, description: r.store || '', category: cat, account: acct, notes: itemsTxt.length > 300 ? itemsTxt.slice(0, 297) + '…' : itemsTxt },
      saveLabel: 'Save expense',
      onSave: (v) => {
        if (v.amount <= 0) return 'Amount must be more than 0.';
        S.transactions.push({ uid: newUid(), ...v, scanned: true });
        UI.lastScanAcct = v.account; saveUI();
        toast(`Saved ${money(v.amount)} from ${v.account}`);
      },
    });
    if (img.url) dlg.addEventListener('close', () => setTimeout(() => URL.revokeObjectURL(img.url), 1000), { once: true });
  }

  const ACTIONS = {
    importXlsx: () => $('#fileXlsx').click(),
    restoreJson: () => $('#fileJson').click(),
    backupJson, exportCsv,
    eraseAll: () => confirmBox('Erase all data?', 'This deletes everything saved in this browser. It cannot be undone. Download a backup first if you might need it.', 'Erase everything', () => { S = blank(); save(); toast('All data erased'); }),
    goSettings: () => { UI.tab = 'settings'; saveUI(); render(); },
    goBudget: () => { UI.tab = 'budget'; UI.month = todayStr().slice(0, 7); saveUI(); render(); },
    prevMonth: () => { UI.month = shiftMonth(UI.month, -1); saveUI(); render(); },
    nextMonth: () => { UI.month = shiftMonth(UI.month, 1); saveUI(); render(); },
    toggleHide: () => { UI.hideMoney = !UI.hideMoney; saveUI(); render(); },
    togglePaid: () => { UI.showPaid = !UI.showPaid; saveUI(); render(); },
    addTx: () => { closeAddMenu(); editTx(); }, statement: () => editStatement(), chartPick: (el) => chartPick(el), openLog: () => { UI.tab = 'history'; UI.logAcct = ''; saveUI(); render(); window.scrollTo(0, 0); }, undoLog: (el) => undoLog(el.dataset.g), addMenu: () => { addMenuOpen = !addMenuOpen; renderAddMenu(); }, scanCamera: () => pickReceipt(true), scanUpload: () => pickReceipt(false), recordInterest: (el) => recordInterest(el.dataset.uid), addDebt: () => editDebt(), addPayment: () => editPayment(), addAccount: () => editAccount(),
    addTransfer: () => editTransfer(), addCategory: () => editCategory(),
    toggleTheme: () => setTheme(isDark() ? 'light' : 'dark'),
    setTheme: (el) => setTheme(el.dataset.v),
    openMenu, closeMenu,
    cloudSignIn: () => { closeMenu(); if (window.cloud) window.cloud.signIn(); },
    addBill: () => editBill(),
    billTap: (el) => { notesOpen = false; billTap(el); renderBell(); },
    toggleNotes: () => { notesOpen = !notesOpen; renderBell(); },
    readAll: () => { UI.seenNotes = [...new Set([...(UI.seenNotes || []), ...notifications().map((x) => x.nid)])].slice(-300); saveUI(); renderBell(); },
    setText: (el) => setTextSize(el.dataset.v),
    useLocal: () => { UI.localOnly = true; saveUI(); render(); },
    cloudSignOut: () => { acctOpen = false; closeMenu(); if (window.cloud) window.cloud.signOut(); },
    toggleAcctMenu: () => { acctOpen = !acctOpen; renderAuth(); },
  };

  document.addEventListener('click', (e) => {
    if (e.target.closest('dialog')) return;
    if (acctOpen && !e.target.closest('.acct-menu')) { acctOpen = false; renderAuth(); }
    if (notesOpen && !e.target.closest('.bell-wrap')) { notesOpen = false; renderBell(); }
    if (addMenuOpen && !e.target.closest('#addMenu,.fab')) closeAddMenu();
    const el = e.target.closest('[data-tab],[data-act],[data-edit]');
    if (!el || el.disabled) return;
    if (el.dataset.tab) { closeMenu(); UI.tab = el.dataset.tab; saveUI(); render(); window.scrollTo(0, 0); return; }
    if (el.dataset.edit) closeMenu();
    if (el.dataset.edit) { EDIT[el.dataset.edit](el.dataset.uid); return; }
    const fn = ACTIONS[el.dataset.act];
    if (fn) fn(el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeMenu(); if (acctOpen) { acctOpen = false; renderAuth(); } if (notesOpen) { notesOpen = false; renderBell(); } closeAddMenu(); }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-edit],.tx-item[data-edit]')) EDIT[e.target.dataset.edit](e.target.dataset.uid);
    if (e.key === 'Enter' && e.target.matches && e.target.matches('.bill[data-act]')) billTap(e.target);
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'monthPick' && e.target.value) { UI.month = e.target.value; saveUI(); render(); }
    if (e.target.classList.contains('log-filter')) { UI.logAcct = e.target.value; saveUI(); render(); }
  });
  $('#fileXlsx').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importXlsxFile(f); });
  for (const id of ['#fileCam', '#fileImg']) $(id).addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) scanFile(f); });
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
  // post any end-of-month interest that is due (after the cloud copy is loaded, so devices don't clash)
  function runAuto() {
    const n = autoInterest();
    if (n) { save({ label: 'Automatic interest' }); render(); toast(`Added interest for ${n} month${n > 1 ? 's' : ''}`); }
  }
  setTimeout(() => { const c = window.cloud; if (!c || !c.enabled || (c.ready && !c.user)) runAuto(); }, 1500);
  { const t = textSize(); if (TEXT_ZOOM[t]) { document.documentElement.style.zoom = TEXT_ZOOM[t]; document.documentElement.setAttribute('data-text', t); } }
  render();

  // exposed for testing in the browser console
  window.tracker = {
    get state() { return S; }, runAuto, totals, monthTotals, accountCalc, debtCalc, hasData, render, toast, choose,
    // used by cloud.js
    replace(data, opts) { S = normalize(data); save(opts); render(); },
    signedIn() { if (UI.localOnly) { UI.localOnly = false; saveUI(); } },
    clearLocal() { S = blank(); snap = takeSnap(); try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } UI.tab = 'summary'; UI.localOnly = false; saveUI(); render(); },
  };
})();
