import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sherzad Enterprise ERP — Business Management & Double-Entry Accounting System',
  description:
    'Complete Production-Ready Business Management, Double-Entry Accounting, Sales, POS, Purchases, Multi-Warehouse Inventory, Debtors, Creditors, and Financial Reporting System (Arabic, Kurdish Sorani, English | USD & IQD)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className="dark" suppressHydrationWarning>
      <body className="bg-charcoal-50 dark:bg-charcoal-950 text-charcoal-900 dark:text-slate-100 min-h-screen selection:bg-emerald-500 selection:text-white transition-colors duration-200">
        {children}
      </body>
    </html>
  );
}
