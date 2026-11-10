/**
 * Live turn state, served to the chat card while a model is still writing.
 *
 * The tool API has no progress channel: a tool result exists only once. So the
 * host keeps the in-flight turn in memory and exposes it over one small HTTP
 * route that the card polls — the same thing the terminal card does, without a
 * session event.
 *
 * Entries are keyed by the tool *call id*, which the card already holds, so a
 * card can only ever read its own turn and never has to guess a debate id.
 */

const KEEP_MS = 10 * 60 * 1000;
/** A turn that has not touched its entry for this long is not writing any more. */
const IDLE_MS = 8 * 60 * 1000;
const MAX_REASONING_CHARS = 4000;
const MAX_STEPS = 16;

/**
 * Build a registry of in-flight and recently finished turns.
 *
 * @returns the registry the tool body writes into and the route reads from.
 */
export function createLiveRegistry() {
  /** @type {Map<string, object>} */
  const runs = new Map();

  const prune = () => {
    const now = Date.now();
    for (const [key, state] of runs) {
      if (state.done === true && now - (state.settledAt ?? state.startedAt) > KEEP_MS) runs.delete(key);
    }
  };

  return {
    /** Register a turn before its first token. */
    begin(callId, meta) {
      if (typeof callId !== "string" || callId === "") return undefined;
      prune();
      const state = {
        call: callId,
        id: meta.id ?? null,
        role: meta.role ?? null,
        phase: meta.phase ?? null,
        route: meta.route ?? null,
        topic: meta.topic ?? null,
        mine: typeof meta.mine === "string" && meta.mine !== "" ? meta.mine : null,
        startedAt: Date.now(),
        at: Date.now(),
        text: "",
        activity: null,
        reasoning: "",
        steps: [],
        done: false,
        error: null,
      };
      runs.set(callId, state);
      return state;
    },
    /** Record progress: growing prose, reasoning, or a tool read. */
    progress(callId, patch) {
      const state = runs.get(callId);
      if (state === undefined || state.done === true) return;
      if (typeof patch?.text === "string") state.text = patch.text;
      if (typeof patch?.activity === "string" && patch.activity !== "") state.activity = patch.activity;
      if (typeof patch?.reasoningDelta === "string" && patch.reasoningDelta !== "") {
        // Enough to watch it think, not enough to turn the card into a novel.
        state.reasoning = `${state.reasoning}${patch.reasoningDelta}`.slice(-MAX_REASONING_CHARS);
      }
      if (patch?.step !== undefined && patch.step !== null && typeof patch.step.name === "string") {
        const last = state.steps[state.steps.length - 1];
        if (last === undefined || last.name !== patch.step.name || last.subject !== patch.step.subject) {
          state.steps.push({ name: patch.step.name, subject: patch.step.subject ?? "" });
          if (state.steps.length > MAX_STEPS) state.steps.shift();
        }
      }
      state.at = Date.now();
    },
    /** Mark a turn finished (or failed) and keep it around for late polls. */
    settle(callId, patch = {}) {
      const state = runs.get(callId);
      if (state === undefined) return;
      state.done = true;
      state.settledAt = Date.now();
      if (typeof patch.text === "string" && patch.text !== "") state.text = patch.text;
      if (typeof patch.error === "string" && patch.error !== "") state.error = patch.error;
      state.activity = null;
    },
    /** One snapshot for a card, or null when the call is unknown. */
    read(callId) {
      prune();
      const state = runs.get(callId);
      if (state === undefined) return null;
      // A process can die after `begin` and before `settle`. Its entry then says
      // "not done" forever, and the card keeps animating a turn that is not being
      // written. Silence past the idle window is reported as a stall, not as motion.
      //
      // Computed per read, never latched: a finished turn that once went quiet for
      // four minutes used to keep `stalled: true` forever, and the card then showed
      // "no answer from the registry" over a reply that was right there. A long turn
      // that pauses — a slow first token, a tool round — must not become a corpse.
      const stalled = state.done !== true && Date.now() - state.at > IDLE_MS;
      return {
        call: state.call,
        id: state.id,
        role: state.role,
        phase: state.phase,
        route: state.route,
        mine: state.mine,
        startedAt: state.startedAt,
        ms: (state.done === true ? (state.settledAt ?? state.at) : Date.now()) - state.startedAt,
        text: state.text,
        activity: state.activity,
        reasoning: state.reasoning,
        steps: state.steps,
        done: state.done,
        stalled,
        error: state.error,
      };
    },
    /** Everything still running, for a client that lost its call id. */
    active() {
      prune();
      // Not "everything unfinished": an entry whose process died is unfinished and
      // silent, and listing it as active would tell a reader a turn is running.
      return [...runs.values()]
        .filter((state) => state.done !== true && Date.now() - state.at <= IDLE_MS)
        .map((state) => this.read(state.call));
    },
    /** The most recent turn that is still being written; finished ones need the id. */
    newest() {
      prune();
      let best = null;
      for (const state of runs.values()) {
        if (state.done === true) continue;
        if (Date.now() - state.at > IDLE_MS) continue;
        if (best === null || state.startedAt >= best.startedAt) best = state;
      }
      return best === null ? null : this.read(best.call);
    },
  };
}

/**
 * HTTP handler for `GET <route>?call=<id>`.
 *
 * @param registry - registry returned by {@link createLiveRegistry}.
 * @returns a `webServer.register` handler owning the whole response.
 */
export function liveHandler(registry) {
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end('{"error":"method not allowed"}');
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const callId = url.searchParams.get("call") ?? "";
    // No call id: hand back the newest running turn. That is what a developer
    // (or a lost card) wants, and it keeps the route useful without the id.
    const newest = callId === "" ? registry.newest() : null;
    const state = callId === "" ? newest : registry.read(callId);
    const body =
      state !== null
        ? JSON.stringify(state)
        : JSON.stringify({ call: callId, missing: true, active: registry.active().map((entry) => entry.call) });
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") res.end();
    else res.end(body);
  };
}