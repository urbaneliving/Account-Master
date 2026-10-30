/* Account Master — Urbane Living
 * Single-page app. All data lives in the Google Sheet behind the Apps Script
 * API (see apps-script/Code.gs). Open with ?demo=1 to try it with sample data
 * stored only in this browser.
 */
(function () {
  'use strict';

  const CFG = window.AM_CONFIG || {};
  const DEMO = new URLSearchParams(location.search).has('demo');
  const WRITE_ROLES = ['Admin', 'Accountant'];

  function store() {}
  store.get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  store.set = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  store.del = function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  const S = {
    token: store.get('am_token'),
    user: null,
    settings: null,
    data: {},
    users: [],
    ui: {},
    tables: {},
    loading: false,
  };

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v) || 0;
  const round2 = (v) => Math.round(num(v) * 100) / 100;
  const inr = (v) => (num(v) < 0 ? '−₹' : '₹') + Math.abs(num(v)).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const inrShort = (v) => {
    const a = Math.abs(v);
    if (a >= 1e7) return '₹' + (v / 1e7).toFixed(1).replace(/\.0$/, '') + 'Cr';
    if (a >= 1e5) return '₹' + (v / 1e5).toFixed(1).replace(/\.0$/, '') + 'L';
    if (a >= 1e3) return '₹' + (v / 1e3).toFixed(0) + 'k';
    return '₹' + Math.round(v);
  };
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => isoDate(new Date());
  const thisMonth = () => today().slice(0, 7);
  const monthOf = (d) => String(d || '').slice(0, 7);
  const addMonths = (m, n) => {
    const d = new Date(m + '-01T00:00:00');
    d.setMonth(d.getMonth() + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  };
  const monthEnd = (m) => { const d = new Date(m + '-01T00:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return isoDate(d); };
  const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const fmtMonth = (m) => m ? new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
  const fmtStamp = (s) => s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const sum = (arr, k) => arr.reduce((a, r) => a + num(typeof k === 'function' ? k(r) : r[k]), 0);
  const initials = (n) => String(n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const canWrite = () => S.user && WRITE_ROLES.includes(S.user.role);
  const isAdmin = () => S.user && S.user.role === 'Admin';
  const ACCOUNTS_ROLES = ['Admin', 'Accountant', 'Viewer'];
  const seesAccounts = () => S.user && ACCOUNTS_ROLES.includes(S.user.role);
  const list = (k) => (S.settings && S.settings.lists[k]) || [];
  const rows = (t) => S.data[t] || [];
  const byId = (t, id) => rows(t).find((r) => r.id === id);
  const clientName = (id) => { const c = byId('Clients', id); return c ? c.name : ''; };
  const empName = (id) => { const e = byId('Employees', id); return e ? e.name : ''; };
  const userName = (email) => { const u = S.users.find((x) => x.email === email); return u ? u.name : email || ''; };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const isKmType = (t) => /km/i.test(t || '');
  const inRange = (d, p) => (!p.from || d >= p.from) && (!p.to || d <= p.to);

  function ui(page) {
    if (!S.ui[page]) S.ui[page] = {};
    return S.ui[page];
  }

  const ICONS = {
    dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    clients: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-7h6v7"/>',
    office: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/>',
    salary: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M17 11h5M19.5 8.5v5"/>',
    expenses: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    estimate: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    attendance: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    pay: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M16 7l3 3M19 4l2 2"/>',
  };
  const icon = (n) => '<svg width="16" height="16" style="vertical-align:-3px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';

  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), isError ? 5000 : 2600);
  }

  // ---------------------------------------------------------------------------
  // Periods (Indian financial year: April–March)
  // ---------------------------------------------------------------------------
  const PERIODS = [
    ['this-month', 'This month'], ['last-month', 'Last month'], ['last-3', 'Last 3 months'],
    ['this-fy', 'This financial year'], ['last-fy', 'Last financial year'], ['all', 'All time'], ['custom', 'Custom range'],
  ];

  function periodRange(st) {
    const p = st.period || 'this-month';
    const m = thisMonth();
    const y = Number(m.slice(0, 4));
    const fyStart = Number(m.slice(5)) >= 4 ? y : y - 1;
    switch (p) {
      case 'this-month': return { from: m + '-01', to: monthEnd(m) };
      case 'last-month': { const lm = addMonths(m, -1); return { from: lm + '-01', to: monthEnd(lm) }; }
      case 'last-3': return { from: addMonths(m, -2) + '-01', to: monthEnd(m) };
      case 'this-fy': return { from: fyStart + '-04-01', to: (fyStart + 1) + '-03-31' };
      case 'last-fy': return { from: (fyStart - 1) + '-04-01', to: fyStart + '-03-31' };
      case 'custom': return { from: st.from || '', to: st.to || '' };
      default: return { from: '', to: '' };
    }
  }

  function periodControls(page, def) {
    const st = ui(page);
    if (!st.period) st.period = def || 'this-month';
    let h = '<select class="input" data-filter="period" aria-label="Period">' +
      PERIODS.map((p) => '<option value="' + p[0] + '"' + (st.period === p[0] ? ' selected' : '') + '>' + p[1] + '</option>').join('') + '</select>';
    if (st.period === 'custom') {
      h += '<input class="input" type="date" data-filter="from" value="' + esc(st.from || '') + '" aria-label="From date">' +
        '<input class="input" type="date" data-filter="to" value="' + esc(st.to || '') + '" aria-label="To date">';
    }
    return h;
  }

  function selectFilter(page, key, label, options) {
    const v = ui(page)[key] || '';
    return '<select class="input" data-filter="' + key + '" aria-label="' + esc(label) + '"><option value="">' + esc(label) + '</option>' +
      options.map((o) => {
        const val = Array.isArray(o) ? o[0] : o;
        const txt = Array.isArray(o) ? o[1] : o;
        return '<option value="' + esc(val) + '"' + (v === val ? ' selected' : '') + '>' + esc(txt) + '</option>';
      }).join('') + '</select>';
  }

  function searchFilter(page, placeholder) {
    return '<input class="input search" type="search" data-filter="q" placeholder="' + esc(placeholder || 'Search…') + '" value="' + esc(ui(page).q || '') + '">';
  }

  function matchQ(page, ...vals) {
    const q = (ui(page).q || '').trim().toLowerCase();
    if (!q) return true;
    return vals.join(' ').toLowerCase().includes(q);
  }

  // ---------------------------------------------------------------------------
  // Table definitions (keep fields in sync with SCHEMA in apps-script/Code.gs)
  // ---------------------------------------------------------------------------
  const TABLES = {
    Clients: {
      title: 'Client',
      fields: [
        { k: 'name', l: 'Client name', t: 'text', req: true },
        { k: 'phone', l: 'Mobile', t: 'tel' },
        { k: 'email', l: 'Email', t: 'email' },
        { k: 'city', l: 'City / Area', t: 'text' },
        { k: 'siteAddress', l: 'Site address', t: 'textarea', full: true },
        { k: 'projectType', l: 'Project type', t: 'select', list: 'projectTypes' },
        { k: 'workScope', l: 'Work scope', t: 'text', hint: 'e.g. False ceiling + painting' },
        { k: 'estimateRef', l: 'Estimate no.', t: 'text' },
        { k: 'approvedAmount', l: 'Approved estimate (₹)', t: 'money', hint: 'Amount the client approved' },
        { k: 'startDate', l: 'Start date', t: 'date', def: today },
        { k: 'endDate', l: 'Completion date', t: 'date' },
        { k: 'status', l: 'Status', t: 'select', list: 'clientStatus', def: () => 'Ongoing' },
        { k: 'notes', l: 'Notes', t: 'textarea', full: true },
      ],
    },
    ClientWork: {
      title: 'Work entry',
      fields: [
        { k: 'date', l: 'Date', t: 'date', req: true, def: today },
        { k: 'clientId', l: 'Client', t: 'ref', ref: 'Clients', req: true },
        { k: 'costType', l: 'Cost type', t: 'select', list: 'costTypes', req: true, def: () => 'Labour' },
        { k: 'workType', l: 'Work type', t: 'select', list: 'workTypes' },
        { k: 'description', l: 'Description', t: 'text', full: true, hint: 'e.g. Gypsum board 12mm, ceiling labour 2nd floor' },
        { k: 'vendor', l: 'Vendor / Labour contractor', t: 'text' },
        { k: 'billNo', l: 'Bill / Invoice no.', t: 'text' },
        { k: 'qty', l: 'Quantity', t: 'number' },
        { k: 'unit', l: 'Unit', t: 'select', list: 'units' },
        { k: 'rate', l: 'Rate (₹)', t: 'money' },
        { k: 'amount', l: 'Amount (₹)', t: 'money', req: true, hint: 'Auto = quantity × rate' },
        { k: 'vendorPaid', l: 'Paid to vendor?', t: 'select', opts: ['Paid', 'Unpaid'], def: () => 'Paid' },
        { k: 'notes', l: 'Notes', t: 'textarea', full: true },
      ],
      onChange(f, key) {
        if ((key === 'qty' || key === 'rate') && f.get('qty') !== '' && f.get('rate') !== '') {
          f.set('amount', round2(num(f.get('qty')) * num(f.get('rate'))));
        }
      },
    },
    ClientPayments: {
      title: 'Client payment',
      fields: [
        { k: 'date', l: 'Date received', t: 'date', req: true, def: today },
        { k: 'clientId', l: 'Client', t: 'ref', ref: 'Clients', req: true },
        { k: 'amount', l: 'Amount (₹)', t: 'money', req: true },
        { k: 'mode', l: 'Payment mode', t: 'select', list: 'paymentModes', def: () => 'UPI' },
        { k: 'reference', l: 'Reference / UTR / Cheque no.', t: 'text', full: true },
        { k: 'notes', l: 'Notes', t: 'textarea', full: true },
      ],
    },
    OfficeExpenses: {
      title: 'Office expense',
      fields: [
        { k: 'date', l: 'Date', t: 'date', req: true, def: today },
        { k: 'category', l: 'Category', t: 'select', list: 'officeCategories', req: true },
        { k: 'amount', l: 'Amount (₹)', t: 'money', req: true },
        { k: 'mode', l: 'Payment mode', t: 'select', list: 'paymentModes', def: () => 'Cash' },
        { k: 'description', l: 'Description', t: 'text', full: true, hint: 'e.g. October rent, 10 water bottles' },
        { k: 'paidTo', l: 'Paid to', t: 'text' },
        { k: 'billNo', l: 'Bill no.', t: 'text' },
        { k: 'notes', l: 'Notes', t: 'textarea', full: true },
      ],
    },
    Employees: {
      title: 'Employee',
      fields: [
        { k: 'name', l: 'Full name', t: 'text', req: true },
        { k: 'designation', l: 'Designation', t: 'select', list: 'designations' },
        { k: 'phone', l: 'Mobile', t: 'tel' },
        { k: 'email', l: 'Email', t: 'email' },
        { k: 'joiningDate', l: 'Joining date', t: 'date' },
        { k: 'monthlySalary', l: 'Monthly salary (₹)', t: 'money', req: true },
        { k: 'perKmRate', l: 'Bike rate per km (₹)', t: 'money', hint: 'Leave blank to use company rate' },
        { k: 'status', l: 'Status', t: 'select', opts: ['Active', 'Inactive'], def: () => 'Active' },
        { k: 'bankDetails', l: 'Bank / UPI details', t: 'textarea', full: true },
        { k: 'notes', l: 'Notes', t: 'textarea', full: true },
      ],
    },
    EmployeeExpenses: {
      title: 'Employee expense',
      fields: [
        { k: 'date', l: 'Date', t: 'date', req: true, def: today },
        { k: 'employeeId', l: 'Employee', t: 'ref', ref: 'Employees', req: true },
        { k: 'expenseType', l: 'Expense type', t: 'select', list: 'expenseTypes', req: true },
        { k: 'clientId', l: 'Client / Site (optional)', t: 'ref', ref: 'Clients' },
        { k: 'fromTo', l: 'From → To', t: 'text', full: true, hint: 'e.g. Office → Sector 62 site → Office', show: (f) => isKmType(f.get('expenseType')) },
        { k: 'km', l: 'Distance (km)', t: 'number', show: (f) => isKmType(f.get('expenseType')) },
        { k: 'rate', l: 'Rate per km (₹)', t: 'money', show: (f) => isKmType(f.get('expenseType')) },
        { k: 'amount', l: 'Amount (₹)', t: 'money', req: true, readonly: (f) => isKmType(f.get('expenseType')) },
        { k: 'salaryMonth', l: 'Add to salary of', t: 'month', req: true, def: thisMonth, hint: 'Amount gets added to this month’s salary' },
        { k: 'notes', l: 'Notes', t: 'textarea', full: true },
      ],
      onChange(f, key) {
        const km = isKmType(f.get('expenseType'));
        if (km && (key === 'expenseType' || key === 'employeeId' || key === '__init') && f.get('rate') === '') {
          const e = byId('Employees', f.get('employeeId'));
          f.set('rate', num(e && e.perKmRate) || num(S.settings.company.perKmRate));
        }
        if (km) f.set('amount', round2(num(f.get('km')) * num(f.get('rate'))));
        if (key === 'date' && !f.touched('salaryMonth')) f.set('salaryMonth', monthOf(f.get('date')));
      },
      beforeSave(r) {
        if (!isKmType(r.expenseType)) { r.km = ''; r.rate = ''; r.fromTo = ''; }
      },
    },
    SalaryAdvances: {
      title: 'Salary advance',
      fields: [
        { k: 'date', l: 'Date given', t: 'date', req: true, def: today },
        { k: 'employeeId', l: 'Employee', t: 'ref', ref: 'Employees', req: true },
        { k: 'amount', l: 'Amount (₹)', t: 'money', req: true },
        { k: 'mode', l: 'Payment mode', t: 'select', list: 'paymentModes', def: () => 'Cash' },
        { k: 'salaryMonth', l: 'Deduct from salary of', t: 'month', req: true, def: thisMonth },
        { k: 'notes', l: 'Notes', t: 'textarea', full: true },
      ],
      onChange(f, key) {
        if (key === 'date' && !f.touched('salaryMonth')) f.set('salaryMonth', monthOf(f.get('date')));
      },
    },
    SalaryPayments: {
      title: 'Salary payment',
      fields: [
        { k: 'salaryMonth', l: 'Salary month', t: 'month', req: true, readonly: () => true },
        { k: 'employeeId', l: 'Employee', t: 'ref', ref: 'Employees', req: true, readonly: () => true },
        { k: 'baseSalary', l: 'Base salary (₹)', t: 'money' },
        { k: 'expenses', l: '+ Expenses (₹)', t: 'money', readonly: () => true },
        { k: 'advances', l: '− Advances (₹)', t: 'money', readonly: () => true },
        { k: 'deduction', l: '− Other deduction (₹)', t: 'money', hint: 'Leave / late / other' },
        { k: 'bonus', l: '+ Bonus / incentive (₹)', t: 'money' },
        { k: 'netPayable', l: 'Net payable (₹)', t: 'money', readonly: () => true },
        { k: 'paidAmount', l: 'Amount paid (₹)', t: 'money', req: true },
        { k: 'paidDate', l: 'Paid on', t: 'date', req: true, def: today },
        { k: 'mode', l: 'Payment mode', t: 'select', list: 'paymentModes', def: () => 'Bank Transfer' },
        { k: 'notes', l: 'Notes', t: 'textarea', full: true },
      ],
      onChange(f, key) {
        const net = round2(num(f.get('baseSalary')) + num(f.get('expenses')) - num(f.get('advances')) - num(f.get('deduction')) + num(f.get('bonus')));
        f.set('netPayable', net);
        if (!f.touched('paidAmount') && (key !== '__init' || f.get('paidAmount') === '')) f.set('paidAmount', net);
      },
    },
  };

  // ---------------------------------------------------------------------------
  // Calculations
  // ---------------------------------------------------------------------------
  function clientStats(c) {
    const work = rows('ClientWork').filter((w) => w.clientId === c.id);
    const pays = rows('ClientPayments').filter((p) => p.clientId === c.id);
    const labour = sum(work.filter((w) => w.costType === 'Labour'), 'amount');
    const material = sum(work.filter((w) => w.costType === 'Material'), 'amount');
    const cost = sum(work, 'amount');
    const received = sum(pays, 'amount');
    const approved = num(c.approvedAmount);
    return {
      work, pays, labour, material, other: cost - labour - material, cost, received, approved,
      due: approved - received, margin: approved - cost, cash: received - cost,
      unpaidVendor: sum(work.filter((w) => w.vendorPaid === 'Unpaid'), 'amount'),
    };
  }

  function salaryFor(emp, month) {
    const exp = rows('EmployeeExpenses').filter((x) => x.employeeId === emp.id && x.salaryMonth === month);
    const adv = rows('SalaryAdvances').filter((x) => x.employeeId === emp.id && x.salaryMonth === month);
    const pay = rows('SalaryPayments').find((x) => x.employeeId === emp.id && x.salaryMonth === month);
    const base = pay ? num(pay.baseSalary) : num(emp.monthlySalary);
    const expenses = sum(exp, 'amount');
    const advances = sum(adv, 'amount');
    const deduction = pay ? num(pay.deduction) : 0;
    const bonus = pay ? num(pay.bonus) : 0;
    const net = round2(base + expenses - advances - deduction + bonus);
    const paid = pay ? num(pay.paidAmount) : 0;
    return { emp, month, exp, adv, pay, base, expenses, advances, deduction, bonus, net, paid, balance: round2(net - paid) };
  }

  function salaryEmployees(month) {
    const end = monthEnd(month);
    return rows('Employees').filter((e) => {
      const hasRecords = ['EmployeeExpenses', 'SalaryAdvances', 'SalaryPayments'].some((t) => rows(t).some((x) => x.employeeId === e.id && x.salaryMonth === month));
      if (hasRecords) return true;
      if (e.status !== 'Active') return false;
      return !e.joiningDate || e.joiningDate <= end;
    });
  }

  function cashFlow(p) {
    const f = (t, k) => rows(t).filter((r) => inRange(r[k || 'date'], p));
    const received = sum(f('ClientPayments'), 'amount');
    const work = f('ClientWork');
    const labour = sum(work.filter((w) => w.costType === 'Labour'), 'amount');
    const material = sum(work.filter((w) => w.costType === 'Material'), 'amount');
    const workOther = sum(work, 'amount') - labour - material;
    const office = sum(f('OfficeExpenses'), 'amount');
    const advances = sum(f('SalaryAdvances'), 'amount');
    const salary = sum(f('SalaryPayments', 'paidDate'), 'paidAmount');
    const out = labour + material + workOther + office + advances + salary;
    return { received, labour, material, workOther, office, advances, salary, out, net: received - out };
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  async function api(action, payload) {
    const body = Object.assign({}, payload || {}, { action: action, token: S.token });
    let res;
    if (DEMO) {
      res = Demo.call(body);
    } else {
      if (!CFG.API_URL) throw new Error('API URL is not set in assets/js/config.js');
      let r;
      try {
        r = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
      } catch (e) {
        throw new Error('Could not reach the server. Check your internet, and that the Apps Script Web App is deployed with access "Anyone" and its URL is in config.js.');
      }
      if (!r.ok) throw new Error('Server error (' + r.status + ')');
      res = await r.json();
    }
    if (!res.ok) {
      const e = new Error(res.error || 'Request failed');
      e.code = res.code;
      if (res.code === 'AUTH' && action !== 'login') {
        clearSession();
        render();
      }
      throw e;
    }
    return res;
  }

  function clearSession() {
    S.token = null;
    S.user = null;
    S.data = {};
    S.sheet = null;
    S.autoSynced = false;
    S.est = null;
    S.estimates = [];
    S.attRows = {};
    S.attendanceToday = null;
    store.del('am_token');
  }

  async function loadAll() {
    const r = await api('bootstrap');
    S.user = r.user;
    S.settings = r.settings;
    S.data = r.data;
    S.users = r.users;
    S.estimates = r.estimates || [];
    S.attendanceToday = r.attendanceToday || null;
    S.me = r.me || { employee: null };
  }

  async function saveRecord(table, record) {
    const r = await api('save', { table: table, record: record });
    const arr = S.data[table] || (S.data[table] = []);
    const i = arr.findIndex((x) => x.id === r.record.id);
    if (i >= 0) arr[i] = r.record; else arr.push(r.record);
    return r.record;
  }

  async function removeRecord(table, id) {
    await api('remove', { table: table, id: id });
    S.data[table] = rows(table).filter((x) => x.id !== id);
  }

  // ---------------------------------------------------------------------------
  // Generic table
  // ---------------------------------------------------------------------------
  function dataTable(id, cols, data, opts) {
    opts = opts || {};
    const sort = (S.ui.sort || {})[id] || opts.sort;
    let list = data.slice();
    if (sort) {
      const col = cols.find((c) => c.k === sort.k);
      if (col) {
        const val = col.v || ((r) => r[col.k]);
        list.sort((a, b) => {
          const x = val(a);
          const y = val(b);
          const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true });
          return sort.dir === 'desc' ? -cmp : cmp;
        });
      }
    }
    S.tables[id] = { cols: cols, rows: list, name: opts.name || id };

    if (!list.length) return '<div class="empty">' + esc(opts.empty || 'No records yet') + '</div>';

    const actions = opts.actions && canWrite();
    let h = '<div class="table-wrap"><table class="data cards"><thead><tr>';
    cols.forEach((c) => {
      const arrow = sort && sort.k === c.k ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '';
      h += '<th class="' + (c.r ? 'r' : '') + '" data-act="sort" data-id="' + id + '" data-k="' + c.k + '">' + esc(c.l) + arrow + '</th>';
    });
    if (actions) h += '<th class="actions"></th>';
    h += '</tr></thead><tbody>';
    list.forEach((r) => {
      const click = opts.onRow ? ' class="clickable" data-act="' + opts.onRow + '" data-id="' + esc(r.id) + '"' : '';
      h += '<tr' + click + '>';
      cols.forEach((c) => {
        const cls = [c.r ? 'r num' : '', c.primary ? 'primary-cell' : ''].join(' ').trim();
        const content = c.f ? c.f(r) : esc(r[c.k]);
        h += '<td class="' + cls + '" data-label="' + esc(c.l) + '"><div>' + (content === '' ? '<span class="muted">—</span>' : content) + '</div></td>';
      });
      if (actions) {
        h += '<td class="actions">' + opts.actions(r) + '</td>';
      }
      h += '</tr>';
    });
    h += '</tbody>';
    if (cols.some((c) => c.total)) {
      h += '<tfoot><tr>';
      cols.forEach((c, i) => {
        let v = '';
        if (c.total) v = inr(sum(list, c.v || c.k));
        else if (i === 0) v = 'Total (' + list.length + ')';
        h += '<td class="' + (c.r ? 'r num' : '') + '" data-label="' + esc(c.l) + '">' + v + '</td>';
      });
      if (actions) h += '<td class="actions"></td>';
      h += '</tr></tfoot>';
    }
    return h + '</table></div>';
  }

  function rowActions(table, r) {
    return '<button class="btn ghost sm icon" title="Edit" data-act="edit" data-t="' + table + '" data-id="' + esc(r.id) + '">' + icon('edit') + '</button>' +
      '<button class="btn ghost sm icon danger" title="Delete" data-act="del" data-t="' + table + '" data-id="' + esc(r.id) + '">' + icon('trash') + '</button>';
  }

  function exportCsv(id) {
    const t = S.tables[id];
    if (!t) return;
    const strip = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); };
    const cell = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = [t.cols.map((c) => cell(c.l)).join(',')];
    t.rows.forEach((r) => {
      lines.push(t.cols.map((c) => {
        if (c.csv) return cell(c.csv(r));
        if (c.v) return cell(c.v(r));
        return cell(c.f ? strip(c.f(r)) : r[c.k]);
      }).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = t.name.replace(/[^\w-]+/g, '_') + '_' + today() + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const csvBtn = (id) => '<button class="btn sm" data-act="csv" data-id="' + id + '">' + icon('download') + 'Export</button>';
  const addBtn = (table, label, presets) => canWrite()
    ? '<button class="btn primary" data-act="add" data-t="' + table + '"' + (presets ? " data-presets='" + esc(JSON.stringify(presets)) + "'" : '') + '>' + icon('plus') + esc(label) + '</button>'
    : '';

  const kpi = (label, value, foot, cls) => '<div class="kpi ' + (cls || '') + '"><div class="label">' + esc(label) + '</div><div class="value num">' + value + '</div>' + (foot ? '<div class="foot">' + foot + '</div>' : '') + '</div>';

  function statusBadge(s) {
    const map = { Ongoing: 'accent', Completed: 'good', 'On Hold': 'warn', Cancelled: 'bad', Active: 'good', Inactive: '', Paid: 'good', Unpaid: 'warn', Pending: 'warn', Partial: 'warn', Present: 'good', Late: 'warn', 'Half Day': 'warn', Leave: '', Absent: 'bad', Holiday: '', Draft: '', Sent: 'accent', Approved: 'good', Rejected: 'bad', Admin: 'accent', Accountant: 'good', Staff: '' };
    return s ? '<span class="badge ' + (map[s] || '') + '">' + esc(s) + '</span>' : '';
  }

  // ---------------------------------------------------------------------------
  // Form modal
  // ---------------------------------------------------------------------------
  function openModal(title, bodyHtml, opts) {
    opts = opts || {};
    const root = $('#modal-root');
    root.innerHTML = '<div class="modal-back" data-act="modal-bg"><div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<form novalidate><div class="modal-head"><h2>' + esc(title) + '</h2><button type="button" class="btn ghost icon" data-act="modal-close" aria-label="Close">✕</button></div>' +
      '<div class="modal-body">' + bodyHtml + '<div class="form-error hidden" style="margin-top:14px"></div></div>' +
      '<div class="modal-foot">' + (opts.foot || '<button type="button" class="btn" data-act="modal-close">Cancel</button><button type="submit" class="btn primary">' + esc(opts.submit || 'Save') + '</button>') + '</div>' +
      '</form></div></div>';
    document.body.style.overflow = 'hidden';
    const form = $('form', root);
    if (opts.onSubmit) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const err = $('.form-error', form);
        err.classList.add('hidden');
        const btn = $('button[type=submit]', form);
        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = 'Saving…';
        try {
          await opts.onSubmit(form);
          closeModal();
        } catch (e) {
          err.textContent = e.message;
          err.classList.remove('hidden');
        } finally {
          btn.disabled = false;
          btn.textContent = label;
        }
      });
    }
    const first = $('input:not([readonly]):not([type=hidden]), select:not([disabled]), textarea', form);
    if (first && window.innerWidth > 640) first.focus();
    return form;
  }

  function closeModal() {
    $('#modal-root').innerHTML = '';
    document.body.style.overflow = '';
  }

  function refOptions(ref, current) {
    let items;
    if (ref === 'Clients') {
      items = rows('Clients').filter((c) => c.status !== 'Cancelled' || c.id === current)
        .sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.id, c.name + (c.clientCode ? ' · ' + c.clientCode : '')]);
    } else {
      items = rows('Employees').filter((e) => e.status === 'Active' || e.id === current)
        .sort((a, b) => a.name.localeCompare(b.name)).map((e) => [e.id, e.name + (e.designation ? ' · ' + e.designation : '')]);
    }
    return items;
  }

  function fieldHtml(fd, val) {
    const id = 'f_' + fd.k;
    const req = fd.req ? ' <span class="req">*</span>' : '';
    let input;
    const v = val === undefined || val === null ? '' : val;
    if (fd.t === 'select' || fd.t === 'ref') {
      let opts = fd.t === 'ref' ? refOptions(fd.ref, v) : (fd.opts || list(fd.list)).map((o) => [o, o]);
      if (v !== '' && !opts.some((o) => o[0] === v)) opts = opts.concat([[v, fd.t === 'ref' ? (clientName(v) || empName(v) || v) : v]]);
      input = '<select class="input" id="' + id + '" name="' + fd.k + '"><option value="">' + (fd.req ? 'Select…' : '—') + '</option>' +
        opts.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    } else if (fd.t === 'textarea') {
      input = '<textarea class="input" id="' + id + '" name="' + fd.k + '" rows="2">' + esc(v) + '</textarea>';
    } else {
      const type = { money: 'number', number: 'number', date: 'date', month: 'month', tel: 'tel', email: 'email' }[fd.t] || 'text';
      const extra = fd.t === 'money' || fd.t === 'number' ? ' step="any" inputmode="decimal"' : '';
      input = '<input class="input" id="' + id + '" name="' + fd.k + '" type="' + type + '" value="' + esc(v) + '"' + extra + '>';
    }
    return '<label class="field' + (fd.full ? ' full' : '') + '" data-field="' + fd.k + '" for="' + id + '"><span>' + esc(fd.l) + req + '</span>' + input +
      (fd.hint ? '<span class="field-hint">' + esc(fd.hint) + '</span>' : '') + '</label>';
  }

  function openForm(table, rec, presets, after) {
    const def = TABLES[table];
    const isNew = !rec;
    const r = {};
    def.fields.forEach((fd) => { if (isNew && fd.def) r[fd.k] = fd.def(); });
    Object.assign(r, presets || {}, rec || {});

    const body = '<div class="form-grid">' + def.fields.map((fd) => fieldHtml(fd, r[fd.k])).join('') + '</div>';
    const touched = new Set();
    let form;
    const api_ = {
      get: (k) => { const el = form.elements[k]; return el ? el.value : ''; },
      set: (k, v) => { const el = form.elements[k]; if (el && el.value !== String(v)) el.value = v; },
      touched: (k) => touched.has(k),
    };
    const refresh = (key) => {
      if (def.onChange) def.onChange(api_, key);
      def.fields.forEach((fd) => {
        const wrap = $('[data-field="' + fd.k + '"]', form);
        if (fd.show) wrap.classList.toggle('hidden', !fd.show(api_));
        const el = form.elements[fd.k];
        const ro = fd.readonly ? fd.readonly(api_) : false;
        if (el.tagName === 'SELECT') el.disabled = ro; else el.readOnly = ro;
      });
    };

    form = openModal((isNew ? 'Add ' : 'Edit ') + def.title.toLowerCase(), body, {
      submit: isNew ? 'Add' : 'Save changes',
      onSubmit: async () => {
        const out = isNew ? {} : { id: rec.id };
        def.fields.forEach((fd) => {
          let v = api_.get(fd.k).trim();
          if (fd.t === 'money' || fd.t === 'number') v = v === '' ? '' : Number(v);
          if (fd.show && !fd.show(api_)) v = '';
          out[fd.k] = v;
        });
        def.fields.forEach((fd) => {
          if (fd.req && (out[fd.k] === '' || out[fd.k] === undefined)) throw new Error(fd.l + ' is required');
          if ((fd.t === 'money' || fd.t === 'number') && out[fd.k] !== '' && !isFinite(out[fd.k])) throw new Error(fd.l + ' must be a number');
        });
        if ('amount' in out && out.amount !== '' && out.amount <= 0) throw new Error('Amount must be more than 0');
        if (def.beforeSave) def.beforeSave(out);
        const saved = await saveRecord(table, out);
        toast(def.title + (isNew ? ' added' : ' updated'));
        if (after) after(saved);
        renderPage();
      },
    });
    form.addEventListener('input', (e) => { if (e.target.name) { touched.add(e.target.name); refresh(e.target.name); } });
    form.addEventListener('change', (e) => { if (e.target.name) { touched.add(e.target.name); refresh(e.target.name); } });
    refresh('__init');
  }

  async function deleteRecord(table, id) {
    const def = TABLES[table];
    if (!confirm('Delete this ' + def.title.toLowerCase() + '? This cannot be undone.')) return;
    try {
      await removeRecord(table, id);
      toast(def.title + ' deleted');
      renderPage();
    } catch (e) {
      toast(e.message, true);
    }
  }

  function openSalaryPay(empId, month) {
    const emp = byId('Employees', empId);
    const s = salaryFor(emp, month);
    const presets = { salaryMonth: month, employeeId: empId, baseSalary: s.base, expenses: s.expenses, advances: s.advances };
    if (s.pay) openForm('SalaryPayments', Object.assign({}, s.pay, { expenses: s.expenses, advances: s.advances }));
    else openForm('SalaryPayments', null, presets);
  }

  // ---------------------------------------------------------------------------
  // Views: login & password
  // ---------------------------------------------------------------------------
  const LOGO = 'assets/img/logo.png';
  const LEGACY_LOGO = /res\.cloudinary\.com\/diosq0s7w/;
  const COMPANY = () => (S.settings && S.settings.company && S.settings.company.name) || CFG.COMPANY || 'Urbane Living';
  function logoUrl(absolute) {
    const custom = S.settings && S.settings.company && S.settings.company.logoUrl;
    const url = custom && !LEGACY_LOGO.test(custom) ? custom : LOGO;
    return absolute ? new URL(url, location.href).href : url;
  }
  function brand() {
    return '<div class="brand"><img class="brand-logo" src="' + esc(logoUrl()) + '" alt="' + esc(COMPANY()) + '" onerror="this.outerHTML=\'<div class=&quot;brand-name&quot;>' + esc(COMPANY()) + '</div>\'"></div>';
  }
  function avatar(u, size) {
    size = size || 34;
    const st = 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.38) + 'px';
    return u && u.photo ? '<img class="avatar" src="' + esc(u.photo) + '" alt="" style="' + st + ';object-fit:cover">' : '<div class="avatar" style="' + st + '">' + esc(initials(u && u.name)) + '</div>';
  }

  function renderLogin() {
    const notConfigured = !DEMO && !CFG.API_URL;
    $('#root').innerHTML = '<div class="login-wrap"><div class="login-card">' + brand() + '<h2 style="margin:18px 0 0">' + esc(COMPANY()) + '</h2><div class="muted">Sign in to your dashboard</div>' +
      '<form id="login-form" novalidate>' +
      '<label class="field">Email<input class="input" type="email" name="email" autocomplete="username" required placeholder="name@urbaneliving.in"></label>' +
      '<label class="field">Password<input class="input" type="password" name="password" autocomplete="current-password" required></label>' +
      '<div class="form-error hidden"></div>' +
      '<button class="btn primary" type="submit" style="height:42px"' + (notConfigured ? ' disabled' : '') + '>Log in</button>' +
      '</form>' +
      (notConfigured ? '<div class="notice"><b>Setup pending.</b> Deploy <code>apps-script/Code.gs</code> and paste the Web App URL into <code>assets/js/config.js</code>. To preview with sample data, open <a href="?demo=1">demo mode</a>.</div>' : '') +
      (DEMO ? '<div class="notice"><b>Demo mode</b> — sample data saved only in this browser. Log in with any member email (e.g. <code>accounts@urbaneliving.in</code>) and password <code>demo1234</code>.</div>' : '') +
      '</div></div>';
    const form = $('#login-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      const btn = $('button', form);
      err.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Logging in…';
      try {
        const r = await api('login', { email: form.email.value, password: form.password.value });
        S.token = r.token;
        store.set('am_token', r.token);
        await start();
      } catch (ex) {
        err.textContent = ex.message;
        err.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Log in';
      }
    });
  }

  function passwordForm(forced) {
    return '<form id="pw-form" novalidate style="display:flex;flex-direction:column;gap:14px;max-width:420px">' +
      (forced ? '<p class="muted" style="margin:0">Welcome, ' + esc(S.user.name) + '. Please set your own password to continue.</p>' : '') +
      '<label class="field">Current password<input class="input" type="password" name="old" autocomplete="current-password"></label>' +
      '<label class="field">New password<input class="input" type="password" name="new1" autocomplete="new-password"><span class="field-hint">At least 8 characters</span></label>' +
      '<label class="field">Confirm new password<input class="input" type="password" name="new2" autocomplete="new-password"></label>' +
      '<div class="form-error hidden"></div>' +
      '<div><button class="btn primary" type="submit">Update password</button></div></form>';
  }

  function bindPasswordForm(onDone) {
    const form = $('#pw-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      err.classList.add('hidden');
      try {
        if (form.new1.value.length < 8) throw new Error('New password must be at least 8 characters');
        if (form.new1.value !== form.new2.value) throw new Error('New passwords do not match');
        await api('changePassword', { oldPassword: form.old.value, newPassword: form.new1.value });
        S.user.mustChange = false;
        toast('Password updated');
        form.reset();
        if (onDone) onDone();
      } catch (ex) {
        err.textContent = ex.message;
        err.classList.remove('hidden');
      }
    });
  }

  function renderForcedPassword() {
    $('#root').innerHTML = '<div class="login-wrap"><div class="login-card">' + brand() + '<h2 style="margin:22px 0 12px">Set a new password</h2>' + passwordForm(true) +
      '<button class="btn ghost sm" style="margin-top:12px" data-act="logout">Log out</button></div></div>';
    bindPasswordForm(() => { render(); autoAttendance(); });
  }

  // ---------------------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------------------
  // [page, label, icon, accounts-only]
  const NAV = [
    ['dashboard', 'Dashboard', 'dashboard', true],
    ['me', 'My account', 'salary', false],
    ['estimates', 'Estimates', 'estimate', false],
    ['clients', 'Clients', 'clients', true],
    ['office', 'Office expenses', 'office', true],
    ['salary', 'Employees & salary', 'salary', true],
    ['expenses', 'Employee expenses', 'expenses', true],
    ['attendance', 'Attendance', 'attendance', false],
    ['sheet', 'Sheet data', 'sheet', true],
    ['settings', 'Settings', 'settings', false],
  ];
  const ACCOUNT_PAGES = ['dashboard', 'clients', 'office', 'salary', 'employees', 'expenses', 'sheet'];
  const homePage = () => (seesAccounts() ? 'dashboard' : 'me');

  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || (S.user ? homePage() : 'dashboard')).split('/');
    return { page: parts[0], id: parts[1] ? decodeURIComponent(parts[1]) : '' };
  }

  function renderShell() {
    const u = S.user;
    $('#root').innerHTML = '<div class="shell">' +
      '<aside class="sidebar">' + brand() + '<nav class="nav">' +
      NAV.filter((n) => !n[3] || seesAccounts()).map((n) => '<a href="#/' + n[0] + '" data-nav="' + n[0] + '">' + icon(n[2]) + '<span>' + n[1] + '</span></a>').join('') + '</nav>' +
      '<div class="side-user"><a href="#/me" title="My account">' + avatar(u) + '</a><div class="who"><div style="font-weight:600">' + esc(u.name) + '</div><div class="small muted">' + esc(u.role) + (DEMO ? ' · Demo' : '') + '</div></div>' +
      '<button class="btn ghost icon" title="Switch theme" data-act="theme">' + icon('moon') + '</button>' +
      '<button class="btn ghost icon" title="Log out" data-act="logout">' + icon('logout') + '</button></div>' +
      '</aside><div class="scrim" data-act="nav-close"></div>' +
      '<div class="main"><header class="topbar"><button class="btn ghost icon" data-act="nav-open" aria-label="Menu">' + icon('menu') + '</button>' + brand() + '</header>' +
      '<main class="content" id="page"></main></div></div>';
  }

  function renderPage() {
    const page = $('#page');
    if (!page) return;
    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.filter : null;
    const caret = focusKey && active.selectionStart !== undefined ? active.selectionStart : null;

    let r = route();
    if (ACCOUNT_PAGES.includes(r.page) && !seesAccounts()) { location.replace('#/' + homePage()); r = route(); }
    document.body.classList.remove('print-estimate');
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === r.page || (r.page === 'employees' && a.dataset.nav === 'salary')));
    const views = { dashboard: viewDashboard, clients: r.id ? viewClient : viewClients, office: viewOffice, salary: viewSalary, employees: viewEmployee, expenses: viewExpenses, sheet: viewSheet, settings: viewSettings, estimates: viewEstimates, attendance: viewAttendance, me: viewMe };
    const fn = views[r.page] || views[homePage()];
    try {
      page.innerHTML = fn(r.id);
    } catch (e) {
      console.error(e);
      page.innerHTML = '<div class="empty">Something went wrong: ' + esc(e.message) + '</div>';
    }
    if (fn.after) fn.after();

    if (focusKey) {
      const el = $('[data-filter="' + focusKey + '"]', page);
      if (el) {
        el.focus();
        if (caret !== null && el.setSelectionRange) try { el.setSelectionRange(caret, caret); } catch (e) { /* not a text input */ }
      }
    }
  }

  function pageHead(title, sub, actions) {
    return '<div class="page-head"><div><h1>' + title + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' +
      (actions ? '<div class="page-actions">' + actions + '</div>' : '') + '</div>';
  }

  function tabs(page, items, def) {
    const st = ui(page);
    if (!st.tab) st.tab = def || items[0][0];
    return '<div class="tabs" role="tablist">' + items.map((t) => '<button role="tab" data-act="tab" data-page="' + page + '" data-tab="' + t[0] + '" class="' + (st.tab === t[0] ? 'active' : '') + '">' + esc(t[1]) +
      (t[2] !== undefined ? '<span class="count">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  function viewDashboard() {
    const st = ui('dashboard');
    const p = periodRange(st);
    const cf = cashFlow(p);
    const clients = rows('Clients').filter((c) => c.status !== 'Cancelled').map((c) => Object.assign({ c: c }, clientStats(c)));
    const dues = sum(clients.filter((x) => x.due > 0), 'due');
    const m = thisMonth();
    const sal = salaryEmployees(m).map((e) => salaryFor(e, m));
    const salPending = sum(sal.filter((s) => s.balance > 0), 'balance');
    const periodLabel = (PERIODS.find((x) => x[0] === st.period) || [])[1];

    let h = pageHead('Dashboard', esc(periodLabel) + (p.from ? ' · ' + fmtDate(p.from) + ' – ' + fmtDate(p.to) : ''),
      '<button class="btn" data-act="reload">' + icon('refresh') + 'Refresh</button>');
    h += '<div class="filters">' + periodControls('dashboard') + '</div>';
    h += '<div class="kpis">' +
      kpi('Received from clients', inr(cf.received), plural(rows('ClientPayments').filter((r) => inRange(r.date, p)).length, 'payment')) +
      kpi('Total spent', inr(cf.out), 'Site work, office & salary') +
      kpi('Net cash flow', inr(cf.net), cf.net >= 0 ? 'More in than out' : 'More out than in', cf.net >= 0 ? 'good' : 'bad') +
      kpi('Client dues', inr(dues), clients.filter((x) => x.due > 0).length + ' clients still to pay', dues > 0 ? 'bad' : '') +
      kpi('Salary pending · ' + fmtMonth(m), inr(salPending), sal.filter((s) => s.balance > 0).length + ' employees') +
      '</div>';
    const ests = estLatestList().filter((r) => inRange(r.estimateDate, p));
    const activeUsers = S.users.filter((u) => u.status === 'Active').length;
    h += '<div class="kpis">' +
      '<a href="#/estimates" style="color:inherit">' + kpi('Estimates given', String(ests.length), inr(sum(ests, 'grandTotal')) + ' quoted') + '</a>' +
      kpi('Estimates approved', inr(sum(ests.filter((r) => r.status === 'Approved'), 'grandTotal')), plural(ests.filter((r) => r.status === 'Approved').length, 'estimate'), 'good') +
      (['Admin', 'Accountant'].includes(S.user.role) ? '<a href="#/attendance" style="color:inherit">' + kpi('In office today', (S.todayCount === undefined ? '…' : S.todayCount) + ' / ' + activeUsers, 'Members marked present') + '</a>' : '') +
      '</div>';

    h += '<div class="two-col">';
    h += '<div class="card"><div class="card-head"><h2>Money in vs money out</h2><div class="legend"><span><i style="background:var(--series-1)"></i>Received</span><span><i style="background:var(--series-2)"></i>Spent</span></div></div>' +
      '<div class="card-body"><div class="chart" id="flow-chart"></div><div class="small muted" style="margin-top:6px">Last 6 months up to ' + fmtMonth(p.to ? monthOf(p.to) > m ? m : monthOf(p.to) : m) + '</div></div></div>';

    const parts = [
      ['Labour (site)', cf.labour], ['Material (site)', cf.material], ['Other site costs', cf.workOther],
      ['Office expenses', cf.office], ['Salary paid', cf.salary], ['Advances given', cf.advances],
    ];
    const maxPart = Math.max.apply(null, parts.map((x) => x[1]).concat([1]));
    h += '<div class="card"><div class="card-head"><h2>Where the money went</h2></div><div class="card-body"><div style="display:flex;flex-direction:column;gap:12px">' +
      parts.map((x) => '<div><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px"><span>' + x[0] + '</span><span class="num" style="font-weight:600">' + inr(x[1]) + '</span></div>' +
        '<div style="height:8px;background:var(--surface-2);border-radius:4px;margin-top:5px;overflow:hidden"><div style="height:100%;width:' + (x[1] / maxPart * 100).toFixed(1) + '%;background:var(--series-2);border-radius:4px"></div></div></div>').join('') +
      '</div></div></div>';
    h += '</div>';

    const topDues = clients.filter((x) => x.due > 0).sort((a, b) => b.due - a.due).slice(0, 6);
    h += '<div class="two-col">';
    h += '<div class="card"><div class="card-head"><h2>Clients with pending payment</h2><a href="#/clients">All clients →</a></div><div class="card-body">' +
      dataTable('dash-dues', [
        { k: 'name', l: 'Client', primary: true, v: (x) => x.c.name, f: (x) => esc(x.c.name) + '<div class="cell-sub">' + esc(x.c.workScope || x.c.projectType || '') + '</div>' },
        { k: 'approved', l: 'Approved', r: true, v: (x) => x.approved, f: (x) => inr(x.approved) },
        { k: 'received', l: 'Received', r: true, v: (x) => x.received, f: (x) => inr(x.received) },
        { k: 'due', l: 'Due', r: true, v: (x) => x.due, f: (x) => '<b class="neg">' + inr(x.due) + '</b>' },
      ], topDues.map((x) => Object.assign({ id: x.c.id }, x)), { onRow: 'open-client', empty: 'No pending dues 🎉' }) + '</div></div>';

    const feed = [];
    rows('ClientPayments').forEach((r) => feed.push([r, 'Received', clientName(r.clientId), r.amount, 'pos']));
    rows('ClientWork').forEach((r) => feed.push([r, r.costType, clientName(r.clientId) + (r.description ? ' · ' + r.description : ''), r.amount, 'neg']));
    rows('OfficeExpenses').forEach((r) => feed.push([r, 'Office', r.category + (r.description ? ' · ' + r.description : ''), r.amount, 'neg']));
    rows('EmployeeExpenses').forEach((r) => feed.push([r, 'Emp. expense', empName(r.employeeId) + ' · ' + r.expenseType, r.amount, 'neg']));
    rows('SalaryAdvances').forEach((r) => feed.push([r, 'Advance', empName(r.employeeId), r.amount, 'neg']));
    rows('SalaryPayments').forEach((r) => feed.push([r, 'Salary', empName(r.employeeId) + ' · ' + fmtMonth(r.salaryMonth), r.paidAmount, 'neg']));
    feed.sort((a, b) => String(b[0].date || b[0].paidDate).localeCompare(String(a[0].date || a[0].paidDate)) || String(b[0].createdAt).localeCompare(String(a[0].createdAt)));
    h += '<div class="card"><div class="card-head"><h2>Recent entries</h2></div><div class="card-body">' +
      (feed.length ? '<div style="display:flex;flex-direction:column">' + feed.slice(0, 8).map((f) =>
        '<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)"><div style="min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span class="badge">' + esc(f[1]) + '</span> ' + esc(f[2]) + '</div>' +
        '<div class="cell-sub">' + esc(fmtDate(f[0].date || f[0].paidDate)) + ' · by ' + esc(userName(f[0].createdBy)) + '</div></div><div class="num ' + f[4] + '" style="font-weight:600">' + inr(f[3]) + '</div></div>').join('') + '</div>'
        : '<div class="empty">No entries yet</div>') + '</div></div>';
    h += '</div>';
    return h;
  }
  viewDashboard.after = function () {
    if (['Admin', 'Accountant'].includes(S.user.role) && S.todayFetched !== today()) {
      S.todayFetched = today();
      api('attendanceList', { from: today(), to: today() }).then((r) => {
        S.todayCount = r.rows.filter((x) => ['Present', 'Late', 'Half Day'].includes(x.status)).length;
        if (route().page === 'dashboard') renderPage();
      }).catch(() => { S.todayFetched = null; });
    }
    const st = ui('dashboard');
    const p = periodRange(st);
    const m = thisMonth();
    const endM = p.to && monthOf(p.to) < m ? monthOf(p.to) : m;
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(addMonths(endM, -i));
    const series = months.map((mm) => {
      const cf = cashFlow({ from: mm + '-01', to: monthEnd(mm) });
      return { m: mm, in: cf.received, out: cf.out };
    });
    drawFlowChart($('#flow-chart'), series);
  };

  function drawFlowChart(el, series) {
    if (!el) return;
    const W = Math.max(300, Math.round(el.clientWidth) || 640);
    const H = W < 500 ? 220 : 260;
    const padL = 48;
    const padB = 28;
    const padT = 10;
    const innerW = W - padL - 8;
    const innerH = H - padB - padT;
    const max = Math.max.apply(null, series.map((s) => Math.max(s.in, s.out)).concat([1]));
    const step = niceStep(max / 4);
    const top = Math.ceil(max / step) * step || 1;
    const y = (v) => padT + innerH - (v / top) * innerH;
    const group = innerW / series.length;
    const bw = Math.min(26, group * 0.3);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Monthly money received versus spent">';
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg += '<line class="grid-line" x1="' + padL + '" x2="' + (W - 8) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="axis-label" x="' + (padL - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + inrShort(v) + '</text>';
    }
    const bar = (x, v, cls) => {
      const h = Math.max(0, (v / top) * innerH);
      if (h < 0.5) return '';
      const r = Math.min(4, h);
      const yy = padT + innerH - h;
      return '<path class="' + cls + '" d="M' + x + ',' + (padT + innerH) + 'V' + (yy + r) + 'Q' + x + ',' + yy + ' ' + (x + r) + ',' + yy + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + yy + ' ' + (x + bw) + ',' + (yy + r) + 'V' + (padT + innerH) + 'Z"/>';
    };
    series.forEach((s, i) => {
      const cx = padL + group * i + group / 2;
      svg += bar(cx - bw - 1, s.in, 'bar-in') + bar(cx + 1, s.out, 'bar-out');
      svg += '<text class="axis-label" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + new Date(s.m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' }) + '</text>';
      svg += '<rect class="hit" data-i="' + i + '" x="' + (padL + group * i) + '" y="' + padT + '" width="' + group + '" height="' + innerH + '"/>';
    });
    svg += '</svg><div class="tooltip hidden"></div>';
    el.innerHTML = svg;
    const tip = $('.tooltip', el);
    const svgEl = $('svg', el);
    const show = (target) => {
      const s = series[Number(target.dataset.i)];
      tip.innerHTML = '<div style="font-weight:600;margin-bottom:4px">' + fmtMonth(s.m) + '</div>' +
        '<div class="row"><span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--series-1);margin-right:6px"></i>Received</span><b class="num">' + inr(s.in) + '</b></div>' +
        '<div class="row"><span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--series-2);margin-right:6px"></i>Spent</span><b class="num">' + inr(s.out) + '</b></div>' +
        '<div class="row" style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px"><span>Net</span><b class="num ' + (s.in - s.out >= 0 ? 'pos' : 'neg') + '">' + inr(s.in - s.out) + '</b></div>';
      tip.classList.remove('hidden');
      const box = el.getBoundingClientRect();
      const rb = target.getBoundingClientRect();
      const scale = svgEl.getBoundingClientRect().width / W;
      let left = rb.left - box.left + rb.width / 2 - tip.offsetWidth / 2;
      left = Math.max(0, Math.min(left, box.width - tip.offsetWidth));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(0, padT * scale - 4) + 'px';
    };
    $$('.hit', el).forEach((r) => {
      r.addEventListener('mouseenter', () => show(r));
      r.addEventListener('click', () => show(r));
      r.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    });
  }

  function niceStep(raw) {
    if (raw <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  // ---------------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------------
  function viewClients() {
    const st = ui('clients');
    const all = rows('Clients').map((c) => Object.assign({ id: c.id, c: c }, clientStats(c)));
    const filtered = all.filter((x) => (!st.status || x.c.status === st.status) && (!st.projectType || x.c.projectType === st.projectType) &&
      matchQ('clients', x.c.name, x.c.clientCode, x.c.phone, x.c.city, x.c.siteAddress, x.c.workScope, x.c.estimateRef));
    const active = filtered.filter((x) => x.c.status !== 'Cancelled');

    let h = pageHead('Clients', all.length + ' clients · ' + all.filter((x) => x.c.status === 'Ongoing').length + ' ongoing', csvBtn('clients') + addBtn('Clients', 'New client'));
    h += '<div class="kpis">' +
      kpi('Approved value', inr(sum(active, 'approved'))) +
      kpi('Received', inr(sum(active, 'received'))) +
      kpi('Due from clients', inr(sum(active.filter((x) => x.due > 0), 'due')), '', 'bad') +
      kpi('Site cost (labour + material)', inr(sum(active, 'cost'))) +
      '</div>';
    h += '<div class="filters">' + searchFilter('clients', 'Search name, code, phone, site…') +
      selectFilter('clients', 'status', 'All statuses', list('clientStatus')) +
      selectFilter('clients', 'projectType', 'All project types', list('projectTypes')) + '</div>';
    h += '<div class="card">' + dataTable('clients', [
      { k: 'name', l: 'Client', primary: true, v: (x) => x.c.name, f: (x) => '<b>' + esc(x.c.name) + '</b><div class="cell-sub">' + esc([x.c.clientCode, x.c.city, x.c.workScope].filter(Boolean).join(' · ')) + '</div>' },
      { k: 'status', l: 'Status', v: (x) => x.c.status, f: (x) => statusBadge(x.c.status) },
      { k: 'approved', l: 'Approved', r: true, total: true, v: (x) => x.approved, f: (x) => inr(x.approved) },
      { k: 'cost', l: 'Site cost', r: true, total: true, v: (x) => x.cost, f: (x) => inr(x.cost) },
      { k: 'received', l: 'Received', r: true, total: true, v: (x) => x.received, f: (x) => inr(x.received) },
      { k: 'due', l: 'Due', r: true, total: true, v: (x) => x.due, f: (x) => '<span class="' + (x.due > 0 ? 'neg' : '') + '">' + inr(x.due) + '</span>' },
    ], filtered, { onRow: 'open-client', name: 'Clients', sort: { k: 'name', dir: 'asc' }, empty: all.length ? 'No clients match the filters' : 'No clients yet — add your first client' }) + '</div>';
    return h;
  }

  function viewClient(id) {
    const c = byId('Clients', id);
    if (!c) return '<a class="back" href="#/clients">' + icon('back') + 'Clients</a><div class="empty">Client not found</div>';
    const s = clientStats(c);
    if (ui('client').id !== id) S.ui.client = { id: id, tab: 'work' };
    const st = ui('client');

    let h = '<a class="back no-print" href="#/clients">' + icon('back') + 'Clients</a>';
    h += '<div class="card" style="margin-bottom:16px"><div class="detail-head"><div><h1>' + esc(c.name) + ' ' + statusBadge(c.status) + '</h1><div class="detail-meta">' +
      [c.clientCode, c.phone && '📞 ' + c.phone, c.projectType, c.workScope, c.estimateRef && 'Estimate ' + c.estimateRef, c.startDate && 'Started ' + fmtDate(c.startDate)]
        .filter(Boolean).map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>' +
      (c.siteAddress ? '<div class="small muted" style="margin-top:6px">' + esc(c.siteAddress) + '</div>' : '') + '</div>' +
      '<div class="page-actions">' + (() => { const ev = c.estimateRef && estVersions(c.estimateRef); return ev && ev.length ? '<a class="btn" href="#/estimates/' + encodeURIComponent(ev[ev.length - 1].id) + '">' + icon('estimate') + 'Estimate</a>' : ''; })() +
      (canWrite() ? '<button class="btn" data-act="edit" data-t="Clients" data-id="' + esc(c.id) + '">' + icon('edit') + 'Edit</button>' : '') +
      '<button class="btn" data-act="print">' + icon('print') + 'Print</button></div></div></div>';

    h += '<div class="kpis">' +
      kpi('Approved estimate', inr(s.approved)) +
      kpi('Received', inr(s.received), plural(s.pays.length, 'payment'), 'good') +
      kpi('Due from client', inr(s.due), s.approved ? Math.round(s.received / s.approved * 100) + '% collected' : 'Set approved amount', s.due > 0 ? 'bad' : '') +
      kpi('Site cost', inr(s.cost), 'Labour ' + inr(s.labour) + ' · Material ' + inr(s.material)) +
      kpi('Margin', inr(s.margin), s.approved ? Math.round(s.margin / s.approved * 100) + '% of approved' : '', s.margin >= 0 ? 'good' : 'bad') +
      '</div>';

    const pre = { clientId: c.id };
    h += '<div class="page-actions" style="margin-bottom:12px">' + addBtn('ClientWork', 'Add labour / material', pre) + addBtn('ClientPayments', 'Add payment received', pre) + '</div>';
    h += tabs('client', [['work', 'Labour & material', s.work.length], ['payments', 'Payments received', s.pays.length], ['ledger', 'Statement']], 'work');

    if (st.tab === 'work') {
      const work = s.work.filter((w) => (!st.costType || w.costType === st.costType) && (!st.workType || w.workType === st.workType) &&
        matchQ('client', w.description, w.vendor, w.billNo, w.notes));
      h += '<div class="filters">' + searchFilter('client', 'Search description, vendor, bill…') + selectFilter('client', 'costType', 'All cost types', list('costTypes')) +
        selectFilter('client', 'workType', 'All work types', list('workTypes')) + csvBtn('client-work') + '</div>';
      h += '<div class="card">' + dataTable('client-work', [
        { k: 'date', l: 'Date', f: (r) => esc(fmtDate(r.date)), csv: (r) => r.date },
        { k: 'description', l: 'Description', primary: true, f: (r) => esc(r.description || r.workType || r.costType) + '<div class="cell-sub">' + esc([r.workType, r.vendor, r.billNo && 'Bill ' + r.billNo].filter(Boolean).join(' · ')) + '</div>' },
        { k: 'costType', l: 'Type', f: (r) => '<span class="badge">' + esc(r.costType) + '</span>' },
        { k: 'qty', l: 'Qty × Rate', r: true, f: (r) => r.qty ? esc(r.qty + ' ' + (r.unit || '')) + ' × ' + inr(r.rate) : '' },
        { k: 'vendorPaid', l: 'Vendor', f: (r) => statusBadge(r.vendorPaid) },
        { k: 'amount', l: 'Amount', r: true, total: true, v: (r) => num(r.amount), f: (r) => inr(r.amount) },
      ], work, { actions: (r) => rowActions('ClientWork', r), name: c.name + ' work', sort: { k: 'date', dir: 'desc' }, empty: 'No labour or material entries yet' }) + '</div>';
      if (s.unpaidVendor) h += '<p class="small muted">Unpaid to vendors: <b class="neg">' + inr(s.unpaidVendor) + '</b></p>';
    } else if (st.tab === 'payments') {
      h += '<div class="filters">' + csvBtn('client-pay') + '</div>';
      h += '<div class="card">' + dataTable('client-pay', [
        { k: 'date', l: 'Date', primary: true, f: (r) => esc(fmtDate(r.date)), csv: (r) => r.date },
        { k: 'mode', l: 'Mode', f: (r) => esc(r.mode) },
        { k: 'reference', l: 'Reference', f: (r) => esc(r.reference) + (r.notes ? '<div class="cell-sub">' + esc(r.notes) + '</div>' : '') },
        { k: 'amount', l: 'Amount', r: true, total: true, v: (r) => num(r.amount), f: (r) => '<span class="pos">' + inr(r.amount) + '</span>' },
      ], s.pays, { actions: (r) => rowActions('ClientPayments', r), name: c.name + ' payments', sort: { k: 'date', dir: 'desc' }, empty: 'No payments received yet' }) + '</div>';
    } else {
      const items = s.pays.map((p) => ({ id: p.id, date: p.date, what: 'Payment received' + (p.mode ? ' (' + p.mode + ')' : ''), sub: p.reference, inAmt: num(p.amount), outAmt: 0, at: p.createdAt }))
        .concat(s.work.map((w) => ({ id: w.id, date: w.date, what: w.costType + (w.description ? ' — ' + w.description : ''), sub: w.vendor, inAmt: 0, outAmt: num(w.amount), at: w.createdAt })))
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.at).localeCompare(String(b.at)));
      let bal = 0;
      items.forEach((i) => { bal += i.inAmt - i.outAmt; i.bal = bal; });
      h += '<div class="filters">' + csvBtn('client-ledger') + '</div>';
      h += '<div class="card">' + dataTable('client-ledger', [
        { k: 'date', l: 'Date', f: (r) => esc(fmtDate(r.date)), csv: (r) => r.date },
        { k: 'what', l: 'Particulars', primary: true, f: (r) => esc(r.what) + (r.sub ? '<div class="cell-sub">' + esc(r.sub) + '</div>' : '') },
        { k: 'inAmt', l: 'Received', r: true, total: true, v: (r) => r.inAmt, f: (r) => r.inAmt ? '<span class="pos">' + inr(r.inAmt) + '</span>' : '' },
        { k: 'outAmt', l: 'Spent', r: true, total: true, v: (r) => r.outAmt, f: (r) => r.outAmt ? inr(r.outAmt) : '' },
        { k: 'bal', l: 'Balance', r: true, v: (r) => r.bal, f: (r) => '<span class="' + (r.bal < 0 ? 'neg' : 'pos') + '">' + inr(r.bal) + '</span>' },
      ], items, { name: c.name + ' statement', empty: 'Nothing recorded for this client yet' }) + '</div>';
      h += '<p class="small muted">Balance = money received from the client minus money spent on this site so far.</p>';
    }
    return h;
  }

  // ---------------------------------------------------------------------------
  // Office expenses
  // ---------------------------------------------------------------------------
  function viewOffice() {
    const st = ui('office');
    const p = periodRange(st);
    const inPeriod = rows('OfficeExpenses').filter((r) => inRange(r.date, p));
    const filtered = inPeriod.filter((r) => (!st.category || r.category === st.category) && (!st.mode || r.mode === st.mode) &&
      matchQ('office', r.category, r.description, r.paidTo, r.billNo, r.notes));
    const byCat = {};
    inPeriod.forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + num(r.amount); });

    let h = pageHead('Office expenses', 'Rent, electricity, water, tea / coffee and other office spending', csvBtn('office') + addBtn('OfficeExpenses', 'Add expense'));
    h += '<div class="filters">' + periodControls('office') + searchFilter('office', 'Search…') +
      selectFilter('office', 'category', 'All categories', list('officeCategories')) + selectFilter('office', 'mode', 'All modes', list('paymentModes')) + '</div>';
    h += '<div class="chips"><div class="chip"><span class="k">Total</span><span class="v num">' + inr(sum(inPeriod, 'amount')) + '</span></div>' +
      Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]).map((k) => '<div class="chip"><span class="k">' + esc(k) + '</span><span class="v num">' + inr(byCat[k]) + '</span></div>').join('') + '</div>';
    h += '<div class="card">' + dataTable('office', [
      { k: 'date', l: 'Date', f: (r) => esc(fmtDate(r.date)), csv: (r) => r.date },
      { k: 'category', l: 'Category', primary: true, f: (r) => '<b>' + esc(r.category) + '</b>' + (r.description ? '<div class="cell-sub">' + esc(r.description) + '</div>' : '') },
      { k: 'paidTo', l: 'Paid to', f: (r) => esc(r.paidTo) + (r.billNo ? '<div class="cell-sub">Bill ' + esc(r.billNo) + '</div>' : '') },
      { k: 'mode', l: 'Mode', f: (r) => esc(r.mode) },
      { k: 'createdBy', l: 'Added by', f: (r) => esc(userName(r.createdBy)) },
      { k: 'amount', l: 'Amount', r: true, total: true, v: (r) => num(r.amount), f: (r) => inr(r.amount) },
    ], filtered, { actions: (r) => rowActions('OfficeExpenses', r), name: 'Office expenses', sort: { k: 'date', dir: 'desc' }, empty: 'No office expenses in this period' }) + '</div>';
    return h;
  }

  // ---------------------------------------------------------------------------
  // Employees & salary
  // ---------------------------------------------------------------------------
  function viewSalary() {
    const st = ui('salary');
    if (!st.month) st.month = thisMonth();
    const emps = rows('Employees');
    let h = pageHead('Employees & salary', 'Salary = base + expenses − advances − deductions + bonus',
      addBtn('Employees', 'Add employee') + (canWrite() ? '<button class="btn" data-act="add" data-t="SalaryAdvances">' + icon('plus') + 'Give advance</button>' : ''));
    h += tabs('salary', [['sheet', 'Salary sheet'], ['employees', 'Employees', emps.length], ['advances', 'Advances', rows('SalaryAdvances').length], ['history', 'Payment history', rows('SalaryPayments').length]], 'sheet');

    if (st.tab === 'sheet') {
      const sal = salaryEmployees(st.month).map((e) => Object.assign({ id: e.id }, salaryFor(e, st.month)));
      h += '<div class="filters"><input class="input" type="month" data-filter="month" value="' + esc(st.month) + '" aria-label="Salary month">' + csvBtn('salary-sheet') + '</div>';
      h += '<div class="kpis">' +
        kpi('Total payable', inr(sum(sal, 'net')), sal.length + ' employees') +
        kpi('Paid', inr(sum(sal, 'paid')), sal.filter((s) => s.pay).length + ' paid', 'good') +
        kpi('Pending', inr(sum(sal.filter((s) => s.balance > 0), 'balance')), sal.filter((s) => s.balance > 0).length + ' employees', 'bad') +
        kpi('Expenses added', inr(sum(sal, 'expenses'))) + kpi('Advances deducted', inr(sum(sal, 'advances'))) + '</div>';
      h += '<div class="card">' + dataTable('salary-sheet', [
        { k: 'name', l: 'Employee', primary: true, v: (s) => s.emp.name, f: (s) => '<a href="#/employees/' + encodeURIComponent(s.emp.id) + '"><b>' + esc(s.emp.name) + '</b></a><div class="cell-sub">' + esc(s.emp.designation || '') + '</div>' },
        { k: 'base', l: 'Base', r: true, total: true, v: (s) => s.base, f: (s) => inr(s.base) },
        { k: 'expenses', l: '+ Expenses', r: true, total: true, v: (s) => s.expenses, f: (s) => s.expenses ? '<span class="pos">' + inr(s.expenses) + '</span>' : '' },
        { k: 'advances', l: '− Advances', r: true, total: true, v: (s) => s.advances, f: (s) => s.advances ? '<span class="neg">' + inr(s.advances) + '</span>' : '' },
        { k: 'adj', l: '± Other', r: true, v: (s) => s.bonus - s.deduction, f: (s) => s.bonus - s.deduction ? inr(s.bonus - s.deduction) : '' },
        { k: 'net', l: 'Net payable', r: true, total: true, v: (s) => s.net, f: (s) => '<b>' + inr(s.net) + '</b>' },
        { k: 'paid', l: 'Paid', r: true, total: true, v: (s) => s.paid, f: (s) => s.pay ? inr(s.paid) + '<div class="cell-sub">' + esc(fmtDate(s.pay.paidDate)) + '</div>' : '' },
        { k: 'status', l: 'Status', v: (s) => (!s.pay ? 'Pending' : s.balance > 0 ? 'Partial' : 'Paid'), f: (s) => statusBadge(!s.pay ? 'Pending' : s.balance > 0.009 ? 'Partial' : 'Paid') + (s.pay && Math.abs(s.balance) > 0.009 ? '<div class="cell-sub">Bal ' + inr(s.balance) + '</div>' : '') },
      ], sal, {
        name: 'Salary ' + st.month,
        sort: { k: 'name', dir: 'asc' },
        empty: emps.length ? 'No active employees for this month' : 'Add employees to see the salary sheet',
        actions: (s) => '<button class="btn sm' + (s.pay ? '' : ' primary') + '" data-act="pay" data-id="' + esc(s.emp.id) + '" data-month="' + st.month + '">' + icon('pay') + (s.pay ? 'Edit' : 'Pay') + '</button>',
      }) + '</div>';
    } else if (st.tab === 'employees') {
      const list_ = emps.filter((e) => (!st.status || e.status === st.status) && matchQ('salary', e.name, e.empCode, e.designation, e.phone));
      const src = S.settings.employeeSource;
      h += '<div class="card" style="margin-bottom:12px"><div class="card-body" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">' +
        (src && src.tab
          ? '<div>' + icon('sheet') + ' Linked to sheet tab <a href="#/sheet" data-act="open-sheet-tab" data-id="' + esc(src.tab) + '"><b>' + esc(src.tab) + '</b></a>' +
            '<div class="small muted">' + (src.lastSync ? 'Last synced ' + esc(fmtStamp(src.lastSync)) + ' by ' + esc(userName(src.lastSyncBy)) : 'Not synced yet') + ' · new rows in the sheet become employees</div></div>' +
            (canWrite() ? '<div class="page-actions"><button class="btn" data-act="emp-link">Change link</button><button class="btn primary" data-act="emp-sync">' + icon('refresh') + 'Sync now</button></div>' : '')
          : '<div><b>Keep employees in a Google Sheet tab?</b><div class="small muted">Link a tab (e.g. your staff list) and its rows become employees here, kept in sync.</div></div>' +
            (canWrite() ? '<button class="btn" data-act="emp-link">' + icon('sheet') + 'Link sheet tab</button>' : '')) +
        '</div></div>';
      h += '<div class="filters">' + searchFilter('salary', 'Search employees…') + selectFilter('salary', 'status', 'All', ['Active', 'Inactive']) + csvBtn('employees') + '</div>';
      h += '<div class="card">' + dataTable('employees', [
        { k: 'name', l: 'Employee', primary: true, f: (e) => '<b>' + esc(e.name) + '</b><div class="cell-sub">' + esc([e.empCode, e.designation].filter(Boolean).join(' · ')) + '</div>' },
        { k: 'phone', l: 'Mobile', f: (e) => esc(e.phone) },
        { k: 'joiningDate', l: 'Joined', f: (e) => esc(fmtDate(e.joiningDate)), csv: (e) => e.joiningDate },
        { k: 'perKmRate', l: 'Per km', r: true, v: (e) => num(e.perKmRate) || num(S.settings.company.perKmRate), f: (e) => inr(num(e.perKmRate) || num(S.settings.company.perKmRate)) },
        { k: 'monthlySalary', l: 'Monthly salary', r: true, total: true, v: (e) => num(e.monthlySalary), f: (e) => inr(e.monthlySalary) },
        { k: 'status', l: 'Status', f: (e) => statusBadge(e.status) },
      ], list_, { onRow: 'open-emp', actions: (e) => rowActions('Employees', e), name: 'Employees', sort: { k: 'name', dir: 'asc' }, empty: 'No employees yet' }) + '</div>';
    } else if (st.tab === 'advances') {
      const adv = rows('SalaryAdvances').filter((a) => (!st.emp || a.employeeId === st.emp) && matchQ('salary', empName(a.employeeId), a.notes));
      h += '<div class="filters">' + searchFilter('salary', 'Search…') + selectFilter('salary', 'emp', 'All employees', emps.map((e) => [e.id, e.name])) + csvBtn('advances') + '</div>';
      h += '<div class="card">' + dataTable('advances', [
        { k: 'date', l: 'Date', f: (r) => esc(fmtDate(r.date)), csv: (r) => r.date },
        { k: 'employee', l: 'Employee', primary: true, v: (r) => empName(r.employeeId), f: (r) => '<b>' + esc(empName(r.employeeId)) + '</b>' + (r.notes ? '<div class="cell-sub">' + esc(r.notes) + '</div>' : '') },
        { k: 'salaryMonth', l: 'Deduct from', f: (r) => esc(fmtMonth(r.salaryMonth)), csv: (r) => r.salaryMonth },
        { k: 'mode', l: 'Mode', f: (r) => esc(r.mode) },
        { k: 'amount', l: 'Amount', r: true, total: true, v: (r) => num(r.amount), f: (r) => inr(r.amount) },
      ], adv, { actions: (r) => rowActions('SalaryAdvances', r), name: 'Advances', sort: { k: 'date', dir: 'desc' }, empty: 'No advances given' }) + '</div>';
    } else {
      const pays = rows('SalaryPayments').filter((r) => (!st.emp || r.employeeId === st.emp));
      h += '<div class="filters">' + selectFilter('salary', 'emp', 'All employees', emps.map((e) => [e.id, e.name])) + csvBtn('salary-history') + '</div>';
      h += '<div class="card">' + dataTable('salary-history', [
        { k: 'salaryMonth', l: 'Month', f: (r) => esc(fmtMonth(r.salaryMonth)), csv: (r) => r.salaryMonth },
        { k: 'employee', l: 'Employee', primary: true, v: (r) => empName(r.employeeId), f: (r) => '<b>' + esc(empName(r.employeeId)) + '</b>' },
        { k: 'netPayable', l: 'Net payable', r: true, total: true, v: (r) => num(r.netPayable), f: (r) => inr(r.netPayable) },
        { k: 'paidAmount', l: 'Paid', r: true, total: true, v: (r) => num(r.paidAmount), f: (r) => inr(r.paidAmount) },
        { k: 'paidDate', l: 'Paid on', f: (r) => esc(fmtDate(r.paidDate)) + '<div class="cell-sub">' + esc(r.mode) + '</div>', csv: (r) => r.paidDate },
      ], pays, { actions: (r) => rowActions('SalaryPayments', r), name: 'Salary payments', sort: { k: 'salaryMonth', dir: 'desc' }, empty: 'No salary paid yet' }) + '</div>';
    }
    return h;
  }

  viewSalary.after = function () {
    const src = S.settings.employeeSource;
    if (src && src.tab && canWrite() && !S.autoSynced) {
      S.autoSynced = true;
      syncEmployees(true).catch((e) => toast(e.message, true));
    }
  };

  function viewEmployee(id) {
    const e = byId('Employees', id);
    if (!e) return '<a class="back" href="#/salary">' + icon('back') + 'Employees & salary</a><div class="empty">Employee not found</div>';
    const st = ui('employee');
    if (st.id !== id) { S.ui.employee = { id: id, month: ui('salary').month || thisMonth() }; }
    const month = ui('employee').month;
    const s = salaryFor(e, month);
    const rate = num(e.perKmRate) || num(S.settings.company.perKmRate);

    let h = '<a class="back no-print" href="#/salary">' + icon('back') + 'Employees & salary</a>';
    h += '<div class="card" style="margin-bottom:16px"><div class="detail-head"><div><h1>' + esc(e.name) + ' ' + statusBadge(e.status) + '</h1><div class="detail-meta">' +
      [e.empCode, e.designation, e.phone && '📞 ' + e.phone, e.joiningDate && 'Joined ' + fmtDate(e.joiningDate), 'Salary ' + inr(e.monthlySalary) + '/month', 'Bike ' + inr(rate) + '/km']
        .filter(Boolean).map((x) => '<span>' + esc(x) + '</span>').join('') + '</div></div>' +
      '<div class="page-actions">' + (canWrite() ? '<button class="btn" data-act="edit" data-t="Employees" data-id="' + esc(e.id) + '">' + icon('edit') + 'Edit</button>' : '') +
      '<button class="btn" data-act="print">' + icon('print') + 'Print</button></div></div></div>';

    h += '<div class="filters"><input class="input" type="month" data-filter="month" value="' + esc(month) + '" aria-label="Month">' +
      addBtn('EmployeeExpenses', 'Add expense', { employeeId: e.id, salaryMonth: month }) + addBtn('SalaryAdvances', 'Give advance', { employeeId: e.id, salaryMonth: month }) + '</div>';

    const status = !s.pay ? 'Pending' : s.balance > 0.009 ? 'Partial' : 'Paid';
    h += '<div class="two-col"><div class="card"><div class="card-head"><h2>Salary slip · ' + esc(fmtMonth(month)) + '</h2>' + statusBadge(status) + '</div><div class="card-body"><div class="breakdown">' +
      '<span>Base salary</span><span class="num">' + inr(s.base) + '</span>' +
      '<span>+ Expenses (' + s.exp.length + ')</span><span class="num pos">' + inr(s.expenses) + '</span>' +
      '<span>− Advances (' + s.adv.length + ')</span><span class="num neg">' + inr(s.advances) + '</span>' +
      (s.deduction ? '<span>− Other deduction</span><span class="num neg">' + inr(s.deduction) + '</span>' : '') +
      (s.bonus ? '<span>+ Bonus / incentive</span><span class="num pos">' + inr(s.bonus) + '</span>' : '') +
      '<span class="total">Net payable</span><span class="total num">' + inr(s.net) + '</span>' +
      '<span>Paid' + (s.pay ? ' on ' + esc(fmtDate(s.pay.paidDate)) : '') + '</span><span class="num">' + inr(s.paid) + '</span>' +
      (s.pay && Math.abs(s.balance) > 0.009 ? '<span>Balance</span><span class="num neg">' + inr(s.balance) + '</span>' : '') +
      '</div>' + (canWrite() ? '<div style="margin-top:16px"><button class="btn ' + (s.pay ? '' : 'primary') + '" data-act="pay" data-id="' + esc(e.id) + '" data-month="' + month + '">' + icon('pay') + (s.pay ? 'Edit payment' : 'Pay salary') + '</button></div>' : '') +
      '</div></div>';

    const hist = [];
    for (let i = 0; i < 12; i++) {
      const m = addMonths(thisMonth(), -i);
      if (e.joiningDate && monthEnd(m) < e.joiningDate) break;
      hist.push(Object.assign({ id: m }, salaryFor(e, m)));
    }
    h += '<div class="card"><div class="card-head"><h2>Last 12 months</h2></div><div class="card-body">' + dataTable('emp-hist', [
      { k: 'month', l: 'Month', primary: true, f: (x) => esc(fmtMonth(x.month)) },
      { k: 'net', l: 'Net', r: true, v: (x) => x.net, f: (x) => inr(x.net) },
      { k: 'paid', l: 'Paid', r: true, v: (x) => x.paid, f: (x) => x.pay ? inr(x.paid) : statusBadge('Pending') },
    ], hist, { onRow: 'emp-month' }) + '</div></div></div>';

    h += '<h2 style="margin:8px 0 10px">Expenses · ' + esc(fmtMonth(month)) + '</h2>';
    h += '<div class="card" style="margin-bottom:16px">' + dataTable('emp-exp', [
      { k: 'date', l: 'Date', f: (r) => esc(fmtDate(r.date)) },
      { k: 'expenseType', l: 'Expense', primary: true, f: (r) => '<b>' + esc(r.expenseType) + '</b><div class="cell-sub">' + esc([r.fromTo, r.clientId && clientName(r.clientId), r.notes].filter(Boolean).join(' · ')) + '</div>' },
      { k: 'km', l: 'Km × rate', r: true, f: (r) => r.km ? esc(r.km) + ' km × ' + inr(r.rate) : '' },
      { k: 'amount', l: 'Amount', r: true, total: true, v: (r) => num(r.amount), f: (r) => inr(r.amount) },
    ], s.exp, { actions: (r) => rowActions('EmployeeExpenses', r), sort: { k: 'date', dir: 'asc' }, empty: 'No expenses this month' }) + '</div>';
    h += '<h2 style="margin:8px 0 10px">Advances · ' + esc(fmtMonth(month)) + '</h2>';
    h += '<div class="card">' + dataTable('emp-adv', [
      { k: 'date', l: 'Date', primary: true, f: (r) => esc(fmtDate(r.date)) },
      { k: 'mode', l: 'Mode', f: (r) => esc(r.mode) + (r.notes ? '<div class="cell-sub">' + esc(r.notes) + '</div>' : '') },
      { k: 'amount', l: 'Amount', r: true, total: true, v: (r) => num(r.amount), f: (r) => inr(r.amount) },
    ], s.adv, { actions: (r) => rowActions('SalaryAdvances', r), sort: { k: 'date', dir: 'asc' }, empty: 'No advances this month' }) + '</div>';
    return h;
  }

  // ---------------------------------------------------------------------------
  // Employee expenses
  // ---------------------------------------------------------------------------
  function viewExpenses() {
    const st = ui('expenses');
    const p = periodRange(st);
    const inPeriod = rows('EmployeeExpenses').filter((r) => inRange(r.date, p));
    const filtered = inPeriod.filter((r) => (!st.emp || r.employeeId === st.emp) && (!st.type || r.expenseType === st.type) &&
      matchQ('expenses', empName(r.employeeId), r.expenseType, r.fromTo, clientName(r.clientId), r.notes));
    const byType = {};
    filtered.forEach((r) => { byType[r.expenseType] = (byType[r.expenseType] || 0) + num(r.amount); });
    const kmTotal = sum(filtered, 'km');

    let h = pageHead('Employee expenses', 'Travel (₹' + esc(num(S.settings.company.perKmRate)) + '/km by bike), fuel, food and other spending — added to salary', csvBtn('expenses') + addBtn('EmployeeExpenses', 'Add expense'));
    h += '<div class="filters">' + periodControls('expenses') + searchFilter('expenses', 'Search…') +
      selectFilter('expenses', 'emp', 'All employees', rows('Employees').map((e) => [e.id, e.name])) +
      selectFilter('expenses', 'type', 'All types', list('expenseTypes')) + '</div>';
    h += '<div class="chips"><div class="chip"><span class="k">Total</span><span class="v num">' + inr(sum(filtered, 'amount')) + '</span></div>' +
      (kmTotal ? '<div class="chip"><span class="k">Distance travelled</span><span class="v num">' + kmTotal.toLocaleString('en-IN') + ' km</span></div>' : '') +
      Object.keys(byType).sort((a, b) => byType[b] - byType[a]).map((k) => '<div class="chip"><span class="k">' + esc(k) + '</span><span class="v num">' + inr(byType[k]) + '</span></div>').join('') + '</div>';
    h += '<div class="card">' + dataTable('expenses', [
      { k: 'date', l: 'Date', f: (r) => esc(fmtDate(r.date)), csv: (r) => r.date },
      { k: 'employee', l: 'Employee', primary: true, v: (r) => empName(r.employeeId), f: (r) => '<b>' + esc(empName(r.employeeId)) + '</b><div class="cell-sub">' + esc(r.expenseType) + '</div>' },
      { k: 'details', l: 'Details', v: (r) => r.fromTo || r.notes, f: (r) => esc([r.fromTo, r.clientId && 'Site: ' + clientName(r.clientId)].filter(Boolean).join(' · ')) + (r.notes ? '<div class="cell-sub">' + esc(r.notes) + '</div>' : '') },
      { k: 'km', l: 'Km × rate', r: true, v: (r) => num(r.km), f: (r) => r.km ? esc(r.km) + ' × ' + inr(r.rate) : '' },
      { k: 'salaryMonth', l: 'Salary month', f: (r) => esc(fmtMonth(r.salaryMonth)), csv: (r) => r.salaryMonth },
      { k: 'amount', l: 'Amount', r: true, total: true, v: (r) => num(r.amount), f: (r) => inr(r.amount) },
    ], filtered, { actions: (r) => rowActions('EmployeeExpenses', r), name: 'Employee expenses', sort: { k: 'date', dir: 'desc' }, empty: 'No employee expenses in this period' }) + '</div>';
    return h;
  }

  // ---------------------------------------------------------------------------
  // Sheet data — read-only view of the spreadsheet's other tabs
  // ---------------------------------------------------------------------------
  const cellNum = (v) => {
    const t = String(v).replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '');
    return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  };

  const colLetter = (j) => { let n = j + 1; let out = ''; while (n) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); } return out; };
  const filledCell = (v) => String(v === undefined || v === null ? '' : v).trim() !== '';

  // Turn raw tab values into header + records, remembering real sheet row numbers.
  function parseTab(rows) {
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const nonEmpty = (r) => r.some(filledCell);
    const usedCols = [];
    for (let j = 0; j < width; j++) if (rows.some((r) => filledCell(r[j]))) usedCols.push(j);
    const hi = rows.findIndex((r) => nonEmpty(r) && usedCols.filter((j) => filledCell(r[j])).length >= Math.min(2, usedCols.length));
    if (hi < 0) return { width: width, usedCols: [], headerRow: 0, header: [], title: '', records: [], label: () => '' };
    const header = rows[hi];
    const label = (j) => String(header[j] || '').trim() || 'Column ' + colLetter(j);
    const records = [];
    for (let i = hi + 1; i < rows.length; i++) if (nonEmpty(rows[i])) records.push({ id: String(i + 1), rowNum: i + 1, raw: rows[i] });
    return {
      width: width, usedCols: usedCols, headerRow: hi + 1, header: header, label: label, records: records,
      title: rows.slice(0, hi).filter(nonEmpty).map((r) => r.filter(filledCell).join(' ')).join(' · '),
    };
  }

  function loadSheetTab(name, after) {
    S.sheet = Object.assign(S.sheet || {}, { loading: true, error: '' });
    renderPage();
    return api('sheetTabs', { name: name || '' }).then((r) => {
      S.sheet = { tabs: r.tabs, name: r.name, rows: r.rows, loading: false, error: '' };
      if (after) after();
      renderPage();
    }).catch((e) => {
      S.sheet = Object.assign(S.sheet || {}, { loading: false, error: e.message });
      renderPage();
    });
  }

  const isLinkedTab = (name) => S.settings && S.settings.employeeSource && S.settings.employeeSource.tab === name;

  function viewSheet() {
    const sh = S.sheet;
    const hiddenTabs = (S.settings && S.settings.hiddenTabs) || [];
    const isHidden = sh && hiddenTabs.includes(sh.name);
    let h = pageHead('Sheet data', 'All other tabs of the Google Sheet — view, add, edit and delete rows',
      (isAdmin() && sh && sh.name ? '<button class="btn" data-act="sheet-hide">' + (isHidden ? 'Show to everyone' : 'Hide from non-admins') + '</button>' : '') +
      '<button class="btn" data-act="sheet-reload">' + icon('refresh') + 'Refresh</button>');
    if (!sh || (sh.loading && !sh.tabs)) {
      return h + '<div class="loading" style="min-height:200px"><div class="spinner"></div><div>Reading the sheet…</div></div>';
    }
    if (sh.error && !sh.tabs) {
      const old = /Unknown action/.test(sh.error);
      return h + '<div class="card"><div class="card-body"><div class="form-error">' + esc(sh.error) + '</div>' +
        (old ? '<p class="muted">The Apps Script code is older than this page. Paste the latest <code>Code.gs</code> and deploy a <b>New version</b>.</p>' : '') + '</div></div>';
    }
    if (!sh.tabs.length) return h + '<div class="card"><div class="empty">The sheet has no other tabs besides the app’s own tabs. Add a tab in Google Sheets and press Refresh.</div></div>';

    h += '<div class="tab-pills" role="tablist">' + sh.tabs.map((t) => '<button role="tab" title="' + esc(t) + '" data-act="sheet-tab" data-id="' + esc(t) + '" class="' + (t === sh.name ? 'active' : '') + '">' + esc(t) +
      (isLinkedTab(t) ? ' · Employees' : '') + (hiddenTabs.includes(t) ? ' 🔒' : '') + '</button>').join('') + '</div>' +
      '<label class="field tab-pick">Sheet tab (' + sh.tabs.length + ')<select class="input" data-act-change="sheet-tab">' +
      sh.tabs.map((t) => '<option' + (t === sh.name ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label>';
    if (sh.loading) return h + '<div class="loading" style="min-height:200px"><div class="spinner"></div></div>';
    if (sh.error) h += '<div class="form-error" style="margin-bottom:12px">' + esc(sh.error) + '</div>';

    const t = parseTab(sh.rows);
    if (isHidden) h += '<div class="notice" style="margin:0 0 12px">🔒 Hidden: only Admins can see this tab.</div>';
    if (isLinkedTab(sh.name)) {
      h += '<div class="notice" style="margin:0 0 12px">This tab is linked to <a href="#/salary"><b>Employees &amp; salary</b></a>. Rows you add or edit here are synced to the employee list automatically.</div>';
    }
    if (!t.usedCols.length) {
      return h + '<div class="card"><div class="empty">This tab is empty.' + (canWrite() ? ' Add columns to create the header row.<div style="margin-top:12px"><button class="btn primary" data-act="sheet-addcol">' + icon('plus') + 'Add column</button></div>' : '') + '</div></div>';
    }
    const cols = t.usedCols.map((j, n) => {
      const k = 'c' + j;
      const vals = t.records.map((r) => r.raw[j]).filter(filledCell);
      const numeric = vals.length > 0 && vals.filter((v) => cellNum(v) !== null).length / vals.length >= 0.8;
      const lbl = t.label(j);
      const isPhone = /phone|mobile|contact|number/i.test(lbl);
      const money = numeric && !isPhone && !/id|code|no\.?$|qty|quantity|km/i.test(lbl);
      return {
        k: k, l: lbl, r: numeric && !isPhone, primary: n === 0,
        v: (r) => (numeric && !isPhone ? (cellNum(r.raw[j]) || 0) : String(r.raw[j] || '')),
        f: (r) => esc(r.raw[j]),
        total: money && vals.length > 1,
        csv: (r) => r.raw[j],
      };
    });
    const list_ = t.records.filter((r) => matchQ('sheet', ...t.usedCols.map((j) => r.raw[j])));
    h += (t.title ? '<p class="muted" style="margin-top:0">' + esc(t.title) + '</p>' : '');
    h += '<div class="filters">' + searchFilter('sheet', 'Search in ' + sh.name + '…') + '<span class="muted small">' + list_.length + ' of ' + t.records.length + ' rows</span>' +
      csvBtn('sheet-tab') + (canWrite() ? '<button class="btn sm" data-act="sheet-addcol">' + icon('plus') + 'Column</button><button class="btn primary" data-act="sheet-add">' + icon('plus') + 'Add row</button>' : '') + '</div>';
    h += '<div class="card">' + dataTable('sheet-tab', cols, list_, {
      name: sh.name,
      empty: t.records.length ? 'No rows match the search' : 'No rows yet',
      actions: (r) => '<button class="btn ghost sm icon" title="Edit" data-act="sheet-edit" data-id="' + r.rowNum + '">' + icon('edit') + '</button>' +
        '<button class="btn ghost sm icon danger" title="Delete" data-act="sheet-del" data-id="' + r.rowNum + '">' + icon('trash') + '</button>',
    }) + '</div>';
    h += '<p class="small muted">Changes are written straight to the "' + esc(sh.name) + '" tab of the Google Sheet. Row numbers refer to the sheet.</p>';
    return h;
  }
  viewSheet.after = function () {
    if (!S.sheet) loadSheetTab('');
  };

  function afterSheetChange() {
    const name = S.sheet.name;
    return loadSheetTab(name).then(() => {
      if (isLinkedTab(name)) return syncEmployees(true).catch((e) => toast(e.message, true));
    });
  }

  function openSheetRow(rowNum) {
    const sh = S.sheet;
    const t = parseTab(sh.rows);
    const rec = rowNum ? t.records.find((r) => r.rowNum === rowNum) : null;
    const width = Math.max(t.width, t.usedCols.length ? t.usedCols[t.usedCols.length - 1] + 1 : 0);
    const raw = rec ? rec.raw : new Array(width).fill('');
    const body = '<div class="form-grid">' + t.usedCols.map((j) => {
      const long = String(raw[j] || '').length > 40;
      return '<label class="field' + (long ? ' full' : '') + '">' + esc(t.label(j)) +
        (long ? '<textarea class="input" name="c' + j + '" rows="2">' + esc(raw[j]) + '</textarea>' : '<input class="input" name="c' + j + '" value="' + esc(raw[j]) + '">') + '</label>';
    }).join('') + '</div>' + (rec ? '<p class="small muted" style="margin-bottom:0">Sheet row ' + rec.rowNum + '</p>' : '');
    openModal((rec ? 'Edit row · ' : 'Add row · ') + sh.name, body, {
      submit: rec ? 'Save changes' : 'Add row',
      onSubmit: async (form) => {
        const values = raw.slice();
        while (values.length < width) values.push('');
        t.usedCols.forEach((j) => { values[j] = form.elements['c' + j].value.trim(); });
        await api('sheetRowSave', { name: sh.name, row: rec ? rec.rowNum : 0, values: values, original: rec ? rec.raw : null });
        toast(rec ? 'Row updated' : 'Row added');
        await afterSheetChange();
      },
    });
  }

  async function deleteSheetRow(rowNum) {
    const sh = S.sheet;
    const rec = parseTab(sh.rows).records.find((r) => r.rowNum === rowNum);
    if (!rec || !confirm('Delete row ' + rowNum + ' from "' + sh.name + '"? This cannot be undone.')) return;
    try {
      await api('sheetRowDelete', { name: sh.name, row: rowNum, original: rec.raw });
      toast('Row deleted');
      await afterSheetChange();
    } catch (e) { toast(e.message, true); }
  }

  function openAddColumn() {
    const sh = S.sheet;
    const t = parseTab(sh.rows);
    openModal('Add column · ' + sh.name, '<label class="field">Column name<input class="input" name="label" placeholder="e.g. Salary"></label>', {
      submit: 'Add column',
      onSubmit: async (form) => {
        await api('sheetAddColumn', { name: sh.name, headerRow: t.headerRow || 1, label: form.label.value });
        toast('Column added');
        await loadSheetTab(sh.name);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Employees ← linked sheet tab
  // ---------------------------------------------------------------------------
  const EMP_FIELDS = [
    ['name', 'Name', /name/i], ['designation', 'Designation', /designation|post|role|position/i], ['phone', 'Mobile', /mobile|phone|contact/i],
    ['email', 'Email', /mail/i], ['monthlySalary', 'Monthly salary', /salary|ctc|pay/i], ['joiningDate', 'Joining date', /join|doj/i],
    ['perKmRate', 'Rate per km', /km/i], ['bankDetails', 'Bank / UPI', /bank|upi|account|ifsc/i], ['status', 'Status (Active / Inactive)', /status|active/i],
  ];

  function toIsoDate(v) {
    v = String(v || '').trim();
    if (!v) return '';
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    m = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad(m[2]) + '-' + pad(m[1]);
    const d = new Date(v);
    return isNaN(d) ? '' : isoDate(d);
  }

  async function syncEmployees(silent) {
    const src = S.settings.employeeSource;
    if (!src || !src.tab || !canWrite()) return;
    const r = await api('sheetTabs', { name: src.tab });
    if (r.name !== src.tab) throw new Error('Linked tab "' + src.tab + '" was not found in the sheet. Link another tab.');
    const t = parseTab(r.rows);
    const colOf = (lbl) => t.usedCols.find((j) => t.label(j) === lbl);
    const records = t.records.map((rec) => {
      const o = {};
      Object.keys(src.map).forEach((f) => {
        const j = colOf(src.map[f]);
        if (j === undefined) return;
        let v = String(rec.raw[j] === undefined ? '' : rec.raw[j]).trim();
        if (f === 'monthlySalary' || f === 'perKmRate') { const n = cellNum(v); v = n === null ? '' : n; }
        else if (f === 'joiningDate') v = toIsoDate(v);
        else if (f === 'email') v = v.toLowerCase();
        else if (f === 'status') v = v ? (/inactive|left|resign|^no$/i.test(v) ? 'Inactive' : 'Active') : '';
        o[f] = v;
      });
      return o;
    }).filter((o) => o.name);
    const res = await api('importEmployees', { records: records, source: src.tab });
    S.data.Employees = res.records;
    S.settings = res.settings;
    if (!silent || res.created || res.updated) toast('Synced from "' + src.tab + '": ' + res.created + ' added, ' + res.updated + ' updated');
    renderPage();
  }

  async function openEmployeeLink() {
    let tabsRes;
    try { tabsRes = await api('sheetTabs', { name: (S.settings.employeeSource || {}).tab || '' }); } catch (e) { return toast(e.message, true); }
    if (!tabsRes.tabs.length) return toast('The sheet has no other tabs to link. Add one in Google Sheets first.', true);
    const cur = S.settings.employeeSource || {};
    const cache = {};
    cache[tabsRes.name] = tabsRes.rows;

    const mappingHtml = (tab) => {
      const t = parseTab(cache[tab] || []);
      const labels = t.usedCols.map((j) => t.label(j));
      const keep = cur.tab === tab ? cur.map || {} : {};
      return '<p class="small muted" style="margin:0 0 12px">' + t.records.length + ' rows found in "' + esc(tab) + '". Choose which column holds each detail.</p><div class="form-grid">' +
        EMP_FIELDS.map((f) => {
          const guess = keep[f[0]] || labels.find((l) => f[2].test(l) && !(f[0] === 'name' && /mail/i.test(l))) || '';
          return '<label class="field">' + esc(f[1]) + (f[0] === 'name' ? ' <span class="req">*</span>' : '') + '<select class="input" name="m_' + f[0] + '"><option value="">— not in sheet —</option>' +
            labels.map((l) => '<option' + (l === guess ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>';
        }).join('') + '</div>';
    };

    const form = openModal('Link employees to a sheet tab', '<label class="field">Sheet tab<select class="input" name="tab">' +
      tabsRes.tabs.map((t) => '<option' + (t === tabsRes.name ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label>' +
      '<div id="emp-map" style="margin-top:16px">' + mappingHtml(tabsRes.name) + '</div>' +
      '<p class="small muted">Employees are matched by email, then mobile, then name. Blank cells never erase details already in the app. Salary, advances and expenses stay in the app.</p>', {
      wide: true,
      submit: 'Link & sync',
      foot: (cur.tab ? '<button type="button" class="btn danger" data-act="emp-unlink" style="margin-right:auto">Unlink</button>' : '') +
        '<button type="button" class="btn" data-act="modal-close">Cancel</button><button type="submit" class="btn primary">Link &amp; sync</button>',
      onSubmit: async (f) => {
        const map = {};
        EMP_FIELDS.forEach((x) => { if (f.elements['m_' + x[0]].value) map[x[0]] = f.elements['m_' + x[0]].value; });
        if (!map.name) throw new Error('Choose which column has the employee name');
        const r = await api('saveSettings', { settings: { employeeSource: { tab: f.tab.value, map: map } } });
        S.settings = r.settings;
        await syncEmployees(false);
      },
    });
    form.tab.addEventListener('change', async () => {
      const tab = form.tab.value;
      $('#emp-map').innerHTML = '<div class="loading" style="min-height:120px"><div class="spinner"></div></div>';
      try {
        if (!cache[tab]) cache[tab] = (await api('sheetTabs', { name: tab })).rows;
        $('#emp-map').innerHTML = mappingHtml(tab);
      } catch (e) { $('#emp-map').innerHTML = '<div class="form-error">' + esc(e.message) + '</div>'; }
    });
  }

  async function unlinkEmployees() {
    if (!confirm('Stop syncing employees from the sheet? Employees already added stay in the app.')) return;
    try {
      const r = await api('saveSettings', { settings: { employeeSource: null } });
      S.settings = r.settings;
      closeModal();
      toast('Sheet unlinked');
      renderPage();
    } catch (e) { toast(e.message, true); }
  }

  // ---------------------------------------------------------------------------
  // Estimates — same document as the old estimate page, saved in the sheet.
  // Version 1 is the original; every update is saved as a new version.
  // ---------------------------------------------------------------------------
  const EST_DEFAULT = {"sections":[{"title":"KITCHEN RENNOVATION","items":[{"name":"Kitchen:- Counter Top - Supply and installation of kitchen counter top with Natural Granite slab or alternative as specified, including required adhesive, cutting, edge finishing, transportation and installation labour. Base specification as per the agreed kitchen scope and approved design.","area":"60","unit":"Sft","amount":""},{"name":"Kitchen:- Hardware & Basic Fitment - Supply and installation of all required kitchen hardware and basic fitments, including soft-close hinges/channels, drawer channels, bottle pull-out, handles and other necessary hardware/accessories required for proper functioning of the modular kitchen units. Hardware to be selected and finalised as per the approved kitchen layout and design.","area":"LM","unit":"LM","amount":""},{"name":"Kitchen:- Cabinet's(lower cabinet, upper head cabinet, loft area and tall unit + Utility + Washing area cabinet in balcony area)","area":"122","unit":"Sft","amount":""},{"name":"Kitchen Dado Area:- Counter back splash area tile","area":"50","unit":"Sft","amount":""},{"name":"Breakfast Counter - Design, fabrication and installation of a customised breakfast counter as per the approved kitchen layout, including counter slab, supporting structure/carcass, required storage (if applicable), edge finishing, hardware, and complete installation labour. Final size, material, finish and detailing to be as per approved design and site measurements.","area":"LM","unit":"LM","amount":""},{"name":"Balcony Covering with Powder-Coated Aluminium & 6mm Glass - Supply and installation of balcony covering using powder-coated aluminium framing with 6mm glass, including required aluminium sections, glass panels, channels, fittings, fasteners, sealant and complete installation labour. The structure shall be properly aligned, levelled and","area":"LM","unit":"LM","amount":""}]},{"title":"LIVING ROOM + BALCONY AREA","items":[{"name":"Puja Unit - Design, fabrication and installation of a customised wooden Puja unit as per the approved design, including required storage, back panel, decorative elements, lighting provisions, hardware and final finishing. The unit shall be executed as per the approved layout and site measurements, with the final material and finish mutually agreed during design finalisation.","area":"LM","unit":"LM","amount":""},{"name":"TV Unit for Living Area - Design, fabrication and installation of a customised TV unit for the living area, including TV back panel, lower storage cabinets/drawers, required open or closed storage, hardware, channels, handles, edge finishing and complete installation labour. The unit shall be designed as per the approved living room layout, site measurements and overall interior design theme.","area":"81","unit":"Sft","amount":""},{"name":"Crockery Unit for Living Area - Design, fabrication and installation of a customised crockery/display unit for the living and dining area, including suitable storage cabinets, drawers, open display niches/shelves, shutters, required hardware and complete finishing. The size, internal storage configuration, material, laminate/finish and detailing shall be finalised as per the approved design and site measurements.","area":"81","unit":"Sft","amount":""},{"name":"Balcony covering with UPVC - Design, supply and installation of UPVC sliding/fixed frame system with toughened glass panels (5mm–6mm) for living balcony. Scope includes UPVC profiles (colour as per Owner's approval), multi point locking hardware, smooth rollers, silicone weather-sealing, mosquito mesh track, removal of existing glazing, and complete labour. System to be weather-tight and operationally smooth. Manufacturer's warranty + 12-month workmanship liability included.","area":"218","unit":"Sft","amount":""}]},{"title":"MASTER BEDROOM + BATHROOM + BALCONY","items":[{"name":"Bed back wall design + T.V. Panel - Design, fabrication and installation of customised bed back wall with integrated T.V. panel, including MDF/ply base, wallpaper/louver/panel finishes as per approved design, concealed wiring provisions for TV and accessories, decorative trim/mouldings, backlighting/cove light provisions, edge finishing, necessary hardware and complete installation labour. The unit shall be designed to create a cohesive feature wall behind the bed with a dedicated recessed/flush-mounted TV panel, as per site measurements and Owner's finalised design. 12-month workmanship warranty included.","area":"LM","unit":"LM","amount":""},{"name":"Walking closet - Design, fabrication and installation of a walk-in wardrobe configuration, including full-height wardrobes with internal partitions, shelves, hanging rods, loft storage, drawer units, soft-close hardware, internal lighting provisions, back panels, edge finishing, complete installation labour, and camouflage/concealed door finish where applicable. The layout and internal storage configuration shall be detailed and approved by the Owner before fabrication, with provisions for both hanging and folded storage as per site measurements. 12-month workmanship warranty + 10-year wooden & hardware service included.","area":"LM","unit":"LM","amount":""},{"name":"Full bathroom renovation (Master bedroom bathroom only) - Complete demolition, removal and disposal of existing tiles, sanitaryware, CP fittings, plumbing lines and old fixtures. Scope includes full wall and floor waterproofing (Dr. Fixit/Sika system with 48-hr ponding test), new vitrified tile flooring (2'x2') and wall tiling (2'x4'), 10mm toughened glass shower partition, Jaquar mid range sanitaryware and CP fittings (wall-mounted WC, cistern, overhead shower, diverter with handle+tap, basin, basin tap, health faucet, bottle trap - 3 sets), storage unit above WC, exhaust fan installation, geyser shifting into shaft, and complete plumbing. All materials and labour are included in this line item. Final tile, CP and sanitaryware selections to be approved in writing by the Owner before ordering 12-month workmanship + manufacturer warranties passed through at handover.","area":"LM","unit":"LM","amount":""},{"name":"Balcony vertical garden - Design, supply and installation of a vertical garden system on the designated master balcony wall, including modular planter panels/pockets or trellis framework, drip irrigation/drainage layer, growing medium, and selected live/artificial plantation as per Owner's final choice. Final layout, planter type and plantation selection to be approved in writing by the Owner before execution. 12-month workmanship warranty included.","area":"LM","unit":"LM","amount":""}]},{"title":"KIDS BEDROOM","items":[{"name":"Customised Bed with Study Table & Bed Back Wall Design - Kids Room - Design, fabrication and installation of a customised kids-room bed integrated with a study table and required storage, along with a customised bed back wall design. The scope includes bed structure, study table, overhead/side storage as required, back panel, decorative elements, required hardware and complete finishing. The design, dimensions, material, laminate/finish and storage configuration shall be finalised as per the approved layout and site measurements","area":"114","unit":"Sft","amount":""},{"name":"Wardrobe - Design, fabrication and installation of a customised wardrobe unit as per the approved layout, including HDHMR/Ply carcass, laminate finish (outer) and inner mica finish, soft-close hinges and channels, hanging rods, shelves, drawers, loft storage, concealed handles or pull profiles, edge banding, back panels, complete installation labour, and internal lighting provisions where required. The unit shall be designed to maximise storage as per site measurements and the Owner's storage requirements. Final design, internal configuration, material and finish to be approved in writing by the Owner before fabrication. 12 month workmanship + 10 year wooden & hardware service included","area":"42","unit":"Sft","amount":""},{"name":"Complete Bathroom Renovation - Kids Room Complete renovation of bathroom, including demolition/removal of existing finishes, new floor and wall tiles, waterproofing, sanitaryware, CP fittings, shower, basin, WC, required plumbing and installation labour, with all necessary bathroom fitments. jaguar (medium range)","area":"1","unit":"No","amount":""}]},{"title":"GUEST BEDROOM","items":[{"name":"Bay Window with Storage & Sitting + Bed Back Wall Design - Guest Room - Design, fabrication and installation of a customised bay window sealing unit with integrated sitting, comfortable sitting provision, storage cabinets/drawers below, required hardware and complete finishing. The scope also includes a customised bed back wall design with decorative panels/wall treatment as per the approved interior theme. Final dimensions, material, storage arrangement, upholstery and finishes shall be as per the approved design and site measurements.","area":"90","unit":"Sft","amount":""},{"name":"Wardrobe - Design, fabrication and installation of a customised wardrobe unit as per the approved layout, including HDHMR/Ply carcass, laminate finish (outer) and inner mica finish, soft-close hinges and channels, hanging rods, shelves, drawers, loft storage, with specified handles, edge banding, back panels, complete installation labour, and internal lighting provisions where required. The unit shall be designed to maximise storage as per site measurements and the Owner's storage requirements. Final design, internal configuration, material and finish to be approved in writing by the Owner before fabrication. 12 month workmanship + 10 year wooden & hardware service included.","area":"40","unit":"Sft","amount":""},{"name":"Common Bathroom - Complete renovation bathroom, including demolition/removal of existing finishes, new floor and wall tiles, waterproofing, sanitaryware, CP fittings, shower, basin, WC, required plumbing and installation labour, with all necessary bathroom fitments.","area":"LM","unit":"LM","amount":""}]},{"title":"ENTRY WAY","items":[{"name":"Entry way shoe rack - Design, fabrication and installation of a covered shoe rack unit outside the flat entrance door, including ply/HDHMR carcass with laminate finish, ventilated shutters, soft-close hardware, shelves angled for easy access, back panel, edge finishing, and complete installation labour. The unit will be designed to maximise shoe storage while complementing the entrance aesthetics, as per site measurements and the Owner's approved design. Final size, design, material and finish to be approved in writing by the Owner before fabrication. 12-month workmanship + 10 year wooden & hardware service included.","area":"LM","unit":"LM","amount":""},{"name":"Key Hanging Unit for Entry Area - Design, fabrication and installation of a customised key hanging unit at the entry area, including a decorative back panel, key hooks/holders, small storage compartment/shelf and required hardware. The unit shall be designed to provide convenient key storage while complementing the overall entrance décor, with material, finish, size and detailing as per the approved design and site measurements","area":"LM","unit":"LM","amount":""}]},{"title":"ELECTRICAL","items":[{"name":"Whole house electrical will be done, which include's wall and ceiling electrical wiring of all 3 bedrooms, 1 bathroom's, 3 balcony's, living room, kitchen and utility area & entry way area and wherever it is required.","area":"1500","unit":"Sft","amount":""},{"name":"Whole house switch boards will be done, which include's wall and ceiling electrical of all 3 bedrooms, 1 bathroom's, 3 balcony's, living room, kitchen and utility area & entry way area and wherever it is required.","area":"1500","unit":"Sft","amount":""},{"name":"Whole house lighting with will have ceiling lights, wall lights and pannel lights if needed will be done, which include's wall and ceiling electrical of all 3 bedroom's, 1 bathroom's, 3 balcony's, living room, kitchen and utility area & entry way area and wherever it is required. Excluding decorative lights and cendialiars","area":"1500","unit":"Sft","amount":""}]},{"title":"PAINT AND WALLPAPER","items":[{"name":"Royal paint's - Surface preparation and application of Asian Royale / Royale Luxury Emulsion or equivalent premium paint system on all internal walls and ceilings (house-wide), including primer coat (1 coat) and two top coats of Royal paint, with putty/filler application, sanding, surface smoothing, edge culling, masking, and complete labour. Scope includes all internal walls and ceiling areas as per site measurements (measured at actuals, capped at ±5% of BOQ quantity). Final shade selection to be approved in writing by the Owner before application, with sample patch approved on site. 12-month workmanship included.","area":"LM","unit":"LM","amount":""}]},{"title":"DOOR'S","items":[{"name":"Main S.S door - main stainless steel door with rust-proof for entrance made from premium SS steel finishes, with specified modern style, robust security with heavy-duty locks.","area":"LM","unit":"LM","amount":""}]},{"title":"GYPROC FALSE CEILING","items":[{"name":"GYPROC FALSE CEILING - Design, fabrication and installation of Cyproc false ceiling throughout the entire house, covering 3 bedrooms, 3 balconies, living room, dining area, kitchen and utility area. Scope includes Gypsum boards with side coves, recessed/profile light provisions, GI channel framework, edge detailing, and complete installation labour Final ceiling design, layout and lighting recess positions to be approved in writing by the Owner before execution. 12-month workmanship warranty included.","area":"LM","unit":"LM","amount":""}]},{"title":"OTHER WORK","items":[{"name":"All Door Laminate Change with Locks & Hardware - Replacement of laminate/finish on all existing doors, including necessary preparation, new laminate application, replacement/provision of required locks, handles and associated door hardware. 6 Nos. doors @ 12,500 per door","area":"6","unit":"Nos","amount":""},{"name":"Floor Tile Change - Living Room, Kitchen & Kitchen Balcony - Removal of existing flooring and supply & installation of new floor tiles in the living room, kitchen and kitchen balcony areas, including necessary laying labour and associated work","area":"600","unit":"Sft","amount":""},{"name":"AC Pipe Installation - Complete AC piping work including required refrigerant/copper piping, drainage arrangement, necessary material, accessories and labour for installation.","area":"52","unit":"Rmt","amount":""}]}],"specs":[{"cat":"Electrical","detail":"Wires and cables: Polycab, Havells, Finolex, KEI\nLights and Panel lights and Cove lights: Polycab and Havells\nSwitch and socket: Havells, Crabtree, Cona"},{"cat":"Wooden Work","detail":"HDHMR board / ply brand: Century, Actiontesa"},{"cat":"Hardware","detail":"Kitchen hardware and fitmate: Hettich, Ozone, Samsung Irex"},{"cat":"UPVC Window","detail":"Cora, simta, prominance"},{"cat":"Door Lock and Hardware","detail":"Jolly or Dorset"},{"cat":"Paint","detail":"Asian, ICI Dulux"},{"cat":"Tiles for Floor and Bathroom","detail":"Kajaria, Nitco, Somany"},{"cat":"False Ceiling","detail":"Saint-Gobain Gyproc"},{"cat":"AC Copper Piping","detail":"TATA, Malaysia Copper Pipes"}],"terms":[{"label":"A","text":"Ref to Project contract file (if any)."},{"label":"B","text":"GST 18% as per government norms Extra. (Inclusive as per contract)"},{"label":"C","text":"The final cost could vary depending on your location, specific material choice and complexity of the installation."},{"label":"D","text":"Design Authority – Designer proposes; Owner holds FINAL design and finalisation authority on all items. No fabrication/ordering before Owner's written approval."},{"label":"E","text":"Warranty – 12-month workmanship/defect liability + 10-year wooden & hardware service + manufacturer warranties passed through at handover."},{"label":"F","text":"Timeline – Total 120 days from DAY 1 of Execution, Work delivery by Day 120 (Subject to normal condition); snag closure and key handover by Day 120. Delay deduction (tolerance 10%): 0.5% per week, capped at 5%."},{"label":"G","text":"Refund Policy – No Refund shall be entertained while stoppage of work by Client or any authority."},{"label":"H","text":"Location & Execution – Service area: Gurugram, Noida, Delhi, Ghaziabad. Subject to builder/maintenance fit-out approval wherever required (Designer to obtain)."},{"label":"I","text":"Any design changes after work starts may incur additional charges."},{"label":"J","text":"Customer must provide electricity and confirm all electrical/lighting points before installation."},{"label":"K","text":"Malwa disposal, and other miscellaneous charges are extra unless specifically mentioned."},{"label":"L","text":"The company is not liable for delays or issues arising from site conditions or customer-side requirements."}]};
  const EST_STATUS = ['Draft', 'Sent', 'Approved', 'Rejected'];
  const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
  const FIREBASE_OLD = {
    apiKey: 'AIzaSyAzY9Sv9Q65ebYibN3jIN2NhPJTJEWbHR8', authDomain: 'urbane-living-official.firebaseapp.com', projectId: 'urbane-living-official',
    storageBucket: 'urbane-living-official.firebasestorage.app', messagingSenderId: '777138287080', appId: '1:777138287080:web:8483bbed0858a809f5f45d',
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const myEmail = () => String(S.user.email).toLowerCase();
  const estItemsTotal = (items) => items.reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
  const estGrand = (e) => e.sections.reduce((a, s) => a + estItemsTotal(s.items), 0);
  const estMoney = (n) => (n > 0 ? '₹' + n.toLocaleString('en-IN') : '');

  function estVersions(no) {
    return (S.estimates || []).filter((x) => x.estimateNo === no).sort((a, b) => a.version - b.version);
  }
  function estOwner(no) {
    const v = estVersions(no)[0];
    return v ? String(v.createdBy).toLowerCase() : '';
  }
  const canEditEst = (no) => isAdmin() || !no || estOwner(no) === myEmail();
  function estLatestList() {
    const by = {};
    (S.estimates || []).forEach((r) => { if (!by[r.estimateNo] || r.version > by[r.estimateNo].version) by[r.estimateNo] = r; });
    return Object.keys(by).map((k) => Object.assign({ versions: estVersions(k).length }, by[k]));
  }
  function blankEstimate() {
    const t = (S.settings && S.settings.estimateTemplate) || EST_DEFAULT;
    return {
      id: '', estimateNo: '', version: 0, status: 'Draft', clientId: '', estimateDate: today(), createdBy: S.user.email,
      client: { name: '', phone: '', address: '' }, sections: clone(t.sections), specs: clone(t.specs), terms: clone(t.terms),
      logs: [], editing: true, newLogs: [], dirty: false,
    };
  }
  function estFromRecord(r) {
    const d = r.data || {};
    return {
      id: r.id, estimateNo: r.estimateNo, version: r.version, isOriginal: r.isOriginal, status: r.status || 'Draft', clientId: r.clientId,
      estimateDate: r.estimateDate, createdBy: r.createdBy, updatedBy: r.updatedBy, updatedAt: r.updatedAt,
      client: { name: r.clientName, phone: r.clientPhone, address: r.clientAddress },
      sections: d.sections || [], specs: d.specs || [], terms: d.terms || [], logs: r.logs || [], editing: false, newLogs: [], dirty: false,
    };
  }

  function viewEstimates(id) {
    if (!id) return estList();
    if (id === 'new') {
      if (!S.est || S.est.id) S.est = blankEstimate();
      return estEditor();
    }
    if (S.est && S.est.id === id) return estEditor();
    if (S.estError) return '<a class="back" href="#/estimates">' + icon('back') + 'Estimates</a><div class="empty">' + esc(S.estError) + '</div>';
    return '<div class="loading" style="min-height:300px"><div class="spinner"></div><div>Opening estimate…</div></div>';
  }
  viewEstimates.after = function () {
    const id = route().id;
    if (id && id !== 'new' && (!S.est || S.est.id !== id) && S.estLoading !== id && !S.estError) {
      S.estLoading = id;
      api('estimateGet', { id: id }).then((r) => {
        S.est = estFromRecord(r.record);
        S.estLoading = null;
        if (route().id === id) renderPage();
      }).catch((e) => { S.estLoading = null; S.estError = e.message; renderPage(); });
    }
  };

  function estList() {
    const st = ui('estimates');
    const seeAll = ['Admin', 'Accountant', 'Viewer'].includes(S.user.role);
    if (!st.tab) st.tab = 'list';
    const base = st.tab === 'list' ? estLatestList() : (S.estimates || []).slice();
    const rowsF = base.filter((r) => (!st.status || r.status === st.status) && (!st.mine || String(r.createdBy).toLowerCase() === myEmail()) &&
      matchQ('estimates', r.estimateNo, r.clientName, r.clientAddress, userName(r.createdBy)));
    const latest = estLatestList();
    const val = (s) => sum(latest.filter((r) => !s || r.status === s), 'grandTotal');
    const decided = latest.filter((r) => r.status === 'Approved' || r.status === 'Rejected').length;

    let h = pageHead('Estimates', seeAll ? 'All estimates of the team · each update is kept as a new version' : 'Your estimates · each update is kept as a new version',
      (isAdmin() ? '<button class="btn" data-act="est-firebase">' + icon('download') + 'Import old estimates</button>' : '') +
      csvBtn('estimates') + '<a class="btn primary" href="#/estimates/new">' + icon('plus') + 'New estimate</a>');
    h += '<div class="kpis">' + kpi('Estimates', String(latest.length), plural(latest.filter((r) => r.status === 'Draft').length, 'draft')) +
      kpi('Total quoted', inr(val())) + kpi('Approved', inr(val('Approved')), plural(latest.filter((r) => r.status === 'Approved').length, 'estimate'), 'good') +
      kpi('Win rate', decided ? Math.round(latest.filter((r) => r.status === 'Approved').length / decided * 100) + '%' : '—', 'Approved out of approved + rejected') + '</div>';
    h += tabs('estimates', [['list', 'Estimates', latest.length], ['history', 'All versions', (S.estimates || []).length]], 'list');
    h += '<div class="filters">' + searchFilter('estimates', 'Search client, estimate no, created by…') + selectFilter('estimates', 'status', 'All statuses', EST_STATUS) +
      (seeAll ? selectFilter('estimates', 'mine', 'Everyone', [['1', 'Only mine']]) : '') + '</div>';
    h += '<div class="card">' + dataTable('estimates', [
      { k: 'estimateNo', l: 'Estimate', primary: true, f: (r) => '<b>' + esc(r.estimateNo) + '</b> <span class="badge">' + (r.version === 1 ? 'Original' : 'V' + r.version) + '</span>' + (st.tab === 'list' && r.versions > 1 ? '<div class="cell-sub">' + r.versions + ' versions</div>' : '') },
      { k: 'clientName', l: 'Client', f: (r) => esc(r.clientName) + (r.clientAddress ? '<div class="cell-sub">' + esc(r.clientAddress.slice(0, 60)) + '</div>' : '') },
      { k: 'estimateDate', l: 'Date', f: (r) => esc(fmtDate(r.estimateDate)), csv: (r) => r.estimateDate },
      { k: 'grandTotal', l: 'Total', r: true, total: true, v: (r) => num(r.grandTotal), f: (r) => (num(r.grandTotal) ? inr(r.grandTotal) : '<span class="muted">As actual</span>') },
      { k: 'status', l: 'Status', f: (r) => statusBadge(r.status) + (r.clientId ? '<div class="cell-sub">Client created</div>' : '') },
      { k: 'createdBy', l: 'Created by', v: (r) => userName(r.createdBy), f: (r) => esc(userName(r.createdBy)) + (r.version > 1 ? '<div class="cell-sub">Updated by ' + esc(userName(r.updatedBy)) + '</div>' : '') },
    ], rowsF, { onRow: 'open-est', name: 'Estimates', sort: { k: 'estimateDate', dir: 'desc' }, empty: (S.estimates || []).length ? 'No estimates match the filters' : 'No estimates yet — create the first one' }) + '</div>';
    return h;
  }

  function estField(path, value, opts) {
    opts = opts || {};
    if (opts.area) return '<textarea class="ed" data-ep="' + path + '" rows="' + (opts.rows || 3) + '">' + esc(value) + '</textarea>';
    return '<input class="ed' + (opts.r ? ' r' : '') + '" data-ep="' + path + '" value="' + esc(value) + '"' + (opts.type ? ' type="' + opts.type + '"' : '') + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + '>';
  }
  const estBtn = (op, label, s, i, cls) => '<button type="button" class="' + (cls || '') + '" data-act="est-op" data-op="' + op + '"' + (s !== undefined ? ' data-s="' + s + '"' : '') + (i !== undefined ? ' data-i="' + i + '"' : '') + '>' + label + '</button>';

  function estDocHtml(e, editing) {
    const c = S.settings.company || {};
    const grand = estGrand(e);
    const days = c.estimateValidDays || 14;
    let h = '<div class="est-wrap"><div class="est-doc">';
    h += '<div class="head"><div>' + (logoUrl() ? '<img src="' + esc(logoUrl(true)) + '" alt="' + esc(c.name || 'Urbane Living') + '" onerror="this.outerHTML=\'<b style=&quot;font-size:22px&quot;>' + esc(c.name || 'Urbane Living') + '</b>\'">' : '<b style="font-size:22px">' + esc(c.name || 'Urbane Living') + '</b>') + '</div>' +
      '<div style="text-align:right"><h1>ESTIMATE</h1><div style="margin-top:5px"><div class="site">' + esc(c.website || '') + '</div><div style="font-size:15px;margin-top:3px">' + esc(c.address || '') + '</div>' +
      (c.serviceArea ? '<div style="font-size:15px;margin-top:2px"><strong>Service Area:</strong> ' + esc(c.serviceArea) + '</div>' : '') + '</div></div></div>';
    if (c.gstNo) h += '<div style="font-size:14px"><strong>GST No:</strong> ' + esc(c.gstNo) + '</div>';
    h += '<div class="meta"><div style="flex:1"><p style="font-weight:700;margin:0 0 4px;font-size:14px">Bill To</p>' +
      (editing ? estField('client.name', e.client.name, { ph: 'Client name *' }) + '<div style="height:4px"></div>' + estField('client.phone', e.client.phone, { ph: 'Mobile (optional)' }) + '<div style="height:4px"></div>' + estField('client.address', e.client.address, { ph: 'Address' })
        : '<div style="font-weight:600">' + esc(e.client.name) + '</div>' + (e.client.phone ? '<div>' + esc(e.client.phone) + '</div>' : '') + '<div>' + esc(e.client.address) + '</div>') + '</div>' +
      '<div style="text-align:right;font-size:14px;min-width:230px;line-height:1.5"><div><strong>Estimate No:</strong> ' + (e.estimateNo ? esc(e.estimateNo) : '<span style="color:#888">(given on save)</span>') + (e.version > 1 ? ' <span style="color:#888">(V' + e.version + ')</span>' : '') + '</div>' +
      '<div><strong>Estimate Date:</strong> ' + (editing ? '<input class="ed" type="date" data-ep="estimateDate" value="' + esc(e.estimateDate) + '" style="width:auto">' : esc(fmtDate(e.estimateDate).replace(/ /g, '-'))) +
      '<br><span style="font-size:10px;color:#c00000">(Valid for ' + days + ' days)</span></div>' +
      '<div style="font-weight:700;margin-top:3px">Grand Total (INR):- <span id="est-grand">' + (grand > 0 ? estMoney(grand) : 'As Actual') + '</span></div></div></div>';

    h += '<table style="margin-top:10px"><thead><tr><th style="width:35px">Sn</th><th>Product/Service</th><th style="width:85px">Area</th><th style="width:75px">Qnt/unit</th><th style="width:' + (editing ? 150 : 120) + 'px">Total</th></tr></thead><tbody>';
    e.sections.forEach((sec, s) => {
      h += '<tr class="sec-row"><td class="c">' + (s + 1) + '</td><td colspan="4"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center">' +
        (editing ? '<div style="flex:1">' + estField('sections.' + s + '.title', sec.title) + '</div><span class="mini">' + estBtn('secUp', '↑', s) + estBtn('secDown', '↓', s) + estBtn('itemAdd', '+ Item', s, undefined, 'add') + estBtn('secDel', '✕ Section', s, undefined, 'del') + '</span>' : '<span>' + esc(sec.title) + '</span>') +
        '</div></td></tr>';
      sec.items.forEach((it, i) => {
        h += '<tr><td class="r" style="font-style:italic">' + (ROMAN[i] || i + 1) + '</td>' +
          '<td>' + (editing ? estField('sections.' + s + '.items.' + i + '.name', it.name, { area: true, rows: Math.min(8, Math.max(2, Math.ceil(String(it.name).length / 90))) }) : '<span class="pre">' + esc(it.name) + '</span>') + '</td>' +
          '<td class="c">' + (editing ? estField('sections.' + s + '.items.' + i + '.area', it.area) : esc(it.area)) + '</td>' +
          '<td class="c">' + (editing ? estField('sections.' + s + '.items.' + i + '.unit', it.unit) : esc(it.unit)) + '</td>' +
          '<td class="r">' + (editing ? '<div style="display:flex;gap:4px;align-items:center">' + estField('sections.' + s + '.items.' + i + '.amount', it.amount, { r: true, ph: 'Amt' }) + '<span class="mini">' + estBtn('itemDel', '✕', s, i, 'del') + '</span></div>' : (it.amount ? '₹' + Number(it.amount).toLocaleString('en-IN') : '')) + '</td></tr>';
      });
      const st = estItemsTotal(sec.items);
      h += '<tr class="tot-row"><td colspan="4" class="r">Total</td><td class="r"><span id="est-st-' + s + '">' + estMoney(st) + '</span></td></tr>';
    });
    h += '</tbody></table>';
    if (editing) h += '<div class="mini" style="margin-top:8px">' + estBtn('secAdd', '+ Add section', undefined, undefined, 'add') + '</div>';

    h += '<div class="band"><span>Material Specifications / Makes</span>' + (editing ? '<span class="mini">' + estBtn('specAdd', '+ Add spec', undefined, undefined, 'add') + '</span>' : '') + '</div>' +
      '<table style="font-size:12px"><thead><tr><th style="width:30px">#</th><th style="width:160px">Category</th><th>Details / Brand</th>' + (editing ? '<th style="width:40px"></th>' : '') + '</tr></thead><tbody>' +
      e.specs.map((x, i) => '<tr><td class="c">' + (i + 1) + '</td><td style="font-weight:600">' + (editing ? estField('specs.' + i + '.cat', x.cat) : esc(x.cat)) + '</td><td class="pre">' + (editing ? estField('specs.' + i + '.detail', x.detail, { area: true, rows: 3 }) : esc(x.detail)) + '</td>' +
        (editing ? '<td class="c"><span class="mini">' + estBtn('specDel', '✕', i, undefined, 'del') + '</span></td>' : '') + '</tr>').join('') + '</tbody></table>';

    h += '<div class="band"><span>Basic Terms &amp; Conditions</span>' + (editing ? '<span class="mini">' + estBtn('termAdd', '+ Add term', undefined, undefined, 'add') + '</span>' : '') + '</div>' +
      '<table style="font-size:12px"><tbody>' + e.terms.map((t, i) => '<tr><td class="c" style="width:30px;font-weight:700">' + esc(t.label) + '</td><td>' +
        (editing ? '<div style="display:flex;gap:6px">' + estField('terms.' + i + '.text', t.text, { area: true, rows: 2 }) + '<span class="mini">' + estBtn('termDel', '✕', i, undefined, 'del') + '</span></div>' : '<span class="pre">' + esc(t.text) + '</span>') + '</td></tr>').join('') + '</tbody></table>';

    if (c.bankAccount || c.bankName || c.bankIfsc) {
      h += '<div class="band bank">Bank Details:-</div><table style="font-size:12px"><tbody>' +
        '<tr><td>Name: <strong>' + esc(c.name || 'Urbane Living') + '</strong></td></tr>' +
        (c.bankAccount ? '<tr><td>Account no.: <strong>' + esc(c.bankAccount) + '</strong></td></tr>' : '') +
        (c.bankIfsc ? '<tr><td>IFSC Code: <strong>' + esc(c.bankIfsc) + '</strong></td></tr>' : '') +
        (c.bankName ? '<tr><td>Bank Name: <strong>' + esc(c.bankName) + '</strong></td></tr>' : '') + '</tbody></table>';
    } else if (isAdmin()) {
      h += '<p class="no-print" style="color:#c00000;font-size:12px;margin-top:16px">Bank details are empty — add them in Settings → Company so they print on estimates.</p>';
    }
    return h + '</div></div>';
  }

  function estEditor() {
    const e = S.est;
    const editable = canEditEst(e.estimateNo);
    const versions = e.estimateNo ? estVersions(e.estimateNo) : [];
    const printing = !!S.estPrint;
    const editing = e.editing && !printing;
    let h = '<a class="back no-print" href="#/estimates" data-act="est-back">' + icon('back') + 'Estimates</a>';
    h += '<div class="est-toolbar no-print"><div class="group">';
    if (editing) {
      if (e.id) h += '<button class="btn primary" data-act="est-save" data-mode="update">' + icon('pay') + 'Save update (V' + ((versions.length ? versions[versions.length - 1].version : e.version) + 1) + ')</button>';
      h += '<button class="btn' + (e.id ? '' : ' primary') + '" data-act="est-save" data-mode="new">' + icon('plus') + (e.id ? 'Save as new estimate' : 'Save estimate') + '</button>';
      h += '<button class="btn" data-act="est-cancel">Cancel</button>';
    } else {
      if (editable) h += '<button class="btn primary" data-act="est-edit">' + icon('edit') + 'Edit estimate</button>';
      h += '<button class="btn" data-act="est-copy">' + icon('plus') + 'Copy as new</button>';
    }
    h += '<a class="btn" href="#/estimates/new" data-act="est-blank">New blank</a>';
    h += '</div><div class="group">';
    if (e.id && (editable || canWrite())) {
      h += '<select class="input" style="width:auto" data-act-change="est-status" aria-label="Status">' + EST_STATUS.map((x) => '<option' + (x === e.status ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>';
    }
    if (e.id && canWrite()) {
      const linked = e.clientId && byId('Clients', e.clientId);
      h += linked ? '<a class="btn" href="#/clients/' + encodeURIComponent(e.clientId) + '">' + icon('clients') + 'Open client</a>'
        : '<button class="btn" data-act="est-client">' + icon('clients') + 'Create client</button>';
    }
    if (isAdmin() && !editing) h += '<button class="btn" data-act="est-template" title="New estimates will start from this one">Use as template</button>';
    h += '<button class="btn primary" data-act="est-print">' + icon('print') + 'Download PDF</button>';
    if (e.id && editable && !editing) h += '<button class="btn ghost icon danger" title="Delete this version" data-act="est-del">' + icon('trash') + '</button>';
    h += '</div></div>';
    if (versions.length > 1) {
      h += '<div class="chips no-print">' + versions.map((v) => '<a class="badge' + (v.id === e.id ? ' accent' : '') + '" href="#/estimates/' + encodeURIComponent(v.id) + '">' + (v.version === 1 ? 'Original' : 'V' + v.version) + ' · ' + esc(fmtDate(v.updatedAt ? v.updatedAt.slice(0, 10) : v.estimateDate)) + '</a>').join('') + '</div>';
    }
    if (!editing) {
      h += '<div class="est-lock no-print">🔒 View mode. ' + (editable ? 'Click <b>Edit estimate</b> to change it — saving creates a new version and the original stays in history.' : 'Only ' + esc(userName(estOwner(e.estimateNo))) + ' or an Admin can edit this estimate. Use <b>Copy as new</b> to start your own from it.') + '</div>';
    }
    h += estDocHtml(e, editing);
    if (e.logs && e.logs.length) {
      h += '<div class="card no-print" style="max-width:850px;margin:16px auto 0"><div class="card-head"><h2>Edit history</h2></div><div class="card-body est-logs">' +
        e.logs.map((l) => '<div style="padding:4px 0;border-bottom:1px solid var(--border)"><span class="muted">' + esc(fmtStamp(l.time) || l.time) + '</span> · <b>' + esc(userName(l.user)) + '</b> · ' + esc(l.action) + '</div>').join('') + '</div></div>';
    }
    return h;
  }

  function estSetPath(obj, path, value) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  }

  function estOnInput(el) {
    const e = S.est;
    if (!e || !e.editing) return;
    estSetPath(e, el.dataset.ep, el.value);
    e.dirty = true;
    const m = el.dataset.ep.match(/^sections\.(\d+)\.items\.\d+\.amount$/);
    if (m) {
      const s = Number(m[1]);
      const st = $('#est-st-' + s);
      if (st) st.textContent = estMoney(estItemsTotal(e.sections[s].items));
      const g = $('#est-grand');
      const grand = estGrand(e);
      if (g) g.textContent = grand > 0 ? estMoney(grand) : 'As Actual';
    }
  }

  function estOp(op, s, i) {
    const e = S.est;
    if (!e || !e.editing) return;
    const L = (msg) => e.newLogs.push(msg);
    const sec = e.sections[s];
    switch (op) {
      case 'secAdd': e.sections.push({ title: 'NEW SECTION TITLE', items: [{ name: 'New item description', area: '0', unit: 'Sft', amount: '' }] }); L('Added a section'); break;
      case 'secDel': if (!confirm('Delete section "' + sec.title + '"?')) return; e.sections.splice(s, 1); L('Deleted section ' + sec.title); break;
      case 'secUp': if (s > 0) e.sections.splice(s - 1, 0, e.sections.splice(s, 1)[0]); break;
      case 'secDown': if (s < e.sections.length - 1) e.sections.splice(s + 1, 0, e.sections.splice(s, 1)[0]); break;
      case 'itemAdd': sec.items.push({ name: 'New item description', area: '0', unit: 'Sft', amount: '' }); L('Added an item in ' + sec.title); break;
      case 'itemDel': sec.items.splice(i, 1); L('Removed an item from ' + sec.title); break;
      case 'specAdd': e.specs.push({ cat: 'New category', detail: 'Specification details here' }); L('Added a spec'); break;
      case 'specDel': L('Deleted spec ' + e.specs[s].cat); e.specs.splice(s, 1); break;
      case 'termAdd': e.terms.push({ label: String.fromCharCode(65 + e.terms.length), text: 'New term details here' }); L('Added a term'); break;
      case 'termDel': e.terms.splice(s, 1); e.terms.forEach((t, k) => { t.label = String.fromCharCode(65 + k); }); L('Deleted a term'); break;
    }
    e.dirty = true;
    const y = window.scrollY;
    renderPage();
    window.scrollTo(0, y);
  }

  async function estSave(mode, btn) {
    const e = S.est;
    if (!String(e.client.name || '').trim()) return toast('Enter the client name (Bill To) first', true);
    btn.disabled = true;
    try {
      const r = await api('estimateSave', {
        mode: mode,
        record: { estimateNo: e.estimateNo, estimateDate: e.estimateDate, client: e.client, data: { sections: e.sections, specs: e.specs, terms: e.terms }, newLogs: e.newLogs },
      });
      S.estimates = r.estimates;
      S.est = estFromRecord(r.record);
      toast(mode === 'new' ? 'Estimate ' + r.record.estimateNo + ' saved' : 'Saved as V' + r.record.version + ' — earlier versions are kept');
      location.hash = '#/estimates/' + encodeURIComponent(r.record.id);
      renderPage();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  }

  function estPrint() {
    const e = S.est;
    const title = document.title;
    S.estPrint = true;
    renderPage();
    document.body.classList.add('print-estimate');
    document.title = 'Urbane_Living_Estimate_' + (e.estimateNo || 'draft') + '_' + String(e.client.name || '').replace(/[^\w]+/g, '_');
    const done = () => {
      document.body.classList.remove('print-estimate');
      document.title = title;
      S.estPrint = false;
      renderPage();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(() => { if (S.estPrint) done(); }, 500); }, 120);
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      if ($('script[src="' + src + '"]')) return res();
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  function openFirebaseImport() {
    openModal('Import estimates from the old estimate page', '<p style="margin-top:0">This copies every saved estimate (originals and updated versions, with their edit history) from the old Firebase estimate page into this dashboard. Nothing is deleted from Firebase, and estimates already copied are skipped, so it is safe to run again.</p>' +
      '<ol class="small" style="padding-left:18px;line-height:1.7"><li>One-time: in the <b>Firebase console → Authentication → Settings → Authorized domains</b>, add <code>' + esc(location.hostname) + '</code>.</li>' +
      '<li>Click <b>Sign in with Google &amp; import</b> and choose an email that could use the old estimate page.</li></ol><div id="fb-status" class="small muted"></div>', {
      submit: 'Sign in with Google & import',
      onSubmit: async () => {
        const status = $('#fb-status');
        const say = (m) => { if (status) status.textContent = m; };
        const v = '10.12.2';
        say('Loading Firebase…');
        await loadScript('https://www.gstatic.com/firebasejs/' + v + '/firebase-app-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/' + v + '/firebase-auth-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/' + v + '/firebase-firestore-compat.js');
        const fb = window.firebase;
        const app = fb.apps.find((a) => a.name === 'ulOldEstimates') || fb.initializeApp(FIREBASE_OLD, 'ulOldEstimates');
        say('Waiting for Google sign-in…');
        await app.auth().signInWithPopup(new fb.auth.GoogleAuthProvider());
        say('Reading estimates…');
        const db = app.firestore();
        const [a, b] = await Promise.all([db.collection('ul_estimates_original').get(), db.collection('ul_estimates_updated').get()]);
        const recs = a.docs.map((d) => [d.data(), 1]).concat(b.docs.map((d) => [d.data(), (Number(d.data().version) || 1) + 1])).map(([x, ver]) => ({
          estimateNo: x.originalEstimateNo || x.estimateNo, version: ver, estimateDate: x.estimateDate, client: x.client || {},
          sections: x.sections || [], specs: x.specs || [], terms: x.terms || [], editLogs: x.editLogs || [],
          createdBy: x.createdBy, updatedBy: x.updatedBy || x.createdBy, updatedAt: x.updatedAt || '',
        }));
        let done = 0;
        for (let k = 0; k < recs.length; k += 25) {
          say('Saving ' + Math.min(k + 25, recs.length) + ' of ' + recs.length + '…');
          const r = await api('estimateImport', { records: recs.slice(k, k + 25) });
          done += r.imported;
          S.estimates = r.estimates;
        }
        await app.auth().signOut();
        toast(done + ' estimates imported (' + (recs.length - done) + ' were already here)');
        renderPage();
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Attendance — marked automatically when someone opens the dashboard from the
  // office network. The browser reports its public IP; the server checks it.
  // ---------------------------------------------------------------------------
  const ATT_STATUS = ['Present', 'Late', 'Half Day', 'Leave', 'Absent', 'Holiday'];
  const ATT_CODE = { Present: 'P', Late: 'L', 'Half Day': 'H', Leave: 'LV', Absent: 'A', Holiday: 'HO' };

  function v6Groups(ip) {
    if (ip.indexOf(':') < 0) return null;
    const parts = ip.split('::');
    const head = parts[0] ? parts[0].split(':') : [];
    const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
    const fill = parts.length > 1 ? new Array(Math.max(0, 8 - head.length - tail.length)).fill('0') : [];
    return head.concat(fill, tail).map((g) => (g.replace(/^0+/, '') || '0').toLowerCase());
  }
  function ipAllowed(ip) {
    const a = S.settings.attendance || {};
    ip = String(ip || '').trim().toLowerCase();
    if (!ip) return false;
    return (a.ipPrefixes || []).some((p) => {
      p = String(p).trim().toLowerCase().replace(/\/\d+$/, '').replace(/[:.]+$/, '');
      if (!p) return false;
      if (p.indexOf(':') >= 0) {
        const ig = v6Groups(ip);
        const pg = p.split(':').map((g) => (g.replace(/^0+/, '') || '0'));
        return !!ig && pg.every((g, k) => ig[k] === g);
      }
      return ip === p || ip.indexOf(p + '.') === 0;
    });
  }
  const netPrefix = (ip) => (ip.indexOf(':') >= 0 ? v6Groups(ip).slice(0, 4).join(':') : ip);

  async function publicIps(force) {
    if (S.ips && !force && Date.now() - S.ips.at < 120000) return S.ips;
    const get = (u) => Promise.race([fetch(u).then((r) => r.json()).then((j) => j.ip), new Promise((res) => setTimeout(() => res(''), 6000))]).catch(() => '');
    const [a, b] = await Promise.all([get('https://api64.ipify.org?format=json'), get('https://api.ipify.org?format=json')]);
    const list = [a, b].filter(Boolean).filter((x, k, arr) => arr.indexOf(x) === k);
    S.ips = { at: Date.now(), list: list };
    return S.ips;
  }
  function getGeo() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('Location is not available on this device'));
      navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => rej(new Error('Location permission was denied')), { enableHighAccuracy: true, timeout: 15000 });
    });
  }

  async function markAttendance(kind, useGeo) {
    const ips = await publicIps(true);
    const ip = ips.list.find(ipAllowed) || ips.list[0] || '';
    let lat = '';
    let lng = '';
    if (!ipAllowed(ip) && useGeo) { const g = await getGeo(); lat = g.latitude; lng = g.longitude; }
    const r = await api('attendanceMark', { kind: kind, ip: ip, lat: lat, lng: lng });
    S.attendanceToday = r.record;
    S.attRows = {};
    S.todayFetched = null;
    return r;
  }

  async function autoAttendance() {
    const a = S.settings && S.settings.attendance;
    if (!a || !a.autoMark || !S.user) return;
    try {
      const ips = await publicIps();
      if (!ips.list.some(ipAllowed)) return;
      const r = await markAttendance(S.attendanceToday ? 'out' : 'in');
      if (r.action === 'in') toast('Attendance marked · ' + r.record.checkIn + (r.record.status === 'Late' ? ' (late)' : ''));
      if (route().page === 'attendance') renderPage();
    } catch (e) { /* not in office or offline — nothing to do */ }
  }

  function attHours(r) {
    if (!r || !r.checkIn || !r.checkOut) return 0;
    const t = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
    return Math.max(0, (t(r.checkOut) - t(r.checkIn)) / 60);
  }
  const fmtHours = (h) => (h ? Math.floor(h) + 'h ' + pad(Math.round((h % 1) * 60)) + 'm' : '');

  function viewAttendance() {
    const st = ui('attendance');
    if (!st.month) st.month = thisMonth();
    const team = ['Admin', 'Accountant'].includes(S.user.role);
    const t = S.attendanceToday;
    const ips = S.ips;
    const inOffice = ips && ips.list.some(ipAllowed);
    const geoOn = S.settings.attendance && S.settings.attendance.geo && S.settings.attendance.geo.enabled;
    let h = pageHead('Attendance', 'Marked automatically when you open the dashboard from the office network', '');
    h += '<div class="card" style="margin-bottom:16px"><div class="card-body" style="display:flex;gap:16px;justify-content:space-between;align-items:center;flex-wrap:wrap">' +
      '<div><div class="small muted">Today · ' + esc(fmtDate(today())) + '</div><div style="font-size:20px;font-weight:700;margin:4px 0">' +
      (t ? statusBadge(t.status) + ' In ' + esc(t.checkIn) + (t.checkOut ? ' · Out / last seen ' + esc(t.checkOut) : '') : 'Not marked yet') + '</div>' +
      '<div class="small ' + (ips ? (inOffice ? 'pos' : 'neg') : 'muted') + '">' + (ips ? (inOffice ? '✓ On office network' : '✗ Not on office network') + ' · IP ' + esc(ips.list.join(', ') || 'unknown') : 'Checking your network…') + '</div></div>' +
      '<div class="page-actions">' + (!t ? '<button class="btn primary" data-act="att-mark" data-kind="in">Check in</button>' : '<button class="btn" data-act="att-mark" data-kind="out">Check out</button>') +
      (geoOn && !inOffice ? '<button class="btn" data-act="att-mark" data-kind="' + (t ? 'out' : 'in') + '" data-geo="1">Use my location</button>' : '') + '</div></div></div>';
    if (team) h += tabs('attendance', [['me', 'My attendance'], ['team', 'Team']], 'me');
    else st.tab = 'me';
    h += '<div class="filters"><input class="input" type="month" data-filter="month" value="' + esc(st.month) + '" aria-label="Month">' + (st.tab === 'team' ? '<button class="btn sm" data-act="att-csv">' + icon('download') + 'Export</button>' : '') + '</div>';
    const rowsM = S.attRows && S.attRows[st.month];
    if (!rowsM) return h + '<div class="loading" style="min-height:160px"><div class="spinner"></div></div>';

    if (st.tab !== 'team') {
      const mine = rowsM.filter((r) => r.email.toLowerCase() === myEmail());
      const hrs = mine.map(attHours).filter(Boolean);
      h += '<div class="kpis">' + kpi('Days present', String(mine.filter((r) => ['Present', 'Late', 'Half Day'].includes(r.status)).length)) +
        kpi('Late', String(mine.filter((r) => r.status === 'Late').length)) + kpi('Leave', String(mine.filter((r) => r.status === 'Leave').length)) +
        kpi('Average hours', hrs.length ? fmtHours(hrs.reduce((a, b) => a + b, 0) / hrs.length) : '—') + '</div>';
      h += '<div class="card">' + dataTable('att-me', [
        { k: 'date', l: 'Date', primary: true, f: (r) => esc(fmtDate(r.date)) + ' <span class="muted small">' + new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }) + '</span>' },
        { k: 'status', l: 'Status', f: (r) => statusBadge(r.status) },
        { k: 'checkIn', l: 'In', f: (r) => esc(r.checkIn) },
        { k: 'checkOut', l: 'Out / last seen', f: (r) => esc(r.checkOut) },
        { k: 'hours', l: 'Hours', r: true, v: attHours, f: (r) => fmtHours(attHours(r)) },
        { k: 'method', l: 'Marked by', f: (r) => esc(r.method) + (r.notes ? '<div class="cell-sub">' + esc(r.notes) + '</div>' : '') },
      ], mine, { sort: { k: 'date', dir: 'desc' }, empty: 'No attendance this month' }) + '</div>';
      return h;
    }

    const members = S.users.filter((u) => u.status === 'Active');
    const days = Number(monthEnd(st.month).slice(8));
    const td = today();
    const byKey = {};
    rowsM.forEach((r) => { byKey[r.email.toLowerCase() + '|' + r.date] = r; });
    // Days before attendance was first recorded are left blank, not marked absent.
    const firstDay = rowsM.reduce((m, r) => (r.method !== 'Manual (Admin)' && (!m || r.date < m) ? r.date : m), '');
    h += '<div class="card"><div class="table-wrap"><table class="data att-grid"><thead><tr><th>Member</th>';
    for (let d = 1; d <= days; d++) {
      const ds = st.month + '-' + pad(d);
      const wd = new Date(ds + 'T00:00:00').getDay();
      h += '<th' + (wd === 0 ? ' style="color:var(--muted)"' : '') + '>' + d + '</th>';
    }
    h += '<th>P</th><th>L</th><th>LV</th><th>A</th></tr></thead><tbody>';
    S.attGrid = [];
    members.forEach((u) => {
      const cnt = { P: 0, L: 0, LV: 0, A: 0 };
      const line = [u.name];
      h += '<tr><td><div style="display:flex;gap:8px;align-items:center">' + avatar(u, 26) + '<div><b>' + esc(u.name) + '</b><div class="cell-sub">' + esc(u.designation || u.role) + '</div></div></div></td>';
      for (let d = 1; d <= days; d++) {
        const ds = st.month + '-' + pad(d);
        const r = byKey[u.email.toLowerCase() + '|' + ds];
        const wd = new Date(ds + 'T00:00:00').getDay();
        let code = r ? ATT_CODE[r.status] || '?' : (firstDay && ds >= firstDay && ds < td && wd !== 0 ? 'A' : '');
        if (code === 'P' || code === 'L' || code === 'H') cnt.P++;
        if (code === 'L') cnt.L++;
        if (code === 'LV') cnt.LV++;
        if (code === 'A') cnt.A++;
        line.push(code);
        const tip = r ? r.status + (r.checkIn ? ' · ' + r.checkIn : '') + (r.checkOut ? '–' + r.checkOut : '') + (r.notes ? ' · ' + r.notes : '') : (code === 'A' ? 'No attendance' : '');
        h += '<td>' + (code || isAdmin() ? '<span class="att-cell ' + code + (isAdmin() ? ' clickable' : '') + '" title="' + esc(tip) + '"' + (isAdmin() ? ' data-act="att-edit" data-email="' + esc(u.email) + '" data-date="' + ds + '"' : '') + '>' + (code || '·') + '</span>' : '') + '</td>';
      }
      h += '<td><b>' + cnt.P + '</b></td><td>' + cnt.L + '</td><td>' + cnt.LV + '</td><td>' + cnt.A + '</td></tr>';
      S.attGrid.push(line.concat([cnt.P, cnt.L, cnt.LV, cnt.A]));
    });
    h += '</tbody></table></div></div><p class="small muted">P present · L late (after ' + esc((S.settings.attendance || {}).startTime || '10:00') + ') · H half day · LV leave · HO holiday · A no attendance on a working day (Sundays skipped).' + (isAdmin() ? ' Click a day to correct it.' : '') + '</p>';
    return h;
  }
  viewAttendance.after = function () {
    const st = ui('attendance');
    if (!S.attRows) S.attRows = {};
    if (!S.attRows[st.month] && S.attLoading !== st.month) {
      S.attLoading = st.month;
      api('attendanceList', { from: st.month + '-01', to: monthEnd(st.month) }).then((r) => {
        S.attRows[st.month] = r.rows;
        S.attLoading = null;
        if (route().page === 'attendance') renderPage();
      }).catch((e) => { S.attLoading = null; toast(e.message, true); });
    }
    if (!S.ips) publicIps().then(() => { if (route().page === 'attendance') renderPage(); });
  };

  function openAttEdit(email, date) {
    const u = S.users.find((x) => x.email.toLowerCase() === email.toLowerCase());
    const r = (S.attRows[ui('attendance').month] || []).find((x) => x.email.toLowerCase() === email.toLowerCase() && x.date === date) || {};
    openModal('Attendance · ' + (u ? u.name : email) + ' · ' + fmtDate(date), '<div class="form-grid">' +
      '<label class="field">Status<select class="input" name="status">' + ATT_STATUS.map((s) => '<option' + (s === (r.status || 'Present') ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label><span></span>' +
      '<label class="field">In<input class="input" type="time" name="checkIn" value="' + esc(r.checkIn || '') + '"></label>' +
      '<label class="field">Out<input class="input" type="time" name="checkOut" value="' + esc(r.checkOut || '') + '"></label>' +
      '<label class="field full">Note<input class="input" name="notes" value="' + esc(r.notes || '') + '" placeholder="e.g. Site visit, sick leave"></label></div>' +
      (r.ip ? '<p class="small muted">Marked from ' + esc(r.method || '') + ' · IP ' + esc(r.ip) + '</p>' : ''), {
      submit: 'Save',
      onSubmit: async (f) => {
        await api('attendanceSave', { record: { email: email, date: date, status: f.status.value, checkIn: f.checkIn.value, checkOut: f.checkOut.value, notes: f.notes.value } });
        delete S.attRows[ui('attendance').month];
        toast('Attendance updated');
        renderPage();
      },
    });
  }

  // ---------------------------------------------------------------------------
  // My account — each member's own profile, salary, advances, expenses
  // ---------------------------------------------------------------------------
  function mySalary(month) {
    const me = S.me;
    const e = me.employee;
    const exp = me.expenses.filter((x) => x.salaryMonth === month);
    const adv = me.advances.filter((x) => x.salaryMonth === month);
    const pay = me.payments.find((x) => x.salaryMonth === month);
    const base = pay ? num(pay.baseSalary) : num(e.monthlySalary);
    const expenses = sum(exp, 'amount');
    const advances = sum(adv, 'amount');
    const deduction = pay ? num(pay.deduction) : 0;
    const bonus = pay ? num(pay.bonus) : 0;
    const net = round2(base + expenses - advances - deduction + bonus);
    const paid = pay ? num(pay.paidAmount) : 0;
    return { month, exp, adv, pay, base, expenses, advances, deduction, bonus, net, paid, balance: round2(net - paid) };
  }

  function viewMe() {
    const u = S.user;
    const st = ui('me');
    if (!st.month) st.month = thisMonth();
    let h = '<div class="card" style="margin-bottom:16px"><div class="card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
      '<label title="Change photo" style="cursor:pointer;position:relative">' + avatar(u, 72) +
      '<input type="file" accept="image/*" id="photo-input" style="display:none"><span class="badge" style="position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);background:var(--surface)">Edit</span></label>' +
      '<div style="flex:1;min-width:200px"><h1>' + esc(u.name) + '</h1><div class="detail-meta"><span>' + esc(u.designation || '') + '</span><span>' + esc(u.email) + '</span>' + statusBadge(u.role) + '</div>' +
      (u.photo ? '<button class="btn ghost sm" data-act="photo-remove" style="margin-top:6px;padding-left:0">Remove photo</button>' : '<div class="small muted" style="margin-top:6px">Click the circle to add your photo</div>') + '</div>' +
      '<div class="page-actions"><a class="btn" href="#/attendance">' + icon('attendance') + 'My attendance</a><a class="btn" href="#/estimates">' + icon('estimate') + 'My estimates</a></div></div></div>';

    const me = S.me || {};
    const e = me.employee;
    if (!e) {
      return h + '<div class="card"><div class="empty">Your login is not linked to an employee record yet, so salary details can’t be shown.<br>Ask an Admin to link it in Settings → Members.</div></div>';
    }
    const s = mySalary(st.month);
    const status = !s.pay ? (st.month >= thisMonth() ? 'Pending' : 'Pending') : s.balance > 0.009 ? 'Partial' : 'Paid';
    h += '<div class="filters"><input class="input" type="month" data-filter="month" value="' + esc(st.month) + '" aria-label="Month"></div>';
    h += '<div class="kpis">' + kpi('Monthly salary', inr(e.monthlySalary), esc([e.empCode, e.joiningDate && 'Joined ' + fmtDate(e.joiningDate)].filter(Boolean).join(' · '))) +
      kpi('+ Expenses · ' + fmtMonth(st.month), inr(s.expenses), plural(s.exp.length, 'entry').replace('entrys', 'entries'), 'good') +
      kpi('− Advances · ' + fmtMonth(st.month), inr(s.advances), plural(s.adv.length, 'advance'), s.advances ? 'bad' : '') +
      kpi('Net payable', inr(s.net), status === 'Paid' ? 'Paid on ' + fmtDate(s.pay.paidDate) : status === 'Partial' ? 'Balance ' + inr(s.balance) : 'Not paid yet') + '</div>';

    h += '<div class="two-col"><div class="card"><div class="card-head"><h2>Salary slip · ' + esc(fmtMonth(st.month)) + '</h2>' + statusBadge(status) + '</div><div class="card-body"><div class="breakdown">' +
      '<span>Base salary</span><span class="num">' + inr(s.base) + '</span>' +
      '<span>+ Expenses</span><span class="num pos">' + inr(s.expenses) + '</span>' +
      '<span>− Advances</span><span class="num neg">' + inr(s.advances) + '</span>' +
      (s.deduction ? '<span>− Other deduction</span><span class="num neg">' + inr(s.deduction) + '</span>' : '') +
      (s.bonus ? '<span>+ Bonus / other</span><span class="num pos">' + inr(s.bonus) + '</span>' : '') +
      '<span class="total">Net payable</span><span class="total num">' + inr(s.net) + '</span>' +
      '<span>Paid' + (s.pay ? ' on ' + esc(fmtDate(s.pay.paidDate)) + (s.pay.mode ? ' · ' + esc(s.pay.mode) : '') : '') + '</span><span class="num">' + inr(s.paid) + '</span>' +
      '</div>' + (e.bankDetails ? '<p class="small muted" style="margin-bottom:0">Paid to: ' + esc(e.bankDetails) + '</p>' : '') + '</div></div>';
    const hist = [];
    for (let i = 0; i < 12; i++) {
      const m = addMonths(thisMonth(), -i);
      if (e.joiningDate && monthEnd(m) < e.joiningDate) break;
      hist.push(Object.assign({ id: m }, mySalary(m)));
    }
    h += '<div class="card"><div class="card-head"><h2>Last 12 months</h2></div><div class="card-body">' + dataTable('me-hist', [
      { k: 'month', l: 'Month', primary: true, f: (x) => esc(fmtMonth(x.month)) },
      { k: 'net', l: 'Net', r: true, v: (x) => x.net, f: (x) => inr(x.net) },
      { k: 'paid', l: 'Paid', r: true, v: (x) => x.paid, f: (x) => (x.pay ? inr(x.paid) : statusBadge('Pending')) },
    ], hist, { onRow: 'me-month' }) + '</div></div></div>';

    h += '<h2 style="margin:8px 0 10px">My expenses · ' + esc(fmtMonth(st.month)) + '</h2><div class="card" style="margin-bottom:16px">' + dataTable('me-exp', [
      { k: 'date', l: 'Date', f: (r) => esc(fmtDate(r.date)) },
      { k: 'expenseType', l: 'Expense', primary: true, f: (r) => '<b>' + esc(r.expenseType) + '</b>' + (r.fromTo ? '<div class="cell-sub">' + esc(r.fromTo) + '</div>' : '') },
      { k: 'km', l: 'Km × rate', r: true, f: (r) => (r.km ? esc(r.km) + ' km × ' + inr(r.rate) : '') },
      { k: 'amount', l: 'Amount', r: true, total: true, v: (r) => num(r.amount), f: (r) => inr(r.amount) },
    ], s.exp, { sort: { k: 'date', dir: 'asc' }, empty: 'No expenses added for this month' }) + '</div>';
    h += '<h2 style="margin:8px 0 10px">My advances</h2><div class="card">' + dataTable('me-adv', [
      { k: 'date', l: 'Date', primary: true, f: (r) => esc(fmtDate(r.date)) },
      { k: 'salaryMonth', l: 'Deducted from', f: (r) => esc(fmtMonth(r.salaryMonth)) },
      { k: 'mode', l: 'Mode', f: (r) => esc(r.mode) },
      { k: 'amount', l: 'Amount', r: true, total: true, v: (r) => num(r.amount), f: (r) => inr(r.amount) },
    ], (S.me.advances || []).filter((r) => r.salaryMonth === st.month || r.date.slice(0, 7) === st.month), { sort: { k: 'date', dir: 'desc' }, empty: 'No advances this month' }) + '</div>';
    return h;
  }
  viewMe.after = function () {
    const inp = $('#photo-input');
    if (inp) inp.addEventListener('change', () => { if (inp.files[0]) uploadPhoto(inp.files[0]); });
  };

  function uploadPhoto(file) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      const size = 160;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const side = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      let q = 0.82;
      let data = c.toDataURL('image/jpeg', q);
      while (data.length > 40000 && q > 0.3) { q -= 0.12; data = c.toDataURL('image/jpeg', q); }
      try { await savePhoto(data); toast('Photo updated'); } catch (e) { toast(e.message, true); }
    };
    img.onerror = () => toast('Could not read this image', true);
    img.src = url;
  }
  async function savePhoto(data) {
    const r = await api('setPhoto', { photo: data });
    S.user.photo = r.photo;
    const mine = S.users.find((x) => x.id === S.user.id);
    if (mine) mine.photo = r.photo;
    renderShell();
    renderPage();
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  const LIST_LABELS = {
    workTypes: 'Work types', costTypes: 'Cost types (site)', units: 'Units', projectTypes: 'Project types', clientStatus: 'Client statuses',
    officeCategories: 'Office expense categories', expenseTypes: 'Employee expense types', paymentModes: 'Payment modes', designations: 'Designations',
  };

  function viewSettings() {
    const st = ui('settings');
    const items = [['profile', 'My profile']];
    if (canWrite()) items.push(['lists', 'Dropdown lists']);
    if (isAdmin()) items.push(['members', 'Members', S.users.length], ['company', 'Company'], ['attendance', 'Attendance'], ['import', 'Import data'], ['activity', 'Activity log']);
    if (!items.some((i) => i[0] === st.tab)) st.tab = 'profile';
    let h = pageHead('Settings', '');
    h += tabs('settings', items, 'profile');

    if (st.tab === 'profile') {
      const u = S.user;
      h += '<div class="two-col"><div class="card"><div class="card-head"><h2>Profile</h2></div><div class="card-body"><div class="breakdown">' +
        '<span class="muted">Name</span><span>' + esc(u.name) + '</span><span class="muted">Email</span><span>' + esc(u.email) + '</span>' +
        '<span class="muted">Designation</span><span>' + esc(u.designation) + '</span><span class="muted">Access</span><span>' + statusBadge(u.role) + '</span></div>' +
        '<p class="small muted" style="margin-bottom:0">Admin (CEO, COO, VP Sales, IT): everything · Accountant: accounts + own estimates · Viewer: read-only accounts · Staff: own estimates and attendance</p></div></div>' +
        '<div class="card"><div class="card-head"><h2>Change password</h2></div><div class="card-body">' + passwordForm(false) + '</div></div></div>';
    } else if (st.tab === 'lists') {
      h += '<p class="muted" style="margin-top:0">One item per line. These options appear in the dropdowns across the app.</p>';
      h += '<form id="lists-form"><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">' +
        Object.keys(LIST_LABELS).map((k) => '<div class="card"><div class="card-body"><label class="field">' + esc(LIST_LABELS[k]) +
          '<textarea class="input" name="' + k + '" rows="7">' + esc(list(k).join('\n')) + '</textarea></label></div></div>').join('') +
        '</div><div style="margin-top:16px"><button class="btn primary" type="submit">Save lists</button></div></form>';
    } else if (st.tab === 'members') {
      h += '<div class="filters" style="justify-content:flex-end"><button class="btn primary" data-act="member-add">' + icon('plus') + 'Add member</button></div>';
      h += '<div class="card">' + dataTable('members', [
        { k: 'name', l: 'Member', primary: true, f: (u) => '<div style="display:flex;gap:10px;align-items:center">' + avatar(u, 30) + '<div><b>' + esc(u.name) + '</b><div class="cell-sub">' + esc(u.designation || '') + (u.employeeId && byId('Employees', u.employeeId) ? ' · Employee: ' + esc(byId('Employees', u.employeeId).name) : '') + '</div></div></div>' },
        { k: 'email', l: 'Email', f: (u) => esc(u.email) + (u.phone ? '<div class="cell-sub">' + esc(u.phone) + '</div>' : '') },
        { k: 'role', l: 'Access', f: (u) => statusBadge(u.role) },
        { k: 'status', l: 'Status', f: (u) => statusBadge(u.status) + (u.mustChange ? '<div class="cell-sub">Must set password</div>' : '') },
        { k: 'lastLogin', l: 'Last login', f: (u) => esc(fmtStamp(u.lastLogin)) },
      ], S.users, {
        sort: { k: 'name', dir: 'asc' },
        actions: (u) => '<button class="btn ghost sm icon" title="Edit" data-act="member-edit" data-id="' + esc(u.id) + '">' + icon('edit') + '</button>' +
          (u.id === S.user.id ? '' : '<button class="btn ghost sm icon" title="Reset password" data-act="member-reset" data-id="' + esc(u.id) + '">' + icon('key') + '</button>'),
      }) + '</div>';
    } else if (st.tab === 'company') {
      const c = S.settings.company;
      const f = (k, l, hint, type) => '<label class="field">' + l + '<input class="input" name="' + k + '"' + (type ? ' type="' + type + '" step="any"' : '') + ' value="' + esc(c[k] === undefined ? '' : c[k]) + '">' + (hint ? '<span class="field-hint">' + hint + '</span>' : '') + '</label>';
      h += '<form id="company-form"><div class="two-col"><div class="card"><div class="card-head"><h2>Company</h2></div><div class="card-body" style="display:flex;flex-direction:column;gap:14px">' +
        f('name', 'Company name') + f('website', 'Website') + f('gstNo', 'GST No') + f('address', 'Address (printed on estimates)') + f('serviceArea', 'Service area') +
        f('logoUrl', 'Logo URL', 'Shown in the app and on estimates') + f('perKmRate', 'Default bike rate per km (₹)', 'Used for employee travel unless the employee has their own rate', 'number') +
        '</div></div><div class="card"><div class="card-head"><h2>Estimates</h2></div><div class="card-body" style="display:flex;flex-direction:column;gap:14px">' +
        f('bankName', 'Bank name') + f('bankAccount', 'Account no.') + f('bankIfsc', 'IFSC code') +
        f('estimatePrefix', 'Estimate number prefix', 'Number = prefix + month + day + counter, e.g. RFIUL1101227') + f('estimateValidDays', 'Valid for (days)', '', 'number') +
        '<label class="field">Last estimate counter<input class="input" name="estimateCounter" type="number" value="' + esc(S.settings.estimateCounter) + '"><span class="field-hint">The next estimate gets this + 1. Set it above the last number used on the old estimate page.</span></label>' +
        (S.settings.estimateTemplate ? '<button type="button" class="btn sm" data-act="tpl-reset" style="align-self:flex-start">Reset estimate template to default</button>' : '') +
        '</div></div></div><button class="btn primary" type="submit">Save</button></form>';
    } else if (st.tab === 'attendance') {
      const a = S.settings.attendance;
      h += '<form id="att-form"><div class="two-col"><div class="card"><div class="card-head"><h2>Office network</h2></div><div class="card-body" style="display:flex;flex-direction:column;gap:14px">' +
        '<label class="field">Allowed office IP prefixes<textarea class="input" name="ipPrefixes" rows="4">' + esc(a.ipPrefixes.join('\n')) + '</textarea>' +
        '<span class="field-hint">One per line. For IPv6 use the first 4 groups (the office network), e.g. 2406:b400:71:93ee — each device in the office gets its own address inside it. For IPv4 use the full public IP.</span></label>' +
        '<button type="button" class="btn" data-act="att-net" style="align-self:flex-start">Add the network I am on now</button>' +
        '<label class="field">Office start time<input class="input" type="time" name="startTime" value="' + esc(a.startTime) + '"><span class="field-hint">Check-in after this time is marked Late</span></label>' +
        '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="autoMark"' + (a.autoMark ? ' checked' : '') + '> Mark attendance automatically when someone opens the dashboard in the office</label>' +
        '</div></div><div class="card"><div class="card-head"><h2>Office location (optional)</h2></div><div class="card-body" style="display:flex;flex-direction:column;gap:14px">' +
        '<p class="muted" style="margin:0">Backup for days the office internet is down: allow check-in by phone location within a radius of the office. G-12, Express Green Plaza, Sector 1, Vaishali.</p>' +
        '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="geoEnabled"' + (a.geo.enabled ? ' checked' : '') + '> Allow check-in by location</label>' +
        '<div class="form-grid"><label class="field">Latitude<input class="input" name="lat" value="' + esc(a.geo.lat) + '"></label><label class="field">Longitude<input class="input" name="lng" value="' + esc(a.geo.lng) + '"></label></div>' +
        '<label class="field">Radius (metres)<input class="input" type="number" name="radius" value="' + esc(a.geo.radius) + '"></label>' +
        '<button type="button" class="btn" data-act="att-here" style="align-self:flex-start">Use my current location (stand in the office)</button>' +
        '</div></div></div><button class="btn primary" type="submit">Save</button></form>';
    } else if (st.tab === 'import') {
      const imps = S.settings.imports || [];
      h += '<div class="two-col"><div class="card"><div class="card-head"><h2>Import from a file</h2></div><div class="card-body">' +
        '<p class="muted" style="margin-top:0">Choose an Account Master import file (<code>.json</code>). You will see what it contains before anything is saved. Every imported row is tagged, so the whole import can be undone.</p>' +
        '<input class="input" type="file" accept=".json,application/json" id="import-file" style="height:auto;padding:8px">' +
        '<div id="import-preview" style="margin-top:14px"></div></div></div>' +
        '<div class="card"><div class="card-head"><h2>Past imports</h2></div><div class="card-body">' +
        (imps.length ? imps.map((i) => '<div style="padding:10px 0;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>' + esc(i.tag) + '</b>' +
          (i.undone ? '<span class="badge">Undone</span>' : '<button class="btn sm danger" data-act="import-undo" data-id="' + esc(i.tag) + '">Undo</button>') + '</div>' +
          '<div class="small muted">' + esc(fmtStamp(i.at)) + ' by ' + esc(userName(i.by)) + (i.source ? ' · ' + esc(i.source) : '') + '</div>' +
          '<div class="small">' + Object.keys(i.counts || {}).filter((k) => i.counts[k]).map((k) => esc(k) + ' ' + i.counts[k]).join(' · ') + '</div></div>').join('')
          : '<div class="empty">No imports yet</div>') + '</div></div></div>';
    } else if (st.tab === 'activity') {
      h += '<div class="card" id="activity"><div class="loading" style="min-height:160px"><div class="spinner"></div></div></div>';
    }
    return h;
  }
  viewSettings.after = function () {
    const st = ui('settings');
    if (st.tab === 'profile') bindPasswordForm();
    if (st.tab === 'lists') {
      $('#lists-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const lists = {};
        Object.keys(LIST_LABELS).forEach((k) => { lists[k] = e.target.elements[k].value.split('\n').map((x) => x.trim()).filter(Boolean); });
        try {
          const r = await api('saveSettings', { settings: { lists: lists } });
          S.settings = r.settings;
          toast('Lists saved');
        } catch (ex) { toast(ex.message, true); }
      });
    }
    if (st.tab === 'company') {
      $('#company-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const fd = e.target.elements;
          const company = {};
          ['name', 'website', 'gstNo', 'address', 'serviceArea', 'logoUrl', 'perKmRate', 'bankName', 'bankAccount', 'bankIfsc', 'estimatePrefix', 'estimateValidDays'].forEach((k) => { company[k] = fd[k].value; });
          const r = await api('saveSettings', { settings: { company: company, estimateCounter: fd.estimateCounter.value } });
          S.settings = r.settings;
          toast('Company settings saved');
        } catch (ex) { toast(ex.message, true); }
      });
    }
    if (st.tab === 'attendance') {
      $('#att-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = e.target.elements;
        try {
          const r = await api('saveSettings', { settings: { attendance: {
            ipPrefixes: fd.ipPrefixes.value.split('\n').map((x) => x.trim()).filter(Boolean), startTime: fd.startTime.value, autoMark: fd.autoMark.checked,
            geo: { enabled: fd.geoEnabled.checked, lat: fd.lat.value, lng: fd.lng.value, radius: fd.radius.value },
          } } });
          S.settings = r.settings;
          toast('Attendance settings saved');
        } catch (ex) { toast(ex.message, true); }
      });
    }
    if (st.tab === 'import') {
      $('#import-file').addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          let d;
          try { d = JSON.parse(rd.result); } catch (err) { $('#import-preview').innerHTML = '<div class="form-error">This file is not valid JSON.</div>'; return; }
          if (!d || d.format !== 'account-master-import') { $('#import-preview').innerHTML = '<div class="form-error">This is not an Account Master import file.</div>'; return; }
          S.pendingImport = d;
          const rows = [
            ['Employees (added or updated)', (d.employees || []).length, ''],
            ['Clients', (d.clients || []).length, sum(d.clients || [], 'approvedAmount') ? 'Approved ' + inr(sum(d.clients || [], 'approvedAmount')) : ''],
            ['Client payments', (d.ClientPayments || []).length, inr(sum(d.ClientPayments || [], 'amount'))],
            ['Site labour / material', (d.ClientWork || []).length, inr(sum(d.ClientWork || [], 'amount'))],
            ['Office expenses', (d.OfficeExpenses || []).length, inr(sum(d.OfficeExpenses || [], 'amount'))],
            ['Salary advances', (d.SalaryAdvances || []).length, inr(sum(d.SalaryAdvances || [], 'amount'))],
            ['Salary payments', (d.SalaryPayments || []).length, inr(sum(d.SalaryPayments || [], 'paidAmount'))],
          ];
          $('#import-preview').innerHTML = '<div class="small muted">' + esc(d.source || '') + '</div><div class="breakdown" style="margin:10px 0 14px">' +
            rows.map((r) => '<span>' + esc(r[0]) + ' <span class="muted">(' + r[1] + ')</span></span><span class="num">' + r[2] + '</span>').join('') + '</div>' +
            '<button class="btn primary" data-act="import-run">Import ' + esc(d.tag) + '</button>';
        };
        rd.readAsText(f);
      });
    }
    if (st.tab === 'activity') {
      api('audit', { limit: 300 }).then((r) => {
        const el = $('#activity');
        if (!el) return;
        el.innerHTML = dataTable('activity', [
          { k: 'timestamp', l: 'When', f: (x) => esc(fmtStamp(x.timestamp)) },
          { k: 'user', l: 'Who', primary: true, f: (x) => esc(userName(x.user)) },
          { k: 'action', l: 'Action', f: (x) => '<span class="badge">' + esc(x.action) + '</span> ' + esc(x.table) },
          { k: 'details', l: 'Details', f: (x) => '<span class="small">' + esc(x.details) + '</span>' },
        ], r.rows.map((x, i) => Object.assign({ id: String(i) }, x)), { empty: 'No activity yet' });
      }).catch((e) => toast(e.message, true));
    }
  };

  function openMember(u) {
    const isNew = !u;
    u = u || { role: 'Accountant', status: 'Active' };
    const opt = (arr, v) => arr.map((o) => '<option' + (o === v ? ' selected' : '') + '>' + o + '</option>').join('');
    const body = '<div class="form-grid">' +
      '<label class="field">Name <input class="input" name="name" value="' + esc(u.name || '') + '"></label>' +
      '<label class="field">Designation<input class="input" name="designation" value="' + esc(u.designation || '') + '"></label>' +
      '<label class="field">Email (login ID)<input class="input" type="email" name="email" value="' + esc(u.email || '') + '"></label>' +
      '<label class="field">Mobile<input class="input" type="tel" name="phone" value="' + esc(u.phone || '') + '"></label>' +
      '<label class="field">Access<select class="input" name="role">' + opt(['Admin', 'Accountant', 'Viewer', 'Staff'], u.role) + '</select></label>' +
      '<label class="field">Status<select class="input" name="status">' + opt(['Active', 'Inactive'], u.status) + '</select></label>' +
      '<label class="field full">Linked employee<select class="input" name="employeeId"><option value="">Automatic (same email or name)</option>' +
        rows('Employees').slice().sort((a, b) => a.name.localeCompare(b.name)).map((e) => '<option value="' + esc(e.id) + '"' + (e.id === u.employeeId ? ' selected' : '') + '>' + esc(e.name + (e.designation ? ' · ' + e.designation : '')) + '</option>').join('') +
        '</select><span class="field-hint">Their salary, advances and expenses show on their own “My account” page</span></label>' +
      (isNew ? '<label class="field full">One-time password<input class="input" name="password" type="text" autocomplete="off" value="' + esc(tempPassword()) + '"><span class="field-hint">Share this with the member. They must set their own password at first login.</span></label>' : '') +
      '</div>';
    openModal(isNew ? 'Add member' : 'Edit member', body, {
      submit: isNew ? 'Add member' : 'Save changes',
      onSubmit: async (form) => {
        const rec = { id: u.id, name: form.name.value, designation: form.designation.value, email: form.email.value, phone: form.phone.value, role: form.role.value, status: form.status.value, employeeId: form.employeeId.value };
        await api('saveUser', { record: rec, password: isNew ? form.password.value : '' });
        await loadAll();
        toast(isNew ? 'Member added' : 'Member updated');
        renderPage();
      },
    });
  }

  function openReset(u) {
    openModal('Reset password · ' + u.name, '<label class="field">New one-time password<input class="input" name="password" type="text" autocomplete="off" value="' + esc(tempPassword()) + '"><span class="field-hint">The member will be logged out and must set their own password at next login.</span></label>', {
      submit: 'Reset password',
      onSubmit: async (form) => {
        await api('resetPassword', { id: u.id, password: form.password.value });
        await loadAll();
        toast('Password reset — share the new password with ' + u.name);
        renderPage();
      },
    });
  }

  function tempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const a = new Uint32Array(8);
    crypto.getRandomValues(a);
    return 'UL@' + Array.from(a, (x) => chars[x % chars.length]).join('');
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) {
      if (e.target.closest('.nav a')) $('.shell') && $('.shell').classList.remove('nav-open');
      return;
    }
    const act = el.dataset.act;
    if (act === 'modal-bg' && e.target !== el) return;
    switch (act) {
      case 'modal-bg':
      case 'modal-close': closeModal(); break;
      case 'nav-open': $('.shell').classList.add('nav-open'); break;
      case 'nav-close': $('.shell').classList.remove('nav-open'); break;
      case 'logout':
        if (S.attendanceToday && S.ips && S.ips.list.some(ipAllowed)) {
          await Promise.race([markAttendance('out').catch(() => null), new Promise((res) => setTimeout(res, 3000))]);
        }
        try { await api('logout'); } catch (err) { /* already logged out */ }
        clearSession();
        render();
        break;
      case 'theme': {
        const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        store.set('am_theme', next);
        break;
      }
      case 'reload':
        try { await loadAll(); toast('Data refreshed'); renderPage(); } catch (err) { toast(err.message, true); }
        break;
      case 'tab': ui(el.dataset.page).tab = el.dataset.tab; renderPage(); break;
      case 'sort': {
        S.ui.sort = S.ui.sort || {};
        const cur = S.ui.sort[el.dataset.id];
        S.ui.sort[el.dataset.id] = { k: el.dataset.k, dir: cur && cur.k === el.dataset.k && cur.dir === 'asc' ? 'desc' : 'asc' };
        renderPage();
        break;
      }
      case 'add': openForm(el.dataset.t, null, el.dataset.presets ? JSON.parse(el.dataset.presets) : null); break;
      case 'edit': e.stopPropagation(); openForm(el.dataset.t, byId(el.dataset.t, el.dataset.id)); break;
      case 'del': e.stopPropagation(); deleteRecord(el.dataset.t, el.dataset.id); break;
      case 'pay': e.stopPropagation(); openSalaryPay(el.dataset.id, el.dataset.month); break;
      case 'open-client': if (!e.target.closest('button, a')) location.hash = '#/clients/' + encodeURIComponent(el.dataset.id); break;
      case 'open-emp': if (!e.target.closest('button, a')) location.hash = '#/employees/' + encodeURIComponent(el.dataset.id); break;
      case 'emp-month': ui('employee').month = el.dataset.id; renderPage(); window.scrollTo(0, 0); break;
      case 'csv': exportCsv(el.dataset.id); break;
      case 'open-sheet-tab': e.preventDefault(); location.hash = '#/sheet'; loadSheetTab(el.dataset.id); break;
      case 'sheet-tab': ui('sheet').q = ''; loadSheetTab(el.dataset.id); break;
      case 'sheet-reload': loadSheetTab(S.sheet && S.sheet.name); break;
      case 'sheet-add': openSheetRow(0); break;
      case 'sheet-edit': openSheetRow(Number(el.dataset.id)); break;
      case 'sheet-del': deleteSheetRow(Number(el.dataset.id)); break;
      case 'sheet-addcol': openAddColumn(); break;
      case 'sheet-hide': {
        const name = S.sheet.name;
        const cur = S.settings.hiddenTabs || [];
        const next = cur.includes(name) ? cur.filter((t) => t !== name) : cur.concat([name]);
        try { const r = await api('setHiddenTabs', { tabs: next }); S.settings = r.settings; toast(next.includes(name) ? 'Tab hidden from Accountants and Viewers' : 'Tab visible to everyone'); renderPage(); } catch (err) { toast(err.message, true); }
        break;
      }
      case 'import-run': {
        if (!S.pendingImport || !confirm('Import ' + S.pendingImport.tag + ' into the Google Sheet?')) break;
        el.disabled = true; el.textContent = 'Importing… (can take a minute)';
        try {
          const r = await api('importBatch', { data: S.pendingImport });
          S.pendingImport = null;
          await loadAll();
          toast('Imported: ' + Object.keys(r.counts).filter((k) => r.counts[k]).map((k) => k + ' ' + r.counts[k]).join(', '));
          renderPage();
        } catch (err) { toast(err.message, true); el.disabled = false; el.textContent = 'Import'; }
        break;
      }
      case 'import-undo': {
        if (!confirm('Undo import ' + el.dataset.id + '? All rows it added will be deleted from the sheet.')) break;
        el.disabled = true;
        try { const r = await api('undoImport', { tag: el.dataset.id }); await loadAll(); toast('Undone: ' + Object.keys(r.counts).filter((k) => r.counts[k]).map((k) => k + ' ' + r.counts[k]).join(', ')); renderPage(); } catch (err) { toast(err.message, true); el.disabled = false; }
        break;
      }
      case 'emp-link': openEmployeeLink(); break;
      case 'emp-unlink': unlinkEmployees(); break;
      case 'emp-sync':
        el.disabled = true;
        syncEmployees(false).catch((err) => toast(err.message, true)).finally(() => { el.disabled = false; });
        break;
      case 'print': window.print(); break;
      case 'open-est': if (!e.target.closest('button, a')) location.hash = '#/estimates/' + encodeURIComponent(el.dataset.id); break;
      case 'est-op': estOp(el.dataset.op, Number(el.dataset.s), Number(el.dataset.i)); break;
      case 'est-edit': S.est.editing = true; S.est.newLogs = []; renderPage(); break;
      case 'est-cancel':
        if (S.est.dirty && !confirm('Discard your changes?')) break;
        if (S.est.id) { const id = S.est.id; S.est = null; S.estError = null; location.hash = '#/estimates/' + encodeURIComponent(id); renderPage(); } else { S.est = null; location.hash = '#/estimates'; }
        break;
      case 'est-back': case 'est-blank':
        if (S.est && S.est.editing && S.est.dirty && !confirm('Discard your changes?')) { e.preventDefault(); break; }
        if (act === 'est-blank') { e.preventDefault(); S.est = blankEstimate(); location.hash = '#/estimates/new'; renderPage(); }
        break;
      case 'est-copy': {
        const c = S.est;
        S.est = Object.assign(blankEstimate(), { client: clone(c.client), sections: clone(c.sections), specs: clone(c.specs), terms: clone(c.terms), newLogs: ['Copied from ' + c.estimateNo + ' V' + c.version], dirty: true });
        location.hash = '#/estimates/new';
        renderPage();
        break;
      }
      case 'est-save': estSave(el.dataset.mode, el); break;
      case 'est-print': estPrint(); break;
      case 'est-del':
        if (!confirm('Delete ' + S.est.estimateNo + (S.est.version > 1 ? ' V' + S.est.version : ' (original)') + '? Other versions stay.')) break;
        try { const r = await api('estimateDelete', { id: S.est.id }); S.estimates = r.estimates; S.est = null; toast('Deleted'); location.hash = '#/estimates'; } catch (err) { toast(err.message, true); }
        break;
      case 'est-client':
        if (!confirm('Create a client from ' + S.est.estimateNo + ' with approved amount ' + inr(estGrand(S.est)) + '?')) break;
        try {
          const r = await api('estimateToClient', { estimateNo: S.est.estimateNo });
          S.estimates = r.estimates;
          (S.data.Clients || (S.data.Clients = [])).push(r.client);
          S.est.clientId = r.client.id;
          S.est.status = 'Approved';
          toast('Client ' + r.client.name + ' created');
          renderPage();
        } catch (err) { toast(err.message, true); }
        break;
      case 'est-template':
        if (!confirm('Make this estimate the starting template for every new estimate? (Amounts are cleared.)')) break;
        try {
          const tpl = { sections: clone(S.est.sections).map((x) => ({ title: x.title, items: x.items.map((i) => Object.assign(i, { amount: '' })) })), specs: clone(S.est.specs), terms: clone(S.est.terms) };
          const r = await api('saveSettings', { settings: { estimateTemplate: tpl } });
          S.settings = r.settings;
          toast('Template saved');
        } catch (err) { toast(err.message, true); }
        break;
      case 'est-firebase': openFirebaseImport(); break;
      case 'photo-remove': if (confirm('Remove your photo?')) { try { await savePhoto(''); toast('Photo removed'); } catch (err) { toast(err.message, true); } } break;
      case 'me-month': ui('me').month = el.dataset.id; renderPage(); window.scrollTo(0, 0); break;
      case 'tpl-reset':
        if (!confirm('Go back to the built-in estimate template?')) break;
        try { const r = await api('saveSettings', { settings: { estimateTemplate: null } }); S.settings = r.settings; toast('Template reset'); renderPage(); } catch (err) { toast(err.message, true); }
        break;
      case 'att-mark':
        el.disabled = true;
        try {
          const r = await markAttendance(el.dataset.kind, !!el.dataset.geo);
          toast(r.action === 'in' ? 'Checked in · ' + r.record.checkIn : r.action === 'out' ? 'Checked out · ' + r.record.checkOut : 'Already checked in');
        } catch (err) { toast(err.message, true); }
        renderPage();
        break;
      case 'att-edit': openAttEdit(el.dataset.email, el.dataset.date); break;
      case 'att-csv': {
        const m = ui('attendance').month;
        const days = Number(monthEnd(m).slice(8));
        const head = ['Member'].concat(Array.from({ length: days }, (_, k) => String(k + 1)), ['Present', 'Late', 'Leave', 'Absent']);
        const lines = [head].concat(S.attGrid || []).map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(','));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv' }));
        a.download = 'Attendance_' + m + '.csv';
        a.click();
        break;
      }
      case 'att-net': {
        try {
          const ips = await publicIps(true);
          const ta = $('#att-form [name=ipPrefixes]');
          const add = ips.list.map(netPrefix).filter((x) => !ta.value.split('\n').map((y) => y.trim()).includes(x));
          ta.value = ta.value.trim() + (add.length ? (ta.value.trim() ? '\n' : '') + add.join('\n') : '');
          toast(add.length ? 'Added ' + add.join(', ') + ' — press Save' : 'This network is already in the list');
        } catch (err) { toast(err.message, true); }
        break;
      }
      case 'att-here':
        try { const g = await getGeo(); $('#att-form [name=lat]').value = g.latitude.toFixed(6); $('#att-form [name=lng]').value = g.longitude.toFixed(6); toast('Location filled — press Save'); } catch (err) { toast(err.message, true); }
        break;
      case 'member-add': openMember(); break;
      case 'member-edit': openMember(S.users.find((u) => u.id === el.dataset.id)); break;
      case 'member-reset': openReset(S.users.find((u) => u.id === el.dataset.id)); break;
    }
  });

  function onFilter(e) {
    const el = e.target.closest('[data-filter]');
    if (!el) return;
    const page = route().page === 'clients' && route().id ? 'client' : route().page === 'employees' ? 'employee' : route().page;
    ui(page)[el.dataset.filter] = el.value;
    if (el.type === 'search' && e.type === 'change') return;
    renderPage();
  }
  document.addEventListener('input', (e) => {
    if (e.target.matches('input[type=search][data-filter]')) onFilter(e);
    if (e.target.matches('[data-ep]')) estOnInput(e.target);
  });
  document.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-act-change=est-status]')) return;
    try {
      const r = await api('estimateStatus', { estimateNo: S.est.estimateNo, status: e.target.value });
      S.estimates = r.estimates;
      S.est.status = e.target.value;
      toast('Status: ' + e.target.value);
    } catch (err) { toast(err.message, true); }
  });
  window.addEventListener('beforeunload', (e) => { if (S.est && S.est.editing && S.est.dirty) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('change', (e) => { if (e.target.matches('[data-filter]') && e.target.type !== 'search') onFilter(e); });
  document.addEventListener('change', (e) => { if (e.target.matches('[data-act-change=sheet-tab]')) { ui('sheet').q = ''; loadSheetTab(e.target.value); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal(); });
  window.addEventListener('hashchange', () => { closeModal(); S.estError = null; renderPage(); window.scrollTo(0, 0); });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function render() {
    if (!S.user) return renderLogin();
    if (S.user.mustChange) return renderForcedPassword();
    renderShell();
    renderPage();
  }

  async function start() {
    $('#root').innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading data…</div></div>';
    try {
      await loadAll();
    } catch (e) {
      if (e.code !== 'AUTH') toast(e.message, true);
      clearSession();
    }
    render();
    if (S.user && !S.user.mustChange) autoAttendance();
  }

  const savedTheme = store.get('am_theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  // ---------------------------------------------------------------------------
  // Demo backend (?demo=1) — mirrors the Apps Script API using localStorage
  // ---------------------------------------------------------------------------
  const Demo = (function () {
    const KEY = 'am_demo_db';
    const SEED_USERS = [
      ['Digvijay Jha', 'CEO', 'digvijay@urbaneliving.in', 'Admin'],
      ['Abhishek Mishra', 'COO', 'abhishek@urbaneliving.in', 'Admin'],
      ['Prem Jha', 'Account Executive', 'accounts@urbaneliving.in', 'Accountant'],
      ['Saban Jha', 'IT Manager', 'it@urbaneliving.in', 'Admin'],
    ];
    const DEFAULTS = {
      company: { name: 'Urbane Living', perKmRate: 3, website: 'urbaneliving.in', gstNo: '09AAJFU0647A1ZC', address: 'G-12, Express Green Plaza, Sector-1, Vaishali, Ghaziabad', serviceArea: 'Gurugram, Noida, Delhi, Ghaziabad', logoUrl: '', bankName: '', bankAccount: '', bankIfsc: '', estimatePrefix: 'RFIUL', estimateValidDays: 14 },
      attendance: { ipPrefixes: ['2406:b400:71:93ee'], startTime: '10:00', autoMark: false, geo: { enabled: false, lat: '', lng: '', radius: 200 } },
      estimateCounter: 226,
      estimateTemplate: null,
      imports: [],
      hiddenTabs: [],
      lists: {
        projectTypes: ['Residential', 'Commercial', 'Office', 'Showroom', 'Restaurant', 'Other'],
        clientStatus: ['Ongoing', 'Completed', 'On Hold', 'Cancelled'],
        workTypes: ['False Ceiling', 'Gypsum Ceiling', 'POP Ceiling', 'PVC Ceiling', 'Grid Ceiling', 'Wall Panelling', 'Partition', 'Painting', 'Electrical', 'Carpentry', 'Flooring', 'Other'],
        costTypes: ['Labour', 'Material', 'Transport', 'Other'],
        units: ['sq.ft', 'r.ft', 'nos', 'kg', 'bag', 'box', 'day', 'lot'],
        officeCategories: ['Office Rent', 'Electricity Bill', 'Water Bottle', 'Tea / Coffee / Milk / Sugar', 'Internet / Phone', 'Stationery', 'Cleaning', 'Repair & Maintenance', 'Other'],
        expenseTypes: ['Bike Travel (per km)', 'Fuel', 'Auto / Cab', 'Bus / Train', 'Food', 'Site Material', 'Mobile Recharge', 'Other'],
        paymentModes: ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card'],
        designations: ['CEO', 'COO', 'Account Executive', 'IT Manager', 'Sales Executive', 'Site Supervisor', 'Designer', 'Office Assistant', 'Helper'],
      },
    };
    const TABLE_NAMES = ['Clients', 'ClientWork', 'ClientPayments', 'OfficeExpenses', 'Employees', 'EmployeeExpenses', 'SalaryAdvances', 'SalaryPayments'];
    const PREFIX = { Clients: 'CL', ClientWork: 'CW', ClientPayments: 'CP', OfficeExpenses: 'OE', Employees: 'EM', EmployeeExpenses: 'EX', SalaryAdvances: 'AD', SalaryPayments: 'SP' };
    let db = null;

    const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const save = () => store.set(KEY, JSON.stringify(db));

    function seed() {
      const now = new Date().toISOString();
      const m0 = thisMonth();
      const m1 = addMonths(m0, -1);
      const m2 = addMonths(m0, -2);
      const d = (m, day) => m + '-' + pad(day);
      const meta = { createdBy: 'accounts@urbaneliving.in', createdAt: now };
      const t = {};
      TABLE_NAMES.forEach((n) => { t[n] = []; });
      const add = (n, r) => { const rec = Object.assign({ id: uid(PREFIX[n]) }, meta, r); t[n].push(rec); return rec; };
      const c1 = add('Clients', { clientCode: 'UL-C-0001', name: 'Rajesh Sharma (Demo)', phone: '98xxxxxx01', city: 'Noida Sec 62', siteAddress: 'Flat 1204, Tower B', projectType: 'Residential', workScope: 'Gypsum false ceiling + painting', estimateRef: 'EST-101', approvedAmount: 285000, startDate: d(m2, 5), status: 'Ongoing' });
      const c2 = add('Clients', { clientCode: 'UL-C-0002', name: 'Café Brew House (Demo)', phone: '98xxxxxx02', city: 'Gurugram', projectType: 'Restaurant', workScope: 'Grid ceiling + wall panelling', estimateRef: 'EST-104', approvedAmount: 420000, startDate: d(m1, 2), status: 'Ongoing' });
      const c3 = add('Clients', { clientCode: 'UL-C-0003', name: 'Neha Verma (Demo)', city: 'Ghaziabad', projectType: 'Residential', workScope: 'POP ceiling', estimateRef: 'EST-097', approvedAmount: 95000, startDate: d(m2, 1), endDate: d(m1, 20), status: 'Completed' });
      [[c1, m2, 8, 'Material', 'Gypsum board 12mm + channels', 'Saint-Gobain dealer', 300, 'sq.ft', 95], [c1, m2, 15, 'Labour', 'Ceiling framing labour', 'Ramesh contractor', 300, 'sq.ft', 22], [c1, m1, 6, 'Material', 'Paint & putty', 'Asian Paints store', 1, 'lot', 18500], [c1, m0, 3, 'Labour', 'Painting labour', 'Sonu painter', 6, 'day', 900],
        [c2, m1, 5, 'Material', 'Grid ceiling tiles 2x2', 'Armstrong distributor', 900, 'sq.ft', 85], [c2, m1, 12, 'Labour', 'Grid installation', 'Ramesh contractor', 900, 'sq.ft', 18], [c2, m0, 4, 'Material', 'WPC wall panels', 'Panel Hub', 40, 'nos', 1450],
        [c3, m2, 4, 'Material', 'POP & accessories', 'Local supplier', 1, 'lot', 21000], [c3, m2, 18, 'Labour', 'POP ceiling labour', 'Ajay team', 450, 'sq.ft', 30]]
        .forEach((w) => add('ClientWork', { clientId: w[0].id, date: d(w[1], w[2]), costType: w[3], workType: w[0] === c2 ? 'Grid Ceiling' : 'False Ceiling', description: w[4], vendor: w[5], qty: w[6], unit: w[7], rate: w[8], amount: w[6] * w[8], vendorPaid: w[2] > 10 && w[1] === m0 ? 'Unpaid' : 'Paid' }));
      [[c1, m2, 6, 100000, 'UPI'], [c1, m1, 10, 80000, 'Bank Transfer'], [c2, m1, 3, 150000, 'Cheque'], [c2, m0, 2, 100000, 'Bank Transfer'], [c3, m2, 2, 50000, 'Cash'], [c3, m1, 21, 45000, 'UPI']]
        .forEach((p) => add('ClientPayments', { clientId: p[0].id, date: d(p[1], p[2]), amount: p[3], mode: p[4], reference: p[4] === 'Cash' ? '' : 'Ref ' + Math.floor(Math.random() * 1e6) }));
      [m2, m1, m0].forEach((m) => {
        add('OfficeExpenses', { date: d(m, 1), category: 'Office Rent', description: 'Monthly rent', amount: 25000, mode: 'Bank Transfer', paidTo: 'Landlord' });
        add('OfficeExpenses', { date: d(m, 7), category: 'Electricity Bill', amount: 3200 + Math.floor(Math.random() * 800), mode: 'UPI', paidTo: 'Electricity board' });
        add('OfficeExpenses', { date: d(m, 9), category: 'Water Bottle', description: '20 bottles', amount: 600, mode: 'Cash' });
        add('OfficeExpenses', { date: d(m, 3), category: 'Tea / Coffee / Milk / Sugar', description: 'Monthly pantry', amount: 1450, mode: 'Cash' });
      });
      const e1 = add('Employees', { empCode: 'UL-E-0001', name: 'Amit Kumar (Demo)', designation: 'Sales Executive', phone: '97xxxxxx11', joiningDate: d(m2, 1), monthlySalary: 22000, status: 'Active' });
      const e2 = add('Employees', { empCode: 'UL-E-0002', name: 'Vikas Yadav (Demo)', designation: 'Site Supervisor', phone: '97xxxxxx12', joiningDate: d(m2, 1), monthlySalary: 26000, status: 'Active' });
      const e3 = add('Employees', { empCode: 'UL-E-0003', name: 'Pooja Singh (Demo)', designation: 'Office Assistant', joiningDate: d(m2, 1), monthlySalary: 15000, status: 'Active' });
      [[e1, m1, 4, 'Office → Noida Sec 62 site → Office', 34, c1], [e1, m1, 12, 'Office → Gurugram café → Office', 58, c2], [e1, m0, 2, 'Office → Gurugram café', 31, c2], [e2, m0, 5, 'Home → Noida site', 18, c1]]
        .forEach((x) => add('EmployeeExpenses', { employeeId: x[0].id, date: d(x[1], x[2]), expenseType: 'Bike Travel (per km)', fromTo: x[3], km: x[4], rate: 3, amount: x[4] * 3, clientId: x[5].id, salaryMonth: x[1] }));
      add('EmployeeExpenses', { employeeId: e2.id, date: d(m0, 6), expenseType: 'Site Material', clientId: c1.id, amount: 450, notes: 'Screws & tape', salaryMonth: m0 });
      add('SalaryAdvances', { employeeId: e2.id, date: d(m0, 3), amount: 5000, mode: 'Cash', salaryMonth: m0, notes: 'Family function' });
      add('SalaryAdvances', { employeeId: e1.id, date: d(m1, 15), amount: 3000, mode: 'UPI', salaryMonth: m1 });
      [e1, e2, e3].forEach((e) => {
        const exp = t.EmployeeExpenses.filter((x) => x.employeeId === e.id && x.salaryMonth === m1).reduce((a, x) => a + x.amount, 0);
        const adv = t.SalaryAdvances.filter((x) => x.employeeId === e.id && x.salaryMonth === m1).reduce((a, x) => a + x.amount, 0);
        const net = e.monthlySalary + exp - adv;
        add('SalaryPayments', { employeeId: e.id, salaryMonth: m1, baseSalary: e.monthlySalary, expenses: exp, advances: adv, deduction: 0, bonus: 0, netPayable: net, paidAmount: net, paidDate: d(m0, 1), mode: 'Bank Transfer' });
      });
      return {
        users: SEED_USERS.map((u, i) => ({ id: 'US-' + (i + 1), name: u[0], designation: u[1], email: u[2], role: u[3], status: 'Active', password: 'demo1234', mustChange: false })),
        settings: JSON.parse(JSON.stringify(DEFAULTS)),
        tables: t,
        sessions: {},
        audit: [],
      };
    }

    function ensure() {
      if (db) return;
      try { db = JSON.parse(store.get(KEY) || 'null'); } catch (e) { db = null; }
      if (!db) { db = seed(); save(); }
    }
    const pub = (u) => ({ id: u.id, name: u.name, designation: u.designation, email: u.email, phone: u.phone, role: u.role, status: u.status, mustChange: !!u.mustChange, lastLogin: u.lastLogin, employeeId: u.employeeId || '', photo: u.photo || '' });
    const fail = (msg, code) => ({ ok: false, error: msg, code: code || '' });

    function call(req) {
      ensure();
      if (req.action === 'login') {
        const u = db.users.find((x) => x.email === String(req.email || '').trim().toLowerCase());
        if (!u || u.status !== 'Active' || u.password !== req.password) return fail('Invalid email or password');
        const token = uid('T');
        db.sessions[token] = u.id;
        u.lastLogin = new Date().toISOString();
        save();
        return { ok: true, token: token, user: pub(u) };
      }
      const user = db.users.find((x) => x.id === db.sessions[req.token]);
      if (!user) return fail('Please log in', 'AUTH');
      const write = WRITE_ROLES.includes(user.role);
      const log = (action, table, id) => { db.audit.unshift({ timestamp: new Date().toISOString(), user: user.email, action: action, table: table, recordId: id, details: '' }); };
      switch (req.action) {
        case 'logout': delete db.sessions[req.token]; save(); return { ok: true };
        case 'bootstrap': {
          db.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), db.settings);
          db.estimates = db.estimates || [];
          db.attendance = db.attendance || [];
          const est = db.estimates.map((r) => { const o = Object.assign({}, r); delete o.data; delete o.logs; return o; });
          const emp = db.tables.Employees.find((e) => e.id === user.employeeId) || db.tables.Employees.find((e) => (e.email && e.email === user.email) || e.name.toLowerCase() === user.name.toLowerCase());
          const mine = (t) => (emp ? db.tables[t].filter((r) => r.employeeId === emp.id) : []);
          const me = emp ? { employee: emp, expenses: mine('EmployeeExpenses'), advances: mine('SalaryAdvances'), payments: mine('SalaryPayments') } : { employee: null };
          return { ok: true, me: me, user: pub(user), settings: db.settings, data: JSON.parse(JSON.stringify(db.tables)), users: db.users.map(pub), estimates: est, attendanceToday: db.attendance.find((r) => r.email === user.email && r.date === today()) || null };
        }
        case 'setPhoto': user.photo = req.photo; save(); return { ok: true, photo: req.photo };
        case 'estimateGet': { const r = (db.estimates || []).find((x) => x.id === req.id); return r ? { ok: true, record: JSON.parse(JSON.stringify(r)) } : fail('Estimate not found'); }
        case 'estimateSave': {
          db.estimates = db.estimates || [];
          const rec = req.record;
          const now = new Date().toISOString();
          const tot = rec.data.sections.reduce((a, x) => a + x.items.reduce((b, i) => b + (parseFloat(i.amount) || 0), 0), 0);
          let no = rec.estimateNo;
          let version = 1;
          if (req.mode === 'new') { db.settings.estimateCounter = (db.settings.estimateCounter || 226) + 1; no = 'RFIUL' + today().slice(5, 7) + today().slice(8) + db.settings.estimateCounter; }
          else version = Math.max.apply(null, db.estimates.filter((x) => x.estimateNo === no).map((x) => x.version)) + 1;
          const first = db.estimates.find((x) => x.estimateNo === no && x.version === 1);
          const o = { id: uid('ES'), estimateNo: no, version: version, isOriginal: version === 1, estimateDate: rec.estimateDate, clientName: rec.client.name, clientPhone: rec.client.phone || '', clientAddress: rec.client.address || '', grandTotal: tot, status: 'Draft', clientId: '', data: rec.data, logs: [{ time: now, user: user.email, action: version === 1 ? 'Saved original ' + no : 'Updated to V' + version }].concat((rec.newLogs || []).map((a) => ({ time: now, user: user.email, action: a }))), createdBy: first ? first.createdBy : user.email, updatedBy: user.email, updatedAt: now };
          db.estimates.push(o); save();
          return { ok: true, record: JSON.parse(JSON.stringify(o)), estimates: db.estimates.map((r) => { const x = Object.assign({}, r); delete x.data; delete x.logs; return x; }) };
        }
        case 'estimateDelete': db.estimates = db.estimates.filter((x) => x.id !== req.id); save(); return { ok: true, estimates: db.estimates.map((r) => { const x = Object.assign({}, r); delete x.data; delete x.logs; return x; }) };
        case 'estimateStatus': db.estimates.filter((x) => x.estimateNo === req.estimateNo).forEach((x) => { x.status = req.status; }); save(); return { ok: true, estimates: db.estimates.map((r) => { const x = Object.assign({}, r); delete x.data; delete x.logs; return x; }) };
        case 'attendanceMark': {
          db.attendance = db.attendance || [];
          const t = new Date().toTimeString().slice(0, 5);
          let r = db.attendance.find((x) => x.email === user.email && x.date === today());
          if (!r) { r = { id: uid('AT'), date: today(), email: user.email, name: user.name, checkIn: t, checkOut: '', ip: req.ip, method: 'Demo', status: t > '10:00' ? 'Late' : 'Present', notes: '' }; db.attendance.push(r); save(); return { ok: true, record: r, action: 'in' }; }
          if (req.kind === 'in') return { ok: true, record: r, action: 'already' };
          r.checkOut = t; save(); return { ok: true, record: r, action: 'out' };
        }
        case 'attendanceList': return { ok: true, rows: (db.attendance || []).filter((x) => x.date >= req.from && x.date <= req.to && (['Admin', 'Accountant'].includes(user.role) || x.email === user.email)) };
        case 'attendanceSave': {
          const t = db.users.find((u) => u.email === req.record.email);
          let r = db.attendance.find((x) => x.email === t.email && x.date === req.record.date);
          if (!r) { r = { id: uid('AT'), date: req.record.date, email: t.email, name: t.name, ip: '', method: 'Manual (Admin)' }; db.attendance.push(r); }
          Object.assign(r, { status: req.record.status, checkIn: req.record.checkIn, checkOut: req.record.checkOut, notes: req.record.notes }); save();
          return { ok: true };
        }
        case 'changePassword':
          if (req.oldPassword !== user.password) return fail('Current password is wrong');
          user.password = req.newPassword; user.mustChange = false; save(); return { ok: true };
        case 'save': {
          if (!write) return fail('You do not have permission for this action');
          const arr = db.tables[req.table];
          if (!arr) return fail('Invalid table');
          const r = Object.assign({}, req.record);
          const now = new Date().toISOString();
          if (req.table === 'SalaryPayments' && arr.some((x) => x.id !== r.id && x.employeeId === r.employeeId && x.salaryMonth === r.salaryMonth)) return fail('A record for this salaryMonth + employeeId already exists — edit that one instead');
          if (r.id) {
            const i = arr.findIndex((x) => x.id === r.id);
            if (i < 0) return fail('Record not found');
            arr[i] = Object.assign({}, arr[i], r, { updatedBy: user.email, updatedAt: now });
            log('update', req.table, r.id); save();
            return { ok: true, record: arr[i] };
          }
          r.id = uid(PREFIX[req.table]);
          Object.assign(r, { createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now });
          if (req.table === 'Clients' && !r.clientCode) r.clientCode = 'UL-C-' + String(arr.length + 1).padStart(4, '0');
          if (req.table === 'Employees' && !r.empCode) r.empCode = 'UL-E-' + String(arr.length + 1).padStart(4, '0');
          arr.push(r); log('create', req.table, r.id); save();
          return { ok: true, record: r };
        }
        case 'remove': {
          if (!write) return fail('You do not have permission for this action');
          const kids = { Clients: [['ClientWork', 'clientId'], ['ClientPayments', 'clientId'], ['EmployeeExpenses', 'clientId']], Employees: [['EmployeeExpenses', 'employeeId'], ['SalaryAdvances', 'employeeId'], ['SalaryPayments', 'employeeId']] }[req.table] || [];
          for (const k of kids) {
            const n = db.tables[k[0]].filter((x) => x[k[1]] === req.id).length;
            if (n) return fail('Cannot delete: ' + n + ' linked ' + k[0] + ' record(s) exist. Delete them first or mark this record inactive.');
          }
          db.tables[req.table] = db.tables[req.table].filter((x) => x.id !== req.id);
          log('delete', req.table, req.id); save();
          return { ok: true };
        }
        case 'saveUser': {
          if (user.role !== 'Admin') return fail('You do not have permission for this action');
          const r = req.record;
          const email = String(r.email || '').trim().toLowerCase();
          if (!r.name || !email) return fail('Name and email are required');
          if (db.users.some((x) => x.email === email && x.id !== r.id)) return fail('A member with this email already exists');
          if (r.id) Object.assign(db.users.find((x) => x.id === r.id), r, { email: email });
          else {
            if (!req.password || req.password.length < 8) return fail('Password must be at least 8 characters');
            db.users.push(Object.assign({}, r, { id: uid('US'), email: email, password: req.password, mustChange: true }));
          }
          log(r.id ? 'update' : 'create', 'Users', r.id || ''); save();
          return { ok: true };
        }
        case 'resetPassword': {
          if (user.role !== 'Admin') return fail('You do not have permission for this action');
          const u = db.users.find((x) => x.id === req.id);
          u.password = req.password; u.mustChange = true; save();
          return { ok: true };
        }
        case 'saveSettings':
          if (!write) return fail('You do not have permission for this action');
          if (req.settings.company) db.settings.company = Object.assign(db.settings.company, req.settings.company);
          ['attendance', 'estimateCounter', 'estimateTemplate'].forEach((k) => { if (k in req.settings) db.settings[k] = req.settings[k]; });
          Object.assign(db.settings.lists, req.settings.lists || {});
          if ('employeeSource' in req.settings) db.settings.employeeSource = req.settings.employeeSource;
          log('update', 'Settings', ''); save();
          return { ok: true, settings: db.settings };
        case 'audit': return { ok: true, rows: db.audit.slice(0, req.limit || 300) };
        case 'sheetTabs': {
          if (!db.raw) db.raw = { 'Staff List (Demo)': [['URBANE LIVING — STAFF', '', '', '', ''], ['NAME', 'DESIGNATION', 'EMAIL ADDRESS', 'MOBILE NUMBER', 'SALARY'], ['Archit Kumar', 'Sales Executive', 'sales1@example.com', '9000000001', '18000'], ['Karun Kumar', 'Sales Executive', 'sales2@example.com', '9000000002', '18000'], ['Divya Singh', 'Design Manager', 'design1@example.com', '9000000003', '30000']], 'Old Records (Demo)': [['Date', 'Client', 'Particulars', 'Amount'], ['05-09-2026', 'Rajesh Sharma', 'Advance received', '₹50,000'], ['12-09-2026', 'Café Brew House', 'Material purchase', '₹18,400']] };
          const tabs = Object.keys(db.raw);
          const name = tabs.includes(req.name) ? req.name : tabs[0];
          const w = db.raw[name].reduce((m, r) => Math.max(m, r.length), 0);
          return { ok: true, tabs: tabs, name: name, rows: db.raw[name].map((r) => { const x = r.map(String); while (x.length < w) x.push(''); return x; }) };
        }
        case 'sheetRowSave': case 'sheetRowDelete': case 'sheetAddColumn': {
          if (!write) return fail('You do not have permission for this action');
          const t = db.raw[req.name];
          if (req.action === 'sheetAddColumn') { const hr = t[req.headerRow - 1]; const w = t.reduce((m, r) => Math.max(m, r.length), 0); while (hr.length < w) hr.push(''); hr.push(req.label); save(); return { ok: true }; }
          if (req.action === 'sheetRowDelete') t.splice(req.row - 1, 1);
          else if (req.row) t[req.row - 1] = req.values; else t.push(req.values);
          save(); return { ok: true };
        }
        case 'setHiddenTabs': db.settings.hiddenTabs = req.tabs; save(); return { ok: true, settings: db.settings };
        case 'importBatch': case 'undoImport': return fail('Import is not available in demo mode');
        case 'importEmployees': {
          if (!write) return fail('You do not have permission for this action');
          let created = 0; let updated = 0;
          (req.records || []).forEach((r) => {
            const e = db.tables.Employees.find((x) => (r.email && x.email === r.email) || x.name.toLowerCase() === r.name.toLowerCase());
            if (e) { let ch = false; Object.keys(r).forEach((k) => { if (r[k] !== '' && String(r[k]) !== String(e[k])) { e[k] = r[k]; ch = true; } }); if (ch) updated++; }
            else { const o = Object.assign({ status: 'Active', monthlySalary: 0 }, r); Object.keys(o).forEach((k) => { if (o[k] === '') delete o[k]; }); o.id = uid('EM'); o.empCode = 'UL-E-' + String(db.tables.Employees.length + 1).padStart(4, '0'); o.createdBy = user.email; o.createdAt = new Date().toISOString(); db.tables.Employees.push(o); created++; }
          });
          if (db.settings.employeeSource && db.settings.employeeSource.tab === req.source) Object.assign(db.settings.employeeSource, { lastSync: new Date().toISOString(), lastSyncBy: user.email });
          save();
          return { ok: true, created: created, updated: updated, records: JSON.parse(JSON.stringify(db.tables.Employees)), settings: db.settings };
        }
        default: return fail('Unknown action');
      }
    }
    return { call: call };
  })();

  if (S.token) start(); else render();
})();
