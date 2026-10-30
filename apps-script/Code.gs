/**
 * Account Master — Google Apps Script backend
 * Urbane Living
 *
 * The Google Sheet is the database. Each table below is one tab; row 1 holds
 * the column headers. Deploy this script as a Web App (see README.md) and put
 * the Web App URL in assets/js/config.js.
 */

const SPREADSHEET_ID = '1MAtOq_XKFCRWr7cMFMWYiEVXl71C9tokYj2NCeA2pkQ';
const SESSION_DAYS = 7;
const MAX_LOGIN_FAILS = 5;
const ROLES = ['Admin', 'Accountant', 'Viewer'];
const WRITE_ROLES = ['Admin', 'Accountant'];

// First members created by setup(). Each gets a one-time password printed in
// the execution log and must change it on first login.
const SEED_USERS = [
  { name: 'Digvijay Jha', designation: 'CEO', email: 'digvijay@urbaneliving.in', role: 'Admin' },
  { name: 'Abhishek Mishra', designation: 'COO', email: 'abhishek@urbaneliving.in', role: 'Admin' },
  { name: 'Prem Jha', designation: 'Account Executive', email: 'accounts@urbaneliving.in', role: 'Accountant' },
  { name: 'Saban Jha', designation: 'IT Manager', email: 'it@urbaneliving.in', role: 'Admin' },
];

// ---------------------------------------------------------------------------
// Schema. Field spec: "name:type", type is text | number | date | month.
// Keep in sync with TABLES in assets/js/app.js.
// ---------------------------------------------------------------------------
const META_FIELDS = 'createdBy createdAt updatedBy updatedAt';

const SCHEMA = {
  Users: {
    fields: 'id name designation email phone role status passwordHash salt mustChange lastLogin ' + META_FIELDS,
  },
  Clients: {
    editable: true, prefix: 'CL',
    fields: 'id clientCode name phone email siteAddress city projectType workScope estimateRef approvedAmount:number startDate:date endDate:date status notes ' + META_FIELDS,
    required: ['name'],
  },
  ClientWork: {
    editable: true, prefix: 'CW',
    fields: 'id date:date clientId workType costType description vendor qty:number unit rate:number amount:number billNo vendorPaid notes ' + META_FIELDS,
    required: ['date', 'clientId', 'costType', 'amount'],
    refs: { clientId: 'Clients' },
  },
  ClientPayments: {
    editable: true, prefix: 'CP',
    fields: 'id date:date clientId amount:number mode reference notes ' + META_FIELDS,
    required: ['date', 'clientId', 'amount'],
    refs: { clientId: 'Clients' },
  },
  OfficeExpenses: {
    editable: true, prefix: 'OE',
    fields: 'id date:date category description amount:number mode paidTo billNo notes ' + META_FIELDS,
    required: ['date', 'category', 'amount'],
  },
  Employees: {
    editable: true, prefix: 'EM',
    fields: 'id empCode name designation phone email joiningDate:date monthlySalary:number perKmRate:number bankDetails status notes ' + META_FIELDS,
    required: ['name', 'monthlySalary'],
  },
  EmployeeExpenses: {
    editable: true, prefix: 'EX',
    fields: 'id date:date employeeId expenseType clientId fromTo km:number rate:number amount:number salaryMonth:month notes ' + META_FIELDS,
    required: ['date', 'employeeId', 'expenseType', 'amount', 'salaryMonth'],
    refs: { employeeId: 'Employees', clientId: 'Clients' },
  },
  SalaryAdvances: {
    editable: true, prefix: 'AD',
    fields: 'id date:date employeeId amount:number mode salaryMonth:month notes ' + META_FIELDS,
    required: ['date', 'employeeId', 'amount', 'salaryMonth'],
    refs: { employeeId: 'Employees' },
  },
  SalaryPayments: {
    editable: true, prefix: 'SP',
    fields: 'id salaryMonth:month employeeId baseSalary:number expenses:number advances:number deduction:number bonus:number netPayable:number paidAmount:number paidDate:date mode notes ' + META_FIELDS,
    required: ['salaryMonth', 'employeeId', 'paidAmount', 'paidDate'],
    refs: { employeeId: 'Employees' },
    unique: ['salaryMonth', 'employeeId'],
  },
  Settings: { fields: 'key value updatedBy updatedAt' },
  AuditLog: { fields: 'timestamp user action table recordId details' },
};

// Records that block deletion of a parent row.
const CHILDREN = {
  Clients: [['ClientWork', 'clientId'], ['ClientPayments', 'clientId'], ['EmployeeExpenses', 'clientId']],
  Employees: [['EmployeeExpenses', 'employeeId'], ['SalaryAdvances', 'employeeId'], ['SalaryPayments', 'employeeId']],
};

const DEFAULT_SETTINGS = {
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

// ---------------------------------------------------------------------------
// HTTP entry points
// ---------------------------------------------------------------------------
function doGet() {
  return json_({ ok: true, app: 'Account Master API', time: new Date().toISOString() });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  try {
    return json_(Object.assign({ ok: true }, route_(req)));
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err), code: err.code || '' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  if (req.action === 'login') return login_(req.email, req.password);
  const user = auth_(req.token);
  const open = ['logout', 'bootstrap', 'changePassword'];
  if (isTrue_(user.mustChange) && open.indexOf(req.action) < 0) {
    throw err_('Please change your password first', 'MUST_CHANGE');
  }
  switch (req.action) {
    case 'logout': endSession_(req.token); return {};
    case 'bootstrap': return bootstrap_(user);
    case 'changePassword': return changePassword_(user, req.oldPassword, req.newPassword);
    case 'save': return saveRecord_(user, req.table, req.record);
    case 'remove': return removeRecord_(user, req.table, req.id);
    case 'saveUser': return saveUser_(user, req.record, req.password);
    case 'resetPassword': return resetPassword_(user, req.id, req.password);
    case 'saveSettings': return saveSettings_(user, req.settings);
    case 'audit': return { rows: auditRows_(user, req.limit) };
    default: throw err_('Unknown action: ' + req.action);
  }
}

function err_(msg, code) {
  const e = new Error(msg);
  e.code = code || '';
  return e;
}

// ---------------------------------------------------------------------------
// Auth & sessions
// ---------------------------------------------------------------------------
function hash_(password, salt) {
  let h = salt + '|' + password;
  for (let i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return h;
}

function setPassword_(u, password) {
  if (!password || String(password).length < 8) throw err_('Password must be at least 8 characters');
  u.salt = Utilities.getUuid();
  u.passwordHash = hash_(String(password), u.salt);
}

function login_(email, password) {
  email = String(email || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const key = 'fail_' + email;
  const fails = Number(cache.get(key) || 0);
  if (fails >= MAX_LOGIN_FAILS) throw err_('Too many failed attempts. Try again after 15 minutes.');

  const u = readTable_('Users').filter(function (x) { return x.email.toLowerCase() === email; })[0];
  if (!u || u.status !== 'Active' || !u.passwordHash || hash_(String(password || ''), u.salt) !== u.passwordHash) {
    cache.put(key, String(fails + 1), 900);
    throw err_('Invalid email or password');
  }
  cache.remove(key);

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('S_' + token, JSON.stringify({ uid: u.id, exp: Date.now() + SESSION_DAYS * 864e5 }));
  cleanupSessions_(props);
  patchRow_('Users', u.id, { lastLogin: new Date().toISOString() });
  return { token: token, user: publicUser_(u) };
}

function auth_(token) {
  if (!token) throw err_('Please log in', 'AUTH');
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('S_' + token);
  if (!raw) throw err_('Session expired, please log in again', 'AUTH');
  const s = JSON.parse(raw);
  if (s.exp < Date.now()) {
    props.deleteProperty('S_' + token);
    throw err_('Session expired, please log in again', 'AUTH');
  }
  const u = readTable_('Users').filter(function (x) { return x.id === s.uid; })[0];
  if (!u || u.status !== 'Active') throw err_('Account disabled', 'AUTH');
  return u;
}

function endSession_(token) {
  PropertiesService.getScriptProperties().deleteProperty('S_' + token);
}

function cleanupSessions_(props) {
  const all = props.getProperties();
  const now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('S_') !== 0) return;
    try {
      if (JSON.parse(all[k]).exp < now) props.deleteProperty(k);
    } catch (e) {
      props.deleteProperty(k);
    }
  });
}

function endUserSessions_(uid) {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('S_') === 0 && all[k].indexOf('"' + uid + '"') >= 0) props.deleteProperty(k);
  });
}

function publicUser_(u) {
  return {
    id: u.id, name: u.name, designation: u.designation, email: u.email, phone: u.phone,
    role: u.role, status: u.status, mustChange: isTrue_(u.mustChange), lastLogin: u.lastLogin,
  };
}

function isTrue_(v) {
  return String(v).toUpperCase() === 'TRUE';
}

function needRole_(user, roles) {
  if (roles.indexOf(user.role) < 0) throw err_('You do not have permission for this action', 'FORBIDDEN');
}

function changePassword_(user, oldPassword, newPassword) {
  if (hash_(String(oldPassword || ''), user.salt) !== user.passwordHash) throw err_('Current password is wrong');
  const u = { salt: '', passwordHash: '' };
  setPassword_(u, newPassword);
  patchRow_('Users', user.id, { salt: u.salt, passwordHash: u.passwordHash, mustChange: 'FALSE', updatedBy: user.email, updatedAt: new Date().toISOString() });
  audit_(user, 'password', 'Users', user.id, 'Changed own password');
  return {};
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
function bootstrap_(user) {
  const data = {};
  Object.keys(SCHEMA).forEach(function (t) {
    if (SCHEMA[t].editable) data[t] = readTable_(t);
  });
  const users = readTable_('Users');
  return {
    user: publicUser_(user),
    settings: readSettings_(),
    data: data,
    users: users.map(function (u) {
      const p = publicUser_(u);
      if (user.role !== 'Admin') return { id: p.id, name: p.name, email: p.email, designation: p.designation, role: p.role, status: p.status };
      return p;
    }),
  };
}

function saveRecord_(user, table, rec) {
  const def = SCHEMA[table];
  if (!def || !def.editable) throw err_('Invalid table');
  needRole_(user, WRITE_ROLES);
  rec = sanitize_(table, rec || {});
  (def.required || []).forEach(function (k) {
    if (rec[k] === '' || rec[k] === undefined || rec[k] === null) throw err_('Missing field: ' + k);
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    Object.keys(def.refs || {}).forEach(function (k) {
      if (!rec[k]) return;
      const exists = readTable_(def.refs[k]).some(function (r) { return r.id === rec[k]; });
      if (!exists) throw err_('Linked ' + def.refs[k] + ' record not found');
    });

    const sh = sheet_(table);
    const values = sh.getDataRange().getValues();
    const headers = values[0].map(String);
    const types = types_(table);
    const idCol = headers.indexOf('id');
    const now = new Date().toISOString();

    let rowIdx = -1;
    if (rec.id) {
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idCol]) === String(rec.id)) { rowIdx = i; break; }
      }
      if (rowIdx < 0) throw err_('Record not found (it may have been deleted)');
    }

    if (def.unique) {
      const clash = readTable_(table).some(function (r) {
        return r.id !== rec.id && def.unique.every(function (k) { return String(r[k]) === String(rec[k]); });
      });
      if (clash) throw err_('A record for this ' + def.unique.join(' + ') + ' already exists — edit that one instead');
    }

    if (rowIdx < 0) {
      rec.id = newId_(def.prefix);
      rec.createdBy = user.email;
      rec.createdAt = now;
      if (table === 'Clients' && !rec.clientCode) rec.clientCode = nextCode_(values, headers, 'clientCode', 'UL-C-');
      if (table === 'Employees' && !rec.empCode) rec.empCode = nextCode_(values, headers, 'empCode', 'UL-E-');
    } else {
      const old = rowToObj_(headers, values[rowIdx], types);
      rec.createdBy = old.createdBy;
      rec.createdAt = old.createdAt;
    }
    rec.updatedBy = user.email;
    rec.updatedAt = now;

    const row = headers.map(function (k, j) {
      if (k in rec) return toCell_(rec[k], types[k]);
      return rowIdx >= 0 ? values[rowIdx][j] : '';
    });
    writeRow_(sh, rowIdx >= 0 ? rowIdx + 1 : values.length + 1, headers, types, row);
    audit_(user, rowIdx < 0 ? 'create' : 'update', table, rec.id, summary_(rec));
    return { record: rowToObj_(headers, row, types) };
  } finally {
    lock.releaseLock();
  }
}

function removeRecord_(user, table, id) {
  const def = SCHEMA[table];
  if (!def || !def.editable) throw err_('Invalid table');
  needRole_(user, WRITE_ROLES);
  (CHILDREN[table] || []).forEach(function (c) {
    const n = readTable_(c[0]).filter(function (r) { return r[c[1]] === id; }).length;
    if (n) throw err_('Cannot delete: ' + n + ' linked ' + c[0] + ' record(s) exist. Delete them first or mark this record inactive.');
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(table);
    const values = sh.getDataRange().getValues();
    const headers = values[0].map(String);
    const idCol = headers.indexOf('id');
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][idCol]) === String(id)) {
        const old = rowToObj_(headers, values[i], types_(table));
        sh.deleteRow(i + 1);
        audit_(user, 'delete', table, id, summary_(old));
        return {};
      }
    }
    throw err_('Record not found');
  } finally {
    lock.releaseLock();
  }
}

function sanitize_(table, rec) {
  const types = types_(table);
  const out = {};
  Object.keys(types).forEach(function (k) {
    if (META_FIELDS.split(' ').indexOf(k) >= 0) return;
    if (!(k in rec)) return;
    let v = rec[k];
    if (types[k] === 'number') {
      v = v === '' || v === null ? '' : Number(v);
      if (v !== '' && !isFinite(v)) throw err_('Invalid number in ' + k);
    } else if (types[k] === 'date') {
      v = String(v || '').trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw err_('Invalid date in ' + k);
    } else if (types[k] === 'month') {
      v = String(v || '').trim();
      if (v && !/^\d{4}-\d{2}$/.test(v)) throw err_('Invalid month in ' + k);
    } else {
      v = String(v === null || v === undefined ? '' : v).trim().slice(0, 2000);
    }
    out[k] = v;
  });
  return out;
}

function summary_(rec) {
  return ['name', 'clientCode', 'date', 'salaryMonth', 'category', 'costType', 'expenseType', 'amount', 'paidAmount']
    .filter(function (k) { return rec[k] !== undefined && rec[k] !== ''; })
    .map(function (k) { return k + '=' + rec[k]; }).join(', ');
}

// ---------------------------------------------------------------------------
// Users (Admin only)
// ---------------------------------------------------------------------------
function saveUser_(user, rec, password) {
  needRole_(user, ['Admin']);
  rec = rec || {};
  const email = String(rec.email || '').trim().toLowerCase();
  if (!rec.name || !email) throw err_('Name and email are required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err_('Invalid email');
  if (ROLES.indexOf(rec.role) < 0) throw err_('Invalid role');
  const status = rec.status === 'Inactive' ? 'Inactive' : 'Active';

  const users = readTable_('Users');
  if (users.some(function (u) { return u.email.toLowerCase() === email && u.id !== rec.id; })) throw err_('A member with this email already exists');
  if (rec.id === user.id && (rec.role !== 'Admin' || status !== 'Active')) throw err_('You cannot remove your own Admin access');

  const now = new Date().toISOString();
  const patch = {
    name: String(rec.name).trim(), designation: String(rec.designation || '').trim(), email: email,
    phone: String(rec.phone || '').trim(), role: rec.role, status: status, updatedBy: user.email, updatedAt: now,
  };
  if (rec.id) {
    if (!users.some(function (u) { return u.id === rec.id; })) throw err_('Member not found');
    if (password) { setPassword_(patch, password); patch.mustChange = 'TRUE'; }
    patchRow_('Users', rec.id, patch);
    if (status !== 'Active' || password) endUserSessions_(rec.id);
    audit_(user, 'update', 'Users', rec.id, patch.email + ' ' + patch.role + ' ' + patch.status);
    return {};
  }
  setPassword_(patch, password);
  patch.id = newId_('US');
  patch.mustChange = 'TRUE';
  patch.createdBy = user.email;
  patch.createdAt = now;
  appendObj_('Users', patch);
  audit_(user, 'create', 'Users', patch.id, patch.email + ' ' + patch.role);
  return {};
}

function resetPassword_(user, id, password) {
  needRole_(user, ['Admin']);
  const patch = {};
  setPassword_(patch, password);
  patch.mustChange = 'TRUE';
  patch.updatedBy = user.email;
  patch.updatedAt = new Date().toISOString();
  patchRow_('Users', id, patch);
  endUserSessions_(id);
  audit_(user, 'password', 'Users', id, 'Password reset by admin');
  return {};
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function readSettings_() {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  readTable_('Settings').forEach(function (r) {
    try {
      const v = JSON.parse(r.value);
      if (r.key === 'company') s.company = Object.assign(s.company, v);
      else if (r.key.indexOf('list.') === 0 && Array.isArray(v)) s.lists[r.key.slice(5)] = v;
    } catch (e) { /* ignore malformed values */ }
  });
  return s;
}

function saveSettings_(user, settings) {
  needRole_(user, WRITE_ROLES);
  settings = settings || {};
  const entries = [];
  if (settings.company) {
    if (user.role !== 'Admin') throw err_('Only Admin can change company settings', 'FORBIDDEN');
    const c = settings.company;
    entries.push(['company', { name: String(c.name || '').trim() || 'Urbane Living', perKmRate: Number(c.perKmRate) || 0 }]);
  }
  Object.keys(settings.lists || {}).forEach(function (k) {
    if (!(k in DEFAULT_SETTINGS.lists)) return;
    const list = (settings.lists[k] || []).map(function (x) { return String(x).trim(); }).filter(String);
    if (!list.length) throw err_('List "' + k + '" cannot be empty');
    entries.push(['list.' + k, list]);
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('Settings');
    const values = sh.getDataRange().getValues();
    const now = new Date().toISOString();
    entries.forEach(function (e) {
      const row = [e[0], JSON.stringify(e[1]), user.email, now];
      let found = -1;
      for (let i = 1; i < values.length; i++) if (values[i][0] === e[0]) { found = i; break; }
      if (found >= 0) sh.getRange(found + 1, 1, 1, 4).setValues([row]);
      else { sh.appendRow(row); values.push(row); }
    });
  } finally {
    lock.releaseLock();
  }
  audit_(user, 'update', 'Settings', '', entries.map(function (e) { return e[0]; }).join(', '));
  return { settings: readSettings_() };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
function audit_(user, action, table, id, details) {
  try {
    sheet_('AuditLog').appendRow([new Date().toISOString(), user.email, action, table, id || '', String(details || '').slice(0, 500)]);
  } catch (e) { /* audit must never block a save */ }
}

function auditRows_(user, limit) {
  needRole_(user, ['Admin']);
  const sh = sheet_('AuditLog');
  const n = Math.min(Number(limit) || 300, 2000);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - n + 1);
  return sh.getRange(start, 1, last - start + 1, 6).getValues().reverse().map(function (r) {
    return { timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), user: r[1], action: r[2], table: r[3], recordId: r[4], details: r[5] };
  });
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------
function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw err_('Sheet tab "' + name + '" is missing. Run setup() once from the Apps Script editor.');
  return sh;
}

function fields_(table) {
  return SCHEMA[table].fields.split(/\s+/).filter(String).map(function (f) {
    const p = f.split(':');
    return [p[0], p[1] || 'text'];
  });
}

function types_(table) {
  const t = {};
  fields_(table).forEach(function (f) { t[f[0]] = f[1]; });
  return t;
}

function numberFormat_(type) {
  if (type === 'number') return '0.##';
  if (type === 'date') return 'yyyy-mm-dd';
  return '@';
}

function normalize_(v, type) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), type === 'month' ? 'yyyy-MM' : 'yyyy-MM-dd');
  }
  if (type === 'number') return v === '' || v === null ? '' : Number(v) || 0;
  return v === null || v === undefined ? '' : String(v);
}

function toCell_(v, type) {
  if (type === 'number') return v === '' || v === null || v === undefined ? '' : Number(v);
  return v === null || v === undefined ? '' : v;
}

function rowToObj_(headers, row, types) {
  const o = {};
  headers.forEach(function (k, j) {
    if (k) o[k] = normalize_(row[j], types[k]);
  });
  return o;
}

function readTable_(name) {
  const values = sheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  const types = types_(name);
  const idCol = headers.indexOf('id') >= 0 ? headers.indexOf('id') : 0;
  const out = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i][idCol] === '' || values[i][idCol] === null) continue;
    out.push(rowToObj_(headers, values[i], types));
  }
  return out;
}

function writeRow_(sh, rowNum, headers, types, row) {
  if (rowNum > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
  const formats = headers.map(function (k) { return types[k] ? numberFormat_(types[k]) : 'General'; });
  sh.getRange(rowNum, 1, 1, headers.length).setNumberFormats([formats]).setValues([row]);
}

function appendObj_(table, obj) {
  const sh = sheet_(table);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const types = types_(table);
  writeRow_(sh, sh.getLastRow() + 1, headers, types, headers.map(function (k) { return toCell_(obj[k], types[k]); }));
}

function patchRow_(table, id, patch) {
  const sh = sheet_(table);
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const idCol = headers.indexOf('id');
  const types = types_(table);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(id)) {
      const row = headers.map(function (k, j) { return k in patch ? toCell_(patch[k], types[k]) : values[i][j]; });
      writeRow_(sh, i + 1, headers, types, row);
      return;
    }
  }
  throw err_('Record not found');
}

function newId_(prefix) {
  const d = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd');
  return prefix + '-' + d + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}

function nextCode_(values, headers, col, prefix) {
  const c = headers.indexOf(col);
  let max = 0;
  for (let i = 1; i < values.length; i++) {
    const m = String(values[i][c] || '').match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + String(max + 1).padStart(4, '0');
}

// ---------------------------------------------------------------------------
// One-time setup — run from the Apps Script editor (Run ▶ setup)
// ---------------------------------------------------------------------------
function setup() {
  const ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const fields = fields_(name);
    const lastCol = sh.getLastColumn();
    const headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    const missing = fields.filter(function (f) { return headers.indexOf(f[0]) < 0; }).map(function (f) { return f[0]; });
    if (missing.length) sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    const all = headers.concat(missing);
    const rows = Math.max(sh.getMaxRows() - 1, 1);
    fields.forEach(function (f) {
      sh.getRange(2, all.indexOf(f[0]) + 1, rows, 1).setNumberFormat(numberFormat_(f[1]));
    });
    sh.getRange(1, 1, 1, all.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });

  const users = readTable_('Users');
  const created = [];
  SEED_USERS.forEach(function (s) {
    if (users.some(function (u) { return u.email.toLowerCase() === s.email; })) return;
    const pw = 'UL@' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    const u = Object.assign({}, s, { id: newId_('US'), status: 'Active', mustChange: 'TRUE', createdBy: 'setup', createdAt: new Date().toISOString() });
    setPassword_(u, pw);
    appendObj_('Users', u);
    created.push(s.email + '  →  ' + pw);
  });

  Logger.log('Setup complete. Sheet tabs are ready.');
  if (created.length) {
    Logger.log('One-time passwords (each member must change it on first login):');
    created.forEach(function (c) { Logger.log(c); });
  } else {
    Logger.log('No new members created (they already exist).');
  }
}

/**
 * Emergency password reset from the editor, e.g. if every Admin is locked out.
 * Edit the two values, run it once, then clear them again.
 */
function emergencyResetPassword() {
  const EMAIL = '';
  const NEW_PASSWORD = '';
  if (!EMAIL || !NEW_PASSWORD) throw new Error('Fill EMAIL and NEW_PASSWORD inside the function first');
  const u = readTable_('Users').filter(function (x) { return x.email.toLowerCase() === EMAIL.toLowerCase(); })[0];
  if (!u) throw new Error('No member with that email');
  const patch = { status: 'Active', mustChange: 'TRUE' };
  setPassword_(patch, NEW_PASSWORD);
  patchRow_('Users', u.id, patch);
  CacheService.getScriptCache().remove('fail_' + u.email.toLowerCase());
  Logger.log('Password reset for ' + u.email);
}
