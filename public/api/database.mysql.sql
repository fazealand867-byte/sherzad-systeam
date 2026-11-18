-- =============================================================================
-- SHERZAD ENTERPRISE ERP & DOUBLE-ENTRY ACCOUNTING SYSTEM
-- Complete MySQL / MariaDB Schema for Hostinger phpMyAdmin
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Key-Value Transactional State Store (Used by PHP PDO MySQL Engine for atomic snapshots)
CREATE TABLE IF NOT EXISTS `erp_state_store` (
  `store_key` VARCHAR(64) NOT NULL PRIMARY KEY,
  `payload_json` LONGTEXT NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Company Settings
CREATE TABLE IF NOT EXISTS `company_settings` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `company_name_en` VARCHAR(255) NOT NULL DEFAULT 'Sherzad Enterprise Group',
  `company_name_ar` VARCHAR(255) NOT NULL DEFAULT 'مجموعة شيرزاد للتجارة العامة والمحاسبة',
  `company_name_ku` VARCHAR(255) NOT NULL DEFAULT 'گرووپی شێرزاد بۆ بازرگانی گشتی و ژمێریاری',
  `phone` VARCHAR(64) NOT NULL DEFAULT '+964 750 320 9900',
  `email` VARCHAR(128) NOT NULL DEFAULT 'finance@sherzad-enterprise.iq',
  `address_en` TEXT,
  `address_ar` TEXT,
  `address_ku` TEXT,
  `tax_number` VARCHAR(64) DEFAULT 'IQ-KRG-9940218',
  `base_currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `default_display_currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `usd_to_iqd_rate` DECIMAL(18,2) NOT NULL DEFAULT 1500.00,
  `default_tax_rate` DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  `sales_invoice_prefix` VARCHAR(16) NOT NULL DEFAULT 'INV-',
  `purchase_invoice_prefix` VARCHAR(16) NOT NULL DEFAULT 'PUR-',
  `expense_prefix` VARCHAR(16) NOT NULL DEFAULT 'EXP-',
  `journal_prefix` VARCHAR(16) NOT NULL DEFAULT 'JRN-',
  `allow_negative_stock` TINYINT(1) NOT NULL DEFAULT 0,
  `expense_approval_threshold_usd` DECIMAL(18,2) NOT NULL DEFAULT 1000.00,
  `default_language` VARCHAR(8) NOT NULL DEFAULT 'ar',
  `last_backup_at` DATETIME NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Users & Employees
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `email` VARCHAR(128) NOT NULL UNIQUE,
  `username` VARCHAR(64) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'SALES_EMPLOYEE',
  `phone` VARCHAR(64) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `preferred_language` VARCHAR(8) NOT NULL DEFAULT 'ar',
  `preferred_currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Chart of Accounts
CREATE TABLE IF NOT EXISTS `accounts` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `code` VARCHAR(32) NOT NULL UNIQUE,
  `name_en` VARCHAR(255) NOT NULL,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_ku` VARCHAR(255) NOT NULL,
  `type` VARCHAR(32) NOT NULL,
  `sub_type` VARCHAR(64) NOT NULL,
  `normal_balance` VARCHAR(16) NOT NULL,
  `is_system` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `balance_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Journal Entries & Lines (Double-Entry General Ledger)
CREATE TABLE IF NOT EXISTS `journal_entries` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `entry_number` VARCHAR(64) NOT NULL UNIQUE,
  `date` DATETIME NOT NULL,
  `description` TEXT NOT NULL,
  `reference_type` VARCHAR(32) NOT NULL,
  `reference_id` VARCHAR(64) NULL,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `exchange_rate` DECIMAL(18,2) NOT NULL DEFAULT 1500.00,
  `total_debit_usd` DECIMAL(18,2) NOT NULL,
  `total_credit_usd` DECIMAL(18,2) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'POSTED',
  `reversed_by_entry_id` VARCHAR(64) NULL,
  `reverses_entry_id` VARCHAR(64) NULL,
  `created_by_id` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `journal_lines` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `journal_entry_id` VARCHAR(64) NOT NULL,
  `account_id` VARCHAR(64) NOT NULL,
  `description` TEXT NULL,
  `debit_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `credit_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `debit_original` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `credit_original` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `customer_id` VARCHAR(64) NULL,
  `supplier_id` VARCHAR(64) NULL,
  INDEX `idx_jrn_entry` (`journal_entry_id`),
  INDEX `idx_jrn_account` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Warehouses, Categories, Products & Stock
CREATE TABLE IF NOT EXISTS `warehouses` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `code` VARCHAR(32) NOT NULL UNIQUE,
  `name_en` VARCHAR(255) NOT NULL,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_ku` VARCHAR(255) NOT NULL,
  `location` VARCHAR(255) NULL,
  `manager_name` VARCHAR(128) NULL,
  `phone` VARCHAR(64) NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `categories` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `code` VARCHAR(32) NOT NULL UNIQUE,
  `name_en` VARCHAR(255) NOT NULL,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_ku` VARCHAR(255) NOT NULL,
  `description` TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `products` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `sku` VARCHAR(64) NOT NULL UNIQUE,
  `barcode` VARCHAR(64) NULL,
  `name_en` VARCHAR(255) NOT NULL,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_ku` VARCHAR(255) NOT NULL,
  `category_id` VARCHAR(64) NOT NULL,
  `unit` VARCHAR(16) NOT NULL DEFAULT 'PCS',
  `purchase_cost_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `selling_price_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `tax_rate` DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  `min_stock_level` DECIMAL(18,2) NOT NULL DEFAULT 5.00,
  `total_stock` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Customers & Suppliers
CREATE TABLE IF NOT EXISTS `customers` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `code` VARCHAR(32) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `company_name` VARCHAR(255) NULL,
  `phone` VARCHAR(64) NOT NULL,
  `email` VARCHAR(128) NULL,
  `address` TEXT NULL,
  `city` VARCHAR(128) NULL,
  `credit_limit_usd` DECIMAL(18,2) NOT NULL DEFAULT 5000.00,
  `balance_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `opening_balance_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `payment_term_days` INT NOT NULL DEFAULT 30,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `suppliers` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `code` VARCHAR(32) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `company_name` VARCHAR(255) NULL,
  `contact_person` VARCHAR(128) NULL,
  `phone` VARCHAR(64) NOT NULL,
  `email` VARCHAR(128) NULL,
  `address` TEXT NULL,
  `city` VARCHAR(128) NULL,
  `tax_number` VARCHAR(64) NULL,
  `balance_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `opening_balance_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `payment_term_days` INT NOT NULL DEFAULT 30,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Sales Invoices, Purchase Invoices, Expenses, Cash & Debt Payments
CREATE TABLE IF NOT EXISTS `sales_invoices` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `invoice_number` VARCHAR(64) NOT NULL UNIQUE,
  `customer_id` VARCHAR(64) NOT NULL,
  `warehouse_id` VARCHAR(64) NOT NULL,
  `date` DATETIME NOT NULL,
  `due_date` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  `payment_type` VARCHAR(32) NOT NULL DEFAULT 'CASH',
  `currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `exchange_rate` DECIMAL(18,2) NOT NULL DEFAULT 1500.00,
  `subtotal_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `discount_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `tax_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `total_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `paid_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `due_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `total_cost_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `gross_profit_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `journal_entry_id` VARCHAR(64) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `purchase_invoices` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `invoice_number` VARCHAR(64) NOT NULL UNIQUE,
  `supplier_invoice_ref` VARCHAR(64) NULL,
  `supplier_id` VARCHAR(64) NOT NULL,
  `warehouse_id` VARCHAR(64) NOT NULL,
  `date` DATETIME NOT NULL,
  `due_date` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  `payment_type` VARCHAR(32) NOT NULL DEFAULT 'CREDIT',
  `currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `exchange_rate` DECIMAL(18,2) NOT NULL DEFAULT 1500.00,
  `total_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `paid_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `due_usd` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `journal_entry_id` VARCHAR(64) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
