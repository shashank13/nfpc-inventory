<?php
/**
 * Login sessions, roles & permissions, password rules and the activity log.
 * Shared by api.php and the account pages.
 */

if (!defined('NFPC_APP')) {
    http_response_code(403);
    exit;
}
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/schema.php';

define('SESSION_IDLE_SECONDS', 8 * 3600);   // log out after 8 hours of inactivity
define('SESSION_MAX_SECONDS', 12 * 3600);   // and always after 12 hours, even if active
define('MAX_FAILED_LOGINS', 5);             // per account, before a temporary lock
define('LOCK_MINUTES', 15);
define('MAX_FAILED_PER_IP', 20);            // per IP address within LOCK_MINUTES
define('RESET_TOKEN_MINUTES', 30);          // self-service "forgot password" link
define('ADMIN_RESET_TOKEN_HOURS', 24);      // link created by a Super Admin

/** Everything a role can be allowed to do. Viewing the inventory is always allowed. */
function permission_catalog()
{
    return array(
        'products.create'  => array('group' => 'Inventory', 'label' => 'Add products', 'hint' => 'Create new product batches and scan in new barcodes.'),
        'products.edit'    => array('group' => 'Inventory', 'label' => 'Edit products & stock', 'hint' => 'Change product details and stock quantities.'),
        'products.delete'  => array('group' => 'Inventory', 'label' => 'Delete products', 'hint' => 'Permanently remove product batches.'),
        'products.import'  => array('group' => 'Inventory', 'label' => 'Bulk upload', 'hint' => 'Import or update many products from CSV / Excel.'),
        'labels.print'     => array('group' => 'Labels', 'label' => 'Print & download labels', 'hint' => 'Print labels and download barcodes (PNG, SVG, ZIP).'),
        'templates.manage' => array('group' => 'Labels', 'label' => 'Manage label templates', 'hint' => 'Create, edit and delete label designs.'),
        'reports.export'   => array('group' => 'Reports', 'label' => 'Export inventory (CSV)', 'hint' => 'Download the full inventory as a spreadsheet.'),
        'activity.view'    => array('group' => 'Reports', 'label' => 'View activity log', 'hint' => "See everyone's activity: product changes, printing, exports, sign-ins and user changes."),
    );
}

/** Keep only known permission keys. */
function clean_permissions($list)
{
    if (is_string($list)) $list = explode(',', $list);
    if (!is_array($list)) return array();
    $catalog = permission_catalog();
    $out = array();
    foreach ($list as $p) {
        if (is_string($p) && isset($catalog[$p]) && !in_array($p, $out, true)) $out[] = $p;
    }
    return $out;
}

function app_db()
{
    $pdo = db();
    ensure_schema($pdo);
    return $pdo;
}

function start_session()
{
    if (session_id() !== '') return;
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    // Cookie path must match the URL as the browser sees it ("Inventory%20System"), so encode each segment.
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
    $path = implode('/', array_map('rawurlencode', explode('/', $dir))) . '/';
    session_name('NFPC_SESSION');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    if (PHP_VERSION_ID >= 70300) {
        session_set_cookie_params(array('lifetime' => 0, 'path' => $path, 'secure' => $secure,
            'httponly' => true, 'samesite' => 'Lax'));
    } else {
        // PHP < 7.3 has no SameSite option; appending it to the path is the standard workaround.
        // Lax (not Strict) so the session survives clicking a password-reset link in an email.
        session_set_cookie_params(0, $path . '; samesite=Lax', '', $secure, true);
    }
    session_start();

    $idle = isset($_SESSION['last_seen']) && time() - $_SESSION['last_seen'] > SESSION_IDLE_SECONDS;
    $tooOld = isset($_SESSION['login_at']) && time() - $_SESSION['login_at'] > SESSION_MAX_SECONDS;
    if ($idle || $tooOld) {
        clear_session();
        $_SESSION['flash'] = 'timeout';
    }
    $_SESSION['last_seen'] = time();
}

/** Forget the logged-in user but keep a fresh, usable session (for the CSRF token and messages). */
function clear_session()
{
    $_SESSION = array();
    session_regenerate_id(true);
    current_user(true);
}

/**
 * The logged-in user, re-read from the database on every request so that role changes,
 * deactivation and password resets take effect immediately. Returns null if not logged in.
 */
function current_user($forget = false)
{
    static $cache = false;
    if ($forget) { $cache = false; return null; }   // re-read on the next call
    if ($cache !== false) return $cache;
    $cache = null;
    if (empty($_SESSION['uid'])) return null;

    // While a Super Admin is viewing as someone else, check the admin is still allowed to (every request).
    $imp = isset($_SESSION['imp']) && is_array($_SESSION['imp']) ? $_SESSION['imp'] : null;
    if ($imp) {
        $why = impersonation_problem($imp);
        if ($why === 'admin') {             // the admin lost access: sign out completely
            clear_session();
            $_SESSION['flash'] = 'signed_out';
            return null;
        }
        if ($why !== '') {                  // time is up, or the person/role changed: go back to the admin's own account
            end_impersonation($why);
            return current_user();
        }
    }

    $u = load_user_row((int)$_SESSION['uid']);
    $epoch = isset($_SESSION['epoch']) ? (int)$_SESSION['epoch'] : -1;
    if (!$u || !(int)$u['is_active'] || !$u['role_id'] || (int)$u['session_epoch'] !== $epoch) {
        if ($imp) { end_impersonation('The account you were viewing changed.'); return current_user(); }
        clear_session();
        $_SESSION['flash'] = $u && !(int)$u['is_active'] ? 'disabled' : 'signed_out';
        return null;
    }
    $isSuper = (bool)$u['is_super'];
    $cache = array(
        'id'          => (int)$u['id'],
        'username'    => $u['username'],
        'name'        => $u['full_name'] !== '' ? $u['full_name'] : $u['username'],
        'email'       => (string)$u['email'],
        'role'        => $u['role_name'],
        'isSuper'     => $isSuper,
        'perms'       => $isSuper ? array_keys(permission_catalog()) : clean_permissions($u['permissions']),
        'mustChange'  => (bool)$u['must_change_pw'],
        'impersonation' => null,
    );
    if ($imp) {
        if ($imp['mode'] === 'role') {      // admin keeps their identity but gets only this role's permissions
            $r = load_role_row((int)$imp['target']);
            $cache['role'] = $r['name'];
            $cache['isSuper'] = false;
            $cache['perms'] = clean_permissions($r['permissions']);
        }
        $cache['mustChange'] = false;       // the admin is only looking; don't push them into a password change
        $cache['impersonation'] = array(
            'mode'      => $imp['mode'],
            'adminName' => $imp['admin_name'],
            'admin'     => $imp['admin_username'],
            'roleName'  => $cache['role'],
            'secondsLeft' => max(0, IMPERSONATE_SECONDS - (time() - (int)$imp['started'])),
        );
    }
    return $cache;
}

function load_user_row($id)
{
    $st = app_db()->prepare('SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.must_change_pw, u.session_epoch,
                                    r.id AS role_id, r.name AS role_name, r.is_super, r.permissions
                             FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?');
    $st->execute(array((int)$id));
    return $st->fetch();
}

function load_role_row($id)
{
    $st = app_db()->prepare('SELECT id, name, permissions, is_super FROM roles WHERE id = ?');
    $st->execute(array((int)$id));
    return $st->fetch();
}

/* ======================= Impersonation (Super Admin only) =======================
 * Two modes:
 *   'user' — the session switches to another person's account (uid/epoch become theirs).
 *   'role' — the admin stays themselves but gets only the chosen role's permissions.
 * The admin's own session details are kept in $_SESSION['imp'] and restored when it ends.
 * It ends automatically after IMPERSONATE_SECONDS, or as soon as the admin, the person or
 * the role no longer qualifies. Every action taken meanwhile is logged with "via <admin>".
 */
define('IMPERSONATE_SECONDS', 60 * 60);

/** '' if the impersonation may continue; 'admin' if the admin lost access; otherwise a reason to end it. */
function impersonation_problem($imp)
{
    $a = load_user_row((int)$imp['admin_uid']);
    if (!$a || !(int)$a['is_active'] || !(int)$a['is_super'] || (int)$a['session_epoch'] !== (int)$imp['admin_epoch']) return 'admin';
    if (time() - (int)$imp['started'] > IMPERSONATE_SECONDS) return 'Time limit reached (' . max(1, (int)ceil(IMPERSONATE_SECONDS / 60)) . ' min).';
    if ($imp['mode'] === 'user') {
        $t = load_user_row((int)$imp['target']);
        if (!$t || !(int)$t['is_active']) return 'That account was deactivated or deleted.';
        if ((int)$t['is_super']) return 'That account became a Super Admin.';
    } else {
        $r = load_role_row((int)$imp['target']);
        if (!$r || (int)$r['is_super']) return 'That role was deleted or changed.';
    }
    return '';
}

/** Start viewing as a user ('user' mode) or with a role's permissions ('role' mode). Returns an error or ''. */
function start_impersonation($admin, $mode, $targetId, $reason)
{
    if (!$admin || !$admin['isSuper'] || !empty($_SESSION['imp'])) return 'Only a Super Admin can do this.';
    $targetLabel = '';
    if ($mode === 'user') {
        $t = load_user_row($targetId);
        if (!$t) return 'User not found.';
        if ((int)$t['id'] === (int)$admin['id']) return "You can't view as yourself.";
        if (!(int)$t['is_active']) return 'This account is deactivated. Activate it first.';
        if ((int)$t['is_super']) return "Super Admin accounts can't be impersonated.";
        $targetLabel = $t['username'];
    } elseif ($mode === 'role') {
        $r = load_role_row($targetId);
        if (!$r) return 'Role not found.';
        if ((int)$r['is_super']) return 'You already have every Super Admin permission.';
        $targetLabel = 'role: ' . $r['name'];
    } else {
        return 'Unknown mode.';
    }
    $imp = array(
        'mode' => $mode, 'target' => (int)$targetId, 'started' => time(), 'reason' => $reason,
        'admin_uid' => (int)$admin['id'], 'admin_epoch' => (int)$_SESSION['epoch'], 'admin_login_at' => isset($_SESSION['login_at']) ? (int)$_SESSION['login_at'] : time(),
        'admin_username' => $admin['username'], 'admin_name' => $admin['name'], 'label' => $targetLabel,
    );
    // Logged before switching, so the entry is the admin's own action.
    audit('impersonation_started', ($mode === 'user' ? 'Viewing as user' : 'Previewing role') . ($reason !== '' ? ' · reason: ' . $reason : ''),
        $admin['id'], $admin['username'], $targetLabel);
    session_regenerate_id(true);
    $_SESSION['imp'] = $imp;
    if ($mode === 'user') {
        $_SESSION['uid'] = (int)$t['id'];
        $_SESSION['epoch'] = (int)$t['session_epoch'];
    }
    current_user(true);
    return '';
}

/** Return to the admin's own account. $why explains an automatic end (shown once, and logged). */
function end_impersonation($why = '')
{
    if (empty($_SESSION['imp'])) return;
    $imp = $_SESSION['imp'];
    unset($_SESSION['imp']);
    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$imp['admin_uid'];
    $_SESSION['epoch'] = (int)$imp['admin_epoch'];
    $_SESSION['login_at'] = (int)$imp['admin_login_at'];
    if ($why !== '') $_SESSION['imp_notice'] = $why;
    current_user(true);
    audit('impersonation_ended', ($why !== '' ? $why : 'Returned to own account') . ' · lasted ' . max(1, (int)round((time() - (int)$imp['started']) / 60)) . ' min',
        (int)$imp['admin_uid'], $imp['admin_username'], $imp['label']);
}

function is_impersonating()
{
    return !empty($_SESSION['imp']);
}

/** Why an impersonation ended on its own (shown once), or ''. */
function take_imp_notice()
{
    $n = isset($_SESSION['imp_notice']) ? (string)$_SESSION['imp_notice'] : '';
    unset($_SESSION['imp_notice']);
    return $n;
}

function can($user, $perm)
{
    if (!$user) return false;
    if ($perm === 'users.manage') return $user['isSuper'];
    return $user['isSuper'] || in_array($perm, $user['perms'], true);
}

/** Public view of the user for the page's JavaScript. */
function user_for_client($u)
{
    return array('username' => $u['username'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'],
        'isSuper' => $u['isSuper'], 'perms' => $u['perms'], 'mustChange' => $u['mustChange'],
        'impersonation' => isset($u['impersonation']) ? $u['impersonation'] : null);
}

function log_in_user($id)
{
    $pdo = app_db();
    session_regenerate_id(true);   // prevent session fixation
    $st = $pdo->prepare('SELECT session_epoch FROM users WHERE id = ?');
    $st->execute(array((int)$id));
    $_SESSION = array('uid' => (int)$id, 'epoch' => (int)$st->fetchColumn(), 'last_seen' => time(), 'login_at' => time());
    $pdo->prepare('UPDATE users SET last_login = NOW(), failed_logins = 0, locked_until = NULL WHERE id = ?')->execute(array((int)$id));
    current_user(true);
    return current_user();
}

function log_out_user()
{
    $_SESSION = array();
    session_regenerate_id(true);
    session_destroy();
}

/**
 * Sign out every session of a user (after a password change, deactivation, etc.).
 * Pass $keepCurrent = true to keep the caller's own session logged in.
 */
function bump_session_epoch($pdo, $userId, $keepCurrent = false)
{
    $pdo->prepare('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?')->execute(array((int)$userId));
    if ($keepCurrent && isset($_SESSION['uid']) && (int)$_SESSION['uid'] === (int)$userId) {
        $st = $pdo->prepare('SELECT session_epoch FROM users WHERE id = ?');
        $st->execute(array((int)$userId));
        $_SESSION['epoch'] = (int)$st->fetchColumn();
        session_regenerate_id(true);
    }
}

function csrf_token()
{
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(openssl_random_pseudo_bytes(32));
    return $_SESSION['csrf'];
}

function csrf_ok($token)
{
    return is_string($token) && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $token);
}

/** Same headers as .htaccess, so the pages stay protected even if Apache's mod_headers is off. */
function send_security_headers()
{
    if (function_exists('header_remove')) header_remove('X-Powered-By');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
         . "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
         . "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    header('Cross-Origin-Opener-Policy: same-origin');
}

function client_ip()
{
    return isset($_SERVER['REMOTE_ADDR']) ? substr((string)$_SERVER['REMOTE_ADDR'], 0, 45) : '';
}

/** Which tab of the activity log an event belongs to. */
function event_category($event)
{
    static $map = array(
        'login' => 'auth', 'logout' => 'auth', 'login_failed' => 'auth', 'login_blocked' => 'auth', 'signout_others' => 'auth', 'setup' => 'auth',
        'account_locked' => 'security', 'user_unlocked' => 'security', 'password_changed' => 'security', 'password_reset' => 'security',
        'password_set_by_admin' => 'security', 'reset_requested' => 'security', 'reset_link_created' => 'security',
        'profile_updated' => 'security', 'mail_test' => 'security',
        'impersonation_started' => 'security', 'impersonation_ended' => 'security',
        'user_created' => 'admin', 'user_updated' => 'admin', 'user_deleted' => 'admin',
        'role_created' => 'admin', 'role_updated' => 'admin', 'role_deleted' => 'admin',
        'product_created' => 'inventory', 'product_updated' => 'inventory', 'product_deleted' => 'inventory',
        'product_imported' => 'inventory', 'bulk_import' => 'inventory',
        'template_created' => 'labels', 'template_updated' => 'labels', 'template_deleted' => 'labels',
        'labels_printed' => 'labels', 'labels_downloaded' => 'labels', 'inventory_exported' => 'labels',
    );
    return isset($map[$event]) ? $map[$event] : 'other';
}

/** Cut a string to $max characters without breaking a multi-byte (e.g. Kannada) character. */
function utf8_cut($s, $max)
{
    $s = (string)$s;
    if (function_exists('mb_substr')) return mb_substr($s, 0, $max, 'UTF-8');
    if (strlen($s) <= $max) return $s;
    return (string)iconv('UTF-8', 'UTF-8//IGNORE', substr($s, 0, $max));
}

/**
 * Record an activity.
 *   $actorId / $actorName  who did it (null + a typed name for failed sign-ins)
 *   $target                what it was done to, e.g. "Coconut Oil · 1 L · NFPC-OIL-12345" or a username
 *   $changes               for edits: list of [field, before, after]
 * Inside a transaction the entry is rolled back with the change it describes.
 */
function audit($event, $detail = '', $actorId = null, $actorName = '', $target = '', $changes = null)
{
    static $st = null;
    try {
        if ($st === null) {
            $st = app_db()->prepare('INSERT INTO audit_log (user_id, username, via, event, category, detail, target, changes, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        }
        // While impersonating, record the Super Admin who really acted.
        $via = '';
        if (!empty($_SESSION['imp'])) {
            $imp = $_SESSION['imp'];
            $via = $imp['mode'] === 'role' ? 'role preview by ' . $imp['admin_username'] : $imp['admin_username'];
        }
        $st->execute(array($actorId, utf8_cut($actorName, 50), utf8_cut($via, 80), $event, event_category($event), utf8_cut($detail, 500), utf8_cut($target, 190),
            $changes ? json_encode($changes) : null, client_ip()));
    } catch (Exception $e) {
        error_log('audit failed: ' . $e->getMessage());
    }
}

/** Returns an error message, or '' if the password is acceptable. */
function password_problem($pw, $username = '')
{
    if (!is_string($pw) || strlen($pw) < 8) return 'Password must be at least 8 characters.';
    if (strlen($pw) > 72) return 'Password must be at most 72 characters.';
    if (!preg_match('/[A-Za-z]/', $pw) || !preg_match('/[0-9]/', $pw)) return 'Password must include at least one letter and one number.';
    if ($username !== '' && strcasecmp($pw, $username) === 0) return "Password can't be the same as the username.";
    $common = array('password', 'password1', 'password123', '12345678', '123456789', 'qwerty123', 'admin123', 'welcome1', 'abc12345', 'nfpc1234', 'iloveyou1');
    if (in_array(strtolower($pw), $common, true)) return 'That password is too common. Choose another.';
    return '';
}

function random_token()
{
    return bin2hex(openssl_random_pseudo_bytes(32));
}

/** A readable temporary password, e.g. "Kite-4827-mango". */
function generate_temp_password()
{
    $words = array('mango', 'river', 'paddy', 'cocoa', 'pepper', 'lotus', 'cedar', 'monsoon', 'harbor', 'tiger', 'falcon', 'amber', 'coral', 'maple', 'orchid', 'banyan');
    $b = openssl_random_pseudo_bytes(4);
    $w1 = $words[ord($b[0]) % count($words)];
    $w2 = $words[ord($b[1]) % count($words)];
    $n = (ord($b[2]) * 256 + ord($b[3])) % 9000 + 1000;
    return ucfirst($w1) . '-' . $n . '-' . $w2;
}

/** Create a single-use password reset token. Older unused links for the user stop working. */
function create_reset_token($pdo, $userId, $viaAdmin)
{
    $token = random_token();
    $pdo->prepare('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL')->execute(array((int)$userId));
    $mins = $viaAdmin ? ADMIN_RESET_TOKEN_HOURS * 60 : RESET_TOKEN_MINUTES;
    $st = $pdo->prepare('INSERT INTO password_resets (user_id, token_hash, expires_at, via_admin, requested_ip, dismissed)
                         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, ?, ?)');
    $st->execute(array((int)$userId, hash('sha256', $token), $mins, $viaAdmin ? 1 : 0, client_ip(), $viaAdmin ? 1 : 0));
    return array('token' => $token, 'id' => (int)$pdo->lastInsertId(), 'minutes' => $mins);
}

/** Look up a reset token; returns the reset + user row if it's valid, otherwise null. */
function find_reset_token($pdo, $token)
{
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) return null;
    $st = $pdo->prepare('SELECT pr.id AS reset_id, u.id, u.username, u.full_name, u.is_active
                         FROM password_resets pr JOIN users u ON u.id = pr.user_id
                         WHERE pr.token_hash = ? AND pr.used_at IS NULL AND pr.expires_at > NOW()');
    $st->execute(array(hash('sha256', $token)));
    $r = $st->fetch();
    return $r && (int)$r['is_active'] ? $r : null;
}

/** Set a user's password and sign out their other sessions. */
function set_user_password($pdo, $userId, $password, $mustChange, $keepCurrent = false)
{
    $pdo->prepare('UPDATE users SET password_hash = ?, must_change_pw = ?, pw_changed_at = NOW(), failed_logins = 0, locked_until = NULL WHERE id = ?')
        ->execute(array(password_hash($password, PASSWORD_DEFAULT), $mustChange ? 1 : 0, (int)$userId));
    $pdo->prepare('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL')->execute(array((int)$userId));
    bump_session_epoch($pdo, $userId, $keepCurrent);
}

/**
 * Full URL of a page in this app. With $forEmail, the address the browser used is trusted only
 * if it's this machine (localhost or the server's own IP); otherwise APP_URL in mail.php must be
 * set. This stops someone faking the Host header to plant their own site in a reset email.
 * Returns '' if no trusted URL is available.
 */
function app_url($page, $forEmail = false)
{
    if (defined('APP_URL') && APP_URL !== '') return rtrim(APP_URL, '/') . '/' . $page;
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
    $path = implode('/', array_map('rawurlencode', explode('/', $dir)));
    $host = isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'localhost';
    if ($forEmail) {
        $trusted = array('localhost', '127.0.0.1', '::1', '[::1]');
        if (!empty($_SERVER['SERVER_ADDR'])) $trusted[] = $_SERVER['SERVER_ADDR'];
        if (!in_array(strtolower($host), $trusted, true)) return '';
    }
    $port = isset($_SERVER['SERVER_PORT']) ? (int)$_SERVER['SERVER_PORT'] : 80;
    $hostPort = $host . (($secure && $port !== 443) || (!$secure && $port !== 80) ? ':' . $port : '');
    return ($secure ? 'https://' : 'http://') . $hostPort . $path . '/' . $page;
}
