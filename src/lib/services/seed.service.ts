import prisma from '../prisma';
import { DEFAULT_ROLE_PERMISSIONS, hashPassword, UserRole } from '../auth';
import { recordCashDepositOrWithdrawal } from './cashbank.service';
import { createPurchaseInvoice } from './purchases.service';
import { createSalesInvoice } from './sales.service';
import { recordCreditorPayment, recordDebtorCollection } from './debt.service';
import { createExpense } from './expense.service';
import { transferWarehouseStock } from './inventory.service';

export const CORE_CHART_OF_ACCOUNTS = [
  // ASSETS (1000-1999)
  {
    code: '1010',
    nameEn: 'Main Cash Vault (USD)',
    nameAr: 'الخزينة النقدية الرئيسية (دولار)',
    nameKu: 'قاسەی سەرەکی نەقدی (دۆلار)',
    type: 'ASSET',
    subType: 'CASH',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '1015',
    nameEn: 'Main Cash Safe (IQD)',
    nameAr: 'صندوق النقد الرئيسي (دينار عراقي)',
    nameKu: 'سندوقی سەرەکی نەقد (دیناری عێراقی)',
    type: 'ASSET',
    subType: 'CASH',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '1020',
    nameEn: 'Trade Bank of Iraq — TBI (USD)',
    nameAr: 'المصرف العراقي للتجارة TBI (دولار)',
    nameKu: 'بانکی بازرگانی عێراقی TBI (دۆلار)',
    type: 'ASSET',
    subType: 'BANK',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '1025',
    nameEn: 'First Iraqi Bank — FIB (IQD)',
    nameAr: 'المصرف العراقي الأول FIB (دينار)',
    nameKu: 'بانکی یەکەمی عێراقی FIB (دینار)',
    type: 'ASSET',
    subType: 'BANK',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '1200',
    nameEn: 'Accounts Receivable (Trade Debtors)',
    nameAr: 'الذمم المدينة (حسابات العملاء)',
    nameKu: 'قەرزی کڕیاران (خاوەن قەرزەکان)',
    type: 'ASSET',
    subType: 'ACCOUNTS_RECEIVABLE',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '1300',
    nameEn: 'Merchandise Inventory Asset',
    nameAr: 'مخزون البضائع التجاري',
    nameKu: 'سامانی کۆگای کاڵاکان',
    type: 'ASSET',
    subType: 'INVENTORY',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '1500',
    nameEn: 'Equipment & Fixed Assets',
    nameAr: 'المعدات والأصول الثابتة',
    nameKu: 'ئامێر و سامانە جێگیرەکان',
    type: 'ASSET',
    subType: 'FIXED_ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
  },

  // LIABILITIES (2000-2999)
  {
    code: '2100',
    nameEn: 'Accounts Payable (Trade Creditors)',
    nameAr: 'الذمم الدائنة (حسابات الموردين)',
    nameKu: 'قەرزی دابینکەران (قەرزدەرەکان)',
    type: 'LIABILITY',
    subType: 'ACCOUNTS_PAYABLE',
    normalBalance: 'CREDIT',
    isSystem: true,
  },
  {
    code: '2200',
    nameEn: 'Sales Tax & VAT Payable',
    nameAr: 'ضريبة المبيعات المستحقة',
    nameKu: 'باجی فرۆشتنی شایستە',
    type: 'LIABILITY',
    subType: 'TAX_PAYABLE',
    normalBalance: 'CREDIT',
    isSystem: true,
  },
  {
    code: '2300',
    nameEn: 'Accrued Expenses Payable',
    nameAr: 'المصروفات المستحقة غير المدفوعة',
    nameKu: 'خەرجییە شایستە نەدراوەکان',
    type: 'LIABILITY',
    subType: 'OTHER_LIABILITY',
    normalBalance: 'CREDIT',
    isSystem: true,
  },

  // EQUITY (3000-3999)
  {
    code: '3000',
    nameEn: "Owner's Capital & Paid-In Equity",
    nameAr: 'رأس مال المالك وحقوق الملكية',
    nameKu: 'سەرمایەی خاوەن کار و مافی خاوەندارێتی',
    type: 'EQUITY',
    subType: 'OWNER_EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
  },
  {
    code: '3100',
    nameEn: 'Retained Earnings',
    nameAr: 'الأرباح المحتجزة',
    nameKu: 'قازانجی گلداوە',
    type: 'EQUITY',
    subType: 'RETAINED_EARNINGS',
    normalBalance: 'CREDIT',
    isSystem: true,
  },
  {
    code: '3200',
    nameEn: "Owner's Drawings & Distributions",
    nameAr: 'مسحوبات المالك الشخصية',
    nameKu: 'ڕاکێشانی تایبەتی خاوەن کار',
    type: 'EQUITY',
    subType: 'OWNER_EQUITY',
    normalBalance: 'DEBIT',
    isSystem: true,
  },

  // REVENUE (4000-4999)
  {
    code: '4000',
    nameEn: 'Sales Revenue',
    nameAr: 'إيرادات المبيعات',
    nameKu: 'داهاتی فرۆشتن',
    type: 'REVENUE',
    subType: 'SALES_REVENUE',
    normalBalance: 'CREDIT',
    isSystem: true,
  },
  {
    code: '4050',
    nameEn: 'Sales Returns & Allowances',
    nameAr: 'مردودات ومسموحات المبيعات',
    nameKu: 'گەڕاوەکانی فرۆشتن',
    type: 'REVENUE',
    subType: 'SALES_RETURN',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '4100',
    nameEn: 'Sales Discounts',
    nameAr: 'خصومات المبيعات الممنوحة',
    nameKu: 'داشکاندنی فرۆشتن',
    type: 'REVENUE',
    subType: 'SALES_DISCOUNT',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '4200',
    nameEn: 'Other Operating Income',
    nameAr: 'إيرادات تشغيلية أخرى',
    nameKu: 'داهاتی دیکەی کارگێڕی',
    type: 'REVENUE',
    subType: 'OTHER_INCOME',
    normalBalance: 'CREDIT',
    isSystem: true,
  },

  // EXPENSES & COGS (5000-5999)
  {
    code: '5000',
    nameEn: 'Cost of Goods Sold (COGS)',
    nameAr: 'تكلفة البضاعة المباعة',
    nameKu: 'تێچووی کاڵای فرۆشراو',
    type: 'EXPENSE',
    subType: 'COGS',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '5110',
    nameEn: 'Salaries & Employee Wages',
    nameAr: 'الرواتب وأجور الموظفين',
    nameKu: 'مووچە و کرێی کارمەندان',
    type: 'EXPENSE',
    subType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '5120',
    nameEn: 'Rent & Facility Lease',
    nameAr: 'إيجار المباني والمعارض',
    nameKu: 'کرێی بینا و پێشانگا',
    type: 'EXPENSE',
    subType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '5130',
    nameEn: 'Electricity, Generator & Utilities',
    nameAr: 'الكهرباء والمولدة والخدمات',
    nameKu: 'کارەبا و مۆلیدە و خزمەتگوزاری',
    type: 'EXPENSE',
    subType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '5140',
    nameEn: 'Transportation, Fuel & Shipping',
    nameAr: 'النقل والوقود والشحن',
    nameKu: 'گواستنەوە و سووتەمەنی و بارکردن',
    type: 'EXPENSE',
    subType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '5150',
    nameEn: 'Maintenance & Repairs',
    nameAr: 'الصيانة والإصلاحات',
    nameKu: 'چاککردنەوە و نۆژەنکردنەوە',
    type: 'EXPENSE',
    subType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '5160',
    nameEn: 'Marketing & Advertising',
    nameAr: 'التسويق والإعلانات',
    nameKu: 'بازاڕگەری و ڕیکلام',
    type: 'EXPENSE',
    subType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '5170',
    nameEn: 'Internet & Telecommunications',
    nameAr: 'الإنترنت والاتصالات',
    nameKu: 'ئینتەرنێت و پەیوەندییەکان',
    type: 'EXPENSE',
    subType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '5180',
    nameEn: 'Office Supplies & Hospitality',
    nameAr: 'قرطاسية ومستلزمات المكتب والضيافة',
    nameKu: 'پێداویستی ئۆفیس و میوانداری',
    type: 'EXPENSE',
    subType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '5190',
    nameEn: 'Miscellaneous Operating Expense',
    nameAr: 'مصروفات تشغيلية متفرقة',
    nameKu: 'خەرجی جۆراوجۆری کارگێڕی',
    type: 'EXPENSE',
    subType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    code: '5200',
    nameEn: 'Inventory Shrinkage & Stock Adjustments',
    nameAr: 'فروقات وتعديلات المخزون والتالف',
    nameKu: 'جیاوازی و ڕێکخستنی کۆگا و خەساربوو',
    type: 'EXPENSE',
    subType: 'COGS',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
];

export async function ensureSystemSeeded() {
  const existingAccounts = await prisma.account.count();
  if (existingAccounts > 0) {
    return { alreadySeeded: true };
  }

  // 1. Company Settings
  await prisma.companySettings.create({
    data: {
      companyNameEn: 'Sherzad Enterprise Group',
      companyNameAr: 'مجموعة شيرزاد للتجارة العامة والمحاسبة',
      companyNameKu: 'گرووپی شێرزاد بۆ بازرگانی گشتی و ژمێریاری',
      phone: '+964 750 320 9900',
      email: 'finance@sherzad-enterprise.iq',
      addressEn: '60 Meter Road, Financial Tower, Erbil, Kurdistan Region, Iraq',
      addressAr: 'شارع الستين، البرج المالي، أربيل، إقليم كردستان العراق',
      addressKu: 'شەقامی شەست مەتری، تاوەری دارایی، هەولێر، هەرێمی کوردستان',
      taxNumber: 'IQ-KRG-9940218',
      baseCurrency: 'USD',
      defaultDisplayCurrency: 'USD',
      usdToIqdRate: 1500.0,
      defaultTaxRate: 0.0,
      expenseApprovalThresholdUsd: 1000.0,
      defaultLanguage: 'ar',
      demoModeEnabled: true,
    },
  });

  await prisma.exchangeRateHistory.create({
    data: {
      fromCurrency: 'USD',
      toCurrency: 'IQD',
      rate: 1500.0,
      notes: 'Initial central exchange rate configuration (1 USD = 1,500 IQD)',
    },
  });

  // 2. Role Permissions
  const roleNames: Record<UserRole, { en: string; ar: string; ku: string }> = {
    SUPER_ADMIN: {
      en: 'Super Administrator',
      ar: 'مدير النظام الأعلى',
      ku: 'بەڕێوەبەری باڵای سیستەم',
    },
    BUSINESS_OWNER: {
      en: 'Business Owner',
      ar: 'مالك الشركة',
      ku: 'خاوەنی کۆمپانیا',
    },
    ACCOUNTANT: {
      en: 'Senior Accountant',
      ar: 'محاسب مالي',
      ku: 'ژمێریاری دارایی',
    },
    SALES_EMPLOYEE: {
      en: 'Sales Representative',
      ar: 'موظف مبيعات',
      ku: 'کارمەندی فرۆشتن',
    },
    INVENTORY_MANAGER: {
      en: 'Inventory & Warehouse Manager',
      ar: 'مدير المخازن والمستودعات',
      ku: 'بەڕێوەبەری کۆگا',
    },
    VIEWER: {
      en: 'Read-Only Auditor / Viewer',
      ar: 'مراقب / مستعرض فقط',
      ku: 'چاودێر / تەنها بینەر',
    },
  };

  for (const [roleKey, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const names = roleNames[roleKey as UserRole];
    await prisma.rolePermission.upsert({
      where: { role: roleKey },
      update: {},
      create: {
        role: roleKey,
        nameEn: names.en,
        nameAr: names.ar,
        nameKu: names.ku,
        permissionsJson: JSON.stringify(perms),
      },
    });
  }

  // 3. Users for all 6 roles
  const defaultPassword = hashPassword('Admin@123');
  const adminUser = await prisma.user.create({
    data: {
      name: 'Sherzad Othman (Super Admin)',
      email: 'admin@sherzad.iq',
      username: 'admin',
      passwordHash: defaultPassword,
      role: 'SUPER_ADMIN',
      phone: '+964 750 111 0001',
      preferredLanguage: 'ar',
      preferredCurrency: 'USD',
    },
  });

  await prisma.user.createMany({
    data: [
      {
        name: 'Aland Othman (Business Owner)',
        email: 'owner@sherzad.iq',
        username: 'owner',
        passwordHash: defaultPassword,
        role: 'BUSINESS_OWNER',
        phone: '+964 750 111 0002',
        preferredLanguage: 'ku',
        preferredCurrency: 'USD',
      },
      {
        name: 'Karwan Mahmood (Chief Accountant)',
        email: 'accountant@sherzad.iq',
        username: 'accountant',
        passwordHash: defaultPassword,
        role: 'ACCOUNTANT',
        phone: '+964 750 111 0003',
        preferredLanguage: 'ar',
        preferredCurrency: 'USD',
      },
      {
        name: 'Rebaz Hassan (Sales Executive)',
        email: 'sales@sherzad.iq',
        username: 'sales',
        passwordHash: defaultPassword,
        role: 'SALES_EMPLOYEE',
        phone: '+964 750 111 0004',
        preferredLanguage: 'ku',
        preferredCurrency: 'IQD',
      },
      {
        name: 'Diyar Karim (Warehouse Manager)',
        email: 'inventory@sherzad.iq',
        username: 'inventory',
        passwordHash: defaultPassword,
        role: 'INVENTORY_MANAGER',
        phone: '+964 750 111 0005',
        preferredLanguage: 'ar',
        preferredCurrency: 'USD',
      },
      {
        name: 'Sara Ahmed (External Auditor)',
        email: 'viewer@sherzad.iq',
        username: 'viewer',
        passwordHash: defaultPassword,
        role: 'VIEWER',
        phone: '+964 750 111 0006',
        preferredLanguage: 'en',
        preferredCurrency: 'USD',
      },
    ],
  });

  // 4. Chart of Accounts
  const createdAccounts = new Map<string, string>();
  for (const acc of CORE_CHART_OF_ACCOUNTS) {
    const record = await prisma.account.create({
      data: acc,
    });
    createdAccounts.set(acc.code, record.id);
  }

  // 5. Financial Accounts (Cash Registers & Bank Accounts)
  const usdCashRegister = await prisma.financialAccount.create({
    data: {
      code: 'CASH-USD-01',
      nameEn: 'Main USD Cash Vault — Erbil HQ',
      nameAr: 'الخزينة النقدية الرئيسية (دولار) — أربيل',
      nameKu: 'قاسەی سەرەکی دۆلار — هەولێر',
      type: 'CASH_REGISTER',
      currency: 'USD',
      ledgerAccountId: createdAccounts.get('1010')!,
    },
  });

  const iqdCashRegister = await prisma.financialAccount.create({
    data: {
      code: 'CASH-IQD-01',
      nameEn: 'Main IQD Cash Safe — Erbil HQ',
      nameAr: 'صندوق النقد الرئيسي (دينار عراقي) — أربيل',
      nameKu: 'سندوقی سەرەکی دیناری عێراقی — هەولێر',
      type: 'CASH_REGISTER',
      currency: 'IQD',
      ledgerAccountId: createdAccounts.get('1015')!,
    },
  });

  const usdBankAccount = await prisma.financialAccount.create({
    data: {
      code: 'BANK-TBI-USD',
      nameEn: 'Trade Bank of Iraq (TBI Corporate USD)',
      nameAr: 'المصرف العراقي للتجارة (حساب الشركات دولار)',
      nameKu: 'بانکی بازرگانی عێراقی TBI (هەژماری دۆلار)',
      type: 'BANK_ACCOUNT',
      currency: 'USD',
      bankName: 'Trade Bank of Iraq (TBI)',
      accountNumber: '0019-482910-001',
      iban: 'IQ98TBIQ0019482910001',
      ledgerAccountId: createdAccounts.get('1020')!,
    },
  });

  await prisma.financialAccount.create({
    data: {
      code: 'BANK-FIB-IQD',
      nameEn: 'First Iraqi Bank (FIB Business IQD)',
      nameAr: 'المصرف العراقي الأول (حساب الأعمال دينار)',
      nameKu: 'بانکی یەکەمی عێراقی FIB (هەژماری دینار)',
      type: 'BANK_ACCOUNT',
      currency: 'IQD',
      bankName: 'First Iraqi Bank (FIB)',
      accountNumber: '4490-221890-368',
      iban: 'IQ22FIBQ4490221890368',
      ledgerAccountId: createdAccounts.get('1025')!,
    },
  });

  // 6. Warehouses
  const mainWarehouse = await prisma.warehouse.create({
    data: {
      code: 'WH-EBL-01',
      nameEn: 'Erbil Central Distribution Warehouse',
      nameAr: 'مستودع أربيل المركزي للتوزيع',
      nameKu: 'کۆگای ناوەندی دابەشکردنی هەولێر',
      location: 'Erbil — Gwer Industrial Zone',
      managerName: 'Diyar Karim',
      phone: '+964 750 111 0005',
      isDefault: true,
    },
  });

  const suliWarehouse = await prisma.warehouse.create({
    data: {
      code: 'WH-SUL-02',
      nameEn: 'Sulaymaniyah Regional Warehouse',
      nameAr: 'مستودع السليمانية الإقليمي',
      nameKu: 'کۆگای هەرێمی سلێمانی',
      location: 'Sulaymaniyah — Tasluja Highway',
      managerName: 'Harem Jalal',
      phone: '+964 770 220 4455',
      isDefault: false,
    },
  });

  await prisma.warehouse.create({
    data: {
      code: 'WH-DHK-03',
      nameEn: 'Duhok Showroom & Storage',
      nameAr: 'معرض ومستودع دهوك',
      nameKu: 'پێشانگا و کۆگای دهۆک',
      location: 'Duhok — Zakho Way Commercial Center',
      managerName: 'warheen Barzani',
      phone: '+964 750 440 8899',
      isDefault: false,
    },
  });

  // 7. Product Categories
  const catLaptops = await prisma.category.create({
    data: {
      code: 'CAT-COMPUTERS',
      nameEn: 'Enterprise Laptops & Workstations',
      nameAr: 'الحواسيب المحمولة ومحطات العمل',
      nameKu: 'لاپتۆپ و کۆمپیوتەری کارگێڕی',
      description: 'High-performance business laptops and desktop workstations',
    },
  });

  const catNetworking = await prisma.category.create({
    data: {
      code: 'CAT-NETWORK',
      nameEn: 'Servers & Networking Equipment',
      nameAr: 'الخوادم ومعدات الشبكات',
      nameKu: 'سێرڤەر و ئامێرەکانی تۆڕ',
      description: 'Enterprise switches, routers, firewalls, and rack servers',
    },
  });

  const catPos = await prisma.category.create({
    data: {
      code: 'CAT-POS',
      nameEn: 'POS Terminals & Barcode Systems',
      nameAr: 'أنظمة نقاط البيع وقارئات الباركود',
      nameKu: 'سیستەمی کاشێر و بارکۆد و پرینتەر',
      description: 'Touch POS systems, thermal printers, and laser scanners',
    },
  });

  const catMonitors = await prisma.category.create({
    data: {
      code: 'CAT-DISPLAYS',
      nameEn: 'Professional Displays & Monitors',
      nameAr: 'الشاشات الاحترافية وشاشات العرض',
      nameKu: 'شاشەی پڕۆفیشناڵ و مۆنیتەر',
      description: '4K monitors and commercial displays',
    },
  });

  // 8. Products
  const prodMacbook = await prisma.product.create({
    data: {
      sku: 'LAP-MBP-16M3',
      barcode: '8901002003011',
      nameEn: 'MacBook Pro 16" M3 Max (36GB / 1TB)',
      nameAr: 'ماك بوك برو 16 بوصة M3 Max (36GB / 1TB)',
      nameKu: 'ماک بووک پڕۆ ١٦ ئینج M3 Max (36GB / 1TB)',
      categoryId: catLaptops.id,
      unit: 'PCS',
      purchaseCostUsd: 2200.0,
      sellingPriceUsd: 2650.0,
      minStockLevel: 5,
      isDemo: true,
    },
  });

  const prodThinkpad = await prisma.product.create({
    data: {
      sku: 'LAP-LEN-X1C',
      barcode: '8901002003028',
      nameEn: 'Lenovo ThinkPad X1 Carbon Gen 12 (Core Ultra 7)',
      nameAr: 'لينوفو ثينك باد X1 كاربون الجيل 12',
      nameKu: 'لینۆڤۆ سینکپاد X1 کاربۆن نەوەی ١٢',
      categoryId: catLaptops.id,
      unit: 'PCS',
      purchaseCostUsd: 1350.0,
      sellingPriceUsd: 1690.0,
      minStockLevel: 8,
      isDemo: true,
    },
  });

  const prodCiscoSwitch = await prisma.product.create({
    data: {
      sku: 'NET-CIS-9200',
      barcode: '8901002003035',
      nameEn: 'Cisco Catalyst 9200L 48-Port PoE+ Switch',
      nameAr: 'سويتش سيسكو كاتاليست 48 منفذ PoE+',
      nameKu: 'سویچی سیسکۆ کاتالیست ٤٨ دەرچە PoE+',
      categoryId: catNetworking.id,
      unit: 'PCS',
      purchaseCostUsd: 1800.0,
      sellingPriceUsd: 2350.0,
      minStockLevel: 4,
      isDemo: true,
    },
  });

  const prodPosTerminal = await prisma.product.create({
    data: {
      sku: 'POS-SUN-T2S',
      barcode: '8901002003042',
      nameEn: 'Sunmi T2s Dual-Screen Touch POS Terminal',
      nameAr: 'جهاز كاشير لمس بشاشتين Sunmi T2s',
      nameKu: 'ئامێری کاشێری دەبڵ شاشە Sunmi T2s',
      categoryId: catPos.id,
      unit: 'SET',
      purchaseCostUsd: 480.0,
      sellingPriceUsd: 680.0,
      minStockLevel: 6,
      isDemo: true,
    },
  });

  const prodThermalPrinter = await prisma.product.create({
    data: {
      sku: 'POS-EPS-TM88',
      barcode: '8901002003059',
      nameEn: 'Epson TM-T88VII High-Speed Thermal Receipt Printer',
      nameAr: 'طابعة فواتير حرارية إبسون TM-T88VII',
      nameKu: 'پرینتەری پسوولەی گەرمی ئێپسۆن TM-T88VII',
      categoryId: catPos.id,
      unit: 'PCS',
      purchaseCostUsd: 190.0,
      sellingPriceUsd: 275.0,
      minStockLevel: 10,
      isDemo: true,
    },
  });

  const prodDellMonitor = await prisma.product.create({
    data: {
      sku: 'MON-DEL-U2723',
      barcode: '8901002003066',
      nameEn: 'Dell UltraSharp 27" 4K USB-C Hub Monitor',
      nameAr: 'شاشة ديل ألترا شارب 27 بوصة 4K USB-C',
      nameKu: 'شاشەی دێڵ ئەڵترا شارپ ٢٧ ئینج 4K',
      categoryId: catMonitors.id,
      unit: 'PCS',
      purchaseCostUsd: 410.0,
      sellingPriceUsd: 560.0,
      minStockLevel: 8,
      isDemo: true,
    },
  });

  // 9. Customers
  const custEmpire = await prisma.customer.create({
    data: {
      code: 'CUST-001',
      name: 'Empire World Commercial Towers',
      companyName: 'Empire World Erbil LLC',
      phone: '+964 750 400 1000',
      email: 'procurement@empireworld.iq',
      address: 'Empire World Business District, Tower T3',
      city: 'Erbil',
      creditLimitUsd: 50000.0,
      paymentTermDays: 30,
      isDemo: true,
    },
  });

  const custKorek = await prisma.customer.create({
    data: {
      code: 'CUST-002',
      name: 'Kurdistan Digital Retail Group',
      companyName: 'KDR Supermarkets & Hypermarkets',
      phone: '+964 750 400 2200',
      email: 'it-supply@kdr-group.iq',
      address: '100 Meter Street, Gulan Intersection',
      city: 'Erbil',
      creditLimitUsd: 35000.0,
      paymentTermDays: 30,
      isDemo: true,
    },
  });

  const custSuliHospital = await prisma.customer.create({
    data: {
      code: 'CUST-003',
      name: 'Faruk Medical City IT Department',
      companyName: 'Faruk Holding Healthcare',
      phone: '+964 770 500 3300',
      email: 'purchasing@fmc.iq',
      address: 'Malik Mahmud Ring Road',
      city: 'Sulaymaniyah',
      creditLimitUsd: 40000.0,
      paymentTermDays: 45,
      isDemo: true,
    },
  });

  const custWalkIn = await prisma.customer.create({
    data: {
      code: 'CUST-004',
      name: 'Walk-in Cash Customer (Direct POS)',
      companyName: 'Direct Showroom Retail',
      phone: '+964 750 000 0000',
      address: 'Erbil Showroom Counter',
      city: 'Erbil',
      creditLimitUsd: 5000.0,
      paymentTermDays: 0,
      isDemo: true,
    },
  });

  // 10. Suppliers
  const suppDubaiTech = await prisma.supplier.create({
    data: {
      code: 'SUPP-001',
      name: 'Gulf Enterprise Distribution FZE',
      companyName: 'Gulf Enterprise Tech Dubai',
      contactPerson: 'Tariq Al-Mansoor',
      phone: '+971 4 881 9900',
      email: 'export@gulfenterprise.ae',
      address: 'Jebel Ali Free Zone (JAFZA), South Zone 2',
      city: 'Dubai, UAE',
      taxNumber: 'UAE-TRN-1004928172',
      paymentTermDays: 45,
      isDemo: true,
    },
  });

  const suppBaghdadImport = await prisma.supplier.create({
    data: {
      code: 'SUPP-002',
      name: 'Tigris Hardware & Networking Co.',
      companyName: 'Tigris Information Systems Ltd.',
      contactPerson: 'Mustafa Al-Kadhimi',
      phone: '+964 780 911 4400',
      email: 'sales@tigris-systems.iq',
      address: 'Al-Arasat Commercial Street, Karrada',
      city: 'Baghdad',
      taxNumber: 'IQ-BGD-7710293',
      paymentTermDays: 30,
      isDemo: true,
    },
  });

  const suppAnatolia = await prisma.supplier.create({
    data: {
      code: 'SUPP-003',
      name: 'Anatolia POS & Industrial Hardware',
      companyName: 'Anatolia Elektronik A.S.',
      contactPerson: 'Mehmet Yilmaz',
      phone: '+90 212 444 8811',
      email: 'b2b@anatoliapos.com.tr',
      address: 'Maslak Mah. Buyukdere Cad.',
      city: 'Istanbul, Turkey',
      taxNumber: 'TR-998120341',
      paymentTermDays: 30,
      isDemo: true,
    },
  });

  // 11. Accounting Period for Current Month (Open)
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  await prisma.accountingPeriod.create({
    data: {
      name: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      startDate: startOfMonth,
      endDate: endOfMonth,
      isClosed: false,
      isLocked: false,
    },
  });

  // 12. Execute Real Demo Financial Transactions through Services (Ensuring 100% Double-Entry Integrity!)
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  // A. Owner Capital Contributions into Cash & Bank Accounts
  await recordCashDepositOrWithdrawal({
    financialAccountId: usdBankAccount.id,
    type: 'DEPOSIT',
    amountOriginal: 120000.0,
    currency: 'USD',
    counterpartyAccountCode: '3000',
    category: 'OWNER_CAPITAL',
    description: 'Initial Owner Capital Deposit into TBI Corporate USD Account',
    date: daysAgo(12),
    isDemo: true,
    createdById: adminUser.id,
  });

  await recordCashDepositOrWithdrawal({
    financialAccountId: usdCashRegister.id,
    type: 'DEPOSIT',
    amountOriginal: 45000.0,
    currency: 'USD',
    counterpartyAccountCode: '3000',
    category: 'OWNER_CAPITAL',
    description: 'Initial Owner Capital Deposit into Erbil HQ USD Cash Vault',
    date: daysAgo(12),
    isDemo: true,
    createdById: adminUser.id,
  });

  await recordCashDepositOrWithdrawal({
    financialAccountId: iqdCashRegister.id,
    type: 'DEPOSIT',
    amountOriginal: 30000000, // 30,000,000 IQD = $20,000 USD at 1500
    currency: 'IQD',
    exchangeRate: 1500,
    counterpartyAccountCode: '3000',
    category: 'OWNER_CAPITAL',
    description: 'Initial Capital Deposit into Erbil HQ IQD Cash Safe (30M IQD)',
    date: daysAgo(12),
    isDemo: true,
    createdById: adminUser.id,
  });

  // B. Purchase Invoices (Receiving stock into Warehouse & creating Supplier Creditors)
  // Purchase 1: Cash + Credit partial payment to Gulf Enterprise Tech Dubai
  await createPurchaseInvoice({
    supplierId: suppDubaiTech.id,
    supplierInvoiceRef: 'JAFZA-2026-8812',
    warehouseId: mainWarehouse.id,
    date: daysAgo(10),
    dueDate: daysAgo(-20),
    status: 'POSTED',
    paymentType: 'PARTIAL',
    currency: 'USD',
    exchangeRate: 1500,
    paidOriginal: 25000.0,
    financialAccountId: usdBankAccount.id,
    paymentMethod: 'BANK_TRANSFER',
    notes: 'Q4 Shipment of MacBook Pro M3 Max & ThinkPad X1 Carbon units',
    isDemo: true,
    createdById: adminUser.id,
    items: [
      { productId: prodMacbook.id, quantity: 12, unitCostOriginal: 2200.0 }, // $26,400
      { productId: prodThinkpad.id, quantity: 15, unitCostOriginal: 1350.0 }, // $20,250 -> Total $46,650 (Paid $25,000, Due $21,650)
    ],
  });

  // Purchase 2: Credit purchase from Tigris Hardware (Networking & Monitors)
  const pur2 = await createPurchaseInvoice({
    supplierId: suppBaghdadImport.id,
    supplierInvoiceRef: 'TIG-9910',
    warehouseId: mainWarehouse.id,
    date: daysAgo(8),
    dueDate: daysAgo(-15),
    status: 'POSTED',
    paymentType: 'CREDIT',
    currency: 'USD',
    exchangeRate: 1500,
    paidOriginal: 0,
    paymentMethod: 'CREDIT',
    notes: 'Cisco Catalyst switches and Dell UltraSharp 4K displays',
    isDemo: true,
    createdById: adminUser.id,
    items: [
      { productId: prodCiscoSwitch.id, quantity: 8, unitCostOriginal: 1800.0 }, // $14,400
      { productId: prodDellMonitor.id, quantity: 20, unitCostOriginal: 410.0 }, // $8,200 -> Total $22,600
    ],
  });

  // Purchase 3: Cash purchase from Anatolia POS Hardware
  await createPurchaseInvoice({
    supplierId: suppAnatolia.id,
    supplierInvoiceRef: 'IST-POS-442',
    warehouseId: mainWarehouse.id,
    date: daysAgo(7),
    status: 'POSTED',
    paymentType: 'CASH',
    currency: 'USD',
    exchangeRate: 1500,
    financialAccountId: usdCashRegister.id,
    paymentMethod: 'CASH',
    notes: 'Sunmi POS terminals and Epson thermal printers',
    isDemo: true,
    createdById: adminUser.id,
    items: [
      { productId: prodPosTerminal.id, quantity: 14, unitCostOriginal: 480.0 }, // $6,720
      { productId: prodThermalPrinter.id, quantity: 4, unitCostOriginal: 190.0 }, // $760 -> Total $7,480
    ],
  });

  // Stock Transfer from Erbil Warehouse to Sulaymaniyah Warehouse
  await transferWarehouseStock({
    productId: prodThinkpad.id,
    fromWarehouseId: mainWarehouse.id,
    toWarehouseId: suliWarehouse.id,
    quantity: 4,
    notes: 'Branch replenishment transfer to Sulaymaniyah showroom',
    userId: adminUser.id,
  });

  // C. Sales Invoices (Generating Revenue, COGS, Profit, Cash receipts, and Customer Debtors)
  // Sale 1: Partial payment sale to Empire World Commercial Towers
  const sale1 = await createSalesInvoice({
    customerId: custEmpire.id,
    warehouseId: mainWarehouse.id,
    date: daysAgo(6),
    dueDate: daysAgo(-14),
    status: 'POSTED',
    paymentType: 'PARTIAL',
    currency: 'USD',
    exchangeRate: 1500,
    paidOriginal: 10000.0,
    financialAccountId: usdBankAccount.id,
    paymentMethod: 'BANK_TRANSFER',
    notes: 'Executive IT workstation deployment for Empire World Tower T3',
    isDemo: true,
    createdById: adminUser.id,
    items: [
      { productId: prodMacbook.id, quantity: 4, unitPriceOriginal: 2650.0 }, // $10,600
      { productId: prodDellMonitor.id, quantity: 6, unitPriceOriginal: 560.0 }, // $3,360
      { productId: prodCiscoSwitch.id, quantity: 2, unitPriceOriginal: 2350.0 }, // $4,700 -> Total $18,660 (Paid $10,000, Due $8,660)
    ],
  });

  // Sale 2: Credit sale to Kurdistan Digital Retail Group
  await createSalesInvoice({
    customerId: custKorek.id,
    warehouseId: mainWarehouse.id,
    date: daysAgo(4),
    dueDate: daysAgo(-20),
    status: 'POSTED',
    paymentType: 'CREDIT',
    currency: 'USD',
    exchangeRate: 1500,
    paymentMethod: 'CREDIT',
    notes: 'Supermarket checkout POS terminals and receipt printers rollout',
    isDemo: true,
    createdById: adminUser.id,
    items: [
      { productId: prodPosTerminal.id, quantity: 6, unitPriceOriginal: 680.0 }, // $4,080
      { productId: prodThermalPrinter.id, quantity: 2, unitPriceOriginal: 275.0 }, // $550 -> Total $4,630
    ],
  });

  // Sale 3: Cash sale to Faruk Medical City
  await createSalesInvoice({
    customerId: custSuliHospital.id,
    warehouseId: mainWarehouse.id,
    date: daysAgo(2),
    status: 'POSTED',
    paymentType: 'CASH',
    currency: 'USD',
    exchangeRate: 1500,
    financialAccountId: usdCashRegister.id,
    paymentMethod: 'CASH',
    notes: 'ThinkPad X1 Carbon laptops and Cisco networking switch',
    isDemo: true,
    createdById: adminUser.id,
    items: [
      { productId: prodThinkpad.id, quantity: 5, unitPriceOriginal: 1690.0 }, // $8,450
      { productId: prodCiscoSwitch.id, quantity: 1, unitPriceOriginal: 2350.0 }, // $2,350 -> Total $10,800
    ],
  });

  // Sale 4: IQD Cash Sale at Showroom POS
  await createSalesInvoice({
    customerId: custWalkIn.id,
    warehouseId: mainWarehouse.id,
    date: daysAgo(1),
    status: 'POSTED',
    paymentType: 'CASH',
    currency: 'IQD',
    exchangeRate: 1500,
    financialAccountId: iqdCashRegister.id,
    paymentMethod: 'CASH',
    notes: 'Showroom POS sale in Iraqi Dinars',
    isDemo: true,
    createdById: adminUser.id,
    items: [
      { productId: prodDellMonitor.id, quantity: 2, unitPriceOriginal: 840000 }, // 1,680,000 IQD ($1,120 USD)
    ],
  });

  // D. Debtor Collection (Empire World pays $3,660 towards their $8,660 balance)
  await recordDebtorCollection({
    customerId: custEmpire.id,
    salesInvoiceId: sale1.id,
    financialAccountId: usdBankAccount.id,
    paymentMethod: 'BANK_TRANSFER',
    currency: 'USD',
    exchangeRate: 1500,
    amountOriginal: 3660.0,
    date: daysAgo(3),
    referenceNumber: 'TBI-WIRE-7721',
    notes: 'Second installment received from Empire World',
    isDemo: true,
    createdById: adminUser.id,
  });

  // E. Creditor Payment (Pay $7,600 to Tigris Hardware towards their $22,600 purchase invoice)
  await recordCreditorPayment({
    supplierId: suppBaghdadImport.id,
    purchaseInvoiceId: pur2.id,
    financialAccountId: usdBankAccount.id,
    paymentMethod: 'BANK_TRANSFER',
    currency: 'USD',
    exchangeRate: 1500,
    amountOriginal: 7600.0,
    date: daysAgo(2),
    referenceNumber: 'TBI-OUT-9902',
    notes: 'Partial settlement for Cisco & Dell shipment TIG-9910',
    isDemo: true,
    createdById: adminUser.id,
  });

  // F. Operating Expenses (Salaries, Rent, Electricity, Pending large Marketing expense)
  await createExpense({
    date: daysAgo(5),
    category: 'SALARIES',
    title: 'Monthly Staff Payroll — Erbil Showroom & Warehouse',
    description: 'Base salaries for sales and warehouse personnel',
    vendorName: 'Internal Payroll',
    financialAccountId: usdBankAccount.id,
    paymentMethod: 'BANK_TRANSFER',
    currency: 'USD',
    exchangeRate: 1500,
    amountOriginal: 2400.0,
    isRecurring: true,
    recurringInterval: 'MONTHLY',
    bypassApprovalThreshold: true,
    isDemo: true,
    createdById: adminUser.id,
  });

  await createExpense({
    date: daysAgo(4),
    category: 'RENT',
    title: 'Erbil 60M Showroom Monthly Lease',
    description: 'Commercial showroom & office rent',
    vendorName: 'Erbil Commercial Real Estate Co.',
    financialAccountId: usdCashRegister.id,
    paymentMethod: 'CASH',
    currency: 'USD',
    exchangeRate: 1500,
    amountOriginal: 1200.0,
    isRecurring: true,
    recurringInterval: 'MONTHLY',
    bypassApprovalThreshold: true,
    isDemo: true,
    createdById: adminUser.id,
  });

  await createExpense({
    date: daysAgo(2),
    category: 'ELECTRICITY',
    title: 'National Grid & Private Generator Power Bill',
    description: 'Monthly electricity and 60A commercial generator subscription',
    vendorName: 'Gulan Power Grid',
    financialAccountId: iqdCashRegister.id,
    paymentMethod: 'CASH',
    currency: 'IQD',
    exchangeRate: 1500,
    amountOriginal: 675000, // 675,000 IQD = $450 USD
    isRecurring: true,
    recurringInterval: 'MONTHLY',
    bypassApprovalThreshold: true,
    isDemo: true,
    createdById: adminUser.id,
  });

  // Large Expense awaiting Owner Approval (demonstrates Approval Workflow!)
  await createExpense({
    date: daysAgo(1),
    category: 'MARKETING',
    title: 'Erbil International Tech Expo Sponsorship & Booth',
    description: 'Annual enterprise technology exhibition booth and billboard campaign',
    vendorName: 'Kurdistan Events & Media Agency',
    financialAccountId: usdBankAccount.id,
    paymentMethod: 'BANK_TRANSFER',
    currency: 'USD',
    exchangeRate: 1500,
    amountOriginal: 1850.0,
    isRecurring: false,
    bypassApprovalThreshold: false, // Will be created as PENDING_APPROVAL!
    isDemo: true,
    createdById: adminUser.id,
  });

  return { alreadySeeded: false };
}
