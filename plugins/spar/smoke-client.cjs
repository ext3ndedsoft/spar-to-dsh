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
];

for (const [label, props, expect] of cases) {
  const tree = expand(component(props));
  const text = strings(tree).join(" | ");
  if (text.trim() === "") throw new Error(`${label}: rendered nothing`);
  for (const needle of expect?.has ?? []) {
    if (!text.includes(needle)) throw new Error(`${label}: missing "${needle}" in "${text.slice(0, 200)}"`);
  }
  for (const needle of expect?.missing ?? []) {
    if (text.includes(needle)) throw new Error(`${label}: the body was duplicated ("${needle}")`);
  }
  console.log(`${label}: ok — ${text.slice(0, 110)}`);
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