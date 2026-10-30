<?php
/**
 * Automatic database upgrades. Runs once per schema version, the first time any page
 * connects after the code is updated, so existing installs don't need a manual SQL import.
 */

if (!defined('NFPC_APP')) {
    http_response_code(403);
    exit;
}

define('SCHEMA_VERSION', 5);

function schema_version($pdo)
{
    try {
        return (int)$pdo->query("SELECT v FROM app_meta WHERE k = 'schema_version'")->fetchColumn();
    } catch (PDOException $e) {
        return 0;   // app_meta table doesn't exist yet
    }
}

function ensure_schema($pdo)
{
    if (schema_version($pdo) >= SCHEMA_VERSION) return;

    // Only one request may run the upgrade; the others wait here.
    $pdo->query("SELECT GET_LOCK('nfpc_schema_upgrade', 30)");
    try {
        if (schema_version($pdo) < 2) migrate_to_2($pdo);
        if (schema_version($pdo) < 3) migrate_to_3($pdo);
        if (schema_version($pdo) < 4) migrate_to_4($pdo);
        if (schema_version($pdo) < 5) migrate_to_5($pdo);
    } catch (Exception $e) {
        $pdo->query("SELECT RELEASE_LOCK('nfpc_schema_upgrade')");
        throw $e;
    }
    $pdo->query("SELECT RELEASE_LOCK('nfpc_schema_upgrade')");
}

function column_exists($pdo, $table, $column)
{
    $st = $pdo->prepare('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $st->execute(array($table, $column));
    return (bool)$st->fetchColumn();
}

function index_exists($pdo, $table, $index)
{
    $st = $pdo->prepare('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?');
    $st->execute(array($table, $index));
    return (bool)$st->fetchColumn();
}

/** Version 2: roles & permissions, account status, password resets, activity log. */
function migrate_to_2($pdo)
{
    $opts = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    $pdo->exec("CREATE TABLE IF NOT EXISTS app_meta (
        k  VARCHAR(50)  NOT NULL,
        v  VARCHAR(255) NOT NULL DEFAULT '',
        PRIMARY KEY (k)
    ) $opts");

    $pdo->exec("CREATE TABLE IF NOT EXISTS roles (
        id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name         VARCHAR(50)  NOT NULL,
        description  VARCHAR(255) NOT NULL DEFAULT '',
        permissions  VARCHAR(1000) NOT NULL DEFAULT '',
        is_super     TINYINT(1)   NOT NULL DEFAULT 0,
        created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP    NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_roles_name (name)
    ) $opts");

    $seed = $pdo->prepare('INSERT IGNORE INTO roles (name, description, permissions, is_super) VALUES (?, ?, ?, ?)');
    $seed->execute(array('Super Admin', 'Full access, including managing users and roles.', '', 1));
    $seed->execute(array('Manager', 'Full inventory access: products, bulk upload, label templates and exports.',
        'products.create,products.edit,products.delete,products.import,labels.print,templates.manage,reports.export', 0));
    $seed->execute(array('Inventory Staff', 'Adds and updates products and prints labels. Cannot delete.',
        'products.create,products.edit,labels.print', 0));
    $seed->execute(array('Viewer', 'Read-only access to the inventory.', '', 0));
    $superId = (int)$pdo->query("SELECT id FROM roles WHERE is_super = 1 ORDER BY id LIMIT 1")->fetchColumn();

    $cols = array(
        'full_name'      => "VARCHAR(100) NOT NULL DEFAULT '' AFTER username",
        'email'          => "VARCHAR(190) NULL DEFAULT NULL AFTER full_name",
        'role_id'        => "INT UNSIGNED NULL DEFAULT NULL AFTER password_hash",
        'is_active'      => "TINYINT(1) NOT NULL DEFAULT 1 AFTER role_id",
        'must_change_pw' => "TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active",
        'failed_logins'  => "INT UNSIGNED NOT NULL DEFAULT 0 AFTER must_change_pw",
        'locked_until'   => "DATETIME NULL DEFAULT NULL AFTER failed_logins",
        'pw_changed_at'  => "DATETIME NULL DEFAULT NULL AFTER locked_until",
        'session_epoch'  => "INT UNSIGNED NOT NULL DEFAULT 1 AFTER pw_changed_at",
        'created_by'     => "INT UNSIGNED NULL DEFAULT NULL AFTER session_epoch",
        'updated_at'     => "TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
    );
    foreach ($cols as $c => $def) {
        if (!column_exists($pdo, 'users', $c)) $pdo->exec("ALTER TABLE users ADD COLUMN $c $def");
    }
    if (!index_exists($pdo, 'users', 'uq_users_email')) $pdo->exec('ALTER TABLE users ADD UNIQUE KEY uq_users_email (email)');
    if (!index_exists($pdo, 'users', 'fk_users_role')) {
        $pdo->exec('ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id) ON UPDATE CASCADE ON DELETE RESTRICT');
    }
    // Before roles existed every account was an administrator, so existing accounts become Super Admins.
    $pdo->prepare('UPDATE users SET role_id = ? WHERE role_id IS NULL')->execute(array($superId));

    $pdo->exec("CREATE TABLE IF NOT EXISTS password_resets (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id       INT UNSIGNED NOT NULL,
        token_hash    CHAR(64)     NOT NULL,
        expires_at    DATETIME     NOT NULL,
        used_at       DATETIME     NULL DEFAULT NULL,
        via_admin     TINYINT(1)   NOT NULL DEFAULT 0,
        mail_sent     TINYINT(1)   NOT NULL DEFAULT 0,
        dismissed     TINYINT(1)   NOT NULL DEFAULT 0,
        requested_ip  VARCHAR(45)  NOT NULL DEFAULT '',
        created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_resets_token (token_hash),
        KEY idx_resets_user (user_id),
        CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
    ) $opts");

    $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id     INT UNSIGNED NULL DEFAULT NULL,
        username    VARCHAR(50)  NOT NULL DEFAULT '',
        event       VARCHAR(40)  NOT NULL,
        detail      VARCHAR(255) NOT NULL DEFAULT '',
        ip          VARCHAR(45)  NOT NULL DEFAULT '',
        created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_audit_created (created_at),
        KEY idx_audit_event_ip (event, ip, created_at)
    ) $opts");

    $pdo->exec("INSERT INTO app_meta (k, v) VALUES ('schema_version', '2') ON DUPLICATE KEY UPDATE v = '2'");
}

/** Version 3: give accounts created before version 2 a display name and a password date. */
function migrate_to_3($pdo)
{
    $pdo->exec("UPDATE users SET full_name = username WHERE full_name = ''");
    $pdo->exec('UPDATE users SET pw_changed_at = created_at WHERE pw_changed_at IS NULL');
    $pdo->exec("UPDATE app_meta SET v = '3' WHERE k = 'schema_version'");
}

/**
 * Version 4: one activity log for everything.
 * audit_log now records the person who acted (user_id/username), what they acted on (target),
 * a category for filtering, and field-by-field changes for edits. Earlier stock history is copied in.
 */
function migrate_to_4($pdo)
{
    if (!column_exists($pdo, 'audit_log', 'category')) {
        $pdo->exec("ALTER TABLE audit_log
            ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT 'other' AFTER event,
            ADD COLUMN target VARCHAR(190) NOT NULL DEFAULT '' AFTER detail,
            ADD COLUMN changes TEXT NULL AFTER target,
            MODIFY detail VARCHAR(500) NOT NULL DEFAULT ''");
    }
    if (!index_exists($pdo, 'audit_log', 'idx_audit_cat')) $pdo->exec('ALTER TABLE audit_log ADD KEY idx_audit_cat (category, created_at)');
    if (!index_exists($pdo, 'audit_log', 'idx_audit_user')) $pdo->exec('ALTER TABLE audit_log ADD KEY idx_audit_user (username, created_at)');

    $cats = array(
        'auth'     => "'login','logout','login_failed','login_blocked','signout_others','setup'",
        'security' => "'account_locked','user_unlocked','password_changed','password_reset','password_set_by_admin','reset_requested','reset_link_created','profile_updated','mail_test'",
        'admin'    => "'user_created','user_updated','user_deleted','role_created','role_updated','role_deleted'",
    );
    foreach ($cats as $c => $list) $pdo->exec("UPDATE audit_log SET category = '$c' WHERE event IN ($list) AND category = 'other'");
    // Before v4, admin actions stored the affected user in username; move it to target (the actor wasn't recorded).
    $pdo->exec("UPDATE audit_log SET target = username, username = '', user_id = NULL
                WHERE event IN ('user_created','user_updated','user_deleted','password_set_by_admin','reset_link_created','user_unlocked') AND target = ''");
    $pdo->exec("UPDATE audit_log SET target = SUBSTRING_INDEX(detail, ':', 1) WHERE event = 'role_created' AND target = ''");

    // Copy earlier stock history so the activity log starts complete (once, even if this upgrade is retried).
    $already = (int)$pdo->query("SELECT COUNT(*) FROM audit_log WHERE category = 'inventory'")->fetchColumn();
    if (!$already) $pdo->exec("INSERT INTO audit_log (user_id, username, event, category, detail, target, ip, created_at)
        SELECT NULL, sm.username,
               CASE sm.action WHEN 'create' THEN 'product_created' WHEN 'update' THEN 'product_updated'
                              WHEN 'import' THEN 'product_imported' ELSE 'product_deleted' END,
               'inventory',
               CONCAT(IF(sm.note <> '', CONCAT(sm.note, ' · '), ''),
                      IF(sm.action = 'delete', CONCAT('Stock was ', sm.qty_before),
                         IF(sm.qty_before = sm.qty_after, CONCAT('Stock ', sm.qty_after), CONCAT('Stock ', sm.qty_before, ' → ', sm.qty_after)))),
               LEFT(CONCAT(sm.product_name, ' · ', sm.sku), 190), '', sm.created_at
        FROM stock_movements sm");

    // Managers can see the activity log by default (Super Admins always can).
    $pdo->exec("UPDATE roles SET permissions = CONCAT(permissions, IF(permissions = '', '', ','), 'activity.view')
                WHERE name = 'Manager' AND is_super = 0 AND FIND_IN_SET('activity.view', permissions) = 0");

    $pdo->exec("UPDATE app_meta SET v = '4' WHERE k = 'schema_version'");
}

/** Version 5: record who really acted while a Super Admin was viewing the app as someone else. */
function migrate_to_5($pdo)
{
    if (!column_exists($pdo, 'audit_log', 'via')) {
        $pdo->exec("ALTER TABLE audit_log ADD COLUMN via VARCHAR(80) NOT NULL DEFAULT '' AFTER username");
    }
    $pdo->exec("UPDATE app_meta SET v = '5' WHERE k = 'schema_version'");
}
