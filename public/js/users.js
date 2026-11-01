/* Users page — carried over from the PHP version (URLs updated). */
const ME=JSON.parse(document.getElementById("me-data").textContent);
const {esc,$,icon,api,toast}=App;
App.topbar(ME,"users");

let S={users:[],roles:[],resets:[],permissions:[],mailEnabled:false};
let tab="users", editUser=null, editRole=null, pwUser=null;

$("addUserBtn").innerHTML=icon("plus")+"Add user";
$("addRoleBtn").innerHTML=icon("shield")+"New role";
$("searchIc").innerHTML=icon("search");
$("umGen").innerHTML=icon("refresh"); $("pmGen").innerHTML=icon("refresh"); $("umCopy").innerHTML=icon("copy");
document.querySelectorAll(".pw-toggle").forEach(b=>b.innerHTML=icon("eyeOff"));

/* ---------- Data ---------- */
async function load(){
  try{ apply(await api("admin_data")); }
  catch(e){ $("uBody").innerHTML=`<tr><td colspan="6"><div class="empty-state">${icon("alert")}<b>Couldn't load users</b>${esc(e.message)}</div></td></tr>`; }
}
function apply(d){
  S={users:d.users,roles:d.roles,resets:d.resets,permissions:d.permissions,mailEnabled:d.mailEnabled,mailFrom:d.mailFrom};
  renderAll();
}
const roleById=id=>S.roles.find(r=>r.id===id);
const permLabel=k=>(S.permissions.find(p=>p.key===k)||{}).label||k;
const genPw=()=>{ const w=["Mango","River","Paddy","Cocoa","Pepper","Lotus","Cedar","Monsoon","Harbor","Tiger","Falcon","Amber","Coral","Maple","Orchid","Banyan"];
  const r=crypto.getRandomValues(new Uint32Array(3)); return `${w[r[0]%16]}-${1000+r[1]%9000}-${w[r[2]%16].toLowerCase()}`; };

/* ---------- Render ---------- */
function renderAll(){
  const active=S.users.filter(u=>u.active).length;
  const locked=S.users.filter(u=>u.locked).length, supers=S.users.filter(u=>u.isSuper&&u.active).length;
  $("stats").innerHTML=[["users","Active users",`${active}<span class="muted" style="font-size:13px;font-weight:500"> / ${S.users.length}</span>`],
    ["shield","Super Admins",supers],["lock","Locked accounts",locked],["key","Reset requests",S.resets.length]]
    .map(([ic,k,v])=>`<div class="mini"><span class="ic">${icon(ic)}</span><div><div class="k">${k}</div><div class="v">${v}</div></div></div>`).join("");
  $("cUsers").textContent=S.users.length; $("cRoles").textContent=S.roles.length;
  $("cResets").textContent=S.resets.length; $("cResets").classList.toggle("alert-count",S.resets.length>0);
  const sel=$("uRole").value;
  $("uRole").innerHTML=`<option value="">All roles</option>`+S.roles.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
  $("uRole").value=S.roles.some(r=>r.id===sel)?sel:"";
  renderUsers(); renderRoles(); renderResets();
}

function statusBadges(u){
  const b=[];
  b.push(u.active?`<span class="badge ok dot">Active</span>`:`<span class="badge neutral dot">Deactivated</span>`);
  if(u.locked) b.push(`<span class="badge danger">${icon("lock")}Locked</span>`);
  if(u.mustChange&&u.active) b.push(`<span class="badge warn">Must change password</span>`);
  return `<div class="status">${b.join("")}</div>`;
}
function renderUsers(){
  const q=$("uSearch").value.trim().toLowerCase(), rf=$("uRole").value, sf=$("uStatus").value;
  const list=S.users.filter(u=>{
    if(rf&&u.roleId!==rf) return false;
    if(sf==="active"&&!u.active) return false; if(sf==="inactive"&&u.active) return false;
    if(sf==="locked"&&!u.locked) return false; if(sf==="pending"&&!u.mustChange) return false;
    return !q||[u.name,u.username,u.email].join(" ").toLowerCase().includes(q);
  });
  $("uBody").innerHTML=list.length?list.map(u=>{
    const self=u.username===ME.username;
    return `<tr data-id="${esc(u.id)}" class="${u.active?"":"inactive"}">
      <td><div class="ucell"><span class="avatar">${esc(App.initials(u.name||u.username))}</span><div><b>${esc(u.name||u.username)}${self?'<span class="you">You</span>':""}</b>
        <small>@${esc(u.username)}${u.email?" · "+esc(u.email):""}</small></div></div></td>
      <td><span class="badge ${u.isSuper?"accent":"neutral"}">${u.isSuper?icon("shield"):""}${esc(u.role)}</span></td>
      <td>${statusBadges(u)}</td>
      <td title="${esc(App.fmtDateTime(u.lastLogin))}">${esc(App.timeAgo(u.lastLogin))}</td>
      <td class="muted" style="font-size:12.5px">${esc(App.fmtDateTime(u.created).split(",")[0])}${u.createdBy?`<br>by ${esc(u.createdBy)}`:""}</td>
      <td><div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn sm" data-act="edit">${icon("edit")}Edit</button>
        <div class="dd"><button class="btn sm icon" data-menu aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${esc(u.username)}">${icon("more")}</button>
          <div class="menu" role="menu">
            ${self?`<a class="menu-item" href="/account">${icon("settings")}Change my password</a>`:
             `<button class="menu-item" data-act="pw">${icon("key")}Reset password…</button>`}
            ${!self&&!u.isSuper&&u.active?`<button class="menu-item" data-act="impersonate">${icon("eye")}View as this user…</button>`:""}
            ${u.locked?`<button class="menu-item" data-act="unlock">${icon("unlock")}Unlock account</button>`:""}
            ${self?"":`<button class="menu-item" data-act="toggle">${icon(u.active?"lock":"check")}${u.active?"Deactivate":"Activate"}</button>`}
            ${self?"":`<div class="menu-sep"></div><button class="menu-item danger" data-act="delete">${icon("trash")}Delete user</button>`}
          </div></div>
      </div></td></tr>`;
  }).join(""):`<tr><td colspan="6"><div class="empty-state">${icon("users")}<b>No users match</b>Try a different search or filter.</div></td></tr>`;
}

function renderRoles(){
  $("rGrid").innerHTML=S.roles.map(r=>`
    <article class="role-card" data-id="${esc(r.id)}">
      <h3>${r.isSuper?`<span style="color:var(--accent);display:flex">${icon("shield")}</span>`:""}${esc(r.name)}</h3>
      <p>${esc(r.description)||'<span class="muted">No description</span>'}</p>
      <div class="perm-list">${r.isSuper?`<span class="badge accent">All permissions</span><span class="badge accent">Manage users &amp; roles</span>`:
        (r.perms.length?r.perms.map(k=>`<span class="badge neutral">${esc(permLabel(k))}</span>`).join(""):`<span class="badge neutral">View inventory only</span>`)}</div>
      <div class="role-foot"><span class="muted" style="font-size:12.5px">${r.users} user${r.users===1?"":"s"}</span>
        <div style="display:flex;gap:6px">
          ${r.isSuper?"":`<button class="btn sm" data-ract="preview" title="Use the app with only this role's permissions">${icon("eye")}Preview</button>`}
          <button class="btn sm" data-ract="edit">${icon("edit")}Edit</button>
          ${r.isSuper?"":`<button class="btn sm danger icon" data-ract="delete" title="Delete role" aria-label="Delete role ${esc(r.name)}">${icon("trash")}</button>`}
        </div></div>
    </article>`).join("");
}

function renderResets(){
  $("mailNote").innerHTML=(S.mailEnabled
    ?`<div class="alert success">${icon("mail")}<div><b>Email is on.</b> "Forgot password" links are emailed from <b>${esc(S.mailFrom)}</b>. Requests only appear here if an email couldn't be sent or the user has no email address.</div></div>`
    :`<div class="alert info">${icon("info")}<div><b>Email is off</b>, so "Forgot password" requests come here instead of being emailed.
      Give the user a temporary password or a reset link. To email links automatically, set <span class="mono">MAIL_TRANSPORT</span> in the app settings (<span class="mono">.env</span>).</div></div>`)
    +`<div class="card" style="margin-bottom:14px;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
      <div style="flex:1;min-width:220px"><label for="mtTo" style="margin-top:0">Send a test email to</label><input id="mtTo" type="email" value="${esc(ME.email)}" placeholder="you@example.com"></div>
      <button class="btn" id="mtGo">${icon("mail")}Send test email</button></div>`;
  $("mtGo").onclick=async()=>{
    const to=$("mtTo").value.trim(), b=$("mtGo"); if(!to){ $("mtTo").focus(); return; }
    b.classList.add("loading");
    try{ await api("mail_test",{to}); toast(`Test email sent to ${to}. Check the inbox (and spam).`,"success",6000); }
    catch(e){ App.dialog(`<h3>Test email failed</h3><div class="alert error" style="margin:12px 0 0">${icon("alert")}<div>${esc(e.message)}</div></div>
      <div class="actions"><button class="btn primary" onclick="App.closeModal(this.closest('.modal'));this.closest('.modal').remove()">OK</button></div>`); }
    finally{ b.classList.remove("loading"); }
  };
  $("rsBody").innerHTML=S.resets.length?S.resets.map(r=>`<tr data-id="${esc(r.id)}" data-user="${esc(r.userId)}">
      <td><div class="ucell"><span class="avatar">${esc(App.initials(r.name||r.username))}</span><div><b>${esc(r.name||r.username)}</b><small>@${esc(r.username)}${r.email?" · "+esc(r.email):""}</small></div></div></td>
      <td title="${esc(App.fmtDateTime(r.requested))}">${esc(App.timeAgo(r.requested))}</td>
      <td class="mono muted" style="font-size:12.5px">${esc(r.ip)}</td>
      <td><div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn sm primary" data-ract2="pw">${icon("key")}Reset password…</button>
        <button class="btn sm" data-ract2="dismiss">Dismiss</button></div></td></tr>`).join("")
    :`<tr><td colspan="4"><div class="empty-state">${icon("check")}<b>No pending requests</b>When someone uses "Forgot password" and it can't be emailed, it shows up here.</div></td></tr>`;
}


/* ---------- Tabs & filters ---------- */
function showTab(t){
  tab=t;
  document.querySelectorAll(".tab").forEach(b=>{ const on=b.dataset.tab===t; b.classList.toggle("active",on); b.setAttribute("aria-selected",String(on)); });
  document.querySelectorAll("[data-panel]").forEach(p=>p.classList.toggle("hidden",p.dataset.panel!==t));
  try{ history.replaceState(null,"","#"+t); }catch(e){}
}
document.querySelector(".tabs").addEventListener("click",e=>{ const b=e.target.closest(".tab"); if(b) showTab(b.dataset.tab); });
["uSearch","uRole","uStatus"].forEach(id=>$(id).addEventListener("input",renderUsers));

/* ---------- User dialog ---------- */
function fillRoleSelect(sel,val){
  sel.innerHTML=S.roles.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
  sel.value=val&&S.roles.some(r=>r.id===val)?val:(S.roles.find(r=>r.name==="Inventory Staff")||S.roles.find(r=>!r.isSuper)||S.roles[0]||{}).id||"";
}
function roleHint(){
  const r=roleById($("umRole").value); if(!r){ $("umRoleHint").textContent=""; return; }
  $("umRoleHint").innerHTML=`<b>${esc(r.name)}:</b> ${esc(r.description)||""}<div style="margin-top:4px">${r.isSuper?"Can do everything, including managing users and roles.":
    (r.perms.length?"Can: "+r.perms.map(k=>esc(permLabel(k).toLowerCase())).join(", ")+".":"Can only view the inventory.")}</div>`;
}
$("umRole").addEventListener("change",roleHint);
$("umActive").addEventListener("change",()=>$("umActiveHint").textContent=$("umActive").checked?"— can sign in":"— can't sign in");
function openUser(u){
  editUser=u||null;
  $("umTitle").textContent=u?`Edit ${u.name||u.username}`:"Add user";
  $("umLead").textContent=u?"Update their details, role or access. To change their password, use Reset password.":"They'll sign in with a temporary password and then choose their own.";
  $("umName").value=u?u.name:""; $("umUser").value=u?u.username:""; $("umEmail").value=u?u.email:"";
  fillRoleSelect($("umRole"),u?u.roleId:""); roleHint();
  $("umActive").checked=u?u.active:true; $("umActive").dispatchEvent(new Event("change"));
  const self=u&&u.username===ME.username;
  $("umActive").disabled=!!self; $("umRole").disabled=!!self;
  $("umPwBlock").classList.toggle("hidden",!!u);
  if(!u){ $("umPw").value=genPw(); $("umPw").type="text"; $("umMust").checked=true; }
  $("umSaveAnother").classList.toggle("hidden",!!u);
  $("umSave").textContent=u?"Save changes":"Add user";
  $("umErr").textContent="";
  if(self) $("umErr").innerHTML=`<span class="muted">You can't change your own role or deactivate yourself.</span>`;
  App.openModal("userModal"); setTimeout(()=>$("umName").focus(),40);
}
$("addUserBtn").onclick=()=>openUser(null);
$("umCancel").onclick=()=>App.closeModal("userModal");
$("umGen").onclick=()=>{ $("umPw").value=genPw(); $("umPw").type="text"; };
$("umCopy").onclick=async()=>{ try{ await navigator.clipboard.writeText($("umPw").value); toast("Password copied","success"); }catch(e){ $("umPw").select(); document.execCommand("copy"); toast("Password copied","success"); } };
// Suggest a username from the full name while adding.
$("umName").addEventListener("input",()=>{ if(editUser||$("umUser").dataset.touched) return;
  $("umUser").value=$("umName").value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,".").replace(/^\.|\.$/g,"").slice(0,50); });
$("umUser").addEventListener("input",()=>$("umUser").dataset.touched="1");

async function saveUser(again){
  const body={id:editUser?editUser.id:undefined,name:$("umName").value.trim(),username:$("umUser").value.trim(),email:$("umEmail").value.trim(),
    roleId:$("umRole").value,active:$("umActive").checked};
  const err=m=>{ $("umErr").textContent=m; };
  if(!body.name) return err("Enter their full name."), $("umName").focus();
  if(!/^[A-Za-z0-9_.@-]{3,50}$/.test(body.username)) return err("Username must be 3–50 characters: letters, digits, _ . @ -"), $("umUser").focus();
  if(body.email&&!$("umEmail").checkValidity()) return err("Enter a valid email address, or leave it blank."), $("umEmail").focus();
  if(!editUser){
    body.password=$("umPw").value; body.mustChange=$("umMust").checked;
    if(body.password.length<8||!/[A-Za-z]/.test(body.password)||!/\d/.test(body.password)) return err("Temporary password needs 8+ characters with a letter and a number."), $("umPw").focus();
  }
  const btn=again?$("umSaveAnother"):$("umSave"); btn.classList.add("loading");
  try{
    const d=await api("user_save",body); apply(d);
    if(editUser){ App.closeModal("userModal"); toast("User updated","success"); return; }
    const pw=body.password, who=body.username;
    if(again){ toast(`${who} added. Password: ${pw}`,"success",9000); delete $("umUser").dataset.touched; openUser(null); }
    else{ App.closeModal("userModal");
      App.secretDialog({title:`${body.name} has been added`,message:`Give <b>@${esc(who)}</b> this temporary password.${body.mustChange?" They'll choose their own when they first sign in.":""}`,value:pw}); }
  }catch(e){ err(e.message); }
  finally{ btn.classList.remove("loading"); }
}
$("userForm").addEventListener("submit",e=>{ e.preventDefault(); saveUser(false); });
$("umSaveAnother").onclick=()=>saveUser(true);

/* ---------- Row actions ---------- */
$("uBody").addEventListener("click",async e=>{
  const b=e.target.closest("[data-act]"); if(!b) return;
  const u=S.users.find(x=>x.id===b.closest("tr").dataset.id); if(!u) return;
  const act=b.dataset.act;
  if(act==="edit") return openUser(u);
  if(act==="pw") return openPw(u);
  if(act==="impersonate") return startImpersonation("user",u.id,`View as ${u.name||u.username}?`,
    `You'll see and use the app exactly as <b>@${esc(u.username)}</b> (${esc(u.role)}) does, for up to 60 minutes.
     Anything you do is recorded as them, <b>done by you</b>. You can't change their password, email or sessions.
     They stay signed in and aren't notified.`);
  try{
    if(act==="unlock"){ apply(await api("user_unlock",{id:u.id})); toast(`${u.username} unlocked`,"success"); }
    if(act==="toggle"){
      if(u.active&&!await App.confirm({title:`Deactivate ${u.name||u.username}?`,message:"They'll be signed out right away and won't be able to sign in. Their history is kept, and you can reactivate them at any time.",confirmText:"Deactivate",danger:true})) return;
      apply(await api("user_save",{id:u.id,name:u.name||u.username,username:u.username,email:u.email,roleId:u.roleId,active:!u.active}));
      toast(u.active?"User deactivated":"User activated","success");
    }
    if(act==="delete"){
      if(!await App.confirm({title:`Delete ${u.name||u.username}?`,message:`This permanently removes <b>@${esc(u.username)}</b>. Stock history keeps their name. <br><br>Tip: <b>Deactivate</b> instead if they might come back.`,confirmText:"Delete user",danger:true})) return;
      apply(await api("user_delete",{id:u.id})); toast("User deleted","success");
    }
  }catch(err){ toast(err.message,"error"); }
});

/* ---------- Reset password dialog ---------- */
let pwMode="temp";
function setPwMode(m){
  pwMode=m; $("pmMode").querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.m===m));
  $("pmTemp").classList.toggle("hidden",m!=="temp"); $("pmLink").classList.toggle("hidden",m!=="link");
  $("pmGo").textContent=m==="temp"?"Set password":"Create link";
  const canEmail=m==="link"&&S.mailEnabled&&pwUser&&pwUser.email;
  $("pmEmail").classList.toggle("hidden",!canEmail); $("pmEmail").innerHTML=icon("mail")+"Email link";
  $("pmNote").innerHTML=icon("info")+`<div>${m==="temp"?"They'll be signed out everywhere and must use this password next time.":"Their current password keeps working until they use the link. The link works once and expires in 24 hours."}</div>`;
  $("pmErr").textContent="";
}
$("pmMode").addEventListener("click",e=>{ const b=e.target.closest("button"); if(b) setPwMode(b.dataset.m); });
function openPw(u,resetId){
  pwUser=u; pwUser.resetId=resetId;
  $("pmTitle").textContent=`Reset password for ${u.name||u.username}`;
  $("pmLead").innerHTML=`Account <b>@${esc(u.username)}</b>${u.locked?" — this also unlocks the account.":""}`;
  $("pmPw").value=genPw(); $("pmMust").checked=true;
  $("pmLinkHelp").textContent=`Create a one-time link that lets ${u.name||u.username} choose a new password.${S.mailEnabled&&u.email?" You can copy it or email it to "+u.email+".":" Copy it and send it to them privately."}`;
  setPwMode("temp"); App.openModal("pwModal");
}
$("pmGen").onclick=()=>$("pmPw").value=genPw();
$("pmCancel").onclick=()=>App.closeModal("pwModal");
async function runPw(send){
  const btn=send?$("pmEmail"):$("pmGo"); btn.classList.add("loading"); $("pmErr").textContent="";
  try{
    if(pwMode==="temp"){
      const pw=$("pmPw").value;
      const d=await api("user_password",{id:pwUser.id,password:pw,mustChange:$("pmMust").checked}); apply(d);
      App.closeModal("pwModal");
      App.secretDialog({title:"Password updated",message:`Give <b>@${esc(pwUser.username)}</b> this temporary password.`,value:pw});
    } else {
      const d=await api("user_reset_link",{id:pwUser.id,send:!!send}); apply(d);
      App.closeModal("pwModal");
      if(d.emailed) toast(`Reset link emailed to ${pwUser.email}`,"success");
      else App.secretDialog({title:"Reset link created",message:`Send this link to <b>@${esc(pwUser.username)}</b>. It works once and expires in ${d.hours} hours.`,value:d.link,label:"Copy link"});
    }
  }catch(e){ $("pmErr").textContent=e.message; }
  finally{ btn.classList.remove("loading"); }
}
$("pmGo").onclick=()=>runPw(false);
$("pmEmail").onclick=()=>runPw(true);

$("rsBody").addEventListener("click",async e=>{
  const b=e.target.closest("[data-ract2]"); if(!b) return;
  const tr=b.closest("tr"), r=S.resets.find(x=>x.id===tr.dataset.id); if(!r) return;
  if(b.dataset.ract2==="pw"){ const u=S.users.find(x=>x.id===r.userId); if(u) openPw(u,r.id); return; }
  try{ apply(await api("reset_dismiss",{id:r.id})); toast("Request dismissed"); }catch(err){ toast(err.message,"error"); }
});

/* ---------- Role dialog ---------- */
function openRole(r){
  editRole=r||null;
  $("rmTitle").textContent=r?`Edit role: ${r.name}`:"New role";
  $("rmName").value=r?r.name:""; $("rmDesc").value=r?r.description:"";
  const groups={}; S.permissions.forEach(p=>(groups[p.group]=groups[p.group]||[]).push(p));
  const locked=r&&r.isSuper;
  $("rmPerms").innerHTML=(locked?`<div class="alert info" style="margin:14px 0 0">${icon("shield")}<div>Super Admins always have every permission, including managing users and roles. You can rename the role or change its description.</div></div>`:"")+
    Object.entries(groups).map(([g,ps])=>`<fieldset class="perm-group" ${locked?"disabled":""}><h4>${esc(g)}</h4>${ps.map(p=>`
      <label class="check"><input type="checkbox" value="${esc(p.key)}" ${(r?r.perms:[]).includes(p.key)?"checked":""}><span>${esc(p.label)}<small>${esc(p.hint)}</small></span></label>`).join("")}</fieldset>`).join("");
  $("rmErr").textContent="";
  App.openModal("roleModal"); setTimeout(()=>$("rmName").focus(),40);
}
$("addRoleBtn").onclick=()=>openRole(null);
$("rmCancel").onclick=()=>App.closeModal("roleModal");
$("roleForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const name=$("rmName").value.trim(); if(!name){ $("rmErr").textContent="Give the role a name."; $("rmName").focus(); return; }
  const perms=[...$("rmPerms").querySelectorAll("input:checked")].map(c=>c.value);
  $("rmSave").classList.add("loading");
  try{ apply(await api("role_save",{id:editRole?editRole.id:undefined,name,description:$("rmDesc").value.trim(),perms}));
    App.closeModal("roleModal"); toast(editRole?"Role updated":"Role created","success"); showTab("roles"); }
  catch(err){ $("rmErr").textContent=err.message; }
  finally{ $("rmSave").classList.remove("loading"); }
});
/* ---------- View as a user / preview a role ---------- */
function startImpersonation(mode,id,title,message){
  const m=App.dialog(`<h3>${esc(title)}</h3><p class="lead">${message}</p>
    <label for="impReason">Reason <span class="muted" style="font-weight:400">(optional, saved in the activity log)</span></label>
    <input id="impReason" maxlength="150" placeholder="e.g. Checking why Ravi can't see the Edit button">
    <div class="field-err" id="impErr" role="alert"></div>
    <div class="actions"><button class="btn" data-r="0">Cancel</button><button class="btn primary" data-r="1">${icon("eye")}${mode==="role"?"Start preview":"View as user"}</button></div>`,{wide:true});
  const close=()=>{ App.closeModal(m); m.remove(); };
  m.addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.stopPropagation(); close(); } });
  m.addEventListener("click",async e=>{
    const b=e.target.closest("[data-r]"); if(!b){ if(e.target===m) close(); return; }
    if(b.dataset.r==="0") return close();
    b.classList.add("loading");
    try{ await api("impersonate_start",{mode,id,reason:m.querySelector("#impReason").value.trim()}); location.href="/inventory"; }
    catch(err){ m.querySelector("#impErr").textContent=err.message; b.classList.remove("loading"); }
  });
}

$("rGrid").addEventListener("click",async e=>{
  const b=e.target.closest("[data-ract]"); if(!b) return;
  const r=roleById(b.closest(".role-card").dataset.id); if(!r) return;
  if(b.dataset.ract==="edit") return openRole(r);
  if(b.dataset.ract==="preview") return startImpersonation("role",r.id,`Preview the "${r.name}" role?`,
    `You'll use the app as yourself but with <b>only</b> this role's permissions, for up to 60 minutes, to check what people with it can see and do.
     Your actions are recorded as you, marked as a role preview.`);
  if(r.users>0){ toast(`${r.users} user(s) have this role. Move them to another role first.`,"error"); return; }
  if(!await App.confirm({title:`Delete the "${r.name}" role?`,message:"This can't be undone.",confirmText:"Delete role",danger:true})) return;
  try{ apply(await api("role_delete",{id:r.id})); toast("Role deleted","success"); }catch(err){ toast(err.message,"error"); }
});

["userModal","roleModal","pwModal"].forEach(id=>$(id).addEventListener("mousedown",e=>{ if(e.target.id===id) App.closeModal(id); }));

showTab(["users","roles","resets"].includes(location.hash.slice(1))?location.hash.slice(1):"users");
load();
