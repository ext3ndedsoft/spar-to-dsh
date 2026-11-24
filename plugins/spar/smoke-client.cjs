const fs = require("fs");
let spec;
global.window = { __ModuleLoader__: { load(s) { spec = s; } } };
const injectedStyles = [];
global.document = {
  getElementById: (id) => injectedStyles.find((style) => style.id === id) ?? null,
  createElement: () => ({
    style: {},
    append() {},
    remove() {},
    setAttribute() {},
    addEventListener() {},
  }),
  head: { append: (style) => injectedStyles.push(style) },
  querySelector: () => null,
};
global.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
eval(fs.readFileSync("client.js", "utf8"));

let hooks = 0;
const React = {
  useState: (initial) => {
    hooks += 1;
    return [initial, () => {}];
  },
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (initial) => ({ current: initial }),
  createElement: () => ({}),
};

/** Minimal element tree: { type, props, children }. */
function makeElement(type, props) {
  return { type, props: props ?? {} };
}
const jsx = (type, props) => makeElement(type, props);
const jsxs = (type, props) => makeElement(type, props);
const fakeRequire = (name) => (name === "react" ? React : { jsx, jsxs });

const mod = spec.factory(fakeRequire);
if (mod.inject === undefined || !mod.inject.includes("slots")) throw new Error("client half must inject slots");

let component;
let panel;
const ctx = {
  effect(fn) {
    fn();
    return () => {};
  },
  slots: {
    inject(key, cb) {
      const disposer = cb();
      if (typeof disposer !== "function") throw new Error("inject effect must return a disposer");
      return () => {};
    },
    register(options, render) {
      if (options?.name === "tool.call.toolview" && options?.key === "spar") {
        if (typeof render !== "function") throw new Error("component must be a function");
        component = render;
        return () => {};
      }
      if (options?.name === "shell.overlay" && options?.id === "spar") {
        if (typeof render !== "function") throw new Error("panel must be a function");
        panel = render;
        return () => {};
      }
      throw new Error(`unexpected slot ${options?.name}`);
    },
  },
};
mod.apply(ctx);
if (typeof component !== "function") throw new Error("component was not registered");
if (typeof panel !== "function") throw new Error("settings panel was not registered");

const pill = strings(expand(panel())).join(" | ");
if (!pill.includes("spar")) throw new Error(`panel pill rendered "${pill}"`);
console.log(`panel pill: ok — ${pill}`);

// Both stylesheets must be injected: losing the card sheet turns the speaker
// card into unstyled text and stretches the pill across the screen.
const styleIds = injectedStyles.map((style) => style.id);
for (const id of ["dsh-spar-style", "dsh-spar-panel-style"]) {
  if (!styleIds.includes(id)) throw new Error(`stylesheet ${id} was not injected (got ${styleIds.join(", ")})`);
}
const cardCss = injectedStyles.find((style) => style.id === "dsh-spar-style").textContent;
if (!cardCss.includes("[data-spar-head]")) throw new Error("the card sheet lost its head rule");
if (!cardCss.includes("[data-spar-pair]")) throw new Error("the card sheet is missing [data-spar-pair]");
if (cardCss.includes("[data-spar-mine]")) throw new Error("legacy [data-spar-mine] footnote CSS should be removed");
console.log(`styles: ok — ${styleIds.join(", ")}`);

/** Resolve a function element by invoking it, the way the renderer would. */
function expand(node) {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) return node.map(expand);
  if (typeof node === "string") return node;
  if (typeof node === "object" && typeof node.type === "function") return expand(node.type(node.props));
  return node;
}

/** Walk every prop value looking for a string. */
function strings(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) strings(item, out);
    return out;
  }
  if (typeof node === "object") {
    // Components are expanded the way the renderer would, hooks mocked above.
    if (typeof node.type === "function") return strings(node.type(node.props), out);
    if (node.children !== undefined) strings(node.children, out);
    if (node.props !== undefined) strings(node.props?.children, out);
  }
  return out;
}

const cases = [
  ["preparing", { phase: "preparing", callId: "c1", block: undefined, toolName: "spar" }],
  ["start", { phase: "start", callId: "c1", block: undefined, toolName: "spar" }],
  [
    "settled",
    {
      phase: "result",
      callId: "c1",
      toolName: "spar",
      block: {
        type: "tool-result",
        isError: false,
        content: [
          {
            type: "text",
            text: "[spar d1 · r1 · antigravity/gemini-3.8-flash · 7.1s]\n## Возражение\n\nТвоя посылка **не доказана**.\n\n· читал: read docs/A.md",
          },
        ],
      },
    },
  ],
  [
    "async ack",
    {
      phase: "result",
      callId: "c1",
      toolName: "spar",
      block: {
        type: "tool-result",
        isError: false,
        content: [{ type: "text", text: '[spar d2 · reply · antigravity/gemini-3.8-flash · started]\nTurn is running in the background.' }],
      },
    },
  ],
  ["error", { phase: "result", callId: "c1", toolName: "spar", block: { type: "tool-result", isError: true, content: [{ type: "text", text: "spar: provider aborted" }] } }],
  [
    "result receipt",
    {
      phase: "result",
      callId: "c1",
      toolName: "spar",
      block: {
        type: "tool-result",
        isError: false,
        content: [
          {
            type: "text",
            text: "[spar d3 · result r3 · antigravity/gemini-3.8-flash · 42.0s]\nТЕЛО-КОТОРОЕ-НЕ-ДОЛЖНО-ПОВТОРЯТЬСЯ",
          },
        ],
      },
    },
    { has: ["ответ получен", "раунд 3"], missing: ["ТЕЛО-КОТОРОЕ-НЕ-ДОЛЖНО-ПОВТОРЯТЬСЯ"] },
  ],
  [
    "result pending",
    {
      phase: "result",
      callId: "c1",
      toolName: "spar",
      block: {
        type: "tool-result",
        isError: false,
        content: [
          {
            type: "text",
            text: "[spar d3 · result pending · antigravity/gemini-3.8-flash · 120s]\nTurn is still being written.",
          },
        ],
      },
    },
    { has: ["ответ ещё не готов", "ещё пишет"] },
  ],
  [
    "bookkeeping opened is hidden",
    {
      phase: "result",
      callId: "c1",
      toolName: "spar",
      block: { type: "tool-result", isError: false, content: [{ type: "text", text: 'opened d65 · some/model\nSilent start. Send your first argument with action:"say", id:"d65".' }] },
    },
    { empty: true },
  ],
  [
    "list is hidden while it runs",
    { phase: "start", callId: "c1", toolName: "spar", block: { name: "spar", arguments: { action: "list" } } },
    { empty: true },
  ],
  [
    "left final card",
    {
      phase: "result",
      callId: "c1",
      toolName: "spar",
      block: {
        type: "tool-result",
        isError: false,
        content: [
          {
            type: "text",
            text: "[spar d1 · left · r3 · antigravity/gemini-4-carbon]\nМой финальный **тезис**.",
          },
        ],
      },
    },
    { has: ["A отвечает", "gemini-4-carbon", "раунд 3 · финал", "Мой финальный", "тезис"] },
  ],
];

function expandDeep(node) {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) return node.map(expandDeep);
  if (typeof node !== "object") return node;
  if (typeof node.type === "function") return expandDeep(node.type(node.props));
  if (node.props && node.props.children !== undefined) {
    return { ...node, props: { ...node.props, children: expandDeep(node.props.children) } };
  }
  return node;
}

function countAttr(node, attr, count = 0) {
  if (node === null || node === undefined) return count;
  if (Array.isArray(node)) {
    for (const item of node) count = countAttr(item, attr, count);
    return count;
  }
  if (typeof node === "object") {
    if (node.props && Object.prototype.hasOwnProperty.call(node.props, attr)) count += 1;
    if (node.props && node.props.children !== undefined) count = countAttr(node.props.children, attr, count);
  }
  return count;
}

for (const [label, props, expect] of cases) {
  const tree = expand(component(props));
  const text = strings(tree).join(" | ");
  if (expect?.empty === true) {
    if (text.trim() !== "") throw new Error(`${label}: bookkeeping must render nothing, got "${text.slice(0, 120)}"`);
    console.log(`${label}: ok — nothing rendered`);
    continue;
  }  if (text.trim() === "") throw new Error(`${label}: rendered nothing`);
  for (const needle of expect?.has ?? []) {
    if (!text.includes(needle)) throw new Error(`${label}: missing "${needle}" in "${text.slice(0, 200)}"`);
  }
  for (const needle of expect?.missing ?? []) {
    if (text.includes(needle)) throw new Error(`${label}: the body was duplicated ("${needle}")`);
  }
  console.log(`${label}: ok — ${text.slice(0, 110)}`);
}

// Verify that when A speaks to B (live turn with `mine`), both A and B render
// as equal [data-spar-card] speaker cards inside [data-spar-pair], never a footnote.
{
  let callIndex = 0;
  const origUseState = React.useState;
  React.useState = (initial) => {
    callIndex += 1;
    // Inside Card: #1 expanded, #2 useLiveTurn state (live).
    if (callIndex === 2) {
      return [
        {
          known: true,
          done: false,
          id: "d71",
          role: "right",
          phase: "reply",
          route: "coarena-pool/deepseek-v4-1-flash-1017",
          leftRoute: "antigravity/gemini-4-carbon",
          leftRound: 2,
          round: 2,
          mine: "Аргумент **стороны A**",
          text: "Ответ **стороны B**",
          steps: [],
          reasoning: "",
          ms: 4200,
        },
        () => {},
      ];
    }
    return origUseState(initial);
  };
  const pairTree = expandDeep(
    component({
      phase: "result",
      callId: "c_pair",
      toolName: "spar",
      block: {
        type: "tool-result",
        isError: false,
        content: [{ type: "text", text: "[spar d71 · reply · coarena-pool/deepseek-v4-1-flash-1017 · started]\nTurn is running." }],
      },
    }),
  );
  React.useState = origUseState;
  const pairText = strings(pairTree).join(" | ");
  const cards = countAttr(pairTree, "data-spar-card");
  if (cards !== 2) throw new Error(`A+B pair must render 2 equal [data-spar-card] elements, got ${cards}`);
  if (countAttr(pairTree, "data-spar-mine") !== 0) throw new Error("legacy data-spar-mine rendered instead of A card");
  if (!pairText.includes("A отвечает") || !pairText.includes("gemini-4-carbon")) throw new Error(`missing A speaker card header in "${pairText}"`);
  if (!pairText.includes("B отвечает") || !pairText.includes("deepseek-v4-1-flash-1017")) throw new Error(`missing B speaker card header in "${pairText}"`);
  const cardBrands = [];
  const avatarBrands = [];
  const collectBrands = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(collectBrands);
    if (n.props?.["data-spar-card"] !== undefined && n.props?.["data-brand"]) cardBrands.push(n.props["data-brand"]);
    if (n.props?.["data-spar-avatar"] !== undefined && n.props?.["data-brand"]) avatarBrands.push(n.props["data-brand"]);
    if (n.props?.children !== undefined) collectBrands(n.props.children);
  };
  collectBrands(pairTree);
  if (cardBrands.join(",") !== "gemini,deepseek") throw new Error(`expected gemini,deepseek card brands, got ${cardBrands.join(",")}`);
  if (avatarBrands.join(",") !== "gemini,deepseek") throw new Error(`expected gemini,deepseek avatar brands, got ${avatarBrands.join(",")}`);
  console.log("A+B equal speaker pair: ok — 2 speaker cards");
}

// Verify model brand SVG icons for Gemini, Claude, OpenAI/ChatGPT, GLM, DeepSeek, Qwen, Kimi, Grok, Meta, Mistral, MiniMax, Perplexity, Cohere.
{
  const findBrandSvg = (n) => {
    if (!n || typeof n !== "object") return null;
    if (Array.isArray(n)) {
      for (const item of n) {
        const hit = findBrandSvg(item);
        if (hit) return hit;
      }
      return null;
    }
    if (n.props?.["data-spar-avatar"] !== undefined) {
      const serialized = JSON.stringify(n.props.children);
      return { brand: n.props["data-brand"] ?? "", hasSvg: serialized.includes('"type":"svg"'), serialized };
    }
    return n.props?.children !== undefined ? findBrandSvg(n.props.children) : null;
  };
  for (const [route, expected, colorNeedles] of [
    ["antigravity/gemini-3.8-flash", "gemini", ["#3186FF", "#08B962", "#F94543", "#FABC12"]],
    ["anthropic/claude-sonnet-4-6", "claude", ["#D97757"]],
    ["openai/gpt-5", "openai", ["#10A37F"]],
    ["openai/chatgpt-4o-latest", "openai", ["#10A37F"]],
    ["zhipu/glm-4.7", "glm", ["#4F7BFF"]],
    ["coarena-pool/deepseek-v4-1-flash-1017", "deepseek", ["#4D6BFE"]],
    ["dashscope/qwen3-max", "qwen", ["#4F6DFF", "#A855F7"]],
    ["moonshot/kimi-k2", "kimi", ["#1783FF"]],
    ["xai/grok-4", "grok", ["#F4F4F5"]],
    ["meta/llama-4-maverick", "meta", ["#0082FB"]],
    ["mistral/mistral-large", "mistral", ["#FFAF00", "#FA500F", "#E10500"]],
    ["minimax/minimax-m1", "minimax", ["#E2167E", "#FE603C"]],
    ["perplexity/sonar-pro", "perplexity", ["#22B8CD"]],
    ["cohere/command-a", "cohere", ["#39594D", "#D18EE2", "#FF7759"]],
  ]) {
    const tree = expandDeep(
      component({
        phase: "result",
        callId: "c_brand",
        toolName: "spar",
        block: { type: "tool-result", isError: false, content: [{ type: "text", text: `[spar d1 · r1 · ${route} · 1.0s]\nТест.` }] },
      }),
    );
    const hit = findBrandSvg(tree);
    if (!hit || hit.brand !== expected || !hit.hasSvg) {
      throw new Error(`brand icon check failed for ${route}: got ${JSON.stringify(hit)}`);
    }
    for (const color of colorNeedles) {
      if (!hit.serialized.includes(color)) {
        throw new Error(`brand icon ${route} missing official color ${color}`);
      }
    }
  }
  console.log("brand SVG logos: ok — 14 routes matched with official colors");
}

// Regression: when `async: false` completes (phase === "result", no `· started]`),
// a stale `live` snapshot with `done: false` and partial text must NEVER keep the
// card stuck in `working` with "пишет…" or cut off the final answer.
{
  let callIndex = 0;
  const origUseState = React.useState;
  React.useState = (initial) => {
    callIndex += 1;
    if (callIndex === 2) {
      return [
        {
          known: true,
          done: false,
          id: "d72",
          role: "right",
          phase: "reply",
          route: "coarena-pool/deepseek-v4-1-flash-1017",
          leftRoute: "antigravity/gemini-4-carbon",
          leftRound: 1,
          round: 2,
          mine: "Тезис стороны A",
          text: "Обрезанный кус",
          steps: [],
          reasoning: "",
          ms: 8100,
        },
        () => {},
      ];
    }
    return origUseState(initial);
  };
  const settledTree = expandDeep(
    component({
      phase: "result",
      callId: "c_sync_done",
      toolName: "spar",
      block: {
        type: "tool-result",
        isError: false,
        content: [
          {
            type: "text",
            text: "[spar d72 · r2 · coarena-pool/deepseek-v4-1-flash-1017 · 8.7s]\nПолный финальный ответ без обрыва.",
          },
        ],
      },
    }),
  );
  React.useState = origUseState;
  const settledText = strings(settledTree).join(" | ");
  const cards = countAttr(settledTree, "data-spar-card");
  if (cards !== 2) throw new Error(`settled sync result with stale live must render 2 cards, got ${cards}`);
  if (!settledText.includes("Полный финальный ответ без обрыва.")) throw new Error(`settled sync result missing final body: "${settledText}"`);
  if (settledText.includes("пишет…") || settledText.includes("Обрезанный кус")) {
    throw new Error(`settled sync result stayed stuck on stale streaming state: "${settledText}"`);
  }
  console.log("sync settle with stale live: ok — full text, no пишет…");
}

// Verify opening card (`opening: true`) renders A's "A начинает" + "старт" card above B's card.
{
  let callIndex = 0;
  const origUseState = React.useState;
  React.useState = (initial) => {
    callIndex += 1;
    if (callIndex === 2) {
      return [
        {
          known: true,
          done: true,
          opening: true,
          id: "d72",
          role: "right",
          phase: "reply",
          route: "coarena-pool/deepseek-v4-1-flash-1017",
          leftRoute: "antigravity/gemini-4-carbon",
          round: 1,
          mine: "**Тема:** Длинное окно\n\nЯ за компактный контекст.",
          text: "Ответ B на открытие.",
          used: [],
          steps: [],
          reasoning: "",
          ms: 5200,
        },
        () => {},
      ];
    }
    return origUseState(initial);
  };
  const openTree = expandDeep(
    component({
      phase: "result",
      callId: "c_open_ui",
      toolName: "spar",
      block: {
        type: "tool-result",
        isError: false,
        content: [{ type: "text", text: "[spar d72 · reply · coarena-pool/deepseek-v4-1-flash-1017 · started]\nTurn is running." }],
      },
    }),
  );
  React.useState = origUseState;
  const openText = strings(openTree).join(" | ");
  const cards = countAttr(openTree, "data-spar-card");
  if (cards !== 2) throw new Error(`opening turn must render 2 cards (A starts + B replies), got ${cards}`);
  if (!openText.includes("A начинает") || !openText.includes("старт") || !openText.includes("Я за компактный контекст.")) {
    throw new Error(`missing A opening card in "${openText}"`);
  }
  if (!openText.includes("B отвечает") || !openText.includes("Ответ B на открытие.")) {
    throw new Error(`missing B reply card in "${openText}"`);
  }
  console.log("opening A+B pair: ok — A начинает (старт) + B отвечает");
}

// Verify redesigned pill + open panel render brand logos, arena matchup, and debates tab icons.
{
  const seedPanel = (openState, tabState) => {
    let idx = 0;
    const origUseState = React.useState;
    React.useState = (initial) => {
      idx += 1;
      // Panel state slots: 1=open, 2=closing, 3=catalog, 4=state, 5=draft, 6=note, 7=bad, 8=busy, 9=tab, 10=copiedId
      if (idx === 1) return [openState, () => {}];
      if (idx === 3) {
        return [
          {
            providers: [{ id: "coarena-pool", name: "Coarena" }, { id: "antigravity", name: "Antigravity" }],
            models: [
              { provider: "coarena-pool", model: "deepseek-v4-1-flash-1017", label: "coarena-pool/deepseek-v4-1-flash-1017", chat: true },
              { provider: "antigravity", model: "gemini-4-neon", label: "antigravity/gemini-4-neon", chat: true },
            ],
          },
          () => {},
        ];
      }
      if (idx === 4) {
        return [
          {
            saved: {},
            effective: {
              profile: {
                opponent: "coarena-pool/deepseek-v4-1-flash-1017",
                judge: "antigravity/gemini-4-neon",
                challenger: "anthropic/claude-sonnet-4-6",
                language: "ru",
                tools: true,
                selfJudge: false,
                temperatureOpponent: 0.8,
                temperatureJudge: 0.25,
              },
              current: {
                opponent: "coarena-pool/deepseek-v4-1-flash-1017",
                judge: "antigravity/gemini-4-neon",
              },
            },
            debates: [
              {
                id: "d73",
                topic: "Модульный монолит против микросервисов",
                turns: 4,
                closed: false,
                verdict: false,
                leftRoute: "antigravity/gemini-4-carbon",
                rightRoute: "coarena-pool/deepseek-v4-1-flash-1017",
                lastMs: 14200,
              },
            ],
          },
          () => {},
        ];
      }
      if (idx === 9) return [tabState, () => {}];
      return origUseState(initial);
    };
    const tree = expandDeep(panel());
    React.useState = origUseState;
    return tree;
  };

  const closedPill = seedPanel(false, "models");
  const closedSerialized = JSON.stringify(closedPill);
  if (!closedSerialized.includes('"type":"svg"') || !closedSerialized.includes("#4D6BFE") || !closedSerialized.includes("#3186FF")) {
    throw new Error("closed pill must display colored opponent & judge SVG logos");
  }
  if (!strings(closedPill).join(" | ").includes("1")) {
    throw new Error("closed pill must show active debate count");
  }
  console.log("redesigned pill (logos + count): ok");

  const openModels = seedPanel(true, "models");
  const openText = strings(openModels).join(" | ");
  if (!openText.includes("Спарринг") || !openText.includes("1 активн.") || !openText.includes("deepseek-v4-1-flash-1017") || !openText.includes("gemini-4-neon")) {
    throw new Error(`open panel missing expected arena matchup: "${openText.slice(0, 220)}"`);
  }
  if (countAttr(openModels, "data-brand") < 4) {
    throw new Error("open panel missing brand-styled chips/arena sides");
  }
  console.log("redesigned panel (arena + models): ok");

  const openDebates = seedPanel(true, "debates");
  const debatesText = strings(openDebates).join(" | ");
  if (!debatesText.includes("d73") || !debatesText.includes("● открыт") || !debatesText.includes("gemini-4-carbon vs deepseek-v4-1-flash-1017")) {
    throw new Error(`debates tab missing expected row details: "${debatesText}"`);
  }
  console.log("redesigned panel (debates tab): ok");
}

console.log("all card states render");

// Exactly one polling loop may be scheduled per tick. A duplicated `setTimeout`
// in one branch doubles the poll rate on every miss, the tab then spams thousands
// of requests a second, and the page stops accepting input — which is a whole
// session of "не могу отправить промпт" from a two-line slip.
{
  const source = fs.readFileSync("client.js", "utf8");
  const schedulers = source.match(/setTimeout\(\s*tick/g) ?? [];
  if (schedulers.length !== 1) throw new Error(`client.js schedules its poll from ${schedulers.length} places; every tick must go through schedule()`);
  console.log("one poll scheduler: ok");
}