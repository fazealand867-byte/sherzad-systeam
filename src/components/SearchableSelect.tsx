'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, X, Plus, Check } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  badgeColor?: 'emerald' | 'amber' | 'rose' | 'slate';
  searchText?: string;
}

interface SearchableSelectProps {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  onQuickAdd?: () => void;
  quickAddLabel?: string;
  className?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results',
  disabled = false,
  onQuickAdd,
  quickAddLabel,
  className = '',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 20);
    } else {
      setQuery('');
    }
  }, [open]);

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.sublabel || ''} ${o.badge || ''} ${o.searchText || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  const badgeCls = (color?: string) => {
    if (color === 'rose') return 'bg-rose-500/15 text-rose-500';
    if (color === 'amber') return 'bg-amber-500/15 text-amber-500';
    if (color === 'emerald') return 'bg-emerald-500/15 text-emerald-500';
    return 'bg-slate-200 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300';
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border text-start transition text-sm ${
          open
            ? 'border-emerald-500 ring-2 ring-emerald-500/20'
            : 'border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <div className="min-w-0 flex-1">
          {selected ? (
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 dark:text-white truncate">
                {selected.label}
              </span>
              {selected.badge && (
                <span
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold shrink-0 ${badgeCls(
                    selected.badgeColor
                  )}`}
                >
                  {selected.badge}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
            open ? 'rotate-180 text-emerald-500' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-700 rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 dark:border-charcoal-800 flex items-center gap-2">
            <Search className="w-4 h-4 text-emerald-500 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm focus:outline-none text-slate-900 dark:text-white placeholder:text-slate-400"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-charcoal-800 text-slate-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
            {filtered.length === 0 ? (
              <div className="py-5 text-center text-xs text-slate-400">{emptyText}</div>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`w-full text-start px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 transition ${
                      isSelected
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'hover:bg-slate-100 dark:hover:bg-charcoal-800/80 text-slate-800 dark:text-slate-100'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                        {isSelected && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                        <span className="truncate">{opt.label}</span>
                      </div>
                      {opt.sublabel && (
                        <div className="text-xs text-slate-400 truncate mt-0.5">
                          {opt.sublabel}
                        </div>
                      )}
                    </div>
                    {opt.badge && (
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-bold shrink-0 ${badgeCls(
                          opt.badgeColor
                        )}`}
                      >
                        {opt.badge}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {onQuickAdd && (
            <div className="p-2 border-t border-slate-100 dark:border-charcoal-800 bg-slate-50 dark:bg-charcoal-950">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onQuickAdd();
                }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-600 dark:text-emerald-400 text-xs font-bold transition"
              >
                <Plus className="w-3.5 h-3.5" />
                {quickAddLabel || '+ Add New'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
