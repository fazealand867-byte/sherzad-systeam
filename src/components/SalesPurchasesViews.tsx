'use client';

import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Printer,
  RotateCcw,
  CheckCircle2,
  Trash2,
  ShoppingCart,
  FileText,
  Download,
  Barcode,
  AlertTriangle,
  Receipt,
  UserPlus,
  PackageCheck,
  XCircle,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import { exportToCsv, fmtMoney, fmtOriginal, locName } from '@/lib/client-utils';

interface SalesModuleProps {
  lang: LanguageCode;
  displayCurrency: 'USD' | 'IQD';
  exchangeRate: number;
  invoices: any[];
  products: any[];
  customers: any[];
  warehouses: any[];
  financialAccounts: any[];
  onRefresh: () => Promise<void>;
  onPrint: (doc: {
    type: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'ACCOUNT_STATEMENT';
    mode?: 'A4' | 'THERMAL';
    data: any;
  }) => void;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function SalesModuleView({
  lang,
  displayCurrency,
  exchangeRate,
  invoices,
  products,
  customers,
  warehouses,
  financialAccounts,
  onRefresh,
  onPrint,
  notify,
}: SalesModuleProps) {
  const t = translations[lang];
  const [viewMode, setViewMode] = useState<'LIST' | 'NEW_INVOICE' | 'POS'>('LIST');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [submitting, setSubmitting] = useState(false);

  // Invoice Builder State
  const [customerId, setCustomerId] = useState(customers[0]?.id || '');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || '');
  const [currency, setCurrency] = useState<'USD' | 'IQD'>(displayCurrency);
  const [paymentType, setPaymentType] = useState<'CASH' | 'CREDIT' | 'PARTIAL'>('CASH');
  const [financialAccountId, setFinancialAccountId] = useState(
    financialAccounts[0]?.id || ''
  );
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [invoiceDiscount, setInvoiceDiscount] = useState<string>('0');
  const [paidAmountInput, setPaidAmountInput] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [overrideCreditLimit, setOverrideCreditLimit] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const [lines, setLines] = useState<
    {
      productId: string;
      name: string;
      sku: string;
      availableStock: number;
      quantity: number;
      unitPriceOriginal: number;
      unitCostUsd: number;
      discountOriginal: number;
      taxRate: number;
    }[]
  >([]);

  // Quick-create Customer modal
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');

  // Return modal state
  const [returnTarget, setReturnTarget] = useState<any | null>(null);
  const [returnReason, setReturnReason] = useState('Customer requested product return & refund');

  const addProductToInvoice = (product: any) => {
    const existingIdx = lines.findIndex((l) => l.productId === product.id);
    const defaultPrice =
      currency === 'USD'
        ? Number(product.sellingPriceUsd)
        : Math.round(Number(product.sellingPriceUsd) * exchangeRate);

    if (existingIdx >= 0) {
      const copy = [...lines];
      copy[existingIdx].quantity += 1;
      setLines(copy);
    } else {
      setLines([
        ...lines,
        {
          productId: product.id,
          name: locName(product, lang),
          sku: product.sku,
          availableStock: Number(product.totalStock),
          quantity: 1,
          unitPriceOriginal: defaultPrice,
          unitCostUsd: Number(product.purchaseCostUsd),
          discountOriginal: 0,
          taxRate: Number(product.taxRate || 0),
        },
      ]);
    }
  };

  const handleCurrencyToggle = (newCurr: 'USD' | 'IQD') => {
    if (newCurr === currency) return;
    const factor = newCurr === 'IQD' ? exchangeRate : 1 / exchangeRate;
    setLines(
      lines.map((l) => ({
        ...l,
        unitPriceOriginal:
          newCurr === 'IQD'
            ? Math.round(l.unitPriceOriginal * factor)
            : Number((l.unitPriceOriginal * factor).toFixed(2)),
        discountOriginal:
          newCurr === 'IQD'
            ? Math.round(l.discountOriginal * factor)
            : Number((l.discountOriginal * factor).toFixed(2)),
      }))
    );
    setCurrency(newCurr);
  };

  const totals = useMemo(() => {
    let subtotalOrig = 0;
    let lineDiscOrig = 0;
    let taxOrig = 0;
    let totalCostUsd = 0;

    for (const l of lines) {
      const gross = l.quantity * l.unitPriceOriginal;
      const net = Math.max(0, gross - l.discountOriginal);
      const tax = net * (l.taxRate / 100);
      subtotalOrig += gross;
      lineDiscOrig += l.discountOriginal;
      taxOrig += tax;
      totalCostUsd += l.quantity * l.unitCostUsd;
    }

    const extraDisc = Number(invoiceDiscount || 0);
    const totalDiscOrig = lineDiscOrig + extraDisc;
    const grandTotalOrig = Math.max(0, subtotalOrig - totalDiscOrig + taxOrig);

    const paidOrig =
      paymentType === 'CASH'
        ? grandTotalOrig
        : paymentType === 'CREDIT'
        ? 0
        : Number(paidAmountInput || 0);

    const dueOrig = Math.max(0, grandTotalOrig - paidOrig);

    const netRevUsd =
      currency === 'USD'
        ? subtotalOrig - totalDiscOrig
        : (subtotalOrig - totalDiscOrig) / exchangeRate;
    const estProfitUsd = netRevUsd - totalCostUsd;

    return {
      subtotalOrig,
      totalDiscOrig,
      taxOrig,
      grandTotalOrig,
      paidOrig,
      dueOrig,
      totalCostUsd,
      estProfitUsd,
    };
  }, [lines, invoiceDiscount, paymentType, paidAmountInput, currency, exchangeRate]);

  const handleCreateInvoice = async (targetStatus: 'DRAFT' | 'POSTED') => {
    const effectiveCustomerId = customerId || customers[0]?.id;
    const effectiveWarehouseId = warehouseId || warehouses[0]?.id;
    const effectiveFinAccId = financialAccountId || financialAccounts[0]?.id;

    if (!effectiveCustomerId) {
      notify('error', 'Please select a customer');
      return;
    }
    if (lines.length === 0) {
      notify('error', 'Please add at least one product to the invoice');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createInvoice',
          customerId: effectiveCustomerId,
          warehouseId: effectiveWarehouseId,
          status: targetStatus,
          paymentType,
          currency,
          exchangeRate,
          invoiceDiscountOriginal: Number(invoiceDiscount || 0),
          paidOriginal: totals.paidOrig,
          financialAccountId: effectiveFinAccId,
          paymentMethod,
          notes,
          allowNegativeStock,
          overrideCreditLimit,
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPriceOriginal: l.unitPriceOriginal,
            discountOriginal: l.discountOriginal,
            taxRate: l.taxRate,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to create sales invoice');
      } else {
        notify(
          'success',
          targetStatus === 'DRAFT'
            ? `Draft Invoice ${data.invoice.invoiceNumber} saved!`
            : `Sales Invoice ${data.invoice.invoiceNumber} posted to Inventory & General Ledger!`
        );
        setLines([]);
        setNotes('');
        setInvoiceDiscount('0');
        setViewMode('LIST');
        await onRefresh();
      }
    } catch (err: any) {
      notify('error', err.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostDraft = async (invoiceId: string) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'postInvoice',
          invoiceId,
          allowNegativeStock,
          overrideCreditLimit,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to post invoice');
      } else {
        notify('success', `Invoice ${data.invoice.invoiceNumber} posted!`);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnInvoice = async () => {
    if (!returnTarget) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'returnInvoice',
          invoiceId: returnTarget.id,
          reason: returnReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to return invoice');
      } else {
        notify(
          'success',
          `Sales Return processed for ${returnTarget.invoiceNumber}. Stock restored & ledger reversed!`
        );
        setReturnTarget(null);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createCustomer',
          name: newCustomerName,
          phone: newCustomerPhone,
          creditLimitUsd: 10000,
        }),
      });
      const data = await res.json();
      if (res.ok && data.customer) {
        await onRefresh();
        setCustomerId(data.customer.id);
        setShowQuickCustomer(false);
        setNewCustomerName('');
        setNewCustomerPhone('');
        notify('success', `Customer '${data.customer.name}' created!`);
      } else {
        notify('error', data.error || 'Could not create customer');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.nameEn.toLowerCase().includes(q) ||
        p.nameAr.toLowerCase().includes(q) ||
        p.nameKu.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    );
  }, [products, productSearch]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customer?.name?.toLowerCase().includes(q) ||
        (inv.notes && inv.notes.toLowerCase().includes(q))
      );
    });
  }, [invoices, statusFilter, searchQuery]);

  const handleExportCsv = () => {
    exportToCsv(
      `sales-invoices-${new Date().toISOString().slice(0, 10)}`,
      [
        'Invoice #',
        'Date',
        'Customer',
        'Status',
        'Payment Type',
        'Currency',
        'Total (USD)',
        'Paid (USD)',
        'Due (USD)',
        'COGS (USD)',
        'Gross Profit (USD)',
      ],
      filteredInvoices.map((inv) => [
        inv.invoiceNumber,
        new Date(inv.date).toISOString().slice(0, 10),
        inv.customer?.name,
        inv.status,
        inv.paymentType,
        inv.currency,
        Number(inv.totalUsd).toFixed(2),
        Number(inv.paidUsd).toFixed(2),
        Number(inv.dueUsd).toFixed(2),
        Number(inv.totalCostUsd).toFixed(2),
        Number(inv.grossProfitUsd).toFixed(2),
      ])
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <ShoppingCart className="w-6 h-6 text-emerald-500" />
            {t.sales.title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {lang === 'ar'
              ? 'إصدار فواتير المبيعات، نقطة البيع السريعة (POS)، الخصم التلقائي من المخزون، وحساب تكلفة البضاعة المباعة والأرباح'
              : lang === 'ku'
              ? 'دروستکردنی پسوولەی فرۆشتن، کاشێری خێرا، داشکاندنی خۆکارانە لە کۆگا، و هەژمارکردنی قازانج'
              : 'Create sales invoices, run POS terminal, auto-deduct warehouse inventory, and track real-time COGS & gross profit'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setViewMode('LIST')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
              viewMode === 'LIST'
                ? 'bg-charcoal-900 dark:bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-charcoal-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            {lang === 'ar' ? 'سجل الفواتير' : lang === 'ku' ? 'لیستی پسوولەکان' : 'Invoices List'} (
            {invoices.length})
          </button>

          <button
            onClick={() => setViewMode('NEW_INVOICE')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition ${
              viewMode === 'NEW_INVOICE'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
            }`}
          >
            <Plus className="w-4 h-4" />
            {t.sales.newInvoice}
          </button>

          <button
            onClick={() => setViewMode('POS')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition ${
              viewMode === 'POS'
                ? 'bg-teal-600 text-white shadow-lg shadow-teal-600/25'
                : 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800'
            }`}
          >
            <Barcode className="w-4 h-4" />
            {t.sales.posMode}
          </button>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-slate-200 dark:hover:bg-charcoal-700 text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            {t.exportCsv}
          </button>
        </div>
      </div>

      {/* INVOICE BUILDER OR POS TERMINAL */}
      {(viewMode === 'NEW_INVOICE' || viewMode === 'POS') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Side: Product Catalog & Barcode Scanner */}
          <div className="lg:col-span-5 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-3.5 start-3.5" />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredProducts.length === 1) {
                    e.preventDefault();
                    addProductToInvoice(filteredProducts[0]);
                    setProductSearch('');
                  }
                }}
                placeholder={t.sales.selectProduct}
                className="w-full ps-10 pe-4 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[540px] overflow-y-auto pe-1">
              {filteredProducts.map((p) => {
                const stock = Number(p.totalStock);
                const isLow = stock <= Number(p.minStockLevel);
                const displayPrice =
                  currency === 'USD'
                    ? `$${Number(p.sellingPriceUsd).toFixed(2)}`
                    : `${Math.round(Number(p.sellingPriceUsd) * exchangeRate).toLocaleString()} د.ع`;

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProductToInvoice(p)}
                    className="text-start p-3.5 rounded-xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500 dark:hover:border-emerald-500 bg-slate-50/60 dark:bg-charcoal-950/60 hover:bg-emerald-50/30 transition group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 text-[10px] font-mono text-slate-400">
                        <span>{p.sku}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold ${
                            stock <= 0
                              ? 'bg-rose-500/15 text-rose-500'
                              : isLow
                              ? 'bg-amber-500/15 text-amber-500'
                              : 'bg-emerald-500/15 text-emerald-500'
                          }`}
                        >
                          {stock} {p.unit}
                        </span>
                      </div>
                      <div className="font-semibold text-xs text-slate-900 dark:text-white mt-1 line-clamp-2 group-hover:text-emerald-500">
                        {locName(p, lang)}
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-200/70 dark:border-charcoal-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        {displayPrice}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Cost: ${Number(p.purchaseCostUsd).toFixed(0)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Side: Active Invoice Cart & Accounting Controls */}
          <div className="lg:col-span-7 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {t.sales.customer}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowQuickCustomer(true)}
                    className="text-[11px] text-emerald-500 hover:underline flex items-center gap-0.5"
                  >
                    <UserPlus className="w-3 h-3" /> New
                  </button>
                </div>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (Debt: ${Number(c.balanceUsd).toFixed(0)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t.warehouse}
                </label>
                <select
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {locName(w, lang)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t.currency}
                </label>
                <div className="grid grid-cols-2 gap-1.5 bg-slate-100 dark:bg-charcoal-950 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => handleCurrencyToggle('USD')}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      currency === 'USD'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-500'
                    }`}
                  >
                    USD ($)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCurrencyToggle('IQD')}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      currency === 'IQD'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-500'
                    }`}
                  >
                    IQD (د.ع)
                  </button>
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="border border-slate-200 dark:border-charcoal-800 rounded-xl overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3 text-start">Product</th>
                    <th className="py-2.5 px-2 text-center w-20">{t.sales.qty}</th>
                    <th className="py-2.5 px-2 text-center w-28">{t.sales.unitPrice}</th>
                    <th className="py-2.5 px-2 text-center w-24">{t.sales.discount}</th>
                    <th className="py-2.5 px-3 text-end">{t.sales.lineTotal}</th>
                    <th className="py-2.5 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        {lang === 'ar'
                          ? 'اضغط على أي منتج من القائمة لإضافته إلى الفاتورة'
                          : lang === 'ku'
                          ? 'کرتە لە هەر کاڵایەک بکە بۆ زیادکردنی بۆ پسوولە'
                          : 'Click any product on the left to add it to this invoice'}
                      </td>
                    </tr>
                  ) : (
                    lines.map((line, idx) => {
                      const lineNet = Math.max(
                        0,
                        line.quantity * line.unitPriceOriginal - line.discountOriginal
                      );
                      const exceedsStock = line.quantity > line.availableStock;
                      return (
                        <tr key={line.productId}>
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {line.name}
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-2">
                              <span>{line.sku}</span>
                              {exceedsStock && (
                                <span className="text-rose-500 font-semibold flex items-center gap-0.5">
                                  <AlertTriangle className="w-3 h-3" /> Exceeds stock ({line.availableStock})
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min="1"
                              value={line.quantity}
                              onChange={(e) => {
                                const copy = [...lines];
                                copy[idx].quantity = Math.max(1, Number(e.target.value));
                                setLines(copy);
                              }}
                              className="w-full px-2 py-1 text-center rounded-lg bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={line.unitPriceOriginal}
                              onChange={(e) => {
                                const copy = [...lines];
                                copy[idx].unitPriceOriginal = Math.max(
                                  0,
                                  Number(e.target.value)
                                );
                                setLines(copy);
                              }}
                              className="w-full px-2 py-1 text-end rounded-lg bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={line.discountOriginal}
                              onChange={(e) => {
                                const copy = [...lines];
                                copy[idx].discountOriginal = Math.max(
                                  0,
                                  Number(e.target.value)
                                );
                                setLines(copy);
                              }}
                              className="w-full px-2 py-1 text-end rounded-lg bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800"
                            />
                          </td>
                          <td className="py-2 px-3 text-end font-bold">
                            {fmtOriginal(lineNet, currency, lang)}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                setLines(lines.filter((_, i) => i !== idx))
                              }
                              className="text-rose-500 hover:bg-rose-500/10 p-1 rounded-lg"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Payment Terms & Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 dark:bg-charcoal-950 p-4 rounded-xl border border-slate-200 dark:border-charcoal-800">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    {t.sales.paymentType}
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['CASH', 'CREDIT', 'PARTIAL'] as const).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => setPaymentType(pt)}
                        className={`py-2 px-2 rounded-lg text-[11px] font-bold border transition ${
                          paymentType === pt
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800'
                        }`}
                      >
                        {pt}
                      </button>
                    ))}
                  </div>
                </div>

                {paymentType === 'PARTIAL' && (
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      {t.paid} ({currency})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={paidAmountInput}
                      onChange={(e) => setPaidAmountInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                    />
                  </div>
                )}

                {paymentType !== 'CREDIT' && (
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Deposit Into Cash / Bank Account
                    </label>
                    <select
                      value={financialAccountId}
                      onChange={(e) => setFinancialAccountId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs"
                    >
                      {financialAccounts.map((fa) => (
                        <option key={fa.id} value={fa.id}>
                          {locName(fa, lang)} ({fa.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Extra Invoice Discount ({currency})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={invoiceDiscount}
                    onChange={(e) => setInvoiceDiscount(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs"
                  />
                </div>

                <div className="space-y-1.5 pt-1">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowNegativeStock}
                      onChange={(e) => setAllowNegativeStock(e.target.checked)}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.sales.allowNegativeStock}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideCreditLimit}
                      onChange={(e) => setOverrideCreditLimit(e.target.checked)}
                      className="rounded text-emerald-600"
                    />
                    <span>Authorize Credit Limit Override</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2 text-xs flex flex-col justify-between bg-white dark:bg-charcoal-900 p-4 rounded-xl border border-slate-200 dark:border-charcoal-800">
                <div className="space-y-2">
                  <div className="flex justify-between text-slate-500">
                    <span>Subtotal:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {fmtOriginal(totals.subtotalOrig, currency, lang)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Total Discounts:</span>
                    <span className="text-emerald-500 font-semibold">
                      -{fmtOriginal(totals.totalDiscOrig, currency, lang)}
                    </span>
                  </div>
                  <div className="flex justify-between text-base font-black text-slate-900 dark:text-white border-t border-slate-200 dark:border-charcoal-800 pt-2">
                    <span>{t.total}:</span>
                    <span className="text-emerald-500">
                      {fmtOriginal(totals.grandTotalOrig, currency, lang)}
                    </span>
                  </div>
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                    <span>{t.paid}:</span>
                    <span>{fmtOriginal(totals.paidOrig, currency, lang)}</span>
                  </div>
                  <div className="flex justify-between text-rose-500 font-bold">
                    <span>{t.due}:</span>
                    <span>{fmtOriginal(totals.dueOrig, currency, lang)}</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-dashed border-slate-200 dark:border-charcoal-800 flex justify-between items-center text-[11px]">
                  <span className="text-slate-400">
                    COGS: ${totals.totalCostUsd.toFixed(2)}
                  </span>
                  <span
                    className={`font-bold ${
                      totals.estProfitUsd >= 0 ? 'text-emerald-500' : 'text-rose-500'
                    }`}
                  >
                    Est. Profit: ${totals.estProfitUsd.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleCreateInvoice('DRAFT')}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-charcoal-700 hover:bg-slate-100 dark:hover:bg-charcoal-800 text-xs font-semibold"
              >
                {t.sales.saveAsDraft}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleCreateInvoice('POSTED')}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/25 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                {t.sales.postInvoice}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SALES INVOICES TABLE */}
      {viewMode === 'LIST' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute top-3 start-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search invoice # or customer..."
                className="w-full ps-9 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {['ALL', 'DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'RETURNED'].map(
                (st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition ${
                      statusFilter === st
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {st === 'ALL'
                      ? t.all
                      : (t.statuses as Record<string, string>)[st] || st}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4 text-start">Invoice #</th>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">{t.sales.customer}</th>
                  <th className="py-3 px-4 text-center">{t.status}</th>
                  <th className="py-3 px-4 text-end">{t.total}</th>
                  <th className="py-3 px-4 text-end">{t.paid}</th>
                  <th className="py-3 px-4 text-end">{t.due}</th>
                  <th className="py-3 px-4 text-end">{t.sales.lineProfit}</th>
                  <th className="py-3 px-4 text-center">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {filteredInvoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40 transition"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {inv.invoiceNumber}
                      <span className="ms-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-charcoal-800 text-slate-500">
                        {inv.currency}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {new Date(inv.date).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 font-semibold">{inv.customer?.name}</td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          inv.status === 'PAID'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : inv.status === 'PARTIALLY_PAID'
                            ? 'bg-amber-500/15 text-amber-500'
                            : inv.status === 'DRAFT'
                            ? 'bg-slate-500/15 text-slate-400'
                            : inv.status === 'RETURNED'
                            ? 'bg-rose-500/15 text-rose-500'
                            : 'bg-teal-500/15 text-teal-400'
                        }`}
                      >
                        {(t.statuses as Record<string, string>)[inv.status] || inv.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-end font-bold">
                      {fmtMoney(inv.totalUsd, displayCurrency, exchangeRate, lang)}
                    </td>
                    <td className="py-3 px-4 text-end text-emerald-500 font-semibold">
                      {fmtMoney(inv.paidUsd, displayCurrency, exchangeRate, lang)}
                    </td>
                    <td className="py-3 px-4 text-end text-rose-500 font-semibold">
                      {fmtMoney(inv.dueUsd, displayCurrency, exchangeRate, lang)}
                    </td>
                    <td className="py-3 px-4 text-end font-semibold text-teal-500">
                      {fmtMoney(inv.grossProfitUsd, displayCurrency, exchangeRate, lang)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() =>
                            onPrint({ type: 'SALES_INVOICE', mode: 'A4', data: inv })
                          }
                          title={t.sales.printInvoice}
                          className="p-1.5 rounded-lg bg-slate-100 dark:bg-charcoal-800 hover:bg-emerald-500/20 text-slate-600 dark:text-slate-300 hover:text-emerald-400"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            onPrint({
                              type: 'SALES_INVOICE',
                              mode: 'THERMAL',
                              data: inv,
                            })
                          }
                          title={t.sales.printReceipt}
                          className="p-1.5 rounded-lg bg-slate-100 dark:bg-charcoal-800 hover:bg-teal-500/20 text-slate-600 dark:text-slate-300 hover:text-teal-400"
                        >
                          <Receipt className="w-3.5 h-3.5" />
                        </button>

                        {inv.status === 'DRAFT' && (
                          <>
                            <button
                              onClick={() => handlePostDraft(inv.id)}
                              className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-500"
                            >
                              Post
                            </button>
                            <button
                              onClick={async () => {
                                const res = await fetch('/api/sales', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    action: 'cancelDraft',
                                    invoiceId: inv.id,
                                  }),
                                });
                                if (res.ok) {
                                  notify('warning', `Cancelled draft ${inv.invoiceNumber}`);
                                  await onRefresh();
                                }
                              }}
                              title="Cancel Draft"
                              className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status) && (
                          <button
                            onClick={() => setReturnTarget(inv)}
                            title={t.sales.returnInvoice}
                            className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick Create Customer Modal */}
      {showQuickCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleQuickCreateCustomer}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">Quick Create Customer</h3>
            <div>
              <label className="block text-xs font-semibold mb-1">Customer Name</label>
              <input
                type="text"
                required
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Phone Number</label>
              <input
                type="text"
                required
                value={newCustomerPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowQuickCustomer(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sales Return & Refund Confirmation Dialog */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-bold text-rose-500 flex items-center gap-2">
              <RotateCcw className="w-5 h-5" />
              {t.sales.returnInvoice} — {returnTarget.invoiceNumber}
            </h3>
            <p className="text-xs text-slate-500">
              This will restore all items to inventory, reverse the customer receivable /
              refund cash, and post an official reversing double-entry journal entry.
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Return Reason</label>
              <input
                type="text"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setReturnTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleReturnInvoice}
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
              >
                Confirm Return & Reversal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   PURCHASES & PROCUREMENT MODULE VIEW
   ============================================================================ */

interface PurchasesModuleProps {
  lang: LanguageCode;
  displayCurrency: 'USD' | 'IQD';
  exchangeRate: number;
  invoices: any[];
  products: any[];
  suppliers: any[];
  warehouses: any[];
  financialAccounts: any[];
  onRefresh: () => Promise<void>;
  onPrint: (doc: {
    type: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'ACCOUNT_STATEMENT';
    mode?: 'A4' | 'THERMAL';
    data: any;
  }) => void;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function PurchasesModuleView({
  lang,
  displayCurrency,
  exchangeRate,
  invoices,
  products,
  suppliers,
  warehouses,
  financialAccounts,
  onRefresh,
  onPrint,
  notify,
}: PurchasesModuleProps) {
  const t = translations[lang];
  const [showBuilder, setShowBuilder] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [submitting, setSubmitting] = useState(false);

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || '');
  const [currency, setCurrency] = useState<'USD' | 'IQD'>(displayCurrency);
  const [paymentType, setPaymentType] = useState<'CASH' | 'CREDIT' | 'PARTIAL'>('CREDIT');
  const [financialAccountId, setFinancialAccountId] = useState(
    financialAccounts[0]?.id || ''
  );
  const [shippingCost, setShippingCost] = useState('0');
  const [invoiceDiscount, setInvoiceDiscount] = useState('0');
  const [paidAmountInput, setPaidAmountInput] = useState('0');
  const [notes, setNotes] = useState('');
  const [attachmentName, setAttachmentName] = useState('');

  const [lines, setLines] = useState<
    {
      productId: string;
      name: string;
      sku: string;
      quantity: number;
      unitCostOriginal: number;
      discountOriginal: number;
    }[]
  >([]);

  const addProductLine = (p: any) => {
    const existing = lines.findIndex((l) => l.productId === p.id);
    const defaultCost =
      currency === 'USD'
        ? Number(p.purchaseCostUsd)
        : Math.round(Number(p.purchaseCostUsd) * exchangeRate);

    if (existing >= 0) {
      const copy = [...lines];
      copy[existing].quantity += 1;
      setLines(copy);
    } else {
      setLines([
        ...lines,
        {
          productId: p.id,
          name: locName(p, lang),
          sku: p.sku,
          quantity: 5,
          unitCostOriginal: defaultCost,
          discountOriginal: 0,
        },
      ]);
    }
  };

  const totals = useMemo(() => {
    let subtotalOrig = 0;
    let lineDiscOrig = 0;
    for (const l of lines) {
      subtotalOrig += l.quantity * l.unitCostOriginal;
      lineDiscOrig += l.discountOriginal;
    }
    const totalDisc = lineDiscOrig + Number(invoiceDiscount || 0);
    const ship = Number(shippingCost || 0);
    const grandTotalOrig = Math.max(0, subtotalOrig - totalDisc + ship);
    const paidOrig =
      paymentType === 'CASH'
        ? grandTotalOrig
        : paymentType === 'CREDIT'
        ? 0
        : Number(paidAmountInput || 0);
    const dueOrig = Math.max(0, grandTotalOrig - paidOrig);

    return { subtotalOrig, totalDisc, ship, grandTotalOrig, paidOrig, dueOrig };
  }, [lines, invoiceDiscount, shippingCost, paymentType, paidAmountInput]);

  const handleCreatePurchase = async (status: 'DRAFT' | 'POSTED') => {
    const effectiveSupplierId = supplierId || suppliers[0]?.id;
    const effectiveWarehouseId = warehouseId || warehouses[0]?.id;
    const effectiveFinAccId = financialAccountId || financialAccounts[0]?.id;

    if (!effectiveSupplierId || lines.length === 0) {
      notify('error', 'Select a supplier and add at least one product');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createInvoice',
          supplierId: effectiveSupplierId,
          supplierInvoiceRef,
          warehouseId: effectiveWarehouseId,
          status,
          paymentType,
          currency,
          exchangeRate,
          shippingOriginal: totals.ship,
          invoiceDiscountOriginal: Number(invoiceDiscount || 0),
          paidOriginal: totals.paidOrig,
          financialAccountId: effectiveFinAccId,
          notes,
          attachmentName: attachmentName || null,
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCostOriginal: l.unitCostOriginal,
            discountOriginal: l.discountOriginal,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to create purchase invoice');
      } else {
        notify(
          'success',
          status === 'DRAFT'
            ? `Draft Purchase Invoice ${data.invoice.invoiceNumber} saved!`
            : `Purchase Invoice ${data.invoice.invoiceNumber} received into inventory & posted to General Ledger!`
        );
        setLines([]);
        setShowBuilder(false);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostPurchase = async (invoiceId: string) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'postInvoice', invoiceId }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `Purchase Invoice ${data.invoice.invoiceNumber} posted!`);
        await onRefresh();
      } else {
        notify('error', data.error || 'Failed to post purchase');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnPurchase = async (inv: any) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'returnInvoice',
          invoiceId: inv.id,
          reason: 'Returned defective/excess goods to supplier',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(
          'success',
          `Purchase Return completed for ${inv.invoiceNumber}. Stock & supplier payable updated!`
        );
        await onRefresh();
      } else {
        notify('error', data.error || 'Failed to process purchase return');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const filteredInvoices = invoices.filter((inv) => {
    if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      inv.invoiceNumber.toLowerCase().includes(q) ||
      inv.supplier?.name?.toLowerCase().includes(q) ||
      (inv.supplierInvoiceRef && inv.supplierInvoiceRef.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <PackageCheck className="w-6 h-6 text-emerald-500" />
            {t.purchases.title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {lang === 'ar'
              ? 'توريد البضائع للمخازن، تحديث متوسط التكلفة المرجح تلقائياً، وإدارة ذمم الموردين'
              : lang === 'ku'
              ? 'هاوردەکردنی کاڵا بۆ کۆگا، نوێکردنەوەی تێچوو، و تۆمارکردنی قەرزی دابینکەران'
              : 'Receive supplier goods into warehouses, auto-calculate weighted average cost, and post supplier payables'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowBuilder(!showBuilder)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/25 transition"
          >
            <Plus className="w-4 h-4" />
            {t.purchases.newPurchase}
          </button>
          <button
            onClick={() =>
              exportToCsv(
                'purchase-invoices',
                ['Invoice #', 'Supplier Ref', 'Date', 'Supplier', 'Status', 'Total USD', 'Paid USD', 'Due USD'],
                filteredInvoices.map((i) => [
                  i.invoiceNumber,
                  i.supplierInvoiceRef || '',
                  new Date(i.date).toISOString().slice(0, 10),
                  i.supplier?.name,
                  i.status,
                  Number(i.totalUsd).toFixed(2),
                  Number(i.paidUsd).toFixed(2),
                  Number(i.dueUsd).toFixed(2),
                ])
              )
            }
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            {t.exportCsv}
          </button>
        </div>
      </div>

      {showBuilder && (
        <div className="bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-emerald-500/40 shadow-lg space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">
                {t.purchases.supplier}
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Payable: ${Number(s.balanceUsd).toFixed(0)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                {t.purchases.supplierRef}
              </label>
              <input
                type="text"
                value={supplierInvoiceRef}
                onChange={(e) => setSupplierInvoiceRef(e.target.value)}
                placeholder="e.g. SUP-2026-991"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                {t.warehouse}
              </label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {locName(w, lang)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                Add Product to Purchase Order
              </label>
              <select
                onChange={(e) => {
                  const p = products.find((x) => x.id === e.target.value);
                  if (p) addProductLine(p);
                  e.target.value = '';
                }}
                defaultValue=""
                className="w-full px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold"
              >
                <option value="" disabled>
                  + Select Product to Receive...
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {locName(p, lang)} (${Number(p.purchaseCostUsd).toFixed(0)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Items table */}
          <div className="border border-slate-200 dark:border-charcoal-800 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-2 px-3 text-start">Product</th>
                  <th className="py-2 px-3 text-center w-24">Quantity</th>
                  <th className="py-2 px-3 text-end w-32">Unit Cost ({currency})</th>
                  <th className="py-2 px-3 text-end">Line Total</th>
                  <th className="py-2 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {lines.map((l, idx) => (
                  <tr key={l.productId}>
                    <td className="py-2 px-3 font-semibold">
                      {l.name} <span className="text-slate-400 font-mono">({l.sku})</span>
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min="1"
                        value={l.quantity}
                        onChange={(e) => {
                          const copy = [...lines];
                          copy[idx].quantity = Math.max(1, Number(e.target.value));
                          setLines(copy);
                        }}
                        className="w-full px-2 py-1 text-center rounded bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.unitCostOriginal}
                        onChange={(e) => {
                          const copy = [...lines];
                          copy[idx].unitCostOriginal = Math.max(
                            0,
                            Number(e.target.value)
                          );
                          setLines(copy);
                        }}
                        className="w-full px-2 py-1 text-end rounded bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800"
                      />
                    </td>
                    <td className="py-2 px-3 text-end font-bold">
                      {fmtOriginal(l.quantity * l.unitCostOriginal, currency, lang)}
                    </td>
                    <td className="py-2 px-2">
                      <button
                        type="button"
                        onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                        className="text-rose-500 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold mb-1">Payment Terms</label>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              >
                <option value="CREDIT">Credit Purchase (On Account Payable)</option>
                <option value="CASH">Cash Purchase (Paid in Full)</option>
                <option value="PARTIAL">Partial Payment</option>
              </select>
            </div>

            {paymentType === 'PARTIAL' && (
              <div>
                <label className="block text-xs font-semibold mb-1">
                  Paid Amount ({currency})
                </label>
                <input
                  type="number"
                  value={paidAmountInput}
                  onChange={(e) => setPaidAmountInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold mb-1">
                Supporting Document / Attachment Ref
              </label>
              <input
                type="text"
                value={attachmentName}
                onChange={(e) => setAttachmentName(e.target.value)}
                placeholder="e.g. BillOfLading-882.pdf"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>

            <div className="text-end">
              <div className="text-xs text-slate-400">
                Total: <span className="text-base font-black text-emerald-500">{fmtOriginal(totals.grandTotalOrig, currency, lang)}</span>
              </div>
              <div className="text-[11px] text-rose-500">
                Supplier Balance Due: {fmtOriginal(totals.dueOrig, currency, lang)}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => handleCreatePurchase('DRAFT')}
              disabled={submitting}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-charcoal-700 text-xs font-semibold"
            >
              {t.sales.saveAsDraft}
            </button>
            <button
              type="button"
              onClick={() => handleCreatePurchase('POSTED')}
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
            >
              {t.purchases.postPurchase}
            </button>
          </div>
        </div>
      )}

      {/* Purchases Table */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap justify-between gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search purchase invoice or supplier..."
            className="w-full sm:w-80 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
              <tr>
                <th className="py-3 px-4 text-start">Invoice #</th>
                <th className="py-3 px-4 text-start">Supplier Ref</th>
                <th className="py-3 px-4 text-start">{t.date}</th>
                <th className="py-3 px-4 text-start">{t.purchases.supplier}</th>
                <th className="py-3 px-4 text-center">{t.status}</th>
                <th className="py-3 px-4 text-end">{t.total}</th>
                <th className="py-3 px-4 text-end">{t.paid}</th>
                <th className="py-3 px-4 text-end">{t.due}</th>
                <th className="py-3 px-4 text-center">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
              {filteredInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                  <td className="py-3 px-4 font-mono font-bold text-emerald-500">
                    {inv.invoiceNumber}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-400">
                    {inv.supplierInvoiceRef || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-500">
                    {new Date(inv.date).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 font-semibold">{inv.supplier?.name}</td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        inv.status === 'PAID'
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : inv.status === 'PARTIALLY_PAID'
                          ? 'bg-amber-500/15 text-amber-500'
                          : inv.status === 'RETURNED'
                          ? 'bg-rose-500/15 text-rose-500'
                          : 'bg-teal-500/15 text-teal-400'
                      }`}
                    >
                      {(t.statuses as Record<string, string>)[inv.status] || inv.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-end font-bold">
                    {fmtMoney(inv.totalUsd, displayCurrency, exchangeRate, lang)}
                  </td>
                  <td className="py-3 px-4 text-end text-emerald-500 font-semibold">
                    {fmtMoney(inv.paidUsd, displayCurrency, exchangeRate, lang)}
                  </td>
                  <td className="py-3 px-4 text-end text-rose-500 font-semibold">
                    {fmtMoney(inv.dueUsd, displayCurrency, exchangeRate, lang)}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() =>
                          onPrint({ type: 'PURCHASE_INVOICE', mode: 'A4', data: inv })
                        }
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-charcoal-800 hover:bg-emerald-500/20"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                      {inv.status === 'DRAFT' && (
                        <button
                          onClick={() => handlePostPurchase(inv.id)}
                          className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold"
                        >
                          Post
                        </button>
                      )}
                      {['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status) && (
                        <button
                          onClick={() => handleReturnPurchase(inv)}
                          title={t.purchases.returnPurchase}
                          className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
