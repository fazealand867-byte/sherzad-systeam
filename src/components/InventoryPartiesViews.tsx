'use client';

import React, { useState, useMemo } from 'react';
import {
  Users,
  Building2,
  Wallet,
  Plus,
  Download,
  FileSpreadsheet,
  Search,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import {
  exportToCsv,
  fmtIqd,
  locName,
  todayDateStr,
  makeIdempotencyKey,
} from '@/lib/client-utils';
import { SearchableSelect } from './SearchableSelect';
import { PrintableDocument } from './PrintModal';

interface PartiesDebtViewProps {
  mode: 'CUSTOMERS' | 'SUPPLIERS';
  lang: LanguageCode;
  partiesData: any;
  financialAccounts: any[];
  onRefresh: () => Promise<void>;
  onPrint: (doc: PrintableDocument) => void;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function PartiesAndDebtModuleView({
  mode,
  lang,
  partiesData,
  financialAccounts,
  onRefresh,
  onPrint,
  notify,
}: PartiesDebtViewProps) {
  const t = translations[lang];
  const isCustomerSide = mode === 'CUSTOMERS';
  const [search, setSearch] = useState('');
  const [onlyDebtors, setOnlyDebtors] = useState(false);
  const [showAddParty, setShowAddParty] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState(() => makeIdempotencyKey('debt'));

  const customers = partiesData?.customers || [];
  const suppliers = partiesData?.suppliers || [];
  const debtPayments = partiesData?.debtPayments || [];
  const unpaidSalesInvoices = partiesData?.unpaidSalesInvoices || [];
  const unpaidPurchaseInvoices = partiesData?.unpaidPurchaseInvoices || [];

  // Settlement Form State (IQD only!)
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [finAccId, setFinAccId] = useState(financialAccounts[0]?.id || '');
  const [payAmountIqd, setPayAmountIqd] = useState('');
  const [payDate, setPayDate] = useState(todayDateStr());
  const [payNotes, setPayNotes] = useState('');

  // New Party Form (Simple!)
  const [partyName, setPartyName] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [partyCity, setPartyCity] = useState('هەولێر');
  const [partyOpeningBalIqd, setPartyOpeningBalIqd] = useState('0');

  const rawList = isCustomerSide ? customers : suppliers;

  const openSettlementFor = (party?: any, invoice?: any) => {
    const p = party || rawList[0];
    setIdemKey(makeIdempotencyKey('debt'));
    setSelectedPartyId(p?.id || '');
    setSelectedInvoiceId(invoice?.id || '');
    setFinAccId(financialAccounts[0]?.id || '');
    setPayDate(todayDateStr());
    setPayNotes('');
    const defaultIqd = invoice
      ? String(Math.round(Number(invoice.dueIqd || 0)))
      : String(Math.round(Number(p?.balanceIqd || 0)));
    setPayAmountIqd(defaultIqd === '0' ? '' : defaultIqd);
    setShowSettlementModal(true);
  };

  const handleRecordSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyId || Number(payAmountIqd) <= 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isCustomerSide ? 'collectDebt' : 'payCreditor',
          ...(isCustomerSide
            ? { customerId: selectedPartyId, salesInvoiceId: selectedInvoiceId || null }
            : { supplierId: selectedPartyId, purchaseInvoiceId: selectedInvoiceId || null }),
          financialAccountId: finAccId || financialAccounts[0]?.id,
          amountIqd: Number(payAmountIqd),
          date: payDate,
          notes: payNotes,
          idempotencyKey: idemKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Failed to record payment');
      else {
        notify('success', `${data.payment.paymentNumber} — ${fmtIqd(data.payment.amountIqd, lang)} ✓`);
        setShowSettlementModal(false);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isCustomerSide ? 'createCustomer' : 'createSupplier',
          name: partyName.trim(),
          phone: partyPhone.trim(),
          city: partyCity.trim(),
          openingBalanceIqd: Number(partyOpeningBalIqd || 0),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `${partyName.trim()} ✓`);
        setShowAddParty(false);
        setPartyName('');
        setPartyPhone('');
        setPartyOpeningBalIqd('0');
        await onRefresh();
      } else notify('error', data.error || 'Could not save');
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
      onPrint({ type: 'ACCOUNT_STATEMENT', mode: 'A4', data: data.statement });
    } else notify('error', data.error || 'Failed to load statement');
  };

  const filteredList = useMemo(
    () =>
      rawList.filter((item: any) => {
        if (onlyDebtors && Number(item.balanceIqd || 0) <= 0) return false;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          (item.name || '').toLowerCase().includes(q) ||
          (item.code || '').toLowerCase().includes(q) ||
          (item.phone || '').toLowerCase().includes(q)
        );
      }),
    [rawList, onlyDebtors, search]
  );

  const totalOutstandingIqd = useMemo(
    () =>
      rawList.reduce(
        (acc: number, item: any) => acc + Math.max(0, Number(item.balanceIqd || 0)),
        0
      ),
    [rawList]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
            {isCustomerSide ? (
              <Users className="w-6 h-6 text-emerald-500" />
            ) : (
              <Building2 className="w-6 h-6 text-teal-500" />
            )}
            {isCustomerSide ? t.parties.customersTitle : t.parties.suppliersTitle}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">
            <span className="text-slate-400 me-1.5">{t.parties.totalDebt}:</span>
            <span className="font-black text-rose-500 text-sm">{fmtIqd(totalOutstandingIqd, lang)}</span>
          </div>

          {rawList.length > 0 && (
            <button
              onClick={() => openSettlementFor()}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/20"
            >
              <Wallet className="w-4 h-4" />
              {isCustomerSide ? t.parties.collectDebt : t.parties.payDebt}
            </button>
          )}

          <button
            onClick={() => setShowAddParty(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-bold"
          >
            <Plus className="w-4 h-4 text-emerald-500" />
            {isCustomerSide ? t.parties.addCustomer : t.parties.addSupplier}
          </button>
        </div>
      </div>

      {/* Main Directory Table */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap justify-between items-center gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full ps-9 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOnlyDebtors(false)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${!onlyDebtors ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'}`}
            >
              {t.parties.allParties} ({rawList.length})
            </button>
            <button
              onClick={() => setOnlyDebtors(true)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${onlyDebtors ? 'bg-amber-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'}`}
            >
              {t.parties.onlyWithDebt}
            </button>
            <button
              onClick={() =>
                exportToCsv(
                  `${mode.toLowerCase()}-iqd`,
                  ['Code', 'Name', 'Phone', 'City', 'Balance IQD'],
                  filteredList.map((p: any) => [p.code, p.name, p.phone, p.city || '', p.balanceIqd])
                )
              }
              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
              <tr>
                <th className="py-3 px-4 text-start">#</th>
                <th className="py-3 px-4 text-start">{t.employees.name}</th>
                <th className="py-3 px-4 text-start">{t.employees.phone}</th>
                <th className="py-3 px-4 text-end">{t.due}</th>
                <th className="py-3 px-4 text-center">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
              {filteredList.map((p: any) => {
                const bal = Number(p.balanceIqd || 0);
                return (
                  <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-bold text-emerald-500">{p.code}</td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">{p.name}</div>
                      {p.city && <div className="text-xs text-slate-400">{p.city}</div>}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500">{p.phone || '—'}</td>
                    <td className="py-3 px-4 text-end">
                      <span className={`font-black ${bal > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {fmtIqd(bal, lang)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-2">
                        {bal > 0 && (
                          <button
                            onClick={() => openSettlementFor(p)}
                            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                          >
                            {isCustomerSide ? t.parties.collectDebt : t.parties.payDebt}
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenStatement(p.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-teal-500" />
                          {t.parties.statement}
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

      {/* Open Invoices & Payment History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 p-5 space-y-3">
          <h3 className="text-sm font-black">{t.parties.openInvoices}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-2 px-3 text-start">#</th>
                  <th className="py-2 px-3 text-start">{isCustomerSide ? t.sales.customer : t.purchases.supplier}</th>
                  <th className="py-2 px-3 text-end">{t.due}</th>
                  <th className="py-2 px-3 text-center">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {(isCustomerSide ? unpaidSalesInvoices : unpaidPurchaseInvoices).map((inv: any) => (
                  <tr key={inv.id}>
                    <td className="py-2.5 px-3 font-mono font-bold">{inv.invoiceNumber}</td>
                    <td className="py-2.5 px-3 font-semibold">{inv.customer?.name || inv.supplier?.name}</td>
                    <td className="py-2.5 px-3 text-end font-bold text-rose-500">{fmtIqd(inv.dueIqd, lang)}</td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => openSettlementFor(inv.customer || inv.supplier, inv)}
                        className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold"
                      >
                        {isCustomerSide ? t.parties.collectDebt : t.parties.payDebt}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 p-5 space-y-3">
          <h3 className="text-sm font-black">{t.parties.paymentHistory}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-2 px-3 text-start">#</th>
                  <th className="py-2 px-3 text-start">{t.date}</th>
                  <th className="py-2 px-3 text-start">{isCustomerSide ? t.sales.customer : t.purchases.supplier}</th>
                  <th className="py-2 px-3 text-end">{t.amount}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {debtPayments
                  .filter((dp: any) =>
                    isCustomerSide ? dp.type === 'DEBTOR_COLLECTION' : dp.type === 'CREDITOR_PAYMENT'
                  )
                  .map((dp: any) => (
                    <tr key={dp.id}>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-500">{dp.paymentNumber}</td>
                      <td className="py-2.5 px-3 text-slate-500">{new Date(dp.date).toLocaleDateString()}</td>
                      <td className="py-2.5 px-3 font-semibold">{dp.customer?.name || dp.supplier?.name}</td>
                      <td className="py-2.5 px-3 text-end font-bold text-emerald-500">{fmtIqd(dp.amountIqd, lang)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Collect / Pay Debt Modal (IQD Only) */}
      {showSettlementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleRecordSettlement} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-black">
              {isCustomerSide ? t.parties.collectDebt : t.parties.payDebt}
            </h3>
            <div>
              <label className="block text-xs font-bold mb-1">
                {isCustomerSide ? t.sales.customer : t.purchases.supplier} *
              </label>
              <SearchableSelect
                value={selectedPartyId}
                onChange={(id) => {
                  setSelectedPartyId(id);
                  setSelectedInvoiceId('');
                  const p = rawList.find((x: any) => x.id === id);
                  if (p) setPayAmountIqd(String(Math.round(Number(p.balanceIqd || 0))));
                }}
                options={rawList.map((p: any) => ({
                  value: p.id,
                  label: p.name,
                  sublabel: p.phone,
                  badge: fmtIqd(p.balanceIqd, lang),
                  badgeColor: Number(p.balanceIqd) > 0 ? 'rose' : 'emerald',
                }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.amount} *</label>
                <input type="number" min="1" step="any" required value={payAmountIqd} onChange={(e) => setPayAmountIqd(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-base font-black text-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.date}</label>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">{t.nav.cashbank}</label>
              <select value={finAccId} onChange={(e) => setFinAccId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs">
                {financialAccounts.map((fa) => (
                  <option key={fa.id} value={fa.id}>{locName(fa, lang)} ({fmtIqd(fa.balanceIqd, lang)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">{t.notes}</label>
              <input type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowSettlementModal(false)} className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black">{t.confirm}</button>
            </div>
          </form>
        </div>
      )}

      {/* Add Customer / Supplier Modal */}
      {showAddParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleCreateParty} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-black">
              {isCustomerSide ? t.parties.addCustomer : t.parties.addSupplier}
            </h3>
            <div>
              <label className="block text-xs font-bold mb-1">{t.employees.name} *</label>
              <input type="text" required value={partyName} onChange={(e) => setPartyName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-semibold" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.employees.phone}</label>
                <input type="text" value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} placeholder="0750XXXXXXX" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{lang === 'ku' ? 'شار' : lang === 'ar' ? 'المدينة' : 'City'}</label>
                <input type="text" value={partyCity} onChange={(e) => setPartyCity(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">
                {lang === 'ku' ? 'قەرزی سەرەتایی (د.ع - ئارەزوومەندانە)' : lang === 'ar' ? 'الرصيد الافتتاحي (د.ع)' : 'Opening Debt Balance (IQD)'}
              </label>
              <input type="number" min="0" step="any" value={partyOpeningBalIqd} onChange={(e) => setPartyOpeningBalIqd(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddParty(false)} className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black">{t.save}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
