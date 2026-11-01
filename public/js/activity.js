/* Activity page — carried over from the PHP version (URLs updated). */
const ME=JSON.parse(document.getElementById("me-data").textContent);
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
  sku_format_updated:["SKU format changed","info"],
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
