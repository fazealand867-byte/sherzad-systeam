'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { LanguageCode } from '@/lib/i18n';

const MONTHS: Record<LanguageCode, string[]> = {
  ku: [
    'کانوونی دووەم (١)',
    'شوبات (٢)',
    'ئازار (٣)',
    'نیسان (٤)',
    'ئایار (٥)',
    'حوزەیران (٦)',
    'تەمموز (٧)',
    'ئاب (٨)',
    'ئەیلوول (٩)',
    'تشرینی یەکەم (١٠)',
    'تشرینی دووەم (١١)',
    'کانوونی یەکەم (١٢)',
  ],
  ar: [
    'يناير (1)',
    'فبراير (2)',
    'مارس (3)',
    'أبريل (4)',
    'مايو (5)',
    'يونيو (6)',
    'يوليو (7)',
    'أغسطس (8)',
    'سبتمبر (9)',
    'أكتوبر (10)',
    'نوفمبر (11)',
    'ديسمبر (12)',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
};

const SHORT_MONTHS: Record<LanguageCode, string[]> = {
  ku: ['ک.دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران', 'تەمموز', 'ئاب', 'ئەیلوول', 'ت.یەکەم', 'ت.دووەم', 'ک.یەکەم'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const WEEKDAYS: Record<LanguageCode, string[]> = {
  ku: ['ی', 'د', 'س', 'چ', 'پ', 'هـ', 'ش'],
  ar: ['أح', 'إث', 'ثل', 'أر', 'خم', 'جم', 'سب'],
  en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseYmd(val: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(val || '');
  if (m) {
    return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

function parseYm(val: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})/.exec(val || '');
  if (m) {
    return { year: Number(m[1]), month: Number(m[2]) - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

/* ============================================================================
   1. CUSTOM SLEEK DATE PICKER (REPLACES NATIVE <input type="date"> SYSTEM-WIDE)
   ============================================================================ */

interface CustomDatePickerProps {
  value: string;
  onChange: (val: string) => void;
  lang?: LanguageCode;
  className?: string;
  placeholder?: string;
}

export function CustomDatePicker({
  value,
  onChange,
  lang = 'ku',
  className = '',
  placeholder,
}: CustomDatePickerProps) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseYmd(value), [value]);
  const [viewYear, setViewYear] = useState(parsed.year);
  const [viewMonth, setViewMonth] = useState(parsed.month);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setViewYear(parsed.year);
    setViewMonth(parsed.month);
  }, [parsed.year, parsed.month]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const calendarDays = useMemo(() => {
    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [viewYear, viewMonth]);

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const selectDay = (d: number) => {
    const str = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`;
    onChange(str);
    setOpen(false);
  };

  const selectToday = () => {
    const now = new Date();
    const str = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    onChange(str);
    setOpen(false);
  };

  const displayLabel = value
    ? `${parsed.year}/${pad2(parsed.month + 1)}/${pad2(parsed.day)}`
    : placeholder || (lang === 'ku' ? 'بەروار هەڵبژێرە' : lang === 'ar' ? 'اختر التاريخ' : 'Select Date');

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border transition text-sm font-semibold ${
          open
            ? 'border-emerald-500 ring-2 ring-emerald-500/20'
            : 'border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/50'
        }`}
      >
        <span className="font-mono text-xs sm:text-sm text-slate-800 dark:text-white tracking-wide">
          {displayLabel}
        </span>
        <Calendar className="w-4 h-4 text-emerald-500 shrink-0" />
      </button>

      {open && (
        <div
          dir="ltr"
          className="absolute z-[70] mt-2 w-72 end-0 bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-emerald-500/30 rounded-2xl shadow-2xl shadow-black/40 p-3.5 space-y-3 animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Month & Year Header */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-emerald-500/20 text-slate-700 dark:text-slate-200 hover:text-emerald-400 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="text-center">
              <div className="text-xs font-black text-slate-900 dark:text-white">
                {MONTHS[lang][viewMonth]}
              </div>
              <div className="flex items-center justify-center gap-1 mt-0.5">
                <button
                  type="button"
                  onClick={() => setViewYear((y) => y - 1)}
                  className="text-[10px] px-1.5 rounded bg-slate-100 dark:bg-charcoal-800 text-slate-500 hover:text-emerald-400"
                >
                  -
                </button>
                <span className="text-[11px] font-mono font-bold text-emerald-500">{viewYear}</span>
                <button
                  type="button"
                  onClick={() => setViewYear((y) => y + 1)}
                  className="text-[10px] px-1.5 rounded bg-slate-100 dark:bg-charcoal-800 text-slate-500 hover:text-emerald-400"
                >
                  +
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={nextMonth}
              className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-emerald-500/20 text-slate-700 dark:text-slate-200 hover:text-emerald-400 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday Labels */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS[lang].map((wd, idx) => (
              <div key={idx} className="text-[11px] font-bold text-slate-400 py-1">
                {wd}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((d, idx) => {
              if (d === null) return <div key={`empty-${idx}`} />;
              const cellStr = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`;
              const isSelected = value.slice(0, 10) === cellStr;
              const isToday = todayStr === cellStr;
              return (
                <button
                  key={cellStr}
                  type="button"
                  onClick={() => selectDay(d)}
                  className={`h-8 w-full rounded-xl text-xs font-bold transition flex items-center justify-center ${
                    isSelected
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 font-black'
                      : isToday
                      ? 'border border-emerald-500 text-emerald-500 bg-emerald-500/10'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-charcoal-800'
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>

          {/* Footer Quick Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-charcoal-800">
            <button
              type="button"
              onClick={selectToday}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500 text-xs font-bold transition"
            >
              {lang === 'ku' ? 'ئەمڕۆ' : lang === 'ar' ? 'اليوم' : 'Today'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-charcoal-800 text-slate-500 dark:text-slate-300 text-xs font-semibold"
            >
              {lang === 'ku' ? 'داخستن' : lang === 'ar' ? 'إغلاق' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   2. CUSTOM SLEEK MONTH PICKER (REPLACES NATIVE <input type="month"> SYSTEM-WIDE)
   ============================================================================ */

interface CustomMonthPickerProps {
  value: string; // YYYY-MM
  onChange: (val: string) => void;
  lang?: LanguageCode;
  className?: string;
}

export function CustomMonthPicker({
  value,
  onChange,
  lang = 'ku',
  className = '',
}: CustomMonthPickerProps) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseYm(value), [value]);
  const [viewYear, setViewYear] = useState(parsed.year);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setViewYear(parsed.year);
  }, [parsed.year]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const selectMonth = (mIdx: number) => {
    onChange(`${viewYear}-${pad2(mIdx + 1)}`);
    setOpen(false);
  };

  const selectThisMonth = () => {
    const now = new Date();
    onChange(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border transition text-sm font-bold ${
          open
            ? 'border-emerald-500 ring-2 ring-emerald-500/20'
            : 'border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/50'
        }`}
      >
        <span className="text-xs sm:text-sm text-slate-800 dark:text-white whitespace-nowrap">
          {SHORT_MONTHS[lang][parsed.month]} <span className="font-mono text-emerald-500">{parsed.year}</span>
        </span>
        <Calendar className="w-4 h-4 text-emerald-500 shrink-0" />
      </button>

      {open && (
        <div
          dir="ltr"
          className="absolute z-[70] mt-2 w-64 end-0 bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-emerald-500/30 rounded-2xl shadow-2xl shadow-black/40 p-3.5 space-y-3"
        >
          {/* Year switcher */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-emerald-500/20 text-slate-700 dark:text-slate-200 hover:text-emerald-400 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-mono font-black text-emerald-500">{viewYear}</span>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-emerald-500/20 text-slate-700 dark:text-slate-200 hover:text-emerald-400 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* 12 Months Grid */}
          <div className="grid grid-cols-3 gap-1.5">
            {SHORT_MONTHS[lang].map((mName, idx) => {
              const isSelected = parsed.year === viewYear && parsed.month === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => selectMonth(idx)}
                  className={`py-2 px-1 rounded-xl text-xs font-bold transition ${
                    isSelected
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                      : 'bg-slate-50 dark:bg-charcoal-950 text-slate-700 dark:text-slate-200 hover:bg-emerald-500/15 hover:text-emerald-500'
                  }`}
                >
                  {mName}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-charcoal-800">
            <button
              type="button"
              onClick={selectThisMonth}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500 text-xs font-bold transition"
            >
              {lang === 'ku' ? 'ئەم مانگە' : lang === 'ar' ? 'هذا الشهر' : 'This Month'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-charcoal-800 text-slate-500 dark:text-slate-300 text-xs font-semibold"
            >
              {lang === 'ku' ? 'داخستن' : lang === 'ar' ? 'إغلاق' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
