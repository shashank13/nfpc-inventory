<?php
/**
 * Sign-in page. If no account exists yet, it shows a one-time "create Super Admin" form instead.
 */
define('NFPC_APP', true);
require __DIR__ . '/auth.php';
require __DIR__ . '/ui.php';

start_session();

$error = '';
$notice = null;
$ident = '';
$fullName = '';
$email = '';
try {
    $pdo = app_db();
    $setup = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0;
} catch (Exception $e) {
    error_log('login.php DB error: ' . $e->getMessage());
    $pdo = null;
    $setup = false;
    $error = 'Cannot connect to the database. Check that MySQL is running in XAMPP and that database.sql has been imported.';
}

if ($pdo && !$setup && ($me = current_user())) {
    redirect($me['mustChange'] ? 'account.php' : 'dashboard.php');
}

// Messages carried over from a redirect.
$flashCodes = array(
    'timeout'    => array('info', 'You were signed out after a period of inactivity. Please sign in again.'),
    'disabled'   => array('error', 'Your account has been disabled. Contact your administrator.'),
    'signed_out' => array('info', 'Your session ended (your password or access was changed). Please sign in again.'),
);
if (!empty($_SESSION['flash']) && isset($flashCodes[$_SESSION['flash']])) $notice = $flashCodes[$_SESSION['flash']];
unset($_SESSION['flash']);
if (isset($_GET['bye'])) $notice = array('success', "You've been signed out.");
if (isset($_GET['reset'])) $notice = array('success', 'Your password has been updated. Sign in with your new password.');
if ($f = take_flash()) $notice = $f;

function lock_minutes_left($until)
{
    return max(1, (int)ceil((strtotime($until) - time()) / 60));
}

function unknown_name_locked($pdo, $name)
{
    $st = $pdo->prepare("SELECT COUNT(*) FROM audit_log WHERE event = 'login_failed' AND user_id IS NULL AND username = ?
                         AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)");
    $st->execute(array(substr($name, 0, 50), LOCK_MINUTES));
    return (int)$st->fetchColumn() >= MAX_FAILED_LOGINS;
}

if ($pdo && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $ident = trim(isset($_POST['username']) && is_string($_POST['username']) ? $_POST['username'] : '');
    $password = isset($_POST['password']) && is_string($_POST['password']) ? $_POST['password'] : '';

    if (!csrf_ok(isset($_POST['csrf']) ? $_POST['csrf'] : null)) {
        $error = 'Your session expired. Please try again.';
    } elseif ($setup) {
        $confirm = isset($_POST['confirm']) && is_string($_POST['confirm']) ? $_POST['confirm'] : '';
        $fullName = trim(isset($_POST['full_name']) && is_string($_POST['full_name']) ? $_POST['full_name'] : '');
        $email = trim(isset($_POST['email']) && is_string($_POST['email']) ? $_POST['email'] : '');
        if ($fullName === '' || strlen($fullName) > 100) {
            $error = 'Enter your full name (up to 100 characters).';
        } elseif (!preg_match('/^[A-Za-z0-9_.@-]{3,50}$/', $ident)) {
            $error = 'Username must be 3–50 characters: letters, digits, _ . @ -';
        } elseif ($email !== '' && (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190)) {
            $error = 'Enter a valid email address, or leave it blank.';
        } elseif ($p = password_problem($password, $ident)) {
            $error = $p;
        } elseif ($password !== $confirm) {
            $error = 'Passwords do not match.';
        } else {
            $superId = (int)$pdo->query('SELECT id FROM roles WHERE is_super = 1 ORDER BY id LIMIT 1')->fetchColumn();
            // Insert only if the table is still empty, so two people can't both claim the first account.
            $st = $pdo->prepare('INSERT INTO users (username, full_name, email, password_hash, role_id, pw_changed_at)
                                 SELECT ?, ?, ?, ?, ?, NOW() FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users)');
            $st->execute(array($ident, $fullName, $email !== '' ? $email : null, password_hash($password, PASSWORD_DEFAULT), $superId));
            if ($st->rowCount() === 1) {
                $id = (int)$pdo->lastInsertId();
                log_in_user($id);
                audit('setup', 'Created the first Super Admin account', $id, $ident);
                redirect('dashboard.php');
            }
            $setup = false;
            $error = 'An account was already created. Please sign in.';
        }
    } else {
        $ipFails = $pdo->prepare("SELECT COUNT(*) FROM audit_log WHERE event = 'login_failed' AND ip = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)");
        $ipFails->execute(array(client_ip(), LOCK_MINUTES));

        $find = $pdo->prepare('SELECT id, username, password_hash, is_active, must_change_pw, failed_logins, locked_until,
                                      (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked FROM users WHERE username = ?');
        $find->execute(array($ident));
        $u = $find->fetch();
        if (!$u && strpos($ident, '@') !== false) {
            $find = $pdo->prepare('SELECT id, username, password_hash, is_active, must_change_pw, failed_logins, locked_until,
                                          (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked FROM users WHERE email = ?');
            $find->execute(array($ident));
            $u = $find->fetch();
        }

        if ($ident === '' || $password === '') {
            $error = 'Enter your username (or email) and password.';
        } elseif ((int)$ipFails->fetchColumn() >= MAX_FAILED_PER_IP) {
            $error = 'Too many failed sign-in attempts from this device. Try again in ' . LOCK_MINUTES . ' minutes.';
        } elseif ($u && (int)$u['is_locked']) {
            $error = 'This account is temporarily locked after too many failed attempts. Try again in '
                   . lock_minutes_left($u['locked_until']) . ' minute(s), or reset your password.';
        } elseif (!$u && unknown_name_locked($pdo, $ident)) {
            // Unknown usernames "lock" the same way, so the message doesn't reveal which accounts exist.
            $error = 'This account is temporarily locked after too many failed attempts. Try again in '
                   . LOCK_MINUTES . ' minute(s), or reset your password.';
        } else {
            // Verify against a dummy hash when the user doesn't exist so the response time doesn't reveal it.
            $hash = $u ? $u['password_hash'] : '$2y$10$x6988ICc7Mn0opfft3hG4ODlQjl6SBNBgCg4tAl7UOXieSf8PTyQC';
            $ok = password_verify($password, $hash) && $u;
            if ($ok && !(int)$u['is_active']) {
                $error = 'Your account has been disabled. Contact your administrator.';
                audit('login_blocked', 'Account disabled', (int)$u['id'], $u['username']);
            } elseif ($ok) {
                if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
                    $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
                        ->execute(array(password_hash($password, PASSWORD_DEFAULT), $u['id']));
                }
                log_in_user($u['id']);
                audit('login', '', (int)$u['id'], $u['username']);
                redirect((int)$u['must_change_pw'] ? 'account.php' : 'dashboard.php');
            } else {
                if ($u) {
                    $fails = (int)$u['failed_logins'] + 1;
                    if ($fails >= MAX_FAILED_LOGINS) {
                        $pdo->prepare('UPDATE users SET failed_logins = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?')
                            ->execute(array(LOCK_MINUTES, $u['id']));
                        audit('account_locked', MAX_FAILED_LOGINS . ' failed attempts', (int)$u['id'], $u['username']);
                    } else {
                        $pdo->prepare('UPDATE users SET failed_logins = ? WHERE id = ?')->execute(array($fails, $u['id']));
                    }
                }
                audit('login_failed', $u ? '' : 'Unknown user', $u ? (int)$u['id'] : null, $ident);
                sleep(1);   // slow down password guessing
                $error = 'Incorrect username or password.';
            }
        }
    }
}
$token = csrf_token();

auth_shell_open($setup ? 'Set up' : 'Sign in');
?>
<?php if ($setup): ?>
  <h1>Create the Super Admin</h1>
  <p class="lead">First-time setup. This account can manage users, roles and everything else. You can add more people afterwards.</p>
<?php else: ?>
  <h1>Sign in</h1>
  <p class="lead">Welcome back. Sign in to manage inventory and labels.</p>
<?php endif; ?>

<?php if ($notice) echo alert_html($notice[0], h($notice[1])); ?>
<?php if ($error) echo alert_html('error', h($error)); ?>

<form method="post" autocomplete="on" novalidate>
  <input type="hidden" name="csrf" value="<?php echo h($token); ?>">
  <?php if ($setup): ?>
    <label for="full_name">Full name</label>
    <input id="full_name" name="full_name" required maxlength="100" value="<?php echo h($fullName); ?>" autocomplete="name" autofocus>
    <div class="row stack-sm">
      <div>
        <label for="username">Username</label>
        <input id="username" name="username" required maxlength="50" pattern="[A-Za-z0-9_.@\-]{3,50}" value="<?php echo h($ident); ?>" autocomplete="username" autocapitalize="none" spellcheck="false">
      </div>
      <div>
        <label for="email">Email <span class="muted" style="font-weight:400">(for password resets)</span></label>
        <input id="email" name="email" type="email" maxlength="190" value="<?php echo h($email); ?>" autocomplete="email">
      </div>
    </div>
    <label for="password">Password</label>
    <div class="input-wrap">
      <input id="password" name="password" type="password" required minlength="8" maxlength="72" autocomplete="new-password" data-caps="capsMsg">
      <button type="button" class="pw-toggle" aria-label="Show password" aria-pressed="false"></button>
    </div>
    <div class="strength" id="pwMeter"><i></i><i></i><i></i><i></i></div>
    <ul class="rules" id="pwRules"></ul>
    <div class="caps" id="capsMsg">Caps Lock is on.</div>
    <label for="confirm">Confirm password</label>
    <input id="confirm" name="confirm" type="password" required minlength="8" maxlength="72" autocomplete="new-password">
    <div class="field-err" id="pwMatch"></div>
    <button type="submit" class="btn primary block lg">Create account &amp; continue</button>
  <?php else: ?>
    <label for="username">Username or email</label>
    <input id="username" name="username" required maxlength="190" value="<?php echo h($ident); ?>" autocomplete="username" autocapitalize="none" spellcheck="false" <?php echo $ident === '' ? 'autofocus' : ''; ?>>
    <div class="label-row">
      <label for="password">Password</label>
      <a href="forgot.php">Forgot password?</a>
    </div>
    <div class="input-wrap">
      <input id="password" name="password" type="password" required autocomplete="current-password" data-caps="capsMsg" <?php echo $ident !== '' ? 'autofocus' : ''; ?>>
      <button type="button" class="pw-toggle" aria-label="Show password" aria-pressed="false"></button>
    </div>
    <div class="caps" id="capsMsg">Caps Lock is on.</div>
    <button type="submit" class="btn primary block lg"<?php echo $pdo ? '' : ' disabled'; ?>>Sign in</button>
    <p class="auth-alt">Need an account? Ask your administrator to add you.</p>
  <?php endif; ?>
</form>
<script>
document.querySelectorAll(".pw-toggle").forEach(b=>b.innerHTML=App.icon("eye"));
<?php if ($setup): ?>
App.passwordMeter(App.$("password"),{meter:App.$("pwMeter"),rules:App.$("pwRules"),confirm:App.$("confirm"),match:App.$("pwMatch")});
<?php endif; ?>
</script>
<?php auth_shell_close();
