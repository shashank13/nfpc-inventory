<?php
/**
 * "Forgot password": emails a single-use reset link (when email is set up in mail.php).
 * Without email, the request is shown to Super Admins under Users & roles → Reset requests.
 * The response is the same whether or not the account exists, so it can't be used to find usernames.
 */
define('NFPC_APP', true);
require __DIR__ . '/auth.php';
require __DIR__ . '/ui.php';
require __DIR__ . '/mail.php';

start_session();

$error = '';
$done = false;
$ident = '';
try {
    $pdo = app_db();
} catch (Exception $e) {
    error_log('forgot.php DB error: ' . $e->getMessage());
    $pdo = null;
    $error = 'Cannot connect to the database. Check that MySQL is running.';
}

if ($pdo && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $ident = trim(isset($_POST['ident']) && is_string($_POST['ident']) ? $_POST['ident'] : '');
    if (!csrf_ok(isset($_POST['csrf']) ? $_POST['csrf'] : null)) {
        $error = 'Your session expired. Please try again.';
    } elseif ($ident === '' || strlen($ident) > 190) {
        $error = 'Enter your username or email address.';
    } else {
        $done = true;
        $ipCount = $pdo->prepare("SELECT COUNT(*) FROM audit_log WHERE event = 'reset_requested' AND ip = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)");
        $ipCount->execute(array(client_ip()));
        if ((int)$ipCount->fetchColumn() < 10) {
            $st = $pdo->prepare('SELECT id, username, full_name, email, is_active FROM users WHERE username = ? OR email = ? ORDER BY (username = ?) DESC LIMIT 1');
            $st->execute(array($ident, $ident, $ident));
            $u = $st->fetch();
            $recent = 0;
            if ($u) {
                $rc = $pdo->prepare('SELECT COUNT(*) FROM password_resets WHERE user_id = ? AND via_admin = 0 AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)');
                $rc->execute(array($u['id']));
                $recent = (int)$rc->fetchColumn();
            }
            if ($u && (int)$u['is_active'] && $recent < 3) {
                $t = create_reset_token($pdo, (int)$u['id'], false);
                $sent = false;
                $link = app_url('reset.php?token=' . $t['token'], true);
                if (mail_enabled() && $u['email'] && $link !== '') {
                    $name = $u['full_name'] !== '' ? $u['full_name'] : $u['username'];
                    $body = "Hello $name,\n\n"
                          . "We received a request to reset the password for your Nitte FPC Inventory account (username: {$u['username']}).\n\n"
                          . "Open this link to choose a new password. It works once and expires in " . RESET_TOKEN_MINUTES . " minutes:\n\n$link\n\n"
                          . "If you didn't ask for this, you can ignore this email; your password won't change.\n\n"
                          . "— Nitte FPC Inventory";
                    $sent = send_mail($u['email'], 'Reset your Nitte FPC Inventory password', $body);
                    if ($sent) $pdo->prepare('UPDATE password_resets SET mail_sent = 1 WHERE id = ?')->execute(array($t['id']));
                } elseif (mail_enabled() && $link === '') {
                    error_log('forgot.php: set APP_URL in mail.php so reset emails can contain a link.');
                }
                audit('reset_requested', $sent ? 'Reset link emailed' : 'Waiting for an administrator', (int)$u['id'], $u['username']);
            } else {
                audit('reset_requested', $u ? 'Ignored (disabled account or too many requests)' : 'Unknown user', $u ? (int)$u['id'] : null, $ident);
            }
        }
    }
}
$token = csrf_token();

auth_shell_open('Forgot password');
?>
<a class="back-link" href="login.php"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back to sign in</a>
<?php if ($done): ?>
  <div class="auth-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></div>
  <?php if (mail_enabled()): ?>
    <h1>Check your email</h1>
    <p class="lead">If an account matches <b><?php echo h($ident); ?></b> and has an email address, we've sent it a link to reset the password. The link expires in <?php echo RESET_TOKEN_MINUTES; ?> minutes.</p>
    <?php echo alert_html('info', "Didn't get it? Check your spam folder. If your account has no email address, your administrator can reset your password for you."); ?>
  <?php else: ?>
    <h1>Request sent</h1>
    <p class="lead">If an account matches <b><?php echo h($ident); ?></b>, your administrator has been notified. They'll give you a reset link or a temporary password.</p>
    <?php echo alert_html('info', 'For a quicker reset, contact your administrator directly.'); ?>
  <?php endif; ?>
  <a class="btn primary block lg" href="login.php" style="margin-top:8px">Return to sign in</a>
<?php else: ?>
  <div class="auth-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/></svg></div>
  <h1>Forgot your password?</h1>
  <p class="lead"><?php echo mail_enabled()
      ? "Enter your username or email and we'll send you a link to reset it."
      : "Enter your username or email and we'll ask your administrator to reset it."; ?></p>
  <?php if ($error) echo alert_html('error', h($error)); ?>
  <form method="post" novalidate>
    <input type="hidden" name="csrf" value="<?php echo h($token); ?>">
    <label for="ident">Username or email</label>
    <input id="ident" name="ident" required maxlength="190" value="<?php echo h($ident); ?>" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus>
    <button type="submit" class="btn primary block lg"<?php echo $pdo ? '' : ' disabled'; ?>><?php echo mail_enabled() ? 'Send reset link' : 'Request a reset'; ?></button>
  </form>
  <p class="auth-alt">Remembered it? <a href="login.php">Sign in</a></p>
<?php endif; ?>
<?php auth_shell_close();
