// spar — a second model on the other side of the table.
//
// The bridge already lets DSH *talk to* Gemini. This plugin does something
// different: it keeps a live, persistent argument between two models, where the
// other side is instructed to break the calling agent's claims instead of
// agreeing with them. The calling agent speaks, the opponent answers, the
// transcript is stored on disk, and every reply comes back into the agent's
// context as a normal tool result — so a debate survives turns, compaction, and
// restarts.
//
// Route resolution leans on `ctx.llm`, the harness's own provider registry: the
// `antigravity` (Gemini bridge), `zexkora`, and `basisweb` routes all work
// without this file knowing anything about their wire format, auth, or quota.
//
// Tools registered: `spar`.
// Config (all optional):
//   opponents           alias -> { provider, model }     default: see DEFAULTS
//   defaultOpponent     alias used when a call omits one
//   challenger          second side of a duel when `sides` is omitted
//   judge               alias or route for verdicts
//   maxReplyTokens      output cap per debate reply      default 1600
//   temperature         sampling for debate replies      default 0.8
//   timeoutMs           per-reply deadline               default 180000
//   dir                 transcript directory             default <dsh home>/spar
//   maxTranscriptChars  transcript budget per request    default 70000
//   maxAttachChars      total attached-file budget       default 120000
//   leftLabel           how the calling agent appears    default "calling agent"
//   language            language of the exchange        default "ru"
//   tools               let debaters read the project   default true
//   cwd                 repository a debate is scoped to default: session cwd
//   maxToolRounds       tool calls per turn             default 3
//   judgeTokens         output cap for a verdict        default 16384

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { ALLOWED_TOOL_NAMES, TOOL_SCHEMAS, assertPublicUrl, parseSearchHtml, runTool, webRun } from "./tools.js";
import { createLiveRegistry, liveHandler } from "./live.js";
import { createSettingsStore, modelCatalog, modelsHandler, settingsHandler } from "./settings.js";

export const name = "spar";

/** The tools registry is required; `llm` is resolved lazily so a profile
 *  without any model route still loads this plugin and reports a clear error. */
export const inject = ["tools"];

/** Per-turn ceiling on tool calls and on the bytes they drag into the transcript. */
const MAX_TOOL_ROUNDS = 3;
/**
 * A turn may pull this much text before the budget is spent. Bytes, not calls:
 * one whole 3200-line file is a few calls' worth of tokens and a single
 * round-trip, so counting calls punishes the efficient way of reading.
 */
const MAX_TOOL_BYTES = 512 * 1024;

/** Route the chat card polls for the in-flight turn. */
const LIVE_PATH = "/spar-live";

/** How long `result` waits for a reply that is still being written. */
const RESULT_WAIT_MS = 120_000;
const MAX_RESULT_WAIT_MS = 300_000;

const DEFAULTS = {
  // Aliases are sugar, not assumptions: nothing here names a provider, because
  // the catalog belongs to the installation. Define your own in the profile
  // config (`opponents: { gem: { provider, model } }`) or just use
  // `provider/model` everywhere.
  opponents: {},
  // No default opponent, challenger or judge. A plugin that ships with
  // "gemini" assumes a bridge plenty of people do not run.
  defaultOpponent: "",
  challenger: "",
  judge: "",
  // The arbiter should be a route the user picked. `judge:"self"` opts in to
  // "same model as the caller"; the impartiality comes from the context — clean
  // prompt, no memory of arguing, blinded sides, order swapped by hash, forced
  // steelman of the side it is inclined to reject.
  maxReplyTokens: 8192,
  // Language of the exchange itself. The tool's own headers stay English so the
  // client can parse them; everything the models write follows this.
  language: "ru",
  // A debater may read the project it is arguing about instead of trusting the
  // caller's summary of it. Off makes every turn a closed-book answer.
  tools: true,
  cwd: "",
  maxToolRounds: 10,
  // A ruling on a thinking route spends most of its budget reasoning before it
  // writes anything, and the provider counts both against one cap. The budget is
  // sized so a full ruling fits after a full train of thought.
  judgeTokens: 16384,
  /** Reading rounds for a verdict; the arbiter checks more than a debater argues. */
  judgeToolRounds: 8,
  /** Web search for the sides. Off by default: an opinion is not a research task. */
  web: false,
  temperature: 0.8,
  judgeTemperature: 0.25,
  timeoutMs: 180_000,
  maxTranscriptChars: 70_000,
  maxAttachChars: 120_000,
  leftLabel: "",
};

const MAX_TURNS = 200;
const MAX_TURN_CHARS = 40_000;
const MAX_RESULT_CHARS = 60_000;
/** Per turn inside a transcript: one verbose side must not eat both. */
const TURN_SHOWN_CHARS = 9_000;
const MAX_FILES = 4;
const MAX_FILE_CHARS = 60_000;

/* ---------------------------------------------------------------- config -- */

function dshHome() {
  return process.env.DSH_HOME ?? path.join(homedir(), ".dsh");
}

function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(homedir(), value.slice(2));
  return path.resolve(value);
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeConfig(raw) {
  const config = { ...DEFAULTS, ...(raw ?? {}) };
  config.opponents = { ...DEFAULTS.opponents, ...(raw?.opponents ?? {}) };
  config.dir = expandHome(
    typeof config.dir === "string" && config.dir !== "" ? config.dir : path.join(dshHome(), "spar"),
  );
  config.maxReplyTokens = positiveInt(config.maxReplyTokens, DEFAULTS.maxReplyTokens);
  config.timeoutMs = positiveInt(config.timeoutMs, DEFAULTS.timeoutMs);
  config.maxTranscriptChars = positiveInt(config.maxTranscriptChars, DEFAULTS.maxTranscriptChars);
  config.maxAttachChars = positiveInt(config.maxAttachChars, DEFAULTS.maxAttachChars);
  // A debater argues, so it samples; the arbiter mostly measures, so it does not.
  // Both are adjustable from the panel, because one model's good temperature is
  // another model's rambling.
  config.temperature = Number.isFinite(config.temperature) ? Number(config.temperature) : DEFAULTS.temperature;
  config.judgeTemperature = Number.isFinite(config.judgeTemperature)
    ? Number(config.judgeTemperature)
    : DEFAULTS.judgeTemperature;
  return config;
}

/**
 * Accept an alias from `config.opponents`, a `provider/model` pair, or a
 * `provider:model` pair.
 * @returns {{ provider: string, model: string, label: string }}
 */
function resolveRoute(spec, config) {
  const text = typeof spec === "string" ? spec.trim() : "";
  const pairOf = (value) => {
    const match = /^([^/:]+)\s*[/:]\s*(.+)$/.exec(value);
    return match === null ? undefined : { provider: match[1].trim(), model: match[2].trim() };
  };

  if (text === "") {
    // The configured default may itself be a `provider/model` string — that is
    // what the settings panel writes when a model is picked from the catalog.
    const fallback = config.opponents?.[config.defaultOpponent];
    if (fallback !== undefined) return { ...fallback, label: `${fallback.provider}/${fallback.model}` };
    const pair = pairOf(config.defaultOpponent ?? "");
    if (pair !== undefined) return { ...pair, label: `${pair.provider}/${pair.model}` };
    // No model name ships with the plugin on purpose: the catalog differs per
    // installation, and a bridge one person runs is not a bridge everyone has.
    throw new Error(
      "spar: модель не выбрана. Плагин не предполагает ни одной: у разных установок разные каталоги и мосты. " +
        "Выбери модель в панели ◈ или укажи `defaultOpponent: <provider>/<model>` в конфиге профиля.",
    );
  }
  const alias = config.opponents[text];
  if (alias !== undefined) return { provider: alias.provider, model: alias.model, label: `${alias.provider}/${alias.model}` };

  const pair = pairOf(text);
  if (pair !== undefined) return { ...pair, label: `${pair.provider}/${pair.model}` };

  const known = Object.keys(config.opponents ?? {}).sort().join(", ");
  throw new Error(
    `spar: неизвестная модель "${text}". ` +
      `Используй <provider>/<model> из каталога — он у каждой установки свой${known === "" ? "" : `, — или один из своих алиасов: ${known}`}.`,
  );
}

function sameRoute(left, right) {
  return left !== null && right !== null && left.provider === right.provider && left.model === right.model;
}

/** Stable parity for blinding: a given debate replayed gives the same layout. */
function hashParity(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & 1;
}

/**
 * The judge is the caller's own model by default — a fresh instance with no
 * stake and no memory of the argument — read from the live agent route rather
 * than from an alias, so it follows whatever route the session actually uses.
 * An explicit alias or `provider/model` overrides it.
 */
function judgeRoute(spec, config, exec) {
  const text = typeof spec === "string" ? spec.trim() : "";
  const options = exec?.agent?.options;
  const hasRoute = options !== null && options !== undefined && typeof options.provider === "string" && typeof options.model === "string";
  const live = () => {
    if (hasRoute) return { provider: options.provider, model: options.model, label: `${options.provider}/${options.model}`, self: true };
    throw new Error('spar verdict: cannot read the live model route — pass judge:"glm" or another alias');
  };
  if (text === "self") return live();
  if (text === "") {
    const configured = typeof config.judge === "string" ? config.judge.trim() : "";
    if (configured === "self") return live();
    if (configured === "") {
      // Picking the caller's own model by default would be a decision about the
      // user's setup, and the whole point of an arbiter is that they chose one.
      throw new Error(
        'spar verdict: судья не выбран. Укажи его в панели ◈, в конфиге (`judge: <provider>/<model>`), ' +
          'либо явно `judge:"self"`, если судить должна та же модель, что вызвала спор.',
      );
    }
    return { ...resolveRoute(configured, config), self: false };
  }
  return { ...resolveRoute(text, config), self: false };
}

/* ----------------------------------------------------------------- state -- */

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function debatePath(config, id) {
  return path.join(config.dir, `${id}.json`);
}

function isDebateId(value) {
  return typeof value === "string" && /^d[1-9][0-9]{0,5}$/.test(value);
}

function listDebateIds(config) {
  if (!existsSync(config.dir)) return [];
  return readdirSync(config.dir)
    .filter((file) => /^d[1-9][0-9]{0,5}\.json$/.test(file))
    .map((file) => file.slice(0, -".json".length))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function nextDebateId(config) {
  const ids = listDebateIds(config);
  const last = ids.length === 0 ? 0 : Number(ids[ids.length - 1].slice(1));
  return `d${last + 1}`;
}

function loadDebate(config, id) {
  if (!isDebateId(id)) throw new Error(`spar: "${id}" is not a debate id (expected d1, d2, …)`);
  const file = debatePath(config, id);
  if (!existsSync(file)) throw new Error(`spar: debate ${id} does not exist`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`spar: debate ${id} is unreadable (${String(error?.message ?? error)})`);
  }
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.turns)) {
    throw new Error(`spar: debate ${id} has an unexpected shape`);
  }
  parsed.attach ??= [];
  parsed.verdict ??= null;
  return parsed;
}

function saveDebate(config, debate) {
  debate.updatedAt = new Date().toISOString();
  ensureDir(config.dir);
  // Runtime-only helper fields never belong in the file.
  delete debate.__config;
  delete debate.maxTranscriptChars;
  writeFileSync(debatePath(config, debate.id), JSON.stringify(debate, null, 2), "utf8");
}

function newDebate({ id, topic, kind, mode, intensity, left, right, stance, attach, cwd, web }) {
  const now = new Date().toISOString();
  return {
    version: 1,
    id,
    kind, // 'spar' (agent vs opponent) | 'duel' (two models, agent watches)
    topic,
    stance: stance ?? "",
    mode,
    intensity,
    left,
    right,
    attach,
    // The directory the debate is scoped to. Kept because the arbiter must read
    // the same project the debaters argued about, not the session's directory.
    cwd: cwd ?? "",
    // Off unless the caller asked: a debate about tea is not a research task, and
    // giving both sides a search box turned every opinion into a slow scrape.
    web: web === true,
    turns: [],
    verdict: null,
    closed: false,
    createdAt: now,
    updatedAt: now,
  };
}

/* -------------------------------------------------------------- rendering -- */

/** One-line label for a turn from the point of view of one speaker. */
function labelFor(turn, viewer) {
  if (turn.role === "judge") return "ARBITER";
  return turn.role === viewer ? "YOU" : "OPPONENT";
}

/**
 * Render the shared record for one speaker. Keeps the first two turns and the
 * most recent ones when the transcript exceeds the budget, so a long argument
 * stays affordable without losing its opening or its current state.
 */
function renderTranscript(turns, viewer, maxChars) {
  const usable = turns.filter((turn) => turn.role !== "judge");
  const cost = (turn) => (turn.text?.length ?? 0) + 24;
  const total = usable.reduce((sum, turn) => sum + cost(turn), 0);

  let selected = usable;
  if (total > maxChars) {
    const head = usable.slice(0, 2);
    const tail = [];
    let budget = maxChars - head.reduce((sum, turn) => sum + cost(turn), 0);
    for (let index = usable.length - 1; index >= 2; index -= 1) {
      budget -= cost(usable[index]);
      if (budget < 0) break;
      tail.unshift(usable[index]);
    }
    const elided = usable.length - head.length - tail.length;
    // "How many" is not enough: an arbiter that knows the picture is incomplete but
    // not what is missing cannot weigh what it reads, and it cannot ask for the gap.
    const dropped = usable.slice(head.length, usable.length - tail.length);
    const names = dropped
      .map((turn, position) => `#${head.length + position + 1} ${turn.role === "left" ? "caller" : turn.role === "right" ? "opponent" : turn.role}`)
      .join(", ");
    selected = [
      ...head,
      {
        role: "note",
        text: `[${elided} earlier turns elided to fit the context budget: ${names}. Their content is not in this transcript — say so rather than reconstructing it.]`,
      },
      ...tail,
    ];
  }

  const counters = { left: 0, right: 0 };
  const lines = [];
  for (const turn of selected) {
    if (turn.role === "note") {
      lines.push(turn.text);
      lines.push("");
      continue;
    }
    counters[turn.role] = (counters[turn.role] ?? 0) + 1;
    lines.push(`${labelFor(turn, viewer)} (${counters[turn.role]}): ${turn.text.trim()}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** Render the record for the calling agent to read: readable, not model-facing. */
function renderForReading(debate) {
  const lines = [];
  lines.push(`# ${debate.id} · ${debate.topic}`);
  const turns = debate.turns.filter((turn) => turn.role !== "judge").length;
  lines.push(
    `mode ${debate.mode}/${debate.intensity} · ${debate.kind === "duel" ? "duel" : "spar"} · ` +
      `${debate.left.label} vs ${debate.right.label} · ${turns} turns${debate.closed ? " · closed" : ""}`,
  );
  if (debate.stance !== "") lines.push(`stance: ${debate.stance}`);
  if (debate.attach.length > 0) lines.push(`attached: ${debate.attach.map((entry) => entry.path).join(", ")}`);
  lines.push("");
  const counters = { left: 0, right: 0 };
  for (const turn of debate.turns) {
    if (turn.role === "judge") {
      lines.push(`ARBITER: ${turn.text}`);
      if (debate.verdictSides !== undefined) {
        const side = debate.verdictSides;
        const name = (role) => (role === "left" ? debate.left.label : debate.right.label);
        lines.push(`A = ${name(side.A)} · B = ${name(side.B)}`);
      }
      lines.push("");
      continue;
    }
    counters[turn.role] = (counters[turn.role] ?? 0) + 1;
    const name = turn.role === "left" ? debate.left.label : debate.right.label;
    lines.push(`[${turn.role === "left" ? "A" : "B"}${counters[turn.role]}] ${name}: ${turn.text}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/* ---------------------------------------------------------------- prompts -- */

function intensityRules(intensity) {
  if (intensity === "civil") return "Tone: firm but collegial. Assume the opponent argues in good faith.";
  if (intensity === "brutal") {
    return [
      "Tone: ruthless about reasoning. Name the fallacy by name when you see one (moving the goalposts,",
      "motte-and-bailey, appeal to authority, equivocation, unfalsifiable claim). No false balance,",
      'no "both sides have a point" escape hatch. Attack the argument, never the person behind it.',
      "No profanity aimed at the opponent.",
    ].join(" ");
  }
  return "Tone: blunt. No cushioning. Short sentences where the claim is weak.";
}

function modeRules(mode) {
  if (mode === "steelman") {
    return [
      "Your job is not to win. The opponent is attacking a position; build the strongest possible version of that",
      "position, then show exactly where the opponent's version of it is weaker than it could be. You are a",
      "forge, not a wrecking ball: the opponent should finish your turn with a better argument than they started with.",
    ].join(" ");
  }
  if (mode === "cross") {
    return [
      "Engage as a rigorous interlocutor rather than a pure adversary: answer what is actually asked, but flag every",
      "unstated assumption, every unsupported assertion, and every place the opponent's conclusion outruns their evidence.",
    ].join(" ");
  }
  return "Break the opponent's position where it is weak. Do not summarize it, do not praise it, do not agree politely.";
}

const LANGUAGES = { ru: "Russian", en: "English" };

/**
 * The debate has its own language, independent of the tool's English headers:
 * the caller speaks Russian and reads the exchange, so the models must write in
 * Russian even though every instruction they get is in English.
 */
function languageName(config) {
  const wanted = typeof config?.language === "string" ? config.language.trim().toLowerCase() : "ru";
  return LANGUAGES[wanted] ?? LANGUAGES.ru;
}

/** How the calling agent is named inside the exchange, in the exchange's language. */
function leftLabel(config) {
  const explicit = typeof config?.leftLabel === "string" ? config.leftLabel.trim() : "";
  if (explicit !== "") return explicit;
  return languageName(config) === "Russian" ? "вызывающий агент" : "calling agent";
}

function languageLine(config) {
  return `Write everything you say in ${languageName(config)}. Code, identifiers, file paths, shell commands, and quoted source stay exactly as written — do not translate or transliterate them, and do not add a note about the language.`;
}

function systemFor(debate, side, config) {
  const me = side === "left" ? debate.left : debate.right;
  const other = side === "left" ? debate.right : debate.left;
  const rules = [
    `You are ${me.label}, one side of a live written exchange with another AI agent (${other.label}).`,
    "The transcript below is the shared record. Lines marked OPPONENT are the other agent's words; lines marked YOU are your own earlier replies.",
    "Reply only as yourself, starting with your argument — never with a label, a header, or a restatement of the other side.",
    "",
    modeRules(debate.mode),
    "",
    "Rules of the exchange:",
    "- Lead with the single strongest objection, in at most two sentences, concrete enough to be wrong.",
    "- Then at most three further points. Each must name a mechanism (why the claim fails), not an opinion.",
    '- Concede only what the opponent actually demonstrated, and say "conceded:" plus the specific point. Never concede to be agreeable; never fabricate agreement either.',
    "- If the opponent is simply right, say so in one line and name the strongest remaining doubt instead of manufacturing a fight.",
    "- End with one observation or test that would settle the disagreement.",
    "- When a claim is about a whole file, read it with `whole: true`. A 200-line slice does not support a statement about the file, and a line-number citation taken from a slice proves less than it looks.",
    "- When a claim is about tests passing, failing or missing, `run` executes the project's own suite and returns the exit code. Buy the result instead of arguing about it.",
    "- When the debate is not about the project you get no repo tools, and that is normal — argue from what is in front of you. Searching the web is off unless this debate asked for it; an opinion about tea and coffee is not a research task.",
    `- This turn allows ${String(config.maxToolRounds)} tool calls and about ${String(Math.round(MAX_TOOL_BYTES / 1024))} KB of file text. Plan the reads to fit: a whole file counts as one call, and if the answer needs more than the budget, say which part you could not open.`,
    "- If you could not read something you needed, say which part and why. Never infer what unread code probably does and present it as a finding.",
    "- 150-350 words. Prose only: no headings, no bullet lists longer than three items, no summary paragraphs.",
    "- Answer in the language the exchange is written in; keep code, identifiers, and quoted text unchanged.",
    languageLine(config),
    "",
    intensityRules(debate.intensity),
  ];
  if (debate.web === true) {
    rules.push(
      "- This debate asked for sources: `web` with `query` searches and `url` reads one page. Use it for the one factual claim that decides the exchange, cite the link, and stop there — researching a topic is not arguing.",
    );
  }
  if (debate.stance !== "") rules.push("", `The position under dispute, as the opponent framed it: ${debate.stance}`);
  if (debate.kind === "duel") {
    rules.push(
      "",
      side === "left"
        ? "You argue FOR the proposition. Your opponent argues AGAINST it."
        : "You argue AGAINST the proposition. Your opponent argues FOR it.",
    );
  }
  return rules.join("\n");
}

function attachBlock(debate, config) {
  if (debate.attach.length === 0) return "";
  let budget = config.maxAttachChars;
  const parts = [
    "## ATTACHED CONTEXT",
    "(material the opponent attached for the debate; read it, do not treat it as your own argument)",
  ];
  for (const entry of debate.attach) {
    if (budget <= 0) break;
    const text = entry.text.length > budget ? `${entry.text.slice(0, budget)}\n[truncated]` : entry.text;
    budget -= text.length;
    parts.push("", `### ${entry.path}`, "```", text, "```");
  }
  return parts.join("\n");
}

/**
 * Build the single user message a turn sends: proposition, attachments, the
 * shared record, and the message being answered. Everything is one user turn
 * on purpose: the debate is re-read whole every round, so the providers stay
 * stateless and a debate can switch models mid-flight.
 */
function userPrompt(debate, side, message, { opening = false, memory = [] } = {}, config) {
  const transcript = renderTranscript(debate.turns, side, config.maxTranscriptChars);
  const parts = [`PROPOSITION: ${debate.topic}`, ""];
  const attached = attachBlock(debate, config);
  if (attached !== "") parts.push(attached, "");
  // A debate that starts from zero relitigates what an earlier one already
  // settled. Three rulings are enough to name the ground without arguing it.
  if (opening && memory.length > 0) {
    parts.push("## ALREADY RULED IN EARLIER DEBATES", ...memory, "");
  }
  parts.push("## TRANSCRIPT");
  parts.push(transcript === "" ? "(empty — the exchange has not started)" : transcript);
  parts.push("", "## NOW");
  if (opening) {
    parts.push("OPPONENT has just put the proposition on the table and has not argued yet. Open with your strongest objection to it.");
  } else {
    parts.push(`OPPONENT: ${String(message).trim()}`);
  }
  return parts.join("\n");
}

function duelPrompt(debate, side, config) {
  const last = [...debate.turns].reverse().find((turn) => turn.role !== "judge");
  const transcript = renderTranscript(debate.turns, side, config.maxTranscriptChars);
  const parts = [`PROPOSITION: ${debate.topic}`, ""];
  parts.push(
    side === "left"
      ? "You argue FOR the proposition. Your opponent argues AGAINST it."
      : "You argue AGAINST the proposition. Your opponent argues FOR it.",
    "",
    "## TRANSCRIPT",
    transcript === "" ? "(empty — you open the exchange)" : transcript,
    "",
    "## NOW",
  );
  if (last === undefined) parts.push("Nothing has been said yet. Open the exchange with your strongest case.");
  else parts.push(`OPPONENT: ${last.text}`);
  return parts.join("\n");
}

const JUDGE_SYSTEM = [
  "You are an arbiter with no stake in this exchange. You did not take part in it, you do not know who wrote which side, and you must not try to guess: the sides are labelled A and B on purpose, and their order was randomised for this ruling.",
  "One side may be your own earlier argument. Be stricter with the evidence it presents, never with the claim itself: a familiar argument that survives your checks counts at full weight. If you discount it anyway, name the specific unverified claim you discounted. Acquaintance is a reason to look, not a reason to lean. Report that check in section 1 as a check of support, not as a suspicion of the prose.",
  "Judge the arguments only. Length, tone, fluency, and confidence are not evidence; a side that sounds familiar is not therefore right, and a side that sounds like you is not therefore wrong.",
  "Verification is part of the ruling, not a courtesy. You have tools and the project is on disk: before you rule, open at least one artefact per side (a cited file, a cited line, a command's output) and say in section 5 whether it held. A `path:line` or a `test: command` you did not check is unverified and supports nothing.",
  "Each side's entry ends with what it actually read. If a side cites a path that is missing from its own list, name it a fabricated source in section 4 and discount every claim resting on it.",
  "A debate may be about something that is not on disk yet — an interface nobody has written, an external API, an invariant. If the artefact does not exist, say so in section 5 and treat the claim as unverified; never invent a check, and never refuse to rule because files are missing. Attribution matters more than coverage: state what you opened and what you did not, so a reader can weigh the ruling instead of trusting it.",
  "Work in this order, keep the six numbered sections, and add no preamble:",
  "1. first read: which side you were inclined to favour before analysis, in one clause, and one reason that inclination is suspect.",
  "2. steelman of the side you are inclined to reject: its strongest version, three sentences, in its own terms — no strawman, no \"however\" in this section.",
  "3. survived: the claims still standing, attributed to A or B.",
  "4. refuted: the claims actually defeated, attributed to A or B, naming the argument that defeated them.",
  "5. debt: one objection each side must still answer, plus the artefacts you verified for it and the ones you could not. \"none\" is allowed only with a sentence saying why that side carries no debt.",
  "6. verdict: 3-5 sentences naming the stronger case, or \"draw\" / \"both wrong\".",
  "A ruling that splits the difference to seem fair is a wrong ruling; so is one that rewards the longer answer.",
].join("\n");

/** The judge gets the same blind rules plus the debate's language. */
function judgeSystem(config) {
  return `${JUDGE_SYSTEM}\n${languageLine(config)}\nThe section headings keep their shape: number them 1 to 6, keep each short.`;
}

/* ------------------------------------------------------------------- call -- */

function resolveLlm(ctx) {
  try {
    const service = typeof ctx.get === "function" ? ctx.get("llm") : ctx.llm;
    if (service !== undefined && service !== null && typeof service.stream === "function") return service;
  } catch {
    /* a profile without a model route: reported by the caller */
  }
  return undefined;
}

let messageCounter = 0;

/** A per-request message identity; the LLM layer only needs it to be unique. */
function nextMessageId() {
  messageCounter += 1;
  return `spar_${Date.now().toString(36)}_${messageCounter.toString(36)}`;
}

/**
 * The repository a debate may read, or undefined when tools are off. Config wins
 * over the calling agent's own directory so a debate can be pointed at a project
 * other than the one the session happens to sit in.
 */
function repoFor(config, exec) {
  if (config.tools === false) return undefined;
  const fromConfig = typeof config.cwd === "string" ? config.cwd.trim() : "";
  const fromExec = typeof exec?.agent?.cwd === "string" ? exec.agent.cwd.trim() : "";
  const root = fromConfig !== "" ? expandHome(fromConfig) : fromExec !== "" ? fromExec : process.cwd();
  if (!existsSync(root)) return undefined;
  return { root: path.resolve(root), label: path.basename(path.resolve(root)) };
}

/**
 * Stream one model reply and return its text.
 *
 * When `repo` is given, the model may read the project itself: every tool call
 * it requests is executed here, bounded, and fed back, until it stops asking or
 * the round budget runs out. That is what keeps a debate about real code rather
 * than about the caller's description of it.
 *
 * @throws {Error} on a missing route, a provider failure, or a deadline.
 */
async function callModel(
  ctx,
  route,
  system,
  prompt,
  { maxTokens, temperature, timeoutMs, signal, repo, maxToolRounds = MAX_TOOL_ROUNDS, onDelta, schemas, allowedToolNames },
) {
  const llm = resolveLlm(ctx);
  if (llm === undefined) {
    throw new Error("spar: no `llm` service in this profile — mount a provider adapter before debating");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`spar: reply timed out after ${Math.round(timeoutMs / 1000)}s`)),
    timeoutMs,
  );
  timer.unref?.();
  const stop = () => controller.abort(new Error("spar: cancelled"));
  if (signal !== undefined) {
    if (signal.aborted) controller.abort(new Error("spar: cancelled"));
    else signal.addEventListener("abort", stop, { once: true });
  }

  let text = "";
  let reasoning = "";
  let finish;
  let toolRounds = 0;
  let toolBytes = 0;
  let readBudgetAnnounced = false;
  // A model that keeps asking for tools after the budget is gone must not spin
  // the turn forever: two useless rounds and we answer with what we have.
  let wastedRounds = 0;
  const started = Date.now();
  const usesTools = repo !== null && repo !== undefined && typeof repo.root === "string";
  try {
    // prepareCall validates the route and resolves the adapter defaults. The
    // reasoning level stays the profile's own: a judge or a debater that is not
    // allowed to think is a worse one, not a cheaper one.
    const messages = [{ role: "user", content: [{ type: "text", text: prompt }] }];

    for (;;) {
      // A prepared call dispatches once, so every round — including the ones a
      // tool result triggers — gets its own preparation.
      const call = await llm.prepareCall(
        { provider: route.provider, model: route.model, maxTokens, temperature },
        controller.signal,
        (controls) => controls,
      );
      finish = undefined;
      const spent = toolRounds >= maxToolRounds || toolBytes >= MAX_TOOL_BYTES;
      if (spent && toolRounds > 0 && readBudgetAnnounced === false) {
        // Losing the tools silently is worse than losing them loudly: a model that
        // cannot look something up must not report "not found" as if it had looked.
        readBudgetAnnounced = true;
        messages.push({
          id: nextMessageId(),
          role: "user",
          content: [
            {
              type: "text",
              text: `Reading budget for this turn is spent (${toolRounds} tool calls, ${Math.round(toolBytes / 1024)} KB). Answer from what you did read, and say explicitly which files or questions you could not open.`,
            },
          ],
        });
      }
      // A verdict on an argument about phones does not need the repo; a verdict on
      // a claim about `index.js:412` does. The caller decides by saying `project`,
      // otherwise the transcript decides: a side that opened a file made it about
      // the project, and one that opened nothing did not.
      const offered = schemas ?? TOOL_SCHEMAS;
      const allowed = allowedToolNames ?? ALLOWED_TOOL_NAMES;
      const roundTools = usesTools && !spent ? offered : undefined;
      const stream = call.stream({
        ...call.config,
        system,
        messages,
        ...(roundTools === undefined ? {} : { tools: roundTools }),
        signal: controller.signal,
      });
      let roundText = "";
      const asked = [];
      for await (const chunk of stream) {
        if (chunk?.type === "text-delta" && typeof chunk.text === "string") {
          roundText += chunk.text;
          onDelta?.({ text: `${text}${roundText}`, activity: null });
        } else if (chunk?.type === "reasoning-delta" && typeof chunk.text === "string") {
          reasoning += chunk.text;
          onDelta?.({ reasoningDelta: chunk.text });
        } else if (chunk?.type === "block-end" && chunk.block?.type === "tool-call") {
          // Anthropic-shaped providers require `tool_use.id` on the assistant block and
          // a matching `tool_result` id. Not every stream supplies one; a missing id is
          // a 400 on the *next* request, after the model has already been charged for
          // the turn. Mint a stable one here so both sides of the pair agree.
          asked.push({
            id:
              typeof chunk.block.id === "string" && chunk.block.id !== ""
                ? chunk.block.id
                : `spar-${String(toolRounds)}-${String(asked.length)}`,
            name: chunk.block.name,
            arguments: chunk.block.arguments,
          });
        } else if (chunk?.type === "finish") {
          finish = chunk.reason;
        }
      }
      text += roundText;
      if (!usesTools || finish?.kind !== "tool-calls" || asked.length === 0) break;

      const blocks = [];
      if (roundText.trim() !== "") blocks.push({ type: "text", text: roundText });
      for (const askedCall of asked) {
        blocks.push({ type: "tool-call", id: askedCall.id, name: askedCall.name, arguments: askedCall.arguments });
      }
      messages.push({
        id: nextMessageId(),
        role: "assistant",
        content: blocks,
        source: { kind: "model", provider: route.provider, model: route.model },
      });

      if (asked.length > 0 && spent) {
        wastedRounds += 1;
        if (wastedRounds >= 2) {
          // The turn is cut while the model was still trying to look something up,
          // so whatever it wrote is a preamble, not an answer. Say so, or it will
          // be read later as a complete argument.
          if (text.trim() !== "") text += "\n\n[stopped before answering: the reading budget was spent while the model was still asking for files]";
          break;
        }
      }
      for (const askedCall of asked) {
        let body;
        if (spent) {
          body = "error: this turn's tool budget is spent — answer with what you have";
        } else {
          toolRounds += 1;
          let args = {};
          let parseFailed = false;
          try {
            // Providers disagree on this: some send a JSON string, some an object.
            const raw = askedCall.arguments;
            args = typeof raw === "object" && raw !== null ? raw : JSON.parse(raw === "" || raw === undefined ? "{}" : raw);
          } catch {
            parseFailed = true;
            args = {};
          }
          const name = allowed.has(askedCall.name) ? askedCall.name : "";
          body = parseFailed
            ? // Silent `{}` used to turn a malformed call into "the file is not there".
              "error: the tool arguments were not valid JSON — repeat the call with a JSON object"
            : name === ""
              ? `error: unknown tool ${askedCall.name}`
              : name === "web"
                ? await webRun(args)
                : runTool(repo.root, name, args);
          const subject =
            typeof args.path === "string"
              ? args.path
              : typeof args.pattern === "string"
                ? args.pattern
                : typeof args.query === "string"
                  ? args.query
                  : typeof args.url === "string"
                    ? args.url
                    : "";
          // A read that covered 200 of 3200 lines is not the same claim as one that
          // covered the file. The trail says which, so the arbiter can weigh it and
          // the caller can see whether a whole-file argument rests on a slice.
          const covered = name === "read" ? /^\S+ · lines (\d+)-(\d+) of (\d+)$/m.exec(body) : null;
          const span = covered === null ? "" : ` (${covered[1]}-${covered[2]}/${covered[3]})`;
          onDelta?.({
            text,
            ok: !String(body).startsWith("error:"),
            step: { name, subject: `${subject}${span}` },
            activity: subject === "" ? name : `${name} ${subject}${span}`,
          });
          toolBytes += body.length;
          if (toolBytes > MAX_TOOL_BYTES) body += "\n… this turn's reading budget is spent";
        }
        messages.push({
          id: nextMessageId(),
          role: "tool",
          toolCallId: askedCall.id,
          content: [{ type: "text", text: body }],
          source: { kind: "tool", callId: askedCall.id },
        });
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", stop);
  }

  if (finish?.kind === "error") {
    const failure = finish.failure ?? {};
    const error = new Error(
      `spar: ${route.provider}/${route.model} failed: ${failure.code ?? "ERROR"} ${failure.message ?? ""}`.trim(),
    );
    error.code = failure.code;
    throw error;
  }
  if (finish?.kind === "aborted") {
    const failure = finish.failure ?? {};
    throw new Error(
      `spar: ${route.provider}/${route.model} aborted after ${Date.now() - started}ms (${failure.code ?? "ABORTED"} ${failure.message ?? ""})`.trim(),
    );
  }

  const reply = text.trim();
  if (reply === "") {
    const detail = [
      `finish=${finish?.kind ?? "unknown"}`,
      reasoning === "" ? "" : `reasoning-chars=${reasoning.length}`,
    ].filter(Boolean).join(" ");
    throw new Error(`spar: ${route.provider}/${route.model} returned no text (${detail})`);
  }
  return { text: reply, ms: Date.now() - started, truncated: finish?.kind === "max-tokens" };
}

/* ------------------------------------------------------------------ files -- */

function readAttachments(paths, config) {
  const attached = [];
  let budget = config.maxAttachChars;
  for (const entry of paths.slice(0, MAX_FILES)) {
    const raw = typeof entry === "string" ? entry.trim() : "";
    if (raw === "") continue;
    try {
      const text = readFileSync(expandHome(raw), "utf8");
      const limit = Math.min(MAX_FILE_CHARS, Math.max(budget, 0));
      const clipped = text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text;
      budget -= clipped.length;
      attached.push({ path: raw, text: clipped });
    } catch (error) {
      attached.push({ path: raw, text: `[unreadable: ${String(error?.message ?? error)}]` });
    }
    if (budget <= 0) break;
  }
  return attached;
}

/** Attach new files to an existing debate. */
function addAttachments(debate, config, paths) {
  const known = new Set(debate.attach.map((entry) => entry.path));
  let added = 0;
  for (const entry of readAttachments(paths, config)) {
    if (known.has(entry.path)) continue;
    debate.attach.push(entry);
    added += 1;
  }
  return added;
}

/* ------------------------------------------------------------------- tool -- */

const DESCRIPTION = [
  "Debate a second model that is instructed to break your claims. This is not a chat with a helper: the other side attacks mechanisms, evidence, and hidden assumptions, concedes only what you actually demonstrated, and names the test that would settle the disagreement.",
  "",
  "`open` starts a debate (returns the opponent's opening attack). `say` sends your next argument and returns theirs. The transcript lives on disk, so it survives compaction and restarts — pass the same `id` every time.",
  "",
  "Turns run in the background by default: `open`/`say`/`verdict` come back immediately with `started`, so you keep working while the other model writes, then collect the text with `action:\"result\", id`. Pass `async:false` only when you truly have nothing else to do. The chat card fills in live either way. `result` waits for a reply that is still being written: an unread turn is not an answer, so never end a turn claiming otherwise — and if a reply looks like nonsense, let the judge rule on it instead of dismissing it alone.",
  "",
  "The other side is not limited to your summary: it can read the project itself (`read`/`grep`/`glob`/`git`, scoped to `cwd`), and every turn reports what it actually read.",
  "",
  "Models are optional. `open` with only a `topic` uses the profile's opponent and judge — that is the normal case, because the profile already names them. Pass `opponent`/`judge` only when the user asked for a specific model by name, and never invent one: `models` lists the valid ids, `list` shows what is already configured.",
  "",
  "Actions:",
  "- open   — { topic, opponent?, mode?, intensity?, stance?, files?, opening? } → new id + the other side's opening. `opening:\"me\"` starts silent so you speak first.",
  "- say    — { id, message } → they answer with their strongest objection; your message is recorded as your turn.",
  '- duel   — { topic, sides?:["gemini","claude"], rounds?, mode?, intensity? } → two models argue FOR/AGAINST while you watch; returns the full exchange.',
  "- verdict— { id, judge? } → a ruling from this same model in a clean context, with the sides blinded, their order randomised, and the mapping disclosed only afterwards. The arbiter never argues, so it owes neither side a defence. `judge:\"self\"` follows the live route; an alias names another one.",
  "- show   — { id } → the whole transcript, readable, for re-reading after a compaction.",
  "- list   — open debates, known opponent aliases, and live model routes.",
  "- close  — { id } → marks the debate closed (the file stays).",
  "",
  "Opponents are aliases (gemini, gemini-tiered, claude-ag, sonnet-ag, kimi, deepseek) or an explicit \"provider/model\". The exchange is written in the configured language (Russian by default), not in your reply language.",
].join("\n");

const PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["open", "say", "duel", "verdict", "result", "show", "list", "models", "close"],
      description:
        "open: start a debate (needs only `topic`); say: your turn in it; duel: two models argue while you watch; verdict: a third model judges; result: read the newest turn (for async runs); show: full transcript; list: debates + routes; models: the provider/model catalog of this harness; close: mark closed.",
    },
    id: { type: "string", description: 'Debate id, e.g. "d3". Required for say, verdict, show, close.' },
    topic: { type: "string", description: "The proposition or question under dispute (open, duel)." },
    message: {
      type: "string",
      description: "Your argument for this round (say). Write the actual claim, not a request to argue.",
    },
    stance: {
      type: "string",
      description: "Optional: the position under dispute, framed the way you want the opponent to read it (open, duel).",
    },
    opponent: {
      type: "string",
      description:
        'Alias (gemini, claude, gpt, kimi, deepseek) or "provider/model". Default: the profile\'s defaultOpponent.',
    },
    challenger: { type: "string", description: "Second side for duel when sides is omitted." },
    judge: {
      type: "string",
      description:
        'Route for the verdict. Default: the profile judge alias (deepseek — the same model in a clean blinded context). "self" follows the live route; an alias or provider/model names another one.',
    },
    sides: {
      type: "array",
      items: { type: "string" },
      description: "Duel only: two sides — [for, against]. Aliases or provider/model. One entry plus `challenger` also works.",
    },
    web: {
      type: "boolean",
      description:
        "Allow the web (`query`/`url`) for the sides and the arbiter. Off by default: an opinion debate is not a research task. Set it when the topic turns on a checkable fact.",
    },
    project: {
      type: "boolean",
      description:
        "Verdict only: whether the debate is about the project's code. Default: inferred — a side that opened a file made it about the project. `true` gives the judge the repo tools even if nobody read; `false` keeps it to the arguments and `web`.",
    },
    rounds: { type: "integer", description: "Duel only: exchanges to run, 1-4 (default 2). Each round is two model calls." },
    mode: {
      type: "string",
      enum: ["strike", "steelman", "cross"],
      description:
        "strike (default): they attack your claims. steelman: they build the strongest case against your position. cross: normal exchange that flags your unstated assumptions.",
    },
    intensity: {
      type: "string",
      enum: ["civil", "sharp", "brutal"],
      description:
        "sharp (default): blunt. civil: collegial. brutal: ruthless about reasoning — fallacies named, no false balance.",
    },
    files: {
      type: "array",
      items: { type: "string" },
      description: "Files to attach as shared context (max 4, 60 KB each). Absolute or relative to the working directory.",
    },
    opening: {
      type: "string",
      enum: ["opponent", "me"],
      description: 'open only: "opponent" (default) lets them attack first; "me" starts silent.',
    },
    maxTokens: { type: "integer", description: "Output cap for this reply, overriding maxReplyTokens." },
    async: {
      type: "boolean",
      description:
        "Default true: start the turn and return at once so you can keep working, then read it with action:\"result\". Pass false to block until the reply is ready.",
    },
    wait: {
      type: "boolean",
      description:
        "result: default true — wait for a reply that is still being written instead of returning an older turn. Never finish an answer while a reply is unread.",
    },
    waitMs: {
      type: "integer",
      description: "result: how long to wait for the pending turn, in ms (default 120000, at most 300000).",
    },
    cwd: {
      type: "string",
      description:
        "Repository the debaters may read with their tools (read/grep/glob/git). Default: the profile's cwd, or the session's own directory.",
    },
  },
};

function header(debate, turn, route) {
  if (turn.role === "judge") return `[spar ${debate.id} · verdict · ${route.label} · ${(turn.ms / 1000).toFixed(1)}s]`;
  const round = debate.turns.filter((entry) => entry.role === "right").length;
  const cut = turn.truncated === true ? " · cut at token cap" : "";
  return `[spar ${debate.id} · r${round} · ${route.label} · ${(turn.ms / 1000).toFixed(1)}s${cut}]`;
}

/**
 * The header for a collected turn. `result` marks it as a receipt: the reply is
 * already on screen in the turn's own card, so the card for this call collapses
 * to "получен" instead of printing the same prose twice.
 */
function resultHeader(debate, turn, route) {
  if (turn.role === "judge") return `[spar ${debate.id} · result verdict · ${route.label} · ${(turn.ms / 1000).toFixed(1)}s]`;
  const round = debate.turns.filter((entry) => entry.role === "right").length;
  const cut = turn.truncated === true ? " · cut at token cap" : "";
  return `[spar ${debate.id} · result r${round} · ${route.label} · ${(turn.ms / 1000).toFixed(1)}s${cut}]`;
}

function clip(text) {
  return text.length <= MAX_RESULT_CHARS ? text : `${text.slice(0, MAX_RESULT_CHARS)}\n[reply truncated at ${MAX_RESULT_CHARS} chars]`;
}

/** What the turn actually read, so "I checked the code" is verifiable. */
function usedLine(turn) {
  const used = Array.isArray(turn?.used) ? turn.used.filter((entry) => typeof entry === "string" && entry !== "") : [];
  return used.length === 0 ? "" : `\n\n· читал: ${used.join(", ")}`;
}

/**
 * The last few rulings, one line each. A new debate should not re-argue ground
 * an earlier one already settled, and the cheapest fix is to say so up front.
 */
function priorDigest(config, excludeId) {
  const rows = [];
  for (const id of listDebateIds(config).slice(-24).reverse()) {
    if (id === excludeId) continue;
    let debate;
    try {
      debate = loadDebate(config, id);
    } catch {
      continue;
    }
    if (typeof debate?.verdict !== "string" || debate.verdict.trim() === "") continue;
    const topic = String(debate.topic ?? "").replace(/\s+/g, " ").slice(0, 110);
    const ruling = String(debate.verdict).replace(/\s+/g, " ").slice(0, 90);
    rows.push(`- ${id}: «${topic}» → ${ruling}`);
    if (rows.length >= 3) break;
  }
  return rows;
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  try {
    ensureDir(config.dir);
  } catch (error) {
    ctx.logger?.warn?.(`spar: cannot create ${config.dir}: ${String(error?.message ?? error)}`);
  }

  // The card polls this route while a turn is still being written: the tool API
  // has no progress channel, so the in-flight text lives here until it settles.
  const live = createLiveRegistry();
  // The yaml patch is the deployment's opinion; `settings.json` is the
  // operator's, written by the panel and read on every turn.
  const store = createSettingsStore(path.join(config.dir, "settings.json"));
  const baseConfig = { ...config, opponents: { ...config.opponents } };
  const applySettings = () => {
    const saved = store.read();
    config.defaultOpponent = saved.opponent ?? baseConfig.defaultOpponent;
    config.judge = saved.judge ?? baseConfig.judge;
    config.challenger = saved.challenger ?? baseConfig.challenger;
    config.language = saved.language ?? baseConfig.language;
    config.tools = saved.tools ?? baseConfig.tools;
    config.maxToolRounds = saved.maxToolRounds ?? baseConfig.maxToolRounds;
    config.maxReplyTokens = saved.maxReplyTokens ?? baseConfig.maxReplyTokens;
    config.judgeTokens = saved.judgeTokens ?? baseConfig.judgeTokens;
    config.temperature = saved.temperatureOpponent ?? baseConfig.temperature;
    config.judgeTemperature = saved.temperatureJudge ?? baseConfig.judgeTemperature;
    return config;
  };
  applySettings();
  const debateIndex = () => {
    const rows = [];
    for (const id of listDebateIds(config).slice(-12).reverse()) {
      try {
        const debate = loadDebate(config, id);
        const last = debate.turns[debate.turns.length - 1];
        rows.push({
          id,
          topic: String(debate.topic ?? "").slice(0, 140),
          turns: debate.turns.length,
          kind: debate.kind ?? "debate",
          closed: debate.closed === true,
          verdict: debate.verdict !== null && debate.verdict !== undefined,
          lastMs: typeof last?.ms === "number" ? last.ms : null,
          updatedAt: debate.updatedAt ?? null,
        });
      } catch {
        /* an unreadable debate is not a reason to break the panel */
      }
    }
    return rows;
  };
  try {
    const server = typeof ctx.get === "function" ? ctx.get("webServer") : ctx.webServer;
    if (server !== undefined && server !== null && typeof server.register === "function") {
      ctx.effect(
        () => server.register({ kind: "prefix", path: LIVE_PATH, handler: liveHandler(live) }, "spar: live route"),
        "spar: live route",
      );
      ctx.effect(
        () =>
          server.register(
            {
              kind: "exact",
              path: "/spar-settings",
              handler: settingsHandler({
                store,
                effective: () => {
                  applySettings();
                  return {
                    opponent: config.defaultOpponent,
                    judge: config.judge,
                    challenger: config.challenger,
                    language: config.language,
                    tools: config.tools,
                    maxToolRounds: config.maxToolRounds,
                    maxReplyTokens: config.maxReplyTokens,
                    judgeTokens: config.judgeTokens,
                    temperature: config.temperature,
                    judgeTemperature: config.judgeTemperature,
                  };
                },
                debates: debateIndex,
              }),
            },
            "spar: settings route",
          ),
        "spar: settings route",
      );
      ctx.effect(
        () =>
          server.register(
            { kind: "exact", path: "/spar-models", handler: modelsHandler({ resolveLlm: () => resolveLlm(ctx) }) },
            "spar: models route",
          ),
        "spar: models route",
      );
    }
  } catch (error) {
    ctx.logger?.warn?.(`spar: live route not registered: ${String(error?.message ?? error)}`);
  }

  const busy = new Set();

  const guard = async (id, run) => {
    if (busy.has(id)) throw new Error(`spar: ${id} already has a reply in flight — wait for it`);
    busy.add(id);
    try {
      return await run();
    } finally {
      busy.delete(id);
    }
  };

  /** Run one side's turn and record the answer in the transcript. */
  const runTurn = async (debate, side, message, options = {}) => {
    const route = side === "left" ? debate.left : debate.right;
    if (route?.provider == null || route?.model == null) throw new Error(`spar: side ${side} has no model route`);
    const prompt =
      debate.kind === "duel"
        ? duelPrompt(debate, side, config)
        : userPrompt(
            debate,
            side,
            message,
            {
              opening: options.opening === true,
              memory: options.opening === true ? priorDigest(config, debate.id) : [],
            },
            config,
          );
    const callId = typeof options.callId === "string" ? options.callId : "";
    const used = [];
    live.begin(callId, {
      id: debate.id,
      role: side,
      phase: options.phase ?? "reply",
      route: route.label,
      topic: debate.topic,
    });
    try {
      const reply = await callModel(ctx, route, systemFor(debate, side, config), prompt, {
        maxTokens: options.maxTokens ?? config.maxReplyTokens,
        temperature: config.temperature,
        timeoutMs: config.timeoutMs,
        signal: options.signal,
        repo: options.repo,
        maxToolRounds: positiveInt(config.maxToolRounds, MAX_TOOL_ROUNDS),
        schemas: debate.web === true ? TOOL_SCHEMAS : TOOL_SCHEMAS.filter((schema) => schema.name !== "web"),
        allowedToolNames: debate.web === true ? ALLOWED_TOOL_NAMES : new Set([...ALLOWED_TOOL_NAMES].filter((name) => name !== "web")),
        onDelta: (patch) => {
          // A call that errored, or was refused because the budget was spent, is not
          // evidence. Recording it in the trail would let a claim rest on a file the
          // model never saw while the header says it read it.
          if (
            patch?.ok !== false &&
            typeof patch?.activity === "string" &&
            patch.activity !== "" &&
            used[used.length - 1] !== patch.activity
          ) {
            used.push(patch.activity);
          }
          live.progress(callId, patch);
        },
      });
      const turn = {
        role: side,
        text: reply.text.slice(0, MAX_TURN_CHARS),
        ms: reply.ms,
        truncated: reply.truncated === true,
        // Forty is past any turn's budget, so the list is effectively complete; when it
		// is not, the tail says so instead of dropping the last reads silently — the
		// arbiter calls an unlisted path "fabricated", and a real file would be judged
		// that way because we hid it.
		used: used.length > 40 ? [...used.slice(0, 39), `… +${String(used.length - 39)} more reads`] : used,
        at: new Date().toISOString(),
      };
      debate.turns.push(turn);
      if (debate.turns.length > MAX_TURNS) debate.turns = debate.turns.slice(-MAX_TURNS);
      debate.pending = null;
      debate.failed = null;
      saveDebate(config, debate);
      live.settle(callId, { text: turn.text });
      return { debate, turn, route };
    } catch (error) {
      // A failed turn must not leave the debate "pending": `result` would wait
      // for a reply that is never coming. It must also not look like a silence:
      // without this record the next `result` hands back the previous round as if
      // it were the answer to the message that never got one.
      debate.pending = null;
      debate.failed = { route: route.label, at: new Date().toISOString(), message: String(error?.message ?? error) };
      try {
        saveDebate(config, debate);
      } catch {
        /* the original error matters more than this bookkeeping */
      }
      live.settle(callId, { error: String(error?.message ?? error) });
      throw error;
    }
  };

  ctx.tools.register({
    name: "spar",
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string" } },
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    async execute(args, exec) {
      const action = typeof args?.action === "string" ? args.action.trim() : "";
      const mode = ["strike", "steelman", "cross"].includes(args?.mode) ? args.mode : "strike";
      const intensity = ["civil", "sharp", "brutal"].includes(args?.intensity) ? args.intensity : "sharp";
      const signal = exec?.signal;
      // A choice made in the panel applies to this turn, not the next reload.
      applySettings();
      // The card polls live state by the tool call id it already holds, and a
      // debate may read the repository it argues about.
      const callId = typeof exec?.rootCallId === "string" ? exec.rootCallId : "";
      const repo =
        typeof args?.cwd === "string" && args.cwd.trim() !== ""
          ? repoFor({ ...config, cwd: args.cwd }, exec)
          : repoFor(config, exec);
      /**
       * The project a debate argues about is pinned to the debate. A later turn must
       * not inherit the caller's current directory: a session that moved on would turn
       * the opponent's reads into "no such file" while its claim about the code stands,
       * and the transcript would look like a bad argument instead of a broken reader.
       */
      const repoOf = (debate) =>
        typeof debate?.cwd === "string" && debate.cwd !== "" ? repoFor({ ...config, cwd: debate.cwd }, exec) : repo;

      /**
       * Run a turn now, or hand it to the background unless the caller asked to
       * wait. Async is the default because waiting on a model is exactly what
       * a debate should not cost the calling agent: start it, keep working, then
       * read the turn with `result`.
       */
      const start = (id, route, phase, task) => {
        if (args?.async === false) return task();
        const pending = loadDebate(config, id);
        pending.pending = { phase, route: route.label, at: new Date().toISOString() };
        saveDebate(config, pending);
        Promise.resolve()
          .then(task)
          .catch(() => {});
        return {
          text:
            `[spar ${id} · ${phase} · ${route.label} · started]\n` +
            `Turn is running in the background; the card fills as it writes. Read it with action:"result", id:"${id}".`,
        };
      };

      if (action === "list") return { text: await listText(ctx, config) };

      if (action === "models") {
        // The catalog used to be reachable only over HTTP, which made a terminal
        // user read a URL or edit YAML before their first debate. The panel is a
        // client of this list, not the gate to it.
        const { models } = await modelCatalog(resolveLlm(ctx));
        const chat = models.filter((model) => model.chat !== false);
        // What is already configured comes first: the question behind `models` is
        // almost always "who will actually argue", and a flat dump answers it only
        // by alphabet — a caller then assumes the profile is empty and goes looking
        // for model names in the news.
        const configured = [
          `opponent (спорит с тобой): ${config.defaultOpponent || "не выбран"}`,
          `challenger (вторая сторона дуэли): ${config.challenger || "не выбран"}`,
          `judge (выносит вердикт): ${config.judge || "не выбран"}`,
        ];
        const byProvider = new Map();
        for (const model of chat) {
          const bucket = byProvider.get(model.provider) ?? [];
          bucket.push(model.model);
          byProvider.set(model.provider, bucket);
        }
        const table = [...byProvider.entries()]
          .sort((left, right) => left[0].localeCompare(right[0]))
          .map(([provider, names]) => `${provider}: ${names.join(", ")}`);
        return {
          text: [
            `[spar models · ${chat.length} chat models · ${byProvider.size} providers]`,
            "уже выбрано в профиле:",
            ...configured.map((line) => `  ${line}`),
            "",
            "поэтому для обычного спора модели указывать не надо: `open` с одним `topic` возьмёт их отсюда.",
            "",
            "каталог (provider: models):",
            ...table,
            "",
            "если пользователь назвал модель — бери её из этого списка. выдуманное имя падает у провайдера, а не здесь, и спор не начнётся.",
          ].join("\n"),
        };
      }

      if (action === "open") {
        const topic = typeof args?.topic === "string" ? args.topic.trim() : "";
        if (topic === "") throw new Error('spar open: "topic" is required');
        const right = resolveRoute(args?.opponent, config);
        const caller = exec?.agent?.options;
        const id = nextDebateId(config);
        const debate = newDebate({
          id,
          topic,
          kind: "spar",
          mode,
          intensity,
          left: {
            label: leftLabel(config),
            provider: typeof caller?.provider === "string" ? caller.provider : null,
            model: typeof caller?.model === "string" ? caller.model : null,
          },
          right,
          stance: typeof args?.stance === "string" ? args.stance.trim() : "",
          // Remembered, not just used for this turn: the arbiter has to read the
          // same project the debaters argued about.
          cwd: repo === undefined ? "" : repo.root,
          web: args?.web === true || config.web === true,
          attach: Array.isArray(args?.files) ? readAttachments(args.files, config) : [],
        });
        saveDebate(config, debate);
        if (args?.opening === "me") {
          return { text: `opened ${id} · ${right.label}\nSilent start. Send your first argument with action:"say", id:"${id}".` };
        }
        return start(id, right, "reply", () =>
          guard(id, async () => {
            const { turn } = await runTurn(debate, "right", "", {
              opening: true,
              maxTokens: args?.maxTokens,
              signal,
              callId,
              repo,
            });
            return { text: `${header(debate, turn, right)}\n${clip(turn.text)}${usedLine(turn)}` };
          }),
        );
      }

      if (action === "say") {
        const id = typeof args?.id === "string" ? args.id.trim() : "";
        if (id === "") throw new Error('spar say: "id" is required (open a debate first)');
        const message = typeof args?.message === "string" ? args.message.trim() : "";
        if (message === "") throw new Error('spar say: "message" is required — write your actual argument');
        const debate = loadDebate(config, id);
        if (debate.closed) throw new Error(`spar: ${id} is closed`);
        if (debate.kind !== "spar") {
          throw new Error(`spar: ${id} is a duel — read it with verdict/show, or open a spar to argue yourself`);
        }
        if (Array.isArray(args?.files) && args.files.length > 0) addAttachments(debate, config, args.files);

        return start(id, debate.right, "reply", () =>
          guard(id, async () => {
            debate.turns.push({ role: "left", text: message.slice(0, MAX_TURN_CHARS), at: new Date().toISOString() });
            const { turn } = await runTurn(debate, "right", message, { maxTokens: args?.maxTokens, signal, callId, repo: repoOf(debate) });
            // The caller's own words are part of the record and must be part of what
            // comes back: the card showed only the reply, so its own argument looked
            // missing even though the transcript had it.
            const mine = message.length > TURN_SHOWN_CHARS ? `${message.slice(0, TURN_SHOWN_CHARS)}\n… (${message.length - TURN_SHOWN_CHARS} characters cut)` : message;
            return { text: `A (ты) — твой аргумент:\n${mine}\n\n${header(debate, turn, debate.right)}\n${clip(turn.text)}${usedLine(turn)}` };
          }),
        );
      }

      if (action === "duel") {
        const topic = typeof args?.topic === "string" ? args.topic.trim() : "";
        if (topic === "") throw new Error('spar duel: "topic" is required');
        // `sides` reaches us in three shapes: an array, a JSON string, a comma list. One
        // element is legitimate when `challenger` names the other corner — requiring
        // exactly two silently dropped it and substituted the default opponent.
        let sides = null;
        if (Array.isArray(args?.sides)) sides = args.sides.map((entry) => String(entry).trim()).filter(Boolean);
        else if (typeof args?.sides === "string" && args.sides.trim() !== "") {
          const raw = args.sides.trim();
          if (raw.startsWith("[")) {
            let parsed;
            try {
              parsed = JSON.parse(raw);
            } catch {
              throw new Error(`spar duel: sides as text must be a JSON array — got ${raw.slice(0, 80)}`);
            }
            if (Array.isArray(parsed)) sides = parsed.map((entry) => String(entry).trim()).filter(Boolean);
          } else {
            sides = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
          }
        }
        if (sides !== null && sides.length > 2) throw new Error("spar duel: sides takes at most two models");
        const forSide = resolveRoute(sides?.[0], config);
        const againstSide = resolveRoute(sides?.[1] ?? args?.challenger ?? config.challenger, config);
        if (sameRoute(forSide, againstSide)) {
          throw new Error(
            `spar duel: both sides resolved to ${forSide.label} — pass sides:["gemini","claude"] (or set challenger)`,
          );
        }
        const rounds = Math.min(Math.max(positiveInt(args?.rounds, 2), 1), 4);
        const id = nextDebateId(config);
        const debate = newDebate({
          id,
          topic,
          kind: "duel",
          mode,
          intensity,
          left: forSide,
          right: againstSide,
          stance: typeof args?.stance === "string" ? args.stance.trim() : "",
          web: args?.web === true || config.web === true,
          attach: Array.isArray(args?.files) ? readAttachments(args.files, config) : [],
        });
        saveDebate(config, debate);

        return guard(id, async () => {
          for (let round = 0; round < rounds; round += 1) {
            // Both sides of a round are independent once the topic is fixed, so
            // they run at the same time: a two-model round costs one round, not two.
            if (round === 0) {
              await Promise.all([
                runTurn(debate, "left", "", { maxTokens: args?.maxTokens, signal, callId, repo: repoOf(debate) }),
                runTurn(debate, "right", "", { maxTokens: args?.maxTokens, signal, callId, repo: repoOf(debate) }),
              ]);
            } else {
              await runTurn(debate, "left", "", { maxTokens: args?.maxTokens, signal, callId, repo: repoOf(debate) });
              await runTurn(debate, "right", "", { maxTokens: args?.maxTokens, signal, callId, repo: repoOf(debate) });
            }
          }
          const transcript = debate.turns
            .map((turn) => {
              // A side that said nothing must say nothing visibly: an empty line under
              // "A (deepseek) FOR" reads as "I skipped it", not as "the model returned
              // nothing", and the caller then wonders where its own argument went.
              const said =
                typeof turn.text === "string" && turn.text.trim() !== ""
                  ? turn.text.length > TURN_SHOWN_CHARS
                    ? `${turn.text.slice(0, TURN_SHOWN_CHARS)}\n… (${turn.text.length - TURN_SHOWN_CHARS} characters cut)`
                    : turn.text
                  : `(эта сторона не ответила · ${turn.finish ?? "no text"})`;
              return `${turn.role === "left" ? `A (${forSide.label}) FOR` : `B (${againstSide.label}) AGAINST`}: ${said}${usedLine(turn)}`;
            })
            .join("\n\n");
          return {
            text:
              `[spar ${id} · duel · ${rounds} rounds · ${forSide.label} FOR vs ${againstSide.label} AGAINST]\n\n` +
              clip(transcript),
          };
        });
      }

      if (action === "verdict") {
        const id = typeof args?.id === "string" ? args.id.trim() : "";
        if (id === "") throw new Error('spar verdict: "id" is required');
        const debate = loadDebate(config, id);
        const judge = judgeRoute(args?.judge, config, exec);
        const conflict =
          debate.kind === "duel"
            ? sameRoute(judge, debate.left) || sameRoute(judge, debate.right)
            : sameRoute(judge, debate.right);
        if (conflict) throw new Error(`spar verdict: ${judge.label} is one of the debaters — choose an uninvolved judge`);

        return start(id, judge, "verdict", () =>
          guard(id, async () => {
            // Blind the sides and swap them per verdict: the arbiter never learns
          // which side is the caller, and no side gets a permanent position. The
          // swap is a stable hash, so replaying the same debate gives the same
          // layout; the mapping is disclosed only after the ruling.
          const swap = hashParity(`${debate.id}:${debate.turns.length}`) === 1;
          const aRole = swap ? "right" : "left";
          const bRole = swap ? "left" : "right";
          const sideOf = (role) => (role === aRole ? "A" : "B");
          const labelOf = (role) => (role === "left" ? debate.left.label : debate.right.label);
          // The arbiter reads the project the debaters argued about, not whatever
          // directory the session happens to sit in: a verdict that cannot open a
          // cited file is just a second opinion on prose.
          const judgeRepo =
            typeof debate.cwd === "string" && debate.cwd !== "" ? repoFor({ ...config, cwd: debate.cwd }, exec) : repo;
          // Does this debate live in the project? Either the caller says so, or a
          // side actually opened something. A phone argument gets no repo tools:
          // forcing a walk there produced verdicts that quoted files nobody cited.
          const projectish =
            typeof args?.project === "boolean"
              ? args.project
              : debate.turns.some((turn) => Array.isArray(turn.used) && turn.used.length > 0);
          // Repo tools only for a project debate; the web only when this debate asked for
          // sources. An opinion debate gets neither, so the arbiter does not go
          // reading code nobody cited or searching a topic that is not a fact.
          const judgeSchemas = (projectish ? TOOL_SCHEMAS : TOOL_SCHEMAS.filter((schema) => schema.name === "web")).filter(
            (schema) => schema.name !== "web" || debate.web === true || args?.web === true,
          );
          const judgeAllowed = new Set(judgeSchemas.map((schema) => schema.name));
          const record = debate.turns
            .filter((turn) => turn.role !== "judge")
            .map((turn) => `SIDE ${sideOf(turn.role)}: ${turn.text}${usedLine(turn)}`)
            .join("\n\n");
          const scope = projectish
            ? ""
            : "\n\nNOTE: no side opened a project file in this debate, and it is not about the project. Rule on the arguments and on any sources they cite; the only tool you have is `web` for checking a factual claim.";
          const prompt = `PROPOSITION: ${debate.topic}\n\n## DEBATE\n${record}${scope}`;
          live.begin(callId, { id: debate.id, role: "judge", phase: "verdict", route: judge.label, topic: debate.topic });
          let reply;
          try {
            reply = await callModel(ctx, judge, judgeSystem(config), prompt, {
              maxTokens: Math.max(positiveInt(config.judgeTokens, 12000), config.maxReplyTokens),
              temperature: config.judgeTemperature,
              timeoutMs: Math.max(config.timeoutMs, 240_000),
              // The arbiter verifies; the debater argues. One reading budget for both
              // meant the judge ran out while checking a claim it had already quoted.
              maxToolRounds: positiveInt(config.judgeToolRounds, 8),
              schemas: judgeSchemas,
              allowedToolNames: judgeAllowed,
              signal,
              repo: judgeRepo,
              onDelta: (patch) => live.progress(callId, patch),
            });
          } catch (error) {
            live.settle(callId, { error: String(error?.message ?? error) });
            throw error;
          }
          const turn = {
            role: "judge",
            text: reply.text.slice(0, MAX_TURN_CHARS),
            ms: reply.ms,
            at: new Date().toISOString(),
          };
          debate.turns.push(turn);
          debate.verdict = reply.text;
          debate.verdictSides = { A: aRole, B: bRole };
          saveDebate(config, debate);
          live.settle(callId, { text: reply.text });
          return {
              text: `${header(debate, turn, judge)}\n${clip(reply.text)}\n\nA = ${labelOf(aRole)} · B = ${labelOf(bRole)}`,
            };
          }),
        );
      }

      if (action === "result") {
        const id = typeof args?.id === "string" ? args.id.trim() : "";
        if (id === "") throw new Error('spar result: "id" is required');
        let debate = loadDebate(config, id);
        const waitMs =
          args?.wait === false
            ? 0
            : Math.min(Math.max(positiveInt(args?.waitMs, RESULT_WAIT_MS), 0), MAX_RESULT_WAIT_MS);
        const deadline = Date.now() + waitMs;
        // A turn that is still being written is not an answer. Wait for it here
        // instead of handing back an older one, so the caller never finishes a
        // turn without having read the reply it was waiting for.
        while (debate.pending !== null && debate.pending !== undefined && Date.now() < deadline) {
          if (signal?.aborted === true) break;
          await new Promise((resolve) => setTimeout(resolve, 400));
          debate = loadDebate(config, id);
        }
        if (debate.pending !== null && debate.pending !== undefined) {
          return {
            text:
              `[spar ${id} · result pending · ${debate.pending.route} · ${Math.round(waitMs / 1000)}s]\n` +
              "Turn is still being written. Do not answer as if it were read — call this again " +
              '(`action:"result"`), or say plainly that it did not reply.',
          };
        }
        // A turn that died must be reported as itself. Without this the next `result`
        // hands back the previous round, and a reader cannot tell that the message
        // it answered was never answered.
        if (debate.failed !== null && debate.failed !== undefined) {
          const failed = debate.failed;
          return {
            text:
              `[spar ${id} · failed · ${failed.route}]\n` +
              `${failed.message}\n\n` +
              "This turn produced no reply, so the previous round is not the answer to the last message. " +
              'Retry with `action:"say"` (or reply again), or read the transcript with `action:"show"`.',
          };
        }

        const last = [...debate.turns].reverse().find((turn) => turn.role !== "left");
        if (last === undefined) {
          return { text: `[spar ${id} · result]\nNothing has been written yet — the turn never started.` };
        }
        const route = last.role === "judge" ? judgeRoute(args?.judge, config, exec) : debate.right;
        // The caller's own turn is half the exchange. Printing only the reply made
        // the argument look lost even though the transcript had it, and the reader
        // could not check whether the reply answered what was actually said.
        const index = debate.turns.indexOf(last);
        const mine = index > 0 ? debate.turns[index - 1] : undefined;
        const own =
          mine !== undefined && mine.role === "left" && typeof mine.text === "string" && mine.text.trim() !== ""
            ? `A (ты) — твой аргумент:\n${
                mine.text.length > TURN_SHOWN_CHARS
                  ? `${mine.text.slice(0, TURN_SHOWN_CHARS)}\n… (${mine.text.length - TURN_SHOWN_CHARS} characters cut)`
                  : mine.text
              }\n\n`
            : "";
        return {
          text: `${own}${resultHeader(debate, last, route)}\n${clip(last.text)}${usedLine(last)}`,
        };
      }

      if (action === "show") {
        const id = typeof args?.id === "string" ? args.id.trim() : "";
        if (id === "") throw new Error('spar show: "id" is required');
        return { text: clip(renderForReading(loadDebate(config, id))) };
      }

      if (action === "close") {
        const id = typeof args?.id === "string" ? args.id.trim() : "";
        if (id === "") throw new Error('spar close: "id" is required');
        const debate = loadDebate(config, id);
        debate.closed = true;
        saveDebate(config, debate);
        return { text: `closed ${id} · ${debate.turns.length} turns kept at ${debatePath(config, id)}` };
      }

      throw new Error(`spar: unknown action "${action}". Use open, say, duel, verdict, show, list, or close.`);
    },
  });
}

async function listText(ctx, config) {
  const ids = listDebateIds(config);
  // The effective numbers, not the defaults: a saved setting overrides the profile,
  // and quoting a default while the file says something else is how a caller ends up
  // claiming "6 calls" to a model that was given 3.
  const lines = [
    `## budgets · ${String(config.maxToolRounds)} reads per turn · ${String(Math.round(MAX_TOOL_BYTES / 1024))} KB · reply ${String(config.maxReplyTokens)} · verdict ${String(config.judgeTokens)}`,
    `## modes · tools ${config.tools === true ? "on" : "off"} · judge reads ${String(config.judgeToolRounds ?? 8)} · opponent ${config.defaultOpponent || "не выбран"} · judge ${config.judge || "не выбран"}`,
    "",
    "## debates",
  ];
  if (ids.length === 0) lines.push('(none yet — start one with action:"open")');
  for (const id of ids.slice(-12)) {
    try {
      const debate = loadDebate(config, id);
      const turns = debate.turns.filter((turn) => turn.role !== "judge").length;
      const mark = debate.closed ? " · closed" : "";
      const verdict = debate.verdict === null ? "" : " · has verdict";
      lines.push(
        `- ${id} · ${debate.kind}/${debate.mode} · ${turns} turns${verdict}${mark} · ` +
          `${debate.left.label} vs ${debate.right.label} · ${debate.topic.slice(0, 90)}`,
      );
    } catch (error) {
      lines.push(`- ${id} · unreadable (${String(error?.message ?? error)})`);
    }
  }

  lines.push("", "## opponents");
  for (const alias of Object.keys(config.opponents).sort()) {
    const route = config.opponents[alias];
    const marks = [
      alias === config.defaultOpponent ? "default" : "",
      alias === config.judge ? "judge" : "",
      alias === config.challenger ? "challenger" : "",
    ].filter(Boolean);
    lines.push(`- ${alias} → ${route.provider}/${route.model}${marks.length === 0 ? "" : ` (${marks.join(", ")})`}`);
  }

  lines.push("", "## live routes");
  const llm = resolveLlm(ctx);
  if (llm === undefined) {
    lines.push("(no llm service mounted — nothing can be called)");
  } else {
    let providers = [];
    try {
      providers = llm.listProviders();
    } catch (error) {
      lines.push(`(provider registry unavailable: ${String(error?.message ?? error)})`);
    }
    lines.push(providers.length === 0 ? "(none registered)" : providers.map((entry) => `${entry.id} — ${entry.name}`).join(", "));

    // Reasoning levels per route matter for the judge: a route that cannot be
    // told to stop thinking spends the whole budget on thoughts and returns no
    // prose, which is a catalog fact, not a spelling mistake.
    lines.push("", "## reasoning levels");
    for (const provider of providers.slice(0, 8)) {
      let models = [];
      try {
        models = typeof llm.listModels === "function" ? await llm.listModels(provider.id) : [];
      } catch {
        models = [];
      }
      const rows = Array.isArray(models)
        ? models
        : models instanceof Map
          ? [...models.values()]
          : Object.values(models ?? {});
      for (const model of rows.slice(0, 12)) {
        const id = model?.id ?? model?.model;
        if (id === undefined) continue;
        const efforts = Array.isArray(model.reasoning?.efforts) ? model.reasoning.efforts.map((effort) => effort.id) : [];
        const out = model.maxTokens ?? model.maxOutputTokens ?? "?";
        const suffix =
          efforts.length === 0
            ? `(no reasoning levels) · maxOutput ${out}`
            : `efforts: ${efforts.join(", ")}${model.reasoning?.defaultEffort === undefined ? "" : ` · default: ${model.reasoning.defaultEffort}`} · maxOutput ${out}`;
        lines.push(`- ${provider.id}/${id} · ${suffix}`);
      }
    }
  }
  return lines.join("\n");
}

/** Test seam: pure helpers, no harness required. */
export const __internals = {
  normalizeConfig,
  resolveRoute,
  renderTranscript,
  renderForReading,
  userPrompt,
  duelPrompt,
  systemFor,
  readAttachments,
  JUDGE_SYSTEM,
  runTool,
  parseSearchHtml,
  assertPublicUrl,
};