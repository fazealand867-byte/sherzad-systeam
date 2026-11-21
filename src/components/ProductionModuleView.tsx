'use client';

import React, { useState, useMemo } from 'react';
import {
  ChefHat,
  Plus,
  BookOpen,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import {
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
import { CustomDatePicker } from './CustomDatePicker';

interface ProductionModuleProps {
  lang: LanguageCode;
  productionData: any;
  products: any[];
  warehouses: any[];
  units: UnitDefinition[];
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function ProductionModuleView({
  lang,
  productionData,
  products,
  warehouses,
  units,
  onRefresh,
  notify,
}: ProductionModuleProps) {
  const t = translations[lang];
  const [tab, setTab] = useState<'BATCHES' | 'RECIPES'>('BATCHES');
  const [modal, setModal] = useState<null | 'RECORD' | 'RECIPE'>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState(() => makeIdempotencyKey('prd'));

  const recipes = productionData?.recipes || [];
  const batches = productionData?.batches || [];

  const finishedProducts = useMemo(
    () => products.filter((p) => p.productType !== 'RAW_MATERIAL'),
    [products]
  );
  const rawMaterials = useMemo(
    () => products.filter((p) => p.productType === 'RAW_MATERIAL' || p.productType === 'GENERAL'),
    [products]
  );

  // Record Production Modal State
  const [mode, setMode] = useState<'RECIPE' | 'MANUAL'>('RECIPE');
  const [finishedProductId, setFinishedProductId] = useState('');
  const [qtyProduced, setQtyProduced] = useState('100');
  const [prodUnit, setProdUnit] = useState('piece');
  const [prodDate, setProdDate] = useState(todayDateStr());
  const [prodNotes, setProdNotes] = useState('');
  const [allowNeg, setAllowNeg] = useState(false);
  const [batchMaterials, setBatchMaterials] = useState<
    { rawMaterialId: string; quantity: string; unit: string }[]
  >([]);

  // Recipe Modal State
  const [recipeFinishedId, setRecipeFinishedId] = useState('');
  const [recipeYieldQty, setRecipeYieldQty] = useState('100');
  const [recipeYieldUnit, setRecipeYieldUnit] = useState('piece');
  const [recipeNotes, setRecipeNotes] = useState('');
  const [recipeIngredients, setRecipeIngredients] = useState<
    { rawMaterialId: string; quantity: string; unit: string }[]
  >([]);

  const syncRecipeMaterials = (fpId: string, qtyStr: string, unitCode: string, nextMode: 'RECIPE' | 'MANUAL') => {
    const r = recipes.find((x: any) => x.finishedProductId === fpId);
    const fp = products.find((p) => p.id === fpId);
    if (nextMode === 'RECIPE' && r && fp && Number(qtyStr) > 0) {
      try {
        const producedBase = convertQuantity(Number(qtyStr), unitCode, fp.unit, units);
        const yieldBase = convertQuantity(Number(r.yieldQuantity), r.yieldUnit, fp.unit, units);
        const scale = yieldBase > 0 ? producedBase / yieldBase : 1;
        setBatchMaterials(
          (r.ingredients || []).map((ing: any) => ({
            rawMaterialId: ing.rawMaterialId,
            quantity: String(Number((Number(ing.quantity) * scale).toFixed(4))),
            unit: ing.unit,
          }))
        );
      } catch {
        setBatchMaterials([]);
      }
    } else if (nextMode === 'RECIPE' && !r) {
      setBatchMaterials([]);
    }
  };

  const openRecordProduction = (preselectedFpId?: string) => {
    setIdemKey(makeIdempotencyKey('prd'));
    const fpId = preselectedFpId || recipes[0]?.finishedProductId || finishedProducts[0]?.id || '';
    const fp = products.find((p) => p.id === fpId);
    const hasRecipe = recipes.some((r: any) => r.finishedProductId === fpId);
    const initMode: 'RECIPE' | 'MANUAL' = hasRecipe ? 'RECIPE' : 'MANUAL';
    const r = recipes.find((x: any) => x.finishedProductId === fpId);
    const initQty = r ? String(r.yieldQuantity) : '10';
    const initUnit = r?.yieldUnit || fp?.unit || 'piece';

    setFinishedProductId(fpId);
    setMode(initMode);
    setQtyProduced(initQty);
    setProdUnit(initUnit);
    setProdDate(todayDateStr());
    setProdNotes('');
    setAllowNeg(false);
    if (initMode === 'RECIPE') {
      syncRecipeMaterials(fpId, initQty, initUnit, 'RECIPE');
    } else {
      setBatchMaterials([]);
    }
    setModal('RECORD');
  };

  const openRecipeModal = (existing?: any) => {
    const fpId = existing?.finishedProductId || finishedProducts[0]?.id || '';
    const fp = products.find((p) => p.id === fpId);
    setRecipeFinishedId(fpId);
    setRecipeYieldQty(String(existing?.yieldQuantity || 100));
    setRecipeYieldUnit(existing?.yieldUnit || fp?.unit || 'piece');
    setRecipeNotes(existing?.notes || '');
    setRecipeIngredients(
      existing?.ingredients?.length
        ? existing.ingredients.map((i: any) => ({
            rawMaterialId: i.rawMaterialId,
            quantity: String(i.quantity),
            unit: i.unit,
          }))
        : rawMaterials[0]
        ? [{ rawMaterialId: rawMaterials[0].id, quantity: '1', unit: rawMaterials[0].unit }]
        : []
    );
    setModal('RECIPE');
  };

  const selectedFp = products.find((p) => p.id === finishedProductId);

  const estimatedBatchCost = useMemo(() => {
    let total = 0;
    for (const m of batchMaterials) {
      const rm = products.find((p) => p.id === m.rawMaterialId);
      if (!rm || !Number(m.quantity)) continue;
      try {
        const baseQty = convertQuantity(Number(m.quantity), m.unit, rm.unit, units);
        total += baseQty * Number(rm.purchaseCostIqd || 0);
      } catch {}
    }
    return Math.round(total);
  }, [batchMaterials, products, units]);

  const handleRecordProduction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finishedProductId || Number(qtyProduced) <= 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'recordProduction',
          mode,
          finishedProductId,
          quantityProduced: Number(qtyProduced),
          unit: prodUnit,
          warehouseId: warehouses[0]?.id,
          date: prodDate,
          notes: prodNotes,
          allowNegativeStock: allowNeg,
          idempotencyKey: idemKey,
          materialsUsed: batchMaterials
            .filter((m) => m.rawMaterialId && Number(m.quantity) > 0)
            .map((m) => ({
              rawMaterialId: m.rawMaterialId,
              quantity: Number(m.quantity),
              unit: m.unit,
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to record production');
      } else {
        notify('success', `${data.batch.batchNumber} ✓`);
        setModal(null);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipeFinishedId || recipeIngredients.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveRecipe',
          finishedProductId: recipeFinishedId,
          yieldQuantity: Number(recipeYieldQty),
          yieldUnit: recipeYieldUnit,
          notes: recipeNotes,
          ingredients: recipeIngredients
            .filter((i) => i.rawMaterialId && Number(i.quantity) > 0)
            .map((i) => ({
              rawMaterialId: i.rawMaterialId,
              quantity: Number(i.quantity),
              unit: i.unit,
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Failed to save recipe');
      else {
        notify('success', `${t.production.recipesTab} ✓`);
        setModal(null);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverseBatch = async (batch: any) => {
    if (!window.confirm(`${t.production.reverseBatch} ${batch.batchNumber}?`)) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverseProduction', batchId: batch.id }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `${batch.batchNumber} reversed`);
        await onRefresh();
      } else notify('error', data.error || 'Could not reverse batch');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
            <ChefHat className="w-6 h-6 text-emerald-500" />
            {t.production.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t.production.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => openRecipeModal()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600/15 hover:bg-teal-600/25 text-teal-600 dark:text-teal-400 border border-teal-500/30 text-sm font-bold"
          >
            <BookOpen className="w-4 h-4" />
            {t.production.addRecipe}
          </button>
          <button
            onClick={() => openRecordProduction()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/25 transition"
          >
            <Plus className="w-4 h-4" />
            {t.production.recordBatch}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex items-center gap-2">
          <button
            onClick={() => setTab('BATCHES')}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${
              tab === 'BATCHES' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'
            }`}
          >
            {t.production.batchesTab} ({batches.length})
          </button>
          <button
            onClick={() => setTab('RECIPES')}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${
              tab === 'RECIPES' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'
            }`}
          >
            {t.production.recipesTab} ({recipes.length})
          </button>
        </div>

        {tab === 'BATCHES' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">#</th>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">{t.production.finishedProduct}</th>
                  <th className="py-3 px-4 text-center">{t.production.quantityProduced}</th>
                  <th className="py-3 px-4 text-start">{t.production.ingredientsNeeded}</th>
                  <th className="py-3 px-4 text-end">{t.products.costPrice}</th>
                  <th className="py-3 px-4 text-center">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {batches.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      {t.noData}
                    </td>
                  </tr>
                ) : (
                  batches.map((b: any) => (
                    <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                      <td className="py-3 px-4 font-mono text-xs font-bold text-emerald-500">
                        {b.batchNumber}
                        <div className="text-[10px] text-slate-400">{b.mode}</div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500">{new Date(b.date).toLocaleDateString()}</td>
                      <td className="py-3 px-4 font-bold">{locName(b.finishedProduct, lang)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-500 font-black text-xs">
                          +{fmtQty(b.quantityProduced)} {unitLabel(b.unit, lang, units)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {(b.materialsUsed || []).length === 0
                          ? '—'
                          : (b.materialsUsed || [])
                              .map((m: any) => `${locName(m.rawMaterial, lang) || m.rawMaterialName}: ${fmtQty(m.quantity)} ${unitLabel(m.unit, lang, units)}`)
                              .join(' • ')}
                      </td>
                      <td className="py-3 px-4 text-end font-bold">
                        {fmtIqd(b.totalBatchValueIqd, lang)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {b.status === 'COMPLETED' ? (
                          <button
                            onClick={() => handleReverseBatch(b)}
                            disabled={submitting}
                            title={t.production.reverseBatch}
                            className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-500 text-[10px] font-bold">
                            {t.statuses.REVERSED}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'RECIPES' && (
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recipes.length === 0 ? (
              <div className="col-span-full py-12 text-center text-slate-400">{t.noData}</div>
            ) : (
              recipes.map((r: any) => (
                <div
                  key={r.id}
                  className="p-5 rounded-2xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 flex flex-col justify-between space-y-4"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-black text-base text-slate-900 dark:text-white">
                          {locName(r.finishedProduct, lang)}
                        </div>
                        <div className="text-xs text-emerald-500 font-bold mt-0.5">
                          {t.production.yieldQty}: {fmtQty(r.yieldQuantity)} {unitLabel(r.yieldUnit, lang, units)}
                        </div>
                      </div>
                      <button
                        onClick={() => openRecipeModal(r)}
                        className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-charcoal-800 text-xs font-bold"
                      >
                        {t.edit}
                      </button>
                    </div>

                    <div className="mt-3 space-y-1.5 border-t border-slate-200 dark:border-charcoal-800 pt-3">
                      {(r.ingredients || []).map((ing: any, idx: number) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {locName(ing.rawMaterial, lang)}
                          </span>
                          <span className="font-mono font-bold text-slate-500">
                            {fmtQty(ing.quantity)} {unitLabel(ing.unit, lang, units)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200 dark:border-charcoal-800 flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <div className="text-slate-400">{t.production.unitCost}</div>
                      <div className="font-black text-emerald-500">{fmtIqd(r.estimatedUnitCostIqd, lang)}</div>
                    </div>
                    <button
                      onClick={() => openRecordProduction(r.finishedProductId)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                    >
                      + {t.production.recordBatch}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* RECORD PRODUCTION BATCH MODAL */}
      {modal === 'RECORD' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 overflow-y-auto">
          <form
            onSubmit={handleRecordProduction}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-xl w-full space-y-4 my-8 shadow-2xl"
          >
            <h3 className="text-lg font-black flex items-center gap-2">
              <ChefHat className="w-5 h-5 text-emerald-500" />
              {t.production.recordBatch}
            </h3>

            {/* Mode Switcher: Recipe vs Simple Manual */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('RECIPE');
                  syncRecipeMaterials(finishedProductId, qtyProduced, prodUnit, 'RECIPE');
                }}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border transition ${
                  mode === 'RECIPE'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                {t.production.recipeMode}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('MANUAL');
                  setBatchMaterials([]);
                }}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border transition ${
                  mode === 'MANUAL'
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800'
                }`}
              >
                <Wrench className="w-4 h-4" />
                {t.production.manualMode}
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">{t.production.finishedProduct} *</label>
              <SearchableSelect
                value={finishedProductId}
                onChange={(id) => {
                  setFinishedProductId(id);
                  const fp = products.find((p) => p.id === id);
                  const u = fp?.unit || 'piece';
                  setProdUnit(u);
                  syncRecipeMaterials(id, qtyProduced, u, mode);
                }}
                options={finishedProducts.map((p) => ({
                  value: p.id,
                  label: locName(p, lang),
                  badge: `${fmtQty(p.totalStock)} ${unitLabel(p.unit, lang, units)}`,
                }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.production.quantityProduced} *</label>
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  required
                  value={qtyProduced}
                  onChange={(e) => {
                    setQtyProduced(e.target.value);
                    syncRecipeMaterials(finishedProductId, e.target.value, prodUnit, mode);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-base font-black text-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.unit}</label>
                <select
                  value={prodUnit}
                  onChange={(e) => {
                    setProdUnit(e.target.value);
                    syncRecipeMaterials(finishedProductId, qtyProduced, e.target.value, mode);
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold"
                >
                  {getCompatibleUnits(selectedFp?.unit || 'piece', units).map((u) => (
                    <option key={u.code} value={u.code}>{locName(u, lang)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.date}</label>
                <CustomDatePicker value={prodDate} onChange={setProdDate} lang={lang} />
              </div>
            </div>

            {/* Raw Materials Consumed List */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  {t.production.ingredientsNeeded}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setBatchMaterials([
                      ...batchMaterials,
                      { rawMaterialId: rawMaterials[0]?.id || '', quantity: '1', unit: rawMaterials[0]?.unit || 'kg' },
                    ])
                  }
                  className="text-xs text-emerald-500 font-bold hover:underline"
                >
                  {t.production.addIngredient}
                </button>
              </div>

              {batchMaterials.length === 0 ? (
                <div className="text-xs text-slate-400 py-2">
                  {mode === 'RECIPE'
                    ? lang === 'ku'
                      ? 'هیچ ڕێسپییەک بۆ ئەم بەرهەمە نییە. دەتوانیت کەرەستەکان زیاد بکەیت یان دۆخی سادە بەکاربهێنیت.'
                      : 'No saved recipe for this product yet. Add materials below or use Manual Mode.'
                    : lang === 'ku'
                    ? 'ئارەزوومەندانە: کەرەستە خاوە بەکارهاتووەکان زیاد بکە'
                    : 'Optional: add raw materials consumed in this batch'}
                </div>
              ) : (
                <div className="space-y-2">
                  {batchMaterials.map((m, idx) => {
                    const rm = products.find((p) => p.id === m.rawMaterialId);
                    let reqBase = Number(m.quantity || 0);
                    if (rm) {
                      try {
                        reqBase = convertQuantity(reqBase, m.unit, rm.unit, units);
                      } catch {}
                    }
                    const avail = Number(rm?.totalStock || 0);
                    const isShort = rm && reqBase > avail + 0.0001;

                    return (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-5">
                          <select
                            value={m.rawMaterialId}
                            onChange={(e) => {
                              const copy = [...batchMaterials];
                              copy[idx].rawMaterialId = e.target.value;
                              const nextRm = products.find((p) => p.id === e.target.value);
                              if (nextRm) copy[idx].unit = nextRm.unit;
                              setBatchMaterials(copy);
                            }}
                            className="w-full px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs font-semibold"
                          >
                            {rawMaterials.map((r) => (
                              <option key={r.id} value={r.id}>
                                {locName(r, lang)} ({fmtQty(r.totalStock)} {unitLabel(r.unit, lang, units)})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-3">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={m.quantity}
                            onChange={(e) => {
                              const copy = [...batchMaterials];
                              copy[idx].quantity = e.target.value;
                              setBatchMaterials(copy);
                            }}
                            className={`w-full px-2.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border text-xs font-bold text-center ${
                              isShort ? 'border-rose-500 text-rose-500' : 'border-slate-200 dark:border-charcoal-800'
                            }`}
                          />
                        </div>
                        <div className="col-span-3">
                          <select
                            value={m.unit}
                            onChange={(e) => {
                              const copy = [...batchMaterials];
                              copy[idx].unit = e.target.value;
                              setBatchMaterials(copy);
                            }}
                            className="w-full px-2 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                          >
                            {getCompatibleUnits(rm?.unit || 'kg', units).map((u) => (
                              <option key={u.code} value={u.code}>{locName(u, lang)}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-1 text-center">
                          <button
                            type="button"
                            onClick={() => setBatchMaterials(batchMaterials.filter((_, i) => i !== idx))}
                            className="text-rose-500 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {isShort && (
                          <div className="col-span-12 text-[11px] text-rose-500 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {t.production.available}: {fmtQty(avail)} {unitLabel(rm?.unit, lang, units)} | {t.production.required}: {fmtQty(reqBase)} {unitLabel(rm?.unit, lang, units)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {estimatedBatchCost > 0 && (
                <div className="pt-2 border-t border-slate-200 dark:border-charcoal-800 flex justify-between text-xs font-bold">
                  <span className="text-slate-500">{t.production.estimatedCost}:</span>
                  <span className="text-emerald-500">{fmtIqd(estimatedBatchCost, lang)}</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">{t.notes}</label>
              <input type="text" value={prodNotes} onChange={(e) => setProdNotes(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
              <input type="checkbox" checked={allowNeg} onChange={(e) => setAllowNeg(e.target.checked)} className="rounded text-emerald-600" />
              <span>{lang === 'ku' ? 'ڕێگەدان بە کەمبوونەوەی کەرەستەی خاو لە ژێر سفر' : 'Allow raw material stock below zero'}</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModal(null)} className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg shadow-emerald-600/25">
                <CheckCircle2 className="w-4 h-4" />
                {submitting ? t.saving : t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SAVE RECIPE MODAL */}
      {modal === 'RECIPE' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 overflow-y-auto">
          <form onSubmit={handleSaveRecipe} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-xl w-full space-y-4 my-8 shadow-2xl">
            <h3 className="text-lg font-black">{t.production.addRecipe}</h3>
            <div>
              <label className="block text-xs font-bold mb-1">{t.production.finishedProduct} *</label>
              <SearchableSelect
                value={recipeFinishedId}
                onChange={(id) => {
                  setRecipeFinishedId(id);
                  const fp = products.find((p) => p.id === id);
                  if (fp) setRecipeYieldUnit(fp.unit);
                }}
                options={finishedProducts.map((p) => ({ value: p.id, label: locName(p, lang) }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.production.yieldQty} *</label>
                <input type="number" step="any" min="0.0001" required value={recipeYieldQty} onChange={(e) => setRecipeYieldQty(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold" />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.unit}</label>
                <select value={recipeYieldUnit} onChange={(e) => setRecipeYieldUnit(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold">
                  {getCompatibleUnits(products.find((p) => p.id === recipeFinishedId)?.unit || 'piece', units).map((u) => (
                    <option key={u.code} value={u.code}>{locName(u, lang)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold">{t.production.ingredientsNeeded}</span>
                <button
                  type="button"
                  onClick={() =>
                    setRecipeIngredients([
                      ...recipeIngredients,
                      { rawMaterialId: rawMaterials[0]?.id || '', quantity: '1', unit: rawMaterials[0]?.unit || 'kg' },
                    ])
                  }
                  className="text-xs text-emerald-500 font-bold"
                >
                  {t.production.addIngredient}
                </button>
              </div>
              {recipeIngredients.map((ing, idx) => {
                const rm = products.find((p) => p.id === ing.rawMaterialId);
                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <select
                        value={ing.rawMaterialId}
                        onChange={(e) => {
                          const c = [...recipeIngredients];
                          c[idx].rawMaterialId = e.target.value;
                          const next = products.find((p) => p.id === e.target.value);
                          if (next) c[idx].unit = next.unit;
                          setRecipeIngredients(c);
                        }}
                        className="w-full px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                      >
                        {rawMaterials.map((r) => (
                          <option key={r.id} value={r.id}>{locName(r, lang)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        step="any"
                        min="0.0001"
                        required
                        value={ing.quantity}
                        onChange={(e) => {
                          const c = [...recipeIngredients];
                          c[idx].quantity = e.target.value;
                          setRecipeIngredients(c);
                        }}
                        className="w-full px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold text-center"
                      />
                    </div>
                    <div className="col-span-3">
                      <select
                        value={ing.unit}
                        onChange={(e) => {
                          const c = [...recipeIngredients];
                          c[idx].unit = e.target.value;
                          setRecipeIngredients(c);
                        }}
                        className="w-full px-2 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                      >
                        {getCompatibleUnits(rm?.unit || 'kg', units).map((u) => (
                          <option key={u.code} value={u.code}>{locName(u, lang)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-1 text-center">
                      <button type="button" onClick={() => setRecipeIngredients(recipeIngredients.filter((_, i) => i !== idx))} className="text-rose-500 p-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModal(null)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold">{t.save}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
