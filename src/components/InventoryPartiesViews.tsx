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
  Edit3,
  Phone,
  MapPin,
  CheckCircle2,
  XCircle,
  Receipt,
  History,
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
import { CustomDatePicker } from './CustomDatePicker';

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
  const [tab, setTab] = useState<'LIST' | 'UNPAID' | 'HISTORY'>('LIST');
  const [search, setSearch] = useState('');
  const [onlyDebtors, setOnlyDebtors] = useState(false);
  const [showPartyModal, setShowPartyModal] = useState(false);
  const [editingPartyId, setEditingPartyId] = useState<string | null>(null);
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

  // Add / Edit Party Form
  const [partyName, setPartyName] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [partyCity, setPartyCity] = useState('هەولێر');
  const [partyOpeningBalIqd, setPartyOpeningBalIqd] = useState('0');

  const rawList = isCustomerSide ? customers : suppliers;
  const openInvoices = isCustomerSide ? unpaidSalesInvoices : unpaidPurchaseInvoices;
  const sidePayments = useMemo(
    () =>
      debtPayments.filter((dp: any) =>
        isCustomerSide ? dp.type === 'DEBTOR_COLLECTION' : dp.type === 'CREDITOR_PAYMENT'
      ),
    [debtPayments, isCustomerSide]
  );

  const selectedPartyObj = useMemo(
    () => rawList.find((p: any) => p.id === selectedPartyId) || null,
    [rawList, selectedPartyId]
  );

  const openAddParty = () => {
    setEditingPartyId(null);
    setPartyName('');
    setPartyPhone('');
    setPartyCity('هەولێر');
    setPartyOpeningBalIqd('0');
    setShowPartyModal(true);
  };

  const openEditParty = (p: any) => {
    setEditingPartyId(p.id);
    setPartyName(p.name || '');
    setPartyPhone(p.phone || '');
    setPartyCity(p.city || 'هەولێر');
    setPartyOpeningBalIqd('0');
    setShowPartyModal(true);
  };

  const openSettlementFor = (party?: any, invoice?: any) => {
    const withDebt = rawList.find((x: any) => Number(x.balanceIqd || 0) > 0);
    const p = party || withDebt || rawList[0];
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
    if (!selectedPartyId || Number(payAmountIqd) <= 0) {
      notify('error', lang === 'ku' ? 'تکایە بڕی پارە بە دروستی بنووسە' : 'Please enter a valid amount');
      return;
    }
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
          notes: payNotes.trim() || undefined,
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
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editingPartyId
            ? {
                action: isCustomerSide ? 'updateCustomer' : 'updateSupplier',
                ...(isCustomerSide ? { customerId: editingPartyId } : { supplierId: editingPartyId }),
                name: partyName.trim(),
                phone: partyPhone.trim(),
                city: partyCity.trim(),
              }
            : {
                action: isCustomerSide ? 'createCustomer' : 'createSupplier',
                name: partyName.trim(),
                phone: partyPhone.trim(),
                city: partyCity.trim(),
                openingBalanceIqd: Math.max(0, Number(partyOpeningBalIqd || 0)),
              }
        ),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `${partyName.trim()} ✓`);
        setShowPartyModal(false);
        await onRefresh();
      } else notify('error', data.error || 'Could not save');
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenStatement = async (partyId: string) => {
    try {
      const query = isCustomerSide
        ? `statementCustomerId=${partyId}`
        : `statementSupplierId=${partyId}`;
      const res = await fetch(`/api/parties?${query}`);
      const data = await res.json();
      if (res.ok && data.statement) {
        onPrint({ type: 'ACCOUNT_STATEMENT', mode: 'A4', data: data.statement });
      } else notify('error', data.error || 'Failed to load statement');
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    }
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
          (item.phone || '').toLowerCase().includes(q) ||
          (item.city || '').toLowerCase().includes(q)
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

  const debtorsCount = useMemo(
    () => rawList.filter((item: any) => Number(item.balanceIqd || 0) > 0).length,
    [rawList]
  );

  const partyLabel = isCustomerSide ? t.sales.customer : t.purchases.supplier;

  return (
    <div className="space-y-5">
      {/* Clean Header */}
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
          <p className="text-xs text-slate-500 mt-1">
            {isCustomerSide
              ? (lang === 'ku' ? 'بەڕێوەبردنی کڕیاران، وەرگرتنەوەی قەرز و کەشف حساب' : lang === 'ar' ? 'إدارة الزبائن، تحصيل الديون وكشف الحساب' : 'Manage customers, debt collections, and account statements')
              : (lang === 'ku' ? 'بەڕێوەبردنی دابینکەران، دانەوەی قەرز و کەشف حساب' : lang === 'ar' ? 'إدارة الموردين، سداد الديون وكشف الحساب' : 'Manage suppliers, creditor payments, and account statements')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {rawList.length > 0 && (
            <button
              onClick={() => openSettlementFor()}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg shadow-emerald-600/20 transition"
            >
              <Wallet className="w-4 h-4" />
              {isCustomerSide ? t.parties.collectDebt : t.parties.payDebt}
            </button>
          )}

          <button
            onClick={openAddParty}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-slate-200 dark:hover:bg-charcoal-700 text-xs font-bold transition"
          >
            <Plus className="w-4 h-4 text-emerald-500" />
            {isCustomerSide ? t.parties.addCustomer : t.parties.addSupplier}
          </button>
        </div>
      </div>

      {/* Clickable KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <button
          type="button"
          onClick={() => {
            setTab('LIST');
            setOnlyDebtors(false);
          }}
          className={`text-start p-4 rounded-2xl border transition ${
            tab === 'LIST' && !onlyDebtors
              ? 'bg-emerald-500/10 border-emerald-500/50'
              : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/40'
          }`}
        >
          <div className="text-xs text-slate-400">
            {isCustomerSide ? t.parties.customersTitle : t.parties.suppliersTitle}
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{rawList.length}</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setTab('LIST');
            setOnlyDebtors(true);
          }}
          className={`text-start p-4 rounded-2xl border transition ${
            tab === 'LIST' && onlyDebtors
              ? 'bg-rose-500/10 border-rose-500/50'
              : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800 hover:border-rose-500/40'
          }`}
        >
          <div className="text-xs text-slate-400">{t.parties.totalDebt}</div>
          <div className="text-xl font-black text-rose-500 mt-1">{fmtIqd(totalOutstandingIqd, lang)}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {debtorsCount} {t.parties.onlyWithDebt}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setTab('UNPAID')}
          className={`text-start p-4 rounded-2xl border transition ${
            tab === 'UNPAID'
              ? 'bg-amber-500/10 border-amber-500/50'
              : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800 hover:border-amber-500/40'
          }`}
        >
          <div className="text-xs text-slate-400">{t.parties.openInvoices}</div>
          <div className="text-2xl font-black text-amber-500 mt-1">{openInvoices.length}</div>
        </button>
      </div>

      {/* Unified Clean 3-Tab Card */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap justify-between items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setTab('LIST')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                tab === 'LIST' ? 'bg-emerald-600 text-white shadow' : 'bg-slate-100 dark:bg-charcoal-800'
              }`}
            >
              {t.parties.allParties} ({rawList.length})
            </button>
            <button
              onClick={() => setTab('UNPAID')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                tab === 'UNPAID' ? 'bg-amber-600 text-white shadow' : 'bg-slate-100 dark:bg-charcoal-800'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              {t.parties.openInvoices} ({openInvoices.length})
            </button>
            <button
              onClick={() => setTab('HISTORY')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                tab === 'HISTORY' ? 'bg-teal-600 text-white shadow' : 'bg-slate-100 dark:bg-charcoal-800'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              {t.parties.paymentHistory} ({sidePayments.length})
            </button>
          </div>

          {tab === 'LIST' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-52 sm:w-64">
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
                onClick={() => setOnlyDebtors(!onlyDebtors)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition ${
                  onlyDebtors
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-slate-100 dark:bg-charcoal-800 border-transparent'
                }`}
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
                className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
            </div>
          )}
        </div>

        {/* TAB 1: DIRECTORY LIST */}
        {tab === 'LIST' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">{partyLabel}</th>
                  <th className="py-3 px-4 text-start">{t.employees.phone}</th>
                  <th className="py-3 px-4 text-end">{t.due}</th>
                  <th className="py-3 px-4 text-center">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-400">{t.noData}</td>
                  </tr>
                ) : (
                  filteredList.map((p: any) => {
                    const bal = Number(p.balanceIqd || 0);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                        <td className="py-3.5 px-4">
                          <div className="font-black text-slate-900 dark:text-white">{p.name}</div>
                          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                            <span className="font-mono text-emerald-500">{p.code}</span>
                            {p.city && (
                              <span className="flex items-center gap-0.5">
                                <MapPin className="w-3 h-3" /> {p.city}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-500">
                          {p.phone ? (
                            <span dir="ltr" className="inline-flex items-center gap-1.5 font-mono">
                              <Phone className="w-3.5 h-3.5 text-emerald-500" />
                              {p.phone}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-end">
                          {bal > 0 ? (
                            <span className="font-black text-rose-500 text-base">
                              {fmtIqd(bal, lang)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-500 text-xs font-black">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {lang === 'ku' ? 'قەرزی نییە' : lang === 'ar' ? 'لا يوجد دين' : 'Settled'}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            {bal > 0 && (
                              <button
                                onClick={() => openSettlementFor(p)}
                                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
                              >
                                {isCustomerSide ? t.parties.collectDebt : t.parties.payDebt}
                              </button>
                            )}
                            <button
                              onClick={() => handleOpenStatement(p.id)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:text-teal-500 text-xs font-semibold transition"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5 text-teal-500" />
                              {t.parties.statement}
                            </button>
                            <button
                              onClick={() => openEditParty(p)}
                              title={t.edit}
                              className="p-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:text-emerald-500 transition"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: OPEN / UNPAID INVOICES */}
        {tab === 'UNPAID' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">#</th>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">{partyLabel}</th>
                  <th className="py-3 px-4 text-end">{t.total}</th>
                  <th className="py-3 px-4 text-end">{t.paid}</th>
                  <th className="py-3 px-4 text-end">{t.due}</th>
                  <th className="py-3 px-4 text-center">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {openInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">{t.noData}</td>
                  </tr>
                ) : (
                  openInvoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                      <td className="py-3 px-4 font-mono text-xs font-bold text-emerald-500">{inv.invoiceNumber}</td>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {inv.date ? new Date(inv.date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-4 font-bold">{inv.customer?.name || inv.supplier?.name || '—'}</td>
                      <td className="py-3 px-4 text-end font-semibold">{fmtIqd(inv.totalIqd, lang)}</td>
                      <td className="py-3 px-4 text-end font-bold text-emerald-500">{fmtIqd(inv.paidIqd, lang)}</td>
                      <td className="py-3 px-4 text-end font-black text-rose-500">{fmtIqd(inv.dueIqd, lang)}</td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => openSettlementFor(inv.customer || inv.supplier, inv)}
                          className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                        >
                          {isCustomerSide ? t.parties.collectDebt : t.parties.payDebt}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: PAYMENT HISTORY */}
        {tab === 'HISTORY' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">#</th>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">{partyLabel}</th>
                  <th className="py-3 px-4 text-start">{t.notes}</th>
                  <th className="py-3 px-4 text-end">{t.amount}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {sidePayments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">{t.noData}</td>
                  </tr>
                ) : (
                  sidePayments.map((dp: any) => (
                    <tr key={dp.id}>
                      <td className="py-3 px-4 font-mono text-xs font-bold text-emerald-500">{dp.paymentNumber}</td>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {dp.date ? new Date(dp.date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-4 font-bold">{dp.customer?.name || dp.supplier?.name || '—'}</td>
                      <td className="py-3 px-4 text-xs text-slate-400">{dp.notes || '—'}</td>
                      <td className="py-3 px-4 text-end font-black text-emerald-500">{fmtIqd(dp.amountIqd, lang)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SIMPLE COLLECT / PAY DEBT MODAL (WITH QUICK FULL/HALF BUTTONS & LIVE BALANCE PREVIEW) */}
      {showSettlementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 overflow-y-auto">
          <form onSubmit={handleRecordSettlement} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4 my-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black flex items-center gap-2 text-emerald-500">
                <Wallet className="w-5 h-5" />
                {isCustomerSide ? t.parties.collectDebt : t.parties.payDebt}
              </h3>
              <button type="button" onClick={() => setShowSettlementModal(false)} className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-slate-400">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">{partyLabel} *</label>
              <SearchableSelect
                value={selectedPartyId}
                onChange={(id) => {
                  setSelectedPartyId(id);
                  setSelectedInvoiceId('');
                  const p = rawList.find((x: any) => x.id === id);
                  if (p) setPayAmountIqd(Number(p.balanceIqd || 0) > 0 ? String(Math.round(Number(p.balanceIqd))) : '');
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

            {/* Current Debt Summary + Quick Full / Half Buttons */}
            {selectedPartyObj && Number(selectedPartyObj.balanceIqd || 0) > 0 && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 space-y-2.5 text-xs">
                <div className="flex justify-between font-bold">
                  <span className="text-slate-400">{lang === 'ku' ? 'قەرزی ئێستا:' : lang === 'ar' ? 'الدين الحالي:' : 'Current Debt:'}</span>
                  <span className="text-rose-500 font-black text-sm">{fmtIqd(selectedPartyObj.balanceIqd, lang)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayAmountIqd(String(Math.round(Number(selectedPartyObj.balanceIqd))))}
                    className="py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-500 font-bold transition"
                  >
                    {lang === 'ku' ? 'هەموو قەرزەکە' : lang === 'ar' ? 'كامل المبلغ' : 'Full Debt'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayAmountIqd(String(Math.round(Number(selectedPartyObj.balanceIqd) / 2)))}
                    className="py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 font-bold transition"
                  >
                    {lang === 'ku' ? 'نیوەی قەرزەکە' : lang === 'ar' ? 'نصف المبلغ' : 'Half Debt'}
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.amount} *</label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={payAmountIqd}
                  onChange={(e) => setPayAmountIqd(e.target.value)}
                  placeholder="0"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-base font-black text-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.date}</label>
                <CustomDatePicker value={payDate} onChange={setPayDate} lang={lang} />
              </div>
            </div>

            {selectedPartyObj && Number(payAmountIqd || 0) > 0 && Number(selectedPartyObj.balanceIqd || 0) > 0 && (
              <div className="flex justify-between text-xs font-bold px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800">
                <span className="text-slate-400">
                  {lang === 'ku' ? 'قەرزی ماوە دوای پارەدان:' : lang === 'ar' ? 'المتبقي بعد الدفع:' : 'Remaining After Payment:'}
                </span>
                <span className="text-emerald-500 font-black">
                  {fmtIqd(Math.max(0, Number(selectedPartyObj.balanceIqd) - Math.round(Number(payAmountIqd))), lang)}
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold mb-1">{t.nav.cashbank}</label>
              <select value={finAccId} onChange={(e) => setFinAccId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold">
                {financialAccounts.map((fa) => (
                  <option key={fa.id} value={fa.id}>{locName(fa, lang)} ({fmtIqd(fa.balanceIqd, lang)})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">{t.notes}</label>
              <input type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder={lang === 'ku' ? 'تێبینی (ئارەزوومەندانە)...' : 'Notes (optional)...'} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowSettlementModal(false)} className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg shadow-emerald-600/20">
                {submitting ? t.saving : t.confirm}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ADD / EDIT CUSTOMER OR SUPPLIER MODAL */}
      {showPartyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 overflow-y-auto">
          <form onSubmit={handleSaveParty} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4 my-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black">
                {editingPartyId
                  ? `${t.edit} ${partyLabel}`
                  : isCustomerSide
                  ? t.parties.addCustomer
                  : t.parties.addSupplier}
              </h3>
              <button type="button" onClick={() => setShowPartyModal(false)} className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-slate-400">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">{partyLabel} *</label>
              <input type="text" required value={partyName} onChange={(e) => setPartyName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.employees.phone}</label>
                <input type="text" dir="ltr" value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} placeholder="0750XXXXXXX" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{lang === 'ku' ? 'شار' : lang === 'ar' ? 'المدينة' : 'City'}</label>
                <input type="text" value={partyCity} onChange={(e) => setPartyCity(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
              </div>
            </div>
            {!editingPartyId && (
              <div>
                <label className="block text-xs font-bold mb-1">
                  {lang === 'ku' ? 'قەرزی سەرەتایی (د.ع - ئارەزوومەندانە)' : lang === 'ar' ? 'الرصيد الافتتاحي (د.ع)' : 'Opening Debt Balance (IQD)'}
                </label>
                <input type="number" min="0" step="any" value={partyOpeningBalIqd} onChange={(e) => setPartyOpeningBalIqd(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold" />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowPartyModal(false)} className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black">{submitting ? t.saving : t.save}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
