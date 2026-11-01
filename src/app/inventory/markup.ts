// Page markup, carried over unchanged from the PHP version (URLs updated).
// Rendered as static HTML; public/js/inventory.js adds the behaviour.
export const markup = `<style>
  /* Page-specific styles. Colours, buttons, inputs, modals and badges come from assets/app.css. */
  label{margin:10px 0 5px}
  .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}
  .stat{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow-sm);display:flex;gap:12px;align-items:center;min-width:0}
  .stat .ic{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex:none}
  .stat .ic svg{width:19px;height:19px}
  .stat.warn .ic{background:var(--warn-soft);color:var(--warn)} .stat.danger .ic{background:var(--danger-soft);color:var(--danger)}
  .stat .k{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .stat .v{font-size:21px;font-weight:700;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .stat.warn .v{color:var(--warn)} .stat.danger .v{color:var(--danger)}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
  .chip{border:1px solid var(--border);background:var(--surface);border-radius:99px;padding:6px 12px;font-size:12.5px;cursor:pointer;display:flex;gap:6px;align-items:center;color:var(--text);font-family:inherit;font-weight:500;transition:.15s}
  .chip:hover{border-color:var(--border-strong);background:var(--surface-2)}
  .chip b{color:var(--muted);font-weight:600}
  .chip.active{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
  .chip.active b{color:var(--accent-ink)}
  .grid{display:grid;grid-template-columns:370px minmax(0,1fr);gap:20px;align-items:start}
  .grid.single{grid-template-columns:minmax(0,1fr)}
  /* Add / edit product window: header and Save buttons stay put; only the fields scroll on very small screens. */
  .modal .box.product-box{max-width:900px;padding:0;display:flex;flex-direction:column;overflow:hidden;max-height:94vh}
  .product-box form{display:flex;flex-direction:column;min-height:0;flex:1}
  .pm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 22px 4px}
  .pm-head .lead{margin:2px 0 0}
  .pm-body{padding:0 22px 10px;overflow:auto;flex:1;min-height:0}
  .pm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 14px;align-items:end}
  .pm-grid .span2{grid-column:span 2}
  .pack-row{display:flex;gap:6px}
  .pack-row input{flex:1 1 55%;min-width:0}
  .pack-row select{flex:1 1 45%;min-width:0}
  .pm-grid .preview{margin-top:0;min-height:38px;height:38px;padding:3px 8px;border-radius:8px}
  .pm-grid .preview svg{max-height:32px;width:auto}
  .pm-grid .preview .empty{font-size:12px}
  .req{color:var(--danger);font-weight:700}
  .pm-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 22px;border-top:1px solid var(--border);background:var(--surface-2)}
  .pm-keys{font-size:12px;color:var(--muted)}
  kbd{font:600 11px var(--mono);padding:1px 5px;border:1px solid var(--border-strong);border-bottom-width:2px;border-radius:4px;background:var(--surface);color:var(--text-2)}
  .product-box.editing .pm-head h3::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:2px}
  @media (max-width:760px){.pm-grid{grid-template-columns:1fr 1fr}.pm-grid .span2{grid-column:1/-1}.pm-keys{display:none}}
  @media (max-width:480px){.pm-grid{grid-template-columns:1fr}.pm-foot .btn{flex:1}}
  .sku-row{display:flex;gap:8px}
  .sku-hint{min-height:18px}
  .tok-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .tok{border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text);border-radius:6px;padding:3px 8px;font:12px var(--mono);cursor:pointer}
  .tok:hover{border-color:var(--accent);color:var(--accent)}
  .sku-example{margin-top:12px;padding:10px 12px;background:var(--surface-2);border-radius:8px;font-size:13px;overflow-wrap:anywhere}
  .sku-example b{font-size:14px}
  .mono,.sku-row input,#fBatch{font-family:var(--mono)}
  .section-t{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);font-weight:700;margin:18px 0 0;padding-top:14px;border-top:1px solid var(--border)}
  .preview{margin-top:14px;border:1px dashed var(--border-strong);border-radius:10px;padding:14px;background:#fff;text-align:center;min-height:110px;display:grid;place-items:center}
  .preview svg{max-width:100%;height:auto}
  .preview .empty{color:#8a958c;font-size:13px}
  .err{color:var(--danger);font-size:12.5px;margin-top:6px;min-height:16px}
  .actions{display:flex;gap:8px;margin-top:12px}
  .actions .btn{flex:1}
  .scan{display:flex;gap:10px;align-items:center;background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 25%,var(--border));border-radius:10px;padding:10px 12px;margin-bottom:14px}
  .scan svg{flex:none;width:22px;height:22px;color:var(--accent)}
  .scan input{background:var(--surface);font-family:var(--mono)}
  .inv-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
  .inv-head h2{margin:0}
  .inv-count{font-size:12.5px;color:var(--muted)}
  #invTable{min-width:820px}
  #invTable td.sel,#invTable th.sel{width:38px;padding-right:0}
  #invTable td.sel input,#invTable th.sel input{width:17px;height:17px}
  #invTable tr.selected td{background:color-mix(in srgb,var(--accent) 8%,transparent)}
  .bulkbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;margin-bottom:10px;border-radius:10px;
    background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border))}
  .bulkbar #selCount{font-weight:700;font-size:13.5px;padding-left:4px}
  .bulkbar #selAllItems{color:var(--accent)}
  .pager{display:flex;align-items:center;gap:10px 16px;flex-wrap:wrap;padding-top:14px;margin-top:4px;border-top:1px solid var(--border);font-size:13px}
  .pg-size{display:flex;align-items:center;gap:8px}
  .pg-size label{margin:0;font-weight:500;color:var(--muted);font-size:13px;white-space:nowrap}
  .pg-size select{width:auto;min-height:30px;padding:0 26px 0 8px}
  .pg-info{color:var(--muted)}
  .pg-nav{display:flex;align-items:center;gap:4px;margin-left:auto;flex-wrap:wrap}
  .pg-num{min-width:30px;padding:0 8px}
  .pg-num.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
  .pg-gap{color:var(--muted);padding:0 2px}
  #invTable td:first-child:not(.sel),#invTable td.sel+td{min-width:170px}
  #invTable td,#invTable th{padding-left:10px;padding-right:10px}
  #invTable td.batch-cell,#invTable td.nw{white-space:nowrap}
  #invTable th{position:sticky;top:0;z-index:1}
  tr.hit td{background:color-mix(in srgb,var(--accent) 14%,transparent)!important}
  .thumb{background:#fff;border-radius:6px;padding:4px 6px;display:inline-block;border:1px solid var(--border)}
  .thumb svg{height:28px;width:96px;display:block}
  .pname{font-weight:600}
  .meta{font-size:11.5px;color:var(--muted)}
  .catdot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:1px}
  .row-actions{display:flex;gap:6px;justify-content:flex-end}
  .nodata{text-align:center;color:var(--muted);padding:30px}
  .banner{margin-bottom:16px}
  .banner a{font-weight:600}
  /* product label (rendered as one SVG everywhere: preview, print, downloads, ZIP) */
  .lbl{background:#fff;line-height:0}
  .lbl svg{width:100%;height:auto;display:block}
  /* label template editor */
  .tpl-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:20px;align-items:start}
  .tpl-form{max-height:68vh;overflow:auto;padding-right:6px}
  .tpl-prev{position:sticky;top:0;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:14px}
  .tpl-prev .lbl{box-shadow:var(--shadow);border-radius:14px}
  .tpl-top{display:flex;gap:8px;align-items:center}
  .tpl-top select{flex:1}
  .checks{display:grid;grid-template-columns:repeat(3,1fr);gap:2px 10px}
  .checks label.inline{margin:6px 0 0}
  .logo-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .logo-row select{flex:1;min-width:150px}
  .logo-thumb{width:46px;height:46px;border:1px solid var(--border);border-radius:8px;background:#fff;object-fit:contain;display:none}
  .modal .actions .spacer{flex:2}
  .modal .actions{justify-content:stretch}
  @media (max-width:800px){.tpl-grid{grid-template-columns:1fr}.tpl-form{max-height:none}.tpl-prev{position:static}.checks{grid-template-columns:1fr 1fr}}
  .box.wide{max-width:980px}
  /* Bulk upload: file / paste switch and the paste grid */
  .seg{display:inline-flex;border:1px solid var(--border-strong);border-radius:8px;padding:2px;gap:2px;background:var(--surface-2)}
  .seg button{border:0;background:none;padding:6px 12px;border-radius:6px;font:inherit;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer}
  .seg button.on{background:var(--surface);color:var(--text);box-shadow:var(--shadow-sm)}
  .paste-wrap{max-height:300px;overflow:auto;margin-top:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
  table.paste-grid{border-collapse:collapse;min-width:1180px;font-size:12.5px}
  .paste-grid th{position:sticky;top:0;z-index:1;background:var(--surface-2);padding:6px 8px;font-size:11px;border-bottom:1px solid var(--border-strong)}
  .paste-grid th .req{margin-left:2px}
  .paste-grid td{padding:0;border:1px solid var(--border)}
  .paste-grid td.rn{padding:0 6px;color:var(--muted);text-align:right;background:var(--surface-2);font-size:11px;width:36px;user-select:none}
  .paste-grid input{border:0;border-radius:0;min-height:28px;height:28px;padding:0 6px;font-size:12.5px;background:transparent;width:100%;min-width:84px;box-shadow:none}
  .paste-grid input:focus{box-shadow:inset 0 0 0 2px var(--accent);background:var(--surface)}
  .paste-grid tr.bad td.rn{color:var(--danger);font-weight:700}
  .paste-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
  /* Bulk upload: file / paste switch and the paste grid */
  .seg{display:inline-flex;border:1px solid var(--border-strong);border-radius:8px;padding:2px;gap:2px;background:var(--surface-2)}
  .seg button{border:0;background:none;padding:6px 12px;border-radius:6px;font:inherit;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer}
  .seg button.on{background:var(--surface);color:var(--text);box-shadow:var(--shadow-sm)}
  .paste-wrap{max-height:300px;overflow:auto;margin-top:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
  table.paste-grid{border-collapse:collapse;min-width:1180px;font-size:12.5px}
  .paste-grid th{position:sticky;top:0;z-index:1;background:var(--surface-2);padding:6px 8px;font-size:11px;border-bottom:1px solid var(--border-strong)}
  .paste-grid th .req{margin-left:2px}
  .paste-grid td{padding:0;border:1px solid var(--border)}
  .paste-grid td.rn{padding:0 6px;color:var(--muted);text-align:right;background:var(--surface-2);font-size:11px;width:36px;user-select:none}
  .paste-grid input{border:0;border-radius:0;min-height:28px;height:28px;padding:0 6px;font-size:12.5px;background:transparent;width:100%;min-width:84px;box-shadow:none}
  .paste-grid input:focus{box-shadow:inset 0 0 0 2px var(--accent);background:var(--surface)}
  .paste-grid tr.bad td.rn{color:var(--danger);font-weight:700}
  .paste-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
  .drop{border:2px dashed var(--border-strong);border-radius:12px;padding:22px;text-align:center;background:var(--surface-2);transition:.15s}
  .drop.over{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--surface-2))}
  label.inline{display:flex;align-items:center;gap:8px;margin:10px 0 0;color:var(--text);font-weight:500;font-size:13px;cursor:pointer}
  .prev-wrap{max-height:340px;overflow:auto;margin-top:10px;border:1px solid var(--border);border-radius:10px}
  table.prev{min-width:920px;font-size:12.5px}
  table.prev th{position:sticky;top:0;background:var(--surface);z-index:1}
  table.prev td{padding:6px 10px}
  .summary{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .notes{color:var(--muted);font-size:12px}
  .notes .e{color:var(--danger)}
  .progress{height:8px;border-radius:99px;background:var(--surface-2);overflow:hidden;margin-top:16px}
  .progress div{height:100%;width:0;background:var(--accent);transition:width .15s}
  #printArea{display:none}
  @media (max-width:1366px){.grid{grid-template-columns:330px minmax(0,1fr)}}
  @media (max-width:1100px){.stats{grid-template-columns:repeat(3,1fr)}}
  @media (max-width:1000px){.grid{grid-template-columns:minmax(0,1fr)}.form-card{position:static;max-height:none}}
  @media (max-width:560px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat{padding:12px}.stat .ic{display:none}.stat .v{font-size:18px}.row3{grid-template-columns:1fr 1fr}.page-actions{width:100%}.page-actions>*{flex:1}}
  /* Label-printer (roll) preview: the box has the physical label's shape. */
  .lbl.roll{display:flex;align-items:center;justify-content:center;outline:1px dashed var(--border-strong);max-height:62vh;margin:0 auto}
  .lbl.roll svg{width:100%;height:100%}
  .print-info{margin-top:8px}
  .print-info .warn-text{color:var(--warn);font-weight:600}
  .size2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  /* Phones: each product becomes a card (no sideways scrolling to reach price, stock or actions). */
  @media (max-width:640px){
    #invTable{min-width:0}
    #invTable thead{display:none}
    #invTable,#invTable tbody{display:block}
    #invTable tbody tr[data-id]{display:grid;grid-template-columns:auto minmax(0,1fr) auto;
      grid-template-areas:"sel prod prod" "sel mrp stock" "sel best batch" "sel bar act";gap:8px 12px;padding:14px 2px;border-bottom:1px solid var(--border)}
    #invTable tbody tr[data-id] td{display:block;padding:0;border:0;min-width:0!important;background:none!important}
    #invTable tbody tr[data-id]:last-child{border-bottom:0}
    #invTable tr.selected{background:color-mix(in srgb,var(--accent) 8%,transparent)}
    #invTable tr.hit{background:color-mix(in srgb,var(--accent) 14%,transparent)}
    #invTable td.sel{grid-area:sel;padding-top:2px!important}
    #invTable td.c-prod{grid-area:prod}
    #invTable td.c-mrp{grid-area:mrp;align-self:center;font-weight:700;font-size:15px}
    #invTable td.c-mrp::before{content:"MRP ";font-weight:500;font-size:12px;color:var(--muted)}
    #invTable td.c-stock{grid-area:stock;justify-self:end;align-self:center}
    #invTable td.c-best{grid-area:best}
    #invTable td.c-batch{grid-area:batch;justify-self:end;text-align:right}
    #invTable td.c-bar{grid-area:bar;align-self:end}
    #invTable td.c-bar .mono{white-space:nowrap}
    #invTable td.c-act{grid-area:act;align-self:end}
    #invTable td.c-act .btn.icon{width:36px;min-height:36px}
    #invTable td.c-act .btn{min-height:36px}
    #invTable tbody tr:not([data-id]) td{display:block}
  }
  @media print{
    body{background:#fff}
    .page,.topbar,.app-foot,.modal,.toasts{display:none!important}
    #printArea{display:grid;grid-template-columns:repeat(var(--per,3),1fr);gap:8px;padding:8px}
    #printArea .lbl{break-inside:avoid}
    /* Barcode / label printer: one printed page per row of labels, exactly the label size, no margins. */
    html,body{margin:0!important;padding:0!important}
    #printArea.roll{display:block;padding:0;gap:0}
    #printArea.roll .roll-page{display:flex;overflow:hidden;break-after:page;page-break-after:always;margin:0;padding:0}
    #printArea.roll .roll-page:last-child{break-after:auto;page-break-after:auto}
    #printArea.roll .roll-lbl{flex:none;display:flex;align-items:center;justify-content:center;overflow:hidden}
    #printArea.roll .roll-lbl svg{width:100%;height:100%;display:block}
  }
</style>
<main class="page">
  <div class="page-head">
    <div>
      <h1>Inventory</h1>
      <p>Farm produce stock, batches and barcode labels · <span id="todayStr"></span></p>
    </div>
    <div class="page-actions">
      <button class="btn hidden" id="openTpl"><span data-ic="tag" style="display:contents"></span>Label templates</button>
      <div class="dd hidden" id="exportDd">
        <button class="btn" data-menu aria-haspopup="menu" aria-expanded="false"><span data-ic="download" style="display:contents"></span>Export<span data-ic="chev" style="display:contents"></span></button>
        <div class="menu" role="menu">
          <button class="menu-item" role="menuitem" id="openZip"><span data-ic="zip" style="display:contents"></span>Download barcodes (ZIP)</button>
          <button class="menu-item" role="menuitem" id="printAll"><span data-ic="printer" style="display:contents"></span>Print labels (all matching)</button>
          <button class="menu-item" role="menuitem" id="exportCsv"><span data-ic="file" style="display:contents"></span>Export inventory (CSV)</button>
        </div>
      </div>
      <button class="btn hidden" id="openBulk"><span data-ic="upload" style="display:contents"></span>Bulk upload</button>
      <button class="btn primary hidden" id="addProductBtn" title="Add product (N)"><span data-ic="plus" style="display:contents"></span>Add product</button>
    </div>
  </div>

  <div id="banners"></div>

  <section class="stats" aria-label="Summary">
    <div class="stat"><span class="ic" data-ic="box"></span><div style="min-width:0"><div class="k">Products</div><div class="v" id="sProducts">–</div></div></div>
    <div class="stat"><span class="ic" data-ic="inventory"></span><div style="min-width:0"><div class="k">Packs in stock</div><div class="v" id="sUnits">–</div></div></div>
    <div class="stat"><span class="ic" data-ic="rupee"></span><div style="min-width:0"><div class="k">Stock value (MRP)</div><div class="v" id="sValue">–</div></div></div>
    <div class="stat warn"><span class="ic" data-ic="warn"></span><div style="min-width:0"><div class="k">Low / out of stock</div><div class="v" id="sLow">–</div></div></div>
    <div class="stat danger"><span class="ic" data-ic="clock"></span><div style="min-width:0"><div class="k">Expiring ≤ 15 days</div><div class="v" id="sExp">–</div></div></div>
  </section>

  <nav class="chips" id="chips"></nav>

  <div class="grid single" id="mainGrid">
    <!-- Inventory -->
    <section class="card" aria-labelledby="invTitle">
      <div class="inv-head"><h2 id="invTitle">Stock list</h2><span class="inv-count" id="invCount"></span></div>
      <div class="scan">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8"/></svg>
        <input id="scanInput" placeholder="Scan a barcode (USB scanner) or type a SKU and press Enter" aria-label="Scan barcode">
      </div>
      <div class="toolbar">
        <div class="search-box"><span data-ic="search" style="display:contents"></span><input type="search" id="search" placeholder="Search product, SKU, batch, village…" aria-label="Search inventory"></div>
        <select id="filterStatus" style="width:auto" aria-label="Filter by stock status">
          <option value="">All stock</option>
          <option value="low">Low / out of stock</option>
          <option value="exp">Expiring ≤ 15 days</option>
          <option value="expired">Expired</option>
        </select>
      </div>
      <div class="bulkbar hidden" id="bulkBar" role="region" aria-label="Selected products">
        <span id="selCount"></span>
        <button type="button" class="btn sm ghost" id="selAllItems"></button>
        <span class="spacer"></span>
        <button type="button" class="btn sm" id="selPrint"><span data-ic="printer" style="display:contents"></span>Print labels</button>
        <button type="button" class="btn sm danger-solid" id="selDelete"><span data-ic="trash" style="display:contents"></span>Delete selected</button>
        <button type="button" class="btn sm ghost" id="selClear">Clear</button>
      </div>
      <div class="table-wrap">
        <table id="invTable">
          <thead><tr><th class="sel hidden" id="selTh"><input type="checkbox" id="selAll" aria-label="Select all shown products"></th><th>Product</th><th>Barcode</th><th>Batch</th><th>MRP</th><th>Stock</th><th>Best before</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody id="tbody">
            <tr><td colspan="8"><span class="skel" style="width:70%"></span></td></tr>
            <tr><td colspan="8"><span class="skel" style="width:55%"></span></td></tr>
            <tr><td colspan="8"><span class="skel" style="width:62%"></span></td></tr>
          </tbody>
        </table>
      </div>
      <div class="pager hidden" id="pager"></div>
    </section>
  </div>
</main>
<footer class="app-foot">
  <span>Nitte Farmers Producer Company Ltd. · NMAMIT Campus, Nitte, Udupi, Karnataka</span>
  <span>CIN U01110KA2021PTC149385</span>
</footer>

<!-- Add / edit product window: everything fits on one screen; the Save buttons are always visible. -->
<div class="modal" id="productModal" role="dialog" aria-modal="true" aria-labelledby="formTitle" data-close="pmClose">
  <div class="box product-box">
    <form id="form" autocomplete="off">
      <div class="pm-head">
        <div>
          <h3 id="formTitle">Add product</h3>
          <p class="lead" id="formSub">Fill in the details. Batch number, best-before date and barcode are filled in for you.</p>
        </div>
        <button type="button" class="btn icon ghost" id="pmClose" aria-label="Close"><span data-ic="x" style="display:contents"></span></button>
      </div>
      <div class="pm-body">
        <div class="pm-grid">
          <div class="span2">
            <label for="fName">Product name <span class="req" aria-hidden="true">*</span></label>
            <input id="fName" required maxlength="150" placeholder="e.g. Red Rice (Kajé Akki)" list="nameHints">
            <datalist id="nameHints"></datalist>
          </div>
          <div>
            <label for="fCat">Category</label>
            <select id="fCat"></select>
          </div>

          <div>
            <label for="fGrade">Variety / grade</label>
            <input id="fGrade" maxlength="100" placeholder="Organic, Grade A…">
          </div>
          <div>
            <label for="fNet">Pack size <span class="req" aria-hidden="true">*</span></label>
            <div class="pack-row">
              <input id="fNet" type="number" min="0.001" max="9999999" step="any" required placeholder="1">
              <select id="fUnit" aria-label="Unit"><option>kg</option><option>g</option><option>L</option><option>ml</option><option>pcs</option><option>dozen</option><option>bunch</option></select>
            </div>
          </div>
          <div>
            <label for="fQty">Packs in stock <span class="req" aria-hidden="true">*</span></label>
            <input id="fQty" type="number" min="0" max="2000000000" step="1" required placeholder="0">
          </div>

          <div>
            <label for="fPrice">MRP per pack (₹) <span class="req" aria-hidden="true">*</span></label>
            <input id="fPrice" type="number" min="0" max="99999999.99" step="0.01" required placeholder="0.00">
          </div>
          <div>
            <label for="fLoc">Storage location</label>
            <input id="fLoc" maxlength="100" placeholder="Godown 1 / Cold room">
          </div>
          <div>
            <label for="fSource">Sourced from (farmer / village)</label>
            <input id="fSource" maxlength="150" placeholder="Kedinje farmers group">
          </div>

          <div>
            <label for="fBatch">Batch / lot no.</label>
            <input id="fBatch" maxlength="50" placeholder="Auto">
          </div>
          <div>
            <label for="fPacked">Packed / harvested on <span class="req" aria-hidden="true">*</span></label>
            <input id="fPacked" type="date" required>
          </div>
          <div>
            <label for="fBest">Best before <span class="req" aria-hidden="true">*</span></label>
            <input id="fBest" type="date" required>
          </div>

          <div class="span2">
            <label for="fSku">SKU / barcode value</label>
            <div class="sku-row">
              <input id="fSku" maxlength="64" placeholder="Made automatically" autocomplete="off" spellcheck="false" aria-describedby="skuHint">
              <button type="button" class="btn" id="genSku" title="Make a new SKU from the SKU format">Generate</button>
              <button type="button" class="btn icon hidden" id="skuFmtBtn" title="SKU format settings" aria-label="SKU format settings"><span data-ic="settings" style="display:contents"></span></button>
            </div>
            <div class="help sku-hint" id="skuHint"></div>
          </div>
          <div class="preview" id="preview" aria-label="Barcode preview"><span class="empty">Barcode preview</span></div>
        </div>
        <div class="err" id="err" role="alert"></div>
      </div>
      <div class="pm-foot">
        <span class="pm-keys"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> save · <kbd>Esc</kbd> close</span>
        <span class="spacer"></span>
        <button type="button" class="btn" id="resetBtn">Clear</button>
        <button type="submit" class="btn" id="saveAnother">Save &amp; add another</button>
        <button type="submit" class="btn primary" id="saveBtn">Save product</button>
      </div>
    </form>
  </div>
</div>

<!-- SKU format settings -->
<div class="modal" id="skuModal" role="dialog" aria-modal="true" aria-labelledby="skuTitle" data-close="skCancel">
  <div class="box" style="max-width:600px">
    <h3 id="skuTitle">SKU format</h3>
    <p class="lead">How new SKUs (barcode values) are made. Existing products keep their SKU, and any SKU can still be typed or edited by hand.</p>
    <label class="inline"><input type="checkbox" id="skAuto"> Fill in the SKU automatically when adding a product</label>
    <div class="row">
      <div>
        <label for="skPreset">Style</label>
        <select id="skPreset">
          <option value="{PREFIX}-{CAT}-{RAND:5}">Random number · NFPC-GRP-48213</option>
          <option value="{PREFIX}-{CAT}-{SEQ:5}">Running number per category · NFPC-GRP-00001</option>
          <option value="{PREFIX}{YY}{MM}{SEQ:4}">Year + month + running number · NFPC26100001</option>
          <option value="{CAT}{SEQ:6}">Category + running number · GRP000001</option>
          <option value="{PREFIX}-{NAME:4}-{SEQ:3}">Product name + running number · NFPC-REDR-001</option>
          <option value="custom">Custom format…</option>
        </select>
      </div>
      <div>
        <label for="skPrefix">Company code <span class="muted" style="font-weight:400">({PREFIX})</span></label>
        <input id="skPrefix" maxlength="10" autocomplete="off" spellcheck="false" style="text-transform:uppercase">
      </div>
    </div>
    <label for="skFormat">Format</label>
    <input id="skFormat" class="mono" maxlength="60" autocomplete="off" spellcheck="false">
    <div class="tok-list" id="skTokens" aria-label="Insert a code">
      <button type="button" class="tok" data-tok="{PREFIX}" title="Company code">{PREFIX}</button>
      <button type="button" class="tok" data-tok="{CAT}" title="Category code (GRP, OIL, …)">{CAT}</button>
      <button type="button" class="tok" data-tok="{NAME:4}" title="First 4 letters of the product name">{NAME:4}</button>
      <button type="button" class="tok" data-tok="{SEQ:5}" title="Running number, 5 digits">{SEQ:5}</button>
      <button type="button" class="tok" data-tok="{RAND:5}" title="5 random digits">{RAND:5}</button>
      <button type="button" class="tok" data-tok="{YYYY}" title="Year (2026)">{YYYY}</button>
      <button type="button" class="tok" data-tok="{YY}" title="Year (26)">{YY}</button>
      <button type="button" class="tok" data-tok="{MM}" title="Month (01–12)">{MM}</button>
      <button type="button" class="tok" data-tok="{DD}" title="Day (01–31)">{DD}</button>
    </div>
    <div class="notes" style="margin-top:8px"><b>{SEQ:5}</b> continues from the highest existing SKU of the same shape (00001, 00002, …), so numbers never repeat. <b>{RAND:5}</b> picks random digits. Use one of them in every format. Change the number to set how many digits; anything else you type (- / . letters) is kept as it is.</div>
    <div class="sku-example">Next SKU: <b class="mono" id="skExample">—</b> <span class="notes" id="skExampleFor"></span></div>
    <div class="err" id="skErr" role="alert"></div>
    <div class="actions">
      <button class="btn" id="skCancel">Cancel</button>
      <button class="btn primary" id="skSave">Save format</button>
    </div>
  </div>
</div>

<div class="modal" id="modal" role="dialog" aria-modal="true" aria-label="Product label">
  <div class="box" style="max-width:520px">
    <h3>Product label</h3>
    <div id="labelHolder"></div>
    <div class="notes print-info" id="lPrintInfo"></div>
    <div class="row">
      <div>
        <label for="lTpl">Label template</label>
        <select id="lTpl"></select>
      </div>
      <div>
        <label for="copies">Copies to print</label>
        <input id="copies" type="number" min="1" max="60" value="1">
      </div>
    </div>
    <div class="actions">
      <button class="btn sm" id="dlLabelPng">Label PNG</button>
      <button class="btn sm" id="dlLabelSvg">Label SVG</button>
      <button class="btn sm" id="dlPng">Barcode PNG</button>
      <button class="btn sm" id="dlSvg">Barcode SVG</button>
    </div>
    <div class="actions">
      <button class="btn" id="closeModal">Close</button>
      <button class="btn primary" id="printOne">Print</button>
    </div>
  </div>
</div>

<!-- Bulk upload modal -->
<div class="modal" id="bulkModal" role="dialog" aria-modal="true" aria-label="Bulk upload products">
  <div class="box wide">
    <h3>Bulk upload products</h3>
    <div class="seg" id="bulkMode" role="tablist" aria-label="How to add the products" style="margin-top:8px">
      <button type="button" data-m="file" class="on" role="tab" aria-selected="true">Upload a file</button>
      <button type="button" data-m="paste" role="tab" aria-selected="false">Paste from Excel</button>
    </div>
    <div class="notes" style="margin-top:10px">Required columns: <b>Product</b> and <b>MRP</b>. If SKU, batch or best-before is left blank, it's generated automatically. Dates can be YYYY-MM-DD, DD-MM-YYYY or 30-Oct-2026.</div>
    <div id="filePanel">
      <div class="drop" id="drop" style="margin-top:12px">
        <input type="file" id="bulkFile" accept=".csv,.tsv,.txt,.xlsx,.xls" hidden>
        <b>Drop a CSV or Excel (.xlsx) file here</b> or <button type="button" class="btn sm" id="pickFile">Choose file</button>
        <div class="notes" id="fileName" style="margin-top:6px"></div>
      </div>
    </div>
    <div id="pastePanel" class="hidden">
      <div class="notes" style="margin-top:10px">In Excel, select the cells (include the heading row if you like) and press <kbd>Ctrl</kbd>+<kbd>C</kbd>. Click a cell below — usually the first one — and press <kbd>Ctrl</kbd>+<kbd>V</kbd>. With headings, each column goes to the matching column here; without, values fill in from the cell you clicked. You can also type and correct cells directly.</div>
      <div class="paste-wrap"><table class="paste-grid" id="pasteGrid"><thead></thead><tbody></tbody></table></div>
      <div class="paste-bar">
        <button type="button" class="btn sm" id="pasteAddRows">Add 10 rows</button>
        <button type="button" class="btn sm ghost" id="pasteClear">Clear all</button>
        <span class="notes" id="pasteCount"></span>
      </div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:10px">
      <button type="button" class="btn sm" id="dlTemplate">Download template (CSV)</button>
      <label class="inline" style="margin:0"><input type="checkbox" id="bulkUpdate" checked> Update existing products when the SKU matches</label>
    </div>
    <div class="summary" id="bulkSummary"></div>
    <div class="prev-wrap" id="bulkPrevWrap" style="display:none">
      <table class="prev">
        <thead><tr><th>Row</th><th>Status</th><th>Product</th><th>Category</th><th>Pack</th><th>Stock</th><th>MRP</th><th>Packed</th><th>Best before</th><th>SKU</th><th>Notes</th></tr></thead>
        <tbody id="bulkBody"></tbody>
      </table>
    </div>
    <div class="actions">
      <button class="btn" id="bulkCancel">Cancel</button>
      <button class="btn primary" id="bulkImport" disabled>Import</button>
    </div>
  </div>
</div>

<!-- ZIP download modal -->
<div class="modal" id="zipModal" role="dialog" aria-modal="true" aria-label="Download barcodes">
  <div class="box">
    <h3>Download barcodes as a folder (ZIP)</h3>
    <label for="zContent">What to include</label>
    <select id="zContent">
      <option value="label">Full product labels</option>
      <option value="barcode">Barcode only</option>
      <option value="both">Both labels and barcodes</option>
    </select>
    <label for="zTpl">Label template</label>
    <select id="zTpl"></select>
    <label for="zFormat">Image format</label>
    <select id="zFormat">
      <option value="png">PNG (high resolution, ready to print)</option>
      <option value="svg">SVG (vector, for designers / label software)</option>
      <option value="both">PNG + SVG</option>
    </select>
    <label for="zScope">Products</label>
    <select id="zScope"></select>
    <label class="inline"><input type="checkbox" id="zByCat" checked> Put each category in its own sub-folder</label>
    <div class="progress"><div id="zBar"></div></div>
    <div class="notes" id="zStatus" style="margin-top:6px">Includes an index.csv listing every file.</div>
    <div class="actions">
      <button class="btn" id="zCancel">Close</button>
      <button class="btn primary" id="zGo">Download ZIP</button>
    </div>
  </div>
</div>

<!-- Label template editor -->
<div class="modal" id="tplModal" role="dialog" aria-modal="true" aria-label="Label templates" data-close="tClose">
  <div class="box wide" style="max-width:1100px">
    <h3>Label templates</h3>
    <div class="tpl-grid">
      <form class="tpl-form" id="tplForm" autocomplete="off" onsubmit="return false">
        <div class="tpl-top">
          <select id="tSel" aria-label="Choose template"></select>
          <button type="button" class="btn sm" id="tNew">New</button>
          <button type="button" class="btn sm" id="tDup">Duplicate</button>
        </div>
        <label for="tName">Template name</label>
        <input id="tName" maxlength="80" required placeholder="e.g. Honey jar label">
        <label class="inline"><input type="checkbox" id="tDefault"> Use as the default template</label>

        <div class="section-t">Printer &amp; label size</div>
        <div class="row">
          <div>
            <label for="tMedia">Print on</label>
            <select id="tMedia">
              <option value="roll">Barcode / label printer (roll)</option>
              <option value="sheet">Normal printer (A4 sheet)</option>
            </select>
          </div>
          <div>
            <label for="tLayout">Label layout</label>
            <select id="tLayout">
              <option value="full">Full label</option>
              <option value="compact">Compact (small labels)</option>
              <option value="barcode">Barcode + price only</option>
            </select>
          </div>
        </div>
        <div id="tRollOpts">
          <div class="row">
            <div>
              <label for="tSize">Label size (width × height)</label>
              <select id="tSize">
                <option value="38x25">38 × 25 mm</option>
                <option value="50x25">50 × 25 mm</option>
                <option value="50x30">50 × 30 mm</option>
                <option value="50x38">50 × 38 mm</option>
                <option value="60x40">60 × 40 mm</option>
                <option value="75x50">75 × 50 mm</option>
                <option value="100x50">100 × 50 mm</option>
                <option value="100x75">100 × 75 mm</option>
                <option value="100x100">100 × 100 mm</option>
                <option value="100x150">100 × 150 mm</option>
                <option value="custom">Custom size…</option>
              </select>
            </div>
            <div class="size2" id="tCustom">
              <div><label for="tW">Width (mm)</label><input id="tW" type="number" min="15" max="220" step="0.5"></div>
              <div><label for="tH">Height (mm)</label><input id="tH" type="number" min="10" max="300" step="0.5"></div>
            </div>
          </div>
          <div class="row">
            <div>
              <label for="tAcross">Labels across the roll</label>
              <select id="tAcross"><option>1</option><option>2</option><option>3</option><option>4</option></select>
            </div>
            <div>
              <label for="tGap">Gap between labels across (mm)</label>
              <input id="tGap" type="number" min="0" max="10" step="0.5">
            </div>
          </div>
          <label class="inline"><input type="checkbox" id="tMono"> Black only (thermal printers can't print colour)</label>
          <div class="notes" style="margin-top:6px">Set the label printer's driver to this label size. When printing, choose the label printer, set <b>Margins: None</b> and <b>Scale: 100%</b>, and turn off headers and footers.</div>
        </div>
        <div id="tSheetOpts">
          <label for="tPerRow">Labels per row (A4)</label>
          <select id="tPerRow"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
        </div>

        <div class="section-t">Brand</div>
        <label for="tBrand">Brand / company name</label>
        <input id="tBrand" maxlength="80" required>
        <label for="tTagline">Tagline (optional)</label>
        <input id="tTagline" maxlength="100" placeholder="e.g. From our farmers to your home">
        <label for="tLogoMode">Logo</label>
        <div class="logo-row">
          <select id="tLogoMode">
            <option value="default">Default leaf icon</option>
            <option value="custom">My logo (upload)</option>
            <option value="none">No logo</option>
          </select>
          <img class="logo-thumb" id="tLogoThumb" alt="Logo preview">
          <button type="button" class="btn sm" id="tLogoPick">Upload logo…</button>
          <input type="file" id="tLogoFile" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden>
        </div>
        <div class="notes">PNG with a transparent background looks best. Large images are shrunk automatically.</div>
        <div class="row">
          <div>
            <label for="tColor">Brand colour</label>
            <input id="tColor" type="color" value="#2f7d32">
          </div>
          <div>
            <label for="tHeader">Header style</label>
            <select id="tHeader">
              <option value="band">Coloured band</option>
              <option value="line">White with coloured text</option>
            </select>
          </div>
        </div>

        <div class="section-t">Show on label</div>
        <div class="checks" id="tShow">
          <label class="inline"><input type="checkbox" data-k="net"> Net qty</label>
          <label class="inline"><input type="checkbox" data-k="batch"> Batch</label>
          <label class="inline"><input type="checkbox" data-k="packed"> Packed date</label>
          <label class="inline"><input type="checkbox" data-k="best"> Best before</label>
          <label class="inline"><input type="checkbox" data-k="grade"> Grade</label>
          <label class="inline"><input type="checkbox" data-k="source"> Sourced from</label>
          <label class="inline"><input type="checkbox" data-k="mrp"> MRP</label>
          <label class="inline"><input type="checkbox" data-k="barcodeText"> SKU under barcode</label>
          <label class="inline"><input type="checkbox" data-k="footer"> Footer</label>
        </div>

        <div class="section-t">Text</div>
        <label for="tMrpText">MRP caption</label>
        <input id="tMrpText" maxlength="60">
        <label for="tAddress">Address</label>
        <input id="tAddress" maxlength="200">
        <div class="row">
          <div><label for="tCin">CIN</label><input id="tCin" maxlength="40"></div>
          <div><label for="tFssai">FSSAI licence no.</label><input id="tFssai" maxlength="30"></div>
        </div>
        <label for="tContact">Contact (phone / email / website)</label>
        <input id="tContact" maxlength="80">
        <label for="tNote">Extra footer note</label>
        <input id="tNote" maxlength="150" placeholder="e.g. Store in a cool, dry place">
        <div class="err" id="tErr"></div>
      </form>

      <div class="tpl-prev">
        <label for="tPrevItem" style="margin-top:0">Preview with product</label>
        <select id="tPrevItem"></select>
        <div id="tPreview" style="margin-top:12px"></div>
        <div class="notes print-info" id="tPrintInfo"></div>
      </div>
    </div>
    <div class="actions">
      <button class="btn danger" id="tDelete">Delete template</button>
      <span class="spacer"></span>
      <button class="btn" id="tClose">Close</button>
      <button class="btn primary" id="tSave">Save template</button>
    </div>
  </div>
</div>

<div id="printArea"></div>
`;
