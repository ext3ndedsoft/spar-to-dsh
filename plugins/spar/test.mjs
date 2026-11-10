// Offline tests for `spar`: a fake ctx + fake llm stream, no network, no quota.
// Run: node test.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { apply, __internals } from "./index.js";
import { runTool } from "./tools.js";

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
  apply(ctx, { dir, ...(config ?? {}) });
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
  eq(config.opponents.gemini.provider, "antigravity", "default alias kept after merge");
  eq(config.opponents.extra.model, "m", "custom alias merged");
  eq(__internals.resolveRoute("gemini", config).model, "gemini-3.8-flash", "alias resolves");
  eq(__internals.resolveRoute("basisweb/gpt-6.1-sol", config).provider, "basisweb", "provider/model resolves");
  eq(__internals.resolveRoute("zexkora:kimi-k3.1-pro", config).model, "kimi-k3.1-pro", "provider:model resolves");
  let threw = false;
  try {
    __internals.resolveRoute("nope", config);
  } catch {
    threw = true;
  }
  ok(threw, "unknown alias throws");
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
  includes(result.text, "never started", "there is no reply to report");
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