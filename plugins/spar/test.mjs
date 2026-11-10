// Offline tests for `spar`: a fake ctx + fake llm stream, no network, no quota.
// Run: node test.mjs
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { apply, __internals } from "./index.js";
import { runTool } from "./tools.js";
import { createLiveRegistry } from "./live.js";

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label, detail = "") {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  failures.push(`${label}${detail === "" ? "" : ` — ${detail}`}`);
}

function eq(actual, expected, label) {
  ok(actual === expected, label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function includes(haystack, needle, label) {
  ok(typeof haystack === "string" && haystack.includes(needle), label, `missing ${JSON.stringify(needle)}`);
}

/** A fake ctx whose `llm` records every request and answers with a scripted text. */
function makeHarness({ text = "opponent reply", finish = { kind: "stop" }, dir, config, delayMs = 0 } = {}) {
  const calls = [];
  const tools = [];
  const llm = {
    calls,
    listProviders: () => [
      { id: "antigravity", name: "Antigravity" },
      { id: "zexkora", name: "Zexkora" },
    ],
    // A catalog, so the `models` action and the panel have something to list.
    listModels: async (provider) =>
      provider === "antigravity" ? [{ id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }] : [{ id: "deepseek-v4.1-flash-1017" }],
    stream(options) {
      calls.push(options);
      const answer = typeof text === "function" ? text(options) : text;
      return (async function* chunks() {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        // A scripted tool round: the model asks for a file instead of answering.
        if (answer !== null && typeof answer === "object" && answer.toolCall !== undefined) {
          yield {
            type: "block-end",
            index: 0,
            block: {
              type: "tool-call",
              id: answer.toolCall.id,
              name: answer.toolCall.name,
              arguments: answer.toolCall.arguments,
            },
          };
          yield { type: "finish", reason: { kind: "tool-calls" } };
          return;
        }
        yield { type: "text-delta", index: 0, text: answer };
        yield { type: "finish", reason: finish };
      })();
    },
    // Mirrors the real service: prepareCall resolves the route and hands back a
    // callable, and the effort selector is given the resolved model.
    async prepareCall(options, _signal, select) {
      const model = { provider: options.provider, id: options.model, reasoning: { efforts: [{ id: "off", name: "Off" }, { id: "high", name: "High" }], defaultEffort: "high" } };
      const controls = {
        provider: options.provider,
        model: options.model,
        maxTokens: options.maxTokens,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      };
      const chosen = select === undefined ? controls : select(controls, model);
      return { config: chosen, stream: (callOptions) => llm.stream(callOptions) };
    },
  };
  const ctx = {
    tools: { register: (definition) => tools.push(definition) },
    get: (name) => (name === "llm" ? llm : undefined),
    logger: { warn: () => {} },
  };
  // The plugin ships no models; a test fixture names its own, exactly like a
  // profile would. Every alias used by the suite is defined here.
  apply(ctx, {
    dir,
    opponents: {
      gemini: { provider: "antigravity", model: "gemini-3.8-flash" },
      "gemini-tiered": { provider: "antigravity", model: "gemini-3.8-flash-tiered" },
      kimi: { provider: "zexkora", model: "kimi-k3" },
      deepseek: { provider: "zexkora", model: "deepseek-v4.1-flash-1017" },
      "sonnet-ag": { provider: "antigravity", model: "claude-sonnet-4-6" },
      claude: { provider: "basisweb", model: "claude-sonnet-5.5" },
      gpt: { provider: "basisweb", model: "gpt-6.1-sol" },
    },
    defaultOpponent: "gemini",
    challenger: "kimi",
    judge: "deepseek",
    ...(config ?? {}),
  });
  const tool = tools[0];
  // Turns are async by default now; the offline suite asserts on the reply, so
  // it waits unless a test says otherwise (test 21 exercises the async path).
  const execute = (args, exec) => tool.execute(args.async === undefined ? { ...args, async: false } : args, exec);
  return { ctx, tools, llm, tool: { ...tool, execute }, calls };
}

function sandboxDir(label) {
  const dir = mkdtempSync(path.join(tmpdir(), `spar-${label}-`));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const exec = { signal: undefined };

/* ------------------------------------------------------------------ tests -- */

// 1. config + route resolution
{
  const config = __internals.normalizeConfig({ opponents: { extra: { provider: "p", model: "m" } } });
  eq(Object.keys(config.opponents).join(","), "extra", "the plugin ships no model aliases of its own");
  eq(config.opponents.extra.model, "m", "custom alias merged");
  eq(__internals.resolveRoute("extra", config).model, "m", "alias resolves");
  eq(__internals.resolveRoute("basisweb/gpt-6.1-sol", config).provider, "basisweb", "provider/model resolves");
  eq(__internals.resolveRoute("zexkora:kimi-k3.1-pro", config).model, "kimi-k3.1-pro", "provider:model resolves");
  let threw = false;
  try {
    __internals.resolveRoute("nope", config);
  } catch {
    threw = true;
  }
  ok(threw, "unknown alias throws");

  // 1b. nothing is assumed about which provider the installation has.
  const bare = __internals.normalizeConfig({});
  eq(bare.defaultOpponent, "", "no default opponent");
  eq(bare.judge, "", "no default judge");
  eq(bare.challenger, "", "no default challenger");
  let message = "";
  try {
    __internals.resolveRoute("", bare);
  } catch (error) {
    message = String(error.message);
  }
  includes(message, "модель не выбрана", "an empty route explains itself instead of naming a model");
  includes(message, "панели", "and points at the panel");
}

// 2. registration shape
{
  const { dir, cleanup } = sandboxDir("register");
  const { tools } = makeHarness({ dir });
  eq(tools.length, 1, "one tool registered");
  eq(tools[0].name, "spar", "tool name");
  eq(typeof tools[0].execute, "function", "execute present");
  eq(tools[0].parameters.type, "object", "parameters is a JSON schema");
  eq(tools[0].parameters.required[0], "action", "action required");
  ok(Array.isArray(tools[0].parameters.properties.action.enum), "action has enum");
  const rendered = tools[0].output.render({}, { text: "hello" });
  eq(rendered[0].text, "hello", "output render");
  cleanup();
}

// 3. open returns the opponent's opening and persists a transcript
{
  const { dir, cleanup } = sandboxDir("open");
  const { tool, llm, calls } = makeHarness({ dir, text: "Your claim assumes X causes Y without a mechanism." });
  const result = await tool.execute({ action: "open", topic: "Tabs beat spaces in every codebase" }, exec);
  eq(calls.length, 1, "one model call on open");
  eq(calls[0].provider, "antigravity", "routed to the bridge provider");
  eq(calls[0].model, "gemini-3.8-flash", "routed to the default opponent model");
  eq(calls[0].reasoningEffort, undefined, "a debate reply keeps the profile's reasoning default");
  includes(calls[0].system, "Write everything you say in Russian", "the exchange is written in Russian");
  includes(result.text, "Your claim assumes X", "reply surfaced");
  includes(result.text, "[spar d1", "header carries the debate id");
  includes(calls[0].system, "Break the opponent's position", "strike rules present");
  includes(calls[0].messages[0].content[0].text, "has not argued yet", "opening prompt");

  const stored = JSON.parse(readFileSync(path.join(dir, "d1.json"), "utf8"));
  eq(stored.left.label, "вызывающий агент", "the calling agent is named in the exchange's language");
  eq(stored.turns.length, 1, "one turn stored");
  eq(stored.turns[0].role, "right", "stored as the opponent's turn");
  ok(stored.__config === undefined, "runtime config is not persisted");
  ok(stored.maxTranscriptChars === undefined, "runtime budget is not persisted");
  cleanup();
}

// 4. say records my turn and shows the transcript to the opponent
{
  const { dir, cleanup } = sandboxDir("say");
  const { tool, calls } = makeHarness({ dir, text: "Weak: you conflate correlation with cause." });
  await tool.execute({ action: "open", topic: "Remote work kills culture" }, exec);
  const result = await tool.execute(
    { action: "say", id: "d1", message: "Culture is written down in rituals, not hallways." },
    exec,
  );
  eq(calls.length, 2, "second call on say");
  const prompt = calls[1].messages[0].content[0].text;
  includes(prompt, "Culture is written down in rituals", "my message reaches the opponent");
  includes(prompt, "OPPONENT (1)", "my turn is labelled from the opponent's side");
  includes(prompt, "YOU (1)", "their earlier reply is labelled as theirs");
  includes(result.text, "r2", "header shows the round (their second reply)");
  eq(JSON.parse(readFileSync(path.join(dir, "d1.json"), "utf8")).turns.length, 3, "three turns stored");
  cleanup();
}

// 5. opening:"me" starts silent
{
  const { dir, cleanup } = sandboxDir("silent");
  const { tool, calls } = makeHarness({ dir });
  const result = await tool.execute({ action: "open", topic: "Tabs vs spaces", opening: "me" }, exec);
  eq(calls.length, 0, "no model call on a silent open");
  includes(result.text, "Silent start", "returned a hint instead of a reply");
  cleanup();
}

// 6. verdict rules with an uninvolved judge and stores the ruling
{
  const { dir, cleanup } = sandboxDir("verdict");
  const { tool, calls } = makeHarness({ dir, text: "1. first read: side A" });
  await tool.execute({ action: "open", topic: "Tabs vs spaces" }, exec);
  await tool.execute({ action: "say", id: "d1", message: "Alignment is a tooling problem." }, exec);
  const result = await tool.execute({ action: "verdict", id: "d1", judge: "kimi" }, exec);
  const judgeCall = calls[calls.length - 1];
  eq(judgeCall.provider, "zexkora", "judge routed to the configured judge");
  eq(judgeCall.model, "kimi-k3", "judge model");
  includes(judgeCall.system, "arbiter", "judge system prompt");
  includes(judgeCall.system, "steelman of the side you are inclined to reject", "judge must steelman the side it rejects");
  includes(judgeCall.messages[0].content[0].text, "SIDE A", "judge sees both sides");
  ok(!judgeCall.messages[0].content[0].text.includes("calling agent"), "judge is blinded to who is the caller");
  ok(!judgeCall.messages[0].content[0].text.includes("gemini-3.8-flash"), "judge is blinded to model names");
  includes(result.text, "verdict", "verdict header");
  includes(result.text, "A = ", "mapping disclosed after the ruling");
  const stored = JSON.parse(readFileSync(path.join(dir, "d1.json"), "utf8"));
  eq(stored.verdict, "1. first read: side A", "verdict stored on the debate");
  eq(typeof stored.verdictSides.A, "string", "blind mapping stored for replay");
  cleanup();
}

// 6b. the twin route still works when asked for by name
{
  const { dir, cleanup } = sandboxDir("selfjudge");
  const { tool, calls } = makeHarness({ dir, text: "1. first read: side B" });
  const own = {
    signal: undefined,
    agent: { options: { provider: "zexkora", model: "deepseek-v4.1-flash-1017" } },
  };
  await tool.execute({ action: "open", topic: "Ship the renderer before the auto hook" }, own);
  await tool.execute({ action: "say", id: "d1", message: "The visual half is the ask; the hook is second." }, own);
  const result = await tool.execute({ action: "verdict", id: "d1", judge: "self" }, own);
  const judgeCall = calls[calls.length - 1];
  eq(judgeCall.provider, "zexkora", "self judge uses the live provider");
  eq(judgeCall.model, "deepseek-v4.1-flash-1017", "self judge uses the live model");
  includes(result.text, "zexkora/deepseek-v4.1-flash-1017", "header names the twin route");
  ok(!judgeCall.messages[0].content[0].text.includes("calling agent"), "the twin never learns it is the caller");
  cleanup();
}

// 6d. by default the ruling comes from the caller's own model, in a blinded context
{
  const { dir, cleanup } = sandboxDir("defaultjudge");
  const { tool, calls } = makeHarness({ dir, text: "1. first read: side A" });
  const own = { signal: undefined, agent: { options: { provider: "zexkora", model: "deepseek-v4.1-flash-1017" } } };
  await tool.execute({ action: "open", topic: "Ship the renderer before the auto hook" }, own);
  await tool.execute({ action: "say", id: "d1", message: "Renderer first." }, own);
  await tool.execute({ action: "verdict", id: "d1" }, own);
  const judgeCall = calls[calls.length - 1];
  eq(judgeCall.provider, "zexkora", "default judge provider");
  eq(judgeCall.model, "deepseek-v4.1-flash-1017", "default judge is the same model as the caller, so it rules fast");
  includes(judgeCall.system, "Write everything you say in Russian", "the ruling is written in Russian");
  ok(!judgeCall.system.includes("calling agent"), "the judge is not told who argued");
  cleanup();
}

// 6c. asking for the twin without a live route fails loudly
{
  const { dir, cleanup } = sandboxDir("noroute");
  const { tool } = makeHarness({ dir });
  await tool.execute({ action: "open", topic: "x" }, exec);
  let message = "";
  try {
    await tool.execute({ action: "verdict", id: "d1", judge: "self" }, { signal: undefined });
  } catch (error) {
    message = String(error.message);
  }
  includes(message, "cannot read the live model route", "missing route is explained");
  cleanup();
}

// 7. a debater cannot judge its own debate
{
  const { dir, cleanup } = sandboxDir("selfjudge");
  const { tool } = makeHarness({ dir });
  await tool.execute({ action: "open", topic: "x" }, exec);
  let message = "";
  try {
    await tool.execute({ action: "verdict", id: "d1", judge: "gemini" }, exec);
  } catch (error) {
    message = String(error.message);
  }
  includes(message, "one of the debaters", "self-judging is refused");
  cleanup();
}

// 8. duel runs two different models and returns the exchange
{
  const { dir, cleanup } = sandboxDir("duel");
  const { tool, calls } = makeHarness({
    dir,
    text: (options) => `${options.model} speaks`,
  });
  const result = await tool.execute(
    { action: "duel", topic: "Static typing pays for itself", sides: ["gemini", "claude"], rounds: 2 },
    exec,
  );
  eq(calls.length, 4, "two rounds = four calls");
  eq(calls[0].model, "gemini-3.8-flash", "side A is the first route");
  eq(calls[1].provider, "basisweb", "side B is the second route");
  includes(calls[1].system, "AGAINST", "side B argues against");
  includes(result.text, "FOR", "duel result labels the sides");
  includes(result.text, "gemini-3.8-flash speaks", "side A text present");
  cleanup();
}

// 9. duel refuses a monologue
{
  const { dir, cleanup } = sandboxDir("monologue");
  const { tool } = makeHarness({ dir });
  let message = "";
  try {
    await tool.execute({ action: "duel", topic: "x", sides: ["gemini", "gemini"] }, exec);
  } catch (error) {
    message = String(error.message);
  }
  includes(message, "both sides resolved", "same-model duel refused");
  cleanup();
}

// 10. provider failure surfaces its code
{
  const { dir, cleanup } = sandboxDir("failure");
  const { tool } = makeHarness({
    dir,
    finish: { kind: "error", failure: { code: "RATE_LIMIT", message: "quota exhausted" } },
  });
  let message = "";
  try {
    await tool.execute({ action: "open", topic: "x" }, exec);
  } catch (error) {
    message = String(error.message);
  }
  includes(message, "RATE_LIMIT", "failure code propagates");
  cleanup();
}

// 11. an empty reply is an error, not a silent empty turn
{
  const { dir, cleanup } = sandboxDir("empty");
  const { tool } = makeHarness({ dir, text: "" });
  let message = "";
  try {
    await tool.execute({ action: "open", topic: "x" }, exec);
  } catch (error) {
    message = String(error.message);
  }
  includes(message, "returned no text", "empty reply rejected");
  cleanup();
}

// 12. transcript truncation keeps head and tail with an elision marker
{
  const config = __internals.normalizeConfig({ maxTranscriptChars: 400 });
  const turns = [];
  for (let index = 0; index < 20; index += 1) {
    turns.push({ role: index % 2 === 0 ? "left" : "right", text: `turn ${index} ${"x".repeat(60)}` });
  }
  const rendered = __internals.renderTranscript(turns, "right", config.maxTranscriptChars);
  includes(rendered, "turn 0", "opening turn survives truncation");
  includes(rendered, "elided", "elision marker present");
  includes(rendered, "turn 19", "latest turn survives truncation");
  ok(rendered.length < 1200, "truncated transcript stays bounded", `length ${rendered.length}`);
}

// 13. attachments are read, capped, and reported when unreadable
{
  const { dir, cleanup } = sandboxDir("attach");
  const file = path.join(dir, "code.js");
  writeFileSync(file, "export const x = 1;\n".repeat(10), "utf8");
  const config = __internals.normalizeConfig({ maxAttachChars: 500 });
  const attached = __internals.readAttachments([file, path.join(dir, "missing.js")], config);
  eq(attached.length, 2, "both entries returned");
  includes(attached[0].text, "export const x", "file content read");
  includes(attached[1].text, "unreadable", "missing file reported inline");
  cleanup();
}

// 14. my turn is stored even when the opponent fails, so the record never lies
{
  const { dir, cleanup } = sandboxDir("partial");
  const { tool } = makeHarness({ dir, finish: { kind: "error", failure: { code: "AUTH", message: "no key" } } });
  try {
    await tool.execute({ action: "open", topic: "x" }, exec);
  } catch {
    /* expected */
  }
  let stored = null;
  try {
    stored = JSON.parse(readFileSync(path.join(dir, "d1.json"), "utf8"));
  } catch {
    stored = null;
  }
  ok(stored === null || stored.turns.length === 0, "a failed opening leaves no phantom turn");
  cleanup();
}

// 15. unknown action, missing ids, and closed debates all fail loudly
{
  const { dir, cleanup } = sandboxDir("errors");
  const { tool } = makeHarness({ dir });
  for (const [args, needle] of [
    [{ action: "dance" }, "unknown action"],
    [{ action: "say", id: "d1", message: "hi" }, "does not exist"],
    [{ action: "open", topic: "" }, "topic"],
    [{ action: "show" }, "id"],
  ]) {
    let message = "";
    try {
      await tool.execute(args, exec);
    } catch (error) {
      message = String(error.message);
    }
    includes(message, needle, `error for ${JSON.stringify(args)}`);
  }
  await tool.execute({ action: "open", topic: "x" }, exec);
  await tool.execute({ action: "close", id: "d1" }, exec);
  let message = "";
  try {
    await tool.execute({ action: "say", id: "d1", message: "hi" }, exec);
  } catch (error) {
    message = String(error.message);
  }
  includes(message, "closed", "closed debate refuses new turns");
  cleanup();
}

// 16. list reports debates, aliases, and live routes
{
  const { dir, cleanup } = sandboxDir("list");
  const { tool } = makeHarness({ dir });
  await tool.execute({ action: "open", topic: "Cache invalidation is a naming problem" }, exec);
  const result = await tool.execute({ action: "list" }, exec);
  includes(result.text, "d1", "debate listed");
  includes(result.text, "gemini → antigravity/gemini-3.8-flash", "alias listed");
  includes(result.text, "antigravity", "live provider listed");
  cleanup();
}

// 17. a per-call cap overrides the profile default
{
  const { dir, cleanup } = sandboxDir("tokens");
  const { tool, calls } = makeHarness({ dir });
  await tool.execute({ action: "open", topic: "x", maxTokens: 77 }, exec);
  eq(calls[0].maxTokens, 77, "maxTokens override reaches the provider");
  cleanup();
}

// 18. a debater reads the repository itself instead of trusting the brief
{
  const { dir, cleanup } = sandboxDir("toolcall");
  const repo = mkdtempSync(path.join(tmpdir(), "spar-repo-"));
  writeFileSync(path.join(repo, "NOTES.md"), "# RULES\nonly this line\n");
  const { tool, calls } = makeHarness({
    dir,
    text: (options) => {
      const answered = Array.isArray(options.messages) && options.messages.some((message) => message.role === "tool");
      if (Array.isArray(options.tools) && options.tools.length > 0 && !answered) {
        return { toolCall: { id: "call_read_1", name: "read", arguments: JSON.stringify({ path: "NOTES.md" }) } };
      }
      return "цитата: only this line";
    },
  });
  const result = await tool.execute({ action: "open", topic: "прочитай NOTES.md", cwd: repo }, exec);
  const second = calls[1];
  const toolMessage = Array.isArray(second?.messages) ? second.messages.find((message) => message.role === "tool") : undefined;
  ok(toolMessage !== undefined, "the tool result is fed back to the model");
  includes(toolMessage?.content?.[0]?.text ?? "", "only this line", "the real file content reaches the model");
  includes(result.text, "· читал: read NOTES.md", "the turn records what it read");
  includes(result.text, "only this line", "the answer uses the file");
  ok(Array.isArray(second.tools) && second.tools.length > 0, "tools stay available for the next round");
  rmSync(repo, { recursive: true, force: true });
  cleanup();
}

// 19. a debater cannot read outside the debate root
{
  const { dir, cleanup } = sandboxDir("escape");
  const repo = mkdtempSync(path.join(tmpdir(), "spar-jail-"));
  const { tool, calls } = makeHarness({
    dir,
    text: (options) => {
      const answered = Array.isArray(options.messages) && options.messages.some((message) => message.role === "tool");
      if (Array.isArray(options.tools) && options.tools.length > 0 && !answered) {
        return { toolCall: { id: "call_1", name: "read", arguments: JSON.stringify({ path: "../../secret.txt" }) } };
      }
      return "не смог прочитать";
    },
  });
  await tool.execute({ action: "open", topic: "x", cwd: repo }, exec);
  const toolMessage = calls[1].messages.find((message) => message.role === "tool");
  includes(toolMessage?.content?.[0]?.text ?? "", "escapes the debate root", "path escape is refused");
  rmSync(repo, { recursive: true, force: true });
  cleanup();
}

// 20. live state what the card polls while a turn is being written
{
  const { createLiveRegistry, liveHandler } = await import("./live.js");
  const live = createLiveRegistry();
  live.begin("call_1", { id: "d9", role: "right", phase: "reply", route: "antigravity/gemini-3.8-flash", topic: "t" });
  live.progress("call_1", { text: "первая фраза", activity: "read NOTES.md" });
  const mid = live.read("call_1");
  eq(mid.text, "первая фраза", "partial text is exposed");
  eq(mid.activity, "read NOTES.md", "current read is exposed");
  eq(mid.done, false, "a running turn is not settled");
  live.settle("call_1", { text: "первая фраза, конец" });
  const end = live.read("call_1");
  eq(end.done, true, "the turn settles");
  includes(end.text, "конец", "the settled text wins");
  ok(typeof end.ms === "number" && end.ms >= 0, "elapsed time is reported");

  let status;
  let body;
  const res = {
    writeHead: (code) => {
      status = code;
    },
    end: (text) => {
      body = text;
    },
  };
  liveHandler(live)({ method: "GET", url: "/spar-live?call=call_1" }, res);
  eq(status, 200, "route answers");
  includes(body, "первая фраза", "route returns the turn");
  liveHandler(live)({ method: "GET", url: "/spar-live?call=nope" }, res);
  includes(body, "missing", "an unknown call is reported as missing");
}

// 21. async: the turn does not block the caller
{
  const { dir, cleanup } = sandboxDir("async");
  const { tool, calls } = makeHarness({ dir, text: "готово: возражение" });
  const opened = await tool.execute({ action: "open", topic: "x", async: true }, exec);
  includes(opened.text, "started", "async open returns at once");
  const deadline = Date.now() + 2000;
  let result;
  while (Date.now() < deadline) {
    result = await tool.execute({ action: "result", id: "d1" }, exec);
    if (result.text.includes("готово: возражение")) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  includes(result.text, "готово: возражение", "result action reads the finished turn");
  eq(calls.length, 1, "exactly one model call was made");
  cleanup();
}

// 22. a folder of folders is not "empty"
{
  const repo = mkdtempSync(path.join(tmpdir(), "spar-dirs-"));
  mkdirSync(path.join(repo, "src", "driver"), { recursive: true });
  mkdirSync(path.join(repo, "src", "uefi"), { recursive: true });
  writeFileSync(path.join(repo, "src", "driver", "main.c"), "int main(void) { return 0; }\n");
  const listing = runTool(repo, "read", { path: "src" });
  includes(listing, "driver/", "read on a directory lists subdirectories");
  includes(listing, "uefi/", "all subdirectories are listed");
  ok(!listing.includes("empty"), "an intermediate folder is not reported as empty");
  const globbed = runTool(repo, "glob", { pattern: "src/*" });
  includes(globbed, "src/driver/", "glob includes directories");
  includes(globbed, "src/uefi/", "glob includes every directory");
  includes(runTool(repo, "glob", { pattern: "**/*.c" }), "src/driver/main.c", "glob still finds files");
  const subtree = runTool(repo, "glob", { pattern: "src/**" });
  includes(subtree, "src/driver/", "`dir/**` matches the directories below it");
  includes(subtree, "src/driver/main.c", "`dir/**` matches the files below it");
  rmSync(repo, { recursive: true, force: true });
}

// 23. live state carries reasoning and the reads a turn made
{
  const { createLiveRegistry } = await import("./live.js");
  const live = createLiveRegistry();
  live.begin("call_r", { id: "d1", role: "right", phase: "reply", route: "antigravity/x" });
  live.progress("call_r", { reasoningDelta: "сначала проверю " });
  live.progress("call_r", { reasoningDelta: "документ" });
  live.progress("call_r", { step: { name: "read", subject: "docs/A.md" } });
  live.progress("call_r", { step: { name: "grep", subject: "PsLoadedModuleList" } });
  live.progress("call_r", { step: { name: "grep", subject: "PsLoadedModuleList" } });
  const state = live.read("call_r");
  eq(state.reasoning, "сначала проверю документ", "reasoning deltas accumulate");
  eq(state.steps.length, 2, "a repeated read is not listed twice");
  eq(state.steps[1].subject, "PsLoadedModuleList", "the read subject is kept");
}

// 24. async is the default: a turn starts without being asked to
{
  const { dir, cleanup } = sandboxDir("asyncdefault");
  const { tools } = makeHarness({ dir, text: "ответ" });
  const started = await tools[0].execute({ action: "open", topic: "x" }, exec);
  includes(started.text, "started", "open does not block by default");
  includes(started.text, 'action:"result"', "the acknowledgement says how to collect it");
  await new Promise((resolve) => setTimeout(resolve, 50));
  cleanup();
}

// 25. a catalog pick works without an alias
{
  const { dir, cleanup } = sandboxDir("catalogpick");
  const { tool, calls } = makeHarness({ dir, config: { defaultOpponent: "deepseek-account/deepseek-v4-pro" } });
  await tool.execute({ action: "open", topic: "x" }, exec);
  eq(calls[0].provider, "deepseek-account", "the provider comes from the pick");
  eq(calls[0].model, "deepseek-v4-pro", "the model comes from the pick");
  cleanup();
}

// 26. the settings store round-trips, and an empty value reverts
{
  const { createSettingsStore, normalizeSettings } = await import("./settings.js");
  const repo = mkdtempSync(path.join(tmpdir(), "spar-settings-"));
  const file = path.join(repo, "settings.json");
  const store = createSettingsStore(file);
  eq(Object.keys(store.read()).length, 0, "a missing file reads as empty");
  store.write({ opponent: "antigravity/gemini-3.8-flash", maxReplyTokens: 4096, nonsense: 1 });
  const saved = store.read();
  eq(saved.opponent, "antigravity/gemini-3.8-flash", "the pick persists");
  eq(saved.maxReplyTokens, 4096, "a number persists");
  eq(saved.nonsense, undefined, "an unknown key is dropped");
  store.write({ opponent: "" });
  eq(store.read().opponent, undefined, "an empty value reverts to the profile");
  eq(store.read().maxReplyTokens, 4096, "other keys survive the revert");
  const cleaned = normalizeSettings({ maxToolRounds: -2, tools: "yes", language: "ru" });
  eq(cleaned.maxToolRounds, undefined, "a negative budget is rejected");
  eq(cleaned.tools, undefined, "a non-boolean toggle is rejected");
  eq(cleaned.language, "ru", "a known key survives validation");
  rmSync(repo, { recursive: true, force: true });
}

// 27. result waits for a turn that is still being written
{
  const { dir, cleanup } = sandboxDir("resultwait");
  const { tool } = makeHarness({ dir, text: "готовый ответ", delayMs: 300 });
  await tool.execute({ action: "open", topic: "x", async: true }, exec);
  const early = await tool.execute({ action: "result", id: "d1", wait: false }, exec);
  includes(early.text, "result pending", "a running turn is reported as pending, not answered");
  includes(early.text, "Do not answer", "the caller is told not to answer blind");
  ok(!early.text.includes("готовый ответ"), "an unfinished turn is never shown as the reply");
  const settled = await tool.execute({ action: "result", id: "d1" }, exec);
  includes(settled.text, "result r1", "the collected turn carries a result header");
  includes(settled.text, "готовый ответ", "and the reply itself");
  ok(!settled.text.includes("pending"), "a settled turn is no longer pending");
  cleanup();
}

// 28. a failed turn does not leave the debate waiting forever
{
  const { dir, cleanup } = sandboxDir("resultfail");
  const { tool } = makeHarness({ dir, finish: { kind: "error", failure: { code: "boom" } } });
  await tool.execute({ action: "open", topic: "x", async: true }, exec);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const state = JSON.parse(readFileSync(path.join(dir, "d1.json"), "utf8"));
  eq(state.pending ?? null, null, "a failed turn clears the pending marker");
  const result = await tool.execute({ action: "result", id: "d1" }, exec);
  includes(result.text, "failed", "a failed turn is reported as a failure");
  includes(result.text, "boom", "and the provider's reason comes with it");
  includes(result.text, "not the answer", "and it says the previous round is not the answer");
  cleanup();
}

// 29. the judge reads the debate's project, not the session directory
{
  const { dir, cleanup } = sandboxDir("judgecwd");
  const project = path.join(dir, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, "only-here.txt"), "MARKER-ONLY-IN-THE-DEBATE-REPO\n", "utf8");

  // The arbiter asks for a file; only the debate's own directory contains it,
  // so a successful read proves which repo the judge was handed.
  let judgeAsked = false;
  const scripted = (options) => {
    if (!String(options.system ?? "").includes("arbiter")) return "opponent reply";
    if (!judgeAsked) {
      judgeAsked = true;
      return { toolCall: { id: "j1", name: "read", arguments: { path: "only-here.txt" } } };
    }
    return "ruling";
  };

  const { tool, calls } = makeHarness({ dir, text: scripted, config: { tools: true, maxToolRounds: 2 } });
  await tool.execute({ action: "open", topic: "t", cwd: project, async: false }, exec);
  // Neither side read anything, so the debate counts as not being about the repo;
  // `project: true` is the caller's way to say otherwise.
  await tool.execute({ action: "verdict", id: "d1", project: true, async: false }, exec);

  const judgeCall = calls[calls.length - 1];
  const seen = JSON.stringify(judgeCall.messages ?? "");
  includes(seen, "MARKER-ONLY-IN-THE-DEBATE-REPO", "the arbiter opened the file from the debate's cwd");
  includes(String(judgeCall.system), "open at least one artefact per side", "and was told to verify artefacts");
  includes(
    String(judgeCall.system),
    "counts at full weight",
    "familiarity costs evidence, not the claim: a surviving familiar argument keeps its weight",
  );
  cleanup();
}

// 30. nothing is assumed about which models the installation has
{
  const { dir, cleanup } = sandboxDir("nomodel");
  const { tool } = makeHarness({ dir, config: { opponents: {}, defaultOpponent: "", judge: "", challenger: "" } });

  let message = "";
  try {
    await tool.execute({ action: "open", topic: "x" }, exec);
  } catch (error) {
    message = String(error.message);
  }
  includes(message, "модель не выбрана", "open refuses to guess an opponent");
  includes(message, "панели", "and points at the panel");

  const both = await tool.execute({ action: "open", topic: "x", opponent: "antigravity/gemini-3.8-flash" }, exec);
  includes(both.text, "antigravity/gemini-3.8-flash", "an explicit route works with no aliases at all");

  message = "";
  try {
    await tool.execute({ action: "verdict", id: "d1" }, exec);
  } catch (error) {
    message = String(error.message);
  }
  includes(message, "судья не выбран", "verdict refuses to pick a judge");
  includes(message, 'judge:"self"', "and names the explicit opt-in");
  cleanup();
}

// 31. the catalog is reachable from the tool, not only from the browser
{
  const { dir, cleanup } = sandboxDir("models");
  const { tool } = makeHarness({ dir });
  const result = await tool.execute({ action: "models" }, exec);
  includes(result.text, "spar models", "the action answers with a header the card understands");
  includes(result.text, "antigravity:", "and groups the catalog by provider");
  includes(result.text, "gemini-3.8-flash", "with the model names under it");
  includes(result.text, "уже выбрано в профиле", "it answers the real question first: who will argue");
  cleanup();
}

// 32. a whole-file read is one call, and the trail says how much was covered
{
  const { dir, cleanup } = sandboxDir("whole");
  const project = path.join(dir, "project");
  mkdirSync(project, { recursive: true });
  const lines = Array.from({ length: 1200 }, (_, index) => `line ${index + 1}`).join("\n");
  writeFileSync(path.join(project, "big.txt"), lines, "utf8");

  const slice = __internals.runTool(project, "read", { path: "big.txt" });
  includes(slice, "lines 1-200 of 1200", "a plain read still takes a slice");
  const whole = __internals.runTool(project, "read", { path: "big.txt", whole: true });
  includes(whole, "lines 1-1200 of 1200", "`whole` reads the file past the default slice");
  cleanup();
}

// 33. losing the tools is announced, not silent
{
  const { dir, cleanup } = sandboxDir("budget");
  let asked = false;
  const scripted = () => {
    if (!asked) {
      asked = true;
      return { toolCall: { id: "r1", name: "read", arguments: JSON.stringify({ path: "a.txt" }) } };
    }
    return "answering without tools";
  };
  writeFileSync(path.join(dir, "a.txt"), "hello\n", "utf8");
  const { tool, calls } = makeHarness({ dir, text: scripted, config: { maxToolRounds: 1 } });
  await tool.execute({ action: "open", topic: "t", async: false }, exec);

  const finalCall = calls[calls.length - 1];
  includes(
    JSON.stringify(finalCall.messages ?? ""),
    "Reading budget for this turn is spent",
    "the model is told the budget is gone, so it cannot claim it looked",
  );
  cleanup();
}

// 34. the read trail records coverage, not just the path
{
  const { dir, cleanup } = sandboxDir("coverage");
  writeFileSync(path.join(dir, "a.txt"), "hello\nworld\n", "utf8");
  let asked = false;
  const scripted = () => {
    if (!asked) {
      asked = true;
      return { toolCall: { id: "r1", name: "read", arguments: JSON.stringify({ path: "a.txt" }) } };
    }
    return "done";
  };
  const { tool } = makeHarness({ dir, text: scripted, config: { maxToolRounds: 1 } });
  const result = await tool.execute({ action: "open", topic: "t", async: false, cwd: dir }, exec);
  includes(result.text, "a.txt (1-", "the trail says which lines were actually read");
  cleanup();
}

// 35. the header counts the lines the byte ceiling actually delivered
{
  const { dir, cleanup } = sandboxDir("ceiling");
  const line = "x".repeat(1000);
  const body = Array.from({ length: 500 }, () => line).join("\n");
  writeFileSync(path.join(dir, "big.txt"), body, "utf8");

  const text = __internals.runTool(dir, "read", { path: "big.txt", whole: true });
  const header = text.split("\n")[0];
  includes(header, "of 500", "the total is the real line count");
  if (header.includes("1-500")) throw new Error(`the header claims the whole file: ${header}`);
  includes(header, "stopped at the 256 KB ceiling", "and says where it stopped");
  cleanup();
}

// 36. an empty file is not a one-line file
{
  const { dir, cleanup } = sandboxDir("empty");
  writeFileSync(path.join(dir, "zero.txt"), "", "utf8");
  const text = __internals.runTool(dir, "read", { path: "zero.txt" });
  includes(text, "empty file", "an empty file says so instead of claiming line 1");
  if (text.includes("lines 1-1")) throw new Error(`empty file reported as one line: ${text}`);
  cleanup();
}

// 37. `git diff` hands back the change, not a summary of it
{
  const { dir, cleanup } = sandboxDir("gitdiff");
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "one"]);
  writeFileSync(path.join(dir, "a.txt"), "hello\n", "utf8");
  git(["add", "."]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "two"]);
  writeFileSync(path.join(dir, "a.txt"), "hello\nworld\n", "utf8");

  const diff = __internals.runTool(dir, "git", { sub: "diff" });
  includes(diff, "+world", "the default diff shows the added line");
  const stat = __internals.runTool(dir, "git", { sub: "diff", stat: true });
  includes(stat, "1 insertion", "`stat: true` gives the summary when asked");
  cleanup();
}

// 38. a truncated glob says it is truncated
{
  const { dir, cleanup } = sandboxDir("globcut");
  for (let index = 0; index < 405; index += 1) writeFileSync(path.join(dir, `f${index}.txt`), "x", "utf8");
  const text = __internals.runTool(dir, "glob", { pattern: "*.txt" });
  includes(text, "stopped at 400 matches", "a cut list is not passed off as complete");
  cleanup();
}

// 39. a later turn still reads the project the debate was opened on
{
  const { dir, cleanup } = sandboxDir("pinned");
  const projectA = path.join(dir, "a");
  const projectB = path.join(dir, "b");
  mkdirSync(projectA, { recursive: true });
  mkdirSync(projectB, { recursive: true });
  writeFileSync(path.join(projectA, "marker.txt"), "AAAA\n", "utf8");
  writeFileSync(path.join(projectB, "marker.txt"), "BBBB\n", "utf8");

  let phase = 0;
  const scripted = () => {
    phase += 1;
    // one read per turn, then prose
    return phase % 2 === 1
      ? { toolCall: { id: `r${phase}`, name: "read", arguments: JSON.stringify({ path: "marker.txt" }) } }
      : "готово";
  };
  const { tool, calls } = makeHarness({ dir, text: scripted, config: { cwd: projectB } });
  await tool.execute({ action: "open", topic: "t", cwd: projectA, async: false }, exec);
  const before = calls.length;
  await tool.execute({ action: "say", id: "d1", message: "ещё", async: false }, exec);
  const later = JSON.stringify(calls.slice(before).map((call) => call.messages));
  includes(later, "AAAA", "the second turn read the debate's project, not the session's");
  if (later.includes("BBBB")) throw new Error("a later turn read the session directory instead");
  cleanup();
}

// 40. a run whose process died is reported as stalled, not as still writing
{
  const registry = createLiveRegistry();
  const state = registry.begin("c1", { id: "d1", role: "reply", route: "p/m", phase: "replying" });
  if (state === undefined) throw new Error("begin returned nothing");
  state.at = Date.now() - 9 * 60 * 1000;
  const read = registry.read("c1");
  if (read.stalled !== true) throw new Error("a silent run was not marked stalled");
  if (read.done === true) throw new Error("a silent run must not claim to be done");
  eq(registry.active().length, 0, "a silent run is not listed as active");
  eq(registry.newest(), null, "and is not served as the newest live turn");
  // A pause shorter than the idle window is not a corpse: a turn that takes five
  // minutes between tokens used to be declared dead and stayed dead.
  const slow = registry.begin("c2", { id: "d2", role: "reply", route: "p/m", phase: "replying" });
  slow.at = Date.now() - 5 * 60 * 1000;
  eq(registry.read("c2").stalled, false, "five quiet minutes are still motion");
  registry.settle("c1", { text: "done" });
  eq(registry.read("c1").stalled, false, "a settled turn is never stalled, even after silence");
}

// 41. a tool call without an id still gets a paired id (Anthropic rejects the rest)
{
  const { dir, cleanup } = sandboxDir("toolid");
  writeFileSync(path.join(dir, "a.txt"), "hello\n", "utf8");
  let phase = 0;
  const scripted = () => {
    phase += 1;
    // deliberately no `id`, the way some streams report a call
    return phase === 1
      ? { toolCall: { name: "read", arguments: JSON.stringify({ path: "a.txt" }) } }
      : "ok";
  };
  const { tool, calls } = makeHarness({ dir, text: scripted });
  await tool.execute({ action: "open", topic: "t", cwd: dir, async: false }, exec);
  const last = JSON.stringify(calls[calls.length - 1].messages ?? "");
  includes(last, '"type":"tool-call"', "the tool round is recorded");
  const block = (calls[calls.length - 1].messages ?? [])
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .find((entry) => entry.type === "tool-call");
  eq(typeof block?.id, "string", "a call that arrived without an id gets one minted");
  cleanup();
}

// 42. a sides array handed over as JSON text still resolves
{
  const { dir, cleanup } = sandboxDir("sidestext");
  const { tool } = makeHarness({ dir });
  const result = await tool.execute(
    { action: "duel", topic: "t", rounds: 1, sides: '["gemini", "kimi"]', async: false },
    exec,
  );
  includes(result.text, "FOR", "the duel started from a stringified array");
  cleanup();
}

// 43. one named side plus `challenger` is a duel, not a silent default
{
  const { dir, cleanup } = sandboxDir("oneside");
  const { tool } = makeHarness({ dir });
  const result = await tool.execute(
    { action: "duel", topic: "t", rounds: 1, sides: ["kimi"], challenger: "deepseek", async: false },
    exec,
  );
  includes(result.text, "kimi", "the named side is the one that argues FOR");
  includes(result.text, "deepseek", "and challenger takes the other corner");
  cleanup();
}

// 44. the project's own suite is discovered and run
{
  const { dir, cleanup } = sandboxDir("runner");
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "probe", scripts: { test: 'node -e "console.log(\'suite ok\'); process.exit(0)"' } }),
    "utf8",
  );
  const list = __internals.runTool(dir, "run", {});
  includes(list, "npm test", "the script in package.json is offered");
  const ran = __internals.runTool(dir, "run", { what: "tests" });
  includes(ran, "exit 0", "and the suite runs with its exit code");
  includes(ran, "suite ok", "with the output kept");

  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "probe", scripts: { test: 'node -e "console.error(\'boom\'); process.exit(3)"' } }),
    "utf8",
  );
  const failed = __internals.runTool(dir, "run", { what: "tests" });
  includes(failed, "exit 3", "a failing suite is reported as failing");
  cleanup();
}

// 45. `run` refuses anything that is not a test runner, and refuses a shell
{
  const { dir, cleanup } = sandboxDir("runrefuse");
  const curl = __internals.runTool(dir, "run", { command: "curl http://127.0.0.1:1" });
  includes(curl, "not a known test runner", "an arbitrary binary is refused");
  const shell = __internals.runTool(dir, "run", { command: "npm test; rm -rf /" });
  includes(shell, "shell metacharacters", "a shell string is refused");
  const empty = __internals.runTool(dir, "run", { what: "tests" });
  includes(empty, "no test runner found", "an empty project says so instead of guessing");
  cleanup();
}

// 46. a debater can run the project's own suite
{
  const { dir, cleanup } = sandboxDir("debaterrun");
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "probe", scripts: { test: 'node -e "console.log(\'debater ran it\')"' } }),
    "utf8",
  );
  let phase = 0;
  const scripted = () => {
    phase += 1;
    return phase === 1 ? { toolCall: { name: "run", arguments: JSON.stringify({ what: "tests" }) } } : "готово";
  };
  const { tool, calls } = makeHarness({ dir, text: scripted });
  const result = await tool.execute({ action: "open", topic: "t", cwd: dir, async: false }, exec);
  includes(JSON.stringify(calls[0].tools ?? []), '"name":"run"', "the debater is offered `run`");
  const fed = JSON.stringify(calls[calls.length - 1].messages ?? "");
  includes(fed, "debater ran it", "and its call actually executes the suite");
  cleanup();
}

// 47. a symlink out of the root is refused, and a binary file is not text
{
  const { dir, cleanup } = sandboxDir("escape");
  const outsideDir = path.join(dir, "..", `outside-${Date.now()}`);
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(path.join(outsideDir, "notes.txt"), "OUTSIDE\n", "utf8");
  const project = path.join(dir, "project");
  mkdirSync(project, { recursive: true });
  try {
    // A junction works without elevation on Windows; a file symlink does not.
    symlinkSync(outsideDir, path.join(project, "junc"), "junction");
    const escaped = __internals.runTool(project, "read", { path: "junc/notes.txt" });
    includes(escaped, "escapes the debate root", "a link out of the project is refused");
    if (escaped.includes("OUTSIDE")) throw new Error("the link was followed out of the root");
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
  }
  writeFileSync(path.join(project, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x41]));
  includes(__internals.runTool(project, "read", { path: "blob.bin" }), "looks binary", "binary is refused instead of decoded as text");
  rmSync(outsideDir, { recursive: true, force: true });
  cleanup();
}

// 48. a staged change is still a change
{
  const { dir, cleanup } = sandboxDir("gitstaged");
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q"]);
  writeFileSync(path.join(dir, "a.txt"), "one\n", "utf8");
  git(["add", "."]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base"]);
  writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n", "utf8");
  git(["add", "."]);
  const diff = __internals.runTool(dir, "git", { sub: "diff" });
  includes(diff, "staged", "the staged half is named");
  includes(diff, "+two", "and shows the staged line, not 'nothing to show'");
  cleanup();
}

// 49. tokens.ts is source, not a secret
{
  const { dir, cleanup } = sandboxDir("tokens");
  writeFileSync(path.join(dir, "tokens.ts"), "export const TOKEN = 1;\n", "utf8");
  includes(__internals.runTool(dir, "read", { path: "tokens.ts" }), "TOKEN", "a lexer file is readable");
  includes(__internals.runTool(dir, "grep", { pattern: "TOKEN" }), "tokens.ts", "and searchable");
  writeFileSync(path.join(dir, "tokens.json"), "{\"a\":1}\n", "utf8");
  includes(__internals.runTool(dir, "read", { path: "tokens.json" }), "denied", "a credential-shaped file still is not");
  cleanup();
}

// 50. the search parser survives the real markup, and the URL guard refuses LAN
{
  const html = `
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x">First &amp; best</a>
    <a class="result__snippet" href="#">It says <b>this</b> about the thing.</a>
    <a rel="nofollow" class="result__a" href="https://example.org/b">Second</a>
    <a class="result__snippet" href="#">Another snippet.</a>`;
  const found = __internals.parseSearchHtml(html, 5);
  eq(found.length, 2, "two results parsed");
  eq(found[0].url, "https://example.com/a", "the uddg redirect is unwrapped");
  includes(found[0].title, "First & best", "entities decoded");
  includes(found[0].snippet, "It says this about the thing", "the snippet is text, not tags");
  eq(found[1].url, "https://example.org/b", "a plain href is kept");
}
{
  for (const bad of ["http://localhost:3080/spar-settings", "http://127.0.0.1/x", "http://10.0.0.5/", "file:///C:/Windows", "http://192.168.1.1/"]) {
    let refused = false;
    try {
      __internals.assertPublicUrl(bad);
    } catch {
      refused = true;
    }
    if (!refused) throw new Error(`fetched a private or non-http URL: ${bad}`);
  }
  eq(__internals.assertPublicUrl("https://example.com/a?b=1"), "https://example.com/a?b=1", "a public URL passes");
}

// 51. the judge only gets repo tools when the debate is about the project
{
  const { dir, cleanup } = sandboxDir("judgescope");
  writeFileSync(path.join(dir, "a.txt"), "x\n", "utf8");
  const { tool, calls } = makeHarness({ dir });
  const opened = await tool.execute({ action: "open", topic: "айфон против андроида", cwd: dir, async: false }, exec);
  const idMatch = /\[spar (d\d+)/.exec(opened.text);
  if (idMatch === null) throw new Error(`no debate id in ${opened.text.slice(0, 120)}`);
  calls.length = 0;
  await tool.execute({ action: "verdict", id: idMatch[1], project: false, async: false }, exec);
  const judgeTools = JSON.stringify(calls[0]?.tools ?? []);
  if (judgeTools.includes('"name":"read"')) throw new Error("the judge was offered repo tools for a phone argument");
  if (judgeTools.includes('"name":"web"')) throw new Error(`an opinion debate got a search box: ${judgeTools}`);
  // ...unless the caller asks for sources on purpose.
  calls.length = 0;
  await tool.execute({ action: "verdict", id: idMatch[1], web: true, async: false }, exec);
  includes(JSON.stringify(calls[0]?.tools ?? []), '"name":"web"', "and `web: true` buys it back");
  cleanup();
}

// 52. the caller's own argument comes back with the reply, and reaches the judge
{
  const { dir, cleanup } = sandboxDir("ownturn");
  writeFileSync(path.join(dir, "a.txt"), "x\n", "utf8");
  const { tool, calls } = makeHarness({ dir });
  await tool.execute({ action: "open", topic: "t", cwd: dir, async: false }, exec);
  await tool.execute({ action: "say", id: "d1", message: "МОЙ АРГУМЕНТ ПРО ПАМЯТЬ", async: false }, exec);
  const back = await tool.execute({ action: "result", id: "d1", async: false }, exec);
  includes(back.text, "твой аргумент", "the result names the caller's own turn");
  includes(back.text, "МОЙ АРГУМЕНТ ПРО ПАМЯТЬ", "and prints it, not only the reply");
  calls.length = 0;
  await tool.execute({ action: "verdict", id: "d1", project: true, async: false }, exec);
  includes(JSON.stringify(calls[0].messages), "МОЙ АРГУМЕНТ ПРО ПАМЯТЬ", "the judge is given the caller's argument too");
  cleanup();
}

// 53. a family name resolves to the configured model, not to a lookup
{
  const { dir, cleanup } = sandboxDir("family");
  const { tool, calls } = makeHarness({ dir, config: { defaultOpponent: "antigravity/gemini-3.8-flash", challenger: "antigravity/gemini-3.8-flash-tiered" } });
  const result = await tool.execute({ action: "open", topic: "t", opponent: "gemini", cwd: dir, async: false }, exec);
  if (/неизвестная модель/.test(result.text)) throw new Error("a family name must resolve through the profile");
  includes(JSON.stringify(calls[0]?.model ?? ""), "gemini", "the configured gemini is the one that answers");
  cleanup();
}

// 54. a verdict waits for a turn that is still being written
{
  const { dir, cleanup } = sandboxDir("verdictwait");
  writeFileSync(path.join(dir, "a.txt"), "x\n", "utf8");
  const { tool, calls } = makeHarness({ dir, text: () => "аргумент стороны", config: { verdictWaitMs: 1200 } });
  await tool.execute({ action: "open", topic: "t", cwd: dir, async: false }, exec);
  // Pretend a turn is in flight: the verdict must not judge half a transcript.
  const store = path.join(dir, "store");
  const file = path.join(dir, "d1.json");
  const debate = JSON.parse(readFileSync(file, "utf8"));
  debate.pending = { phase: "reply", route: "x/y", at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(debate), "utf8");
  calls.length = 0;
  let complained = "";
  try {
    await tool.execute({ action: "verdict", id: "d1", project: true, async: false }, exec);
  } catch (error) {
    complained = String(error?.message ?? error);
  }
  includes(complained, "still being written", "a half-written turn is refused instead of judged");
  cleanup();
}

/* ----------------------------------------------------------------- report -- */

const total = passed + failed;
if (failed === 0) {
  console.log(`spar: ${passed}/${total} checks passed`);
} else {
  console.log(`spar: ${passed}/${total} checks passed, ${failed} failed`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exitCode = 1;
}