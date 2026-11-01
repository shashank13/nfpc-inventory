// Page markup, carried over unchanged from the PHP version (URLs updated).
// Rendered as static HTML; public/js/dashboard.js adds the behaviour.
export const markup = `<style>
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
      <a class="btn" href="/inventory" id="goInv"></a>
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
      <div class="chart-head"><div><h2>Activity this period</h2><p id="actSub"></p></div><a class="btn sm ghost" href="/activity">Activity log</a></div>
      <div class="act-tiles" id="actTiles"></div>
    </div>
    <div class="card">
      <div class="chart-head"><div><h2>Latest product changes</h2><p>Additions, edits, prints and exports</p></div><a class="btn sm ghost" href="/activity?cat=inventory">See all</a></div>
      <ul class="recent" id="recent"></ul>
    </div>
  </section>
</main>
<div class="tip" id="tip" role="tooltip"></div>
`;
