/* Inventory page — carried over from the PHP version (URLs updated). */
/* ================= Company settings ================= */

/* Label text, logo and layout are managed in "Label templates" (stored in the database).
   This built-in template is used only for missing values or if no template exists yet. */
const DEFAULT_TPL = {
  brand:"NITTE FARMERS PRODUCER COMPANY LTD.", tagline:"", logoMode:"default", logo:"", logoAspect:1,
  color:"#2f7d32", header:"band", mrpText:"MRP (incl. of all taxes)",
  address:"NMAMIT Campus, Nitte, Karkala Tq., Udupi Dist., Karnataka – 574110", cin:"U01110KA2021PTC149385",
  fssai:"", contact:"", note:"", perRow:3,
  // Printing: "roll" = barcode / thermal label printer (one label per printed page, exact size);
  // "sheet" = normal printer, several labels per A4 page (perRow).
  media:"roll", labelW:100, labelH:75, across:1, gapX:2, mono:true, layout:"full",
  show:{net:true,batch:true,packed:true,best:true,grade:true,source:true,mrp:true,barcodeText:true,footer:true}
};

/* Category: code (used in SKU), colour, default shelf life (days), default unit, suggestions */
const CATS = {
  "Grains & Pulses":       {code:"GRP", color:"#c98a12", life:180, unit:"kg", hints:["Red Rice (Kajé Akki)","Raw Rice","Ragi","Foxtail Millet","Little Millet","Toor Dal","Green Gram","Black Gram (Urad)","Horse Gram","Cowpea"]},
  "Oils & Oilseeds":       {code:"OIL", color:"#e0b400", life:270, unit:"L",  hints:["Cold-pressed Coconut Oil","Groundnut Oil","Sesame Oil","Sunflower Oil","Groundnut (Raw)","Sesame Seeds"]},
  "Spices & Plantation":   {code:"SPC", color:"#8b4a2b", life:365, unit:"g",  hints:["Black Pepper","Cardamom","Turmeric Powder","Dry Ginger","Coffee Powder","Cashew Nuts W320"]},
  "Processed Products":    {code:"PRC", color:"#b8456b", life:120, unit:"g",  hints:["Banana Chips","Jackfruit Chips","Jackfruit Papad","Mango Pickle","Mango Pulp","Ragi Flour","Rice Flour","Jaggery","Wild Honey"]},
  "Fresh Produce":         {code:"FRS", color:"#2f9d4a", life:7,   unit:"kg", hints:["Tender Coconut","Coconut (Dehusked)","Arecanut (Chali)","Banana (Nendran)","Brinjal (Mattu Gulla)","Cucumber","Pineapple","Jackfruit"]},
  "Others":                {code:"OTH", color:"#6b7a8f", life:180, unit:"pcs",hints:["Vermicompost","Seeds Kit","Coir Products"]}
};

/* ================= Code 128 (Set B) encoder ================= */
const C128=["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
function encode128B(text){
  if(!text) throw new Error("Barcode value is empty");
  const codes=[104];
  for(const ch of text){
    const c=ch.charCodeAt(0);
    if(c<32||c>126) throw new Error(`Unsupported character "${ch}" (use English letters, digits, - or /)`);
    codes.push(c-32);
  }
  let sum=codes[0]; for(let i=1;i<codes.length;i++) sum+=codes[i]*i;
  codes.push(sum%103,106);
  return codes.map(c=>C128[c]).join("");
}
function barcodeSVG(text,{module=2,height=70,showText=true,quiet=10,attrs=""}={}){
  const widths=encode128B(text);
  let x=quiet*module, rects="", bar=true;
  for(const w of widths){ const px=+w*module; if(bar) rects+=`<rect x="${x}" y="0" width="${px}" height="${height}"/>`; x+=px; bar=!bar; }
  const total=x+quiet*module, th=showText?18:0;
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs||`width="${total}" height="${height+th}"`} viewBox="0 0 ${total} ${height+th}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">${rects}</g>`+
    (showText?`<text x="${total/2}" y="${height+14}" text-anchor="middle" font-family="Consolas,monospace" font-size="13" fill="#000">${esc(text)}</text>`:"")+`</svg>`;
}

/* ================= Helpers & state ================= */
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const inr=n=>"₹"+Number(n).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2});
const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const addDays=(s,n)=>{const d=new Date(s+"T00:00:00"); d.setDate(d.getDate()+n); return iso(d);};
const today=()=>iso(new Date());
const daysLeft=s=>Math.round((new Date(s+"T00:00:00")-new Date(today()+"T00:00:00"))/86400000);
const fmtDate=s=>s?new Date(s+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):"—";
const LOW=10, EXP_WARN=15;
let items=[], editingId=null, currentLabel=null, catFilter="", bestTouched=false;
// The stock list is loaded one page at a time from the server (search, filters and paging happen there).
// items = the products on the current page; total = how many match the filters; stats = whole-inventory figures.
let total=0, stats={products:0,units:0,value:0,low:0,exp:0,byCat:{}};
const knownSkus=new Set();   // SKUs seen or generated in this session (so a new random SKU doesn't repeat them)
let templates=[];   // [{id,name,isDefault,settings}] from the database

function ym(){ const d=new Date(); return String(d.getFullYear()).slice(2)+String(d.getMonth()+1).padStart(2,"0"); }
/* ================= SKU (barcode value) =================
   New SKUs come from the SKU format (gear button next to the SKU field). They're made on the server,
   so running numbers never repeat. In the form the SKU is filled in automatically and stays editable:
   typing your own makes it "custom"; Generate goes back to an automatic one. */
let SKU={format:"{PREFIX}-{CAT}-{RAND:5}",prefix:"NFPC",auto:true}, canEditSku=false;
let skuAuto=false, skuSeq=0;   // skuAuto: the field holds an automatic SKU; skuSeq: ignore stale answers
const skuUsesName=()=>/\{NAME/i.test(SKU.format);
async function fetchNextSku(){
  const p=new URLSearchParams({cat:$("fCat").value,name:$("fName").value.trim()});
  if(editingId) p.set("exclude",editingId);
  return (await api("sku_next&"+p.toString())).sku;
}
/** Fill the SKU field from the format. force: also replace a SKU typed by hand (the Generate button). */
async function autoSku(force){
  if(!force&&!skuAuto) return;
  const my=++skuSeq; skuAuto=true; updateSkuHint(true);
  try{
    const s=await fetchNextSku();
    if(my!==skuSeq||!skuAuto) return;   // a newer request, or the user started typing
    $("fSku").value=s; updatePreview();
  }catch(err){ if(my===skuSeq) $("err").textContent=err.message; }
  finally{ if(my===skuSeq) updateSkuHint(); }
}
function updateSkuHint(loading){
  const v=$("fSku").value.trim();
  $("skuHint").textContent=loading?"Making a SKU from the SKU format…"
    :skuAuto?"Automatic, from the SKU format. Type here to use your own."
    :v?(editingId?"Click Generate to replace it with a new automatic SKU.":"Your own SKU. Click Generate to go back to an automatic one.")
    :"Leave blank and one is made from the SKU format when you save.";
}
let autoSkuTimer;
function autoSkuSoon(){ clearTimeout(autoSkuTimer); autoSkuTimer=setTimeout(()=>{ if(skuAuto&&skuUsesName()) autoSku(); },300); }
function genBatch(){ return `B${ym()}-${String(Math.floor(Math.random()*999)+1).padStart(3,"0")}`; }

/* ================= Database (PostgreSQL via /api) ================= */
const api=App.api;   // shared helper in assets/app.js (redirects to sign-in when the session ends)
const safeColor=c=>/^#[0-9a-f]{3,8}$/i.test(c||"")?c:"#6b7a8f";

/* ================= Signed-in user & permissions ================= */
let USER=null;
const can=p=>!!USER&&(USER.isSuper||USER.perms.includes(p));
function applyPermissions(){
  $("openBulk").classList.toggle("hidden",!can("products.import"));
  $("openTpl").classList.toggle("hidden",!can("templates.manage"));
  $("openZip").classList.toggle("hidden",!can("labels.print"));
  $("printAll").classList.toggle("hidden",!can("labels.print"));
  $("exportCsv").classList.toggle("hidden",!can("reports.export"));
  $("exportDd").classList.toggle("hidden",!can("labels.print")&&!can("reports.export"));
  $("skuFmtBtn").classList.toggle("hidden",!canEditSku);
  updateFormVisibility();
}
// "Add product" button for people allowed to add; editing opens the same window from the stock list.
function updateFormVisibility(){
  $("addProductBtn").classList.toggle("hidden",!can("products.create"));
}
function showBanners(data){
  const b=[];
  if(USER&&USER.isSuper&&data.pendingResets>0){
    b.push(`<div class="alert warn banner">${App.icon("key")}<div><b>${data.pendingResets} password reset request${data.pendingResets===1?" is":"s are"} waiting.</b>
      <a href="/users#resets">Review requests</a></div></div>`);
  }
  if(USER&&!["products.create","products.edit","products.delete","products.import"].some(can)){
    b.push(`<div class="alert info banner">${App.icon("info")}<div>You have <b>view-only</b> access (${esc(USER.role)}). Ask a Super Admin if you need to add or change products.</div></div>`);
  }
  $("banners").innerHTML=b.join("");
}

async function load(){
  const data=await api("list");
  USER=data.user; USER.notice=data.notice; App.topbar(USER,"inventory"); showBanners(data);
  if(data.categories.length){
    const merged={};
    for(const c of data.categories) merged[c.name]={code:c.code,color:safeColor(c.color),life:c.life,unit:c.unit,hints:(CATS[c.name]||{}).hints||[]};
    if(!merged.Others) merged.Others=CATS.Others;
    for(const k of Object.keys(CATS)) delete CATS[k];
    Object.assign(CATS,merged);
  }
  setPage(data.inventory);
  templates=data.templates||[];
  if(data.sku) SKU=data.sku;
  canEditSku=!!data.canEditSku;
}

/* ================= Rendering ================= */
function stockBadge(q){
  if(q<=0) return `<span class="badge out">Out</span>`;
  if(q<LOW) return `<span class="badge low">${q} low</span>`;
  return `<span class="badge ok">${q}</span>`;
}
function expBadge(best){
  const d=daysLeft(best);
  if(d<0) return `<span class="badge out">Expired</span><div class="meta">${fmtDate(best)}</div>`;
  if(d<=EXP_WARN) return `<span class="badge low">${d} day${d===1?"":"s"} left</span><div class="meta">${fmtDate(best)}</div>`;
  return `<span class="meta" style="color:var(--text)">${fmtDate(best)}</span>`;
}
function renderChips(){
  const counts=stats.byCat||{};
  $("chips").innerHTML=[`<button class="chip ${!catFilter?"active":""}" data-cat="">All <b>${stats.products}</b></button>`,
    ...Object.keys(CATS).map(c=>`<button class="chip ${catFilter===c?"active":""}" data-cat="${esc(c)}"><span class="catdot" style="background:${CATS[c].color}"></span>${esc(c)} <b>${counts[c]||0}</b></button>`)].join("");
}
/* ================= Performance helpers =================
   Large inventories stay fast because:
   - only one page of products is loaded and drawn at a time; search, filters and counts run on the server,
   - each barcode thumbnail is built once and reused,
   - typing in search waits for a short pause before asking the server. */
const thumbCache=new Map();           // SKU -> barcode thumbnail SVG
function barcodeThumb(sku){
  let s=thumbCache.get(sku);
  if(s===undefined){
    try{ s=barcodeSVG(sku,{module:1,height:32,showText:false,quiet:4}); }catch(e){ s=`<span class="meta">Invalid barcode</span>`; }
    if(thumbCache.size>5000) thumbCache.clear();   // keep memory bounded
    thumbCache.set(sku,s);
  }
  return s;
}
const debounce=(fn,ms)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

/** The products shown on this page (the server has already applied the search and filters). */
function visibleItems(){ return items; }
const filtersActive=()=>!!($("search").value.trim()||$("filterStatus").value||catFilter);
/** Current search / category / status as URL parameters for the API. */
function filterQuery(){
  const p=new URLSearchParams(), q=$("search").value.trim(), st=$("filterStatus").value;
  if(q) p.set("q",q); if(catFilter) p.set("cat",catFilter); if(st) p.set("status",st);
  return p.toString();
}
/** Every product matching the current filters (only for print-all / export / ZIP, on request). */
async function allMatching(useFilter=true){
  const q=useFilter?filterQuery():"";
  return (await api("items&"+(q?q+"&":"")+"all=1")).rows;
}
function setPage(d){
  if(!d) return;
  items=d.rows||[]; total=d.total||0; page=d.page||1;
  if(d.stats) stats=d.stats;
  for(const i of items) knownSkus.add(i.sku);
}
/** Load the current page from the server. focus: SKU to jump to and highlight; stats: refresh the summary figures. */
let reqSeq=0;
async function refresh(opts={}){
  const my=++reqSeq, p=new URLSearchParams(filterQuery());
  p.set("page",page); p.set("size",pageSize);
  if(opts.focus) p.set("focus",opts.focus);
  if(opts.stats) p.set("stats","1");
  $("invTable").setAttribute("aria-busy","true");
  try{
    const d=await api("items&"+p.toString());
    if(my!==reqSeq) return;   // a newer request is on its way
    setPage(d); render(opts.focus);
  }catch(err){ if(my===reqSeq) toast(err.message,"error"); }
  finally{ if(my===reqSeq) $("invTable").removeAttribute("aria-busy"); }
}
/** The selected products' details (fetched when some are on other pages). */
async function selectedItems(){
  const ids=[...selected], here=items.filter(i=>selected.has(i.id));
  if(here.length===ids.length) return here;
  return (await api("items_lookup",{ids})).rows;
}

/* ================= Paging ================= */
const PAGE_SIZES=[25,50,100,200];
let page=1, pageSize=50;
try{ const s=+localStorage.getItem("nfpc-page-size"); if(PAGE_SIZES.includes(s)) pageSize=s; }catch(e){}
function pageCount(n){ return Math.max(1,Math.ceil(n/pageSize)); }
function renderPager(total){
  const pages=pageCount(total), from=total?(page-1)*pageSize+1:0, to=Math.min(total,page*pageSize);
  // Page numbers: first, last, and two either side of the current page, with gaps as "…".
  const nums=[]; for(let p=1;p<=pages;p++) if(p===1||p===pages||Math.abs(p-page)<=2) nums.push(p);
  const btns=[]; nums.forEach((p,k)=>{ if(k&&p-nums[k-1]>1) btns.push(`<span class="pg-gap">…</span>`);
    btns.push(`<button class="btn sm pg-num ${p===page?"on":""}" data-page="${p}" ${p===page?'aria-current="page"':""} aria-label="Page ${p}">${p}</button>`); });
  $("pager").innerHTML=total?`
    <div class="pg-size"><label for="pgSize">Rows per page</label>
      <select id="pgSize">${PAGE_SIZES.map(s=>`<option ${s===pageSize?"selected":""}>${s}</option>`).join("")}</select></div>
    <span class="pg-info">${from.toLocaleString("en-IN")}–${to.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}</span>
    <nav class="pg-nav" aria-label="Pages">
      <button class="btn sm icon" data-page="${page-1}" ${page<=1?"disabled":""} aria-label="Previous page">‹</button>
      ${btns.join("")}
      <button class="btn sm icon" data-page="${page+1}" ${page>=pages?"disabled":""} aria-label="Next page">›</button>
    </nav>`:"";
  $("pager").classList.toggle("hidden",total<=PAGE_SIZES[0]&&page===1);
}
function goToPage(p){
  page=p;
  refresh().then(()=>{ const top=$("invTable").getBoundingClientRect().top;
    if(top<70||top>innerHeight) $("invTitle").scrollIntoView({behavior:"smooth",block:"start"}); });
}

/* ================= Multi-select (bulk delete / print) ================= */
// Selection is limited to products matching the current search/filter (it's cleared when the filter changes),
// so a hidden product is never deleted by accident.
// The header checkbox selects the current page; "Select all N matching" selects every page.
const selected=new Set();
let canSel=false;
function updateBulkBar(pageRows){
  pageRows=pageRows||[];
  const n=selected.size, all=total>0&&n>=total;
  const pageSel=pageRows.filter(i=>selected.has(i.id)).length, pageAll=pageRows.length>0&&pageSel===pageRows.length;
  $("bulkBar").classList.toggle("hidden",!canSel||n===0);
  $("selCount").textContent=`${n.toLocaleString("en-IN")} selected`+(n&&!all&&total>pageRows.length&&pageAll&&n===pageRows.length?" on this page":"");
  $("selAllItems").classList.toggle("hidden",all||total===0);
  $("selAllItems").textContent=`Select all ${total.toLocaleString("en-IN")} matching`;
  $("selPrint").classList.toggle("hidden",!can("labels.print"));
  $("selDelete").classList.toggle("hidden",!can("products.delete"));
  const sa=$("selAll"); sa.checked=pageAll; sa.indeterminate=pageSel>0&&!pageAll; sa.disabled=!pageRows.length;
}
let pageRowsNow=[];
function setSelected(ids,on){ ids.forEach(id=>on?selected.add(id):selected.delete(id)); render(); }
$("selAll").addEventListener("change",e=>setSelected(pageRowsNow.map(i=>i.id),e.target.checked));
$("selAllItems").onclick=async()=>{ const b=$("selAllItems"); b.classList.add("loading");
  try{ setSelected((await api("items&"+filterQuery()+"&ids=1")).ids,true); }catch(err){ toast(err.message,"error"); }
  finally{ b.classList.remove("loading"); } };
$("selClear").onclick=()=>{ selected.clear(); render(); };
$("selPrint").onclick=async()=>{ try{ const l=await selectedItems(); if(l.length) printLabels(l,undefined,`${l.length} selected products`); }catch(err){ toast(err.message,"error"); } };
// Shift+click a checkbox to select a range.
let lastSelIdx=null;
$("tbody").addEventListener("click",e=>{
  const cb=e.target.closest("[data-sel]"); if(!cb) return;
  const rows=[...$("tbody").querySelectorAll("tr[data-id]")], idx=rows.indexOf(cb.closest("tr"));
  const ids=e.shiftKey&&lastSelIdx!==null?rows.slice(Math.min(idx,lastSelIdx),Math.max(idx,lastSelIdx)+1).map(r=>r.dataset.id):[rows[idx].dataset.id];
  lastSelIdx=idx; setSelected(ids,cb.checked);
});
$("selDelete").onclick=async()=>{
  let list; try{ list=await selectedItems(); }catch(err){ toast(err.message,"error"); return; }
  if(!list.length) return;
  const n=list.length, big=n>=20, units=list.reduce((a,i)=>a+ +i.qty,0);
  const names=list.slice(0,6).map(i=>`<li>${esc(i.name)} <span class="muted">· ${esc(i.net)} ${esc(i.unit)} · ${esc(i.sku)}</span></li>`).join("")+(n>6?`<li class="muted">…and ${n-6} more</li>`:"");
  const ok=await new Promise(resolve=>{
    const m=App.dialog(`<h3>Delete ${n} product${n===1?"":"s"}?</h3>
      <p class="lead">${units?`They hold <b>${units.toLocaleString("en-IN")}</b> packs in stock. `:""}This removes them from the inventory and can't be undone. The stock history keeps a record.</p>
      <ul style="margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.7">${names}</ul>
      ${big?`<label for="delConfirm">Type <b>DELETE</b> to confirm</label><input id="delConfirm" autocomplete="off" spellcheck="false">`:""}
      <div class="actions"><button class="btn" data-r="0">Cancel</button><button class="btn danger-solid" data-r="1" ${big?"disabled":""}>Delete ${n} product${n===1?"":"s"}</button></div>`,{wide:true});
    const done=v=>{ App.closeModal(m); m.remove(); resolve(v); };
    const go=m.querySelector('[data-r="1"]'), inp=m.querySelector("#delConfirm");
    if(inp) inp.addEventListener("input",()=>go.disabled=inp.value.trim().toUpperCase()!=="DELETE");
    m.addEventListener("click",e=>{ const b=e.target.closest("[data-r]"); if(b&&!b.disabled) done(b.dataset.r==="1"); else if(e.target===m) done(false); });
    m.addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.stopPropagation(); done(false); } if(e.key==="Enter"&&inp&&!go.disabled) done(true); });
    setTimeout(()=>(inp||go).focus(),40);
  });
  if(!ok) return;
  const btn=$("selDelete"); btn.classList.add("loading");
  try{
    const r=await api("delete_many",{ids:list.map(i=>i.id)});
    const gone=new Set(r.deleted.concat(r.missing?list.map(i=>i.id):[]));
    selected.clear();
    if(editingId&&gone.has(editingId)) resetForm();
    refresh({stats:true}); toast(`${r.deleted.length} product${r.deleted.length===1?"":"s"} deleted`,"success");
  }catch(err){ toast(err.message,"error"); }
  finally{ btn.classList.remove("loading"); }
};

function render(highlightSku){
  // The server returns one page (and has already jumped to the page holding a just-saved / scanned product).
  canSel=can("products.delete")||can("labels.print");
  $("selTh").classList.toggle("hidden",!canSel);
  const rows=items;
  pageRowsNow=rows;
  $("tbody").innerHTML=rows.length?rows.map(i=>`
    <tr data-id="${esc(i.id)}" class="${i.sku===highlightSku?"hit":""}${selected.has(i.id)?" selected":""}">
      ${canSel?`<td class="sel"><input type="checkbox" data-sel ${selected.has(i.id)?"checked":""} aria-label="Select ${esc(i.name)}"></td>`:""}
      <td class="c-prod"><div class="pname">${esc(i.name)} <span class="meta">· ${esc(i.net)} ${esc(i.unit)}</span></div>
          <div class="meta"><span class="catdot" style="background:${(CATS[i.cat]||CATS.Others).color}"></span>${esc(i.cat)}${i.grade?" · "+esc(i.grade):""}</div>
          <div class="meta">${i.source?"From "+esc(i.source):""}${i.loc?" · "+esc(i.loc):""}</div></td>
      <td class="c-bar"><span class="thumb">${barcodeThumb(i.sku)}</span><div class="mono meta">${esc(i.sku)}</div></td>
      <td class="mono meta batch-cell c-batch">${esc(i.batch)}<br>Pkd ${fmtDate(i.packed)}</td>
      <td class="nw c-mrp">${inr(i.price)}</td>
      <td class="c-stock">${stockBadge(i.qty)}</td>
      <td class="c-best">${expBadge(i.best)}</td>
      <td class="c-act"><div class="row-actions">
        ${can("labels.print")?`<button class="btn sm" data-act="label">${App.icon("tag")}Label</button>`:""}
        ${can("products.edit")?`<button class="btn sm icon" data-act="edit" title="Edit" aria-label="Edit ${esc(i.name)}">${App.icon("edit")}</button>`:""}
        ${can("products.delete")?`<button class="btn sm danger icon" data-act="del" title="Delete" aria-label="Delete ${esc(i.name)}">${App.icon("trash")}</button>`:""}
      </div></td>
    </tr>`).join(""):`<tr><td colspan="${canSel?8:7}">${stats.products
      ?`<div class="empty-state">${App.icon("search")}<b>No products match</b>Try a different search, category or stock filter.</div>`
      :`<div class="empty-state">${App.icon("box")}<b>No products yet</b>${can("products.create")?"Click Add product (or press N) to add your first batch"+(can("products.import")?", or use Bulk upload for many at once.":"."):"Products added by your team will appear here."}</div>`}</td></tr>`;
  const all=stats.products;
  $("invCount").textContent=!filtersActive()?`${all.toLocaleString("en-IN")} batch${all===1?"":"es"}`
    :`${total.toLocaleString("en-IN")} of ${all.toLocaleString("en-IN")} match`;
  updateBulkBar(rows);
  renderPager(total);

  // Summary cards: whole-inventory figures calculated by the server.
  $("sProducts").textContent=stats.products.toLocaleString("en-IN"); $("sUnits").textContent=stats.units.toLocaleString("en-IN");
  $("sValue").textContent=inr(stats.value); $("sLow").textContent=stats.low.toLocaleString("en-IN"); $("sExp").textContent=stats.exp.toLocaleString("en-IN");
  renderChips();
}
function labelHTML(i,tpl){
  const s=normTpl(tpl);
  return s.media==="roll"
    ?`<div class="lbl roll" style="aspect-ratio:${s.labelW}/${s.labelH}">${labelSVG(i,s)}</div>`
    :`<div class="lbl">${labelSVG(i,s)}</div>`;
}

/* ================= Form ================= */
function fillCatSelect(){
  $("fCat").innerHTML=Object.keys(CATS).map(c=>`<option>${esc(c)}</option>`).join("");
  updateHints();
}
function updateHints(){ $("nameHints").innerHTML=(CATS[$("fCat").value]||CATS.Others).hints.map(h=>`<option value="${esc(h)}">`).join(""); }
function autoBest(){ if(bestTouched||!$("fPacked").value) return; $("fBest").value=addDays($("fPacked").value,(CATS[$("fCat").value]||CATS.Others).life); }
function updatePreview(){
  const v=$("fSku").value.trim(); $("err").textContent="";
  if(!v){ $("preview").innerHTML=`<span class="empty">Barcode preview appears here</span>`; return; }
  try{ $("preview").innerHTML=barcodeSVG(v); }catch(e){ $("err").textContent=e.message; $("preview").innerHTML=`<span class="empty">Invalid barcode value</span>`; }
}
function resetForm(){
  $("form").reset(); editingId=null; bestTouched=false;
  $("formTitle").textContent="Add product"; $("saveBtn").textContent="Save product";
  $("formSub").textContent="Fill in the details. Batch number, best-before date and barcode are filled in for you.";
  document.querySelector(".product-box").classList.remove("editing");
  $("saveAnother").classList.remove("hidden"); $("resetBtn").classList.remove("hidden");
  $("fUnit").value=CATS[$("fCat").value].unit; $("fPacked").value=today(); autoBest(); updateHints();
  skuAuto=false; skuSeq++; updatePreview(); updateSkuHint();
}

/* ---------- Add / edit product window ---------- */
const FORM_IDS=["fName","fCat","fGrade","fNet","fUnit","fQty","fPrice","fLoc","fSource","fBatch","fPacked","fBest","fSku"];
let formSnapshot="";
const formState=()=>FORM_IDS.map(id=>id==="fSku"&&skuAuto?"":$(id).value).join("\u0001");
function openProductForm(it){
  if(it){
    if(!can("products.edit")) return;
    resetForm(); editingId=it.id; bestTouched=true;
    $("fName").value=it.name; $("fCat").value=it.cat; $("fGrade").value=it.grade||""; $("fNet").value=it.net; $("fUnit").value=it.unit;
    $("fQty").value=it.qty; $("fPrice").value=it.price; $("fLoc").value=it.loc||""; $("fBatch").value=it.batch; $("fSource").value=it.source||"";
    $("fPacked").value=it.packed; $("fBest").value=it.best; $("fSku").value=it.sku;
    $("formTitle").textContent=`Edit ${it.name}`; $("saveBtn").textContent="Update product";
    $("formSub").textContent=`${it.net} ${it.unit} · batch ${it.batch} · SKU ${it.sku}`;
    document.querySelector(".product-box").classList.add("editing");
    $("saveAnother").classList.add("hidden"); $("resetBtn").classList.add("hidden");
    updateHints(); updatePreview(); updateSkuHint();
  } else {
    if(!can("products.create")) return;
    if(editingId||!$("productModal").classList.contains("open")) resetForm();
    if(SKU.auto&&!$("fSku").value.trim()) autoSku(true);
  }
  formSnapshot=formState();
  App.openModal("productModal");
  setTimeout(()=>{ $("fName").focus(); if(it) $("fName").select(); },40);
}
async function closeProductForm(force){
  if(!force&&formState()!==formSnapshot&&!await App.confirm({title:"Discard your changes?",message:"What you've typed in this product hasn't been saved.",confirmText:"Discard",cancelText:"Keep editing",danger:true})) return;
  App.closeModal("productModal"); resetForm();
}
$("addProductBtn").onclick=()=>openProductForm();
$("pmClose").onclick=()=>closeProductForm();
$("productModal").addEventListener("mousedown",e=>{ if(e.target.id==="productModal") closeProductForm(); });
$("productModal").addEventListener("keydown",e=>{ if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); $("saveBtn").click(); } });
// Press N anywhere on the page (when not typing) to add a product.
document.addEventListener("keydown",e=>{
  if(e.key.toLowerCase()!=="n"||e.ctrlKey||e.metaKey||e.altKey||/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)||document.querySelector(".modal.open")) return;
  if(can("products.create")){ e.preventDefault(); openProductForm(); }
});
// After "Save & add another", keep the fields that usually repeat between batches.
function keepForNext(){
  const keep={fCat:$("fCat").value,fUnit:$("fUnit").value,fLoc:$("fLoc").value,fSource:$("fSource").value,fPacked:$("fPacked").value,fBest:$("fBest").value};
  const touched=bestTouched;
  resetForm();
  for(const [k,v] of Object.entries(keep)) $(k).value=v;
  bestTouched=touched; updateHints(); updatePreview();
  if(SKU.auto) autoSku(true);
  formSnapshot=formState();
  $("fName").focus();
}
$("fCat").addEventListener("change",()=>{ updateHints(); if(!editingId) $("fUnit").value=CATS[$("fCat").value].unit; autoBest();
  if(skuAuto) autoSku(); });   // automatic SKUs follow the category
$("fPacked").addEventListener("change",autoBest);
$("fBest").addEventListener("input",()=>bestTouched=true);
$("genSku").onclick=()=>autoSku(true);
$("fSku").addEventListener("input",()=>{ skuAuto=false; skuSeq++; updatePreview(); updateSkuHint(); });   // typed by hand: keep it
$("fName").addEventListener("input",autoSkuSoon);   // formats with {NAME} follow the product name
$("resetBtn").onclick=()=>{ resetForm(); if(SKU.auto) autoSku(true); };

$("form").addEventListener("submit",async e=>{
  e.preventDefault();
  const another=e.submitter&&e.submitter.id==="saveAnother"&&!editingId;
  const rec={name:$("fName").value.trim(),cat:$("fCat").value,grade:$("fGrade").value.trim(),
    net:parseFloat($("fNet").value)||0,unit:$("fUnit").value,qty:parseInt($("fQty").value)||0,
    price:parseFloat($("fPrice").value)||0,loc:$("fLoc").value.trim(),batch:$("fBatch").value.trim()||genBatch(),
    source:$("fSource").value.trim(),packed:$("fPacked").value,best:$("fBest").value,sku:$("fSku").value.trim(),
    skuAuto:skuAuto||!$("fSku").value.trim()};
  if(rec.best<rec.packed){ $("err").textContent="Best-before date can't be earlier than packed date."; return; }
  if(rec.sku){
    try{ encode128B(rec.sku); }catch(err){ $("err").textContent=err.message; return; }
    if(!rec.skuAuto&&items.some(i=>i.sku===rec.sku&&i.id!==editingId)){ $("err").textContent="This SKU already exists — generate a new one."; return; }
  }
  const btn=another?$("saveAnother"):$("saveBtn");
  $("saveBtn").disabled=$("saveAnother").disabled=true; btn.classList.add("loading");
  try{
    const {item}=await api("save",editingId?{id:editingId,...rec}:rec);
    if(editingId) toast(`${item.name} updated`,"success");
    else toast(`${item.name} (${item.net} ${item.unit}) added`,"success");
    knownSkus.add(item.sku);
    refresh({focus:item.sku,stats:true});
    if(another) keepForNext();
    else { App.closeModal("productModal"); resetForm(); }
  }catch(err){ $("err").textContent=err.message; }
  finally{ $("saveBtn").disabled=$("saveAnother").disabled=false; btn.classList.remove("loading"); }
});

/* ---------- SKU format settings (managers) ---------- */
const SKU_PRESETS=[...document.querySelectorAll("#skPreset option")].map(o=>o.value).filter(v=>v!=="custom");
function openSkuSettings(){
  $("skAuto").checked=SKU.auto; $("skPrefix").value=SKU.prefix; $("skFormat").value=SKU.format;
  $("skPreset").value=SKU_PRESETS.includes(SKU.format)?SKU.format:"custom";
  $("skErr").textContent=""; $("skExample").textContent="…"; skuExample(); App.openModal("skuModal");
}
// Live example of the next SKU (made by the server, so running numbers are real).
const skuExample=debounce(async()=>{
  const cat=$("fCat").value||Object.keys(CATS)[0], name=$("fName").value.trim()||"Red Rice";
  const p=new URLSearchParams({format:$("skFormat").value.trim(),prefix:$("skPrefix").value.trim(),cat,name});
  $("skExampleFor").textContent=`(for ${name} · ${cat})`;
  try{ $("skExample").textContent=(await api("sku_next&"+p.toString())).sku; $("skErr").textContent=""; }
  catch(err){ $("skExample").textContent="—"; $("skErr").textContent=err.message; }
},250);
$("skuFmtBtn").onclick=openSkuSettings;
$("skPreset").onchange=()=>{ if($("skPreset").value!=="custom") $("skFormat").value=$("skPreset").value; else $("skFormat").focus(); skuExample(); };
$("skFormat").addEventListener("input",()=>{ const f=$("skFormat").value.trim(); $("skPreset").value=SKU_PRESETS.includes(f)?f:"custom"; skuExample(); });
$("skPrefix").addEventListener("input",skuExample);
$("skTokens").addEventListener("click",e=>{
  const b=e.target.closest("[data-tok]"); if(!b) return;
  const f=$("skFormat"), st=f.selectionStart??f.value.length, en=f.selectionEnd??st;
  f.value=f.value.slice(0,st)+b.dataset.tok+f.value.slice(en); f.focus(); f.selectionStart=f.selectionEnd=st+b.dataset.tok.length;
  f.dispatchEvent(new Event("input"));
});
$("skCancel").onclick=()=>App.closeModal("skuModal");
$("skuModal").addEventListener("mousedown",e=>{ if(e.target.id==="skuModal") App.closeModal("skuModal"); });
$("skSave").onclick=async()=>{
  const b=$("skSave"); b.classList.add("loading");
  try{
    const r=await api("sku_settings_save",{format:$("skFormat").value.trim(),prefix:$("skPrefix").value.trim(),auto:$("skAuto").checked});
    SKU=r.sku; App.closeModal("skuModal"); toast("SKU format saved","success");
    // A new product being added picks up the new format straight away.
    if($("productModal").classList.contains("open")&&!editingId&&(skuAuto||!$("fSku").value.trim())&&SKU.auto) autoSku(true);
    else updateSkuHint();
  }catch(err){ $("skErr").textContent=err.message; }
  finally{ b.classList.remove("loading"); }
};

/* ================= Table, scan, labels ================= */
const toast=(m,type)=>App.toast(m,type);
$("chips").addEventListener("click",e=>{ const c=e.target.closest(".chip"); if(!c) return; catFilter=c.dataset.cat; page=1; selected.clear(); refresh(); });
// Wait for a short pause in typing before filtering (keeps typing smooth with thousands of products).
const searchNow=debounce(()=>{ page=1; selected.clear(); refresh(); },120);
$("search").addEventListener("input",searchNow);
$("filterStatus").addEventListener("change",()=>{ page=1; selected.clear(); refresh(); });
$("pager").addEventListener("click",e=>{ const b=e.target.closest("[data-page]"); if(b&&!b.disabled) goToPage(+b.dataset.page); });
$("pager").addEventListener("change",e=>{ if(e.target.id!=="pgSize") return;
  const first=(page-1)*pageSize; pageSize=+e.target.value; page=Math.floor(first/pageSize)+1;
  try{ localStorage.setItem("nfpc-page-size",String(pageSize)); }catch(err){} refresh(); });

$("tbody").addEventListener("click",e=>{
  const btn=e.target.closest("button"); if(!btn) return;
  const id=btn.closest("tr").dataset.id, it=items.find(i=>i.id===id);
  if(btn.dataset.act==="label") openLabel(it);
  if(btn.dataset.act==="edit") openProductForm(it);
  if(btn.dataset.act==="del"){
    App.confirm({title:`Delete "${it.name}"?`,danger:true,confirmText:"Delete product",
      message:`Batch <b>${esc(it.batch)}</b> · SKU <span class="mono">${esc(it.sku)}</span> · ${it.qty} in stock.<br>It's removed from the inventory; the stock history keeps a record.`})
    .then(ok=>{ if(!ok) return;
      api("delete",{id}).then(()=>{ selected.delete(id); if(editingId===id) resetForm(); refresh({stats:true}); toast("Product deleted","success"); })
        .catch(err=>toast(err.message,"error")); });
  }
});

$("scanInput").addEventListener("keydown",async e=>{
  if(e.key!=="Enter") return;
  const input=e.target, v=input.value.trim(); if(!v) return;
  input.value="";
  $("search").value=""; $("filterStatus").value=""; catFilter=""; page=1; selected.clear();
  let it=null;
  try{ it=(await api("items_lookup",{skus:[v]})).rows[0]||null; }catch(err){ toast(err.message,"error"); return; }
  if(it){ await refresh({focus:it.sku}); const d=daysLeft(it.best);
    toast(`${it.name} ${it.net}${it.unit} · ${it.qty} in stock · ${d<0?"EXPIRED":d+" days to expiry"}`);
    document.querySelector("tr.hit")?.scrollIntoView({behavior:"smooth",block:"center"}); }
  else if(can("products.create")){ refresh(); toast("New barcode — fill in the product details"); resetForm(); openProductForm(); skuAuto=false; skuSeq++; $("fSku").value=v; updatePreview(); updateSkuHint(); formSnapshot=formState(); }
  else{ refresh(); toast("No product with that barcode","error"); }
});

function showLabel(){ const s=tplSettings($("lTpl").value); $("labelHolder").innerHTML=labelHTML(currentLabel,s); $("lPrintInfo").innerHTML=printInfo(currentLabel,s); }
function openLabel(it){ currentLabel=it; fillTplSelect($("lTpl"),$("lTpl").value); showLabel(); $("copies").value=1; $("modal").classList.add("open"); }
$("lTpl").onchange=showLabel;
$("dlLabelSvg").onclick=()=>{ logLabelDownload("Label SVG"); download(new Blob([labelSVG(currentLabel,tplSettings($("lTpl").value))],{type:"image/svg+xml"}),safe(`${currentLabel.sku}_label`)+".svg"); };
$("dlLabelPng").onclick=()=>svgToPng(labelSVG(currentLabel,tplSettings($("lTpl").value)),3)
  .then(b=>{ download(b,safe(`${currentLabel.sku}_label`)+".png"); logLabelDownload("Label PNG"); }).catch(e=>toast(e.message,"error"));
$("closeModal").onclick=()=>$("modal").classList.remove("open");
$("modal").addEventListener("click",e=>{ if(e.target.id==="modal") $("modal").classList.remove("open"); });

function download(blob,name){ const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
$("dlSvg").onclick=()=>{ logLabelDownload("Barcode SVG"); download(new Blob([barcodeSVG(currentLabel.sku,{module:3,height:90})],{type:"image/svg+xml"}),`${currentLabel.sku}.svg`); };
$("dlPng").onclick=()=>{
  logLabelDownload("Barcode PNG");
  const url=URL.createObjectURL(new Blob([barcodeSVG(currentLabel.sku,{module:3,height:90})],{type:"image/svg+xml"}));
  const img=new Image();
  img.onload=()=>{ const c=document.createElement("canvas"); c.width=img.width*2; c.height=img.height*2;
    const x=c.getContext("2d"); x.imageSmoothingEnabled=false; x.drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
    c.toBlob(b=>download(b,`${currentLabel.sku}.png`)); };
  img.src=url;
};
/* Printing, downloads and exports happen in the browser, so they report themselves to the activity log. */
function track(event,target,detail){ api("log_event",{event,target,detail}).catch(()=>{}); }
const productRef=i=>`${i.name} · ${i.net} ${i.unit} · ${i.sku}`;
const tplName=id=>{ const t=templates.find(x=>x.id===id)||defaultTemplate(); return t?t.name:"Built-in"; };
function logLabelDownload(kind){ track("labels_downloaded",productRef(currentLabel),`${kind} · template ${tplName($("lTpl").value)}`); }
function describeFilter(){ const q=$("search").value.trim(), st=$("filterStatus"); return [catFilter&&`category ${catFilter}`, st.value&&st.options[st.selectedIndex].text, q&&`search "${q}"`].filter(Boolean).join(", ")||"no filter"; }
/** Page size for printing (an @page rule that only applies to the printout). */
function setPrintPage(css){
  let el=document.getElementById("printPageStyle");
  if(!el){ el=document.createElement("style"); el.id="printPageStyle"; el.media="print"; document.head.appendChild(el); }
  el.textContent=css;
}
function printLabels(list,tplId,target,detail){
  const s=tplSettings(tplId);
  const products=new Set(list.map(i=>i.id)).size;
  track("labels_printed",target||(products===1?productRef(list[0]):`${products} products`),`${list.length} label${list.length===1?"":"s"} · template ${tplName(tplId)}`+(detail?` · ${detail}`:""));
  const pa=$("printArea");
  if(s.media==="roll"){
    // Barcode / label printer: each printed page is one row of labels at the exact label size, no margins,
    // so the printer advances exactly one label (or one row of a 2- / 3-across roll) per page.
    const n=s.across, gap=n>1?s.gapX:0, pageW=+(s.labelW*n+gap*(n-1)).toFixed(2), H=s.labelH;
    setPrintPage(`@page{size:${pageW}mm ${H}mm;margin:0}`);
    pa.className="roll"; pa.style.removeProperty("--per");
    const rows=[]; for(let k=0;k<list.length;k+=n) rows.push(list.slice(k,k+n));
    // A hair under the page height so rounding never spills into an extra blank label.
    const h=`${(H-0.3).toFixed(2)}mm`;
    pa.innerHTML=rows.map(r=>`<div class="roll-page" style="width:${pageW}mm;height:${h};gap:${gap}mm">${
      r.map(i=>`<div class="roll-lbl" style="width:${s.labelW}mm;height:${h}">${labelSVG(i,s)}</div>`).join("")}</div>`).join("");
  } else {
    setPrintPage("");
    pa.className=""; pa.style.setProperty("--per",s.perRow);
    pa.innerHTML=list.map(i=>labelHTML(i,s)).join("");
  }
  window.print();
}
$("printOne").onclick=()=>{ const n=Math.max(1,Math.min(60,parseInt($("copies").value)||1)); printLabels(Array(n).fill(currentLabel),$("lTpl").value,productRef(currentLabel),`${n} cop${n===1?"y":"ies"}`); };
$("printAll").onclick=async()=>{ let l; try{ l=await allMatching(); }catch(err){ toast(err.message,"error"); return; }
  l.length?printLabels(l,undefined,`${l.length} products`,`Print all matching (${describeFilter()})`):toast("No products to print"); };   // uses the default template

$("exportCsv").onclick=async()=>{
  let items; try{ items=await allMatching(false); }catch(err){ toast(err.message,"error"); return; }   // the whole inventory, fetched on request
  const head=["SKU","Product","Category","Grade","Pack size","Unit","Packs in stock","MRP","Stock value","Batch","Packed on","Best before","Sourced from","Location"];
  const rows=items.map(i=>[i.sku,i.name,i.cat,i.grade,i.net,i.unit,i.qty,i.price,i.qty*i.price,i.batch,i.packed,i.best,i.source,i.loc]);
  download(new Blob(["\ufeff"+toCSV([head,...rows])],{type:"text/csv"}),`NFPC-inventory-${today()}.csv`);
  track("inventory_exported",`${rows.length} products`,"Inventory CSV");
};

/* ================= Shared helpers ================= */
// Text starting with = + - @ (or tab/CR) would run as a formula in Excel, so prefix it with '.
const csvCell=v=>{ let s=String(v??""); if(typeof v!=="number"&&/^[=+\-@\t\r]/.test(s)) s="'"+s; return `"${s.replace(/"/g,'""')}"`; };
const toCSV=rows=>rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
const safe=s=>String(s).replace(/[\\/:*?"<>|]+/g,"-").replace(/\s+/g," ").trim().slice(0,90);
const trunc=(s,n)=>{s=String(s??""); return s.length>n?s.slice(0,n-1)+"…":s;};
const norm=s=>String(s??"").toLowerCase().replace(/[^a-z0-9]/g,"");
const UNITS=["kg","g","L","ml","pcs","dozen","bunch"];
const TEMPLATE_HEAD=["SKU","Product","Category","Grade","Pack size","Unit","Packs in stock","MRP","Batch","Packed on","Best before","Sourced from","Location"];

/* ================= Bulk upload ================= */
const COLS={
  sku:["sku","barcode","code","skubarcode"], name:["product","productname","name","item","itemname"],
  cat:["category","cat"], grade:["grade","variety","varietygrade"], net:["packsize","size","netqty","net","weight","quantityperpack"],
  unit:["unit","uom","units"], qty:["packsinstock","qty","quantity","stock","instock"], price:["mrp","price","mrpperpack","rate","sellingprice"],
  batch:["batch","lot","batchno","lotno","batchlotno","batchlot"], packed:["packedon","packed","harvestedon","packeddate","mfgdate","dateofpacking"],
  best:["bestbefore","expiry","expirydate","bestbeforedate","expiresOn".toLowerCase()], source:["sourcedfrom","source","farmer","village","farmervillage"],
  loc:["location","storagelocation","storage","godown"]
};
const CAT_KW={"Grains & Pulses":["grain","pulse","dal","rice","millet","cereal","ragi","gram"],"Oils & Oilseeds":["oil","seed"],
  "Spices & Plantation":["spice","plantation","pepper","coffee","cashew","cardamom"],"Processed Products":["process","pickle","chips","honey","jaggery","flour","pulp"],
  "Fresh Produce":["fresh","vegetable","fruit","produce","coconut","arecanut"],"Others":["other","misc"]};
function matchCat(v){
  const n=norm(v); if(!n) return null;
  for(const [c,o] of Object.entries(CATS)) if(norm(c)===n||norm(o.code)===n) return c;
  for(const [c,ks] of Object.entries(CAT_KW)) if(CATS[c]&&ks.some(k=>n.includes(k))) return c;
  return null;
}
function mkDate(y,mo,d){ if(mo<1||mo>12||d<1||d>31) return null; const dt=new Date(Date.UTC(y,mo-1,d)); return dt.getUTCDate()===d?dt.toISOString().slice(0,10):null; }
function parseDate(v){
  if(v===""||v==null) return "";
  const s=String(v).trim(); if(!s) return "";
  if(/^\d{5}(\.\d+)?$/.test(s)){ const n=+s; if(n>20000&&n<80000) return new Date(Date.UTC(1899,11,30)+Math.round(n)*86400000).toISOString().slice(0,10); }
  let m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/); if(m) return mkDate(+m[1],+m[2],+m[3]);
  m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/); if(m){ let y=+m[3]; if(y<100) y+=2000; return mkDate(y,+m[2],+m[1]); }
  m=s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s,]*(\d{4}|\d{2})$/);
  if(m){ const mi=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[2].slice(0,3).toLowerCase()); let y=+m[3]; if(y<100) y+=2000; if(mi>=0) return mkDate(y,mi+1,+m[1]); }
  return null;
}
function toNum(v){ if(typeof v==="number") return v; const s=String(v??"").replace(/[₹,\s]|rs\.?/gi,""); return s===""?NaN:Number(s); }
function parseCSV(text,forceDelim){   // forceDelim: e.g. "\t" for cells copied from Excel
  text=text.replace(/^\ufeff/,"");
  const first=text.split(/\r?\n/)[0], cnt=ch=>first.split(ch).length;
  const delim=forceDelim||(cnt("\t")>cnt(",")?"\t":(cnt(";")>cnt(",")?";":","));
  const rows=[]; let row=[],f="",q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else if(c==='"') q=true;
    else if(c===delim){ row.push(f); f=""; }
    else if(c==="\n"){ row.push(f); rows.push(row); row=[]; f=""; }
    else if(c!=="\r") f+=c;
  }
  if(f!==""||row.length){ row.push(f); rows.push(row); }
  return rows.filter(r=>r.some(v=>String(v).trim()!==""));
}
/** Existing products for the SKUs in an uploaded file (looked up on the server), keyed by lower-case SKU. */
async function existingForRows(rows){
  const head=(rows[0]||[]).map(norm), k=head.findIndex(h=>COLS.sku.includes(h));
  const skus=k<0?[]:[...new Set(rows.slice(1).map(r=>String(r[k]??"").trim()).filter(Boolean))];
  if(!skus.length) return new Map();
  const found=(await api("items_lookup",{skus})).rows;
  return new Map(found.map(i=>[i.sku.toLowerCase(),i]));
}
function buildRecords(rows,existing){
  if(rows.length<2) throw new Error("The file has no data rows.");
  const head=rows[0].map(norm), idx={};
  for(const [k,al] of Object.entries(COLS)){ const i=head.findIndex(h=>al.includes(h)); if(i>=0) idx[k]=i; }
  if(idx.name==null) throw new Error('Couldn\'t find a "Product" column. Download the template to see the expected headings.');
  if(idx.price==null) throw new Error('Couldn\'t find an "MRP" column. Download the template to see the expected headings.');
  const seen=new Set();
  return rows.slice(1).map((r,n)=>{
    const g=k=>idx[k]==null?"":(r[idx[k]]??""), gs=k=>String(g(k)).trim();
    const errs=[], warns=[];
    const name=gs("name"); if(!name) errs.push("Product name missing");
    let cat=matchCat(gs("cat")); if(!cat){ warns.push(gs("cat")?`Category "${gs("cat")}" → Others`:"No category → Others"); cat="Others"; }
    const price=toNum(g("price")); if(!(price>=0)) errs.push("Invalid MRP");
    let net=toNum(g("net")); if(isNaN(net)) net=1; else if(net<=0) errs.push("Invalid pack size");
    let qty=toNum(g("qty")); if(isNaN(qty)) qty=0; if(qty<0) errs.push("Negative stock"); qty=Math.round(qty);
    const rawUnit=gs("unit"), um=UNITS.find(u=>u.toLowerCase()===rawUnit.toLowerCase()||(u==="L"&&/^(l|ltr|litre|liter)s?$/i.test(rawUnit))||(u==="pcs"&&/^(pc|piece|nos?)s?$/i.test(rawUnit)));
    let unit=um||CATS[cat].unit; if(rawUnit&&!um) warns.push(`Unit "${rawUnit}" → ${unit}`);
    let packed=parseDate(g("packed")); if(packed===null){ errs.push("Packed date not understood"); packed=""; } if(!packed) packed=today();
    let best=parseDate(g("best")); if(best===null){ errs.push("Best-before date not understood"); best=""; }
    if(!best){ best=addDays(packed,CATS[cat].life); warns.push("Best before auto-set"); }
    if(best<packed) errs.push("Best before is earlier than packed");
    const sku=gs("sku"); let action="new";
    if(sku){
      try{ encode128B(sku); }catch(e){ errs.push("SKU has unsupported characters"); }
      if(seen.has(sku.toLowerCase())) errs.push("SKU repeated in file");
      seen.add(sku.toLowerCase());
      if(existing.has(sku.toLowerCase())) action="update";
    }
    const rec={name,cat,grade:gs("grade"),net,unit,qty,price,loc:gs("loc"),batch:gs("batch"),source:gs("source"),packed,best,sku};
    if(action==="update"){
      // Blank cells keep the existing product's value instead of resetting it to a default.
      const ex=existing.get(sku.toLowerCase()), given=k=>gs(k)!=="";
      for(const k of ["cat","grade","net","unit","qty","loc","batch","source","packed"]) if(!given(k)) rec[k]=ex[k];
      if(!given("best")&&!given("packed")) rec.best=ex.best;
      if(!given("unit")&&given("cat")) rec.unit=ex.unit;
      rec.sku=ex.sku;
      const w=warns.filter(x=>!/^No category|auto-set$/.test(x)); warns.length=0; warns.push(...w);
      const k=errs.indexOf("Best before is earlier than packed"); if(k>=0) errs.splice(k,1); // re-check with merged dates
      if(rec.best<rec.packed) errs.push("Best before is earlier than packed");
    }
    return {line:n+2,errs,warns,action,rec};
  });
}
let bulkRows=[];
function renderBulk(){
  const upd=$("bulkUpdate").checked;
  const ok=bulkRows.filter(r=>!r.errs.length), nNew=ok.filter(r=>r.action==="new").length, nUpd=ok.filter(r=>r.action==="update").length;
  const nErr=bulkRows.length-ok.length, nWarn=ok.filter(r=>r.warns.length).length;
  $("bulkSummary").innerHTML=`<span class="badge ok">${nNew} new</span><span class="badge info">${nUpd} ${upd?"to update":"existing (will skip)"}</span>`+
    `<span class="badge out">${nErr} with errors (skipped)</span>${nWarn?`<span class="badge low">${nWarn} with notes</span>`:""}`;
  $("bulkPrevWrap").style.display="";
  $("bulkBody").innerHTML=bulkRows.slice(0,500).map(r=>{const x=r.rec;
    const st=r.errs.length?`<span class="badge out">Error</span>`:r.action==="update"?`<span class="badge info">${upd?"Update":"Skip"}</span>`:`<span class="badge ok">New</span>`;
    return `<tr><td>${r.line}</td><td>${st}</td><td>${esc(x.name)||"—"}</td><td>${esc(x.cat)}</td><td>${esc(x.net)} ${esc(x.unit)}</td><td>${x.qty}</td><td>${isNaN(x.price)?"—":inr(x.price)}</td>
      <td>${fmtDate(x.packed)}</td><td>${fmtDate(x.best)}</td><td class="mono">${esc(x.sku)||'<span class="notes">auto</span>'}</td>
      <td class="notes">${r.errs.map(e=>`<div class="e">${esc(e)}</div>`).join("")}${r.warns.map(w=>`<div>${esc(w)}</div>`).join("")}</td></tr>`;}).join("")+
    (bulkRows.length>500?`<tr><td colspan="11" class="notes">…and ${bulkRows.length-500} more rows</td></tr>`:"");
  $("bulkImport").disabled=!(nNew+(upd?nUpd:0));
  $("bulkImport").textContent=`Import ${nNew+(upd?nUpd:0)} product${nNew+(upd?nUpd:0)===1?"":"s"}`;
}
function loadXLSX(){
  if(window.XLSX) return Promise.resolve();
  return new Promise((res,rej)=>{ const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.integrity="sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==";
    s.crossOrigin="anonymous"; s.referrerPolicy="no-referrer"; s.onload=res;
    s.onerror=()=>rej(new Error("Couldn't load the Excel reader (it needs an internet connection). Save the sheet as CSV and upload that instead."));
    document.head.appendChild(s); });
}
async function handleFile(f){
  if(!f) return;
  $("fileName").textContent=`${f.name} · ${(f.size/1024).toFixed(1)} KB`;
  $("bulkSummary").innerHTML=`<span class="notes">Reading file…</span>`; $("bulkPrevWrap").style.display="none"; $("bulkImport").disabled=true; bulkRows=[];
  try{
    let rows;
    if(/\.xlsx?$/i.test(f.name)){
      await loadXLSX();
      const wb=XLSX.read(await f.arrayBuffer(),{type:"array"});
      rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:true,defval:""}).filter(r=>r.some(v=>String(v).trim()!==""));
    } else rows=parseCSV(await f.text());
    bulkRows=buildRecords(rows,await existingForRows(rows)); renderBulk();
  }catch(e){ $("bulkSummary").innerHTML=`<div class="err">${esc(e.message)}</div>`; }
}
$("openBulk").onclick=()=>{ bulkRows=[]; $("bulkFile").value=""; $("fileName").textContent=""; clearBulkPreview();
  $("bulkImport").textContent="Import"; pasteData=[]; renderPasteGrid(); setBulkMode("file"); $("bulkModal").classList.add("open"); };
$("bulkCancel").onclick=()=>$("bulkModal").classList.remove("open");
$("pickFile").onclick=()=>$("bulkFile").click();
$("bulkFile").addEventListener("change",e=>handleFile(e.target.files[0]));
$("bulkUpdate").addEventListener("change",()=>bulkRows.length&&renderBulk());

/* ---------- Bulk upload: paste from Excel ----------
   Excel copies cells as tab-separated text. Pasting into the grid fills its rows and columns; with a
   heading row, each column goes to the matching grid column (by name), otherwise values fill in from
   the clicked cell. Rows are checked as you go, exactly like an uploaded file. */
const FIELD_COL={sku:0,name:1,cat:2,grade:3,net:4,unit:5,qty:6,price:7,batch:8,packed:9,best:10,source:11,loc:12};   // COLS key -> TEMPLATE_HEAD column
const PASTE_SHOW=200;   // rows drawn as editable cells; further pasted rows are kept and imported
const MAX_BULK=5000;    // rows per import (the server's limit)
let pasteData=[], bulkMode="file", pasteSeq=0;
const emptyPasteRow=()=>TEMPLATE_HEAD.map(()=>"");
const filledPasteRows=()=>pasteData.map((r,i)=>({r,i})).filter(x=>x.r.some(v=>String(v).trim()!==""));
function clearBulkPreview(){ $("bulkSummary").innerHTML=""; $("bulkPrevWrap").style.display="none"; $("bulkImport").disabled=true; }
function setBulkMode(m){
  bulkMode=m;
  $("bulkMode").querySelectorAll("button").forEach(b=>{ const on=b.dataset.m===m; b.classList.toggle("on",on); b.setAttribute("aria-selected",String(on)); });
  $("filePanel").classList.toggle("hidden",m!=="file"); $("pastePanel").classList.toggle("hidden",m!=="paste");
  bulkRows=[]; clearBulkPreview();
  if(m==="paste"){ checkPaste(); setTimeout(()=>$("pasteGrid").querySelector("input")?.focus(),40); }
  else{ $("bulkFile").value=""; $("fileName").textContent=""; }
}
$("bulkMode").addEventListener("click",e=>{ const b=e.target.closest("button[data-m]"); if(b&&b.dataset.m!==bulkMode) setBulkMode(b.dataset.m); });
function renderPasteGrid(){
  while(pasteData.length<10) pasteData.push(emptyPasteRow());
  const req=new Set(["Product","MRP"]);
  $("pasteGrid").tHead.innerHTML=`<tr><th></th>${TEMPLATE_HEAD.map(h=>`<th>${esc(h)}${req.has(h)?'<span class="req">*</span>':""}</th>`).join("")}</tr>`;
  $("pasteGrid").tBodies[0].innerHTML=pasteData.slice(0,PASTE_SHOW).map((row,r)=>`<tr data-r="${r}"><td class="rn">${r+1}</td>${
    row.map((v,c)=>`<td><input data-r="${r}" data-c="${c}" value="${esc(v)}" autocomplete="off" spellcheck="false" aria-label="Row ${r+1}, ${esc(TEMPLATE_HEAD[c])}"></td>`).join("")}</tr>`).join("");
  updatePasteCount();
}
function updatePasteCount(){
  const n=filledPasteRows().length;
  $("pasteCount").textContent=(n?`${n.toLocaleString("en-IN")} row${n===1?"":"s"} with data`:"No rows yet")+
    (pasteData.length>PASTE_SHOW?` · showing the first ${PASTE_SHOW} of ${pasteData.length.toLocaleString("en-IN")} rows (all are imported)`:"");
}
/** Check the grid's rows (same rules as a file) and show the preview. */
const checkPaste=debounce(async()=>{
  const my=++pasteSeq, filled=filledPasteRows();
  updatePasteCount();
  if(!filled.length){ bulkRows=[]; clearBulkPreview(); return; }
  const table=[TEMPLATE_HEAD,...filled.map(x=>x.r)];
  try{
    const existing=await existingForRows(table);
    if(my!==pasteSeq||bulkMode!=="paste") return;
    bulkRows=buildRecords(table,existing);
    bulkRows.forEach((b,k)=>b.line=filled[k].i+1);   // "Row" = the grid's row number
    renderBulk();
    const bad=new Set(bulkRows.filter(b=>b.errs.length).map(b=>b.line-1));
    $("pasteGrid").querySelectorAll("tbody tr").forEach(tr=>tr.classList.toggle("bad",bad.has(+tr.dataset.r)));
  }catch(err){ if(my===pasteSeq) $("bulkSummary").innerHTML=`<div class="err">${esc(err.message)}</div>`; }
},300);
$("pasteGrid").addEventListener("input",e=>{
  const i=e.target.closest("input[data-r]"); if(!i) return;
  pasteData[+i.dataset.r][+i.dataset.c]=i.value; checkPaste();
});
$("pasteGrid").addEventListener("paste",e=>{
  const i=e.target.closest("input[data-r]"); if(!i) return;
  const text=(e.clipboardData||window.clipboardData).getData("text/plain")||"";
  if(!/[\t\r\n]/.test(text.replace(/[\r\n]+$/,""))) return;   // a single value: normal paste into the cell
  e.preventDefault();
  let rows=parseCSV(text,"\t"); if(!rows.length) return;
  let r0=+i.dataset.r, c0=+i.dataset.c, colMap=null;
  // A heading row decides where each column goes (so the sheet's column order doesn't matter).
  const map=rows[0].map(h=>{ const n=norm(h); for(const [k,al] of Object.entries(COLS)) if(al.includes(n)) return FIELD_COL[k]; return -1; });
  if(map.filter(x=>x>=0).length>=2){ colMap=map; rows=rows.slice(1); }
  if(r0+rows.length>MAX_BULK){ rows=rows.slice(0,Math.max(0,MAX_BULK-r0)); toast(`Only the first ${MAX_BULK.toLocaleString("en-IN")} rows can be imported at once.`,"error"); }
  while(pasteData.length<r0+rows.length) pasteData.push(emptyPasteRow());
  rows.forEach((row,k)=>row.forEach((v,j)=>{ const c=colMap?colMap[j]:c0+j; if(c>=0&&c<TEMPLATE_HEAD.length) pasteData[r0+k][c]=String(v).trim(); }));
  renderPasteGrid(); checkPaste();
  toast(`Pasted ${rows.length.toLocaleString("en-IN")} row${rows.length===1?"":"s"}${colMap?" (columns matched by heading)":""}`,"success");
});
// Enter moves down a row (like a spreadsheet); a new row is added at the bottom.
$("pasteGrid").addEventListener("keydown",e=>{
  const i=e.target.closest("input[data-r]"); if(!i||e.key!=="Enter") return;
  e.preventDefault();
  const r=+i.dataset.r+(e.shiftKey?-1:1), c=i.dataset.c;
  if(r<0) return;
  if(r>=pasteData.length&&r<PASTE_SHOW){ pasteData.push(emptyPasteRow()); renderPasteGrid(); }
  $("pasteGrid").querySelector(`input[data-r="${r}"][data-c="${c}"]`)?.focus();
});
$("pasteAddRows").onclick=()=>{ for(let k=0;k<10;k++) pasteData.push(emptyPasteRow()); renderPasteGrid(); };
$("pasteClear").onclick=()=>{ pasteData=[]; renderPasteGrid(); checkPaste(); };
const drop=$("drop");
["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault(); drop.classList.add("over");}));
["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault(); drop.classList.remove("over");}));
drop.addEventListener("drop",e=>handleFile(e.dataTransfer.files[0]));
$("dlTemplate").onclick=()=>{
  const t=today(), [y,m,d]=t.split("-");
  const rows=[TEMPLATE_HEAD,
    ["","Red Rice (Kajé Akki)","Grains & Pulses","Boiled, Grade A",5,"kg",50,420,"",t,"","Kedinje farmers group","Godown 1"],
    ["","Cold-pressed Coconut Oil","Oils & Oilseeds","Wood-pressed",1,"L",30,330,"",t,"","FPC mill, Nitte","Oil room"],
    ["","Banana Chips","Processed Products","Coconut-oil fried",200,"g",40,90,"B-CHIPS-01",`${d}-${m}-${y}`,"","FPC kitchen","Retail shelf"]];
  download(new Blob(["\ufeff"+toCSV(rows)],{type:"text/csv"}),"NFPC-bulk-upload-template.csv");
};
$("bulkImport").onclick=async()=>{
  const upd=$("bulkUpdate").checked, rows=[]; let skipped=0; editingId=null;
  for(const r of bulkRows){
    if(r.errs.length){ skipped++; continue; }
    const rec={...r.rec};
    if(r.action==="update"){
      if(!upd){ skipped++; continue; }
    } else {
      if(!rec.batch) rec.batch=genBatch();
      // rows without a SKU get one from the SKU format on the server
    }
    rows.push(rec);
  }
  const btn=$("bulkImport"); btn.disabled=true; btn.textContent="Importing…";
  try{
    const r=await api("bulk",{rows,update:upd});
    page=1; refresh({stats:true}); $("bulkModal").classList.remove("open"); pasteData=[];
    toast(`Import done: ${r.added} added, ${r.updated} updated, ${r.skipped+skipped} skipped`,"success");
    if(r.errors.length) console.warn("Import errors:",r.errors);
  }catch(err){
    $("bulkSummary").innerHTML=`<div class="err">${esc(err.message)}</div>`; btn.disabled=false; btn.textContent="Retry import";
  }
};

/* ================= Label templates ================= */
const LOGO_RE=/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const LEAF='<path d="M12 21V9"/><path d="M12 13c-3 0-5-2-5-5 3 0 5 2 5 5z"/><path d="M12 11c0-3 2-5 5-5 0 3-2 5-5 5z"/><path d="M12 17c-3 0-5-2-5-5 3 0 5 2 5 5z"/><path d="M12 15c0-3 2-5 5-5 0 3-2 5-5 5z"/>';

/** Fill in missing values and reject anything unsafe, so a template can always be drawn. */
function normTpl(s){
  s=s&&typeof s==="object"?s:{};
  const o={...DEFAULT_TPL,...s,show:{...DEFAULT_TPL.show,...(s.show||{})}};
  for(const k of ["brand","tagline","mrpText","address","cin","fssai","contact","note"]) o[k]=String(o[k]??"");
  if(!/^#[0-9a-f]{6}$/i.test(o.color)) o.color=DEFAULT_TPL.color;
  if(!["band","line"].includes(o.header)) o.header="band";
  if(!["default","custom","none"].includes(o.logoMode)) o.logoMode="default";
  if(o.logoMode==="custom"&&!LOGO_RE.test(o.logo)) o.logoMode="default";
  o.logoAspect=Math.min(5,Math.max(.2,+o.logoAspect||1));
  o.perRow=Math.min(5,Math.max(1,parseInt(o.perRow)||3));
  o.media=o.media==="sheet"?"sheet":"roll";
  if(!["full","compact","barcode"].includes(o.layout)) o.layout="full";
  const mm=(v,min,max,d)=>{ const n=+v; return Number.isFinite(n)&&n>0?Math.min(max,Math.max(min,Math.round(n*2)/2)):d; };
  o.labelW=mm(o.labelW,15,220,100); o.labelH=mm(o.labelH,10,300,75);
  o.across=Math.min(4,Math.max(1,parseInt(o.across)||1));
  o.gapX=Number.isFinite(+o.gapX)?Math.min(10,Math.max(0,+o.gapX)):2;
  o.mono=o.mono!==false;
  return o;
}
const defaultTemplate=()=>templates.find(t=>t.isDefault)||templates[0]||null;
const tplSettings=id=>normTpl((templates.find(t=>t.id===id)||defaultTemplate()||{}).settings);
function fillTplSelect(sel,selectedId){
  sel.innerHTML=templates.length?templates.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}${t.isDefault?" (default)":""}</option>`).join(""):`<option value="">Built-in</option>`;
  const d=defaultTemplate(); sel.value=templates.some(t=>t.id===selectedId)?selectedId:(d?d.id:"");
}
// Rough font size that makes text fit a width (bold sans-serif ≈ 0.66em per character).
const fitFont=(text,width,max,min)=>Math.max(min,Math.min(max,width/(Math.max(1,String(text).length)*0.66)));
// If text could still be too wide at that size, squeeze it to the exact width so it never runs off the label.
const fitAttr=(text,width,fs)=>String(text).length*fs*0.66>width?` textLength="${width}" lengthAdjust="spacingAndGlyphs"`:"";

/** Total Code 128 modules (narrowest bar widths) in a barcode, or 0 if the value can't be encoded. */
const modulesOf=sku=>{ try{ return [...encode128B(sku)].reduce((a,d)=>a+ +d,0); }catch(e){ return 0; } };

/** Draw a product label from a template as a standalone SVG (used for preview, print and downloads). */
function labelSVG(i,tpl){ return labelParts(i,tpl).svg; }
/** The label SVG plus its size and the drawn width of one barcode module (to check printability). */
function labelParts(i,tpl){ const s=normTpl(tpl); return s.layout==="full"?fullLabelParts(i,s):smallLabelParts(i,s); }

/** The full label design. In "black only" mode every colour and grey is printed pure black. */
function fullLabelParts(i,s){
  const W=640, P=24, MONO=s.mono, C=MONO?"#000":s.color, band=s.header==="band", F='font-family="Segoe UI,Roboto,Arial,sans-serif"';
  const GRAY=c=>MONO?"#000":c, RULE=MONO?1:.35;
  let moduleUnits=0;
  const HH=s.tagline?72:58, LH=HH-22;           // header height, logo height
  let head="", logoW=0;
  if(s.logoMode==="default"){
    logoW=LH;
    head+=band
      ? `<g transform="translate(${P},11) scale(${LH/24})" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${LEAF}</g>`
      : `<rect x="${P}" y="11" width="${LH}" height="${LH}" rx="8" fill="${C}"/><g transform="translate(${P+LH*.15},${11+LH*.15}) scale(${LH*.7/24})" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${LEAF}</g>`;
  } else if(s.logoMode==="custom"){
    logoW=Math.min(LH*s.logoAspect,170);
    if(band) head+=`<rect x="${P-5}" y="6" width="${logoW+10}" height="${LH+10}" rx="8" fill="#fff"/>`;
    head+=`<image x="${P}" y="11" width="${logoW}" height="${LH}" preserveAspectRatio="xMidYMid meet" href="${esc(s.logo)}" xlink:href="${esc(s.logo)}"${MONO?' filter="url(#nfpcMono)"':""}/>`;
  }
  const tx=logoW?P+logoW+16:W/2, anchor=logoW?"start":"middle", avail=logoW?W-tx-P:W-2*P;
  const brand=trunc(s.brand,80), bfs=fitFont(brand,avail,22,12), ink=band?"#fff":C;
  head+=`<text x="${tx}" y="${(s.tagline?34:HH/2+bfs*.36).toFixed(1)}" text-anchor="${anchor}" ${F} font-size="${bfs.toFixed(1)}" font-weight="800" fill="${ink}"${fitAttr(brand,avail,bfs)}>${esc(brand)}</text>`;
  if(s.tagline){ const tg=trunc(s.tagline,100);
    head+=`<text x="${tx}" y="56" text-anchor="${anchor}" ${F} font-size="13" fill="${band?"#fff":GRAY("#555")}" fill-opacity="${band?.88:1}"${fitAttr(tg,avail,13*.85)}>${esc(tg)}</text>`; }

  // Product name + detail rows (two columns)
  let body="", y=HH+40;
  const pname=trunc(i.name,60), nfs=fitFont(pname,W-2*P,28,16);
  body+=`<text x="${P}" y="${y}" ${F} font-size="${nfs.toFixed(1)}" font-weight="800" fill="#111"${fitAttr(pname,W-2*P,nfs)}>${esc(pname)}</text>`;
  const rows=[];
  if(s.show.net) rows.push(["Net qty:",`${i.net} ${i.unit}`]);
  if(s.show.batch) rows.push(["Batch:",i.batch]);
  if(s.show.packed) rows.push(["Packed:",fmtDate(i.packed)]);
  if(s.show.best) rows.push(["Best before:",fmtDate(i.best)]);
  if(s.show.grade&&i.grade) rows.push(["Grade:",i.grade]);
  if(s.show.source&&i.source) rows.push(["From:",i.source]);
  rows.forEach(([k,v],n)=>{ const ry=y+32+24*Math.floor(n/2), rx=n%2?330:P;
    body+=`<text x="${rx}" y="${ry}" ${F} font-size="15" fill="${GRAY("#555")}">${esc(k)} <tspan fill="#111" font-weight="700">${esc(trunc(v,26))}</tspan></text>`; });
  y+=rows.length?32+24*(Math.ceil(rows.length/2)-1)+20:18;

  // Barcode
  const bh=s.show.barcodeText?112:96;
  body+=barcodeSVG(i.sku,{module:2,height:80,quiet:6,showText:s.show.barcodeText,attrs:`x="70" y="${y}" width="500" height="${bh}" preserveAspectRatio="xMidYMid meet"`});
  { const m=modulesOf(i.sku); if(m) moduleUnits=2*Math.min(500/((m+12)*2),bh/(80+(s.show.barcodeText?18:0))); }
  y+=bh+14;

  // MRP
  if(s.show.mrp){
    body+=`<line x1="${P}" y1="${y}" x2="${W-P}" y2="${y}" stroke="${C}" stroke-opacity="${RULE}"/>`;
    y+=36;
    body+=`<text x="${P}" y="${y-2}" ${F} font-size="15" fill="${GRAY("#444")}">${esc(trunc(s.mrpText,40))}</text>`+
          `<text x="${W-P}" y="${y+2}" text-anchor="end" ${F} font-size="32" font-weight="800" fill="#111">${esc(inr(i.price))}</text>`;
    y+=12;
  }

  // Footer
  const foot=s.show.footer?[s.address,[s.cin&&"CIN "+s.cin,s.fssai&&"FSSAI Lic. "+s.fssai,s.contact].filter(Boolean).join("  ·  "),s.note].filter(Boolean):[];
  if(foot.length){
    if(!s.show.mrp) body+=`<line x1="${P}" y1="${y}" x2="${W-P}" y2="${y}" stroke="${C}" stroke-opacity="${RULE}"/>`;
    y+=8;
    for(const line of foot){ y+=18; body+=`<text x="${P}" y="${y}" ${F} font-size="11.5" fill="${GRAY("#666")}">${esc(trunc(line,98))}</text>`; }
  }
  const H=Math.round(y+20);

  const frame=`<rect x="1.5" y="1.5" width="${W-3}" height="${H-3}" rx="14" fill="#fff" stroke="${C}" stroke-width="3"/>`+
    (band?`<path d="M1.5 ${HH} V15.5 A14 14 0 0 1 15.5 1.5 H${W-15.5} A14 14 0 0 1 ${W-1.5} 15.5 V${HH} Z" fill="${C}"/>`
         :`<line x1="${P}" y1="${HH}" x2="${W-P}" y2="${HH}" stroke="${C}" stroke-width="2"/>`);
  const defs=MONO&&s.logoMode==="custom"?`<defs><filter id="nfpcMono"><feColorMatrix type="saturate" values="0"/></filter></defs>`:"";
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${frame}${head}${body}</svg>`,W,H,moduleUnits};
}

/**
 * Layouts for small labels ("compact" and "barcode + price only"). The drawing has the label's own
 * shape, text is centred, and the barcode takes all the remaining space. Optional lines (dates,
 * brand) are dropped when the label is too short for them.
 */
function smallLabelParts(i,s){
  const roll=s.media==="roll", W=640, H=Math.round(Math.min(960,Math.max(220,W*(roll?s.labelH/s.labelW:0.5))));
  const P=20, C=s.mono?"#000":s.color, F='font-family="Segoe UI,Roboto,Arial,sans-serif"', compact=s.layout==="compact";
  const sub=[s.show.net?`${i.net} ${i.unit}`:"", s.show.mrp?`MRP ${inr(i.price)}`:""].filter(Boolean).join("  ·  ");
  const dates=compact?[s.show.packed?`Pkd ${fmtDate(i.packed)}`:"", s.show.best?`Best before ${fmtDate(i.best)}`:"", s.show.batch?`Batch ${i.batch}`:""].filter(Boolean).join("  ·  "):"";
  const foot=compact&&s.show.footer?[s.fssai&&"FSSAI Lic. "+s.fssai,s.contact].filter(Boolean).join("  ·  "):"";
  let lines=[
    compact&&s.brand?{t:trunc(s.brand,80),max:22,min:12,w:800,fill:C,opt:1}:null,
    {t:trunc(i.name,60),max:40,min:18,w:800,fill:"#000"},
    sub?{t:sub,max:28,min:14,w:700,fill:"#000"}:null,
    dates?{t:dates,max:20,min:12,w:500,fill:"#000",opt:2}:null,
  ].filter(Boolean);
  const textW=W-2*P, footH=foot?24:0, skuH=s.show.barcodeText?18:0, minBar=Math.max(70,H*0.32);
  const used=()=>lines.reduce((a,l)=>a+fitFont(l.t,textW,l.max,l.min)*1.25,0);
  for(const level of [2,1]){ if(H-2*P-used()-footH>=minBar) break; lines=lines.filter(l=>l.opt!==level); }
  let y=P, out="";
  for(const l of lines){
    const fs=fitFont(l.t,textW,l.max,l.min); y+=fs;
    out+=`<text x="${W/2}" y="${y.toFixed(1)}" text-anchor="middle" ${F} font-size="${fs.toFixed(1)}" font-weight="${l.w}" fill="${l.fill}"${fitAttr(l.t,textW,fs)}>${esc(l.t)}</text>`;
    y+=fs*.25;
  }
  y+=6;
  // Barcode: as wide as the label allows, bars as tall as the space left.
  const bh=Math.max(40,H-P-footH-y), m=modulesOf(i.sku), innerW=(m+20)*2, scaleW=textW/Math.max(1,innerW);
  const barH=Math.max(20,bh/scaleW-skuH), moduleUnits=m?2*Math.min(scaleW,bh/(barH+skuH)):0;
  out+=barcodeSVG(i.sku,{module:2,height:Math.round(barH),quiet:10,showText:s.show.barcodeText,attrs:`x="${P}" y="${y.toFixed(1)}" width="${textW}" height="${bh.toFixed(1)}" preserveAspectRatio="xMidYMid meet"`});
  if(foot) out+=`<text x="${W/2}" y="${H-P+6}" text-anchor="middle" ${F} font-size="15" fill="#000"${fitAttr(foot,textW,15)}>${esc(trunc(foot,90))}</text>`;
  // Die-cut roll labels need no border; sheet labels get a thin cutting outline.
  const frame=roll?`<rect width="${W}" height="${H}" fill="#fff"/>`:`<rect x="1" y="1" width="${W-2}" height="${H-2}" rx="10" fill="#fff" stroke="${C}" stroke-width="2"/>`;
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${frame}${out}</svg>`,W,H,moduleUnits};
}

/** One line describing how a template prints, with a warning when barcode bars would be too thin to scan. */
function printInfo(i,tpl){
  const s=normTpl(tpl);
  if(s.media!=="roll") return `Prints on A4 paper, ${s.perRow} label${s.perRow===1?"":"s"} per row.`;
  const base=esc(`Prints on ${s.labelW} × ${s.labelH} mm labels${s.across>1?`, ${s.across} across`:""}${s.mono?" · black only":""}.`);
  let mm=0; try{ const p=labelParts(i,s); mm=p.moduleUnits*Math.min(s.labelW/p.W,s.labelH/p.H); }catch(e){}
  if(!mm) return base;
  const bars=`Thinnest barcode bar: ${mm.toFixed(2)} mm`;
  // Most thermal printers are 203 dpi (0.125 mm per dot): bars under 2 dots scan poorly.
  return mm<0.25
    ?`${base} <span class="warn-text">${bars} — may be too thin to scan (aim for 0.25 mm or more). Use a larger label, the “Barcode + price only” layout, or fewer labels across.</span>`
    :`${base} ${bars}.`;
}

/* ---------- Template editor ---------- */
const SAMPLE_ITEM={name:"Red Rice (Kajé Akki)",net:5,unit:"kg",batch:"B2610-001",packed:today(),best:addDays(today(),180),
  grade:"Boiled, Grade A",source:"Kedinje farmers group",price:420,sku:"NFPC-GRP-48213"};
let tEdit=null, tDirty=false;   // tEdit = {id|null, name, isDefault, settings}

const SIZE_PRESETS=["38x25","50x25","50x30","50x38","60x40","75x50","100x50","100x75","100x100","100x150"];
/** Show the settings for the chosen printer type. */
function syncPrintOpts(){
  const roll=$("tMedia").value==="roll";
  $("tRollOpts").classList.toggle("hidden",!roll); $("tSheetOpts").classList.toggle("hidden",roll);
  $("tCustom").classList.toggle("hidden",$("tSize").value!=="custom");
}
const TFIELDS={tBrand:"brand",tTagline:"tagline",tMrpText:"mrpText",tAddress:"address",tCin:"cin",tFssai:"fssai",tContact:"contact",tNote:"note"};
function tplToForm(){
  const s=tEdit.settings;
  $("tName").value=tEdit.name; $("tDefault").checked=!!tEdit.isDefault; $("tPerRow").value=String(s.perRow);
  for(const [id,k] of Object.entries(TFIELDS)) $(id).value=s[k];
  $("tColor").value=s.color; $("tHeader").value=s.header; $("tLogoMode").value=s.logoMode;
  $("tShow").querySelectorAll("input").forEach(c=>c.checked=!!s.show[c.dataset.k]);
  $("tMedia").value=s.media; $("tLayout").value=s.layout;
  const size=`${s.labelW}x${s.labelH}`; $("tSize").value=SIZE_PRESETS.includes(size)?size:"custom";
  $("tW").value=s.labelW; $("tH").value=s.labelH; $("tAcross").value=String(s.across); $("tGap").value=s.gapX; $("tMono").checked=s.mono;
  syncPrintOpts();
  updateLogoThumb(); $("tErr").textContent=""; $("tDelete").disabled=!tEdit.id||templates.length<=1;
  renderTplPreview();
}
function formToTpl(){
  const s=tEdit.settings;
  tEdit.name=$("tName").value; tEdit.isDefault=$("tDefault").checked; s.perRow=+$("tPerRow").value;
  for(const [id,k] of Object.entries(TFIELDS)) s[k]=$(id).value;
  s.color=$("tColor").value; s.header=$("tHeader").value;
  $("tShow").querySelectorAll("input").forEach(c=>s.show[c.dataset.k]=c.checked);
  s.media=$("tMedia").value; s.layout=$("tLayout").value; s.across=+$("tAcross").value; s.gapX=Math.max(0,+$("tGap").value||0); s.mono=$("tMono").checked;
  if($("tSize").value==="custom"){ s.labelW=+$("tW").value||s.labelW; s.labelH=+$("tH").value||s.labelH; }
  else{ const [w,h]=$("tSize").value.split("x").map(Number); s.labelW=w; s.labelH=h; $("tW").value=w; $("tH").value=h; }
  syncPrintOpts();
  const mode=$("tLogoMode").value;
  if(mode==="custom"&&!LOGO_RE.test(s.logo)){ $("tLogoMode").value=s.logoMode==="custom"?"custom":s.logoMode; $("tLogoFile").click(); }
  else s.logoMode=mode;
}
function updateLogoThumb(){
  const s=tEdit.settings, th=$("tLogoThumb"), has=LOGO_RE.test(s.logo);
  th.style.display=has&&s.logoMode==="custom"?"block":"none"; if(has) th.src=s.logo; else th.removeAttribute("src");
  $("tLogoPick").textContent=has?"Change logo…":"Upload logo…";
}
function renderTplPreview(){
  const id=$("tPrevItem").value, it=items.find(i=>i.id===id)||items[0]||SAMPLE_ITEM;
  try{ $("tPreview").innerHTML=labelHTML(it,tEdit.settings); $("tPrintInfo").innerHTML=printInfo(it,tEdit.settings); }
  catch(e){ $("tPreview").innerHTML=`<div class="err">${esc(e.message)}</div>`; $("tPrintInfo").textContent=""; }
}
function selectTpl(id){
  const t=templates.find(x=>x.id===id)||defaultTemplate();
  tEdit=t?{id:t.id,name:t.name,isDefault:t.isDefault,settings:normTpl(JSON.parse(JSON.stringify(t.settings)))}
         :{id:null,name:"Standard",isDefault:true,settings:normTpl({})};
  tDirty=false; fillTplSelect($("tSel"),tEdit.id); tplToForm();
}
const confirmDiscard=()=>!tDirty||confirm("You have unsaved changes to this template. Discard them?");

$("openTpl").onclick=()=>{
  $("tPrevItem").innerHTML=(items.length?items.slice(0,300):[SAMPLE_ITEM]).map(i=>`<option value="${esc(i.id||"")}">${esc(i.name)} · ${esc(i.net)} ${esc(i.unit)}</option>`).join("");
  selectTpl((defaultTemplate()||{}).id); $("tplModal").classList.add("open");
};
$("tSel").onchange=e=>{ if(confirmDiscard()) selectTpl(e.target.value); else e.target.value=tEdit.id||""; };
$("tPrevItem").onchange=renderTplPreview;
// Text and colour fields update on "input" (live); selects and checkboxes on "change".
function onTplEdit(e){ formToTpl(); tDirty=true; updateLogoThumb(); renderTplPreview(); }
$("tplForm").addEventListener("input",e=>{ const t=e.target; if(t.tagName==="INPUT"&&!["checkbox","file"].includes(t.type)) onTplEdit(e); });
$("tplForm").addEventListener("change",e=>{ const t=e.target; if((t.tagName==="SELECT"&&t.id!=="tSel")||t.type==="checkbox") onTplEdit(e); });
$("tNew").onclick=()=>{ if(!confirmDiscard()) return;
  tEdit={id:null,name:"New template",isDefault:false,settings:normTpl({})}; tDirty=true;
  $("tSel").insertAdjacentHTML("beforeend",`<option value="">New template (unsaved)</option>`); $("tSel").value=""; tplToForm(); $("tName").select(); };
$("tDup").onclick=()=>{ formToTpl();
  tEdit={id:null,name:trunc(`${tEdit.name} (copy)`,80),isDefault:false,settings:normTpl(JSON.parse(JSON.stringify(tEdit.settings)))}; tDirty=true;
  $("tSel").insertAdjacentHTML("beforeend",`<option value="">${esc(tEdit.name)} (unsaved)</option>`); $("tSel").value=""; tplToForm(); $("tName").select(); };
$("tClose").onclick=()=>{ if(confirmDiscard()){ tDirty=false; $("tplModal").classList.remove("open"); } };

/** Shrink an uploaded image to max 360px and convert it to PNG (also strips anything that isn't pixels, e.g. SVG scripts). */
function processLogo(file){
  return new Promise((res,rej)=>{
    if(!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) return rej(new Error("Choose a PNG, JPG, WEBP, GIF or SVG image."));
    if(file.size>5*1024*1024) return rej(new Error("That image is too large (max 5 MB)."));
    const url=URL.createObjectURL(file), img=new Image();
    img.onload=()=>{
      let w=img.naturalWidth||300, h=img.naturalHeight||300; const k=Math.min(1,360/Math.max(w,h));
      w=Math.max(1,Math.round(w*k)); h=Math.max(1,Math.round(h*k));
      const c=document.createElement("canvas"); c.width=w; c.height=h; const x=c.getContext("2d");
      x.drawImage(img,0,0,w,h); URL.revokeObjectURL(url);
      let data=c.toDataURL("image/png");
      if(data.length>480000){ x.globalCompositeOperation="destination-over"; x.fillStyle="#fff"; x.fillRect(0,0,w,h); data=c.toDataURL("image/jpeg",.88); }
      res({data,aspect:w/h});
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error("Couldn't read that image.")); };
    img.src=url;
  });
}
$("tLogoPick").onclick=()=>$("tLogoFile").click();
$("tLogoFile").onchange=async e=>{
  const f=e.target.files[0]; e.target.value=""; if(!f) return;
  try{ const {data,aspect}=await processLogo(f);
    Object.assign(tEdit.settings,{logo:data,logoAspect:aspect,logoMode:"custom"}); $("tLogoMode").value="custom";
    tDirty=true; $("tErr").textContent=""; updateLogoThumb(); renderTplPreview();
  }catch(err){ $("tErr").textContent=err.message; }
};
$("tSave").onclick=async()=>{
  formToTpl();
  if(!tEdit.name.trim()){ $("tErr").textContent="Give the template a name."; $("tName").focus(); return; }
  if(!tEdit.settings.brand.trim()){ $("tErr").textContent="Brand name is required."; $("tBrand").focus(); return; }
  const s={...tEdit.settings}; if(s.logoMode!=="custom") s.logo="";
  $("tSave").disabled=true;
  try{
    const r=await api("template_save",{id:tEdit.id,name:tEdit.name.trim(),settings:s,makeDefault:tEdit.isDefault});
    templates=r.templates; selectTpl(r.id); toast("Template saved","success");
  }catch(err){ $("tErr").textContent=err.message; }
  finally{ $("tSave").disabled=false; }
};
$("tDelete").onclick=async()=>{
  if(!tEdit.id||!await App.confirm({title:`Delete the template "${tEdit.name}"?`,message:"Labels already printed aren't affected. This can't be undone.",confirmText:"Delete template",danger:true})) return;
  try{ const r=await api("template_delete",{id:tEdit.id}); templates=r.templates; tDirty=false; selectTpl((defaultTemplate()||{}).id); toast("Template deleted","success"); }
  catch(err){ $("tErr").textContent=err.message; }
};
function svgToPng(svg,scale=2,crisp=false){
  return new Promise((res,rej)=>{
    const url=URL.createObjectURL(new Blob([svg],{type:"image/svg+xml;charset=utf-8"})), img=new Image();
    img.onload=()=>{ const c=document.createElement("canvas"); c.width=img.naturalWidth*scale; c.height=img.naturalHeight*scale;
      const x=c.getContext("2d"); x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height); x.imageSmoothingEnabled=!crisp;
      x.drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url); c.toBlob(b=>b?res(b):rej(new Error("PNG conversion failed")),"image/png"); };
    img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error("Couldn't render image")); };
    img.src=url;
  });
}

/* ================= Minimal ZIP writer (no compression, works offline) ================= */
const CRC_T=(()=>{const t=new Uint32Array(256); for(let n=0;n<256;n++){let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0;} return t;})();
function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=CRC_T[(c^u8[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function makeZip(files){
  const enc=new TextEncoder(), parts=[], central=[]; let offset=0;
  const d=new Date(), tm=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1), dt=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  for(const f of files){
    const name=enc.encode(f.name), crc=crc32(f.data), sz=f.data.length;
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true); lh.setUint16(8,0,true);
    lh.setUint16(10,tm,true); lh.setUint16(12,dt,true); lh.setUint32(14,crc,true); lh.setUint32(18,sz,true); lh.setUint32(22,sz,true);
    lh.setUint16(26,name.length,true); lh.setUint16(28,0,true);
    parts.push(lh.buffer,name,f.data);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true);
    ch.setUint16(12,tm,true); ch.setUint16(14,dt,true); ch.setUint32(16,crc,true); ch.setUint32(20,sz,true); ch.setUint32(24,sz,true);
    ch.setUint16(28,name.length,true); ch.setUint32(42,offset,true);
    central.push(ch.buffer,name);
    offset+=30+name.length+sz;
  }
  const cdSize=central.reduce((a,p)=>a+p.byteLength,0), end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(8,files.length,true); end.setUint16(10,files.length,true);
  end.setUint32(12,cdSize,true); end.setUint32(16,offset,true);
  return new Blob([...parts,...central,end.buffer],{type:"application/zip"});
}

/* ================= ZIP download ================= */
function setZip(p,msg){ $("zBar").style.width=Math.round(p*100)+"%"; $("zStatus").textContent=msg; }
$("openZip").onclick=()=>{
  $("zScope").innerHTML=`<option value="all">All products (${stats.products})</option>`+(filtersActive()&&total!==stats.products?`<option value="visible">Only the current filter (${total})</option>`:"");
  fillTplSelect($("zTpl"),$("zTpl").value);
  setZip(0,"Includes an index.csv listing every file."); $("zipModal").classList.add("open");
};
$("zCancel").onclick=()=>$("zipModal").classList.remove("open");
$("zGo").onclick=async()=>{
  setZip(0,"Loading products…");
  let list; try{ list=await allMatching($("zScope").value==="visible"); }catch(err){ setZip(0,"Error: "+err.message); return; }
  if(!list.length){ setZip(0,"No products to export."); return; }
  const content=$("zContent").value, fmt=$("zFormat").value, byCat=$("zByCat").checked, tpl=tplSettings($("zTpl").value);
  const root=`NFPC-barcodes-${today()}`, enc=new TextEncoder(), files=[], index=[["File","SKU","Product","Category","Pack","Batch","Packed on","Best before","MRP"]];
  $("zGo").disabled=true;
  try{
    for(let k=0;k<list.length;k++){
      const i=list[k], dir=`${root}/${byCat?safe(i.cat)+"/":""}`, base=safe(`${i.sku}_${i.name}_${i.net}${i.unit}`);
      for(const kind of content==="both"?["label","barcode"]:[content]){
        const svg=kind==="label"?labelSVG(i,tpl):barcodeSVG(i.sku,{module:3,height:110});
        const suf=content==="both"?`_${kind}`:"";
        if(fmt!=="png"){ const n=`${dir}${base}${suf}.svg`; files.push({name:n,data:enc.encode(svg)}); index.push([n.slice(root.length+1),i.sku,i.name,i.cat,`${i.net} ${i.unit}`,i.batch,i.packed,i.best,i.price]); }
        if(fmt!=="svg"){ const b=await svgToPng(svg,kind==="label"?3:2,kind!=="label"); const n=`${dir}${base}${suf}.png`;
          files.push({name:n,data:new Uint8Array(await b.arrayBuffer())}); index.push([n.slice(root.length+1),i.sku,i.name,i.cat,`${i.net} ${i.unit}`,i.batch,i.packed,i.best,i.price]); }
      }
      setZip((k+1)/list.length,`Rendering ${k+1} of ${list.length}…`);
    }
    files.push({name:`${root}/index.csv`,data:enc.encode("\ufeff"+toCSV(index))});
    download(makeZip(files),`${root}.zip`);
    track("labels_downloaded",`${list.length} products`,`ZIP · ${$("zContent").selectedOptions[0].text} · ${fmt.toUpperCase()} · template ${tplName($("zTpl").value)}`);
    setZip(1,`Done — ${files.length-1} image files in ${root}.zip`);
  }catch(e){ setZip(0,"Error: "+e.message); }
  finally{ $("zGo").disabled=false; }
};
["bulkModal","zipModal"].forEach(id=>$(id).addEventListener("click",e=>{ if(e.target.id===id) $(id).classList.remove("open"); }));

document.querySelectorAll("[data-ic]").forEach(el=>el.innerHTML=App.icon(el.dataset.ic));
$("todayStr").textContent=new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
// "/" jumps to search, like most web apps.
document.addEventListener("keydown",e=>{
  if(e.key==="/"&&!e.ctrlKey&&!e.metaKey&&!/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)&&!document.querySelector(".modal.open")){ e.preventDefault(); $("search").focus(); }
});

(async()=>{
  let loadErr=null;
  try{ await load(); }catch(e){ items=[]; loadErr=e.message; }
  fillCatSelect(); resetForm(); applyPermissions();
  // Links from the dashboard: ?status=low|exp|expired and/or ?q=<search text or SKU>
  { const p=new URLSearchParams(location.search), st=p.get("status"), q=p.get("q"), c=p.get("cat");
    if(c&&CATS[c]) catFilter=c;
    if(st&&[...$("filterStatus").options].some(o=>o.value===st)) $("filterStatus").value=st;
    if(q) $("search").value=q; }
  // The first page comes with the page itself; other filters or page sizes are fetched.
  if(!loadErr&&(filtersActive()||pageSize!==50)) await refresh();
  else render();
  if(loadErr){ $("banners").innerHTML=`<div class="alert error banner">${App.icon("alert")}<div><b>Couldn't load the inventory.</b> ${esc(loadErr)}</div></div>`; toast(loadErr,"error"); }
})();
