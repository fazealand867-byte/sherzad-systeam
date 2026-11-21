'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  PackageCheck,
  Receipt,
  Boxes,
  ChefHat,
  Users,
  UserCheck,
  Building2,
  Landmark,
  BookOpen,
  FileBarChart2,
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
  TrendingUp,
  Banknote,
  Menu,
  X,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
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
import { fmtIqd, fmtQty, locName } from '@/lib/client-utils';
import { unitLabel } from '@/lib/units';
import { PrintModal, PrintableDocument } from '@/components/PrintModal';
import { SalesModuleView, PurchasesModuleView } from '@/components/SalesPurchasesViews';
import { ProductsInventoryView } from '@/components/ProductsInventoryView';
import { ProductionModuleView } from '@/components/ProductionModuleView';
import { ExpensesModuleView } from '@/components/ExpensesView';
import { EmployeesPayrollView } from '@/components/EmployeesPayrollView';
import { PartiesAndDebtModuleView } from '@/components/InventoryPartiesViews';
import { CashBankModuleView, AccountingEngineModuleView } from '@/components/FinanceAccountingViews';
import { ReportsModuleView, SettingsModuleView } from '@/components/ReportsSettingsViews';

type ModuleKey =
  | 'dashboard'
  | 'sales'
  | 'purchases'
  | 'expenses'
  | 'inventory'
  | 'production'
  | 'employees'
  | 'customers'
  | 'suppliers'
  | 'cashbank'
  | 'reports'
  | 'accounting'
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

export default function SherzadFoodFactoryApp() {
  const [activeModule, setActiveModule] = useState<ModuleKey>('dashboard');
  const [lang, setLang] = useState<LanguageCode>('ku');
  const [darkMode, setDarkMode] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Quick-action triggers from Dashboard
  const [expenseQuickMode, setExpenseQuickMode] = useState<'NORMAL' | 'SALARY' | null>(null);
  const [saleQuickNew, setSaleQuickNew] = useState(false);
  const [purchaseQuickNew, setPurchaseQuickNew] = useState(false);

  // Live Application Data States
  const [bootstrap, setBootstrap] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [salesInvoices, setSalesInvoices] = useState<any[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [inventoryData, setInventoryData] = useState<any>(null);
  const [productionData, setProductionData] = useState<any>(null);
  const [employeesData, setEmployeesData] = useState<any>(null);
  const [partiesData, setPartiesData] = useState<any>(null);
  const [cashBankData, setCashBankData] = useState<any>(null);
  const [accountingData, setAccountingData] = useState<any>(null);
  const [settingsData, setSettingsData] = useState<any>(null);

  // Popovers & Modals
  const [chartPeriod, setChartPeriod] = useState<'DAILY' | 'MONTHLY'>('DAILY');
  const [showNotifications, setShowNotifications] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginIdentifier, setLoginIdentifier] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('Admin@123');
  const [printableDoc, setPrintableDoc] = useState<PrintableDocument | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

  const notify = useCallback((type: 'success' | 'error' | 'warning', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  }, []);

  useEffect(() => {
    const dir = LANGUAGE_METADATA[lang].dir;
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
    localStorage.setItem('sherzad_erp_lang_v2', lang);
  }, [lang]);

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

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
      // Single-request ultra-fast snapshot (replaces 12 parallel PHP calls with 1!)
      const snapRes = await fetch('/api/snapshot');
      if (snapRes.ok) {
        const snap = await snapRes.json();
        if (snap.bootstrap) setBootstrap(snap.bootstrap);
        if (snap.dashboard) setDashboard(snap.dashboard);
        if (snap.sales) setSalesInvoices(snap.sales.invoices || []);
        if (snap.purchases) setPurchaseInvoices(snap.purchases.invoices || []);
        if (snap.expenses) setExpenses(snap.expenses.expenses || []);
        if (snap.inventory) setInventoryData(snap.inventory);
        if (snap.production) setProductionData(snap.production);
        if (snap.employees) setEmployeesData(snap.employees);
        if (snap.parties) setPartiesData(snap.parties);
        if (snap.cashbank) setCashBankData(snap.cashbank);
        if (snap.accounting) setAccountingData(snap.accounting);
        if (snap.settings) setSettingsData(snap.settings);
        return;
      }
      // Fallback to individual routes if snapshot endpoint is unavailable
      const [bootRes, dashRes] = await Promise.all([
        fetch('/api/bootstrap'),
        fetch('/api/dashboard'),
      ]);
      if (bootRes.ok) setBootstrap(await bootRes.json());
      if (dashRes.ok) setDashboard(await dashRes.json());
    } catch (err) {
      console.error('Failed to load system data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedLang = localStorage.getItem('sherzad_erp_lang_v2') as LanguageCode | null;
    if (savedLang && ['ku', 'ar', 'en'].includes(savedLang)) {
      setLang(savedLang);
    }
    loadAllSystemData();
  }, [loadAllSystemData]);

  const t = translations[lang];
  const isRtl = LANGUAGE_METADATA[lang].dir === 'rtl';
  const units = bootstrap?.units || [];
  const currentRole = bootstrap?.user?.role || 'SUPER_ADMIN';
  const canSeeAccounting = ['SUPER_ADMIN', 'BUSINESS_OWNER', 'ACCOUNTANT'].includes(currentRole);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', identifier: loginIdentifier, password: loginPassword }),
    });
    const data = await res.json();
    if (res.ok) {
      notify('success', `${data.user.name} ✓`);
      setShowLoginModal(false);
      await loadAllSystemData();
    } else notify('error', data.error || 'Invalid credentials');
  };

  const globalSearchResults = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: { category: string; title: string; subtitle: string; targetModule: ModuleKey }[] = [];

    for (const p of bootstrap?.products || []) {
      if (
        (p.nameKu || '').toLowerCase().includes(q) ||
        (p.nameAr || '').toLowerCase().includes(q) ||
        (p.nameEn || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q)
      ) {
        results.push({
          category: t.nav.inventory,
          title: locName(p, lang),
          subtitle: `${fmtQty(p.totalStock)} ${unitLabel(p.unit, lang, units)} • ${fmtIqd(p.sellingPriceIqd, lang)}`,
          targetModule: 'inventory',
        });
      }
    }
    for (const emp of bootstrap?.employees || []) {
      if ((emp.name || '').toLowerCase().includes(q) || (emp.phone || '').includes(q)) {
        results.push({
          category: t.nav.employees,
          title: emp.name,
          subtitle: `${emp.phone} • ${fmtIqd(emp.monthlySalaryIqd, lang)}`,
          targetModule: 'employees',
        });
      }
    }
    for (const c of bootstrap?.customers || []) {
      if ((c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q)) {
        results.push({
          category: t.nav.customers,
          title: c.name,
          subtitle: `${c.phone || ''} • ${fmtIqd(c.balanceIqd, lang)}`,
          targetModule: 'customers',
        });
      }
    }
    for (const s of bootstrap?.suppliers || []) {
      if ((s.name || '').toLowerCase().includes(q) || (s.phone || '').includes(q)) {
        results.push({
          category: t.nav.suppliers,
          title: s.name,
          subtitle: `${s.phone || ''} • ${fmtIqd(s.balanceIqd, lang)}`,
          targetModule: 'suppliers',
        });
      }
    }
    for (const inv of salesInvoices) {
      if ((inv.invoiceNumber || '').toLowerCase().includes(q)) {
        results.push({
          category: t.nav.sales,
          title: `${inv.invoiceNumber} — ${inv.customer?.name || ''}`,
          subtitle: fmtIqd(inv.totalIqd, lang),
          targetModule: 'sales',
        });
      }
    }
    return results.slice(0, 12);
  }, [globalSearchQuery, bootstrap, salesInvoices, lang, t, units]);

  const NAV_GROUPS: {
    label: string;
    items: { id: ModuleKey; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[];
  }[] = [
    {
      label: t.navGroups.daily,
      items: [
        { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
        { id: 'sales', label: t.nav.sales, icon: ShoppingCart },
        { id: 'purchases', label: t.nav.purchases, icon: PackageCheck },
        {
          id: 'expenses',
          label: t.nav.expenses,
          icon: Receipt,
          badge: dashboard?.kpis?.pendingExpensesCount || undefined,
        },
      ],
    },
    {
      label: t.navGroups.factory,
      items: [
        {
          id: 'inventory',
          label: t.nav.inventory,
          icon: Boxes,
          badge: dashboard?.kpis?.lowStockCount || undefined,
        },
        { id: 'production', label: t.nav.production, icon: ChefHat },
      ],
    },
    {
      label: t.navGroups.people,
      items: [
        { id: 'employees', label: t.nav.employees, icon: Users },
        {
          id: 'customers',
          label: t.nav.customers,
          icon: UserCheck,
          badge: dashboard?.kpis?.unpaidSalesCount || undefined,
        },
        {
          id: 'suppliers',
          label: t.nav.suppliers,
          icon: Building2,
          badge: dashboard?.kpis?.unpaidPurchasesCount || undefined,
        },
      ],
    },
    {
      label: t.navGroups.finance,
      items: [
        { id: 'cashbank', label: t.nav.cashbank, icon: Landmark },
        { id: 'reports', label: t.nav.reports, icon: FileBarChart2 },
        ...(canSeeAccounting ? [{ id: 'accounting' as ModuleKey, label: t.nav.accounting, icon: BookOpen }] : []),
        { id: 'settings', label: t.nav.settings, icon: Settings },
      ],
    },
  ];

  const kpis = dashboard?.kpis || {
    totalSalesIqd: 0,
    totalPurchasesIqd: 0,
    totalExpensesIqd: 0,
    netProfitIqd: 0,
    grossProfitIqd: 0,
    totalCustomerDebtsIqd: 0,
    totalSupplierLiabilitiesIqd: 0,
    cashBalanceIqd: 0,
    inventoryCostValueIqd: 0,
    lowStockCount: 0,
    activeEmployeesCount: 0,
    salariesPaidThisMonthIqd: 0,
    todayProductionCount: 0,
  };

  const notifications = bootstrap?.notifications || [];

  return (
    <div className="min-h-screen flex bg-charcoal-50 dark:bg-charcoal-950 text-charcoal-900 dark:text-slate-100">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 end-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-md bg-charcoal-900/95 text-white border-emerald-500/40">
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : toast.type === 'warning' ? (
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
          )}
          <span className="text-sm font-semibold">{toast.message}</span>
        </div>
      )}

      {/* Print Modal (Sales, Purchases, Statements, Salary Receipts) */}
      <PrintModal
        doc={printableDoc}
        onClose={() => setPrintableDoc(null)}
        settings={bootstrap?.settings}
        lang={lang}
        units={units}
      />

      {/* Global Search Palette */}
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
              <button onClick={() => setShowGlobalSearch(false)} className="text-xs text-slate-400 px-2 py-1 rounded bg-slate-100 dark:bg-charcoal-800">
                ESC
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-3 space-y-1">
              {globalSearchResults.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">{t.searchPlaceholder}</div>
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
                      <div className="text-sm font-bold text-slate-900 dark:text-white">{res.title}</div>
                      <div className="text-xs text-slate-400">{res.subtitle}</div>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-500 text-xs font-bold">
                      {res.category}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SIDEBAR NAVIGATION (CLEAN GROUPED STRUCTURE) */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-20' : 'w-64'
        } hidden md:flex flex-col bg-charcoal-900 text-slate-200 border-e border-charcoal-800 transition-all duration-200 shrink-0 select-none`}
      >
        <div className="p-4 border-b border-charcoal-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center font-black text-lg shadow-lg shadow-emerald-500/25 shrink-0">
              <ChefHat className="w-5 h-5" />
            </div>
            {!sidebarCollapsed && (
              <div className="truncate">
                <div className="font-black text-sm text-white truncate">
                  {locName(
                    {
                      nameKu: bootstrap?.settings?.companyNameKu || t.appName,
                      nameAr: bootstrap?.settings?.companyNameAr || t.appName,
                      nameEn: bootstrap?.settings?.companyNameEn || t.appName,
                    },
                    lang
                  )}
                </div>
                <div className="text-[11px] text-emerald-400 font-semibold truncate">{t.currencyLabel}</div>
              </div>
            )}
          </div>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg hover:bg-charcoal-800 text-slate-400 hover:text-white"
          >
            {sidebarCollapsed ? (
              isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
            ) : isRtl ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveModule(item.id)}
                    title={item.label}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-bold transition ${
                      isActive
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-600/20'
                        : 'text-slate-300 hover:bg-charcoal-800/70 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3 truncate">
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-emerald-400'}`} />
                      {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                    </div>
                    {!sidebarCollapsed && item.badge ? (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${isActive ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-400'}`}>
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {!sidebarCollapsed && bootstrap?.user && (
          <div className="p-3.5 border-t border-charcoal-800 bg-charcoal-950/60 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate">
                <div className="font-bold text-white truncate">{bootstrap.user.name}</div>
                <div className="text-[10px] font-mono text-emerald-400">{bootstrap.user.role}</div>
              </div>
              <button
                onClick={() => setShowLoginModal(true)}
                title={t.signIn}
                className="p-2 rounded-lg bg-charcoal-800 hover:bg-charcoal-700 text-slate-300"
              >
                <LogIn className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Simplified Top Bar (NO USD/Exchange Rate Clutter!) */}
        <header className="sticky top-0 z-30 bg-white/90 dark:bg-charcoal-900/90 backdrop-blur-md border-b border-slate-200 dark:border-charcoal-800 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 rounded-xl bg-slate-100 dark:bg-charcoal-800">
              <Menu className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowGlobalSearch(true)}
              className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs text-slate-400 hover:border-emerald-500/50 w-52 sm:w-80 transition"
            >
              <Search className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="truncate">{t.searchPlaceholder}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Language Switcher: Kurdish Sorani Primary, Arabic, English */}
            <div className="flex items-center bg-slate-100 dark:bg-charcoal-950 p-1 rounded-xl border border-slate-200 dark:border-charcoal-800 text-xs">
              {(['ku', 'ar', 'en'] as LanguageCode[]).map((code) => (
                <button
                  key={code}
                  onClick={() => setLang(code)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition ${
                    lang === code
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {code === 'ku' ? 'کوردی' : code === 'ar' ? 'العربية' : 'EN'}
                </button>
              ))}
            </div>

            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800"
              >
                <Bell className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                {notifications.length > 0 && (
                  <span className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute end-0 mt-2 w-80 bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl shadow-2xl z-50 overflow-hidden">
                  <div className="p-3.5 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center text-xs font-bold">
                    <span>{t.notifications}</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500">{notifications.length}</span>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-charcoal-800">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">{t.noNotifications}</div>
                    ) : (
                      notifications.map((n: any) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            setActiveModule(n.module as ModuleKey);
                            setShowNotifications(false);
                          }}
                          className="w-full text-start p-3 hover:bg-slate-50 dark:hover:bg-charcoal-800/50 text-xs"
                        >
                          <div className="font-bold text-slate-900 dark:text-white">
                            {lang === 'ku' ? n.titleKu : lang === 'ar' ? n.titleAr : n.titleEn}
                          </div>
                          <div className="text-slate-400 mt-0.5">
                            {lang === 'ku' ? n.descKu : lang === 'ar' ? n.descAr : n.descEn}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button onClick={() => setDarkMode(!darkMode)} title={t.switchTheme} className="p-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800">
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>

            <button onClick={loadAllSystemData} title={t.refresh} className="p-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-500' : ''}`} />
            </button>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-black/70 flex">
            <div className="w-72 bg-charcoal-900 text-white p-4 space-y-4 overflow-y-auto">
              <div className="flex justify-between items-center pb-3 border-b border-charcoal-800">
                <span className="font-black text-sm">{t.appName}</span>
                <button onClick={() => setMobileMenuOpen(false)}><X className="w-5 h-5" /></button>
              </div>
              {NAV_GROUPS.map((g, gi) => (
                <div key={gi} className="space-y-1">
                  <div className="text-[11px] font-bold text-slate-400 px-2">{g.label}</div>
                  {g.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setActiveModule(item.id); setMobileMenuOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold ${
                          activeModule === item.id ? 'bg-emerald-600 text-white' : 'text-slate-300'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MAIN PAGE CONTENT */}
        <main className="flex-1 p-5 md:p-6 overflow-y-auto max-w-[1550px] w-full mx-auto">
          {activeModule === 'dashboard' && (
            <div className="space-y-6">
              {/* Hero Welcome + Big Clear Daily Quick Actions */}
              <div className="bg-gradient-to-r from-charcoal-900 via-emerald-950 to-teal-950 text-white p-6 rounded-2xl border border-emerald-500/30 shadow-xl space-y-5">
                <div>
                  <h1 className="text-2xl font-black tracking-tight">{t.dashboard.title}</h1>
                  <p className="text-xs text-slate-300 mt-1">{t.dashboard.subtitle}</p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <button
                    onClick={() => { setSaleQuickNew(true); setActiveModule('sales'); }}
                    className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-charcoal-950 font-black text-sm shadow-lg shadow-emerald-500/25 transition"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    {t.dashboard.quickSale}
                  </button>
                  <button
                    onClick={() => { setExpenseQuickMode('NORMAL'); setActiveModule('expenses'); }}
                    className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-sm border border-white/15 transition"
                  >
                    <Receipt className="w-4 h-4 text-rose-300" />
                    {t.dashboard.quickExpense}
                  </button>
                  <button
                    onClick={() => { setExpenseQuickMode('SALARY'); setActiveModule('expenses'); }}
                    className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-teal-500/25 hover:bg-teal-500/35 text-teal-100 font-bold text-sm border border-teal-400/30 transition"
                  >
                    <Banknote className="w-4 h-4 text-teal-300" />
                    {t.dashboard.quickSalary}
                  </button>
                  <button
                    onClick={() => setActiveModule('production')}
                    className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-sm border border-white/15 transition"
                  >
                    <ChefHat className="w-4 h-4 text-amber-300" />
                    {t.dashboard.quickProduction}
                  </button>
                  <button
                    onClick={() => { setPurchaseQuickNew(true); setActiveModule('purchases'); }}
                    className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-sm border border-white/15 transition"
                  >
                    <PackageCheck className="w-4 h-4 text-emerald-300" />
                    {t.dashboard.quickPurchase}
                  </button>
                </div>
              </div>

              {/* Simple Readable KPI Grid (IQD Only) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div onClick={() => setActiveModule('sales')} className="cursor-pointer bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/50 transition">
                  <div className="flex justify-between text-xs text-slate-400 font-semibold">
                    <span>{t.dashboard.totalSales}</span>
                    <ShoppingCart className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="text-2xl font-black mt-2">{fmtIqd(kpis.totalSalesIqd, lang)}</div>
                </div>

                <div onClick={() => setActiveModule('expenses')} className="cursor-pointer bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-rose-500/50 transition">
                  <div className="flex justify-between text-xs text-slate-400 font-semibold">
                    <span>{t.dashboard.totalExpenses}</span>
                    <Receipt className="w-4 h-4 text-rose-500" />
                  </div>
                  <div className="text-2xl font-black text-rose-500 mt-2">{fmtIqd(kpis.totalExpensesIqd, lang)}</div>
                </div>

                <div onClick={() => setActiveModule('reports')} className="cursor-pointer bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/50 transition">
                  <div className="flex justify-between text-xs text-slate-400 font-semibold">
                    <span>{t.dashboard.netProfit}</span>
                    <TrendingUp className="w-4 h-4 text-teal-500" />
                  </div>
                  <div className={`text-2xl font-black mt-2 ${kpis.netProfitIqd >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {fmtIqd(kpis.netProfitIqd, lang)}
                  </div>
                </div>

                <div onClick={() => setActiveModule('cashbank')} className="cursor-pointer bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/50 transition">
                  <div className="flex justify-between text-xs text-slate-400 font-semibold">
                    <span>{t.dashboard.cashBalance}</span>
                    <Landmark className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="text-2xl font-black text-emerald-500 mt-2">{fmtIqd(kpis.cashBalanceIqd, lang)}</div>
                </div>

                <div onClick={() => setActiveModule('customers')} className="cursor-pointer bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
                  <div className="text-xs text-slate-400">{t.dashboard.customerDebts}</div>
                  <div className="text-xl font-black text-amber-500 mt-1">{fmtIqd(kpis.totalCustomerDebtsIqd, lang)}</div>
                </div>

                <div onClick={() => setActiveModule('suppliers')} className="cursor-pointer bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
                  <div className="text-xs text-slate-400">{t.dashboard.supplierLiabilities}</div>
                  <div className="text-xl font-black text-rose-500 mt-1">{fmtIqd(kpis.totalSupplierLiabilitiesIqd, lang)}</div>
                </div>

                <div onClick={() => setActiveModule('employees')} className="cursor-pointer bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
                  <div className="text-xs text-slate-400">{t.dashboard.salariesThisMonth}</div>
                  <div className="text-xl font-black text-teal-500 mt-1">{fmtIqd(kpis.salariesPaidThisMonthIqd, lang)}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{kpis.activeEmployeesCount} {t.nav.employees}</div>
                </div>

                <div onClick={() => setActiveModule('inventory')} className="cursor-pointer bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
                  <div className="text-xs text-slate-400">{t.dashboard.lowStockAlerts}</div>
                  <div className="text-xl font-black text-amber-500 mt-1">{kpis.lowStockCount}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{t.dashboard.inventoryValue}: {fmtIqd(kpis.inventoryCostValueIqd, lang)}</div>
                </div>
              </div>

              {/* Charts + Low Stock Alerts */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black">{t.dashboard.financialChart}</h3>
                    <div className="flex gap-1 bg-slate-100 dark:bg-charcoal-950 p-1 rounded-xl text-xs">
                      <button onClick={() => setChartPeriod('DAILY')} className={`px-3 py-1 rounded-lg font-bold ${chartPeriod === 'DAILY' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>
                        {t.dashboard.dailyView}
                      </button>
                      <button onClick={() => setChartPeriod('MONTHLY')} className={`px-3 py-1 rounded-lg font-bold ${chartPeriod === 'MONTHLY' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>
                        {t.dashboard.monthlyView}
                      </button>
                    </div>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartPeriod === 'DAILY' ? dashboard?.charts?.daily || [] : dashboard?.charts?.monthly || []}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(val: any) => fmtIqd(val, lang)} />
                        <Legend />
                        <Area type="monotone" dataKey="salesIqd" name={t.nav.sales} stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={2.5} />
                        <Area type="monotone" dataKey="expensesIqd" name={t.nav.expenses} stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.12} strokeWidth={2} />
                        <Area type="monotone" dataKey="purchasesIqd" name={t.nav.purchases} stroke="#f59e0b" fillOpacity={0} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="lg:col-span-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black">{t.dashboard.lowStockList}</h3>
                    <button onClick={() => setActiveModule('inventory')} className="text-xs text-emerald-500 font-bold hover:underline">
                      {t.all} →
                    </button>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {(dashboard?.lowStockProducts || []).length === 0 ? (
                      <div className="py-10 text-center text-xs text-slate-400">{t.noNotifications}</div>
                    ) : (
                      (dashboard?.lowStockProducts || []).slice(0, 8).map((item: any) => (
                        <div key={item.productId} className="p-3 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 flex items-center justify-between text-xs">
                          <span className="font-bold truncate">{locName(item, lang)}</span>
                          <span className={`px-2.5 py-0.5 rounded-full font-black shrink-0 ${item.quantity <= 0 ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'}`}>
                            {fmtQty(item.quantity)} {unitLabel(item.unit, lang, units)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeModule === 'sales' && (
            <SalesModuleView
              lang={lang}
              invoices={salesInvoices}
              products={bootstrap?.products || []}
              customers={bootstrap?.customers || []}
              warehouses={bootstrap?.warehouses || []}
              financialAccounts={bootstrap?.financialAccounts || []}
              units={units}
              autoOpenNew={saleQuickNew}
              onClearAutoOpen={() => setSaleQuickNew(false)}
              onRefresh={loadAllSystemData}
              onPrint={setPrintableDoc}
              notify={notify}
            />
          )}

          {activeModule === 'purchases' && (
            <PurchasesModuleView
              lang={lang}
              invoices={purchaseInvoices}
              products={bootstrap?.products || []}
              suppliers={bootstrap?.suppliers || []}
              warehouses={bootstrap?.warehouses || []}
              financialAccounts={bootstrap?.financialAccounts || []}
              units={units}
              autoOpenNew={purchaseQuickNew}
              onClearAutoOpen={() => setPurchaseQuickNew(false)}
              onRefresh={loadAllSystemData}
              onPrint={setPrintableDoc}
              notify={notify}
            />
          )}

          {activeModule === 'expenses' && (
            <ExpensesModuleView
              lang={lang}
              expenses={expenses}
              expenseCategories={bootstrap?.expenseCategories || []}
              employees={bootstrap?.employees || []}
              financialAccounts={bootstrap?.financialAccounts || []}
              suppliers={bootstrap?.suppliers || []}
              initialMode={expenseQuickMode}
              onClearInitialMode={() => setExpenseQuickMode(null)}
              onRefresh={loadAllSystemData}
              onPrint={setPrintableDoc}
              notify={notify}
            />
          )}

          {activeModule === 'inventory' && (
            <ProductsInventoryView
              lang={lang}
              inventoryData={inventoryData}
              units={units}
              onRefresh={loadAllSystemData}
              notify={notify}
            />
          )}

          {activeModule === 'production' && (
            <ProductionModuleView
              lang={lang}
              productionData={productionData}
              products={bootstrap?.products || []}
              warehouses={bootstrap?.warehouses || []}
              units={units}
              onRefresh={loadAllSystemData}
              notify={notify}
            />
          )}

          {activeModule === 'employees' && (
            <EmployeesPayrollView
              lang={lang}
              employeesData={employeesData}
              settingsData={settingsData}
              financialAccounts={bootstrap?.financialAccounts || []}
              currentUserRole={currentRole}
              onRefresh={loadAllSystemData}
              onPrint={setPrintableDoc}
              notify={notify}
            />
          )}

          {(activeModule === 'customers' || activeModule === 'suppliers') && (
            <PartiesAndDebtModuleView
              mode={activeModule === 'customers' ? 'CUSTOMERS' : 'SUPPLIERS'}
              lang={lang}
              partiesData={partiesData}
              financialAccounts={bootstrap?.financialAccounts || []}
              onRefresh={loadAllSystemData}
              onPrint={setPrintableDoc}
              notify={notify}
            />
          )}

          {activeModule === 'cashbank' && (
            <CashBankModuleView
              lang={lang}
              cashBankData={cashBankData}
              onRefresh={loadAllSystemData}
              notify={notify}
            />
          )}

          {activeModule === 'reports' && (
            <ReportsModuleView
              lang={lang}
              salesInvoices={salesInvoices}
              purchaseInvoices={purchaseInvoices}
              expenses={expenses}
              inventoryData={inventoryData}
              partiesData={partiesData}
              accountingData={accountingData}
              cashBankData={cashBankData}
              employeesData={employeesData}
              productionData={productionData}
            />
          )}

          {activeModule === 'accounting' && (
            <AccountingEngineModuleView
              lang={lang}
              accountingData={accountingData}
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

      {/* Sign In / Switch Account Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleLogin} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-black">{t.signIn}</h3>
            <p className="text-xs text-slate-400">
              Accounts: <b>admin</b>, <b>owner</b>, <b>accountant</b>, <b>sales</b>, <b>inventory</b>, <b>viewer</b>
            </p>
            <input type="text" required value={loginIdentifier} onChange={(e) => setLoginIdentifier(e.target.value)} placeholder="Username" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            <input type="password" required value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Password" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowLoginModal(false)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">{t.cancel}</button>
              <button type="submit" className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">{t.signIn}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
