# Sherzad Enterprise ERP — Business Management & Double-Entry Accounting System

A complete, production-ready **Business Management, Double-Entry Accounting, Sales, Point of Sale (POS), Purchases, Multi-Warehouse Inventory, Debtors, Creditors, Treasury, and Financial Reporting Platform**.

---

## 1. Key Capabilities

- **Trilingual RTL/LTR Interface**: Instant switching between **Arabic (العربية — RTL)**, **Kurdish Sorani (کوردی سۆرانی — RTL)**, and **English (LTR)**.
- **Multi-Currency Financial Engine**: Native support for **US Dollar (`USD`)** and **Iraqi Dinar (`IQD`)** with configurable exchange rates, exchange rate audit history, and strict `Decimal.js` arithmetic (zero floating-point errors).
- **Double-Entry Accounting Engine**:
  - 28-account structured Chart of Accounts (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`).
  - Automatic journal entries posted from Sales, Sales Returns, Purchases, Purchase Returns, Expenses, Debtor Collections, Creditor Settlements, Stock Adjustments, and Cash/Bank Transfers.
  - Strict invariant enforcement: **`Total Debits === Total Credits`**.
  - Reversing journal entries instead of deleting posted financial history.
  - Fiscal Period closing and locking.
- **Complete Operational Modules**:
  - **Executive Dashboard**: 12+ live database KPIs, Daily & Monthly Recharts analytics, low-stock alerts, unpaid invoices, and recent ledger activity.
  - **Sales & POS**: Standard Sales Invoice builder + Quick POS Terminal, barcode/SKU search, line & invoice discounts, tax calculation, negative stock protection, credit limit verification, A4 Invoice & 80mm Thermal POS Receipt printing, and Sales Returns.
  - **Purchases & Procurement**: Supplier invoice receiving, weighted-average cost recalculation, cash/credit/partial payments, and Purchase Returns.
  - **Expenses**: 9 operating expense categories mapped to Chart of Accounts, recurring expenses, receipt references, and automatic **Management Approval Workflow** for large expenses.
  - **Debtors (AR) & Creditors (AP)**: Partial & full debt collections/settlements with FIFO invoice auto-allocation and printable chronological Account Statements with running balances.
  - **Multi-Warehouse Inventory**: Product catalog, warehouse stock breakdown, stock adjustments with automatic GL journal posting, and atomic inter-warehouse stock transfers.
  - **Cash & Bank Treasury**: Multiple USD & IQD cash registers and corporate bank accounts, deposits, withdrawals, cross-currency internal transfers, and statement reconciliation.
  - **14 Enterprise Financial & Operational Reports**: Including Accrual Profit & Loss (Income Statement), Balance Sheet (`Assets = Liabilities + Equity`), Trial Balance (`Debits = Credits`), General Ledger, Cash Flow, and Daily Financial Summary with Print/PDF and Excel CSV export.
  - **Employees & RBAC**: 6 configurable roles (`SUPER_ADMIN`, `BUSINESS_OWNER`, `ACCOUNTANT`, `SALES_EMPLOYEE`, `INVENTORY_MANAGER`, `VIEWER`), interactive permission matrix, and immutable Audit Trail.

---

## 2. Default Administrator & Role Accounts

When initialized via `npm run db:setup` or first launch, the system creates 6 role accounts (Default Password for all demo accounts: **`Admin@123`**):

| Role | Username | Email | Password |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin` | `admin@sherzad.iq` | `Admin@123` |
| **Business Owner** | `owner` | `owner@sherzad.iq` | `Admin@123` |
| **Accountant** | `accountant` | `accountant@sherzad.iq` | `Admin@123` |
| **Sales Employee** | `sales` | `sales@sherzad.iq` | `Admin@123` |
| **Inventory Manager** | `inventory` | `inventory@sherzad.iq` | `Admin@123` |
| **Viewer / Auditor** | `viewer` | `viewer@sherzad.iq` | `Admin@123` |

> **Creating the First Production Administrator**:
> Change the default password immediately via **Sign In -> Change Password** or create a new `SUPER_ADMIN` / `BUSINESS_OWNER` account in **Employees & RBAC**.

---

## 3. Running & Testing

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma client, push schema, and seed initial accounts
npm run db:setup

# 3. Run automated test suite (Vitest)
npm test

# 4. Start development server
npm run dev
```

For **Production PostgreSQL Deployment**:
1. Update `DATABASE_URL` in `.env` to your PostgreSQL connection string (`postgresql://user:password@host:5432/sherzad_erp?schema=public`).
2. Use `prisma/schema.postgresql.prisma` (`npx prisma db push --schema=prisma/schema.postgresql.prisma`).
