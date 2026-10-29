# Account Master — Urbane Living

Accounts dashboard for Urbane Living. The accountant does all the work from this dashboard, and every entry is saved to the Google Sheet.

- **Clients:** create clients, record labour and material costs by date, and record client payments. The app shows the approved estimate, amount received, amount due, site cost and margin.
- **Office expenses:** rent, electricity bill, water bottles, tea/coffee/milk/sugar and similar costs, with categories you can change.
- **Employees & salary:** salary sheet = base salary + expenses − advances − deductions + bonus. You can record payments and keep a month-wise history.
- **Employee expenses:** bike travel (km × ₹3 by default), fuel, food and so on. These are added to the salary of the month you choose.
- **Login & members:** Admin, Accountant and Viewer roles. Admins add members from Settings.
- **Dashboard:** cash in vs cash out, client dues, pending salary, recent entries.
- Fully responsive (phone, tablet, desktop), dark mode, CSV export and print.

Preview with sample data (stored only in your browser): open `index.html?demo=1` and log in with `accounts@urbaneliving.in` / `demo1234`.

---

## Architecture

```
GitHub Pages (index.html + assets/)  ──HTTPS──▶  Google Apps Script Web App  ──▶  Google Sheet
         frontend                                  apps-script/Code.gs              (database)
```

Each table is one tab in the sheet:

| Tab | What it holds |
|---|---|
| `Users` | Login members (passwords are stored hashed) |
| `Clients` | Client, site, approved estimate, status |
| `ClientWork` | Labour / material entries by date |
| `ClientPayments` | Payments received from clients |
| `OfficeExpenses` | Rent, bills, pantry and other office costs |
| `Employees` | Employee details and monthly salary |
| `EmployeeExpenses` | Travel (km), fuel, food and other expenses, linked to a salary month |
| `SalaryAdvances` | Advances, deducted from a salary month |
| `SalaryPayments` | Salary paid for each employee and month |
| `Settings` | Dropdown lists, company name, rate per km |
| `AuditLog` | Who added, changed or deleted what, and when |

> Don't rename the column headers in row 1. You can add your own extra columns at the end.

---

## Setup (one time, about 10 minutes)

### 1. Apps Script backend
1. Open the Google Sheet, then go to **Extensions → Apps Script**.
2. Delete any existing code and paste the full contents of `apps-script/Code.gs`. Save it.
3. Select the `setup` function at the top and click **Run**. Allow the permissions it asks for.
4. Open **Execution log**. It shows a **one-time password** for each of the 4 members. Note these down. At first login, each member must set their own password.

### 2. Web App deploy
1. **Deploy → New deployment → Select type: Web app**
2. *Execute as*: **Me**. *Who has access*: **Anyone**. (The app has its own login, so the sheet itself stays private.)
3. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

### 3. Frontend config
Put the URL in `assets/js/config.js`:
```js
API_URL: 'https://script.google.com/macros/s/XXXX/exec',
```
Then commit and push.

### 4. GitHub Pages
Repo **Settings → Pages → Branch: `main` / root → Save**. The site will be live at
`https://urbaneliving.github.io/Account-Master/`.

### Updating the code later
After you change `Code.gs`: **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same.

---

## Roles

| Role | Can do |
|---|---|
| **Admin** | Everything, plus adding and removing members, resetting passwords, company settings and the activity log |
| **Accountant** | Add, edit and delete all records, and change dropdown lists |
| **Viewer** | View only |

If every Admin is locked out, fill in `EMAIL` and `NEW_PASSWORD` in the `emergencyResetPassword()` function in Apps Script and run it once. Then clear those values.

## How the numbers are calculated

- **Client due** = approved estimate − total received
- **Client margin** = approved estimate − (labour + material + other site cost)
- **Net salary** = base + that month's expenses − that month's advances − other deduction + bonus
- **Total spent (dashboard)** = site cost + office expenses + advances given + salary paid (cash basis, so nothing is counted twice)
