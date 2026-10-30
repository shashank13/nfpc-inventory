<?php
/**
 * Dashboard: stock value, alerts, category breakdown, stock movement, upcoming expiries,
 * products needing attention and (for people who can see the activity log) recent activity.
 * Every signed-in user can open it; activity sections need the "View activity log" permission.
 */
define('NFPC_APP', true);
require __DIR__ . '/auth.php';
require __DIR__ . '/ui.php';

start_session();
try {
    app_db();
} catch (Exception $e) {
    error_log('dashboard.php DB error: ' . $e->getMessage());
    redirect('login.php');
}
$me = current_user();
if (!$me) redirect('login.php');
if ($me['mustChange']) redirect('account.php');

page_head('Dashboard');
?>
<body>
<div id="topbar" class="topbar"></div>
<style>
  /* Chart colours (validated: colour-blind safe, ≥3:1 on the card in both themes). */
  .viz{--viz-seq:#2a78d6;--viz-up:#2a78d6;--viz-down:#e34948;--viz-good:#0ca30c;--viz-warn:#fab219;--viz-crit:#d03b3b;
       --viz-grid:#e1e0d9;--viz-axis:#c3c2b7;--viz-muted:#898781}
  @media (prefers-color-scheme: dark){ :root:where(:not([data-theme="light"])) .viz{--viz-seq:#3987e5;--viz-up:#3987e5;--viz-down:#e66767;--viz-grid:#2c2c2a;--viz-axis:#383835} }
  :root[data-theme="dark"] .viz{--viz-seq:#3987e5;--viz-up:#3987e5;--viz-down:#e66767;--viz-grid:#2c2c2a;--viz-axis:#383835}

  .filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}
  .filters .lbl{font-size:13px;color:var(--muted);font-weight:600}
  .seg{display:inline-flex;border:1px solid var(--border-strong);border-radius:8px;padding:2px;gap:2px;background:var(--surface-2)}
  .seg button{border:0;background:none;padding:6px 12px;border-radius:6px;font:inherit;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer}
  .seg button.on{background:var(--surface);color:var(--text);box-shadow:var(--shadow-sm)}
  .refreshed{font-size:12px;color:var(--muted);margin-left:auto}

  .top-row{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,2fr);gap:16px;margin-bottom:16px}
  .hero{display:flex;flex-direction:column;justify-content:center}
  .hero .k{font-size:13px;color:var(--muted);font-weight:600}
  .hero .v{font-size:48px;font-weight:700;line-height:1.1;letter-spacing:-.02em;margin:4px 0}
  .hero .sub{font-size:13px;color:var(--text-2)}
  .alerts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .alert-tile{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border-radius:12px;border:1px solid var(--border);background:var(--surface);
    text-decoration:none;color:var(--text);box-shadow:var(--shadow-sm);transition:border-color .15s,transform .15s}
  .alert-tile:hover{border-color:var(--border-strong);transform:translateY(-1px);color:var(--text)}
  .alert-tile .t{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-2);font-weight:600}
  .alert-tile .t svg{width:16px;height:16px;flex:none}
  .alert-tile .n{font-size:26px;font-weight:700;line-height:1.1}
  .alert-tile .go{font-size:12px;color:var(--muted)}
  .alert-tile.warn .t svg{color:#b7791f} .alert-tile.crit .t svg{color:var(--viz-crit)} .alert-tile.good .t svg{color:var(--viz-good)}
  .alert-tile.zero .n{color:var(--muted)}

  .dash-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:16px}
  .chart-card{display:flex;flex-direction:column;min-width:0}
  .chart-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
  .chart-head h2{margin:0;font-size:15px}
  .chart-head p{margin:2px 0 0;font-size:12.5px;color:var(--muted)}
  .chart{position:relative;min-height:60px}
  .chart svg{display:block;width:100%;overflow:visible}
  .chart text{font:12px var(--font);fill:var(--muted)}
  .chart text.lbl{fill:var(--text-2)}
  .chart text.val{fill:var(--text);font-weight:600}
  .chart .mark{cursor:default;outline:none;transition:opacity .12s}
  .chart .mark:hover,.chart .mark:focus-visible{opacity:.78}
  .chart .mark:focus-visible{stroke:var(--text);stroke-width:1.5}
  .legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:12.5px;color:var(--text-2)}
  .legend span{display:inline-flex;align-items:center;gap:6px}
  .legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
  .legend svg{width:14px;height:14px}
  .legend b{color:var(--text)}
  .totals{display:flex;gap:18px;flex-wrap:wrap;margin-top:8px;font-size:13px;color:var(--text-2)}
  .totals b{color:var(--text);font-size:15px}
  .by-cat{margin-top:18px;border-top:1px solid var(--border);padding-top:12px}
  .by-cat-h{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:4px}
  .by-cat table{font-size:13px}
  .by-cat th,.by-cat td{padding:6px 8px}
  .by-cat .num{text-align:right;font-variant-numeric:tabular-nums;width:60px}
  .by-cat tr[data-href]{cursor:pointer}
  .catdot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px}
  .empty-chart svg{width:16px;height:16px;vertical-align:-3px;color:var(--viz-good)}
  .empty-chart{display:grid;place-items:center;min-height:160px;color:var(--muted);font-size:13px;text-align:center}
  .tbl-view table{font-size:12.5px}
  .tbl-view td,.tbl-view th{padding:6px 10px}
  .tbl-view td.num,.tbl-view th.num{text-align:right;font-variant-numeric:tabular-nums}
  .tip{position:fixed;z-index:80;pointer-events:none;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-lg);
    border-radius:8px;padding:8px 10px;font-size:12.5px;min-width:120px;display:none}
  .tip .tv{font-size:15px;font-weight:700;color:var(--text)}
  .tip .tl{color:var(--muted)}
  .tip .row{display:flex;align-items:center;gap:8px}
  .tip .key{width:12px;height:2px;border-radius:1px;flex:none}

  .list-card table{font-size:13px}
  .list-card td{padding:9px 12px}
  .list-card td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .list-card tr[data-href]{cursor:pointer}
  .pname{font-weight:600}
  .meta{font-size:11.5px;color:var(--muted)}
  .mini-tabs{display:inline-flex;gap:2px}
  .act-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .act-tiles div{background:var(--surface-2);border-radius:10px;padding:10px 12px}
  .act-tiles .k{font-size:12px;color:var(--muted)} .act-tiles .v{font-size:20px;font-weight:700}
  .recent{list-style:none;margin:0;padding:0}
  .recent li{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);font-size:13px}
  .recent li:last-child{border-bottom:0}
  .recent .when{color:var(--muted);font-size:12px;white-space:nowrap;min-width:64px}
  .recent .what b{font-weight:600}
  .loading-dim{opacity:.55;transition:opacity .2s}
  @media (max-width:1100px){.top-row{grid-template-columns:1fr}.alerts{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media (max-width:860px){.dash-grid{grid-template-columns:1fr}.hero .v{font-size:40px}}
  @media (max-width:520px){.act-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>

<main class="page viz" id="dash">
  <div class="page-head">
    <div><h1>Dashboard</h1><p id="hello"></p></div>
    <div class="page-actions">
      <a class="btn" href="inventory-barcode.html" id="goInv"></a>
    </div>
  </div>

  <div class="filters" role="group" aria-label="Period">
    <span class="lbl">Period</span>
    <div class="seg" id="period">
      <button data-d="7">Last 7 days</button><button data-d="30" class="on">Last 30 days</button><button data-d="90">Last 90 days</button>
    </div>
    <span class="refreshed" id="refreshed"></span>
  </div>

  <section class="top-row">
    <div class="card hero" aria-live="polite">
      <div class="k">Stock value at MRP · right now</div>
      <div class="v" id="heroValue">–</div>
      <div class="sub" id="heroSub"></div>
    </div>
    <div class="alerts" id="alerts"></div>
  </section>

  <section class="dash-grid">
    <div class="card chart-card">
      <div class="chart-head"><div><h2>Stock value by category</h2><p>MRP × packs in stock, right now</p></div><button class="btn sm ghost" data-table="cat">Table</button></div>
      <div class="chart" id="chCat"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-head"><div><h2>Stock health</h2><p id="healthSub">Products by stock level, right now</p></div><button class="btn sm ghost" data-table="health">Table</button></div>
      <div class="chart" id="chHealth"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-head"><div><h2>Stock added and removed</h2><p id="moveSub"></p></div><button class="btn sm ghost" data-table="move">Table</button></div>
      <div class="chart" id="chMove"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-head"><div><h2>Upcoming expiries</h2><p>Batches reaching their best-before date, by week</p></div><button class="btn sm ghost" data-table="expiry">Table</button></div>
      <div class="chart" id="chExpiry"></div>
    </div>
  </section>

  <section class="dash-grid">
    <div class="card list-card" style="padding:0">
      <div class="chart-head" style="padding:18px 18px 0">
        <div><h2>Needs attention</h2><p id="attSub"></p></div>
        <div class="seg mini-tabs" id="attTabs"><button data-t="low" class="on">Low stock</button><button data-t="exp">Expiring</button></div>
      </div>
      <div class="table-wrap"><table><tbody id="attBody"></tbody></table></div>
    </div>
    <div class="card list-card" style="padding:0">
      <div class="chart-head" style="padding:18px 18px 0"><div><h2>Top products by stock value</h2><p>Where most of your stock value sits</p></div></div>
      <div class="table-wrap"><table><tbody id="topBody"></tbody></table></div>
    </div>
  </section>

  <section class="dash-grid hidden" id="activityRow">
    <div class="card">
      <div class="chart-head"><div><h2>Activity this period</h2><p id="actSub"></p></div><a class="btn sm ghost" href="activity.php">Activity log</a></div>
      <div class="act-tiles" id="actTiles"></div>
    </div>
    <div class="card">
      <div class="chart-head"><div><h2>Latest product changes</h2><p>Additions, edits, prints and exports</p></div><a class="btn sm ghost" href="activity.php?cat=inventory">See all</a></div>
      <ul class="recent" id="recent"></ul>
    </div>
  </section>
</main>
<div class="tip" id="tip" role="tooltip"></div>

<script>
const ME=<?php echo user_json($me); ?>;
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
    tile("warn","warn","Low stock",k.low_stock,"inventory-barcode.html?status=low",`Below ${D.lowLimit} packs · view list`)+
    tile("crit","alert","Out of stock",k.out_stock,"inventory-barcode.html?status=low","0 packs left · view list")+
    tile("warn","clock","Expiring ≤ 15 days",k.expiring,"inventory-barcode.html?status=exp","Sell or move first · view list")+
    tile("crit","x","Expired, still in stock",k.expired_in_stock,"inventory-barcode.html?status=expired","Remove from shelves · view list");

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
      short.map(c=>`<tr data-href="inventory-barcode.html?status=low&amp;cat=${encodeURIComponent(c.cat)}"><td><span class="catdot" style="background:${/^#[0-9a-f]{6}$/i.test(c.color)?c.color:"#6b7a8f"}"></span>${esc(c.cat)}</td><td class="num">${num(c.low)}</td><td class="num">${num(c.out_stock)}</td></tr>`).join("")}</tbody></table></div>`
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
      template_created:"added label template",template_updated:"edited label template",template_deleted:"deleted label template",labels_printed:"printed labels for",labels_downloaded:"downloaded labels for",inventory_exported:"exported"};
    $("recent").innerHTML=D.recent.length?D.recent.map(r=>`<li><span class="when" title="${esc(App.fmtDateTime(r.created_at))}">${esc(App.timeAgo(r.created_at))}</span>
      <span class="what"><b>${esc(r.username||"—")}</b>${r.via?` <span class="meta">(by ${esc(r.via)})</span>`:""} ${esc(EV[r.event]||r.event.replace(/_/g," "))} <b>${esc(r.target)}</b><div class="meta">${esc(r.detail)}</div></span></li>`).join("")
      :`<li class="meta">No product activity yet.</li>`;
  }
}
const prodRow=(p,right)=>`<tr data-href="inventory-barcode.html?q=${encodeURIComponent(p.sku)}"><td><div class="pname">${esc(p.name)} <span class="meta">· ${esc(p.net)} ${esc(p.unit)}</span></div><div class="meta">${esc(p.cat)} · ${esc(p.sku)}</div></td><td class="num">${right}</td></tr>`;
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
</script>
</body>
</html>
