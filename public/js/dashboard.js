/* Dashboard page — carried over from the PHP version (URLs updated). */
const ME=JSON.parse(document.getElementById("me-data").textContent);
const {esc,$,icon,api}=App;
App.topbar(ME,"dashboard");
$("goInv").innerHTML=icon("inventory")+"Open inventory";
const hour=new Date().getHours();
$("hello").textContent=`${hour<12?"Good morning":hour<17?"Good afternoon":"Good evening"}, ${ME.name.split(" ")[0]} · ${new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}`;

/* ---------------- Formatting ---------------- */
const inr=n=>"₹"+Number(n).toLocaleString("en-IN",{maximumFractionDigits:0});
const num=n=>Number(n).toLocaleString("en-IN");
// Compact Indian units for axes and tight labels: ₹1.2L, ₹3.4Cr, 12K.
function compact(n,money){
  const a=Math.abs(n), p=money?"₹":"";
  if(money&&a>=1e7) return p+(n/1e7).toFixed(a>=1e8?0:1).replace(/\.0$/,"")+"Cr";
  if(money&&a>=1e5) return p+(n/1e5).toFixed(a>=1e6?0:1).replace(/\.0$/,"")+"L";
  if(a>=1000) return p+(n/1000).toFixed(a>=1e4?0:1).replace(/\.0$/,"")+"K";
  return p+Math.round(n);
}
const dShort=s=>new Date(s+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short"});
function niceMax(v){ if(v<=0) return 1; const p=Math.pow(10,Math.floor(Math.log10(v))), f=v/p; return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p; }
const svgEl=(w,h,inner,label)=>`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
// A bar with a 4px rounded data-end and a square base. dir: "right" (horizontal) or "up"/"down" (vertical).
function barPath(x,y,w,h,dir){
  const r=Math.min(4,dir==="right"?w/2:h/2,dir==="right"?h/2:w/2);
  if(w<=0||h<=0) return "";
  if(dir==="right") return `M${x},${y}h${w-r}a${r},${r} 0 0 1 ${r},${r}v${h-2*r}a${r},${r} 0 0 1 -${r},${r}h-${w-r}z`;
  if(dir==="up") return `M${x},${y+h}v-${h-r}a${r},${r} 0 0 1 ${r},-${r}h${w-2*r}a${r},${r} 0 0 1 ${r},${r}v${h-r}z`;
  return `M${x},${y}h${w}v${h-r}a${r},${r} 0 0 1 -${r},${r}h-${w-2*r}a${r},${r} 0 0 1 -${r},-${r}z`;
}

/* ---------------- Tooltip (values set with textContent) ---------------- */
const tip=$("tip");
function showTip(e,title,rows){
  tip.replaceChildren();
  const t=document.createElement("div"); t.className="tl"; t.textContent=title; tip.appendChild(t);
  for(const r of rows){
    const row=document.createElement("div"); row.className="row";
    if(r.color){ const k=document.createElement("span"); k.className="key"; k.style.background=r.color; row.appendChild(k); }
    const v=document.createElement("span"); v.className="tv"; v.textContent=r.value; row.appendChild(v);
    if(r.label){ const l=document.createElement("span"); l.className="tl"; l.textContent=r.label; row.appendChild(l); }
    tip.appendChild(row);
  }
  tip.style.display="block";
  const b=e.target.getBoundingClientRect(), px=e.clientX??(b.left+b.width/2), py=e.clientY??b.top;
  const w=tip.offsetWidth, h=tip.offsetHeight;
  tip.style.left=Math.max(8,Math.min(px+12,innerWidth-w-8))+"px";
  tip.style.top=Math.max(8,py-h-12<8?py+16:py-h-12)+"px";
}
const hideTip=()=>tip.style.display="none";
const TIPS=new Map();   // mark element -> {title, rows}
function wireTips(root){
  root.querySelectorAll(".mark").forEach(m=>{
    const d=TIPS.get(m.dataset.tip); if(!d) return;
    m.setAttribute("tabindex","0");
    m.addEventListener("pointermove",e=>showTip(e,d.title,d.rows));
    m.addEventListener("pointerleave",hideTip);
    m.addEventListener("focus",e=>showTip({target:m,clientX:undefined,clientY:undefined},d.title,d.rows));
    m.addEventListener("blur",hideTip);
  });
}
let tipSeq=0;
const tipId=(title,rows)=>{ const id="t"+(++tipSeq); TIPS.set(id,{title,rows}); return id; };
const cssVar=n=>getComputedStyle($("dash")).getPropertyValue(n).trim();

/* ---------------- Charts ---------------- */
// Horizontal bars, one hue (magnitude). Value at each bar's tip.
function hbars(el,rows,{money=true,unit=""}={}){
  const W=el.clientWidth||520, labW=Math.min(170,W*.36), valW=70, rowH=30, bh=16, H=rows.length*rowH;
  const max=niceMax(Math.max(...rows.map(r=>r.value),1)), sc=(W-labW-valW)/max, color=cssVar("--viz-seq");
  let g="";
  rows.forEach((r,i)=>{
    const y=i*rowH, w=Math.max(r.value>0?2:0,r.value*sc), id=tipId(r.label,[{value:money?inr(r.value):num(r.value)+unit,label:r.extra||""}]);
    g+=`<text class="lbl" x="${labW-10}" y="${y+rowH/2+4}" text-anchor="end">${esc(r.label.length>24?r.label.slice(0,23)+"…":r.label)}</text>`;
    g+=`<rect class="mark" data-tip="${id}" x="${labW}" y="${y}" width="${W-labW}" height="${rowH}" fill="transparent"/>`;
    if(w) g+=`<path class="mark" data-tip="${id}" d="${barPath(labW,y+(rowH-bh)/2,w,bh,"right")}" fill="${color}"/>`;
    g+=`<text class="val" x="${labW+w+6}" y="${y+rowH/2+4}">${money?compact(r.value,true):num(r.value)}</text>`;
  });
  g=`<line x1="${labW}" y1="0" x2="${labW}" y2="${H}" stroke="var(--viz-axis)"/>`+g;
  el.innerHTML=svgEl(W,H,g,"Bar chart");
  wireTips(el);
}
// Vertical columns from one baseline. series: [{key,label,color,sign}] where sign -1 draws below zero.
function columns(el,data,series,{xLabel,tickEvery=1,money=false,emptyText}={}){
  const total=data.reduce((a,d)=>a+series.reduce((s,ser)=>s+(d[ser.key]||0),0),0);
  if(!total){ el.innerHTML=`<div class="empty-chart">${esc(emptyText||"Nothing in this period yet.")}</div>`; return; }
  const W=el.clientWidth||520, H=220, L=44, R=8, T=12, B=26, two=series.some(s=>s.sign<0);
  const up=niceMax(Math.max(...data.map(d=>series.filter(s=>s.sign>0).reduce((a,s)=>Math.max(a,d[s.key]||0),0)),1));
  const dn=two?niceMax(Math.max(...data.map(d=>series.filter(s=>s.sign<0).reduce((a,s)=>Math.max(a,d[s.key]||0),0)),1)):0;
  const ph=H-T-B, zeroY=T+ph*(up/(up+dn)), sc=ph/(up+dn), band=(W-L-R)/data.length, bw=Math.min(24,Math.max(2,band-4));
  let g="";
  // gridlines + ticks (hairline, recessive)
  const ticks=[0,up/2,up].concat(two?[-dn/2,-dn]:[]);
  for(const t of ticks){ const y=zeroY-t*sc;
    g+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="${t===0?"var(--viz-axis)":"var(--viz-grid)"}"/>`;
    g+=`<text x="${L-6}" y="${y+4}" text-anchor="end">${t<0?"−":""}${compact(Math.abs(t),money)}</text>`; }
  // X labels every `tickEvery` columns, always including the last; drop the one before it if they'd collide.
  const ticked=new Set(); for(let i=0;i<data.length;i+=tickEvery) ticked.add(i);
  const last=data.length-1, prev=Math.floor(last/tickEvery)*tickEvery;
  if(prev!==last&&last-prev<tickEvery*0.6) ticked.delete(prev);
  ticked.add(last);
  data.forEach((d,i)=>{
    const x=L+i*band+(band-bw)/2, rows=series.map(s=>({value:money?inr(d[s.key]||0):num(d[s.key]||0),label:s.label,color:cssVar(s.color)}));
    const id=tipId(xLabel(d,true),rows);
    g+=`<rect class="mark" data-tip="${id}" x="${L+i*band}" y="${T}" width="${band}" height="${ph}" fill="transparent"/>`;
    for(const s of series){ const v=d[s.key]||0; if(!v) continue; const h=Math.max(2,v*sc);
      g+=s.sign>0?`<path class="mark" data-tip="${id}" d="${barPath(x,zeroY-h-1,bw,h,"up")}" fill="var(${s.color})"/>`
                 :`<path class="mark" data-tip="${id}" d="${barPath(x,zeroY+1,bw,h,"down")}" fill="var(${s.color})"/>`; }
    if(ticked.has(i)) g+=`<text x="${L+i*band+band/2}" y="${H-6}" text-anchor="middle">${esc(xLabel(d,false))}</text>`;
  });
  el.innerHTML=svgEl(W,H,g,"Column chart");
  wireTips(el);
}
// One stacked bar of status counts, 2px surface gaps, icon + label legend.
function healthBar(el,parts){
  const total=parts.reduce((a,p)=>a+p.value,0);
  if(!total){ el.innerHTML=`<div class="empty-chart">No products yet.</div>`; return; }
  const W=el.clientWidth||520, H=28, gap=2, avail=W-gap*(parts.filter(p=>p.value).length-1);
  let x=0, g=""; const shown=parts.filter(p=>p.value);
  shown.forEach((p,i)=>{ const w=Math.max(3,p.value/total*avail);
    const r=(i===0||i===shown.length-1)?4:0, id=tipId(p.label,[{value:`${num(p.value)} products`,label:`${Math.round(p.value/total*100)}%`,color:cssVar(p.color)}]);
    // round only the outer ends of the whole bar
    const path=i===0&&shown.length===1?`M${x+4},0h${w-8}a4,4 0 0 1 4,4v${H-8}a4,4 0 0 1 -4,4h-${w-8}a4,4 0 0 1 -4,-4v-${H-8}a4,4 0 0 1 4,-4z`
      :i===0?`M${x+4},0h${w-4}v${H}h-${w-4}a4,4 0 0 1 -4,-4v-${H-8}a4,4 0 0 1 4,-4z`
      :i===shown.length-1?`M${x},0h${w-4}a4,4 0 0 1 4,4v${H-8}a4,4 0 0 1 -4,4h-${w-4}z`:`M${x},0h${w}v${H}h-${w}z`;
    g+=`<path class="mark" data-tip="${id}" d="${path}" fill="var(${p.color})"/>`; x+=w+gap; });
  el.innerHTML=svgEl(W,H,g,"Stock health")+`<div class="legend">${parts.map(p=>`<span>${icon(p.icon)}<i style="background:var(${p.color})"></i>${esc(p.label)} <b>${num(p.value)}</b> <span class="meta">${Math.round(p.value/total*100)}%</span></span>`).join("")}</div>`;
  el.querySelectorAll(".legend svg").forEach((s,i)=>s.style.color=`var(${parts[i].color})`);
  wireTips(el);
}

/* ---------------- Table view (same numbers, no hover needed) ---------------- */
const TABLES={};
function tableHTML(head,rows,numCols){ return `<div class="table-wrap tbl-view"><table><thead><tr>${head.map((h,i)=>`<th class="${numCols.includes(i)?"num":""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,i)=>`<td class="${numCols.includes(i)?"num":""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`; }
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-table]"); if(!b) return;
  const key=b.dataset.table, card=b.closest(".chart-card"), on=b.classList.toggle("on");
  b.textContent=on?"Chart":"Table";
  card.querySelector(".chart").classList.toggle("hidden",on);
  let tv=card.querySelector(".tbl-holder"); if(!tv){ tv=document.createElement("div"); tv.className="tbl-holder"; card.appendChild(tv); }
  tv.innerHTML=on&&TABLES[key]?TABLES[key]():""; tv.classList.toggle("hidden",!on);
});

/* ---------------- Load & render ---------------- */
let DATA=null, days=30, attTab="low";
try{ const d=+localStorage.getItem("nfpc-dash-days"); if([7,30,90].includes(d)) days=d; }catch(e){}
document.querySelectorAll("#period button").forEach(b=>b.classList.toggle("on",+b.dataset.d===days));

async function load(){
  $("dash").classList.add("loading-dim");
  try{ DATA=await api("dashboard&days="+days); render(); $("refreshed").textContent="Updated "+new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}); }
  catch(e){ App.toast(e.message,"error"); }
  finally{ $("dash").classList.remove("loading-dim"); }
}
function render(){
  const D=DATA, k=D.kpi; TIPS.clear();
  $("heroValue").textContent=inr(k.value);
  $("heroSub").textContent=`${num(k.units)} packs across ${num(k.products)} product batches`;
  const tile=(cls,ic,title,n,href,go)=>`<a class="alert-tile ${cls}${n?"":" zero"}" href="${href}"><span class="t">${icon(ic)}${esc(title)}</span><span class="n">${num(n)}</span><span class="go">${n?esc(go):"Nothing to do"}</span></a>`;
  $("alerts").innerHTML=
    tile("warn","warn","Low stock",k.low_stock,"/inventory?status=low",`Below ${D.lowLimit} packs · view list`)+
    tile("crit","alert","Out of stock",k.out_stock,"/inventory?status=low","0 packs left · view list")+
    tile("warn","clock","Expiring ≤ 15 days",k.expiring,"/inventory?status=exp","Sell or move first · view list")+
    tile("crit","x","Expired, still in stock",k.expired_in_stock,"/inventory?status=expired","Remove from shelves · view list");

  // Category value
  const cats=D.byCategory.filter(c=>c.products>0);
  if(cats.length) hbars($("chCat"),cats.map(c=>({label:c.cat,value:c.value,extra:`${num(c.units)} packs · ${num(c.products)} batches`})));
  else $("chCat").innerHTML=`<div class="empty-chart">No products yet.</div>`;
  TABLES.cat=()=>tableHTML(["Category","Batches","Packs","Stock value"],D.byCategory.map(c=>[c.cat,num(c.products),num(c.units),inr(c.value)]),[1,2,3]);

  // Health
  const parts=[{label:"Healthy",value:k.ok_stock,color:"--viz-good",icon:"check"},{label:`Low (under ${D.lowLimit})`,value:k.low_stock,color:"--viz-warn",icon:"warn"},{label:"Out of stock",value:k.out_stock,color:"--viz-crit",icon:"x"}];
  healthBar($("chHealth"),parts);
  // Where the low / out-of-stock batches are, by category (fills the card with something actionable).
  const short=D.byCategory.filter(c=>c.low||c.out_stock).sort((a,b)=>(b.low+b.out_stock)-(a.low+a.out_stock)).slice(0,6);
  $("chHealth").insertAdjacentHTML("beforeend",short.length
    ?`<div class="by-cat"><div class="by-cat-h">Running low, by category</div><table><thead><tr><th>Category</th><th class="num">Low</th><th class="num">Out</th></tr></thead><tbody>${
      short.map(c=>`<tr data-href="/inventory?status=low&amp;cat=${encodeURIComponent(c.cat)}"><td><span class="catdot" style="background:${/^#[0-9a-f]{6}$/i.test(c.color)?c.color:"#6b7a8f"}"></span>${esc(c.cat)}</td><td class="num">${num(c.low)}</td><td class="num">${num(c.out_stock)}</td></tr>`).join("")}</tbody></table></div>`
    :`<div class="by-cat"><div class="empty-chart" style="min-height:90px">${icon("check")} Every category is well stocked.</div></div>`);
  TABLES.health=()=>tableHTML(["Stock level","Batches","Share"],parts.map(p=>[p.label,num(p.value),k.products?Math.round(p.value/k.products*100)+"%":"0%"]),[1,2]);

  // Movement
  const add=D.movement.reduce((a,d)=>a+d.added,0), rem=D.movement.reduce((a,d)=>a+d.removed,0);
  $("moveSub").textContent=`Packs per day, last ${D.days} days · from adds, edits, uploads and deletes`;
  columns($("chMove"),D.movement,[{key:"added",label:"added",color:"--viz-up",sign:1},{key:"removed",label:"removed",color:"--viz-down",sign:-1}],
    {xLabel:(d,full)=>full?new Date(d.date+"T00:00:00").toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"}):dShort(d.date),
     tickEvery:D.days<=7?1:D.days<=30?7:15,emptyText:`No stock changes in the last ${D.days} days.`});
  if(add||rem) $("chMove").insertAdjacentHTML("beforeend",`<div class="legend"><span><i style="background:var(--viz-up)"></i>Packs added <b>${num(add)}</b></span><span><i style="background:var(--viz-down)"></i>Packs removed <b>${num(rem)}</b></span><span>Net <b>${add-rem>=0?"+":"−"}${num(Math.abs(add-rem))}</b></span></div>`);
  TABLES.move=()=>tableHTML(["Date","Packs added","Packs removed","Net"],D.movement.filter(d=>d.added||d.removed).reverse().map(d=>[dShort(d.date),num(d.added),num(d.removed),(d.added-d.removed>=0?"+":"−")+num(Math.abs(d.added-d.removed))]),[1,2,3]);

  // Expiry weeks
  columns($("chExpiry"),D.expiryWeeks,[{key:"batches",label:"batches",color:"--viz-seq",sign:1}],
    {xLabel:(d,full)=>full?`Week of ${dShort(d.from)}${d.week===0?" (this week)":""}`:(d.week===0?"This wk":dShort(d.from)),tickEvery:3,emptyText:"No batches expire in the next 12 weeks."});
  TABLES.expiry=()=>tableHTML(["Week starting","Batches","Packs"],D.expiryWeeks.map(w=>[dShort(w.from),num(w.batches),num(w.units)]),[1,2]);

  renderAttention(); renderTop();
  // Activity (only for people who can see the activity log)
  if(D.activity){
    $("activityRow").classList.remove("hidden");
    const a=D.activity; $("actSub").textContent=`Last ${D.days} days`;
    $("actTiles").innerHTML=[["Products added",a.added_products],["Product edits",a.edits],["Products deleted",a.deletes],["Label prints",a.prints],["Label downloads",a.downloads],["People active",a.people]]
      .map(([k2,v])=>`<div><div class="k">${k2}</div><div class="v">${num(v)}</div></div>`).join("");
    const EV={product_created:"added",product_imported:"added by bulk upload",product_updated:"edited",product_deleted:"deleted",bulk_import:"bulk upload",
      template_created:"added label template",template_updated:"edited label template",template_deleted:"deleted label template",labels_printed:"printed labels for",sku_format_updated:"changed the",labels_downloaded:"downloaded labels for",inventory_exported:"exported"};
    $("recent").innerHTML=D.recent.length?D.recent.map(r=>`<li><span class="when" title="${esc(App.fmtDateTime(r.created_at))}">${esc(App.timeAgo(r.created_at))}</span>
      <span class="what"><b>${esc(r.username||"—")}</b>${r.via?` <span class="meta">(by ${esc(r.via)})</span>`:""} ${esc(EV[r.event]||r.event.replace(/_/g," "))} <b>${esc(r.target)}</b><div class="meta">${esc(r.detail)}</div></span></li>`).join("")
      :`<li class="meta">No product activity yet.</li>`;
  }
}
const prodRow=(p,right)=>`<tr data-href="/inventory?q=${encodeURIComponent(p.sku)}"><td><div class="pname">${esc(p.name)} <span class="meta">· ${esc(p.net)} ${esc(p.unit)}</span></div><div class="meta">${esc(p.cat)} · ${esc(p.sku)}</div></td><td class="num">${right}</td></tr>`;
function renderAttention(){
  const D=DATA, today=D.today;
  if(attTab==="low"){
    $("attSub").textContent=`Lowest stock first · below ${D.lowLimit} packs`;
    $("attBody").innerHTML=D.lowStock.length?D.lowStock.map(p=>prodRow(p,p.qty<=0?`<span class="badge out">Out</span>`:`<span class="badge low">${num(p.qty)} left</span>`)).join("")
      :`<tr><td><div class="empty-state">${icon("check")}<b>All stocked up</b>Nothing is below ${D.lowLimit} packs.</div></td></tr>`;
  } else {
    $("attSub").textContent="Expired and expiring within 15 days, soonest first";
    $("attBody").innerHTML=D.expiringSoon.length?D.expiringSoon.map(p=>{ const d=Math.round((new Date(p.best+"T00:00:00")-new Date(today+"T00:00:00"))/864e5);
      return prodRow(p,d<0?`<span class="badge out">Expired</span><div class="meta">${dShort(p.best)} · ${num(p.qty)} left</div>`:`<span class="badge low">${d===0?"Today":d+" day"+(d===1?"":"s")}</span><div class="meta">${dShort(p.best)} · ${num(p.qty)} left</div>`); }).join("")
      :`<tr><td><div class="empty-state">${icon("check")}<b>Nothing expiring soon</b>No batches expire in the next 15 days.</div></td></tr>`;
  }
}
function renderTop(){
  $("topBody").innerHTML=DATA.topValue.length?DATA.topValue.map(p=>prodRow(p,`<b>${inr(p.value)}</b><div class="meta">${num(p.qty)} × ${inr(p.price)}</div>`)).join("")
    :`<tr><td><div class="empty-state">${icon("box")}<b>No stock value yet</b>Add stock quantities to see your most valuable products.</div></td></tr>`;
}
document.addEventListener("click",e=>{ const tr=e.target.closest("tr[data-href]"); if(tr) location.href=tr.dataset.href; });
$("attTabs").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; attTab=b.dataset.t;
  $("attTabs").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); renderAttention(); });
$("period").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; days=+b.dataset.d;
  try{ localStorage.setItem("nfpc-dash-days",String(days)); }catch(err){}
  $("period").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); load(); });
// Redraw charts to fit when the window size changes (and when the theme flips, so colours follow).
let rz; addEventListener("resize",()=>{ clearTimeout(rz); rz=setTimeout(()=>DATA&&render(),150); });
new MutationObserver(()=>DATA&&render()).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
load();
