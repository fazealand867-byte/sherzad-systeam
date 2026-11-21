<?php
/**
 * SHERZAD FOOD FACTORY & BUSINESS MANAGEMENT SYSTEM
 * Pure PHP 8 Double-Entry Accounting, Production, Payroll & Inventory Engine
 * IQD-Native | Decimal-Safe (bcmath) | Safe Schema Migration | Hostinger Ready
 */

require_once __DIR__ . '/config.php';

class ErpEngine
{
    public array $db = [];
    private ?PDO $pdo = null;
    private bool $readCacheEnabled = false;
    private array $idIndexCache = [];
    private array $unitCodeCache = [];
    private array $accountCodeCache = [];
    private ?array $wsByProductCache = null;
    private ?array $salesItemsByInvCache = null;
    private ?array $purchaseItemsByInvCache = null;
    private ?array $journalLinesByEntryCache = null;
    private ?array $usedProductIdsCache = null;

    public const CURRENT_SCHEMA_VERSION = 2;

    public function enableReadCache(): void
    {
        $this->readCacheEnabled = true;
        $this->idIndexCache = [];
        $this->unitCodeCache = [];
        $this->accountCodeCache = [];
        $this->wsByProductCache = null;
        $this->salesItemsByInvCache = null;
        $this->purchaseItemsByInvCache = null;
        $this->journalLinesByEntryCache = null;
        $this->usedProductIdsCache = null;
    }

    public function invalidateReadCache(): void
    {
        $this->readCacheEnabled = false;
        $this->idIndexCache = [];
        $this->unitCodeCache = [];
        $this->accountCodeCache = [];
        $this->wsByProductCache = null;
        $this->salesItemsByInvCache = null;
        $this->purchaseItemsByInvCache = null;
        $this->journalLinesByEntryCache = null;
        $this->usedProductIdsCache = null;
    }

    public function __construct()
    {
        if (!is_dir(ERP_STORAGE_DIR)) {
            @mkdir(ERP_STORAGE_DIR, 0775, true);
        }
        $this->loadDatabase();
        $this->migrateIfNeeded();
    }

    // -------------------------------------------------------------------------
    // DECIMAL-SAFE ARITHMETIC (BCMATH WITH SAFE FALLBACK)
    // -------------------------------------------------------------------------
    public static function decStr($val, int $scale = 6): string
    {
        if ($val === null || $val === '') return '0';
        if (is_int($val)) return (string)$val;
        $str = trim((string)$val);
        if (!is_numeric($str)) return '0';
        // Handle scientific notation safely
        if (stripos($str, 'e') !== false) {
            return number_format((float)$str, $scale, '.', '');
        }
        return $str;
    }

    public static function decAdd($a, $b, int $scale = 6): string
    {
        $sa = self::decStr($a, $scale);
        $sb = self::decStr($b, $scale);
        if (function_exists('bcadd')) {
            return bcadd($sa, $sb, $scale);
        }
        return number_format((float)$sa + (float)$sb, $scale, '.', '');
    }

    public static function decSub($a, $b, int $scale = 6): string
    {
        $sa = self::decStr($a, $scale);
        $sb = self::decStr($b, $scale);
        if (function_exists('bcsub')) {
            return bcsub($sa, $sb, $scale);
        }
        return number_format((float)$sa - (float)$sb, $scale, '.', '');
    }

    public static function decMul($a, $b, int $scale = 6): string
    {
        $sa = self::decStr($a, $scale);
        $sb = self::decStr($b, $scale);
        if (function_exists('bcmul')) {
            return bcmul($sa, $sb, $scale);
        }
        return number_format((float)$sa * (float)$sb, $scale, '.', '');
    }

    public static function decDiv($a, $b, int $scale = 6): string
    {
        $sa = self::decStr($a, $scale);
        $sb = self::decStr($b, $scale);
        if ((float)$sb == 0.0) {
            throw new Exception('Division by zero in decimal calculation.');
        }
        if (function_exists('bcdiv')) {
            return bcdiv($sa, $sb, $scale);
        }
        return number_format((float)$sa / (float)$sb, $scale, '.', '');
    }

    public static function roundIqd($val): float
    {
        $s = self::decStr($val, 6);
        return round((float)$s, 0, PHP_ROUND_HALF_UP);
    }

    public static function roundQty($val): float
    {
        $s = self::decStr($val, 6);
        return round((float)$s, 4, PHP_ROUND_HALF_UP);
    }

    public static function roundUsd($val): float
    {
        return round((float)$val, 2, PHP_ROUND_HALF_UP);
    }

    public static function iqdToUsd($amountIqd, $rate = 1500.0): float
    {
        $r = (float)$rate > 0 ? (float)$rate : 1500.0;
        return self::roundUsd(self::decDiv($amountIqd, $r, 6));
    }

    public static function usdToIqd($amountUsd, $rate = 1500.0): float
    {
        $r = (float)$rate > 0 ? (float)$rate : 1500.0;
        return self::roundIqd(self::decMul($amountUsd, $r, 6));
    }

    public static function cuid(string $prefix = 'id_'): string
    {
        return $prefix . bin2hex(random_bytes(8));
    }

    public static function nowIso(): string
    {
        return gmdate('Y-m-d\TH:i:s.000\Z');
    }

    public static function normalizeDateIso(?string $dateInput): string
    {
        if (!$dateInput) return self::nowIso();
        $trimmed = trim($dateInput);
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed)) {
            return $trimmed . 'T12:00:00.000Z';
        }
        $ts = strtotime($trimmed);
        return $ts ? gmdate('Y-m-d\TH:i:s.000\Z', $ts) : self::nowIso();
    }

    public static function currentMonthStr(): string
    {
        return date('Y-m');
    }

    // -------------------------------------------------------------------------
    // DATABASE LOAD / SAVE (ATOMIC FILE LOCK + OPTIONAL MYSQL SYNC)
    // -------------------------------------------------------------------------
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
        $this->invalidateReadCache();
        // Compact UTF-8 JSON is ~55% smaller and ~2.5x faster to read/write on every request
        $json = json_encode($this->db, JSON_UNESCAPED_UNICODE);

        $fp = fopen(ERP_LOCK_FILE, 'c+');
        if ($fp && flock($fp, LOCK_EX)) {
            file_put_contents(ERP_DB_FILE, $json);
            flock($fp, LOCK_UN);
            fclose($fp);
        } else {
            file_put_contents(ERP_DB_FILE, $json);
        }

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

    // -------------------------------------------------------------------------
    // SAFE AUTOMATIC MIGRATION TO SCHEMA V2 (FOOD FACTORY + IQD-ONLY)
    // -------------------------------------------------------------------------
    private function migrateIfNeeded(): void
    {
        $version = (int)($this->db['schemaVersion'] ?? 1);
        if ($version >= self::CURRENT_SCHEMA_VERSION) {
            $this->ensureDefaultCollections();
            return;
        }

        // 1. Automatically create a safety backup before structural migration
        $backupDir = ERP_STORAGE_DIR . '/backups';
        if (!is_dir($backupDir)) {
            @mkdir($backupDir, 0775, true);
        }
        if (file_exists(ERP_DB_FILE)) {
            $autoBackup = $backupDir . '/auto_pre_v2_' . date('Ymd_His') . '.json';
            if (!file_exists($autoBackup)) {
                @copy(ERP_DB_FILE, $autoBackup);
            }
        }

        $this->ensureDefaultCollections();

        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500);
        if ($rate <= 0) $rate = 1500.0;

        // 2. Migrate Settings to IQD-only & Kurdish Sorani primary
        $this->db['settings']['baseCurrency'] = 'IQD';
        $this->db['settings']['defaultDisplayCurrency'] = 'IQD';
        $this->db['settings']['defaultLanguage'] = 'ku';
        $this->db['settings']['usdToIqdRate'] = $rate;
        if (!isset($this->db['settings']['expenseApprovalThresholdIqd'])) {
            $oldThreshUsd = (float)($this->db['settings']['expenseApprovalThresholdUsd'] ?? 1000);
            $this->db['settings']['expenseApprovalThresholdIqd'] = self::usdToIqd($oldThreshUsd, $rate);
        }

        // 3. Migrate Chart of Accounts balances to exact IQD & add food factory accounts
        foreach ($this->db['accounts'] as &$acc) {
            if (!isset($acc['balanceIqd'])) {
                $acc['balanceIqd'] = self::usdToIqd($acc['balanceUsd'] ?? 0, $rate);
            }
            // Clean currency labels on cash/bank GL accounts
            if ($acc['code'] === '1010') {
                $acc['nameEn'] = 'Main Cash Safe (HQ)';
                $acc['nameAr'] = 'الصندوق النقدي الرئيسي';
                $acc['nameKu'] = 'قاسەی سەرەکی نەقد';
            } elseif ($acc['code'] === '1015') {
                $acc['nameEn'] = 'Daily Register Cash Safe';
                $acc['nameAr'] = 'صندوق الكاشير اليومي';
                $acc['nameKu'] = 'سندوقی کاشێری ڕۆژانە';
            } elseif ($acc['code'] === '1020') {
                $acc['nameEn'] = 'Business Bank Account (TBI)';
                $acc['nameAr'] = 'الحساب البنكي التجاري (TBI)';
                $acc['nameKu'] = 'هەژماری بانکی بازرگانی (TBI)';
            } elseif ($acc['code'] === '1025') {
                $acc['nameEn'] = 'Business Bank Account (FIB)';
                $acc['nameAr'] = 'الحساب البنكي (FIB)';
                $acc['nameKu'] = 'هەژماری بانکی (FIB)';
            }
        }
        unset($acc);

        $newFoodAccounts = [
            ['code' => '1310', 'nameEn' => 'Raw Materials Inventory', 'nameAr' => 'مخزون المواد الخام', 'nameKu' => 'کۆگای کەرەستەی خاو', 'type' => 'ASSET', 'subType' => 'INVENTORY', 'normalBalance' => 'DEBIT'],
            ['code' => '1320', 'nameEn' => 'Finished Food Products Inventory', 'nameAr' => 'مخزون المنتجات الغذائية الجاهزة', 'nameKu' => 'کۆگای بەرهەمە خۆراکییەکان', 'type' => 'ASSET', 'subType' => 'INVENTORY', 'normalBalance' => 'DEBIT'],
            ['code' => '5132', 'nameEn' => 'Water Expense', 'nameAr' => 'مصروفات المياه', 'nameKu' => 'خەرجی ئاو', 'type' => 'EXPENSE', 'subType' => 'OPERATING_EXPENSE', 'normalBalance' => 'DEBIT'],
            ['code' => '5134', 'nameEn' => 'Gas & Cooking Fuel', 'nameAr' => 'الغاز ووقود الطبخ', 'nameKu' => 'خەرجی غاز و سووتەمەنی', 'type' => 'EXPENSE', 'subType' => 'OPERATING_EXPENSE', 'normalBalance' => 'DEBIT'],
            ['code' => '5145', 'nameEn' => 'Raw Materials Direct Expense', 'nameAr' => 'مصروفات المواد الخام المباشرة', 'nameKu' => 'خەرجی کەرەستەی خاو', 'type' => 'EXPENSE', 'subType' => 'OPERATING_EXPENSE', 'normalBalance' => 'DEBIT'],
            ['code' => '5210', 'nameEn' => 'Food Spoilage & Waste', 'nameAr' => 'التالف والهدر الغذائي', 'nameKu' => 'تێکچوون و بەفیڕۆچوونی خۆراک', 'type' => 'EXPENSE', 'subType' => 'COGS', 'normalBalance' => 'DEBIT'],
        ];
        foreach ($newFoodAccounts as $nfa) {
            if (!$this->findAccountByCodeOrId($nfa['code'], null)) {
                $this->db['accounts'][] = [
                    'id' => self::cuid('acc_'),
                    'code' => $nfa['code'],
                    'nameEn' => $nfa['nameEn'],
                    'nameAr' => $nfa['nameAr'],
                    'nameKu' => $nfa['nameKu'],
                    'type' => $nfa['type'],
                    'subType' => $nfa['subType'],
                    'normalBalance' => $nfa['normalBalance'],
                    'parentId' => null,
                    'isSystem' => true,
                    'isActive' => true,
                    'balanceUsd' => 0.0,
                    'balanceIqd' => 0.0,
                    'createdAt' => self::nowIso(),
                ];
            }
        }

        // 4. Migrate Financial Accounts to IQD
        foreach ($this->db['financialAccounts'] as &$fa) {
            $oldCurr = $fa['currency'] ?? 'IQD';
            if (!isset($fa['balanceIqd'])) {
                $fa['balanceIqd'] = ($oldCurr === 'IQD')
                    ? self::roundIqd($fa['balanceOriginal'] ?? 0)
                    : self::usdToIqd($fa['balanceUsd'] ?? 0, $rate);
            }
            $fa['currency'] = 'IQD';
            $fa['balanceOriginal'] = $fa['balanceIqd'];
            $fa['openingBalanceIqd'] = $fa['openingBalanceIqd'] ?? self::usdToIqd($fa['openingBalanceUsd'] ?? 0, $rate);
            if ($fa['code'] === 'CASH-USD-01') {
                $fa['nameEn'] = 'Main Cash Safe';
                $fa['nameAr'] = 'الصندوق النقدي الرئيسي';
                $fa['nameKu'] = 'قاسەی سەرەکی';
            } elseif ($fa['code'] === 'CASH-IQD-01') {
                $fa['nameEn'] = 'Daily Cashier Safe';
                $fa['nameAr'] = 'صندوق الكاشير اليومي';
                $fa['nameKu'] = 'سندوقی کاشێر';
            } elseif ($fa['code'] === 'BANK-TBI-USD') {
                $fa['nameEn'] = 'TBI Business Bank';
                $fa['nameAr'] = 'حساب مصرف TBI';
                $fa['nameKu'] = 'بانکی TBI';
            } elseif ($fa['code'] === 'BANK-FIB-IQD') {
                $fa['nameEn'] = 'FIB Business Bank';
                $fa['nameAr'] = 'حساب مصرف FIB';
                $fa['nameKu'] = 'بانکی FIB';
            }
        }
        unset($fa);

        // 5. Migrate Journals & Journal Lines to exact IQD
        $jrnRates = [];
        foreach ($this->db['journals'] as $j) {
            $jr = (float)($j['exchangeRate'] ?? $rate);
            $jrnRates[$j['id']] = $jr > 0 ? $jr : $rate;
        }
        $jrnSums = [];
        foreach ($this->db['journalLines'] as &$jl) {
            $jr = $jrnRates[$jl['journalEntryId']] ?? $rate;
            if (!isset($jl['debitIqd'])) {
                $jl['debitIqd'] = self::usdToIqd($jl['debitUsd'] ?? 0, $jr);
            }
            if (!isset($jl['creditIqd'])) {
                $jl['creditIqd'] = self::usdToIqd($jl['creditUsd'] ?? 0, $jr);
            }
            $jl['currency'] = 'IQD';
            $jl['debitOriginal'] = $jl['debitIqd'];
            $jl['creditOriginal'] = $jl['creditIqd'];
            $jid = $jl['journalEntryId'];
            if (!isset($jrnSums[$jid])) $jrnSums[$jid] = ['d' => 0.0, 'c' => 0.0];
            $jrnSums[$jid]['d'] = self::roundIqd(self::decAdd($jrnSums[$jid]['d'], $jl['debitIqd']));
            $jrnSums[$jid]['c'] = self::roundIqd(self::decAdd($jrnSums[$jid]['c'], $jl['creditIqd']));
        }
        unset($jl);

        foreach ($this->db['journals'] as &$j) {
            $jid = $j['id'];
            $jr = $jrnRates[$jid] ?? $rate;
            $j['totalDebitIqd'] = $jrnSums[$jid]['d'] ?? self::usdToIqd($j['totalDebitUsd'] ?? 0, $jr);
            $j['totalCreditIqd'] = $jrnSums[$jid]['c'] ?? self::usdToIqd($j['totalCreditUsd'] ?? 0, $jr);
            $j['currency'] = 'IQD';
        }
        unset($j);

        // 6. Migrate Products, Customers, Suppliers, Invoices, Expenses, CashTx, DebtPayments, Movements
        foreach ($this->db['products'] as &$p) {
            $p['unit'] = self::normalizeUnitCode($p['unit'] ?? 'piece');
            $p['productType'] = $p['productType'] ?? 'GENERAL';
            if (!isset($p['purchaseCostIqd'])) {
                $p['purchaseCostIqd'] = self::usdToIqd($p['purchaseCostUsd'] ?? 0, $rate);
            }
            if (!isset($p['sellingPriceIqd'])) {
                $p['sellingPriceIqd'] = self::usdToIqd($p['sellingPriceUsd'] ?? 0, $rate);
            }
            $p['totalStock'] = self::roundQty($p['totalStock'] ?? 0);
            $p['minStockLevel'] = self::roundQty($p['minStockLevel'] ?? 5);
        }
        unset($p);

        foreach ($this->db['customers'] as &$c) {
            if (!isset($c['balanceIqd'])) $c['balanceIqd'] = self::usdToIqd($c['balanceUsd'] ?? 0, $rate);
            if (!isset($c['openingBalanceIqd'])) $c['openingBalanceIqd'] = self::usdToIqd($c['openingBalanceUsd'] ?? 0, $rate);
            if (!isset($c['creditLimitIqd'])) $c['creditLimitIqd'] = self::usdToIqd($c['creditLimitUsd'] ?? 5000, $rate);
        }
        unset($c);

        foreach ($this->db['suppliers'] as &$s) {
            if (!isset($s['balanceIqd'])) $s['balanceIqd'] = self::usdToIqd($s['balanceUsd'] ?? 0, $rate);
            if (!isset($s['openingBalanceIqd'])) $s['openingBalanceIqd'] = self::usdToIqd($s['openingBalanceUsd'] ?? 0, $rate);
        }
        unset($s);

        foreach ($this->db['salesInvoices'] as &$inv) {
            $ir = (float)($inv['exchangeRate'] ?? $rate) ?: $rate;
            $isIqd = ($inv['currency'] ?? '') === 'IQD';
            $inv['subtotalIqd'] = $inv['subtotalIqd'] ?? ($isIqd ? self::roundIqd($inv['subtotalOriginal'] ?? 0) : self::usdToIqd($inv['subtotalUsd'] ?? 0, $ir));
            $inv['discountIqd'] = $inv['discountIqd'] ?? ($isIqd ? self::roundIqd($inv['discountOriginal'] ?? 0) : self::usdToIqd($inv['discountUsd'] ?? 0, $ir));
            $inv['taxIqd'] = $inv['taxIqd'] ?? ($isIqd ? self::roundIqd($inv['taxOriginal'] ?? 0) : self::usdToIqd($inv['taxUsd'] ?? 0, $ir));
            $inv['totalIqd'] = $inv['totalIqd'] ?? ($isIqd ? self::roundIqd($inv['totalOriginal'] ?? 0) : self::usdToIqd($inv['totalUsd'] ?? 0, $ir));
            $inv['paidIqd'] = $inv['paidIqd'] ?? ($isIqd ? self::roundIqd($inv['paidOriginal'] ?? 0) : self::usdToIqd($inv['paidUsd'] ?? 0, $ir));
            $inv['dueIqd'] = $inv['dueIqd'] ?? max(0, self::roundIqd(self::decSub($inv['totalIqd'], $inv['paidIqd'])));
            $inv['totalCostIqd'] = $inv['totalCostIqd'] ?? self::usdToIqd($inv['totalCostUsd'] ?? 0, $ir);
            $inv['grossProfitIqd'] = $inv['grossProfitIqd'] ?? self::roundIqd(self::decSub($inv['totalIqd'], $inv['totalCostIqd']));
            $inv['currency'] = 'IQD';
            $inv['subtotalOriginal'] = $inv['subtotalIqd'];
            $inv['discountOriginal'] = $inv['discountIqd'];
            $inv['taxOriginal'] = $inv['taxIqd'];
            $inv['totalOriginal'] = $inv['totalIqd'];
            $inv['paidOriginal'] = $inv['paidIqd'];
            $inv['dueOriginal'] = $inv['dueIqd'];
        }
        unset($inv);

        $saleRates = [];
        foreach ($this->db['salesInvoices'] as $si) {
            $saleRates[$si['id']] = (float)($si['exchangeRate'] ?? $rate) ?: $rate;
        }
        foreach ($this->db['salesInvoiceItems'] as &$it) {
            $ir = $saleRates[$it['salesInvoiceId']] ?? $rate;
            $it['unit'] = self::normalizeUnitCode($it['unit'] ?? 'piece');
            $it['baseQuantity'] = $it['baseQuantity'] ?? self::roundQty($it['quantity'] ?? 0);
            $it['unitPriceIqd'] = $it['unitPriceIqd'] ?? self::usdToIqd($it['unitPriceUsd'] ?? 0, $ir);
            $it['unitCostIqd'] = $it['unitCostIqd'] ?? self::usdToIqd($it['unitCostUsd'] ?? 0, $ir);
            $it['discountIqd'] = $it['discountIqd'] ?? self::usdToIqd($it['discountUsd'] ?? 0, $ir);
            $it['taxIqd'] = $it['taxIqd'] ?? self::usdToIqd($it['taxUsd'] ?? 0, $ir);
            $it['lineTotalIqd'] = $it['lineTotalIqd'] ?? self::usdToIqd($it['lineTotalUsd'] ?? 0, $ir);
            $it['lineProfitIqd'] = $it['lineProfitIqd'] ?? self::usdToIqd($it['lineProfitUsd'] ?? 0, $ir);
            $it['unitPriceOriginal'] = $it['unitPriceIqd'];
            $it['discountOriginal'] = $it['discountIqd'];
            $it['lineTotalOriginal'] = $it['lineTotalIqd'];
        }
        unset($it);

        foreach ($this->db['purchaseInvoices'] as &$inv) {
            $ir = (float)($inv['exchangeRate'] ?? $rate) ?: $rate;
            $isIqd = ($inv['currency'] ?? '') === 'IQD';
            $inv['subtotalIqd'] = $inv['subtotalIqd'] ?? ($isIqd ? self::roundIqd($inv['subtotalOriginal'] ?? 0) : self::usdToIqd($inv['subtotalUsd'] ?? 0, $ir));
            $inv['discountIqd'] = $inv['discountIqd'] ?? ($isIqd ? self::roundIqd($inv['discountOriginal'] ?? 0) : self::usdToIqd($inv['discountUsd'] ?? 0, $ir));
            $inv['shippingIqd'] = $inv['shippingIqd'] ?? ($isIqd ? self::roundIqd($inv['shippingOriginal'] ?? 0) : self::usdToIqd($inv['shippingUsd'] ?? 0, $ir));
            $inv['totalIqd'] = $inv['totalIqd'] ?? ($isIqd ? self::roundIqd($inv['totalOriginal'] ?? 0) : self::usdToIqd($inv['totalUsd'] ?? 0, $ir));
            $inv['paidIqd'] = $inv['paidIqd'] ?? ($isIqd ? self::roundIqd($inv['paidOriginal'] ?? 0) : self::usdToIqd($inv['paidUsd'] ?? 0, $ir));
            $inv['dueIqd'] = $inv['dueIqd'] ?? max(0, self::roundIqd(self::decSub($inv['totalIqd'], $inv['paidIqd'])));
            $inv['currency'] = 'IQD';
            $inv['subtotalOriginal'] = $inv['subtotalIqd'];
            $inv['totalOriginal'] = $inv['totalIqd'];
            $inv['paidOriginal'] = $inv['paidIqd'];
            $inv['dueOriginal'] = $inv['dueIqd'];
        }
        unset($inv);

        $purRates = [];
        foreach ($this->db['purchaseInvoices'] as $pi) {
            $purRates[$pi['id']] = (float)($pi['exchangeRate'] ?? $rate) ?: $rate;
        }
        foreach ($this->db['purchaseInvoiceItems'] as &$it) {
            $ir = $purRates[$it['purchaseInvoiceId']] ?? $rate;
            $it['unit'] = self::normalizeUnitCode($it['unit'] ?? 'piece');
            $it['baseQuantity'] = $it['baseQuantity'] ?? self::roundQty($it['quantity'] ?? 0);
            $it['unitCostIqd'] = $it['unitCostIqd'] ?? self::usdToIqd($it['unitCostUsd'] ?? 0, $ir);
            $it['discountIqd'] = $it['discountIqd'] ?? self::usdToIqd($it['discountUsd'] ?? 0, $ir);
            $it['lineTotalIqd'] = $it['lineTotalIqd'] ?? self::usdToIqd($it['lineTotalUsd'] ?? 0, $ir);
            $it['unitCostOriginal'] = $it['unitCostIqd'];
            $it['lineTotalOriginal'] = $it['lineTotalIqd'];
        }
        unset($it);

        foreach ($this->db['expenses'] as &$e) {
            $er = (float)($e['exchangeRate'] ?? $rate) ?: $rate;
            $isIqd = ($e['currency'] ?? '') === 'IQD';
            $e['amountIqd'] = $e['amountIqd'] ?? ($isIqd ? self::roundIqd($e['amountOriginal'] ?? 0) : self::usdToIqd($e['amountUsd'] ?? 0, $er));
            $e['currency'] = 'IQD';
            $e['amountOriginal'] = $e['amountIqd'];
            if (($e['category'] ?? '') === 'MISCELLANEOUS') {
                $e['category'] = 'OTHER';
            }
        }
        unset($e);

        foreach ($this->db['debtPayments'] as &$dp) {
            $dr = (float)($dp['exchangeRate'] ?? $rate) ?: $rate;
            $isIqd = ($dp['currency'] ?? '') === 'IQD';
            $dp['amountIqd'] = $dp['amountIqd'] ?? ($isIqd ? self::roundIqd($dp['amountOriginal'] ?? 0) : self::usdToIqd($dp['amountUsd'] ?? 0, $dr));
            $dp['currency'] = 'IQD';
            $dp['amountOriginal'] = $dp['amountIqd'];
        }
        unset($dp);

        foreach ($this->db['cashTransactions'] as &$ct) {
            $cr = (float)($ct['exchangeRate'] ?? $rate) ?: $rate;
            $isIqd = ($ct['currency'] ?? '') === 'IQD';
            $ct['amountIqd'] = $ct['amountIqd'] ?? ($isIqd ? self::roundIqd($ct['amountOriginal'] ?? 0) : self::usdToIqd($ct['amountUsd'] ?? 0, $cr));
            $ct['balanceAfterIqd'] = $ct['balanceAfterIqd'] ?? ($isIqd ? self::roundIqd($ct['balanceAfterOriginal'] ?? 0) : self::usdToIqd($ct['balanceAfterUsd'] ?? 0, $cr));
            $ct['currency'] = 'IQD';
            $ct['amountOriginal'] = $ct['amountIqd'];
            $ct['balanceAfterOriginal'] = $ct['balanceAfterIqd'];
        }
        unset($ct);

        foreach ($this->db['movements'] as &$m) {
            $m['unitCostIqd'] = $m['unitCostIqd'] ?? self::usdToIqd($m['unitCostUsd'] ?? 0, $rate);
        }
        unset($m);

        // 7. Seed Food Factory Reference Data (Non-destructively, zero GL distortion!)
        $this->seedFoodFactoryDefaults();

        $this->db['schemaVersion'] = self::CURRENT_SCHEMA_VERSION;
        $this->logAudit('SCHEMA_MIGRATED_V2', 'SETTINGS', 'System', null, 'Upgraded to Food Factory v2 (IQD-only, Units, Payroll, Production & Recipes) with historical data preserved.');
        $this->saveDatabase();
    }

    private function ensureDefaultCollections(): void
    {
        $arrayKeys = [
            'rateHistory', 'rolePermissions', 'users', 'auditLogs', 'periods',
            'accounts', 'journals', 'journalLines', 'warehouses', 'categories',
            'products', 'warehouseStocks', 'movements', 'transfers', 'customers',
            'suppliers', 'financialAccounts', 'cashTransactions', 'salesInvoices',
            'salesInvoiceItems', 'purchaseInvoices', 'purchaseInvoiceItems',
            'debtPayments', 'expenses', 'units', 'expenseCategories',
            'employees', 'salaryPayments', 'employeeLeaves', 'recipes', 'productionBatches',
            'spoilageRecords',
        ];
        foreach ($arrayKeys as $k) {
            if (!isset($this->db[$k]) || !is_array($this->db[$k])) {
                $this->db[$k] = [];
            }
        }
        if (!isset($this->db['idempotencyLog']) || !is_array($this->db['idempotencyLog'])) {
            $this->db['idempotencyLog'] = [];
        }
    }

    private function seedFoodFactoryDefaults(): void
    {
        // A. Default Measurement Units
        if (empty($this->db['units'])) {
            $this->db['units'] = [
                ['id' => 'unit_g', 'code' => 'g', 'symbol' => 'g', 'nameKu' => 'گرام', 'nameAr' => 'غرام', 'nameEn' => 'Gram', 'family' => 'WEIGHT', 'baseUnitCode' => 'g', 'toBaseFactor' => 1.0, 'allowDecimal' => true, 'isSystem' => true],
                ['id' => 'unit_kg', 'code' => 'kg', 'symbol' => 'kg', 'nameKu' => 'کیلۆگرام', 'nameAr' => 'كيلوغرام', 'nameEn' => 'Kilogram', 'family' => 'WEIGHT', 'baseUnitCode' => 'g', 'toBaseFactor' => 1000.0, 'allowDecimal' => true, 'isSystem' => true],
                ['id' => 'unit_piece', 'code' => 'piece', 'symbol' => 'دانە', 'nameKu' => 'دانە', 'nameAr' => 'قطعة', 'nameEn' => 'Piece', 'family' => 'COUNT', 'baseUnitCode' => 'piece', 'toBaseFactor' => 1.0, 'allowDecimal' => false, 'isSystem' => true],
                ['id' => 'unit_pack', 'code' => 'pack', 'symbol' => 'پاکەت', 'nameKu' => 'پاکەت', 'nameAr' => 'عبوة / باكيت', 'nameEn' => 'Pack', 'family' => 'PACK', 'baseUnitCode' => 'pack', 'toBaseFactor' => 1.0, 'allowDecimal' => false, 'isSystem' => true],
                ['id' => 'unit_box', 'code' => 'box', 'symbol' => 'کارتۆن', 'nameKu' => 'کارتۆن', 'nameAr' => 'كرتون', 'nameEn' => 'Box', 'family' => 'BOX', 'baseUnitCode' => 'box', 'toBaseFactor' => 1.0, 'allowDecimal' => false, 'isSystem' => true],
                ['id' => 'unit_tray', 'code' => 'tray', 'symbol' => 'سینی', 'nameKu' => 'سینی', 'nameAr' => 'صينية', 'nameEn' => 'Tray', 'family' => 'TRAY', 'baseUnitCode' => 'tray', 'toBaseFactor' => 1.0, 'allowDecimal' => false, 'isSystem' => true],
            ];
        }

        // B. Default Expense Categories
        if (empty($this->db['expenseCategories'])) {
            $this->db['expenseCategories'] = [
                ['id' => 'ecat_salaries', 'code' => 'SALARIES', 'nameKu' => 'مووچەی کارمەندان', 'nameAr' => 'رواتب الموظفين', 'nameEn' => 'Employee Salaries', 'accountCode' => '5110', 'isSalary' => true, 'isSystem' => true],
                ['id' => 'ecat_electricity', 'code' => 'ELECTRICITY', 'nameKu' => 'کارەبا', 'nameAr' => 'الكهرباء', 'nameEn' => 'Electricity', 'accountCode' => '5130', 'isSalary' => false, 'isSystem' => true],
                ['id' => 'ecat_water', 'code' => 'WATER', 'nameKu' => 'ئاو', 'nameAr' => 'المياه', 'nameEn' => 'Water', 'accountCode' => '5132', 'isSalary' => false, 'isSystem' => true],
                ['id' => 'ecat_gas', 'code' => 'GAS', 'nameKu' => 'غاز', 'nameAr' => 'الغاز', 'nameEn' => 'Gas', 'accountCode' => '5134', 'isSalary' => false, 'isSystem' => true],
                ['id' => 'ecat_transport', 'code' => 'TRANSPORTATION', 'nameKu' => 'گواستنەوە', 'nameAr' => 'النقل والتوصيل', 'nameEn' => 'Transportation', 'accountCode' => '5140', 'isSalary' => false, 'isSystem' => true],
                ['id' => 'ecat_rent', 'code' => 'RENT', 'nameKu' => 'کرێ', 'nameAr' => 'الإيجار', 'nameEn' => 'Rent', 'accountCode' => '5120', 'isSalary' => false, 'isSystem' => true],
                ['id' => 'ecat_maint', 'code' => 'MAINTENANCE', 'nameKu' => 'چاککردنەوە', 'nameAr' => 'الصيانة', 'nameEn' => 'Maintenance', 'accountCode' => '5150', 'isSalary' => false, 'isSystem' => true],
                ['id' => 'ecat_raw', 'code' => 'RAW_MATERIALS', 'nameKu' => 'کەرەستەی خاو', 'nameAr' => 'المواد الخام', 'nameEn' => 'Raw Materials', 'accountCode' => '5145', 'isSalary' => false, 'isSystem' => true],
                ['id' => 'ecat_other', 'code' => 'OTHER', 'nameKu' => 'خەرجییەکانی تر', 'nameAr' => 'مصروفات أخرى', 'nameEn' => 'Other Expenses', 'accountCode' => '5190', 'isSalary' => false, 'isSystem' => true],
            ];
        }

        // C. Food Factory Product Categories
        $foodCats = [
            ['id' => 'cat_food_finished', 'code' => 'CAT-FOOD', 'nameKu' => 'بەرهەمە ئامادەکراوەکان', 'nameAr' => 'المنتجات الغذائية الجاهزة', 'nameEn' => 'Prepared Food Products', 'description' => 'Kubba, Burgers, Shawarma, Pastrami, Shish, Kebab'],
            ['id' => 'cat_food_raw', 'code' => 'CAT-RAW', 'nameKu' => 'کەرەستەی خاو', 'nameAr' => 'المواد الخام', 'nameEn' => 'Raw Materials', 'description' => 'Meat, Chicken, Flour, Rice, Oil, Spices, Bread'],
            ['id' => 'cat_food_pack', 'code' => 'CAT-PACK', 'nameKu' => 'پێچانەوە و سینی', 'nameAr' => 'التغليف والصواني', 'nameEn' => 'Packaging Materials', 'description' => 'Trays, Boxes, Bags, Wraps'],
        ];
        foreach ($foodCats as $fc) {
            $exists = false;
            foreach ($this->db['categories'] as $c) {
                if (($c['code'] ?? '') === $fc['code']) {
                    $exists = true;
                    break;
                }
            }
            if (!$exists) {
                $fc['createdAt'] = self::nowIso();
                array_unshift($this->db['categories'], $fc);
            }
        }

        // D. Starter Food Factory Products & Raw Materials (0 stock so historical GL balances stay 100% intact!)
        $existingSkus = [];
        foreach ($this->db['products'] as $p) {
            $existingSkus[$p['sku']] = $p['id'];
        }

        $starterProducts = [
            // Finished Food Products
            ['sku' => 'FOOD-KUBBA', 'nameKu' => 'کوبە', 'nameAr' => 'كبة', 'nameEn' => 'Kubba', 'categoryId' => 'cat_food_finished', 'productType' => 'FINISHED_PRODUCT', 'unit' => 'piece', 'purchaseCostIqd' => 350, 'sellingPriceIqd' => 500, 'minStockLevel' => 50],
            ['sku' => 'FOOD-BURGER', 'nameKu' => 'بەرگەر', 'nameAr' => 'برغر', 'nameEn' => 'Burgers', 'categoryId' => 'cat_food_finished', 'productType' => 'FINISHED_PRODUCT', 'unit' => 'piece', 'purchaseCostIqd' => 1000, 'sellingPriceIqd' => 1500, 'minStockLevel' => 30],
            ['sku' => 'FOOD-SHAWARMA', 'nameKu' => 'شاورمە', 'nameAr' => 'شاورما', 'nameEn' => 'Shawarma', 'categoryId' => 'cat_food_finished', 'productType' => 'FINISHED_PRODUCT', 'unit' => 'kg', 'purchaseCostIqd' => 8500, 'sellingPriceIqd' => 12000, 'minStockLevel' => 5],
            ['sku' => 'FOOD-PASTRAMI', 'nameKu' => 'باسترمە', 'nameAr' => 'بسطرمة', 'nameEn' => 'Pastrami', 'categoryId' => 'cat_food_finished', 'productType' => 'FINISHED_PRODUCT', 'unit' => 'kg', 'purchaseCostIqd' => 12000, 'sellingPriceIqd' => 16000, 'minStockLevel' => 5],
            ['sku' => 'FOOD-MEAT-SHISH', 'nameKu' => 'شیسی گۆشت', 'nameAr' => 'شيش لحم', 'nameEn' => 'Meat Shish', 'categoryId' => 'cat_food_finished', 'productType' => 'FINISHED_PRODUCT', 'unit' => 'kg', 'purchaseCostIqd' => 14000, 'sellingPriceIqd' => 18500, 'minStockLevel' => 5],
            ['sku' => 'FOOD-CHICK-SHISH', 'nameKu' => 'شیسی مریشک', 'nameAr' => 'شيش دجاج', 'nameEn' => 'Chicken Shish', 'categoryId' => 'cat_food_finished', 'productType' => 'FINISHED_PRODUCT', 'unit' => 'kg', 'purchaseCostIqd' => 7500, 'sellingPriceIqd' => 10500, 'minStockLevel' => 5],
            ['sku' => 'FOOD-KEBAB', 'nameKu' => 'کەباب', 'nameAr' => 'كباب', 'nameEn' => 'Kebab', 'categoryId' => 'cat_food_finished', 'productType' => 'FINISHED_PRODUCT', 'unit' => 'kg', 'purchaseCostIqd' => 13500, 'sellingPriceIqd' => 17500, 'minStockLevel' => 5],
            // Raw Materials
            ['sku' => 'RAW-MEAT', 'nameKu' => 'گۆشتی سوور', 'nameAr' => 'لحم أحمر', 'nameEn' => 'Beef Meat', 'categoryId' => 'cat_food_raw', 'productType' => 'RAW_MATERIAL', 'unit' => 'kg', 'purchaseCostIqd' => 15000, 'sellingPriceIqd' => 0, 'minStockLevel' => 10],
            ['sku' => 'RAW-CHICKEN', 'nameKu' => 'مریشک', 'nameAr' => 'دجاج', 'nameEn' => 'Chicken', 'categoryId' => 'cat_food_raw', 'productType' => 'RAW_MATERIAL', 'unit' => 'kg', 'purchaseCostIqd' => 6000, 'sellingPriceIqd' => 0, 'minStockLevel' => 15],
            ['sku' => 'RAW-FLOUR', 'nameKu' => 'ئارد', 'nameAr' => 'طحين', 'nameEn' => 'Flour', 'categoryId' => 'cat_food_raw', 'productType' => 'RAW_MATERIAL', 'unit' => 'kg', 'purchaseCostIqd' => 1000, 'sellingPriceIqd' => 0, 'minStockLevel' => 20],
            ['sku' => 'RAW-RICE', 'nameKu' => 'برنج', 'nameAr' => 'رز', 'nameEn' => 'Rice', 'categoryId' => 'cat_food_raw', 'productType' => 'RAW_MATERIAL', 'unit' => 'kg', 'purchaseCostIqd' => 1750, 'sellingPriceIqd' => 0, 'minStockLevel' => 20],
            ['sku' => 'RAW-OIL', 'nameKu' => 'ڕۆن', 'nameAr' => 'زيت طبخ', 'nameEn' => 'Cooking Oil', 'categoryId' => 'cat_food_raw', 'productType' => 'RAW_MATERIAL', 'unit' => 'kg', 'purchaseCostIqd' => 2500, 'sellingPriceIqd' => 0, 'minStockLevel' => 10],
            ['sku' => 'RAW-SPICES', 'nameKu' => 'بەهارات', 'nameAr' => 'بهارات وتوابل', 'nameEn' => 'Spices', 'categoryId' => 'cat_food_raw', 'productType' => 'RAW_MATERIAL', 'unit' => 'g', 'purchaseCostIqd' => 15, 'sellingPriceIqd' => 0, 'minStockLevel' => 500],
            ['sku' => 'RAW-BREAD', 'nameKu' => 'نان و سەموون', 'nameAr' => 'خبز وصمون', 'nameEn' => 'Bread', 'categoryId' => 'cat_food_raw', 'productType' => 'RAW_MATERIAL', 'unit' => 'pack', 'purchaseCostIqd' => 1000, 'sellingPriceIqd' => 0, 'minStockLevel' => 15],
            ['sku' => 'RAW-PACK', 'nameKu' => 'پاکەت و سینی پێچانەوە', 'nameAr' => 'مواد التغليف والصواني', 'nameEn' => 'Packaging Trays', 'categoryId' => 'cat_food_pack', 'productType' => 'RAW_MATERIAL', 'unit' => 'tray', 'purchaseCostIqd' => 250, 'sellingPriceIqd' => 0, 'minStockLevel' => 50],
        ];

        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;
        $skuToId = $existingSkus;
        foreach ($starterProducts as $sp) {
            if (!isset($existingSkus[$sp['sku']])) {
                $pid = self::cuid('prd_');
                $skuToId[$sp['sku']] = $pid;
                array_unshift($this->db['products'], [
                    'id' => $pid,
                    'sku' => $sp['sku'],
                    'barcode' => null,
                    'nameEn' => $sp['nameEn'],
                    'nameAr' => $sp['nameAr'],
                    'nameKu' => $sp['nameKu'],
                    'description' => null,
                    'categoryId' => $sp['categoryId'],
                    'productType' => $sp['productType'],
                    'unit' => $sp['unit'],
                    'purchaseCostIqd' => (float)$sp['purchaseCostIqd'],
                    'sellingPriceIqd' => (float)$sp['sellingPriceIqd'],
                    'purchaseCostUsd' => self::iqdToUsd($sp['purchaseCostIqd'], $rate),
                    'sellingPriceUsd' => self::iqdToUsd($sp['sellingPriceIqd'], $rate),
                    'taxRate' => 0,
                    'minStockLevel' => (float)$sp['minStockLevel'],
                    'totalStock' => 0.0,
                    'imageUrl' => null,
                    'isActive' => true,
                    'isDemo' => false,
                    'createdAt' => self::nowIso(),
                    'updatedAt' => self::nowIso(),
                ]);
            }
        }

        // E. Starter Production Recipes (Optional formulas ready to use!)
        if (empty($this->db['recipes']) && isset($skuToId['FOOD-KUBBA'], $skuToId['RAW-MEAT'], $skuToId['RAW-RICE'], $skuToId['RAW-SPICES'], $skuToId['RAW-OIL'])) {
            $this->db['recipes'][] = [
                'id' => self::cuid('rcp_'),
                'finishedProductId' => $skuToId['FOOD-KUBBA'],
                'yieldQuantity' => 100,
                'yieldUnit' => 'piece',
                'notes' => 'Standard 100-piece Kubba batch',
                'ingredients' => [
                    ['rawMaterialId' => $skuToId['RAW-MEAT'], 'quantity' => 1.5, 'unit' => 'kg'],
                    ['rawMaterialId' => $skuToId['RAW-RICE'], 'quantity' => 2.0, 'unit' => 'kg'],
                    ['rawMaterialId' => $skuToId['RAW-OIL'], 'quantity' => 500, 'unit' => 'g'],
                    ['rawMaterialId' => $skuToId['RAW-SPICES'], 'quantity' => 100, 'unit' => 'g'],
                ],
                'createdAt' => self::nowIso(),
                'updatedAt' => self::nowIso(),
            ];
        }
        if (isset($skuToId['FOOD-SHAWARMA'], $skuToId['RAW-CHICKEN'], $skuToId['RAW-SPICES']) && count($this->db['recipes']) < 2) {
            $this->db['recipes'][] = [
                'id' => self::cuid('rcp_'),
                'finishedProductId' => $skuToId['FOOD-SHAWARMA'],
                'yieldQuantity' => 10,
                'yieldUnit' => 'kg',
                'notes' => 'Standard 10 kg Chicken Shawarma batch',
                'ingredients' => [
                    ['rawMaterialId' => $skuToId['RAW-CHICKEN'], 'quantity' => 10.5, 'unit' => 'kg'],
                    ['rawMaterialId' => $skuToId['RAW-SPICES'], 'quantity' => 250, 'unit' => 'g'],
                    ['rawMaterialId' => $skuToId['RAW-OIL'], 'quantity' => 500, 'unit' => 'g'],
                ],
                'createdAt' => self::nowIso(),
                'updatedAt' => self::nowIso(),
            ];
        }

        // F. Starter Dedicated HR Employees (ready for instant salary payment dropdown!)
        if (empty($this->db['employees'])) {
            $this->db['employees'] = [
                [
                    'id' => self::cuid('emp_'),
                    'code' => 'EMP-001',
                    'name' => 'ئەحمەد حەسەن',
                    'phone' => '07501112233',
                    'position' => 'شێفی سەرەکی / Head Chef',
                    'monthlySalaryIqd' => 750000,
                    'startDate' => '2025-01-15',
                    'status' => 'ACTIVE',
                    'notes' => '',
                    'createdAt' => self::nowIso(),
                ],
                [
                    'id' => self::cuid('emp_'),
                    'code' => 'EMP-002',
                    'name' => 'کاروان محەمەد',
                    'phone' => '07504445566',
                    'position' => 'قەساب و ئامادەکاری گۆشت / Butcher',
                    'monthlySalaryIqd' => 650000,
                    'startDate' => '2025-03-01',
                    'status' => 'ACTIVE',
                    'notes' => '',
                    'createdAt' => self::nowIso(),
                ],
                [
                    'id' => self::cuid('emp_'),
                    'code' => 'EMP-003',
                    'name' => 'سارا عومەر',
                    'phone' => '07707778899',
                    'position' => 'بەشی پێچانەوە / Packaging',
                    'monthlySalaryIqd' => 550000,
                    'startDate' => '2025-06-10',
                    'status' => 'ACTIVE',
                    'notes' => '',
                    'createdAt' => self::nowIso(),
                ],
                [
                    'id' => self::cuid('emp_'),
                    'code' => 'EMP-004',
                    'name' => 'ڕێباز کەریم',
                    'phone' => '07509998877',
                    'position' => 'شۆفێری دابەشکردن / Delivery Driver',
                    'monthlySalaryIqd' => 600000,
                    'startDate' => '2025-08-01',
                    'status' => 'ACTIVE',
                    'notes' => '',
                    'createdAt' => self::nowIso(),
                ],
            ];
        }
    }

    // -------------------------------------------------------------------------
    // MEASUREMENT UNIT CONVERSION ENGINE (DECIMAL-SAFE)
    // -------------------------------------------------------------------------
    public static function normalizeUnitCode(?string $code): string
    {
        if (!$code) return 'piece';
        $c = strtolower(trim($code));
        $map = [
            'pcs' => 'piece',
            'pc' => 'piece',
            'piece' => 'piece',
            'pieces' => 'piece',
            'ea' => 'piece',
            'unit' => 'piece',
            'kg' => 'kg',
            'kilogram' => 'kg',
            'g' => 'g',
            'gr' => 'g',
            'gram' => 'g',
            'grams' => 'g',
            'pack' => 'pack',
            'pkt' => 'pack',
            'set' => 'pack',
            'box' => 'box',
            'carton' => 'box',
            'tray' => 'tray',
        ];
        return $map[$c] ?? $c;
    }

    public function findUnitByCode(?string $code): ?array
    {
        $norm = self::normalizeUnitCode($code);
        if ($this->readCacheEnabled) {
            if (empty($this->unitCodeCache) && !empty($this->db['units'])) {
                foreach ($this->db['units'] as $u) {
                    $this->unitCodeCache[strtolower($u['code'])] = $u;
                }
            }
            return $this->unitCodeCache[$norm] ?? null;
        }
        foreach ($this->db['units'] as $u) {
            if (strtolower($u['code']) === $norm) {
                return $u;
            }
        }
        return null;
    }

    public function areUnitsCompatible(string $fromCode, string $toCode): bool
    {
        $f = self::normalizeUnitCode($fromCode);
        $t = self::normalizeUnitCode($toCode);
        if ($f === $t) return true;
        $u1 = $this->findUnitByCode($f);
        $u2 = $this->findUnitByCode($t);
        if (!$u1 || !$u2) return false;
        if (empty($u1['family']) || empty($u2['family'])) return false;
        if ($u1['family'] !== $u2['family']) return false;
        // Standalone packaging families only match themselves unless explicitly sharing baseUnitCode
        return ($u1['baseUnitCode'] ?? $u1['code']) === ($u2['baseUnitCode'] ?? $u2['code']);
    }

    public function convertQuantity($quantity, string $fromCode, string $toCode): float
    {
        $f = self::normalizeUnitCode($fromCode);
        $t = self::normalizeUnitCode($toCode);
        $qtyStr = self::decStr($quantity, 6);
        if ($f === $t) {
            return self::roundQty($qtyStr);
        }
        $uFrom = $this->findUnitByCode($f);
        $uTo = $this->findUnitByCode($t);
        if (!$uFrom || !$uTo || !$this->areUnitsCompatible($f, $t)) {
            throw new Exception("Incompatible unit conversion: cannot convert from '{$fromCode}' to '{$toCode}'.");
        }
        $fromFactor = (float)($uFrom['toBaseFactor'] ?? 1);
        $toFactor = (float)($uTo['toBaseFactor'] ?? 1);
        if ($fromFactor <= 0 || $toFactor <= 0) {
            throw new Exception("Invalid conversion factor between '{$fromCode}' and '{$toCode}'.");
        }
        $inBase = self::decMul($qtyStr, $fromFactor, 8);
        $converted = self::decDiv($inBase, $toFactor, 8);
        return self::roundQty($converted);
    }

    // -------------------------------------------------------------------------
    // IDEMPOTENCY HELPER (PREVENT DUPLICATE SUBMISSIONS)
    // -------------------------------------------------------------------------
    public function checkIdempotency(?string $key): ?array
    {
        if (!$key) return null;
        return $this->db['idempotencyLog'][$key] ?? null;
    }

    public function storeIdempotency(?string $key, array $response): void
    {
        if (!$key) return;
        $this->db['idempotencyLog'][$key] = $response;
        // Keep last 500 keys to prevent unbounded growth
        if (count($this->db['idempotencyLog']) > 500) {
            $this->db['idempotencyLog'] = array_slice($this->db['idempotencyLog'], -500, null, true);
        }
    }

    // -------------------------------------------------------------------------
    // USER, AUDIT & LOOKUP HELPERS
    // -------------------------------------------------------------------------
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
        if ($this->readCacheEnabled) {
            if (!isset($this->idIndexCache[$collection])) {
                $map = [];
                foreach ($this->db[$collection] as $item) {
                    if (isset($item['id'])) {
                        $map[$item['id']] = $item;
                    }
                }
                $this->idIndexCache[$collection] = $map;
            }
            return $this->idIndexCache[$collection][$id] ?? null;
        }
        foreach ($this->db[$collection] as $item) {
            if (($item['id'] ?? null) === $id) return $item;
        }
        return null;
    }

    public function findAccountByCodeOrId(?string $code, ?string $id): ?array
    {
        if ($this->readCacheEnabled) {
            if ($id) {
                $byId = $this->findById('accounts', $id);
                if ($byId) return $byId;
            }
            if ($code) {
                if (empty($this->accountCodeCache) && !empty($this->db['accounts'])) {
                    foreach ($this->db['accounts'] as $acc) {
                        $this->accountCodeCache[$acc['code']] = $acc;
                    }
                }
                return $this->accountCodeCache[$code] ?? null;
            }
            return null;
        }
        foreach ($this->db['accounts'] as $acc) {
            if (($id && $acc['id'] === $id) || ($code && $acc['code'] === $code)) {
                return $acc;
            }
        }
        return null;
    }

    public function getDefaultFinancialAccount(): ?array
    {
        // Prefer CASH-IQD-01 or CASH_REGISTER active account
        foreach ($this->db['financialAccounts'] as $fa) {
            if (!empty($fa['isActive']) && ($fa['code'] === 'CASH-IQD-01' || $fa['code'] === 'CASH-USD-01')) {
                return $fa;
            }
        }
        foreach ($this->db['financialAccounts'] as $fa) {
            if (!empty($fa['isActive']) && $fa['type'] === 'CASH_REGISTER') return $fa;
        }
        return $this->db['financialAccounts'][0] ?? null;
    }

    public function getInventoryAccountCodeForProduct(?array $product): string
    {
        $type = $product['productType'] ?? 'GENERAL';
        if ($type === 'RAW_MATERIAL' && $this->findAccountByCodeOrId('1310', null)) {
            return '1310';
        }
        if ($type === 'FINISHED_PRODUCT' && $this->findAccountByCodeOrId('1320', null)) {
            return '1320';
        }
        return '1300';
    }

    public function recordFinancialAccountMovement(
        string $financialAccountId,
        float $amountIqd,
        string $direction,
        string $txType,
        string $description,
        ?string $date = null,
        ?string $category = null,
        ?string $referenceType = null,
        ?string $referenceId = null
    ): array {
        $amtIqd = self::roundIqd($amountIqd);
        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;
        $deltaIqd = ($direction === 'IN') ? $amtIqd : -$amtIqd;

        $found = null;
        $newBalIqd = 0.0;
        foreach ($this->db['financialAccounts'] as &$fa) {
            if ($fa['id'] === $financialAccountId) {
                $curIqd = (float)($fa['balanceIqd'] ?? $fa['balanceOriginal'] ?? 0);
                $newBalIqd = self::roundIqd(self::decAdd($curIqd, $deltaIqd));
                $fa['balanceIqd'] = $newBalIqd;
                $fa['balanceOriginal'] = $newBalIqd;
                $fa['balanceUsd'] = self::iqdToUsd($newBalIqd, $rate);
                $fa['currency'] = 'IQD';
                $found = $fa;
                break;
            }
        }
        unset($fa);

        if (!$found) {
            throw new Exception('Financial account not found.');
        }

        $tx = [
            'id' => self::cuid('ctx_'),
            'transactionNumber' => sprintf('CSH-%s-%05d', date('Y'), count($this->db['cashTransactions']) + 1),
            'date' => self::normalizeDateIso($date),
            'type' => $txType,
            'financialAccountId' => $financialAccountId,
            'currency' => 'IQD',
            'exchangeRate' => $rate,
            'amountOriginal' => $amtIqd,
            'amountIqd' => $amtIqd,
            'amountUsd' => self::iqdToUsd($amtIqd, $rate),
            'direction' => $direction,
            'balanceAfterOriginal' => $newBalIqd,
            'balanceAfterIqd' => $newBalIqd,
            'balanceAfterUsd' => self::iqdToUsd($newBalIqd, $rate),
            'category' => $category,
            'description' => $description,
            'referenceType' => $referenceType,
            'referenceId' => $referenceId,
            'createdAt' => self::nowIso(),
        ];
        array_unshift($this->db['cashTransactions'], $tx);
        return $tx;
    }

    // -------------------------------------------------------------------------
    // DOUBLE-ENTRY JOURNAL POSTING ENGINE (IQD-NATIVE, EXACT BALANCING)
    // -------------------------------------------------------------------------
    public function postJournalEntry(array $input): array
    {
        $entryDate = self::normalizeDateIso($input['date'] ?? null);

        $entryTs = strtotime($entryDate);
        foreach ($this->db['periods'] as $period) {
            if (!empty($period['isLocked']) || !empty($period['isClosed'])) {
                if ($entryTs >= strtotime($period['startDate']) && $entryTs <= strtotime($period['endDate'])) {
                    throw new Exception("Cannot post transactions into locked accounting period '{$period['name']}'.");
                }
            }
        }

        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;
        $rawLines = $input['lines'] ?? [];

        if (count($rawLines) < 2) {
            throw new Exception('Double-entry journal requires at least two lines (debit and credit).');
        }

        $activeLines = [];
        $totalDebitIqd = '0';
        $totalCreditIqd = '0';

        foreach ($rawLines as $line) {
            // Support debitIqd/creditIqd natively (or legacy debitUsd/creditUsd converted once)
            if (isset($line['debitIqd']) || isset($line['creditIqd'])) {
                $debitIqd = self::roundIqd($line['debitIqd'] ?? 0);
                $creditIqd = self::roundIqd($line['creditIqd'] ?? 0);
            } else {
                $debitIqd = self::usdToIqd($line['debitUsd'] ?? 0, $rate);
                $creditIqd = self::usdToIqd($line['creditUsd'] ?? 0, $rate);
            }

            if ($debitIqd == 0 && $creditIqd == 0) continue;
            if ($debitIqd < 0 || $creditIqd < 0) {
                throw new Exception('Journal line amounts cannot be negative.');
            }
            if ($debitIqd > 0 && $creditIqd > 0) {
                throw new Exception('A single journal line cannot have both debit and credit > 0.');
            }

            $account = $this->findAccountByCodeOrId($line['accountCode'] ?? null, $line['accountId'] ?? null);
            if (!$account) {
                throw new Exception('Account not found for journal line.');
            }

            $totalDebitIqd = self::decAdd($totalDebitIqd, $debitIqd, 2);
            $totalCreditIqd = self::decAdd($totalCreditIqd, $creditIqd, 2);

            $debitUsd = self::iqdToUsd($debitIqd, $rate);
            $creditUsd = self::iqdToUsd($creditIqd, $rate);

            $activeLines[] = [
                'id' => self::cuid('jl_'),
                'accountId' => $account['id'],
                'description' => $line['description'] ?? $input['description'],
                'debitIqd' => $debitIqd,
                'creditIqd' => $creditIqd,
                'debitOriginal' => $debitIqd,
                'creditOriginal' => $creditIqd,
                'debitUsd' => $debitUsd,
                'creditUsd' => $creditUsd,
                'currency' => 'IQD',
                'customerId' => $line['customerId'] ?? null,
                'supplierId' => $line['supplierId'] ?? null,
            ];
        }

        if (count($activeLines) < 2) {
            throw new Exception('Double-entry journal requires at least two non-zero lines.');
        }

        $debNum = self::roundIqd($totalDebitIqd);
        $credNum = self::roundIqd($totalCreditIqd);

        if (abs($debNum - $credNum) > 0.01) {
            throw new Exception(sprintf(
                'Unbalanced journal entry rejected: Total Debits (%s IQD) !== Total Credits (%s IQD).',
                number_format($debNum),
                number_format($credNum)
            ));
        }

        $count = count($this->db['journals']) + 1;
        $entryId = self::cuid('jrn_');
        $prefix = $this->db['settings']['journalPrefix'] ?? 'JRN-';
        $entryNumber = sprintf('%s%s-%05d', $prefix, date('Y'), $count);

        $entry = [
            'id' => $entryId,
            'entryNumber' => $entryNumber,
            'date' => $entryDate,
            'description' => $input['description'],
            'referenceType' => $input['referenceType'] ?? 'MANUAL',
            'referenceId' => $input['referenceId'] ?? null,
            'currency' => 'IQD',
            'exchangeRate' => $rate,
            'totalDebitIqd' => $debNum,
            'totalCreditIqd' => $credNum,
            'totalDebitUsd' => self::iqdToUsd($debNum, $rate),
            'totalCreditUsd' => self::iqdToUsd($credNum, $rate),
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

            foreach ($this->db['accounts'] as &$acc) {
                if ($acc['id'] === $al['accountId']) {
                    $deltaIqd = ($acc['normalBalance'] === 'DEBIT')
                        ? self::decSub($al['debitIqd'], $al['creditIqd'], 2)
                        : self::decSub($al['creditIqd'], $al['debitIqd'], 2);
                    $acc['balanceIqd'] = self::roundIqd(self::decAdd($acc['balanceIqd'] ?? 0, $deltaIqd, 2));
                    $acc['balanceUsd'] = self::iqdToUsd($acc['balanceIqd'], $rate);
                    break;
                }
            }
            unset($acc);
        }
        unset($al);

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
                'debitIqd' => (float)($ol['creditIqd'] ?? 0),
                'creditIqd' => (float)($ol['debitIqd'] ?? 0),
                'customerId' => $ol['customerId'] ?? null,
                'supplierId' => $ol['supplierId'] ?? null,
            ];
        }

        $reversal = $this->postJournalEntry([
            'description' => "Reversal of {$original['entryNumber']} — {$reason}",
            'referenceType' => 'REVERSAL',
            'referenceId' => $original['id'],
            'reversesEntryId' => $original['id'],
            'lines' => $revLines,
        ]);

        foreach ($this->db['journals'] as &$j) {
            if ($j['id'] === $journalEntryId) {
                $j['status'] = 'REVERSED';
                $j['reversedByEntryId'] = $reversal['id'];
                break;
            }
        }
        unset($j);

        return $reversal;
    }

    // -------------------------------------------------------------------------
    // INVENTORY STOCK MOVEMENT ENGINE (DECIMAL-SAFE + UNIT-AWARE)
    // -------------------------------------------------------------------------
    public function applyStockChange(array $input): array
    {
        $productId = $input['productId'];
        $warehouseId = $input['warehouseId'] ?: ($this->db['warehouses'][0]['id'] ?? '');
        $delta = self::roundQty($input['quantityDelta']);
        if ($delta == 0.0) {
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

        $beforeQty = $whIdx !== null ? self::roundQty($this->db['warehouseStocks'][$whIdx]['quantity']) : 0.0;
        $afterQty = self::roundQty(self::decAdd($beforeQty, $delta, 6));

        $allowNeg = !empty($input['allowNegativeStock']) || !empty($this->db['settings']['allowNegativeStock']);
        if ($afterQty < 0 && !$allowNeg) {
            throw new Exception("Insufficient stock for '{$product['nameKu']}' / '{$product['nameEn']}'. Available: {$beforeQty} {$product['unit']}, Requested: " . abs($delta) . " {$product['unit']}");
        }

        if ($whIdx !== null) {
            $this->db['warehouseStocks'][$whIdx]['quantity'] = $afterQty;
            $this->db['warehouseStocks'][$whIdx]['updatedAt'] = self::nowIso();
        } else {
            $this->db['warehouseStocks'][] = [
                'id' => self::cuid('ws_'),
                'productId' => $productId,
                'warehouseId' => $warehouseId,
                'quantity' => $afterQty,
                'updatedAt' => self::nowIso(),
            ];
        }

        $product['totalStock'] = self::roundQty(self::decAdd($product['totalStock'] ?? 0, $delta, 6));
        $product['updatedAt'] = self::nowIso();

        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;
        $unitCostIqd = isset($input['unitCostIqd'])
            ? self::roundIqd($input['unitCostIqd'])
            : self::roundIqd($product['purchaseCostIqd'] ?? 0);

        $movement = [
            'id' => self::cuid('mov_'),
            'productId' => $productId,
            'warehouseId' => $warehouseId,
            'type' => $input['type'],
            'quantity' => $delta,
            'unit' => $product['unit'],
            'enteredQuantity' => $input['enteredQuantity'] ?? $delta,
            'enteredUnit' => $input['enteredUnit'] ?? $product['unit'],
            'beforeQty' => $beforeQty,
            'afterQty' => $afterQty,
            'unitCostIqd' => $unitCostIqd,
            'unitCostUsd' => self::iqdToUsd($unitCostIqd, $rate),
            'referenceType' => $input['referenceType'] ?? $input['type'],
            'referenceId' => $input['referenceId'] ?? null,
            'reason' => $input['reason'] ?? null,
            'createdAt' => self::normalizeDateIso($input['date'] ?? null),
        ];
        array_unshift($this->db['movements'], $movement);

        if (!empty($input['postJournalForAdjustment'])) {
            $valIqd = self::roundIqd(self::decMul(abs($delta), $unitCostIqd, 6));
            $invCode = $this->getInventoryAccountCodeForProduct($product);
            if ($valIqd > 0) {
                if ($input['type'] === 'OPENING_STOCK') {
                    $this->postJournalEntry([
                        'date' => $input['date'] ?? null,
                        'description' => "Opening stock for {$product['nameKu']} ({$delta} {$product['unit']})",
                        'referenceType' => 'STOCK_ADJUSTMENT',
                        'referenceId' => $movement['id'],
                        'lines' => [
                            ['accountCode' => $invCode, 'debitIqd' => $valIqd, 'creditIqd' => 0],
                            ['accountCode' => '3000', 'debitIqd' => 0, 'creditIqd' => $valIqd],
                        ],
                    ]);
                } elseif ($input['type'] === 'SPOILAGE_WASTE') {
                    $wasteAcc = $this->findAccountByCodeOrId('5210', null) ? '5210' : '5200';
                    $this->postJournalEntry([
                        'date' => $input['date'] ?? null,
                        'description' => "Spoilage/Waste: {$product['nameKu']} (" . abs($delta) . " {$product['unit']}) — " . ($input['reason'] ?? ''),
                        'referenceType' => 'SPOILAGE_WASTE',
                        'referenceId' => $input['referenceId'] ?? $movement['id'],
                        'lines' => [
                            ['accountCode' => $wasteAcc, 'debitIqd' => $valIqd, 'creditIqd' => 0],
                            ['accountCode' => $invCode, 'debitIqd' => 0, 'creditIqd' => $valIqd],
                        ],
                    ]);
                } elseif ($delta > 0) {
                    $this->postJournalEntry([
                        'date' => $input['date'] ?? null,
                        'description' => "Stock adjustment surplus: {$product['nameKu']} (+{$delta} {$product['unit']}) — " . ($input['reason'] ?? ''),
                        'referenceType' => 'STOCK_ADJUSTMENT',
                        'referenceId' => $movement['id'],
                        'lines' => [
                            ['accountCode' => $invCode, 'debitIqd' => $valIqd, 'creditIqd' => 0],
                            ['accountCode' => '5200', 'debitIqd' => 0, 'creditIqd' => $valIqd],
                        ],
                    ]);
                } else {
                    $this->postJournalEntry([
                        'date' => $input['date'] ?? null,
                        'description' => "Stock adjustment reduction: {$product['nameKu']} ({$delta} {$product['unit']}) — " . ($input['reason'] ?? ''),
                        'referenceType' => 'STOCK_ADJUSTMENT',
                        'referenceId' => $movement['id'],
                        'lines' => [
                            ['accountCode' => '5200', 'debitIqd' => $valIqd, 'creditIqd' => 0],
                            ['accountCode' => $invCode, 'debitIqd' => 0, 'creditIqd' => $valIqd],
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

    private function getUsedProductIdsSet(): array
    {
        if ($this->readCacheEnabled && $this->usedProductIdsCache !== null) {
            return $this->usedProductIdsCache;
        }
        $used = [];
        foreach ($this->db['salesInvoiceItems'] as $it) {
            if (!empty($it['productId'])) $used[$it['productId']] = true;
        }
        foreach ($this->db['purchaseInvoiceItems'] as $it) {
            if (!empty($it['productId'])) $used[$it['productId']] = true;
        }
        foreach ($this->db['productionBatches'] as $b) {
            if (!empty($b['finishedProductId'])) $used[$b['finishedProductId']] = true;
            foreach ($b['materialsUsed'] ?? [] as $m) {
                if (!empty($m['rawMaterialId'])) $used[$m['rawMaterialId']] = true;
            }
        }
        foreach ($this->db['recipes'] as $r) {
            if (!empty($r['finishedProductId'])) $used[$r['finishedProductId']] = true;
            foreach ($r['ingredients'] ?? [] as $ing) {
                if (!empty($ing['rawMaterialId'])) $used[$ing['rawMaterialId']] = true;
            }
        }
        foreach ($this->db['spoilageRecords'] as $sr) {
            if (!empty($sr['productId'])) $used[$sr['productId']] = true;
        }
        foreach ($this->db['movements'] as $m) {
            if (!empty($m['productId'])) $used[$m['productId']] = true;
        }
        foreach ($this->db['products'] as $p) {
            if (abs((float)($p['totalStock'] ?? 0)) > 0.0001) {
                $used[$p['id']] = true;
            }
        }
        if ($this->readCacheEnabled) {
            $this->usedProductIdsCache = $used;
        }
        return $used;
    }

    public function isProductUsed(string $productId): bool
    {
        if ($this->readCacheEnabled) {
            $set = $this->getUsedProductIdsSet();
            return isset($set[$productId]);
        }
        foreach ($this->db['salesInvoiceItems'] as $it) {
            if ($it['productId'] === $productId) return true;
        }
        foreach ($this->db['purchaseInvoiceItems'] as $it) {
            if ($it['productId'] === $productId) return true;
        }
        foreach ($this->db['productionBatches'] as $b) {
            if (($b['finishedProductId'] ?? '') === $productId) return true;
            foreach ($b['materialsUsed'] ?? [] as $m) {
                if (($m['rawMaterialId'] ?? '') === $productId) return true;
            }
        }
        foreach ($this->db['recipes'] as $r) {
            if (($r['finishedProductId'] ?? '') === $productId) return true;
            foreach ($r['ingredients'] ?? [] as $ing) {
                if (($ing['rawMaterialId'] ?? '') === $productId) return true;
            }
        }
        foreach ($this->db['spoilageRecords'] as $sr) {
            if (($sr['productId'] ?? '') === $productId) return true;
        }
        foreach ($this->db['movements'] as $m) {
            if (($m['productId'] ?? '') === $productId) return true;
        }
        $p = $this->findById('products', $productId);
        if ($p && abs((float)($p['totalStock'] ?? 0)) > 0.0001) {
            return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // EMPLOYEE SALARY PAYMENT ENGINE (ZERO DOUBLE-COUNTING + DUPLICATE GUARD)
    // -------------------------------------------------------------------------
    public function getEmployeeMonthStats(string $employeeId, string $salaryMonth): array
    {
        $emp = $this->findById('employees', $employeeId);
        $monthly = self::roundIqd($emp['monthlySalaryIqd'] ?? 0);
        $paidTotal = 0.0;
        $advancesTotal = 0.0;
        $regularPaid = 0.0;
        $count = 0;

        foreach ($this->db['salaryPayments'] as $sp) {
            if ($sp['employeeId'] === $employeeId && ($sp['salaryMonth'] ?? '') === $salaryMonth && ($sp['status'] ?? 'POSTED') !== 'REVERSED') {
                $amt = self::roundIqd($sp['amountIqd'] ?? 0);
                $paidTotal = self::roundIqd(self::decAdd($paidTotal, $amt));
                if (($sp['paymentType'] ?? '') === 'ADVANCE') {
                    $advancesTotal = self::roundIqd(self::decAdd($advancesTotal, $amt));
                } else {
                    $regularPaid = self::roundIqd(self::decAdd($regularPaid, $amt));
                }
                $count++;
            }
        }

        // Off days & optional salary deductions for this month
        $offDaysThisMonth = 0.0;
        $deductionsThisMonthIqd = 0.0;
        foreach (($this->db['employeeLeaves'] ?? []) as $lv) {
            if (($lv['employeeId'] ?? '') === $employeeId && ($lv['salaryMonth'] ?? '') === $salaryMonth) {
                $offDaysThisMonth = self::decAdd($offDaysThisMonth, $lv['days'] ?? 0);
                if (!empty($lv['hasDeduction']) && (float)($lv['deductionIqd'] ?? 0) > 0) {
                    $deductionsThisMonthIqd = self::roundIqd(self::decAdd($deductionsThisMonthIqd, $lv['deductionIqd'] ?? 0));
                }
            }
        }

        $netSalary = $monthly > 0 ? max(0.0, self::roundIqd(self::decSub($monthly, $deductionsThisMonthIqd))) : 0.0;
        $remaining = $monthly > 0 ? max(0.0, self::roundIqd(self::decSub($netSalary, $paidTotal))) : 0.0;
        $status = 'NO_SALARY_SET';
        if ($monthly > 0) {
            if ($paidTotal <= 0 && $remaining > 0) $status = 'UNPAID';
            elseif ($remaining <= 0) $status = 'PAID';
            else $status = 'PARTIAL';
        } elseif ($paidTotal > 0) {
            $status = 'PAID';
        }

        return [
            'salaryMonth' => $salaryMonth,
            'monthlySalaryIqd' => $monthly,
            'offDaysThisMonth' => $offDaysThisMonth,
            'deductionsThisMonthIqd' => $deductionsThisMonthIqd,
            'netSalaryIqd' => $netSalary,
            'paidThisMonthIqd' => $paidTotal,
            'regularPaidIqd' => $regularPaid,
            'advancesThisMonthIqd' => $advancesTotal,
            'remainingSalaryIqd' => $remaining,
            'paymentCount' => $count,
            'salaryStatus' => $status,
        ];
    }

    public function hydrateEmployee(array $emp, ?string $month = null): array
    {
        $m = $month ?: self::currentMonthStr();
        $stats = $this->getEmployeeMonthStats($emp['id'], $m);
        return array_merge($emp, $stats);
    }

    public function recordSalaryPayment(array $input): array
    {
        $idemKey = $input['idempotencyKey'] ?? null;
        if ($idemKey) {
            $cached = $this->checkIdempotency($idemKey);
            if ($cached) return $cached;
        }

        $employeeId = $input['employeeId'] ?? '';
        $emp = $this->findById('employees', $employeeId);
        if (!$emp) {
            throw new Exception('Employee not found.');
        }

        $amountIqd = self::roundIqd($input['amountIqd'] ?? $input['amountOriginal'] ?? 0);
        if ($amountIqd <= 0) {
            throw new Exception('Salary payment amount must be greater than zero.');
        }

        $salaryMonth = trim($input['salaryMonth'] ?? '') ?: substr(self::normalizeDateIso($input['date'] ?? null), 0, 7);
        $dateIso = self::normalizeDateIso($input['date'] ?? null);
        $dateDay = substr($dateIso, 0, 10);
        $paymentType = strtoupper(trim($input['paymentType'] ?? ''));
        $stats = $this->getEmployeeMonthStats($employeeId, $salaryMonth);

        if (!$paymentType) {
            if ($stats['monthlySalaryIqd'] > 0 && $amountIqd < $stats['remainingSalaryIqd']) {
                $paymentType = 'PARTIAL';
            } elseif ($stats['monthlySalaryIqd'] > 0 && $stats['remainingSalaryIqd'] <= 0) {
                $paymentType = 'ADVANCE';
            } else {
                $paymentType = 'FULL';
            }
        }

        // Duplicate payment guard (unless explicitly confirmed)
        if (empty($input['confirmDuplicate'])) {
            $nowTs = time();
            foreach ($this->db['salaryPayments'] as $existing) {
                if ($existing['employeeId'] !== $employeeId || ($existing['status'] ?? 'POSTED') === 'REVERSED') {
                    continue;
                }
                $sameMonth = ($existing['salaryMonth'] ?? '') === $salaryMonth;
                $sameAmt = self::roundIqd($existing['amountIqd'] ?? 0) == $amountIqd;
                $sameDay = substr($existing['date'] ?? '', 0, 10) === $dateDay;
                $recentSecs = abs($nowTs - strtotime($existing['createdAt'] ?? '1970-01-01'));

                if ($sameMonth && $sameAmt && ($sameDay || $recentSecs < 300)) {
                    throw new Exception("DUPLICATE_WARNING: A payment of " . number_format($amountIqd) . " IQD for {$emp['name']} ({$salaryMonth}) was already recorded today ({$existing['receiptNumber']}).");
                }
            }
            if ($stats['monthlySalaryIqd'] > 0 && $stats['remainingSalaryIqd'] <= 0 && $paymentType !== 'ADVANCE') {
                throw new Exception("DUPLICATE_WARNING: {$emp['name']} has already received their full monthly salary (" . number_format($stats['monthlySalaryIqd']) . " IQD) for {$salaryMonth}. Choose 'Advance' or confirm to pay extra.");
            }
        }

        $finAccId = $input['financialAccountId'] ?? null;
        $finAcc = $finAccId ? $this->findById('financialAccounts', $finAccId) : $this->getDefaultFinancialAccount();
        if (!$finAcc) {
            throw new Exception('No active cash/bank account found.');
        }

        $salAcc = $this->findAccountByCodeOrId('5110', null) ?: $this->findAccountByCodeOrId('5190', null);
        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;
        $notes = trim($input['notes'] ?? '');

        $expId = self::cuid('exp_');
        $salPayId = self::cuid('sal_');
        $expPrefix = $this->db['settings']['expensePrefix'] ?? 'EXP-';
        $expNum = sprintf('%s%s-%04d', $expPrefix, date('Y'), count($this->db['expenses']) + 1);
        $receiptNum = sprintf('SAL-%s-%04d', date('Y'), count($this->db['salaryPayments']) + 1);

        $typeLabelEn = $paymentType === 'ADVANCE' ? 'Salary Advance' : ($paymentType === 'PARTIAL' ? 'Partial Salary' : 'Salary Payment');
        $title = "{$typeLabelEn} — {$emp['name']} ({$salaryMonth})";

        // 1. Deduct Cash/Bank ONCE and log cash transaction
        $this->recordFinancialAccountMovement(
            $finAcc['id'],
            $amountIqd,
            'OUT',
            'EXPENSE_PAYMENT',
            "{$title} ({$receiptNum})",
            $dateIso,
            'SALARIES',
            'SALARY_PAYMENT',
            $salPayId
        );

        // 2. Post ONE balanced Double-Entry Journal Entry (Debit 5110 Salaries, Credit Cash/Bank)
        $jrn = $this->postJournalEntry([
            'date' => $dateIso,
            'description' => "Salary {$receiptNum}: {$emp['name']} ({$salaryMonth})",
            'referenceType' => 'EXPENSE',
            'referenceId' => $expId,
            'lines' => [
                ['accountId' => $salAcc['id'], 'debitIqd' => $amountIqd, 'creditIqd' => 0],
                ['accountId' => $finAcc['ledgerAccountId'], 'debitIqd' => 0, 'creditIqd' => $amountIqd],
            ],
        ]);

        // 3. Create ONE Expense Record (links directly to salaryPaymentId & journalEntryId — NO double counting!)
        $expense = [
            'id' => $expId,
            'expenseNumber' => $expNum,
            'date' => $dateIso,
            'category' => 'SALARIES',
            'title' => $title,
            'description' => $notes ?: null,
            'vendorName' => $emp['name'] . ($emp['phone'] ? " ({$emp['phone']})" : ''),
            'employeeId' => $emp['id'],
            'employeeName' => $emp['name'],
            'employeePhone' => $emp['phone'],
            'salaryMonth' => $salaryMonth,
            'salaryPaymentType' => $paymentType,
            'salaryPaymentId' => $salPayId,
            'receiptNumber' => $receiptNum,
            'expenseAccountId' => $salAcc['id'],
            'financialAccountId' => $finAcc['id'],
            'paymentMethod' => $input['paymentMethod'] ?? 'CASH',
            'currency' => 'IQD',
            'exchangeRate' => $rate,
            'amountOriginal' => $amountIqd,
            'amountIqd' => $amountIqd,
            'amountUsd' => self::iqdToUsd($amountIqd, $rate),
            'isRecurring' => false,
            'recurringInterval' => null,
            'status' => 'POSTED',
            'journalEntryId' => $jrn['id'],
            'createdAt' => self::nowIso(),
        ];
        array_unshift($this->db['expenses'], $expense);

        // 4. Create Salary Payment Record (references expenseId & journalEntryId)
        $paidBefore = $stats['paidThisMonthIqd'];
        $paidAfter = self::roundIqd(self::decAdd($paidBefore, $amountIqd));
        $remainingAfter = $stats['monthlySalaryIqd'] > 0
            ? max(0.0, self::roundIqd(self::decSub($stats['monthlySalaryIqd'], $paidAfter)))
            : 0.0;

        $salaryPayment = [
            'id' => $salPayId,
            'receiptNumber' => $receiptNum,
            'expenseId' => $expId,
            'expenseNumber' => $expNum,
            'journalEntryId' => $jrn['id'],
            'employeeId' => $emp['id'],
            'employeeCode' => $emp['code'] ?? '',
            'employeeName' => $emp['name'],
            'employeePhone' => $emp['phone'] ?? '',
            'employeePosition' => $emp['position'] ?? '',
            'monthlySalaryIqd' => $stats['monthlySalaryIqd'],
            'salaryMonth' => $salaryMonth,
            'paymentType' => $paymentType,
            'amountIqd' => $amountIqd,
            'paidBeforeIqd' => $paidBefore,
            'paidAfterIqd' => $paidAfter,
            'remainingAfterIqd' => $remainingAfter,
            'financialAccountId' => $finAcc['id'],
            'paymentMethod' => $input['paymentMethod'] ?? 'CASH',
            'date' => $dateIso,
            'notes' => $notes ?: null,
            'status' => 'POSTED',
            'createdAt' => self::nowIso(),
        ];
        array_unshift($this->db['salaryPayments'], $salaryPayment);

        $this->logAudit('SALARY_PAID', 'EMPLOYEES', 'SalaryPayment', $salPayId, "Paid " . number_format($amountIqd) . " IQD ({$paymentType}) to {$emp['name']} for {$salaryMonth} ({$receiptNum})");

        $result = [
            'expense' => $this->hydrateExpense($expense),
            'salaryPayment' => $salaryPayment,
            'employee' => $this->hydrateEmployee($emp, $salaryMonth),
        ];
        $this->storeIdempotency($idemKey, $result);
        return $result;
    }

    // -------------------------------------------------------------------------
    // HYDRATION HELPERS
    // -------------------------------------------------------------------------
    private function getWarehouseStocksForProduct(string $productId): array
    {
        if ($this->readCacheEnabled) {
            if ($this->wsByProductCache === null) {
                $grouped = [];
                foreach ($this->db['warehouseStocks'] as $ws) {
                    $grouped[$ws['productId']][] = $ws;
                }
                $this->wsByProductCache = $grouped;
            }
            return $this->wsByProductCache[$productId] ?? [];
        }
        $out = [];
        foreach ($this->db['warehouseStocks'] as $ws) {
            if ($ws['productId'] === $productId) $out[] = $ws;
        }
        return $out;
    }

    public function hydrateProduct(array $p): array
    {
        $p['category'] = $this->findById('categories', $p['categoryId'] ?? null);
        $p['unitObj'] = $this->findUnitByCode($p['unit'] ?? 'piece');
        $wsList = [];
        foreach ($this->getWarehouseStocksForProduct($p['id']) as $ws) {
            $ws['warehouse'] = $this->findById('warehouses', $ws['warehouseId']);
            $wsList[] = $ws;
        }
        $p['warehouseStocks'] = $wsList;
        return $p;
    }

    public function hydrateExpense(array $e): array
    {
        $e['expenseAccount'] = $this->findById('accounts', $e['expenseAccountId'] ?? null);
        $e['financialAccount'] = $this->findById('financialAccounts', $e['financialAccountId'] ?? null);
        $e['employee'] = !empty($e['employeeId']) ? $this->findById('employees', $e['employeeId']) : null;
        $e['salaryPayment'] = !empty($e['salaryPaymentId']) ? $this->findById('salaryPayments', $e['salaryPaymentId']) : null;
        foreach ($this->db['expenseCategories'] as $ec) {
            if ($ec['code'] === ($e['category'] ?? '')) {
                $e['categoryObj'] = $ec;
                break;
            }
        }
        return $e;
    }

    public function hydrateRecipe(array $r): array
    {
        $prod = $this->findById('products', $r['finishedProductId'] ?? null);
        $r['finishedProduct'] = $prod;
        $hydratedIngs = [];
        $estBatchCostIqd = 0.0;
        foreach ($r['ingredients'] ?? [] as $ing) {
            $rm = $this->findById('products', $ing['rawMaterialId'] ?? null);
            $baseQty = (float)$ing['quantity'];
            $lineCostIqd = 0.0;
            if ($rm) {
                try {
                    $baseQty = $this->convertQuantity($ing['quantity'], $ing['unit'] ?? $rm['unit'], $rm['unit']);
                } catch (Throwable $e) {
                    $baseQty = (float)$ing['quantity'];
                }
                $lineCostIqd = self::roundIqd(self::decMul($baseQty, $rm['purchaseCostIqd'] ?? 0, 6));
                $estBatchCostIqd = self::roundIqd(self::decAdd($estBatchCostIqd, $lineCostIqd));
            }
            $hydratedIngs[] = array_merge($ing, [
                'rawMaterial' => $rm,
                'baseQuantity' => $baseQty,
                'baseUnit' => $rm['unit'] ?? $ing['unit'],
                'availableStock' => $rm ? (float)$rm['totalStock'] : 0.0,
                'estimatedCostIqd' => $lineCostIqd,
            ]);
        }
        $r['ingredients'] = $hydratedIngs;
        $r['estimatedBatchCostIqd'] = $estBatchCostIqd;
        $yieldBase = (float)($r['yieldQuantity'] ?? 1);
        if ($prod && !empty($r['yieldUnit'])) {
            try {
                $yieldBase = $this->convertQuantity($r['yieldQuantity'], $r['yieldUnit'], $prod['unit']);
            } catch (Throwable $e) {}
        }
        $r['estimatedUnitCostIqd'] = $yieldBase > 0 ? self::roundIqd(self::decDiv($estBatchCostIqd, $yieldBase, 4)) : 0.0;
        return $r;
    }

    public function hydrateProductionBatch(array $b): array
    {
        $b['finishedProduct'] = $this->findById('products', $b['finishedProductId'] ?? null);
        $b['warehouse'] = $this->findById('warehouses', $b['warehouseId'] ?? null);
        $mats = [];
        foreach ($b['materialsUsed'] ?? [] as $m) {
            $m['rawMaterial'] = $this->findById('products', $m['rawMaterialId'] ?? null);
            $mats[] = $m;
        }
        $b['materialsUsed'] = $mats;
        return $b;
    }

    public function hydrateSpoilage(array $s): array
    {
        $s['product'] = $this->findById('products', $s['productId'] ?? null);
        $s['warehouse'] = $this->findById('warehouses', $s['warehouseId'] ?? null);
        return $s;
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
        if ($this->readCacheEnabled) {
            if ($this->salesItemsByInvCache === null) {
                $g = [];
                foreach ($this->db['salesInvoiceItems'] as $it) {
                    $g[$it['salesInvoiceId']][] = $it;
                }
                $this->salesItemsByInvCache = $g;
            }
            $inv['items'] = $this->salesItemsByInvCache[$inv['id']] ?? [];
            return $inv;
        }
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
        if ($this->readCacheEnabled) {
            if ($this->purchaseItemsByInvCache === null) {
                $g = [];
                foreach ($this->db['purchaseInvoiceItems'] as $it) {
                    $g[$it['purchaseInvoiceId']][] = $it;
                }
                $this->purchaseItemsByInvCache = $g;
            }
            $inv['items'] = $this->purchaseItemsByInvCache[$inv['id']] ?? [];
            return $inv;
        }
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
        $rawLines = null;
        if ($this->readCacheEnabled) {
            if ($this->journalLinesByEntryCache === null) {
                $g = [];
                foreach ($this->db['journalLines'] as $l) {
                    $g[$l['journalEntryId']][] = $l;
                }
                $this->journalLinesByEntryCache = $g;
            }
            $rawLines = $this->journalLinesByEntryCache[$j['id']] ?? [];
        } else {
            $rawLines = [];
            foreach ($this->db['journalLines'] as $l) {
                if ($l['journalEntryId'] === $j['id']) {
                    $rawLines[] = $l;
                }
            }
        }
        $lines = [];
        foreach ($rawLines as $l) {
            $l['account'] = $this->findById('accounts', $l['accountId']);
            $lines[] = $l;
        }
        $j['lines'] = $lines;
        return $j;
    }

    // -------------------------------------------------------------------------
    // FINANCIAL STATEMENTS (IQD-NATIVE: TRIAL BALANCE, P&L, BALANCE SHEET, GL)
    // -------------------------------------------------------------------------
    public function getTrialBalance(): array
    {
        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;
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
                'totalDebitIqd' => 0.0,
                'totalCreditIqd' => 0.0,
                'debitBalanceIqd' => 0.0,
                'creditBalanceIqd' => 0.0,
                'totalDebitUsd' => 0.0,
                'totalCreditUsd' => 0.0,
                'debitBalanceUsd' => 0.0,
                'creditBalanceUsd' => 0.0,
            ];
        }

        foreach ($this->db['journalLines'] as $line) {
            $aid = $line['accountId'];
            if (isset($map[$aid])) {
                $map[$aid]['totalDebitIqd'] = self::roundIqd(self::decAdd($map[$aid]['totalDebitIqd'], $line['debitIqd'] ?? 0));
                $map[$aid]['totalCreditIqd'] = self::roundIqd(self::decAdd($map[$aid]['totalCreditIqd'], $line['creditIqd'] ?? 0));
            }
        }

        $rows = [];
        $sumDebits = 0.0;
        $sumCredits = 0.0;
        $sumDebitBal = 0.0;
        $sumCreditBal = 0.0;

        foreach ($map as $r) {
            if ($r['totalDebitIqd'] == 0 && $r['totalCreditIqd'] == 0) continue;
            $net = self::roundIqd(self::decSub($r['totalDebitIqd'], $r['totalCreditIqd']));
            if ($net > 0) {
                $r['debitBalanceIqd'] = $net;
            } elseif ($net < 0) {
                $r['creditBalanceIqd'] = abs($net);
            }
            $r['totalDebitUsd'] = self::iqdToUsd($r['totalDebitIqd'], $rate);
            $r['totalCreditUsd'] = self::iqdToUsd($r['totalCreditIqd'], $rate);
            $r['debitBalanceUsd'] = self::iqdToUsd($r['debitBalanceIqd'], $rate);
            $r['creditBalanceUsd'] = self::iqdToUsd($r['creditBalanceIqd'], $rate);

            $sumDebits = self::roundIqd(self::decAdd($sumDebits, $r['totalDebitIqd']));
            $sumCredits = self::roundIqd(self::decAdd($sumCredits, $r['totalCreditIqd']));
            $sumDebitBal = self::roundIqd(self::decAdd($sumDebitBal, $r['debitBalanceIqd']));
            $sumCreditBal = self::roundIqd(self::decAdd($sumCreditBal, $r['creditBalanceIqd']));
            $rows[] = $r;
        }

        return [
            'rows' => $rows,
            'totalDebitIqd' => $sumDebits,
            'totalCreditIqd' => $sumCredits,
            'totalDebitBalanceIqd' => $sumDebitBal,
            'totalCreditBalanceIqd' => $sumCreditBal,
            'totalDebitUsd' => self::iqdToUsd($sumDebits, $rate),
            'totalCreditUsd' => self::iqdToUsd($sumCredits, $rate),
            'totalDebitBalanceUsd' => self::iqdToUsd($sumDebitBal, $rate),
            'totalCreditBalanceUsd' => self::iqdToUsd($sumCreditBal, $rate),
            'isBalanced' => (abs($sumDebits - $sumCredits) < 1) && (abs($sumDebitBal - $sumCreditBal) < 1),
        ];
    }

    public function getProfitAndLoss(): array
    {
        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;
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
        $spoilageLoss = 0.0;
        $opExTotal = 0.0;
        $opBreakdown = [];

        foreach ($this->db['journalLines'] as $line) {
            $acc = $accMap[$line['accountId']] ?? null;
            if (!$acc) continue;
            $debit = (float)($line['debitIqd'] ?? 0);
            $credit = (float)($line['creditIqd'] ?? 0);

            if ($acc['type'] === 'REVENUE') {
                if ($acc['code'] === '4050' || $acc['subType'] === 'SALES_RETURN') {
                    $salesReturns = self::roundIqd(self::decAdd($salesReturns, self::decSub($debit, $credit)));
                } elseif ($acc['code'] === '4100' || $acc['subType'] === 'SALES_DISCOUNT') {
                    $salesDiscounts = self::roundIqd(self::decAdd($salesDiscounts, self::decSub($debit, $credit)));
                } elseif ($acc['code'] === '4200' || $acc['subType'] === 'OTHER_INCOME') {
                    $otherIncome = self::roundIqd(self::decAdd($otherIncome, self::decSub($credit, $debit)));
                } else {
                    $grossSales = self::roundIqd(self::decAdd($grossSales, self::decSub($credit, $debit)));
                }
            } elseif ($acc['type'] === 'EXPENSE') {
                $amt = self::roundIqd(self::decSub($debit, $credit));
                if ($acc['code'] === '5000') {
                    $cogs = self::roundIqd(self::decAdd($cogs, $amt));
                } elseif ($acc['code'] === '5200') {
                    $invAdj = self::roundIqd(self::decAdd($invAdj, $amt));
                } elseif ($acc['code'] === '5210') {
                    $spoilageLoss = self::roundIqd(self::decAdd($spoilageLoss, $amt));
                } else {
                    $opExTotal = self::roundIqd(self::decAdd($opExTotal, $amt));
                    $code = $acc['code'];
                    if (!isset($opBreakdown[$code])) {
                        $opBreakdown[$code] = [
                            'code' => $code,
                            'nameEn' => $acc['nameEn'],
                            'nameAr' => $acc['nameAr'],
                            'nameKu' => $acc['nameKu'],
                            'amountIqd' => 0.0,
                            'amountUsd' => 0.0,
                        ];
                    }
                    $opBreakdown[$code]['amountIqd'] = self::roundIqd(self::decAdd($opBreakdown[$code]['amountIqd'], $amt));
                    $opBreakdown[$code]['amountUsd'] = self::iqdToUsd($opBreakdown[$code]['amountIqd'], $rate);
                }
            }
        }

        $netSales = self::roundIqd(self::decSub(self::decSub($grossSales, $salesReturns), $salesDiscounts));
        $totalRev = self::roundIqd(self::decAdd($netSales, $otherIncome));
        $totalCogs = self::roundIqd(self::decAdd(self::decAdd($cogs, $invAdj), $spoilageLoss));
        $grossProfit = self::roundIqd(self::decSub($totalRev, $totalCogs));
        $netProfit = self::roundIqd(self::decSub($grossProfit, $opExTotal));

        $grossMargin = $totalRev > 0 ? round(($grossProfit / $totalRev) * 100, 1) : 0;
        $netMargin = $totalRev > 0 ? round(($netProfit / $totalRev) * 100, 1) : 0;

        // Profit by product and category
        $prodMap = [];
        $catMap = [];
        foreach ($this->db['salesInvoices'] as $inv) {
            if (!in_array($inv['status'], ['POSTED', 'PARTIALLY_PAID', 'PAID'])) continue;
            foreach ($this->db['salesInvoiceItems'] as $item) {
                if ($item['salesInvoiceId'] !== $inv['id']) continue;
                $netBaseQty = self::roundQty(self::decSub($item['baseQuantity'] ?? $item['quantity'], $item['returnedQty'] ?? 0));
                if ($netBaseQty <= 0) continue;
                $p = $this->findById('products', $item['productId']);
                if (!$p) continue;
                $cat = $this->findById('categories', $p['categoryId']);

                $revIqd = self::roundIqd(self::decSub($item['lineTotalIqd'] ?? 0, $item['taxIqd'] ?? 0));
                $costIqd = self::roundIqd(self::decMul($item['unitCostIqd'] ?? 0, $netBaseQty, 4));
                $profIqd = self::roundIqd(self::decSub($revIqd, $costIqd));

                $pid = $p['id'];
                if (!isset($prodMap[$pid])) {
                    $prodMap[$pid] = [
                        'productId' => $pid,
                        'sku' => $p['sku'],
                        'unit' => $p['unit'],
                        'nameEn' => $p['nameEn'],
                        'nameAr' => $p['nameAr'],
                        'nameKu' => $p['nameKu'],
                        'quantitySold' => 0.0,
                        'revenueIqd' => 0.0,
                        'costIqd' => 0.0,
                        'profitIqd' => 0.0,
                        'revenueUsd' => 0.0,
                        'costUsd' => 0.0,
                        'profitUsd' => 0.0,
                    ];
                }
                $prodMap[$pid]['quantitySold'] = self::roundQty(self::decAdd($prodMap[$pid]['quantitySold'], $netBaseQty));
                $prodMap[$pid]['revenueIqd'] = self::roundIqd(self::decAdd($prodMap[$pid]['revenueIqd'], $revIqd));
                $prodMap[$pid]['costIqd'] = self::roundIqd(self::decAdd($prodMap[$pid]['costIqd'], $costIqd));
                $prodMap[$pid]['profitIqd'] = self::roundIqd(self::decAdd($prodMap[$pid]['profitIqd'], $profIqd));
                $prodMap[$pid]['revenueUsd'] = self::iqdToUsd($prodMap[$pid]['revenueIqd'], $rate);
                $prodMap[$pid]['costUsd'] = self::iqdToUsd($prodMap[$pid]['costIqd'], $rate);
                $prodMap[$pid]['profitUsd'] = self::iqdToUsd($prodMap[$pid]['profitIqd'], $rate);

                if ($cat) {
                    $cid = $cat['id'];
                    if (!isset($catMap[$cid])) {
                        $catMap[$cid] = [
                            'categoryId' => $cid,
                            'nameEn' => $cat['nameEn'],
                            'nameAr' => $cat['nameAr'],
                            'nameKu' => $cat['nameKu'],
                            'revenueIqd' => 0.0,
                            'costIqd' => 0.0,
                            'profitIqd' => 0.0,
                            'revenueUsd' => 0.0,
                            'costUsd' => 0.0,
                            'profitUsd' => 0.0,
                        ];
                    }
                    $catMap[$cid]['revenueIqd'] = self::roundIqd(self::decAdd($catMap[$cid]['revenueIqd'], $revIqd));
                    $catMap[$cid]['costIqd'] = self::roundIqd(self::decAdd($catMap[$cid]['costIqd'], $costIqd));
                    $catMap[$cid]['profitIqd'] = self::roundIqd(self::decAdd($catMap[$cid]['profitIqd'], $profIqd));
                    $catMap[$cid]['revenueUsd'] = self::iqdToUsd($catMap[$cid]['revenueIqd'], $rate);
                    $catMap[$cid]['costUsd'] = self::iqdToUsd($catMap[$cid]['costIqd'], $rate);
                    $catMap[$cid]['profitUsd'] = self::iqdToUsd($catMap[$cid]['profitIqd'], $rate);
                }
            }
        }

        return [
            'grossSalesRevenueIqd' => $grossSales,
            'salesReturnsIqd' => $salesReturns,
            'salesDiscountsIqd' => $salesDiscounts,
            'netSalesRevenueIqd' => $netSales,
            'otherIncomeIqd' => $otherIncome,
            'totalRevenueIqd' => $totalRev,
            'costOfGoodsSoldIqd' => $cogs,
            'inventoryAdjustmentsIqd' => $invAdj,
            'spoilageLossIqd' => $spoilageLoss,
            'totalCogsIqd' => $totalCogs,
            'grossProfitIqd' => $grossProfit,
            'grossMarginPercent' => $grossMargin,
            'operatingExpensesIqd' => $opExTotal,
            'operatingExpenseBreakdown' => array_values($opBreakdown),
            'netProfitIqd' => $netProfit,
            'netMarginPercent' => $netMargin,
            'profitByProduct' => array_values($prodMap),
            'profitByCategory' => array_values($catMap),
            // Legacy USD aliases
            'grossSalesRevenueUsd' => self::iqdToUsd($grossSales, $rate),
            'salesReturnsUsd' => self::iqdToUsd($salesReturns, $rate),
            'salesDiscountsUsd' => self::iqdToUsd($salesDiscounts, $rate),
            'netSalesRevenueUsd' => self::iqdToUsd($netSales, $rate),
            'totalRevenueUsd' => self::iqdToUsd($totalRev, $rate),
            'costOfGoodsSoldUsd' => self::iqdToUsd($cogs, $rate),
            'inventoryAdjustmentsUsd' => self::iqdToUsd($invAdj, $rate),
            'totalCogsUsd' => self::iqdToUsd($totalCogs, $rate),
            'grossProfitUsd' => self::iqdToUsd($grossProfit, $rate),
            'operatingExpensesUsd' => self::iqdToUsd($opExTotal, $rate),
            'netProfitUsd' => self::iqdToUsd($netProfit, $rate),
        ];
    }

    public function getBalanceSheet(?array $precomputedPnl = null): array
    {
        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;
        $balances = [];
        $accMap = [];
        foreach ($this->db['accounts'] as $acc) {
            $balances[$acc['id']] = 0.0;
            $accMap[$acc['id']] = $acc;
        }

        foreach ($this->db['journalLines'] as $line) {
            $acc = $accMap[$line['accountId']] ?? null;
            if (!$acc) continue;
            $debit = (float)($line['debitIqd'] ?? 0);
            $credit = (float)($line['creditIqd'] ?? 0);
            if ($acc['type'] === 'ASSET') {
                $balances[$acc['id']] = self::roundIqd(self::decAdd($balances[$acc['id']], self::decSub($debit, $credit)));
            } elseif ($acc['type'] === 'LIABILITY' || $acc['type'] === 'EQUITY') {
                $balances[$acc['id']] = self::roundIqd(self::decAdd($balances[$acc['id']], self::decSub($credit, $debit)));
            }
        }

        $pnl = $precomputedPnl ?? $this->getProfitAndLoss();
        $netIncomeIqd = (float)$pnl['netProfitIqd'];

        $assets = [];
        $liabilities = [];
        $equity = [];
        $totalAssets = 0.0;
        $totalLiabilities = 0.0;
        $totalEquity = 0.0;

        foreach ($this->db['accounts'] as $acc) {
            $bal = self::roundIqd($balances[$acc['id']] ?? 0);
            if ($bal == 0) continue;
            $row = [
                'code' => $acc['code'],
                'nameEn' => $acc['nameEn'],
                'nameAr' => $acc['nameAr'],
                'nameKu' => $acc['nameKu'],
                'subType' => $acc['subType'],
                'balanceIqd' => $bal,
                'balanceUsd' => self::iqdToUsd($bal, $rate),
            ];
            if ($acc['type'] === 'ASSET') {
                $assets[] = $row;
                $totalAssets = self::roundIqd(self::decAdd($totalAssets, $bal));
            } elseif ($acc['type'] === 'LIABILITY') {
                $liabilities[] = $row;
                $totalLiabilities = self::roundIqd(self::decAdd($totalLiabilities, $bal));
            } elseif ($acc['type'] === 'EQUITY') {
                $equity[] = $row;
                $totalEquity = self::roundIqd(self::decAdd($totalEquity, $bal));
            }
        }

        if ($netIncomeIqd != 0) {
            $equity[] = [
                'code' => '3999',
                'nameEn' => 'Current Period Net Profit / (Loss)',
                'nameAr' => 'صافي الربح / (الخسارة) للفترة الحالية',
                'nameKu' => 'قازانجی سافی / (زیان)ی ماوەی ئێستا',
                'subType' => 'RETAINED_EARNINGS',
                'balanceIqd' => $netIncomeIqd,
                'balanceUsd' => self::iqdToUsd($netIncomeIqd, $rate),
            ];
            $totalEquity = self::roundIqd(self::decAdd($totalEquity, $netIncomeIqd));
        }

        $totalLAndE = self::roundIqd(self::decAdd($totalLiabilities, $totalEquity));

        return [
            'assets' => $assets,
            'liabilities' => $liabilities,
            'equity' => $equity,
            'totalAssetsIqd' => $totalAssets,
            'totalLiabilitiesIqd' => $totalLiabilities,
            'totalEquityIqd' => $totalEquity,
            'totalLiabilitiesAndEquityIqd' => $totalLAndE,
            'totalAssetsUsd' => self::iqdToUsd($totalAssets, $rate),
            'totalLiabilitiesUsd' => self::iqdToUsd($totalLiabilities, $rate),
            'totalEquityUsd' => self::iqdToUsd($totalEquity, $rate),
            'totalLiabilitiesAndEquityUsd' => self::iqdToUsd($totalLAndE, $rate),
            'isBalanced' => abs($totalAssets - $totalLAndE) < 1,
        ];
    }

    public function getGeneralLedger(): array
    {
        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;
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
            $debit = (float)($l['debitIqd'] ?? 0);
            $credit = (float)($l['creditIqd'] ?? 0);
            $delta = $acc['normalBalance'] === 'DEBIT'
                ? self::decSub($debit, $credit)
                : self::decSub($credit, $debit);
            $cur = self::roundIqd(self::decAdd($prev, $delta));
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
                'debitIqd' => $debit,
                'creditIqd' => $credit,
                'runningBalanceIqd' => $cur,
                'debitUsd' => self::iqdToUsd($debit, $rate),
                'creditUsd' => self::iqdToUsd($credit, $rate),
                'runningBalanceUsd' => self::iqdToUsd($cur, $rate),
            ];
        }
        return $out;
    }

    public function getInventoryValuation(): array
    {
        $rate = (float)($this->db['settings']['usdToIqdRate'] ?? 1500) ?: 1500.0;
        $totalCost = 0.0;
        $totalRetail = 0.0;
        $rawMaterialValueIqd = 0.0;
        $finishedProductValueIqd = 0.0;
        $totalUnits = 0.0;
        $lowCount = 0;
        $outCount = 0;
        $items = [];

        foreach ($this->db['products'] as $p) {
            if (isset($p['isActive']) && !$p['isActive']) continue;
            $cat = $this->findById('categories', $p['categoryId'] ?? null);
            $unitObj = $this->findUnitByCode($p['unit'] ?? 'piece');
            $qty = self::roundQty($p['totalStock'] ?? 0);
            $costIqd = self::roundIqd($p['purchaseCostIqd'] ?? 0);
            $priceIqd = self::roundIqd($p['sellingPriceIqd'] ?? 0);
            $min = self::roundQty($p['minStockLevel'] ?? 5);

            $costValIqd = self::roundIqd(self::decMul($qty, $costIqd, 6));
            $retailValIqd = self::roundIqd(self::decMul($qty, $priceIqd, 6));
            $isOut = $qty <= 0;
            $isLow = !$isOut && $qty <= $min;
            if ($isOut) $outCount++;
            if ($isLow) $lowCount++;

            $totalUnits = self::roundQty(self::decAdd($totalUnits, $qty));
            $totalCost = self::roundIqd(self::decAdd($totalCost, $costValIqd));
            $totalRetail = self::roundIqd(self::decAdd($totalRetail, $retailValIqd));
            if (($p['productType'] ?? 'GENERAL') === 'RAW_MATERIAL') {
                $rawMaterialValueIqd = self::roundIqd(self::decAdd($rawMaterialValueIqd, $costValIqd));
            } elseif (($p['productType'] ?? 'GENERAL') === 'FINISHED_PRODUCT') {
                $finishedProductValueIqd = self::roundIqd(self::decAdd($finishedProductValueIqd, $costValIqd));
            }

            $wb = [];
            foreach ($this->getWarehouseStocksForProduct($p['id']) as $ws) {
                $w = $this->findById('warehouses', $ws['warehouseId']);
                if ($w) {
                    $wb[] = [
                        'warehouseId' => $w['id'],
                        'warehouseNameEn' => $w['nameEn'],
                        'warehouseNameAr' => $w['nameAr'],
                        'warehouseNameKu' => $w['nameKu'],
                        'quantity' => self::roundQty($ws['quantity']),
                    ];
                }
            }

            $items[] = [
                'productId' => $p['id'],
                'sku' => $p['sku'],
                'barcode' => $p['barcode'] ?? null,
                'nameEn' => $p['nameEn'],
                'nameAr' => $p['nameAr'],
                'nameKu' => $p['nameKu'],
                'description' => $p['description'] ?? null,
                'imageUrl' => $p['imageUrl'] ?? null,
                'categoryId' => $p['categoryId'] ?? '',
                'categoryNameEn' => $cat['nameEn'] ?? '',
                'categoryNameAr' => $cat['nameAr'] ?? '',
                'categoryNameKu' => $cat['nameKu'] ?? '',
                'productType' => $p['productType'] ?? 'GENERAL',
                'unit' => $p['unit'] ?? 'piece',
                'unitObj' => $unitObj,
                'quantity' => $qty,
                'minStockLevel' => $min,
                'purchaseCostIqd' => $costIqd,
                'sellingPriceIqd' => $priceIqd,
                'costValueIqd' => $costValIqd,
                'retailValueIqd' => $retailValIqd,
                'potentialProfitIqd' => self::roundIqd(self::decSub($retailValIqd, $costValIqd)),
                'purchaseCostUsd' => self::iqdToUsd($costIqd, $rate),
                'sellingPriceUsd' => self::iqdToUsd($priceIqd, $rate),
                'costValueUsd' => self::iqdToUsd($costValIqd, $rate),
                'retailValueUsd' => self::iqdToUsd($retailValIqd, $rate),
                'isLowStock' => $isLow,
                'isOutOfStock' => $isOut,
                'isUsed' => $this->isProductUsed($p['id']),
                'warehouseBreakdown' => $wb,
            ];
        }

        return [
            'items' => $items,
            'totalProducts' => count($items),
            'totalUnits' => $totalUnits,
            'totalCostValueIqd' => $totalCost,
            'totalRetailValueIqd' => $totalRetail,
            'totalPotentialProfitIqd' => self::roundIqd(self::decSub($totalRetail, $totalCost)),
            'rawMaterialValueIqd' => $rawMaterialValueIqd,
            'finishedProductValueIqd' => $finishedProductValueIqd,
            'totalCostValueUsd' => self::iqdToUsd($totalCost, $rate),
            'totalRetailValueUsd' => self::iqdToUsd($totalRetail, $rate),
            'totalPotentialProfitUsd' => self::iqdToUsd(self::decSub($totalRetail, $totalCost), $rate),
            'lowStockCount' => $lowCount,
            'outOfStockCount' => $outCount,
        ];
    }
}
