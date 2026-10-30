<?php
/**
 * Account settings: profile, change password, sign out other devices.
 * Users who were given a temporary password land here and must choose a new one first.
 */
define('NFPC_APP', true);
require __DIR__ . '/auth.php';
require __DIR__ . '/ui.php';

start_session();
try {
    $pdo = app_db();
} catch (Exception $e) {
    error_log('account.php DB error: ' . $e->getMessage());
    redirect('login.php');
}
$me = current_user();
if (!$me) redirect('login.php');

$errors = array('profile' => '', 'password' => '');
$forced = $me['mustChange'];

$st = $pdo->prepare('SELECT password_hash, created_at, last_login, pw_changed_at FROM users WHERE id = ?');
$st->execute(array($me['id']));
$row = $st->fetch();
$form = array('full_name' => $me['name'], 'email' => $me['email']);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $do = isset($_POST['do']) && is_string($_POST['do']) ? $_POST['do'] : '';
    $post = function ($k) { return isset($_POST[$k]) && is_string($_POST[$k]) ? $_POST[$k] : ''; };
    if (!csrf_ok($post('csrf'))) {
        $errors[$do === 'profile' ? 'profile' : 'password'] = 'Your session expired. Please try again.';
    } elseif (is_impersonating()) {
        // A Super Admin viewing as someone must not change that person's password, email or sessions.
        $errors[$do === 'profile' ? 'profile' : 'password'] = "You're viewing as someone else. Return to your own account to change account settings.";
    } elseif ($do === 'profile' && !$forced) {
        $form['full_name'] = trim($post('full_name'));
        $form['email'] = trim($post('email'));
        $emailChanged = strcasecmp($form['email'], $me['email']) !== 0;
        if ($form['full_name'] === '' || strlen($form['full_name']) > 100) {
            $errors['profile'] = 'Enter your full name (up to 100 characters).';
        } elseif ($form['email'] !== '' && (!filter_var($form['email'], FILTER_VALIDATE_EMAIL) || strlen($form['email']) > 190)) {
            $errors['profile'] = 'Enter a valid email address, or leave it blank.';
        } elseif ($emailChanged && !password_verify($post('current_password'), $row['password_hash'])) {
            $errors['profile'] = 'Enter your current password to change your email address.';
        } else {
            $dup = $pdo->prepare('SELECT 1 FROM users WHERE (email = ? OR username = ?) AND id <> ?');
            $dup->execute(array($form['email'], $form['email'], $me['id']));
            if ($form['email'] !== '' && $dup->fetchColumn()) {
                $errors['profile'] = 'That email address is already used by another account.';
            } else {
                $pdo->prepare('UPDATE users SET full_name = ?, email = ? WHERE id = ?')
                    ->execute(array($form['full_name'], $form['email'] !== '' ? $form['email'] : null, $me['id']));
                audit('profile_updated', $emailChanged ? 'Changed name / email' : 'Changed name', $me['id'], $me['username']);
                set_flash('success', 'Profile saved.');
                redirect('account.php');
            }
        }
    } elseif ($do === 'password') {
        $cur = $post('current_password');
        $new = $post('new_password');
        if (!password_verify($cur, $row['password_hash'])) {
            $errors['password'] = 'Your current password is incorrect.';
        } elseif ($p = password_problem($new, $me['username'])) {
            $errors['password'] = $p;
        } elseif ($new !== $post('confirm_password')) {
            $errors['password'] = 'New passwords do not match.';
        } elseif (password_verify($new, $row['password_hash'])) {
            $errors['password'] = 'Choose a password different from your current one.';
        } else {
            set_user_password($pdo, $me['id'], $new, false, true);
            audit('password_changed', $forced ? 'Replaced temporary password' : '', $me['id'], $me['username']);
            set_flash('success', $forced ? 'Password set. Welcome!' : 'Password changed. Other devices have been signed out.');
            redirect($forced ? 'dashboard.php' : 'account.php');
        }
    } elseif ($do === 'signout_others' && !$forced) {
        bump_session_epoch($pdo, $me['id'], true);
        audit('signout_others', '', $me['id'], $me['username']);
        set_flash('success', 'Signed out of all other devices.');
        redirect('account.php');
    }
}
$flash = take_flash();
$token = csrf_token();

page_head($forced ? 'Set your password' : 'Account settings');
?>
<body>
<div id="topbar" class="topbar"></div>
<main class="page" style="max-width:860px">
  <?php if ($forced): ?>
    <div class="page-head"><div><h1>Set your password</h1><p>Your administrator gave you a temporary password. Choose your own to continue.</p></div></div>
  <?php else: ?>
    <div class="page-head"><div><h1>Account settings</h1><p>Manage your profile, password and sign-in sessions.</p></div>
      <div class="page-actions"><a class="btn" href="inventory-barcode.html">Back to inventory</a></div></div>
  <?php endif; ?>
  <?php if ($flash) echo alert_html($flash[0], h($flash[1])); ?>
  <?php if (is_impersonating()) echo alert_html('warn', 'You are viewing this account as a Super Admin. Password, email and session changes are disabled until you return to your own account.'); ?>

  <?php if (!$forced): ?>
  <section class="card" style="margin-bottom:18px">
    <div class="card-head">
      <div style="display:flex;gap:14px;align-items:center">
        <span class="avatar lg" style="width:52px;height:52px;font-size:17px" id="bigAvatar"></span>
        <div>
          <h2><?php echo h($me['name']); ?></h2>
          <div class="muted" style="font-size:13px">@<?php echo h($me['username']); ?> · <span class="badge <?php echo $me['isSuper'] ? 'accent' : 'neutral'; ?>"><?php echo h($me['role']); ?></span></div>
        </div>
      </div>
    </div>
    <div class="row stack-sm" style="font-size:13px">
      <div><span class="muted">Member since</span><br><b data-dt="<?php echo h($row['created_at']); ?>"></b></div>
      <div><span class="muted">Password last changed</span><br><b data-dt="<?php echo h($row['pw_changed_at']); ?>"></b></div>
    </div>
  </section>

  <section class="card" style="margin-bottom:18px">
    <h2>Profile</h2>
    <p class="card-sub">Your name appears in the top bar and in the stock history. Your email is used for password reset links.</p>
    <?php if ($errors['profile']) echo alert_html('error', h($errors['profile'])); ?>
    <form method="post" novalidate>
      <input type="hidden" name="csrf" value="<?php echo h($token); ?>">
      <input type="hidden" name="do" value="profile">
      <div class="row stack-sm">
        <div>
          <label for="full_name">Full name</label>
          <input id="full_name" name="full_name" required maxlength="100" value="<?php echo h($form['full_name']); ?>" autocomplete="name">
        </div>
        <div>
          <label for="username_ro">Username</label>
          <input id="username_ro" value="<?php echo h($me['username']); ?>" readonly>
          <div class="help">Only a Super Admin can change usernames.</div>
        </div>
      </div>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" maxlength="190" value="<?php echo h($form['email']); ?>" autocomplete="email" placeholder="name@example.com">
      <div id="curPwWrap" class="hidden">
        <label for="profile_pw">Current password <span class="muted" style="font-weight:400">(required to change email)</span></label>
        <input id="profile_pw" name="current_password" type="password" autocomplete="current-password">
      </div>
      <div class="actions" style="display:flex;justify-content:flex-end;margin-top:16px"><button type="submit" class="btn primary">Save profile</button></div>
    </form>
  </section>
  <?php endif; ?>

  <section class="card" style="margin-bottom:18px">
    <h2><?php echo $forced ? 'Choose a new password' : 'Change password'; ?></h2>
    <p class="card-sub">Use at least 8 characters with a letter and a number. A longer passphrase is stronger.<?php echo $forced ? '' : ' Changing it signs you out on other devices.'; ?></p>
    <?php if ($errors['password']) echo alert_html('error', h($errors['password'])); ?>
    <form method="post" novalidate style="max-width:420px">
      <input type="hidden" name="csrf" value="<?php echo h($token); ?>">
      <input type="hidden" name="do" value="password">
      <input type="text" name="username" value="<?php echo h($me['username']); ?>" autocomplete="username" hidden>
      <label for="current_password"><?php echo $forced ? 'Temporary password' : 'Current password'; ?></label>
      <div class="input-wrap">
        <input id="current_password" name="current_password" type="password" required autocomplete="current-password" <?php echo $forced ? 'autofocus' : ''; ?>>
        <button type="button" class="pw-toggle" aria-label="Show password" aria-pressed="false"></button>
      </div>
      <label for="new_password">New password</label>
      <div class="input-wrap">
        <input id="new_password" name="new_password" type="password" required minlength="8" maxlength="72" autocomplete="new-password" data-caps="capsMsg">
        <button type="button" class="pw-toggle" aria-label="Show password" aria-pressed="false"></button>
      </div>
      <div class="strength" id="pwMeter"><i></i><i></i><i></i><i></i></div>
      <ul class="rules" id="pwRules"></ul>
      <div class="caps" id="capsMsg">Caps Lock is on.</div>
      <label for="confirm_password">Confirm new password</label>
      <input id="confirm_password" name="confirm_password" type="password" required minlength="8" maxlength="72" autocomplete="new-password">
      <div class="field-err" id="pwMatch"></div>
      <div style="margin-top:18px"><button type="submit" class="btn primary"><?php echo $forced ? 'Set password & continue' : 'Update password'; ?></button></div>
    </form>
  </section>

  <?php if (!$forced): ?>
  <section class="card">
    <div class="card-head" style="margin:0;align-items:center;flex-wrap:wrap">
      <div><h2>Sessions</h2><p class="card-sub" style="margin:4px 0 0">Signed in on a shared or lost device? Sign out everywhere except here.</p></div>
      <form method="post" data-no-busy>
        <input type="hidden" name="csrf" value="<?php echo h($token); ?>">
        <input type="hidden" name="do" value="signout_others">
        <button type="submit" class="btn">Sign out other devices</button>
      </form>
    </div>
  </section>
  <?php endif; ?>
</main>
<script>
const ME=<?php echo user_json($me); ?>;
App.topbar(ME,"account");
document.querySelectorAll(".pw-toggle").forEach(b=>b.innerHTML=App.icon("eye"));
document.querySelectorAll("[data-dt]").forEach(el=>el.textContent=el.dataset.dt?App.fmtDateTime(el.dataset.dt):"—");
const av=App.$("bigAvatar"); if(av) av.textContent=App.initials(ME.name);
App.passwordMeter(App.$("new_password"),{meter:App.$("pwMeter"),rules:App.$("pwRules"),confirm:App.$("confirm_password"),match:App.$("pwMatch")});
const em=App.$("email");
if(em){ const orig=ME.email.trim().toLowerCase(); const upd=()=>App.$("curPwWrap").classList.toggle("hidden",em.value.trim().toLowerCase()===orig); em.addEventListener("input",upd); upd(); }
</script>
</body>
</html>
