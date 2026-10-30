<?php
/**
 * Database connection (PDO). Edit the settings below to match your MySQL server.
 * Compatible with PHP 5.6+.
 *
 * The app uses its own MySQL account "nfpc_app", which can only reach the nfpc_inventory
 * database (no other databases, no file access), so a bug here can't touch anything else.
 * Its password is below; keep this file private. To recreate the account (as root):
 *   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, CREATE VIEW, SHOW VIEW
 *     ON nfpc_inventory.* TO 'nfpc_app'@'127.0.0.1' IDENTIFIED BY '<password>';
 */

if (!defined('NFPC_APP')) {            // block direct access to this file
    http_response_code(403);
    exit;
}

define('DB_HOST', '127.0.0.1');
define('DB_PORT', '3306');
define('DB_NAME', 'nfpc_inventory');
define('DB_USER', 'nfpc_app');            // dedicated account: access to nfpc_inventory only
define('DB_PASS', '');

// Never print PHP errors to the browser (they leak file paths and break JSON); log them instead.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
date_default_timezone_set('Asia/Kolkata');

function db()
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, array(
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ));
        $pdo->exec("SET time_zone = '+05:30'");
        // Strict mode: reject over-long / out-of-range values instead of silently cutting them short.
        $pdo->exec("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
    }
    return $pdo;
}
