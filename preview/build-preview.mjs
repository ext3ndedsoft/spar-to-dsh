/**
 * Builds static previews of the spar chat cards and settings overlay for docs.
 *
 * Both stylesheets (`CSS` and `PANEL_CSS`) are extracted directly from
 * `plugins/spar/client.js`, so the preview stays faithful to the real UI while
 * framing it in the repo's high-contrast B&W manga style.
 *
 *   node preview/build-preview.mjs panel
 *   node preview/build-preview.mjs cards
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const variant = (process.argv[2] || 'panel').toLowerCase();
if (!['panel', 'cards'].includes(variant)) {
  console.error('usage: node preview/build-preview.mjs panel|cards');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.resolve(here, '..', 'plugins', 'spar', 'client.js');
const client = fs.readFileSync(clientPath, 'utf8');

const cardCssMatch = client.match(/const CSS = `([\s\S]*?)`;/);
const panelCssMatch = client.match(/const PANEL_CSS = `([\s\S]*?)`;/);
if (!cardCssMatch || !panelCssMatch) {
  console.error('cannot find CSS / PANEL_CSS in plugins/spar/client.js');
  process.exit(1);
}

const cardCss = cardCssMatch[1];
const panelCss = panelCssMatch[1];

const panelBody = `
<div class="spp">
  <div class="panel">
    <div class="inner">
      <div class="top">
        <span class="mark">◈</span>
        <div>
          <h1>Спарринг</h1>
          <small>модели, судья и лимиты · применяются к следующему ходу</small>
        </div>
        <button type="button" class="x" aria-label="Закрыть панель">×</button>
      </div>
      <div class="match">
        <div class="side" style="--rail:#ffffff">
          <i>оппонент</i>
          <b>gemini-3.8-flash</b>
          <em>antigravity</em>
        </div>
        <span class="vs">·</span>
        <div class="side" style="--rail:#a1a1aa">
          <i>судья</i>
          <b>deepseek-v4.1-flash</b>
          <em>zexkora</em>
        </div>
      </div>
      <div class="tabs">
        <button type="button" aria-selected="true">Модели</button>
        <button type="button" aria-selected="false">Параметры</button>
        <button type="button" aria-selected="false">Споры<sup>4</sup></button>
      </div>
      <div class="body">
        <div class="group">
          <h2>Кто спорит</h2>
          <div class="row">
            <label>оппонент<small>отвечает на ваши аргументы</small></label>
            <select><option>antigravity/gemini-3.8-flash</option></select>
          </div>
          <div class="row">
            <label>вторая сторона дуэли<small>для режима duel</small></label>
            <select><option>как в профиле · claude-sonnet-4.6</option></select>
          </div>
          <div class="row">
            <label>судья<small>выносит приговор</small></label>
            <select><option>zexkora/deepseek-v4.1-flash</option></select>
          </div>
          <div class="row">
            <label>судья может участвовать<small>одна модель и в споре, и на суде</small></label>
            <select><option>как в профиле · нельзя</option></select>
          </div>
        </div>
        <div class="group">
          <h2>Язык</h2>
          <div class="row">
            <div class="lab">язык спора</div>
            <div class="seg">
              <button type="button" data-on="1">русский</button>
              <button type="button" data-on="0">english</button>
              <button type="button" data-on="0">как в профиле</button>
            </div>
          </div>
        </div>
      </div>
      <div class="foot">
        <button type="button" class="save">Сохранить</button>
        <button type="button" class="ghost">Обновить</button>
        <span class="note">сохранено · следующий ход</span>
      </div>
    </div>
  </div>
  <button type="button" class="pill">
    <span class="mark">◈</span>
    <b>spar</b>
    <span class="live" data-on="1"></span>
  </button>
</div>`;

const cardsBody = `
<div class="cards-wrap">
  <div data-spar-card="" data-state="done" data-kind="turn" style="--spar-rail:#ffffff;--spar-tint:#ffffff">
    <div data-spar-head="">
      <span data-spar-avatar="">◈</span>
      <span data-spar-who="">gemini-3.8-flash</span>
      <span data-spar-tag="">раунд 2</span>
      <span data-spar-meta="">d14 · 14.2s</span>
    </div>
    <div data-spar-body="">
      <p>Тезис «в <code>src</code> нет утечки» не держится: в <code>server.js</code> обработчик <code>/accounts/pin</code> принимает <code>text/plain</code> без проверки <code>Origin</code>.</p>
      <p><b>Что проверит спор:</b> отправь POST с <code>Origin: https://evil.example</code> — сейчас вернётся <code>200</code> вместо <code>403</code>.</p>
    </div>
    <div data-spar-trail="">читал: server.js (1-140/410) · http.js (1-65/120)</div>
  </div>

  <div data-spar-card="" data-state="done" data-kind="verdict" style="--spar-rail:#ffffff;--spar-tint:#ffffff">
    <div data-spar-head="">
      <span data-spar-avatar=""><svg width="13" height="13" viewBox="0 0 24 24"><path d="M12 4v16M7 20h10M5 8h14M5 8l-2.5 5h5L5 8zm14 0l-2.5 5h5L19 8z" fill="none" stroke="#0a0a0a" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span data-spar-who="">deepseek-v4.1-flash</span>
      <span data-spar-tag="">приговор</span>
      <span data-spar-meta="">d14 · 19.6s</span>
    </div>
    <div data-spar-body="">
      <p><b>Стальман сторон:</b> A опирается на отсутствие CORS-заголовков; B указывает на simple-request обход через <code>text/plain</code>.</p>
      <p><b>Вердикт (победа B):</b> проверка <code>server.js:88-104</code> подтверждает аргумент B — фильтр <code>application/json</code> и проверка <code>Origin</code> отсутствуют.</p>
    </div>
    <div data-spar-trail="">читал: server.js (80-130/410) · test-integration.mjs (350-380/424)</div>
  </div>

  <div data-spar-card="" data-state="running" data-kind="turn" style="--spar-rail:#ffffff;--spar-tint:#ffffff">
    <div data-spar-head="">
      <span data-spar-avatar="">◈</span>
      <span data-spar-who="">claude-sonnet-4.6</span>
      <span data-spar-tag="">дуэль · B</span>
      <span data-spar-meta="">d15 · 4.8s</span>
    </div>
    <div data-spar-body="">
      <p>Проверяю, закрывает ли <code>isLocal()</code> DNS rebinding при обращении с локальной вкладки…</p>
    </div>
    <div data-spar-status=""><span data-spar-dot=""></span>читает server.js · пишет…</div>
  </div>

  <div data-spar-card="" data-state="past" data-kind="turn" style="--spar-rail:#a1a1aa">
    <div data-spar-head="">
      <span data-spar-avatar="">◈</span>
      <span data-spar-who="">gemini-3.8-flash</span>
      <span data-spar-tag="">раунд 1</span>
      <span data-spar-meta="">d14 · 11.8s · свернуто</span>
    </div>
  </div>
</div>`;

const modeTag = variant === 'panel' ? '01 · SETTINGS OVERLAY' : '02 · DEBATE & VERDICT CARDS';
const rightTag = variant === 'panel' ? '◈ spar' : 'd14 · blind A/B';

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>spar preview · ${variant}</title>
<style>
  html,body{margin:0;width:456px;height:860px;background:#0d1117;overflow:hidden}
  .frame{width:456px;height:860px;padding:20px 24px;box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
    background:#ffffff;border:2px solid #0a0a0a;border-radius:18px;overflow:hidden}
  .top-bar{width:408px;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
  .tag-blk{display:inline-flex;align-items:center;gap:7px;padding:4px 11px;border-radius:999px;background:#0a0a0a;color:#fff;
    font-family:Consolas,'Cascadia Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.7px}
  .tag-blk i{width:5px;height:5px;border-radius:50%;background:#fff}
  .tag-wht{padding:4px 11px;border-radius:999px;background:#fff;color:#0a0a0a;border:1.5px solid #0a0a0a;box-shadow:2px 2px 0 #0a0a0a;
    font-family:Consolas,'Cascadia Mono',monospace;font-size:10px;font-weight:800;letter-spacing:0.5px}
${cardCss}
${panelCss}
  /* Pure B&W manga contrast overrides after real stylesheets */
  .spp{position:relative;right:auto;bottom:auto;width:408px;
    --p-fg:#f4f4f5;--p-dim:#a1a1aa;--p-faint:#71717a;--p-line:rgba(255,255,255,.12);--p-card:rgba(255,255,255,.04);
    --p-accent:#ffffff;--p-accent2:#ffffff;--p-gold:#ffffff;--p-bad:#d4d4d8}
  .spp .panel{width:408px;background:#0a0a0a;border:2px solid #0a0a0a;box-shadow:6px 6px 0 rgba(10,10,10,0.22)}
  .spp .inner{max-height:none}
  .spp .body{overflow:visible}
  .spp .pill{background:#0a0a0a;border:2px solid #0a0a0a;box-shadow:4px 4px 0 rgba(10,10,10,0.22)}
  .spp .live[data-on="1"]{box-shadow:0 0 6px rgba(255,255,255,0.7)}
  .spp, .spp *{animation:none !important;transition:none !important;opacity:1 !important}

  .cards-wrap{width:408px;display:flex;flex-direction:column;gap:14px}
  [data-spar-card]{margin:0;background:#0a0a0a;border:2px solid #0a0a0a;box-shadow:6px 6px 0 rgba(10,10,10,0.22);
    --spar-fg:#f4f4f5;--spar-dim:#a1a1aa;--spar-line:rgba(255,255,255,.14);--spar-surface:#0a0a0a;--spar-gold:#ffffff;--spar-bad:#d4d4d8}
  [data-spar-card][data-kind="verdict"]{--spar-mark:#ffffff;border-color:#0a0a0a;background:#0a0a0a}
  [data-spar-card][data-state="past"]{background:#141416;border:1.5px solid #0a0a0a;box-shadow:4px 4px 0 rgba(10,10,10,0.16)}
  [data-spar-avatar]{background:#ffffff !important;color:#0a0a0a !important}
  [data-spar-dot]{background:#ffffff !important;box-shadow:0 0 6px rgba(255,255,255,0.7) !important}
  [data-spar-status]{margin-top:8px;display:flex;align-items:center;gap:7px;font-size:11px;color:#d4d4d8}
  [data-spar-tag]{background:rgba(255,255,255,0.10);color:#ffffff;border:1px solid rgba(255,255,255,0.22);padding:1px 7px;border-radius:999px;font-size:10px}
  [data-spar-meta]{margin-left:auto;color:#a1a1aa;font-size:10.5px;font-family:Consolas,'Cascadia Mono',monospace}
  [data-spar-body]{font-size:12.5px;line-height:1.5;color:#e4e4e7}
  [data-spar-body] p{margin:0 0 8px}
  [data-spar-body] p:last-child{margin-bottom:0}
  [data-spar-body] code{background:rgba(255,255,255,0.10);padding:1px 5px;border-radius:5px;font-family:Consolas,'Cascadia Mono',monospace;font-size:11px;color:#ffffff}
  [data-spar-trail]{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.10);font-family:Consolas,'Cascadia Mono',monospace;font-size:10px;color:#a1a1aa}
</style></head>
<body>
<div class="frame">
  <div class="top-bar">
    <span class="tag-blk"><i></i>${modeTag}</span>
    <span class="tag-wht">${rightTag}</span>
  </div>
  ${variant === 'panel' ? panelBody : cardsBody}
</div>
</body></html>`;

const out = path.join(here, `preview-${variant}.html`);
fs.writeFileSync(out, html);
console.log('written:', out, `(${html.length} bytes)`);
