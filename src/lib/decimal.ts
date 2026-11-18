import Decimal from 'decimal.js';

// Configure Decimal.js for high-precision financial calculations
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
});

export type DecimalValue = Decimal | number | string | { toString(): string } | null | undefined;

/**
 * Safely converts any numeric/Decimal input into a Decimal instance.
 * Defaults null/undefined/empty string to Decimal(0).
 */
export function D(value: DecimalValue): Decimal {
  if (value === null || value === undefined || value === '') {
    return new Decimal(0);
  }
  if (value instanceof Decimal) {
    return value;
  }
  return new Decimal(value.toString());
}

/**
 * Rounds a USD value to 2 decimal places using standard accounting half-up rounding.
 */
export function roundUsd(value: DecimalValue): Decimal {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Rounds an IQD value to 0 decimal places (or 2 if sub-dinar precision is needed).
 */
export function roundIqd(value: DecimalValue, decimals = 0): Decimal {
  return D(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
}

/**
 * Rounds according to currency code ('USD' -> 2 decimals, 'IQD' -> 0 decimals or 2).
 */
export function roundCurrency(value: DecimalValue, currency: 'USD' | 'IQD' | string): Decimal {
  if (currency === 'IQD') {
    return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
  return roundUsd(value);
}

/**
 * Converts an amount in `currency` to base USD using the explicit `exchangeRate` (1 USD = X IQD).
 */
export function toUsd(
  amountOriginal: DecimalValue,
  currency: 'USD' | 'IQD' | string,
  exchangeRate: DecimalValue
): Decimal {
  const amt = D(amountOriginal);
  if (currency === 'USD') {
    return roundUsd(amt);
  }
  const rate = D(exchangeRate);
  if (rate.lte(0)) {
    throw new Error('Exchange rate must be greater than zero');
  }
  return roundUsd(amt.div(rate));
}

/**
 * Converts a base USD amount into the target display currency ('USD' or 'IQD') using `exchangeRate`.
 */
export function fromUsd(
  amountUsd: DecimalValue,
  targetCurrency: 'USD' | 'IQD' | string,
  exchangeRate: DecimalValue
): Decimal {
  const amt = D(amountUsd);
  if (targetCurrency === 'USD') {
    return roundUsd(amt);
  }
  const rate = D(exchangeRate);
  if (rate.lte(0)) {
    throw new Error('Exchange rate must be greater than zero');
  }
  return roundIqd(amt.mul(rate), 0);
}

/**
 * Converts between any two currencies ('USD' | 'IQD') using `exchangeRate` (1 USD = X IQD).
 */
export function convertCurrency(
  amount: DecimalValue,
  fromCurr: 'USD' | 'IQD' | string,
  toCurr: 'USD' | 'IQD' | string,
  exchangeRate: DecimalValue
): Decimal {
  if (fromCurr === toCurr) {
    return roundCurrency(amount, toCurr);
  }
  const inUsd = toUsd(amount, fromCurr, exchangeRate);
  return fromUsd(inUsd, toCurr, exchangeRate);
}

/**
 * Formats a numeric value in USD or IQD for display.
 */
export function formatCurrency(
  amount: DecimalValue,
  currency: 'USD' | 'IQD' | string = 'USD',
  locale: 'en' | 'ar' | 'ku' = 'en'
): string {
  const d = D(amount);
  const num = d.toNumber();

  if (currency === 'IQD') {
    const formatted = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(num));
    return locale === 'en' ? `${formatted} IQD` : `${formatted} د.ع`;
  }

  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `$${formatted}`;
}

/**
 * Formats a base USD value directly into the user's selected display currency ('USD' or 'IQD').
 */
export function formatBaseUsdInCurrency(
  amountUsd: DecimalValue,
  displayCurrency: 'USD' | 'IQD' | string = 'USD',
  exchangeRate: DecimalValue = 1500,
  locale: 'en' | 'ar' | 'ku' = 'en'
): string {
  const converted = fromUsd(amountUsd, displayCurrency, exchangeRate);
  return formatCurrency(converted, displayCurrency, locale);
}

export { Decimal };
