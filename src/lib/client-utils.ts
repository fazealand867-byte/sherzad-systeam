import { LanguageCode } from './i18n';

/**
 * Formats a base USD amount into the user's selected display currency ('USD' or 'IQD')
 * using the active exchange rate. Never mixes currencies without explicit conversion.
 */
export function fmtMoney(
  amountUsd: number | string | null | undefined,
  displayCurrency: 'USD' | 'IQD' = 'USD',
  exchangeRate: number = 1500,
  lang: LanguageCode = 'ar'
): string {
  const numUsd = Number(amountUsd || 0);
  if (displayCurrency === 'IQD') {
    const iqd = Math.round(numUsd * (exchangeRate || 1500));
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(iqd);
    return lang === 'en' ? `${formatted} IQD` : `${formatted} د.ع`;
  }

  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numUsd);
  return `$${formatted}`;
}

/**
 * Formats an amount in its original transaction currency ('USD' or 'IQD').
 */
export function fmtOriginal(
  amountOrig: number | string | null | undefined,
  currency: 'USD' | 'IQD' | string = 'USD',
  lang: LanguageCode = 'ar'
): string {
  const num = Number(amountOrig || 0);
  if (currency === 'IQD') {
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(num));
    return lang === 'en' ? `${formatted} IQD` : `${formatted} د.ع`;
  }
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `$${formatted}`;
}

/**
 * Picks the localized name (`nameAr`, `nameKu`, or `nameEn`) from an entity object.
 */
export function locName(
  item: { nameEn?: string; nameAr?: string; nameKu?: string; name?: string } | null | undefined,
  lang: LanguageCode
): string {
  if (!item) return '';
  if (lang === 'ar') return item.nameAr || item.nameEn || item.name || '';
  if (lang === 'ku') return item.nameKu || item.nameAr || item.nameEn || item.name || '';
  return item.nameEn || item.name || item.nameAr || '';
}

/**
 * Exports tabular data to a UTF-8 BOM CSV file compatible with Microsoft Excel (supports Arabic & Kurdish).
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
