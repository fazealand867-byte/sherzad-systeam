'use client';

import React, { useState, useMemo } from 'react';
import {
  Plus,
  Landmark,
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  BookOpen,
  RotateCcw,
  Lock,
  Unlock,
  Download,
  ShieldCheck,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import { exportToCsv, fmtIqd, locName } from '@/lib/client-utils';

/* ============================================================================
   1. CASH & BANK MANAGEMENT (IQD-ONLY)
   ============================================================================ */

export function CashBankModuleView({
  lang,
  cashBankData,
  onRefresh,
  notify,
}: {
  lang: LanguageCode;
  cashBankData: any;
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}) {
  const t = translations[lang];
  const accounts = cashBankData?.accounts || [];
  const transactions = cashBankData?.transactions || [];
  const [modal, setModal] = useState<null | 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'RECONCILE' | 'NEW_ACCOUNT'>(null);
  const [submitting, setSubmitting] = useState(false);

  const [primaryAccId, setPrimaryAccId] = useState(accounts[0]?.id || '');
  const [targetAccId, setTargetAccId] = useState(accounts[1]?.id || accounts[0]?.id || '');
  const [amountIqd, setAmountIqd] = useState('');
  const [description, setDescription] = useState('');
  const [postAdj, setPostAdj] = useState(true);

  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState('CASH_REGISTER');
  const [newAccBankName, setNewAccBankName] = useState('');

  const handleActionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let payload: any = {};
      if (modal === 'DEPOSIT' || modal === 'WITHDRAWAL') {
        payload = {
          action: modal === 'DEPOSIT' ? 'deposit' : 'withdrawal',
          financialAccountId: primaryAccId || accounts[0]?.id,
          amountIqd: Number(amountIqd),
          description,
        };
      } else if (modal === 'TRANSFER') {
        payload = {
          action: 'transfer',
          fromFinancialAccountId: primaryAccId,
          toFinancialAccountId: targetAccId,
          amountIqd: Number(amountIqd),
          description,
        };
      } else if (modal === 'RECONCILE') {
        payload = {
          action: 'reconcile',
          financialAccountId: primaryAccId,
          statementBalanceIqd: Number(amountIqd),
          postAdjustment: postAdj,
          notes: description,
        };
      } else if (modal === 'NEW_ACCOUNT') {
        payload = {
          action: 'createAccount',
          nameKu: newAccName,
          nameAr: newAccName,
          nameEn: newAccName,
          type: newAccType,
          bankName: newAccBankName,
        };
      }

      const res = await fetch('/api/cashbank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Operation failed');
      else {
        notify('success', `${t.nav.cashbank} ✓`);
        setModal(null);
        setAmountIqd('');
        setDescription('');
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
            <Landmark className="w-6 h-6 text-emerald-500" />
            {t.nav.cashbank}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{t.currencyLabel}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setPrimaryAccId(accounts[0]?.id || ''); setModal('DEPOSIT'); }} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold">
            <ArrowDownLeft className="w-4 h-4" />
            {lang === 'ku' ? 'زیادکردنی پارە' : lang === 'ar' ? 'إيداع' : 'Deposit'}
          </button>
          <button onClick={() => { setPrimaryAccId(accounts[0]?.id || ''); setModal('WITHDRAWAL'); }} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold">
            <ArrowUpRight className="w-4 h-4" />
            {lang === 'ku' ? 'ڕاکێشانی پارە' : lang === 'ar' ? 'سحب' : 'Withdrawal'}
          </button>
          <button onClick={() => { setPrimaryAccId(accounts[0]?.id || ''); setTargetAccId(accounts[1]?.id || accounts[0]?.id || ''); setModal('TRANSFER'); }} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-600 text-white text-xs font-bold">
            <ArrowLeftRight className="w-4 h-4" />
            {lang === 'ku' ? 'گواستنەوە' : lang === 'ar' ? 'تحويل' : 'Transfer'}
          </button>
          <button onClick={() => { setPrimaryAccId(accounts[0]?.id || ''); setModal('RECONCILE'); }} className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-500/15 text-amber-500 border border-amber-500/30 text-xs font-bold">
            <Scale className="w-3.5 h-3.5" />
            {lang === 'ku' ? 'ڕێکخستنی باڵانس' : lang === 'ar' ? 'مطابقة' : 'Reconcile'}
          </button>
          <button onClick={() => setModal('NEW_ACCOUNT')} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {accounts.map((acc: any) => (
          <div key={acc.id} className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm space-y-3">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span>{acc.code}</span>
              <span className={`px-2 py-0.5 rounded font-bold ${acc.type === 'BANK_ACCOUNT' ? 'bg-teal-500/15 text-teal-400' : 'bg-emerald-500/15 text-emerald-500'}`}>
                {acc.type === 'BANK_ACCOUNT' ? 'BANK' : 'SAFE'}
              </span>
            </div>
            <div className="font-bold text-sm text-slate-900 dark:text-white">{locName(acc, lang)}</div>
            <div className="pt-2 border-t border-slate-100 dark:border-charcoal-800 text-xl font-black text-emerald-500">
              {fmtIqd(acc.balanceIqd, lang)}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
          <h3 className="text-sm font-black">{t.dashboard.recentActivity}</h3>
          <button
            onClick={() =>
              exportToCsv(
                'cash-bank-iqd',
                ['Tx #', 'Date', 'Account', 'Type', 'Direction', 'Amount IQD', 'Description'],
                transactions.map((tx: any) => [tx.transactionNumber, new Date(tx.date).toISOString().slice(0, 10), locName(tx.financialAccount, lang), tx.type, tx.direction, tx.amountIqd, tx.description])
              )
            }
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" /> {t.exportCsv}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
              <tr>
                <th className="py-3 px-4 text-start">#</th>
                <th className="py-3 px-4 text-start">{t.date}</th>
                <th className="py-3 px-4 text-start">{t.nav.cashbank}</th>
                <th className="py-3 px-4 text-start">{t.description}</th>
                <th className="py-3 px-4 text-end">{t.amount}</th>
                <th className="py-3 px-4 text-end">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
              {transactions.map((tx: any) => (
                <tr key={tx.id}>
                  <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">{tx.transactionNumber}</td>
                  <td className="py-2.5 px-4 text-slate-500">{new Date(tx.date).toLocaleDateString()}</td>
                  <td className="py-2.5 px-4 font-semibold">{locName(tx.financialAccount, lang)}</td>
                  <td className="py-2.5 px-4 text-slate-500">{tx.description}</td>
                  <td className={`py-2.5 px-4 text-end font-black ${tx.direction === 'IN' ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {tx.direction === 'IN' ? '+' : '-'}{fmtIqd(tx.amountIqd, lang)}
                  </td>
                  <td className="py-2.5 px-4 text-end font-bold">{fmtIqd(tx.balanceAfterIqd, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleActionSubmit} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-black">{modal}</h3>
            {modal !== 'NEW_ACCOUNT' ? (
              <>
                <select value={primaryAccId} onChange={(e) => setPrimaryAccId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs">
                  {accounts.map((a: any) => <option key={a.id} value={a.id}>{locName(a, lang)} ({fmtIqd(a.balanceIqd, lang)})</option>)}
                </select>
                {modal === 'TRANSFER' && (
                  <select value={targetAccId} onChange={(e) => setTargetAccId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs">
                    {accounts.map((a: any) => <option key={a.id} value={a.id}>{locName(a, lang)}</option>)}
                  </select>
                )}
                <input type="number" step="any" required placeholder={t.amount} value={amountIqd} onChange={(e) => setAmountIqd(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-base font-black text-emerald-500" />
                <input type="text" placeholder={t.notes} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
                {modal === 'RECONCILE' && (
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={postAdj} onChange={(e) => setPostAdj(e.target.checked)} className="rounded text-emerald-600" />
                    <span>Auto-post adjustment journal</span>
                  </label>
                )}
              </>
            ) : (
              <>
                <input type="text" required placeholder={t.employees.name} value={newAccName} onChange={(e) => setNewAccName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
                <select value={newAccType} onChange={(e) => setNewAccType(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs">
                  <option value="CASH_REGISTER">Cash Safe</option>
                  <option value="BANK_ACCOUNT">Bank Account</option>
                </select>
                {newAccType === 'BANK_ACCOUNT' && (
                  <input type="text" placeholder="Bank Name" value={newAccBankName} onChange={(e) => setNewAccBankName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
                )}
              </>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">{t.confirm}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   2. DOUBLE-ENTRY ACCOUNTING ENGINE (ADMIN/ACCOUNTANT — IQD-NATIVE)
   ============================================================================ */

export function AccountingEngineModuleView({
  lang,
  accountingData,
  onRefresh,
  notify,
}: {
  lang: LanguageCode;
  accountingData: any;
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}) {
  const t = translations[lang];
  const [tab, setTab] = useState<'JOURNALS' | 'MANUAL_ENTRY' | 'COA' | 'LEDGER' | 'TRIAL_BALANCE' | 'BALANCE_SHEET' | 'PERIODS'>('TRIAL_BALANCE');
  const [submitting, setSubmitting] = useState(false);

  const accounts = accountingData?.accounts || [];
  const journals = accountingData?.journals || [];
  const trialBalance = accountingData?.trialBalance;
  const balanceSheet = accountingData?.balanceSheet;
  const generalLedger = accountingData?.generalLedger || [];
  const periods = accountingData?.periods || [];

  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnLines, setJrnLines] = useState([
    { accountId: accounts[0]?.id || '', debitIqd: '100000', creditIqd: '0' },
    { accountId: accounts[1]?.id || '', debitIqd: '0', creditIqd: '100000' },
  ]);
  const [selectedLedgerCode, setSelectedLedgerCode] = useState('ALL');

  const manualTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of jrnLines) {
      debit += Math.round(Number(l.debitIqd || 0));
      credit += Math.round(Number(l.creditIqd || 0));
    }
    return { debit, credit, isBalanced: debit === credit && debit > 0 };
  }, [jrnLines]);

  const handlePostManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTotals.isBalanced) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/accounting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'manualJournal',
          description: jrnDesc,
          lines: jrnLines.map((l, idx) => ({
            accountId: l.accountId || accounts[idx]?.id || accounts[0]?.id,
            debitIqd: Number(l.debitIqd || 0),
            creditIqd: Number(l.creditIqd || 0),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Failed');
      else {
        notify('success', `${data.entry.entryNumber} ✓`);
        setJrnDesc('');
        setTab('JOURNALS');
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
          <BookOpen className="w-6 h-6 text-emerald-500" />
          {t.accounting.title}
        </h2>
        <span className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 text-xs font-bold">
          <ShieldCheck className="w-4 h-4" />
          {t.accounting.balancedBadge}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'TRIAL_BALANCE', label: t.accounting.trialBalance },
          { id: 'BALANCE_SHEET', label: t.accounting.balanceSheet },
          { id: 'JOURNALS', label: t.accounting.journalEntries },
          { id: 'LEDGER', label: t.accounting.generalLedger },
          { id: 'COA', label: t.accounting.chartOfAccounts },
          { id: 'MANUAL_ENTRY', label: `+ ${t.accounting.newManualJournal}` },
          { id: 'PERIODS', label: t.accounting.periods },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${
              tab === item.id ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'TRIAL_BALANCE' && trialBalance && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
            <h3 className="text-sm font-black">{t.accounting.trialBalance}</h3>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${trialBalance.isBalanced ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'}`}>
              {trialBalance.isBalanced ? '✓ Balanced' : '✕ Unbalanced'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-3 px-4 text-start">Code</th>
                  <th className="py-3 px-4 text-start">Account</th>
                  <th className="py-3 px-4 text-end">{t.accounting.debit}</th>
                  <th className="py-3 px-4 text-end">{t.accounting.credit}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {(trialBalance.rows || []).map((r: any) => (
                  <tr key={r.accountId}>
                    <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">{r.code}</td>
                    <td className="py-2.5 px-4 font-semibold">{locName(r, lang)}</td>
                    <td className="py-2.5 px-4 text-end font-mono font-bold">{r.debitBalanceIqd > 0 ? fmtIqd(r.debitBalanceIqd, lang) : '—'}</td>
                    <td className="py-2.5 px-4 text-end font-mono font-bold">{r.creditBalanceIqd > 0 ? fmtIqd(r.creditBalanceIqd, lang) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-charcoal-900 text-white font-black">
                <tr>
                  <td colSpan={2} className="py-3 px-4">{t.total}</td>
                  <td className="py-3 px-4 text-end text-emerald-400">{fmtIqd(trialBalance.totalDebitBalanceIqd, lang)}</td>
                  <td className="py-3 px-4 text-end text-emerald-400">{fmtIqd(trialBalance.totalCreditBalanceIqd, lang)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {tab === 'BALANCE_SHEET' && balanceSheet && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-2">
            <h4 className="font-black text-sm text-emerald-500 border-b border-slate-200 dark:border-charcoal-800 pb-2">Assets / سامانەکان</h4>
            {(balanceSheet.assets || []).map((a: any) => (
              <div key={a.code} className="flex justify-between py-1">
                <span><b className="font-mono text-emerald-500 me-1.5">{a.code}</b>{locName(a, lang)}</span>
                <span className="font-bold">{fmtIqd(a.balanceIqd, lang)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-black border-t-2 border-emerald-500 pt-2">
              <span>TOTAL ASSETS</span>
              <span className="text-emerald-500">{fmtIqd(balanceSheet.totalAssetsIqd, lang)}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-3">
            <h4 className="font-black text-sm text-rose-500 border-b border-slate-200 dark:border-charcoal-800 pb-2">Liabilities & Equity</h4>
            {(balanceSheet.liabilities || []).map((l: any) => (
              <div key={l.code} className="flex justify-between py-1">
                <span><b className="font-mono text-rose-500 me-1.5">{l.code}</b>{locName(l, lang)}</span>
                <span className="font-bold">{fmtIqd(l.balanceIqd, lang)}</span>
              </div>
            ))}
            {(balanceSheet.equity || []).map((eq: any) => (
              <div key={eq.code} className="flex justify-between py-1">
                <span><b className="font-mono text-teal-500 me-1.5">{eq.code}</b>{locName(eq, lang)}</span>
                <span className="font-bold">{fmtIqd(eq.balanceIqd, lang)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-black border-t-2 border-emerald-500 pt-2">
              <span>TOTAL L + E {balanceSheet.isBalanced ? '✓' : ''}</span>
              <span className="text-emerald-500">{fmtIqd(balanceSheet.totalLiabilitiesAndEquityIqd, lang)}</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'JOURNALS' && (
        <div className="space-y-3">
          {journals.map((jrn: any) => (
            <div key={jrn.id} className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 p-4 space-y-2 text-xs">
              <div className="flex flex-wrap justify-between items-center gap-2 border-b border-slate-100 dark:border-charcoal-800 pb-2">
                <div>
                  <span className="font-mono font-black text-emerald-500 me-2">{jrn.entryNumber}</span>
                  <span className="font-semibold">{jrn.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">{new Date(jrn.date).toLocaleDateString()}</span>
                  {jrn.status === 'POSTED' && jrn.referenceType !== 'REVERSAL' && (
                    <button
                      onClick={async () => {
                        const res = await fetch('/api/accounting', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'reverseJournal', journalEntryId: jrn.id, reason: 'Manual reversal' }),
                        });
                        if (res.ok) {
                          notify('success', `${jrn.entryNumber} reversed`);
                          await onRefresh();
                        }
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-500 font-bold"
                    >
                      <RotateCcw className="w-3 h-3" /> {t.accounting.reverseEntry}
                    </button>
                  )}
                </div>
              </div>
              <table className="w-full">
                <tbody>
                  {(jrn.lines || []).map((line: any) => (
                    <tr key={line.id}>
                      <td className="py-1 font-semibold">
                        <span className="font-mono text-emerald-500 me-1.5">{line.account?.code}</span>
                        {locName(line.account, lang)}
                      </td>
                      <td className="py-1 text-end font-mono font-bold w-36">{Number(line.debitIqd) > 0 ? fmtIqd(line.debitIqd, lang) : '—'}</td>
                      <td className="py-1 text-end font-mono font-bold w-36">{Number(line.creditIqd) > 0 ? fmtIqd(line.creditIqd, lang) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {tab === 'LEDGER' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
            <h3 className="text-sm font-black">{t.accounting.generalLedger}</h3>
            <select value={selectedLedgerCode} onChange={(e) => setSelectedLedgerCode(e.target.value)} className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs">
              <option value="ALL">{t.all}</option>
              {accounts.map((a: any) => <option key={a.id} value={a.code}>{a.code} — {locName(a, lang)}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4 text-start">{t.date}</th>
                  <th className="py-2.5 px-4 text-start">#</th>
                  <th className="py-2.5 px-4 text-start">Account</th>
                  <th className="py-2.5 px-4 text-end">{t.accounting.debit}</th>
                  <th className="py-2.5 px-4 text-end">{t.accounting.credit}</th>
                  <th className="py-2.5 px-4 text-end">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {generalLedger
                  .filter((l: any) => selectedLedgerCode === 'ALL' || l.accountCode === selectedLedgerCode)
                  .map((l: any) => (
                    <tr key={l.lineId}>
                      <td className="py-2 px-4 text-slate-500">{new Date(l.date).toLocaleDateString()}</td>
                      <td className="py-2 px-4 font-mono text-emerald-500">{l.entryNumber}</td>
                      <td className="py-2 px-4 font-semibold">{l.accountCode} — {lang === 'ku' ? l.accountNameKu : lang === 'ar' ? l.accountNameAr : l.accountNameEn}</td>
                      <td className="py-2 px-4 text-end font-mono">{l.debitIqd > 0 ? fmtIqd(l.debitIqd, lang) : '—'}</td>
                      <td className="py-2 px-4 text-end font-mono">{l.creditIqd > 0 ? fmtIqd(l.creditIqd, lang) : '—'}</td>
                      <td className="py-2 px-4 text-end font-mono font-bold">{fmtIqd(l.runningBalanceIqd, lang)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'COA' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
              <tr>
                <th className="py-3 px-4 text-start">Code</th>
                <th className="py-3 px-4 text-start">Account</th>
                <th className="py-3 px-4 text-center">Type</th>
                <th className="py-3 px-4 text-end">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
              {accounts.map((acc: any) => (
                <tr key={acc.id}>
                  <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">{acc.code}</td>
                  <td className="py-2.5 px-4 font-semibold">{locName(acc, lang)}</td>
                  <td className="py-2.5 px-4 text-center font-mono text-[10px]">{acc.type}</td>
                  <td className="py-2.5 px-4 text-end font-bold">{fmtIqd(acc.balanceIqd, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'MANUAL_ENTRY' && (
        <form onSubmit={handlePostManual} className="bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-4">
          <input type="text" required placeholder={t.description} value={jrnDesc} onChange={(e) => setJrnDesc(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
          {jrnLines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2">
              <select value={line.accountId} onChange={(e) => { const c = [...jrnLines]; c[idx].accountId = e.target.value; setJrnLines(c); }} className="col-span-6 px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs">
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {locName(a, lang)}</option>)}
              </select>
              <input type="number" min="0" placeholder="Debit IQD" value={line.debitIqd} onChange={(e) => { const c = [...jrnLines]; c[idx].debitIqd = e.target.value; if (Number(e.target.value) > 0) c[idx].creditIqd = '0'; setJrnLines(c); }} className="col-span-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs text-end font-mono" />
              <input type="number" min="0" placeholder="Credit IQD" value={line.creditIqd} onChange={(e) => { const c = [...jrnLines]; c[idx].creditIqd = e.target.value; if (Number(e.target.value) > 0) c[idx].debitIqd = '0'; setJrnLines(c); }} className="col-span-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs text-end font-mono" />
            </div>
          ))}
          <div className="flex justify-between items-center text-xs">
            <button type="button" onClick={() => setJrnLines([...jrnLines, { accountId: accounts[0]?.id || '', debitIqd: '0', creditIqd: '0' }])} className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 font-bold">+ Line</button>
            <div className="flex items-center gap-3 font-mono font-bold">
              <span>D: {fmtIqd(manualTotals.debit, lang)}</span>
              <span>C: {fmtIqd(manualTotals.credit, lang)}</span>
              <span className={manualTotals.isBalanced ? 'text-emerald-500' : 'text-rose-500'}>
                {manualTotals.isBalanced ? '✓ Balanced' : '✕ Unbalanced'}
              </span>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={!manualTotals.isBalanced || submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold">{t.save}</button>
          </div>
        </form>
      )}

      {tab === 'PERIODS' && (
        <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 grid grid-cols-1 md:grid-cols-3 gap-4">
          {periods.map((p: any) => (
            <div key={p.id} className="p-4 rounded-xl border border-slate-200 dark:border-charcoal-800 flex items-center justify-between">
              <div>
                <div className="font-bold text-sm">{p.name}</div>
                <div className="text-[11px] text-slate-400">{new Date(p.startDate).toLocaleDateString()} — {new Date(p.endDate).toLocaleDateString()}</div>
              </div>
              <button
                onClick={async () => {
                  await fetch('/api/accounting', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'togglePeriodLock', periodId: p.id, isLocked: !p.isLocked }),
                  });
                  await onRefresh();
                }}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold ${p.isLocked ? 'bg-rose-500/15 text-rose-500' : 'bg-emerald-500/15 text-emerald-500'}`}
              >
                {p.isLocked ? <><Lock className="w-3.5 h-3.5" /> Locked</> : <><Unlock className="w-3.5 h-3.5" /> Open</>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
