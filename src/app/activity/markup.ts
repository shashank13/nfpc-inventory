// Page markup, carried over unchanged from the PHP version (URLs updated).
// Rendered as static HTML; public/js/activity.js adds the behaviour.
export const markup = `<style>
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
  /* Phones: each entry becomes a card: time on the left; who, what, item and details stacked. */
  @media (max-width:640px){
    .act-table thead{display:none}
    .act-table,.act-table tbody{display:block}
    .act-table tbody tr:not(.day-row){display:grid;grid-template-columns:auto minmax(0,1fr);
      grid-template-areas:"when who" "when act" "when item" "when detail";gap:4px 12px;padding:12px 16px;border-bottom:1px solid var(--border)}
    .act-table tbody tr:not(.day-row) td{display:block;padding:0;border:0;background:none!important}
    .act-table tbody tr:not(.day-row) td:nth-child(1){grid-area:when}
    .act-table tbody tr:not(.day-row) td:nth-child(2){grid-area:who}
    .act-table tbody tr:not(.day-row) td:nth-child(3){grid-area:act}
    .act-table tbody tr:not(.day-row) td:nth-child(4){grid-area:item;max-width:none}
    .act-table tbody tr:not(.day-row) td:nth-child(5){grid-area:detail;max-width:none}
    .act-table tbody tr.day-row td{display:block}
    .act-table tbody tr:not(.day-row) td.act-ip{display:none}
    .filters .search-box{flex-basis:100%}
    .pager nav{margin-left:0}
  }
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
`;
