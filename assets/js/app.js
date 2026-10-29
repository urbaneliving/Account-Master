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
  const list = (k) => (S.settings && S.settings.lists[k]) || [];
  const rows = (t) => S.data[t] || [];
  const byId = (t, id) => rows(t).find((r) => r.id === id);
  const clientName = (id) => { const c = byId('Clients', id); return c ? c.name : ''; };
  const empName = (id) => { const e = byId('Employees', id); return e ? e.name : ''; };
  const userName = (email) => { const u = S.users.find((x) => x.email === email); return u ? u.name : email || ''; };
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
  const icon = (n) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';

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
      const r = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
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
    store.del('am_token');
  }

  async function loadAll() {
    const r = await api('bootstrap');
    S.user = r.user;
    S.settings = r.settings;
    S.data = r.data;
    S.users = r.users;
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
    const map = { Ongoing: 'accent', Completed: 'good', 'On Hold': 'warn', Cancelled: 'bad', Active: 'good', Inactive: '', Paid: 'good', Unpaid: 'warn', Pending: 'warn', Partial: 'warn' };
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
  function brand(sub) {
    return '<div class="brand"><div class="brand-mark">AM</div><div><div class="brand-name">Account Master</div><div class="brand-sub">' + esc(sub || CFG.COMPANY || 'Urbane Living') + '</div></div></div>';
  }

  function renderLogin() {
    const notConfigured = !DEMO && !CFG.API_URL;
    $('#root').innerHTML = '<div class="login-wrap"><div class="login-card">' + brand() +
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
    bindPasswordForm(() => render());
  }

  // ---------------------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------------------
  const NAV = [
    ['dashboard', 'Dashboard', 'dashboard'],
    ['clients', 'Clients', 'clients'],
    ['office', 'Office expenses', 'office'],
    ['salary', 'Employees & salary', 'salary'],
    ['expenses', 'Employee expenses', 'expenses'],
    ['settings', 'Settings', 'settings'],
  ];

  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    return { page: parts[0], id: parts[1] ? decodeURIComponent(parts[1]) : '' };
  }

  function renderShell() {
    const u = S.user;
    $('#root').innerHTML = '<div class="shell">' +
      '<aside class="sidebar">' + brand() + '<nav class="nav">' +
      NAV.map((n) => '<a href="#/' + n[0] + '" data-nav="' + n[0] + '">' + icon(n[2]) + '<span>' + n[1] + '</span></a>').join('') + '</nav>' +
      '<div class="side-user"><div class="avatar">' + esc(initials(u.name)) + '</div><div class="who"><div style="font-weight:600">' + esc(u.name) + '</div><div class="small muted">' + esc(u.role) + (DEMO ? ' · Demo' : '') + '</div></div>' +
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

    const r = route();
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === r.page || (r.page === 'employees' && a.dataset.nav === 'salary')));
    const views = { dashboard: viewDashboard, clients: r.id ? viewClient : viewClients, office: viewOffice, salary: viewSalary, employees: viewEmployee, expenses: viewExpenses, settings: viewSettings };
    const fn = views[r.page] || viewDashboard;
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
      kpi('Received from clients', inr(cf.received), rows('ClientPayments').filter((r) => inRange(r.date, p)).length + ' payments') +
      kpi('Total spent', inr(cf.out), 'Site work, office & salary') +
      kpi('Net cash flow', inr(cf.net), cf.net >= 0 ? 'More in than out' : 'More out than in', cf.net >= 0 ? 'good' : 'bad') +
      kpi('Client dues', inr(dues), clients.filter((x) => x.due > 0).length + ' clients still to pay', dues > 0 ? 'bad' : '') +
      kpi('Salary pending · ' + fmtMonth(m), inr(salPending), sal.filter((s) => s.balance > 0).length + ' employees') +
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
    feed.sort((a, b) => String(b[0].createdAt).localeCompare(String(a[0].createdAt)));
    h += '<div class="card"><div class="card-head"><h2>Recent entries</h2></div><div class="card-body">' +
      (feed.length ? '<div style="display:flex;flex-direction:column">' + feed.slice(0, 8).map((f) =>
        '<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)"><div style="min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span class="badge">' + esc(f[1]) + '</span> ' + esc(f[2]) + '</div>' +
        '<div class="cell-sub">' + esc(fmtDate(f[0].date || f[0].paidDate)) + ' · by ' + esc(userName(f[0].createdBy)) + '</div></div><div class="num ' + f[4] + '" style="font-weight:600">' + inr(f[3]) + '</div></div>').join('') + '</div>'
        : '<div class="empty">No entries yet</div>') + '</div></div>';
    h += '</div>';
    return h;
  }
  viewDashboard.after = function () {
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
      '<div class="page-actions">' + (canWrite() ? '<button class="btn" data-act="edit" data-t="Clients" data-id="' + esc(c.id) + '">' + icon('edit') + 'Edit</button>' : '') +
      '<button class="btn" data-act="print">' + icon('print') + 'Print</button></div></div></div>';

    h += '<div class="kpis">' +
      kpi('Approved estimate', inr(s.approved)) +
      kpi('Received', inr(s.received), s.pays.length + ' payments', 'good') +
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
    if (isAdmin()) items.push(['members', 'Members', S.users.length], ['company', 'Company'], ['activity', 'Activity log']);
    if (!items.some((i) => i[0] === st.tab)) st.tab = 'profile';
    let h = pageHead('Settings', '');
    h += tabs('settings', items, 'profile');

    if (st.tab === 'profile') {
      const u = S.user;
      h += '<div class="two-col"><div class="card"><div class="card-head"><h2>Profile</h2></div><div class="card-body"><div class="breakdown">' +
        '<span class="muted">Name</span><span>' + esc(u.name) + '</span><span class="muted">Email</span><span>' + esc(u.email) + '</span>' +
        '<span class="muted">Designation</span><span>' + esc(u.designation) + '</span><span class="muted">Access</span><span>' + statusBadge(u.role) + '</span></div>' +
        '<p class="small muted" style="margin-bottom:0">Admin: everything incl. members · Accountant: add / edit all records · Viewer: read only</p></div></div>' +
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
        { k: 'name', l: 'Member', primary: true, f: (u) => '<b>' + esc(u.name) + '</b><div class="cell-sub">' + esc(u.designation || '') + '</div>' },
        { k: 'email', l: 'Email', f: (u) => esc(u.email) + (u.phone ? '<div class="cell-sub">' + esc(u.phone) + '</div>' : '') },
        { k: 'role', l: 'Access', f: (u) => statusBadge(u.role) },
        { k: 'status', l: 'Status', f: (u) => statusBadge(u.status) + (u.mustChange ? '<div class="cell-sub">Must set password</div>' : '') },
        { k: 'lastLogin', l: 'Last login', f: (u) => esc(fmtStamp(u.lastLogin)) },
      ], S.users, {
        sort: { k: 'name', dir: 'asc' },
        actions: (u) => '<button class="btn ghost sm icon" title="Edit" data-act="member-edit" data-id="' + esc(u.id) + '">' + icon('edit') + '</button>' +
          '<button class="btn ghost sm icon" title="Reset password" data-act="member-reset" data-id="' + esc(u.id) + '">' + icon('key') + '</button>',
      }) + '</div>';
    } else if (st.tab === 'company') {
      const c = S.settings.company;
      h += '<div class="card" style="max-width:520px"><div class="card-body"><form id="company-form" style="display:flex;flex-direction:column;gap:14px">' +
        '<label class="field">Company name<input class="input" name="name" value="' + esc(c.name) + '"></label>' +
        '<label class="field">Default bike rate per km (₹)<input class="input" name="perKmRate" type="number" step="any" value="' + esc(c.perKmRate) + '"><span class="field-hint">Used for employee travel unless the employee has their own rate</span></label>' +
        '<div><button class="btn primary" type="submit">Save</button></div></form></div></div>';
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
          const r = await api('saveSettings', { settings: { company: { name: e.target.name.value, perKmRate: e.target.perKmRate.value } } });
          S.settings = r.settings;
          toast('Company settings saved');
        } catch (ex) { toast(ex.message, true); }
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
      '<label class="field">Access<select class="input" name="role">' + opt(['Admin', 'Accountant', 'Viewer'], u.role) + '</select></label>' +
      '<label class="field">Status<select class="input" name="status">' + opt(['Active', 'Inactive'], u.status) + '</select></label>' +
      (isNew ? '<label class="field full">One-time password<input class="input" name="password" type="text" autocomplete="off" value="' + esc(tempPassword()) + '"><span class="field-hint">Share this with the member. They must set their own password at first login.</span></label>' : '') +
      '</div>';
    openModal(isNew ? 'Add member' : 'Edit member', body, {
      submit: isNew ? 'Add member' : 'Save changes',
      onSubmit: async (form) => {
        const rec = { id: u.id, name: form.name.value, designation: form.designation.value, email: form.email.value, phone: form.phone.value, role: form.role.value, status: form.status.value };
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
      case 'print': window.print(); break;
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
  document.addEventListener('input', (e) => { if (e.target.matches('input[type=search][data-filter]')) onFilter(e); });
  document.addEventListener('change', (e) => { if (e.target.matches('[data-filter]') && e.target.type !== 'search') onFilter(e); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal(); });
  window.addEventListener('hashchange', () => { closeModal(); renderPage(); window.scrollTo(0, 0); });

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
      company: { name: 'Urbane Living', perKmRate: 3 },
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
    const pub = (u) => ({ id: u.id, name: u.name, designation: u.designation, email: u.email, phone: u.phone, role: u.role, status: u.status, mustChange: !!u.mustChange, lastLogin: u.lastLogin });
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
        case 'bootstrap': return { ok: true, user: pub(user), settings: db.settings, data: JSON.parse(JSON.stringify(db.tables)), users: db.users.map(pub) };
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
          if (req.settings.company) db.settings.company = Object.assign(db.settings.company, { name: req.settings.company.name, perKmRate: Number(req.settings.company.perKmRate) || 0 });
          Object.assign(db.settings.lists, req.settings.lists || {});
          log('update', 'Settings', ''); save();
          return { ok: true, settings: db.settings };
        case 'audit': return { ok: true, rows: db.audit.slice(0, req.limit || 300) };
        default: return fail('Unknown action');
      }
    }
    return { call: call };
  })();

  if (S.token) start(); else render();
})();
