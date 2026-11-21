'use client';

import React, { useState, useMemo } from 'react';
import {
  Boxes,
  Plus,
  Edit3,
  Trash2,
  Archive,
  SlidersHorizontal,
  AlertTriangle,
  Search,
  FolderPlus,
  Ruler,
  Download,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  ArrowLeftRight,
  Package,
  Flame,
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
  const [catFilter, setCatFilter] = useState('ALL');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [modalMode, setModalMode] = useState<
    null | 'PRODUCT' | 'ADJUST' | 'WASTE' | 'TRANSFER' | 'CATEGORY' | 'UNIT'
  >(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [idemKey, setIdemKey] = useState(() => makeIdempotencyKey('inv'));

  const valuation = inventoryData?.valuation || {
    items: [],
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
  const [pUnit, setPUnit] = useState('piece');
  const [pPriceIqd, setPPriceIqd] = useState('');
  const [pCostIqd, setPCostIqd] = useState('');
  const [pOpeningStock, setPOpeningStock] = useState('');
  const [pOpeningUnit, setPOpeningUnit] = useState('piece');
  const [pMinStock, setPMinStock] = useState('5');
  const [pImageUrl, setPImageUrl] = useState('');
  const [pSku, setPSku] = useState('');
  const [pBarcode, setPBarcode] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pWarehouseId, setPWarehouseId] = useState('');

  // Adjust Stock Form
  const [adjProductId, setAdjProductId] = useState('');
  const [adjWarehouseId, setAdjWarehouseId] = useState('');
  const [adjDelta, setAdjDelta] = useState('');
  const [adjUnit, setAdjUnit] = useState('kg');
  const [adjReason, setAdjReason] = useState('');

  // Spoilage / Waste Form
  const [wstProductId, setWstProductId] = useState('');
  const [wstQty, setWstQty] = useState('');
  const [wstUnit, setWstUnit] = useState('kg');
  const [wstReason, setWstReason] = useState('SPOILED');
  const [wstDate, setWstDate] = useState(todayDateStr());
  const [wstNotes, setWstNotes] = useState('');

  // Transfer Form
  const [trfProductId, setTrfProductId] = useState('');
  const [trfFromWh, setTrfFromWh] = useState('');
  const [trfToWh, setTrfToWh] = useState('');
  const [trfQty, setTrfQty] = useState('1');
  const [trfUnit, setTrfUnit] = useState('piece');
  const [trfNotes, setTrfNotes] = useState('');

  // Category Form
  const [catNameKu, setCatNameKu] = useState('');
  const [catNameAr, setCatNameAr] = useState('');
  const [catNameEn, setCatNameEn] = useState('');

  // Custom Unit Form
  const [uNameKu, setUNameKu] = useState('');
  const [uNameAr, setUNameAr] = useState('');
  const [uNameEn, setUNameEn] = useState('');
  const [uSymbol, setUSymbol] = useState('');
  const [uLinkBase, setULinkBase] = useState('');
  const [uFactor, setUFactor] = useState('1');
  const [uAllowDec, setUAllowDec] = useState(true);

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
    const defUnit = defaultType === 'RAW_MATERIAL' ? 'kg' : 'piece';
    setPUnit(defUnit);
    setPOpeningUnit(defUnit);
    setPPriceIqd('');
    setPCostIqd('');
    setPOpeningStock('');
    setPMinStock('5');
    setPImageUrl('');
    setPSku('');
    setPBarcode('');
    setPDesc('');
    setPWarehouseId(warehouses[0]?.id || '');
    setShowAdvanced(false);
    setModalMode('PRODUCT');
  };

  const openEditProduct = (item: any) => {
    setEditingProductId(item.productId);
    setPName(item.nameKu || item.nameEn);
    setPNameAr(item.nameAr || '');
    setPNameEn(item.nameEn || '');
    setPType(item.productType || 'FINISHED_PRODUCT');
    setPCategoryId(item.categoryId || categories[0]?.id || '');
    setPUnit(item.unit || 'piece');
    setPOpeningUnit(item.unit || 'piece');
    setPPriceIqd(String(item.sellingPriceIqd ?? 0));
    setPCostIqd(String(item.purchaseCostIqd ?? 0));
    setPMinStock(String(item.minStockLevel ?? 5));
    setPImageUrl(item.imageUrl || '');
    setPSku(item.sku || '');
    setPBarcode(item.barcode || '');
    setPDesc(item.description || '');
    setShowAdvanced(false);
    setModalMode('PRODUCT');
  };

  const openAdjustModal = (item?: any) => {
    const target = item || valuation.items[0];
    setIdemKey(makeIdempotencyKey('adj'));
    setAdjProductId(target?.productId || '');
    setAdjUnit(target?.unit || 'piece');
    setAdjWarehouseId(warehouses[0]?.id || '');
    setAdjDelta('');
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
            purchaseCostIqd: Number(pCostIqd || 0),
            sellingPriceIqd: Number(pPriceIqd || 0),
            minStockLevel: Number(pMinStock || 0),
            imageUrl: pImageUrl || null,
            barcode: pBarcode || null,
            description: pDesc || null,
          }
        : {
            action: 'createProduct',
            name: pName.trim(),
            nameKu: pName.trim(),
            nameAr: pNameAr.trim() || pName.trim(),
            nameEn: pNameEn.trim() || pName.trim(),
            sku: pSku.trim() || undefined,
            barcode: pBarcode.trim() || null,
            description: pDesc.trim() || null,
            productType: pType,
            categoryId: pCategoryId || categories[0]?.id,
            unit: pUnit,
            purchaseCostIqd: Number(pCostIqd || 0),
            sellingPriceIqd: Number(pPriceIqd || 0),
            minStockLevel: Number(pMinStock || 5),
            initialStock: Number(pOpeningStock || 0),
            initialStockUnit: pOpeningUnit,
            warehouseId: pWarehouseId || warehouses[0]?.id,
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
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOrArchiveProduct = async (item: any) => {
    const action = item.isUsed ? 'archiveProduct' : 'deleteProduct';
    const confirmMsg = item.isUsed
      ? lang === 'ku'
        ? `ئەم بەرهەمە (${locName(item, lang)}) تۆماری هەیە و ناکرێت بسڕدرێتەوە. دەتەوێت ئەرشیف بکرێت؟`
        : lang === 'ar'
        ? `هذا المنتج لديه حركات سابقة ولا يمكن حذفه. هل تريد أرشفته؟`
        : `This product has history and cannot be deleted. Archive it instead?`
      : lang === 'ku'
      ? `دڵنیایت لە سڕینەوەی (${locName(item, lang)})؟`
      : lang === 'ar'
      ? `هل أنت متأكد من حذف (${locName(item, lang)})؟`
      : `Delete unused product "${locName(item, lang)}"?`;

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
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjProductId || !Number(adjDelta)) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjustStock',
          productId: adjProductId,
          warehouseId: adjWarehouseId || warehouses[0]?.id,
          quantityDelta: Number(adjDelta),
          unit: adjUnit,
          reason: adjReason || 'Stock count adjustment',
          idempotencyKey: idemKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Adjustment failed');
      else {
        notify('success', lang === 'ku' ? 'کۆگا بە سەرکەوتوویی نوێکرایەوە!' : 'Stock adjusted successfully!');
        setModalMode(null);
        await onRefresh();
      }
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
          notes: wstNotes,
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
          unit: trfUnit,
          notes: trfNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Transfer failed');
      else {
        notify('success', `${data.transfer.transferNumber} ✓`);
        setModalMode(null);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catNameKu.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createCategory',
          nameKu: catNameKu.trim(),
          nameAr: catNameAr.trim() || catNameKu.trim(),
          nameEn: catNameEn.trim() || catNameKu.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `${locName(data.category, lang)} ✓`);
        setCatNameKu('');
        setCatNameAr('');
        setCatNameEn('');
        setModalMode(null);
        await onRefresh();
      } else notify('error', data.error || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uNameKu.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createUnit',
          nameKu: uNameKu.trim(),
          nameAr: uNameAr.trim() || uNameKu.trim(),
          nameEn: uNameEn.trim() || uNameKu.trim(),
          symbol: uSymbol.trim() || uNameKu.trim(),
          baseUnitCode: uLinkBase || undefined,
          toBaseFactor: uLinkBase ? Number(uFactor || 1) : 1,
          allowDecimal: uAllowDec,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `${locName(data.unit, lang)} ✓`);
        setUNameKu('');
        setUNameAr('');
        setUNameEn('');
        setUSymbol('');
        setULinkBase('');
        setUFactor('1');
        setModalMode(null);
        await onRefresh();
      } else notify('error', data.error || 'Failed to add unit');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredItems = useMemo(() => {
    return (valuation.items || []).filter((item: any) => {
      if (typeFilter !== 'ALL' && item.productType !== typeFilter) return false;
      if (catFilter !== 'ALL' && item.categoryId !== catFilter) return false;
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
  }, [valuation.items, typeFilter, catFilter, onlyLowStock, search]);

  const adjProduct = valuation.items.find((i: any) => i.productId === adjProductId);
  const wstProduct = valuation.items.find((i: any) => i.productId === wstProductId);

  const conversionPreview = (qtyStr: string, fromU: string, toU: string) => {
    const q = Number(qtyStr);
    if (!q || !fromU || !toU || fromU === toU) return null;
    try {
      const conv = convertQuantity(Math.abs(q), fromU, toU, units);
      return `${q < 0 ? '-' : ''}${fmtQty(conv)} ${unitLabel(toU, lang, units)}`;
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Main Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
            <Boxes className="w-6 h-6 text-emerald-500" />
            {t.products.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t.products.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => openAddProduct('FINISHED_PRODUCT')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/25 transition"
          >
            <Plus className="w-4 h-4" />
            {t.products.addProduct}
          </button>

          <button
            onClick={() => openAdjustModal()}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-xs font-bold"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {t.products.adjustStock}
          </button>

          <button
            onClick={() => openWasteModal()}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 text-xs font-bold"
          >
            <Flame className="w-3.5 h-3.5" />
            {t.products.recordWaste}
          </button>

          <button
            onClick={() => setModalMode('CATEGORY')}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
          >
            <FolderPlus className="w-3.5 h-3.5 text-emerald-500" />
            {t.products.addCategory}
          </button>

          <button
            onClick={() => setModalMode('UNIT')}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
          >
            <Ruler className="w-3.5 h-3.5 text-teal-500" />
            {t.products.addUnit}
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.dashboard.inventoryValue}</div>
          <div className="text-xl font-black text-emerald-500 mt-1">
            {fmtIqd(valuation.totalCostValueIqd, lang)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {valuation.totalProducts} {t.products.allItems}
          </div>
        </div>
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.products.finishedProducts}</div>
          <div className="text-xl font-black text-teal-500 mt-1">
            {fmtIqd(valuation.finishedProductValueIqd, lang)}
          </div>
        </div>
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.products.rawMaterials}</div>
          <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
            {fmtIqd(valuation.rawMaterialValueIqd, lang)}
          </div>
        </div>
        <div
          onClick={() => {
            setActiveTab('PRODUCTS');
            setOnlyLowStock(!onlyLowStock);
          }}
          className="cursor-pointer bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800 hover:border-amber-500/50 transition"
        >
          <div className="text-xs text-slate-400">{t.dashboard.lowStockAlerts}</div>
          <div className="text-xl font-black text-amber-500 mt-1">
            {valuation.lowStockCount + valuation.outOfStockCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {onlyLowStock ? '✓ Filtered' : t.products.lowStockOnly}
          </div>
        </div>
      </div>

      {/* Tabs & Content */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'PRODUCTS', label: `${t.products.allItems} (${valuation.items.length})` },
              { id: 'MOVEMENTS', label: `${t.products.movementsTab} (${movements.length})` },
              { id: 'WASTE', label: `${t.products.wasteTab} (${spoilageRecords.length})` },
              { id: 'UNITS', label: `${t.products.unitsTab} (${units.length})` },
            ].map((tb) => (
              <button
                key={tb.id}
                onClick={() => setActiveTab(tb.id as any)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                  activeTab === tb.id
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {activeTab === 'PRODUCTS' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-64">
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
                {t.exportCsv}
              </button>
            </div>
          )}
        </div>

        {/* Sub-filters for Products */}
        {activeTab === 'PRODUCTS' && (
          <>
            <div className="px-4 py-3 bg-slate-50/70 dark:bg-charcoal-950/60 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['ALL', 'FINISHED_PRODUCT', 'RAW_MATERIAL'] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTypeFilter(tf)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                      typeFilter === tf
                        ? 'bg-teal-600 text-white'
                        : 'bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {tf === 'ALL'
                      ? t.all
                      : tf === 'FINISHED_PRODUCT'
                      ? t.products.finishedProducts
                      : t.products.rawMaterials}
                  </button>
                ))}
                <select
                  value={catFilter}
                  onChange={(e) => setCatFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs font-semibold"
                >
                  <option value="ALL">{t.category}: {t.all}</option>
                  {categories.map((c: any) => (
                    <option key={c.id} value={c.id}>{locName(c, lang)}</option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyLowStock}
                  onChange={(e) => setOnlyLowStock(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span>{t.products.lowStockOnly}</span>
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                  <tr>
                    <th className="py-3 px-4 text-start">{t.products.productName}</th>
                    <th className="py-3 px-4 text-start">{t.category}</th>
                    <th className="py-3 px-4 text-center">{t.products.currentStock}</th>
                    <th className="py-3 px-4 text-end">{t.products.costPrice}</th>
                    <th className="py-3 px-4 text-end">{t.products.sellingPrice}</th>
                    <th className="py-3 px-4 text-center">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                  {filteredItems.map((item: any) => (
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
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  item.productType === 'RAW_MATERIAL'
                                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                    : item.productType === 'FINISHED_PRODUCT'
                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-slate-200 dark:bg-charcoal-800 text-slate-500'
                                }`}
                              >
                                {item.productType === 'RAW_MATERIAL'
                                  ? t.products.rawMaterials
                                  : item.productType === 'FINISHED_PRODUCT'
                                  ? t.products.finishedProducts
                                  : 'General'}
                              </span>
                              <span className="text-[11px] font-mono text-slate-400">{item.sku}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {lang === 'ku'
                          ? item.categoryNameKu
                          : lang === 'ar'
                          ? item.categoryNameAr
                          : item.categoryNameEn}
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
                            onClick={() => openEditProduct(item)}
                            title={t.edit}
                            className="p-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-emerald-500/20 text-slate-600 dark:text-slate-300 hover:text-emerald-500"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openAdjustModal(item)}
                            title={t.products.adjustStock}
                            className="p-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-amber-500/20 text-slate-600 dark:text-slate-300 hover:text-amber-500"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteOrArchiveProduct(item)}
                            title={item.isUsed ? t.archive : t.delete}
                            className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500"
                          >
                            {item.isUsed ? <Archive className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* MOVEMENTS TAB */}
        {activeTab === 'MOVEMENTS' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">{t.products.productName}</th>
                  <th className="py-3 px-4 text-center">{t.status}</th>
                  <th className="py-3 px-4 text-end">Delta</th>
                  <th className="py-3 px-4 text-end">After</th>
                  <th className="py-3 px-4 text-start">{t.description}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {movements.map((m: any) => {
                  const qty = Number(m.quantity);
                  return (
                    <tr key={m.id}>
                      <td className="py-2.5 px-4 text-slate-500">{new Date(m.createdAt).toLocaleDateString()}</td>
                      <td className="py-2.5 px-4 font-bold">{locName(m.product, lang)}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-charcoal-800 font-mono text-[10px]">
                          {m.type}
                        </span>
                      </td>
                      <td className={`py-2.5 px-4 text-end font-black ${qty > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {qty > 0 ? `+${fmtQty(qty)}` : fmtQty(qty)} {unitLabel(m.unit || m.product?.unit, lang, units)}
                      </td>
                      <td className="py-2.5 px-4 text-end font-bold">{fmtQty(m.afterQty)}</td>
                      <td className="py-2.5 px-4 text-slate-500">{m.reason || '—'}</td>
                    </tr>
                  );
                })}
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
                      <td className="py-3 px-4 text-xs text-slate-500">{new Date(sr.date).toLocaleDateString()}</td>
                      <td className="py-3 px-4 font-bold">{locName(sr.product, lang)}</td>
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
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {lang === 'ku'
                  ? 'گۆڕینی خۆکارانە: 1 کیلۆگرام = 1,000 گرام | 500 گرام = 0.5 کیلۆگرام'
                  : lang === 'ar'
                  ? 'التحويل التلقائي: 1 كيلوغرام = 1,000 غرام | 500 غرام = 0.5 كيلوغرام'
                  : 'Automatic conversion: 1 kg = 1,000 g | 500 g = 0.5 kg'}
              </div>
              <button
                onClick={() => setModalMode('UNIT')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.products.addUnit}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {units.map((u) => (
                <div
                  key={u.id}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 flex items-center justify-between"
                >
                  <div>
                    <div className="font-bold text-sm text-slate-900 dark:text-white">
                      {locName(u, lang)} <span className="font-mono text-xs text-emerald-500">({u.code})</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {u.toBaseFactor !== 1
                        ? `1 ${u.code} = ${u.toBaseFactor} ${u.baseUnitCode}`
                        : u.allowDecimal
                        ? 'Decimal enabled'
                        : 'Count / Packaging unit'}
                    </div>
                  </div>
                  {!u.isSystem && (
                    <button
                      onClick={async () => {
                        const res = await fetch('/api/inventory', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'deleteUnit', code: u.code }),
                        });
                        const d = await res.json();
                        if (res.ok) {
                          notify('success', `${u.code} deleted`);
                          await onRefresh();
                        } else notify('error', d.error || 'Could not delete unit');
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

      {/* ADD / EDIT PRODUCT MODAL (SIMPLE BY DEFAULT, ADVANCED COLLAPSIBLE) */}
      {modalMode === 'PRODUCT' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveProduct}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-lg w-full space-y-4 my-8 shadow-2xl"
          >
            <h3 className="text-lg font-black">
              {editingProductId ? t.products.editProduct : t.products.addProduct}
            </h3>

            {/* Product Type Toggle */}
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
                    ? 'bg-emerald-600 text-white border-emerald-600'
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
                    setPOpeningUnit('kg');
                    const rc = categories.find((c: any) => c.code === 'CAT-RAW');
                    if (rc) setPCategoryId(rc.id);
                  }
                }}
                className={`py-2.5 rounded-xl text-xs font-bold border transition ${
                  pType === 'RAW_MATERIAL'
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800'
                }`}
              >
                {t.products.rawMaterials}
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">{t.products.productName} *</label>
              <input
                type="text"
                required
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder={lang === 'ku' ? 'نموونە: کوبە، شاورمە، مریشک...' : 'e.g. Kubba, Shawarma, Chicken...'}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-semibold"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.category}</label>
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
              <div>
                <label className="block text-xs font-bold mb-1">{t.unit}</label>
                <select
                  value={pUnit}
                  onChange={(e) => {
                    setPUnit(e.target.value);
                    setPOpeningUnit(e.target.value);
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
                >
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {locName(u, lang)} ({u.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

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
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold text-emerald-600 dark:text-emerald-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {!editingProductId && (
                <div>
                  <label className="block text-xs font-bold mb-1">{t.products.openingStock}</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={pOpeningStock}
                      onChange={(e) => setPOpeningStock(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
                    />
                    <select
                      value={pOpeningUnit}
                      onChange={(e) => setPOpeningUnit(e.target.value)}
                      className="px-2.5 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-bold"
                    >
                      {getCompatibleUnits(pUnit, units).map((u) => (
                        <option key={u.code} value={u.code}>{u.code}</option>
                      ))}
                    </select>
                  </div>
                  {conversionPreview(pOpeningStock, pOpeningUnit, pUnit) && (
                    <div className="text-[11px] text-emerald-500 font-bold mt-1">
                      = {conversionPreview(pOpeningStock, pOpeningUnit, pUnit)}
                    </div>
                  )}
                </div>
              )}
              <div>
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

            {/* Optional Image Upload */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800">
              {pImageUrl ? (
                <img src={pImageUrl} alt="preview" className="w-12 h-12 rounded-xl object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-slate-200 dark:bg-charcoal-800 flex items-center justify-center text-slate-400">
                  <ImageIcon className="w-5 h-5" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold mb-1">{t.products.productImage}</div>
                <label className="inline-block px-3 py-1 rounded-lg bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 text-xs font-bold cursor-pointer">
                  {t.products.uploadImage}
                  <input type="file" accept="image/*" onChange={handleImageFileChange} className="hidden" />
                </label>
                {pImageUrl && (
                  <button
                    type="button"
                    onClick={() => setPImageUrl('')}
                    className="ms-2 text-xs text-rose-500 hover:underline"
                  >
                    {t.delete}
                  </button>
                )}
              </div>
            </div>

            {/* Expandable Advanced Options */}
            <div className="border-t border-slate-100 dark:border-charcoal-800 pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-500"
              >
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {t.advancedOptions}
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1">العربية</label>
                      <input type="text" value={pNameAr} onChange={(e) => setPNameAr(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">English</label>
                      <input type="text" value={pNameEn} onChange={(e) => setPNameEn(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {!editingProductId && (
                      <div>
                        <label className="block text-xs font-semibold mb-1">SKU</label>
                        <input type="text" value={pSku} onChange={(e) => setPSku(e.target.value)} placeholder="Auto" className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-semibold mb-1">Barcode</label>
                      <input type="text" value={pBarcode} onChange={(e) => setPBarcode(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalMode(null)} className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold">
                {t.cancel}
              </button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black shadow-lg shadow-emerald-600/20">
                {submitting ? t.saving : t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ADJUST STOCK MODAL (WITH COMPATIBLE UNIT CONVERSION) */}
      {modalMode === 'ADJUST' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleAdjustStock} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-black">{t.products.adjustStock}</h3>
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
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-xs font-bold mb-1">+ / - {t.sales.qty}</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={adjDelta}
                  onChange={(e) => setAdjDelta(e.target.value)}
                  placeholder="e.g. 5 or -0.5"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-black"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.unit}</label>
                <select
                  value={adjUnit}
                  onChange={(e) => setAdjUnit(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
                >
                  {getCompatibleUnits(adjProduct?.unit || 'piece', units).map((u) => (
                    <option key={u.code} value={u.code}>{locName(u, lang)}</option>
                  ))}
                </select>
              </div>
            </div>
            {adjProduct && conversionPreview(adjDelta, adjUnit, adjProduct.unit) && (
              <div className="text-xs font-bold text-emerald-500">
                = {conversionPreview(adjDelta, adjUnit, adjProduct.unit)}
              </div>
            )}
            <div>
              <label className="block text-xs font-bold mb-1">{t.notes}</label>
              <input type="text" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModalMode(null)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">{t.confirm}</button>
            </div>
          </form>
        </div>
      )}

      {/* RECORD SPOILAGE / WASTE MODAL */}
      {modalMode === 'WASTE' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleRecordWaste} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-black text-rose-500 flex items-center gap-2">
              <Flame className="w-5 h-5" />
              {t.products.recordWaste}
            </h3>
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
                <input type="number" step="any" min="0.0001" required value={wstQty} onChange={(e) => setWstQty(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-black" />
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
            {wstProduct && conversionPreview(wstQty, wstUnit, wstProduct.unit) && (
              <div className="text-xs font-bold text-rose-500">= -{conversionPreview(wstQty, wstUnit, wstProduct.unit)}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.products.wasteReason}</label>
                <select value={wstReason} onChange={(e) => setWstReason(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs">
                  {Object.entries(t.products.wasteReasons).map(([k, lbl]) => (
                    <option key={k} value={k}>{lbl}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.date}</label>
                <input type="date" value={wstDate} onChange={(e) => setWstDate(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">{t.notes}</label>
              <input type="text" value={wstNotes} onChange={(e) => setWstNotes(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModalMode(null)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold">{t.save}</button>
            </div>
          </form>
        </div>
      )}

      {/* ADD CATEGORY MODAL */}
      {modalMode === 'CATEGORY' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleCreateCategory} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-black">{t.products.addCategory}</h3>
            <div>
              <label className="block text-xs font-bold mb-1">{t.category} *</label>
              <input type="text" required value={catNameKu} onChange={(e) => setCatNameKu(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={catNameAr} onChange={(e) => setCatNameAr(e.target.value)} placeholder="العربية (Optional)" className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
              <input type="text" value={catNameEn} onChange={(e) => setCatNameEn(e.target.value)} placeholder="English (Optional)" className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModalMode(null)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">{t.save}</button>
            </div>
          </form>
        </div>
      )}

      {/* ADD CUSTOM MEASUREMENT UNIT MODAL */}
      {modalMode === 'UNIT' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleCreateUnit} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-black">{t.products.addUnit}</h3>
            <div>
              <label className="block text-xs font-bold mb-1">
                {lang === 'ku' ? 'ناوی یەکە (نموونە: فەردە، کیسە، لیتر) *' : 'Unit Name *'}
              </label>
              <input type="text" required value={uNameKu} onChange={(e) => setUNameKu(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={uNameAr} onChange={(e) => setUNameAr(e.target.value)} placeholder="العربية (Optional)" className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
              <input type="text" value={uNameEn} onChange={(e) => setUNameEn(e.target.value)} placeholder="English (Optional)" className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 space-y-2.5">
              <div className="text-xs font-bold text-slate-500">
                {lang === 'ku' ? 'گۆڕینی خۆکارانە (ئارەزوومەندانە)' : 'Optional Conversion Rule'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={uLinkBase} onChange={(e) => setULinkBase(e.target.value)} className="px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs">
                  <option value="">{lang === 'ku' ? 'یەکەی سەربەخۆ' : 'Standalone unit'}</option>
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>= X {locName(u, lang)} ({u.code})</option>
                  ))}
                </select>
                {uLinkBase && (
                  <input type="number" step="any" min="0.0001" value={uFactor} onChange={(e) => setUFactor(e.target.value)} placeholder="Factor e.g. 50" className="px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs font-bold" />
                )}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={uAllowDec} onChange={(e) => setUAllowDec(e.target.checked)} className="rounded text-emerald-600" />
              <span>{lang === 'ku' ? 'ڕێگەدان بە ژمارەی دەیی (نموونە: 0.5)' : 'Allow fractional decimals (e.g. 0.5)'}</span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModalMode(null)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">{t.save}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
