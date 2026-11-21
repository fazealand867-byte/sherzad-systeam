'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Search,
  Printer,
  RotateCcw,
  CheckCircle2,
  Trash2,
  ShoppingCart,
  Download,
  Barcode,
  AlertTriangle,
  Receipt,
  PackageCheck,
  ChevronDown,
  ChevronUp,
  XCircle,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import {
  exportToCsv,
  fmtIqd,
  fmtQty,
  locName,
  todayDateStr,
  makeIdempotencyKey,
} from '@/lib/client-utils';
import {
  UnitDefinition,
  getCompatibleUnits,
  convertQuantity,
  convertUnitPrice,
  unitLabel,
} from '@/lib/units';
import { SearchableSelect } from './SearchableSelect';
import { PrintableDocument } from './PrintModal';

/* ============================================================================
   1. SIMPLIFIED & FAST SALES MODULE (IQD-ONLY + UNIT CONVERSION)
   ============================================================================ */

interface SalesModuleProps {
  lang: LanguageCode;
  invoices: any[];
  products: any[];
  customers: any[];
  warehouses: any[];
  financialAccounts: any[];
  units: UnitDefinition[];
  autoOpenNew?: boolean;
  onClearAutoOpen?: () => void;
  onRefresh: () => Promise<void>;
  onPrint: (doc: PrintableDocument) => void;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function SalesModuleView({
  lang,
  invoices,
  products,
  customers,
  warehouses,
  financialAccounts,
  units,
  autoOpenNew,
  onClearAutoOpen,
  onRefresh,
  onPrint,
  notify,
}: SalesModuleProps) {
  const t = translations[lang];
  const [viewMode, setViewMode] = useState<'LIST' | 'NEW' | 'POS'>('LIST');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [idemKey, setIdemKey] = useState(() => makeIdempotencyKey('sale'));

  const [customerId, setCustomerId] = useState<string>(customers[0]?.id || '');
  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.id || '');
  const [date, setDate] = useState(todayDateStr());
  const [paymentType, setPaymentType] = useState<'CASH' | 'CREDIT' | 'PARTIAL'>('CASH');
  const [financialAccountId, setFinancialAccountId] = useState<string>(financialAccounts[0]?.id || '');
  const [invoiceDiscountIqd, setInvoiceDiscountIqd] = useState('0');
  const [paidInputIqd, setPaidInputIqd] = useState('');
  const [notes, setNotes] = useState('');
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [posSearch, setPosSearch] = useState('');

  const [lines, setLines] = useState<
    {
      productId: string;
      name: string;
      baseUnit: string;
      availableStock: number;
      quantity: string;
      unit: string;
      unitPriceIqd: string;
      baseSellingPriceIqd: number;
      baseCostIqd: number;
    }[]
  >([]);

  // Quick-create customer
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');

  // Return modal
  const [returnTarget, setReturnTarget] = useState<any | null>(null);
  const [returnReason, setReturnReason] = useState('');

  const startNewSale = (mode: 'NEW' | 'POS' = 'NEW') => {
    setIdemKey(makeIdempotencyKey('sale'));
    setCustomerId((prev) => prev || customers[0]?.id || '');
    setWarehouseId((prev) => prev || warehouses[0]?.id || '');
    setFinancialAccountId((prev) => prev || financialAccounts[0]?.id || '');
    setDate(todayDateStr());
    setPaymentType('CASH');
    setInvoiceDiscountIqd('0');
    setPaidInputIqd('');
    setNotes('');
    setLines([]);
    setShowAdvanced(false);
    setViewMode(mode);
  };

  useEffect(() => {
    if (autoOpenNew) {
      startNewSale('NEW');
      onClearAutoOpen?.();
    }
  }, [autoOpenNew]);

  const sellableProducts = useMemo(() => {
    // Show finished products first, then general, then raw materials
    const order: Record<string, number> = { FINISHED_PRODUCT: 0, GENERAL: 1, RAW_MATERIAL: 2 };
    return [...products].sort(
      (a, b) => (order[a.productType] ?? 1) - (order[b.productType] ?? 1)
    );
  }, [products]);

  const addProductToSale = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const existingIdx = lines.findIndex((l) => l.productId === p.id && l.unit === p.unit);
    if (existingIdx >= 0) {
      const copy = [...lines];
      copy[existingIdx].quantity = String(Number(copy[existingIdx].quantity || 0) + 1);
      setLines(copy);
    } else {
      setLines([
        ...lines,
        {
          productId: p.id,
          name: locName(p, lang),
          baseUnit: p.unit,
          availableStock: Number(p.totalStock || 0),
          quantity: '1',
          unit: p.unit,
          unitPriceIqd: String(Number(p.sellingPriceIqd || 0)),
          baseSellingPriceIqd: Number(p.sellingPriceIqd || 0),
          baseCostIqd: Number(p.purchaseCostIqd || 0),
        },
      ]);
    }
  };

  const handleLineUnitChange = (idx: number, newUnit: string) => {
    const copy = [...lines];
    const line = copy[idx];
    line.unit = newUnit;
    try {
      const convertedPrice = convertUnitPrice(line.baseSellingPriceIqd, line.baseUnit, newUnit, units);
      line.unitPriceIqd = String(convertedPrice);
    } catch {}
    setLines(copy);
  };

  const totals = useMemo(() => {
    let subtotalIqd = 0;
    for (const l of lines) {
      subtotalIqd += Math.round(Number(l.quantity || 0) * Number(l.unitPriceIqd || 0));
    }
    const disc = Math.round(Number(invoiceDiscountIqd || 0));
    const grandTotalIqd = Math.max(0, subtotalIqd - disc);
    const paidIqd =
      paymentType === 'CASH'
        ? grandTotalIqd
        : paymentType === 'CREDIT'
        ? 0
        : Math.round(Number(paidInputIqd || 0));
    const dueIqd = Math.max(0, grandTotalIqd - paidIqd);
    return { subtotalIqd, disc, grandTotalIqd, paidIqd, dueIqd };
  }, [lines, invoiceDiscountIqd, paymentType, paidInputIqd]);

  const handleSaveSale = async (targetStatus: 'POSTED' | 'DRAFT') => {
    const effectiveCustomerId = customerId || customers[0]?.id;
    if (!effectiveCustomerId) {
      notify('error', t.sales.selectCustomer);
      return;
    }
    if (lines.length === 0) {
      notify('error', t.sales.selectProduct);
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
          warehouseId: warehouseId || warehouses[0]?.id,
          date,
          status: targetStatus,
          paymentType,
          invoiceDiscountIqd: Number(invoiceDiscountIqd || 0),
          paidIqd: totals.paidIqd,
          financialAccountId: financialAccountId || financialAccounts[0]?.id,
          notes,
          allowNegativeStock,
          idempotencyKey: idemKey,
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: Number(l.quantity),
            unit: l.unit,
            unitPriceIqd: Number(l.unitPriceIqd),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to save invoice');
      } else {
        notify('success', `${data.invoice.invoiceNumber} — ${fmtIqd(data.invoice.totalIqd, lang)} ✓`);
        setViewMode('LIST');
        await onRefresh();
        if (targetStatus === 'POSTED') {
          onPrint({ type: 'SALES_INVOICE', mode: viewMode === 'POS' ? 'THERMAL' : 'A4', data: data.invoice });
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createCustomer', name: newCustName.trim(), phone: newCustPhone.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.customer) {
        await onRefresh();
        setCustomerId(data.customer.id);
        setShowQuickCustomer(false);
        setNewCustName('');
        setNewCustPhone('');
        notify('success', `${data.customer.name} ✓`);
      } else notify('error', data.error || 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        (inv.invoiceNumber || '').toLowerCase().includes(q) ||
        (inv.customer?.name || '').toLowerCase().includes(q)
      );
    });
  }, [invoices, statusFilter, searchQuery]);

  const posFilteredProducts = useMemo(() => {
    const q = posSearch.trim().toLowerCase();
    if (!q) return sellableProducts;
    return sellableProducts.filter(
      (p) =>
        (p.nameKu || '').toLowerCase().includes(q) ||
        (p.nameAr || '').toLowerCase().includes(q) ||
        (p.nameEn || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q)
    );
  }, [sellableProducts, posSearch]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
            <ShoppingCart className="w-6 h-6 text-emerald-500" />
            {t.sales.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t.sales.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setViewMode('LIST')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold ${
              viewMode === 'LIST' ? 'bg-charcoal-900 dark:bg-slate-700 text-white' : 'bg-slate-100 dark:bg-charcoal-800'
            }`}
          >
            {t.sales.invoicesList} ({invoices.length})
          </button>
          <button
            onClick={() => startNewSale('NEW')}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/25"
          >
            <Plus className="w-4 h-4" />
            {t.sales.newSale}
          </button>
          <button
            onClick={() => startNewSale('POS')}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-600/15 text-teal-600 dark:text-teal-400 border border-teal-500/30 text-xs font-bold"
          >
            <Barcode className="w-4 h-4" />
            {t.sales.posMode}
          </button>
        </div>
      </div>

      {/* SIMPLE FAST SALE BUILDER / POS */}
      {(viewMode === 'NEW' || viewMode === 'POS') && (
        <div className={`grid grid-cols-1 ${viewMode === 'POS' ? 'lg:grid-cols-12' : ''} gap-6`}>
          {viewMode === 'POS' && (
            <div className="lg:col-span-5 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute top-3 start-3.5" />
                <input
                  type="text"
                  value={posSearch}
                  onChange={(e) => setPosSearch(e.target.value)}
                  placeholder={t.sales.selectProduct}
                  className="w-full ps-10 pe-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5 max-h-[520px] overflow-y-auto">
                {posFilteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProductToSale(p.id)}
                    className="text-start p-3.5 rounded-xl border border-slate-200 dark:border-charcoal-800 hover:border-emerald-500 bg-slate-50 dark:bg-charcoal-950 transition"
                  >
                    <div className="font-bold text-sm text-slate-900 dark:text-white truncate">{locName(p, lang)}</div>
                    <div className="flex justify-between items-center mt-2 text-xs">
                      <span className="font-black text-emerald-500">{fmtIqd(p.sellingPriceIqd, lang)}</span>
                      <span className="text-[11px] text-slate-400">
                        {fmtQty(p.totalStock)} {unitLabel(p.unit, lang, units)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`${viewMode === 'POS' ? 'lg:col-span-7' : 'max-w-4xl mx-auto w-full'} bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-5`}>
            {/* Step 1 & 2: Customer + Add Product Searchable Dropdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                  1. {t.sales.customer} *
                </label>
                <SearchableSelect
                  value={customerId}
                  onChange={setCustomerId}
                  placeholder={t.sales.selectCustomer}
                  onQuickAdd={() => setShowQuickCustomer(true)}
                  quickAddLabel={t.sales.newCustomer}
                  options={customers.map((c) => ({
                    value: c.id,
                    label: c.name,
                    sublabel: c.phone,
                    badge: Number(c.balanceIqd) > 0 ? fmtIqd(c.balanceIqd, lang) : undefined,
                    badgeColor: 'amber',
                  }))}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                  2. {t.sales.selectProduct}
                </label>
                <SearchableSelect
                  value=""
                  onChange={addProductToSale}
                  placeholder={t.sales.selectProduct}
                  options={sellableProducts.map((p) => ({
                    value: p.id,
                    label: locName(p, lang),
                    sublabel: fmtIqd(p.sellingPriceIqd, lang),
                    badge: `${fmtQty(p.totalStock)} ${unitLabel(p.unit, lang, units)}`,
                    badgeColor: Number(p.totalStock) <= Number(p.minStockLevel) ? 'rose' : 'emerald',
                  }))}
                />
              </div>
            </div>

            {/* Step 3 & 4: Line Items with Quantity + Compatible Unit + Price */}
            <div className="border border-slate-200 dark:border-charcoal-800 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                  <tr>
                    <th className="py-2.5 px-3 text-start">{t.products.productName}</th>
                    <th className="py-2.5 px-2 text-center w-24">{t.sales.qty}</th>
                    <th className="py-2.5 px-2 text-center w-28">{t.unit}</th>
                    <th className="py-2.5 px-2 text-end w-32">{t.sales.unitPrice}</th>
                    <th className="py-2.5 px-3 text-end">{t.sales.lineTotal}</th>
                    <th className="py-2.5 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400 text-xs">
                        {t.sales.selectProduct}
                      </td>
                    </tr>
                  ) : (
                    lines.map((line, idx) => {
                      const qtyNum = Number(line.quantity || 0);
                      const priceNum = Number(line.unitPriceIqd || 0);
                      const lineNet = Math.round(qtyNum * priceNum);
                      let baseReq = qtyNum;
                      try {
                        baseReq = convertQuantity(qtyNum, line.unit, line.baseUnit, units);
                      } catch {}
                      const exceeds = baseReq > line.availableStock + 0.0001;

                      return (
                        <tr key={`${line.productId}-${idx}`}>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-900 dark:text-white">{line.name}</div>
                            <div className="text-[11px] text-slate-400">
                              {line.unit !== line.baseUnit && (
                                <span className="text-teal-500 font-bold me-2">
                                  = {fmtQty(baseReq)} {unitLabel(line.baseUnit, lang, units)}
                                </span>
                              )}
                              {exceeds && (
                                <span className="text-rose-500 font-bold inline-flex items-center gap-0.5">
                                  <AlertTriangle className="w-3 h-3" /> {fmtQty(line.availableStock)} {unitLabel(line.baseUnit, lang, units)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-2">
                            <input
                              type="number"
                              step="any"
                              min="0.0001"
                              value={line.quantity}
                              onChange={(e) => {
                                const c = [...lines];
                                c[idx].quantity = e.target.value;
                                setLines(c);
                              }}
                              className="w-full px-2 py-2 text-center rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 font-bold"
                            />
                          </td>
                          <td className="py-2.5 px-2">
                            <select
                              value={line.unit}
                              onChange={(e) => handleLineUnitChange(idx, e.target.value)}
                              className="w-full px-2 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                            >
                              {getCompatibleUnits(line.baseUnit, units).map((u) => (
                                <option key={u.code} value={u.code}>{locName(u, lang)}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-2">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={line.unitPriceIqd}
                              onChange={(e) => {
                                const c = [...lines];
                                c[idx].unitPriceIqd = e.target.value;
                                setLines(c);
                              }}
                              className="w-full px-2.5 py-2 text-end rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 font-bold"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-end font-black text-emerald-600 dark:text-emerald-400">
                            {fmtIqd(lineNet, lang)}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                              className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10"
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

            {/* Step 5: Payment & Totals */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 dark:bg-charcoal-950 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                  {t.sales.paymentType}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['CASH', 'CREDIT', 'PARTIAL'] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setPaymentType(pt)}
                      className={`py-2.5 rounded-xl text-xs font-bold border transition ${
                        paymentType === pt
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow'
                          : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800'
                      }`}
                    >
                      {pt === 'CASH' ? t.sales.cash : pt === 'CREDIT' ? t.sales.credit : t.sales.partial}
                    </button>
                  ))}
                </div>

                {paymentType === 'PARTIAL' && (
                  <div>
                    <label className="block text-xs font-bold mb-1">{t.paid} (IQD)</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={paidInputIqd}
                      onChange={(e) => setPaidInputIqd(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-sm font-black text-emerald-500"
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-emerald-500 pt-1"
                >
                  {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {t.advancedOptions}
                </button>

                {showAdvanced && (
                  <div className="space-y-2.5 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">{t.date}</label>
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">{t.sales.discount}</label>
                        <input type="number" min="0" value={invoiceDiscountIqd} onChange={(e) => setInvoiceDiscountIqd(e.target.value)} className="w-full px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs font-bold" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs">
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{locName(w, lang)}</option>)}
                      </select>
                      <select value={financialAccountId} onChange={(e) => setFinancialAccountId(e.target.value)} className="px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs">
                        {financialAccounts.map((fa) => <option key={fa.id} value={fa.id}>{locName(fa, lang)}</option>)}
                      </select>
                    </div>
                    <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t.notes} className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={allowNegativeStock} onChange={(e) => setAllowNegativeStock(e.target.checked)} className="rounded text-emerald-600" />
                      <span>{lang === 'ku' ? 'ڕێگەدان بە فرۆشتن لە ژێر سفر' : 'Allow negative stock'}</span>
                    </label>
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-charcoal-900 p-4 rounded-xl border border-slate-200 dark:border-charcoal-800 flex flex-col justify-between space-y-2 text-sm">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{t.total}:</span>
                    <span className="font-bold">{fmtIqd(totals.subtotalIqd, lang)}</span>
                  </div>
                  {totals.disc > 0 && (
                    <div className="flex justify-between text-xs text-emerald-500">
                      <span>{t.sales.discount}:</span>
                      <span>-{fmtIqd(totals.disc, lang)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xl font-black border-t border-slate-200 dark:border-charcoal-800 pt-2">
                    <span>{t.total}:</span>
                    <span className="text-emerald-500">{fmtIqd(totals.grandTotalIqd, lang)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <span>{t.paid}:</span>
                    <span>{fmtIqd(totals.paidIqd, lang)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold text-rose-500">
                    <span>{t.due}:</span>
                    <span>{fmtIqd(totals.dueIqd, lang)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3">
                  {showAdvanced && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleSaveSale('DRAFT')}
                      className="px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-charcoal-700 text-xs font-bold"
                    >
                      {t.sales.saveDraft}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleSaveSale('POSTED')}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg shadow-emerald-600/25 transition"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    {submitting ? t.saving : t.sales.saveInvoice}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SALES LIST */}
      {viewMode === 'LIST' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute top-3 start-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full ps-10 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {['ALL', 'PAID', 'PARTIALLY_PAID', 'POSTED', 'DRAFT', 'RETURNED'].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                    statusFilter === st ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'
                  }`}
                >
                  {st === 'ALL' ? t.all : (t.statuses as Record<string, string>)[st] || st}
                </button>
              ))}
              <button
                onClick={() =>
                  exportToCsv(
                    'sales-iqd',
                    ['Invoice #', 'Date', 'Customer', 'Status', 'Total IQD', 'Paid IQD', 'Due IQD'],
                    filteredInvoices.map((i) => [
                      i.invoiceNumber,
                      new Date(i.date).toISOString().slice(0, 10),
                      i.customer?.name || '',
                      i.status,
                      i.totalIqd,
                      i.paidIqd,
                      i.dueIqd,
                    ])
                  )
                }
                className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                Excel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">#</th>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">{t.sales.customer}</th>
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
                    <td className="py-3 px-4 font-mono text-xs font-bold text-emerald-500">{inv.invoiceNumber}</td>
                    <td className="py-3 px-4 text-xs text-slate-500">{new Date(inv.date).toLocaleDateString()}</td>
                    <td className="py-3 px-4 font-bold">{inv.customer?.name}</td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          inv.status === 'PAID'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : inv.status === 'PARTIALLY_PAID'
                            ? 'bg-amber-500/15 text-amber-500'
                            : inv.status === 'RETURNED'
                            ? 'bg-rose-500/15 text-rose-500'
                            : 'bg-teal-500/15 text-teal-500'
                        }`}
                      >
                        {(t.statuses as Record<string, string>)[inv.status] || inv.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-end font-black">{fmtIqd(inv.totalIqd, lang)}</td>
                    <td className="py-3 px-4 text-end text-emerald-500 font-bold">{fmtIqd(inv.paidIqd, lang)}</td>
                    <td className="py-3 px-4 text-end text-rose-500 font-bold">{fmtIqd(inv.dueIqd, lang)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => onPrint({ type: 'SALES_INVOICE', mode: 'A4', data: inv })}
                          title={t.sales.printInvoice}
                          className="p-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:text-emerald-500"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onPrint({ type: 'SALES_INVOICE', mode: 'THERMAL', data: inv })}
                          title={t.sales.printReceipt}
                          className="p-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:text-teal-500"
                        >
                          <Receipt className="w-3.5 h-3.5" />
                        </button>
                        {inv.status === 'DRAFT' && (
                          <button
                            onClick={async () => {
                              const res = await fetch('/api/sales', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: 'postInvoice', invoiceId: inv.id }),
                              });
                              if (res.ok) {
                                notify('success', `${inv.invoiceNumber} posted!`);
                                await onRefresh();
                              } else notify('error', (await res.json()).error || 'Failed');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                          >
                            Post
                          </button>
                        )}
                        {['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status) && (
                          <button
                            onClick={() => setReturnTarget(inv)}
                            title={t.sales.returnInvoice}
                            className="p-2 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
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

      {/* Quick Create Customer */}
      {showQuickCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleQuickCustomer} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-black">{t.parties.addCustomer}</h3>
            <input type="text" required placeholder={t.employees.name} value={newCustName} onChange={(e) => setNewCustName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            <input type="text" placeholder={t.employees.phone} value={newCustPhone} onChange={(e) => setNewCustPhone(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-mono" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowQuickCustomer(false)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">{t.save}</button>
            </div>
          </form>
        </div>
      )}

      {/* Return Dialog */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-black text-rose-500">
              {t.sales.returnInvoice} — {returnTarget.invoiceNumber}
            </h3>
            <input type="text" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder={t.notes} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setReturnTarget(null)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">{t.cancel}</button>
              <button
                onClick={async () => {
                  setSubmitting(true);
                  try {
                    const res = await fetch('/api/sales', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'returnInvoice', invoiceId: returnTarget.id, reason: returnReason || 'Return' }),
                    });
                    if (res.ok) {
                      notify('success', `${returnTarget.invoiceNumber} returned ✓`);
                      setReturnTarget(null);
                      await onRefresh();
                    } else notify('error', (await res.json()).error || 'Failed');
                  } finally {
                    setSubmitting(false);
                  }
                }}
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold"
              >
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   2. SIMPLIFIED & FAST PURCHASES MODULE (IQD-ONLY + UNIT CONVERSION)
   ============================================================================ */

interface PurchasesModuleProps {
  lang: LanguageCode;
  invoices: any[];
  products: any[];
  suppliers: any[];
  warehouses: any[];
  financialAccounts: any[];
  units: UnitDefinition[];
  autoOpenNew?: boolean;
  onClearAutoOpen?: () => void;
  onRefresh: () => Promise<void>;
  onPrint: (doc: PrintableDocument) => void;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function PurchasesModuleView({
  lang,
  invoices,
  products,
  suppliers,
  warehouses,
  financialAccounts,
  units,
  autoOpenNew,
  onClearAutoOpen,
  onRefresh,
  onPrint,
  notify,
}: PurchasesModuleProps) {
  const t = translations[lang];
  const [showBuilder, setShowBuilder] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState(() => makeIdempotencyKey('pur'));

  const [supplierId, setSupplierId] = useState<string>(suppliers[0]?.id || '');
  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.id || '');
  const [date, setDate] = useState(todayDateStr());
  const [paymentType, setPaymentType] = useState<'CASH' | 'CREDIT' | 'PARTIAL'>('CASH');
  const [financialAccountId, setFinancialAccountId] = useState<string>(financialAccounts[0]?.id || '');
  const [paidInputIqd, setPaidInputIqd] = useState('');
  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState('');
  const [shippingIqd, setShippingIqd] = useState('0');
  const [notes, setNotes] = useState('');

  const [lines, setLines] = useState<
    {
      productId: string;
      name: string;
      baseUnit: string;
      quantity: string;
      unit: string;
      unitCostIqd: string;
      basePurchaseCostIqd: number;
    }[]
  >([]);

  const [showQuickSupplier, setShowQuickSupplier] = useState(false);
  const [newSuppName, setNewSuppName] = useState('');
  const [newSuppPhone, setNewSuppPhone] = useState('');

  const openBuilder = () => {
    setIdemKey(makeIdempotencyKey('pur'));
    setSupplierId((prev) => prev || suppliers[0]?.id || '');
    setWarehouseId((prev) => prev || warehouses[0]?.id || '');
    setFinancialAccountId((prev) => prev || financialAccounts[0]?.id || '');
    setDate(todayDateStr());
    setPaymentType('CASH');
    setPaidInputIqd('');
    setShippingIqd('0');
    setSupplierInvoiceRef('');
    setNotes('');
    setLines([]);
    setShowAdvanced(false);
    setShowBuilder(true);
  };

  useEffect(() => {
    if (autoOpenNew) {
      openBuilder();
      onClearAutoOpen?.();
    }
  }, [autoOpenNew]);

  // Prioritize Raw Materials first in Purchase product dropdown!
  const buyableProducts = useMemo(() => {
    const order: Record<string, number> = { RAW_MATERIAL: 0, FINISHED_PRODUCT: 1, GENERAL: 2 };
    return [...products].sort((a, b) => (order[a.productType] ?? 1) - (order[b.productType] ?? 1));
  }, [products]);

  const addProductLine = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const existing = lines.findIndex((l) => l.productId === p.id && l.unit === p.unit);
    if (existing >= 0) {
      const c = [...lines];
      c[existing].quantity = String(Number(c[existing].quantity || 0) + 1);
      setLines(c);
    } else {
      setLines([
        ...lines,
        {
          productId: p.id,
          name: locName(p, lang),
          baseUnit: p.unit,
          quantity: '1',
          unit: p.unit,
          unitCostIqd: String(Number(p.purchaseCostIqd || 0)),
          basePurchaseCostIqd: Number(p.purchaseCostIqd || 0),
        },
      ]);
    }
  };

  const handleLineUnitChange = (idx: number, newUnit: string) => {
    const c = [...lines];
    const line = c[idx];
    line.unit = newUnit;
    try {
      const convCost = convertUnitPrice(line.basePurchaseCostIqd, line.baseUnit, newUnit, units);
      line.unitCostIqd = String(convCost);
    } catch {}
    setLines(c);
  };

  const totals = useMemo(() => {
    let subtotalIqd = 0;
    for (const l of lines) {
      subtotalIqd += Math.round(Number(l.quantity || 0) * Number(l.unitCostIqd || 0));
    }
    const ship = Math.round(Number(shippingIqd || 0));
    const grandTotalIqd = subtotalIqd + ship;
    const paidIqd =
      paymentType === 'CASH'
        ? grandTotalIqd
        : paymentType === 'CREDIT'
        ? 0
        : Math.round(Number(paidInputIqd || 0));
    const dueIqd = Math.max(0, grandTotalIqd - paidIqd);
    return { subtotalIqd, ship, grandTotalIqd, paidIqd, dueIqd };
  }, [lines, shippingIqd, paymentType, paidInputIqd]);

  const handleSavePurchase = async () => {
    const effectiveSupplierId = supplierId || suppliers[0]?.id;
    if (!effectiveSupplierId || lines.length === 0) {
      notify('error', t.purchases.selectProduct);
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
          warehouseId: warehouseId || warehouses[0]?.id,
          date,
          status: 'POSTED',
          paymentType,
          shippingIqd: totals.ship,
          paidIqd: totals.paidIqd,
          financialAccountId: financialAccountId || financialAccounts[0]?.id,
          notes,
          idempotencyKey: idemKey,
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: Number(l.quantity),
            unit: l.unit,
            unitCostIqd: Number(l.unitCostIqd),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Purchase failed');
      else {
        notify('success', `${data.invoice.invoiceNumber} — ${fmtIqd(data.invoice.totalIqd, lang)} ✓`);
        setShowBuilder(false);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const filteredInvoices = useMemo(
    () =>
      invoices.filter((inv) => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return (
          (inv.invoiceNumber || '').toLowerCase().includes(q) ||
          (inv.supplier?.name || '').toLowerCase().includes(q)
        );
      }),
    [invoices, searchQuery]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
            <PackageCheck className="w-6 h-6 text-emerald-500" />
            {t.purchases.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t.purchases.subtitle}</p>
        </div>

        <button
          onClick={() => (showBuilder ? setShowBuilder(false) : openBuilder())}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/25"
        >
          <Plus className="w-4 h-4" />
          {t.purchases.newPurchase}
        </button>
      </div>

      {showBuilder && (
        <div className="bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-emerald-500/40 shadow-lg space-y-5 max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold mb-1.5">1. {t.purchases.supplier} *</label>
              <SearchableSelect
                value={supplierId}
                onChange={setSupplierId}
                placeholder={t.purchases.selectSupplier}
                onQuickAdd={() => setShowQuickSupplier(true)}
                quickAddLabel={t.purchases.newSupplier}
                options={suppliers.map((s) => ({
                  value: s.id,
                  label: s.name,
                  sublabel: s.phone,
                  badge: Number(s.balanceIqd) > 0 ? fmtIqd(s.balanceIqd, lang) : undefined,
                  badgeColor: 'amber',
                }))}
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">2. {t.purchases.selectProduct}</label>
              <SearchableSelect
                value=""
                onChange={addProductLine}
                placeholder={t.purchases.selectProduct}
                options={buyableProducts.map((p) => ({
                  value: p.id,
                  label: locName(p, lang),
                  sublabel: fmtIqd(p.purchaseCostIqd, lang),
                  badge: `${fmtQty(p.totalStock)} ${unitLabel(p.unit, lang, units)}`,
                }))}
              />
            </div>
          </div>

          <div className="border border-slate-200 dark:border-charcoal-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-2.5 px-3 text-start">{t.products.productName}</th>
                  <th className="py-2.5 px-2 text-center w-24">{t.sales.qty}</th>
                  <th className="py-2.5 px-2 text-center w-28">{t.unit}</th>
                  <th className="py-2.5 px-2 text-end w-32">{t.purchases.unitCost}</th>
                  <th className="py-2.5 px-3 text-end">{t.sales.lineTotal}</th>
                  <th className="py-2.5 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-slate-400">{t.purchases.selectProduct}</td>
                  </tr>
                ) : (
                  lines.map((l, idx) => {
                    const lineTot = Math.round(Number(l.quantity || 0) * Number(l.unitCostIqd || 0));
                    let baseAdd = Number(l.quantity || 0);
                    try {
                      baseAdd = convertQuantity(baseAdd, l.unit, l.baseUnit, units);
                    } catch {}
                    return (
                      <tr key={`${l.productId}-${idx}`}>
                        <td className="py-2.5 px-3">
                          <div className="font-bold">{l.name}</div>
                          {l.unit !== l.baseUnit && (
                            <div className="text-[11px] text-teal-500 font-bold">
                              +{fmtQty(baseAdd)} {unitLabel(l.baseUnit, lang, units)}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2">
                          <input type="number" step="any" min="0.0001" value={l.quantity} onChange={(e) => { const c = [...lines]; c[idx].quantity = e.target.value; setLines(c); }} className="w-full px-2 py-2 text-center rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 font-bold" />
                        </td>
                        <td className="py-2.5 px-2">
                          <select value={l.unit} onChange={(e) => handleLineUnitChange(idx, e.target.value)} className="w-full px-2 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold">
                            {getCompatibleUnits(l.baseUnit, units).map((u) => <option key={u.code} value={u.code}>{locName(u, lang)}</option>)}
                          </select>
                        </td>
                        <td className="py-2.5 px-2">
                          <input type="number" step="any" min="0" value={l.unitCostIqd} onChange={(e) => { const c = [...lines]; c[idx].unitCostIqd = e.target.value; setLines(c); }} className="w-full px-2.5 py-2 text-end rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 font-bold" />
                        </td>
                        <td className="py-2.5 px-3 text-end font-black text-emerald-500">{fmtIqd(lineTot, lang)}</td>
                        <td className="py-2.5 px-2 text-center">
                          <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== idx))} className="text-rose-500 p-1"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 dark:bg-charcoal-950 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {(['CASH', 'CREDIT', 'PARTIAL'] as const).map((pt) => (
                  <button key={pt} type="button" onClick={() => setPaymentType(pt)} className={`py-2.5 rounded-xl text-xs font-bold border ${paymentType === pt ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800'}`}>
                    {pt === 'CASH' ? t.sales.cash : pt === 'CREDIT' ? t.sales.credit : t.sales.partial}
                  </button>
                ))}
              </div>
              {paymentType === 'PARTIAL' && (
                <input type="number" min="0" step="any" placeholder={`${t.paid} (IQD)`} value={paidInputIqd} onChange={(e) => setPaidInputIqd(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-sm font-black" />
              )}
              <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1 text-xs font-semibold text-slate-400">
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {t.advancedOptions}
              </button>
              {showAdvanced && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                    <input type="text" placeholder={t.purchases.supplierRef} value={supplierInvoiceRef} onChange={(e) => setSupplierInvoiceRef(e.target.value)} className="px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" min="0" placeholder={t.purchases.shipping} value={shippingIqd} onChange={(e) => setShippingIqd(e.target.value)} className="px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                    <select value={financialAccountId} onChange={(e) => setFinancialAccountId(e.target.value)} className="px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs">
                      {financialAccounts.map((fa) => <option key={fa.id} value={fa.id}>{locName(fa, lang)}</option>)}
                    </select>
                  </div>
                  <input type="text" placeholder={t.notes} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-charcoal-900 p-4 rounded-xl border border-slate-200 dark:border-charcoal-800 flex flex-col justify-between space-y-2">
              <div className="space-y-1">
                <div className="flex justify-between text-xl font-black">
                  <span>{t.total}:</span>
                  <span className="text-emerald-500">{fmtIqd(totals.grandTotalIqd, lang)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold text-emerald-500"><span>{t.paid}:</span><span>{fmtIqd(totals.paidIqd, lang)}</span></div>
                <div className="flex justify-between text-xs font-bold text-rose-500"><span>{t.due}:</span><span>{fmtIqd(totals.dueIqd, lang)}</span></div>
              </div>
              <button type="button" disabled={submitting} onClick={handleSavePurchase} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg shadow-emerald-600/25">
                {submitting ? t.saving : t.purchases.savePurchase}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PURCHASES LIST */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center gap-3">
          <div className="relative w-72">
            <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t.searchPlaceholder} className="w-full ps-9 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
          </div>
          <button
            onClick={() =>
              exportToCsv(
                'purchases-iqd',
                ['Invoice #', 'Date', 'Supplier', 'Status', 'Total IQD', 'Paid IQD', 'Due IQD'],
                filteredInvoices.map((i) => [i.invoiceNumber, new Date(i.date).toISOString().slice(0, 10), i.supplier?.name || '', i.status, i.totalIqd, i.paidIqd, i.dueIqd])
              )
            }
            className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
              <tr>
                <th className="py-3 px-4 text-start">#</th>
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
                <tr key={inv.id}>
                  <td className="py-3 px-4 font-mono text-xs font-bold text-teal-500">{inv.invoiceNumber}</td>
                  <td className="py-3 px-4 text-xs text-slate-500">{new Date(inv.date).toLocaleDateString()}</td>
                  <td className="py-3 px-4 font-bold">{inv.supplier?.name}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${inv.status === 'PAID' ? 'bg-emerald-500/15 text-emerald-500' : inv.status === 'RETURNED' ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'}`}>
                      {(t.statuses as Record<string, string>)[inv.status] || inv.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-end font-black">{fmtIqd(inv.totalIqd, lang)}</td>
                  <td className="py-3 px-4 text-end text-emerald-500 font-bold">{fmtIqd(inv.paidIqd, lang)}</td>
                  <td className="py-3 px-4 text-end text-rose-500 font-bold">{fmtIqd(inv.dueIqd, lang)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => onPrint({ type: 'PURCHASE_INVOICE', mode: 'A4', data: inv })} className="p-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:text-emerald-500">
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                      {['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status) && (
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Return ${inv.invoiceNumber}?`)) return;
                            const res = await fetch('/api/purchases', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'returnInvoice', invoiceId: inv.id, reason: 'Supplier return' }),
                            });
                            if (res.ok) {
                              notify('success', `${inv.invoiceNumber} returned ✓`);
                              await onRefresh();
                            } else notify('error', (await res.json()).error || 'Failed');
                          }}
                          className="p-2 rounded-xl bg-rose-500/10 text-rose-500"
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

      {/* Quick Create Supplier */}
      {showQuickSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newSuppName.trim()) return;
              setSubmitting(true);
              try {
                const res = await fetch('/api/parties', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'createSupplier', name: newSuppName.trim(), phone: newSuppPhone.trim() }),
                });
                const data = await res.json();
                if (res.ok && data.supplier) {
                  await onRefresh();
                  setSupplierId(data.supplier.id);
                  setShowQuickSupplier(false);
                  setNewSuppName('');
                  setNewSuppPhone('');
                  notify('success', `${data.supplier.name} ✓`);
                }
              } finally {
                setSubmitting(false);
              }
            }}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-sm w-full space-y-4"
          >
            <h3 className="text-base font-black">{t.parties.addSupplier}</h3>
            <input type="text" required placeholder={t.employees.name} value={newSuppName} onChange={(e) => setNewSuppName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            <input type="text" placeholder={t.employees.phone} value={newSuppPhone} onChange={(e) => setNewSuppPhone(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-mono" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowQuickSupplier(false)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">{t.save}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
