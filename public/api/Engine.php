<?php
/**
 * SHERZAD ENTERPRISE ERP & DOUBLE-ENTRY ACCOUNTING ENGINE (PURE PHP 8)
 * Compatible with Hostinger Shared/Business/Cloud Web Hosting (PHP 8.x + MySQL / Transactional Store)
 */

require_once __DIR__ . '/config.php';

class ErpEngine
{
    public array $db = [];
    private ?PDO $pdo = null;

    public function __construct()
    {
        if (!is_dir(ERP_STORAGE_DIR)) {
            @mkdir(ERP_STORAGE_DIR, 0775, true);
        }
        $this->loadDatabase();
    }

    private function getPdo(): ?PDO
    {
        if (!DB_USE_MYSQL) {
            return null;
        }
        if ($this->pdo !== null) {
            return $this->pdo;
        }
        try {
            $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', DB_HOST, DB_PORT, DB_NAME);
            $this->pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
            $this->pdo->exec("
                CREATE TABLE IF NOT EXISTS `erp_state_store` (
                  `store_key` VARCHAR(64) NOT NULL PRIMARY KEY,
                  `payload_json` LONGTEXT NOT NULL,
                  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            ");
            return $this->pdo;
        } catch (Throwable $e) {
            return null;
        }
    }

    public function loadDatabase(): void
    {
        $pdo = $this->getPdo();
        if ($pdo) {
            $stmt = $pdo->prepare("SELECT payload_json FROM erp_state_store WHERE store_key = 'MAIN_STATE' LIMIT 1");
            $stmt->execute();
            $row = $stmt->fetch();
            if ($row && !empty($row['payload_json'])) {
                $decoded = json_decode($row['payload_json'], true);
                if (is_array($decoded)) {
                    $this->db = $decoded;
                    return;
                }
            }
        }

        if (!file_exists(ERP_DB_FILE)) {
            $seedFile = ERP_STORAGE_DIR . '/initial_seed.json';
            if (file_exists($seedFile)) {
                copy($seedFile, ERP_DB_FILE);
            }
        }

        if (file_exists(ERP_DB_FILE)) {
            $raw = file_get_contents(ERP_DB_FILE);
            $decoded = json_decode($raw ?: '{}', true);
            $this->db = is_array($decoded) ? $decoded : [];
        }

        if ($pdo && !empty($this->db)) {
            $this->saveDatabase();
        }
    }

    public function saveDatabase(): void
    {
        $json = json_encode($this->db, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

        // Save to atomic locked file
        $fp = fopen(ERP_LOCK_FILE, 'c+');
        if ($fp && flock($fp, LOCK_EX)) {
            file_put_contents(ERP_DB_FILE, $json);
            flock($fp, LOCK_UN);
            fclose($fp);
        } else {
            file_put_contents(ERP_DB_FILE, $json);
        }

        // Also sync to Hostinger MySQL if DB_USE_MYSQL is enabled
        $pdo = $this->getPdo();
        if ($pdo) {
            $stmt = $pdo->prepare("
                INSERT INTO erp_state_store (store_key, payload_json)
                VALUES ('MAIN_STATE', :payload)
                ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json)
            ");
            $stmt->execute([':payload' => $json]);
        }
    }

    public static function cuid(string $prefix = 'id_'): string
    {
        return $prefix . bin2hex(random_bytes(8));
    }

    public static function nowIso(): string
    {
        return gmdate('Y-m-d\TH:i:s.000\Z');
    }

    public static function roundUsd($val): float
    {
        return round((float)$val, 2, PHP_ROUND_HALF_UP);
    }

    public static function roundCurr($val, string $currency): float
    {
        return $currency === 'IQD'
            ? round((float)$val, 0, PHP_ROUND_HALF_UP)
            : self::roundUsd($val);
    }

    public static function toUsd($amountOrig, string $currency, $exchangeRate): float
    {
        $amt = (float)$amountOrig;
        if ($currency === 'USD') {
            return self::roundUsd($amt);
        }
        $rate = (float)$exchangeRate > 0 ? (float)$exchangeRate : 1500.0;
        return self::roundUsd($amt / $rate);
    }

    public static function fromUsd($amountUsd, string $targetCurrency, $exchangeRate): float
    {
        $amt = (float)$amountUsd;
        if ($targetCurrency === 'USD') {
            return self::roundUsd($amt);
        }
        $rate = (float)$exchangeRate > 0 ? (float)$exchangeRate : 1500.0;
        return round($amt * $rate, 0, PHP_ROUND_HALF_UP);
    }

    public function getCurrentUser(): ?array
    {
        $activeId = $this->db['activeUserId'] ?? null;
        if ($activeId) {
            foreach ($this->db['users'] as $u) {
                if ($u['id'] === $activeId && !empty($u['isActive'])) {
                    return $u;
                }
            }
        }
        foreach ($this->db['users'] as $u) {
            if (!empty($u['isActive'])) {
                return $u;
            }
        }
        return null;
    }

    public function logAudit(string $action, string $module, string $entityType, ?string $entityId, string $description): void
    {
        $user = $this->getCurrentUser();
        array_unshift($this->db['auditLogs'], [
            'id' => self::cuid('aud_'),
            'userId' => $user['id'] ?? null,
            'userName' => $user['name'] ?? 'System Admin',
            'userRole' => $user['role'] ?? 'SUPER_ADMIN',
            'action' => $action,
            'module' => $module,
            'entityType' => $entityType,
            'entityId' => $entityId,
            'description' => $description,
            'createdAt' => self::nowIso(),
        ]);
    }

    public function findById(string $collection, ?string $id): ?array
    {
        if (!$id || empty($this->db[$collection])) return null;
        foreach ($this->db[$collection] as $item) {
            if ($item['id'] === $id) return $item;
        }
        return null;
    }

    public function findAccountByCodeOrId(?string $code, ?string $id): ?array
    {
        foreach ($this->db['accounts'] as $acc) {
            if (($id && $acc['id'] === $id) || ($code && $acc['code'] === $code)) {
                return $acc;
            }
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // DOUBLE-ENTRY JOURNAL POSTING ENGINE
    // -------------------------------------------------------------------------
    public function postJournalEntry(array $input): array
    {
        $entryDate = $input['date'] ?? self::nowIso();

        // Check locked accounting periods
        $entryTs = strtotime($entryDate);
        foreach ($this->db['periods'] as $period) {
            if (!empty($period['isLocked']) || !empty($period['isClosed'])) {
                if ($entryTs >= strtotime($period['startDate']) && $entryTs <= strtotime($period['endDate'])) {
                    throw new Exception("Cannot post transactions into locked accounting period '{$period['name']}'.");
                }
            }
        }

        $currency = $input['currency'] ?? 'USD';
        $exchangeRate = (float)($input['exchangeRate'] ?? ($this->db['settings']['usdToIqdRate'] ?? 1500));
        $rawLines = $input['lines'] ?? [];

        if (count($rawLines) < 2) {
            throw new Exception('Double-entry journal requires at least two lines (debit and credit).');
        }

        $activeLines = [];
        $totalDebitUsd = 0.0;
        $totalCreditUsd = 0.0;

        foreach ($rawLines as $line) {
            $debitUsd = self::roundUsd($line['debitUsd'] ?? 0);
            $creditUsd = self::roundUsd($line['creditUsd'] ?? 0);
            if ($debitUsd == 0 && $creditUsd == 0) continue;
            if ($debitUsd < 0 || $creditUsd < 0) {
                throw new Exception('Journal line amounts cannot be negative.');
            }
            if ($debitUsd > 0 && $creditUsd > 0) {
                throw new Exception('A single journal line cannot have both debit and credit > 0.');
            }

            $account = $this->findAccountByCodeOrId($line['accountCode'] ?? null, $line['accountId'] ?? null);
            if (!$account) {
                throw new Exception('Account not found for journal line.');
            }

            $totalDebitUsd = self::roundUsd($totalDebitUsd + $debitUsd);
            $totalCreditUsd = self::roundUsd($totalCreditUsd + $creditUsd);

            $activeLines[] = [
                'id' => self::cuid('jl_'),
                'accountId' => $account['id'],
                'description' => $line['description'] ?? $input['description'],
                'debitUsd' => $debitUsd,
                'creditUsd' => $creditUsd,
                'debitOriginal' => self::fromUsd($debitUsd, $currency, $exchangeRate),
                'creditOriginal' => self::fromUsd($creditUsd, $currency, $exchangeRate),
                'currency' => $currency,
                'customerId' => $line['customerId'] ?? null,
                'supplierId' => $line['supplierId'] ?? null,
            ];
        }

        if (count($activeLines) < 2) {
            throw new Exception('Double-entry journal requires at least two non-zero lines.');
        }

        if (abs($totalDebitUsd - $totalCreditUsd) > 0.001) {
            throw new Exception(sprintf(
                'Unbalanced journal entry rejected: Total Debits ($%.2f) !== Total Credits ($%.2f).',
                $totalDebitUsd,
                $totalCreditUsd
            ));
        }

        $count = count($this->db['journals']) + 1;
        $entryId = self::cuid('jrn_');
        $entryNumber = sprintf('JRN-%s-%05d', date('Y'), $count);

        $entry = [
            'id' => $entryId,
            'entryNumber' => $entryNumber,
            'date' => $entryDate,
            'description' => $input['description'],
            'referenceType' => $input['referenceType'] ?? 'MANUAL',
            'referenceId' => $input['referenceId'] ?? null,
            'currency' => $currency,
            'exchangeRate' => $exchangeRate,
            'totalDebitUsd' => $totalDebitUsd,
            'totalCreditUsd' => $totalCreditUsd,
            'status' => 'POSTED',
            'reversedByEntryId' => null,
            'reversesEntryId' => $input['reversesEntryId'] ?? null,
            'isDemo' => false,
            'createdById' => $this->getCurrentUser()['id'] ?? null,
            'createdAt' => self::nowIso(),
        ];

        array_unshift($this->db['journals'], $entry);

        foreach ($activeLines as &$al) {
            $al['journalEntryId'] = $entryId;
            $this->db['journalLines'][] = $al;

            // Update Account running balance
            foreach ($this->db['accounts'] as &$acc) {
                if ($acc['id'] === $al['accountId']) {
                    $delta = ($acc['normalBalance'] === 'DEBIT')
                        ? ($al['debitUsd'] - $al['creditUsd'])
                        : ($al['creditUsd'] - $al['debitUsd']);
                    $acc['balanceUsd'] = self::roundUsd((float)$acc['balanceUsd'] + $delta);
                    break;
                }
            }
        }

        return $this->hydrateJournal($entry);
    }

    public function reverseJournalEntry(string $journalEntryId, string $reason): array
    {
        $original = null;
        foreach ($this->db['journals'] as $j) {
            if ($j['id'] === $journalEntryId) {
                $original = $j;
                break;
            }
        }
        if (!$original) {
            throw new Exception('Journal entry not found.');
        }
        if ($original['status'] === 'REVERSED' || !empty($original['reversedByEntryId'])) {
            throw new Exception("Journal entry {$original['entryNumber']} has already been reversed.");
        }

        $origLines = array_filter($this->db['journalLines'], fn($l) => $l['journalEntryId'] === $journalEntryId);
        $revLines = [];
        foreach ($origLines as $ol) {
            $revLines[] = [
                'accountId' => $ol['accountId'],
                'description' => "Reversal of {$original['entryNumber']}: " . ($ol['description'] ?? ''),
                'debitUsd' => $ol['creditUsd'],
                'creditUsd' => $ol['debitUsd'],
                'customerId' => $ol['customerId'] ?? null,
                'supplierId' => $ol['supplierId'] ?? null,
            ];
        }

        $reversal = $this->postJournalEntry([
            'description' => "Reversal of {$original['entryNumber']} — {$reason}",
            'referenceType' => 'REVERSAL',
            'referenceId' => $original['id'],
            'reversesEntryId' => $original['id'],
            'currency' => $original['currency'],
            'exchangeRate' => $original['exchangeRate'],
            'lines' => $revLines,
        ]);

        foreach ($this->db['journals'] as &$j) {
            if ($j['id'] === $journalEntryId) {
                $j['status'] = 'REVERSED';
                $j['reversedByEntryId'] = $reversal['id'];
                break;
            }
        }

        return $reversal;
    }

    // -------------------------------------------------------------------------
    // INVENTORY STOCK MOVEMENT ENGINE
    // -------------------------------------------------------------------------
    public function applyStockChange(array $input): array
    {
        $productId = $input['productId'];
        $warehouseId = $input['warehouseId'];
        $delta = (float)$input['quantityDelta'];
        if ($delta == 0) {
            throw new Exception('Stock quantity change cannot be zero.');
        }

        $productIdx = null;
        foreach ($this->db['products'] as $idx => $p) {
            if ($p['id'] === $productId) {
                $productIdx = $idx;
                break;
            }
        }
        if ($productIdx === null) {
            throw new Exception('Product not found.');
        }
        $product = &$this->db['products'][$productIdx];

        $whIdx = null;
        foreach ($this->db['warehouseStocks'] as $idx => $ws) {
            if ($ws['productId'] === $productId && $ws['warehouseId'] === $warehouseId) {
                $whIdx = $idx;
                break;
            }
        }

        $beforeQty = $whIdx !== null ? (float)$this->db['warehouseStocks'][$whIdx]['quantity'] : 0.0;
        $afterQty = $beforeQty + $delta;

        $allowNeg = !empty($input['allowNegativeStock']) || !empty($this->db['settings']['allowNegativeStock']);
        if ($afterQty < 0 && !$allowNeg) {
            throw new Exception("Insufficient stock for '{$product['nameEn']}' (SKU: {$product['sku']}). Available: {$beforeQty}, Requested: " . abs($delta));
        }

        if ($whIdx !== null) {
            $this->db['warehouseStocks'][$whIdx]['quantity'] = $afterQty;
        } else {
            $this->db['warehouseStocks'][] = [
                'id' => self::cuid('ws_'),
                'productId' => $productId,
                'warehouseId' => $warehouseId,
                'quantity' => $afterQty,
                'updatedAt' => self::nowIso(),
            ];
        }

        $product['totalStock'] = (float)$product['totalStock'] + $delta;
        $unitCost = isset($input['unitCostUsd']) ? self::roundUsd($input['unitCostUsd']) : self::roundUsd($product['purchaseCostUsd']);

        $movement = [
            'id' => self::cuid('mov_'),
            'productId' => $productId,
            'warehouseId' => $warehouseId,
            'type' => $input['type'],
            'quantity' => $delta,
            'beforeQty' => $beforeQty,
            'afterQty' => $afterQty,
            'unitCostUsd' => $unitCost,
            'referenceType' => $input['referenceType'] ?? $input['type'],
            'referenceId' => $input['referenceId'] ?? null,
            'reason' => $input['reason'] ?? null,
            'createdAt' => self::nowIso(),
        ];
        array_unshift($this->db['movements'], $movement);

        if (!empty($input['postJournalForAdjustment'])) {
            $valUsd = self::roundUsd(abs($delta) * $unitCost);
            if ($valUsd > 0) {
                if ($input['type'] === 'OPENING_STOCK') {
                    $this->postJournalEntry([
                        'description' => "Opening stock for {$product['nameEn']} ({$delta} {$product['unit']})",
                        'referenceType' => 'STOCK_ADJUSTMENT',
                        'referenceId' => $movement['id'],
                        'lines' => [
                            ['accountCode' => '1300', 'debitUsd' => $valUsd, 'creditUsd' => 0],
                            ['accountCode' => '3000', 'debitUsd' => 0, 'creditUsd' => $valUsd],
                        ],
                    ]);
                } elseif ($delta > 0) {
                    $this->postJournalEntry([
                        'description' => "Stock adjustment surplus: {$product['nameEn']} (+{$delta}) — " . ($input['reason'] ?? ''),
                        'referenceType' => 'STOCK_ADJUSTMENT',
                        'referenceId' => $movement['id'],
                        'lines' => [
                            ['accountCode' => '1300', 'debitUsd' => $valUsd, 'creditUsd' => 0],
                            ['accountCode' => '5200', 'debitUsd' => 0, 'creditUsd' => $valUsd],
                        ],
                    ]);
                } else {
                    $this->postJournalEntry([
                        'description' => "Stock adjustment reduction: {$product['nameEn']} ({$delta}) — " . ($input['reason'] ?? ''),
                        'referenceType' => 'STOCK_ADJUSTMENT',
                        'referenceId' => $movement['id'],
                        'lines' => [
                            ['accountCode' => '5200', 'debitUsd' => $valUsd, 'creditUsd' => 0],
                            ['accountCode' => '1300', 'debitUsd' => 0, 'creditUsd' => $valUsd],
                        ],
                    ]);
                }
            }
        }

        return [
            'movement' => $this->hydrateMovement($movement),
            'warehouseQuantity' => $afterQty,
            'totalStock' => $product['totalStock'],
        ];
    }

    // -------------------------------------------------------------------------
    // HYDRATION HELPERS
    // -------------------------------------------------------------------------
    public function hydrateProduct(array $p): array
    {
        $p['category'] = $this->findById('categories', $p['categoryId']);
        $wsList = [];
        foreach ($this->db['warehouseStocks'] as $ws) {
            if ($ws['productId'] === $p['id']) {
                $ws['warehouse'] = $this->findById('warehouses', $ws['warehouseId']);
                $wsList[] = $ws;
            }
        }
        $p['warehouseStocks'] = $wsList;
        return $p;
    }

    public function hydrateMovement(array $m): array
    {
        $m['product'] = $this->findById('products', $m['productId']);
        $m['warehouse'] = $this->findById('warehouses', $m['warehouseId']);
        return $m;
    }

    public function hydrateTransfer(array $t): array
    {
        $t['product'] = $this->findById('products', $t['productId']);
        $t['fromWarehouse'] = $this->findById('warehouses', $t['fromWarehouseId']);
        $t['toWarehouse'] = $this->findById('warehouses', $t['toWarehouseId']);
        return $t;
    }

    public function hydrateSalesInvoice(array $inv): array
    {
        $inv['customer'] = $this->findById('customers', $inv['customerId']);
        $inv['warehouse'] = $this->findById('warehouses', $inv['warehouseId']);
        $inv['financialAccount'] = $this->findById('financialAccounts', $inv['financialAccountId'] ?? null);
        $items = [];
        foreach ($this->db['salesInvoiceItems'] as $it) {
            if ($it['salesInvoiceId'] === $inv['id']) {
                $items[] = $it;
            }
        }
        $inv['items'] = $items;
        return $inv;
    }

    public function hydratePurchaseInvoice(array $inv): array
    {
        $inv['supplier'] = $this->findById('suppliers', $inv['supplierId']);
        $inv['warehouse'] = $this->findById('warehouses', $inv['warehouseId']);
        $inv['financialAccount'] = $this->findById('financialAccounts', $inv['financialAccountId'] ?? null);
        $items = [];
        foreach ($this->db['purchaseInvoiceItems'] as $it) {
            if ($it['purchaseInvoiceId'] === $inv['id']) {
                $items[] = $it;
            }
        }
        $inv['items'] = $items;
        return $inv;
    }

    public function hydrateJournal(array $j): array
    {
        $lines = [];
        foreach ($this->db['journalLines'] as $l) {
            if ($l['journalEntryId'] === $j['id']) {
                $l['account'] = $this->findById('accounts', $l['accountId']);
                $lines[] = $l;
            }
        }
        $j['lines'] = $lines;
        return $j;
    }

    // -------------------------------------------------------------------------
    // FINANCIAL STATEMENTS (TRIAL BALANCE, P&L, BALANCE SHEET, GENERAL LEDGER)
    // -------------------------------------------------------------------------
    public function getTrialBalance(): array
    {
        $map = [];
        foreach ($this->db['accounts'] as $acc) {
            $map[$acc['id']] = [
                'accountId' => $acc['id'],
                'code' => $acc['code'],
                'nameEn' => $acc['nameEn'],
                'nameAr' => $acc['nameAr'],
                'nameKu' => $acc['nameKu'],
                'type' => $acc['type'],
                'normalBalance' => $acc['normalBalance'],
                'totalDebitUsd' => 0.0,
                'totalCreditUsd' => 0.0,
                'debitBalanceUsd' => 0.0,
                'creditBalanceUsd' => 0.0,
            ];
        }

        foreach ($this->db['journalLines'] as $line) {
            $aid = $line['accountId'];
            if (isset($map[$aid])) {
                $map[$aid]['totalDebitUsd'] = self::roundUsd($map[$aid]['totalDebitUsd'] + (float)$line['debitUsd']);
                $map[$aid]['totalCreditUsd'] = self::roundUsd($map[$aid]['totalCreditUsd'] + (float)$line['creditUsd']);
            }
        }

        $rows = [];
        $sumDebits = 0.0;
        $sumCredits = 0.0;
        $sumDebitBal = 0.0;
        $sumCreditBal = 0.0;

        foreach ($map as $r) {
            if ($r['totalDebitUsd'] == 0 && $r['totalCreditUsd'] == 0) continue;
            $net = self::roundUsd($r['totalDebitUsd'] - $r['totalCreditUsd']);
            if ($net > 0) {
                $r['debitBalanceUsd'] = $net;
            } elseif ($net < 0) {
                $r['creditBalanceUsd'] = abs($net);
            }
            $sumDebits = self::roundUsd($sumDebits + $r['totalDebitUsd']);
            $sumCredits = self::roundUsd($sumCredits + $r['totalCreditUsd']);
            $sumDebitBal = self::roundUsd($sumDebitBal + $r['debitBalanceUsd']);
            $sumCreditBal = self::roundUsd($sumCreditBal + $r['creditBalanceUsd']);
            $rows[] = $r;
        }

        return [
            'rows' => $rows,
            'totalDebitUsd' => $sumDebits,
            'totalCreditUsd' => $sumCredits,
            'totalDebitBalanceUsd' => $sumDebitBal,
            'totalCreditBalanceUsd' => $sumCreditBal,
            'isBalanced' => (abs($sumDebits - $sumCredits) < 0.01) && (abs($sumDebitBal - $sumCreditBal) < 0.01),
        ];
    }

    public function getProfitAndLoss(): array
    {
        $accMap = [];
        foreach ($this->db['accounts'] as $acc) {
            $accMap[$acc['id']] = $acc;
        }

        $grossSales = 0.0;
        $salesReturns = 0.0;
        $salesDiscounts = 0.0;
        $otherIncome = 0.0;
        $cogs = 0.0;
        $invAdj = 0.0;
        $opExTotal = 0.0;
        $opBreakdown = [];

        foreach ($this->db['journalLines'] as $line) {
            $acc = $accMap[$line['accountId']] ?? null;
            if (!$acc) continue;
            $debit = (float)$line['debitUsd'];
            $credit = (float)$line['creditUsd'];

            if ($acc['type'] === 'REVENUE') {
                if ($acc['code'] === '4050' || $acc['subType'] === 'SALES_RETURN') {
                    $salesReturns += ($debit - $credit);
                } elseif ($acc['code'] === '4100' || $acc['subType'] === 'SALES_DISCOUNT') {
                    $salesDiscounts += ($debit - $credit);
                } elseif ($acc['code'] === '4200' || $acc['subType'] === 'OTHER_INCOME') {
                    $otherIncome += ($credit - $debit);
                } else {
                    $grossSales += ($credit - $debit);
                }
            } elseif ($acc['type'] === 'EXPENSE') {
                $amt = $debit - $credit;
                if ($acc['code'] === '5000') {
                    $cogs += $amt;
                } elseif ($acc['code'] === '5200') {
                    $invAdj += $amt;
                } else {
                    $opExTotal += $amt;
                    $code = $acc['code'];
                    if (!isset($opBreakdown[$code])) {
                        $opBreakdown[$code] = [
                            'code' => $code,
                            'nameEn' => $acc['nameEn'],
                            'nameAr' => $acc['nameAr'],
                            'nameKu' => $acc['nameKu'],
                            'amountUsd' => 0.0,
                        ];
                    }
                    $opBreakdown[$code]['amountUsd'] = self::roundUsd($opBreakdown[$code]['amountUsd'] + $amt);
                }
            }
        }

        $netSales = self::roundUsd($grossSales - $salesReturns - $salesDiscounts);
        $totalRev = self::roundUsd($netSales + $otherIncome);
        $totalCogs = self::roundUsd($cogs + $invAdj);
        $grossProfit = self::roundUsd($totalRev - $totalCogs);
        $netProfit = self::roundUsd($grossProfit - $opExTotal);

        $grossMargin = $totalRev > 0 ? self::roundUsd(($grossProfit / $totalRev) * 100) : 0;
        $netMargin = $totalRev > 0 ? self::roundUsd(($netProfit / $totalRev) * 100) : 0;

        // Profit by product and category
        $prodMap = [];
        $catMap = [];
        foreach ($this->db['salesInvoices'] as $inv) {
            if (!in_array($inv['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) continue;
            foreach ($this->db['salesInvoiceItems'] as $item) {
                if ($item['salesInvoiceId'] !== $inv['id']) continue;
                $netQty = (float)$item['quantity'] - (float)($item['returnedQty'] ?? 0);
                if ($netQty <= 0) continue;
                $p = $this->findById('products', $item['productId']);
                if (!$p) continue;
                $cat = $this->findById('categories', $p['categoryId']);

                $rev = self::roundUsd((float)$item['lineTotalUsd'] - (float)($item['taxUsd'] ?? 0));
                $cost = self::roundUsd((float)$item['unitCostUsd'] * $netQty);
                $prof = self::roundUsd($rev - $cost);

                $pid = $p['id'];
                if (!isset($prodMap[$pid])) {
                    $prodMap[$pid] = [
                        'productId' => $pid,
                        'sku' => $p['sku'],
                        'nameEn' => $p['nameEn'],
                        'nameAr' => $p['nameAr'],
                        'nameKu' => $p['nameKu'],
                        'quantitySold' => 0,
                        'revenueUsd' => 0.0,
                        'costUsd' => 0.0,
                        'profitUsd' => 0.0,
                    ];
                }
                $prodMap[$pid]['quantitySold'] += $netQty;
                $prodMap[$pid]['revenueUsd'] = self::roundUsd($prodMap[$pid]['revenueUsd'] + $rev);
                $prodMap[$pid]['costUsd'] = self::roundUsd($prodMap[$pid]['costUsd'] + $cost);
                $prodMap[$pid]['profitUsd'] = self::roundUsd($prodMap[$pid]['profitUsd'] + $prof);

                if ($cat) {
                    $cid = $cat['id'];
                    if (!isset($catMap[$cid])) {
                        $catMap[$cid] = [
                            'categoryId' => $cid,
                            'nameEn' => $cat['nameEn'],
                            'nameAr' => $cat['nameAr'],
                            'nameKu' => $cat['nameKu'],
                            'revenueUsd' => 0.0,
                            'costUsd' => 0.0,
                            'profitUsd' => 0.0,
                        ];
                    }
                    $catMap[$cid]['revenueUsd'] = self::roundUsd($catMap[$cid]['revenueUsd'] + $rev);
                    $catMap[$cid]['costUsd'] = self::roundUsd($catMap[$cid]['costUsd'] + $cost);
                    $catMap[$cid]['profitUsd'] = self::roundUsd($catMap[$cid]['profitUsd'] + $prof);
                }
            }
        }

        return [
            'grossSalesRevenueUsd' => self::roundUsd($grossSales),
            'salesReturnsUsd' => self::roundUsd($salesReturns),
            'salesDiscountsUsd' => self::roundUsd($salesDiscounts),
            'netSalesRevenueUsd' => $netSales,
            'otherIncomeUsd' => self::roundUsd($otherIncome),
            'totalRevenueUsd' => $totalRev,
            'costOfGoodsSoldUsd' => self::roundUsd($cogs),
            'inventoryAdjustmentsUsd' => self::roundUsd($invAdj),
            'totalCogsUsd' => $totalCogs,
            'grossProfitUsd' => $grossProfit,
            'grossMarginPercent' => $grossMargin,
            'operatingExpensesUsd' => self::roundUsd($opExTotal),
            'operatingExpenseBreakdown' => array_values($opBreakdown),
            'netProfitUsd' => $netProfit,
            'netMarginPercent' => $netMargin,
            'profitByProduct' => array_values($prodMap),
            'profitByCategory' => array_values($catMap),
            'profitByDate' => [],
        ];
    }

    public function getBalanceSheet(): array
    {
        $balances = [];
        foreach ($this->db['accounts'] as $acc) {
            $balances[$acc['id']] = 0.0;
        }
        $accMap = [];
        foreach ($this->db['accounts'] as $acc) {
            $accMap[$acc['id']] = $acc;
        }

        foreach ($this->db['journalLines'] as $line) {
            $acc = $accMap[$line['accountId']] ?? null;
            if (!$acc) continue;
            $debit = (float)$line['debitUsd'];
            $credit = (float)$line['creditUsd'];
            if ($acc['type'] === 'ASSET') {
                $balances[$acc['id']] += ($debit - $credit);
            } elseif ($acc['type'] === 'LIABILITY' || $acc['type'] === 'EQUITY') {
                $balances[$acc['id']] += ($credit - $debit);
            }
        }

        $pnl = $this->getProfitAndLoss();
        $netIncome = (float)$pnl['netProfitUsd'];

        $assets = [];
        $liabilities = [];
        $equity = [];
        $totalAssets = 0.0;
        $totalLiabilities = 0.0;
        $totalEquity = 0.0;

        foreach ($this->db['accounts'] as $acc) {
            $bal = self::roundUsd($balances[$acc['id']] ?? 0);
            if ($bal == 0) continue;
            $row = [
                'code' => $acc['code'],
                'nameEn' => $acc['nameEn'],
                'nameAr' => $acc['nameAr'],
                'nameKu' => $acc['nameKu'],
                'subType' => $acc['subType'],
                'balanceUsd' => $bal,
            ];
            if ($acc['type'] === 'ASSET') {
                $assets[] = $row;
                $totalAssets = self::roundUsd($totalAssets + $bal);
            } elseif ($acc['type'] === 'LIABILITY') {
                $liabilities[] = $row;
                $totalLiabilities = self::roundUsd($totalLiabilities + $bal);
            } elseif ($acc['type'] === 'EQUITY') {
                $equity[] = $row;
                $totalEquity = self::roundUsd($totalEquity + $bal);
            }
        }

        if ($netIncome != 0) {
            $equity[] = [
                'code' => '3999',
                'nameEn' => 'Current Period Net Profit / (Loss)',
                'nameAr' => 'صافي الربح / (الخسارة) للفترة الحالية',
                'nameKu' => 'قازانجی سافی / (زیان)ی ماوەی ئێستا',
                'subType' => 'RETAINED_EARNINGS',
                'balanceUsd' => $netIncome,
            ];
            $totalEquity = self::roundUsd($totalEquity + $netIncome);
        }

        $totalLAndE = self::roundUsd($totalLiabilities + $totalEquity);

        return [
            'assets' => $assets,
            'liabilities' => $liabilities,
            'equity' => $equity,
            'totalAssetsUsd' => $totalAssets,
            'totalLiabilitiesUsd' => $totalLiabilities,
            'totalEquityUsd' => $totalEquity,
            'totalLiabilitiesAndEquityUsd' => $totalLAndE,
            'isBalanced' => abs($totalAssets - $totalLAndE) < 0.01,
        ];
    }

    public function getGeneralLedger(): array
    {
        $accMap = [];
        foreach ($this->db['accounts'] as $a) $accMap[$a['id']] = $a;
        $jrnMap = [];
        foreach ($this->db['journals'] as $j) $jrnMap[$j['id']] = $j;

        $lines = $this->db['journalLines'];
        usort($lines, function ($a, $b) use ($jrnMap) {
            $da = $jrnMap[$a['journalEntryId']]['date'] ?? '';
            $db = $jrnMap[$b['journalEntryId']]['date'] ?? '';
            return strcmp($da, $db);
        });

        $running = [];
        $out = [];
        foreach ($lines as $l) {
            $acc = $accMap[$l['accountId']] ?? null;
            $jrn = $jrnMap[$l['journalEntryId']] ?? null;
            if (!$acc || !$jrn) continue;
            $prev = $running[$acc['id']] ?? 0.0;
            $debit = (float)$l['debitUsd'];
            $credit = (float)$l['creditUsd'];
            $delta = $acc['normalBalance'] === 'DEBIT' ? ($debit - $credit) : ($credit - $debit);
            $cur = self::roundUsd($prev + $delta);
            $running[$acc['id']] = $cur;

            $out[] = [
                'lineId' => $l['id'],
                'entryId' => $jrn['id'],
                'entryNumber' => $jrn['entryNumber'],
                'date' => $jrn['date'],
                'referenceType' => $jrn['referenceType'],
                'status' => $jrn['status'],
                'accountCode' => $acc['code'],
                'accountNameEn' => $acc['nameEn'],
                'accountNameAr' => $acc['nameAr'],
                'accountNameKu' => $acc['nameKu'],
                'description' => $l['description'] ?: $jrn['description'],
                'debitUsd' => $debit,
                'creditUsd' => $credit,
                'runningBalanceUsd' => $cur,
            ];
        }
        return $out;
    }

    public function getInventoryValuation(): array
    {
        $totalCost = 0.0;
        $totalRetail = 0.0;
        $totalUnits = 0.0;
        $lowCount = 0;
        $outCount = 0;
        $items = [];

        foreach ($this->db['products'] as $p) {
            $cat = $this->findById('categories', $p['categoryId']);
            $qty = (float)$p['totalStock'];
            $cost = (float)$p['purchaseCostUsd'];
            $price = (float)$p['sellingPriceUsd'];
            $min = (float)$p['minStockLevel'];

            $costVal = self::roundUsd($qty * $cost);
            $retailVal = self::roundUsd($qty * $price);
            $isOut = $qty <= 0;
            $isLow = !$isOut && $qty <= $min;
            if ($isOut) $outCount++;
            if ($isLow) $lowCount++;

            $totalUnits += $qty;
            $totalCost = self::roundUsd($totalCost + $costVal);
            $totalRetail = self::roundUsd($totalRetail + $retailVal);

            $wb = [];
            foreach ($this->db['warehouseStocks'] as $ws) {
                if ($ws['productId'] === $p['id']) {
                    $w = $this->findById('warehouses', $ws['warehouseId']);
                    if ($w) {
                        $wb[] = [
                            'warehouseId' => $w['id'],
                            'warehouseNameEn' => $w['nameEn'],
                            'warehouseNameAr' => $w['nameAr'],
                            'warehouseNameKu' => $w['nameKu'],
                            'quantity' => (float)$ws['quantity'],
                        ];
                    }
                }
            }

            $items[] = [
                'productId' => $p['id'],
                'sku' => $p['sku'],
                'barcode' => $p['barcode'],
                'nameEn' => $p['nameEn'],
                'nameAr' => $p['nameAr'],
                'nameKu' => $p['nameKu'],
                'categoryNameEn' => $cat['nameEn'] ?? '',
                'categoryNameAr' => $cat['nameAr'] ?? '',
                'categoryNameKu' => $cat['nameKu'] ?? '',
                'unit' => $p['unit'],
                'quantity' => $qty,
                'minStockLevel' => $min,
                'purchaseCostUsd' => $cost,
                'sellingPriceUsd' => $price,
                'costValueUsd' => $costVal,
                'retailValueUsd' => $retailVal,
                'potentialProfitUsd' => self::roundUsd($retailVal - $costVal),
                'isLowStock' => $isLow,
                'isOutOfStock' => $isOut,
                'warehouseBreakdown' => $wb,
            ];
        }

        return [
            'items' => $items,
            'totalProducts' => count($items),
            'totalUnits' => $totalUnits,
            'totalCostValueUsd' => $totalCost,
            'totalRetailValueUsd' => $totalRetail,
            'totalPotentialProfitUsd' => self::roundUsd($totalRetail - $totalCost),
            'lowStockCount' => $lowCount,
            'outOfStockCount' => $outCount,
        ];
    }
}
