/**
 * Signed-in pages (dashboard, inventory, activity, users) are the PHP version's markup and script,
 * served as static HTML. For speed:
 *  - the data the page would fetch first is embedded in the HTML (<script id="preload">), so the
 *    page draws immediately instead of waiting for a second request;
 *  - the page script is a plain deferred script, so it starts as soon as the HTML is parsed rather
 *    than after React has loaded.
 * Everything the script changes lives inside this raw-HTML block, which React never re-renders.
 */
import { COPYRIGHT_OWNER, DEVELOPER } from "@/lib/config";
import { today } from "@/lib/format";
import { jsonForScript } from "@/lib/json";
import { ASSET_VERSION } from "./ui";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Footer shown on every signed-in page (built per request, so the year stays current). */
export function footerHtml(): string {
  return (
    `<footer class="app-foot">` +
    `<span>&copy; ${today().slice(0, 4)} ${esc(COPYRIGHT_OWNER)} All rights reserved.</span>` +
    `<span>Nitte Farmers Producer Company Ltd. · NMAMIT Campus, Nitte, Udupi, Karnataka · CIN U01110KA2021PTC149385</span>` +
    `<span>Developed by <a href="${esc(DEVELOPER.url)}" target="_blank" rel="noopener">${esc(DEVELOPER.name)}</a></span>` +
    `</footer>`
  );
}

export interface AppPageProps {
  /** The page's markup (from markup.ts). */
  markup: string;
  /** Script in /public/js, without ".js". */
  script: string;
  /** Signed-in user JSON (from userJson), for pages that read it. */
  meJson?: string;
  /** API responses the page will ask for first, keyed exactly as the page requests them. */
  preload?: Record<string, unknown>;
  /** Markup inside the top bar before the script fills it. */
  topbarInner?: string;
}

export function AppPage({ markup, script, meJson, preload, topbarInner = "" }: AppPageProps) {
  // Replace the page's own footer (if any) with the shared one, or add it.
  const footer = footerHtml();
  const body = /<footer class="app-foot">[\s\S]*?<\/footer>/.test(markup)
    ? markup.replace(/<footer class="app-foot">[\s\S]*?<\/footer>/, footer)
    : markup.replace(/(<\/main>)/, `$1\n${footer}`);
  const html =
    `<div id="topbar" class="topbar">${topbarInner}</div>\n` +
    body +
    (meJson ? `<script id="me-data" type="application/json">${meJson}</script>` : "") +
    (preload && Object.keys(preload).length ? `<script id="preload" type="application/json">${jsonForScript(preload)}</script>` : "") +
    `<script defer src="/js/${script}.js?v=${ASSET_VERSION}"></script>`;
  return <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: html }} />;
}
