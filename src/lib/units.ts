import { D, Decimal } from './decimal';

export interface UnitDefinition {
  id: string;
  code: string;
  symbol: string;
  nameKu: string;
  nameAr: string;
  nameEn: string;
  family: string;
  baseUnitCode: string;
  toBaseFactor: number;
  allowDecimal?: boolean;
  isSystem?: boolean;
}

export const DEFAULT_UNITS: UnitDefinition[] = [
  {
    id: 'unit_g',
    code: 'g',
    symbol: 'g',
    nameKu: 'گرام',
    nameAr: 'غرام',
    nameEn: 'Gram',
    family: 'WEIGHT',
    baseUnitCode: 'g',
    toBaseFactor: 1,
    allowDecimal: true,
    isSystem: true,
  },
  {
    id: 'unit_kg',
    code: 'kg',
    symbol: 'kg',
    nameKu: 'کیلۆگرام',
    nameAr: 'كيلوغرام',
    nameEn: 'Kilogram',
    family: 'WEIGHT',
    baseUnitCode: 'g',
    toBaseFactor: 1000,
    allowDecimal: true,
    isSystem: true,
  },
  {
    id: 'unit_piece',
    code: 'piece',
    symbol: 'دانە',
    nameKu: 'دانە',
    nameAr: 'قطعة',
    nameEn: 'Piece',
    family: 'COUNT',
    baseUnitCode: 'piece',
    toBaseFactor: 1,
    allowDecimal: false,
    isSystem: true,
  },
  {
    id: 'unit_pack',
    code: 'pack',
    symbol: 'پاکەت',
    nameKu: 'پاکەت',
    nameAr: 'عبوة',
    nameEn: 'Pack',
    family: 'PACK',
    baseUnitCode: 'pack',
    toBaseFactor: 1,
    allowDecimal: false,
    isSystem: true,
  },
  {
    id: 'unit_box',
    code: 'box',
    symbol: 'کارتۆن',
    nameKu: 'کارتۆن',
    nameAr: 'كرتون',
    nameEn: 'Box',
    family: 'BOX',
    baseUnitCode: 'box',
    toBaseFactor: 1,
    allowDecimal: false,
    isSystem: true,
  },
  {
    id: 'unit_tray',
    code: 'tray',
    symbol: 'سینی',
    nameKu: 'سینی',
    nameAr: 'صينية',
    nameEn: 'Tray',
    family: 'TRAY',
    baseUnitCode: 'tray',
    toBaseFactor: 1,
    allowDecimal: false,
    isSystem: true,
  },
];

export function normalizeUnitCode(code?: string | null): string {
  if (!code) return 'piece';
  const c = code.trim().toLowerCase();
  const aliases: Record<string, string> = {
    pcs: 'piece',
    pc: 'piece',
    piece: 'piece',
    pieces: 'piece',
    kg: 'kg',
    kilogram: 'kg',
    g: 'g',
    gr: 'g',
    gram: 'g',
    grams: 'g',
    pack: 'pack',
    pkt: 'pack',
    set: 'pack',
    box: 'box',
    carton: 'box',
    tray: 'tray',
  };
  return aliases[c] || c;
}

export function findUnit(
  code: string | null | undefined,
  units: UnitDefinition[] = DEFAULT_UNITS
): UnitDefinition | undefined {
  const norm = normalizeUnitCode(code);
  return (units.length ? units : DEFAULT_UNITS).find(
    (u) => u.code.toLowerCase() === norm
  );
}

export function areUnitsCompatible(
  fromCode: string,
  toCode: string,
  units: UnitDefinition[] = DEFAULT_UNITS
): boolean {
  const f = normalizeUnitCode(fromCode);
  const t = normalizeUnitCode(toCode);
  if (f === t) return true;
  const u1 = findUnit(f, units);
  const u2 = findUnit(t, units);
  if (!u1 || !u2) return false;
  if (!u1.family || !u2.family || u1.family !== u2.family) return false;
  return (u1.baseUnitCode || u1.code) === (u2.baseUnitCode || u2.code);
}

export function getCompatibleUnits(
  baseCode: string,
  units: UnitDefinition[] = DEFAULT_UNITS
): UnitDefinition[] {
  const list = units.length ? units : DEFAULT_UNITS;
  const matched = list.filter((u) => areUnitsCompatible(u.code, baseCode, list));
  if (matched.length > 0) return matched;
  const fallback = findUnit(baseCode, list);
  return fallback ? [fallback] : [DEFAULT_UNITS[2]];
}

/**
 * Decimal-safe quantity conversion between compatible measurement units.
 * Throws an error if units are incompatible (e.g., kg -> piece).
 */
export function convertQuantity(
  quantity: number | string | Decimal,
  fromCode: string,
  toCode: string,
  units: UnitDefinition[] = DEFAULT_UNITS
): number {
  const qty = D(quantity);
  const f = normalizeUnitCode(fromCode);
  const t = normalizeUnitCode(toCode);
  if (f === t) {
    return qty.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
  }
  const uFrom = findUnit(f, units);
  const uTo = findUnit(t, units);
  if (!uFrom || !uTo || !areUnitsCompatible(f, t, units)) {
    throw new Error(
      `Incompatible unit conversion: cannot convert from '${fromCode}' to '${toCode}'.`
    );
  }
  const fromFactor = D(uFrom.toBaseFactor);
  const toFactor = D(uTo.toBaseFactor);
  if (fromFactor.lte(0) || toFactor.lte(0)) {
    throw new Error('Unit conversion factor must be positive.');
  }
  return qty
    .mul(fromFactor)
    .div(toFactor)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/**
 * Converts a per-unit price/cost in `baseUnit` to a per-unit price/cost in `targetUnit`.
 * Example: 12,000 IQD/kg -> 12 IQD/g.
 */
export function convertUnitPrice(
  pricePerBaseUnit: number | string | Decimal,
  baseUnitCode: string,
  targetUnitCode: string,
  units: UnitDefinition[] = DEFAULT_UNITS
): number {
  const baseFactorOfOneTarget = convertQuantity(1, targetUnitCode, baseUnitCode, units);
  return D(pricePerBaseUnit)
    .mul(baseFactorOfOneTarget)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function unitLabel(
  code: string | null | undefined,
  lang: 'ku' | 'ar' | 'en',
  units: UnitDefinition[] = DEFAULT_UNITS
): string {
  const u = findUnit(code, units);
  if (!u) return code || '';
  if (lang === 'ku') return u.nameKu || u.symbol || u.code;
  if (lang === 'ar') return u.nameAr || u.symbol || u.code;
  return u.nameEn || u.symbol || u.code;
}
