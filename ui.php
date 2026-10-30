<?php
/**
 * Small HTML helpers shared by the server-rendered pages (sign-in, password reset, account, users).
 */

if (!defined('NFPC_APP')) {
    http_response_code(403);
    exit;
}

define('ASSET_VERSION', '6');
define('LEAF_PATHS', '<path d="M12 21V9"/><path d="M12 13c-3 0-5-2-5-5 3 0 5 2 5 5z"/><path d="M12 11c0-3 2-5 5-5 0 3-2 5-5 5z"/><path d="M12 17c-3 0-5-2-5-5 3 0 5 2 5 5z"/><path d="M12 15c0-3 2-5 5-5 0 3-2 5-5 5z"/>');

function h($s)
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function leaf_svg($size = 24)
{
    return '<svg width="' . (int)$size . '" height="' . (int)$size . '" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . LEAF_PATHS . '</svg>';
}

function redirect($page)
{
    header('Location: ' . $page);
    exit;
}

/** Browser-tab and home-screen icons (NITTE FPC emblem). */
function favicon_links()
{
    return '<link rel="icon" href="assets/favicon.ico?v=' . ASSET_VERSION . '" sizes="16x16 32x32 48x48">'
         . '<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png?v=' . ASSET_VERSION . '">'
         . '<link rel="icon" type="image/png" sizes="192x192" href="assets/logo-192.png?v=' . ASSET_VERSION . '">'
         . '<link rel="apple-touch-icon" href="assets/apple-touch-icon.png?v=' . ASSET_VERSION . '">'
         . '<meta name="theme-color" content="#2f7d32">';
}

function page_head($title)
{
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    send_security_headers();
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
       . '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
       . '<meta name="robots" content="noindex">'
       . '<title>' . h($title) . ' · Nitte FPC Inventory</title>'
       . favicon_links()
       . '<link rel="stylesheet" href="assets/app.css?v=' . ASSET_VERSION . '">'
       . '<script src="assets/app.js?v=' . ASSET_VERSION . '"></script>'
       . '</head>';
}

/** One-time message stored in the session (shown after a redirect). */
function set_flash($type, $msg)
{
    $_SESSION['flash_msg'] = array($type, $msg);
}

function take_flash()
{
    $f = isset($_SESSION['flash_msg']) ? $_SESSION['flash_msg'] : null;
    unset($_SESSION['flash_msg']);
    return $f;
}

function alert_html($type, $msg)
{
    $icons = array(
        'error'   => '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
        'success' => '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
        'info'    => '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
        'warn'    => '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
    );
    $ic = isset($icons[$type]) ? $icons[$type] : $icons['info'];
    return '<div class="alert ' . h($type) . '" role="' . ($type === 'error' ? 'alert' : 'status') . '">'
         . '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . $ic . '</svg>'
         . '<div>' . $msg . '</div></div>';
}

/** Split-screen layout for the sign-in / password pages. */
function auth_shell_open($title)
{
    page_head($title);
    echo '<body class="auth-body"><div class="auth">'
       . '<aside class="auth-aside">'
       .   '<div class="auth-brand"><img class="auth-logo" src="assets/logo-192.png?v=' . ASSET_VERSION . '" alt="Nitte Farmers Producer Company Ltd. logo" width="72" height="72">'
       .     '<div><div class="auth-brand-name">Nitte Farmers Producer Company Ltd.</div><div class="auth-brand-sub">Inventory &amp; barcode labelling</div></div></div>'
       .   '<div class="auth-pitch"><h2>From farm to shelf, every batch accounted for.</h2>'
       .     '<ul class="auth-points">'
       .       '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8"/></svg><span><b>Barcode labels</b> Print FSSAI-ready labels with Code 128 barcodes.</span></li>'
       .       '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg><span><b>Batch traceability</b> Know which farmer group every pack came from.</span></li>'
       .       '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg><span><b>Expiry &amp; stock alerts</b> Spot low stock and short-dated batches early.</span></li>'
       .     '</ul></div>'
       .   '<div class="auth-foot">NMAMIT Campus, Nitte, Karkala Tq., Udupi Dist., Karnataka</div>'
       . '</aside>'
       . '<main class="auth-main"><div class="auth-card">'
       .   '<div class="auth-mobile-brand"><img class="tb-logo-img" src="assets/logo-128.png?v=' . ASSET_VERSION . '" alt="" width="44" height="44"><b>Nitte FPC Inventory</b></div>';
}

function auth_shell_close()
{
    echo '<p class="auth-legal">&copy; ' . date('Y') . ' Nitte Farmers Producer Company Ltd.</p>'
       . '</div></main></div></body></html>';
}

/** The logged-in user as JSON for the page's JavaScript (safe inside a <script> tag). */
function user_json($u)
{
    $c = user_for_client($u);
    $c['notice'] = take_imp_notice();
    return json_encode($c, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
}
