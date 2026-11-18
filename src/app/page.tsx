'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  PackageCheck,
  Receipt,
  UserCheck,
  Building,
  Boxes,
  Users,
  Building2,
  Landmark,
  TrendingUp,
  BookOpen,
  FileBarChart2,
  Shield,
  Settings,
  Search,
  Bell,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  LogIn,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Globe,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Sparkles,
  Menu,
  X,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  LanguageCode,
  LANGUAGE_METADATA,
  translations,
} from '@/lib/i18n';
import { fmtMoney, locName } from '@/lib/client-utils';
import { PrintModal } from '@/components/PrintModal';
import {
  SalesModuleView,
  PurchasesModuleView,
} from '@/components/SalesPurchasesViews';
import {
  InventoryModuleView,
  PartiesAndDebtModuleView,
} from '@/components/InventoryPartiesViews';
import {
  ExpensesModuleView,
  CashBankModuleView,
  ProfitAndLossModuleView,
  AccountingEngineModuleView,
} from '@/components/FinanceAccountingViews';
import {
  ReportsModuleView,
  EmployeesPermissionsView,
  SettingsModuleView,
} from '@/components/ReportsSettingsViews';

type ModuleKey =
  | 'dashboard'
  | 'sales'
  | 'purchases'
  | 'expenses'
  | 'debtors'
  | 'creditors'
  | 'inventory'
  | 'customers'
  | 'suppliers'
  | 'cashbank'
  | 'pnl'
  | 'accounting'
  | 'reports'
  | 'employees'
  | 'settings';

// Hostinger PHP 8 Universal Fetch Bridge: routes /api/<endpoint> directly to /api/index.php?route=<endpoint>
if (typeof window !== 'undefined' && !(window as any).__sherzadPhpBridgeInstalled) {
  (window as any).__sherzadPhpBridgeInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/') && !input.startsWith('/api/index.php')) {
      const [pathPart, queryPart] = input.slice(5).split('?');
      const phpUrl = `/api/index.php?route=${encodeURIComponent(pathPart)}${
        queryPart ? `&${queryPart}` : ''
      }`;
      return originalFetch(phpUrl, init);
    }
    return originalFetch(input, init);
  };
}

export default function SherzadEnterpriseApp() {
  const [activeModule, setActiveModule] = useState<ModuleKey>('dashboard');
  const [lang, setLang] = useState<LanguageCode>('ar');
  const [displayCurrency, setDisplayCurrency] = useState<'USD' | 'IQD'>('USD');
  const [darkMode, setDarkMode] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Global Application Data States
  const [bootstrap, setBootstrap] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [salesInvoices, setSalesInvoices] = useState<any[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [inventoryData, setInventoryData] = useState<any>(null);
  const [partiesData, setPartiesData] = useState<any>(null);
  const [cashBankData, setCashBankData] = useState<any>(null);
  const [accountingData, setAccountingData] = useState<any>(null);
  const [settingsData, setSettingsData] = useState<any>(null);

  // UI Popovers & Modals
  const [chartPeriod, setChartPeriod] = useState<'DAILY' | 'MONTHLY'>('DAILY');
  const [showNotifications, setShowNotifications] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginIdentifier, setLoginIdentifier] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('Admin@123');
  const [printableDoc, setPrintableDoc] = useState<any>(null);
  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  const notify = useCallback(
    (type: 'success' | 'error' | 'warning', message: string) => {
      setToast({ type, message });
      setTimeout(() => {
        setToast((prev) => (prev?.message === message ? null : prev));
      }, 4500);
    },
    []
  );

  // Sync RTL / LTR direction and Dark Mode class on <html>
  useEffect(() => {
    const dir = LANGUAGE_METADATA[lang].dir;
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
    localStorage.setItem('sherzad_erp_lang', lang);
  }, [lang]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Keyboard shortcut Ctrl+K for Global Command Search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowGlobalSearch((v) => !v);
      } else if (e.key === 'Escape') {
        setShowGlobalSearch(false);
        setShowNotifications(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadAllSystemData = useCallback(async () => {
    try {
      const [
        bootRes,
        dashRes,
        salesRes,
        purRes,
        expRes,
        invRes,
        partRes,
        cbRes,
        accRes,
        setRes,
      ] = await Promise.all([
        fetch('/api/bootstrap'),
        fetch('/api/dashboard'),
        fetch('/api/sales'),
        fetch('/api/purchases'),
        fetch('/api/expenses'),
        fetch('/api/inventory'),
        fetch('/api/parties'),
        fetch('/api/cashbank'),
        fetch('/api/accounting'),
        fetch('/api/settings'),
      ]);

      if (bootRes.ok) {
        const bootJson = await bootRes.json();
        setBootstrap(bootJson);
      }
      if (dashRes.ok) setDashboard(await dashRes.json());
      if (salesRes.ok) {
        const sJson = await salesRes.json();
        setSalesInvoices(sJson.invoices || []);
      }
      if (purRes.ok) {
        const pJson = await purRes.json();
        setPurchaseInvoices(pJson.invoices || []);
      }
      if (expRes.ok) {
        const eJson = await expRes.json();
        setExpenses(eJson.expenses || []);
      }
      if (invRes.ok) setInventoryData(await invRes.json());
      if (partRes.ok) setPartiesData(await partRes.json());
      if (cbRes.ok) setCashBankData(await cbRes.json());
      if (accRes.ok) setAccountingData(await accRes.json());
      if (setRes.ok) setSettingsData(await setRes.json());
    } catch (err) {
      console.error('Failed to load ERP data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedLang = localStorage.getItem('sherzad_erp_lang') as LanguageCode | null;
    if (savedLang && ['ar', 'ku', 'en'].includes(savedLang)) {
      setLang(savedLang);
    }
    loadAllSystemData();
  }, [loadAllSystemData]);

  const t = translations[lang];
  const isRtl = LANGUAGE_METADATA[lang].dir === 'rtl';
  const exchangeRate = Number(
    bootstrap?.settings?.usdToIqdRate ||
      dashboard?.kpis?.exchangeRate ||
      1500
  );

  const handleRoleSwitch = async (role: string) => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'switchRole', role }),
    });
    if (res.ok) {
      const data = await res.json();
      notify('success', `Active Role switched to ${data.user.role} (${data.user.name})`);
      await loadAllSystemData();
    } else {
      const err = await res.json();
      notify('error', err.error || 'Could not switch role');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'login',
        identifier: loginIdentifier,
        password: loginPassword,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      notify('success', `Welcome back, ${data.user.name}!`);
      setShowLoginModal(false);
      await loadAllSystemData();
    } else {
      notify('error', data.error || 'Invalid credentials');
    }
  };

  // Global Search Results across modules, products, customers, suppliers, invoices
  const globalSearchResults = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: {
      category: string;
      title: string;
      subtitle: string;
      targetModule: ModuleKey;
    }[] = [];

    for (const p of bootstrap?.products || []) {
      if (
        p.nameEn.toLowerCase().includes(q) ||
        p.nameAr.toLowerCase().includes(q) ||
        p.nameKu.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
      ) {
        results.push({
          category: 'Product',
          title: `${p.sku} — ${locName(p, lang)}`,
          subtitle: `Stock: ${Number(p.totalStock)} ${p.unit} • Price: $${Number(
            p.sellingPriceUsd
          ).toFixed(2)}`,
          targetModule: 'inventory',
        });
      }
    }

    for (const c of bootstrap?.customers || []) {
      if (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q))
      ) {
        results.push({
          category: 'Customer',
          title: `${c.code} — ${c.name}`,
          subtitle: `Phone: ${c.phone} • Debt Balance: $${Number(c.balanceUsd).toFixed(2)}`,
          targetModule: 'debtors',
        });
      }
    }

    for (const s of bootstrap?.suppliers || []) {
      if (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q)
      ) {
        results.push({
          category: 'Supplier',
          title: `${s.code} — ${s.name}`,
          subtitle: `Payable Balance: $${Number(s.balanceUsd).toFixed(2)}`,
          targetModule: 'creditors',
        });
      }
    }

    for (const inv of salesInvoices) {
      if (inv.invoiceNumber.toLowerCase().includes(q)) {
        results.push({
          category: 'Sales Invoice',
          title: `${inv.invoiceNumber} — ${inv.customer?.name}`,
          subtitle: `Status: ${inv.status} • Total: $${Number(inv.totalUsd).toFixed(2)}`,
          targetModule: 'sales',
        });
      }
    }

    return results.slice(0, 12);
  }, [globalSearchQuery, bootstrap, salesInvoices, lang]);

  const NAV_ITEMS: {
    id: ModuleKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }[] = [
    { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'sales', label: t.nav.sales, icon: ShoppingCart },
    { id: 'purchases', label: t.nav.purchases, icon: PackageCheck },
    {
      id: 'expenses',
      label: t.nav.expenses,
      icon: Receipt,
      badge: dashboard?.kpis?.pendingExpensesCount || undefined,
    },
    {
      id: 'debtors',
      label: t.nav.debtors,
      icon: UserCheck,
      badge: dashboard?.kpis?.unpaidSalesCount || undefined,
    },
    {
      id: 'creditors',
      label: t.nav.creditors,
      icon: Building,
      badge: dashboard?.kpis?.unpaidPurchasesCount || undefined,
    },
    {
      id: 'inventory',
      label: t.nav.inventory,
      icon: Boxes,
      badge: dashboard?.kpis?.lowStockCount || undefined,
    },
    { id: 'customers', label: t.nav.customers, icon: Users },
    { id: 'suppliers', label: t.nav.suppliers, icon: Building2 },
    { id: 'cashbank', label: t.nav.cashbank, icon: Landmark },
    { id: 'pnl', label: t.nav.pnl, icon: TrendingUp },
    { id: 'accounting', label: t.nav.accounting, icon: BookOpen },
    { id: 'reports', label: t.nav.reports, icon: FileBarChart2 },
    { id: 'employees', label: t.nav.employees, icon: Shield },
    { id: 'settings', label: t.nav.settings, icon: Settings },
  ];

  const kpis = dashboard?.kpis || {
    totalSalesUsd: 0,
    totalPurchasesUsd: 0,
    totalExpensesUsd: 0,
    netProfitUsd: 0,
    grossProfitUsd: 0,
    grossMarginPercent: 0,
    netMarginPercent: 0,
    totalCustomerDebtsUsd: 0,
    totalSupplierLiabilitiesUsd: 0,
    cashBalanceUsd: 0,
    inventoryCostValueUsd: 0,
    inventoryRetailValueUsd: 0,
    totalCustomers: 0,
    totalSuppliers: 0,
    lowStockCount: 0,
    unpaidSalesCount: 0,
    unpaidPurchasesCount: 0,
  };

  const notifications = bootstrap?.notifications || [];

  return (
    <div className="min-h-screen flex bg-charcoal-50 dark:bg-charcoal-950 text-charcoal-900 dark:text-slate-100">
      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed bottom-5 end-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-md animate-in fade-in slide-in-from-bottom-4 bg-charcoal-900/95 text-white border-emerald-500/40">
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : toast.type === 'warning' ? (
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
          )}
          <span className="text-xs font-semibold">{toast.message}</span>
        </div>
      )}

      {/* Printable Invoice / Receipt / Statement Modal */}
      <PrintModal
        doc={printableDoc}
        onClose={() => setPrintableDoc(null)}
        settings={bootstrap?.settings}
        lang={lang}
        displayCurrency={displayCurrency}
        exchangeRate={exchangeRate}
      />

      {/* Global Search Command Palette (Ctrl+K) */}
      {showGlobalSearch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/65 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex items-center gap-3">
              <Search className="w-5 h-5 text-emerald-500" />
              <input
                type="text"
                autoFocus
                value={globalSearchQuery}
                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full bg-transparent text-sm focus:outline-none"
              />
              <button
                onClick={() => setShowGlobalSearch(false)}
                className="text-xs text-slate-400 px-2 py-1 rounded bg-slate-100 dark:bg-charcoal-800"
              >
                ESC
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-3 space-y-1.5">
              {globalSearchResults.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  {globalSearchQuery
                    ? 'No matching records found.'
                    : 'Type a product SKU, customer name, supplier, or invoice number...'}
                </div>
              ) : (
                globalSearchResults.map((res, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setActiveModule(res.targetModule);
                      setShowGlobalSearch(false);
                    }}
                    className="w-full text-start p-3 rounded-xl hover:bg-emerald-500/10 flex items-center justify-between transition"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        {res.title}
                      </div>
                      <div className="text-[11px] text-slate-400">{res.subtitle}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-500 text-[10px] font-bold">
                      {res.category}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SIDEBAR NAVIGATION */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-20' : 'w-64'
        } hidden md:flex flex-col bg-charcoal-900 text-slate-200 border-e border-charcoal-800 transition-all duration-200 shrink-0 select-none`}
      >
        {/* Brand Logo Header */}
        <div className="p-4 border-b border-charcoal-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center font-black text-lg shadow-lg shadow-emerald-500/25 shrink-0">
              S
            </div>
            {!sidebarCollapsed && (
              <div className="truncate">
                <div className="font-bold text-sm text-white truncate">
                  {locName(
                    {
                      nameEn: bootstrap?.settings?.companyNameEn || 'Sherzad ERP',
                      nameAr: bootstrap?.settings?.companyNameAr || 'مجموعة شيرزاد',
                      nameKu: bootstrap?.settings?.companyNameKu || 'گرووپی شێرزاد',
                    },
                    lang
                  )}
                </div>
                <div className="text-[10px] text-emerald-400 font-medium truncate">
                  Enterprise Financial Suite
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg hover:bg-charcoal-800 text-slate-400 hover:text-white"
          >
            {sidebarCollapsed ? (
              isRtl ? (
                <ChevronLeft className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )
            ) : isRtl ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeModule === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveModule(item.id)}
                title={item.label}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                  isActive
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-600/20'
                    : 'text-slate-400 hover:bg-charcoal-800/70 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 truncate">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-white' : 'text-emerald-400/80'
                    }`}
                  />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </div>
                {!sidebarCollapsed && item.badge ? (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Active User Footer */}
        {!sidebarCollapsed && bootstrap?.user && (
          <div className="p-3.5 border-t border-charcoal-800 bg-charcoal-950/60 text-xs">
            <div className="flex items-center justify-between">
              <div className="truncate">
                <div className="font-bold text-white truncate">
                  {bootstrap.user.name}
                </div>
                <div className="text-[10px] font-mono text-emerald-400">
                  {bootstrap.user.role}
                </div>
              </div>
              <button
                onClick={() => setShowLoginModal(true)}
                title="Switch User / Sign In"
                className="p-1.5 rounded-lg bg-charcoal-800 hover:bg-charcoal-700 text-slate-300"
              >
                <LogIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 bg-white/90 dark:bg-charcoal-900/90 backdrop-blur-md border-b border-slate-200 dark:border-charcoal-800 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-xl bg-slate-100 dark:bg-charcoal-800"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Global Search Trigger */}
            <button
              onClick={() => setShowGlobalSearch(true)}
              className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs text-slate-400 hover:border-emerald-500/50 w-56 sm:w-80 transition"
            >
              <Search className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="truncate">{t.searchPlaceholder}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Live Exchange Rate Pill */}
            <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              <span>{t.exchangeRateLabel}:</span>
              <span className="font-mono font-bold">
                1 USD = {exchangeRate.toLocaleString()} IQD
              </span>
            </div>

            {/* Display Currency Switcher (USD / IQD) */}
            <div className="flex items-center bg-slate-100 dark:bg-charcoal-950 p-1 rounded-xl border border-slate-200 dark:border-charcoal-800 text-xs">
              <button
                onClick={() => setDisplayCurrency('USD')}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  displayCurrency === 'USD'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-500'
                }`}
              >
                $ USD
              </button>
              <button
                onClick={() => setDisplayCurrency('IQD')}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  displayCurrency === 'IQD'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-500'
                }`}
              >
                د.ع IQD
              </button>
            </div>

            {/* Trilingual Instant Language Switcher (Arabic, Kurdish Sorani, English) */}
            <div className="flex items-center bg-slate-100 dark:bg-charcoal-950 p-1 rounded-xl border border-slate-200 dark:border-charcoal-800 text-xs">
              {(['ar', 'ku', 'en'] as LanguageCode[]).map((code) => (
                <button
                  key={code}
                  onClick={() => setLang(code)}
                  className={`px-2.5 py-1 rounded-lg font-bold transition ${
                    lang === code
                      ? 'bg-teal-600 text-white shadow'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                  }`}
                >
                  {code === 'ar' ? 'العربية' : code === 'ku' ? 'کوردی' : 'EN'}
                </button>
              ))}
            </div>

            {/* Quick Role Switcher for Testing RBAC */}
            <select
              value={bootstrap?.user?.role || 'SUPER_ADMIN'}
              onChange={(e) => handleRoleSwitch(e.target.value)}
              title={t.quickRoleSwitch}
              className="hidden sm:block px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-[11px] font-mono font-bold text-emerald-500"
            >
              <option value="SUPER_ADMIN">Role: SUPER_ADMIN</option>
              <option value="BUSINESS_OWNER">Role: BUSINESS_OWNER</option>
              <option value="ACCOUNTANT">Role: ACCOUNTANT</option>
              <option value="SALES_EMPLOYEE">Role: SALES_EMPLOYEE</option>
              <option value="INVENTORY_MANAGER">Role: INVENTORY_MANAGER</option>
              <option value="VIEWER">Role: VIEWER</option>
            </select>

            {/* Notification Center Button */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2 rounded-xl bg-slate-100 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/40"
              >
                <Bell className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                {notifications.length > 0 && (
                  <span className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute end-0 mt-2 w-80 sm:w-96 bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl shadow-2xl z-50 overflow-hidden">
                  <div className="p-3.5 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
                    <span className="font-bold text-xs">{t.notifications}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-bold">
                      {notifications.length} Alerts
                    </span>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-charcoal-800">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        {t.noNotifications}
                      </div>
                    ) : (
                      notifications.map((n: any) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            setActiveModule(n.module as ModuleKey);
                            setShowNotifications(false);
                          }}
                          className="w-full text-start p-3 hover:bg-slate-50 dark:hover:bg-charcoal-800/50 transition flex items-start gap-2.5"
                        >
                          <div
                            className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                              n.severity === 'danger'
                                ? 'bg-rose-500'
                                : n.severity === 'warning'
                                ? 'bg-amber-500'
                                : 'bg-teal-500'
                            }`}
                          />
                          <div className="text-xs">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {lang === 'ar'
                                ? n.titleAr
                                : lang === 'ku'
                                ? n.titleKu
                                : n.titleEn}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {lang === 'ar'
                                ? n.descAr
                                : lang === 'ku'
                                ? n.descKu
                                : n.descEn}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Theme Toggle */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              title={t.switchTheme}
              className="p-2 rounded-xl bg-slate-100 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800"
            >
              {darkMode ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700" />
              )}
            </button>

            {/* Refresh Button */}
            <button
              onClick={loadAllSystemData}
              title={t.refresh}
              className="p-2 rounded-xl bg-slate-100 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-500' : ''}`} />
            </button>
          </div>
        </header>

        {/* Mobile Drawer Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-black/70 flex">
            <div className="w-64 bg-charcoal-900 text-white p-4 space-y-2 overflow-y-auto">
              <div className="flex justify-between items-center pb-3 border-b border-charcoal-800">
                <span className="font-bold text-sm">Sherzad Enterprise ERP</span>
                <button onClick={() => setMobileMenuOpen(false)}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveModule(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                      activeModule === item.id
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* PAGE BODY */}
        <main className="flex-1 p-5 md:p-6 overflow-y-auto max-w-[1600px] w-full mx-auto">
          {activeModule === 'dashboard' && (
            <div className="space-y-6">
              {/* Executive Banner */}
              <div className="bg-gradient-to-r from-charcoal-900 via-emerald-950 to-teal-950 text-white p-6 rounded-2xl border border-emerald-500/30 shadow-xl flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold mb-2">
                    <Sparkles className="w-3.5 h-3.5" />
                    DOUBLE-ENTRY GENERAL LEDGER VERIFIED • DEB=CRED
                  </div>
                  <h1 className="text-2xl font-black tracking-tight">
                    {t.dashboard.title}
                  </h1>
                  <p className="text-xs text-slate-300 mt-1">
                    {t.dashboard.subtitle}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => setActiveModule('sales')}
                    className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-charcoal-950 font-black text-xs shadow-lg shadow-emerald-500/25 transition"
                  >
                    + {t.sales.newInvoice}
                  </button>
                  <button
                    onClick={() => setActiveModule('purchases')}
                    className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/15 transition"
                  >
                    + {t.purchases.newPurchase}
                  </button>
                  <button
                    onClick={() => setActiveModule('reports')}
                    className="px-4 py-2.5 rounded-xl bg-teal-500/20 hover:bg-teal-500/30 text-teal-200 font-bold text-xs border border-teal-500/30 transition"
                  >
                    {t.nav.reports}
                  </button>
                </div>
              </div>

              {/* 12 Real-Time Executive KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Net Sales */}
                <div
                  onClick={() => setActiveModule('sales')}
                  className="cursor-pointer bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/50 transition shadow-sm"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{t.dashboard.totalSales}</span>
                    <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500">
                      <ShoppingCart className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="text-2xl font-black text-slate-900 dark:text-white mt-2">
                    {fmtMoney(kpis.totalSalesUsd, displayCurrency, exchangeRate, lang)}
                  </div>
                  <div className="text-[11px] text-emerald-500 font-semibold mt-1 flex items-center gap-1">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    Gross Profit:{' '}
                    {fmtMoney(kpis.grossProfitUsd, displayCurrency, exchangeRate, lang)} (
                    {kpis.grossMarginPercent}%)
                  </div>
                </div>

                {/* 2. Accounting Net Profit */}
                <div
                  onClick={() => setActiveModule('pnl')}
                  className="cursor-pointer bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/50 transition shadow-sm"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{t.dashboard.netProfit}</span>
                    <div className="p-2 rounded-xl bg-teal-500/10 text-teal-500">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                  </div>
                  <div
                    className={`text-2xl font-black mt-2 ${
                      kpis.netProfitUsd >= 0 ? 'text-emerald-500' : 'text-rose-500'
                    }`}
                  >
                    {fmtMoney(kpis.netProfitUsd, displayCurrency, exchangeRate, lang)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Net Margin: <b className="text-teal-400">{kpis.netMarginPercent}%</b>{' '}
                    after COGS & Expenses
                  </div>
                </div>

                {/* 3. Cash & Bank Treasury Balance */}
                <div
                  onClick={() => setActiveModule('cashbank')}
                  className="cursor-pointer bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/50 transition shadow-sm"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{t.dashboard.cashBalance}</span>
                    <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500">
                      <Landmark className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="text-2xl font-black text-emerald-500 mt-2">
                    {fmtMoney(kpis.cashBalanceUsd, displayCurrency, exchangeRate, lang)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Safes:{' '}
                    {fmtMoney(kpis.cashRegistersUsd, displayCurrency, exchangeRate, lang)}{' '}
                    • Banks:{' '}
                    {fmtMoney(kpis.bankAccountsUsd, displayCurrency, exchangeRate, lang)}
                  </div>
                </div>

                {/* 4. Inventory Valuation */}
                <div
                  onClick={() => setActiveModule('inventory')}
                  className="cursor-pointer bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/50 transition shadow-sm"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{t.dashboard.inventoryValue}</span>
                    <div className="p-2 rounded-xl bg-teal-500/10 text-teal-500">
                      <Boxes className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="text-2xl font-black text-slate-900 dark:text-white mt-2">
                    {fmtMoney(
                      kpis.inventoryCostValueUsd,
                      displayCurrency,
                      exchangeRate,
                      lang
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Retail Value:{' '}
                    {fmtMoney(
                      kpis.inventoryRetailValueUsd,
                      displayCurrency,
                      exchangeRate,
                      lang
                    )}
                  </div>
                </div>

                {/* 5. Total Purchases */}
                <div
                  onClick={() => setActiveModule('purchases')}
                  className="cursor-pointer bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/40 transition"
                >
                  <div className="text-xs text-slate-400">
                    {t.dashboard.totalPurchases}
                  </div>
                  <div className="text-xl font-bold mt-1">
                    {fmtMoney(kpis.totalPurchasesUsd, displayCurrency, exchangeRate, lang)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {t.dashboard.totalSuppliers}: <b>{kpis.totalSuppliers}</b>
                  </div>
                </div>

                {/* 6. Operating Expenses */}
                <div
                  onClick={() => setActiveModule('expenses')}
                  className="cursor-pointer bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/40 transition"
                >
                  <div className="text-xs text-slate-400">
                    {t.dashboard.totalExpenses}
                  </div>
                  <div className="text-xl font-bold text-rose-500 mt-1">
                    {fmtMoney(kpis.totalExpensesUsd, displayCurrency, exchangeRate, lang)}
                  </div>
                  <div className="text-[11px] text-amber-500 mt-1">
                    Pending Approval: <b>{kpis.pendingExpensesCount || 0}</b>
                  </div>
                </div>

                {/* 7. Customer Debts (Debtors AR) */}
                <div
                  onClick={() => setActiveModule('debtors')}
                  className="cursor-pointer bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/40 transition"
                >
                  <div className="text-xs text-slate-400">
                    {t.dashboard.customerDebts}
                  </div>
                  <div className="text-xl font-bold text-amber-500 mt-1">
                    {fmtMoney(
                      kpis.totalCustomerDebtsUsd,
                      displayCurrency,
                      exchangeRate,
                      lang
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {t.dashboard.totalCustomers}: <b>{kpis.totalCustomers}</b> • Open
                    Invoices: <b>{kpis.unpaidSalesCount}</b>
                  </div>
                </div>

                {/* 8. Supplier Liabilities (Creditors AP) */}
                <div
                  onClick={() => setActiveModule('creditors')}
                  className="cursor-pointer bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/40 transition"
                >
                  <div className="text-xs text-slate-400">
                    {t.dashboard.supplierLiabilities}
                  </div>
                  <div className="text-xl font-bold text-rose-500 mt-1">
                    {fmtMoney(
                      kpis.totalSupplierLiabilitiesUsd,
                      displayCurrency,
                      exchangeRate,
                      lang
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Open Supplier Bills: <b>{kpis.unpaidPurchasesCount}</b> •{' '}
                    {t.dashboard.lowStockAlerts}: <b>{kpis.lowStockCount}</b>
                  </div>
                </div>
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">
                      {t.dashboard.financialPerformanceChart}
                    </h3>
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-charcoal-950 p-1 rounded-xl text-xs">
                      <button
                        onClick={() => setChartPeriod('DAILY')}
                        className={`px-3 py-1 rounded-lg font-bold ${
                          chartPeriod === 'DAILY'
                            ? 'bg-emerald-600 text-white'
                            : 'text-slate-500'
                        }`}
                      >
                        {t.dashboard.dailyView}
                      </button>
                      <button
                        onClick={() => setChartPeriod('MONTHLY')}
                        className={`px-3 py-1 rounded-lg font-bold ${
                          chartPeriod === 'MONTHLY'
                            ? 'bg-emerald-600 text-white'
                            : 'text-slate-500'
                        }`}
                      >
                        {t.dashboard.monthlyView}
                      </button>
                    </div>
                  </div>

                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={
                          chartPeriod === 'DAILY'
                            ? dashboard?.charts?.daily || []
                            : dashboard?.charts?.monthly || []
                        }
                      >
                        <defs>
                          <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="salesUsd"
                          name="Net Sales ($)"
                          stroke="#10b981"
                          strokeWidth={2.5}
                          fill="url(#salesGrad)"
                        />
                        <Area
                          type="monotone"
                          dataKey="purchasesUsd"
                          name="Purchases ($)"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          fillOpacity={0}
                        />
                        <Area
                          type="monotone"
                          dataKey="profitUsd"
                          name="Net Profit ($)"
                          stroke="#14b8a6"
                          strokeWidth={2.5}
                          fill="url(#profitGrad)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Cash Registers & Bank Accounts Quick Overview */}
                <div className="lg:col-span-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold">
                      {t.dashboard.cashAndBankAccounts}
                    </h3>
                    <button
                      onClick={() => setActiveModule('cashbank')}
                      className="text-xs text-emerald-500 hover:underline font-semibold"
                    >
                      Manage →
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {(dashboard?.financialAccounts || []).map((fa: any) => (
                      <div
                        key={fa.id}
                        className="p-3.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-bold text-xs">
                            {locName(fa, lang)}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {fa.code} ({fa.currency})
                          </div>
                        </div>
                        <div className="text-end">
                          <div className="font-black text-sm text-emerald-500">
                            {fmtMoney(
                              fa.balanceUsd,
                              displayCurrency,
                              exchangeRate,
                              lang
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Tables: Unpaid Invoices, Low Stock, and Recent Journal Entries */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Unpaid Invoices */}
                <div className="lg:col-span-6 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-bold">
                      {t.dashboard.unpaidInvoices} (AR & AP)
                    </h3>
                    <span className="text-xs text-slate-400">
                      {(dashboard?.unpaidInvoices || []).length} Open
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                        <tr>
                          <th className="py-2 px-3 text-start">Invoice #</th>
                          <th className="py-2 px-3 text-start">Party</th>
                          <th className="py-2 px-3 text-center">Type</th>
                          <th className="py-2 px-3 text-end">Balance Due</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                        {(dashboard?.unpaidInvoices || []).map((u: any) => (
                          <tr
                            key={u.id}
                            onClick={() =>
                              setActiveModule(
                                u.type === 'SALE' ? 'debtors' : 'creditors'
                              )
                            }
                            className="cursor-pointer hover:bg-slate-50 dark:hover:bg-charcoal-800/40"
                          >
                            <td className="py-2 px-3 font-mono font-bold text-emerald-500">
                              {u.invoiceNumber}
                            </td>
                            <td className="py-2 px-3 font-semibold">{u.partyName}</td>
                            <td className="py-2 px-3 text-center">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  u.type === 'SALE'
                                    ? 'bg-emerald-500/15 text-emerald-500'
                                    : 'bg-amber-500/15 text-amber-500'
                                }`}
                              >
                                {u.type === 'SALE' ? 'RECEIVABLE' : 'PAYABLE'}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-end font-bold text-rose-500">
                              {fmtMoney(
                                u.dueUsd,
                                displayCurrency,
                                exchangeRate,
                                lang
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Recent General Ledger Transactions */}
                <div className="lg:col-span-6 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-bold">
                      {t.dashboard.recentJournalTransactions}
                    </h3>
                    <button
                      onClick={() => setActiveModule('accounting')}
                      className="text-xs text-emerald-500 hover:underline font-semibold"
                    >
                      Ledger →
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                        <tr>
                          <th className="py-2 px-3 text-start">Journal #</th>
                          <th className="py-2 px-3 text-start">{t.description}</th>
                          <th className="py-2 px-3 text-end">Debit = Credit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                        {(dashboard?.recentTransactions || [])
                          .slice(0, 7)
                          .map((j: any) => (
                            <tr key={j.id}>
                              <td className="py-2 px-3 font-mono font-bold text-emerald-500">
                                {j.entryNumber}
                              </td>
                              <td className="py-2 px-3 truncate max-w-xs">
                                {j.description}
                              </td>
                              <td className="py-2 px-3 text-end font-mono font-bold">
                                {fmtMoney(
                                  j.totalDebitUsd,
                                  displayCurrency,
                                  exchangeRate,
                                  lang
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeModule === 'sales' && (
            <SalesModuleView
              lang={lang}
              displayCurrency={displayCurrency}
              exchangeRate={exchangeRate}
              invoices={salesInvoices}
              products={bootstrap?.products || []}
              customers={bootstrap?.customers || []}
              warehouses={bootstrap?.warehouses || []}
              financialAccounts={bootstrap?.financialAccounts || []}
              onRefresh={loadAllSystemData}
              onPrint={setPrintableDoc}
              notify={notify}
            />
          )}

          {activeModule === 'purchases' && (
            <PurchasesModuleView
              lang={lang}
              displayCurrency={displayCurrency}
              exchangeRate={exchangeRate}
              invoices={purchaseInvoices}
              products={bootstrap?.products || []}
              suppliers={bootstrap?.suppliers || []}
              warehouses={bootstrap?.warehouses || []}
              financialAccounts={bootstrap?.financialAccounts || []}
              onRefresh={loadAllSystemData}
              onPrint={setPrintableDoc}
              notify={notify}
            />
          )}

          {activeModule === 'expenses' && (
            <ExpensesModuleView
              lang={lang}
              displayCurrency={displayCurrency}
              exchangeRate={exchangeRate}
              expenses={expenses}
              financialAccounts={bootstrap?.financialAccounts || []}
              suppliers={bootstrap?.suppliers || []}
              onRefresh={loadAllSystemData}
              notify={notify}
            />
          )}

          {(activeModule === 'debtors' ||
            activeModule === 'creditors' ||
            activeModule === 'customers' ||
            activeModule === 'suppliers') && (
            <PartiesAndDebtModuleView
              mode={
                activeModule === 'debtors'
                  ? 'DEBTORS'
                  : activeModule === 'creditors'
                  ? 'CREDITORS'
                  : activeModule === 'customers'
                  ? 'CUSTOMERS'
                  : 'SUPPLIERS'
              }
              lang={lang}
              displayCurrency={displayCurrency}
              exchangeRate={exchangeRate}
              partiesData={partiesData}
              financialAccounts={bootstrap?.financialAccounts || []}
              onRefresh={loadAllSystemData}
              onPrint={setPrintableDoc}
              notify={notify}
            />
          )}

          {activeModule === 'inventory' && (
            <InventoryModuleView
              lang={lang}
              displayCurrency={displayCurrency}
              exchangeRate={exchangeRate}
              inventoryData={inventoryData}
              onRefresh={loadAllSystemData}
              notify={notify}
            />
          )}

          {activeModule === 'cashbank' && (
            <CashBankModuleView
              lang={lang}
              displayCurrency={displayCurrency}
              exchangeRate={exchangeRate}
              cashBankData={cashBankData}
              onRefresh={loadAllSystemData}
              notify={notify}
            />
          )}

          {activeModule === 'pnl' && (
            <ProfitAndLossModuleView
              lang={lang}
              displayCurrency={displayCurrency}
              exchangeRate={exchangeRate}
              pnl={accountingData?.profitAndLoss}
            />
          )}

          {activeModule === 'accounting' && (
            <AccountingEngineModuleView
              lang={lang}
              displayCurrency={displayCurrency}
              exchangeRate={exchangeRate}
              accountingData={accountingData}
              onRefresh={loadAllSystemData}
              notify={notify}
            />
          )}

          {activeModule === 'reports' && (
            <ReportsModuleView
              lang={lang}
              displayCurrency={displayCurrency}
              exchangeRate={exchangeRate}
              salesInvoices={salesInvoices}
              purchaseInvoices={purchaseInvoices}
              expenses={expenses}
              inventoryData={inventoryData}
              partiesData={partiesData}
              accountingData={accountingData}
              cashBankData={cashBankData}
            />
          )}

          {activeModule === 'employees' && (
            <EmployeesPermissionsView
              lang={lang}
              settingsData={settingsData}
              onRefresh={loadAllSystemData}
              notify={notify}
            />
          )}

          {activeModule === 'settings' && (
            <SettingsModuleView
              lang={lang}
              settingsData={settingsData}
              onRefresh={loadAllSystemData}
              notify={notify}
            />
          )}
        </main>
      </div>

      {/* Sign In / Switch Employee Account Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form
            onSubmit={handleLogin}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-sm w-full space-y-4"
          >
            <h3 className="text-base font-bold">{t.signIn}</h3>
            <p className="text-xs text-slate-400">
              Default accounts: <b>admin</b>, <b>owner</b>, <b>accountant</b>,{' '}
              <b>sales</b>, <b>inventory</b>, <b>viewer</b> (Password:{' '}
              <b>Admin@123</b>)
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Username or Email
              </label>
              <input
                type="text"
                required
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Password</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLoginModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                {t.signIn}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
