<?php
/**
 * SHERZAD ENTERPRISE ERP & DOUBLE-ENTRY ACCOUNTING SYSTEM
 * Unified PHP 8 REST API Controller for Hostinger Web Hosting
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/Engine.php';

try {
    $engine = new ErpEngine();
    $method = $_SERVER['REQUEST_METHOD'];

    // Determine route from ?route=..., or REQUEST_URI (/api/<route>)
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

    // =========================================================================
    // 1. BOOTSTRAP ENDPOINT
    // =========================================================================
    if ($route === 'bootstrap') {
        $user = $engine->getCurrentUser();
        $products = array_map([$engine, 'hydrateProduct'], $engine->db['products']);

        $notifications = [];
        foreach ($products as $p) {
            $qty = (float)$p['totalStock'];
            $min = (float)$p['minStockLevel'];
            if ($qty <= $min) {
                $notifications[] = [
                    'id' => 'low-stock-' . $p['id'],
                    'type' => 'LOW_STOCK',
                    'severity' => $qty <= 0 ? 'danger' : 'warning',
                    'titleEn' => ($qty <= 0 ? 'Out of Stock: ' : 'Low Stock Alert: ') . $p['nameEn'],
                    'titleAr' => ($qty <= 0 ? 'نفاد المخزون: ' : 'تنبيه انخفاض المخزون: ') . $p['nameAr'],
                    'titleKu' => ($qty <= 0 ? 'نەمانی کاڵا: ' : 'ئاگاداری کەمی کاڵا: ') . $p['nameKu'],
                    'descEn' => "Remaining: {$qty} {$p['unit']} (Min: {$min})",
                    'descAr' => "الكمية المتبقية: {$qty} {$p['unit']} (الحد الأدنى: {$min})",
                    'descKu' => "بڕی ماوە: {$qty} {$p['unit']} (کەمترین: {$min})",
                    'module' => 'inventory',
                ];
            }
        }

        foreach ($engine->db['expenses'] as $exp) {
            if ($exp['status'] === 'PENDING_APPROVAL') {
                $notifications[] = [
                    'id' => 'exp-app-' . $exp['id'],
                    'type' => 'EXPENSE_APPROVAL',
                    'severity' => 'info',
                    'titleEn' => 'Approval Required: ' . $exp['title'],
                    'titleAr' => 'يتطلب موافقة الإدارة: ' . $exp['title'],
                    'titleKu' => 'پێویستی بە پەسەندکردنە: ' . $exp['title'],
                    'descEn' => "Expense {$exp['expenseNumber']} (\${$exp['amountUsd']}) awaits approval.",
                    'descAr' => "المصروف {$exp['expenseNumber']} (\${$exp['amountUsd']}) بانتظار الاعتماد.",
                    'descKu' => "خەرجی {$exp['expenseNumber']} (\${$exp['amountUsd']}) چاوەڕوانی پەسەندکردنە.",
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
            'financialAccounts' => $engine->db['financialAccounts'],
            'products' => $products,
            'customers' => $engine->db['customers'],
            'suppliers' => $engine->db['suppliers'],
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
                if (strcasecmp($u['username'], $id) === 0 || strcasecmp($u['email'], $id) === 0) {
                    $target = $u;
                    break;
                }
            }
            if (!$target) {
                http_response_code(401);
                echo json_encode(['error' => 'Invalid username or password']);
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
    // 3. DASHBOARD ANALYTICS ENDPOINT
    // =========================================================================
    if ($route === 'dashboard') {
        $pnl = $engine->getProfitAndLoss();
        $invVal = $engine->getInventoryValuation();

        $totalPurchasesUsd = 0.0;
        $unpaidPurchases = [];
        foreach ($engine->db['purchaseInvoices'] as $p) {
            if (in_array($p['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) {
                $totalPurchasesUsd += (float)$p['totalUsd'];
                if ((float)$p['dueUsd'] > 0) {
                    $supp = $engine->findById('suppliers', $p['supplierId']);
                    $unpaidPurchases[] = [
                        'id' => $p['id'],
                        'invoiceNumber' => $p['invoiceNumber'],
                        'partyName' => $supp['name'] ?? '',
                        'date' => $p['date'],
                        'dueDate' => $p['dueDate'],
                        'totalUsd' => (float)$p['totalUsd'],
                        'paidUsd' => (float)$p['paidUsd'],
                        'dueUsd' => (float)$p['dueUsd'],
                        'currency' => $p['currency'],
                        'type' => 'PURCHASE',
                    ];
                }
            }
        }

        $totalSalesInvoicedUsd = 0.0;
        $unpaidSales = [];
        foreach ($engine->db['salesInvoices'] as $s) {
            if (in_array($s['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) {
                $totalSalesInvoicedUsd += (float)$s['totalUsd'];
                if ((float)$s['dueUsd'] > 0) {
                    $cust = $engine->findById('customers', $s['customerId']);
                    $unpaidSales[] = [
                        'id' => $s['id'],
                        'invoiceNumber' => $s['invoiceNumber'],
                        'partyName' => $cust['name'] ?? '',
                        'date' => $s['date'],
                        'dueDate' => $s['dueDate'],
                        'totalUsd' => (float)$s['totalUsd'],
                        'paidUsd' => (float)$s['paidUsd'],
                        'dueUsd' => (float)$s['dueUsd'],
                        'currency' => $s['currency'],
                        'type' => 'SALE',
                    ];
                }
            }
        }

        $totalCustomerDebtsUsd = 0.0;
        foreach ($engine->db['customers'] as $c) {
            if ((float)$c['balanceUsd'] > 0) $totalCustomerDebtsUsd += (float)$c['balanceUsd'];
        }

        $totalSupplierLiabilitiesUsd = 0.0;
        foreach ($engine->db['suppliers'] as $s) {
            if ((float)$s['balanceUsd'] > 0) $totalSupplierLiabilitiesUsd += (float)$s['balanceUsd'];
        }

        $cashBalanceUsd = 0.0;
        $cashRegUsd = 0.0;
        $bankAccUsd = 0.0;
        foreach ($engine->db['financialAccounts'] as $fa) {
            $b = (float)$fa['balanceUsd'];
            $cashBalanceUsd += $b;
            if ($fa['type'] === 'CASH_REGISTER') $cashRegUsd += $b;
            else $bankAccUsd += $b;
        }

        $pendingExp = array_values(array_filter($engine->db['expenses'], fn($e) => $e['status'] === 'PENDING_APPROVAL'));
        $lowStock = array_values(array_filter($invVal['items'], fn($i) => $i['isLowStock'] || $i['isOutOfStock']));

        // Build daily chart series
        $daily = [];
        for ($i = 13; $i >= 0; $i--) {
            $dayKey = gmdate('Y-m-d', time() - $i * 86400);
            $daily[$dayKey] = [
                'label' => substr($dayKey, 5),
                'salesUsd' => 0.0,
                'purchasesUsd' => 0.0,
                'expensesUsd' => 0.0,
                'profitUsd' => 0.0,
            ];
        }
        foreach ($engine->db['salesInvoices'] as $s) {
            if (!in_array($s['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) continue;
            $dk = substr($s['date'], 0, 10);
            if (isset($daily[$dk])) {
                $daily[$dk]['salesUsd'] = ErpEngine::roundUsd($daily[$dk]['salesUsd'] + (float)$s['totalUsd']);
                $daily[$dk]['profitUsd'] = ErpEngine::roundUsd($daily[$dk]['profitUsd'] + (float)$s['grossProfitUsd']);
            }
        }
        foreach ($engine->db['purchaseInvoices'] as $p) {
            if (!in_array($p['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) continue;
            $dk = substr($p['date'], 0, 10);
            if (isset($daily[$dk])) {
                $daily[$dk]['purchasesUsd'] = ErpEngine::roundUsd($daily[$dk]['purchasesUsd'] + (float)$p['totalUsd']);
            }
        }

        echo json_encode([
            'kpis' => [
                'totalSalesUsd' => $pnl['netSalesRevenueUsd'],
                'totalSalesInvoicedUsd' => ErpEngine::roundUsd($totalSalesInvoicedUsd),
                'totalPurchasesUsd' => ErpEngine::roundUsd($totalPurchasesUsd),
                'totalExpensesUsd' => $pnl['operatingExpensesUsd'],
                'grossProfitUsd' => $pnl['grossProfitUsd'],
                'netProfitUsd' => $pnl['netProfitUsd'],
                'grossMarginPercent' => $pnl['grossMarginPercent'],
                'netMarginPercent' => $pnl['netMarginPercent'],
                'totalCustomerDebtsUsd' => ErpEngine::roundUsd($totalCustomerDebtsUsd),
                'totalSupplierLiabilitiesUsd' => ErpEngine::roundUsd($totalSupplierLiabilitiesUsd),
                'cashBalanceUsd' => ErpEngine::roundUsd($cashBalanceUsd),
                'cashRegistersUsd' => ErpEngine::roundUsd($cashRegUsd),
                'bankAccountsUsd' => ErpEngine::roundUsd($bankAccUsd),
                'inventoryCostValueUsd' => $invVal['totalCostValueUsd'],
                'inventoryRetailValueUsd' => $invVal['totalRetailValueUsd'],
                'totalCustomers' => count($engine->db['customers']),
                'totalSuppliers' => count($engine->db['suppliers']),
                'totalProducts' => $invVal['totalProducts'],
                'lowStockCount' => count($lowStock),
                'unpaidSalesCount' => count($unpaidSales),
                'unpaidPurchasesCount' => count($unpaidPurchases),
                'pendingExpensesCount' => count($pendingExp),
                'exchangeRate' => (float)($engine->db['settings']['usdToIqdRate'] ?? 1500),
            ],
            'financialAccounts' => $engine->db['financialAccounts'],
            'lowStockProducts' => $lowStock,
            'unpaidInvoices' => array_merge($unpaidSales, $unpaidPurchases),
            'pendingExpenses' => $pendingExp,
            'recentTransactions' => array_slice($engine->db['journals'], 0, 15),
            'charts' => [
                'daily' => array_values($daily),
                'monthly' => array_values($daily),
                'expenseByCategory' => $pnl['operatingExpenseBreakdown'],
                'profitByCategory' => $pnl['profitByCategory'],
            ],
        ]);
        exit;
    }

    // =========================================================================
    // 4. INVENTORY ENDPOINT
    // =========================================================================
    if ($route === 'inventory') {
        if ($method === 'GET') {
            echo json_encode([
                'valuation' => $engine->getInventoryValuation(),
                'movements' => array_map([$engine, 'hydrateMovement'], array_slice($engine->db['movements'], 0, 60)),
                'transfers' => array_map([$engine, 'hydrateTransfer'], array_slice($engine->db['transfers'], 0, 40)),
                'categories' => $engine->db['categories'],
                'warehouses' => $engine->db['warehouses'],
            ]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'createProduct') {
            $p = [
                'id' => ErpEngine::cuid('prd_'),
                'sku' => strtoupper(trim($body['sku'] ?? 'SKU-' . rand(100, 999))),
                'barcode' => $body['barcode'] ?? null,
                'nameEn' => trim($body['nameEn']),
                'nameAr' => trim($body['nameAr'] ?: $body['nameEn']),
                'nameKu' => trim($body['nameKu'] ?: $body['nameEn']),
                'description' => $body['description'] ?? null,
                'categoryId' => $body['categoryId'] ?: ($engine->db['categories'][0]['id'] ?? ''),
                'unit' => $body['unit'] ?? 'PCS',
                'purchaseCostUsd' => (float)$body['purchaseCostUsd'],
                'sellingPriceUsd' => (float)$body['sellingPriceUsd'],
                'taxRate' => (float)($body['taxRate'] ?? 0),
                'minStockLevel' => (float)($body['minStockLevel'] ?? 5),
                'totalStock' => 0,
                'isActive' => true,
                'createdAt' => ErpEngine::nowIso(),
            ];
            $engine->db['products'][] = $p;

            $initStock = (float)($body['initialStock'] ?? 0);
            if ($initStock > 0) {
                $whId = $body['warehouseId'] ?: ($engine->db['warehouses'][0]['id'] ?? '');
                $engine->applyStockChange([
                    'productId' => $p['id'],
                    'warehouseId' => $whId,
                    'quantityDelta' => $initStock,
                    'type' => 'OPENING_STOCK',
                    'unitCostUsd' => $p['purchaseCostUsd'],
                    'reason' => 'Initial opening stock',
                    'postJournalForAdjustment' => true,
                ]);
            }
            $engine->logAudit('PRODUCT_CREATED', 'INVENTORY', 'Product', $p['id'], "Created product {$p['nameEn']} ({$p['sku']})");
            $engine->saveDatabase();
            echo json_encode(['product' => $engine->hydrateProduct($p)]);
            exit;
        }

        if ($action === 'adjustStock') {
            $delta = (float)$body['quantityDelta'];
            $res = $engine->applyStockChange([
                'productId' => $body['productId'],
                'warehouseId' => $body['warehouseId'],
                'quantityDelta' => $delta,
                'type' => $delta >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
                'reason' => $body['reason'] ?? 'Manual adjustment',
                'postJournalForAdjustment' => true,
            ]);
            $engine->logAudit('STOCK_ADJUSTED', 'INVENTORY', 'Product', $body['productId'], "Adjusted stock by {$delta}");
            $engine->saveDatabase();
            echo json_encode($res);
            exit;
        }

        if ($action === 'transferStock') {
            $qty = (float)$body['quantity'];
            if ($body['fromWarehouseId'] === $body['toWarehouseId']) {
                throw new Exception('Source and destination warehouses must be different.');
            }
            $trf = [
                'id' => ErpEngine::cuid('trf_'),
                'transferNumber' => sprintf('TRF-%s-%04d', date('Y'), count($engine->db['transfers']) + 1),
                'fromWarehouseId' => $body['fromWarehouseId'],
                'toWarehouseId' => $body['toWarehouseId'],
                'productId' => $body['productId'],
                'quantity' => $qty,
                'notes' => $body['notes'] ?? null,
                'status' => 'COMPLETED',
                'createdAt' => ErpEngine::nowIso(),
            ];
            $engine->applyStockChange([
                'productId' => $body['productId'],
                'warehouseId' => $body['fromWarehouseId'],
                'quantityDelta' => -$qty,
                'type' => 'TRANSFER_OUT',
                'reason' => "Transfer {$trf['transferNumber']}",
            ]);
            $engine->applyStockChange([
                'productId' => $body['productId'],
                'warehouseId' => $body['toWarehouseId'],
                'quantityDelta' => $qty,
                'type' => 'TRANSFER_IN',
                'reason' => "Transfer {$trf['transferNumber']}",
            ]);
            array_unshift($engine->db['transfers'], $trf);
            $engine->saveDatabase();
            echo json_encode(['transfer' => $engine->hydrateTransfer($trf)]);
            exit;
        }

        if ($action === 'createWarehouse') {
            $wh = [
                'id' => ErpEngine::cuid('wh_'),
                'code' => 'WH-' . rand(100, 999),
                'nameEn' => $body['nameEn'],
                'nameAr' => $body['nameAr'] ?: $body['nameEn'],
                'nameKu' => $body['nameKu'] ?: $body['nameEn'],
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
            $cat = [
                'id' => ErpEngine::cuid('cat_'),
                'code' => 'CAT-' . rand(100, 999),
                'nameEn' => $body['nameEn'],
                'nameAr' => $body['nameAr'] ?: $body['nameEn'],
                'nameKu' => $body['nameKu'] ?: $body['nameEn'],
            ];
            $engine->db['categories'][] = $cat;
            $engine->saveDatabase();
            echo json_encode(['category' => $cat]);
            exit;
        }
    }

    // =========================================================================
    // 5. SALES & POS ENDPOINT
    // =========================================================================
    if ($route === 'sales') {
        if ($method === 'GET') {
            $invoices = array_map([$engine, 'hydrateSalesInvoice'], $engine->db['salesInvoices']);
            echo json_encode(['invoices' => $invoices]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'createInvoice') {
            $currency = $body['currency'] ?? 'USD';
            $rate = (float)($body['exchangeRate'] ?? ($engine->db['settings']['usdToIqdRate'] ?? 1500));
            $customerId = $body['customerId'];
            $warehouseId = $body['warehouseId'] ?: ($engine->db['warehouses'][0]['id'] ?? '');
            $status = $body['status'] ?? 'POSTED';

            $subtotalOrig = 0.0;
            $lineDiscOrig = 0.0;
            $taxOrig = 0.0;
            $totalCostUsd = 0.0;
            $invId = ErpEngine::cuid('sinv_');
            $preparedItems = [];

            foreach ($body['items'] as $raw) {
                $prod = $engine->findById('products', $raw['productId']);
                if (!$prod) throw new Exception('Product not found');
                $qty = (float)$raw['quantity'];
                $priceOrig = isset($raw['unitPriceOriginal'])
                    ? (float)$raw['unitPriceOriginal']
                    : ErpEngine::fromUsd($prod['sellingPriceUsd'], $currency, $rate);
                $priceUsd = ErpEngine::toUsd($priceOrig, $currency, $rate);
                $costUsd = (float)$prod['purchaseCostUsd'];
                $discOrig = (float)($raw['discountOriginal'] ?? 0);
                $discUsd = ErpEngine::toUsd($discOrig, $currency, $rate);
                $lineNetOrig = max(0, ($qty * $priceOrig) - $discOrig);
                $lineNetUsd = ErpEngine::toUsd($lineNetOrig, $currency, $rate);
                $lineCostTotal = ErpEngine::roundUsd($qty * $costUsd);

                $subtotalOrig += ($qty * $priceOrig);
                $lineDiscOrig += $discOrig;
                $totalCostUsd = ErpEngine::roundUsd($totalCostUsd + $lineCostTotal);

                $preparedItems[] = [
                    'id' => ErpEngine::cuid('sitem_'),
                    'salesInvoiceId' => $invId,
                    'productId' => $prod['id'],
                    'productName' => $prod['nameEn'],
                    'sku' => $prod['sku'],
                    'quantity' => $qty,
                    'returnedQty' => 0,
                    'unitPriceOriginal' => $priceOrig,
                    'unitPriceUsd' => $priceUsd,
                    'unitCostUsd' => $costUsd,
                    'discountOriginal' => $discOrig,
                    'discountUsd' => $discUsd,
                    'taxRate' => 0,
                    'taxOriginal' => 0,
                    'taxUsd' => 0,
                    'lineTotalOriginal' => $lineNetOrig,
                    'lineTotalUsd' => $lineNetUsd,
                    'lineProfitUsd' => ErpEngine::roundUsd($lineNetUsd - $lineCostTotal),
                ];
            }

            $totalDiscOrig = $lineDiscOrig + (float)($body['invoiceDiscountOriginal'] ?? 0);
            $totalOrig = max(0, $subtotalOrig - $totalDiscOrig + $taxOrig);
            $subtotalUsd = ErpEngine::toUsd($subtotalOrig, $currency, $rate);
            $discountUsd = ErpEngine::toUsd($totalDiscOrig, $currency, $rate);
            $totalUsd = ErpEngine::roundUsd($subtotalUsd - $discountUsd);

            $paymentType = $body['paymentType'] ?? 'CASH';
            $paidOrig = $paymentType === 'CASH'
                ? $totalOrig
                : ($paymentType === 'CREDIT' ? 0 : (float)($body['paidOriginal'] ?? 0));
            $dueOrig = max(0, $totalOrig - $paidOrig);
            $paidUsd = ($paidOrig == $totalOrig) ? $totalUsd : ErpEngine::toUsd($paidOrig, $currency, $rate);
            $dueUsd = ErpEngine::roundUsd($totalUsd - $paidUsd);

            $invNumber = sprintf('INV-%s-%04d', date('Y'), count($engine->db['salesInvoices']) + 1);
            $finAccId = $body['financialAccountId'] ?: ($engine->db['financialAccounts'][0]['id'] ?? null);

            $invoice = [
                'id' => $invId,
                'invoiceNumber' => $invNumber,
                'customerId' => $customerId,
                'warehouseId' => $warehouseId,
                'date' => ErpEngine::nowIso(),
                'dueDate' => $dueUsd > 0 ? gmdate('Y-m-d\TH:i:s.000\Z', time() + 30 * 86400) : null,
                'status' => $status === 'DRAFT' ? 'DRAFT' : ($dueUsd == 0 ? 'PAID' : ($paidUsd > 0 ? 'PARTIALLY_PAID' : 'POSTED')),
                'paymentType' => $dueUsd == 0 ? 'CASH' : ($paidUsd == 0 ? 'CREDIT' : 'PARTIAL'),
                'currency' => $currency,
                'exchangeRate' => $rate,
                'subtotalOriginal' => $subtotalOrig,
                'discountOriginal' => $totalDiscOrig,
                'taxOriginal' => 0,
                'totalOriginal' => $totalOrig,
                'paidOriginal' => $paidOrig,
                'dueOriginal' => $dueOrig,
                'subtotalUsd' => $subtotalUsd,
                'discountUsd' => $discountUsd,
                'taxUsd' => 0,
                'totalUsd' => $totalUsd,
                'paidUsd' => $paidUsd,
                'dueUsd' => $dueUsd,
                'totalCostUsd' => $totalCostUsd,
                'grossProfitUsd' => ErpEngine::roundUsd($totalUsd - $totalCostUsd),
                'financialAccountId' => $finAccId,
                'paymentMethod' => $body['paymentMethod'] ?? 'CASH',
                'notes' => $body['notes'] ?? null,
            ];

            foreach ($preparedItems as $pi) {
                $engine->db['salesInvoiceItems'][] = $pi;
            }

            if ($status !== 'DRAFT') {
                foreach ($preparedItems as $pi) {
                    $engine->applyStockChange([
                        'productId' => $pi['productId'],
                        'warehouseId' => $warehouseId,
                        'quantityDelta' => -$pi['quantity'],
                        'type' => 'SALE_DISPATCH',
                        'unitCostUsd' => $pi['unitCostUsd'],
                        'reason' => "Sales Invoice {$invNumber}",
                        'allowNegativeStock' => !empty($body['allowNegativeStock']),
                    ]);
                }

                if ($dueUsd > 0) {
                    foreach ($engine->db['customers'] as &$c) {
                        if ($c['id'] === $customerId) {
                            $c['balanceUsd'] = ErpEngine::roundUsd((float)$c['balanceUsd'] + $dueUsd);
                            break;
                        }
                    }
                }

                $finAcc = $engine->findById('financialAccounts', $finAccId);
                if ($paidUsd > 0 && $finAcc) {
                    foreach ($engine->db['financialAccounts'] as &$fa) {
                        if ($fa['id'] === $finAcc['id']) {
                            $fa['balanceUsd'] = ErpEngine::roundUsd((float)$fa['balanceUsd'] + $paidUsd);
                            $fa['balanceOriginal'] = ErpEngine::fromUsd($fa['balanceUsd'], $fa['currency'], $rate);
                            break;
                        }
                    }
                }

                $jLines = [];
                if ($paidUsd > 0 && $finAcc) {
                    $jLines[] = ['accountId' => $finAcc['ledgerAccountId'], 'debitUsd' => $paidUsd, 'creditUsd' => 0];
                }
                if ($dueUsd > 0) {
                    $jLines[] = ['accountCode' => '1200', 'debitUsd' => $dueUsd, 'creditUsd' => 0];
                }
                if ($discountUsd > 0) {
                    $jLines[] = ['accountCode' => '4100', 'debitUsd' => $discountUsd, 'creditUsd' => 0];
                }
                if ($subtotalUsd > 0) {
                    $jLines[] = ['accountCode' => '4000', 'debitUsd' => 0, 'creditUsd' => $subtotalUsd];
                }
                if ($totalCostUsd > 0) {
                    $jLines[] = ['accountCode' => '5000', 'debitUsd' => $totalCostUsd, 'creditUsd' => 0];
                    $jLines[] = ['accountCode' => '1300', 'debitUsd' => 0, 'creditUsd' => $totalCostUsd];
                }
                if (count($jLines) >= 2) {
                    $jrn = $engine->postJournalEntry([
                        'description' => "Sales Invoice {$invNumber}",
                        'referenceType' => 'SALE',
                        'referenceId' => $invId,
                        'currency' => $currency,
                        'exchangeRate' => $rate,
                        'lines' => $jLines,
                    ]);
                    $invoice['journalEntryId'] = $jrn['id'];
                }
            }

            array_unshift($engine->db['salesInvoices'], $invoice);
            $engine->logAudit('SALE_CREATED', 'SALES', 'SalesInvoice', $invId, "Created Sales Invoice {$invNumber}");
            $engine->saveDatabase();
            echo json_encode(['invoice' => $engine->hydrateSalesInvoice($invoice)]);
            exit;
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
                            $engine->applyStockChange([
                                'productId' => $it['productId'],
                                'warehouseId' => $inv['warehouseId'],
                                'quantityDelta' => (float)$it['quantity'],
                                'type' => 'SALE_RETURN',
                                'reason' => "Sales Return {$inv['invoiceNumber']}",
                            ]);
                            $it['returnedQty'] = $it['quantity'];
                        }
                    }
                    if ((float)$inv['dueUsd'] > 0) {
                        foreach ($engine->db['customers'] as &$c) {
                            if ($c['id'] === $inv['customerId']) {
                                $c['balanceUsd'] = max(0, ErpEngine::roundUsd((float)$c['balanceUsd'] - (float)$inv['dueUsd']));
                            }
                        }
                    }
                    if (!empty($inv['journalEntryId'])) {
                        $engine->reverseJournalEntry($inv['journalEntryId'], $body['reason'] ?? 'Sales return');
                    }
                    $inv['status'] = 'RETURNED';
                    $inv['dueUsd'] = 0;
                    $inv['dueOriginal'] = 0;
                    $engine->saveDatabase();
                    echo json_encode(['invoice' => $engine->hydrateSalesInvoice($inv)]);
                    exit;
                }
            }
        }
    }

    // =========================================================================
    // 6. PURCHASES ENDPOINT
    // =========================================================================
    if ($route === 'purchases') {
        if ($method === 'GET') {
            $invoices = array_map([$engine, 'hydratePurchaseInvoice'], $engine->db['purchaseInvoices']);
            echo json_encode(['invoices' => $invoices]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'createInvoice') {
            $currency = $body['currency'] ?? 'USD';
            $rate = (float)($body['exchangeRate'] ?? ($engine->db['settings']['usdToIqdRate'] ?? 1500));
            $supplierId = $body['supplierId'];
            $warehouseId = $body['warehouseId'] ?: ($engine->db['warehouses'][0]['id'] ?? '');
            $status = $body['status'] ?? 'POSTED';

            $subtotalOrig = 0.0;
            $invId = ErpEngine::cuid('pinv_');
            $preparedItems = [];

            foreach ($body['items'] as $raw) {
                $prod = $engine->findById('products', $raw['productId']);
                if (!$prod) throw new Exception('Product not found');
                $qty = (float)$raw['quantity'];
                $costOrig = (float)$raw['unitCostOriginal'];
                $costUsd = ErpEngine::toUsd($costOrig, $currency, $rate);
                $lineTotalOrig = $qty * $costOrig;
                $lineTotalUsd = ErpEngine::toUsd($lineTotalOrig, $currency, $rate);
                $subtotalOrig += $lineTotalOrig;

                $preparedItems[] = [
                    'id' => ErpEngine::cuid('pitem_'),
                    'purchaseInvoiceId' => $invId,
                    'productId' => $prod['id'],
                    'productName' => $prod['nameEn'],
                    'sku' => $prod['sku'],
                    'quantity' => $qty,
                    'returnedQty' => 0,
                    'unitCostOriginal' => $costOrig,
                    'unitCostUsd' => $costUsd,
                    'discountOriginal' => 0,
                    'discountUsd' => 0,
                    'lineTotalOriginal' => $lineTotalOrig,
                    'lineTotalUsd' => $lineTotalUsd,
                ];
            }

            $totalOrig = max(0, $subtotalOrig - (float)($body['invoiceDiscountOriginal'] ?? 0) + (float)($body['shippingOriginal'] ?? 0));
            $totalUsd = ErpEngine::toUsd($totalOrig, $currency, $rate);
            $paymentType = $body['paymentType'] ?? 'CREDIT';
            $paidOrig = $paymentType === 'CASH' ? $totalOrig : ($paymentType === 'CREDIT' ? 0 : (float)($body['paidOriginal'] ?? 0));
            $dueOrig = max(0, $totalOrig - $paidOrig);
            $paidUsd = ($paidOrig == $totalOrig) ? $totalUsd : ErpEngine::toUsd($paidOrig, $currency, $rate);
            $dueUsd = ErpEngine::roundUsd($totalUsd - $paidUsd);

            $invNumber = sprintf('PUR-%s-%04d', date('Y'), count($engine->db['purchaseInvoices']) + 1);
            $finAccId = $body['financialAccountId'] ?: ($engine->db['financialAccounts'][0]['id'] ?? null);

            $invoice = [
                'id' => $invId,
                'invoiceNumber' => $invNumber,
                'supplierInvoiceRef' => $body['supplierInvoiceRef'] ?? null,
                'supplierId' => $supplierId,
                'warehouseId' => $warehouseId,
                'date' => ErpEngine::nowIso(),
                'dueDate' => $dueUsd > 0 ? gmdate('Y-m-d\TH:i:s.000\Z', time() + 30 * 86400) : null,
                'status' => $status === 'DRAFT' ? 'DRAFT' : ($dueUsd == 0 ? 'PAID' : ($paidUsd > 0 ? 'PARTIALLY_PAID' : 'POSTED')),
                'paymentType' => $dueUsd == 0 ? 'CASH' : ($paidUsd == 0 ? 'CREDIT' : 'PARTIAL'),
                'currency' => $currency,
                'exchangeRate' => $rate,
                'subtotalOriginal' => $subtotalOrig,
                'discountOriginal' => 0,
                'taxOriginal' => 0,
                'shippingOriginal' => (float)($body['shippingOriginal'] ?? 0),
                'totalOriginal' => $totalOrig,
                'paidOriginal' => $paidOrig,
                'dueOriginal' => $dueOrig,
                'subtotalUsd' => $totalUsd,
                'discountUsd' => 0,
                'taxUsd' => 0,
                'shippingUsd' => 0,
                'totalUsd' => $totalUsd,
                'paidUsd' => $paidUsd,
                'dueUsd' => $dueUsd,
                'financialAccountId' => $finAccId,
                'notes' => $body['notes'] ?? null,
            ];

            foreach ($preparedItems as $pi) {
                $engine->db['purchaseInvoiceItems'][] = $pi;
            }

            if ($status !== 'DRAFT') {
                foreach ($preparedItems as $pi) {
                    $engine->applyStockChange([
                        'productId' => $pi['productId'],
                        'warehouseId' => $warehouseId,
                        'quantityDelta' => $pi['quantity'],
                        'type' => 'PURCHASE_RECEIPT',
                        'unitCostUsd' => $pi['unitCostUsd'],
                        'reason' => "Purchase Invoice {$invNumber}",
                    ]);
                }

                if ($dueUsd > 0) {
                    foreach ($engine->db['suppliers'] as &$s) {
                        if ($s['id'] === $supplierId) {
                            $s['balanceUsd'] = ErpEngine::roundUsd((float)$s['balanceUsd'] + $dueUsd);
                            break;
                        }
                    }
                }

                $finAcc = $engine->findById('financialAccounts', $finAccId);
                if ($paidUsd > 0 && $finAcc) {
                    foreach ($engine->db['financialAccounts'] as &$fa) {
                        if ($fa['id'] === $finAcc['id']) {
                            $fa['balanceUsd'] = ErpEngine::roundUsd((float)$fa['balanceUsd'] - $paidUsd);
                            $fa['balanceOriginal'] = ErpEngine::fromUsd($fa['balanceUsd'], $fa['currency'], $rate);
                            break;
                        }
                    }
                }

                $jLines = [
                    ['accountCode' => '1300', 'debitUsd' => $totalUsd, 'creditUsd' => 0],
                ];
                if ($paidUsd > 0 && $finAcc) {
                    $jLines[] = ['accountId' => $finAcc['ledgerAccountId'], 'debitUsd' => 0, 'creditUsd' => $paidUsd];
                }
                if ($dueUsd > 0) {
                    $jLines[] = ['accountCode' => '2100', 'debitUsd' => 0, 'creditUsd' => $dueUsd];
                }
                $jrn = $engine->postJournalEntry([
                    'description' => "Purchase Invoice {$invNumber}",
                    'referenceType' => 'PURCHASE',
                    'referenceId' => $invId,
                    'currency' => $currency,
                    'exchangeRate' => $rate,
                    'lines' => $jLines,
                ]);
                $invoice['journalEntryId'] = $jrn['id'];
            }

            array_unshift($engine->db['purchaseInvoices'], $invoice);
            $engine->saveDatabase();
            echo json_encode(['invoice' => $engine->hydratePurchaseInvoice($invoice)]);
            exit;
        }
    }

    // =========================================================================
    // 7. EXPENSES ENDPOINT
    // =========================================================================
    if ($route === 'expenses') {
        if ($method === 'GET') {
            $list = [];
            foreach ($engine->db['expenses'] as $e) {
                $e['expenseAccount'] = $engine->findById('accounts', $e['expenseAccountId']);
                $e['financialAccount'] = $engine->findById('financialAccounts', $e['financialAccountId'] ?? null);
                $list[] = $e;
            }
            echo json_encode(['expenses' => $list]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'createExpense') {
            $currency = $body['currency'] ?? 'USD';
            $rate = (float)($body['exchangeRate'] ?? ($engine->db['settings']['usdToIqdRate'] ?? 1500));
            $amtOrig = (float)$body['amountOriginal'];
            $amtUsd = ErpEngine::toUsd($amtOrig, $currency, $rate);
            $threshold = (float)($engine->db['settings']['expenseApprovalThresholdUsd'] ?? 1000);
            $needsApproval = $amtUsd >= $threshold;

            $catMap = [
                'SALARIES' => '5110', 'RENT' => '5120', 'ELECTRICITY' => '5130',
                'TRANSPORTATION' => '5140', 'MAINTENANCE' => '5150', 'MARKETING' => '5160',
                'COMMUNICATION' => '5170', 'OFFICE_SUPPLIES' => '5180', 'MISCELLANEOUS' => '5190',
            ];
            $code = $catMap[$body['category'] ?? 'MISCELLANEOUS'] ?? '5190';
            $expAcc = $engine->findAccountByCodeOrId($code, null);
            $finAccId = $body['financialAccountId'] ?: ($engine->db['financialAccounts'][0]['id'] ?? null);
            $finAcc = $engine->findById('financialAccounts', $finAccId);

            $exp = [
                'id' => ErpEngine::cuid('exp_'),
                'expenseNumber' => sprintf('EXP-%s-%04d', date('Y'), count($engine->db['expenses']) + 1),
                'date' => ErpEngine::nowIso(),
                'category' => $body['category'] ?? 'MISCELLANEOUS',
                'title' => $body['title'],
                'vendorName' => $body['vendorName'] ?? null,
                'expenseAccountId' => $expAcc['id'],
                'financialAccountId' => $finAccId,
                'paymentMethod' => $body['paymentMethod'] ?? 'CASH',
                'currency' => $currency,
                'exchangeRate' => $rate,
                'amountOriginal' => $amtOrig,
                'amountUsd' => $amtUsd,
                'isRecurring' => !empty($body['isRecurring']),
                'recurringInterval' => $body['recurringInterval'] ?? null,
                'status' => $needsApproval ? 'PENDING_APPROVAL' : 'POSTED',
                'attachmentName' => $body['attachmentName'] ?? null,
            ];

            if (!$needsApproval && $finAcc) {
                $jrn = $engine->postJournalEntry([
                    'description' => "Expense {$exp['expenseNumber']}: {$exp['title']}",
                    'referenceType' => 'EXPENSE',
                    'referenceId' => $exp['id'],
                    'lines' => [
                        ['accountId' => $expAcc['id'], 'debitUsd' => $amtUsd, 'creditUsd' => 0],
                        ['accountId' => $finAcc['ledgerAccountId'], 'debitUsd' => 0, 'creditUsd' => $amtUsd],
                    ],
                ]);
                $exp['journalEntryId'] = $jrn['id'];
            }

            array_unshift($engine->db['expenses'], $exp);
            $engine->saveDatabase();
            echo json_encode(['expense' => $exp]);
            exit;
        }

        if ($action === 'approveExpense' || $action === 'rejectExpense') {
            foreach ($engine->db['expenses'] as &$e) {
                if ($e['id'] === $body['expenseId']) {
                    if ($action === 'rejectExpense') {
                        $e['status'] = 'REJECTED';
                    } else {
                        $e['status'] = 'POSTED';
                        $finAcc = $engine->findById('financialAccounts', $e['financialAccountId']) ?: $engine->db['financialAccounts'][0];
                        $jrn = $engine->postJournalEntry([
                            'description' => "Approved Expense {$e['expenseNumber']}: {$e['title']}",
                            'referenceType' => 'EXPENSE',
                            'referenceId' => $e['id'],
                            'lines' => [
                                ['accountId' => $e['expenseAccountId'], 'debitUsd' => $e['amountUsd'], 'creditUsd' => 0],
                                ['accountId' => $finAcc['ledgerAccountId'], 'debitUsd' => 0, 'creditUsd' => $e['amountUsd']],
                            ],
                        ]);
                        $e['journalEntryId'] = $jrn['id'];
                    }
                    $engine->saveDatabase();
                    echo json_encode(['expense' => $e]);
                    exit;
                }
            }
        }
    }

    // =========================================================================
    // 8. PARTIES (CUSTOMERS, SUPPLIERS, DEBTORS, CREDITORS) ENDPOINT
    // =========================================================================
    if ($route === 'parties') {
        if ($method === 'GET') {
            if (!empty($_GET['statementCustomerId'])) {
                $cid = $_GET['statementCustomerId'];
                $cust = $engine->findById('customers', $cid);
                $lines = [];
                $running = 0.0;
                foreach ($engine->db['salesInvoices'] as $inv) {
                    if ($inv['customerId'] === $cid && in_array($inv['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) {
                        $debit = (float)$inv['totalUsd'];
                        $credit = (float)$inv['paidUsd'];
                        $running = ErpEngine::roundUsd($running + $debit - $credit);
                        $lines[] = [
                            'date' => $inv['date'],
                            'reference' => $inv['invoiceNumber'],
                            'description' => "Sales Invoice ({$inv['paymentType']})",
                            'debitUsd' => $debit,
                            'creditUsd' => $credit,
                            'runningBalanceUsd' => $running,
                        ];
                    }
                }
                echo json_encode([
                    'statement' => [
                        'customer' => $cust,
                        'lines' => $lines,
                        'closingBalanceUsd' => (float)($cust['balanceUsd'] ?? 0),
                    ],
                ]);
                exit;
            }

            if (!empty($_GET['statementSupplierId'])) {
                $sid = $_GET['statementSupplierId'];
                $supp = $engine->findById('suppliers', $sid);
                $lines = [];
                $running = 0.0;
                foreach ($engine->db['purchaseInvoices'] as $inv) {
                    if ($inv['supplierId'] === $sid && in_array($inv['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) {
                        $credit = (float)$inv['totalUsd'];
                        $debit = (float)$inv['paidUsd'];
                        $running = ErpEngine::roundUsd($running + $credit - $debit);
                        $lines[] = [
                            'date' => $inv['date'],
                            'reference' => $inv['invoiceNumber'],
                            'description' => "Purchase Invoice ({$inv['paymentType']})",
                            'debitUsd' => $debit,
                            'creditUsd' => $credit,
                            'runningBalanceUsd' => $running,
                        ];
                    }
                }
                echo json_encode([
                    'statement' => [
                        'supplier' => $supp,
                        'lines' => $lines,
                        'closingBalanceUsd' => (float)($supp['balanceUsd'] ?? 0),
                    ],
                ]);
                exit;
            }

            $unpaidSales = [];
            foreach ($engine->db['salesInvoices'] as $s) {
                if (in_array($s['status'], ['POSTED', 'PARTIALLY_PAID']) && (float)$s['dueUsd'] > 0) {
                    $s['customer'] = $engine->findById('customers', $s['customerId']);
                    $unpaidSales[] = $s;
                }
            }
            $unpaidPurchases = [];
            foreach ($engine->db['purchaseInvoices'] as $p) {
                if (in_array($p['status'], ['POSTED', 'PARTIALLY_PAID']) && (float)$p['dueUsd'] > 0) {
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
            $openBal = ErpEngine::roundUsd($body['openingBalanceUsd'] ?? 0);
            $c = [
                'id' => ErpEngine::cuid('cus_'),
                'code' => sprintf('CUST-%03d', count($engine->db['customers']) + 1),
                'name' => trim($body['name']),
                'companyName' => $body['companyName'] ?? null,
                'phone' => $body['phone'] ?? '',
                'email' => $body['email'] ?? null,
                'city' => $body['city'] ?? 'Erbil',
                'creditLimitUsd' => (float)($body['creditLimitUsd'] ?? 10000),
                'balanceUsd' => $openBal,
                'openingBalanceUsd' => $openBal,
                'isActive' => true,
                'createdAt' => ErpEngine::nowIso(),
            ];
            $engine->db['customers'][] = $c;
            if ($openBal > 0) {
                $engine->postJournalEntry([
                    'description' => "Opening receivable balance for {$c['name']}",
                    'referenceType' => 'MANUAL',
                    'lines' => [
                        ['accountCode' => '1200', 'debitUsd' => $openBal, 'creditUsd' => 0],
                        ['accountCode' => '3000', 'debitUsd' => 0, 'creditUsd' => $openBal],
                    ],
                ]);
            }
            $engine->saveDatabase();
            echo json_encode(['customer' => $c]);
            exit;
        }

        if ($action === 'createSupplier') {
            $openBal = ErpEngine::roundUsd($body['openingBalanceUsd'] ?? 0);
            $s = [
                'id' => ErpEngine::cuid('sup_'),
                'code' => sprintf('SUPP-%03d', count($engine->db['suppliers']) + 1),
                'name' => trim($body['name']),
                'companyName' => $body['companyName'] ?? null,
                'phone' => $body['phone'] ?? '',
                'city' => $body['city'] ?? 'Erbil',
                'balanceUsd' => $openBal,
                'openingBalanceUsd' => $openBal,
                'isActive' => true,
                'createdAt' => ErpEngine::nowIso(),
            ];
            $engine->db['suppliers'][] = $s;
            if ($openBal > 0) {
                $engine->postJournalEntry([
                    'description' => "Opening payable balance for {$s['name']}",
                    'referenceType' => 'MANUAL',
                    'lines' => [
                        ['accountCode' => '3000', 'debitUsd' => $openBal, 'creditUsd' => 0],
                        ['accountCode' => '2100', 'debitUsd' => 0, 'creditUsd' => $openBal],
                    ],
                ]);
            }
            $engine->saveDatabase();
            echo json_encode(['supplier' => $s]);
            exit;
        }

        if ($action === 'collectDebt') {
            $currency = $body['currency'] ?? 'USD';
            $rate = (float)($body['exchangeRate'] ?? ($engine->db['settings']['usdToIqdRate'] ?? 1500));
            $amtOrig = (float)$body['amountOriginal'];
            $amtUsd = ErpEngine::toUsd($amtOrig, $currency, $rate);
            $finAcc = $engine->findById('financialAccounts', $body['financialAccountId'] ?? null) ?: $engine->db['financialAccounts'][0];

            $custName = '';
            foreach ($engine->db['customers'] as &$c) {
                if ($c['id'] === $body['customerId']) {
                    $c['balanceUsd'] = max(0, ErpEngine::roundUsd((float)$c['balanceUsd'] - $amtUsd));
                    $custName = $c['name'];
                    break;
                }
            }
            foreach ($engine->db['financialAccounts'] as &$fa) {
                if ($fa['id'] === $finAcc['id']) {
                    $fa['balanceUsd'] = ErpEngine::roundUsd((float)$fa['balanceUsd'] + $amtUsd);
                    $fa['balanceOriginal'] = ErpEngine::fromUsd($fa['balanceUsd'], $fa['currency'], $rate);
                    break;
                }
            }

            $payNum = sprintf('RCV-%s-%04d', date('Y'), count($engine->db['debtPayments']) + 1);
            $engine->postJournalEntry([
                'description' => "Debtor collection {$payNum} from {$custName}",
                'referenceType' => 'DEBTOR_COLLECTION',
                'lines' => [
                    ['accountId' => $finAcc['ledgerAccountId'], 'debitUsd' => $amtUsd, 'creditUsd' => 0],
                    ['accountCode' => '1200', 'debitUsd' => 0, 'creditUsd' => $amtUsd],
                ],
            ]);

            $payment = [
                'id' => ErpEngine::cuid('pay_'),
                'paymentNumber' => $payNum,
                'date' => ErpEngine::nowIso(),
                'type' => 'DEBTOR_COLLECTION',
                'customerId' => $body['customerId'],
                'financialAccountId' => $finAcc['id'],
                'paymentMethod' => $body['paymentMethod'] ?? 'CASH',
                'currency' => $currency,
                'exchangeRate' => $rate,
                'amountOriginal' => $amtOrig,
                'amountUsd' => $amtUsd,
                'notes' => $body['notes'] ?? null,
            ];
            array_unshift($engine->db['debtPayments'], $payment);
            $engine->saveDatabase();
            echo json_encode(['payment' => $payment]);
            exit;
        }

        if ($action === 'payCreditor') {
            $currency = $body['currency'] ?? 'USD';
            $rate = (float)($body['exchangeRate'] ?? ($engine->db['settings']['usdToIqdRate'] ?? 1500));
            $amtOrig = (float)$body['amountOriginal'];
            $amtUsd = ErpEngine::toUsd($amtOrig, $currency, $rate);
            $finAcc = $engine->findById('financialAccounts', $body['financialAccountId'] ?? null) ?: $engine->db['financialAccounts'][0];

            $suppName = '';
            foreach ($engine->db['suppliers'] as &$s) {
                if ($s['id'] === $body['supplierId']) {
                    $s['balanceUsd'] = max(0, ErpEngine::roundUsd((float)$s['balanceUsd'] - $amtUsd));
                    $suppName = $s['name'];
                    break;
                }
            }
            foreach ($engine->db['financialAccounts'] as &$fa) {
                if ($fa['id'] === $finAcc['id']) {
                    $fa['balanceUsd'] = ErpEngine::roundUsd((float)$fa['balanceUsd'] - $amtUsd);
                    $fa['balanceOriginal'] = ErpEngine::fromUsd($fa['balanceUsd'], $fa['currency'], $rate);
                    break;
                }
            }

            $payNum = sprintf('PAY-%s-%04d', date('Y'), count($engine->db['debtPayments']) + 1);
            $engine->postJournalEntry([
                'description' => "Creditor payment {$payNum} to {$suppName}",
                'referenceType' => 'CREDITOR_PAYMENT',
                'lines' => [
                    ['accountCode' => '2100', 'debitUsd' => $amtUsd, 'creditUsd' => 0],
                    ['accountId' => $finAcc['ledgerAccountId'], 'debitUsd' => 0, 'creditUsd' => $amtUsd],
                ],
            ]);

            $payment = [
                'id' => ErpEngine::cuid('pay_'),
                'paymentNumber' => $payNum,
                'date' => ErpEngine::nowIso(),
                'type' => 'CREDITOR_PAYMENT',
                'supplierId' => $body['supplierId'],
                'financialAccountId' => $finAcc['id'],
                'paymentMethod' => $body['paymentMethod'] ?? 'CASH',
                'currency' => $currency,
                'exchangeRate' => $rate,
                'amountOriginal' => $amtOrig,
                'amountUsd' => $amtUsd,
                'notes' => $body['notes'] ?? null,
            ];
            array_unshift($engine->db['debtPayments'], $payment);
            $engine->saveDatabase();
            echo json_encode(['payment' => $payment]);
            exit;
        }
    }

    // =========================================================================
    // 9. CASH & BANK ENDPOINT
    // =========================================================================
    if ($route === 'cashbank') {
        if ($method === 'GET') {
            $accs = [];
            foreach ($engine->db['financialAccounts'] as $fa) {
                $fa['ledgerAccount'] = $engine->findById('accounts', $fa['ledgerAccountId']);
                $accs[] = $fa;
            }
            $txs = [];
            foreach ($engine->db['cashTransactions'] as $ct) {
                $ct['financialAccount'] = $engine->findById('financialAccounts', $ct['financialAccountId']);
                $txs[] = $ct;
            }
            echo json_encode(['accounts' => $accs, 'transactions' => $txs]);
            exit;
        }

        $action = $body['action'] ?? '';
        $rate = (float)($engine->db['settings']['usdToIqdRate'] ?? 1500);

        if ($action === 'deposit' || $action === 'withdrawal') {
            $fa = $engine->findById('financialAccounts', $body['financialAccountId']);
            if (!$fa) throw new Exception('Financial account not found');
            $amtOrig = (float)$body['amountOriginal'];
            $amtUsd = ErpEngine::toUsd($amtOrig, $fa['currency'], $rate);
            $isDeposit = ($action === 'deposit');
            $deltaUsd = $isDeposit ? $amtUsd : -$amtUsd;

            $newBalUsd = 0.0;
            $newBalOrig = 0.0;
            foreach ($engine->db['financialAccounts'] as &$acc) {
                if ($acc['id'] === $fa['id']) {
                    $newBalUsd = ErpEngine::roundUsd((float)$acc['balanceUsd'] + $deltaUsd);
                    $newBalOrig = ErpEngine::fromUsd($newBalUsd, $acc['currency'], $rate);
                    $acc['balanceUsd'] = $newBalUsd;
                    $acc['balanceOriginal'] = $newBalOrig;
                    break;
                }
            }

            $desc = $body['description'] ?: ($isDeposit ? 'Capital Deposit' : 'Cash Withdrawal');
            $engine->postJournalEntry([
                'description' => $desc,
                'referenceType' => 'CASH_TRANSACTION',
                'lines' => $isDeposit
                    ? [
                        ['accountId' => $fa['ledgerAccountId'], 'debitUsd' => $amtUsd, 'creditUsd' => 0],
                        ['accountCode' => '3000', 'debitUsd' => 0, 'creditUsd' => $amtUsd],
                    ]
                    : [
                        ['accountCode' => '3200', 'debitUsd' => $amtUsd, 'creditUsd' => 0],
                        ['accountId' => $fa['ledgerAccountId'], 'debitUsd' => 0, 'creditUsd' => $amtUsd],
                    ],
            ]);

            $tx = [
                'id' => ErpEngine::cuid('ctx_'),
                'transactionNumber' => sprintf('CSH-%s-%05d', date('Y'), count($engine->db['cashTransactions']) + 1),
                'date' => ErpEngine::nowIso(),
                'type' => $isDeposit ? 'DEPOSIT' : 'WITHDRAWAL',
                'financialAccountId' => $fa['id'],
                'currency' => $fa['currency'],
                'exchangeRate' => $rate,
                'amountOriginal' => $amtOrig,
                'amountUsd' => $amtUsd,
                'direction' => $isDeposit ? 'IN' : 'OUT',
                'balanceAfterOriginal' => $newBalOrig,
                'balanceAfterUsd' => $newBalUsd,
                'description' => $desc,
            ];
            array_unshift($engine->db['cashTransactions'], $tx);
            $engine->saveDatabase();
            echo json_encode(['transaction' => $tx]);
            exit;
        }

        if ($action === 'transfer') {
            $from = $engine->findById('financialAccounts', $body['fromFinancialAccountId']);
            $to = $engine->findById('financialAccounts', $body['toFinancialAccountId']);
            if (!$from || !$to) throw new Exception('Accounts not found');
            $amtOrig = (float)$body['amountOriginal'];
            $amtUsd = ErpEngine::toUsd($amtOrig, $from['currency'], $rate);

            foreach ($engine->db['financialAccounts'] as &$acc) {
                if ($acc['id'] === $from['id']) {
                    $acc['balanceUsd'] = ErpEngine::roundUsd((float)$acc['balanceUsd'] - $amtUsd);
                    $acc['balanceOriginal'] = ErpEngine::fromUsd($acc['balanceUsd'], $acc['currency'], $rate);
                } elseif ($acc['id'] === $to['id']) {
                    $acc['balanceUsd'] = ErpEngine::roundUsd((float)$acc['balanceUsd'] + $amtUsd);
                    $acc['balanceOriginal'] = ErpEngine::fromUsd($acc['balanceUsd'], $acc['currency'], $rate);
                }
            }

            $desc = $body['description'] ?: "Transfer from {$from['nameEn']} to {$to['nameEn']}";
            $engine->postJournalEntry([
                'description' => $desc,
                'referenceType' => 'CASH_TRANSACTION',
                'lines' => [
                    ['accountId' => $to['ledgerAccountId'], 'debitUsd' => $amtUsd, 'creditUsd' => 0],
                    ['accountId' => $from['ledgerAccountId'], 'debitUsd' => 0, 'creditUsd' => $amtUsd],
                ],
            ]);

            $engine->saveDatabase();
            echo json_encode(['success' => true]);
            exit;
        }
    }

    // =========================================================================
    // 10. ACCOUNTING ENGINE ENDPOINT
    // =========================================================================
    if ($route === 'accounting') {
        if ($method === 'GET') {
            $hydratedJournals = array_map([$engine, 'hydrateJournal'], array_slice($engine->db['journals'], 0, 100));
            echo json_encode([
                'accounts' => $engine->db['accounts'],
                'journals' => $hydratedJournals,
                'trialBalance' => $engine->getTrialBalance(),
                'profitAndLoss' => $engine->getProfitAndLoss(),
                'balanceSheet' => $engine->getBalanceSheet(),
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
            $acc = [
                'id' => ErpEngine::cuid('acc_'),
                'code' => trim($body['code']),
                'nameEn' => trim($body['nameEn']),
                'nameAr' => trim($body['nameAr'] ?: $body['nameEn']),
                'nameKu' => trim($body['nameKu'] ?: $body['nameEn']),
                'type' => $type,
                'subType' => $type,
                'normalBalance' => in_array($type, ['ASSET', 'EXPENSE']) ? 'DEBIT' : 'CREDIT',
                'isSystem' => false,
                'isActive' => true,
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
    // 11. SETTINGS, EMPLOYEES & BACKUP ENDPOINT
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
                'rateHistory' => $engine->db['rateHistory'],
                'users' => $engine->db['users'],
                'rolePermissions' => $rpList,
                'auditLogs' => array_slice($engine->db['auditLogs'], 0, 100),
            ]);
            exit;
        }

        $action = $body['action'] ?? '';
        if ($action === 'updateSettings') {
            $oldRate = (float)($engine->db['settings']['usdToIqdRate'] ?? 1500);
            $newRate = (float)($body['usdToIqdRate'] ?? $oldRate);

            foreach (['companyNameEn', 'companyNameAr', 'companyNameKu', 'phone', 'email', 'taxNumber', 'salesInvoicePrefix', 'purchaseInvoicePrefix'] as $k) {
                if (isset($body[$k])) $engine->db['settings'][$k] = $body[$k];
            }
            $engine->db['settings']['usdToIqdRate'] = $newRate;
            if (isset($body['expenseApprovalThresholdUsd'])) {
                $engine->db['settings']['expenseApprovalThresholdUsd'] = (float)$body['expenseApprovalThresholdUsd'];
            }
            if (isset($body['allowNegativeStock'])) {
                $engine->db['settings']['allowNegativeStock'] = !empty($body['allowNegativeStock']);
            }

            if ($newRate != $oldRate) {
                array_unshift($engine->db['rateHistory'], [
                    'id' => ErpEngine::cuid('rh_'),
                    'fromCurrency' => 'USD',
                    'toCurrency' => 'IQD',
                    'rate' => $newRate,
                    'effectiveDate' => ErpEngine::nowIso(),
                    'notes' => "Updated rate from {$oldRate} to {$newRate} IQD/USD",
                ]);
            }
            $engine->logAudit('SETTINGS_UPDATED', 'SETTINGS', 'CompanySettings', null, "Updated company settings (1 USD = {$newRate} IQD)");
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
                    'version' => '1.0.0-PHP8',
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
    http_response_code(400);
    echo json_encode(['error' => $e->getMessage()]);
}
