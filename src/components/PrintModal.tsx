'use client';

import React, { useState, useEffect } from 'react';
import { Printer, X, Receipt, FileText, Banknote } from 'lucide-react';
import { LanguageCode } from '@/lib/i18n';
import { fmtIqd, fmtQty } from '@/lib/client-utils';
import { unitLabel, UnitDefinition } from '@/lib/units';

export interface PrintableDocument {
  type: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'ACCOUNT_STATEMENT' | 'SALARY_RECEIPT';
  mode?: 'A4' | 'THERMAL';
  data: any;
}

export interface PrintableDocumentProps {
  doc: PrintableDocument | null;
  onClose: () => void;
  settings: any;
  lang: LanguageCode;
  units?: UnitDefinition[];
}

export function PrintModal({
  doc,
  onClose,
  settings,
  lang,
  units = [],
}: PrintableDocumentProps) {
  const [printFormat, setPrintFormat] = useState<'A4' | 'THERMAL'>(doc?.mode || 'A4');

  useEffect(() => {
    if (doc?.mode) setPrintFormat(doc.mode);
    else setPrintFormat('A4');
  }, [doc]);

  if (!doc) return null;

  const companyName =
    lang === 'ku'
      ? settings?.companyNameKu || settings?.companyNameEn
      : lang === 'ar'
        ? settings?.companyNameAr || settings?.companyNameEn
        : settings?.companyNameEn;

  const companyAddress =
    lang === 'ku'
      ? settings?.addressKu || settings?.addressEn
      : lang === 'ar'
        ? settings?.addressAr || settings?.addressEn
        : settings?.addressEn;

  const footerNote =
    lang === 'ku'
      ? settings?.invoiceFooterKu
      : lang === 'ar'
        ? settings?.invoiceFooterAr
        : settings?.invoiceFooterEn;

  const d = doc.data;
  const isRtl = lang !== 'en';

  const L = {
    preview: lang === 'ku' ? 'پێشبینینی چاپکردن و PDF' : lang === 'ar' ? 'معاينة الطباعة و PDF' : 'Print Preview & PDF',
    printBtn: lang === 'ku' ? 'چاپکردن / PDF' : lang === 'ar' ? 'طباعة / PDF' : 'Print / Save PDF',
    a4: lang === 'ku' ? 'کاغەزی A4' : lang === 'ar' ? 'فاتورة A4' : 'A4 Paper',
    thermal: lang === 'ku' ? 'وەسڵی کاشێر 80mm' : lang === 'ar' ? 'وصل حراري 80mm' : '80mm Receipt',
    invoiceNo: lang === 'ku' ? 'ژمارەی پسوولە' : lang === 'ar' ? 'رقم الفاتورة' : 'Invoice #',
    receiptNo: lang === 'ku' ? 'ژمارەی وەسڵ' : lang === 'ar' ? 'رقم الإيصال' : 'Receipt #',
    date: lang === 'ku' ? 'بەروار' : lang === 'ar' ? 'التاريخ' : 'Date',
    customer: lang === 'ku' ? 'کڕیار' : lang === 'ar' ? 'العميل' : 'Customer',
    supplier: lang === 'ku' ? 'دابینکەر' : lang === 'ar' ? 'المورد' : 'Supplier',
    employee: lang === 'ku' ? 'کارمەند' : lang === 'ar' ? 'الموظف' : 'Employee',
    phone: lang === 'ku' ? 'مۆبایل' : lang === 'ar' ? 'الهاتف' : 'Phone',
    position: lang === 'ku' ? 'کار / پلە' : lang === 'ar' ? 'الوظيفة' : 'Position',
    product: lang === 'ku' ? 'بەرهەم' : lang === 'ar' ? 'المنتج' : 'Product',
    qty: lang === 'ku' ? 'بڕ' : lang === 'ar' ? 'الكمية' : 'Qty',
    price: lang === 'ku' ? 'نرخ' : lang === 'ar' ? 'السعر' : 'Price',
    total: lang === 'ku' ? 'کۆی گشتی' : lang === 'ar' ? 'الإجمالي' : 'Total',
    subtotal: lang === 'ku' ? 'کۆی سەرەتایی' : lang === 'ar' ? 'المجموع الفرعي' : 'Subtotal',
    discount: lang === 'ku' ? 'داشکاندن' : lang === 'ar' ? 'الخصم' : 'Discount',
    paid: lang === 'ku' ? 'دراو' : lang === 'ar' ? 'المدفوع' : 'Paid',
    due: lang === 'ku' ? 'ماوە (قەرز)' : lang === 'ar' ? 'المتبقي' : 'Balance Due',
    notes: lang === 'ku' ? 'تێبینی' : lang === 'ar' ? 'ملاحظات' : 'Notes',
    salaryReceiptTitle: lang === 'ku' ? 'وەسڵی پێدانی مووچە' : lang === 'ar' ? 'إيصال صرف راتب' : 'SALARY PAYMENT RECEIPT',
    salaryMonth: lang === 'ku' ? 'مانگی مووچە' : lang === 'ar' ? 'شهر الراتب' : 'Salary Month',
    paymentType: lang === 'ku' ? 'جۆری پارەدان' : lang === 'ar' ? 'نوع الدفع' : 'Payment Type',
    monthlySalary: lang === 'ku' ? 'مووچەی مانگانە' : lang === 'ar' ? 'الراتب الشهري' : 'Monthly Salary',
    amountPaid: lang === 'ku' ? 'بڕی دراو' : lang === 'ar' ? 'المبلغ المدفوع' : 'Amount Paid',
    previouslyPaid: lang === 'ku' ? 'پێشتر دراوە لەم مانگەدا' : lang === 'ar' ? 'المدفوع مسبقاً هذا الشهر' : 'Previously Paid This Month',
    remaining: lang === 'ku' ? 'ماوەی مووچە' : lang === 'ar' ? 'المتبقي من الراتب' : 'Remaining Balance',
    employerSig: lang === 'ku' ? 'واژووی کارگێڕی / ژمێریار' : lang === 'ar' ? 'توقيع الإدارة / المحاسب' : 'Authorized Manager Signature',
    receiverSig: lang === 'ku' ? 'واژووی وەرگر' : lang === 'ar' ? 'توقيع المستلم' : 'Recipient Signature',
    statementTitle: lang === 'ku' ? 'کەشف حسابی فەرمی' : lang === 'ar' ? 'كشف حساب رسمي' : 'OFFICIAL ACCOUNT STATEMENT',
    closingBalance: lang === 'ku' ? 'باڵانسی کۆتایی' : lang === 'ar' ? 'الرصيد الختامي' : 'Closing Balance',
  };

  const payTypeLabel = (pt: string) => {
    if (pt === 'ADVANCE') return lang === 'ku' ? 'پێشەکی مووچە' : lang === 'ar' ? 'سلفة راتب' : 'Salary Advance';
    if (pt === 'PARTIAL') return lang === 'ku' ? 'بەشێک لە مووچە' : lang === 'ar' ? 'دفعة جزئية' : 'Partial Salary';
    return lang === 'ku' ? 'مووچەی تەواو' : lang === 'ar' ? 'راتب كامل' : 'Full Salary';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden my-8">
        {/* Modal Toolbar */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-charcoal-900 text-white border-b border-charcoal-800">
          <div className="flex items-center gap-3">
            <Printer className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-sm">{L.preview}</span>

            {(doc.type === 'SALES_INVOICE' || doc.type === 'SALARY_RECEIPT') && (
              <div className="flex items-center bg-charcoal-800 rounded-lg p-1 text-xs">
                <button
                  onClick={() => setPrintFormat('A4')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${printFormat === 'A4'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'text-slate-300 hover:text-white'
                    }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  {L.a4}
                </button>
                <button
                  onClick={() => setPrintFormat('THERMAL')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${printFormat === 'THERMAL'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'text-slate-300 hover:text-white'
                    }`}
                >
                  <Receipt className="w-3.5 h-3.5" />
                  {L.thermal}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition shadow-lg shadow-emerald-600/25"
            >
              <Printer className="w-4 h-4" />
              {L.printBtn}
            </button>
            <button
              onClick={onClose}
              className="p-2.5 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-slate-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Area */}
        <div
          id="printable-document-area"
          dir={isRtl ? 'rtl' : 'ltr'}
          className="p-8 bg-white text-slate-900 max-h-[80vh] overflow-y-auto"
        >
          {/* ================= SALARY PAYMENT RECEIPT ================= */}
          {doc.type === 'SALARY_RECEIPT' ? (
            printFormat === 'THERMAL' ? (
              <div className="max-w-xs mx-auto border border-dashed border-slate-400 p-5 text-xs text-slate-900 space-y-3">
                <div className="text-center border-b border-dashed border-slate-300 pb-3">
                  <div className="font-black text-base">{companyName}</div>
                  <div className="text-[11px] text-slate-600 mt-0.5">{settings?.phone}</div>
                  <div className="mt-2 inline-block px-3 py-1 rounded bg-slate-900 text-white font-bold">
                    {L.salaryReceiptTitle}
                  </div>
                </div>
                <div className="space-y-1.5 border-b border-dashed border-slate-300 pb-3">
                  <div className="flex justify-between"><span>{L.receiptNo}:</span><b className="font-mono">{d.receiptNumber}</b></div>
                  <div className="flex justify-between"><span>{L.date}:</span><span>{new Date(d.date).toLocaleDateString()}</span></div>
                  <div className="flex justify-between"><span>{L.salaryMonth}:</span><b className="font-mono">{d.salaryMonth}</b></div>
                </div>
                <div className="space-y-1.5 border-b border-dashed border-slate-300 pb-3">
                  <div className="flex justify-between"><span>{L.employee}:</span><b>{d.employeeName}</b></div>
                  {d.employeePhone && <div className="flex justify-between"><span>{L.phone}:</span><span className="font-mono">{d.employeePhone}</span></div>}
                  {d.employeePosition && <div className="flex justify-between"><span>{L.position}:</span><span>{d.employeePosition}</span></div>}
                  <div className="flex justify-between"><span>{L.paymentType}:</span><b>{payTypeLabel(d.paymentType)}</b></div>
                </div>
                <div className="space-y-1.5 border-b border-dashed border-slate-300 pb-3">
                  {Number(d.monthlySalaryIqd) > 0 && (
                    <div className="flex justify-between"><span>{L.monthlySalary}:</span><span>{fmtIqd(d.monthlySalaryIqd, lang)}</span></div>
                  )}
                  <div className="flex justify-between text-base font-black text-emerald-700 pt-1">
                    <span>{L.amountPaid}:</span>
                    <span>{fmtIqd(d.amountIqd, lang)}</span>
                  </div>
                  {Number(d.monthlySalaryIqd) > 0 && (
                    <div className="flex justify-between font-bold text-slate-700">
                      <span>{L.remaining}:</span>
                      <span>{fmtIqd(d.remainingAfterIqd, lang)}</span>
                    </div>
                  )}
                </div>
                {d.notes && <div className="text-[11px] text-slate-600">{L.notes}: {d.notes}</div>}
                <div className="pt-6 grid grid-cols-2 gap-4 text-[10px] text-center text-slate-500">
                  <div className="border-t border-slate-400 pt-1">{L.employerSig}</div>
                  <div className="border-t border-slate-400 pt-1">{L.receiverSig}</div>
                </div>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto border-2 border-emerald-600 rounded-2xl p-8 space-y-6">
                <div className="flex justify-between items-start border-b-2 border-emerald-600 pb-5">
                  <div>
                    <h1 className="text-2xl font-black text-slate-900">{companyName}</h1>
                    <p className="text-xs text-slate-500 mt-1">{companyAddress}</p>
                    <p className="text-xs text-slate-500">{settings?.phone}</p>
                  </div>
                  <div className="text-end">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-black text-sm">
                      <Banknote className="w-4 h-4" />
                      {L.salaryReceiptTitle}
                    </div>
                    <div className="mt-2 text-lg font-mono font-black text-slate-900">{d.receiptNumber}</div>
                    <div className="text-xs text-slate-500">
                      {L.date}: {new Date(d.date).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-5 rounded-xl border border-slate-200 text-sm">
                  <div className="space-y-1.5">
                    <div className="text-xs text-slate-400 font-bold">{L.employee}</div>
                    <div className="text-lg font-black text-slate-900">{d.employeeName}</div>
                    {d.employeePhone && <div className="text-slate-600 font-mono">{L.phone}: {d.employeePhone}</div>}
                    {d.employeePosition && <div className="text-slate-600">{L.position}: {d.employeePosition}</div>}
                  </div>
                  <div className="space-y-1.5 text-end">
                    <div className="text-xs text-slate-400 font-bold">{L.salaryMonth}</div>
                    <div className="text-lg font-mono font-black text-emerald-700">{d.salaryMonth}</div>
                    <div className="text-sm font-bold text-slate-700">{payTypeLabel(d.paymentType)}</div>
                  </div>
                </div>

                <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-5 space-y-2.5 text-sm">
                  {Number(d.monthlySalaryIqd) > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>{L.monthlySalary}:</span>
                      <span className="font-bold">{fmtIqd(d.monthlySalaryIqd, lang)}</span>
                    </div>
                  )}
                  {Number(d.paidBeforeIqd) > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>{L.previouslyPaid}:</span>
                      <span className="font-bold">{fmtIqd(d.paidBeforeIqd, lang)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xl font-black text-emerald-700 border-t border-emerald-200 pt-3">
                    <span>{L.amountPaid}:</span>
                    <span>{fmtIqd(d.amountIqd, lang)}</span>
                  </div>
                  {Number(d.monthlySalaryIqd) > 0 && (
                    <div className="flex justify-between font-bold text-slate-800 border-t border-emerald-200/70 pt-2">
                      <span>{L.remaining}:</span>
                      <span>{fmtIqd(d.remainingAfterIqd, lang)}</span>
                    </div>
                  )}
                </div>

                {d.notes && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                    <b>{L.notes}:</b> {d.notes}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-12 pt-10 text-xs text-slate-600">
                  <div className="border-t border-slate-400 pt-2 text-center font-semibold">{L.employerSig}</div>
                  <div className="border-t border-slate-400 pt-2 text-center font-semibold">{L.receiverSig}</div>
                </div>
              </div>
            )
          ) : doc.type === 'SALES_INVOICE' && printFormat === 'THERMAL' ? (
            /* ================= 80mm THERMAL SALES RECEIPT (IQD ONLY) ================= */
            <div className="max-w-xs mx-auto border border-dashed border-slate-300 p-5 text-xs text-slate-900">
              <div className="text-center border-b border-dashed border-slate-300 pb-3 mb-3">
                <div className="font-black text-base">{companyName}</div>
                <div className="text-[11px] text-slate-600 mt-1">{companyAddress}</div>
                <div className="text-[11px] text-slate-600">{settings?.phone}</div>
              </div>

              <div className="space-y-1 border-b border-dashed border-slate-300 pb-3 mb-3">
                <div className="flex justify-between">
                  <span>{L.invoiceNo}:</span>
                  <span className="font-mono font-bold">{d.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>{L.date}:</span>
                  <span>{new Date(d.date).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>{L.customer}:</span>
                  <span className="font-bold">{d.customer?.name}</span>
                </div>
              </div>

              <table className="w-full border-b border-dashed border-slate-300 pb-3 mb-3">
                <thead>
                  <tr className="border-b border-slate-300 text-[11px]">
                    <th className="py-1 text-start">{L.product}</th>
                    <th className="py-1 text-center">{L.qty}</th>
                    <th className="py-1 text-end">{L.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.items || []).map((item: any, idx: number) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="py-1.5">
                        <div className="font-bold">{item.productName}</div>
                        <div className="text-[10px] text-slate-500">
                          {fmtIqd(item.unitPriceIqd ?? item.unitPriceOriginal, lang)}
                        </div>
                      </td>
                      <td className="py-1.5 text-center font-semibold">
                        {fmtQty(item.quantity)} {unitLabel(item.unit, lang, units)}
                      </td>
                      <td className="py-1.5 text-end font-bold">
                        {fmtIqd(item.lineTotalIqd ?? item.lineTotalOriginal, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="space-y-1 text-xs border-b border-dashed border-slate-300 pb-3 mb-3">
                <div className="flex justify-between">
                  <span>{L.subtotal}:</span>
                  <span>{fmtIqd(d.subtotalIqd ?? d.subtotalOriginal, lang)}</span>
                </div>
                {Number(d.discountIqd ?? d.discountOriginal) > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>{L.discount}:</span>
                    <span>-{fmtIqd(d.discountIqd ?? d.discountOriginal, lang)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-black pt-1 border-t border-slate-200">
                  <span>{L.total}:</span>
                  <span>{fmtIqd(d.totalIqd ?? d.totalOriginal, lang)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{L.paid}:</span>
                  <span>{fmtIqd(d.paidIqd ?? d.paidOriginal, lang)}</span>
                </div>
                <div className="flex justify-between font-bold text-rose-700">
                  <span>{L.due}:</span>
                  <span>{fmtIqd(d.dueIqd ?? d.dueOriginal, lang)}</span>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-500">
                <div>{footerNote}</div>
              </div>
            </div>
          ) : doc.type === 'SALES_INVOICE' || doc.type === 'PURCHASE_INVOICE' ? (
            /* ================= A4 SALES / PURCHASE INVOICE (IQD ONLY) ================= */
            <div className="space-y-6 text-slate-900">
              <div className="flex flex-wrap justify-between items-start gap-4 border-b-2 border-emerald-600 pb-5">
                <div>
                  <h1 className="text-2xl font-black text-slate-900">{companyName}</h1>
                  <p className="text-xs text-slate-500 mt-1">{companyAddress}</p>
                  <p className="text-xs text-slate-600 mt-1">{settings?.phone}</p>
                </div>

                <div className="text-end">
                  <div className="inline-block px-4 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-black text-sm">
                    {doc.type === 'SALES_INVOICE'
                      ? lang === 'ku'
                        ? 'پسوولەی فرۆشتن'
                        : lang === 'ar'
                          ? 'فاتورة مبيعات'
                          : 'SALES INVOICE'
                      : lang === 'ku'
                        ? 'پسوولەی کڕین'
                        : lang === 'ar'
                          ? 'فاتورة مشتريات'
                          : 'PURCHASE INVOICE'}
                  </div>
                  <div className="mt-2 text-lg font-mono font-black text-slate-900">
                    {d.invoiceNumber}
                  </div>
                  <div className="text-xs text-slate-500">
                    {L.date}: {new Date(d.date).toLocaleDateString()}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <div className="text-slate-400 font-bold mb-1">
                    {doc.type === 'SALES_INVOICE' ? L.customer : L.supplier}
                  </div>
                  <div className="text-base font-black text-slate-900">
                    {d.customer?.name || d.supplier?.name}
                  </div>
                  <div className="text-slate-600 font-mono">
                    {d.customer?.phone || d.supplier?.phone}
                  </div>
                </div>
                <div className="text-end space-y-1">
                  <div className="text-slate-500">{L.paymentType}: <b>{d.paymentType}</b></div>
                  {d.supplierInvoiceRef && (
                    <div className="text-slate-500">Ref: <b>{d.supplierInvoiceRef}</b></div>
                  )}
                </div>
              </div>

              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2.5 px-3 text-start">#</th>
                    <th className="py-2.5 px-3 text-start">{L.product}</th>
                    <th className="py-2.5 px-3 text-center">{L.qty}</th>
                    <th className="py-2.5 px-3 text-end">{L.price}</th>
                    <th className="py-2.5 px-3 text-end">{L.total}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border border-slate-200">
                  {(d.items || []).map((item: any, idx: number) => (
                    <tr key={idx}>
                      <td className="py-2.5 px-3">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-bold">{item.productName}</td>
                      <td className="py-2.5 px-3 text-center font-semibold">
                        {fmtQty(item.quantity)} {unitLabel(item.unit, lang, units)}
                      </td>
                      <td className="py-2.5 px-3 text-end">
                        {fmtIqd(item.unitPriceIqd ?? item.unitCostIqd ?? item.unitPriceOriginal ?? item.unitCostOriginal, lang)}
                      </td>
                      <td className="py-2.5 px-3 text-end font-bold">
                        {fmtIqd(item.lineTotalIqd ?? item.lineTotalOriginal, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex flex-wrap justify-between items-start gap-8 pt-2">
                <div className="max-w-sm text-xs text-slate-600 space-y-2">
                  {d.notes && (
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <b>{L.notes}:</b> {d.notes}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500">{footerNote}</div>
                </div>

                <div className="w-72 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-600">{L.subtotal}:</span>
                    <span className="font-semibold">{fmtIqd(d.subtotalIqd ?? d.subtotalOriginal, lang)}</span>
                  </div>
                  {Number(d.discountIqd ?? d.discountOriginal) > 0 && (
                    <div className="flex justify-between text-emerald-700 font-semibold">
                      <span>{L.discount}:</span>
                      <span>-{fmtIqd(d.discountIqd ?? d.discountOriginal, lang)}</span>
                    </div>
                  )}
                  {Number(d.shippingIqd ?? d.shippingOriginal) > 0 && (
                    <div className="flex justify-between text-slate-600 font-semibold">
                      <span>{lang === 'ku' ? 'گواستنەوە' : lang === 'ar' ? 'الشحن والنقل' : 'Shipping'}:</span>
                      <span>+{fmtIqd(d.shippingIqd ?? d.shippingOriginal, lang)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-black text-slate-900 border-t border-slate-300 pt-2">
                    <span>{L.total}:</span>
                    <span>{fmtIqd(d.totalIqd ?? d.totalOriginal, lang)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>{L.paid}:</span>
                    <span>{fmtIqd(d.paidIqd ?? d.paidOriginal, lang)}</span>
                  </div>
                  <div className="flex justify-between text-rose-700 font-bold border-t border-slate-200 pt-1.5">
                    <span>{L.due}:</span>
                    <span>{fmtIqd(d.dueIqd ?? d.dueOriginal, lang)}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-12 pt-10 text-xs text-slate-500">
                <div className="border-t border-slate-300 pt-2 text-center">{L.employerSig}</div>
                <div className="border-t border-slate-300 pt-2 text-center">{L.receiverSig}</div>
              </div>
            </div>
          ) : (
            /* ================= ACCOUNT STATEMENT (IQD ONLY) ================= */
            <div className="space-y-6 text-slate-900">
              <div className="flex justify-between items-start border-b-2 border-emerald-600 pb-4">
                <div>
                  <h1 className="text-xl font-black">{companyName}</h1>
                  <p className="text-xs text-slate-500">{companyAddress}</p>
                </div>
                <div className="text-end">
                  <div className="text-base font-black text-emerald-700">{L.statementTitle}</div>
                  <div className="text-xs text-slate-500">{new Date().toLocaleDateString()}</div>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                <div>
                  <div className="text-base font-black">{d.customer?.name || d.supplier?.name}</div>
                  <div className="text-slate-600 font-mono">
                    {d.customer?.code || d.supplier?.code} • {d.customer?.phone || d.supplier?.phone}
                  </div>
                </div>
                <div className="text-end">
                  <div className="text-slate-400 font-bold">{L.closingBalance}</div>
                  <div className="text-xl font-black text-emerald-700">
                    {fmtIqd(d.closingBalanceIqd, lang)}
                  </div>
                </div>
              </div>

              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2 px-3 text-start">{L.date}</th>
                    <th className="py-2 px-3 text-start">#</th>
                    <th className="py-2 px-3 text-start">{L.notes}</th>
                    <th className="py-2 px-3 text-end">Debit</th>
                    <th className="py-2 px-3 text-end">Credit</th>
                    <th className="py-2 px-3 text-end">{L.closingBalance}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border border-slate-200">
                  {(d.lines || []).map((line: any, idx: number) => (
                    <tr key={idx}>
                      <td className="py-2 px-3">{new Date(line.date).toLocaleDateString()}</td>
                      <td className="py-2 px-3 font-mono font-semibold">{line.reference}</td>
                      <td className="py-2 px-3">{line.description}</td>
                      <td className="py-2 px-3 text-end">{fmtIqd(line.debitIqd, lang)}</td>
                      <td className="py-2 px-3 text-end">{fmtIqd(line.creditIqd, lang)}</td>
                      <td className="py-2 px-3 text-end font-bold">{fmtIqd(line.runningBalanceIqd, lang)}</td>
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
