<?php
/**
 * SHERZAD ENTERPRISE ERP & DOUBLE-ENTRY ACCOUNTING SYSTEM
 * Hostinger PHP 8 + MySQL / Transactional Storage Configuration
 */

// -----------------------------------------------------------------------------
// 1. HOSTINGER MYSQL CONFIGURATION (Optional - Set DB_USE_MYSQL = true on Hostinger)
// -----------------------------------------------------------------------------
// When deployed on Hostinger:
// - Create a MySQL database in Hostinger hPanel -> Databases -> Management
// - Import `api/database.mysql.sql` via phpMyAdmin (or let the engine auto-create tables)
// - Put your Hostinger MySQL credentials below and set DB_USE_MYSQL to true.
// - Even when DB_USE_MYSQL is false, the system works out-of-the-box using its
//   built-in ACID file-locked transactional database in `api/storage/erp_data.json`!

define('DB_USE_MYSQL', getenv('ERP_USE_MYSQL') === 'true' ? true : false);
define('DB_HOST', getenv('ERP_DB_HOST') ?: 'localhost');
define('DB_PORT', getenv('ERP_DB_PORT') ?: '3306');
define('DB_NAME', getenv('ERP_DB_NAME') ?: 'u123456789_sherzad_erp');
define('DB_USER', getenv('ERP_DB_USER') ?: 'u123456789_admin');
define('DB_PASS', getenv('ERP_DB_PASS') ?: '');

// -----------------------------------------------------------------------------
// 2. SYSTEM SECURITY & STORAGE PATHS
// -----------------------------------------------------------------------------
define('ERP_STORAGE_DIR', __DIR__ . '/storage');
define('ERP_DB_FILE', ERP_STORAGE_DIR . '/erp_database.json');
define('ERP_LOCK_FILE', ERP_STORAGE_DIR . '/erp_database.lock');
define('ERP_SESSION_COOKIE', 'sherzad_erp_session');

date_default_timezone_set('Asia/Baghdad');
