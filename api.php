<?php
/**
 * JSON API for the inventory and admin pages. All actions require a signed-in user, and each
 * action checks the permission it needs (see permission_catalog() in auth.php).
 *
 * Inventory
 *   GET  api.php?action=list                 -> categories + all products + templates + current user
 *   POST api.php?action=save    {product}    -> create (no id, products.create) or update (with id, products.edit)
 *   POST api.php?action=delete  {id}         -> delete a product (products.delete)
 *   POST api.php?action=bulk    {rows:[...], update:true}  (products.import)
 *   POST api.php?action=template_save   {id?, name, settings, makeDefault}  (templates.manage)
 *   POST api.php?action=template_delete {id}                                 (templates.manage)
 *   POST api.php?action=logout                (while impersonating: returns to your own account)
 *   POST impersonate_start {mode:"user"|"role", id, reason?}   (Super Admin)   POST impersonate_stop
 *
 * Users & roles (Super Admin only)
 *   GET  admin_data
 *
 * Activity log (activity.view)
 *   GET  activity_list   ?page&size&q&cat&user&from&to&meta=1
 *   GET  activity_export (same filters, up to 20,000 rows)
 *   POST log_event {event, target, detail}   (printing / downloads / exports done in the browser)
 *   POST user_save, user_delete, user_password, user_reset_link, user_unlock,
 *        role_save, role_delete, reset_dismiss
 *
 * Every request must send the header "X-Requested-With: XMLHttpRequest". Browsers won't let
 * another website add that header to a cross-site request, so this blocks CSRF attacks.
 */

define('NFPC_APP', true);
require __DIR__ . '/auth.php';
require __DIR__ . '/mail.php';

// Compress responses (the full product list shrinks ~10x) when the browser supports it.
if (extension_loaded('zlib') && !ini_get('zlib.output_compression')) ob_start('ob_gzhandler');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
send_security_headers();

$UNITS = array('kg', 'g', 'L', 'ml', 'pcs', 'dozen', 'bunch');
define('MAX_BULK_ROWS', 5000);

/** Error whose message is safe to show to the user. */
class AppError extends Exception {}

function respond($data, $code = 200)
{
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function fail($msg, $code = 400)
{
    respond(array('ok' => false, 'error' => $msg), $code);
}

function input()
{
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : array();
}

function val($a, $k, $default = '')
{
    return isset($a[$k]) && is_scalar($a[$k]) ? $a[$k] : $default;
}

function str($a, $k, $max, $label, $required = false)
{
    $s = trim((string)val($a, $k));
    if ($required && $s === '') throw new AppError($label . ' is required.');
    if (function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') > $max : strlen($s) > $max) {
        throw new AppError($label . ' is too long (max ' . $max . ' characters).');
    }
    return $s;
}

function num($a, $k, $default, $label, $min, $max)
{
    $v = val($a, $k, $default);
    if ($v === '' || !is_numeric($v)) throw new AppError($label . ' must be a number.');
    $v = (float)$v;
    if (!is_finite($v) || $v < $min || $v > $max) throw new AppError($label . ' is out of range.');
    return $v;
}

function valid_date($s)
{
    $d = DateTime::createFromFormat('!Y-m-d', (string)$s);
    return $d && $d->format('Y-m-d') === $s && $s >= '2000-01-01' && $s <= '2099-12-31';
}

/** Shape a DB row the way the page's JavaScript expects it. */
function to_item($r)
{
    return array(
        'id'     => (string)$r['id'],
        'sku'    => $r['sku'],
        'name'   => $r['name'],
        'cat'    => $r['category'],
        'grade'  => $r['grade'],
        'net'    => (float)$r['pack_size'],
        'unit'   => $r['unit'],
        'qty'    => (int)$r['qty'],
        'price'  => (float)$r['mrp'],
        'loc'    => $r['location'],
        'batch'  => $r['batch_no'],
        'source' => $r['sourced_from'],
        'packed' => $r['packed_on'],
        'best'   => $r['best_before'],
    );
}

function fetch_items($pdo, $id = null)
{
    $sql = 'SELECT p.*, c.name AS category FROM products p JOIN categories c ON c.id = p.category_id';
    if ($id !== null) {
        $st = $pdo->prepare($sql . ' WHERE p.id = ?');
        $st->execute(array($id));
    } else {
        $st = $pdo->query($sql . ' ORDER BY p.created_at DESC, p.id DESC');
    }
    return array_map('to_item', $st->fetchAll());
}

/** Validate a product coming from the page; returns a DB-ready array or throws AppError. */
function clean_product($pdo, $p)
{
    global $UNITS;
    $out = array(
        'name'         => str($p, 'name', 150, 'Product name', true),
        'grade'        => str($p, 'grade', 100, 'Grade'),
        'pack_size'    => num($p, 'net', 1, 'Pack size', 0.001, 9999999),
        'unit'         => (string)val($p, 'unit', 'kg'),
        'qty'          => (int)num($p, 'qty', 0, 'Stock', 0, 2000000000),
        'mrp'          => round(num($p, 'price', 0, 'MRP', 0, 99999999.99), 2),
        'location'     => str($p, 'loc', 100, 'Location'),
        'batch_no'     => str($p, 'batch', 50, 'Batch number', true),
        'sourced_from' => str($p, 'source', 150, 'Sourced from'),
        'packed_on'    => (string)val($p, 'packed'),
        'best_before'  => (string)val($p, 'best'),
        'sku'          => str($p, 'sku', 64, 'SKU / barcode', true),
    );
    if (!preg_match('/^[\x20-\x7E]+$/', $out['sku'])) throw new AppError('SKU has unsupported characters (use English letters, digits, - or /).');
    if (!in_array($out['unit'], $UNITS, true)) throw new AppError('Invalid unit.');
    if (!valid_date($out['packed_on']))        throw new AppError('Invalid packed date.');
    if (!valid_date($out['best_before']))      throw new AppError('Invalid best-before date.');
    if ($out['best_before'] < $out['packed_on']) throw new AppError("Best-before date can't be earlier than packed date.");

    $st = $pdo->prepare('SELECT id FROM categories WHERE name = ?');
    $st->execute(array((string)val($p, 'cat')));
    $catId = $st->fetchColumn();
    if (!$catId) {
        $st->execute(array('Others'));
        $catId = $st->fetchColumn();
    }
    if (!$catId) throw new AppError('Unknown category.');
    $out['category_id'] = (int)$catId;
    return $out;
}

function log_move($pdo, $productId, $sku, $name, $action, $before, $after, $note = '')
{
    global $USER;
    $st = $pdo->prepare('INSERT INTO stock_movements (product_id, sku, product_name, action, username, qty_before, qty_after, qty_change, note)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $st->execute(array($productId, $sku, $name, $action, $USER['username'], $before, $after, $after - $before, $note));
}

/* ---------- Activity log helpers for products ---------- */

function category_name($pdo, $id)
{
    static $names = null;
    if ($names === null) {
        $names = array();
        foreach ($pdo->query('SELECT id, name FROM categories') as $r) $names[(int)$r['id']] = $r['name'];
    }
    return isset($names[(int)$id]) ? $names[(int)$id] : '';
}

function fmt_num($n)
{
    return rtrim(rtrim(number_format((float)$n, 3, '.', ''), '0'), '.');
}

/** "Coconut Oil · 500 ml · NFPC-OIL-12345" — how a product is named in the activity log. */
function product_label($name, $size, $unit, $sku)
{
    return $name . ' · ' . fmt_num($size) . ' ' . $unit . ' · ' . $sku;
}

/** Product fields as people read them, for before/after comparison. */
function product_view($pdo, $r)
{
    return array(
        'Name' => $r['name'], 'Category' => category_name($pdo, $r['category_id']), 'Grade' => $r['grade'],
        'Pack size' => fmt_num($r['pack_size']) . ' ' . $r['unit'], 'Stock' => (string)(int)$r['qty'],
        'MRP' => '₹' . fmt_num($r['mrp']), 'Location' => $r['location'], 'Batch' => $r['batch_no'],
        'Sourced from' => $r['sourced_from'], 'Packed on' => $r['packed_on'], 'Best before' => $r['best_before'], 'SKU' => $r['sku'],
    );
}

function product_activity($pdo, $event, $d, $detail, $changes = null)
{
    global $USER;
    audit($event, $detail, $USER['id'], $USER['username'], product_label($d['name'], $d['pack_size'], $d['unit'], $d['sku']), $changes);
}

function insert_product($pdo, $d, $action)
{
    $st = $pdo->prepare('INSERT INTO products (sku, name, category_id, grade, pack_size, unit, qty, mrp, location, batch_no, sourced_from, packed_on, best_before)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $st->execute(array($d['sku'], $d['name'], $d['category_id'], $d['grade'], $d['pack_size'], $d['unit'], $d['qty'],
        $d['mrp'], $d['location'], $d['batch_no'], $d['sourced_from'], $d['packed_on'], $d['best_before']));
    $id = (int)$pdo->lastInsertId();
    log_move($pdo, $id, $d['sku'], $d['name'], $action, 0, $d['qty']);
    product_activity($pdo, $action === 'import' ? 'product_imported' : 'product_created', $d,
        ($action === 'import' ? 'Added by bulk upload · ' : '') . 'Stock ' . (int)$d['qty'] . ' · MRP ₹' . fmt_num($d['mrp']) . ' · ' . category_name($pdo, $d['category_id']));
    return $id;
}

function update_product($pdo, $id, $d, $action)
{
    $st = $pdo->prepare('SELECT * FROM products WHERE id = ? FOR UPDATE');
    $st->execute(array($id));
    $old = $st->fetch();
    if (!$old) throw new AppError('Product not found (it may have been deleted). Reload the page.');

    $st = $pdo->prepare('UPDATE products SET sku=?, name=?, category_id=?, grade=?, pack_size=?, unit=?, qty=?, mrp=?, location=?,
                         batch_no=?, sourced_from=?, packed_on=?, best_before=? WHERE id=?');
    $st->execute(array($d['sku'], $d['name'], $d['category_id'], $d['grade'], $d['pack_size'], $d['unit'], $d['qty'],
        $d['mrp'], $d['location'], $d['batch_no'], $d['sourced_from'], $d['packed_on'], $d['best_before'], $id));
    log_move($pdo, $id, $d['sku'], $d['name'], $action, (int)$old['qty'], $d['qty']);

    // Record exactly which fields changed.
    $a = product_view($pdo, $old);
    $b = product_view($pdo, $d);
    $changes = array();
    foreach ($a as $field => $before) {
        if ((string)$before !== (string)$b[$field]) $changes[] = array($field, $before, $b[$field]);
    }
    $summary = array();
    foreach (array_slice($changes, 0, 4) as $c) $summary[] = $c[0] . ' ' . ($c[1] === '' ? '—' : $c[1]) . ' → ' . ($c[2] === '' ? '—' : $c[2]);
    if (count($changes) > 4) $summary[] = '+' . (count($changes) - 4) . ' more';
    $detail = ($action === 'import' ? 'Updated by bulk upload · ' : '') . ($summary ? implode(', ', $summary) : 'Saved with no changes');
    product_activity($pdo, 'product_updated', $d, $detail, $changes ? $changes : null);
}

function sku_taken($pdo, $sku, $exceptId = 0)
{
    $st = $pdo->prepare('SELECT id FROM products WHERE sku = ? AND id <> ?');
    $st->execute(array($sku, (int)$exceptId));
    return $st->fetchColumn();
}

function is_duplicate_key($e)
{
    return $e instanceof PDOException && isset($e->errorInfo[1]) && (int)$e->errorInfo[1] === 1062;
}

/* ========================== Label templates ========================== */

define('MAX_LOGO_CHARS', 500000);   // ~370 KB image; the page shrinks logos before upload

/** Whitelist + validate template settings so only known, safe values are stored. */
function clean_template_settings($s)
{
    if (!is_array($s)) $s = array();
    $show = isset($s['show']) && is_array($s['show']) ? $s['show'] : array();
    $flags = array('net', 'batch', 'packed', 'best', 'grade', 'source', 'mrp', 'barcodeText', 'footer');
    $out = array(
        'brand'      => str($s, 'brand', 80, 'Brand name', true),
        'tagline'    => str($s, 'tagline', 100, 'Tagline'),
        'logoMode'   => in_array(val($s, 'logoMode'), array('default', 'custom', 'none'), true) ? val($s, 'logoMode') : 'default',
        'logo'       => '',
        'logoAspect' => 1,
        'color'      => preg_match('/^#[0-9a-fA-F]{6}$/', (string)val($s, 'color')) ? strtolower(val($s, 'color')) : '#2f7d32',
        'header'     => val($s, 'header') === 'line' ? 'line' : 'band',
        'mrpText'    => str($s, 'mrpText', 60, 'MRP text'),
        'address'    => str($s, 'address', 200, 'Address'),
        'cin'        => str($s, 'cin', 40, 'CIN'),
        'fssai'      => str($s, 'fssai', 30, 'FSSAI number'),
        'contact'    => str($s, 'contact', 80, 'Contact'),
        'note'       => str($s, 'note', 150, 'Extra note'),
        'perRow'     => max(1, min(5, (int)val($s, 'perRow', 3))),
        'show'       => array(),
    );
    foreach ($flags as $f) $out['show'][$f] = !isset($show[$f]) || (bool)$show[$f];

    if ($out['logoMode'] === 'custom') {
        $logo = (string)val($s, 'logo');
        if ($logo === '') throw new AppError('Upload a logo image, or choose "Default leaf" / "No logo".');
        if (strlen($logo) > MAX_LOGO_CHARS) throw new AppError('Logo image is too large.');
        if (!preg_match('#^data:image/(png|jpeg);base64,([A-Za-z0-9+/]+=*)$#', $logo, $m)) throw new AppError('Logo must be a PNG or JPEG image.');
        $bin = base64_decode($m[2], true);
        $info = $bin === false ? false : @getimagesizefromstring($bin);
        if (!$info || !in_array($info['mime'], array('image/png', 'image/jpeg'), true) || $info[0] > 2000 || $info[1] > 2000) {
            throw new AppError('Logo file is not a valid image.');
        }
        $out['logo'] = $logo;
        $out['logoAspect'] = round(max(0.2, min(5, $info[0] / max(1, $info[1]))), 4);
    }
    return $out;
}

function fetch_templates($pdo)
{
    $rows = $pdo->query('SELECT id, name, settings, is_default FROM label_templates ORDER BY is_default DESC, name')->fetchAll();
    $out = array();
    foreach ($rows as $r) {
        $s = json_decode($r['settings'], true);
        $out[] = array('id' => (string)$r['id'], 'name' => $r['name'], 'isDefault' => (bool)$r['is_default'],
            'settings' => is_array($s) ? $s : new stdClass());
    }
    return $out;
}

/** Make sure exactly one template is the default (the given one, or the oldest). */
function fix_default_template($pdo, $id = 0)
{
    if (!$id) {
        $id = (int)$pdo->query('SELECT id FROM label_templates ORDER BY is_default DESC, id LIMIT 1')->fetchColumn();
        if (!$id) return;
    }
    $pdo->prepare('UPDATE label_templates SET is_default = (id = ?)')->execute(array((int)$id));
}

/* ========================== Users & roles ========================== */

function require_perm($perm)
{
    global $USER;
    if (!can($USER, $perm)) fail("You don't have permission to do this. Ask a Super Admin to change your role.", 403);
}

function admin_users($pdo)
{
    $rows = $pdo->query('SELECT u.id, u.username, u.full_name, u.email, u.role_id, u.is_active, u.must_change_pw,
                                (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS locked,
                                u.last_login, u.created_at, u.pw_changed_at, r.name AS role_name, r.is_super, c.username AS created_by_name
                         FROM users u LEFT JOIN roles r ON r.id = u.role_id LEFT JOIN users c ON c.id = u.created_by
                         ORDER BY u.is_active DESC, r.is_super DESC, u.full_name, u.username')->fetchAll();
    $out = array();
    foreach ($rows as $r) {
        $out[] = array('id' => (string)$r['id'], 'username' => $r['username'], 'name' => $r['full_name'], 'email' => (string)$r['email'],
            'roleId' => (string)$r['role_id'], 'role' => (string)$r['role_name'], 'isSuper' => (bool)$r['is_super'],
            'active' => (bool)$r['is_active'], 'mustChange' => (bool)$r['must_change_pw'], 'locked' => (bool)$r['locked'],
            'lastLogin' => $r['last_login'], 'created' => $r['created_at'], 'pwChanged' => $r['pw_changed_at'],
            'createdBy' => (string)$r['created_by_name']);
    }
    return $out;
}

function admin_roles($pdo)
{
    $rows = $pdo->query('SELECT r.id, r.name, r.description, r.permissions, r.is_super, COUNT(u.id) AS users
                         FROM roles r LEFT JOIN users u ON u.role_id = r.id
                         GROUP BY r.id, r.name, r.description, r.permissions, r.is_super
                         ORDER BY r.is_super DESC, r.name')->fetchAll();
    $out = array();
    foreach ($rows as $r) {
        $out[] = array('id' => (string)$r['id'], 'name' => $r['name'], 'description' => $r['description'], 'isSuper' => (bool)$r['is_super'],
            'perms' => $r['is_super'] ? array_keys(permission_catalog()) : clean_permissions($r['permissions']), 'users' => (int)$r['users']);
    }
    return $out;
}

/** "Forgot password" requests that weren't emailed, so a Super Admin needs to act on them. */
function admin_resets($pdo)
{
    $rows = $pdo->query('SELECT pr.id, pr.created_at, pr.requested_ip, u.id AS user_id, u.username, u.full_name, u.email, u.is_active
                         FROM password_resets pr JOIN users u ON u.id = pr.user_id
                         WHERE pr.via_admin = 0 AND pr.mail_sent = 0 AND pr.dismissed = 0 AND pr.used_at IS NULL
                           AND pr.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
                         ORDER BY pr.created_at DESC')->fetchAll();
    $out = array();
    foreach ($rows as $r) {
        $out[] = array('id' => (string)$r['id'], 'userId' => (string)$r['user_id'], 'username' => $r['username'], 'name' => $r['full_name'],
            'email' => (string)$r['email'], 'active' => (bool)$r['is_active'], 'requested' => $r['created_at'], 'ip' => $r['requested_ip']);
    }
    return $out;
}

function admin_payload($pdo, $extra = array())
{
    $perms = array();
    foreach (permission_catalog() as $k => $p) $perms[] = array('key' => $k, 'group' => $p['group'], 'label' => $p['label'], 'hint' => $p['hint']);
    return array_merge(array('ok' => true, 'users' => admin_users($pdo), 'roles' => admin_roles($pdo), 'resets' => admin_resets($pdo),
        'permissions' => $perms, 'mailEnabled' => mail_enabled(), 'mailFrom' => mail_enabled() ? mail_from() : ''), $extra);
}

function find_user($pdo, $id)
{
    $st = $pdo->prepare('SELECT u.*, r.is_super FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ? FOR UPDATE');
    $st->execute(array((int)$id));
    $u = $st->fetch();
    if (!$u) throw new AppError('User not found (they may have been deleted). Reload the page.');
    return $u;
}

/** Number of active Super Admins other than $exceptId. */
function other_active_supers($pdo, $exceptId)
{
    $st = $pdo->prepare('SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_super = 1 AND u.is_active = 1 AND u.id <> ? FOR UPDATE');
    $st->execute(array((int)$exceptId));
    return (int)$st->fetchColumn();
}

/** Usernames and emails share one namespace, because either can be used to sign in. */
function login_name_taken($pdo, $value, $exceptId)
{
    if ($value === '') return false;
    $st = $pdo->prepare('SELECT 1 FROM users WHERE (username = ? OR email = ?) AND id <> ?');
    $st->execute(array($value, $value, (int)$exceptId));
    return (bool)$st->fetchColumn();
}

/** WHERE clause for the activity log filters: q (search), cat, user, from / to (YYYY-MM-DD). */
function activity_filter($g)
{
    $w = array();
    $a = array();
    $get = function ($k) use ($g) { return isset($g[$k]) && is_string($g[$k]) ? trim($g[$k]) : ''; };
    $cat = $get('cat');
    if (in_array($cat, array('inventory', 'labels', 'admin', 'auth', 'security'), true)) { $w[] = 'category = ?'; $a[] = $cat; }
    if (($user = $get('user')) !== '') { $w[] = '(username = ? OR via = ?)'; array_push($a, $user, $user); }
    if (($from = $get('from')) !== '' && valid_date($from)) { $w[] = 'created_at >= ?'; $a[] = $from . ' 00:00:00'; }
    if (($to = $get('to')) !== '' && valid_date($to)) { $w[] = 'created_at < DATE_ADD(?, INTERVAL 1 DAY)'; $a[] = $to; }
    if (($q = $get('q')) !== '') {
        $like = '%' . addcslashes(utf8_cut($q, 100), '%_\\') . '%';
        $w[] = '(target LIKE ? OR detail LIKE ? OR username LIKE ? OR via LIKE ? OR event LIKE ? OR ip LIKE ?)';
        array_push($a, $like, $like, $like, $like, $like, $like);
    }
    return array($w ? 'WHERE ' . implode(' AND ', $w) : '', $a);
}

/* ============================== Router ============================== */

$action = isset($_GET['action']) && is_string($_GET['action']) ? $_GET['action'] : 'list';
$method = $_SERVER['REQUEST_METHOD'];

// CSRF protection: require the custom header (cross-site pages can't send it without CORS approval).
$xrw = isset($_SERVER['HTTP_X_REQUESTED_WITH']) ? $_SERVER['HTTP_X_REQUESTED_WITH'] : '';
if ($xrw !== 'XMLHttpRequest') fail('Bad request.', 403);
if (!in_array($action, array('list', 'dashboard', 'admin_data', 'activity_list', 'activity_export'), true)) {
    if ($method !== 'POST') fail('Use POST for this action.', 405);
    $ctype = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
    if (stripos($ctype, 'application/json') !== 0) fail('Bad request.', 415);
}

try {
    $pdo = app_db();
} catch (PDOException $e) {
    error_log('api.php DB connect error: ' . $e->getMessage());
    fail('Could not connect to the database. Check that MySQL is running and the settings in db.php.', 500);
}

start_session();
$USER = current_user();
if (!$USER) fail('Please sign in.', 401);

// Impersonation changes the session, so it's handled before the session is closed below.
if ($action === 'logout' && is_impersonating()) {
    end_impersonation();                     // "Sign out" while viewing as someone returns to your own account
    respond(array('ok' => true, 'returned' => true));
}
if ($action === 'logout') {
    audit('logout', '', $USER['id'], $USER['username']);
    log_out_user();
    respond(array('ok' => true));
}
if ($action === 'impersonate_stop') {
    end_impersonation();
    respond(array('ok' => true));
}
if ($action === 'impersonate_start') {
    if (is_impersonating()) fail('Return to your own account first.');
    if (!can($USER, 'users.manage')) fail('Only a Super Admin can view the app as someone else.', 403);
    $p = input();
    $mode = (string)val($p, 'mode');
    $reason = trim(utf8_cut(val($p, 'reason'), 150));
    $err = start_impersonation($USER, $mode, (int)val($p, 'id', 0), $reason);
    if ($err !== '') fail($err);
    respond(array('ok' => true));
}
if ($USER['mustChange']) {
    respond(array('ok' => false, 'code' => 'must_change', 'error' => 'Set a new password to continue.'), 403);
}
$NOTICE = take_imp_notice();   // one-time message after an impersonation ended on its own
session_write_close();   // release the session lock so parallel requests don't queue

try {
    switch ($action) {

        case 'list':
            $cats = $pdo->query('SELECT name, code, color, shelf_life_days AS life, default_unit AS unit FROM categories ORDER BY sort_order, name')->fetchAll();
            foreach ($cats as &$c) $c['life'] = (int)$c['life'];
            unset($c);
            $pending = $USER['isSuper'] ? count(admin_resets($pdo)) : 0;
            respond(array('ok' => true, 'user' => user_for_client($USER), 'notice' => $NOTICE, 'pendingResets' => $pending, 'categories' => $cats,
                'items' => fetch_items($pdo), 'templates' => fetch_templates($pdo)));

        /* ----------------------- Users & roles ----------------------- */

        case 'admin_data':
            require_perm('users.manage');
            respond(admin_payload($pdo));

        /* ------------------------- Dashboard ------------------------- */

        case 'dashboard':
            // Everyone signed in can see the inventory, so everyone gets the dashboard.
            // Totals are calculated in the database so this stays fast with large inventories.
            $days = (int)(isset($_GET['days']) ? $_GET['days'] : 30);
            if (!in_array($days, array(7, 30, 90), true)) $days = 30;
            $LOW = 10;
            $k = $pdo->query("SELECT COUNT(*) AS products, COALESCE(SUM(qty),0) AS units, COALESCE(SUM(qty*mrp),0) AS value,
                    SUM(qty <= 0) AS out_stock, SUM(qty > 0 AND qty < $LOW) AS low_stock, SUM(qty >= $LOW) AS ok_stock,
                    SUM(best_before >= CURDATE() AND best_before <= DATE_ADD(CURDATE(), INTERVAL 15 DAY)) AS expiring,
                    SUM(best_before < CURDATE()) AS expired,
                    SUM(best_before < CURDATE() AND qty > 0) AS expired_in_stock
                FROM products")->fetch();
            foreach ($k as $f => $v) $k[$f] = $f === 'value' ? round((float)$v, 2) : (int)$v;

            $byCat = $pdo->query("SELECT c.name AS cat, c.color, COUNT(p.id) AS products, COALESCE(SUM(p.qty),0) AS units,
                    COALESCE(SUM(p.qty > 0 AND p.qty < $LOW),0) AS low, COALESCE(SUM(p.id IS NOT NULL AND p.qty <= 0),0) AS out_stock,
                    COALESCE(SUM(p.qty*p.mrp),0) AS value
                FROM categories c LEFT JOIN products p ON p.category_id = c.id
                GROUP BY c.id, c.name, c.color, c.sort_order ORDER BY value DESC, products DESC, c.sort_order")->fetchAll();
            foreach ($byCat as &$c) { $c['products'] = (int)$c['products']; $c['units'] = (int)$c['units']; $c['low'] = (int)$c['low']; $c['out_stock'] = (int)$c['out_stock']; $c['value'] = round((float)$c['value'], 2); }
            unset($c);

            // Stock added / removed per day (from the stock ledger).
            $st = $pdo->prepare("SELECT DATE(created_at) AS d, SUM(GREATEST(qty_change,0)) AS added, SUM(GREATEST(-qty_change,0)) AS removed
                FROM stock_movements WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY DATE(created_at)");
            $st->execute(array($days - 1));
            $mv = array();
            foreach ($st as $r) $mv[$r['d']] = array((int)$r['added'], (int)$r['removed']);
            $movement = array();
            for ($i = $days - 1; $i >= 0; $i--) {
                $d = date('Y-m-d', strtotime("-$i day"));
                $movement[] = array('date' => $d, 'added' => isset($mv[$d]) ? $mv[$d][0] : 0, 'removed' => isset($mv[$d]) ? $mv[$d][1] : 0);
            }

            // Batches expiring in each of the next 12 weeks.
            $ex = $pdo->query("SELECT FLOOR(DATEDIFF(best_before, CURDATE()) / 7) AS w, COUNT(*) AS batches, COALESCE(SUM(qty),0) AS units
                FROM products WHERE best_before >= CURDATE() AND best_before < DATE_ADD(CURDATE(), INTERVAL 84 DAY) GROUP BY w")->fetchAll();
            $weeks = array();
            for ($w = 0; $w < 12; $w++) $weeks[$w] = array('week' => $w, 'from' => date('Y-m-d', strtotime('+' . ($w * 7) . ' day')), 'batches' => 0, 'units' => 0);
            foreach ($ex as $r) { $w = (int)$r['w']; if (isset($weeks[$w])) { $weeks[$w]['batches'] = (int)$r['batches']; $weeks[$w]['units'] = (int)$r['units']; } }

            $list = function ($sql) use ($pdo) {
                $out = array();
                foreach ($pdo->query($sql) as $r) {
                    $out[] = array('id' => (string)$r['id'], 'sku' => $r['sku'], 'name' => $r['name'], 'cat' => $r['category'], 'net' => (float)$r['pack_size'],
                        'unit' => $r['unit'], 'qty' => (int)$r['qty'], 'price' => (float)$r['mrp'], 'best' => $r['best_before'],
                        'value' => round((float)$r['qty'] * (float)$r['mrp'], 2));
                }
                return $out;
            };
            $base = 'SELECT p.*, c.name AS category FROM products p JOIN categories c ON c.id = p.category_id';
            $out = array('ok' => true, 'days' => $days, 'today' => date('Y-m-d'), 'lowLimit' => $LOW, 'kpi' => $k, 'byCategory' => $byCat,
                'movement' => $movement, 'expiryWeeks' => array_values($weeks),
                'topValue' => $list("$base WHERE p.qty > 0 ORDER BY p.qty * p.mrp DESC LIMIT 8"),
                'lowStock' => $list("$base WHERE p.qty < $LOW ORDER BY p.qty ASC, p.name LIMIT 8"),
                'expiringSoon' => $list("$base WHERE p.best_before <= DATE_ADD(CURDATE(), INTERVAL 15 DAY) ORDER BY (p.best_before < CURDATE()) DESC, p.best_before ASC LIMIT 8"));

            if (can($USER, 'activity.view')) {
                $st = $pdo->prepare("SELECT
                        SUM(event IN ('product_created','product_imported')) AS added_products,
                        SUM(event = 'product_updated') AS edits, SUM(event = 'product_deleted') AS deletes,
                        SUM(event = 'labels_printed') AS prints, SUM(event = 'labels_downloaded') AS downloads,
                        COUNT(DISTINCT IF(user_id IS NOT NULL, username, NULL)) AS people
                    FROM audit_log WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)");
                $st->execute(array($days - 1));
                $a = $st->fetch();
                foreach ($a as $f => $v) $a[$f] = (int)$v;
                $out['activity'] = $a;
                $out['recent'] = $pdo->query("SELECT created_at, username, via, event, target, detail FROM audit_log
                    WHERE category IN ('inventory','labels') ORDER BY created_at DESC, id DESC LIMIT 8")->fetchAll();
            }
            respond($out);

        /* ----------------------- Activity log ----------------------- */

        case 'activity_list':
        case 'activity_export':
            require_perm('activity.view');
            $export = $action === 'activity_export';
            list($where, $args) = activity_filter($_GET);
            $cnt = $pdo->prepare("SELECT COUNT(*) FROM audit_log $where");
            $cnt->execute($args);
            $total = (int)$cnt->fetchColumn();
            $size = $export ? 20000 : max(10, min(200, (int)(isset($_GET['size']) ? $_GET['size'] : 50)));
            $page = $export ? 1 : max(1, (int)(isset($_GET['page']) ? $_GET['page'] : 1));
            $page = min($page, max(1, (int)ceil($total / $size)));
            $st = $pdo->prepare("SELECT id, created_at, username, via, event, category, detail, target, changes, ip FROM audit_log $where
                                 ORDER BY created_at DESC, id DESC LIMIT " . (int)$size . ' OFFSET ' . (int)(($page - 1) * $size));
            $st->execute($args);
            $rows = array();
            foreach ($st as $r) {
                $r['changes'] = $r['changes'] ? json_decode($r['changes'], true) : null;
                $rows[] = $r;
            }
            $out = array('ok' => true, 'rows' => $rows, 'total' => $total, 'page' => $page, 'size' => $size);
            if (!$export && !empty($_GET['meta'])) {
                $out['users'] = $pdo->query("SELECT DISTINCT username FROM audit_log WHERE username <> '' AND user_id IS NOT NULL ORDER BY username")->fetchAll(PDO::FETCH_COLUMN);
                $out['stats'] = $pdo->query("SELECT
                        SUM(created_at >= CURDATE()) AS today,
                        COUNT(DISTINCT IF(created_at >= CURDATE() AND user_id IS NOT NULL, username, NULL)) AS users_today,
                        SUM(created_at >= CURDATE() AND category = 'inventory') AS stock_today,
                        SUM(created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) AND event IN ('login_failed','account_locked','login_blocked')) AS failed_24h
                    FROM audit_log WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)")->fetch();
            }
            respond($out);

        case 'log_event':
            // Actions that happen in the browser (printing, downloads, exports) report themselves here.
            $p = input();
            $event = (string)val($p, 'event');
            $need = array('labels_printed' => 'labels.print', 'labels_downloaded' => 'labels.print', 'inventory_exported' => 'reports.export');
            if (!isset($need[$event])) fail('Unknown event.');
            require_perm($need[$event]);
            audit($event, utf8_cut(val($p, 'detail'), 300), $USER['id'], $USER['username'], utf8_cut(val($p, 'target'), 190));
            respond(array('ok' => true));

        case 'user_save':
            require_perm('users.manage');
            $p = input();
            $id = (int)val($p, 'id', 0);
            $username = str($p, 'username', 50, 'Username', true);
            $name = str($p, 'name', 100, 'Full name', true);
            $email = str($p, 'email', 190, 'Email');
            $roleId = (int)val($p, 'roleId', 0);
            $active = !empty($p['active']);
            if (!preg_match('/^[A-Za-z0-9_.@-]{3,50}$/', $username)) throw new AppError('Username must be 3–50 characters: letters, digits, _ . @ -');
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new AppError('Enter a valid email address, or leave it blank.');

            $pdo->beginTransaction();
            $st = $pdo->prepare('SELECT id, name, is_super FROM roles WHERE id = ?');
            $st->execute(array($roleId));
            $role = $st->fetch();
            if (!$role) throw new AppError('Choose a role.');
            if (login_name_taken($pdo, $username, $id)) throw new AppError('That username is already taken.');
            if (login_name_taken($pdo, $email, $id)) throw new AppError('That email address is already used by another account.');

            if ($id) {
                $old = find_user($pdo, $id);
                if ($id === $USER['id'] && !$active) throw new AppError("You can't deactivate your own account.");
                if ($id === $USER['id'] && !$role['is_super']) throw new AppError("You can't remove your own Super Admin role. Ask another Super Admin.");
                if ($old['is_super'] && $old['is_active'] && (!$role['is_super'] || !$active) && other_active_supers($pdo, $id) === 0) {
                    throw new AppError('This is the only active Super Admin. Make someone else a Super Admin first.');
                }
                $pdo->prepare('UPDATE users SET username = ?, full_name = ?, email = ?, role_id = ?, is_active = ? WHERE id = ?')
                    ->execute(array($username, $name, $email !== '' ? $email : null, $roleId, $active ? 1 : 0, $id));
                $changes = array();
                if ((int)$old['role_id'] !== $roleId) $changes[] = 'role → ' . $role['name'];
                if ((bool)$old['is_active'] !== $active) $changes[] = $active ? 'activated' : 'deactivated';
                if (strcasecmp($old['username'], $username) !== 0) $changes[] = 'username was ' . $old['username'];
                if (!$active && $old['is_active']) bump_session_epoch($pdo, $id);   // sign them out now
                $pdo->commit();
                audit('user_updated', $changes ? implode(', ', $changes) : 'Profile details', $USER['id'], $USER['username'], $username);
                respond(admin_payload($pdo, array('id' => (string)$id)));
            }

            $password = (string)val($p, 'password', '');
            if ($problem = password_problem($password, $username)) throw new AppError($problem);
            $mustChange = !isset($p['mustChange']) || !empty($p['mustChange']);
            $pdo->prepare('INSERT INTO users (username, full_name, email, password_hash, role_id, is_active, must_change_pw, pw_changed_at, created_by)
                           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)')
                ->execute(array($username, $name, $email !== '' ? $email : null, password_hash($password, PASSWORD_DEFAULT), $roleId,
                    $active ? 1 : 0, $mustChange ? 1 : 0, $USER['id']));
            $newId = (int)$pdo->lastInsertId();
            $pdo->commit();
            audit('user_created', 'Role: ' . $role['name'] . ($active ? '' : ' (inactive)'), $USER['id'], $USER['username'], $username);
            respond(admin_payload($pdo, array('id' => (string)$newId)));

        case 'user_delete':
            require_perm('users.manage');
            $id = (int)val(input(), 'id', 0);
            if ($id === $USER['id']) fail("You can't delete your own account.");
            $pdo->beginTransaction();
            $u = find_user($pdo, $id);
            if ($u['is_super'] && $u['is_active'] && other_active_supers($pdo, $id) === 0) throw new AppError("You can't delete the only active Super Admin.");
            $pdo->prepare('DELETE FROM users WHERE id = ?')->execute(array($id));
            $pdo->commit();
            audit('user_deleted', '', $USER['id'], $USER['username'], $u['username']);
            respond(admin_payload($pdo));

        case 'user_password':
            require_perm('users.manage');
            $p = input();
            $id = (int)val($p, 'id', 0);
            if ($id === $USER['id']) fail('Change your own password from Account settings.');
            $password = (string)val($p, 'password', '');
            $generated = $password === '';
            if ($generated) $password = generate_temp_password();
            $pdo->beginTransaction();
            $u = find_user($pdo, $id);
            if ($problem = password_problem($password, $u['username'])) throw new AppError($problem);
            set_user_password($pdo, $id, $password, !isset($p['mustChange']) || !empty($p['mustChange']));
            $pdo->prepare('UPDATE password_resets SET dismissed = 1 WHERE user_id = ?')->execute(array($id));
            $pdo->commit();
            audit('password_set_by_admin', 'Temporary password set', $USER['id'], $USER['username'], $u['username']);
            respond(admin_payload($pdo, array('password' => $generated ? $password : null, 'username' => $u['username'])));

        case 'user_reset_link':
            require_perm('users.manage');
            $p = input();
            $id = (int)val($p, 'id', 0);
            if ($id === $USER['id']) fail('Change your own password from Account settings.');
            $pdo->beginTransaction();
            $u = find_user($pdo, $id);
            if (!$u['is_active']) throw new AppError('This account is disabled. Activate it first.');
            $t = create_reset_token($pdo, $id, true);
            $pdo->prepare('UPDATE password_resets SET dismissed = 1 WHERE user_id = ?')->execute(array($id));
            $pdo->commit();
            $link = app_url('reset.php?token=' . $t['token']);
            $emailed = false;
            if (!empty($p['send'])) {
                $emailLink = app_url('reset.php?token=' . $t['token'], true);
                if (!$u['email']) throw new AppError('This user has no email address. Copy the link instead.');
                if ($emailLink === '') throw new AppError('Set APP_URL in mail.php so emailed links point to the right address.');
                $nm = $u['full_name'] !== '' ? $u['full_name'] : $u['username'];
                $emailed = send_mail($u['email'], 'Set your Nitte FPC Inventory password',
                    "Hello $nm,\n\nAn administrator created a link for you to set the password for your Nitte FPC Inventory account (username: {$u['username']}).\n\n"
                    . "It works once and expires in " . ADMIN_RESET_TOKEN_HOURS . " hours:\n\n$emailLink\n\n— Nitte FPC Inventory");
                if (!$emailed) throw new AppError("The email couldn't be sent. Check the SMTP settings in mail.php, or copy the link instead.");
            }
            audit('reset_link_created', $emailed ? 'Emailed to the user' : 'Link copied by admin', $USER['id'], $USER['username'], $u['username']);
            respond(admin_payload($pdo, array('link' => $emailed ? null : $link, 'emailed' => $emailed, 'hours' => ADMIN_RESET_TOKEN_HOURS, 'username' => $u['username'])));

        case 'user_unlock':
            require_perm('users.manage');
            $id = (int)val(input(), 'id', 0);
            $st = $pdo->prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?');
            $st->execute(array($id));
            $nm = $pdo->prepare('SELECT username FROM users WHERE id = ?');
            $nm->execute(array($id));
            audit('user_unlocked', '', $USER['id'], $USER['username'], (string)$nm->fetchColumn());
            respond(admin_payload($pdo));

        case 'mail_test':
            require_perm('users.manage');
            $to = trim((string)val(input(), 'to', ''));
            if (!filter_var($to, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address to send the test to.');
            $ok = send_mail($to, 'Test email from Nitte FPC Inventory',
                "Hello,\n\nThis is a test from Nitte FPC Inventory. Email is working, so \"Forgot password\" links will now be emailed to users.\n\n— Nitte FPC Inventory");
            audit('mail_test', $ok ? 'Sent' : 'Failed: ' . mail_last_error(), $USER['id'], $USER['username'], $to);
            if (!$ok) fail(mail_last_error() !== '' ? mail_last_error() : 'The email could not be sent.');
            respond(array('ok' => true));

        case 'reset_dismiss':
            require_perm('users.manage');
            $pdo->prepare('UPDATE password_resets SET dismissed = 1 WHERE id = ?')->execute(array((int)val(input(), 'id', 0)));
            respond(admin_payload($pdo));

        case 'role_save':
            require_perm('users.manage');
            $p = input();
            $id = (int)val($p, 'id', 0);
            $name = str($p, 'name', 50, 'Role name', true);
            $desc = str($p, 'description', 255, 'Description');
            $perms = implode(',', clean_permissions(isset($p['perms']) ? $p['perms'] : array()));
            $dup = $pdo->prepare('SELECT 1 FROM roles WHERE name = ? AND id <> ?');
            $dup->execute(array($name, $id));
            if ($dup->fetchColumn()) fail('A role with this name already exists.', 409);
            if ($id) {
                $st = $pdo->prepare('SELECT is_super FROM roles WHERE id = ?');
                $st->execute(array($id));
                $isSuper = $st->fetchColumn();
                if ($isSuper === false) throw new AppError('Role not found. Reload the page.');
                if ($isSuper) {   // Super Admin always has every permission; only the text can change
                    $pdo->prepare('UPDATE roles SET name = ?, description = ? WHERE id = ?')->execute(array($name, $desc, $id));
                } else {
                    $pdo->prepare('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?')->execute(array($name, $desc, $perms, $id));
                }
                audit('role_updated', 'Permissions: ' . ($isSuper ? 'all' : ($perms !== '' ? $perms : 'view only')), $USER['id'], $USER['username'], $name);
            } else {
                $pdo->prepare('INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)')->execute(array($name, $desc, $perms));
                $id = (int)$pdo->lastInsertId();
                audit('role_created', 'Permissions: ' . ($perms !== '' ? $perms : 'view only'), $USER['id'], $USER['username'], $name);
            }
            respond(admin_payload($pdo, array('id' => (string)$id)));

        case 'role_delete':
            require_perm('users.manage');
            $id = (int)val(input(), 'id', 0);
            $st = $pdo->prepare('SELECT r.name, r.is_super, COUNT(u.id) AS n FROM roles r LEFT JOIN users u ON u.role_id = r.id WHERE r.id = ? GROUP BY r.id, r.name, r.is_super');
            $st->execute(array($id));
            $r = $st->fetch();
            if (!$r) fail('Role not found.', 404);
            if ($r['is_super']) fail("The Super Admin role can't be deleted.");
            if ((int)$r['n'] > 0) fail($r['n'] . ' user(s) have this role. Move them to another role first.');
            $pdo->prepare('DELETE FROM roles WHERE id = ?')->execute(array($id));
            audit('role_deleted', '', $USER['id'], $USER['username'], $r['name']);
            respond(admin_payload($pdo));

        /* ------------------------ Inventory ------------------------ */

        case 'template_save':
            require_perm('templates.manage');
            $p = input();
            $id = (int)val($p, 'id', 0);
            $name = str($p, 'name', 80, 'Template name', true);
            $settings = clean_template_settings(isset($p['settings']) ? $p['settings'] : null);
            $json = json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $st = $pdo->prepare('SELECT id FROM label_templates WHERE name = ? AND id <> ?');
            $st->execute(array($name, $id));
            if ($st->fetchColumn()) fail('A template with this name already exists.', 409);
            $pdo->beginTransaction();
            if ($id) {
                $st = $pdo->prepare('UPDATE label_templates SET name = ?, settings = ? WHERE id = ?');
                $st->execute(array($name, $json, $id));
                $chk = $pdo->prepare('SELECT 1 FROM label_templates WHERE id = ?');
                $chk->execute(array($id));
                if (!$chk->fetchColumn()) throw new AppError('Template not found (it may have been deleted).');
            } else {
                $pdo->prepare('INSERT INTO label_templates (name, settings) VALUES (?, ?)')->execute(array($name, $json));
                $id = (int)$pdo->lastInsertId();
            }
            if (!empty($p['makeDefault'])) fix_default_template($pdo, $id);
            else fix_default_template($pdo);
            audit((int)val($p, 'id', 0) ? 'template_updated' : 'template_created', !empty($p['makeDefault']) ? 'Set as default template' : '',
                $USER['id'], $USER['username'], $name);
            $pdo->commit();
            respond(array('ok' => true, 'id' => (string)$id, 'templates' => fetch_templates($pdo)));

        case 'template_delete':
            require_perm('templates.manage');
            $p = input();
            $id = (int)val($p, 'id', 0);
            $pdo->beginTransaction();
            $count = (int)$pdo->query('SELECT COUNT(*) FROM label_templates FOR UPDATE')->fetchColumn();
            if ($count <= 1) { $pdo->rollBack(); fail('You need at least one label template.'); }
            $nm = $pdo->prepare('SELECT name FROM label_templates WHERE id = ?');
            $nm->execute(array($id));
            $tplName = (string)$nm->fetchColumn();
            $st = $pdo->prepare('DELETE FROM label_templates WHERE id = ?');
            $st->execute(array($id));
            if ($st->rowCount() !== 1) { $pdo->rollBack(); fail('Template not found.', 404); }
            fix_default_template($pdo);
            audit('template_deleted', '', $USER['id'], $USER['username'], $tplName);
            $pdo->commit();
            respond(array('ok' => true, 'templates' => fetch_templates($pdo)));

        case 'save':
            $p = input();
            $id = (int)val($p, 'id', 0);
            require_perm($id ? 'products.edit' : 'products.create');
            $d = clean_product($pdo, $p);
            if (sku_taken($pdo, $d['sku'], $id)) fail('This SKU already exists — generate a new one.', 409);
            $pdo->beginTransaction();
            if ($id) update_product($pdo, $id, $d, 'update');
            else $id = insert_product($pdo, $d, 'create');
            $pdo->commit();
            $items = fetch_items($pdo, $id);
            respond(array('ok' => true, 'item' => $items[0]));

        case 'delete':
            require_perm('products.delete');
            $p = input();
            $id = (int)val($p, 'id', 0);
            $pdo->beginTransaction();
            $st = $pdo->prepare('SELECT * FROM products WHERE id = ? FOR UPDATE');
            $st->execute(array($id));
            $row = $st->fetch();
            if (!$row) { $pdo->rollBack(); fail('Product not found (it may already be deleted).', 404); }
            log_move($pdo, $id, $row['sku'], $row['name'], 'delete', (int)$row['qty'], 0);
            product_activity($pdo, 'product_deleted', $row, 'Stock was ' . (int)$row['qty'] . ' · MRP ₹' . fmt_num($row['mrp']));
            $pdo->prepare('DELETE FROM products WHERE id = ?')->execute(array($id));
            $pdo->commit();
            respond(array('ok' => true));

        case 'delete_many':
            require_perm('products.delete');
            $p = input();
            $ids = isset($p['ids']) && is_array($p['ids']) ? $p['ids'] : array();
            $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
            if (!$ids) fail('Select at least one product.');
            if (count($ids) > MAX_BULK_ROWS) fail('Too many products — delete at most ' . MAX_BULK_ROWS . ' at a time.');
            $pdo->beginTransaction();
            $marks = implode(',', array_fill(0, count($ids), '?'));
            $st = $pdo->prepare("SELECT * FROM products WHERE id IN ($marks) FOR UPDATE");
            $st->execute($ids);
            $rows = $st->fetchAll();
            foreach ($rows as $r) {
                log_move($pdo, (int)$r['id'], $r['sku'], $r['name'], 'delete', (int)$r['qty'], 0, 'Bulk delete');
                product_activity($pdo, 'product_deleted', $r, 'Bulk delete of ' . count($rows) . ' · stock was ' . (int)$r['qty']);
            }
            $deleted = array();
            if ($rows) {
                foreach ($rows as $r) $deleted[] = (int)$r['id'];
                $pdo->prepare('DELETE FROM products WHERE id IN (' . implode(',', array_fill(0, count($deleted), '?')) . ')')->execute($deleted);
            }
            $pdo->commit();
            respond(array('ok' => true, 'deleted' => array_map('strval', $deleted), 'missing' => count($ids) - count($deleted)));

        case 'bulk':
            require_perm('products.import');
            $p = input();
            $rows = isset($p['rows']) && is_array($p['rows']) ? array_values($p['rows']) : array();
            $allowUpdate = !isset($p['update']) || (bool)$p['update'];
            if (!$rows) fail('No rows to import.');
            if (count($rows) > MAX_BULK_ROWS) fail('Too many rows — import at most ' . MAX_BULK_ROWS . ' at a time.');
            $added = 0; $updated = 0; $skipped = 0; $errors = array();
            $find = $pdo->prepare('SELECT id FROM products WHERE sku = ?');
            $pdo->beginTransaction();
            foreach ($rows as $n => $r) {
                try {
                    if (!is_array($r)) throw new AppError('Invalid row.');
                    $d = clean_product($pdo, $r);
                    $find->execute(array($d['sku']));
                    $existing = $find->fetchColumn();
                    if ($existing) {
                        if (!$allowUpdate) { $skipped++; continue; }
                        update_product($pdo, (int)$existing, $d, 'import');
                        $updated++;
                    } else {
                        insert_product($pdo, $d, 'import');
                        $added++;
                    }
                } catch (Exception $e) {
                    $skipped++;
                    if ($e instanceof AppError)       $msg = $e->getMessage();
                    elseif (is_duplicate_key($e))     $msg = 'SKU already exists.';
                    else { error_log('api.php bulk row error: ' . $e->getMessage()); $msg = 'Could not save this row.'; }
                    $errors[] = 'Row ' . ($n + 1) . ': ' . $msg;
                }
            }
            audit('bulk_import', "Added $added, updated $updated, skipped $skipped" . ($errors ? ' · first error: ' . $errors[0] : ''),
                $USER['id'], $USER['username'], count($rows) . ' rows uploaded');
            $pdo->commit();
            respond(array('ok' => true, 'added' => $added, 'updated' => $updated, 'skipped' => $skipped,
                'errors' => array_slice($errors, 0, 200), 'items' => fetch_items($pdo)));

        default:
            fail('Unknown action.', 404);
    }
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($e instanceof AppError) fail($e->getMessage(), 400);
    if (is_duplicate_key($e)) {
        fail(in_array($action, array('save', 'bulk'), true) ? 'This SKU already exists — generate a new one.' : 'That name is already in use.', 409);
    }
    error_log('api.php error: ' . $e->getMessage());   // details go to the PHP error log, not the browser
    fail('Server error. Please try again.', 500);
}
