/**
 * Builds static previews of the spar chat cards and settings overlay for docs.
 *
 * Both stylesheets (`CSS` and `PANEL_CSS`) are extracted directly from
 * `plugins/spar/client.js`, so the preview stays faithful to the real UI.
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

const GEMINI_D =
  'M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z';

const geminiSvg = (size, uid) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <linearGradient id="${uid}-g0" gradientUnits="userSpaceOnUse" x1="7" x2="11" y1="15.5" y2="12"><stop stop-color="#08B962"/><stop offset="1" stop-color="#08B962" stop-opacity="0"/></linearGradient>
    <linearGradient id="${uid}-g1" gradientUnits="userSpaceOnUse" x1="8" x2="11.5" y1="5.5" y2="11"><stop stop-color="#F94543"/><stop offset="1" stop-color="#F94543" stop-opacity="0"/></linearGradient>
    <linearGradient id="${uid}-g2" gradientUnits="userSpaceOnUse" x1="3.5" x2="17.5" y1="13.5" y2="12"><stop stop-color="#FABC12"/><stop offset=".46" stop-color="#FABC12" stop-opacity="0"/></linearGradient>
  </defs>
  <path d="${GEMINI_D}" fill="#3186FF" fill-rule="evenodd" clip-rule="evenodd"/>
  <path d="${GEMINI_D}" fill="url(#${uid}-g0)" fill-rule="evenodd" clip-rule="evenodd"/>
  <path d="${GEMINI_D}" fill="url(#${uid}-g1)" fill-rule="evenodd" clip-rule="evenodd"/>
  <path d="${GEMINI_D}" fill="url(#${uid}-g2)" fill-rule="evenodd" clip-rule="evenodd"/>
</svg>`;

const deepseekSvg = (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
  <path d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z" fill="#4D6BFE" fill-rule="evenodd" clip-rule="evenodd"/>
</svg>`;

const claudeSvg = (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
  <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fill-rule="nonzero" clip-rule="nonzero"/>
</svg>`;

const sparDiamondSvg = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
  <polygon points="12,3.5 20.5,12 12,20.5 3.5,12" fill="none" stroke="#f4f4f5" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="12" cy="12" r="2.2" fill="#f4f4f5"/>
</svg>`;

const sparPillSvg = () => `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
  <polygon points="13,5.5 20.5,13 13,20.5 5.5,13" fill="none" stroke="#f0f0f0" stroke-width="1.7" stroke-linejoin="round"/>
  <circle cx="13" cy="13" r="2" fill="#f0f0f0"/>
</svg>`;

const panelBody = `
<div class="spp" style="--p-left:#4c8dff;--p-opp:#4D6BFE;--p-jud:#4c8dff">
  <div class="panel" data-left-brand="gemini">
    <div class="inner">
      <div class="top">
        <span class="mark">${sparDiamondSvg(15)}</span>
        <div>
          <div class="top-title">
            <h1>Спарринг</h1>
            <span class="top-badge" data-on="1">2 активн.</span>
          </div>
          <small>модели, судья и лимиты · применяются к следующему ходу</small>
        </div>
        <button type="button" class="x" aria-label="Закрыть панель">×</button>
      </div>
      <div class="match">
        <div class="side" data-brand="gemini" style="--rail:#4c8dff">
          <span class="side-av">${geminiSvg(19, 'p-a')}</span>
          <div class="side-txt">
            <i>ваш чат · A</i>
            <b>Gemini 4 Hydrogen</b>
            <em>Antigravity</em>
          </div>
        </div>
        <span class="vs">vs</span>
        <div class="side" data-brand="deepseek" style="--rail:#4D6BFE">
          <span class="side-av">${deepseekSvg(19)}</span>
          <div class="side-txt">
            <i>оппонент · B</i>
            <b>DeepSeek V4.1 Flash</b>
            <em>Coarena Pool</em>
          </div>
        </div>
      </div>
      <div class="arbiter-bar">
        <div class="arb-chip" style="--atint:#4c8dff">
          <span class="pchip" data-brand="gemini" style="--chip:#4c8dff">${geminiSvg(11, 'p-j')}</span>
          <span>судья</span>
          <b>Gemini 4 Neon</b>
          <small>Antigravity</small>
        </div>
        <div class="arb-chip" style="--atint:#D97757">
          <span class="pchip" data-brand="claude" style="--chip:#D97757">${claudeSvg(11)}</span>
          <span>дуэль</span>
          <b>Claude Sonnet 4.6</b>
        </div>
      </div>
      <div class="tabs">
        <button type="button" aria-selected="true">Модели</button>
        <button type="button" aria-selected="false">Параметры</button>
        <button type="button" aria-selected="false">Споры<sup>8</sup></button>
      </div>
      <div class="body">
        <div class="group">
          <h2>Участники</h2>
          <div class="row" style="--rtint:#4D6BFE">
            <label>
              <span class="role-head">оппонент<small>отвечает</small></span>
              <span class="role-pill"><span class="pchip" data-brand="deepseek" style="--chip:#4D6BFE">${deepseekSvg(11)}</span><span>DeepSeek V4.1 Flash</span></span>
            </label>
            <select><option>DeepSeek V4.1 Flash · Coarena Pool</option></select>
          </div>
          <div class="row" style="--rtint:#D97757">
            <label>
              <span class="role-head">вторая сторона<small>для duel</small></span>
              <span class="role-pill"><span class="pchip" data-brand="claude" style="--chip:#D97757">${claudeSvg(11)}</span><span>Claude Sonnet 4.6</span></span>
            </label>
            <select><option>Claude Sonnet 4.6 · Anthropic</option></select>
          </div>
          <div class="row" style="--rtint:#4c8dff">
            <label>
              <span class="role-head">судья<small>приговор</small></span>
              <span class="role-pill"><span class="pchip" data-brand="gemini" style="--chip:#4c8dff">${geminiSvg(11, 'p-r')}</span><span>Gemini 4 Neon</span></span>
            </label>
            <select><option>Gemini 4 Neon · Antigravity</option></select>
          </div>
          <div class="row">
            <div class="lab">судья может спорить<small>одна модель в обеих ролях</small></div>
            <div class="seg">
              <button type="button" data-on="1">профиль · нельзя</button>
              <button type="button" data-on="0">можно</button>
              <button type="button" data-on="0">нельзя</button>
            </div>
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
    <span class="pill-mark">${sparPillSvg()}</span>
    <span class="pill-txt">
      <b>spar</b>
      <span class="pill-cap"><span class="st" data-on="1"></span><span>2 активн.</span></span>
    </span>
    <span class="pill-pair">${geminiSvg(13, 'p-pill')}<span class="pill-vs">×</span>${deepseekSvg(13)}</span>
  </button>
</div>`;

const cardsBody = `
<div class="cards-wrap">
  <div data-spar-pair="">
    <div data-spar-card="" data-tool="spar" data-state="done" data-kind="turn" data-brand="gemini" style="--spar-rail:linear-gradient(180deg,#3186FF,#08B962,#FABC12,#F94543);--spar-tint:#4c8dff">
      <div data-spar-head="">
        <span data-spar-avatar="" data-brand="gemini">${geminiSvg(15, 'c-a')}</span>
        <span data-spar-who="">
          <span data-spar-name="">A отвечает</span>
          <span data-spar-model="">Gemini 4 Hydrogen</span>
        </span>
        <span data-spar-tag="">раунд 2</span>
        <span data-spar-meta="">d14</span>
      </div>
      <div data-spar-body="">
        <p><code>/accounts/pin</code> принимает <code>text/plain</code> без проверки <code>Origin</code> — это обход CORS через simple request.</p>
      </div>
    </div>

    <div data-spar-card="" data-tool="spar" data-state="done" data-kind="turn" data-brand="deepseek" style="--spar-rail:linear-gradient(180deg,#4D6BFE,#38A6F0);--spar-tint:#4D6BFE">
      <div data-spar-head="">
        <span data-spar-avatar="" data-brand="deepseek">${deepseekSvg(15)}</span>
        <span data-spar-who="">
          <span data-spar-name="">B отвечает</span>
          <span data-spar-model="">DeepSeek V4.1 Flash</span>
        </span>
        <span data-spar-tag="">раунд 2</span>
        <span data-spar-meta="">14.2s · d14</span>
      </div>
      <div data-spar-body="">
        <p><b>Уступка:</b> фильтр <code>application/json</code> действительно отсутствует в <code>server.js:88</code>, но маршрут привязан к <code>127.0.0.1</code>.</p>
      </div>
      <div data-spar-foot=""><span>читал:</span><span data-spar-chip=""><span>read server.js (1-140/410)</span></span></div>
    </div>
  </div>

  <div data-spar-card="" data-tool="spar" data-state="done" data-kind="verdict" style="--spar-rail:#e5b83a;--spar-tint:#e5b83a">
    <div data-spar-head="">
      <span data-spar-avatar="">⚖</span>
      <span data-spar-who="">
        <span data-spar-name="">судья</span>
        <span data-spar-model="">Gemini 4 Neon</span>
      </span>
      <span data-spar-tag="" data-tone="verdict">приговор</span>
      <span data-spar-meta="">19.6s · d14</span>
    </div>
    <div data-spar-body="">
      <p><b>Вердикт (победа A):</b> привязка к loopback не защищает от DNS rebinding и cross-origin POST без проверки <code>Host</code> и <code>Origin</code>.</p>
    </div>
    <div data-spar-foot=""><span>читал:</span><span data-spar-chip=""><span>read server.js (80-130/410)</span></span></div>
  </div>

  <div data-spar-card="" data-tool="spar" data-state="running" data-kind="turn" data-brand="claude" style="--spar-rail:linear-gradient(180deg,#D97757,#E89572);--spar-tint:#D97757">
    <div data-spar-head="">
      <span data-spar-avatar="" data-brand="claude">${claudeSvg(15)}</span>
      <span data-spar-who="">
        <span data-spar-name="">B отвечает</span>
        <span data-spar-model="">Claude Sonnet 4.6</span>
      </span>
      <span data-spar-tag="" data-tone="live">пишет</span>
      <span data-spar-meta="">4.8s</span>
    </div>
    <div data-spar-body="">
      <p>Проверяю, закрывает ли <code>sameOriginRefusal()</code> запросы с чужого порта…</p>
    </div>
    <div data-spar-status=""><span data-spar-dot=""></span>читает settings.js · пишет…</div>
  </div>

  <div data-spar-card="" data-tool="spar" data-state="past" data-kind="turn">
    <div data-spar-head="">
      <span data-spar-avatar="">◈</span>
      <span data-spar-who=""><span data-spar-name="">d14 · этап пройден</span></span>
      <span data-spar-tag="">B отвечает</span>
      <span data-spar-meta="">показать ›</span>
    </div>
  </div>
</div>`;

const modeTag = variant === 'panel' ? '01 · SETTINGS OVERLAY' : '02 · DEBATE & VERDICT CARDS';
const rightTag = variant === 'panel' ? '◈ spar' : 'd14 · blind A/B';

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>spar preview · ${variant}</title>
<style>
  html,body{margin:0;width:456px;height:860px;background:#0d1117;overflow:hidden}
  .frame{width:456px;height:860px;padding:16px 12px;box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
    background:#09090c;border:1.5px solid rgba(255,255,255,0.14);border-radius:18px;overflow:hidden}
  .top-bar{width:432px;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
  .tag-blk{display:inline-flex;align-items:center;gap:7px;padding:4px 11px;border-radius:999px;background:#000;color:#fff;border:1px solid rgba(255,255,255,0.14);
    font-family:Consolas,'Cascadia Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.7px}
  .tag-blk i{width:5px;height:5px;border-radius:50%;background:#34d399}
  .tag-wht{padding:4px 11px;border-radius:999px;background:rgba(255,255,255,0.06);color:#f0f0f0;border:1px solid rgba(255,255,255,0.14);
    font-family:Consolas,'Cascadia Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.5px}
${cardCss}
${panelCss}
  .spp{position:relative;right:auto;bottom:auto;width:432px}
  .spp .panel{width:432px}
  .spp .inner{max-height:none}
  .spp .body{overflow:visible}
  .spp, .spp *{animation:none !important;transition:none !important;opacity:1 !important}
  .cards-wrap{width:432px;display:flex;flex-direction:column;gap:10px}
  .cards-wrap [data-spar-card]{margin:0}
  .cards-wrap [data-spar-pair]{margin:0}
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
