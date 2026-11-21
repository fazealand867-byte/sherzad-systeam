-- =============================================================================
-- SHERZAD FOOD FACTORY & BUSINESS MANAGEMENT SYSTEM (v2.0 - IQD Only)
-- Complete MySQL / MariaDB Schema for Hostinger phpMyAdmin (Safe Additive Migration)
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Key-Value Transactional State Store (Used by PHP PDO MySQL Engine for atomic snapshots)
CREATE TABLE IF NOT EXISTS `erp_state_store` (
  `store_key` VARCHAR(64) NOT NULL PRIMARY KEY,
  `payload_json` LONGTEXT NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Measurement Units (g, kg, piece, pack, box, tray + custom units)
CREATE TABLE IF NOT EXISTS `measurement_units` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `code` VARCHAR(32) NOT NULL UNIQUE,
  `symbol` VARCHAR(32) NOT NULL,
  `name_ku` VARCHAR(128) NOT NULL,
  `name_ar` VARCHAR(128) NOT NULL,
  `name_en` VARCHAR(128) NOT NULL,
  `family` VARCHAR(64) NOT NULL,
  `base_unit_code` VARCHAR(32) NOT NULL,
  `to_base_factor` DECIMAL(18,6) NOT NULL DEFAULT 1.000000,
  `allow_decimal` TINYINT(1) NOT NULL DEFAULT 0,
  `is_system` TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Expense Categories (Salaries, Electricity, Water, Gas, Rent, Maintenance, Raw Materials, etc.)
CREATE TABLE IF NOT EXISTS `expense_categories` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `code` VARCHAR(64) NOT NULL UNIQUE,
  `name_ku` VARCHAR(128) NOT NULL,
  `name_ar` VARCHAR(128) NOT NULL,
  `name_en` VARCHAR(128) NOT NULL,
  `account_code` VARCHAR(32) NOT NULL DEFAULT '5190',
  `is_salary` TINYINT(1) NOT NULL DEFAULT 0,
  `is_system` TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Dedicated HR Employees & Salary Payments (IQD)
CREATE TABLE IF NOT EXISTS `employees` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `code` VARCHAR(32) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(64) NOT NULL,
  `position` VARCHAR(128) NULL,
  `monthly_salary_iqd` DECIMAL(18,0) NOT NULL DEFAULT 0,
  `start_date` DATE NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `salary_payments` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `receipt_number` VARCHAR(64) NOT NULL UNIQUE,
  `employee_id` VARCHAR(64) NOT NULL,
  `expense_id` VARCHAR(64) NULL,
  `journal_entry_id` VARCHAR(64) NULL,
  `salary_month` VARCHAR(7) NOT NULL,
  `payment_type` VARCHAR(32) NOT NULL DEFAULT 'FULL',
  `amount_iqd` DECIMAL(18,0) NOT NULL,
  `remaining_after_iqd` DECIMAL(18,0) NOT NULL DEFAULT 0,
  `date` DATETIME NOT NULL,
  `notes` TEXT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_sal_emp_month` (`employee_id`, `salary_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Food Production Recipes, Batches & Spoilage/Waste
CREATE TABLE IF NOT EXISTS `production_recipes` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `finished_product_id` VARCHAR(64) NOT NULL,
  `yield_quantity` DECIMAL(18,4) NOT NULL DEFAULT 1.0000,
  `yield_unit` VARCHAR(32) NOT NULL DEFAULT 'piece',
  `ingredients_json` LONGTEXT NOT NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `production_batches` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `batch_number` VARCHAR(64) NOT NULL UNIQUE,
  `mode` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
  `recipe_id` VARCHAR(64) NULL,
  `finished_product_id` VARCHAR(64) NOT NULL,
  `warehouse_id` VARCHAR(64) NOT NULL,
  `quantity_produced` DECIMAL(18,4) NOT NULL,
  `unit` VARCHAR(32) NOT NULL,
  `base_quantity_produced` DECIMAL(18,4) NOT NULL,
  `materials_used_json` LONGTEXT NULL,
  `total_material_cost_iqd` DECIMAL(18,0) NOT NULL DEFAULT 0,
  `unit_cost_iqd` DECIMAL(18,0) NOT NULL DEFAULT 0,
  `date` DATETIME NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
  `journal_entry_id` VARCHAR(64) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spoilage_records` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `record_number` VARCHAR(64) NOT NULL UNIQUE,
  `product_id` VARCHAR(64) NOT NULL,
  `warehouse_id` VARCHAR(64) NOT NULL,
  `quantity` DECIMAL(18,4) NOT NULL,
  `unit` VARCHAR(32) NOT NULL,
  `base_quantity` DECIMAL(18,4) NOT NULL,
  `total_cost_iqd` DECIMAL(18,0) NOT NULL DEFAULT 0,
  `reason` VARCHAR(128) NOT NULL,
  `notes` TEXT NULL,
  `date` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
