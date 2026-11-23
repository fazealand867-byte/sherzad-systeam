'use client';

import React, { useState, useMemo } from 'react';
import {
  Boxes,
  Plus,
  Minus,
  Edit3,
  Trash2,
  Archive,
  AlertTriangle,
  Search,
  Download,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Package,
  Flame,
  XCircle,
  CheckCircle2,
  ArrowUpDown,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import { CustomDatePicker } from './CustomDatePicker';
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
  unitLabel,
} from '@/lib/units';
import { SearchableSelect } from './SearchableSelect';

interface ProductsInventoryProps {
  lang: LanguageCode;
  inventoryData: any;
  units: UnitDefinition[];
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function ProductsInventoryView({
  lang,
  inventoryData,
  units,
  onRefresh,
  notify,
}: ProductsInventoryProps) {
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<'PRODUCTS' | 'MOVEMENTS' | 'WASTE' | 'UNITS'>('PRODUCTS');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'FINISHED_PRODUCT' | 'RAW_MATERIAL'>('ALL');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [modalMode, setModalMode] = useState<
    null | 'PRODUCT' | 'ADJUST' | 'WASTE' | 'CATEGORY' | 'UNIT'
  >(null);
  const [returnToProductAfterSubModal, setReturnToProductAfterSubModal] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [idemKey, setIdemKey] = useState(() => makeIdempotencyKey('inv'));

  const valuation = inventoryData?.valuation || {
    items: [],
    totalProducts: 0,
    totalCostValueIqd: 0,
    totalRetailValueIqd: 0,
    rawMaterialValueIqd: 0,
    finishedProductValueIqd: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
  };
  const categories = inventoryData?.categories || [];
  const warehouses = inventoryData?.warehouses || [];
  const movements = inventoryData?.movements || [];
  const spoilageRecords = inventoryData?.spoilageRecords || [];

  // Product Add/Edit Form
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [pName, setPName] = useState('');
  const [pNameAr, setPNameAr] = useState('');
  const [pNameEn, setPNameEn] = useState('');
  const [pType, setPType] = useState<'FINISHED_PRODUCT' | 'RAW_MATERIAL' | 'GENERAL'>('FINISHED_PRODUCT');
  const [pCategoryId, setPCategoryId] = useState('');
  const [pUnit, setPUnit] = useState('kg');
  const [pPriceIqd, setPPriceIqd] = useState('');
  const [pCostIqd, setPCostIqd] = useState('');
  const [pOpeningStock, setPOpeningStock] = useState('');
  const [pMinStock, setPMinStock] = useState('5');
  const [pImageUrl, setPImageUrl] = useState('');
  const [pSku, setPSku] = useState('');
  const [pBarcode, setPBarcode] = useState('');

  // Simple Adjust Stock Form (Clear ADD vs REMOVE toggle — no negative sign needed!)
  const [adjProductId, setAdjProductId] = useState('');
  const [adjDirection, setAdjDirection] = useState<'ADD' | 'REMOVE'>('ADD');
  const [adjQty, setAdjQty] = useState('');
  const [adjUnit, setAdjUnit] = useState('kg');
  const [adjReason, setAdjReason] = useState('');

  // Spoilage / Waste Form
  const [wstProductId, setWstProductId] = useState('');
  const [wstQty, setWstQty] = useState('');
  const [wstUnit, setWstUnit] = useState('kg');
  const [wstReason, setWstReason] = useState('SPOILED');
  const [wstDate, setWstDate] = useState(todayDateStr());
  const [wstNotes, setWstNotes] = useState('');

  // Simple Category Form (Just 1 required field!)
  const [catName, setCatName] = useState('');

  // Simple Custom Unit Form
  const [uName, setUName] = useState('');
  const [uLinkBase, setULinkBase] = useState('');
  const [uFactor, setUFactor] = useState('1');

  const openAddProduct = (defaultType: 'FINISHED_PRODUCT' | 'RAW_MATERIAL' = 'FINISHED_PRODUCT') => {
    setEditingProductId(null);
    setPName('');
    setPNameAr('');
    setPNameEn('');
    setPType(defaultType);
    const matchedCat = categories.find((c: any) =>
      defaultType === 'RAW_MATERIAL' ? c.code === 'CAT-RAW' : c.code === 'CAT-FOOD'
    );
    setPCategoryId(matchedCat?.id || categories[0]?.id || '');
    setPUnit('kg');
    setPPriceIqd('');
    setPCostIqd('');
    setPOpeningStock('');
    setPMinStock('5');
    setPImageUrl('');
    setPSku('');
    setPBarcode('');
    setShowAdvanced(false);
    setModalMode('PRODUCT');
  };

  const openEditProduct = (item: any) => {
    setEditingProductId(item.productId);
    setPName(item.nameKu || item.nameEn || '');
    setPNameAr(item.nameAr || '');
    setPNameEn(item.nameEn || '');
    setPType(item.productType || 'FINISHED_PRODUCT');
    setPCategoryId(item.categoryId || categories[0]?.id || '');
    setPUnit(item.unit || 'kg');
    setPPriceIqd(String(item.sellingPriceIqd ?? 0));
    setPCostIqd(String(item.purchaseCostIqd ?? 0));
    setPMinStock(String(item.minStockLevel ?? 5));
    setPImageUrl(item.imageUrl || '');
    setPSku(item.sku || '');
    setPBarcode(item.barcode || '');
    setShowAdvanced(false);
    setModalMode('PRODUCT');
  };

  const openAdjustModal = (item?: any) => {
    const target = item || valuation.items[0];
    setIdemKey(makeIdempotencyKey('adj'));
    setAdjProductId(target?.productId || '');
    setAdjDirection('ADD');
    setAdjUnit(target?.unit || 'kg');
    setAdjQty('');
    setAdjReason('');
    setModalMode('ADJUST');
  };

  const openWasteModal = (item?: any) => {
    const target = item || valuation.items[0];
    setIdemKey(makeIdempotencyKey('wst'));
    setWstProductId(target?.productId || '');
    setWstUnit(target?.unit || 'kg');
    setWstQty('');
    setWstReason('SPOILED');
    setWstDate(todayDateStr());
    setWstNotes('');
    setModalMode('WASTE');
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1500000) {
      notify('warning', lang === 'ku' ? 'قەبارەی وێنە زۆر گەورەیە (کەمتر لە 1.5MB)' : 'Image must be smaller than 1.5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPImageUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName.trim()) return;
    setSubmitting(true);
    try {
      const payload: any = editingProductId
        ? {
            action: 'updateProduct',
            productId: editingProductId,
            name: pName.trim(),
            nameKu: pName.trim(),
            nameAr: pNameAr.trim() || pName.trim(),
            nameEn: pNameEn.trim() || pName.trim(),
            productType: pType,
            categoryId: pCategoryId || categories[0]?.id,
            unit: pUnit,
            purchaseCostIqd: Math.max(0, Number(pCostIqd || 0)),
            sellingPriceIqd: Math.max(0, Number(pPriceIqd || 0)),
            minStockLevel: Math.max(0, Number(pMinStock || 0)),
            imageUrl: pImageUrl || null,
            barcode: pBarcode.trim() || null,
          }
        : {
            action: 'createProduct',
            name: pName.trim(),
            nameKu: pName.trim(),
            nameAr: pNameAr.trim() || pName.trim(),
            nameEn: pNameEn.trim() || pName.trim(),
            sku: pSku.trim() || undefined,
            barcode: pBarcode.trim() || null,
            productType: pType,
            categoryId: pCategoryId || categories[0]?.id,
            unit: pUnit,
            purchaseCostIqd: Math.max(0, Number(pCostIqd || 0)),
            sellingPriceIqd: Math.max(0, Number(pPriceIqd || 0)),
            minStockLevel: Math.max(0, Number(pMinStock || 5)),
            initialStock: Math.max(0, Number(pOpeningStock || 0)),
            initialStockUnit: pUnit,
            warehouseId: warehouses[0]?.id,
            imageUrl: pImageUrl || null,
          };

      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to save product');
      } else {
        notify('success', `${locName(data.product, lang)} ✓`);
        setModalMode(null);
        await onRefresh();
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOrArchiveProduct = async (item: any) => {
    const action = item.isUsed ? 'archiveProduct' : 'deleteProduct';
    const confirmMsg = item.isUsed
      ? lang === 'ku'
        ? `ئەم بەرهەمە (${locName(item, lang)}) تۆماری هەیە. دەتەوێت لە لیستەکە بیشاریتەوە (ئەرشیف)؟`
        : lang === 'ar'
        ? `هذا المنتج لديه حركات سابقة. هل تريد أرشفته؟`
        : `This product has transaction history. Archive it?`
      : lang === 'ku'
      ? `دڵنیایت لە سڕینەوەی (${locName(item, lang)})؟`
      : lang === 'ar'
      ? `هل أنت متأكد من حذف (${locName(item, lang)})؟`
      : `Delete "${locName(item, lang)}"?`;

    if (!window.confirm(confirmMsg)) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, productId: item.productId }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `${locName(item, lang)} ✓`);
        await onRefresh();
      } else {
        notify('error', data.error || 'Action failed');
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyAbs = Math.abs(Number(adjQty || 0));
    if (!adjProductId || qtyAbs <= 0) {
      notify('error', lang === 'ku' ? 'تکایە بڕێکی دروست بنووسە' : 'Please enter a valid quantity');
      return;
    }
    const delta = adjDirection === 'ADD' ? qtyAbs : -qtyAbs;
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjustStock',
          productId: adjProductId,
          warehouseId: warehouses[0]?.id,
          quantityDelta: delta,
          unit: adjUnit,
          reason: adjReason.trim() || (adjDirection === 'ADD' ? 'زیادکردنی کۆگا' : 'کەمکردنەوەی کۆگا'),
          idempotencyKey: idemKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Adjustment failed');
      else {
        notify('success', lang === 'ku' ? 'کۆگا بە سەرکەوتوویی نوێکرایەوە ✓' : 'Stock updated ✓');
        setModalMode(null);
        await onRefresh();
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordWaste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wstProductId || Number(wstQty) <= 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'recordSpoilage',
          productId: wstProductId,
          warehouseId: warehouses[0]?.id,
          quantity: Number(wstQty),
          unit: wstUnit,
          reason: wstReason,
          date: wstDate,
          notes: wstNotes.trim() || undefined,
          idempotencyKey: idemKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Failed to record spoilage');
      else {
        notify('success', `${data.spoilage.recordNumber} ✓`);
        setModalMode(null);
        await onRefresh();
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createCategory',
          nameKu: catName.trim(),
          nameAr: catName.trim(),
          nameEn: catName.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.category) {
        notify('success', `${locName(data.category, lang)} ✓`);
        setPCategoryId(data.category.id);
        setCatName('');
        setModalMode(returnToProductAfterSubModal ? 'PRODUCT' : null);
        setReturnToProductAfterSubModal(false);
        await onRefresh();
      } else notify('error', data.error || 'Failed');
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createUnit',
          nameKu: uName.trim(),
          nameAr: uName.trim(),
          nameEn: uName.trim(),
          symbol: uName.trim(),
          baseUnitCode: uLinkBase || undefined,
          toBaseFactor: uLinkBase ? Math.max(0.0001, Number(uFactor || 1)) : 1,
          allowDecimal: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.unit) {
        notify('success', `${locName(data.unit, lang)} ✓`);
        setPUnit(data.unit.code);
        setUName('');
        setULinkBase('');
        setUFactor('1');
        setModalMode(returnToProductAfterSubModal ? 'PRODUCT' : null);
        setReturnToProductAfterSubModal(false);
        await onRefresh();
      } else notify('error', data.error || 'Failed to add unit');
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  // Sort Food Factory items first (Finished Products -> Raw Materials -> Other)
  const filteredItems = useMemo(() => {
    const score = (i: any) => {
      const sku = String(i.sku || '');
      if (sku.startsWith('FOOD-') || (i.productType === 'FINISHED_PRODUCT' && !sku.startsWith('SKU-10'))) return 0;
      if (sku.startsWith('RAW-') || i.productType === 'RAW_MATERIAL') return 1;
      return 2;
    };
    return [...(valuation.items || [])]
      .sort((a, b) => score(a) - score(b))
      .filter((item: any) => {
        if (typeFilter !== 'ALL' && item.productType !== typeFilter) return false;
        if (onlyLowStock && !item.isLowStock && !item.isOutOfStock) return false;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          (item.nameKu || '').toLowerCase().includes(q) ||
          (item.nameAr || '').toLowerCase().includes(q) ||
          (item.nameEn || '').toLowerCase().includes(q) ||
          (item.sku || '').toLowerCase().includes(q) ||
          (item.barcode && item.barcode.toLowerCase().includes(q))
        );
      });
  }, [valuation.items, typeFilter, onlyLowStock, search]);

  const adjProduct = valuation.items.find((i: any) => i.productId === adjProductId);
  const wstProduct = valuation.items.find((i: any) => i.productId === wstProductId);

  // Live stock preview inside Adjust Stock modal
  const adjPreview = useMemo(() => {
    if (!adjProduct || !Number(adjQty)) return null;
    try {
      const absBase = convertQuantity(Math.abs(Number(adjQty)), adjUnit, adjProduct.unit, units);
      const deltaBase = adjDirection === 'ADD' ? absBase : -absBase;
      const afterBase = Math.max(0, Math.round((Number(adjProduct.quantity || 0) + deltaBase) * 10000) / 10000);
      return { deltaBase, afterBase };
    } catch {
      return null;
    }
  }, [adjProduct, adjQty, adjUnit, adjDirection, units]);

  const lowCount = Number(valuation.lowStockCount || 0) + Number(valuation.outOfStockCount || 0);

  return (
    <div className="space-y-5">
      {/* Clean Header — Only 2 clear action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
            <Boxes className="w-6 h-6 text-emerald-500" />
            {t.products.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t.products.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => openWasteModal()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-500 border border-rose-500/30 text-xs font-bold transition"
          >
            <Flame className="w-4 h-4" />
            {lang === 'ku' ? 'تۆمارکردنی تێکچوون' : lang === 'ar' ? 'تسجيل تالف' : 'Record Waste'}
          </button>

          <button
            onClick={() => openAddProduct('FINISHED_PRODUCT')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg shadow-emerald-600/25 transition"
          >
            <Plus className="w-4 h-4" />
            {t.products.addProduct}
          </button>
        </div>
      </div>

      {/* Clickable Summary KPI Cards — Clicking any card filters the table! */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <button
          type="button"
          onClick={() => {
            setActiveTab('PRODUCTS');
            setTypeFilter('ALL');
            setOnlyLowStock(false);
          }}
          className={`text-start p-4 rounded-2xl border transition ${
            activeTab === 'PRODUCTS' && typeFilter === 'ALL' && !onlyLowStock
              ? 'bg-emerald-500/10 border-emerald-500/50'
              : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/40'
          }`}
        >
          <div className="text-xs text-slate-400">{t.dashboard.inventoryValue}</div>
          <div className="text-xl font-black text-emerald-500 mt-1">
            {fmtIqd(valuation.totalCostValueIqd, lang)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {valuation.items.length} {t.products.allItems}
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('PRODUCTS');
            setTypeFilter('FINISHED_PRODUCT');
            setOnlyLowStock(false);
          }}
          className={`text-start p-4 rounded-2xl border transition ${
            typeFilter === 'FINISHED_PRODUCT' && !onlyLowStock
              ? 'bg-teal-500/10 border-teal-500/50'
              : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800 hover:border-teal-500/40'
          }`}
        >
          <div className="text-xs text-slate-400">{t.products.finishedProducts}</div>
          <div className="text-xl font-black text-teal-500 mt-1">
            {fmtIqd(valuation.finishedProductValueIqd, lang)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {valuation.items.filter((i: any) => i.productType === 'FINISHED_PRODUCT').length}{' '}
            {lang === 'ku' ? 'بەرهەم' : lang === 'ar' ? 'منتج' : 'items'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('PRODUCTS');
            setTypeFilter('RAW_MATERIAL');
            setOnlyLowStock(false);
          }}
          className={`text-start p-4 rounded-2xl border transition ${
            typeFilter === 'RAW_MATERIAL' && !onlyLowStock
              ? 'bg-amber-500/10 border-amber-500/50'
              : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800 hover:border-amber-500/40'
          }`}
        >
          <div className="text-xs text-slate-400">{t.products.rawMaterials}</div>
          <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
            {fmtIqd(valuation.rawMaterialValueIqd, lang)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {valuation.items.filter((i: any) => i.productType === 'RAW_MATERIAL').length}{' '}
            {lang === 'ku' ? 'کەرەستە' : lang === 'ar' ? 'مادة' : 'items'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('PRODUCTS');
            setTypeFilter('ALL');
            setOnlyLowStock(!onlyLowStock);
          }}
          className={`text-start p-4 rounded-2xl border transition ${
            onlyLowStock
              ? 'bg-rose-500/10 border-rose-500/50'
              : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800 hover:border-amber-500/40'
          }`}
        >
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            {t.dashboard.lowStockAlerts}
          </div>
          <div className="text-xl font-black text-amber-500 mt-1">{lowCount}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {onlyLowStock
              ? (lang === 'ku' ? 'پیشاندانی هەموو ↺' : 'Show all ↺')
              : t.products.lowStockOnly}
          </div>
        </button>
      </div>

      {/* Main Card: Clean Single Bar + Table */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap items-center justify-between gap-3">
          {/* 4 Simple Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'PRODUCTS', label: `${t.products.allItems} (${valuation.items.length})` },
              { id: 'MOVEMENTS', label: `${t.products.movementsTab} (${movements.length})` },
              { id: 'WASTE', label: `${t.products.wasteTab} (${spoilageRecords.length})` },
              { id: 'UNITS', label: `${t.products.unitsTab} (${units.length})` },
            ].map((tb) => (
              <button
                key={tb.id}
                onClick={() => setActiveTab(tb.id as any)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                  activeTab === tb.id
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-charcoal-700'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {activeTab === 'PRODUCTS' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-56 sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="w-full ps-9 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <button
                onClick={() =>
                  exportToCsv(
                    'products-inventory-iqd',
                    ['SKU', 'Name', 'Type', 'Unit', 'Stock', 'Cost (IQD)', 'Price (IQD)', 'Value (IQD)'],
                    filteredItems.map((i: any) => [
                      i.sku,
                      locName(i, lang),
                      i.productType,
                      i.unit,
                      i.quantity,
                      i.purchaseCostIqd,
                      i.sellingPriceIqd,
                      i.costValueIqd,
                    ])
                  )
                }
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Excel
              </button>
            </div>
          )}
        </div>

        {/* PRODUCTS TABLE */}
        {activeTab === 'PRODUCTS' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">{t.products.productName}</th>
                  <th className="py-3 px-4 text-center">{t.products.currentStock}</th>
                  <th className="py-3 px-4 text-end">{t.products.costPrice}</th>
                  <th className="py-3 px-4 text-end">{t.products.sellingPrice}</th>
                  <th className="py-3 px-4 text-center">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400 text-sm">
                      {t.noData}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item: any) => (
                    <tr key={item.productId} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={locName(item, lang)}
                              className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-charcoal-700 shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                              <Package className="w-5 h-5" />
                            </div>
                          )}
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white">
                              {locName(item, lang)}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  item.productType === 'RAW_MATERIAL'
                                    ? 'bg-amber-500/15 text-amber-500'
                                    : item.productType === 'FINISHED_PRODUCT'
                                    ? 'bg-emerald-500/15 text-emerald-500'
                                    : 'bg-slate-200 dark:bg-charcoal-800 text-slate-500'
                                }`}
                              >
                                {item.productType === 'RAW_MATERIAL'
                                  ? t.products.rawMaterials
                                  : item.productType === 'FINISHED_PRODUCT'
                                  ? t.products.finishedProducts
                                  : (lang === 'ku' ? 'گشتی' : 'General')}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-3 py-1 rounded-full font-black text-xs ${
                            item.isOutOfStock
                              ? 'bg-rose-500/15 text-rose-500'
                              : item.isLowStock
                              ? 'bg-amber-500/15 text-amber-500'
                              : 'bg-emerald-500/15 text-emerald-500'
                          }`}
                        >
                          {fmtQty(item.quantity)} {unitLabel(item.unit, lang, units)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end text-xs font-semibold text-slate-500">
                        {fmtIqd(item.purchaseCostIqd, lang)}
                      </td>
                      <td className="py-3 px-4 text-end font-black text-emerald-600 dark:text-emerald-400">
                        {Number(item.sellingPriceIqd) > 0 ? fmtIqd(item.sellingPriceIqd, lang) : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => openAdjustModal(item)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 text-xs font-bold transition"
                          >
                            <ArrowUpDown className="w-3.5 h-3.5" />
                            {lang === 'ku' ? '+ / - کۆگا' : lang === 'ar' ? '+ / - مخزون' : 'Stock'}
                          </button>
                          <button
                            onClick={() => openEditProduct(item)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:text-emerald-500 text-xs font-semibold transition"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            {t.edit}
                          </button>
                          <button
                            onClick={() => handleDeleteOrArchiveProduct(item)}
                            title={item.isUsed ? t.archive : t.delete}
                            className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 transition"
                          >
                            {item.isUsed ? <Archive className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* MOVEMENTS TAB */}
        {activeTab === 'MOVEMENTS' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">{t.products.productName}</th>
                  <th className="py-3 px-4 text-end">{lang === 'ku' ? 'گۆڕانکاری' : lang === 'ar' ? 'التغيير' : 'Change'}</th>
                  <th className="py-3 px-4 text-end">{lang === 'ku' ? 'کۆگای نوێ' : lang === 'ar' ? 'المخزون بعد' : 'New Stock'}</th>
                  <th className="py-3 px-4 text-start">{t.description}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-400">{t.noData}</td>
                  </tr>
                ) : (
                  movements.map((m: any) => {
                    const qty = Number(m.quantity || 0);
                    return (
                      <tr key={m.id}>
                        <td className="py-2.5 px-4 text-slate-500">
                          {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-2.5 px-4 font-bold">
                          {m.product ? locName(m.product, lang) : '—'}
                        </td>
                        <td className={`py-2.5 px-4 text-end font-black ${qty > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {qty > 0 ? `+${fmtQty(qty)}` : fmtQty(qty)} {unitLabel(m.unit || m.product?.unit || 'piece', lang, units)}
                        </td>
                        <td className="py-2.5 px-4 text-end font-bold">{fmtQty(m.afterQty)}</td>
                        <td className="py-2.5 px-4 text-slate-500">{m.reason || '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* SPOILAGE & WASTE TAB */}
        {activeTab === 'WASTE' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">#</th>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">{t.products.productName}</th>
                  <th className="py-3 px-4 text-center">{t.sales.qty}</th>
                  <th className="py-3 px-4 text-start">{t.products.wasteReason}</th>
                  <th className="py-3 px-4 text-end">{t.products.costPrice}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {spoilageRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">{t.noData}</td>
                  </tr>
                ) : (
                  spoilageRecords.map((sr: any) => (
                    <tr key={sr.id}>
                      <td className="py-3 px-4 font-mono text-xs font-bold text-rose-500">{sr.recordNumber}</td>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {sr.date ? new Date(sr.date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-4 font-bold">{sr.product ? locName(sr.product, lang) : '—'}</td>
                      <td className="py-3 px-4 text-center font-bold text-rose-500">
                        -{fmtQty(sr.quantity)} {unitLabel(sr.unit, lang, units)}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {(t.products.wasteReasons as Record<string, string>)[sr.reason] || sr.reason}
                        {sr.notes ? ` — ${sr.notes}` : ''}
                      </td>
                      <td className="py-3 px-4 text-end font-bold text-rose-500">{fmtIqd(sr.totalCostIqd, lang)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* MEASUREMENT UNITS TAB */}
        {activeTab === 'UNITS' && (
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {lang === 'ku'
                  ? 'گۆڕینی خۆکارانە: 1 کیلۆگرام = 1,000 گرام | 500 گرام = 0.5 کیلۆگرام'
                  : lang === 'ar'
                  ? 'التحويل التلقائي: 1 كيلوغرام = 1,000 غرام | 500 غرام = 0.5 كيلوغرام'
                  : 'Automatic conversion: 1 kg = 1,000 g | 500 g = 0.5 kg'}
              </div>
              <button
                onClick={() => {
                  setReturnToProductAfterSubModal(false);
                  setModalMode('UNIT');
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.products.addUnit}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {units.map((u) => (
                <div
                  key={u.id}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 flex items-center justify-between"
                >
                  <div>
                    <div className="font-bold text-sm text-slate-900 dark:text-white">
                      {locName(u, lang)}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                      {u.toBaseFactor !== 1 ? `1 ${u.code} = ${u.toBaseFactor} ${u.baseUnitCode}` : u.code}
                    </div>
                  </div>
                  {!u.isSystem && (
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/inventory', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'deleteUnit', code: u.code }),
                          });
                          const d = await res.json();
                          if (res.ok) {
                            notify('success', `${locName(u, lang)} ✓`);
                            await onRefresh();
                          } else notify('error', d.error || 'Could not delete unit');
                        } catch {}
                      }}
                      className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ULTRA-SIMPLE ADD / EDIT PRODUCT MODAL */}
      {modalMode === 'PRODUCT' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveProduct}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4 my-8 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black">
                {editingProductId ? t.products.editProduct : t.products.addProduct}
              </h3>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-slate-400"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* 1. Simple Type Toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setPType('FINISHED_PRODUCT');
                  if (!editingProductId) {
                    const fc = categories.find((c: any) => c.code === 'CAT-FOOD');
                    if (fc) setPCategoryId(fc.id);
                  }
                }}
                className={`py-2.5 rounded-xl text-xs font-bold border transition ${
                  pType === 'FINISHED_PRODUCT'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow'
                    : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800'
                }`}
              >
                {t.products.finishedProducts}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPType('RAW_MATERIAL');
                  if (!editingProductId) {
                    setPUnit('kg');
                    const rc = categories.find((c: any) => c.code === 'CAT-RAW');
                    if (rc) setPCategoryId(rc.id);
                  }
                }}
                className={`py-2.5 rounded-xl text-xs font-bold border transition ${
                  pType === 'RAW_MATERIAL'
                    ? 'bg-amber-600 text-white border-amber-600 shadow'
                    : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800'
                }`}
              >
                {t.products.rawMaterials}
              </button>
            </div>

            {/* 2. Product Name */}
            <div>
              <label className="block text-xs font-bold mb-1">{t.products.productName} *</label>
              <input
                type="text"
                required
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder={lang === 'ku' ? 'نموونە: کوبە، شاورمە، مریشک...' : 'e.g. Kubba, Shawarma, Chicken...'}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
              />
            </div>

            {/* 3. Unit & Category with inline + Add shortcuts */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold">{t.unit}</label>
                  <button
                    type="button"
                    onClick={() => {
                      setReturnToProductAfterSubModal(true);
                      setModalMode('UNIT');
                    }}
                    className="text-[11px] text-emerald-500 font-bold hover:underline"
                  >
                    + {lang === 'ku' ? 'یەکەی نوێ' : lang === 'ar' ? 'وحدة جديدة' : 'New'}
                  </button>
                </div>
                <select
                  value={pUnit}
                  onChange={(e) => setPUnit(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
                >
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>{locName(u, lang)}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold">{t.category}</label>
                  <button
                    type="button"
                    onClick={() => {
                      setReturnToProductAfterSubModal(true);
                      setModalMode('CATEGORY');
                    }}
                    className="text-[11px] text-emerald-500 font-bold hover:underline"
                  >
                    + {lang === 'ku' ? 'بەشی نوێ' : lang === 'ar' ? 'قسم جديد' : 'New'}
                  </button>
                </div>
                <select
                  value={pCategoryId}
                  onChange={(e) => setPCategoryId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm"
                >
                  {categories.map((c: any) => (
                    <option key={c.id} value={c.id}>{locName(c, lang)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 4. Prices (Cost + Selling Price) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.products.costPrice}</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={pCostIqd}
                  onChange={(e) => setPCostIqd(e.target.value)}
                  placeholder="0"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.products.sellingPrice}</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={pPriceIqd}
                  onChange={(e) => setPPriceIqd(e.target.value)}
                  placeholder="0"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-black text-emerald-500"
                />
              </div>
            </div>

            {/* 5. Opening Stock & Low Stock Alert */}
            <div className="grid grid-cols-2 gap-3">
              {!editingProductId && (
                <div>
                  <label className="block text-xs font-bold mb-1">{t.products.openingStock}</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={pOpeningStock}
                    onChange={(e) => setPOpeningStock(e.target.value)}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
                  />
                </div>
              )}
              <div className={editingProductId ? 'col-span-2' : ''}>
                <label className="block text-xs font-bold mb-1">{t.products.minStock}</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={pMinStock}
                  onChange={(e) => setPMinStock(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm"
                />
              </div>
            </div>

            {/* Optional Extra Options (Image, SKU, Barcode, Other Languages) */}
            <div className="border-t border-slate-100 dark:border-charcoal-800 pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-500"
              >
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {lang === 'ku' ? 'وێنە و هەڵبژاردنی زیاتر (ئارەزوومەندانە)' : lang === 'ar' ? 'صورة وخيارات إضافية (اختياري)' : 'Image & More Options (Optional)'}
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800">
                  <div className="flex items-center gap-3">
                    {pImageUrl ? (
                      <img src={pImageUrl} alt="preview" className="w-11 h-11 rounded-xl object-cover" />
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-slate-200 dark:bg-charcoal-800 flex items-center justify-center text-slate-400">
                        <ImageIcon className="w-4 h-4" />
                      </div>
                    )}
                    <label className="px-3 py-1.5 rounded-lg bg-emerald-600/15 text-emerald-500 text-xs font-bold cursor-pointer">
                      {t.products.uploadImage}
                      <input type="file" accept="image/*" onChange={handleImageFileChange} className="hidden" />
                    </label>
                    {pImageUrl && (
                      <button type="button" onClick={() => setPImageUrl('')} className="text-xs text-rose-500">
                        {t.delete}
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <input type="text" value={pNameAr} onChange={(e) => setPNameAr(e.target.value)} placeholder="الاسم بالعربية" className="px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                    <input type="text" value={pNameEn} onChange={(e) => setPNameEn(e.target.value)} placeholder="English Name" className="px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {!editingProductId && (
                      <input type="text" value={pSku} onChange={(e) => setPSku(e.target.value)} placeholder="SKU (Auto)" className="px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                    )}
                    <input type="text" value={pBarcode} onChange={(e) => setPBarcode(e.target.value)} placeholder="Barcode" className="px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalMode(null)} className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold">
                {t.cancel}
              </button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg shadow-emerald-600/20">
                {submitting ? t.saving : t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUPER-EASY ADJUST STOCK MODAL (+ ADD vs - REMOVE WITH LIVE PREVIEW) */}
      {modalMode === 'ADJUST' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleAdjustStock} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black">{t.products.adjustStock}</h3>
              <button type="button" onClick={() => setModalMode(null)} className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-slate-400">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">{t.products.productName}</label>
              <SearchableSelect
                value={adjProductId}
                onChange={(id) => {
                  setAdjProductId(id);
                  const found = valuation.items.find((i: any) => i.productId === id);
                  if (found) setAdjUnit(found.unit);
                }}
                options={valuation.items.map((p: any) => ({
                  value: p.productId,
                  label: locName(p, lang),
                  badge: `${fmtQty(p.quantity)} ${unitLabel(p.unit, lang, units)}`,
                }))}
              />
            </div>

            {/* Clear Big ADD / REMOVE Toggle */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setAdjDirection('ADD')}
                className={`py-3 rounded-xl text-xs font-black border flex items-center justify-center gap-1.5 transition ${
                  adjDirection === 'ADD'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow'
                    : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800 text-slate-500'
                }`}
              >
                <Plus className="w-4 h-4" />
                {lang === 'ku' ? 'زیادکردن بۆ کۆگا' : lang === 'ar' ? 'إضافة للمخزون' : 'Add to Stock'}
              </button>
              <button
                type="button"
                onClick={() => setAdjDirection('REMOVE')}
                className={`py-3 rounded-xl text-xs font-black border flex items-center justify-center gap-1.5 transition ${
                  adjDirection === 'REMOVE'
                    ? 'bg-rose-600 text-white border-rose-600 shadow'
                    : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800 text-slate-500'
                }`}
              >
                <Minus className="w-4 h-4" />
                {lang === 'ku' ? 'کەمکردنەوە لە کۆگا' : lang === 'ar' ? 'إنقاص من المخزون' : 'Remove Stock'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-xs font-bold mb-1">{t.sales.qty} *</label>
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  required
                  value={adjQty}
                  onChange={(e) => setAdjQty(e.target.value)}
                  placeholder="10"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-base font-black"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.unit}</label>
                <select
                  value={adjUnit}
                  onChange={(e) => setAdjUnit(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
                >
                  {getCompatibleUnits(adjProduct?.unit || 'kg', units).map((u) => (
                    <option key={u.code} value={u.code}>{locName(u, lang)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Live Stock After Preview */}
            {adjProduct && adjPreview && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 flex items-center justify-between text-xs font-bold">
                <span className="text-slate-400">
                  {lang === 'ku' ? 'کۆگای نوێ دوای گۆڕانکاری:' : lang === 'ar' ? 'المخزون الجديد:' : 'New Stock:'}
                </span>
                <span className={adjDirection === 'ADD' ? 'text-emerald-500 text-sm font-black' : 'text-amber-500 text-sm font-black'}>
                  {fmtQty(adjProduct.quantity)} → {fmtQty(adjPreview.afterBase)} {unitLabel(adjProduct.unit, lang, units)}
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold mb-1">{t.notes}</label>
              <input
                type="text"
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder={lang === 'ku' ? 'هۆکار (ئارەزوومەندانە)...' : 'Reason (optional)...'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModalMode(null)} className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black">
                <CheckCircle2 className="w-4 h-4" />
                {submitting ? t.saving : t.confirm}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SIMPLE RECORD SPOILAGE / WASTE MODAL */}
      {modalMode === 'WASTE' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleRecordWaste} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-rose-500 flex items-center gap-2">
                <Flame className="w-5 h-5" />
                {t.products.recordWaste}
              </h3>
              <button type="button" onClick={() => setModalMode(null)} className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-slate-400">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">{t.products.productName} *</label>
              <SearchableSelect
                value={wstProductId}
                onChange={(id) => {
                  setWstProductId(id);
                  const found = valuation.items.find((i: any) => i.productId === id);
                  if (found) setWstUnit(found.unit);
                }}
                options={valuation.items.map((p: any) => ({
                  value: p.productId,
                  label: locName(p, lang),
                  badge: `${fmtQty(p.quantity)} ${unitLabel(p.unit, lang, units)}`,
                }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-xs font-bold mb-1">{t.sales.qty} *</label>
                <input type="number" step="any" min="0.0001" required value={wstQty} onChange={(e) => setWstQty(e.target.value)} placeholder="1" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-base font-black" />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.unit}</label>
                <select value={wstUnit} onChange={(e) => setWstUnit(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold">
                  {getCompatibleUnits(wstProduct?.unit || 'kg', units).map((u) => (
                    <option key={u.code} value={u.code}>{locName(u, lang)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.products.wasteReason}</label>
                <select value={wstReason} onChange={(e) => setWstReason(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold">
                  {Object.entries(t.products.wasteReasons).map(([k, lbl]) => (
                    <option key={k} value={k}>{lbl}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.date}</label>
                <CustomDatePicker value={wstDate} onChange={setWstDate} lang={lang} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">{t.notes}</label>
              <input type="text" value={wstNotes} onChange={(e) => setWstNotes(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModalMode(null)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-bold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-black">{submitting ? t.saving : t.save}</button>
            </div>
          </form>
        </div>
      )}

      {/* SIMPLE 1-FIELD ADD CATEGORY MODAL */}
      {modalMode === 'CATEGORY' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleCreateCategory} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-black">{t.products.addCategory}</h3>
            <div>
              <label className="block text-xs font-bold mb-1">{t.category} *</label>
              <input
                type="text"
                required
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder={lang === 'ku' ? 'نموونە: خواردنی سارد، گۆشت...' : 'e.g. Frozen Foods, Spices...'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setModalMode(returnToProductAfterSubModal ? 'PRODUCT' : null);
                  setReturnToProductAfterSubModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-bold"
              >
                {t.cancel}
              </button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black">
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SIMPLE ADD CUSTOM UNIT MODAL */}
      {modalMode === 'UNIT' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleCreateUnit} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-black">{t.products.addUnit}</h3>
            <div>
              <label className="block text-xs font-bold mb-1">
                {lang === 'ku' ? 'ناوی یەکە (نموونە: فەردە، لیتر، بتڵ) *' : 'Unit Name *'}
              </label>
              <input
                type="text"
                required
                value={uName}
                onChange={(e) => setUName(e.target.value)}
                placeholder={lang === 'ku' ? 'فەردە' : 'Sack'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
              />
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 space-y-2">
              <div className="text-[11px] font-bold text-slate-400">
                {lang === 'ku' ? 'گۆڕینی خۆکارانە (ئارەزوومەندانە — نموونە: 1 فەردە = 50 کیلۆگرام)' : 'Optional Conversion (e.g. 1 Sack = 50 kg)'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={uLinkBase} onChange={(e) => setULinkBase(e.target.value)} className="px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs font-bold">
                  <option value="">{lang === 'ku' ? 'یەکەی سەربەخۆ' : 'Standalone'}</option>
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>{locName(u, lang)}</option>
                  ))}
                </select>
                {uLinkBase && (
                  <input
                    type="number"
                    step="any"
                    min="0.0001"
                    value={uFactor}
                    onChange={(e) => setUFactor(e.target.value)}
                    placeholder="50"
                    className="px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs font-black"
                  />
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setModalMode(returnToProductAfterSubModal ? 'PRODUCT' : null);
                  setReturnToProductAfterSubModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-bold"
              >
                {t.cancel}
              </button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black">
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
