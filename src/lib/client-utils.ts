import { LanguageCode } from './i18n';

/**
 * Formats an Iraqi Dinar (IQD) amount cleanly without unnecessary decimals.
 * This system operates strictly in Iraqi Dinar (IQD).
 */
export function fmtIqd(
  amountIqd: number | string | null | undefined,
  lang: LanguageCode = 'ku'
): string {
  const num = Math.round(Number(amountIqd || 0));
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
  return lang === 'en' ? `${formatted} IQD` : `${formatted} د.ع`;
}

/**
 * Backward-compatible alias that formats IQD amounts cleanly.
 * Accepts direct IQD values (`amountIqd`) when called with 2 args, or converts legacy USD if explicitly requested.
 */
export function fmtMoney(
  amount: number | string | null | undefined,
  lang: LanguageCode = 'ku'
): string {
  return fmtIqd(amount, lang);
}

/**
 * Formats fractional or integer quantities cleanly (removes trailing zeros like 2.5000 -> 2.5).
 */
export function fmtQty(qty: number | string | null | undefined): string {
  const n = Number(qty || 0);
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return Number(n.toFixed(4)).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  });
}

/**
 * Picks the localized name (`nameKu`, `nameAr`, or `nameEn`) from an entity object.
 * Defaults to Kurdish Sorani first when `lang === 'ku'`.
 */
export function locName(
  item: { nameEn?: string; nameAr?: string; nameKu?: string; name?: string } | null | undefined,
  lang: LanguageCode
): string {
  if (!item) return '';
  if (lang === 'ku') return item.nameKu || item.nameAr || item.nameEn || item.name || '';
  if (lang === 'ar') return item.nameAr || item.nameKu || item.nameEn || item.name || '';
  return item.nameEn || item.name || item.nameKu || item.nameAr || '';
}

/**
 * Returns today's date in YYYY-MM-DD local format.
 */
export function todayDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns current month in YYYY-MM format.
 */
export function currentMonthStr(): string {
  return todayDateStr().slice(0, 7);
}

/**
 * Generates a unique idempotency key per form submission to prevent accidental duplicate transactions.
 */
export function makeIdempotencyKey(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Exports tabular data to a UTF-8 BOM CSV file compatible with Microsoft Excel (supports Kurdish & Arabic).
 */
export function exportToCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  const escapeCell = (val: string | number | null | undefined) => {
    const str = val === null || val === undefined ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvContent =
    '\uFEFF' +
    [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join(
      '\r\n'
    );

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
