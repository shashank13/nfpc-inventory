/* =====================================================================
   Nitte FPC Inventory — shared page helpers
   Theme, API calls, toasts, dialogs, the top bar / user menu and password fields.
   ===================================================================== */

// Apply the saved theme before the page paints (avoids a light→dark flash).
(function(){ try{ const t=localStorage.getItem("nfpc-theme"); if(t==="dark"||t==="light") document.documentElement.dataset.theme=t; }catch(e){} })();

const App=(()=>{
  // Build version this file was loaded with (…/app.js?v=…), reused for the images it references.
  const ASSET_V=(()=>{ try{ return new URL(document.currentScript.src).searchParams.get("v")||"1"; }catch(e){ return "1"; } })();
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const $=id=>document.getElementById(id);

  const P={
    inventory:'<path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
    shield:'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
    logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    chev:'<path d="m6 9 6 6 6-6"/>',
    check:'<path d="m5 12 5 5 9-10"/>',
    x:'<path d="M18 6 6 18M6 6l12 12"/>',
    alert:'<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff:'<path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/>',
    copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    printer:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    tag:'<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    zip:'<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1zM10 12h4"/>',
    more:'<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
    edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash:'<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    key:'<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
    link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    barcode:'<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8"/>',
    box:'<path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5"/>',
    rupee:'<path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3a5 5 0 0 0 0-10"/>',
    warn:'<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    refresh:'<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    dashboard:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  };
  const icon=(n,cls="")=>`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]||""}</svg>`;
  const LEAF='<path d="M12 21V9"/><path d="M12 13c-3 0-5-2-5-5 3 0 5 2 5 5z"/><path d="M12 11c0-3 2-5 5-5 0 3-2 5-5 5z"/><path d="M12 17c-3 0-5-2-5-5 3 0 5 2 5 5z"/><path d="M12 15c0-3 2-5 5-5 0 3-2 5-5 5z"/>';

  /* ---------- API ---------- */
  // The server embeds the page's first API responses in the HTML (<script id="preload">), so the
  // page can draw without waiting for another request. Each one is used once, then fetched as usual.
  let preload=null;
  function takePreload(action){
    if(preload===null){ try{ const el=document.getElementById("preload"); preload=el?JSON.parse(el.textContent):{}; }catch(e){ preload={}; } }
    const d=preload[action]; if(d===undefined) return null;
    delete preload[action]; return d;
  }
  // `action` may carry extra GET parameters, already URL-encoded: api("activity_list&page=2&q=oil").
  async function api(action,body){
    if(body===undefined){ const d=takePreload(String(action)); if(d&&d.ok) return d; }
    let res;
    const headers={"X-Requested-With":"XMLHttpRequest"};
    const [name,...extra]=String(action).split("&");
    const url=`/api?action=${encodeURIComponent(name)}${extra.length?"&"+extra.join("&"):""}`;
    try{
      res=await fetch(url,body===undefined?{cache:"no-store",credentials:"same-origin",headers}:
        {method:"POST",credentials:"same-origin",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify(body)});
    }catch(e){ throw new Error("Can't reach the server. Check your connection and try again."); }
    if(res.status===401){ location.href="/login"; throw new Error("Please sign in."); }
    let data; try{ data=await res.json(); }catch(e){ throw new Error(`Server error (${res.status}). Please try again.`); }
    if(data.code==="must_change"){ location.href="/account"; throw new Error(data.error); }
    if(!data.ok) throw new Error(data.error||"Request failed");
    return data;
  }

  /* ---------- Toasts ---------- */
  function toast(msg,type="info",ms){
    let wrap=document.querySelector(".toasts");
    if(!wrap){ wrap=document.createElement("div"); wrap.className="toasts"; wrap.setAttribute("aria-live","polite"); wrap.setAttribute("role","status"); document.body.appendChild(wrap); }
    const t=document.createElement("div"); t.className=`toast-item ${type}`;
    t.innerHTML=(type==="success"?icon("check"):type==="error"?icon("alert"):icon("info"))+`<span>${esc(msg)}</span>`;
    wrap.appendChild(t);
    while(wrap.children.length>3) wrap.firstChild.remove();
    setTimeout(()=>{ t.classList.add("hide"); setTimeout(()=>t.remove(),250); },ms||(type==="error"?5000:2600));
  }

  /* ---------- Modals ---------- */
  let lastFocus=null;
  function openModal(el){
    if(typeof el==="string") el=$(el);
    lastFocus=document.activeElement; el.classList.add("open"); document.body.classList.add("modal-open");
    setTimeout(()=>{ const f=el.querySelector("[autofocus],input:not([type=hidden]):not([disabled]):not([readonly]),select,textarea,.btn.primary"); f&&f.focus(); },30);
  }
  function closeModal(el){
    if(typeof el==="string") el=$(el);
    el.classList.remove("open");
    if(!document.querySelector(".modal.open")) document.body.classList.remove("modal-open");
    if(lastFocus&&document.contains(lastFocus)) try{ lastFocus.focus(); }catch(e){}
  }
  // Esc closes the top-most dialog. A dialog can name its own "close" button (data-close) to run checks first.
  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape") return;
    const openMenu=document.querySelector(".menu.open"); if(openMenu){ closeMenus(); return; }
    const m=[...document.querySelectorAll(".modal.open")].pop(); if(!m) return;
    const btn=m.dataset.close&&$(m.dataset.close);
    if(btn) btn.click(); else closeModal(m);
  });
  // Keep Tab focus inside an open dialog.
  document.addEventListener("keydown",e=>{
    if(e.key!=="Tab") return;
    const m=[...document.querySelectorAll(".modal.open")].pop(); if(!m) return;
    const f=[...m.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled&&x.offsetParent!==null);
    if(!f.length) return;
    if(e.shiftKey&&document.activeElement===f[0]){ e.preventDefault(); f[f.length-1].focus(); }
    else if(!e.shiftKey&&document.activeElement===f[f.length-1]){ e.preventDefault(); f[0].focus(); }
  });

  function dialog(html,{wide=false}={}){
    const m=document.createElement("div"); m.className="modal"; m.setAttribute("role","dialog"); m.setAttribute("aria-modal","true");
    m.innerHTML=`<div class="box" style="${wide?"max-width:560px":""}">${html}</div>`;
    document.body.appendChild(m); openModal(m);
    return m;
  }
  /** Styled replacement for window.confirm(). Resolves to true / false. */
  function confirmDialog({title="Are you sure?",message="",confirmText="Confirm",cancelText="Cancel",danger=false}={}){
    return new Promise(resolve=>{
      const m=dialog(`<h3>${esc(title)}</h3>${message?`<p class="lead">${message}</p>`:""}
        <div class="actions"><button class="btn" data-r="0">${esc(cancelText)}</button><button class="btn ${danger?"danger-solid":"primary"}" data-r="1">${esc(confirmText)}</button></div>`);
      const done=v=>{ closeModal(m); m.remove(); resolve(v); };
      m.addEventListener("click",e=>{ const b=e.target.closest("[data-r]"); if(b) done(b.dataset.r==="1"); else if(e.target===m) done(false); });
      m.dataset.close=""; m.addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.stopPropagation(); done(false); } });
      setTimeout(()=>m.querySelector('[data-r="1"]').focus(),40);
    });
  }
  /** Show a value the admin must copy now (temporary password / reset link). */
  function secretDialog({title,message,value,label="Copy"}){
    const m=dialog(`<h3>${esc(title)}</h3><p class="lead">${message}</p>
      <div class="secret"><input readonly value="${esc(value)}" aria-label="${esc(title)}"><button class="btn primary" data-copy>${icon("copy")}${esc(label)}</button></div>
      <div class="alert warn" style="margin:14px 0 0">${icon("warn")}<div>This is shown only once. Share it privately with the user (in person or by phone).</div></div>
      <div class="actions"><button class="btn" data-done>Done</button></div>`,{wide:true});
    const inp=m.querySelector("input");
    m.querySelector("[data-copy]").onclick=async()=>{ inp.select(); try{ await navigator.clipboard.writeText(value); }catch(e){ document.execCommand("copy"); } toast("Copied to clipboard","success"); };
    const close=()=>{ closeModal(m); m.remove(); };
    m.querySelector("[data-done]").onclick=close;
    m.addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.stopPropagation(); close(); } });
    setTimeout(()=>inp.select(),40);
  }

  /* ---------- Dropdown menus ---------- */
  function closeMenus(except){
    document.querySelectorAll(".menu.open").forEach(m=>{ if(m!==except){ m.classList.remove("open","fixed"); m.style.cssText="";
      const b=m.parentElement.querySelector("[aria-expanded]"); b&&b.setAttribute("aria-expanded","false"); } });
  }
  /**
   * Menus inside a scrolling table would be cut off by the table's edge, so they're placed relative to the
   * screen instead (position: fixed), below the button, or above it when there isn't room below.
   */
  function placeMenu(menu,trigger){
    const b=trigger.getBoundingClientRect();
    if(menu.closest(".table-wrap")){
      menu.classList.add("fixed");
      const w=menu.offsetWidth, h=menu.offsetHeight;
      const below=innerHeight-b.bottom, up=below<h+12&&b.top>below;
      menu.style.top=(up?Math.max(8,b.top-h-6):Math.min(b.bottom+6,innerHeight-h-8))+"px";
      menu.style.left=Math.max(8,Math.min(b.right-w,innerWidth-w-8))+"px";
    } else {
      const r=menu.getBoundingClientRect();
      menu.classList.toggle("up",r.bottom>innerHeight-8&&r.height<b.top);
    }
  }
  document.addEventListener("click",e=>{
    const trigger=e.target.closest("[data-menu]");
    if(trigger){
      const menu=trigger.parentElement.querySelector(".menu"); const open=!menu.classList.contains("open");
      closeMenus(menu); menu.classList.toggle("open",open); trigger.setAttribute("aria-expanded",String(open));
      if(open) placeMenu(menu,trigger);
      else { menu.classList.remove("fixed"); menu.style.cssText=""; }
      return;
    }
    if(!e.target.closest(".menu")||e.target.closest(".menu-item")) closeMenus();
  });
  // A screen-positioned menu would drift away from its button when the page scrolls, so close it instead.
  addEventListener("scroll",e=>{ if(document.querySelector(".menu.open.fixed")&&!(e.target.closest&&e.target.closest(".menu"))) closeMenus(); },true);
  addEventListener("resize",()=>closeMenus());

  /* ---------- Theme ---------- */
  const isDark=()=>{ const r=document.documentElement; return r.dataset.theme?r.dataset.theme==="dark":matchMedia("(prefers-color-scheme: dark)").matches; };
  function toggleTheme(){
    const t=isDark()?"light":"dark"; document.documentElement.dataset.theme=t;
    try{ localStorage.setItem("nfpc-theme",t); }catch(e){}
    document.querySelectorAll("[data-theme-icon]").forEach(el=>el.innerHTML=icon(t==="dark"?"sun":"moon"));
  }

  /* ---------- Top bar ---------- */
  const initials=s=>String(s||"?").trim().split(/[\s._@-]+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"?";
  async function signOut(){
    let r=null; try{ r=await api("logout",{}); }catch(e){}
    location.href=r&&r.returned?"/users":"/login?bye=1";   // while impersonating, "sign out" returns to your own account
  }
  async function stopImpersonating(){
    try{ await api("impersonate_stop",{}); }catch(e){}
    location.href="/users";
  }
  /** Banner shown on every page while a Super Admin is viewing as someone else. */
  function impersonationBar(user){
    const imp=user.impersonation; if(!imp) return "";
    const mins=Math.max(1,Math.ceil(imp.secondsLeft/60));
    const what=imp.mode==="role"
      ?`Previewing the <b>${esc(imp.roleName)}</b> role. You only have this role's permissions; your actions are recorded as you.`
      :`Viewing as <b>${esc(user.name)}</b> (@${esc(user.username)} · ${esc(imp.roleName)}). Actions are recorded as them, done by you.`;
    return `<div class="imp-bar" role="status">${icon("eye")}<span>${what} <span class="imp-time" data-left="${imp.secondsLeft}">Ends in ${mins} min.</span></span>
      <button class="btn sm" data-act="imp-stop">Return to my account</button></div>`;
  }

  /** Render the app's top navigation bar into #topbar. `active` = "inventory" | "users" | "account". */
  function topbar(user,active){
    const el=$("topbar"); if(!el||!user) return;
    const nav=[["dashboard","/dashboard","Dashboard","dashboard"],["inventory","/inventory","Inventory","inventory"]];
    if(user.isSuper||(user.perms||[]).includes("activity.view")) nav.push(["activity","/activity","Activity","activity"]);
    if(user.isSuper) nav.push(["users","/users","Users & roles","users"]);
    const restricted=user.mustChange, imp=user.impersonation;
    el.className="topbar"+(imp?" impersonating":"");
    el.innerHTML=impersonationBar(user)+`<div class="topbar-in">
      <a class="tb-brand" href="/dashboard" aria-label="Nitte FPC Inventory home">
        <img class="tb-logo-img" src="/assets/logo-128.png?v=${ASSET_V}" alt="" width="40" height="40">
        <span><span class="tb-title">Nitte FPC</span><span class="tb-sub">Inventory &amp; labels</span></span>
      </a>
      ${restricted?"":`<nav class="tb-nav" aria-label="Main">${nav.map(([k,href,label,ic])=>`<a href="${href}" class="${k===active?"active":""}" ${k===active?'aria-current="page"':""} title="${label}">${icon(ic)}<span>${label}</span></a>`).join("")}</nav>`}
      <div class="tb-right">
        <button class="btn icon ghost" id="tbTheme" title="Switch light / dark theme" aria-label="Switch light / dark theme"><span data-theme-icon style="display:contents">${icon(isDark()?"sun":"moon")}</span></button>
        <div class="dd">
          <button class="user-btn" data-menu aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">
            <span class="avatar">${esc(initials(user.name))}</span>
            <span class="user-meta"><b>${esc(user.name)}</b><small>${esc(user.role)}</small></span>${icon("chev","chev")}
          </button>
          <div class="menu" role="menu">
            <div class="menu-head"><span class="avatar lg">${esc(initials(user.name))}</span><div><b>${esc(user.name)}</b><small>${esc(user.email||"@"+user.username)}</small>
              <span class="badge ${user.isSuper?"accent":"neutral"}" style="margin-top:4px">${user.isSuper?icon("shield"):""}${esc(user.role)}</span></div></div>
            <div class="menu-sep"></div>
            ${restricted?"":`<a class="menu-item" role="menuitem" href="/account">${icon("settings")}Account settings</a>`}
            ${user.isSuper&&!restricted?`<a class="menu-item" role="menuitem" href="/users">${icon("users")}Users &amp; roles</a>`:""}
            <button class="menu-item" role="menuitem" data-act="theme">${icon("moon")}Switch theme</button>
            <div class="menu-sep"></div>
            ${imp?`<button class="menu-item" role="menuitem" data-act="imp-stop">${icon("user")}Return to my account</button>`
                 :`<button class="menu-item danger" role="menuitem" data-act="signout">${icon("logout")}Sign out</button>`}
          </div>
        </div>
      </div></div>`;
    $("tbTheme").onclick=toggleTheme;
    el.querySelectorAll('[data-act="imp-stop"]').forEach(b=>b.onclick=stopImpersonating);
    if(user.notice) setTimeout(()=>toast(`You're back on your own account. ${user.notice}`,"info",7000),300);
    // Count down the remaining time; when it runs out the server ends it, so reload to show your own account.
    const left=el.querySelector(".imp-time");
    if(left){ const end=Date.now()+(+left.dataset.left)*1000; clearInterval(topbar._t);
      topbar._t=setInterval(()=>{ const s=Math.round((end-Date.now())/1000);
        if(s<=0){ clearInterval(topbar._t); location.reload(); return; }
        left.textContent=s<60?`Ends in ${s} s.`:`Ends in ${Math.ceil(s/60)} min.`; },15000); }
    el.querySelector('[data-act="theme"]').onclick=toggleTheme;
    const so=el.querySelector('[data-act="signout"]'); if(so) so.onclick=signOut;   // absent while impersonating
  }

  /* ---------- Password fields ---------- */
  // <button class="pw-toggle"> next to a password input shows / hides it.
  document.addEventListener("click",e=>{
    const b=e.target.closest(".pw-toggle"); if(!b) return;
    const inp=b.parentElement.querySelector("input"); const show=inp.type==="password";
    inp.type=show?"text":"password"; b.innerHTML=icon(show?"eyeOff":"eye"); b.setAttribute("aria-label",show?"Hide password":"Show password");
    b.setAttribute("aria-pressed",String(show)); inp.focus();
  });
  // Caps Lock warning for inputs with data-caps="<id of warning element>".
  document.addEventListener("keyup",e=>{
    const t=e.target; if(!t.dataset||!t.dataset.caps||!e.getModifierState) return;
    const w=$(t.dataset.caps); w&&w.classList.toggle("show",e.getModifierState("CapsLock"));
  });

  const passwordRules=[["len","At least 8 characters",p=>p.length>=8],["letter","Contains a letter",p=>/[A-Za-z]/.test(p)],["num","Contains a number",p=>/\d/.test(p)]];
  function scorePassword(p){
    if(!p) return 0;
    let s=0; if(p.length>=8) s++; if(p.length>=12) s++;
    if(/[a-z]/.test(p)&&/[A-Z]/.test(p)) s++; if(/\d/.test(p)&&/[^A-Za-z0-9]/.test(p)) s++;
    if(!passwordRules.every(r=>r[2](p))) s=Math.min(s,1);
    return Math.max(1,Math.min(4,s));
  }
  /** Wire a strength meter + rules checklist to a new-password input (and optional confirm input). */
  function passwordMeter(input,{meter,label,rules,confirm,match}={}){
    const words=["","Weak","Fair","Good","Strong"];
    if(rules) rules.innerHTML=passwordRules.map(r=>`<li data-k="${r[0]}">${r[1]}</li>`).join("");
    const upd=()=>{
      const p=input.value, s=scorePassword(p);
      if(meter){ meter.dataset.score=String(p?s:0); }
      if(label) label.textContent=p?`Strength: ${words[s]}`:"";
      if(rules) passwordRules.forEach(r=>rules.querySelector(`[data-k="${r[0]}"]`).classList.toggle("ok",r[2](p)));
      if(confirm&&match){ const c=confirm.value; match.textContent=c&&c!==p?"Passwords don't match.":""; confirm.setAttribute("aria-invalid",String(!!c&&c!==p)); }
    };
    input.addEventListener("input",upd); confirm&&confirm.addEventListener("input",upd); upd();
  }

  /** Disable a form's submit button and show a spinner while it submits (server-rendered forms). */
  document.addEventListener("submit",e=>{
    const f=e.target; if(f.dataset.noBusy!==undefined) return;
    setTimeout(()=>{ if(e.defaultPrevented) return; const b=f.querySelector('button[type=submit]'); if(b){ b.classList.add("loading"); b.setAttribute("aria-busy","true"); } },0);
  });

  const fmtDateTime=s=>{ if(!s) return "—"; const d=new Date(String(s).replace(" ","T")); return isNaN(d)?s:d.toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); };
  function timeAgo(s){
    if(!s) return "Never"; const d=new Date(String(s).replace(" ","T")); if(isNaN(d)) return s;
    const sec=Math.round((Date.now()-d)/1000);
    if(sec<60) return "Just now"; if(sec<3600) return `${Math.floor(sec/60)} min ago`; if(sec<86400) return `${Math.floor(sec/3600)} h ago`;
    if(sec<86400*30) return `${Math.floor(sec/86400)} d ago`; return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
  }

  return {esc,$,icon,api,toast,openModal,closeModal,dialog,confirm:confirmDialog,secretDialog,closeMenus,toggleTheme,isDark,topbar,
    initials,signOut,passwordMeter,scorePassword,fmtDateTime,timeAgo,LEAF};
})();
