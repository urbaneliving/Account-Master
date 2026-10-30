/**
 * Account Master — Google Apps Script backend
 * Urbane Living
 *
 * The Google Sheet is the database. Each table below is one tab; row 1 holds
 * the column headers. Deploy this script as a Web App (see README.md) and put
 * the Web App URL in assets/js/config.js.
 */

const API_VERSION = '2026-11-02.1';
const SPREADSHEET_ID = '1MAtOq_XKFCRWr7cMFMWYiEVXl71C9tokYj2NCeA2pkQ';
const SESSION_DAYS = 7;
const MAX_LOGIN_FAILS = 5;
const ROLES = ['Admin', 'Accountant', 'Viewer', 'Staff'];
const WRITE_ROLES = ['Admin', 'Accountant'];
// Roles that see the accounts (clients' money, office, salary). Staff only see their own work.
const ACCOUNTS_ROLES = ['Admin', 'Accountant', 'Viewer'];
const TZ = 'Asia/Kolkata';

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
    fields: 'id name designation email phone role status passwordHash salt mustChange lastLogin employeeId photo ' + META_FIELDS,
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
  Estimates: {
    fields: 'id estimateNo version:number isOriginal estimateDate:date clientName clientPhone clientAddress grandTotal:number status clientId data logs ' + META_FIELDS,
  },
  Attendance: {
    fields: 'id date:date email name checkIn checkOut ip method status notes ' + META_FIELDS,
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
  company: {
    name: 'Urbane Living', perKmRate: 3, website: 'urbaneliving.in', gstNo: '09AAJFU0647A1ZC',
    address: 'G-12, Express Green Plaza, Sector-1, Vaishali, Ghaziabad', serviceArea: 'Gurugram, Noida, Delhi, Ghaziabad',
    logoUrl: '',
    bankName: '', bankAccount: '', bankIfsc: '', estimatePrefix: 'RFIUL', estimateValidDays: 14,
  },
  attendance: { ipPrefixes: ['2406:b400:71:93ee'], startTime: '10:00', autoMark: true, geo: { enabled: false, lat: '', lng: '', radius: 200 } },
  estimateCounter: 226,
  estimateTemplate: null,
  employeeSource: null,
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

// ---------------------------------------------------------------------------
// HTTP entry points
// ---------------------------------------------------------------------------
function doGet() {
  return json_({ ok: true, app: 'Account Master API', version: API_VERSION, time: new Date().toISOString() });
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
    case 'sheetTabs': needRole_(user, ACCOUNTS_ROLES); return sheetTabs_(req.name, user.role === 'Admin');
    case 'sheetRowSave': return sheetRowSave_(user, req.name, req.row, req.values, req.original);
    case 'sheetRowDelete': return sheetRowDelete_(user, req.name, req.row, req.original);
    case 'sheetAddColumn': return sheetAddColumn_(user, req.name, req.headerRow, req.label);
    case 'importEmployees': return importEmployees_(user, req.records, req.source);
    case 'importBatch': return importBatch_(user, req.data);
    case 'undoImport': return undoImport_(user, req.tag);
    case 'setHiddenTabs': return setHiddenTabs_(user, req.tabs);
    case 'setPhoto': return setPhoto_(user, req.photo);
    case 'estimateGet': return { record: estimateGet_(user, req.id) };
    case 'estimateSave': return estimateSave_(user, req.record, req.mode);
    case 'estimateDelete': return estimateDelete_(user, req.id);
    case 'estimateStatus': return estimateStatus_(user, req.estimateNo, req.status);
    case 'estimateToClient': return estimateToClient_(user, req.estimateNo);
    case 'estimateImport': return estimateImport_(user, req.records);
    case 'attendanceMark': return attendanceMark_(user, req);
    case 'attendanceList': return { rows: attendanceList_(user, req.from, req.to) };
    case 'attendanceSave': return attendanceSave_(user, req.record);
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
    role: u.role, status: u.status, mustChange: isTrue_(u.mustChange), lastLogin: u.lastLogin, employeeId: u.employeeId || '', photo: u.photo || '',
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
  const accounts = ACCOUNTS_ROLES.indexOf(user.role) >= 0;
  Object.keys(SCHEMA).forEach(function (t) {
    if (SCHEMA[t].editable && accounts) data[t] = readTable_(t);
  });
  const users = readTable_('Users');
  const settings = readSettings_();
  if (!accounts) settings.lists = {};
  return {
    user: publicUser_(user),
    settings: settings,
    data: data,
    estimates: estimatesList_(user),
    me: mySelf_(user),
    attendanceToday: attendanceToday_(user),
    users: users.map(function (u) {
      const p = publicUser_(u);
      if (user.role !== 'Admin') return { id: p.id, name: p.name, email: p.email, designation: p.designation, role: p.role, status: p.status, photo: p.photo };
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
    employeeId: String(rec.employeeId || ''),
  };
  if (patch.employeeId && !readTable_('Employees').some(function (e) { return e.id === patch.employeeId; })) throw err_('Linked employee not found');
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
      else if (r.key === 'employeeSource') s.employeeSource = v;
      else if (r.key === 'attendance') s.attendance = Object.assign(s.attendance, v);
      else if (r.key === 'estimateCounter') s.estimateCounter = Number(v) || s.estimateCounter;
      else if (r.key === 'estimateTemplate') s.estimateTemplate = v;
      else if ((r.key === 'imports' || r.key === 'hiddenTabs') && Array.isArray(v)) s[r.key] = v;
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
    const str = function (k, max) { return String(c[k] === undefined ? '' : c[k]).trim().slice(0, max || 300); };
    entries.push(['company', {
      name: str('name') || 'Urbane Living', perKmRate: Number(c.perKmRate) || 0, website: str('website'), gstNo: str('gstNo'),
      address: str('address'), serviceArea: str('serviceArea'), logoUrl: str('logoUrl', 500), bankName: str('bankName'),
      bankAccount: str('bankAccount'), bankIfsc: str('bankIfsc'), estimatePrefix: str('estimatePrefix', 12) || 'RFIUL',
      estimateValidDays: Number(c.estimateValidDays) || 14,
    }]);
  }
  if (settings.attendance) {
    if (user.role !== 'Admin') throw err_('Only Admin can change attendance settings', 'FORBIDDEN');
    const a = settings.attendance;
    entries.push(['attendance', {
      ipPrefixes: (a.ipPrefixes || []).map(function (x) { return String(x).trim().toLowerCase(); }).filter(String).slice(0, 20),
      startTime: /^\d{2}:\d{2}$/.test(a.startTime) ? a.startTime : '10:00',
      autoMark: a.autoMark !== false,
      geo: { enabled: !!(a.geo && a.geo.enabled), lat: Number(a.geo && a.geo.lat) || '', lng: Number(a.geo && a.geo.lng) || '', radius: Number(a.geo && a.geo.radius) || 200 },
    }]);
  }
  if ('estimateCounter' in settings) {
    if (user.role !== 'Admin') throw err_('Only Admin can change the estimate counter', 'FORBIDDEN');
    entries.push(['estimateCounter', Math.max(0, Math.floor(Number(settings.estimateCounter) || 0))]);
  }
  if ('estimateTemplate' in settings) {
    if (user.role !== 'Admin') throw err_('Only Admin can change the estimate template', 'FORBIDDEN');
    const tpl = settings.estimateTemplate;
    if (tpl && JSON.stringify(tpl).length > 45000) throw err_('Template is too large');
    entries.push(['estimateTemplate', tpl || null]);
  }
  if ('employeeSource' in settings) entries.push(['employeeSource', cleanSource_(settings.employeeSource, null)]);
  Object.keys(settings.lists || {}).forEach(function (k) {
    if (!(k in DEFAULT_SETTINGS.lists)) return;
    const list = (settings.lists[k] || []).map(function (x) { return String(x).trim(); }).filter(String);
    if (!list.length) throw err_('List "' + k + '" cannot be empty');
    entries.push(['list.' + k, list]);
  });

  writeSettings_(user, entries);
  audit_(user, 'update', 'Settings', '', entries.map(function (e) { return e[0]; }).join(', '));
  return { settings: readSettings_() };
}

function writeSettings_(user, entries) {
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
}

const EMPLOYEE_SOURCE_FIELDS = ['name', 'designation', 'phone', 'email', 'joiningDate', 'monthlySalary', 'perKmRate', 'bankDetails', 'status'];

function cleanSource_(src, lastSync) {
  if (!src || !src.tab) return null;
  const map = {};
  EMPLOYEE_SOURCE_FIELDS.forEach(function (f) { if (src.map && src.map[f]) map[f] = String(src.map[f]); });
  if (!map.name) throw err_('Choose which column has the employee name');
  return { tab: String(src.tab), map: map, lastSync: lastSync || src.lastSync || '', lastSyncBy: src.lastSyncBy || '' };
}

// ---------------------------------------------------------------------------
// Other tabs in the spreadsheet (read-only view of data the app doesn't manage)
// ---------------------------------------------------------------------------
function sheetTabs_(name, isAdmin) {
  const ss = ss_();
  const hidden = readSettings_().hiddenTabs;
  const tabs = ss.getSheets().map(function (sh) { return sh.getName(); })
    .filter(function (n) { return !(n in SCHEMA) && (isAdmin || hidden.indexOf(n) < 0); });
  if (!name || tabs.indexOf(name) < 0) name = tabs[0] || '';
  if (!name) return { tabs: tabs, name: '', rows: [] };
  const sh = ss.getSheetByName(name);
  const lastRow = Math.min(sh.getLastRow(), 5000);
  const lastCol = Math.min(sh.getLastColumn(), 60);
  const rows = lastRow && lastCol ? sh.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [];
  return { tabs: tabs, name: name, rows: rows };
}

function editableTab_(name, user) {
  name = String(name || '');
  if (!name || name in SCHEMA) throw err_('This tab cannot be edited here');
  if (user && user.role !== 'Admin' && readSettings_().hiddenTabs.indexOf(name) >= 0) throw err_('This tab is hidden by Admin', 'FORBIDDEN');
  const sh = ss_().getSheetByName(name);
  if (!sh) throw err_('Tab "' + name + '" not found');
  return sh;
}

function cleanValues_(values) {
  return (values || []).map(function (v) { return v === null || v === undefined ? '' : String(v).slice(0, 5000); });
}

// Refuse to touch a row that changed since the user loaded it (rows can shift).
function checkRow_(sh, row, original) {
  original = cleanValues_(original);
  if (!original.length) throw err_('Missing original row values');
  const cur = sh.getRange(row, 1, 1, original.length).getDisplayValues()[0];
  if (cur.join('\u0001') !== original.join('\u0001')) {
    throw err_('This row was changed in the sheet meanwhile. Press Refresh and try again.');
  }
}

function sheetRowSave_(user, name, row, values, original) {
  needRole_(user, WRITE_ROLES);
  const sh = editableTab_(name, user);
  values = cleanValues_(values);
  if (!values.length || !values.some(String)) throw err_('Row is empty');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    row = Number(row) || 0;
    const isNew = !row;
    if (isNew) {
      row = sh.getLastRow() + 1;
      if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
    } else {
      checkRow_(sh, row, original);
    }
    sh.getRange(row, 1, 1, values.length).setValues([values]);
    audit_(user, isNew ? 'create' : 'update', 'Sheet: ' + name, 'row ' + row, values.filter(String).slice(0, 6).join(' | '));
    return { row: row };
  } finally {
    lock.releaseLock();
  }
}

function sheetRowDelete_(user, name, row, original) {
  needRole_(user, WRITE_ROLES);
  const sh = editableTab_(name, user);
  row = Number(row) || 0;
  if (row < 1) throw err_('Invalid row');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    checkRow_(sh, row, original);
    sh.deleteRow(row);
    audit_(user, 'delete', 'Sheet: ' + name, 'row ' + row, cleanValues_(original).filter(String).slice(0, 6).join(' | '));
    return {};
  } finally {
    lock.releaseLock();
  }
}

function sheetAddColumn_(user, name, headerRow, label) {
  needRole_(user, WRITE_ROLES);
  const sh = editableTab_(name, user);
  label = String(label || '').trim();
  if (!label) throw err_('Column name is required');
  headerRow = Math.max(1, Number(headerRow) || 1);
  const col = sh.getLastColumn() + 1;
  sh.getRange(headerRow, col).setValue(label);
  audit_(user, 'update', 'Sheet: ' + name, 'column ' + col, 'Added column ' + label);
  return {};
}

function setHiddenTabs_(user, tabs) {
  needRole_(user, ['Admin']);
  tabs = (tabs || []).map(String).filter(String);
  writeSettings_(user, [['hiddenTabs', tabs]]);
  audit_(user, 'update', 'Settings', '', 'Hidden tabs: ' + (tabs.join(', ') || 'none'));
  return { settings: readSettings_() };
}

// ---------------------------------------------------------------------------
// Self-service: every member sees their own employee record, salary,
// advances, expenses and payments (linked by member → employee, else email).
// ---------------------------------------------------------------------------
function linkedEmployee_(user) {
  const emps = readTable_('Employees');
  if (user.employeeId) {
    const e = emps.filter(function (x) { return x.id === user.employeeId; })[0];
    if (e) return e;
  }
  const email = String(user.email).toLowerCase();
  return emps.filter(function (x) { return x.email && String(x.email).toLowerCase() === email; })[0] ||
    emps.filter(function (x) { return String(x.name).trim().toLowerCase() === String(user.name).trim().toLowerCase(); })[0] || null;
}

function mySelf_(user) {
  const e = linkedEmployee_(user);
  if (!e) return { employee: null };
  const mine = function (t) { return readTable_(t).filter(function (r) { return r.employeeId === e.id; }).map(function (r) { const o = Object.assign({}, r); delete o.notes; return o; }); };
  return {
    employee: {
      id: e.id, empCode: e.empCode, name: e.name, designation: e.designation, phone: e.phone, email: e.email, joiningDate: e.joiningDate,
      monthlySalary: e.monthlySalary, perKmRate: e.perKmRate, status: e.status, bankDetails: e.bankDetails,
    },
    expenses: mine('EmployeeExpenses'), advances: mine('SalaryAdvances'), payments: mine('SalaryPayments'),
  };
}

function setPhoto_(user, photo) {
  photo = String(photo || '');
  if (photo && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) throw err_('Invalid image');
  if (photo.length > 45000) throw err_('Photo is too large — choose a smaller image');
  patchRow_('Users', user.id, { photo: photo, updatedBy: user.email, updatedAt: new Date().toISOString() });
  audit_(user, 'update', 'Users', user.id, photo ? 'Changed profile photo' : 'Removed profile photo');
  return { photo: photo };
}

// ---------------------------------------------------------------------------
// Estimates. Each save is a row: version 1 is the original, later versions are
// updates (history is kept). Sections/specs/terms are stored as JSON in "data".
// ---------------------------------------------------------------------------
function canSeeAllEstimates_(user) { return ACCOUNTS_ROLES.indexOf(user.role) >= 0; }

function estimateOwner_(rows, estimateNo) {
  const orig = rows.filter(function (r) { return r.estimateNo === estimateNo; })
    .sort(function (a, b) { return Number(a.version) - Number(b.version); })[0];
  return orig ? String(orig.createdBy).toLowerCase() : '';
}

function canEditEstimate_(user, rows, estimateNo) {
  return user.role === 'Admin' || estimateOwner_(rows, estimateNo) === String(user.email).toLowerCase();
}

function estimatesList_(user) {
  const rows = readTable_('Estimates');
  const me = String(user.email).toLowerCase();
  const mine = {};
  rows.forEach(function (r) { if (estimateOwner_(rows, r.estimateNo) === me) mine[r.estimateNo] = true; });
  return rows.filter(function (r) { return canSeeAllEstimates_(user) || mine[r.estimateNo]; }).map(function (r) {
    const o = Object.assign({}, r);
    delete o.data;
    delete o.logs;
    o.isOriginal = isTrue_(r.isOriginal);
    o.version = Number(r.version) || 1;
    return o;
  });
}

function estimateGet_(user, id) {
  const rows = readTable_('Estimates');
  const r = rows.filter(function (x) { return x.id === id; })[0];
  if (!r) throw err_('Estimate not found');
  if (!canSeeAllEstimates_(user) && estimateOwner_(rows, r.estimateNo) !== String(user.email).toLowerCase()) throw err_('You can only open your own estimates', 'FORBIDDEN');
  const o = Object.assign({}, r);
  try { o.data = JSON.parse(r.data || '{}'); } catch (e) { o.data = {}; }
  try { o.logs = JSON.parse(r.logs || '[]'); } catch (e) { o.logs = []; }
  o.isOriginal = isTrue_(r.isOriginal);
  o.version = Number(r.version) || 1;
  return o;
}

function estimateTotal_(sections) {
  return (sections || []).reduce(function (a, s) {
    return a + (s.items || []).reduce(function (b, i) { return b + (parseFloat(i.amount) || 0); }, 0);
  }, 0);
}

function cleanEstimateData_(d) {
  d = d || {};
  const txt = function (v, max) { return String(v === null || v === undefined ? '' : v).slice(0, max || 5000); };
  return {
    sections: (d.sections || []).slice(0, 60).map(function (s) {
      return { title: txt(s.title, 300), items: (s.items || []).slice(0, 60).map(function (i) {
        return { name: txt(i.name), area: txt(i.area, 40), unit: txt(i.unit, 20), amount: txt(i.amount, 20) };
      }) };
    }),
    specs: (d.specs || []).slice(0, 60).map(function (x) { return { cat: txt(x.cat, 200), detail: txt(x.detail, 2000) }; }),
    terms: (d.terms || []).slice(0, 60).map(function (x) { return { label: txt(x.label, 4), text: txt(x.text, 2000) }; }),
  };
}

function estimateSave_(user, rec, mode) {
  rec = rec || {};
  const client = rec.client || {};
  const clientName = String(client.name || '').trim();
  if (!clientName) throw err_('Client name is required');
  const data = cleanEstimateData_(rec.data);
  const dataJson = JSON.stringify(data);
  if (dataJson.length > 45000) throw err_('This estimate is too long to save (over 45,000 characters). Shorten some descriptions.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rows = readTable_('Estimates');
    const settings = readSettings_();
    const now = new Date();
    const stamp = now.toISOString();
    const by = user.email;
    let o;
    const newLogs = (rec.newLogs || []).slice(0, 50).map(function (l) { return { time: stamp, user: by, action: String(l).slice(0, 200) }; });
    if (mode === 'new') {
      const counter = (Number(settings.estimateCounter) || 0) + 1;
      writeSettings_(user, [['estimateCounter', counter]]);
      const estimateNo = (settings.company.estimatePrefix || 'RFIUL') + Utilities.formatDate(now, TZ, 'MMdd') + counter;
      o = { id: newId_('ES'), estimateNo: estimateNo, version: 1, isOriginal: 'TRUE', status: 'Draft', clientId: '' };
      newLogs.unshift({ time: stamp, user: by, action: 'Saved original estimate ' + estimateNo });
      o.logs = JSON.stringify(newLogs);
    } else {
      const no = String(rec.estimateNo || '');
      const versions = rows.filter(function (r) { return r.estimateNo === no; });
      if (!versions.length) throw err_('Estimate ' + no + ' not found');
      if (!canEditEstimate_(user, rows, no)) throw err_('Only the person who created this estimate, or an Admin, can update it', 'FORBIDDEN');
      const latest = versions.sort(function (a, b) { return Number(b.version) - Number(a.version); })[0];
      let prevLogs = [];
      try { prevLogs = JSON.parse(latest.logs || '[]'); } catch (e) { /* ignore */ }
      const version = Number(latest.version) + 1;
      newLogs.unshift({ time: stamp, user: by, action: 'Updated to V' + version });
      o = { id: newId_('ES'), estimateNo: no, version: version, isOriginal: 'FALSE', status: latest.status || 'Draft', clientId: latest.clientId || '' };
      o.logs = JSON.stringify(newLogs.concat(prevLogs).slice(0, 300));
    }
    Object.assign(o, {
      estimateDate: /^\d{4}-\d{2}-\d{2}$/.test(rec.estimateDate || '') ? rec.estimateDate : Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
      clientName: clientName.slice(0, 200), clientPhone: String(client.phone || '').trim().slice(0, 40), clientAddress: String(client.address || '').trim().slice(0, 500),
      grandTotal: estimateTotal_(data.sections), data: dataJson,
      createdBy: by, createdAt: stamp, updatedBy: by, updatedAt: stamp,
    });
    if (mode !== 'new') {
      const orig = rows.filter(function (r) { return r.estimateNo === o.estimateNo; }).sort(function (a, b) { return Number(a.version) - Number(b.version); })[0];
      o.createdBy = orig.createdBy;
    }
    appendObj_('Estimates', o);
    audit_(user, mode === 'new' ? 'create' : 'update', 'Estimates', o.estimateNo, 'V' + o.version + ' ' + o.clientName + ' ' + o.grandTotal);
    return { record: estimateGet_(user, o.id), estimates: estimatesList_(user) };
  } finally {
    lock.releaseLock();
  }
}

function estimateDelete_(user, id) {
  const rows = readTable_('Estimates');
  const r = rows.filter(function (x) { return x.id === id; })[0];
  if (!r) throw err_('Estimate not found');
  if (!canEditEstimate_(user, rows, r.estimateNo)) throw err_('Only the person who created this estimate, or an Admin, can delete it', 'FORBIDDEN');
  const sh = sheet_('Estimates');
  const values = sh.getDataRange().getValues();
  const idCol = values[0].map(String).indexOf('id');
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][idCol]) === id) { sh.deleteRow(i + 1); break; }
  }
  audit_(user, 'delete', 'Estimates', r.estimateNo, 'V' + r.version + ' ' + r.clientName);
  return { estimates: estimatesList_(user) };
}

function setEstimateFields_(estimateNo, patch) {
  readTable_('Estimates').filter(function (r) { return r.estimateNo === estimateNo; }).forEach(function (r) { patchRow_('Estimates', r.id, patch); });
}

function estimateStatus_(user, estimateNo, status) {
  if (['Draft', 'Sent', 'Approved', 'Rejected'].indexOf(status) < 0) throw err_('Invalid status');
  const rows = readTable_('Estimates');
  if (!canEditEstimate_(user, rows, estimateNo) && WRITE_ROLES.indexOf(user.role) < 0) throw err_('You cannot change this estimate', 'FORBIDDEN');
  setEstimateFields_(estimateNo, { status: status, updatedBy: user.email, updatedAt: new Date().toISOString() });
  audit_(user, 'update', 'Estimates', estimateNo, 'Status ' + status);
  return { estimates: estimatesList_(user) };
}

function estimateToClient_(user, estimateNo) {
  needRole_(user, WRITE_ROLES);
  const versions = readTable_('Estimates').filter(function (r) { return r.estimateNo === estimateNo; })
    .sort(function (a, b) { return Number(b.version) - Number(a.version); });
  if (!versions.length) throw err_('Estimate not found');
  const latest = versions[0];
  if (latest.clientId && readTable_('Clients').some(function (c) { return c.id === latest.clientId; })) throw err_('This estimate is already linked to a client');
  const saved = saveRecord_(user, 'Clients', {
    name: latest.clientName, phone: latest.clientPhone, siteAddress: latest.clientAddress, estimateRef: estimateNo,
    approvedAmount: Number(latest.grandTotal) || '', startDate: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), status: 'Ongoing',
    notes: 'Created from estimate ' + estimateNo + ' V' + latest.version,
  }).record;
  setEstimateFields_(estimateNo, { clientId: saved.id, status: 'Approved', updatedBy: user.email, updatedAt: new Date().toISOString() });
  return { client: saved, estimates: estimatesList_(user) };
}

// One-time copy of estimates from the old Firebase estimate page.
function estimateImport_(user, records) {
  needRole_(user, ['Admin']);
  const rows = readTable_('Estimates');
  const have = {};
  rows.forEach(function (r) { have[r.estimateNo + '#' + r.version] = true; });
  const settings = readSettings_();
  let maxCounter = Number(settings.estimateCounter) || 0;
  const out = [];
  (records || []).forEach(function (r) {
    const no = String(r.estimateNo || '').trim();
    const version = Math.max(1, Number(r.version) || 1);
    if (!no || have[no + '#' + version]) return;
    have[no + '#' + version] = true;
    const data = cleanEstimateData_(r);
    const dm = String(r.estimateDate || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
    const m = no.match(/(\d+)$/);
    if (m && m[1].length > 4) maxCounter = Math.max(maxCounter, Number(m[1].slice(4)) || 0);
    out.push({
      id: newId_('ES'), estimateNo: no, version: version, isOriginal: version === 1 ? 'TRUE' : 'FALSE',
      estimateDate: dm ? dm[3] + '-' + dm[2] + '-' + dm[1] : '', clientName: String((r.client || {}).name || 'Unnamed').slice(0, 200),
      clientPhone: '', clientAddress: String((r.client || {}).address || '').slice(0, 500), grandTotal: estimateTotal_(data.sections),
      status: 'Sent', clientId: '', data: JSON.stringify(data),
      logs: JSON.stringify((r.editLogs || []).slice(0, 200).map(function (l) { return { time: l.date || l.time || '', user: l.user_id || '', action: String(l.action || '').slice(0, 200) }; })),
      createdBy: String(r.createdBy || user.email), createdAt: String(r.updatedAt || new Date().toISOString()),
      updatedBy: String(r.updatedBy || r.createdBy || user.email), updatedAt: String(r.updatedAt || new Date().toISOString()),
    });
  });
  appendRows_('Estimates', out);
  if (maxCounter > (Number(settings.estimateCounter) || 0)) writeSettings_(user, [['estimateCounter', maxCounter]]);
  audit_(user, 'import', 'Estimates', '', out.length + ' estimates from the old estimate page');
  return { imported: out.length, estimates: estimatesList_(user) };
}

// ---------------------------------------------------------------------------
// Attendance — marked only from the office network (IP prefix) or, if
// enabled, from within the office geofence. Times are India time.
// ---------------------------------------------------------------------------
function v6Groups_(ip) {
  if (ip.indexOf(':') < 0) return null;
  const parts = ip.split('::');
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const fill = [];
  if (parts.length > 1) for (let k = 0; k < 8 - head.length - tail.length; k++) fill.push('0');
  return head.concat(fill, tail).map(function (g) { return (g.replace(/^0+/, '') || '0').toLowerCase(); });
}

function officeCheck_(settings, ip, lat, lng) {
  const a = settings.attendance;
  ip = String(ip || '').trim().toLowerCase();
  const ipOk = !!ip && a.ipPrefixes.some(function (p) {
    p = String(p).trim().toLowerCase().replace(/\/\d+$/, '').replace(/[:.]+$/, '');
    if (!p) return false;
    if (p.indexOf(':') >= 0) {
      const ig = v6Groups_(ip);
      const pg = p.split(':').map(function (g) { return g.replace(/^0+/, '') || '0'; });
      return !!ig && pg.every(function (g, k) { return ig[k] === g; });
    }
    return ip === p || ip.indexOf(p + '.') === 0;
  });
  let geoOk = false;
  if (a.geo.enabled && lat !== '' && lat !== undefined && lng !== '' && lng !== undefined && a.geo.lat !== '') {
    const R = 6371000;
    const toRad = function (d) { return d * Math.PI / 180; };
    const dLat = toRad(Number(lat) - a.geo.lat);
    const dLng = toRad(Number(lng) - a.geo.lng);
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(a.geo.lat)) * Math.cos(toRad(Number(lat))) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    geoOk = 2 * R * Math.asin(Math.sqrt(h)) <= a.geo.radius;
  }
  return ipOk ? 'Office IP' : geoOk ? 'Office location' : '';
}

function attendanceToday_(user) {
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return readTable_('Attendance').filter(function (r) { return r.date === today && r.email.toLowerCase() === user.email.toLowerCase(); })[0] || null;
}

function attendanceMark_(user, req) {
  const settings = readSettings_();
  const method = officeCheck_(settings, req.ip, req.lat, req.lng);
  if (!method) throw err_('Attendance can be marked only from the office network. Your IP: ' + (req.ip || 'unknown'), 'NOT_OFFICE');
  const now = new Date();
  const date = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const time = Utilities.formatDate(now, TZ, 'HH:mm');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const row = readTable_('Attendance').filter(function (r) { return r.date === date && r.email.toLowerCase() === user.email.toLowerCase(); })[0];
    if (!row) {
      const o = {
        id: newId_('AT'), date: date, email: user.email, name: user.name, checkIn: time, checkOut: '', ip: String(req.ip || '').slice(0, 60), method: method,
        status: time > settings.attendance.startTime ? 'Late' : 'Present', notes: '',
        createdBy: user.email, createdAt: now.toISOString(), updatedBy: user.email, updatedAt: now.toISOString(),
      };
      appendObj_('Attendance', o);
      audit_(user, 'attendance', 'Attendance', o.id, 'Check-in ' + time + ' via ' + method);
      return { record: o, action: 'in' };
    }
    if (req.kind === 'in') return { record: row, action: 'already' };
    patchRow_('Attendance', row.id, { checkOut: time, updatedBy: user.email, updatedAt: now.toISOString() });
    row.checkOut = time;
    return { record: row, action: 'out' };
  } finally {
    lock.releaseLock();
  }
}

function attendanceList_(user, from, to) {
  const all = ['Admin', 'Accountant'].indexOf(user.role) >= 0;
  return readTable_('Attendance').filter(function (r) {
    return (all || r.email.toLowerCase() === user.email.toLowerCase()) && (!from || r.date >= from) && (!to || r.date <= to);
  });
}

function attendanceSave_(user, rec) {
  needRole_(user, ['Admin']);
  rec = rec || {};
  const statuses = ['Present', 'Late', 'Half Day', 'Leave', 'Absent', 'Holiday'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date || '')) throw err_('Invalid date');
  if (statuses.indexOf(rec.status) < 0) throw err_('Invalid status');
  const target = readTable_('Users').filter(function (u) { return u.email.toLowerCase() === String(rec.email || '').toLowerCase(); })[0];
  if (!target) throw err_('Member not found');
  const t = function (v) { v = String(v || '').trim(); if (v && !/^\d{2}:\d{2}$/.test(v)) throw err_('Time must be HH:MM'); return v; };
  const patch = { status: rec.status, checkIn: t(rec.checkIn), checkOut: t(rec.checkOut), notes: String(rec.notes || '').slice(0, 300), updatedBy: user.email, updatedAt: new Date().toISOString() };
  const row = readTable_('Attendance').filter(function (r) { return r.date === rec.date && r.email.toLowerCase() === target.email.toLowerCase(); })[0];
  if (row) patchRow_('Attendance', row.id, patch);
  else appendObj_('Attendance', Object.assign({ id: newId_('AT'), date: rec.date, email: target.email, name: target.name, ip: '', method: 'Manual (Admin)', createdBy: user.email, createdAt: new Date().toISOString() }, patch));
  audit_(user, 'attendance', 'Attendance', target.email, rec.date + ' ' + rec.status);
  return {};
}

// ---------------------------------------------------------------------------
// Bulk import (Settings → Import data). Every imported row carries the batch
// tag in its notes so the whole batch can be undone.
// ---------------------------------------------------------------------------
const IMPORT_TABLES = ['ClientWork', 'ClientPayments', 'OfficeExpenses', 'SalaryAdvances', 'SalaryPayments'];

function tagOf_(tag) { return '[import:' + tag + ']'; }

function appendRows_(table, objs) {
  if (!objs.length) return;
  const sh = sheet_(table);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const types = types_(table);
  const start = sh.getLastRow() + 1;
  const need = start + objs.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 50);
  const formats = headers.map(function (k) { return types[k] ? numberFormat_(types[k]) : 'General'; });
  const range = sh.getRange(start, 1, objs.length, headers.length);
  range.setNumberFormats(objs.map(function () { return formats; }));
  range.setValues(objs.map(function (o) { return headers.map(function (k) { return toCell_(o[k], types[k]); }); }));
}

function importBatch_(user, data) {
  needRole_(user, ['Admin']);
  if (!data || data.format !== 'account-master-import' || !data.tag) throw err_('This is not an Account Master import file');
  const tag = String(data.tag).replace(/[^\w.-]/g, '').slice(0, 40);
  const mark = tagOf_(tag);
  const settings = readSettings_();
  if (settings.imports.some(function (i) { return i.tag === tag && !i.undone; })) throw err_('This file was already imported. Undo it first to import again.');

  // Dropdown lists the imported rows use
  const lists = {};
  Object.keys(data.lists || {}).forEach(function (k) {
    if (!(k in DEFAULT_SETTINGS.lists)) return;
    const cur = settings.lists[k].slice();
    (data.lists[k] || []).forEach(function (v) { if (cur.indexOf(v) < 0) cur.push(v); });
    lists[k] = cur;
  });
  if (Object.keys(lists).length) writeSettings_(user, Object.keys(lists).map(function (k) { return ['list.' + k, lists[k]]; }));

  // Employees: update existing ones (matched by name), create the rest (tagged)
  const known = {};
  readTable_('Employees').forEach(function (e) { known[String(e.name).trim().toLowerCase()] = true; });
  importEmployees_(user, (data.employees || []).map(function (e) {
    const o = Object.assign({}, e);
    if (known[String(o.name || '').trim().toLowerCase()]) delete o.notes;
    else o.notes = (o.notes ? o.notes + ' ' : '') + mark;
    return o;
  }), '');
  const empId = {};
  readTable_('Employees').forEach(function (e) { empId[String(e.name).trim().toLowerCase()] = e.id; });

  // Clients: match by name, otherwise create (tagged)
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const counts = {};
  try {
    const now = new Date().toISOString();
    const meta = { createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now };
    const clients = readTable_('Clients');
    const cliId = {};
    clients.forEach(function (c) { cliId[String(c.name).trim().toLowerCase()] = c.id; });
    const csh = sheet_('Clients');
    const cvals = csh.getDataRange().getValues();
    const chead = cvals[0].map(String);
    const newClients = [];
    (data.clients || []).forEach(function (c) {
      const key = String(c.name || '').trim().toLowerCase();
      if (!key || cliId[key]) return;
      const o = Object.assign(sanitize_('Clients', c), meta);
      o.id = newId_('CL');
      o.clientCode = nextCode_(cvals, chead, 'clientCode', 'UL-C-');
      cvals.push(chead.map(function (h) { return o[h] || ''; }));
      o.notes = (o.notes ? o.notes + ' ' : '') + mark;
      if (!o.status) o.status = 'Ongoing';
      cliId[key] = o.id;
      newClients.push(o);
    });
    appendRows_('Clients', newClients);
    counts.Clients = newClients.length;

    IMPORT_TABLES.forEach(function (table) {
      const existingPays = table === 'SalaryPayments' ? readTable_('SalaryPayments') : [];
      const out = [];
      (data[table] || []).forEach(function (r) {
        const rec = Object.assign({}, r);
        if ('client' in rec) { rec.clientId = cliId[String(rec.client).trim().toLowerCase()] || ''; delete rec.client; }
        if ('employee' in rec) { rec.employeeId = empId[String(rec.employee).trim().toLowerCase()] || ''; delete rec.employee; }
        const o = Object.assign(sanitize_(table, rec), meta);
        (SCHEMA[table].required || []).forEach(function (k) {
          if (o[k] === '' || o[k] === undefined) throw err_(table + ': missing ' + k + ' in ' + JSON.stringify(r).slice(0, 120));
        });
        if (table === 'SalaryPayments' && existingPays.some(function (p) { return p.employeeId === o.employeeId && p.salaryMonth === o.salaryMonth; })) return;
        o.id = newId_(SCHEMA[table].prefix);
        o.notes = (o.notes ? o.notes + ' ' : '') + mark;
        out.push(o);
      });
      appendRows_(table, out);
      counts[table] = out.length;
    });
  } finally {
    lock.releaseLock();
  }
  counts.Employees = readTable_('Employees').filter(function (e) { return String(e.notes).indexOf(mark) >= 0; }).length;

  const imports = readSettings_().imports.filter(function (i) { return i.tag !== tag; });
  imports.unshift({ tag: tag, source: String(data.source || '').slice(0, 200), at: new Date().toISOString(), by: user.email, counts: counts });
  writeSettings_(user, [['imports', imports.slice(0, 20)]]);
  audit_(user, 'import', 'All', tag, JSON.stringify(counts));
  return { counts: counts };
}

function undoImport_(user, tag) {
  needRole_(user, ['Admin']);
  const mark = tagOf_(String(tag || ''));
  const counts = {};
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    IMPORT_TABLES.concat(['Clients', 'Employees']).forEach(function (table) {
      const sh = sheet_(table);
      const values = sh.getDataRange().getValues();
      const n = values[0].map(String).indexOf('notes');
      let removed = 0;
      for (let i = values.length - 1; i >= 1; i--) {
        if (String(values[i][n]).indexOf(mark) >= 0) {
          if (table === 'Clients' || table === 'Employees') {
            const id = values[i][values[0].map(String).indexOf('id')];
            const linked = (CHILDREN[table] || []).some(function (c) {
              return readTable_(c[0]).some(function (r) { return r[c[1]] === id; });
            });
            if (linked) continue;
          }
          sh.deleteRow(i + 1);
          removed++;
        }
      }
      counts[table] = removed;
    });
  } finally {
    lock.releaseLock();
  }
  const imports = readSettings_().imports.map(function (i) {
    if (i.tag === tag) { i.undone = new Date().toISOString(); i.undoneBy = user.email; }
    return i;
  });
  writeSettings_(user, [['imports', imports]]);
  audit_(user, 'undo import', 'All', tag, JSON.stringify(counts));
  return { counts: counts };
}

// Create/update employees from rows of a linked sheet tab. Matches by email,
// then mobile, then name. Blank cells never overwrite existing values.
function importEmployees_(user, records, source) {
  needRole_(user, WRITE_ROLES);
  records = (records || []).map(function (r) { return sanitize_('Employees', r || {}); }).filter(function (r) { return r.name; });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let created = 0;
  let updated = 0;
  try {
    const sh = sheet_('Employees');
    const values = sh.getDataRange().getValues();
    const headers = values[0].map(String);
    const types = types_('Employees');
    const existing = values.slice(1).map(function (row, i) { return { i: i + 1, o: rowToObj_(headers, row, types) }; })
      .filter(function (x) { return x.o.id; });
    const digits = function (v) { return String(v || '').replace(/\D/g, '').slice(-10); };
    const now = new Date().toISOString();
    let next = values.length + 1;
    const codeVals = values.slice();

    records.forEach(function (r) {
      const email = String(r.email || '').toLowerCase();
      const match = existing.filter(function (x) {
        return (email && String(x.o.email).toLowerCase() === email) ||
          (digits(r.phone) && digits(x.o.phone) === digits(r.phone)) ||
          String(x.o.name).trim().toLowerCase() === String(r.name).trim().toLowerCase();
      })[0];
      if (match) {
        let changed = false;
        Object.keys(r).forEach(function (k) {
          if (r[k] !== '' && String(r[k]) !== String(match.o[k])) { match.o[k] = r[k]; changed = true; }
        });
        if (!changed) return;
        match.o.updatedBy = user.email;
        match.o.updatedAt = now;
        writeRow_(sh, match.i + 1, headers, types, headers.map(function (k) { return toCell_(match.o[k], types[k]); }));
        updated++;
      } else {
        const o = Object.assign({ status: 'Active', monthlySalary: 0 }, r);
        Object.keys(o).forEach(function (k) { if (o[k] === '') delete o[k]; });
        if (!o.status) o.status = 'Active';
        o.id = newId_('EM');
        o.empCode = nextCode_(codeVals, headers, 'empCode', 'UL-E-');
        o.createdBy = o.updatedBy = user.email;
        o.createdAt = o.updatedAt = now;
        const row = headers.map(function (k) { return toCell_(o[k], types[k]); });
        writeRow_(sh, next++, headers, types, row);
        codeVals.push(row);
        existing.push({ i: next - 2, o: o });
        created++;
      }
    });
  } finally {
    lock.releaseLock();
  }
  const settings = readSettings_();
  if (settings.employeeSource && source === settings.employeeSource.tab) {
    const src = settings.employeeSource;
    src.lastSync = new Date().toISOString();
    src.lastSyncBy = user.email;
    writeSettings_(user, [['employeeSource', src]]);
  }
  if (created || updated) audit_(user, 'sync', 'Employees', '', 'From sheet "' + source + '": ' + created + ' added, ' + updated + ' updated');
  return { created: created, updated: updated, records: readTable_('Employees'), settings: readSettings_() };
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
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh && SCHEMA[name]) {
    // Tabs added in later versions are created on first use.
    sh = ss.insertSheet(name);
    const fields = fields_(name);
    sh.getRange(1, 1, 1, fields.length).setValues([fields.map(function (f) { return f[0]; })])
      .setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  if (!sh) throw err_('Sheet tab "' + name + '" is missing. Run setup() once from the Apps Script editor.');
  ensureColumns_(sh, name);
  return sh;
}

// Columns added in later versions are appended to existing tabs on first use.
const CHECKED_COLUMNS_ = {};
function ensureColumns_(sh, name) {
  if (!SCHEMA[name] || CHECKED_COLUMNS_[name]) return;
  CHECKED_COLUMNS_[name] = true;
  const lastCol = sh.getLastColumn();
  const headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = fields_(name).map(function (f) { return f[0]; }).filter(function (f) { return headers.indexOf(f) < 0; });
  if (missing.length) sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
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
