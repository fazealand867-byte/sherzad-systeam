<?php
/**
 * SHERZAD FOOD FACTORY & BUSINESS MANAGEMENT SYSTEM
 * Unified PHP 8 REST API Controller (IQD-Only | Units | Payroll | Production | Accounting)
 */

if (!headers_sent() && extension_loaded('zlib') && !ini_get('zlib.output_compression') && isset($_SERVER['HTTP_ACCEPT_ENCODING']) && stripos($_SERVER['HTTP_ACCEPT_ENCODING'], 'gzip') !== false) {
    ob_start('ob_gzhandler');
}

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Cache-Control: no-store, no-cache, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/Engine.php';

try {
    $engine = new ErpEngine();
    $method = $_SERVER['REQUEST_METHOD'];
    if ($method === 'GET') {
        $engine->enableReadCache();
    }

    $route = $_GET['route'] ?? '';
    if (!$route) {
        $uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '';
        if (preg_match('#/api/([a-zA-Z0-9_-]+)#', $uri, $m)) {
            $route = $m[1];
        }
    }
    $route = strtolower(trim($route, '/'));

    $rawBody = file_get_contents('php://input');
    $body = $rawBody ? (json_decode($rawBody, true) ?: []) : [];
    $rate = (float)($engine->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;

    // =========================================================================
    // 0. ULTRA-FAST UNIFIED SNAPSHOT ENDPOINT (1 REQUEST INSTEAD OF 12!)
    // =========================================================================
    if ($route === 'snapshot' && $method === 'GET') {
        $user = $engine->getCurrentUser();
        $curMonth = ErpEngine::currentMonthStr();
        $products = array_values(array_map(
            [$engine, 'hydrateProduct'],
            array_filter($engine->db['products'], fn($p) => !isset($p['isActive']) || $p['isActive'])
        ));
        $employees = array_map(fn($e) => $engine->hydrateEmployee($e, $curMonth), $engine->db['employees']);
        $recipes = array_map([$engine, 'hydrateRecipe'], $engine->db['recipes']);

        // Compute P&L and Inventory Valuation ONCE and reuse across Dashboard, Inventory & Accounting!
        $pnl = $engine->getProfitAndLoss();
        $invVal = $engine->getInventoryValuation();
        $trialBalance = $engine->getTrialBalance();
        $balanceSheet = $engine->getBalanceSheet($pnl);
        $generalLedger = $engine->getGeneralLedger();

        // Notifications (Low stock + pending approvals)
        $notifications = [];
        foreach ($products as $p) {
            $qty = (float)$p['totalStock'];
            $min = (float)$p['minStockLevel'];
            if ($qty <= $min) {
                $uLabelKu = $p['unitObj']['nameKu'] ?? $p['unit'];
                $uLabelAr = $p['unitObj']['nameAr'] ?? $p['unit'];
                $uLabelEn = $p['unitObj']['nameEn'] ?? $p['unit'];
                $notifications[] = [
                    'id' => 'low-stock-' . $p['id'],
                    'type' => 'LOW_STOCK',
                    'severity' => $qty <= 0 ? 'danger' : 'warning',
                    'titleEn' => $qty <= 0 ? "Out of stock: {$p['nameEn']}" : "Low stock: {$p['nameEn']}",
                    'titleAr' => $qty <= 0 ? "نفد المخزون: {$p['nameAr']}" : "مخزون منخفض: {$p['nameAr']}",
                    'titleKu' => $qty <= 0 ? "نەماوە لە کۆگا: {$p['nameKu']}" : "کەمبوونەوە لە کۆگا: {$p['nameKu']}",
                    'descEn' => "Remaining: {$qty} {$uLabelEn}",
                    'descAr' => "المتبقي: {$qty} {$uLabelAr}",
                    'descKu' => "ماوە: {$qty} {$uLabelKu}",
                    'module' => 'inventory',
                ];
            }
        }
        $pendingExp = [];
        foreach ($engine->db['expenses'] as $e) {
            if (($e['status'] ?? '') === 'PENDING_APPROVAL') {
                $pendingExp[] = $e;
                $notifications[] = [
                    'id' => 'exp-' . $e['id'],
                    'type' => 'EXPENSE_APPROVAL',
                    'severity' => 'info',
                    'titleEn' => "Pending approval: {$e['title']}",
                    'titleAr' => "بانتظار الموافقة: {$e['title']}",
                    'titleKu' => "چاوەڕوانی پەسەندکردن: {$e['title']}",
                    'descEn' => number_format($e['amountIqd'] ?? 0) . " IQD",
                    'descAr' => number_format($e['amountIqd'] ?? 0) . " د.ع",
                    'descKu' => number_format($e['amountIqd'] ?? 0) . " د.ع",
                    'module' => 'expenses',
                ];
            }
        }

        // Dashboard KPIs & Charts in single pass
        $totalPurchasesIqd = 0.0;
        $unpaidPurchasesDash = [];
        $unpaidPurchasesList = [];
        foreach ($engine->db['purchaseInvoices'] as $p) {
            if (in_array($p['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) {
                $totalPurchasesIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalPurchasesIqd, $p['totalIqd'] ?? 0));
                if (in_array($p['status'], ['POSTED', 'PARTIALLY_PAID']) && (float)($p['dueIqd'] ?? 0) > 0) {
                    $supp = $engine->findById('suppliers', $p['supplierId']);
                    $unpaidPurchasesDash[] = [
                        'id' => $p['id'], 'invoiceNumber' => $p['invoiceNumber'], 'partyName' => $supp['name'] ?? '',
                        'date' => $p['date'], 'dueDate' => $p['dueDate'] ?? null,
                        'totalIqd' => (float)($p['totalIqd'] ?? 0), 'paidIqd' => (float)($p['paidIqd'] ?? 0),
                        'dueIqd' => (float)($p['dueIqd'] ?? 0), 'type' => 'PURCHASE',
                    ];
                    $pWithSupp = $p;
                    $pWithSupp['supplier'] = $supp;
                    $unpaidPurchasesList[] = $pWithSupp;
                }
            }
        }

        $totalSalesInvoicedIqd = 0.0;
        $unpaidSalesDash = [];
        $unpaidSalesList = [];
        foreach ($engine->db['salesInvoices'] as $s) {
            if (in_array($s['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) {
                $totalSalesInvoicedIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalSalesInvoicedIqd, $s['totalIqd'] ?? 0));
                if (in_array($s['status'], ['POSTED', 'PARTIALLY_PAID']) && (float)($s['dueIqd'] ?? 0) > 0) {
                    $cust = $engine->findById('customers', $s['customerId']);
                    $unpaidSalesDash[] = [
                        'id' => $s['id'], 'invoiceNumber' => $s['invoiceNumber'], 'partyName' => $cust['name'] ?? '',
                        'date' => $s['date'], 'dueDate' => $s['dueDate'] ?? null,
                        'totalIqd' => (float)($s['totalIqd'] ?? 0), 'paidIqd' => (float)($s['paidIqd'] ?? 0),
                        'dueIqd' => (float)($s['dueIqd'] ?? 0), 'type' => 'SALE',
                    ];
                    $sWithCust = $s;
                    $sWithCust['customer'] = $cust;
                    $unpaidSalesList[] = $sWithCust;
                }
            }
        }

        $totalCustomerDebtsIqd = 0.0;
        foreach ($engine->db['customers'] as $c) {
            $b = (float)($c['balanceIqd'] ?? 0);
            if ($b > 0) $totalCustomerDebtsIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalCustomerDebtsIqd, $b));
        }
        $totalSupplierLiabilitiesIqd = 0.0;
        foreach ($engine->db['suppliers'] as $s) {
            $b = (float)($s['balanceIqd'] ?? 0);
            if ($b > 0) $totalSupplierLiabilitiesIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalSupplierLiabilitiesIqd, $b));
        }
        $cashBalanceIqd = 0.0;
        $cashRegIqd = 0.0;
        $bankAccIqd = 0.0;
        $hydratedFinAccs = [];
        foreach ($engine->db['financialAccounts'] as $fa) {
            $b = (float)($fa['balanceIqd'] ?? 0);
            $cashBalanceIqd = ErpEngine::roundIqd(ErpEngine::decAdd($cashBalanceIqd, $b));
            if ($fa['type'] === 'CASH_REGISTER') $cashRegIqd = ErpEngine::roundIqd(ErpEngine::decAdd($cashRegIqd, $b));
            else $bankAccIqd = ErpEngine::roundIqd(ErpEngine::decAdd($bankAccIqd, $b));
            $faCopy = $fa;
            $faCopy['ledgerAccount'] = $engine->findById('accounts', $fa['ledgerAccountId']);
            $hydratedFinAccs[] = $faCopy;
        }

        $lowStock = array_values(array_filter($invVal['items'], fn($i) => $i['isLowStock'] || $i['isOutOfStock']));
        $todayPrefix = date('Y-m-d');
        $todayProductionCount = 0;
        foreach ($engine->db['productionBatches'] as $b) {
            if (($b['status'] ?? 'COMPLETED') === 'COMPLETED' && substr($b['date'] ?? '', 0, 10) === $todayPrefix) {
                $todayProductionCount++;
            }
        }
        $salariesPaidThisMonthIqd = 0.0;
        foreach ($engine->db['salaryPayments'] as $sp) {
            if (($sp['salaryMonth'] ?? '') === $curMonth && ($sp['status'] ?? 'POSTED') !== 'REVERSED') {
                $salariesPaidThisMonthIqd = ErpEngine::roundIqd(ErpEngine::decAdd($salariesPaidThisMonthIqd, $sp['amountIqd'] ?? 0));
            }
        }
        $totalPayrollIqd = 0.0;
        $totalPaidEmpIqd = 0.0;
        $totalRemEmpIqd = 0.0;
        $activeEmployeesCount = 0;
        foreach ($employees as $e) {
            if (($e['status'] ?? 'ACTIVE') === 'ACTIVE') {
                $activeEmployeesCount++;
                $totalPayrollIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalPayrollIqd, $e['monthlySalaryIqd'] ?? 0));
                $totalPaidEmpIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalPaidEmpIqd, $e['paidThisMonthIqd'] ?? 0));
                $totalRemEmpIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalRemEmpIqd, $e['remainingSalaryIqd'] ?? 0));
            }
        }

        // Daily (14d) & Monthly (6m) Charts
        $daily = [];
        for ($i = 13; $i >= 0; $i--) {
            $dayKey = gmdate('Y-m-d', time() - $i * 86400);
            $daily[$dayKey] = ['label' => substr($dayKey, 5), 'salesIqd' => 0.0, 'purchasesIqd' => 0.0, 'expensesIqd' => 0.0, 'profitIqd' => 0.0];
        }
        $monthly = [];
        for ($i = 5; $i >= 0; $i--) {
            $mk = date('Y-m', strtotime("-{$i} months"));
            $monthly[$mk] = ['label' => $mk, 'salesIqd' => 0.0, 'purchasesIqd' => 0.0, 'expensesIqd' => 0.0, 'profitIqd' => 0.0];
        }
        foreach ($engine->db['salesInvoices'] as $s) {
            if (!in_array($s['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) continue;
            $dk = substr($s['date'], 0, 10);
            $mk = substr($s['date'], 0, 7);
            if (isset($daily[$dk])) {
                $daily[$dk]['salesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($daily[$dk]['salesIqd'], $s['totalIqd'] ?? 0));
                $daily[$dk]['profitIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($daily[$dk]['profitIqd'], $s['grossProfitIqd'] ?? 0));
            }
            if (isset($monthly[$mk])) {
                $monthly[$mk]['salesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($monthly[$mk]['salesIqd'], $s['totalIqd'] ?? 0));
                $monthly[$mk]['profitIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($monthly[$mk]['profitIqd'], $s['grossProfitIqd'] ?? 0));
            }
        }
        foreach ($engine->db['purchaseInvoices'] as $p) {
            if (!in_array($p['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) continue;
            $dk = substr($p['date'], 0, 10);
            $mk = substr($p['date'], 0, 7);
            if (isset($daily[$dk])) $daily[$dk]['purchasesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($daily[$dk]['purchasesIqd'], $p['totalIqd'] ?? 0));
            if (isset($monthly[$mk])) $monthly[$mk]['purchasesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($monthly[$mk]['purchasesIqd'], $p['totalIqd'] ?? 0));
        }
        foreach ($engine->db['expenses'] as $e) {
            if (($e['status'] ?? '') !== 'POSTED') continue;
            $dk = substr($e['date'], 0, 10);
            $mk = substr($e['date'], 0, 7);
            if (isset($daily[$dk])) $daily[$dk]['expensesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($daily[$dk]['expensesIqd'], $e['amountIqd'] ?? 0));
            if (isset($monthly[$mk])) $monthly[$mk]['expensesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($monthly[$mk]['expensesIqd'], $e['amountIqd'] ?? 0));
        }

        $hydratedSales = array_map([$engine, 'hydrateSalesInvoice'], $engine->db['salesInvoices']);
        $hydratedPurchases = array_map([$engine, 'hydratePurchaseInvoice'], $engine->db['purchaseInvoices']);
        $hydratedExpenses = array_map([$engine, 'hydrateExpense'], $engine->db['expenses']);
        $hydratedSpoilage = array_map([$engine, 'hydrateSpoilage'], array_slice($engine->db['spoilageRecords'], 0, 60));
        $hydratedBatches = array_map([$engine, 'hydrateProductionBatch'], array_slice($engine->db['productionBatches'], 0, 80));
        $debtPayments = [];
        foreach ($engine->db['debtPayments'] as $dp) {
            $dp['customer'] = $engine->findById('customers', $dp['customerId'] ?? null);
            $dp['supplier'] = $engine->findById('suppliers', $dp['supplierId'] ?? null);
            $debtPayments[] = $dp;
        }
        $cashTxs = [];
        foreach (array_slice($engine->db['cashTransactions'], 0, 100) as $ct) {
            $ct['financialAccount'] = $engine->findById('financialAccounts', $ct['financialAccountId']);
            $cashTxs[] = $ct;
        }
        $rpList = [];
        foreach ($engine->db['rolePermissions'] as $rp) {
            $rp['permissions'] = json_decode($rp['permissionsJson'] ?? '[]', true) ?: [];
            $rpList[] = $rp;
        }

        echo json_encode([
            'bootstrap' => [
                'user' => $user,
                'permissions' => [],
                'settings' => $engine->db['settings'],
                'warehouses' => $engine->db['warehouses'],
                'categories' => $engine->db['categories'],
                'units' => $engine->db['units'],
                'expenseCategories' => $engine->db['expenseCategories'],
                'financialAccounts' => $engine->db['financialAccounts'],
                'products' => $products,
                'customers' => $engine->db['customers'],
                'suppliers' => $engine->db['suppliers'],
                'employees' => $employees,
                'recipes' => $recipes,
                'notifications' => $notifications,
            ],
            'dashboard' => [
                'kpis' => [
                    'totalSalesIqd' => $pnl['netSalesRevenueIqd'],
                    'totalSalesInvoicedIqd' => $totalSalesInvoicedIqd,
                    'totalPurchasesIqd' => $totalPurchasesIqd,
                    'totalExpensesIqd' => $pnl['operatingExpensesIqd'],
                    'grossProfitIqd' => $pnl['grossProfitIqd'],
                    'netProfitIqd' => $pnl['netProfitIqd'],
                    'grossMarginPercent' => $pnl['grossMarginPercent'],
                    'netMarginPercent' => $pnl['netMarginPercent'],
                    'totalCustomerDebtsIqd' => $totalCustomerDebtsIqd,
                    'totalSupplierLiabilitiesIqd' => $totalSupplierLiabilitiesIqd,
                    'cashBalanceIqd' => $cashBalanceIqd,
                    'cashRegistersIqd' => $cashRegIqd,
                    'bankAccountsIqd' => $bankAccIqd,
                    'inventoryCostValueIqd' => $invVal['totalCostValueIqd'],
                    'inventoryRetailValueIqd' => $invVal['totalRetailValueIqd'],
                    'rawMaterialValueIqd' => $invVal['rawMaterialValueIqd'],
                    'finishedProductValueIqd' => $invVal['finishedProductValueIqd'],
                    'totalCustomers' => count($engine->db['customers']),
                    'totalSuppliers' => count($engine->db['suppliers']),
                    'totalProducts' => $invVal['totalProducts'],
                    'lowStockCount' => count($lowStock),
                    'unpaidSalesCount' => count($unpaidSalesDash),
                    'unpaidPurchasesCount' => count($unpaidPurchasesDash),
                    'pendingExpensesCount' => count($pendingExp),
                    'activeEmployeesCount' => $activeEmployeesCount,
                    'salariesPaidThisMonthIqd' => $salariesPaidThisMonthIqd,
                    'todayProductionCount' => $todayProductionCount,
                    'totalProductionBatches' => count($engine->db['productionBatches']),
                ],
                'financialAccounts' => $engine->db['financialAccounts'],
                'lowStockProducts' => $lowStock,
                'unpaidInvoices' => array_merge($unpaidSalesDash, $unpaidPurchasesDash),
                'pendingExpenses' => $pendingExp,
                'recentTransactions' => array_slice($engine->db['journals'], 0, 10),
                'charts' => [
                    'daily' => array_values($daily),
                    'monthly' => array_values($monthly),
                    'expenseByCategory' => $pnl['operatingExpenseBreakdown'],
                    'profitByCategory' => $pnl['profitByCategory'],
                ],
            ],
            'sales' => ['invoices' => $hydratedSales],
            'purchases' => ['invoices' => $hydratedPurchases],
            'expenses' => ['expenses' => $hydratedExpenses],
            'inventory' => [
                'valuation' => $invVal,
                'movements' => array_map([$engine, 'hydrateMovement'], array_slice($engine->db['movements'], 0, 80)),
                'transfers' => array_map([$engine, 'hydrateTransfer'], array_slice($engine->db['transfers'], 0, 40)),
                'spoilageRecords' => $hydratedSpoilage,
                'categories' => $engine->db['categories'],
                'warehouses' => $engine->db['warehouses'],
                'units' => $engine->db['units'],
            ],
            'production' => [
                'recipes' => $recipes,
                'batches' => $hydratedBatches,
                'spoilageRecords' => $hydratedSpoilage,
            ],
            'employees' => [
                'month' => $curMonth,
                'employees' => $employees,
                'salaryPayments' => $engine->db['salaryPayments'],
                'employeeLeaves' => $engine->db['employeeLeaves'] ?? [],
                'summary' => [
                    'totalEmployees' => count($employees),
                    'activeEmployees' => $activeEmployeesCount,
                    'totalPayrollIqd' => $totalPayrollIqd,
                    'totalPaidIqd' => $totalPaidEmpIqd,
                    'totalRemainingIqd' => $totalRemEmpIqd,
                ],
            ],
            'parties' => [
                'customers' => $engine->db['customers'],
                'suppliers' => $engine->db['suppliers'],
                'unpaidSalesInvoices' => $unpaidSalesList,
                'unpaidPurchaseInvoices' => $unpaidPurchasesList,
                'debtPayments' => $debtPayments,
            ],
            'cashbank' => [
                'accounts' => $hydratedFinAccs,
                'transactions' => $cashTxs,
            ],
            'accounting' => [
                'accounts' => $engine->db['accounts'],
                'journals' => array_map([$engine, 'hydrateJournal'], array_slice($engine->db['journals'], 0, 100)),
                'trialBalance' => $trialBalance,
                'profitAndLoss' => $pnl,
                'balanceSheet' => $balanceSheet,
                'generalLedger' => $generalLedger,
                'periods' => $engine->db['periods'],
            ],
            'settings' => [
                'settings' => $engine->db['settings'],
                'users' => $engine->db['users'],
                'rolePermissions' => $rpList,
                'auditLogs' => array_slice($engine->db['auditLogs'], 0, 100),
            ],
        ]);
        exit;
    }

    // =========================================================================
    // 1. BOOTSTRAP ENDPOINT
    // =========================================================================
    if ($route === 'bootstrap') {
        $user = $engine->getCurrentUser();
        $products = array_values(array_map(
            [$engine, 'hydrateProduct'],
            array_filter($engine->db['products'], fn($p) => !isset($p['isActive']) || $p['isActive'])
        ));
        $curMonth = ErpEngine::currentMonthStr();
        $employees = array_map(fn($e) => $engine->hydrateEmployee($e, $curMonth), $engine->db['employees']);
        $recipes = array_map([$engine, 'hydrateRecipe'], $engine->db['recipes']);

        $notifications = [];
        foreach ($products as $p) {
            $qty = (float)$p['totalStock'];
            $min = (float)$p['minStockLevel'];
            if ($qty <= $min) {
                $uLabelKu = $p['unitObj']['nameKu'] ?? $p['unit'];
                $uLabelAr = $p['unitObj']['nameAr'] ?? $p['unit'];
                $uLabelEn = $p['unitObj']['nameEn'] ?? $p['unit'];
                $notifications[] = [
                    'id' => 'low-stock-' . $p['id'],
                    'type' => 'LOW_STOCK',
                    'severity' => $qty <= 0 ? 'danger' : 'warning',
                    'titleKu' => ($qty <= 0 ? 'نەمانی کاڵا: ' : 'ئاگاداری کەمی کاڵا: ') . $p['nameKu'],
                    'titleAr' => ($qty <= 0 ? 'نفاد المخزون: ' : 'تنبيه نقص المخزون: ') . $p['nameAr'],
                    'titleEn' => ($qty <= 0 ? 'Out of Stock: ' : 'Low Stock Alert: ') . $p['nameEn'],
                    'descKu' => "بڕی ماوە: {$qty} {$uLabelKu} (کەمترین: {$min})",
                    'descAr' => "المتبقي: {$qty} {$uLabelAr} (الحد الأدنى: {$min})",
                    'descEn' => "Remaining: {$qty} {$uLabelEn} (Min: {$min})",
                    'module' => 'inventory',
                ];
            }
        }

        foreach ($engine->db['expenses'] as $exp) {
            if (($exp['status'] ?? '') === 'PENDING_APPROVAL') {
                $amtStr = number_format((float)($exp['amountIqd'] ?? 0));
                $notifications[] = [
                    'id' => 'exp-app-' . $exp['id'],
                    'type' => 'EXPENSE_APPROVAL',
                    'severity' => 'info',
                    'titleKu' => 'پێویستی بە پەسەندکردنە: ' . $exp['title'],
                    'titleAr' => 'بانتظار الموافقة: ' . $exp['title'],
                    'titleEn' => 'Approval Required: ' . $exp['title'],
                    'descKu' => "خەرجی {$exp['expenseNumber']} ({$amtStr} د.ع)",
                    'descAr' => "المصروف {$exp['expenseNumber']} ({$amtStr} د.ع)",
                    'descEn' => "Expense {$exp['expenseNumber']} ({$amtStr} IQD)",
                    'module' => 'expenses',
                ];
            }
        }

        echo json_encode([
            'user' => $user,
            'permissions' => [],
            'settings' => $engine->db['settings'],
            'warehouses' => $engine->db['warehouses'],
            'categories' => $engine->db['categories'],
            'units' => $engine->db['units'],
            'expenseCategories' => $engine->db['expenseCategories'],
            'financialAccounts' => $engine->db['financialAccounts'],
            'products' => $products,
            'customers' => $engine->db['customers'],
            'suppliers' => $engine->db['suppliers'],
            'employees' => $employees,
            'recipes' => $recipes,
            'notifications' => $notifications,
        ]);
        exit;
    }

    // =========================================================================
    // 2. AUTHENTICATION & RBAC ENDPOINT
    // =========================================================================
    if ($route === 'auth' && $method === 'POST') {
        $action = $body['action'] ?? '';
        if ($action === 'switchRole') {
            $role = $body['role'] ?? 'SUPER_ADMIN';
            $target = null;
            foreach ($engine->db['users'] as $u) {
                if ($u['role'] === $role && !empty($u['isActive'])) {
                    $target = $u;
                    break;
                }
            }
            if (!$target) {
                throw new Exception("No active user found for role {$role}");
            }
            $engine->db['activeUserId'] = $target['id'];
            $engine->saveDatabase();
            echo json_encode(['user' => $target]);
            exit;
        }

        if ($action === 'login') {
            $id = trim($body['identifier'] ?? '');
            $target = null;
            foreach ($engine->db['users'] as $u) {
                if ((strcasecmp($u['username'], $id) === 0 || strcasecmp($u['email'], $id) === 0) && !empty($u['isActive'])) {
                    $target = $u;
                    break;
                }
            }
            if (!$target) {
                http_response_code(401);
                echo json_encode(['error' => 'Invalid username or inactive account']);
                exit;
            }
            $engine->db['activeUserId'] = $target['id'];
            $engine->logAudit('USER_LOGIN', 'AUTH', 'User', $target['id'], "{$target['name']} signed in.");
            $engine->saveDatabase();
            echo json_encode(['user' => $target]);
            exit;
        }

        echo json_encode(['success' => true]);
        exit;
    }

    // =========================================================================
    // 3. DASHBOARD ANALYTICS ENDPOINT (IQD-NATIVE)
    // =========================================================================
    if ($route === 'dashboard') {
        $pnl = $engine->getProfitAndLoss();
        $invVal = $engine->getInventoryValuation();

        $totalPurchasesIqd = 0.0;
        $unpaidPurchases = [];
        foreach ($engine->db['purchaseInvoices'] as $p) {
            if (in_array($p['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) {
                $totalPurchasesIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalPurchasesIqd, $p['totalIqd'] ?? 0));
                if ((float)($p['dueIqd'] ?? 0) > 0) {
                    $supp = $engine->findById('suppliers', $p['supplierId']);
                    $unpaidPurchases[] = [
                        'id' => $p['id'],
                        'invoiceNumber' => $p['invoiceNumber'],
                        'partyName' => $supp['name'] ?? '',
                        'date' => $p['date'],
                        'dueDate' => $p['dueDate'] ?? null,
                        'totalIqd' => (float)($p['totalIqd'] ?? 0),
                        'paidIqd' => (float)($p['paidIqd'] ?? 0),
                        'dueIqd' => (float)($p['dueIqd'] ?? 0),
                        'type' => 'PURCHASE',
                    ];
                }
            }
        }

        $totalSalesInvoicedIqd = 0.0;
        $unpaidSales = [];
        foreach ($engine->db['salesInvoices'] as $s) {
            if (in_array($s['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) {
                $totalSalesInvoicedIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalSalesInvoicedIqd, $s['totalIqd'] ?? 0));
                if ((float)($s['dueIqd'] ?? 0) > 0) {
                    $cust = $engine->findById('customers', $s['customerId']);
                    $unpaidSales[] = [
                        'id' => $s['id'],
                        'invoiceNumber' => $s['invoiceNumber'],
                        'partyName' => $cust['name'] ?? '',
                        'date' => $s['date'],
                        'dueDate' => $s['dueDate'] ?? null,
                        'totalIqd' => (float)($s['totalIqd'] ?? 0),
                        'paidIqd' => (float)($s['paidIqd'] ?? 0),
                        'dueIqd' => (float)($s['dueIqd'] ?? 0),
                        'type' => 'SALE',
                    ];
                }
            }
        }

        $totalCustomerDebtsIqd = 0.0;
        foreach ($engine->db['customers'] as $c) {
            $b = (float)($c['balanceIqd'] ?? 0);
            if ($b > 0) $totalCustomerDebtsIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalCustomerDebtsIqd, $b));
        }

        $totalSupplierLiabilitiesIqd = 0.0;
        foreach ($engine->db['suppliers'] as $s) {
            $b = (float)($s['balanceIqd'] ?? 0);
            if ($b > 0) $totalSupplierLiabilitiesIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalSupplierLiabilitiesIqd, $b));
        }

        $cashBalanceIqd = 0.0;
        $cashRegIqd = 0.0;
        $bankAccIqd = 0.0;
        foreach ($engine->db['financialAccounts'] as $fa) {
            $b = (float)($fa['balanceIqd'] ?? 0);
            $cashBalanceIqd = ErpEngine::roundIqd(ErpEngine::decAdd($cashBalanceIqd, $b));
            if ($fa['type'] === 'CASH_REGISTER') $cashRegIqd = ErpEngine::roundIqd(ErpEngine::decAdd($cashRegIqd, $b));
            else $bankAccIqd = ErpEngine::roundIqd(ErpEngine::decAdd($bankAccIqd, $b));
        }

        $pendingExp = array_values(array_filter($engine->db['expenses'], fn($e) => ($e['status'] ?? '') === 'PENDING_APPROVAL'));
        $lowStock = array_values(array_filter($invVal['items'], fn($i) => $i['isLowStock'] || $i['isOutOfStock']));

        // Food Factory & HR KPIs
        $todayPrefix = date('Y-m-d');
        $curMonth = ErpEngine::currentMonthStr();
        $todayProductionCount = 0;
        foreach ($engine->db['productionBatches'] as $b) {
            if (($b['status'] ?? 'COMPLETED') === 'COMPLETED' && substr($b['date'] ?? '', 0, 10) === $todayPrefix) {
                $todayProductionCount++;
            }
        }
        $salariesPaidThisMonthIqd = 0.0;
        foreach ($engine->db['salaryPayments'] as $sp) {
            if (($sp['salaryMonth'] ?? '') === $curMonth && ($sp['status'] ?? 'POSTED') !== 'REVERSED') {
                $salariesPaidThisMonthIqd = ErpEngine::roundIqd(ErpEngine::decAdd($salariesPaidThisMonthIqd, $sp['amountIqd'] ?? 0));
            }
        }
        $activeEmployeesCount = count(array_filter($engine->db['employees'], fn($e) => ($e['status'] ?? 'ACTIVE') === 'ACTIVE'));

        // Build 14-day daily chart series in IQD
        $daily = [];
        for ($i = 13; $i >= 0; $i--) {
            $dayKey = gmdate('Y-m-d', time() - $i * 86400);
            $daily[$dayKey] = [
                'label' => substr($dayKey, 5),
                'salesIqd' => 0.0,
                'purchasesIqd' => 0.0,
                'expensesIqd' => 0.0,
                'profitIqd' => 0.0,
            ];
        }
        foreach ($engine->db['salesInvoices'] as $s) {
            if (!in_array($s['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) continue;
            $dk = substr($s['date'], 0, 10);
            if (isset($daily[$dk])) {
                $daily[$dk]['salesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($daily[$dk]['salesIqd'], $s['totalIqd'] ?? 0));
                $daily[$dk]['profitIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($daily[$dk]['profitIqd'], $s['grossProfitIqd'] ?? 0));
            }
        }
        foreach ($engine->db['purchaseInvoices'] as $p) {
            if (!in_array($p['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) continue;
            $dk = substr($p['date'], 0, 10);
            if (isset($daily[$dk])) {
                $daily[$dk]['purchasesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($daily[$dk]['purchasesIqd'], $p['totalIqd'] ?? 0));
            }
        }
        foreach ($engine->db['expenses'] as $e) {
            if (($e['status'] ?? '') !== 'POSTED') continue;
            $dk = substr($e['date'], 0, 10);
            if (isset($daily[$dk])) {
                $daily[$dk]['expensesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($daily[$dk]['expensesIqd'], $e['amountIqd'] ?? 0));
            }
        }

        // Build 6-month monthly chart series in IQD
        $monthly = [];
        for ($i = 5; $i >= 0; $i--) {
            $mk = date('Y-m', strtotime("-{$i} months"));
            $monthly[$mk] = [
                'label' => $mk,
                'salesIqd' => 0.0,
                'purchasesIqd' => 0.0,
                'expensesIqd' => 0.0,
                'profitIqd' => 0.0,
            ];
        }
        foreach ($engine->db['salesInvoices'] as $s) {
            if (!in_array($s['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) continue;
            $mk = substr($s['date'], 0, 7);
            if (isset($monthly[$mk])) {
                $monthly[$mk]['salesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($monthly[$mk]['salesIqd'], $s['totalIqd'] ?? 0));
                $monthly[$mk]['profitIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($monthly[$mk]['profitIqd'], $s['grossProfitIqd'] ?? 0));
            }
        }
        foreach ($engine->db['purchaseInvoices'] as $p) {
            if (!in_array($p['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) continue;
            $mk = substr($p['date'], 0, 7);
            if (isset($monthly[$mk])) {
                $monthly[$mk]['purchasesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($monthly[$mk]['purchasesIqd'], $p['totalIqd'] ?? 0));
            }
        }
        foreach ($engine->db['expenses'] as $e) {
            if (($e['status'] ?? '') !== 'POSTED') continue;
            $mk = substr($e['date'], 0, 7);
            if (isset($monthly[$mk])) {
                $monthly[$mk]['expensesIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($monthly[$mk]['expensesIqd'], $e['amountIqd'] ?? 0));
            }
        }

        echo json_encode([
            'kpis' => [
                'totalSalesIqd' => $pnl['netSalesRevenueIqd'],
                'totalSalesInvoicedIqd' => $totalSalesInvoicedIqd,
                'totalPurchasesIqd' => $totalPurchasesIqd,
                'totalExpensesIqd' => $pnl['operatingExpensesIqd'],
                'grossProfitIqd' => $pnl['grossProfitIqd'],
                'netProfitIqd' => $pnl['netProfitIqd'],
                'grossMarginPercent' => $pnl['grossMarginPercent'],
                'netMarginPercent' => $pnl['netMarginPercent'],
                'totalCustomerDebtsIqd' => $totalCustomerDebtsIqd,
                'totalSupplierLiabilitiesIqd' => $totalSupplierLiabilitiesIqd,
                'cashBalanceIqd' => $cashBalanceIqd,
                'cashRegistersIqd' => $cashRegIqd,
                'bankAccountsIqd' => $bankAccIqd,
                'inventoryCostValueIqd' => $invVal['totalCostValueIqd'],
                'inventoryRetailValueIqd' => $invVal['totalRetailValueIqd'],
                'rawMaterialValueIqd' => $invVal['rawMaterialValueIqd'],
                'finishedProductValueIqd' => $invVal['finishedProductValueIqd'],
                'totalCustomers' => count($engine->db['customers']),
                'totalSuppliers' => count($engine->db['suppliers']),
                'totalProducts' => $invVal['totalProducts'],
                'lowStockCount' => count($lowStock),
                'unpaidSalesCount' => count($unpaidSales),
                'unpaidPurchasesCount' => count($unpaidPurchases),
                'pendingExpensesCount' => count($pendingExp),
                'activeEmployeesCount' => $activeEmployeesCount,
                'salariesPaidThisMonthIqd' => $salariesPaidThisMonthIqd,
                'todayProductionCount' => $todayProductionCount,
                'totalProductionBatches' => count($engine->db['productionBatches']),
            ],
            'financialAccounts' => $engine->db['financialAccounts'],
            'lowStockProducts' => $lowStock,
            'unpaidInvoices' => array_merge($unpaidSales, $unpaidPurchases),
            'pendingExpenses' => $pendingExp,
            'recentTransactions' => array_slice($engine->db['journals'], 0, 10),
            'charts' => [
                'daily' => array_values($daily),
                'monthly' => array_values($monthly),
                'expenseByCategory' => $pnl['operatingExpenseBreakdown'],
                'profitByCategory' => $pnl['profitByCategory'],
            ],
        ]);
        exit;
    }

    // =========================================================================
    // 4. INVENTORY, PRODUCTS, UNITS & SPOILAGE ENDPOINT
    // =========================================================================
    if ($route === 'inventory') {
        if ($method === 'GET') {
            echo json_encode([
                'valuation' => $engine->getInventoryValuation(),
                'movements' => array_map([$engine, 'hydrateMovement'], array_slice($engine->db['movements'], 0, 80)),
                'transfers' => array_map([$engine, 'hydrateTransfer'], array_slice($engine->db['transfers'], 0, 40)),
                'spoilageRecords' => array_map([$engine, 'hydrateSpoilage'], array_slice($engine->db['spoilageRecords'], 0, 60)),
                'categories' => $engine->db['categories'],
                'warehouses' => $engine->db['warehouses'],
                'units' => $engine->db['units'],
            ]);
            exit;
        }

        $action = $body['action'] ?? '';

        if ($action === 'createProduct') {
            $primaryName = trim($body['name'] ?? $body['nameKu'] ?? $body['nameAr'] ?? $body['nameEn'] ?? '');
            if (!$primaryName) {
                throw new Exception('Product name is required.');
            }
            $nameKu = trim($body['nameKu'] ?? '') ?: $primaryName;
            $nameAr = trim($body['nameAr'] ?? '') ?: $primaryName;
            $nameEn = trim($body['nameEn'] ?? '') ?: $primaryName;

            $unitCode = ErpEngine::normalizeUnitCode($body['unit'] ?? 'piece');
            if (!$engine->findUnitByCode($unitCode)) {
                throw new Exception("Unknown measurement unit '{$unitCode}'.");
            }

            $productType = $body['productType'] ?? 'FINISHED_PRODUCT';
            if (!in_array($productType, ['FINISHED_PRODUCT', 'RAW_MATERIAL', 'GENERAL'])) {
                $productType = 'FINISHED_PRODUCT';
            }

            $skuPrefix = $productType === 'RAW_MATERIAL' ? 'RAW' : 'PRD';
            $sku = strtoupper(trim($body['sku'] ?? ''));
            if (!$sku) {
                $sku = sprintf('%s-%04d', $skuPrefix, count($engine->db['products']) + 1);
            }
            foreach ($engine->db['products'] as $existingP) {
                if (strcasecmp($existingP['sku'], $sku) === 0) {
                    $sku = $sku . '-' . rand(10, 99);
                    break;
                }
            }

            $costIqd = ErpEngine::roundIqd($body['purchaseCostIqd'] ?? 0);
            $priceIqd = ErpEngine::roundIqd($body['sellingPriceIqd'] ?? 0);
            if ($costIqd < 0 || $priceIqd < 0) {
                throw new Exception('Prices and costs cannot be negative.');
            }

            $p = [
                'id' => ErpEngine::cuid('prd_'),
                'sku' => $sku,
                'barcode' => !empty($body['barcode']) ? trim($body['barcode']) : null,
                'nameEn' => $nameEn,
                'nameAr' => $nameAr,
                'nameKu' => $nameKu,
                'description' => !empty($body['description']) ? trim($body['description']) : null,
                'categoryId' => !empty($body['categoryId']) ? $body['categoryId'] : ($engine->db['categories'][0]['id'] ?? ''),
                'productType' => $productType,
                'unit' => $unitCode,
                'purchaseCostIqd' => $costIqd,
                'sellingPriceIqd' => $priceIqd,
                'purchaseCostUsd' => ErpEngine::iqdToUsd($costIqd, $rate),
                'sellingPriceUsd' => ErpEngine::iqdToUsd($priceIqd, $rate),
                'taxRate' => (float)($body['taxRate'] ?? 0),
                'minStockLevel' => ErpEngine::roundQty($body['minStockLevel'] ?? 5),
                'totalStock' => 0.0,
                'imageUrl' => !empty($body['imageUrl']) ? $body['imageUrl'] : null,
                'isActive' => true,
                'createdAt' => ErpEngine::nowIso(),
                'updatedAt' => ErpEngine::nowIso(),
            ];
            array_unshift($engine->db['products'], $p);

            $initStockRaw = (float)($body['initialStock'] ?? 0);
            if ($initStockRaw > 0) {
                $initUnit = !empty($body['initialStockUnit']) ? ErpEngine::normalizeUnitCode($body['initialStockUnit']) : $unitCode;
                $initStockBase = $engine->convertQuantity($initStockRaw, $initUnit, $unitCode);
                $whId = !empty($body['warehouseId']) ? $body['warehouseId'] : ($engine->db['warehouses'][0]['id'] ?? '');
                $engine->applyStockChange([
                    'productId' => $p['id'],
                    'warehouseId' => $whId,
                    'quantityDelta' => $initStockBase,
                    'enteredQuantity' => $initStockRaw,
                    'enteredUnit' => $initUnit,
                    'type' => 'OPENING_STOCK',
                    'unitCostIqd' => $costIqd,
                    'reason' => 'Initial opening stock',
                    'postJournalForAdjustment' => true,
                ]);
                $p = $engine->findById('products', $p['id']);
            }
            $engine->logAudit('PRODUCT_CREATED', 'INVENTORY', 'Product', $p['id'], "Created product {$p['nameKu']} ({$p['sku']}, {$p['unit']})");
            $engine->saveDatabase();
            echo json_encode(['product' => $engine->hydrateProduct($p)]);
            exit;
        }

        if ($action === 'updateProduct') {
            $pid = $body['productId'] ?? '';
            $foundIdx = null;
            foreach ($engine->db['products'] as $idx => $p) {
                if ($p['id'] === $pid) {
                    $foundIdx = $idx;
                    break;
                }
            }
            if ($foundIdx === null) throw new Exception('Product not found.');

            $prod = &$engine->db['products'][$foundIdx];
            $oldUnit = $prod['unit'];
            $newUnit = isset($body['unit']) ? ErpEngine::normalizeUnitCode($body['unit']) : $oldUnit;

            if ($newUnit !== $oldUnit) {
                if (!$engine->findUnitByCode($newUnit)) {
                    throw new Exception("Unknown measurement unit '{$newUnit}'.");
                }
                if ($engine->areUnitsCompatible($oldUnit, $newUnit)) {
                    // Safely convert stock, minStockLevel, and unit prices/costs to new compatible unit!
                    $factorToNew = $engine->convertQuantity(1, $oldUnit, $newUnit);
                    $prod['totalStock'] = $engine->convertQuantity($prod['totalStock'] ?? 0, $oldUnit, $newUnit);
                    $prod['minStockLevel'] = $engine->convertQuantity($prod['minStockLevel'] ?? 0, $oldUnit, $newUnit);
                    foreach ($engine->db['warehouseStocks'] as &$ws) {
                        if ($ws['productId'] === $pid) {
                            $ws['quantity'] = $engine->convertQuantity($ws['quantity'], $oldUnit, $newUnit);
                        }
                    }
                    unset($ws);
                    if (!isset($body['purchaseCostIqd']) && $factorToNew > 0) {
                        $prod['purchaseCostIqd'] = ErpEngine::roundIqd(ErpEngine::decDiv($prod['purchaseCostIqd'] ?? 0, $factorToNew, 6));
                    }
                    if (!isset($body['sellingPriceIqd']) && $factorToNew > 0) {
                        $prod['sellingPriceIqd'] = ErpEngine::roundIqd(ErpEngine::decDiv($prod['sellingPriceIqd'] ?? 0, $factorToNew, 6));
                    }
                    $prod['unit'] = $newUnit;
                } else {
                    if (abs((float)($prod['totalStock'] ?? 0)) > 0.0001) {
                        throw new Exception("Cannot change unit from '{$oldUnit}' to incompatible unit '{$newUnit}' while product has stock ({$prod['totalStock']}). Adjust stock to 0 first.");
                    }
                    $prod['unit'] = $newUnit;
                }
            }

            if (isset($body['name']) && trim($body['name']) !== '') {
                $n = trim($body['name']);
                $prod['nameKu'] = trim($body['nameKu'] ?? '') ?: $n;
                $prod['nameAr'] = trim($body['nameAr'] ?? '') ?: $n;
                $prod['nameEn'] = trim($body['nameEn'] ?? '') ?: $n;
            } else {
                if (isset($body['nameKu']) && trim($body['nameKu']) !== '') $prod['nameKu'] = trim($body['nameKu']);
                if (isset($body['nameAr']) && trim($body['nameAr']) !== '') $prod['nameAr'] = trim($body['nameAr']);
                if (isset($body['nameEn']) && trim($body['nameEn']) !== '') $prod['nameEn'] = trim($body['nameEn']);
            }
            if (isset($body['categoryId'])) $prod['categoryId'] = $body['categoryId'];
            if (isset($body['productType'])) $prod['productType'] = $body['productType'];
            if (isset($body['barcode'])) $prod['barcode'] = trim($body['barcode']) ?: null;
            if (isset($body['description'])) $prod['description'] = trim($body['description']) ?: null;
            if (array_key_exists('imageUrl', $body)) $prod['imageUrl'] = $body['imageUrl'] ?: null;
            if (isset($body['minStockLevel'])) $prod['minStockLevel'] = ErpEngine::roundQty($body['minStockLevel']);
            if (isset($body['purchaseCostIqd'])) {
                $prod['purchaseCostIqd'] = ErpEngine::roundIqd($body['purchaseCostIqd']);
                $prod['purchaseCostUsd'] = ErpEngine::iqdToUsd($prod['purchaseCostIqd'], $rate);
            }
            if (isset($body['sellingPriceIqd'])) {
                $prod['sellingPriceIqd'] = ErpEngine::roundIqd($body['sellingPriceIqd']);
                $prod['sellingPriceUsd'] = ErpEngine::iqdToUsd($prod['sellingPriceIqd'], $rate);
            }
            $prod['updatedAt'] = ErpEngine::nowIso();

            $engine->logAudit('PRODUCT_UPDATED', 'INVENTORY', 'Product', $pid, "Updated product {$prod['nameKu']}");
            $engine->saveDatabase();
            echo json_encode(['product' => $engine->hydrateProduct($prod)]);
            exit;
        }

        if ($action === 'deleteProduct') {
            $pid = $body['productId'] ?? '';
            $prod = $engine->findById('products', $pid);
            if (!$prod) throw new Exception('Product not found.');

            if ($engine->isProductUsed($pid)) {
                throw new Exception("Cannot delete '{$prod['nameKu']}' because it has existing stock or transaction history. You can archive it instead.");
            }
            $engine->db['products'] = array_values(array_filter($engine->db['products'], fn($p) => $p['id'] !== $pid));
            $engine->db['warehouseStocks'] = array_values(array_filter($engine->db['warehouseStocks'], fn($ws) => $ws['productId'] !== $pid));
            $engine->logAudit('PRODUCT_DELETED', 'INVENTORY', 'Product', $pid, "Deleted unused product {$prod['nameKu']}");
            $engine->saveDatabase();
            echo json_encode(['deleted' => true, 'productId' => $pid]);
            exit;
        }

        if ($action === 'archiveProduct') {
            $pid = $body['productId'] ?? '';
            foreach ($engine->db['products'] as &$p) {
                if ($p['id'] === $pid) {
                    $p['isActive'] = false;
                    $engine->logAudit('PRODUCT_ARCHIVED', 'INVENTORY', 'Product', $pid, "Archived product {$p['nameKu']}");
                    $engine->saveDatabase();
                    echo json_encode(['archived' => true, 'productId' => $pid]);
                    exit;
                }
            }
            throw new Exception('Product not found.');
        }

        if ($action === 'adjustStock') {
            $idem = $engine->checkIdempotency($body['idempotencyKey'] ?? null);
            if ($idem) { echo json_encode($idem); exit; }

            $prod = $engine->findById('products', $body['productId'] ?? '');
            if (!$prod) throw new Exception('Product not found.');
            $enteredDelta = (float)$body['quantityDelta'];
            if ($enteredDelta == 0.0) throw new Exception('Quantity change cannot be zero.');

            $enteredUnit = !empty($body['unit']) ? ErpEngine::normalizeUnitCode($body['unit']) : $prod['unit'];
            $sign = $enteredDelta < 0 ? -1 : 1;
            $baseDelta = $sign * $engine->convertQuantity(abs($enteredDelta), $enteredUnit, $prod['unit']);

            $res = $engine->applyStockChange([
                'productId' => $prod['id'],
                'warehouseId' => !empty($body['warehouseId']) ? $body['warehouseId'] : ($engine->db['warehouses'][0]['id'] ?? ''),
                'quantityDelta' => $baseDelta,
                'enteredQuantity' => $enteredDelta,
                'enteredUnit' => $enteredUnit,
                'type' => $baseDelta >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
                'reason' => trim($body['reason'] ?? '') ?: 'Manual stock adjustment',
                'date' => $body['date'] ?? null,
                'postJournalForAdjustment' => true,
            ]);
            $engine->logAudit('STOCK_ADJUSTED', 'INVENTORY', 'Product', $prod['id'], "Adjusted {$prod['nameKu']} by {$enteredDelta} {$enteredUnit} ({$baseDelta} {$prod['unit']})");
            $engine->storeIdempotency($body['idempotencyKey'] ?? null, $res);
            $engine->saveDatabase();
            echo json_encode($res);
            exit;
        }

        if ($action === 'recordSpoilage') {
            $idem = $engine->checkIdempotency($body['idempotencyKey'] ?? null);
            if ($idem) { echo json_encode($idem); exit; }

            $prod = $engine->findById('products', $body['productId'] ?? '');
            if (!$prod) throw new Exception('Product not found.');
            $qtyEntered = (float)($body['quantity'] ?? 0);
            if ($qtyEntered <= 0) throw new Exception('Spoilage quantity must be greater than zero.');

            $enteredUnit = !empty($body['unit']) ? ErpEngine::normalizeUnitCode($body['unit']) : $prod['unit'];
            $baseQty = $engine->convertQuantity($qtyEntered, $enteredUnit, $prod['unit']);
            $whId = !empty($body['warehouseId']) ? $body['warehouseId'] : ($engine->db['warehouses'][0]['id'] ?? '');
            $dateIso = ErpEngine::normalizeDateIso($body['date'] ?? null);
            $reason = trim($body['reason'] ?? 'SPOILED');
            $notes = trim($body['notes'] ?? '');
            $costIqd = ErpEngine::roundIqd(ErpEngine::decMul($baseQty, $prod['purchaseCostIqd'] ?? 0, 6));

            $spoilageId = ErpEngine::cuid('spl_');
            $spoilageNum = sprintf('WST-%s-%04d', date('Y'), count($engine->db['spoilageRecords']) + 1);

            $engine->applyStockChange([
                'productId' => $prod['id'],
                'warehouseId' => $whId,
                'quantityDelta' => -$baseQty,
                'enteredQuantity' => -$qtyEntered,
                'enteredUnit' => $enteredUnit,
                'type' => 'SPOILAGE_WASTE',
                'referenceType' => 'SPOILAGE_WASTE',
                'referenceId' => $spoilageId,
                'reason' => "{$spoilageNum}: {$reason}" . ($notes ? " — {$notes}" : ''),
                'date' => $dateIso,
                'postJournalForAdjustment' => true,
            ]);

            $rec = [
                'id' => $spoilageId,
                'recordNumber' => $spoilageNum,
                'productId' => $prod['id'],
                'warehouseId' => $whId,
                'quantity' => $qtyEntered,
                'unit' => $enteredUnit,
                'baseQuantity' => $baseQty,
                'baseUnit' => $prod['unit'],
                'unitCostIqd' => (float)($prod['purchaseCostIqd'] ?? 0),
                'totalCostIqd' => $costIqd,
                'reason' => $reason,
                'notes' => $notes ?: null,
                'date' => $dateIso,
                'createdAt' => ErpEngine::nowIso(),
            ];
            array_unshift($engine->db['spoilageRecords'], $rec);
            $engine->logAudit('SPOILAGE_RECORDED', 'INVENTORY', 'Spoilage', $spoilageId, "Recorded spoilage {$spoilageNum}: {$qtyEntered} {$enteredUnit} of {$prod['nameKu']}");
            $resp = ['spoilage' => $engine->hydrateSpoilage($rec)];
            $engine->storeIdempotency($body['idempotencyKey'] ?? null, $resp);
            $engine->saveDatabase();
            echo json_encode($resp);
            exit;
        }

        if ($action === 'transferStock') {
            $prod = $engine->findById('products', $body['productId'] ?? '');
            if (!$prod) throw new Exception('Product not found.');
            $qtyEntered = (float)$body['quantity'];
            if ($qtyEntered <= 0) throw new Exception('Transfer quantity must be greater than zero.');
            if ($body['fromWarehouseId'] === $body['toWarehouseId']) {
                throw new Exception('Source and destination warehouses must be different.');
            }
            $enteredUnit = !empty($body['unit']) ? ErpEngine::normalizeUnitCode($body['unit']) : $prod['unit'];
            $baseQty = $engine->convertQuantity($qtyEntered, $enteredUnit, $prod['unit']);

            $trf = [
                'id' => ErpEngine::cuid('trf_'),
                'transferNumber' => sprintf('TRF-%s-%04d', date('Y'), count($engine->db['transfers']) + 1),
                'fromWarehouseId' => $body['fromWarehouseId'],
                'toWarehouseId' => $body['toWarehouseId'],
                'productId' => $prod['id'],
                'quantity' => $baseQty,
                'enteredQuantity' => $qtyEntered,
                'enteredUnit' => $enteredUnit,
                'notes' => $body['notes'] ?? null,
                'status' => 'COMPLETED',
                'createdAt' => ErpEngine::nowIso(),
            ];
            $engine->applyStockChange([
                'productId' => $prod['id'],
                'warehouseId' => $body['fromWarehouseId'],
                'quantityDelta' => -$baseQty,
                'type' => 'TRANSFER_OUT',
                'reason' => "Transfer {$trf['transferNumber']}",
            ]);
            $engine->applyStockChange([
                'productId' => $prod['id'],
                'warehouseId' => $body['toWarehouseId'],
                'quantityDelta' => $baseQty,
                'type' => 'TRANSFER_IN',
                'reason' => "Transfer {$trf['transferNumber']}",
            ]);
            array_unshift($engine->db['transfers'], $trf);
            $engine->saveDatabase();
            echo json_encode(['transfer' => $engine->hydrateTransfer($trf)]);
            exit;
        }

        if ($action === 'createUnit') {
            $nameKu = trim($body['nameKu'] ?? $body['name'] ?? '');
            $nameEn = trim($body['nameEn'] ?? $nameKu);
            $nameAr = trim($body['nameAr'] ?? $nameKu);
            if (!$nameKu && !$nameEn) throw new Exception('Unit name is required.');

            $rawCode = strtolower(trim($body['code'] ?? ''));
            if (!$rawCode) {
                $rawCode = preg_replace('/[^a-z0-9_]+/', '_', strtolower($nameEn));
                $rawCode = trim($rawCode, '_') ?: ('unit_' . rand(100, 999));
                while ($engine->findUnitByCode($rawCode)) {
                    $rawCode .= '_' . rand(10, 99);
                }
            }
            if ($engine->findUnitByCode($rawCode)) {
                throw new Exception("Unit code '{$rawCode}' already exists.");
            }

            $linkToBase = !empty($body['baseUnitCode']) ? ErpEngine::normalizeUnitCode($body['baseUnitCode']) : null;
            $factor = (float)($body['toBaseFactor'] ?? 1);
            if ($factor <= 0) throw new Exception('Conversion factor must be greater than zero.');

            if ($linkToBase) {
                $baseObj = $engine->findUnitByCode($linkToBase);
                if (!$baseObj) throw new Exception("Base unit '{$linkToBase}' not found.");
                $family = $baseObj['family'];
                $trueBaseCode = $baseObj['baseUnitCode'];
                $trueFactor = (float)ErpEngine::decMul($factor, $baseObj['toBaseFactor'], 6);
            } else {
                $family = 'CUSTOM_' . strtoupper($rawCode);
                $trueBaseCode = $rawCode;
                $trueFactor = 1.0;
            }

            $u = [
                'id' => ErpEngine::cuid('unit_'),
                'code' => $rawCode,
                'symbol' => trim($body['symbol'] ?? '') ?: $nameKu,
                'nameKu' => $nameKu ?: $nameEn,
                'nameAr' => $nameAr ?: $nameKu,
                'nameEn' => $nameEn ?: $nameKu,
                'family' => $family,
                'baseUnitCode' => $trueBaseCode,
                'toBaseFactor' => $trueFactor,
                'allowDecimal' => !empty($body['allowDecimal']),
                'isSystem' => false,
            ];
            $engine->db['units'][] = $u;
            $engine->logAudit('UNIT_CREATED', 'INVENTORY', 'Unit', $u['id'], "Created unit {$u['nameKu']} ({$u['code']})");
            $engine->saveDatabase();
            echo json_encode(['unit' => $u]);
            exit;
        }

        if ($action === 'deleteUnit') {
            $code = strtolower(trim($body['code'] ?? ''));
            $u = $engine->findUnitByCode($code);
            if (!$u) throw new Exception('Unit not found.');
            if (!empty($u['isSystem'])) throw new Exception('System measurement units cannot be deleted.');
            foreach ($engine->db['products'] as $p) {
                if (strtolower($p['unit']) === $code) {
                    throw new Exception("Cannot delete unit '{$u['nameKu']}' because it is used by product '{$p['nameKu']}'.");
                }
            }
            $engine->db['units'] = array_values(array_filter($engine->db['units'], fn($x) => strtolower($x['code']) !== $code));
            $engine->saveDatabase();
            echo json_encode(['deleted' => true]);
            exit;
        }

        if ($action === 'createWarehouse') {
            $name = trim($body['nameKu'] ?? $body['nameEn'] ?? '');
            if (!$name) throw new Exception('Warehouse name is required.');
            $wh = [
                'id' => ErpEngine::cuid('wh_'),
                'code' => 'WH-' . rand(100, 999),
                'nameEn' => trim($body['nameEn'] ?? '') ?: $name,
                'nameAr' => trim($body['nameAr'] ?? '') ?: $name,
                'nameKu' => trim($body['nameKu'] ?? '') ?: $name,
                'location' => $body['location'] ?? '',
                'isDefault' => false,
                'isActive' => true,
            ];
            $engine->db['warehouses'][] = $wh;
            $engine->saveDatabase();
            echo json_encode(['warehouse' => $wh]);
            exit;
        }

        if ($action === 'createCategory') {
            $name = trim($body['nameKu'] ?? $body['nameEn'] ?? $body['nameAr'] ?? '');
            if (!$name) throw new Exception('Category name is required.');
            $cat = [
                'id' => ErpEngine::cuid('cat_'),
                'code' => 'CAT-' . rand(100, 999),
                'nameEn' => trim($body['nameEn'] ?? '') ?: $name,
                'nameAr' => trim($body['nameAr'] ?? '') ?: $name,
                'nameKu' => trim($body['nameKu'] ?? '') ?: $name,
                'createdAt' => ErpEngine::nowIso(),
            ];
            array_unshift($engine->db['categories'], $cat);
            $engine->saveDatabase();
            echo json_encode(['category' => $cat]);
            exit;
        }
    }

    // =========================================================================
    // 5. FOOD PRODUCTION & RECIPES ENDPOINT
    // =========================================================================
    if ($route === 'production') {
        if ($method === 'GET') {
            echo json_encode([
                'recipes' => array_map([$engine, 'hydrateRecipe'], $engine->db['recipes']),
                'batches' => array_map([$engine, 'hydrateProductionBatch'], array_slice($engine->db['productionBatches'], 0, 80)),
                'spoilageRecords' => array_map([$engine, 'hydrateSpoilage'], array_slice($engine->db['spoilageRecords'], 0, 60)),
            ]);
            exit;
        }

        $action = $body['action'] ?? '';

        if ($action === 'saveRecipe') {
            $fpId = $body['finishedProductId'] ?? '';
            $fp = $engine->findById('products', $fpId);
            if (!$fp) throw new Exception('Finished product not found.');
            $yieldQty = (float)($body['yieldQuantity'] ?? 0);
            if ($yieldQty <= 0) throw new Exception('Recipe yield quantity must be greater than zero.');
            $yieldUnit = ErpEngine::normalizeUnitCode($body['yieldUnit'] ?? $fp['unit']);
            // Validate yieldUnit is compatible with finished product's unit
            $engine->convertQuantity($yieldQty, $yieldUnit, $fp['unit']);

            $rawIngs = $body['ingredients'] ?? [];
            if (count($rawIngs) === 0) throw new Exception('Recipe must contain at least one raw material ingredient.');

            $cleanIngs = [];
            foreach ($rawIngs as $ing) {
                $rm = $engine->findById('products', $ing['rawMaterialId'] ?? '');
                if (!$rm) throw new Exception('Raw material not found in recipe.');
                $q = (float)($ing['quantity'] ?? 0);
                if ($q <= 0) throw new Exception("Ingredient quantity for '{$rm['nameKu']}' must be > 0.");
                $u = ErpEngine::normalizeUnitCode($ing['unit'] ?? $rm['unit']);
                // Strictly verify compatible unit!
                $engine->convertQuantity($q, $u, $rm['unit']);
                $cleanIngs[] = [
                    'rawMaterialId' => $rm['id'],
                    'quantity' => ErpEngine::roundQty($q),
                    'unit' => $u,
                ];
            }

            $existingIdx = null;
            foreach ($engine->db['recipes'] as $idx => $r) {
                if (($body['recipeId'] ?? null) === $r['id'] || $r['finishedProductId'] === $fpId) {
                    $existingIdx = $idx;
                    break;
                }
            }

            if ($existingIdx !== null) {
                $engine->db['recipes'][$existingIdx]['yieldQuantity'] = ErpEngine::roundQty($yieldQty);
                $engine->db['recipes'][$existingIdx]['yieldUnit'] = $yieldUnit;
                $engine->db['recipes'][$existingIdx]['ingredients'] = $cleanIngs;
                $engine->db['recipes'][$existingIdx]['notes'] = trim($body['notes'] ?? '') ?: null;
                $engine->db['recipes'][$existingIdx]['updatedAt'] = ErpEngine::nowIso();
                $saved = $engine->db['recipes'][$existingIdx];
            } else {
                $saved = [
                    'id' => ErpEngine::cuid('rcp_'),
                    'finishedProductId' => $fpId,
                    'yieldQuantity' => ErpEngine::roundQty($yieldQty),
                    'yieldUnit' => $yieldUnit,
                    'ingredients' => $cleanIngs,
                    'notes' => trim($body['notes'] ?? '') ?: null,
                    'createdAt' => ErpEngine::nowIso(),
                    'updatedAt' => ErpEngine::nowIso(),
                ];
                array_unshift($engine->db['recipes'], $saved);
            }

            $engine->logAudit('RECIPE_SAVED', 'PRODUCTION', 'Recipe', $saved['id'], "Saved production recipe for {$fp['nameKu']}");
            $engine->saveDatabase();
            echo json_encode(['recipe' => $engine->hydrateRecipe($saved)]);
            exit;
        }

        if ($action === 'deleteRecipe') {
            $rid = $body['recipeId'] ?? '';
            $engine->db['recipes'] = array_values(array_filter($engine->db['recipes'], fn($r) => $r['id'] !== $rid));
            $engine->saveDatabase();
            echo json_encode(['deleted' => true]);
            exit;
        }

        if ($action === 'recordProduction') {
            $idem = $engine->checkIdempotency($body['idempotencyKey'] ?? null);
            if ($idem) { echo json_encode($idem); exit; }

            $fpId = $body['finishedProductId'] ?? '';
            $fp = $engine->findById('products', $fpId);
            if (!$fp) throw new Exception('Finished product not found.');

            $qtyProduced = (float)($body['quantityProduced'] ?? 0);
            if ($qtyProduced <= 0) throw new Exception('Produced quantity must be greater than zero.');

            $enteredUnit = ErpEngine::normalizeUnitCode($body['unit'] ?? $fp['unit']);
            $producedBaseQty = $engine->convertQuantity($qtyProduced, $enteredUnit, $fp['unit']);
            $warehouseId = !empty($body['warehouseId']) ? $body['warehouseId'] : ($engine->db['warehouses'][0]['id'] ?? '');
            $dateIso = ErpEngine::normalizeDateIso($body['date'] ?? null);
            $mode = strtoupper($body['mode'] ?? 'MANUAL');
            $allowNeg = !empty($body['allowNegativeStock']) || !empty($engine->db['settings']['allowNegativeStock']);

            // Resolve raw materials list (either passed explicitly, or auto-scaled from recipe)
            $materialsInput = $body['materialsUsed'] ?? [];
            $recipeId = $body['recipeId'] ?? null;
            if ($mode === 'RECIPE' && empty($materialsInput)) {
                $recipe = null;
                foreach ($engine->db['recipes'] as $r) {
                    if (($recipeId && $r['id'] === $recipeId) || $r['finishedProductId'] === $fpId) {
                        $recipe = $r;
                        break;
                    }
                }
                if (!$recipe) throw new Exception("No saved recipe found for '{$fp['nameKu']}'.");
                $recipeId = $recipe['id'];
                $yieldBase = $engine->convertQuantity($recipe['yieldQuantity'], $recipe['yieldUnit'], $fp['unit']);
                $scale = ErpEngine::decDiv($producedBaseQty, $yieldBase, 8);
                foreach ($recipe['ingredients'] as $ing) {
                    $materialsInput[] = [
                        'rawMaterialId' => $ing['rawMaterialId'],
                        'quantity' => ErpEngine::roundQty(ErpEngine::decMul($ing['quantity'], $scale, 8)),
                        'unit' => $ing['unit'],
                    ];
                }
            }

            // PHASE 1: Validate ALL raw materials & stock availability BEFORE mutating anything!
            $preparedMaterials = [];
            $totalMaterialCostIqd = 0.0;
            $requiredByProductId = [];

            foreach ($materialsInput as $mRaw) {
                $rmQty = (float)($mRaw['quantity'] ?? 0);
                if ($rmQty <= 0) continue;
                $rm = $engine->findById('products', $mRaw['rawMaterialId'] ?? '');
                if (!$rm) throw new Exception('Raw material not found.');
                if ($rm['id'] === $fpId) throw new Exception('Finished product cannot consume itself as a raw material.');

                $rmUnit = ErpEngine::normalizeUnitCode($mRaw['unit'] ?? $rm['unit']);
                $rmBaseQty = $engine->convertQuantity($rmQty, $rmUnit, $rm['unit']);
                $requiredByProductId[$rm['id']] = ErpEngine::roundQty(ErpEngine::decAdd($requiredByProductId[$rm['id']] ?? 0, $rmBaseQty, 6));

                $unitCostIqd = ErpEngine::roundIqd($rm['purchaseCostIqd'] ?? 0);
                $lineCostIqd = ErpEngine::roundIqd(ErpEngine::decMul($rmBaseQty, $unitCostIqd, 6));
                $totalMaterialCostIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalMaterialCostIqd, $lineCostIqd));

                $preparedMaterials[] = [
                    'rawMaterialId' => $rm['id'],
                    'rawMaterialName' => $rm['nameKu'],
                    'quantity' => ErpEngine::roundQty($rmQty),
                    'unit' => $rmUnit,
                    'baseQuantity' => $rmBaseQty,
                    'baseUnit' => $rm['unit'],
                    'unitCostIqd' => $unitCostIqd,
                    'totalCostIqd' => $lineCostIqd,
                    'invAccountCode' => $engine->getInventoryAccountCodeForProduct($rm),
                ];
            }

            if (!$allowNeg) {
                foreach ($requiredByProductId as $rmId => $reqQty) {
                    $rmObj = $engine->findById('products', $rmId);
                    $avail = 0.0;
                    foreach ($engine->db['warehouseStocks'] as $ws) {
                        if ($ws['productId'] === $rmId && $ws['warehouseId'] === $warehouseId) {
                            $avail = (float)$ws['quantity'];
                            break;
                        }
                    }
                    if ($avail < $reqQty - 0.0001) {
                        throw new Exception("Insufficient raw material '{$rmObj['nameKu']}'. Available: {$avail} {$rmObj['unit']}, Required: {$reqQty} {$rmObj['unit']}.");
                    }
                }
            }

            // PHASE 2: Apply stock mutations ONCE per item!
            $batchId = ErpEngine::cuid('prd_b_');
            $batchNumber = sprintf('PRD-%s-%04d', date('Y'), count($engine->db['productionBatches']) + 1);

            foreach ($preparedMaterials as $pm) {
                $engine->applyStockChange([
                    'productId' => $pm['rawMaterialId'],
                    'warehouseId' => $warehouseId,
                    'quantityDelta' => -$pm['baseQuantity'],
                    'enteredQuantity' => -$pm['quantity'],
                    'enteredUnit' => $pm['unit'],
                    'type' => 'PRODUCTION_CONSUMPTION',
                    'unitCostIqd' => $pm['unitCostIqd'],
                    'referenceType' => 'PRODUCTION_BATCH',
                    'referenceId' => $batchId,
                    'reason' => "Production {$batchNumber} ({$fp['nameKu']})",
                    'date' => $dateIso,
                    'allowNegativeStock' => $allowNeg,
                    'postJournalForAdjustment' => false,
                ]);
            }

            // Calculate unit production cost
            $unitProductionCostIqd = $totalMaterialCostIqd > 0
                ? ErpEngine::roundIqd(ErpEngine::decDiv($totalMaterialCostIqd, $producedBaseQty, 6))
                : ErpEngine::roundIqd($fp['purchaseCostIqd'] ?? 0);
            $totalBatchValueIqd = $totalMaterialCostIqd > 0
                ? $totalMaterialCostIqd
                : ErpEngine::roundIqd(ErpEngine::decMul($producedBaseQty, $unitProductionCostIqd, 6));

            // Update weighted average cost of finished product if materials were consumed
            if ($totalMaterialCostIqd > 0) {
                foreach ($engine->db['products'] as &$pRef) {
                    if ($pRef['id'] === $fpId) {
                        $oldStock = max(0.0, (float)($pRef['totalStock'] ?? 0));
                        $oldCost = (float)($pRef['purchaseCostIqd'] ?? 0);
                        $newTotal = ErpEngine::decAdd($oldStock, $producedBaseQty, 6);
                        if ((float)$newTotal > 0) {
                            $weighted = ErpEngine::decDiv(
                                ErpEngine::decAdd(ErpEngine::decMul($oldStock, $oldCost, 6), $totalMaterialCostIqd, 6),
                                $newTotal,
                                6
                            );
                            $pRef['purchaseCostIqd'] = ErpEngine::roundIqd($weighted);
                            $pRef['purchaseCostUsd'] = ErpEngine::iqdToUsd($pRef['purchaseCostIqd'], $rate);
                        }
                        break;
                    }
                }
                unset($pRef);
            }

            // Add finished product stock ONCE!
            $engine->applyStockChange([
                'productId' => $fpId,
                'warehouseId' => $warehouseId,
                'quantityDelta' => $producedBaseQty,
                'enteredQuantity' => $qtyProduced,
                'enteredUnit' => $enteredUnit,
                'type' => 'PRODUCTION_OUTPUT',
                'unitCostIqd' => $unitProductionCostIqd,
                'referenceType' => 'PRODUCTION_BATCH',
                'referenceId' => $batchId,
                'reason' => "Production {$batchNumber}",
                'date' => $dateIso,
                'postJournalForAdjustment' => false,
            ]);

            // PHASE 3: Post Balanced Double-Entry Journal Entry
            $journalEntryId = null;
            if ($totalBatchValueIqd > 0) {
                $finInvCode = $engine->getInventoryAccountCodeForProduct($fp);
                $jLines = [
                    ['accountCode' => $finInvCode, 'debitIqd' => $totalBatchValueIqd, 'creditIqd' => 0, 'description' => "Produced {$qtyProduced} {$enteredUnit} {$fp['nameKu']} ({$batchNumber})"],
                ];
                if ($totalMaterialCostIqd > 0) {
                    // Group raw material credits by inventory account code (e.g. 1310 / 1300)
                    $creditByAcc = [];
                    foreach ($preparedMaterials as $pm) {
                        $c = $pm['invAccountCode'];
                        $creditByAcc[$c] = ErpEngine::roundIqd(ErpEngine::decAdd($creditByAcc[$c] ?? 0, $pm['totalCostIqd']));
                    }
                    foreach ($creditByAcc as $accCode => $amt) {
                        if ($amt > 0) {
                            $jLines[] = ['accountCode' => $accCode, 'debitIqd' => 0, 'creditIqd' => $amt, 'description' => "Raw materials consumed for {$batchNumber}"];
                        }
                    }
                } else {
                    // Simple manual production without inventory raw materials: absorb against COGS (5000) so selling nets out accurately without double-counting raw material expenses
                    $jLines[] = ['accountCode' => '5000', 'debitIqd' => 0, 'creditIqd' => $totalBatchValueIqd, 'description' => "Manual production cost absorbed ({$batchNumber})"];
                }

                // Only post if lines hit distinct accounts or have >= 2 valid lines
                if (count($jLines) >= 2) {
                    $jrn = $engine->postJournalEntry([
                        'date' => $dateIso,
                        'description' => "Production Batch {$batchNumber}: {$qtyProduced} {$enteredUnit} {$fp['nameKu']}",
                        'referenceType' => 'PRODUCTION',
                        'referenceId' => $batchId,
                        'lines' => $jLines,
                    ]);
                    $journalEntryId = $jrn['id'];
                }
            }

            $batch = [
                'id' => $batchId,
                'batchNumber' => $batchNumber,
                'mode' => $mode,
                'recipeId' => $recipeId,
                'finishedProductId' => $fpId,
                'warehouseId' => $warehouseId,
                'quantityProduced' => ErpEngine::roundQty($qtyProduced),
                'unit' => $enteredUnit,
                'baseQuantityProduced' => $producedBaseQty,
                'baseUnit' => $fp['unit'],
                'materialsUsed' => $preparedMaterials,
                'totalMaterialCostIqd' => $totalMaterialCostIqd,
                'totalBatchValueIqd' => $totalBatchValueIqd,
                'unitCostIqd' => $unitProductionCostIqd,
                'date' => $dateIso,
                'notes' => trim($body['notes'] ?? '') ?: null,
                'status' => 'COMPLETED',
                'journalEntryId' => $journalEntryId,
                'createdAt' => ErpEngine::nowIso(),
            ];
            array_unshift($engine->db['productionBatches'], $batch);
            $engine->logAudit('PRODUCTION_RECORDED', 'PRODUCTION', 'ProductionBatch', $batchId, "Recorded production {$batchNumber}: {$qtyProduced} {$enteredUnit} of {$fp['nameKu']}");
            $resp = ['batch' => $engine->hydrateProductionBatch($batch)];
            $engine->storeIdempotency($body['idempotencyKey'] ?? null, $resp);
            $engine->saveDatabase();
            echo json_encode($resp);
            exit;
        }

        if ($action === 'reverseProduction') {
            $bid = $body['batchId'] ?? '';
            foreach ($engine->db['productionBatches'] as &$b) {
                if ($b['id'] === $bid) {
                    if (($b['status'] ?? '') === 'REVERSED') throw new Exception('Production batch already reversed.');
                    // Deduct finished product back
                    $engine->applyStockChange([
                        'productId' => $b['finishedProductId'],
                        'warehouseId' => $b['warehouseId'],
                        'quantityDelta' => -((float)$b['baseQuantityProduced']),
                        'type' => 'PRODUCTION_REVERSAL',
                        'reason' => "Reversal of {$b['batchNumber']}",
                        'allowNegativeStock' => true,
                    ]);
                    // Restore raw materials
                    foreach ($b['materialsUsed'] ?? [] as $m) {
                        $engine->applyStockChange([
                            'productId' => $m['rawMaterialId'],
                            'warehouseId' => $b['warehouseId'],
                            'quantityDelta' => (float)$m['baseQuantity'],
                            'type' => 'PRODUCTION_REVERSAL',
                            'reason' => "Restore raw materials from {$b['batchNumber']}",
                        ]);
                    }
                    if (!empty($b['journalEntryId'])) {
                        $engine->reverseJournalEntry($b['journalEntryId'], "Reversed production batch {$b['batchNumber']}");
                    }
                    $b['status'] = 'REVERSED';
                    $engine->logAudit('PRODUCTION_REVERSED', 'PRODUCTION', 'ProductionBatch', $bid, "Reversed production {$b['batchNumber']}");
                    $engine->saveDatabase();
                    echo json_encode(['batch' => $engine->hydrateProductionBatch($b)]);
                    exit;
                }
            }
            throw new Exception('Production batch not found.');
        }
    }

    // =========================================================================
    // 6. DEDICATED EMPLOYEES & PAYROLL ENDPOINT
    // =========================================================================
    if ($route === 'employees') {
        if ($method === 'GET') {
            $month = $_GET['month'] ?? ErpEngine::currentMonthStr();
            $employees = array_map(fn($e) => $engine->hydrateEmployee($e, $month), $engine->db['employees']);
            $payments = $engine->db['salaryPayments'];
            if (!empty($_GET['employeeId'])) {
                $eid = $_GET['employeeId'];
                $payments = array_values(array_filter($payments, fn($p) => $p['employeeId'] === $eid));
            }
            $totalPayrollIqd = 0.0;
            $totalPaidIqd = 0.0;
            $totalRemainingIqd = 0.0;
            foreach ($employees as $e) {
                if (($e['status'] ?? 'ACTIVE') === 'ACTIVE') {
                    $totalPayrollIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalPayrollIqd, $e['monthlySalaryIqd'] ?? 0));
                    $totalPaidIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalPaidIqd, $e['paidThisMonthIqd'] ?? 0));
                    $totalRemainingIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalRemainingIqd, $e['remainingSalaryIqd'] ?? 0));
                }
            }
            echo json_encode([
                'month' => $month,
                'employees' => $employees,
                'salaryPayments' => $payments,
                'employeeLeaves' => $engine->db['employeeLeaves'] ?? [],
                'summary' => [
                    'totalEmployees' => count($employees),
                    'activeEmployees' => count(array_filter($employees, fn($e) => ($e['status'] ?? 'ACTIVE') === 'ACTIVE')),
                    'totalPayrollIqd' => $totalPayrollIqd,
                    'totalPaidIqd' => $totalPaidIqd,
                    'totalRemainingIqd' => $totalRemainingIqd,
                ],
            ]);
            exit;
        }

        $action = $body['action'] ?? '';

        if ($action === 'createEmployee') {
            $name = trim($body['name'] ?? '');
            $phone = trim($body['phone'] ?? '');
            if (!$name) throw new Exception('Employee name is required.');
            if (!$phone) throw new Exception('Employee phone number is required.');

            $empStatus = $body['status'] ?? 'ACTIVE';
            $emp = [
                'id' => ErpEngine::cuid('emp_'),
                'code' => sprintf('EMP-%03d', count($engine->db['employees']) + 1),
                'name' => $name,
                'phone' => $phone,
                'position' => trim($body['position'] ?? '') ?: null,
                'monthlySalaryIqd' => ErpEngine::roundIqd($body['monthlySalaryIqd'] ?? 0),
                'startDate' => !empty($body['startDate']) ? trim($body['startDate']) : date('Y-m-d'),
                'status' => in_array($empStatus, ['ACTIVE', 'ON_LEAVE', 'INACTIVE'], true) ? $empStatus : 'ACTIVE',
                'notes' => trim($body['notes'] ?? '') ?: null,
                'createdAt' => ErpEngine::nowIso(),
            ];
            array_unshift($engine->db['employees'], $emp);
            $engine->logAudit('EMPLOYEE_CREATED', 'EMPLOYEES', 'Employee', $emp['id'], "Registered employee {$emp['name']} ({$emp['phone']})");
            $engine->saveDatabase();
            echo json_encode(['employee' => $engine->hydrateEmployee($emp)]);
            exit;
        }

        if ($action === 'updateEmployee') {
            $eid = $body['employeeId'] ?? '';
            foreach ($engine->db['employees'] as &$emp) {
                if ($emp['id'] === $eid) {
                    if (isset($body['name']) && trim($body['name']) !== '') $emp['name'] = trim($body['name']);
                    if (isset($body['phone']) && trim($body['phone']) !== '') $emp['phone'] = trim($body['phone']);
                    if (array_key_exists('position', $body)) $emp['position'] = trim((string)$body['position']) ?: null;
                    if (isset($body['monthlySalaryIqd'])) $emp['monthlySalaryIqd'] = ErpEngine::roundIqd($body['monthlySalaryIqd']);
                    if (array_key_exists('startDate', $body)) $emp['startDate'] = trim((string)$body['startDate']) ?: null;
                    if (isset($body['status']) && in_array($body['status'], ['ACTIVE', 'ON_LEAVE', 'INACTIVE'])) $emp['status'] = $body['status'];
                    if (array_key_exists('notes', $body)) $emp['notes'] = trim((string)$body['notes']) ?: null;
                    $engine->logAudit('EMPLOYEE_UPDATED', 'EMPLOYEES', 'Employee', $eid, "Updated employee {$emp['name']}");
                    $engine->saveDatabase();
                    echo json_encode(['employee' => $engine->hydrateEmployee($emp)]);
                    exit;
                }
            }
            throw new Exception('Employee not found.');
        }

        if ($action === 'deleteEmployee') {
            $eid = $body['employeeId'] ?? '';
            $emp = $engine->findById('employees', $eid);
            if (!$emp) throw new Exception('Employee not found.');
            foreach ($engine->db['salaryPayments'] as $sp) {
                if ($sp['employeeId'] === $eid) {
                    throw new Exception("Cannot delete '{$emp['name']}' because they have salary payment records. Set their status to Inactive instead.");
                }
            }
            $engine->db['employees'] = array_values(array_filter($engine->db['employees'], fn($e) => $e['id'] !== $eid));
            $engine->logAudit('EMPLOYEE_DELETED', 'EMPLOYEES', 'Employee', $eid, "Deleted employee {$emp['name']}");
            $engine->saveDatabase();
            echo json_encode(['deleted' => true]);
            exit;
        }

        if ($action === 'paySalary') {
            $res = $engine->recordSalaryPayment($body);
            $engine->saveDatabase();
            echo json_encode($res);
            exit;
        }

        if ($action === 'recordOffDays') {
            $eid = $body['employeeId'] ?? '';
            $emp = $engine->findById('employees', $eid);
            if (!$emp) throw new Exception('Employee not found.');

            $days = max(0.5, (float)($body['days'] ?? 1));
            $dateStr = !empty($body['date']) ? substr(trim((string)$body['date']), 0, 10) : date('Y-m-d');
            $salaryMonth = !empty($body['salaryMonth']) ? trim((string)$body['salaryMonth']) : substr($dateStr, 0, 7);
            $hasDeduction = !empty($body['hasDeduction']);
            $deductionIqd = $hasDeduction ? max(0.0, ErpEngine::roundIqd($body['deductionIqd'] ?? 0)) : 0.0;
            $reason = trim((string)($body['reason'] ?? ''));

            if (!isset($engine->db['employeeLeaves']) || !is_array($engine->db['employeeLeaves'])) {
                $engine->db['employeeLeaves'] = [];
            }

            $leave = [
                'id' => ErpEngine::cuid('lv_'),
                'employeeId' => $emp['id'],
                'employeeName' => $emp['name'],
                'employeePhone' => $emp['phone'] ?? '',
                'salaryMonth' => $salaryMonth,
                'date' => $dateStr,
                'days' => $days,
                'hasDeduction' => $hasDeduction && $deductionIqd > 0,
                'deductionIqd' => $deductionIqd,
                'reason' => $reason ?: null,
                'createdAt' => ErpEngine::nowIso(),
            ];
            array_unshift($engine->db['employeeLeaves'], $leave);
            $dedText = $leave['hasDeduction'] ? " (deducted " . number_format($deductionIqd) . " IQD)" : " (no deduction)";
            $engine->logAudit('EMPLOYEE_OFF_DAYS', 'EMPLOYEES', 'EmployeeLeave', $leave['id'], "Recorded {$days} off day(s) for {$emp['name']} in {$salaryMonth}{$dedText}");
            $engine->saveDatabase();
            echo json_encode([
                'leave' => $leave,
                'employee' => $engine->hydrateEmployee($emp, $salaryMonth),
            ]);
            exit;
        }

        if ($action === 'deleteOffDays') {
            $lid = $body['leaveId'] ?? '';
            $before = count($engine->db['employeeLeaves'] ?? []);
            $engine->db['employeeLeaves'] = array_values(array_filter(
                $engine->db['employeeLeaves'] ?? [],
                fn($lv) => ($lv['id'] ?? '') !== $lid
            ));
            if (count($engine->db['employeeLeaves']) === $before) {
                throw new Exception('Off-day record not found.');
            }
            $engine->logAudit('EMPLOYEE_OFF_DAYS_DELETED', 'EMPLOYEES', 'EmployeeLeave', $lid, "Removed off-day record {$lid}");
            $engine->saveDatabase();
            echo json_encode(['deleted' => true]);
            exit;
        }
    }

    // =========================================================================
    // 7. SALES & POS ENDPOINT (IQD-NATIVE + UNIT CONVERSION + IDEMPOTENCY)
    // =========================================================================
    if ($route === 'sales') {
        if ($method === 'GET') {
            $invoices = array_map([$engine, 'hydrateSalesInvoice'], $engine->db['salesInvoices']);
            echo json_encode(['invoices' => $invoices]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'createInvoice') {
            $idem = $engine->checkIdempotency($body['idempotencyKey'] ?? null);
            if ($idem) { echo json_encode($idem); exit; }

            $customerId = $body['customerId'] ?? '';
            $cust = $engine->findById('customers', $customerId);
            if (!$cust) throw new Exception('Customer not found.');

            $warehouseId = !empty($body['warehouseId']) ? $body['warehouseId'] : ($engine->db['warehouses'][0]['id'] ?? '');
            $status = $body['status'] ?? 'POSTED';
            $dateIso = ErpEngine::normalizeDateIso($body['date'] ?? null);

            if (empty($body['items']) || !is_array($body['items'])) {
                throw new Exception('Invoice must contain at least one product.');
            }

            $subtotalIqd = 0.0;
            $lineDiscIqd = 0.0;
            $totalCostIqd = 0.0;
            $invId = ErpEngine::cuid('sinv_');
            $preparedItems = [];

            foreach ($body['items'] as $raw) {
                $prod = $engine->findById('products', $raw['productId'] ?? '');
                if (!$prod) throw new Exception('Product not found.');

                $qty = (float)($raw['quantity'] ?? 0);
                if ($qty <= 0) throw new Exception("Quantity for '{$prod['nameKu']}' must be greater than zero.");

                $enteredUnit = !empty($raw['unit']) ? ErpEngine::normalizeUnitCode($raw['unit']) : $prod['unit'];
                $baseQty = $engine->convertQuantity($qty, $enteredUnit, $prod['unit']);

                // Default unitPrice in enteredUnit (e.g., if product is 12,000 IQD/kg and enteredUnit is g, 12 IQD/g)
                if (isset($raw['unitPriceIqd']) || isset($raw['unitPriceOriginal'])) {
                    $priceIqd = (float)($raw['unitPriceIqd'] ?? $raw['unitPriceOriginal']);
                } else {
                    $unitRatio = $engine->convertQuantity(1, $enteredUnit, $prod['unit']);
                    $priceIqd = (float)ErpEngine::decMul($prod['sellingPriceIqd'] ?? 0, $unitRatio, 4);
                }

                $baseCostIqd = ErpEngine::roundIqd($prod['purchaseCostIqd'] ?? 0);
                $discIqd = ErpEngine::roundIqd($raw['discountIqd'] ?? $raw['discountOriginal'] ?? 0);
                $lineGrossIqd = ErpEngine::roundIqd(ErpEngine::decMul($qty, $priceIqd, 6));
                $lineNetIqd = max(0.0, ErpEngine::roundIqd(ErpEngine::decSub($lineGrossIqd, $discIqd)));
                $lineCostTotalIqd = ErpEngine::roundIqd(ErpEngine::decMul($baseQty, $baseCostIqd, 6));

                $subtotalIqd = ErpEngine::roundIqd(ErpEngine::decAdd($subtotalIqd, $lineGrossIqd));
                $lineDiscIqd = ErpEngine::roundIqd(ErpEngine::decAdd($lineDiscIqd, $discIqd));
                $totalCostIqd = ErpEngine::roundIqd(ErpEngine::decAdd($totalCostIqd, $lineCostTotalIqd));

                $preparedItems[] = [
                    'id' => ErpEngine::cuid('sitem_'),
                    'salesInvoiceId' => $invId,
                    'productId' => $prod['id'],
                    'productName' => $prod['nameKu'],
                    'productNameEn' => $prod['nameEn'],
                    'productNameAr' => $prod['nameAr'],
                    'sku' => $prod['sku'],
                    'quantity' => ErpEngine::roundQty($qty),
                    'unit' => $enteredUnit,
                    'baseQuantity' => $baseQty,
                    'baseUnit' => $prod['unit'],
                    'returnedQty' => 0.0,
                    'unitPriceOriginal' => $priceIqd,
                    'unitPriceIqd' => $priceIqd,
                    'unitPriceUsd' => ErpEngine::iqdToUsd($priceIqd, $rate),
                    'unitCostIqd' => $baseCostIqd,
                    'unitCostUsd' => ErpEngine::iqdToUsd($baseCostIqd, $rate),
                    'discountOriginal' => $discIqd,
                    'discountIqd' => $discIqd,
                    'discountUsd' => ErpEngine::iqdToUsd($discIqd, $rate),
                    'taxRate' => 0,
                    'taxOriginal' => 0,
                    'taxIqd' => 0,
                    'taxUsd' => 0,
                    'lineTotalOriginal' => $lineNetIqd,
                    'lineTotalIqd' => $lineNetIqd,
                    'lineTotalUsd' => ErpEngine::iqdToUsd($lineNetIqd, $rate),
                    'lineProfitIqd' => ErpEngine::roundIqd(ErpEngine::decSub($lineNetIqd, $lineCostTotalIqd)),
                    'lineProfitUsd' => ErpEngine::iqdToUsd(ErpEngine::decSub($lineNetIqd, $lineCostTotalIqd), $rate),
                    'invAccountCode' => $engine->getInventoryAccountCodeForProduct($prod),
                ];
            }

            $extraDiscIqd = ErpEngine::roundIqd($body['invoiceDiscountIqd'] ?? $body['invoiceDiscountOriginal'] ?? 0);
            $totalDiscIqd = ErpEngine::roundIqd(ErpEngine::decAdd($lineDiscIqd, $extraDiscIqd));
            $totalIqd = max(0.0, ErpEngine::roundIqd(ErpEngine::decSub($subtotalIqd, $totalDiscIqd)));

            $paymentType = strtoupper($body['paymentType'] ?? 'CASH');
            $paidIqd = $paymentType === 'CASH'
                ? $totalIqd
                : ($paymentType === 'CREDIT' ? 0.0 : ErpEngine::roundIqd($body['paidIqd'] ?? $body['paidOriginal'] ?? 0));
            if ($paidIqd > $totalIqd) {
                throw new Exception('Paid amount cannot exceed invoice total.');
            }
            $dueIqd = max(0.0, ErpEngine::roundIqd(ErpEngine::decSub($totalIqd, $paidIqd)));

            // Validate stock BEFORE modifying anything when posting
            if ($status !== 'DRAFT' && empty($body['allowNegativeStock']) && empty($engine->db['settings']['allowNegativeStock'])) {
                $needed = [];
                foreach ($preparedItems as $pi) {
                    $needed[$pi['productId']] = ErpEngine::roundQty(ErpEngine::decAdd($needed[$pi['productId']] ?? 0, $pi['baseQuantity']));
                }
                foreach ($needed as $pid => $reqQty) {
                    $avail = 0.0;
                    foreach ($engine->db['warehouseStocks'] as $ws) {
                        if ($ws['productId'] === $pid && $ws['warehouseId'] === $warehouseId) {
                            $avail = (float)$ws['quantity'];
                            break;
                        }
                    }
                    if ($avail < $reqQty - 0.0001) {
                        $pObj = $engine->findById('products', $pid);
                        throw new Exception("Insufficient stock for '{$pObj['nameKu']}'. Available: {$avail} {$pObj['unit']}, Requested: {$reqQty} {$pObj['unit']}.");
                    }
                }
            }

            $invPrefix = $engine->db['settings']['salesInvoicePrefix'] ?? 'INV-';
            $invNumber = sprintf('%s%s-%04d', $invPrefix, date('Y'), count($engine->db['salesInvoices']) + 1);
            $finAcc = !empty($body['financialAccountId'])
                ? $engine->findById('financialAccounts', $body['financialAccountId'])
                : $engine->getDefaultFinancialAccount();
            $finAccId = $finAcc['id'] ?? null;

            $grossProfitIqd = ErpEngine::roundIqd(ErpEngine::decSub($totalIqd, $totalCostIqd));

            $invoice = [
                'id' => $invId,
                'invoiceNumber' => $invNumber,
                'customerId' => $customerId,
                'warehouseId' => $warehouseId,
                'date' => $dateIso,
                'dueDate' => $dueIqd > 0 ? gmdate('Y-m-d\TH:i:s.000\Z', strtotime($dateIso) + 30 * 86400) : null,
                'status' => $status === 'DRAFT' ? 'DRAFT' : ($dueIqd == 0 ? 'PAID' : ($paidIqd > 0 ? 'PARTIALLY_PAID' : 'POSTED')),
                'paymentType' => $dueIqd == 0 ? 'CASH' : ($paidIqd == 0 ? 'CREDIT' : 'PARTIAL'),
                'currency' => 'IQD',
                'exchangeRate' => $rate,
                'subtotalOriginal' => $subtotalIqd,
                'discountOriginal' => $totalDiscIqd,
                'taxOriginal' => 0,
                'totalOriginal' => $totalIqd,
                'paidOriginal' => $paidIqd,
                'dueOriginal' => $dueIqd,
                'subtotalIqd' => $subtotalIqd,
                'discountIqd' => $totalDiscIqd,
                'taxIqd' => 0,
                'totalIqd' => $totalIqd,
                'paidIqd' => $paidIqd,
                'dueIqd' => $dueIqd,
                'totalCostIqd' => $totalCostIqd,
                'grossProfitIqd' => $grossProfitIqd,
                'subtotalUsd' => ErpEngine::iqdToUsd($subtotalIqd, $rate),
                'discountUsd' => ErpEngine::iqdToUsd($totalDiscIqd, $rate),
                'taxUsd' => 0,
                'totalUsd' => ErpEngine::iqdToUsd($totalIqd, $rate),
                'paidUsd' => ErpEngine::iqdToUsd($paidIqd, $rate),
                'dueUsd' => ErpEngine::iqdToUsd($dueIqd, $rate),
                'totalCostUsd' => ErpEngine::iqdToUsd($totalCostIqd, $rate),
                'grossProfitUsd' => ErpEngine::iqdToUsd($grossProfitIqd, $rate),
                'financialAccountId' => $finAccId,
                'paymentMethod' => $body['paymentMethod'] ?? 'CASH',
                'notes' => trim($body['notes'] ?? '') ?: null,
                'createdAt' => ErpEngine::nowIso(),
            ];

            foreach ($preparedItems as $pi) {
                $engine->db['salesInvoiceItems'][] = $pi;
            }

            if ($status !== 'DRAFT') {
                foreach ($preparedItems as $pi) {
                    $engine->applyStockChange([
                        'productId' => $pi['productId'],
                        'warehouseId' => $warehouseId,
                        'quantityDelta' => -$pi['baseQuantity'],
                        'enteredQuantity' => -$pi['quantity'],
                        'enteredUnit' => $pi['unit'],
                        'type' => 'SALE_DISPATCH',
                        'unitCostIqd' => $pi['unitCostIqd'],
                        'referenceType' => 'SALES_INVOICE',
                        'referenceId' => $invId,
                        'reason' => "Sales Invoice {$invNumber}",
                        'date' => $dateIso,
                        'allowNegativeStock' => !empty($body['allowNegativeStock']),
                    ]);
                }

                if ($dueIqd > 0) {
                    foreach ($engine->db['customers'] as &$c) {
                        if ($c['id'] === $customerId) {
                            $c['balanceIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($c['balanceIqd'] ?? 0, $dueIqd));
                            $c['balanceUsd'] = ErpEngine::iqdToUsd($c['balanceIqd'], $rate);
                            break;
                        }
                    }
                    unset($c);
                }

                if ($paidIqd > 0 && $finAcc) {
                    $engine->recordFinancialAccountMovement(
                        $finAcc['id'],
                        $paidIqd,
                        'IN',
                        'SALE_RECEIPT',
                        "Sales Invoice {$invNumber} — {$cust['name']}",
                        $dateIso,
                        'SALES',
                        'SALES_INVOICE',
                        $invId
                    );
                }

                $jLines = [];
                if ($paidIqd > 0 && $finAcc) {
                    $jLines[] = ['accountId' => $finAcc['ledgerAccountId'], 'debitIqd' => $paidIqd, 'creditIqd' => 0];
                }
                if ($dueIqd > 0) {
                    $jLines[] = ['accountCode' => '1200', 'debitIqd' => $dueIqd, 'creditIqd' => 0, 'customerId' => $customerId];
                }
                if ($totalDiscIqd > 0) {
                    $jLines[] = ['accountCode' => '4100', 'debitIqd' => $totalDiscIqd, 'creditIqd' => 0];
                }
                if ($subtotalIqd > 0) {
                    $jLines[] = ['accountCode' => '4000', 'debitIqd' => 0, 'creditIqd' => $subtotalIqd];
                }
                if ($totalCostIqd > 0) {
                    $jLines[] = ['accountCode' => '5000', 'debitIqd' => $totalCostIqd, 'creditIqd' => 0];
                    $invCredits = [];
                    foreach ($preparedItems as $pi) {
                        $lineC = ErpEngine::roundIqd(ErpEngine::decMul($pi['baseQuantity'], $pi['unitCostIqd'], 6));
                        $code = $pi['invAccountCode'] ?? '1300';
                        $invCredits[$code] = ErpEngine::roundIqd(ErpEngine::decAdd($invCredits[$code] ?? 0, $lineC));
                    }
                    foreach ($invCredits as $accCode => $amt) {
                        if ($amt > 0) {
                            $jLines[] = ['accountCode' => $accCode, 'debitIqd' => 0, 'creditIqd' => $amt];
                        }
                    }
                }
                if (count($jLines) >= 2) {
                    $jrn = $engine->postJournalEntry([
                        'date' => $dateIso,
                        'description' => "Sales Invoice {$invNumber} — {$cust['name']}",
                        'referenceType' => 'SALE',
                        'referenceId' => $invId,
                        'lines' => $jLines,
                    ]);
                    $invoice['journalEntryId'] = $jrn['id'];
                }
            }

            array_unshift($engine->db['salesInvoices'], $invoice);
            $engine->logAudit('SALE_CREATED', 'SALES', 'SalesInvoice', $invId, "Created Sales Invoice {$invNumber} (" . number_format($totalIqd) . " IQD)");
            $resp = ['invoice' => $engine->hydrateSalesInvoice($invoice)];
            $engine->storeIdempotency($body['idempotencyKey'] ?? null, $resp);
            $engine->saveDatabase();
            echo json_encode($resp);
            exit;
        }

        if ($action === 'postInvoice') {
            $invId = $body['invoiceId'] ?? '';
            foreach ($engine->db['salesInvoices'] as &$inv) {
                if ($inv['id'] === $invId) {
                    if ($inv['status'] !== 'DRAFT') throw new Exception('Only DRAFT invoices can be posted.');
                    $items = array_values(array_filter($engine->db['salesInvoiceItems'], fn($it) => $it['salesInvoiceId'] === $invId));
                    foreach ($items as $pi) {
                        $engine->applyStockChange([
                            'productId' => $pi['productId'],
                            'warehouseId' => $inv['warehouseId'],
                            'quantityDelta' => -((float)($pi['baseQuantity'] ?? $pi['quantity'])),
                            'type' => 'SALE_DISPATCH',
                            'unitCostIqd' => $pi['unitCostIqd'] ?? 0,
                            'referenceType' => 'SALES_INVOICE',
                            'referenceId' => $invId,
                            'reason' => "Sales Invoice {$inv['invoiceNumber']}",
                            'allowNegativeStock' => !empty($body['allowNegativeStock']),
                        ]);
                    }
                    $paidIqd = (float)($inv['paidIqd'] ?? 0);
                    $dueIqd = (float)($inv['dueIqd'] ?? 0);
                    $subtotalIqd = (float)($inv['subtotalIqd'] ?? 0);
                    $discIqd = (float)($inv['discountIqd'] ?? 0);
                    $costIqd = (float)($inv['totalCostIqd'] ?? 0);
                    $finAcc = $engine->findById('financialAccounts', $inv['financialAccountId'] ?? null) ?: $engine->getDefaultFinancialAccount();
                    if ($dueIqd > 0) {
                        foreach ($engine->db['customers'] as &$c) {
                            if ($c['id'] === $inv['customerId']) {
                                $c['balanceIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($c['balanceIqd'] ?? 0, $dueIqd));
                                $c['balanceUsd'] = ErpEngine::iqdToUsd($c['balanceIqd'], $rate);
                                break;
                            }
                        }
                        unset($c);
                    }
                    if ($paidIqd > 0 && $finAcc) {
                        $engine->recordFinancialAccountMovement($finAcc['id'], $paidIqd, 'IN', 'SALE_RECEIPT', "Sales Invoice {$inv['invoiceNumber']}", $inv['date'], 'SALES', 'SALES_INVOICE', $invId);
                    }
                    $jLines = [];
                    if ($paidIqd > 0 && $finAcc) $jLines[] = ['accountId' => $finAcc['ledgerAccountId'], 'debitIqd' => $paidIqd, 'creditIqd' => 0];
                    if ($dueIqd > 0) $jLines[] = ['accountCode' => '1200', 'debitIqd' => $dueIqd, 'creditIqd' => 0];
                    if ($discIqd > 0) $jLines[] = ['accountCode' => '4100', 'debitIqd' => $discIqd, 'creditIqd' => 0];
                    if ($subtotalIqd > 0) $jLines[] = ['accountCode' => '4000', 'debitIqd' => 0, 'creditIqd' => $subtotalIqd];
                    if ($costIqd > 0) {
                        $jLines[] = ['accountCode' => '5000', 'debitIqd' => $costIqd, 'creditIqd' => 0];
                        $jLines[] = ['accountCode' => '1300', 'debitIqd' => 0, 'creditIqd' => $costIqd];
                    }
                    if (count($jLines) >= 2) {
                        $jrn = $engine->postJournalEntry(['description' => "Sales Invoice {$inv['invoiceNumber']}", 'referenceType' => 'SALE', 'referenceId' => $invId, 'lines' => $jLines]);
                        $inv['journalEntryId'] = $jrn['id'];
                    }
                    $inv['status'] = $dueIqd == 0 ? 'PAID' : ($paidIqd > 0 ? 'PARTIALLY_PAID' : 'POSTED');
                    $engine->saveDatabase();
                    echo json_encode(['invoice' => $engine->hydrateSalesInvoice($inv)]);
                    exit;
                }
            }
            throw new Exception('Sales invoice not found.');
        }

        if ($action === 'cancelDraft') {
            foreach ($engine->db['salesInvoices'] as &$inv) {
                if ($inv['id'] === $body['invoiceId']) {
                    $inv['status'] = 'CANCELLED';
                    $engine->saveDatabase();
                    echo json_encode(['invoice' => $inv]);
                    exit;
                }
            }
        }

        if ($action === 'returnInvoice') {
            foreach ($engine->db['salesInvoices'] as &$inv) {
                if ($inv['id'] === $body['invoiceId']) {
                    if ($inv['status'] === 'RETURNED') throw new Exception('Already returned.');
                    foreach ($engine->db['salesInvoiceItems'] as &$it) {
                        if ($it['salesInvoiceId'] === $inv['id']) {
                            $restoreQty = (float)($it['baseQuantity'] ?? $it['quantity']);
                            $engine->applyStockChange([
                                'productId' => $it['productId'],
                                'warehouseId' => $inv['warehouseId'],
                                'quantityDelta' => $restoreQty,
                                'type' => 'SALE_RETURN',
                                'reason' => "Sales Return {$inv['invoiceNumber']}",
                            ]);
                            $it['returnedQty'] = $restoreQty;
                        }
                    }
                    unset($it);
                    $dueIqd = (float)($inv['dueIqd'] ?? 0);
                    $paidIqd = (float)($inv['paidIqd'] ?? 0);
                    if ($dueIqd > 0) {
                        foreach ($engine->db['customers'] as &$c) {
                            if ($c['id'] === $inv['customerId']) {
                                $c['balanceIqd'] = max(0.0, ErpEngine::roundIqd(ErpEngine::decSub($c['balanceIqd'] ?? 0, $dueIqd)));
                                $c['balanceUsd'] = ErpEngine::iqdToUsd($c['balanceIqd'], $rate);
                            }
                        }
                        unset($c);
                    }
                    if ($paidIqd > 0 && !empty($inv['financialAccountId'])) {
                        $engine->recordFinancialAccountMovement($inv['financialAccountId'], $paidIqd, 'OUT', 'SALE_RETURN_REFUND', "Refund for returned invoice {$inv['invoiceNumber']}", null, 'SALES', 'SALES_INVOICE', $inv['id']);
                    }
                    if (!empty($inv['journalEntryId'])) {
                        $engine->reverseJournalEntry($inv['journalEntryId'], $body['reason'] ?? 'Sales return');
                    }
                    $inv['status'] = 'RETURNED';
                    $inv['dueIqd'] = 0;
                    $inv['dueOriginal'] = 0;
                    $inv['dueUsd'] = 0;
                    $engine->saveDatabase();
                    echo json_encode(['invoice' => $engine->hydrateSalesInvoice($inv)]);
                    exit;
                }
            }
        }
    }

    // =========================================================================
    // 8. PURCHASES ENDPOINT (IQD-NATIVE + UNIT CONVERSION + WEIGHTED AVG COST)
    // =========================================================================
    if ($route === 'purchases') {
        if ($method === 'GET') {
            $invoices = array_map([$engine, 'hydratePurchaseInvoice'], $engine->db['purchaseInvoices']);
            echo json_encode(['invoices' => $invoices]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'createInvoice') {
            $idem = $engine->checkIdempotency($body['idempotencyKey'] ?? null);
            if ($idem) { echo json_encode($idem); exit; }

            $supplierId = $body['supplierId'] ?? '';
            $supp = $engine->findById('suppliers', $supplierId);
            if (!$supp) throw new Exception('Supplier not found.');

            $warehouseId = !empty($body['warehouseId']) ? $body['warehouseId'] : ($engine->db['warehouses'][0]['id'] ?? '');
            $status = $body['status'] ?? 'POSTED';
            $dateIso = ErpEngine::normalizeDateIso($body['date'] ?? null);

            if (empty($body['items']) || !is_array($body['items'])) {
                throw new Exception('Purchase invoice must contain at least one product.');
            }

            $subtotalIqd = 0.0;
            $invId = ErpEngine::cuid('pinv_');
            $preparedItems = [];

            foreach ($body['items'] as $raw) {
                $prod = $engine->findById('products', $raw['productId'] ?? '');
                if (!$prod) throw new Exception('Product not found.');

                $qty = (float)($raw['quantity'] ?? 0);
                if ($qty <= 0) throw new Exception("Quantity for '{$prod['nameKu']}' must be greater than zero.");

                $enteredUnit = !empty($raw['unit']) ? ErpEngine::normalizeUnitCode($raw['unit']) : $prod['unit'];
                $baseQty = $engine->convertQuantity($qty, $enteredUnit, $prod['unit']);

                $costPerEnteredUnitIqd = (float)($raw['unitCostIqd'] ?? $raw['unitCostOriginal'] ?? 0);
                $lineTotalIqd = ErpEngine::roundIqd(ErpEngine::decMul($qty, $costPerEnteredUnitIqd, 6));
                $baseUnitCostIqd = $baseQty > 0 ? ErpEngine::roundIqd(ErpEngine::decDiv($lineTotalIqd, $baseQty, 6)) : 0.0;
                $subtotalIqd = ErpEngine::roundIqd(ErpEngine::decAdd($subtotalIqd, $lineTotalIqd));

                $preparedItems[] = [
                    'id' => ErpEngine::cuid('pitem_'),
                    'purchaseInvoiceId' => $invId,
                    'productId' => $prod['id'],
                    'productName' => $prod['nameKu'],
                    'productNameEn' => $prod['nameEn'],
                    'productNameAr' => $prod['nameAr'],
                    'sku' => $prod['sku'],
                    'quantity' => ErpEngine::roundQty($qty),
                    'unit' => $enteredUnit,
                    'baseQuantity' => $baseQty,
                    'baseUnit' => $prod['unit'],
                    'returnedQty' => 0.0,
                    'unitCostOriginal' => $costPerEnteredUnitIqd,
                    'unitCostIqd' => $costPerEnteredUnitIqd,
                    'baseUnitCostIqd' => $baseUnitCostIqd,
                    'unitCostUsd' => ErpEngine::iqdToUsd($baseUnitCostIqd, $rate),
                    'discountOriginal' => 0,
                    'discountIqd' => 0,
                    'discountUsd' => 0,
                    'lineTotalOriginal' => $lineTotalIqd,
                    'lineTotalIqd' => $lineTotalIqd,
                    'lineTotalUsd' => ErpEngine::iqdToUsd($lineTotalIqd, $rate),
                    'invAccountCode' => $engine->getInventoryAccountCodeForProduct($prod),
                ];
            }

            $discIqd = ErpEngine::roundIqd($body['invoiceDiscountIqd'] ?? $body['invoiceDiscountOriginal'] ?? 0);
            $shipIqd = ErpEngine::roundIqd($body['shippingIqd'] ?? $body['shippingOriginal'] ?? 0);
            $totalIqd = max(0.0, ErpEngine::roundIqd(ErpEngine::decAdd(ErpEngine::decSub($subtotalIqd, $discIqd), $shipIqd)));

            $paymentType = strtoupper($body['paymentType'] ?? 'CASH');
            $paidIqd = $paymentType === 'CASH'
                ? $totalIqd
                : ($paymentType === 'CREDIT' ? 0.0 : ErpEngine::roundIqd($body['paidIqd'] ?? $body['paidOriginal'] ?? 0));
            if ($paidIqd > $totalIqd) throw new Exception('Paid amount cannot exceed purchase total.');
            $dueIqd = max(0.0, ErpEngine::roundIqd(ErpEngine::decSub($totalIqd, $paidIqd)));

            $purPrefix = $engine->db['settings']['purchaseInvoicePrefix'] ?? 'PUR-';
            $invNumber = sprintf('%s%s-%04d', $purPrefix, date('Y'), count($engine->db['purchaseInvoices']) + 1);
            $finAcc = !empty($body['financialAccountId'])
                ? $engine->findById('financialAccounts', $body['financialAccountId'])
                : $engine->getDefaultFinancialAccount();
            $finAccId = $finAcc['id'] ?? null;

            $invoice = [
                'id' => $invId,
                'invoiceNumber' => $invNumber,
                'supplierInvoiceRef' => !empty($body['supplierInvoiceRef']) ? trim($body['supplierInvoiceRef']) : null,
                'supplierId' => $supplierId,
                'warehouseId' => $warehouseId,
                'date' => $dateIso,
                'dueDate' => $dueIqd > 0 ? gmdate('Y-m-d\TH:i:s.000\Z', strtotime($dateIso) + 30 * 86400) : null,
                'status' => $status === 'DRAFT' ? 'DRAFT' : ($dueIqd == 0 ? 'PAID' : ($paidIqd > 0 ? 'PARTIALLY_PAID' : 'POSTED')),
                'paymentType' => $dueIqd == 0 ? 'CASH' : ($paidIqd == 0 ? 'CREDIT' : 'PARTIAL'),
                'currency' => 'IQD',
                'exchangeRate' => $rate,
                'subtotalOriginal' => $subtotalIqd,
                'discountOriginal' => $discIqd,
                'taxOriginal' => 0,
                'shippingOriginal' => $shipIqd,
                'totalOriginal' => $totalIqd,
                'paidOriginal' => $paidIqd,
                'dueOriginal' => $dueIqd,
                'subtotalIqd' => $subtotalIqd,
                'discountIqd' => $discIqd,
                'shippingIqd' => $shipIqd,
                'totalIqd' => $totalIqd,
                'paidIqd' => $paidIqd,
                'dueIqd' => $dueIqd,
                'subtotalUsd' => ErpEngine::iqdToUsd($subtotalIqd, $rate),
                'discountUsd' => ErpEngine::iqdToUsd($discIqd, $rate),
                'taxUsd' => 0,
                'shippingUsd' => ErpEngine::iqdToUsd($shipIqd, $rate),
                'totalUsd' => ErpEngine::iqdToUsd($totalIqd, $rate),
                'paidUsd' => ErpEngine::iqdToUsd($paidIqd, $rate),
                'dueUsd' => ErpEngine::iqdToUsd($dueIqd, $rate),
                'financialAccountId' => $finAccId,
                'notes' => trim($body['notes'] ?? '') ?: null,
                'createdAt' => ErpEngine::nowIso(),
            ];

            foreach ($preparedItems as $pi) {
                $engine->db['purchaseInvoiceItems'][] = $pi;
            }

            if ($status !== 'DRAFT') {
                foreach ($preparedItems as $pi) {
                    // Weighted average cost update in IQD
                    foreach ($engine->db['products'] as &$pRef) {
                        if ($pRef['id'] === $pi['productId']) {
                            $existingQty = max(0.0, (float)($pRef['totalStock'] ?? 0));
                            $existingCost = (float)($pRef['purchaseCostIqd'] ?? 0);
                            $inQty = (float)$pi['baseQuantity'];
                            $inCost = (float)$pi['baseUnitCostIqd'];
                            $newQty = ErpEngine::decAdd($existingQty, $inQty, 6);
                            if ((float)$newQty > 0 && $inCost > 0) {
                                $weighted = ErpEngine::decDiv(
                                    ErpEngine::decAdd(ErpEngine::decMul($existingQty, $existingCost, 6), ErpEngine::decMul($inQty, $inCost, 6), 6),
                                    $newQty,
                                    6
                                );
                                $pRef['purchaseCostIqd'] = ErpEngine::roundIqd($weighted);
                                $pRef['purchaseCostUsd'] = ErpEngine::iqdToUsd($pRef['purchaseCostIqd'], $rate);
                            }
                            break;
                        }
                    }
                    unset($pRef);

                    $engine->applyStockChange([
                        'productId' => $pi['productId'],
                        'warehouseId' => $warehouseId,
                        'quantityDelta' => $pi['baseQuantity'],
                        'enteredQuantity' => $pi['quantity'],
                        'enteredUnit' => $pi['unit'],
                        'type' => 'PURCHASE_RECEIPT',
                        'unitCostIqd' => $pi['baseUnitCostIqd'],
                        'referenceType' => 'PURCHASE_INVOICE',
                        'referenceId' => $invId,
                        'reason' => "Purchase Invoice {$invNumber}",
                        'date' => $dateIso,
                    ]);
                }

                if ($dueIqd > 0) {
                    foreach ($engine->db['suppliers'] as &$s) {
                        if ($s['id'] === $supplierId) {
                            $s['balanceIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($s['balanceIqd'] ?? 0, $dueIqd));
                            $s['balanceUsd'] = ErpEngine::iqdToUsd($s['balanceIqd'], $rate);
                            break;
                        }
                    }
                    unset($s);
                }

                if ($paidIqd > 0 && $finAcc) {
                    $engine->recordFinancialAccountMovement(
                        $finAcc['id'],
                        $paidIqd,
                        'OUT',
                        'PURCHASE_PAYMENT',
                        "Purchase Invoice {$invNumber} — {$supp['name']}",
                        $dateIso,
                        'PURCHASES',
                        'PURCHASE_INVOICE',
                        $invId
                    );
                }

                // Group inventory debits by inventory account code (Raw Materials 1310 / Finished 1320 / General 1300)
                $invDebits = [];
                $sumLineTotals = 0.0;
                foreach ($preparedItems as $pi) {
                    $code = $pi['invAccountCode'] ?? '1300';
                    $invDebits[$code] = ErpEngine::roundIqd(ErpEngine::decAdd($invDebits[$code] ?? 0, $pi['lineTotalIqd']));
                    $sumLineTotals = ErpEngine::roundIqd(ErpEngine::decAdd($sumLineTotals, $pi['lineTotalIqd']));
                }
                // Adjust first inventory bucket for net shipping/discount so debit === totalIqd
                $diffAdj = ErpEngine::roundIqd(ErpEngine::decSub($totalIqd, $sumLineTotals));
                if ($diffAdj != 0 && !empty($invDebits)) {
                    $firstCode = array_key_first($invDebits);
                    $invDebits[$firstCode] = max(0.0, ErpEngine::roundIqd(ErpEngine::decAdd($invDebits[$firstCode], $diffAdj)));
                }

                $jLines = [];
                foreach ($invDebits as $accCode => $amt) {
                    if ($amt > 0) {
                        $jLines[] = ['accountCode' => $accCode, 'debitIqd' => $amt, 'creditIqd' => 0];
                    }
                }
                if ($paidIqd > 0 && $finAcc) {
                    $jLines[] = ['accountId' => $finAcc['ledgerAccountId'], 'debitIqd' => 0, 'creditIqd' => $paidIqd];
                }
                if ($dueIqd > 0) {
                    $jLines[] = ['accountCode' => '2100', 'debitIqd' => 0, 'creditIqd' => $dueIqd, 'supplierId' => $supplierId];
                }
                if (count($jLines) >= 2) {
                    $jrn = $engine->postJournalEntry([
                        'date' => $dateIso,
                        'description' => "Purchase Invoice {$invNumber} — {$supp['name']}",
                        'referenceType' => 'PURCHASE',
                        'referenceId' => $invId,
                        'lines' => $jLines,
                    ]);
                    $invoice['journalEntryId'] = $jrn['id'];
                }
            }

            array_unshift($engine->db['purchaseInvoices'], $invoice);
            $engine->logAudit('PURCHASE_CREATED', 'PURCHASES', 'PurchaseInvoice', $invId, "Created Purchase Invoice {$invNumber} (" . number_format($totalIqd) . " IQD)");
            $resp = ['invoice' => $engine->hydratePurchaseInvoice($invoice)];
            $engine->storeIdempotency($body['idempotencyKey'] ?? null, $resp);
            $engine->saveDatabase();
            echo json_encode($resp);
            exit;
        }

        if ($action === 'returnInvoice') {
            foreach ($engine->db['purchaseInvoices'] as &$inv) {
                if ($inv['id'] === $body['invoiceId']) {
                    if ($inv['status'] === 'RETURNED') throw new Exception('Already returned.');
                    foreach ($engine->db['purchaseInvoiceItems'] as &$it) {
                        if ($it['purchaseInvoiceId'] === $inv['id']) {
                            $retQty = (float)($it['baseQuantity'] ?? $it['quantity']);
                            $engine->applyStockChange([
                                'productId' => $it['productId'],
                                'warehouseId' => $inv['warehouseId'],
                                'quantityDelta' => -$retQty,
                                'type' => 'PURCHASE_RETURN',
                                'reason' => "Purchase Return {$inv['invoiceNumber']}",
                                'allowNegativeStock' => true,
                            ]);
                            $it['returnedQty'] = $retQty;
                        }
                    }
                    unset($it);
                    $dueIqd = (float)($inv['dueIqd'] ?? 0);
                    $paidIqd = (float)($inv['paidIqd'] ?? 0);
                    if ($dueIqd > 0) {
                        foreach ($engine->db['suppliers'] as &$s) {
                            if ($s['id'] === $inv['supplierId']) {
                                $s['balanceIqd'] = max(0.0, ErpEngine::roundIqd(ErpEngine::decSub($s['balanceIqd'] ?? 0, $dueIqd)));
                                $s['balanceUsd'] = ErpEngine::iqdToUsd($s['balanceIqd'], $rate);
                            }
                        }
                        unset($s);
                    }
                    if ($paidIqd > 0 && !empty($inv['financialAccountId'])) {
                        $engine->recordFinancialAccountMovement($inv['financialAccountId'], $paidIqd, 'IN', 'PURCHASE_RETURN_REFUND', "Refund from returned purchase {$inv['invoiceNumber']}", null, 'PURCHASES', 'PURCHASE_INVOICE', $inv['id']);
                    }
                    if (!empty($inv['journalEntryId'])) {
                        $engine->reverseJournalEntry($inv['journalEntryId'], $body['reason'] ?? 'Purchase return');
                    }
                    $inv['status'] = 'RETURNED';
                    $inv['dueIqd'] = 0;
                    $inv['dueOriginal'] = 0;
                    $inv['dueUsd'] = 0;
                    $engine->saveDatabase();
                    echo json_encode(['invoice' => $engine->hydratePurchaseInvoice($inv)]);
                    exit;
                }
            }
        }
    }

    // =========================================================================
    // 9. EXPENSES ENDPOINT (SIMPLIFIED IQD-ONLY + INTEGRATED SALARY PAYMENTS)
    // =========================================================================
    if ($route === 'expenses') {
        if ($method === 'GET') {
            $list = array_map([$engine, 'hydrateExpense'], $engine->db['expenses']);
            $curMonth = ErpEngine::currentMonthStr();
            $employees = array_map(fn($e) => $engine->hydrateEmployee($e, $curMonth), $engine->db['employees']);
            echo json_encode([
                'expenses' => $list,
                'expenseCategories' => $engine->db['expenseCategories'],
                'employees' => $employees,
            ]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'createExpense') {
            $categoryCode = strtoupper(trim($body['category'] ?? 'OTHER'));

            // Unified salary payment flow directly inside Expenses! (Zero double-counting)
            if ($categoryCode === 'SALARIES' && !empty($body['employeeId'])) {
                $res = $engine->recordSalaryPayment($body);
                $engine->saveDatabase();
                echo json_encode($res);
                exit;
            }

            $idem = $engine->checkIdempotency($body['idempotencyKey'] ?? null);
            if ($idem) { echo json_encode($idem); exit; }

            $amtIqd = ErpEngine::roundIqd($body['amountIqd'] ?? $body['amountOriginal'] ?? 0);
            if ($amtIqd <= 0) throw new Exception('Expense amount must be greater than zero.');

            $dateIso = ErpEngine::normalizeDateIso($body['date'] ?? null);

            // Resolve expense category & GL account
            $catObj = null;
            foreach ($engine->db['expenseCategories'] as $ec) {
                if (strtoupper($ec['code']) === $categoryCode) {
                    $catObj = $ec;
                    break;
                }
            }
            $legacyMap = [
                'SALARIES' => '5110', 'RENT' => '5120', 'ELECTRICITY' => '5130',
                'WATER' => '5132', 'GAS' => '5134', 'TRANSPORTATION' => '5140',
                'RAW_MATERIALS' => '5145', 'MAINTENANCE' => '5150', 'MARKETING' => '5160',
                'COMMUNICATION' => '5170', 'OFFICE_SUPPLIES' => '5180',
                'MISCELLANEOUS' => '5190', 'OTHER' => '5190',
            ];
            $accCode = $catObj['accountCode'] ?? ($legacyMap[$categoryCode] ?? '5190');
            $expAcc = $engine->findAccountByCodeOrId($accCode, null) ?: $engine->findAccountByCodeOrId('5190', null);

            $notes = trim($body['notes'] ?? $body['description'] ?? '');
            $title = trim($body['title'] ?? '');
            if (!$title) {
                $catLabel = $catObj['nameKu'] ?? $categoryCode;
                $title = $notes ? "{$catLabel} — {$notes}" : $catLabel;
            }

            $paymentMethod = strtoupper($body['paymentMethod'] ?? 'CASH');
            $finAcc = !empty($body['financialAccountId'])
                ? $engine->findById('financialAccounts', $body['financialAccountId'])
                : $engine->getDefaultFinancialAccount();
            $finAccId = $paymentMethod === 'CREDIT' ? null : ($finAcc['id'] ?? null);

            $user = $engine->getCurrentUser();
            $isTopAdmin = in_array($user['role'] ?? 'SUPER_ADMIN', ['SUPER_ADMIN', 'BUSINESS_OWNER']);
            $thresholdIqd = (float)($engine->db['settings']['expenseApprovalThresholdIqd'] ?? 0);
            $needsApproval = !$isTopAdmin && empty($body['bypassApproval']) && $thresholdIqd > 0 && $amtIqd >= $thresholdIqd;

            $expId = ErpEngine::cuid('exp_');
            $expPrefix = $engine->db['settings']['expensePrefix'] ?? 'EXP-';
            $expNum = sprintf('%s%s-%04d', $expPrefix, date('Y'), count($engine->db['expenses']) + 1);

            $exp = [
                'id' => $expId,
                'expenseNumber' => $expNum,
                'date' => $dateIso,
                'category' => $categoryCode,
                'title' => $title,
                'description' => $notes ?: null,
                'vendorName' => trim($body['vendorName'] ?? '') ?: null,
                'expenseAccountId' => $expAcc['id'],
                'financialAccountId' => $finAccId,
                'supplierId' => $paymentMethod === 'CREDIT' ? ($body['supplierId'] ?? null) : null,
                'paymentMethod' => $paymentMethod,
                'currency' => 'IQD',
                'exchangeRate' => $rate,
                'amountOriginal' => $amtIqd,
                'amountIqd' => $amtIqd,
                'amountUsd' => ErpEngine::iqdToUsd($amtIqd, $rate),
                'isRecurring' => !empty($body['isRecurring']),
                'recurringInterval' => !empty($body['isRecurring']) ? ($body['recurringInterval'] ?? 'MONTHLY') : null,
                'status' => $needsApproval ? 'PENDING_APPROVAL' : 'POSTED',
                'attachmentName' => trim($body['attachmentName'] ?? '') ?: null,
                'createdAt' => ErpEngine::nowIso(),
            ];

            if (!$needsApproval) {
                if ($paymentMethod === 'CREDIT') {
                    $creditCode = !empty($exp['supplierId']) ? '2100' : '2300';
                    if (!empty($exp['supplierId'])) {
                        foreach ($engine->db['suppliers'] as &$s) {
                            if ($s['id'] === $exp['supplierId']) {
                                $s['balanceIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($s['balanceIqd'] ?? 0, $amtIqd));
                                $s['balanceUsd'] = ErpEngine::iqdToUsd($s['balanceIqd'], $rate);
                                break;
                            }
                        }
                        unset($s);
                    }
                    $jrn = $engine->postJournalEntry([
                        'date' => $dateIso,
                        'description' => "Expense {$expNum}: {$title}",
                        'referenceType' => 'EXPENSE',
                        'referenceId' => $expId,
                        'lines' => [
                            ['accountId' => $expAcc['id'], 'debitIqd' => $amtIqd, 'creditIqd' => 0],
                            ['accountCode' => $creditCode, 'debitIqd' => 0, 'creditIqd' => $amtIqd],
                        ],
                    ]);
                    $exp['journalEntryId'] = $jrn['id'];
                } elseif ($finAcc) {
                    $engine->recordFinancialAccountMovement(
                        $finAcc['id'],
                        $amtIqd,
                        'OUT',
                        'EXPENSE_PAYMENT',
                        "Expense {$expNum}: {$title}",
                        $dateIso,
                        $categoryCode,
                        'EXPENSE',
                        $expId
                    );
                    $jrn = $engine->postJournalEntry([
                        'date' => $dateIso,
                        'description' => "Expense {$expNum}: {$title}",
                        'referenceType' => 'EXPENSE',
                        'referenceId' => $expId,
                        'lines' => [
                            ['accountId' => $expAcc['id'], 'debitIqd' => $amtIqd, 'creditIqd' => 0],
                            ['accountId' => $finAcc['ledgerAccountId'], 'debitIqd' => 0, 'creditIqd' => $amtIqd],
                        ],
                    ]);
                    $exp['journalEntryId'] = $jrn['id'];
                }
            }

            array_unshift($engine->db['expenses'], $exp);
            $engine->logAudit('EXPENSE_CREATED', 'EXPENSES', 'Expense', $expId, "Recorded expense {$expNum}: {$title} (" . number_format($amtIqd) . " IQD)");
            $resp = ['expense' => $engine->hydrateExpense($exp)];
            $engine->storeIdempotency($body['idempotencyKey'] ?? null, $resp);
            $engine->saveDatabase();
            echo json_encode($resp);
            exit;
        }

        if ($action === 'createExpenseCategory') {
            $nameKu = trim($body['nameKu'] ?? $body['name'] ?? '');
            $nameAr = trim($body['nameAr'] ?? '') ?: $nameKu;
            $nameEn = trim($body['nameEn'] ?? '') ?: $nameKu;
            if (!$nameKu) throw new Exception('Category name is required.');

            $code = strtoupper(preg_replace('/[^A-Za-z0-9_]+/', '_', $body['code'] ?? $nameEn));
            $code = trim($code, '_') ?: ('EXP_CAT_' . rand(100, 999));
            foreach ($engine->db['expenseCategories'] as $ec) {
                if (strtoupper($ec['code']) === $code) {
                    $code .= '_' . rand(10, 99);
                    break;
                }
            }

            $cat = [
                'id' => ErpEngine::cuid('ecat_'),
                'code' => $code,
                'nameKu' => $nameKu,
                'nameAr' => $nameAr,
                'nameEn' => $nameEn,
                'accountCode' => '5190',
                'isSalary' => false,
                'isSystem' => false,
            ];
            $engine->db['expenseCategories'][] = $cat;
            $engine->logAudit('EXPENSE_CATEGORY_CREATED', 'EXPENSES', 'ExpenseCategory', $cat['id'], "Created expense category {$cat['nameKu']}");
            $engine->saveDatabase();
            echo json_encode(['category' => $cat]);
            exit;
        }

        if ($action === 'approveExpense' || $action === 'rejectExpense') {
            foreach ($engine->db['expenses'] as &$e) {
                if ($e['id'] === $body['expenseId']) {
                    if ($e['status'] !== 'PENDING_APPROVAL') throw new Exception('Expense is not awaiting approval.');
                    if ($action === 'rejectExpense') {
                        $e['status'] = 'REJECTED';
                    } else {
                        $e['status'] = 'POSTED';
                        $amtIqd = ErpEngine::roundIqd($e['amountIqd'] ?? 0);
                        $finAcc = $engine->findById('financialAccounts', $e['financialAccountId'] ?? null) ?: $engine->getDefaultFinancialAccount();
                        if ($finAcc) {
                            $engine->recordFinancialAccountMovement($finAcc['id'], $amtIqd, 'OUT', 'EXPENSE_PAYMENT', "Approved Expense {$e['expenseNumber']}: {$e['title']}", $e['date'], $e['category'], 'EXPENSE', $e['id']);
                            $jrn = $engine->postJournalEntry([
                                'date' => $e['date'],
                                'description' => "Approved Expense {$e['expenseNumber']}: {$e['title']}",
                                'referenceType' => 'EXPENSE',
                                'referenceId' => $e['id'],
                                'lines' => [
                                    ['accountId' => $e['expenseAccountId'], 'debitIqd' => $amtIqd, 'creditIqd' => 0],
                                    ['accountId' => $finAcc['ledgerAccountId'], 'debitIqd' => 0, 'creditIqd' => $amtIqd],
                                ],
                            ]);
                            $e['journalEntryId'] = $jrn['id'];
                        }
                    }
                    $engine->saveDatabase();
                    echo json_encode(['expense' => $engine->hydrateExpense($e)]);
                    exit;
                }
            }
        }
    }

    // =========================================================================
    // 10. PARTIES (CUSTOMERS, SUPPLIERS, DEBTORS, CREDITORS) ENDPOINT
    // =========================================================================
    if ($route === 'parties') {
        if ($method === 'GET') {
            if (!empty($_GET['statementCustomerId'])) {
                $cid = $_GET['statementCustomerId'];
                $cust = $engine->findById('customers', $cid);
                if (!$cust) throw new Exception('Customer not found.');
                $events = [];
                $openIqd = (float)($cust['openingBalanceIqd'] ?? 0);
                if ($openIqd > 0) {
                    $events[] = ['date' => $cust['createdAt'] ?? '2025-01-01', 'reference' => 'OPEN', 'description' => 'Opening Balance', 'debitIqd' => $openIqd, 'creditIqd' => 0];
                }
                foreach ($engine->db['salesInvoices'] as $inv) {
                    if ($inv['customerId'] === $cid && in_array($inv['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) {
                        $events[] = [
                            'date' => $inv['date'],
                            'reference' => $inv['invoiceNumber'],
                            'description' => "Sales Invoice ({$inv['paymentType']})",
                            'debitIqd' => (float)($inv['totalIqd'] ?? 0),
                            'creditIqd' => (float)($inv['paidIqd'] ?? 0),
                        ];
                    }
                }
                foreach ($engine->db['debtPayments'] as $dp) {
                    if (($dp['customerId'] ?? '') === $cid && $dp['type'] === 'DEBTOR_COLLECTION') {
                        $events[] = [
                            'date' => $dp['date'],
                            'reference' => $dp['paymentNumber'],
                            'description' => 'Debt Collection' . (!empty($dp['notes']) ? " — {$dp['notes']}" : ''),
                            'debitIqd' => 0,
                            'creditIqd' => (float)($dp['amountIqd'] ?? 0),
                        ];
                    }
                }
                usort($events, fn($a, $b) => strcmp($a['date'], $b['date']));
                $lines = [];
                $running = 0.0;
                foreach ($events as $ev) {
                    $running = ErpEngine::roundIqd(ErpEngine::decSub(ErpEngine::decAdd($running, $ev['debitIqd']), $ev['creditIqd']));
                    $ev['runningBalanceIqd'] = $running;
                    $lines[] = $ev;
                }
                echo json_encode([
                    'statement' => [
                        'customer' => $cust,
                        'lines' => $lines,
                        'closingBalanceIqd' => (float)($cust['balanceIqd'] ?? 0),
                    ],
                ]);
                exit;
            }

            if (!empty($_GET['statementSupplierId'])) {
                $sid = $_GET['statementSupplierId'];
                $supp = $engine->findById('suppliers', $sid);
                if (!$supp) throw new Exception('Supplier not found.');
                $events = [];
                $openIqd = (float)($supp['openingBalanceIqd'] ?? 0);
                if ($openIqd > 0) {
                    $events[] = ['date' => $supp['createdAt'] ?? '2025-01-01', 'reference' => 'OPEN', 'description' => 'Opening Balance', 'debitIqd' => 0, 'creditIqd' => $openIqd];
                }
                foreach ($engine->db['purchaseInvoices'] as $inv) {
                    if ($inv['supplierId'] === $sid && in_array($inv['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) {
                        $events[] = [
                            'date' => $inv['date'],
                            'reference' => $inv['invoiceNumber'],
                            'description' => "Purchase Invoice ({$inv['paymentType']})",
                            'debitIqd' => (float)($inv['paidIqd'] ?? 0),
                            'creditIqd' => (float)($inv['totalIqd'] ?? 0),
                        ];
                    }
                }
                foreach ($engine->db['debtPayments'] as $dp) {
                    if (($dp['supplierId'] ?? '') === $sid && $dp['type'] === 'CREDITOR_PAYMENT') {
                        $events[] = [
                            'date' => $dp['date'],
                            'reference' => $dp['paymentNumber'],
                            'description' => 'Supplier Payment' . (!empty($dp['notes']) ? " — {$dp['notes']}" : ''),
                            'debitIqd' => (float)($dp['amountIqd'] ?? 0),
                            'creditIqd' => 0,
                        ];
                    }
                }
                usort($events, fn($a, $b) => strcmp($a['date'], $b['date']));
                $lines = [];
                $running = 0.0;
                foreach ($events as $ev) {
                    $running = ErpEngine::roundIqd(ErpEngine::decSub(ErpEngine::decAdd($running, $ev['creditIqd']), $ev['debitIqd']));
                    $ev['runningBalanceIqd'] = $running;
                    $lines[] = $ev;
                }
                echo json_encode([
                    'statement' => [
                        'supplier' => $supp,
                        'lines' => $lines,
                        'closingBalanceIqd' => (float)($supp['balanceIqd'] ?? 0),
                    ],
                ]);
                exit;
            }

            $unpaidSales = [];
            foreach ($engine->db['salesInvoices'] as $s) {
                if (in_array($s['status'], ['POSTED', 'PARTIALLY_PAID']) && (float)($s['dueIqd'] ?? 0) > 0) {
                    $s['customer'] = $engine->findById('customers', $s['customerId']);
                    $unpaidSales[] = $s;
                }
            }
            $unpaidPurchases = [];
            foreach ($engine->db['purchaseInvoices'] as $p) {
                if (in_array($p['status'], ['POSTED', 'PARTIALLY_PAID']) && (float)($p['dueIqd'] ?? 0) > 0) {
                    $p['supplier'] = $engine->findById('suppliers', $p['supplierId']);
                    $unpaidPurchases[] = $p;
                }
            }
            $payments = [];
            foreach ($engine->db['debtPayments'] as $dp) {
                $dp['customer'] = $engine->findById('customers', $dp['customerId'] ?? null);
                $dp['supplier'] = $engine->findById('suppliers', $dp['supplierId'] ?? null);
                $payments[] = $dp;
            }

            echo json_encode([
                'customers' => $engine->db['customers'],
                'suppliers' => $engine->db['suppliers'],
                'debtPayments' => $payments,
                'unpaidSalesInvoices' => $unpaidSales,
                'unpaidPurchaseInvoices' => $unpaidPurchases,
            ]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'createCustomer') {
            $name = trim($body['name'] ?? '');
            if (!$name) throw new Exception('Customer name is required.');
            $openIqd = ErpEngine::roundIqd($body['openingBalanceIqd'] ?? 0);
            $limitIqd = ErpEngine::roundIqd($body['creditLimitIqd'] ?? 15000000);
            $c = [
                'id' => ErpEngine::cuid('cus_'),
                'code' => sprintf('CUST-%03d', count($engine->db['customers']) + 1),
                'name' => $name,
                'companyName' => trim($body['companyName'] ?? '') ?: null,
                'phone' => trim($body['phone'] ?? ''),
                'email' => trim($body['email'] ?? '') ?: null,
                'city' => trim($body['city'] ?? '') ?: 'هەولێر',
                'creditLimitIqd' => $limitIqd,
                'creditLimitUsd' => ErpEngine::iqdToUsd($limitIqd, $rate),
                'balanceIqd' => $openIqd,
                'balanceUsd' => ErpEngine::iqdToUsd($openIqd, $rate),
                'openingBalanceIqd' => $openIqd,
                'openingBalanceUsd' => ErpEngine::iqdToUsd($openIqd, $rate),
                'isActive' => true,
                'createdAt' => ErpEngine::nowIso(),
            ];
            array_unshift($engine->db['customers'], $c);
            if ($openIqd > 0) {
                $engine->postJournalEntry([
                    'description' => "Opening receivable balance for {$c['name']}",
                    'referenceType' => 'MANUAL',
                    'lines' => [
                        ['accountCode' => '1200', 'debitIqd' => $openIqd, 'creditIqd' => 0],
                        ['accountCode' => '3000', 'debitIqd' => 0, 'creditIqd' => $openIqd],
                    ],
                ]);
            }
            $engine->saveDatabase();
            echo json_encode(['customer' => $c]);
            exit;
        }

        if ($action === 'createSupplier') {
            $name = trim($body['name'] ?? '');
            if (!$name) throw new Exception('Supplier name is required.');
            $openIqd = ErpEngine::roundIqd($body['openingBalanceIqd'] ?? 0);
            $s = [
                'id' => ErpEngine::cuid('sup_'),
                'code' => sprintf('SUPP-%03d', count($engine->db['suppliers']) + 1),
                'name' => $name,
                'companyName' => trim($body['companyName'] ?? '') ?: null,
                'phone' => trim($body['phone'] ?? ''),
                'city' => trim($body['city'] ?? '') ?: 'هەولێر',
                'balanceIqd' => $openIqd,
                'balanceUsd' => ErpEngine::iqdToUsd($openIqd, $rate),
                'openingBalanceIqd' => $openIqd,
                'openingBalanceUsd' => ErpEngine::iqdToUsd($openIqd, $rate),
                'isActive' => true,
                'createdAt' => ErpEngine::nowIso(),
            ];
            array_unshift($engine->db['suppliers'], $s);
            if ($openIqd > 0) {
                $engine->postJournalEntry([
                    'description' => "Opening payable balance for {$s['name']}",
                    'referenceType' => 'MANUAL',
                    'lines' => [
                        ['accountCode' => '3000', 'debitIqd' => $openIqd, 'creditIqd' => 0],
                        ['accountCode' => '2100', 'debitIqd' => 0, 'creditIqd' => $openIqd],
                    ],
                ]);
            }
            $engine->saveDatabase();
            echo json_encode(['supplier' => $s]);
            exit;
        }

        if ($action === 'updateCustomer') {
            $cid = $body['customerId'] ?? '';
            foreach ($engine->db['customers'] as &$c) {
                if ($c['id'] === $cid) {
                    if (isset($body['name']) && trim($body['name']) !== '') $c['name'] = trim($body['name']);
                    if (array_key_exists('phone', $body)) $c['phone'] = trim((string)$body['phone']);
                    if (array_key_exists('city', $body)) $c['city'] = trim((string)$body['city']) ?: 'هەولێر';
                    $engine->logAudit('CUSTOMER_UPDATED', 'PARTIES', 'Customer', $cid, "Updated customer {$c['name']}");
                    $engine->saveDatabase();
                    echo json_encode(['customer' => $c]);
                    exit;
                }
            }
            throw new Exception('Customer not found.');
        }

        if ($action === 'updateSupplier') {
            $sid = $body['supplierId'] ?? '';
            foreach ($engine->db['suppliers'] as &$s) {
                if ($s['id'] === $sid) {
                    if (isset($body['name']) && trim($body['name']) !== '') $s['name'] = trim($body['name']);
                    if (array_key_exists('phone', $body)) $s['phone'] = trim((string)$body['phone']);
                    if (array_key_exists('city', $body)) $s['city'] = trim((string)$body['city']) ?: 'هەولێر';
                    $engine->logAudit('SUPPLIER_UPDATED', 'PARTIES', 'Supplier', $sid, "Updated supplier {$s['name']}");
                    $engine->saveDatabase();
                    echo json_encode(['supplier' => $s]);
                    exit;
                }
            }
            throw new Exception('Supplier not found.');
        }

        if ($action === 'collectDebt') {
            $idem = $engine->checkIdempotency($body['idempotencyKey'] ?? null);
            if ($idem) { echo json_encode($idem); exit; }

            $amtIqd = ErpEngine::roundIqd($body['amountIqd'] ?? $body['amountOriginal'] ?? 0);
            if ($amtIqd <= 0) throw new Exception('Payment amount must be greater than zero.');
            $finAcc = !empty($body['financialAccountId'])
                ? $engine->findById('financialAccounts', $body['financialAccountId'])
                : $engine->getDefaultFinancialAccount();
            $dateIso = ErpEngine::normalizeDateIso($body['date'] ?? null);

            $custName = '';
            foreach ($engine->db['customers'] as &$c) {
                if ($c['id'] === $body['customerId']) {
                    $c['balanceIqd'] = max(0.0, ErpEngine::roundIqd(ErpEngine::decSub($c['balanceIqd'] ?? 0, $amtIqd)));
                    $c['balanceUsd'] = ErpEngine::iqdToUsd($c['balanceIqd'], $rate);
                    $custName = $c['name'];
                    break;
                }
            }
            unset($c);

            // Allocate payment to target invoice or FIFO unpaid invoices
            $remainingAlloc = $amtIqd;
            $targetInvId = $body['salesInvoiceId'] ?? null;
            foreach ($engine->db['salesInvoices'] as &$inv) {
                if ($remainingAlloc <= 0) break;
                if ($inv['customerId'] !== $body['customerId']) continue;
                if ($targetInvId && $inv['id'] !== $targetInvId) continue;
                if (!in_array($inv['status'], ['POSTED', 'PARTIALLY_PAID']) || (float)($inv['dueIqd'] ?? 0) <= 0) continue;
                $apply = min($remainingAlloc, (float)$inv['dueIqd']);
                $inv['paidIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($inv['paidIqd'] ?? 0, $apply));
                $inv['dueIqd'] = max(0.0, ErpEngine::roundIqd(ErpEngine::decSub($inv['dueIqd'] ?? 0, $apply)));
                $inv['paidOriginal'] = $inv['paidIqd'];
                $inv['dueOriginal'] = $inv['dueIqd'];
                $inv['paidUsd'] = ErpEngine::iqdToUsd($inv['paidIqd'], $rate);
                $inv['dueUsd'] = ErpEngine::iqdToUsd($inv['dueIqd'], $rate);
                $inv['status'] = $inv['dueIqd'] <= 0 ? 'PAID' : 'PARTIALLY_PAID';
                $remainingAlloc = ErpEngine::roundIqd(ErpEngine::decSub($remainingAlloc, $apply));
            }
            unset($inv);

            $payNum = sprintf('RCV-%s-%04d', date('Y'), count($engine->db['debtPayments']) + 1);
            $payId = ErpEngine::cuid('pay_');

            if ($finAcc) {
                $engine->recordFinancialAccountMovement($finAcc['id'], $amtIqd, 'IN', 'DEBTOR_COLLECTION', "Debt collection {$payNum} from {$custName}", $dateIso, 'DEBT', 'DEBT_PAYMENT', $payId);
            }

            $engine->postJournalEntry([
                'date' => $dateIso,
                'description' => "Debtor collection {$payNum} from {$custName}",
                'referenceType' => 'DEBTOR_COLLECTION',
                'referenceId' => $payId,
                'lines' => [
                    ['accountId' => $finAcc['ledgerAccountId'], 'debitIqd' => $amtIqd, 'creditIqd' => 0],
                    ['accountCode' => '1200', 'debitIqd' => 0, 'creditIqd' => $amtIqd, 'customerId' => $body['customerId']],
                ],
            ]);

            $payment = [
                'id' => $payId,
                'paymentNumber' => $payNum,
                'date' => $dateIso,
                'type' => 'DEBTOR_COLLECTION',
                'customerId' => $body['customerId'],
                'salesInvoiceId' => $targetInvId,
                'financialAccountId' => $finAcc['id'],
                'paymentMethod' => $body['paymentMethod'] ?? 'CASH',
                'currency' => 'IQD',
                'exchangeRate' => $rate,
                'amountOriginal' => $amtIqd,
                'amountIqd' => $amtIqd,
                'amountUsd' => ErpEngine::iqdToUsd($amtIqd, $rate),
                'notes' => trim($body['notes'] ?? '') ?: null,
            ];
            array_unshift($engine->db['debtPayments'], $payment);
            $resp = ['payment' => $payment];
            $engine->storeIdempotency($body['idempotencyKey'] ?? null, $resp);
            $engine->saveDatabase();
            echo json_encode($resp);
            exit;
        }

        if ($action === 'payCreditor') {
            $idem = $engine->checkIdempotency($body['idempotencyKey'] ?? null);
            if ($idem) { echo json_encode($idem); exit; }

            $amtIqd = ErpEngine::roundIqd($body['amountIqd'] ?? $body['amountOriginal'] ?? 0);
            if ($amtIqd <= 0) throw new Exception('Payment amount must be greater than zero.');
            $finAcc = !empty($body['financialAccountId'])
                ? $engine->findById('financialAccounts', $body['financialAccountId'])
                : $engine->getDefaultFinancialAccount();
            $dateIso = ErpEngine::normalizeDateIso($body['date'] ?? null);

            $suppName = '';
            foreach ($engine->db['suppliers'] as &$s) {
                if ($s['id'] === $body['supplierId']) {
                    $s['balanceIqd'] = max(0.0, ErpEngine::roundIqd(ErpEngine::decSub($s['balanceIqd'] ?? 0, $amtIqd)));
                    $s['balanceUsd'] = ErpEngine::iqdToUsd($s['balanceIqd'], $rate);
                    $suppName = $s['name'];
                    break;
                }
            }
            unset($s);

            $remainingAlloc = $amtIqd;
            $targetInvId = $body['purchaseInvoiceId'] ?? null;
            foreach ($engine->db['purchaseInvoices'] as &$inv) {
                if ($remainingAlloc <= 0) break;
                if ($inv['supplierId'] !== $body['supplierId']) continue;
                if ($targetInvId && $inv['id'] !== $targetInvId) continue;
                if (!in_array($inv['status'], ['POSTED', 'PARTIALLY_PAID']) || (float)($inv['dueIqd'] ?? 0) <= 0) continue;
                $apply = min($remainingAlloc, (float)$inv['dueIqd']);
                $inv['paidIqd'] = ErpEngine::roundIqd(ErpEngine::decAdd($inv['paidIqd'] ?? 0, $apply));
                $inv['dueIqd'] = max(0.0, ErpEngine::roundIqd(ErpEngine::decSub($inv['dueIqd'] ?? 0, $apply)));
                $inv['paidOriginal'] = $inv['paidIqd'];
                $inv['dueOriginal'] = $inv['dueIqd'];
                $inv['paidUsd'] = ErpEngine::iqdToUsd($inv['paidIqd'], $rate);
                $inv['dueUsd'] = ErpEngine::iqdToUsd($inv['dueIqd'], $rate);
                $inv['status'] = $inv['dueIqd'] <= 0 ? 'PAID' : 'PARTIALLY_PAID';
                $remainingAlloc = ErpEngine::roundIqd(ErpEngine::decSub($remainingAlloc, $apply));
            }
            unset($inv);

            $payNum = sprintf('PAY-%s-%04d', date('Y'), count($engine->db['debtPayments']) + 1);
            $payId = ErpEngine::cuid('pay_');

            if ($finAcc) {
                $engine->recordFinancialAccountMovement($finAcc['id'], $amtIqd, 'OUT', 'CREDITOR_PAYMENT', "Supplier payment {$payNum} to {$suppName}", $dateIso, 'DEBT', 'DEBT_PAYMENT', $payId);
            }

            $engine->postJournalEntry([
                'date' => $dateIso,
                'description' => "Creditor payment {$payNum} to {$suppName}",
                'referenceType' => 'CREDITOR_PAYMENT',
                'referenceId' => $payId,
                'lines' => [
                    ['accountCode' => '2100', 'debitIqd' => $amtIqd, 'creditIqd' => 0, 'supplierId' => $body['supplierId']],
                    ['accountId' => $finAcc['ledgerAccountId'], 'debitIqd' => 0, 'creditIqd' => $amtIqd],
                ],
            ]);

            $payment = [
                'id' => $payId,
                'paymentNumber' => $payNum,
                'date' => $dateIso,
                'type' => 'CREDITOR_PAYMENT',
                'supplierId' => $body['supplierId'],
                'purchaseInvoiceId' => $targetInvId,
                'financialAccountId' => $finAcc['id'],
                'paymentMethod' => $body['paymentMethod'] ?? 'CASH',
                'currency' => 'IQD',
                'exchangeRate' => $rate,
                'amountOriginal' => $amtIqd,
                'amountIqd' => $amtIqd,
                'amountUsd' => ErpEngine::iqdToUsd($amtIqd, $rate),
                'notes' => trim($body['notes'] ?? '') ?: null,
            ];
            array_unshift($engine->db['debtPayments'], $payment);
            $resp = ['payment' => $payment];
            $engine->storeIdempotency($body['idempotencyKey'] ?? null, $resp);
            $engine->saveDatabase();
            echo json_encode($resp);
            exit;
        }
    }

    // =========================================================================
    // 11. CASH & BANK ENDPOINT (IQD-ONLY)
    // =========================================================================
    if ($route === 'cashbank') {
        if ($method === 'GET') {
            $accs = [];
            foreach ($engine->db['financialAccounts'] as $fa) {
                $fa['ledgerAccount'] = $engine->findById('accounts', $fa['ledgerAccountId']);
                $accs[] = $fa;
            }
            $txs = [];
            foreach (array_slice($engine->db['cashTransactions'], 0, 100) as $ct) {
                $ct['financialAccount'] = $engine->findById('financialAccounts', $ct['financialAccountId']);
                $txs[] = $ct;
            }
            echo json_encode(['accounts' => $accs, 'transactions' => $txs]);
            exit;
        }

        $action = $body['action'] ?? '';

        if ($action === 'deposit' || $action === 'withdrawal') {
            $fa = $engine->findById('financialAccounts', $body['financialAccountId'] ?? '');
            if (!$fa) throw new Exception('Financial account not found.');
            $amtIqd = ErpEngine::roundIqd($body['amountIqd'] ?? $body['amountOriginal'] ?? 0);
            if ($amtIqd <= 0) throw new Exception('Amount must be greater than zero.');
            $isDeposit = ($action === 'deposit');
            $desc = trim($body['description'] ?? '') ?: ($isDeposit ? 'Cash / Capital Deposit' : 'Cash Withdrawal');

            $tx = $engine->recordFinancialAccountMovement($fa['id'], $amtIqd, $isDeposit ? 'IN' : 'OUT', $isDeposit ? 'DEPOSIT' : 'WITHDRAWAL', $desc);
            $engine->postJournalEntry([
                'description' => $desc,
                'referenceType' => 'CASH_TRANSACTION',
                'referenceId' => $tx['id'],
                'lines' => $isDeposit
                    ? [
                        ['accountId' => $fa['ledgerAccountId'], 'debitIqd' => $amtIqd, 'creditIqd' => 0],
                        ['accountCode' => '3000', 'debitIqd' => 0, 'creditIqd' => $amtIqd],
                    ]
                    : [
                        ['accountCode' => '3200', 'debitIqd' => $amtIqd, 'creditIqd' => 0],
                        ['accountId' => $fa['ledgerAccountId'], 'debitIqd' => 0, 'creditIqd' => $amtIqd],
                    ],
            ]);
            $engine->saveDatabase();
            echo json_encode(['transaction' => $tx]);
            exit;
        }

        if ($action === 'transfer') {
            $from = $engine->findById('financialAccounts', $body['fromFinancialAccountId'] ?? '');
            $to = $engine->findById('financialAccounts', $body['toFinancialAccountId'] ?? '');
            if (!$from || !$to) throw new Exception('Accounts not found.');
            if ($from['id'] === $to['id']) throw new Exception('Source and destination accounts must differ.');
            $amtIqd = ErpEngine::roundIqd($body['amountIqd'] ?? $body['amountOriginal'] ?? 0);
            if ($amtIqd <= 0) throw new Exception('Transfer amount must be greater than zero.');

            $desc = trim($body['description'] ?? '') ?: "Transfer from {$from['nameKu']} to {$to['nameKu']}";
            $engine->recordFinancialAccountMovement($from['id'], $amtIqd, 'OUT', 'TRANSFER', $desc);
            $engine->recordFinancialAccountMovement($to['id'], $amtIqd, 'IN', 'TRANSFER', $desc);

            $engine->postJournalEntry([
                'description' => $desc,
                'referenceType' => 'CASH_TRANSACTION',
                'lines' => [
                    ['accountId' => $to['ledgerAccountId'], 'debitIqd' => $amtIqd, 'creditIqd' => 0],
                    ['accountId' => $from['ledgerAccountId'], 'debitIqd' => 0, 'creditIqd' => $amtIqd],
                ],
            ]);
            $engine->saveDatabase();
            echo json_encode(['success' => true]);
            exit;
        }

        if ($action === 'reconcile') {
            $fa = $engine->findById('financialAccounts', $body['financialAccountId'] ?? '');
            if (!$fa) throw new Exception('Financial account not found.');
            $actualIqd = ErpEngine::roundIqd($body['statementBalanceIqd'] ?? $body['statementBalanceOriginal'] ?? 0);
            $bookIqd = ErpEngine::roundIqd($fa['balanceIqd'] ?? 0);
            $diffIqd = ErpEngine::roundIqd(ErpEngine::decSub($actualIqd, $bookIqd));

            if ($diffIqd != 0 && !empty($body['postAdjustment'])) {
                $desc = trim($body['notes'] ?? '') ?: "Reconciliation adjustment for {$fa['nameKu']}";
                $engine->recordFinancialAccountMovement($fa['id'], abs($diffIqd), $diffIqd > 0 ? 'IN' : 'OUT', 'RECONCILIATION_ADJUSTMENT', $desc);
                $engine->postJournalEntry([
                    'description' => $desc,
                    'referenceType' => 'CASH_TRANSACTION',
                    'lines' => $diffIqd > 0
                        ? [
                            ['accountId' => $fa['ledgerAccountId'], 'debitIqd' => $diffIqd, 'creditIqd' => 0],
                            ['accountCode' => '4200', 'debitIqd' => 0, 'creditIqd' => $diffIqd],
                        ]
                        : [
                            ['accountCode' => '5190', 'debitIqd' => abs($diffIqd), 'creditIqd' => 0],
                            ['accountId' => $fa['ledgerAccountId'], 'debitIqd' => 0, 'creditIqd' => abs($diffIqd)],
                        ],
                ]);
            }
            foreach ($engine->db['financialAccounts'] as &$acc) {
                if ($acc['id'] === $fa['id']) {
                    $acc['lastReconciledAt'] = ErpEngine::nowIso();
                    $acc['lastReconciledBalance'] = $actualIqd;
                    break;
                }
            }
            unset($acc);
            $engine->saveDatabase();
            echo json_encode(['success' => true, 'differenceIqd' => $diffIqd]);
            exit;
        }

        if ($action === 'createAccount') {
            $name = trim($body['nameKu'] ?? $body['nameEn'] ?? '');
            if (!$name) throw new Exception('Account name is required.');
            $type = $body['type'] ?? 'CASH_REGISTER';
            $ledgerAcc = $engine->findAccountByCodeOrId($type === 'BANK_ACCOUNT' ? '1025' : '1015', null)
                ?: $engine->findAccountByCodeOrId('1010', null);

            $fa = [
                'id' => ErpEngine::cuid('fin_'),
                'code' => ($type === 'BANK_ACCOUNT' ? 'BANK-' : 'CASH-') . rand(100, 999),
                'nameKu' => trim($body['nameKu'] ?? '') ?: $name,
                'nameAr' => trim($body['nameAr'] ?? '') ?: $name,
                'nameEn' => trim($body['nameEn'] ?? '') ?: $name,
                'type' => $type,
                'currency' => 'IQD',
                'bankName' => trim($body['bankName'] ?? '') ?: null,
                'ledgerAccountId' => $ledgerAcc['id'],
                'balanceOriginal' => 0.0,
                'balanceIqd' => 0.0,
                'balanceUsd' => 0.0,
                'isActive' => true,
                'createdAt' => ErpEngine::nowIso(),
            ];
            $engine->db['financialAccounts'][] = $fa;
            $engine->saveDatabase();
            echo json_encode(['account' => $fa]);
            exit;
        }
    }

    // =========================================================================
    // 12. ACCOUNTING ENGINE ENDPOINT (IQD-NATIVE)
    // =========================================================================
    if ($route === 'accounting') {
        if ($method === 'GET') {
            $hydratedJournals = array_map([$engine, 'hydrateJournal'], array_slice($engine->db['journals'], 0, 100));
            $pnl = $engine->getProfitAndLoss();
            echo json_encode([
                'accounts' => $engine->db['accounts'],
                'journals' => $hydratedJournals,
                'trialBalance' => $engine->getTrialBalance(),
                'profitAndLoss' => $pnl,
                'balanceSheet' => $engine->getBalanceSheet($pnl),
                'generalLedger' => $engine->getGeneralLedger(),
                'periods' => $engine->db['periods'],
            ]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'manualJournal') {
            $entry = $engine->postJournalEntry([
                'description' => $body['description'],
                'referenceType' => 'MANUAL',
                'lines' => $body['lines'],
            ]);
            $engine->logAudit('MANUAL_JOURNAL_POSTED', 'ACCOUNTING', 'JournalEntry', $entry['id'], "Posted Manual Journal {$entry['entryNumber']}");
            $engine->saveDatabase();
            echo json_encode(['entry' => $entry]);
            exit;
        }

        if ($action === 'reverseJournal') {
            $rev = $engine->reverseJournalEntry($body['journalEntryId'], $body['reason'] ?? 'Reversal');
            $engine->logAudit('JOURNAL_REVERSED', 'ACCOUNTING', 'JournalEntry', $rev['id'], "Reversed journal via {$rev['entryNumber']}");
            $engine->saveDatabase();
            echo json_encode(['reversal' => $rev]);
            exit;
        }

        if ($action === 'createAccount') {
            $type = $body['type'] ?? 'EXPENSE';
            $name = trim($body['nameKu'] ?? $body['nameEn'] ?? '');
            $acc = [
                'id' => ErpEngine::cuid('acc_'),
                'code' => trim($body['code']),
                'nameEn' => trim($body['nameEn'] ?? '') ?: $name,
                'nameAr' => trim($body['nameAr'] ?? '') ?: $name,
                'nameKu' => trim($body['nameKu'] ?? '') ?: $name,
                'type' => $type,
                'subType' => $type,
                'normalBalance' => in_array($type, ['ASSET', 'EXPENSE']) ? 'DEBIT' : 'CREDIT',
                'isSystem' => false,
                'isActive' => true,
                'balanceIqd' => 0.0,
                'balanceUsd' => 0.0,
            ];
            $engine->db['accounts'][] = $acc;
            $engine->saveDatabase();
            echo json_encode(['account' => $acc]);
            exit;
        }

        if ($action === 'togglePeriodLock') {
            foreach ($engine->db['periods'] as &$p) {
                if ($p['id'] === $body['periodId']) {
                    $p['isLocked'] = !empty($body['isLocked']);
                    $p['isClosed'] = !empty($body['isLocked']);
                    $engine->saveDatabase();
                    echo json_encode(['period' => $p]);
                    exit;
                }
            }
        }
    }

    // =========================================================================
    // 13. SETTINGS, SYSTEM USERS & BACKUP ENDPOINT
    // =========================================================================
    if ($route === 'settings') {
        if ($method === 'GET') {
            $rpList = [];
            foreach ($engine->db['rolePermissions'] as $rp) {
                $rp['permissions'] = json_decode($rp['permissionsJson'] ?? '[]', true) ?: [];
                $rpList[] = $rp;
            }
            echo json_encode([
                'settings' => $engine->db['settings'],
                'users' => $engine->db['users'],
                'rolePermissions' => $rpList,
                'auditLogs' => array_slice($engine->db['auditLogs'], 0, 100),
            ]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'updateSettings') {
            foreach (['companyNameEn', 'companyNameAr', 'companyNameKu', 'phone', 'email', 'addressEn', 'addressAr', 'addressKu', 'taxNumber', 'salesInvoicePrefix', 'purchaseInvoicePrefix'] as $k) {
                if (isset($body[$k])) $engine->db['settings'][$k] = $body[$k];
            }
            if (isset($body['expenseApprovalThresholdIqd'])) {
                $engine->db['settings']['expenseApprovalThresholdIqd'] = ErpEngine::roundIqd($body['expenseApprovalThresholdIqd']);
            }
            if (isset($body['allowNegativeStock'])) {
                $engine->db['settings']['allowNegativeStock'] = !empty($body['allowNegativeStock']);
            }
            $engine->logAudit('SETTINGS_UPDATED', 'SETTINGS', 'CompanySettings', null, "Updated company settings");
            $engine->saveDatabase();
            echo json_encode(['settings' => $engine->db['settings']]);
            exit;
        }

        if ($action === 'createUser') {
            $u = [
                'id' => ErpEngine::cuid('usr_'),
                'name' => trim($body['name']),
                'username' => trim($body['username']),
                'email' => strtolower(trim($body['email'])),
                'phone' => trim($body['phone'] ?? '') ?: null,
                'role' => $body['role'] ?? 'SALES_EMPLOYEE',
                'isActive' => true,
                'createdAt' => ErpEngine::nowIso(),
            ];
            $engine->db['users'][] = $u;
            $engine->saveDatabase();
            echo json_encode(['user' => $u]);
            exit;
        }

        if ($action === 'toggleUserActive') {
            foreach ($engine->db['users'] as &$u) {
                if ($u['id'] === $body['userId']) {
                    $u['isActive'] = !empty($body['isActive']);
                    $engine->saveDatabase();
                    echo json_encode(['user' => $u]);
                    exit;
                }
            }
        }

        if ($action === 'updateRolePermissions') {
            foreach ($engine->db['rolePermissions'] as &$rp) {
                if ($rp['role'] === $body['role']) {
                    $rp['permissionsJson'] = json_encode($body['permissions'] ?? []);
                    $engine->saveDatabase();
                    echo json_encode(['rolePermission' => $rp]);
                    exit;
                }
            }
        }

        if ($action === 'createBackup') {
            $engine->db['settings']['lastBackupAt'] = ErpEngine::nowIso();
            $engine->saveDatabase();
            echo json_encode([
                'backup' => [
                    'version' => '2.0.0-FOOD-FACTORY-IQD',
                    'exportedAt' => ErpEngine::nowIso(),
                    'data' => $engine->db,
                ],
            ]);
            exit;
        }
    }

    http_response_code(404);
    echo json_encode(['error' => "Unknown API route '{$route}'"]);
} catch (Throwable $e) {
    $msg = $e->getMessage();
    $code = str_starts_with($msg, 'DUPLICATE_WARNING:') ? 409 : 400;
    http_response_code($code);
    echo json_encode([
        'error' => str_replace('DUPLICATE_WARNING: ', '', $msg),
        'code' => $code === 409 ? 'POSSIBLE_DUPLICATE' : 'ERROR',
    ]);
}
