import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sherzad Food Factory — سیستەمی بەڕێوەبردنی کارگەی خۆراک',
  description:
    'Simple, professional Food Factory Management System (Kurdish Sorani, Arabic, English | IQD)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ku" dir="rtl" className="dark" suppressHydrationWarning>
      <body className="bg-charcoal-50 dark:bg-charcoal-950 text-charcoal-900 dark:text-slate-100 min-h-screen selection:bg-emerald-500 selection:text-white transition-colors duration-200">
        {children}
      </body>
    </html>
  );
}
