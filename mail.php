<?php
/**
 * Email settings for "Forgot password" links.
 *
 * While MAIL_TRANSPORT is 'none', reset requests are not emailed. They appear under
 * Users & roles → "Reset requests" so a Super Admin can help the user.
 *
 * TO TURN ON EMAIL WITH GMAIL (about 3 minutes):
 *   1. Turn on 2-Step Verification for the Gmail account: https://myaccount.google.com/security
 *   2. Create an App password: https://myaccount.google.com/apppasswords  (name it "Inventory")
 *      Google shows a 16-letter password like "abcd efgh ijkl mnop".
 *   3. Below, set MAIL_TRANSPORT to 'smtp', SMTP_USER to the Gmail address and SMTP_PASS to
 *      the app password (spaces are fine). Your normal Gmail password will NOT work.
 *   4. Sign in as a Super Admin → Users & roles → "Send test email" to check it works.
 *
 * Keep this file private: it contains the app password. (The web server refuses to serve it.)
 */

if (!defined('NFPC_APP')) {
    http_response_code(403);
    exit;
}

define('MAIL_TRANSPORT', 'smtp');                 // 'none' (off) | 'smtp' | 'mail' (PHP mail())
define('SMTP_USER', '');                          // e.g. 'nittefpc@gmail.com'
define('SMTP_PASS', '');                          // the 16-letter Gmail App password

define('APP_URL', '');                            // address other computers use, e.g. 'http://192.168.1.20/Inventory%20System' — blank = http://localhost/...
define('MAIL_FROM', '');                          // blank = SMTP_USER (Gmail always sends as the signed-in account)
define('MAIL_FROM_NAME', 'Nitte FPC Inventory');

define('SMTP_HOST', 'smtp.gmail.com');
define('SMTP_PORT', 587);
define('SMTP_SECURE', 'tls');                     // 'tls' (STARTTLS, port 587) | 'ssl' (port 465) | '' (none)
// Trusted certificates. This bundle includes the GlobalSign root that PHP 5.6's old OpenSSL needs for Gmail.
define('SMTP_CAFILE', 'C:/xampp/php/extras/ssl/cacert-smtp.pem');

function mail_enabled()
{
    return MAIL_TRANSPORT === 'smtp' || MAIL_TRANSPORT === 'mail';
}

function mail_from()
{
    return MAIL_FROM !== '' ? MAIL_FROM : SMTP_USER;
}

/** Why the last send_mail() failed, in plain words (shown to Super Admins by "Send test email"). */
function mail_last_error($set = null)
{
    static $err = '';
    if ($set !== null) $err = $set;
    return $err;
}

/** Send a plain-text email. Returns true on success; failures are written to the PHP error log. */
function send_mail($to, $subject, $body)
{
    mail_last_error('');
    if (!mail_enabled()) { mail_last_error("Email is switched off. Set MAIL_TRANSPORT to 'smtp' in mail.php."); return false; }
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) { mail_last_error('Invalid recipient address.'); return false; }
    if (MAIL_TRANSPORT === 'smtp' && (SMTP_USER === '' || SMTP_PASS === '')) { mail_last_error('Fill in SMTP_USER and SMTP_PASS in mail.php.'); return false; }
    $subjectEnc = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $fromName = '=?UTF-8?B?' . base64_encode(MAIL_FROM_NAME) . '?=';
    $body = str_replace(array("\r\n", "\r"), "\n", $body);

    if (MAIL_TRANSPORT === 'mail') {
        $headers = "From: $fromName <" . mail_from() . ">\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit";
        $ok = @mail($to, $subjectEnc, str_replace("\n", "\r\n", $body), $headers);
        if (!$ok) error_log('send_mail: mail() failed for ' . $to);
        return $ok;
    }
    return smtp_send($to, $subjectEnc, $fromName, $body);
}

function smtp_send($to, $subjectEnc, $fromName, $body)
{
    $ssl = array('verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => SMTP_HOST);
    if (SMTP_CAFILE !== '' && is_file(SMTP_CAFILE)) $ssl['cafile'] = SMTP_CAFILE;
    $ctx = stream_context_create(array('ssl' => $ssl));
    $remote = (SMTP_SECURE === 'ssl' ? 'ssl://' : 'tcp://') . SMTP_HOST . ':' . (int)SMTP_PORT;
    $fp = @stream_socket_client($remote, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        error_log("smtp_send: cannot connect to $remote ($errno $errstr)");
        mail_last_error("Can't reach " . SMTP_HOST . ':' . SMTP_PORT . " ($errstr). Check the internet connection, or a firewall/antivirus blocking outgoing mail.");
        return false;
    }
    stream_set_timeout($fp, 20);

    $read = function () use ($fp) {
        $data = '';
        while (($line = fgets($fp, 1024)) !== false) {
            $data .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') break;   // last line of a multi-line reply
        }
        return $data;
    };
    $cmd = function ($line, $expect) use ($fp, $read) {
        if ($line !== null) fwrite($fp, $line . "\r\n");
        $reply = $read();
        if (!in_array((int)substr($reply, 0, 3), (array)$expect, true)) {
            throw new Exception('SMTP error after "' . strtok((string)$line, ' ') . '": ' . trim($reply));
        }
        return $reply;
    };

    try {
        $cmd(null, 220);
        $cmd('EHLO localhost', 250);
        if (SMTP_SECURE === 'tls') {
            $cmd('STARTTLS', 220);
            $method = defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')
                ? STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT | STREAM_CRYPTO_METHOD_TLS_CLIENT
                : STREAM_CRYPTO_METHOD_TLS_CLIENT;
            if (!@stream_socket_enable_crypto($fp, true, $method)) {
                throw new Exception('Secure connection failed: the mail server certificate could not be verified. Check SMTP_CAFILE in mail.php.');
            }
            $cmd('EHLO localhost', 250);
        }
        if (SMTP_USER !== '') {
            $cmd('AUTH LOGIN', 334);
            $cmd(base64_encode(SMTP_USER), 334);
            $cmd(base64_encode(SMTP_PASS), 235);
        }
        $cmd('MAIL FROM:<' . mail_from() . '>', 250);
        $cmd('RCPT TO:<' . $to . '>', array(250, 251));
        $cmd('DATA', 354);
        $msg = 'Date: ' . date('r') . "\r\n"
             . "From: $fromName <" . mail_from() . ">\r\n"
             . "To: <$to>\r\n"
             . "Subject: $subjectEnc\r\n"
             . 'Message-ID: <' . bin2hex(openssl_random_pseudo_bytes(12)) . '@' . preg_replace('/^.*@/', '', mail_from()) . ">\r\n"
             . "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
             . chunk_split(base64_encode($body), 76, "\r\n");
        $cmd($msg . '.', 250);
        $cmd('QUIT', 221);
        fclose($fp);
        return true;
    } catch (Exception $e) {
        $m = $e->getMessage();
        error_log('smtp_send: ' . $m);
        if (strpos($m, '535') !== false || stripos($m, 'BadCredentials') !== false) {
            $m = 'Gmail rejected the username or password. Use a 16-letter App password (not your normal Gmail password), and check SMTP_USER is the full Gmail address.';
        } elseif (strpos($m, '534') !== false) {
            $m = 'Gmail requires an App password. Turn on 2-Step Verification, then create one at https://myaccount.google.com/apppasswords';
        }
        mail_last_error($m);
        @fclose($fp);
        return false;
    }
}
