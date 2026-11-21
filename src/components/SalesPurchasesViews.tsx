'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Minus,
  Search,
  Printer,
  RotateCcw,
  CheckCircle2,
  Trash2,
  ShoppingCart,
  Download,
  Receipt,
  PackageCheck,
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
   1. ULTRA-SIMPLE & FAST SALES MODULE (IQD-ONLY + SMART UNIT CONVERSION)
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
  const [viewMode, setViewMode] = useState<'LIST' | 'NEW'>('LIST');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState(() => makeIdempotencyKey('sale'));

  // Default to Walk-In Cash Customer if available, otherwise first customer
  const defaultCustomerId = useMemo(() => {
    const walkIn = customers.find(
      (c) =>
        (c.name || '').toLowerCase().includes('walk-in') ||
        (c.name || '').includes('نەقد') ||
        (c.code || '') === 'CUST-0004'
    );
    return walkIn?.id || customers[0]?.id || '';
  }, [customers]);

  const [customerId, setCustomerId] = useState<string>(defaultCustomerId);
  const [paymentType, setPaymentType] = useState<'CASH' | 'CREDIT' | 'PARTIAL'>('CASH');
  const [invoiceDiscountIqd, setInvoiceDiscountIqd] = useState('');
  const [paidInputIqd, setPaidInputIqd] = useState('');
  const [notes, setNotes] = useState('');
  const [productFilter, setProductFilter] = useState('');

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

  // Quick-create new product right inside Sales
  const [showQuickProduct, setShowQuickProduct] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdUnit, setNewProdUnit] = useState('kg');
  const [newProdPriceIqd, setNewProdPriceIqd] = useState('');
  const [newProdCostIqd, setNewProdCostIqd] = useState('');

  // Return modal
  const [returnTarget, setReturnTarget] = useState<any | null>(null);
  const [returnReason, setReturnReason] = useState('');

  const startNewSale = () => {
    setIdemKey(makeIdempotencyKey('sale'));
    setCustomerId(defaultCustomerId || customers[0]?.id || '');
    setPaymentType('CASH');
    setInvoiceDiscountIqd('');
    setPaidInputIqd('');
    setNotes('');
    setProductFilter('');
    setLines([]);
    setViewMode('NEW');
  };

  useEffect(() => {
    if (autoOpenNew) {
      startNewSale();
      onClearAutoOpen?.();
    }
  }, [autoOpenNew]);

  const sellableProducts = useMemo(() => {
    // Food finished products first, then newly created items, then raw materials
    const score = (p: any) => {
      const sku = String(p.sku || '');
      if (sku.startsWith('FOOD-')) return 0;
      if (p.productType === 'FINISHED_PRODUCT' && !sku.startsWith('SKU-10')) return 1;
      if (p.productType === 'RAW_MATERIAL' || sku.startsWith('RAW-')) return 3;
      return 2;
    };
    return [...products].sort((a, b) => score(a) - score(b));
  }, [products]);

  const quickProducts = useMemo(() => {
    const q = productFilter.trim().toLowerCase();
    const list = sellableProducts.filter((p) => p.productType !== 'RAW_MATERIAL' || q.length > 0);
    if (!q) return list;
    return list.filter(
      (p) =>
        (p.nameKu || '').toLowerCase().includes(q) ||
        (p.nameAr || '').toLowerCase().includes(q) ||
        (p.nameEn || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q)
    );
  }, [sellableProducts, productFilter]);

  const addProductToSale = (productId: string) => {
    if (!productId) return;
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const existingIdx = lines.findIndex((l) => l.productId === p.id);
    if (existingIdx >= 0) {
      const copy = [...lines];
      const currentUnit = copy[existingIdx].unit;
      const step = currentUnit === 'g' ? 500 : 1;
      copy[existingIdx].quantity = String(Number(copy[existingIdx].quantity || 0) + step);
      setLines(copy);
    } else {
      setLines([
        ...lines,
        {
          productId: p.id,
          name: locName(p, lang),
          baseUnit: p.unit,
          availableStock: Number(p.totalStock || 0),
          quantity: p.unit === 'g' ? '500' : '1',
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
    const oldUnit = line.unit;
    const currentQty = Number(line.quantity || 0);

    // Smart quantity conversion when switching between kg and g so 1 kg becomes 1000 g (not 1 g = 18 IQD!)
    if (oldUnit !== newUnit && currentQty > 0) {
      try {
        const convertedQty = convertQuantity(currentQty, oldUnit, newUnit, units);
        if (convertedQty > 0) {
          line.quantity = String(convertedQty);
        }
      } catch {}
    }

    line.unit = newUnit;
    try {
      const convertedPrice = convertUnitPrice(line.baseSellingPriceIqd, line.baseUnit, newUnit, units);
      line.unitPriceIqd = String(convertedPrice);
    } catch {}
    setLines(copy);
  };

  const adjustLineQty = (idx: number, delta: number) => {
    const copy = [...lines];
    const line = copy[idx];
    const step = line.unit === 'g' ? 250 : 1;
    const nextQty = Math.max(step, Math.round((Number(line.quantity || 0) + delta * step) * 1000) / 1000);
    line.quantity = String(nextQty);
    setLines(copy);
  };

  const totals = useMemo(() => {
    let subtotalIqd = 0;
    for (const l of lines) {
      subtotalIqd += Math.round(Number(l.quantity || 0) * Number(l.unitPriceIqd || 0));
    }
    const discountIqd = Math.min(subtotalIqd, Math.max(0, Math.round(Number(invoiceDiscountIqd || 0))));
    const grandTotalIqd = Math.max(0, subtotalIqd - discountIqd);
    const paidIqd =
      paymentType === 'CASH'
        ? grandTotalIqd
        : paymentType === 'CREDIT'
        ? 0
        : Math.min(grandTotalIqd, Math.max(0, Math.round(Number(paidInputIqd || 0))));
    const dueIqd = Math.max(0, grandTotalIqd - paidIqd);
    return { subtotalIqd, discountIqd, grandTotalIqd, paidIqd, dueIqd };
  }, [lines, invoiceDiscountIqd, paymentType, paidInputIqd]);

  const handleSaveSale = async () => {
    const effectiveCustomerId = customerId || defaultCustomerId || customers[0]?.id;
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
          warehouseId: warehouses[0]?.id,
          date: todayDateStr(),
          status: 'POSTED',
          paymentType,
          invoiceDiscountIqd: totals.discountIqd,
          paidIqd: totals.paidIqd,
          financialAccountId: financialAccounts[0]?.id,
          notes,
          allowNegativeStock: true,
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

  const handleQuickCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName.trim()) return;
    setSubmitting(true);
    try {
      const sellingPrice = Math.max(0, Number(newProdPriceIqd || 0));
      const purchaseCost = Math.max(0, Number(newProdCostIqd || Math.round(sellingPrice * 0.7)));
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createProduct',
          nameKu: newProdName.trim(),
          nameAr: newProdName.trim(),
          nameEn: newProdName.trim(),
          productType: 'FINISHED_PRODUCT',
          unit: newProdUnit,
          sellingPriceIqd: sellingPrice,
          purchaseCostIqd: purchaseCost,
          initialStock: 50,
          initialStockUnit: newProdUnit,
          minStockLevel: 5,
        }),
      });
      const data = await res.json();
      if (res.ok && data.product) {
        const p = data.product;
        await onRefresh();
        setLines((prev) => [
          ...prev,
          {
            productId: p.id,
            name: locName(p, lang),
            baseUnit: p.unit,
            availableStock: Number(p.totalStock || 50),
            quantity: p.unit === 'g' ? '500' : '1',
            unit: p.unit,
            unitPriceIqd: String(Number(p.sellingPriceIqd || sellingPrice)),
            baseSellingPriceIqd: Number(p.sellingPriceIqd || sellingPrice),
            baseCostIqd: Number(p.purchaseCostIqd || purchaseCost),
          },
        ]);
        setShowQuickProduct(false);
        setNewProdName('');
        setNewProdPriceIqd('');
        setNewProdCostIqd('');
        notify('success', `${locName(p, lang)} ✓`);
      } else {
        notify('error', data.error || 'Error creating product');
      }
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

  return (
    <div className="space-y-6">
      {/* Header — Clean 2 buttons only (Invoices List + New Sale) */}
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
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition ${
              viewMode === 'LIST'
                ? 'bg-charcoal-900 dark:bg-slate-700 text-white'
                : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.sales.invoicesList} ({invoices.length})
          </button>
          <button
            onClick={() => startNewSale()}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/25 transition"
          >
            <Plus className="w-4 h-4" />
            {t.sales.newSale}
          </button>
        </div>
      </div>

      {/* ULTRA-SIMPLE NEW SALE SCREEN */}
      {viewMode === 'NEW' && (
        <div className="max-w-4xl mx-auto w-full bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-6">
          {/* Step 1: 1-Click Quick Product Selection */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-500 text-xs flex items-center justify-center font-black">
                  1
                </span>
                {lang === 'ku'
                  ? 'کرتە لە بەرهەم بکە بۆ زیادکردن:'
                  : lang === 'ar'
                  ? 'اضغط على المنتج لإضافته:'
                  : 'Click a product to add:'}
              </label>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-60">
                  <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
                  <input
                    type="text"
                    value={productFilter}
                    onChange={(e) => setProductFilter(e.target.value)}
                    placeholder={t.sales.selectProduct}
                    className="w-full ps-9 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowQuickProduct(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600/15 text-emerald-500 hover:bg-emerald-600 hover:text-white border border-emerald-500/30 text-xs font-black transition whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  {t.products.addProduct}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto p-1">
              {quickProducts.map((p) => {
                const inCart = lines.find((l) => l.productId === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProductToSale(p.id)}
                    className={`text-start p-3 rounded-xl border transition flex flex-col justify-between ${
                      inCart
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/60 bg-slate-50 dark:bg-charcoal-950'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-bold text-sm text-slate-900 dark:text-white leading-snug">
                        {locName(p, lang)}
                      </span>
                      {inCart && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[11px] font-black">
                          {inCart.quantity}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-200/60 dark:border-charcoal-800/60 text-xs">
                      <span className="font-black text-emerald-500">{fmtIqd(p.sellingPriceIqd, lang)}</span>
                      <span className="text-[11px] text-slate-400">
                        {unitLabel(p.unit, lang, units)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Selected Products List (Simple +/- Quantity, Smart Unit, Price) */}
          <div className="space-y-2.5">
            <label className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-500 text-xs flex items-center justify-center font-black">
                2
              </span>
              {lang === 'ku'
                ? 'بەرهەمە هەڵبژێردراوەکان (بڕ و یەکە دیاری بکە):'
                : lang === 'ar'
                ? 'المنتجات المختارة (حدد الكمية والوحدة):'
                : 'Selected Items (Set Quantity & Unit):'}
            </label>

            <div className="border border-slate-200 dark:border-charcoal-800 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                  <tr>
                    <th className="py-3 px-4 text-start">{t.products.productName}</th>
                    <th className="py-3 px-3 text-center w-44">{t.sales.qty}</th>
                    <th className="py-3 px-2 text-center w-32">{t.unit}</th>
                    <th className="py-3 px-2 text-end w-36">{t.sales.unitPrice}</th>
                    <th className="py-3 px-4 text-end w-36">{t.sales.lineTotal}</th>
                    <th className="py-3 px-2 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400 text-sm">
                        {lang === 'ku'
                          ? 'هیچ بەرهەمێک هەڵنەبژێردراوە — کرتە لە بەرهەمەکانی سەرەوە بکە'
                          : lang === 'ar'
                          ? 'لم يتم اختيار أي منتج — اضغط على المنتجات أعلاه'
                          : 'No products added yet — click any product above'}
                      </td>
                    </tr>
                  ) : (
                    lines.map((line, idx) => {
                      const qtyNum = Number(line.quantity || 0);
                      const priceNum = Number(line.unitPriceIqd || 0);
                      const lineNet = Math.round(qtyNum * priceNum);

                      return (
                        <tr key={`${line.productId}-${idx}`} className="bg-white dark:bg-charcoal-900">
                          <td className="py-3 px-4">
                            <div className="font-black text-base text-slate-900 dark:text-white">
                              {line.name}
                            </div>
                            <div className="text-xs text-slate-400">
                              {fmtIqd(line.baseSellingPriceIqd, lang)} / {unitLabel(line.baseUnit, lang, units)}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => adjustLineQty(idx, -1)}
                                className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-slate-200 dark:hover:bg-charcoal-700 flex items-center justify-center font-black"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <input
                                type="number"
                                step="any"
                                min="0.001"
                                value={line.quantity}
                                onChange={(e) => {
                                  const c = [...lines];
                                  c[idx].quantity = e.target.value;
                                  setLines(c);
                                }}
                                className="w-20 px-2 py-2 text-center rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 font-black text-base"
                              />
                              <button
                                type="button"
                                onClick={() => adjustLineQty(idx, 1)}
                                className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 flex items-center justify-center font-black"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <select
                              value={line.unit}
                              onChange={(e) => handleLineUnitChange(idx, e.target.value)}
                              className="w-full px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                            >
                              {getCompatibleUnits(line.baseUnit, units).map((u) => (
                                <option key={u.code} value={u.code}>
                                  {locName(u, lang)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-3 px-2">
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
                              className="w-full px-3 py-2 text-end rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 font-bold"
                            />
                          </td>
                          <td className="py-3 px-4 text-end font-black text-base text-emerald-600 dark:text-emerald-400">
                            {fmtIqd(lineNet, lang)}
                          </td>
                          <td className="py-3 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                              className="p-2 rounded-xl text-rose-500 hover:bg-rose-500/10"
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
          </div>

          {/* Step 3: Customer, Discount, Payment Method & Big Save Button */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 bg-slate-50 dark:bg-charcoal-950 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 items-center">
            <div className="md:col-span-7 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-7">
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                    {t.sales.customer}
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

                <div className="sm:col-span-5">
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                    {t.sales.discount}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={invoiceDiscountIqd}
                    onChange={(e) => setInvoiceDiscountIqd(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-sm font-black text-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
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
              </div>

              {paymentType === 'PARTIAL' && (
                <div>
                  <label className="block text-xs font-bold mb-1">{t.paid} (د.ع)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={paidInputIqd}
                    onChange={(e) => setPaidInputIqd(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-sm font-black text-emerald-500"
                  />
                </div>
              )}
            </div>

            <div className="md:col-span-5 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                {totals.discountIqd > 0 && (
                  <div className="flex justify-between items-center text-xs font-bold text-amber-500">
                    <span>{t.sales.discount}:</span>
                    <span>-{fmtIqd(totals.discountIqd, lang)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-slate-500">{t.total}:</span>
                  <span className="text-2xl font-black text-emerald-500">
                    {fmtIqd(totals.grandTotalIqd, lang)}
                  </span>
                </div>

                {paymentType !== 'CASH' && (
                  <div className="pt-2 border-t border-slate-200 dark:border-charcoal-800 space-y-1 text-xs font-bold">
                    <div className="flex justify-between text-emerald-500">
                      <span>{t.paid}:</span>
                      <span>{fmtIqd(totals.paidIqd, lang)}</span>
                    </div>
                    <div className="flex justify-between text-rose-500">
                      <span>{t.due}:</span>
                      <span>{fmtIqd(totals.dueIqd, lang)}</span>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={submitting || lines.length === 0}
                onClick={handleSaveSale}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-black shadow-lg shadow-emerald-600/25 transition"
              >
                <CheckCircle2 className="w-5 h-5" />
                {submitting ? t.saving : t.sales.saveInvoice}
              </button>
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
              {['ALL', 'PAID', 'PARTIALLY_PAID', 'POSTED', 'RETURNED'].map((st) => (
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

      {/* Quick Create Product inside Sales */}
      {showQuickProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleQuickCreateProduct} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-black">{t.products.addProduct}</h3>
            <div>
              <label className="block text-xs font-bold mb-1">{t.products.productName} *</label>
              <input
                type="text"
                required
                placeholder={t.products.productName}
                value={newProdName}
                onChange={(e) => setNewProdName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.unit}</label>
                <select
                  value={newProdUnit}
                  onChange={(e) => setNewProdUnit(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                >
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {locName(u, lang)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.products.sellingPrice} *</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="any"
                  placeholder="0"
                  value={newProdPriceIqd}
                  onChange={(e) => setNewProdPriceIqd(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-black text-emerald-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowQuickProduct(false)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-bold">{t.cancel}</button>
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
   2. ULTRA-SIMPLE & FAST PURCHASES MODULE (IQD-ONLY + SMART UNIT CONVERSION)
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
  const [searchQuery, setSearchQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState(() => makeIdempotencyKey('pur'));

  const [supplierId, setSupplierId] = useState<string>(suppliers[0]?.id || '');
  const [paymentType, setPaymentType] = useState<'CASH' | 'CREDIT' | 'PARTIAL'>('CASH');
  const [paidInputIqd, setPaidInputIqd] = useState('');
  const [productFilter, setProductFilter] = useState('');

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

  // Quick-create new item/raw material right inside Purchases
  const [showQuickItem, setShowQuickItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('kg');
  const [newItemCostIqd, setNewItemCostIqd] = useState('');

  const openBuilder = () => {
    setIdemKey(makeIdempotencyKey('pur'));
    setSupplierId((prev) => prev || suppliers[0]?.id || '');
    setPaymentType('CASH');
    setPaidInputIqd('');
    setProductFilter('');
    setLines([]);
    setShowBuilder(true);
  };

  useEffect(() => {
    if (autoOpenNew) {
      openBuilder();
      onClearAutoOpen?.();
    }
  }, [autoOpenNew]);

  // Prioritize Raw Materials & Food items first in Purchases
  const buyableProducts = useMemo(() => {
    const score = (p: any) => {
      const sku = String(p.sku || '');
      if (sku.startsWith('RAW-') || p.productType === 'RAW_MATERIAL') return 0;
      if (sku.startsWith('FOOD-')) return 1;
      if (!sku.startsWith('SKU-10')) return 2;
      return 3;
    };
    const sorted = [...products].sort((a, b) => score(a) - score(b));
    const q = productFilter.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (p) =>
        (p.nameKu || '').toLowerCase().includes(q) ||
        (p.nameAr || '').toLowerCase().includes(q) ||
        (p.nameEn || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q)
    );
  }, [products, productFilter]);

  const addProductLine = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const existing = lines.findIndex((l) => l.productId === p.id);
    if (existing >= 0) {
      const c = [...lines];
      const step = c[existing].unit === 'g' ? 500 : 1;
      c[existing].quantity = String(Number(c[existing].quantity || 0) + step);
      setLines(c);
    } else {
      setLines([
        ...lines,
        {
          productId: p.id,
          name: locName(p, lang),
          baseUnit: p.unit,
          quantity: p.unit === 'g' ? '1000' : '1',
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
    const oldUnit = line.unit;
    const currentQty = Number(line.quantity || 0);

    if (oldUnit !== newUnit && currentQty > 0) {
      try {
        const convertedQty = convertQuantity(currentQty, oldUnit, newUnit, units);
        if (convertedQty > 0) {
          line.quantity = String(convertedQty);
        }
      } catch {}
    }

    line.unit = newUnit;
    try {
      const convCost = convertUnitPrice(line.basePurchaseCostIqd, line.baseUnit, newUnit, units);
      line.unitCostIqd = String(convCost);
    } catch {}
    setLines(c);
  };

  const adjustLineQty = (idx: number, delta: number) => {
    const c = [...lines];
    const line = c[idx];
    const step = line.unit === 'g' ? 500 : 1;
    const nextQty = Math.max(step, Math.round((Number(line.quantity || 0) + delta * step) * 1000) / 1000);
    line.quantity = String(nextQty);
    setLines(c);
  };

  const totals = useMemo(() => {
    let grandTotalIqd = 0;
    for (const l of lines) {
      grandTotalIqd += Math.round(Number(l.quantity || 0) * Number(l.unitCostIqd || 0));
    }
    const paidIqd =
      paymentType === 'CASH'
        ? grandTotalIqd
        : paymentType === 'CREDIT'
        ? 0
        : Math.min(grandTotalIqd, Math.max(0, Math.round(Number(paidInputIqd || 0))));
    const dueIqd = Math.max(0, grandTotalIqd - paidIqd);
    return { grandTotalIqd, paidIqd, dueIqd };
  }, [lines, paymentType, paidInputIqd]);

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
          warehouseId: warehouses[0]?.id,
          date: todayDateStr(),
          status: 'POSTED',
          paymentType,
          shippingIqd: 0,
          paidIqd: totals.paidIqd,
          financialAccountId: financialAccounts[0]?.id,
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

        <div className="flex items-center gap-2">
          {showBuilder && (
            <button
              onClick={() => setShowBuilder(false)}
              className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-bold"
            >
              {t.sales.invoicesList} ({invoices.length})
            </button>
          )}
          <button
            onClick={() => openBuilder()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/25"
          >
            <Plus className="w-4 h-4" />
            {t.purchases.newPurchase}
          </button>
        </div>
      </div>

      {showBuilder && (
        <div className="bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-6 max-w-4xl mx-auto">
          {/* Step 1: 1-Click Raw Material / Product Buttons */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-500 text-xs flex items-center justify-center font-black">
                  1
                </span>
                {lang === 'ku'
                  ? 'کرتە لە کەرەستە بکە بۆ کڕین:'
                  : lang === 'ar'
                  ? 'اضغط على المادة لشرائها:'
                  : 'Click an item to purchase:'}
              </label>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-60">
                  <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
                  <input
                    type="text"
                    value={productFilter}
                    onChange={(e) => setProductFilter(e.target.value)}
                    placeholder={t.purchases.selectProduct}
                    className="w-full ps-9 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowQuickItem(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600/15 text-emerald-500 hover:bg-emerald-600 hover:text-white border border-emerald-500/30 text-xs font-black transition whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  {t.products.addProduct}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto p-1">
              {buyableProducts.map((p) => {
                const inCart = lines.find((l) => l.productId === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProductLine(p.id)}
                    className={`text-start p-3 rounded-xl border transition flex flex-col justify-between ${
                      inCart
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/60 bg-slate-50 dark:bg-charcoal-950'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-bold text-sm text-slate-900 dark:text-white leading-snug">
                        {locName(p, lang)}
                      </span>
                      {inCart && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[11px] font-black">
                          {inCart.quantity}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-200/60 dark:border-charcoal-800/60 text-xs">
                      <span className="font-black text-emerald-500">{fmtIqd(p.purchaseCostIqd, lang)}</span>
                      <span className="text-[11px] text-slate-400">{unitLabel(p.unit, lang, units)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Selected Items Table */}
          <div className="border border-slate-200 dark:border-charcoal-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">{t.products.productName}</th>
                  <th className="py-3 px-3 text-center w-44">{t.sales.qty}</th>
                  <th className="py-3 px-2 text-center w-32">{t.unit}</th>
                  <th className="py-3 px-2 text-end w-36">{t.purchases.unitCost}</th>
                  <th className="py-3 px-4 text-end w-36">{t.sales.lineTotal}</th>
                  <th className="py-3 px-2 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-slate-400">
                      {t.purchases.selectProduct}
                    </td>
                  </tr>
                ) : (
                  lines.map((l, idx) => {
                    const lineTot = Math.round(Number(l.quantity || 0) * Number(l.unitCostIqd || 0));
                    return (
                      <tr key={`${l.productId}-${idx}`}>
                        <td className="py-3 px-4 font-black text-base">{l.name}</td>
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => adjustLineQty(idx, -1)}
                              className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-charcoal-800 flex items-center justify-center font-black"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              step="any"
                              min="0.001"
                              value={l.quantity}
                              onChange={(e) => {
                                const c = [...lines];
                                c[idx].quantity = e.target.value;
                                setLines(c);
                              }}
                              className="w-20 px-2 py-2 text-center rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 font-black text-base"
                            />
                            <button
                              type="button"
                              onClick={() => adjustLineQty(idx, 1)}
                              className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center font-black"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          <select
                            value={l.unit}
                            onChange={(e) => handleLineUnitChange(idx, e.target.value)}
                            className="w-full px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                          >
                            {getCompatibleUnits(l.baseUnit, units).map((u) => (
                              <option key={u.code} value={u.code}>
                                {locName(u, lang)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-2">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={l.unitCostIqd}
                            onChange={(e) => {
                              const c = [...lines];
                              c[idx].unitCostIqd = e.target.value;
                              setLines(c);
                            }}
                            className="w-full px-3 py-2 text-end rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 font-bold"
                          />
                        </td>
                        <td className="py-3 px-4 text-end font-black text-base text-emerald-500">
                          {fmtIqd(lineTot, lang)}
                        </td>
                        <td className="py-3 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                            className="text-rose-500 p-2 rounded-xl hover:bg-rose-500/10"
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

          {/* Step 3: Supplier, Payment Type & Big Save Button */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 bg-slate-50 dark:bg-charcoal-950 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 items-center">
            <div className="md:col-span-7 space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1.5">{t.purchases.supplier}</label>
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

              <div className="grid grid-cols-3 gap-2">
                {(['CASH', 'CREDIT', 'PARTIAL'] as const).map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => setPaymentType(pt)}
                    className={`py-2.5 rounded-xl text-xs font-bold border ${
                      paymentType === pt
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800'
                    }`}
                  >
                    {pt === 'CASH' ? t.sales.cash : pt === 'CREDIT' ? t.sales.credit : t.sales.partial}
                  </button>
                ))}
              </div>
              {paymentType === 'PARTIAL' && (
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder={`${t.paid} (د.ع)`}
                  value={paidInputIqd}
                  onChange={(e) => setPaidInputIqd(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-sm font-black"
                />
              )}
            </div>

            <div className="md:col-span-5 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-slate-500">{t.total}:</span>
                  <span className="text-2xl font-black text-emerald-500">
                    {fmtIqd(totals.grandTotalIqd, lang)}
                  </span>
                </div>
                {paymentType !== 'CASH' && (
                  <div className="pt-2 border-t border-slate-200 dark:border-charcoal-800 space-y-1 text-xs font-bold">
                    <div className="flex justify-between text-emerald-500">
                      <span>{t.paid}:</span>
                      <span>{fmtIqd(totals.paidIqd, lang)}</span>
                    </div>
                    <div className="flex justify-between text-rose-500">
                      <span>{t.due}:</span>
                      <span>{fmtIqd(totals.dueIqd, lang)}</span>
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={submitting || lines.length === 0}
                onClick={handleSavePurchase}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-black shadow-lg shadow-emerald-600/25"
              >
                <CheckCircle2 className="w-5 h-5" />
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

      {/* Quick Create Raw Material / Product inside Purchases */}
      {showQuickItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newItemName.trim()) return;
              setSubmitting(true);
              try {
                const cost = Math.max(0, Number(newItemCostIqd || 0));
                const res = await fetch('/api/inventory', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'createProduct',
                    nameKu: newItemName.trim(),
                    nameAr: newItemName.trim(),
                    nameEn: newItemName.trim(),
                    productType: 'RAW_MATERIAL',
                    unit: newItemUnit,
                    purchaseCostIqd: cost,
                    sellingPriceIqd: Math.round(cost * 1.25),
                    initialStock: 0,
                    initialStockUnit: newItemUnit,
                    minStockLevel: 5,
                  }),
                });
                const data = await res.json();
                if (res.ok && data.product) {
                  const p = data.product;
                  await onRefresh();
                  setLines((prev) => [
                    ...prev,
                    {
                      productId: p.id,
                      name: locName(p, lang),
                      baseUnit: p.unit,
                      quantity: p.unit === 'g' ? '1000' : '1',
                      unit: p.unit,
                      unitCostIqd: String(Number(p.purchaseCostIqd || cost)),
                      basePurchaseCostIqd: Number(p.purchaseCostIqd || cost),
                    },
                  ]);
                  setShowQuickItem(false);
                  setNewItemName('');
                  setNewItemCostIqd('');
                  notify('success', `${locName(p, lang)} ✓`);
                } else {
                  notify('error', data.error || 'Error creating item');
                }
              } finally {
                setSubmitting(false);
              }
            }}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-sm w-full space-y-4"
          >
            <h3 className="text-base font-black">{t.products.addProduct}</h3>
            <div>
              <label className="block text-xs font-bold mb-1">{t.products.productName} *</label>
              <input
                type="text"
                required
                placeholder={t.products.productName}
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.unit}</label>
                <select
                  value={newItemUnit}
                  onChange={(e) => setNewItemUnit(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                >
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {locName(u, lang)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.purchases.unitCost} *</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="any"
                  placeholder="0"
                  value={newItemCostIqd}
                  onChange={(e) => setNewItemCostIqd(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-black text-emerald-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowQuickItem(false)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-bold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">{t.save}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
