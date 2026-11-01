// Page markup, carried over unchanged from the PHP version (URLs updated).
// Rendered as static HTML; public/js/users.js adds the behaviour.
export const markup = `<style>
  .stats4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
  .mini{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;display:flex;gap:12px;align-items:center;box-shadow:var(--shadow-sm)}
  .mini .ic{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex:none}
  .mini .ic svg{width:19px;height:19px}
  .mini .k{font-size:12px;color:var(--muted)} .mini .v{font-size:20px;font-weight:700;line-height:1.2}
  .ucell{display:flex;gap:10px;align-items:center;min-width:220px}
  .ucell b{display:block;font-size:13.5px} .ucell small{display:block;color:var(--muted);font-size:12px}
  .status{display:flex;flex-wrap:wrap;gap:4px}
  .you{font-size:11px;font-weight:700;color:var(--accent);background:var(--accent-soft);padding:0 6px;border-radius:99px;margin-left:4px}
  tr.inactive .ucell,tr.inactive td:not(:last-child){opacity:.6}
  .roles-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
  .role-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:10px;box-shadow:var(--shadow-sm)}
  .role-card h3{margin:0;font-size:15px;display:flex;align-items:center;gap:8px}
  .role-card h3 svg{width:18px;height:18px}
  .role-card p{margin:0;color:var(--muted);font-size:13px}
  .perm-list{display:flex;flex-wrap:wrap;gap:5px}
  .role-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:10px;border-top:1px solid var(--border)}
  .perm-group{border:1px solid var(--border);border-radius:10px;padding:4px 14px 12px;margin-top:12px}
  .perm-group h4{margin:10px 0 0;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .role-hint{background:var(--surface-2);border-radius:8px;padding:9px 11px;font-size:12.5px;color:var(--text-2);margin-top:8px}
  .seg{display:inline-flex;border:1px solid var(--border-strong);border-radius:8px;padding:2px;gap:2px;background:var(--surface-2)}
  .seg button{border:0;background:none;padding:6px 12px;border-radius:6px;font:inherit;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer}
  .seg button.on{background:var(--surface);color:var(--text);box-shadow:var(--shadow-sm)}
  .event{font-family:var(--mono);font-size:12px}
  .modal .box.user-box{max-width:560px}
  @media (max-width:900px){.stats4{grid-template-columns:repeat(2,1fr)}}
  /* Phones: each user / reset request becomes a card instead of a wide table. */
  @media (max-width:640px){
    [data-panel="users"] thead,[data-panel="resets"] thead{display:none}
    [data-panel="users"] table,[data-panel="users"] tbody,[data-panel="resets"] table,[data-panel="resets"] tbody{display:block}
    #uBody tr[data-id]{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"user act" "role status" "last added";
      gap:8px 12px;padding:14px 16px;border-bottom:1px solid var(--border)}
    #uBody tr[data-id] td,#rsBody tr[data-id] td{display:block;padding:0;border:0;background:none!important}
    #uBody td:nth-child(1){grid-area:user;min-width:0}
    #uBody td:nth-child(2){grid-area:role}
    #uBody td:nth-child(3){grid-area:status;justify-self:end}
    #uBody td:nth-child(4){grid-area:last;font-size:12.5px;color:var(--muted)}
    #uBody td:nth-child(4)::before{content:"Last sign-in: "}
    #uBody td:nth-child(5){grid-area:added;justify-self:end;text-align:right}
    #uBody td:nth-child(6){grid-area:act;align-self:start}
    #rsBody tr[data-id]{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"user user" "when ip" "act act";
      gap:8px 12px;padding:14px 16px;border-bottom:1px solid var(--border)}
    #rsBody td:nth-child(1){grid-area:user} #rsBody td:nth-child(2){grid-area:when}
    #rsBody td:nth-child(3){grid-area:ip;justify-self:end} #rsBody td:nth-child(4){grid-area:act}
    #rsBody td:nth-child(4)>div{justify-content:flex-start!important}
    .ucell{min-width:0}
    .ucell small{overflow-wrap:anywhere}
    #uBody tr:not([data-id]) td,#rsBody tr:not([data-id]) td{display:block}
  }
</style>
<main class="page">
  <div class="page-head">
    <div><h1>Users &amp; roles</h1><p>Add people, choose what each role can do, and help users who are locked out.</p></div>
    <div class="page-actions">
      <button class="btn" id="addRoleBtn"></button>
      <button class="btn primary" id="addUserBtn"></button>
    </div>
  </div>

  <section class="stats4" id="stats"></section>

  <nav class="tabs" role="tablist">
    <button class="tab active" data-tab="users" role="tab">Users <span class="count" id="cUsers">0</span></button>
    <button class="tab" data-tab="roles" role="tab">Roles &amp; permissions <span class="count" id="cRoles">0</span></button>
    <button class="tab" data-tab="resets" role="tab">Reset requests <span class="count" id="cResets">0</span></button>
  </nav>

  <!-- Users -->
  <section data-panel="users" class="card" style="padding:0">
    <div class="toolbar" style="padding:16px 16px 0">
      <div class="search-box"><span id="searchIc" style="display:contents"></span><input id="uSearch" type="search" placeholder="Search name, username or email…" aria-label="Search users"></div>
      <select id="uRole" style="width:auto" aria-label="Filter by role"></select>
      <select id="uStatus" style="width:auto" aria-label="Filter by status">
        <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Deactivated</option>
        <option value="locked">Locked</option><option value="pending">Must change password</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Added</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody id="uBody"><tr><td colspan="6"><span class="skel" style="width:60%"></span></td></tr></tbody>
      </table>
    </div>
  </section>

  <!-- Roles -->
  <section data-panel="roles" class="hidden">
    <div class="roles-grid" id="rGrid"></div>
  </section>

  <!-- Reset requests -->
  <section data-panel="resets" class="hidden">
    <div id="mailNote"></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>User</th><th>Requested</th><th>From IP</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody id="rsBody"></tbody>
    </table></div></div>
  </section>
</main>

<!-- User dialog -->
<div class="modal" id="userModal" role="dialog" aria-modal="true" aria-labelledby="umTitle">
  <div class="box user-box">
    <h3 id="umTitle">Add user</h3>
    <p class="lead" id="umLead">They'll sign in with a temporary password and choose their own.</p>
    <form id="userForm" novalidate>
      <div class="row stack-sm">
        <div><label for="umName">Full name</label><input id="umName" maxlength="100" required autocomplete="off"></div>
        <div><label for="umUser">Username</label><input id="umUser" maxlength="50" required autocomplete="off" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9_.@\\-]{3,50}">
          <div class="help">3–50 characters: letters, digits, _ . @ -</div></div>
      </div>
      <label for="umEmail">Email <span class="muted" style="font-weight:400">(optional — needed for emailed reset links)</span></label>
      <input id="umEmail" type="email" maxlength="190" autocomplete="off" placeholder="name@example.com">
      <label for="umRole">Role</label>
      <select id="umRole"></select>
      <div class="role-hint" id="umRoleHint"></div>
      <div id="umPwBlock">
        <label for="umPw">Temporary password</label>
        <div class="secret" style="margin:0">
          <div class="input-wrap" style="flex:1"><input id="umPw" type="text" maxlength="72" autocomplete="new-password" class="mono"><button type="button" class="pw-toggle" aria-label="Hide password"></button></div>
          <button type="button" class="btn" id="umGen" title="Generate a new password"></button>
          <button type="button" class="btn" id="umCopy" title="Copy password"></button>
        </div>
        <div class="help">Share it with them privately. At least 8 characters with a letter and a number.</div>
        <label class="check"><input type="checkbox" id="umMust" checked><span>Require a new password at first sign-in<small>Recommended: only they will know their password.</small></span></label>
      </div>
      <div style="margin-top:16px"><label class="switch"><input type="checkbox" id="umActive" checked><span class="track"></span><span>Account active <span class="muted" id="umActiveHint" style="font-weight:400">— can sign in</span></span></label></div>
      <div class="field-err" id="umErr" role="alert" style="margin-top:12px"></div>
      <div class="actions">
        <button type="button" class="btn" id="umCancel">Cancel</button>
        <button type="button" class="btn" id="umSaveAnother">Save &amp; add another</button>
        <button type="submit" class="btn primary" id="umSave">Add user</button>
      </div>
    </form>
  </div>
</div>

<!-- Role dialog -->
<div class="modal" id="roleModal" role="dialog" aria-modal="true" aria-labelledby="rmTitle">
  <div class="box" style="max-width:560px">
    <h3 id="rmTitle">New role</h3>
    <p class="lead">Everyone can view the inventory. Choose what else people with this role can do.</p>
    <form id="roleForm" novalidate>
      <label for="rmName">Role name</label>
      <input id="rmName" maxlength="50" required placeholder="e.g. Godown Supervisor">
      <label for="rmDesc">Description</label>
      <input id="rmDesc" maxlength="255" placeholder="What this role is for">
      <div id="rmPerms"></div>
      <div class="field-err" id="rmErr" role="alert" style="margin-top:12px"></div>
      <div class="actions">
        <button type="button" class="btn" id="rmCancel">Cancel</button>
        <button type="submit" class="btn primary" id="rmSave">Save role</button>
      </div>
    </form>
  </div>
</div>

<!-- Set password dialog -->
<div class="modal" id="pwModal" role="dialog" aria-modal="true" aria-labelledby="pmTitle">
  <div class="box">
    <h3 id="pmTitle">Reset password</h3>
    <p class="lead" id="pmLead"></p>
    <div class="seg" id="pmMode" style="margin-top:8px"><button class="on" data-m="temp">Temporary password</button><button data-m="link">Reset link</button></div>
    <div id="pmTemp">
      <label for="pmPw">New temporary password</label>
      <div class="secret" style="margin:0">
        <input id="pmPw" class="mono" maxlength="72" autocomplete="new-password">
        <button type="button" class="btn" id="pmGen" title="Generate"></button>
      </div>
      <label class="check"><input type="checkbox" id="pmMust" checked><span>Require a new password at next sign-in</span></label>
    </div>
    <div id="pmLink" class="hidden">
      <p class="help" style="font-size:13px;margin-top:14px" id="pmLinkHelp"></p>
    </div>
    <div class="alert info" style="margin:16px 0 0" id="pmNote"></div>
    <div class="field-err" id="pmErr" role="alert"></div>
    <div class="actions">
      <button type="button" class="btn" id="pmCancel">Cancel</button>
      <button type="button" class="btn hidden" id="pmEmail"></button>
      <button type="button" class="btn primary" id="pmGo">Set password</button>
    </div>
  </div>
</div>
`;
