'use client';

import React, { useState } from 'react';
import {
  Boxes,
  Plus,
  ArrowLeftRight,
  SlidersHorizontal,
  Warehouse,
  Download,
  Search,
  AlertTriangle,
  Users,
  Building2,
  Wallet,
  FileSpreadsheet,
  Printer,
  CheckCircle2,
  FolderPlus,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import { exportToCsv, fmtMoney, locName } from '@/lib/client-utils';

interface InventoryProps {
  lang: LanguageCode;
  displayCurrency: 'USD' | 'IQD';
  exchangeRate: number;
  inventoryData: any;
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function InventoryModuleView({
  lang,
  displayCurrency,
  exchangeRate,
  inventoryData,
  onRefresh,
  notify,
}: InventoryProps) {
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<'PRODUCTS' | 'MOVEMENTS' | 'TRANSFERS'>(
    'PRODUCTS'
  );
  const [search, setSearch] = useState('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [modalMode, setModalMode] = useState<
    null | 'NEW_PRODUCT' | 'ADJUST' | 'TRANSFER' | 'NEW_WAREHOUSE' | 'NEW_CATEGORY'
  >(null);
  const [submitting, setSubmitting] = useState(false);

  const valuation = inventoryData?.valuation || {
    items: [],
    totalCostValueUsd: 0,
    totalRetailValueUsd: 0,
    totalPotentialProfitUsd: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
  };
  const categories = inventoryData?.categories || [];
  const warehouses = inventoryData?.warehouses || [];
  const movements = inventoryData?.movements || [];
  const transfers = inventoryData?.transfers || [];

  // New Product Form State
  const [pSku, setPSku] = useState('');
  const [pBarcode, setPBarcode] = useState('');
  const [pNameEn, setPNameEn] = useState('');
  const [pNameAr, setPNameAr] = useState('');
  const [pNameKu, setPNameKu] = useState('');
  const [pCategoryId, setPCategoryId] = useState(categories[0]?.id || '');
  const [pUnit, setPUnit] = useState('PCS');
  const [pCostUsd, setPCostUsd] = useState('');
  const [pPriceUsd, setPPriceUsd] = useState('');
  const [pMinStock, setPMinStock] = useState('5');
  const [pInitialStock, setPInitialStock] = useState('0');

  // Stock Adjustment State
  const [adjProductId, setAdjProductId] = useState(valuation.items[0]?.productId || '');
  const [adjWarehouseId, setAdjWarehouseId] = useState(warehouses[0]?.id || '');
  const [adjDelta, setAdjDelta] = useState('1');
  const [adjReason, setAdjReason] = useState('Physical inventory count adjustment');

  // Stock Transfer State
  const [trfProductId, setTrfProductId] = useState(valuation.items[0]?.productId || '');
  const [trfFromWh, setTrfFromWh] = useState(warehouses[0]?.id || '');
  const [trfToWh, setTrfToWh] = useState(warehouses[1]?.id || warehouses[0]?.id || '');
  const [trfQty, setTrfQty] = useState('1');
  const [trfNotes, setTrfNotes] = useState('');

  // New Warehouse / Category State
  const [whNameEn, setWhNameEn] = useState('');
  const [whNameAr, setWhNameAr] = useState('');
  const [whLocation, setWhLocation] = useState('');
  const [catNameEn, setCatNameEn] = useState('');
  const [catNameAr, setCatNameAr] = useState('');

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createProduct',
          sku: pSku,
          barcode: pBarcode || null,
          nameEn: pNameEn,
          nameAr: pNameAr || pNameEn,
          nameKu: pNameKu || pNameAr || pNameEn,
          categoryId: pCategoryId || categories[0]?.id,
          unit: pUnit,
          purchaseCostUsd: Number(pCostUsd),
          sellingPriceUsd: Number(pPriceUsd),
          minStockLevel: Number(pMinStock || 5),
          initialStock: Number(pInitialStock || 0),
          warehouseId: warehouses[0]?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to create product');
      } else {
        notify('success', `Product '${data.product.nameEn}' created!`);
        setModalMode(null);
        setPSku('');
        setPNameEn('');
        setPNameAr('');
        setPNameKu('');
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjustStock',
          productId: adjProductId,
          warehouseId: adjWarehouseId,
          quantityDelta: Number(adjDelta),
          reason: adjReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Stock adjustment failed');
      } else {
        notify(
          'success',
          'Stock adjusted and Double-Entry Inventory Shrinkage/Surplus Journal Entry posted!'
        );
        setModalMode(null);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransferStock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transferStock',
          productId: trfProductId,
          fromWarehouseId: trfFromWh,
          toWarehouseId: trfToWh,
          quantity: Number(trfQty),
          notes: trfNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Warehouse transfer failed');
      } else {
        notify('success', `Stock Transfer ${data.transfer.transferNumber} completed!`);
        setModalMode(null);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createWarehouse',
          nameEn: whNameEn,
          nameAr: whNameAr || whNameEn,
          nameKu: whNameAr || whNameEn,
          location: whLocation,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `Warehouse '${data.warehouse.nameEn}' created!`);
        setModalMode(null);
        await onRefresh();
      } else {
        notify('error', data.error || 'Failed to create warehouse');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createCategory',
          nameEn: catNameEn,
          nameAr: catNameAr || catNameEn,
          nameKu: catNameAr || catNameEn,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `Category '${data.category.nameEn}' created!`);
        setModalMode(null);
        await onRefresh();
      } else {
        notify('error', data.error || 'Failed to create category');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const filteredItems = (valuation.items || []).filter((item: any) => {
    if (onlyLowStock && !item.isLowStock && !item.isOutOfStock) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      item.nameEn.toLowerCase().includes(q) ||
      item.nameAr.toLowerCase().includes(q) ||
      item.nameKu.toLowerCase().includes(q) ||
      item.sku.toLowerCase().includes(q) ||
      (item.barcode && item.barcode.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2.5">
            <Boxes className="w-6 h-6 text-emerald-500" />
            {t.inventory.title}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-warehouse stock control, SKU/Barcode lookup, stock transfers, and automated accounting valuation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setPCategoryId(categories[0]?.id || '');
              setModalMode('NEW_PRODUCT');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20"
          >
            <Plus className="w-4 h-4" />
            {t.inventory.newProduct}
          </button>

          <button
            onClick={() => {
              setAdjProductId(valuation.items[0]?.productId || '');
              setAdjWarehouseId(warehouses[0]?.id || '');
              setModalMode('ADJUST');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-xs font-semibold"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {t.inventory.adjustStock}
          </button>

          <button
            onClick={() => {
              setTrfProductId(valuation.items[0]?.productId || '');
              setTrfFromWh(warehouses[0]?.id || '');
              setTrfToWh(warehouses[1]?.id || warehouses[0]?.id || '');
              setModalMode('TRANSFER');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-500/30 text-xs font-semibold"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            {t.inventory.transferStock}
          </button>

          <button
            onClick={() => setModalMode('NEW_WAREHOUSE')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-medium"
          >
            <Warehouse className="w-3.5 h-3.5" />
            + {t.warehouse}
          </button>

          <button
            onClick={() => setModalMode('NEW_CATEGORY')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-medium"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            + {t.category}
          </button>

          <button
            onClick={() =>
              exportToCsv(
                'inventory-valuation',
                [
                  'SKU',
                  'Barcode',
                  'Product Name',
                  'Category',
                  'Unit',
                  'Stock Qty',
                  'Cost (USD)',
                  'Selling Price (USD)',
                  'Total Cost Value (USD)',
                  'Total Retail Value (USD)',
                ],
                filteredItems.map((i: any) => [
                  i.sku,
                  i.barcode || '',
                  locName(i, lang),
                  i.categoryNameEn,
                  i.unit,
                  i.quantity,
                  i.purchaseCostUsd,
                  i.sellingPriceUsd,
                  i.costValueUsd,
                  i.retailValueUsd,
                ])
              )
            }
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            {t.exportCsv}
          </button>
        </div>
      </div>

      {/* Valuation KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.dashboard.inventoryValue}</div>
          <div className="text-xl font-black text-emerald-500 mt-1">
            {fmtMoney(valuation.totalCostValueUsd, displayCurrency, exchangeRate, lang)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Total Units: {valuation.totalUnits} across {warehouses.length} warehouses
          </div>
        </div>

        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.dashboard.inventoryRetail}</div>
          <div className="text-xl font-black text-teal-500 mt-1">
            {fmtMoney(valuation.totalRetailValueUsd, displayCurrency, exchangeRate, lang)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Est. Potential Margin:{' '}
            {fmtMoney(
              valuation.totalPotentialProfitUsd,
              displayCurrency,
              exchangeRate,
              lang
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.dashboard.lowStockAlerts}</div>
          <div className="text-xl font-black text-amber-500 mt-1">
            {valuation.lowStockCount + valuation.outOfStockCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Low Stock: {valuation.lowStockCount} | Out of Stock: {valuation.outOfStockCount}
          </div>
        </div>

        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">Active Warehouses</div>
          <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
            {warehouses.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 truncate">
            {warehouses.map((w: any) => locName(w, lang)).join(' • ')}
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('PRODUCTS')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === 'PRODUCTS'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              Product Catalog & Valuation ({valuation.items.length})
            </button>
            <button
              onClick={() => setActiveTab('MOVEMENTS')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === 'MOVEMENTS'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.inventory.movementHistory} ({movements.length})
            </button>
            <button
              onClick={() => setActiveTab('TRANSFERS')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === 'TRANSFERS'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              Warehouse Transfers ({transfers.length})
            </button>
          </div>

          {activeTab === 'PRODUCTS' && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyLowStock}
                  onChange={(e) => setOnlyLowStock(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <span>Low-Stock Only</span>
              </label>
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search SKU, Barcode, or Name..."
                  className="w-full ps-8 pe-3 py-1.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            </div>
          )}
        </div>

        {activeTab === 'PRODUCTS' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4 text-start">{t.inventory.sku}</th>
                  <th className="py-3 px-4 text-start">Product</th>
                  <th className="py-3 px-4 text-start">{t.category}</th>
                  <th className="py-3 px-4 text-center">{t.inventory.availableStock}</th>
                  <th className="py-3 px-4 text-start">By Warehouse</th>
                  <th className="py-3 px-4 text-end">{t.inventory.purchaseCost}</th>
                  <th className="py-3 px-4 text-end">{t.inventory.sellingPrice}</th>
                  <th className="py-3 px-4 text-end">Valuation (Cost)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {filteredItems.map((item: any) => (
                  <tr
                    key={item.productId}
                    className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40"
                  >
                    <td className="py-3 px-4 font-mono">
                      <div className="font-bold text-emerald-500">{item.sku}</div>
                      {item.barcode && (
                        <div className="text-[10px] text-slate-400">{item.barcode}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-semibold">{locName(item, lang)}</td>
                    <td className="py-3 px-4 text-slate-500">
                      {lang === 'ar'
                        ? item.categoryNameAr
                        : lang === 'ku'
                        ? item.categoryNameKu
                        : item.categoryNameEn}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full font-bold text-[11px] ${
                          item.isOutOfStock
                            ? 'bg-rose-500/15 text-rose-500'
                            : item.isLowStock
                            ? 'bg-amber-500/15 text-amber-500'
                            : 'bg-emerald-500/15 text-emerald-500'
                        }`}
                      >
                        {item.quantity} {item.unit}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {(item.warehouseBreakdown || []).map((wb: any) => (
                          <span
                            key={wb.warehouseId}
                            className="px-2 py-0.5 rounded bg-slate-100 dark:bg-charcoal-800 text-[10px]"
                          >
                            {lang === 'ar'
                              ? wb.warehouseNameAr
                              : lang === 'ku'
                              ? wb.warehouseNameKu
                              : wb.warehouseNameEn}
                            : <b>{wb.quantity}</b>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-end">
                      {fmtMoney(item.purchaseCostUsd, displayCurrency, exchangeRate, lang)}
                    </td>
                    <td className="py-3 px-4 text-end font-semibold text-emerald-500">
                      {fmtMoney(item.sellingPriceUsd, displayCurrency, exchangeRate, lang)}
                    </td>
                    <td className="py-3 px-4 text-end font-bold">
                      {fmtMoney(item.costValueUsd, displayCurrency, exchangeRate, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'MOVEMENTS' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">Product</th>
                  <th className="py-3 px-4 text-start">{t.warehouse}</th>
                  <th className="py-3 px-4 text-center">Type</th>
                  <th className="py-3 px-4 text-end">Before</th>
                  <th className="py-3 px-4 text-end">Delta</th>
                  <th className="py-3 px-4 text-end">After</th>
                  <th className="py-3 px-4 text-start">Reason / Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {movements.map((m: any) => {
                  const qty = Number(m.quantity);
                  return (
                    <tr key={m.id}>
                      <td className="py-2.5 px-4 text-slate-500">
                        {new Date(m.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 font-semibold">
                        {locName(m.product, lang)}
                      </td>
                      <td className="py-2.5 px-4">{locName(m.warehouse, lang)}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-charcoal-800 font-mono text-[10px]">
                          {m.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-end">{Number(m.beforeQty)}</td>
                      <td
                        className={`py-2.5 px-4 text-end font-bold ${
                          qty > 0 ? 'text-emerald-500' : 'text-rose-500'
                        }`}
                      >
                        {qty > 0 ? `+${qty}` : qty}
                      </td>
                      <td className="py-2.5 px-4 text-end font-bold">
                        {Number(m.afterQty)}
                      </td>
                      <td className="py-2.5 px-4 text-slate-500">{m.reason || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'TRANSFERS' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4 text-start">Transfer #</th>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">Product</th>
                  <th className="py-3 px-4 text-start">From Warehouse</th>
                  <th className="py-3 px-4 text-start">To Warehouse</th>
                  <th className="py-3 px-4 text-center">Quantity</th>
                  <th className="py-3 px-4 text-start">{t.notes}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {transfers.map((tr: any) => (
                  <tr key={tr.id}>
                    <td className="py-3 px-4 font-mono font-bold text-teal-500">
                      {tr.transferNumber}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {new Date(tr.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 font-semibold">
                      {locName(tr.product, lang)}
                    </td>
                    <td className="py-3 px-4">{locName(tr.fromWarehouse, lang)}</td>
                    <td className="py-3 px-4 font-semibold text-emerald-500">
                      {locName(tr.toWarehouse, lang)}
                    </td>
                    <td className="py-3 px-4 text-center font-bold">
                      {Number(tr.quantity)}
                    </td>
                    <td className="py-3 px-4 text-slate-500">{tr.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Product Modal */}
      {modalMode === 'NEW_PRODUCT' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateProduct}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-lg w-full space-y-4"
          >
            <h3 className="text-base font-bold">{t.inventory.newProduct}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">SKU Code *</label>
                <input
                  type="text"
                  required
                  value={pSku}
                  onChange={(e) => setPSku(e.target.value)}
                  placeholder="LAP-HP-990"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Barcode</label>
                <input
                  type="text"
                  value={pBarcode}
                  onChange={(e) => setPBarcode(e.target.value)}
                  placeholder="8901002991"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Name (English) *</label>
                <input
                  type="text"
                  required
                  value={pNameEn}
                  onChange={(e) => setPNameEn(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Name (العربية)</label>
                <input
                  type="text"
                  value={pNameAr}
                  onChange={(e) => setPNameAr(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Name (کوردی)</label>
                <input
                  type="text"
                  value={pNameKu}
                  onChange={(e) => setPNameKu(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">{t.category}</label>
                <select
                  value={pCategoryId}
                  onChange={(e) => setPCategoryId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  {categories.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {locName(c, lang)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Unit</label>
                <select
                  value={pUnit}
                  onChange={(e) => setPUnit(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  <option value="PCS">PCS</option>
                  <option value="SET">SET</option>
                  <option value="BOX">BOX</option>
                  <option value="KG">KG</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Cost ($ USD) *</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={pCostUsd}
                  onChange={(e) => setPCostUsd(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Price ($ USD) *</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={pPriceUsd}
                  onChange={(e) => setPPriceUsd(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Min Alert</label>
                <input
                  type="number"
                  value={pMinStock}
                  onChange={(e) => setPMinStock(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Opening Stock</label>
                <input
                  type="number"
                  value={pInitialStock}
                  onChange={(e) => setPInitialStock(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {modalMode === 'ADJUST' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleAdjustStock}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">{t.inventory.adjustStock}</h3>
            <p className="text-xs text-slate-500">
              Automatically updates warehouse stock and posts a Double-Entry Journal Entry between Inventory Asset (1300) and Inventory Shrinkage/Adjustment (5200).
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Product</label>
              <select
                value={adjProductId}
                onChange={(e) => setAdjProductId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              >
                {valuation.items.map((p: any) => (
                  <option key={p.productId} value={p.productId}>
                    {p.sku} — {locName(p, lang)} (Current: {p.quantity})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">{t.warehouse}</label>
              <select
                value={adjWarehouseId}
                onChange={(e) => setAdjWarehouseId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              >
                {warehouses.map((w: any) => (
                  <option key={w.id} value={w.id}>
                    {locName(w, lang)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Quantity Change (+ for Surplus, - for Shortage/Damaged)
              </label>
              <input
                type="number"
                required
                value={adjDelta}
                onChange={(e) => setAdjDelta(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Adjustment Reason</label>
              <input
                type="text"
                required
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                {t.confirm}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Warehouse Transfer Modal */}
      {modalMode === 'TRANSFER' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleTransferStock}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">{t.inventory.transferStock}</h3>
            <div>
              <label className="block text-xs font-semibold mb-1">Product</label>
              <select
                value={trfProductId}
                onChange={(e) => setTrfProductId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              >
                {valuation.items.map((p: any) => (
                  <option key={p.productId} value={p.productId}>
                    {p.sku} — {locName(p, lang)} (Total: {p.quantity})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">From Warehouse</label>
                <select
                  value={trfFromWh}
                  onChange={(e) => setTrfFromWh(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  {warehouses.map((w: any) => (
                    <option key={w.id} value={w.id}>
                      {locName(w, lang)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">To Warehouse</label>
                <select
                  value={trfToWh}
                  onChange={(e) => setTrfToWh(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  {warehouses.map((w: any) => (
                    <option key={w.id} value={w.id}>
                      {locName(w, lang)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Transfer Quantity</label>
              <input
                type="number"
                min="1"
                required
                value={trfQty}
                onChange={(e) => setTrfQty(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">{t.notes}</label>
              <input
                type="text"
                value={trfNotes}
                onChange={(e) => setTrfNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-bold"
              >
                Execute Transfer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Create Warehouse Modal */}
      {modalMode === 'NEW_WAREHOUSE' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateWarehouse}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">{t.inventory.newWarehouse}</h3>
            <div>
              <label className="block text-xs font-semibold mb-1">Warehouse Name (EN) *</label>
              <input
                type="text"
                required
                value={whNameEn}
                onChange={(e) => setWhNameEn(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Warehouse Name (AR/KU)</label>
              <input
                type="text"
                value={whNameAr}
                onChange={(e) => setWhNameAr(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Location / Address</label>
              <input
                type="text"
                value={whLocation}
                onChange={(e) => setWhLocation(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalMode(null)}
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

      {/* Create Category Modal */}
      {modalMode === 'NEW_CATEGORY' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateCategory}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">{t.inventory.newCategory}</h3>
            <div>
              <label className="block text-xs font-semibold mb-1">Category Name (EN) *</label>
              <input
                type="text"
                required
                value={catNameEn}
                onChange={(e) => setCatNameEn(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Category Name (AR/KU)</label>
              <input
                type="text"
                value={catNameAr}
                onChange={(e) => setCatNameAr(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalMode(null)}
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
    </div>
  );
}

/* ============================================================================
   DEBTORS, CREDITORS, CUSTOMERS & SUPPLIERS UNIFIED VIEW
   ============================================================================ */

interface PartiesDebtViewProps {
  mode: 'DEBTORS' | 'CREDITORS' | 'CUSTOMERS' | 'SUPPLIERS';
  lang: LanguageCode;
  displayCurrency: 'USD' | 'IQD';
  exchangeRate: number;
  partiesData: any;
  financialAccounts: any[];
  onRefresh: () => Promise<void>;
  onPrint: (doc: {
    type: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'ACCOUNT_STATEMENT';
    mode?: 'A4' | 'THERMAL';
    data: any;
  }) => void;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function PartiesAndDebtModuleView({
  mode,
  lang,
  displayCurrency,
  exchangeRate,
  partiesData,
  financialAccounts,
  onRefresh,
  onPrint,
  notify,
}: PartiesDebtViewProps) {
  const t = translations[lang];
  const isCustomerSide = mode === 'DEBTORS' || mode === 'CUSTOMERS';
  const [search, setSearch] = useState('');
  const [showAddParty, setShowAddParty] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const customers = partiesData?.customers || [];
  const suppliers = partiesData?.suppliers || [];
  const debtPayments = partiesData?.debtPayments || [];
  const unpaidSalesInvoices = partiesData?.unpaidSalesInvoices || [];
  const unpaidPurchaseInvoices = partiesData?.unpaidPurchaseInvoices || [];

  // Settlement Form State
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [finAccId, setFinAccId] = useState(financialAccounts[0]?.id || '');
  const [payCurrency, setPayCurrency] = useState<'USD' | 'IQD'>('USD');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');

  // New Party Form State
  const [partyName, setPartyName] = useState('');
  const [partyCompany, setPartyCompany] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [partyEmail, setPartyEmail] = useState('');
  const [partyCity, setPartyCity] = useState('Erbil');
  const [partyCreditLimit, setPartyCreditLimit] = useState('15000');
  const [partyOpeningBal, setPartyOpeningBal] = useState('0');

  const openSettlementFor = (party: any, invoice?: any) => {
    setSelectedPartyId(party.id);
    setSelectedInvoiceId(invoice?.id || '');
    setFinAccId(financialAccounts[0]?.id || '');
    setPayCurrency('USD');
    const defaultUsd = invoice
      ? Number(invoice.dueUsd).toFixed(2)
      : Number(party.balanceUsd).toFixed(2);
    setPayAmount(defaultUsd);
    setShowSettlementModal(true);
  };

  const handleRecordSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isCustomerSide ? 'collectDebt' : 'payCreditor',
          ...(isCustomerSide
            ? {
                customerId: selectedPartyId,
                salesInvoiceId: selectedInvoiceId || null,
              }
            : {
                supplierId: selectedPartyId,
                purchaseInvoiceId: selectedInvoiceId || null,
              }),
          financialAccountId: finAccId,
          paymentMethod: payMethod,
          currency: payCurrency,
          exchangeRate,
          amountOriginal: Number(payAmount),
          referenceNumber: payRef,
          notes: payNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to record payment');
      } else {
        notify(
          'success',
          isCustomerSide
            ? `Debt collection ${data.payment.paymentNumber} recorded! AR and Cash/Bank updated.`
            : `Creditor payment ${data.payment.paymentNumber} recorded! AP and Cash/Bank updated.`
        );
        setShowSettlementModal(false);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateParty = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isCustomerSide ? 'createCustomer' : 'createSupplier',
          name: partyName,
          companyName: partyCompany,
          phone: partyPhone,
          email: partyEmail,
          city: partyCity,
          creditLimitUsd: Number(partyCreditLimit || 10000),
          openingBalanceUsd: Number(partyOpeningBal || 0),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `Saved profile '${partyName}'!`);
        setShowAddParty(false);
        setPartyName('');
        setPartyPhone('');
        setPartyOpeningBal('0');
        await onRefresh();
      } else {
        notify('error', data.error || 'Could not create profile');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenStatement = async (partyId: string) => {
    const query = isCustomerSide
      ? `statementCustomerId=${partyId}`
      : `statementSupplierId=${partyId}`;
    const res = await fetch(`/api/parties?${query}`);
    const data = await res.json();
    if (res.ok && data.statement) {
      onPrint({
        type: 'ACCOUNT_STATEMENT',
        mode: 'A4',
        data: data.statement,
      });
    } else {
      notify('error', data.error || 'Failed to load statement');
    }
  };

  const rawList = isCustomerSide ? customers : suppliers;
  const filteredList = rawList.filter((item: any) => {
    if (
      (mode === 'DEBTORS' || mode === 'CREDITORS') &&
      Number(item.balanceUsd) <= 0
    ) {
      // In Debtors/Creditors view, show parties with positive balance first, or all if search is typed
      if (!search.trim()) return Number(item.balanceUsd) > 0;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.code.toLowerCase().includes(q) ||
      (item.phone && item.phone.toLowerCase().includes(q))
    );
  });

  const totalOutstandingUsd = rawList.reduce(
    (acc: number, item: any) => acc + Math.max(0, Number(item.balanceUsd)),
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2.5">
            {isCustomerSide ? (
              <Users className="w-6 h-6 text-emerald-500" />
            ) : (
              <Building2 className="w-6 h-6 text-teal-500" />
            )}
            {mode === 'DEBTORS'
              ? t.debt.debtorsTitle
              : mode === 'CREDITORS'
              ? t.debt.creditorsTitle
              : mode === 'CUSTOMERS'
              ? t.nav.customers
              : t.nav.suppliers}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isCustomerSide
              ? 'Track customer receivables, credit limits, partial & full debt collections, and printable customer statements'
              : 'Manage supplier liabilities, due dates, partial & full creditor settlements, and printable supplier statements'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">
            <span className="text-slate-400 me-1.5">{t.debt.currentBalance}:</span>
            <span className="font-black text-rose-500">
              {fmtMoney(totalOutstandingUsd, displayCurrency, exchangeRate, lang)}
            </span>
          </div>

          {rawList.length > 0 && (
            <button
              onClick={() => openSettlementFor(rawList[0])}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20"
            >
              <Wallet className="w-4 h-4" />
              {isCustomerSide ? t.debt.collectPayment : t.debt.paySupplier}
            </button>
          )}

          <button
            onClick={() => setShowAddParty(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-slate-200 dark:hover:bg-charcoal-700 text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            {isCustomerSide ? '+ Customer' : '+ Supplier'}
          </button>

          <button
            onClick={() =>
              exportToCsv(
                `${mode.toLowerCase()}-report`,
                ['Code', 'Name', 'Company', 'Phone', 'City', 'Balance (USD)'],
                filteredList.map((p: any) => [
                  p.code,
                  p.name,
                  p.companyName || '',
                  p.phone,
                  p.city || '',
                  Number(p.balanceUsd).toFixed(2),
                ])
              )
            }
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            {t.exportCsv}
          </button>
        </div>
      </div>

      {/* Main Directory & Balances Table */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap justify-between items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code, or phone..."
            className="w-full sm:w-80 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
              <tr>
                <th className="py-3 px-4 text-start">Code</th>
                <th className="py-3 px-4 text-start">Name / Company</th>
                <th className="py-3 px-4 text-start">Phone & City</th>
                {isCustomerSide && (
                  <th className="py-3 px-4 text-end">{t.debt.creditLimit}</th>
                )}
                <th className="py-3 px-4 text-end">{t.debt.currentBalance}</th>
                <th className="py-3 px-4 text-center">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
              {filteredList.map((p: any) => {
                const bal = Number(p.balanceUsd);
                return (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-emerald-500">
                      {p.code}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {p.companyName || p.email || ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      <div>{p.phone}</div>
                      <div className="text-[10px]">{p.city}</div>
                    </td>
                    {isCustomerSide && (
                      <td className="py-3 px-4 text-end text-slate-500">
                        {fmtMoney(p.creditLimitUsd, displayCurrency, exchangeRate, lang)}
                      </td>
                    )}
                    <td className="py-3 px-4 text-end">
                      <span
                        className={`font-black text-sm ${
                          bal > 0 ? 'text-rose-500' : 'text-emerald-500'
                        }`}
                      >
                        {fmtMoney(bal, displayCurrency, exchangeRate, lang)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-2">
                        {bal > 0 && (
                          <button
                            onClick={() => openSettlementFor(p)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold"
                          >
                            {isCustomerSide ? 'Collect Debt' : 'Pay Debt'}
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenStatement(p.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-slate-200 dark:hover:bg-charcoal-700 text-[11px] font-semibold"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-teal-500" />
                          {t.debt.accountStatement}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Outstanding Invoices & Recent Payment History Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 p-5 space-y-3">
          <h3 className="text-sm font-bold">
            {isCustomerSide
              ? 'Open Receivable Sales Invoices'
              : 'Open Payable Purchase Invoices'}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-2 px-3 text-start">Invoice #</th>
                  <th className="py-2 px-3 text-start">Party</th>
                  <th className="py-2 px-3 text-end">Due Balance</th>
                  <th className="py-2 px-3 text-center">Settle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {(isCustomerSide ? unpaidSalesInvoices : unpaidPurchaseInvoices).map(
                  (inv: any) => (
                    <tr key={inv.id}>
                      <td className="py-2 px-3 font-mono font-bold">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-2 px-3">
                        {inv.customer?.name || inv.supplier?.name}
                      </td>
                      <td className="py-2 px-3 text-end font-bold text-rose-500">
                        {fmtMoney(inv.dueUsd, displayCurrency, exchangeRate, lang)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() =>
                            openSettlementFor(
                              inv.customer || inv.supplier,
                              inv
                            )
                          }
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold"
                        >
                          Settle Invoice
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 p-5 space-y-3">
          <h3 className="text-sm font-bold">{t.debt.collectionHistory}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-2 px-3 text-start">Voucher #</th>
                  <th className="py-2 px-3 text-start">{t.date}</th>
                  <th className="py-2 px-3 text-start">Party</th>
                  <th className="py-2 px-3 text-end">{t.amount}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {debtPayments
                  .filter((dp: any) =>
                    isCustomerSide
                      ? dp.type === 'DEBTOR_COLLECTION'
                      : dp.type === 'CREDITOR_PAYMENT'
                  )
                  .map((dp: any) => (
                    <tr key={dp.id}>
                      <td className="py-2 px-3 font-mono font-bold text-emerald-500">
                        {dp.paymentNumber}
                      </td>
                      <td className="py-2 px-3 text-slate-500">
                        {new Date(dp.date).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-3 font-semibold">
                        {dp.customer?.name || dp.supplier?.name}
                      </td>
                      <td className="py-2 px-3 text-end font-bold text-emerald-500">
                        {fmtMoney(dp.amountUsd, displayCurrency, exchangeRate, lang)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Debt Collection / Creditor Payment Modal */}
      {showSettlementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleRecordSettlement}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">
              {isCustomerSide ? t.debt.collectPayment : t.debt.paySupplier}
            </h3>

            <div>
              <label className="block text-xs font-semibold mb-1">
                {isCustomerSide ? 'Customer (Debtor)' : 'Supplier (Creditor)'}
              </label>
              <select
                value={selectedPartyId}
                onChange={(e) => {
                  setSelectedPartyId(e.target.value);
                  setSelectedInvoiceId('');
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              >
                {rawList.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (Balance: ${Number(p.balanceUsd).toFixed(2)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                Cash Register / Bank Account
              </label>
              <select
                value={finAccId}
                onChange={(e) => setFinAccId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              >
                {financialAccounts.map((fa) => (
                  <option key={fa.id} value={fa.id}>
                    {locName(fa, lang)} ({fa.currency} — ${Number(fa.balanceUsd).toFixed(0)})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Currency</label>
                <select
                  value={payCurrency}
                  onChange={(e) => setPayCurrency(e.target.value as 'USD' | 'IQD')}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  <option value="USD">USD ($)</option>
                  <option value="IQD">IQD (د.ع)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  Amount ({payCurrency}) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Payment Method</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank Wire / Transfer</option>
                  <option value="CHECK">Check</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Reference #</label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="Receipt / Wire Ref"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">{t.notes}</label>
              <input
                type="text"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSettlementModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                Post Settlement
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Customer / Supplier Modal */}
      {showAddParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateParty}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">
              {isCustomerSide ? 'New Customer Profile' : 'New Supplier Profile'}
            </h3>
            <div>
              <label className="block text-xs font-semibold mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Company Name</label>
                <input
                  type="text"
                  value={partyCompany}
                  onChange={(e) => setPartyCompany(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Phone *</label>
                <input
                  type="text"
                  required
                  value={partyPhone}
                  onChange={(e) => setPartyPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">City</label>
                <input
                  type="text"
                  value={partyCity}
                  onChange={(e) => setPartyCity(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  Opening Balance ($ USD)
                </label>
                <input
                  type="number"
                  step="any"
                  value={partyOpeningBal}
                  onChange={(e) => setPartyOpeningBal(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            </div>
            {isCustomerSide && (
              <div>
                <label className="block text-xs font-semibold mb-1">
                  Credit Limit ($ USD)
                </label>
                <input
                  type="number"
                  step="any"
                  value={partyCreditLimit}
                  onChange={(e) => setPartyCreditLimit(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddParty(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
