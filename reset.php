<?php
/**
 * Choose a new password using a single-use reset link (from email or from a Super Admin).
 * The token is moved from the URL into the session straight away so it doesn't linger in
 * the address bar or browser history.
 */
define('NFPC_APP', true);
require __DIR__ . '/auth.php';
require __DIR__ . '/ui.php';

start_session();

if (isset($_GET['token']) && is_string($_GET['token'])) {
    $_SESSION['reset_token'] = $_GET['token'];
    redirect('reset.php');
}

$error = '';
$reset = null;
try {
    $pdo = app_db();
    $reset = find_reset_token($pdo, isset($_SESSION['reset_token']) ? $_SESSION['reset_token'] : '');
} catch (Exception $e) {
    error_log('reset.php DB error: ' . $e->getMessage());
    $pdo = null;
    $error = 'Cannot connect to the database. Check that MySQL is running.';
}

if ($pdo && $reset && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $pw = isset($_POST['password']) && is_string($_POST['password']) ? $_POST['password'] : '';
    $confirm = isset($_POST['confirm']) && is_string($_POST['confirm']) ? $_POST['confirm'] : '';
    if (!csrf_ok(isset($_POST['csrf']) ? $_POST['csrf'] : null)) {
        $error = 'Your session expired. Please try again.';
    } elseif ($p = password_problem($pw, $reset['username'])) {
        $error = $p;
    } elseif ($pw !== $confirm) {
        $error = 'Passwords do not match.';
    } else {
        $pdo->beginTransaction();
        $st = $pdo->prepare('UPDATE password_resets SET used_at = NOW() WHERE id = ? AND used_at IS NULL');
        $st->execute(array($reset['reset_id']));
        if ($st->rowCount() === 1) {
            set_user_password($pdo, (int)$reset['id'], $pw, false);
            $pdo->commit();
            audit('password_reset', 'Password changed with a reset link', (int)$reset['id'], $reset['username']);
            unset($_SESSION['reset_token']);
            if (isset($_SESSION['uid'])) clear_session();
            redirect('login.php?reset=1');
        }
        $pdo->rollBack();
        $reset = null;
    }
}
$token = csrf_token();

auth_shell_open('Set a new password');
?>
<a class="back-link" href="login.php"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back to sign in</a>
<?php if (!$reset): ?>
  <div class="auth-icon" style="background:var(--danger-soft);color:var(--danger)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg></div>
  <h1>Link expired or invalid</h1>
  <p class="lead">This password reset link has expired, was already used, or isn't valid. Reset links work once and expire after <?php echo RESET_TOKEN_MINUTES; ?> minutes (<?php echo ADMIN_RESET_TOKEN_HOURS; ?> hours when created by an administrator).</p>
  <?php if ($error) echo alert_html('error', h($error)); ?>
  <a class="btn primary block lg" href="forgot.php">Request a new link</a>
<?php else: ?>
  <div class="auth-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
  <h1>Set a new password</h1>
  <p class="lead">For <b><?php echo h($reset['full_name'] !== '' ? $reset['full_name'] : $reset['username']); ?></b> (<?php echo h($reset['username']); ?>). You'll be signed out on all other devices.</p>
  <?php if ($error) echo alert_html('error', h($error)); ?>
  <form method="post" novalidate>
    <input type="hidden" name="csrf" value="<?php echo h($token); ?>">
    <input type="text" name="username" value="<?php echo h($reset['username']); ?>" autocomplete="username" hidden>
    <label for="password">New password</label>
    <div class="input-wrap">
      <input id="password" name="password" type="password" required minlength="8" maxlength="72" autocomplete="new-password" data-caps="capsMsg" autofocus>
      <button type="button" class="pw-toggle" aria-label="Show password" aria-pressed="false"></button>
    </div>
    <div class="strength" id="pwMeter"><i></i><i></i><i></i><i></i></div>
    <ul class="rules" id="pwRules"></ul>
    <div class="caps" id="capsMsg">Caps Lock is on.</div>
    <label for="confirm">Confirm new password</label>
    <input id="confirm" name="confirm" type="password" required minlength="8" maxlength="72" autocomplete="new-password">
    <div class="field-err" id="pwMatch"></div>
    <button type="submit" class="btn primary block lg">Update password</button>
  </form>
  <script>
  document.querySelectorAll(".pw-toggle").forEach(b=>b.innerHTML=App.icon("eye"));
  App.passwordMeter(App.$("password"),{meter:App.$("pwMeter"),rules:App.$("pwRules"),confirm:App.$("confirm"),match:App.$("pwMatch")});
  </script>
<?php endif; ?>
<?php auth_shell_close();
