/**
 * Debate settings, editable from the harness UI.
 *
 * The yaml patch is the deployment's opinion; this store is the operator's. It
 * only ever holds the handful of choices that are worth changing without a
 * restart — which models take part, what they speak, and how much room they get
 * — and it is read on every turn so a change lands on the next round.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The only keys the UI may change, with their defaults. */
export const SETTINGS_DEFAULTS = {
  opponent: "",
  judge: "",
  challenger: "",
  language: "",
  tools: null,
  maxToolRounds: 0,
  maxReplyTokens: 0,
  judgeTokens: 0,
};

const TEXT_KEYS = ["opponent", "judge", "challenger", "language"];
/** Sampling is a float in [0, 2]; -1 means "leave the profile's value alone". */
const TEMPERATURE_KEYS = { temperatureOpponent: "temperatureOpponent", temperatureJudge: "temperatureJudge" };

/**
 * Keep only known keys with sane types, so a hand-edited file cannot poison the
 * runtime: an unknown key is dropped rather than spread into the config.
 */
export function normalizeSettings(raw) {
  const out = {};
  for (const key of TEXT_KEYS) {
    const value = raw?.[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
  }
  if (typeof raw?.tools === "boolean") out.tools = raw.tools;
  for (const key of ["maxToolRounds", "maxReplyTokens", "judgeTokens"]) {
    const value = Number(raw?.[key]);
    if (Number.isInteger(value) && value > 0) out[key] = value;
  }
  for (const key of Object.keys(TEMPERATURE_KEYS)) {
    const value = Number(raw?.[key]);
    if (Number.isFinite(value) && value >= 0 && value <= 2) out[key] = value;
  }
  return out;
}

/**
 * A tiny JSON store with an mtime check, so an edit made in the UI is picked up
 * by the next turn without a plugin reload.
 */
export function createSettingsStore(file) {
  let cached = {};
  let stamp = -1;

  const read = () => {
    try {
      if (!existsSync(file)) {
        cached = {};
        stamp = -1;
        return cached;
      }
      const stat = statSafe(file);
      if (stat !== null && stat.mtimeMs === stamp) return cached;
      cached = normalizeSettings(JSON.parse(readFileSync(file, "utf8")));
      stamp = stat?.mtimeMs ?? -1;
      return cached;
    } catch {
      return cached ?? {};
    }
  };

  return {
    read,
    /**
     * Merge a patch into the stored settings and return the whole file.
     *
     * An empty value means "back to the profile default", so it deletes the
     * key instead of storing a blank — otherwise the panel could set a choice
     * and never take it back.
     */
    write(patch) {
      const merged = { ...read() };
      for (const [key, value] of Object.entries(patch ?? {})) {
        // A temperature of 0 is a real choice (a fully deterministic arbiter), so
        // only an empty value reverts; counts and names keep the old rule.
        const reverted = key in TEMPERATURE_KEYS ? value === null || value === undefined || value === "" : value === null || value === undefined || value === "" || value === 0;
        if (reverted) delete merged[key];
        else merged[key] = value;
      }
      const next = normalizeSettings(merged);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      cached = next;
      stamp = statSafe(file)?.mtimeMs ?? -1;
      return next;
    },
    file,
  };
}

function statSafe(file) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

/**
 * Models the harness itself knows about, for the selection UI. Chat models come
 * first: a catalog also carries embeddings and audio endpoints, and offering
 * those as debaters would be a trap, not a choice.
 */
const NOT_CHAT = /(embed|whisper|tts|dall-e|image|audio|speech|moderation|rerank)/i;

export async function modelCatalog(llm) {
  const providers = [];
  const models = [];
  let list = [];
  try {
    list = typeof llm?.listProviders === "function" ? llm.listProviders() : [];
  } catch {
    list = [];
  }
  for (const provider of Array.isArray(list) ? list : []) {
    if (provider?.id === undefined) continue;
    providers.push({ id: provider.id, name: provider.name ?? provider.id });
    let rows = [];
    try {
      rows = typeof llm.listModels === "function" ? await llm.listModels(provider.id) : [];
    } catch {
      rows = [];
    }
    const entries = Array.isArray(rows) ? rows : rows instanceof Map ? [...rows.values()] : Object.values(rows ?? {});
    for (const entry of entries) {
      const id = entry?.id ?? entry?.model;
      if (typeof id !== "string" || id === "") continue;
      const efforts = Array.isArray(entry.reasoning?.efforts)
        ? entry.reasoning.efforts.map((effort) => effort.id).filter((value) => typeof value === "string")
        : [];
      models.push({
        provider: provider.id,
        model: id,
        label: `${provider.id}/${id}`,
        chat: !NOT_CHAT.test(id),
        efforts,
      });
    }
  }
  models.sort((left, right) => {
    if (left.chat !== right.chat) return left.chat ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
  return { providers, models };
}

/** Read a small JSON body without trusting its size. */
export function readJsonBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(new Error(`body is not JSON: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

/**
 * `GET/POST /spar-settings`: the panel's whole state in one answer — saved
 * choices, the config they override, and a compact list of debates.
 */
export function settingsHandler({ store, effective, debates }) {
  return (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" || req.method === "HEAD") {
      send(200, { saved: store.read(), effective: effective(), debates: debates() });
      return;
    }
    if (req.method !== "POST") {
      send(405, { error: "method not allowed" });
      return;
    }
    readJsonBody(req).then(
      (patch) => {
        const saved = store.write(patch);
        send(200, { saved, effective: effective() });
      },
      (error) => send(400, { error: String(error?.message ?? error) }),
    );
  };
}

/** `GET /spar-models`: the harness's own catalog, as the selects need it. */
export function modelsHandler({ resolveLlm }) {
  return (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(405, { error: "method not allowed" });
      return;
    }
    const llm = resolveLlm();
    if (llm === undefined) {
      send(200, { providers: [], models: [], error: "no llm service in this profile" });
      return;
    }
    modelCatalog(llm).then(
      (catalog) => send(200, catalog),
      (error) => send(200, { providers: [], models: [], error: String(error?.message ?? error) }),
    );
  };
}