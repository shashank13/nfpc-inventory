<?php
/**
 * Activity log: who did what, to which item, and when — product changes, bulk uploads, deletes,
 * label printing and downloads, exports, template changes, sign-ins and user / role changes.
 * Visible to Super Admins and roles with the "View activity log" permission.
 */
define('NFPC_APP', true);
require __DIR__ . '/auth.php';
require __DIR__ . '/ui.php';

start_session();
try {
    app_db();
} catch (Exception $e) {
    error_log('activity.php DB error: ' . $e->getMessage());
    redirect('login.php');
}
$me = current_user();
if (!$me) redirect('login.php');
if ($me['mustChange']) redirect('account.php');
if (!can($me, 'activity.view')) redirect('inventory-barcode.html');

page_head('Activity log');
?>
<body>
<div id="topbar" class="topbar"></div>
<style>
  .stats4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
  .mini{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;display:flex;gap:12px;align-items:center;box-shadow:var(--shadow-sm)}
  .mini .ic{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex:none}
  .mini .ic svg{width:19px;height:19px}
  .mini.warn .ic{background:var(--danger-soft);color:var(--danger)}
  .mini .k{font-size:12px;color:var(--muted)} .mini .v{font-size:20px;font-weight:700;line-height:1.2}
  .filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:16px 16px 0}
  .filters select{width:auto}
  .filters input[type=date]{width:auto}
  .act-table td{vertical-align:top}
  .act-when{white-space:nowrap;font-size:13px}
  .act-when small{display:block;color:var(--muted);font-size:11.5px}
  .who{display:flex;gap:8px;align-items:center;white-space:nowrap}
  .who .avatar{width:26px;height:26px;font-size:10.5px}
  .who.sys{color:var(--muted)}
  .via{display:flex;width:max-content;align-items:center;gap:4px;margin-top:4px;font-size:11px;font-weight:600;color:#b45309;background:color-mix(in srgb,#b45309 12%,transparent);padding:1px 7px;border-radius:99px;white-space:nowrap}
  .via svg{width:12px;height:12px}
  .act-target{font-weight:600;font-size:13px;max-width:280px;overflow-wrap:anywhere}
  .act-detail{font-size:12.5px;color:var(--text-2);max-width:380px;overflow-wrap:anywhere}
  .act-ip{font-family:var(--mono);font-size:11.5px;color:var(--muted);white-space:nowrap}
  .chg-btn{border:0;background:none;color:var(--accent);font:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:2px 0;margin-top:3px}
  .chg{margin-top:6px;border:1px solid var(--border);border-radius:8px;overflow:hidden;font-size:12px}
  .chg table{width:100%}
  .chg th,.chg td{padding:5px 8px;border-bottom:1px solid var(--border);text-transform:none;letter-spacing:0;font-size:12px}
  .chg tr:last-child td{border-bottom:0}
  .chg .old{color:var(--danger);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--danger) 50%,transparent)}
  .chg .new{color:var(--ok);font-weight:600}
  .day-row td{background:var(--surface-2)!important;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:6px 12px}
  .pager{display:flex;align-items:center;gap:10px 16px;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--border);font-size:13px}
  .pager .info{color:var(--muted)}
  .pager nav{margin-left:auto;display:flex;gap:4px}
  @media (max-width:900px){.stats4{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media (max-width:700px){.act-ip,.th-ip{display:none}}
</style>

<main class="page">
  <div class="page-head">
    <div><h1>Activity log</h1><p>Every change, print, export and sign-in: who did it, what they changed, and when.</p></div>
    <div class="page-actions">
      <button class="btn" id="refreshBtn"></button>
      <button class="btn" id="exportBtn"></button>
    </div>
  </div>

  <section class="stats4" id="stats"></section>

  <nav class="tabs" role="tablist" id="catTabs">
    <button class="tab active" data-cat="" role="tab">All activity</button>
    <button class="tab" data-cat="inventory" role="tab">Products &amp; stock</button>
    <button class="tab" data-cat="labels" role="tab">Labels &amp; exports</button>
    <button class="tab" data-cat="admin" role="tab">Users &amp; roles</button>
    <button class="tab" data-cat="auth" role="tab">Sign-ins</button>
    <button class="tab" data-cat="security" role="tab">Passwords &amp; security</button>
  </nav>

  <section class="card" style="padding:0">
    <div class="filters">
      <div class="search-box"><span id="searchIc" style="display:contents"></span><input id="q" type="search" placeholder="Search product, SKU, user, details or IP…" aria-label="Search activity"></div>
      <select id="user" aria-label="Filter by person"><option value="">Everyone</option></select>
      <select id="range" aria-label="Date range">
        <option value="">Any time</option><option value="today">Today</option><option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option><option value="custom">Custom dates…</option>
      </select>
      <span id="customDates" class="hidden" style="display:inline-flex;gap:6px;align-items:center">
        <input type="date" id="from" aria-label="From date"><span class="muted">to</span><input type="date" id="to" aria-label="To date">
      </span>
      <button class="btn sm ghost hidden" id="clearBtn">Clear filters</button>
    </div>
    <div class="table-wrap" style="margin-top:12px">
      <table class="act-table">
        <thead><tr><th>When</th><th>Who</th><th>Activity</th><th>Item</th><th>Details</th><th class="th-ip">IP address</th></tr></thead>
        <tbody id="rows"><tr><td colspan="6"><span class="skel" style="width:60%"></span></td></tr></tbody>
      </table>
    </div>
    <div class="pager hidden" id="pager"></div>
  </section>
</main>

<script>
const ME=<?php echo user_json($me); ?>;
const {esc,$,icon,api,toast}=App;
App.topbar(ME,"activity");
$("searchIc").innerHTML=icon("search");
$("refreshBtn").innerHTML=icon("refresh")+"Refresh";
$("exportBtn").innerHTML=icon("download")+"Export CSV";

// What each event is called on screen, and its badge colour.
const EV={
  product_created:["Product added","ok"], product_updated:["Product edited","info"], product_deleted:["Product deleted","danger"],
  product_imported:["Added by bulk upload","ok"], bulk_import:["Bulk upload","accent"],
  template_created:["Label template added","ok"], template_updated:["Label template edited","info"], template_deleted:["Label template deleted","danger"],
  labels_printed:["Labels printed","neutral"], labels_downloaded:["Labels downloaded","neutral"], inventory_exported:["Inventory exported","neutral"],
  login:["Signed in","ok"], logout:["Signed out","neutral"], login_failed:["Failed sign-in","danger"], login_blocked:["Sign-in blocked","danger"],
  signout_others:["Signed out other devices","neutral"], setup:["First-time setup","ok"],
  account_locked:["Account locked","danger"], user_unlocked:["Account unlocked","info"], password_changed:["Password changed","info"],
  password_reset:["Password reset by link","info"], password_set_by_admin:["Password reset by admin","warn"], reset_requested:["Password reset requested","warn"],
  reset_link_created:["Reset link created","warn"], profile_updated:["Profile updated","neutral"], mail_test:["Test email","neutral"],
  user_created:["User added","ok"], user_updated:["User updated","info"], user_deleted:["User deleted","danger"],
  role_created:["Role created","ok"], role_updated:["Role updated","info"], role_deleted:["Role deleted","danger"],
  impersonation_started:["Started viewing as","warn"], impersonation_ended:["Stopped viewing as","neutral"],
};
const evText=e=>(EV[e]||[e.replace(/_/g," "),"neutral"]);

let state={page:1,size:50,q:"",cat:"",user:"",range:"",from:"",to:""}, lastRows=[], loading=0;

/* ---------- URL <-> filters, so a filtered view can be bookmarked or shared ---------- */
function readUrl(){
  const p=new URLSearchParams(location.search);
  for(const k of ["q","cat","user","range","from","to"]) if(p.get(k)) state[k]=p.get(k);
  state.page=Math.max(1,+p.get("page")||1);
}
function writeUrl(){
  const p=new URLSearchParams();
  for(const k of ["q","cat","user","range","from","to"]) if(state[k]) p.set(k,state[k]);
  if(state.page>1) p.set("page",state.page);
  try{ history.replaceState(null,"",location.pathname+(p.toString()?"?"+p:"")); }catch(e){}
}
function iso(d){ return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function dateBounds(){
  const t=new Date();
  if(state.range==="today") return [iso(t),iso(t)];
  if(state.range==="7"||state.range==="30"){ const f=new Date(t); f.setDate(f.getDate()-(+state.range-1)); return [iso(f),iso(t)]; }
  if(state.range==="custom") return [state.from,state.to];
  return ["",""];
}
function query(extra){
  const [from,to]=dateBounds(), p=new URLSearchParams();
  if(state.q) p.set("q",state.q); if(state.cat) p.set("cat",state.cat); if(state.user) p.set("user",state.user);
  if(from) p.set("from",from); if(to) p.set("to",to);
  for(const [k,v] of Object.entries(extra||{})) p.set(k,v);
  return p.toString();
}

/* ---------- Load & render ---------- */
async function load(meta){
  const my=++loading;
  writeUrl(); syncControls();
  try{
    const d=await api("activity_list&"+query({page:state.page,size:state.size,meta:meta?1:0}));
    if(my!==loading) return;   // a newer request is on its way
    if(meta){ renderStats(d.stats); fillUsers(d.users); }
    state.page=d.page; lastRows=d.rows; renderRows(d); renderPager(d);
  }catch(e){ $("rows").innerHTML=`<tr><td colspan="6"><div class="empty-state">${icon("alert")}<b>Couldn't load the activity log</b>${esc(e.message)}</div></td></tr>`; }
}
function renderStats(s){
  s=s||{};
  const n=v=>(+v||0).toLocaleString("en-IN");
  $("stats").innerHTML=[["activity","Activities today",n(s.today),""],["users","People active today",n(s.users_today),""],
    ["box","Product changes today",n(s.stock_today),""],["lock","Failed sign-ins (24 h)",n(s.failed_24h),+s.failed_24h?"warn":""]]
    .map(([ic,k,v,c])=>`<div class="mini ${c}"><span class="ic">${icon(ic)}</span><div><div class="k">${k}</div><div class="v">${v}</div></div></div>`).join("");
}
function fillUsers(list){
  const cur=state.user;
  $("user").innerHTML=`<option value="">Everyone</option>`+(list||[]).map(u=>`<option value="${esc(u)}">${esc(u)}</option>`).join("");
  if(cur&&!(list||[]).includes(cur)) $("user").insertAdjacentHTML("beforeend",`<option value="${esc(cur)}">${esc(cur)}</option>`);
  $("user").value=cur;
}
const dayLabel=s=>{ const d=new Date(s.replace(" ","T")), t=new Date(); const y=new Date(t); y.setDate(t.getDate()-1);
  if(d.toDateString()===t.toDateString()) return "Today"; if(d.toDateString()===y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"}); };
function renderRows(d){
  if(!d.rows.length){
    const filtered=state.q||state.cat||state.user||state.range;
    $("rows").innerHTML=`<tr><td colspan="6"><div class="empty-state">${icon("activity")}<b>${filtered?"No activity matches these filters":"No activity yet"}</b>${filtered?"Try a wider date range or clear the filters.":"Changes, prints, exports and sign-ins will appear here."}</div></td></tr>`;
    return;
  }
  let lastDay="", html="";
  d.rows.forEach((r,idx)=>{
    const day=dayLabel(r.created_at);
    if(day!==lastDay){ html+=`<tr class="day-row"><td colspan="6">${esc(day)}</td></tr>`; lastDay=day; }
    const [label,cls]=evText(r.event), t=new Date(r.created_at.replace(" ","T"));
    const who=(r.username?`<span class="who"><span class="avatar">${esc(App.initials(r.username))}</span>${esc(r.username)}</span>`:`<span class="who sys">—</span>`)
      +(r.via?`<span class="via" title="A Super Admin did this while viewing the app as this person (or previewing a role)">${icon("eye")}${/^role preview/.test(r.via)?esc(r.via):"done by "+esc(r.via)}</span>`:"");
    const chg=Array.isArray(r.changes)&&r.changes.length?`<button class="chg-btn" data-chg="${idx}" aria-expanded="false">Show ${r.changes.length} change${r.changes.length===1?"":"s"}</button><div class="chg hidden" id="chg${idx}"></div>`:"";
    html+=`<tr>
      <td class="act-when" title="${esc(t.toLocaleString("en-IN"))}">${esc(t.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}))}<small>${esc(App.timeAgo(r.created_at))}</small></td>
      <td>${who}</td>
      <td><span class="badge ${cls}">${esc(label)}</span></td>
      <td class="act-target">${esc(r.target)||'<span class="muted">—</span>'}</td>
      <td class="act-detail">${esc(r.detail)}${chg}</td>
      <td class="act-ip">${esc(r.ip)}</td></tr>`;
  });
  $("rows").innerHTML=html;
}
$("rows").addEventListener("click",e=>{
  const b=e.target.closest("[data-chg]"); if(!b) return;
  const r=lastRows[+b.dataset.chg], box=$("chg"+b.dataset.chg), open=box.classList.toggle("hidden")===false;
  if(open&&!box.innerHTML) box.innerHTML=`<table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${r.changes.map(([f,a,c])=>
    `<tr><td>${esc(f)}</td><td class="old">${esc(a)||"—"}</td><td class="new">${esc(c)||"—"}</td></tr>`).join("")}</tbody></table>`;
  b.setAttribute("aria-expanded",String(open));
  b.textContent=(open?"Hide ":"Show ")+r.changes.length+" change"+(r.changes.length===1?"":"s");
});
function renderPager(d){
  const pages=Math.max(1,Math.ceil(d.total/d.size)), from=d.total?(d.page-1)*d.size+1:0, to=Math.min(d.total,d.page*d.size);
  $("pager").classList.toggle("hidden",!d.total);
  $("pager").innerHTML=`<span class="info">${from.toLocaleString("en-IN")}–${to.toLocaleString("en-IN")} of ${d.total.toLocaleString("en-IN")} activities</span>
    <nav aria-label="Pages"><button class="btn sm" data-p="${d.page-1}" ${d.page<=1?"disabled":""}>‹ Newer</button>
    <span class="muted" style="align-self:center;padding:0 8px">Page ${d.page} of ${pages}</span>
    <button class="btn sm" data-p="${d.page+1}" ${d.page>=pages?"disabled":""}>Older ›</button></nav>`;
}
$("pager").addEventListener("click",e=>{ const b=e.target.closest("[data-p]"); if(!b||b.disabled) return; state.page=+b.dataset.p; load(false); window.scrollTo({top:0,behavior:"smooth"}); });

/* ---------- Filters ---------- */
function syncControls(){
  $("q").value!==state.q&&document.activeElement!==$("q")&&($("q").value=state.q);
  $("range").value=state.range; $("from").value=state.from; $("to").value=state.to;
  $("customDates").classList.toggle("hidden",state.range!=="custom");
  document.querySelectorAll("#catTabs .tab").forEach(t=>{ const on=t.dataset.cat===state.cat; t.classList.toggle("active",on); t.setAttribute("aria-selected",String(on)); });
  $("clearBtn").classList.toggle("hidden",!(state.q||state.cat||state.user||state.range));
}
const refilter=()=>{ state.page=1; load(false); };
let qTimer; $("q").addEventListener("input",()=>{ clearTimeout(qTimer); qTimer=setTimeout(()=>{ state.q=$("q").value.trim(); refilter(); },250); });
$("user").addEventListener("change",()=>{ state.user=$("user").value; refilter(); });
$("range").addEventListener("change",()=>{ state.range=$("range").value;
  if(state.range==="custom"&&!state.from){ const t=new Date(), f=new Date(); f.setDate(t.getDate()-6); state.from=iso(f); state.to=iso(t); }
  refilter(); });
["from","to"].forEach(id=>$(id).addEventListener("change",()=>{ state[id]=$(id).value; refilter(); }));
$("catTabs").addEventListener("click",e=>{ const t=e.target.closest(".tab"); if(!t) return; state.cat=t.dataset.cat; refilter(); });
$("clearBtn").onclick=()=>{ Object.assign(state,{q:"",cat:"",user:"",range:"",from:"",to:"",page:1}); $("q").value=""; $("user").value=""; load(false); };
$("refreshBtn").onclick=()=>load(true);

/* ---------- CSV export (current filters) ---------- */
// Cells starting with = + - @ would run as formulas in Excel, so they're prefixed with '.
const csvCell=v=>{ let s=String(v??""); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; return `"${s.replace(/"/g,'""')}"`; };
$("exportBtn").onclick=async()=>{
  const b=$("exportBtn"); b.classList.add("loading");
  try{
    const d=await api("activity_export&"+query());
    const head=["Date & time","User","Done by (impersonation)","Activity","Item","Details","Changes","IP address"];
    const lines=[head,...d.rows.map(r=>[r.created_at,r.username,r.via||"",evText(r.event)[0],r.target,r.detail,
      Array.isArray(r.changes)?r.changes.map(([f,a,c])=>`${f}: ${a||"—"} → ${c||"—"}`).join("; "):"",r.ip])].map(r=>r.map(csvCell).join(","));
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv"}));
    a.download=`NFPC-activity-log-${iso(new Date())}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast(`Exported ${d.rows.length.toLocaleString("en-IN")} activities`+(d.total>d.rows.length?` (newest ${d.rows.length.toLocaleString("en-IN")} of ${d.total.toLocaleString("en-IN")})`:""),"success");
  }catch(e){ toast(e.message,"error"); }
  finally{ b.classList.remove("loading"); }
};

readUrl(); load(true);
</script>
</body>
</html>
