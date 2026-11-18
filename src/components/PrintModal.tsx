'use client';

import React, { useState } from 'react';
import { Printer, X, Receipt, FileText } from 'lucide-react';
import { LanguageCode } from '@/lib/i18n';
import { fmtMoney, fmtOriginal } from '@/lib/client-utils';

export interface PrintableDocumentProps {
  doc: {
    type: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'ACCOUNT_STATEMENT';
    mode?: 'A4' | 'THERMAL';
    data: any;
  } | null;
  onClose: () => void;
  settings: any;
  lang: LanguageCode;
  displayCurrency: 'USD' | 'IQD';
  exchangeRate: number;
}

export function PrintModal({
  doc,
  onClose,
  settings,
  lang,
  displayCurrency,
  exchangeRate,
}: PrintableDocumentProps) {
  const [printFormat, setPrintFormat] = useState<'A4' | 'THERMAL'>(
    doc?.mode || 'A4'
  );

  if (!doc) return null;

  const companyName =
    lang === 'ar'
      ? settings?.companyNameAr
      : lang === 'ku'
      ? settings?.companyNameKu
      : settings?.companyNameEn;

  const companyAddress =
    lang === 'ar'
      ? settings?.addressAr
      : lang === 'ku'
      ? settings?.addressKu
      : settings?.addressEn;

  const footerNote =
    lang === 'ar'
      ? settings?.invoiceFooterAr
      : lang === 'ku'
      ? settings?.invoiceFooterKu
      : settings?.invoiceFooterEn;

  const handlePrint = () => {
    window.print();
  };

  const d = doc.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden my-8">
        {/* Modal Toolbar (Hidden during print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-charcoal-900 text-white border-b border-charcoal-800">
          <div className="flex items-center gap-3">
            <Printer className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold text-sm">
              {lang === 'ar'
                ? 'معاينة الطباعة وتصدير PDF'
                : lang === 'ku'
                ? 'پێشبینینی چاپکردن و PDF'
                : 'Print Preview & PDF Export'}
            </span>

            {doc.type === 'SALES_INVOICE' && (
              <div className="flex items-center bg-charcoal-800 rounded-lg p-1 text-xs">
                <button
                  onClick={() => setPrintFormat('A4')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition ${
                    printFormat === 'A4'
                      ? 'bg-emerald-600 text-white font-medium'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  A4 Invoice
                </button>
                <button
                  onClick={() => setPrintFormat('THERMAL')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition ${
                    printFormat === 'THERMAL'
                      ? 'bg-emerald-600 text-white font-medium'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Receipt className="w-3.5 h-3.5" />
                  80mm POS Receipt
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition shadow-lg shadow-emerald-600/25"
            >
              <Printer className="w-4 h-4" />
              {lang === 'ar'
                ? 'طباعة / حفظ PDF'
                : lang === 'ku'
                ? 'چاپکردن / PDF'
                : 'Print / Save PDF'}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-slate-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Area */}
        <div
          id="printable-document-area"
          className="p-8 bg-white text-slate-900 max-h-[80vh] overflow-y-auto"
        >
          {doc.type === 'SALES_INVOICE' && printFormat === 'THERMAL' ? (
            /* 80mm Thermal POS Cashier Receipt */
            <div className="max-w-xs mx-auto border border-dashed border-slate-300 p-5 font-mono text-xs text-slate-900">
              <div className="text-center border-b border-dashed border-slate-300 pb-3 mb-3">
                <div className="font-bold text-base">{companyName}</div>
                <div className="text-[11px] text-slate-600 mt-1">{companyAddress}</div>
                <div className="text-[11px] text-slate-600">
                  Tel: {settings?.phone} | Tax: {settings?.taxNumber}
                </div>
              </div>

              <div className="space-y-1 border-b border-dashed border-slate-300 pb-3 mb-3">
                <div className="flex justify-between">
                  <span>Invoice #:</span>
                  <span className="font-bold">{d.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>Date:</span>
                  <span>{new Date(d.date).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Customer:</span>
                  <span className="font-semibold">{d.customer?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span>Payment:</span>
                  <span>
                    {d.paymentType} ({d.currency})
                  </span>
                </div>
              </div>

              <table className="w-full text-left border-b border-dashed border-slate-300 pb-3 mb-3">
                <thead>
                  <tr className="border-b border-slate-300 text-[10px] uppercase">
                    <th className="py-1">Item</th>
                    <th className="py-1 text-center">Qty</th>
                    <th className="py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.items || []).map((item: any, idx: number) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="py-1.5 pr-1">
                        <div className="font-semibold">{item.productName}</div>
                        <div className="text-[10px] text-slate-500">
                          @{fmtOriginal(item.unitPriceOriginal, d.currency, lang)}
                        </div>
                      </td>
                      <td className="py-1.5 text-center">{Number(item.quantity)}</td>
                      <td className="py-1.5 text-right font-semibold">
                        {fmtOriginal(item.lineTotalOriginal, d.currency, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="space-y-1 text-xs border-b border-dashed border-slate-300 pb-3 mb-3">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{fmtOriginal(d.subtotalOriginal, d.currency, lang)}</span>
                </div>
                {Number(d.discountOriginal) > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Discount:</span>
                    <span>-{fmtOriginal(d.discountOriginal, d.currency, lang)}</span>
                  </div>
                )}
                {Number(d.taxOriginal) > 0 && (
                  <div className="flex justify-between">
                    <span>Tax:</span>
                    <span>{fmtOriginal(d.taxOriginal, d.currency, lang)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold pt-1 border-t border-slate-200">
                  <span>TOTAL:</span>
                  <span>{fmtOriginal(d.totalOriginal, d.currency, lang)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Paid:</span>
                  <span>{fmtOriginal(d.paidOriginal, d.currency, lang)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Balance Due:</span>
                  <span>{fmtOriginal(d.dueOriginal, d.currency, lang)}</span>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-500 space-y-1">
                <div>{footerNote}</div>
                <div className="font-bold pt-1">*** THANK YOU ***</div>
              </div>
            </div>
          ) : doc.type === 'SALES_INVOICE' || doc.type === 'PURCHASE_INVOICE' ? (
            /* Standard A4 Enterprise Sales / Purchase Invoice */
            <div className="space-y-6 text-slate-900">
              <div className="flex flex-wrap justify-between items-start gap-4 border-b-2 border-emerald-600 pb-6">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black text-xl">
                      S
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold text-slate-900">
                        {companyName}
                      </h1>
                      <p className="text-xs text-slate-500">{companyAddress}</p>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-slate-600 space-y-0.5">
                    <div>
                      Phone: {settings?.phone} | Email: {settings?.email}
                    </div>
                    <div>Tax Registration #: {settings?.taxNumber}</div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="inline-block px-4 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-sm uppercase tracking-wider">
                    {doc.type === 'SALES_INVOICE'
                      ? lang === 'ar'
                        ? 'فاتورة مبيعات ضريبية'
                        : lang === 'ku'
                        ? 'پسوولەی فرۆشتن'
                        : 'TAX SALES INVOICE'
                      : lang === 'ar'
                      ? 'فاتورة مشتريات وتوريد'
                      : lang === 'ku'
                      ? 'پسوولەی کڕین'
                      : 'PURCHASE INVOICE'}
                  </div>
                  <div className="mt-2 text-lg font-bold text-slate-900">
                    {d.invoiceNumber}
                  </div>
                  <div className="text-xs text-slate-500">
                    Date: {new Date(d.date).toLocaleDateString()} | Status:{' '}
                    <span className="font-semibold">{d.status}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    Currency: {d.currency} (Rate: 1 USD = {Number(d.exchangeRate)} IQD)
                  </div>
                </div>
              </div>

              {/* Counterparty & Warehouse Info */}
              <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <div className="text-slate-400 uppercase font-semibold mb-1">
                    {doc.type === 'SALES_INVOICE'
                      ? 'Billed To (Customer)'
                      : 'Supplier / Creditor'}
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {d.customer?.name || d.supplier?.name}
                  </div>
                  <div className="text-slate-600">
                    {d.customer?.companyName || d.supplier?.companyName}
                  </div>
                  <div className="text-slate-600">
                    Tel: {d.customer?.phone || d.supplier?.phone}
                  </div>
                  <div className="text-slate-600">
                    {d.customer?.address || d.supplier?.address}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-slate-400 uppercase font-semibold mb-1">
                    Fulfillment & Settlement Details
                  </div>
                  <div>
                    Warehouse:{' '}
                    <span className="font-semibold">
                      {d.warehouse?.nameEn || 'Main Warehouse'}
                    </span>
                  </div>
                  <div>
                    Payment Terms:{' '}
                    <span className="font-semibold">
                      {d.paymentType} ({d.paymentMethod})
                    </span>
                  </div>
                  {d.dueDate && (
                    <div>
                      Due Date:{' '}
                      <span className="font-semibold">
                        {new Date(d.dueDate).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {d.supplierInvoiceRef && (
                    <div>
                      Supplier Ref:{' '}
                      <span className="font-semibold">{d.supplierInvoiceRef}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Line Items Table */}
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2.5 px-3 text-left rounded-tl-lg">#</th>
                    <th className="py-2.5 px-3 text-left">SKU</th>
                    <th className="py-2.5 px-3 text-left">Product / Description</th>
                    <th className="py-2.5 px-3 text-center">Qty</th>
                    <th className="py-2.5 px-3 text-right">Unit Price</th>
                    <th className="py-2.5 px-3 text-right">Discount</th>
                    <th className="py-2.5 px-3 text-right rounded-tr-lg">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border border-slate-200">
                  {(d.items || []).map((item: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{item.sku}</td>
                      <td className="py-2.5 px-3 font-semibold">{item.productName}</td>
                      <td className="py-2.5 px-3 text-center font-semibold">
                        {Number(item.quantity)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {fmtOriginal(
                          item.unitPriceOriginal ?? item.unitCostOriginal,
                          d.currency,
                          lang
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {fmtOriginal(item.discountOriginal, d.currency, lang)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold">
                        {fmtOriginal(item.lineTotalOriginal, d.currency, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals Summary */}
              <div className="flex justify-between items-start gap-8 pt-2">
                <div className="max-w-sm text-xs text-slate-600 space-y-2">
                  {d.notes && (
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="font-semibold text-slate-800 mb-1">Notes:</div>
                      <div>{d.notes}</div>
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500">{footerNote}</div>
                </div>

                <div className="w-72 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="font-semibold">
                      {fmtOriginal(d.subtotalOriginal, d.currency, lang)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Discount:</span>
                    <span className="text-emerald-700 font-semibold">
                      -{fmtOriginal(d.discountOriginal, d.currency, lang)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Tax:</span>
                    <span>{fmtOriginal(d.taxOriginal, d.currency, lang)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-slate-900 border-t border-slate-300 pt-2">
                    <span>Grand Total:</span>
                    <span>{fmtOriginal(d.totalOriginal, d.currency, lang)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>Paid Amount:</span>
                    <span>{fmtOriginal(d.paidOriginal, d.currency, lang)}</span>
                  </div>
                  <div className="flex justify-between text-rose-700 font-bold border-t border-slate-200 pt-1.5">
                    <span>Balance Due:</span>
                    <span>{fmtOriginal(d.dueOriginal, d.currency, lang)}</span>
                  </div>
                </div>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-12 pt-10 text-xs text-slate-500">
                <div className="border-t border-slate-300 pt-2 text-center">
                  Authorized Finance & Accounting Signature
                </div>
                <div className="border-t border-slate-300 pt-2 text-center">
                  Customer / Recipient Acknowledgment
                </div>
              </div>
            </div>
          ) : (
            /* Customer or Supplier Account Statement */
            <div className="space-y-6 text-slate-900">
              <div className="flex justify-between items-start border-b-2 border-emerald-600 pb-4">
                <div>
                  <h1 className="text-xl font-bold">{companyName}</h1>
                  <p className="text-xs text-slate-500">{companyAddress}</p>
                </div>
                <div className="text-right">
                  <div className="text-base font-bold text-emerald-700 uppercase">
                    Official Account Statement
                  </div>
                  <div className="text-xs text-slate-500">
                    Generated: {new Date().toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                <div>
                  <div className="text-slate-400 uppercase font-semibold">
                    Account Holder
                  </div>
                  <div className="text-base font-bold">
                    {d.customer?.name || d.supplier?.name}
                  </div>
                  <div className="text-slate-600">
                    Code: {d.customer?.code || d.supplier?.code} | Tel:{' '}
                    {d.customer?.phone || d.supplier?.phone}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-slate-400 uppercase font-semibold">
                    Closing Balance
                  </div>
                  <div className="text-xl font-black text-emerald-700">
                    {fmtMoney(d.closingBalanceUsd, displayCurrency, exchangeRate, lang)}
                  </div>
                </div>
              </div>

              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2 px-3 text-left">Date</th>
                    <th className="py-2 px-3 text-left">Ref #</th>
                    <th className="py-2 px-3 text-left">Type / Description</th>
                    <th className="py-2 px-3 text-right">Debit</th>
                    <th className="py-2 px-3 text-right">Credit</th>
                    <th className="py-2 px-3 text-right">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border border-slate-200">
                  {(d.lines || []).map((line: any, idx: number) => (
                    <tr key={idx}>
                      <td className="py-2 px-3">
                        {new Date(line.date).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-3 font-mono font-semibold">
                        {line.reference}
                      </td>
                      <td className="py-2 px-3">{line.description}</td>
                      <td className="py-2 px-3 text-right">
                        {fmtMoney(line.debitUsd, displayCurrency, exchangeRate, lang)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {fmtMoney(line.creditUsd, displayCurrency, exchangeRate, lang)}
                      </td>
                      <td className="py-2 px-3 text-right font-bold">
                        {fmtMoney(
                          line.runningBalanceUsd,
                          displayCurrency,
                          exchangeRate,
                          lang
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
