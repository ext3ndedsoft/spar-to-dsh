// spar — client half. Draws the opponent as a speaker, not as a tool card.
//
// The tool's model-facing text starts with a machine-readable header line
//
//   [spar d3 · r2 · antigravity/gemini-3.8-flash · 12.1s]
//
// so this view gets the debate id, the round, the route, and the duration from
// the same string the model reads, and the body it renders is exactly the
// argument. Results without that header (`list`, `show`, `close`) fall back to a
// quiet utility card, so bookkeeping never impersonates a voice.
//
// Registered through `tool.call.toolview`, the keyed per-tool slot the shell
// dispatches every atomic call through. Only baseline modules are used
// (react, react/jsx-runtime), so this local plugin needs no build step.

window.__ModuleLoader__.load({
	id: "dsh-plugin-spar",
	factory: (require) => {
		const React = require("react");
		const { jsx, jsxs } = require("react/jsx-runtime");

		const STYLE_ID = "dsh-spar-style";

		const CSS = `
[data-spar-card] {
	--spar-fg: var(--dsw-alias-label-primary, #ececec);
	--spar-dim: var(--dsw-alias-label-tertiary, #8a8a93);
	--spar-line: var(--dsw-alias-border-l1, rgba(255,255,255,0.09));
	--spar-surface: var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.035));
	position: relative;
	margin: 8px 0;
	padding: 12px 14px 12px 14px;
	border: 1px solid var(--spar-line);
	border-radius: 14px;
	background:
		linear-gradient(135deg, color-mix(in srgb, var(--spar-tint, #6b7280) 7%, transparent), transparent 55%),
		var(--spar-surface);
	color: var(--spar-fg);
	overflow: hidden;
	transition: border-color .2s ease, box-shadow .2s ease;
}
[data-spar-card][data-state="running"] { border-color: color-mix(in srgb, var(--spar-tint, #6b7280) 45%, var(--spar-line)); }
[data-spar-card][data-state="running"]::after {
	content: "";
	position: absolute; left: 0; right: 0; top: 0; height: 2px;
	background: linear-gradient(90deg, transparent, var(--spar-tint, #6b7280), transparent);
	background-size: 40% 100%;
	background-repeat: no-repeat;
	animation: spar-sweep 1.6s ease-in-out infinite;
}
[data-spar-card][data-kind="verdict"] {
	border-color: rgba(234, 179, 8, 0.45);
	box-shadow: 0 0 0 1px rgba(234, 179, 8, 0.12), 0 6px 28px -12px rgba(234, 179, 8, 0.35);
	background:
		linear-gradient(135deg, rgba(234, 179, 8, 0.09), transparent 60%),
		var(--spar-surface);
}
[data-spar-card][data-state="error"] { border-color: var(--dsw-alias-state-error-primary, #f87171); }
[data-spar-card][data-state="utility"] { background: transparent; padding: 8px 12px; }
[data-spar-card][data-state="past"] { padding: 6px 12px; cursor: pointer; background: transparent; }
[data-spar-card][data-state="past"]:hover, [data-spar-card][data-state="past"]:focus-visible { border-color: var(--spar-dim); outline: none; }

[data-spar-head] { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; font-size: 12px; min-width: 0; }
[data-spar-card][data-state="past"] [data-spar-head] { margin-bottom: 0; }
[data-spar-avatar] {
	flex: none; width: 26px; height: 26px; border-radius: 9px;
	display: inline-flex; align-items: center; justify-content: center;
	font-size: 12px; font-weight: 700; color: #fff; letter-spacing: 0;
	background: var(--spar-rail, linear-gradient(135deg, #4c8dff, #a78bfa));
	box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
}
[data-spar-who] { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
[data-spar-name] { font-weight: 600; font-size: 12.5px; color: var(--spar-fg); }
[data-spar-model] { font-size: 10.5px; color: var(--spar-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-spar-tag] {
	font-size: 10.5px; padding: 2px 8px; border-radius: 999px; white-space: nowrap;
	color: var(--spar-dim); border: 1px solid var(--spar-line);
}
[data-spar-tag][data-tone="live"] { color: var(--spar-tint, #4c8dff); border-color: color-mix(in srgb, var(--spar-tint, #4c8dff) 50%, transparent); }
[data-spar-tag][data-tone="verdict"] { color: #eab308; border-color: rgba(234,179,8,0.5); }
[data-spar-tag][data-tone="error"] { color: var(--dsw-alias-state-error-primary, #f87171); border-color: currentColor; }
[data-spar-meta] { margin-left: auto; font-size: 11px; color: var(--spar-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-spar-tools] { display: inline-flex; gap: 4px; margin-left: 6px; }
[data-spar-icon] {
	appearance: none; border: 1px solid transparent; background: transparent; color: var(--spar-dim);
	border-radius: 7px; padding: 2px 6px; font-size: 11px; cursor: pointer; font-family: inherit;
}
[data-spar-icon]:hover, [data-spar-icon]:focus-visible { color: var(--spar-fg); border-color: var(--spar-line); outline: none; }

[data-spar-mine] {
	margin: 0 0 10px; padding: 8px 11px; border-radius: 10px;
	font-size: 12.5px; line-height: 1.5; color: var(--spar-dim);
	background: color-mix(in srgb, var(--spar-fg) 4%, transparent);
	border-left: 2px solid var(--spar-dim);
	white-space: pre-wrap; max-height: 9.5em; overflow: auto;
}
[data-spar-mine]::before {
	content: attr(data-label); display: block; margin-bottom: 3px;
	font-size: 10px; letter-spacing: .06em; text-transform: uppercase; opacity: .75;
}
[data-spar-body], [data-spar-stream] { font-size: 13.5px; line-height: 1.62; color: var(--spar-fg); overflow-wrap: anywhere; }
[data-spar-body] > div > div, [data-spar-stream] [data-spar-body] > div > div { margin: 0 0 7px; }
[data-spar-body] > div > div:last-child { margin-bottom: 0; }
[data-spar-body] strong { font-weight: 650; }
[data-spar-body] code {
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;
	padding: 1px 5px; border-radius: 5px; background: color-mix(in srgb, var(--spar-fg) 9%, transparent);
}
[data-spar-body] pre {
	margin: 6px 0; padding: 10px 12px; border-radius: 10px; overflow: auto; max-height: 24em;
	background: rgba(0,0,0,0.32); border: 1px solid var(--spar-line);
}
[data-spar-body] pre code { padding: 0; background: none; font-size: 12px; line-height: 1.55; }
[data-spar-clamp] { max-height: 15.5em; overflow: hidden; position: relative; }
[data-spar-clamp]::after {
	content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3.4em; pointer-events: none;
	background: linear-gradient(transparent, var(--dsw-alias-bg-layer-1, #17171b));
}
[data-spar-steps] { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 9px; }
[data-spar-chip] {
	display: inline-flex; gap: 5px; align-items: baseline; max-width: 100%;
	padding: 2px 8px; border-radius: 999px; font-size: 11px; color: var(--spar-dim);
	border: 1px solid var(--spar-line); background: color-mix(in srgb, var(--spar-fg) 3%, transparent);
}
[data-spar-chip] b { font-weight: 600; color: var(--spar-fg); }
[data-spar-chip] span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 28ch; }
[data-spar-reason] { margin: 0 0 9px; font-size: 12px; color: var(--spar-dim); }
[data-spar-reason] summary { cursor: pointer; font-size: 11px; user-select: none; }
[data-spar-reason] div { margin-top: 5px; padding-left: 10px; border-left: 2px solid var(--spar-line); white-space: pre-wrap; max-height: 9em; overflow: auto; }
[data-spar-quiet] { color: var(--spar-dim); font-size: 12.5px; display: flex; gap: 8px; align-items: center; }
[data-spar-status] { display: flex; align-items: center; gap: 8px; margin-top: 9px; font-size: 11.5px; color: var(--spar-dim); }
[data-spar-status][data-stalled="1"] { color: var(--dsw-alias-state-error-primary, #f87171); }
[data-spar-dot], [data-spar-quiet]::before {
	content: ""; width: 7px; height: 7px; border-radius: 50%; flex: none;
	background: var(--spar-tint, #4c8dff); animation: spar-pulse 1.1s ease-in-out infinite;
}
[data-spar-quiet]::before { content: ""; }
[data-spar-foot] { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; font-size: 11px; color: var(--spar-dim); }
[data-spar-toggle] {
	appearance: none; font: inherit; font-size: 11.5px; cursor: pointer; padding: 3px 10px; border-radius: 999px;
	color: var(--spar-fg); background: transparent; border: 1px solid var(--spar-line);
}
[data-spar-toggle]:hover, [data-spar-toggle]:focus-visible { border-color: var(--spar-dim); outline: none; }
[data-spar-receipt] { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--spar-dim); }
[data-spar-cols] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
[data-spar-col] { min-width: 0; padding: 10px 12px; border-radius: 11px; border: 1px solid var(--spar-line); background: color-mix(in srgb, var(--spar-fg) 3%, transparent); }
[data-spar-col] > [data-spar-head] { margin-bottom: 7px; }
@media (max-width: 720px) { [data-spar-cols] { grid-template-columns: minmax(0, 1fr); } }
@keyframes spar-sweep { 0% { background-position: -50% 0; } 100% { background-position: 150% 0; } }
@keyframes spar-pulse { 0%, 100% { opacity: .35; transform: scale(.85); } 50% { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
	[data-spar-card][data-state="running"]::after, [data-spar-dot], [data-spar-quiet]::before { animation: none; }
}
`;


		const HEADER = /^\[spar\s+([^\]]*)\]\s*\n?/;

		/** Model families get their own rail colour, so a glance tells who is talking. */
		function accent(model) {
			const name = String(model ?? "").toLowerCase();
			if (name.includes("gemini")) return "linear-gradient(180deg, #4c8dff, #a78bfa)";
			if (name.includes("claude")) return "linear-gradient(180deg, #d97757, #e8a87c)";
			if (name.includes("gpt") || name.includes("oss")) return "linear-gradient(180deg, #10a37f, #5eead4)";
			if (name.includes("kimi")) return "linear-gradient(180deg, #8b5cf6, #c4b5fd)";
			if (name.includes("deepseek")) return "linear-gradient(180deg, #3b82f6, #22d3ee)";
			return "linear-gradient(180deg, #6b7280, #9ca3af)";
		}

		/** A flat colour for the same family, used for glows and live accents. */
		function tintOf(model) {
			const name = String(model ?? "").toLowerCase();
			if (name.includes("gemini")) return "#6d8dff";
			if (name.includes("claude")) return "#e08a62";
			if (name.includes("gpt") || name.includes("oss")) return "#2bb894";
			if (name.includes("kimi")) return "#9d7bf5";
			if (name.includes("deepseek")) return "#38a6f0";
			return "#8b93a1";
		}

		/** Split a reply into prose and fenced code so long arguments stay readable. */
		function segments(text) {
			const parts = [];
			const fence = /```([\w+-]*)\n?([\s\S]*?)```/g;
			let cursor = 0;
			let match = fence.exec(text);
			while (match !== null) {
				const before = text.slice(cursor, match.index);
				if (before.trim() !== "") parts.push({ kind: "text", text: before.replace(/\n+$/, "") });
				parts.push({ kind: "code", lang: match[1], text: match[2].replace(/\n+$/, "") });
				cursor = match.index + match[0].length;
				match = fence.exec(text);
			}
			const rest = text.slice(cursor);
			if (rest.trim() !== "") parts.push({ kind: "text", text: rest.replace(/^\n+/, "") });
			return parts.length === 0 ? [{ kind: "text", text }] : parts;
		}

		/** Inline markdown the models actually use in arguments: bold and `code`. */
		function inline(text, prefix) {
			const nodes = [];
			const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
			let cursor = 0;
			let index = 0;
			let match = pattern.exec(text);
			while (match !== null) {
				if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
				const token = match[0];
				if (token.startsWith("**")) {
					nodes.push(jsx("strong", { key: `${prefix}b${index++}`, children: token.slice(2, -2) }));
				} else {
					nodes.push(jsx("code", { key: `${prefix}c${index++}`, children: token.slice(1, -1) }));
				}
				cursor = match.index + token.length;
				match = pattern.exec(text);
			}
			if (cursor < text.length) nodes.push(text.slice(cursor));
			return nodes;
		}

		/** Paragraphs, headings and bullet runs — enough to keep a ruling readable. */
		function blocks(text) {
			return text
				.split(/\n{2,}/)
				.map((chunk, index) => {
					const trimmed = chunk.trim();
					if (trimmed === "") return null;
					if (/^#{1,4}\s/.test(trimmed)) {
						return jsx("div", {
							key: `h${index}`,
							style: { fontWeight: 600, marginTop: index === 0 ? 0 : 6 },
							children: inline(trimmed.replace(/^#{1,4}\s+/, ""), `h${index}`),
						});
					}
					const lines = trimmed.split("\n");
					if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
						return jsx("div", {
							key: `u${index}`,
							children: lines.map((line, lineIndex) =>
								jsxs("div", {
									key: lineIndex,
									style: { display: "flex", gap: 7, alignItems: "baseline" },
									children: [
										jsx("span", { key: "dot", style: { opacity: 0.45 }, children: "•" }),
										jsx("span", {
											key: "text",
											style: { flex: 1 },
											children: inline(line.replace(/^\s*[-*•]\s+/, ""), `u${index}-${lineIndex}`),
										}),
									],
								}),
							),
						});
					}
					return jsx("div", { key: `p${index}`, children: inline(trimmed, `p${index}`) });
				})
				.filter(Boolean);
		}

		function Body({ text }) {
			// Parsing is the expensive part and the text only changes when it grows:
			// memoised, a re-render for any other reason costs nothing.
			const children = React.useMemo(
				() =>
					segments(text).map((part, index) =>
						part.kind === "code"
							? jsx("pre", {
									key: index,
									children: jsx("code", { "data-lang": part.lang || undefined, children: part.text }),
								})
							: jsx("div", { key: index, children: blocks(part.text) }),
					),
				[text],
			);
			return jsx("div", { "data-spar-body": "", children });
		}

		function rawText(block) {
			const content = block?.content;
			if (!Array.isArray(content)) return "";
			return content
				.map((item) => (item !== null && typeof item === "object" && typeof item.text === "string" ? item.text : ""))
				.join("\n")
				.trim();
		}

		/** `[spar d3 · r2 · antigravity/gemini-3.8-flash · 12.1s]` → facts + body. */
		function parse(block) {
			const raw = rawText(block);
			const match = HEADER.exec(raw);
			if (match === null) return { utility: true, body: raw, model: "", debate: "", tag: "служебное", ms: null, receipt: false, pending: false };
			const body = raw.slice(match[0].length).trim();
			const fields = match[1].split("·").map((part) => part.trim()).filter(Boolean);
			let debate = "";
			let model = "";
			let ms = null;
			let tag = "возражение";
			let receipt = false;
			let pending = false;
			let failed = false;
			for (const field of fields) {
				if (/^d\d+$/.test(field)) debate = field;
				else if (field.includes("/")) model = field.slice(field.lastIndexOf("/") + 1);
				else if (field === "verdict") tag = "приговор";
				else if (field === "duel") tag = "дуэль";
				else if (field === "models") tag = "каталог";
				else if (field === "failed") {
					tag = "сбой";
					failed = true;
				}
				else if (/^r\d+$/.test(field)) tag = `раунд ${field.slice(1)}`;
				else if (/^result\b/.test(field)) {
					// A collected turn: its prose already lives in the turn's own card,
					// so this one is a receipt, not a second copy of the answer.
					receipt = true;
					const round = /^result\s+r(\d+)$/.exec(field);
					if (round !== null) tag = `раунд ${round[1]}`;
					else if (field === "result verdict") tag = "приговор";
					else if (field === "result pending") {
						tag = "ещё пишет";
						pending = true;
					}
				} else {
					const duration = /^([\d.]+)s$/.exec(field);
					if (duration !== null) ms = Number(duration[1]) * 1000;
				}
			}
			if (body.includes("[reply truncated at")) tag = `${tag} · обрезано`;
			return { utility: false, body, model, debate, tag, ms, receipt, pending, failed };
		}

		const LIVE_MS = 320;
		/** Consecutive empty polls before a running card admits it lost the host. */
		const STALL_AFTER = 40;
		/** Nothing is declared dead inside the first minute: a cold gateway is slow. */
		const STALL_FLOOR_MS = 60_000;
		/** A card stops asking for a call the registry no longer knows at all. */
		const KEEP_POLLING_MS = 5 * 60_000;

		/**
		 * Reveal the arriving text a frame at a time instead of in the chunks the
		 * poll happens to bring. The host hands over snapshots every few hundred
		 * milliseconds, so without this the card jumps paragraph by paragraph.
		 */
		function useSmoothText(full, streaming) {
			const [count, setCount] = React.useState(full.length);
			const target = full.length;
			React.useEffect(() => {
				if (streaming !== true || count >= target) return undefined;
				if (typeof requestAnimationFrame !== "function") {
					setCount(target);
					return undefined;
				}
				const step = Math.max(8, Math.ceil((target - count) / 6));
				const handle = requestAnimationFrame(() => setCount((value) => Math.min(target, value + step)));
				return () => {
					if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
				};
			}, [count, target, streaming]);
			if (streaming !== true || count >= target) return full;
			return full.slice(0, count);
		}

		/**
		 * The same turn, read from the transcript on disk.
		 *
		 * The registry above is memory: it forgets after ten minutes, and a page
		 * reload starts with nothing. The debate file does not forget, and every
		 * turn records the tool call that wrote it, so a card can rebuild itself
		 * after a restart instead of showing "Turn is running…" forever.
		 */
		function useDurableTurn(callId, enabled) {
			const [turn, setTurn] = React.useState(null);
			React.useEffect(() => {
				if (enabled !== true || typeof callId !== "string" || callId === "") return undefined;
				let stopped = false;
				let timer;
				let tries = 0;
				const ask = () => {
					fetch(`/spar-turn?call=${encodeURIComponent(callId)}`, { cache: "no-store" })
						.then((response) => (response.ok ? response.json() : null))
						.then((value) => {
							if (stopped) return;
							if (value !== null && value.missing !== true) {
								setTurn(value);
								// The question is saved before the answer: keep asking until the
								// reply (or a recorded failure) arrives.
								if (value.pending !== true || value.failed) return;
							}
							tries += 1;
							// The turn is written at the end, so early calls miss by design.
							if (tries < 60) timer = setTimeout(ask, hiddenTab() ? 8000 : 3000);
						})
						.catch(() => {
							tries += 1;
							if (!stopped && tries < 20) timer = setTimeout(ask, 5000);
						});
				};
				ask();
				return () => {
					stopped = true;
					clearTimeout(timer);
				};
			}, [callId, enabled]);
			return turn;
		}

		/**
		 * Poll the host for the turn this card belongs to. The tool result only
		 * exists at the end, so while the model is writing the card reads the
		 * in-flight text from the plugin's own route instead of showing a
		 * spinner for a minute.
		 */
		function useLiveTurn(callId, enabled) {
			const [state, setState] = React.useState(null);
			React.useEffect(() => {
				if (enabled !== true || typeof callId !== "string" || callId === "") return undefined;
				let stopped = false;
				let timer;
				let misses = 0;
				const startedAt = Date.now();
				// One timer at a time, always. Two `setTimeout` calls in one branch double
				// the polling on every miss and the tab then reports thousands of requests
				// per second — the page stops accepting input. Clearing first makes a
				// duplicate schedule harmless instead of exponential.
				const schedule = (ms) => {
					if (timer !== undefined) clearTimeout(timer);
					timer = setTimeout(tick, ms);
				};
				const tick = () => {
					if (hiddenTab()) {
						// Nobody is looking: ask rarely instead of hammering the host.
						schedule(4000);
						return;
					}
					fetch(`/spar-live?call=${encodeURIComponent(callId)}`, { cache: "no-store" })
						.then((response) => (response.ok ? response.json() : null))
						.then((value) => {
							if (stopped) return;
							if (value !== null && value.missing !== true) {
								misses = 0;
								setState({ ...value, known: true, stalled: false });
								if (value.done !== true) schedule(LIVE_MS);
							} else {
								// The registry does not know this call. That is normal for a
								// moment after the turn starts, and suspicious after a while: a
								// dead process would otherwise animate "пишет…" forever.
								misses += 1;
								// A cold first call can take ten seconds before the host
								// registers anything: twelve polls of 640 ms declared a stall on
								// a turn that had not started writing yet, which is where "нет
								// ответа от реестра" at the beginning came from.
								const waited = Date.now() - startedAt;
								setState((previous) => ({ ...(previous ?? {}), known: false, stalled: misses >= STALL_AFTER && waited > STALL_FLOOR_MS }));
								// After the registry has kept entries for a while it may drop
								// this one; polling it forever is a tab that never sleeps. Give
								// up once the answer cannot arrive any more.
								if (waited > KEEP_POLLING_MS) return;
								schedule(LIVE_MS * 2);
							}
						})
						.catch(() => {
							if (stopped) return;
							misses += 1;
							setState((previous) => ({ ...(previous ?? {}), known: false, stalled: misses >= STALL_AFTER && Date.now() - startedAt > STALL_FLOOR_MS }));
							if (Date.now() - startedAt > KEEP_POLLING_MS) return;
							schedule(LIVE_MS * 2);
						});
				};
				tick();
				return () => {
					stopped = true;
					clearTimeout(timer);
				};
			}, [callId, enabled]);
			return state;
		}

		/**
		 * Which call of this debate is the newest? A spawn card that has been
		 * overtaken by a later call is a finished phase and folds to one line. Polls
		 * only while the card could still be overtaken, never in a hidden tab, and
		 * sets state only when the answer changed.
		 */
		function useNewestFor(debateId, callId, enabled) {
			const [newest, setNewest] = React.useState(null);
			React.useEffect(() => {
				if (enabled !== true || debateId === "") return undefined;
				let alive = true;
				let timer;
				const startedAt = Date.now();
				const ask = () => {
					if (hiddenTab()) {
						timer = setTimeout(ask, 5000);
						return;
					}
					fetch(`/spar-live?debate=${encodeURIComponent(debateId)}`, { cache: "no-store" })
						.then((response) => (response.ok ? response.json() : null))
						.then((value) => {
							if (!alive) return;
							const next = value?.newest ?? null;
							if (next !== null) {
								setNewest((previous) =>
									previous !== null && previous.callId === next.callId && previous.done === next.done ? previous : next,
								);
							}
							const overtaken = next !== null && typeof callId === "string" && next.callId !== callId;
							const settledHere = next !== null && next.callId === callId && next.done === true;
							// Once overtaken the answer cannot change back; once our own call is
							// done, only a later call could overtake it, and that is rare enough
							// to check slowly.
							if (overtaken || Date.now() - startedAt > KEEP_POLLING_MS) return;
							timer = setTimeout(ask, settledHere ? 8000 : 2500);
						})
						.catch(() => {
							if (alive && Date.now() - startedAt <= KEEP_POLLING_MS) timer = setTimeout(ask, 5000);
						});
				};
				ask();
				return () => {
					alive = false;
					clearTimeout(timer);
				};
			}, [debateId, callId, enabled]);
			return newest;
		}

		/** `provider/model` → `model`. */
		function modelOf(route) {
			const text = typeof route === "string" ? route : "";
			return text.slice(text.lastIndexOf("/") + 1);
		}

		/** Who is on the mic, in words. A model id is not a stage. */
		function stageName(entry) {
			if (entry === null || entry === undefined) return "спор";
			if (entry.phase === "verdict") return "судья";
			if (entry.phase === "duel") return "дуэль";
			if (entry.role === "right") return "B отвечает";
			if (entry.role === "left") return "A отвечает";
			return modelOf(entry.route) || "спор";
		}

		/** "1 знак / 2 знака / 5 знаков". */
		function plural(n, one, few, many) {
			const mod10 = n % 10;
			const mod100 = n % 100;
			if (mod10 === 1 && mod100 !== 11) return one;
			if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
			return many;
		}

		const fmtSeconds = (ms) => (typeof ms === "number" && Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "");
		const hiddenTab = () => typeof document !== "undefined" && document.hidden === true;

		/** Monogram for a speaker: A/B for the sides, a scale for the judge. */
		function monogram(role, phase) {
			if (phase === "verdict" || role === "judge") return "⚖";
			if (role === "left") return "A";
			if (role === "right") return "B";
			return "◈";
		}

		/** Split a finished duel body into its two sides. */
		function splitDuel(body) {
			const re = /^(A|B) \(([^)\n]*)\) (FOR|AGAINST): /gm;
			const marks = [];
			let match = re.exec(body);
			while (match !== null) {
				marks.push({ at: match.index, end: re.lastIndex, side: match[1], model: match[2], stance: match[3] });
				match = re.exec(body);
			}
			if (marks.length < 2) return null;
			return marks.map((mark, index) => ({
				side: mark.side,
				model: modelOf(mark.model),
				stance: mark.stance === "FOR" ? "за" : "против",
				text: body.slice(mark.end, index + 1 < marks.length ? marks[index + 1].at : body.length).trim(),
			}));
		}

		/** One speaker's header row. */
		function Head({ v, children }) {
			return jsxs("div", {
				"data-spar-head": "",
				children: [
					jsx("span", { "data-spar-avatar": "", "aria-hidden": "true", children: monogram(v.role, v.phase) }),
					jsxs("span", {
						"data-spar-who": "",
						children: [
							jsx("span", { "data-spar-name": "", children: v.name }),
							v.model === "" ? null : jsx("span", { "data-spar-model": "", title: v.route ?? v.model, children: v.model }),
						],
					}),
					v.tag === "" ? null : jsx("span", { "data-spar-tag": "", "data-tone": v.tone ?? "", children: v.tag }),
					jsx("span", { "data-spar-meta": "", children: v.meta ?? "" }),
					children ?? null,
				],
			});
		}

		/** The caller's own argument, shown above the reply it provoked. */
		function Mine({ text }) {
			if (typeof text !== "string" || text.trim() === "") return null;
			return jsx("div", { "data-spar-mine": "", "data-label": "A · запрос оппоненту", children: text });
		}

		function Steps({ steps }) {
			if (!Array.isArray(steps) || steps.length === 0) return null;
			return jsx("div", {
				"data-spar-steps": "",
				children: steps.map((step, index) =>
					jsxs("span", {
						"data-spar-chip": "",
						key: `${index}-${step.name}`,
						children: [jsx("b", { children: step.name }), step.subject ? jsx("span", { children: step.subject }) : null],
					}),
				),
			});
		}

		function CopyButton({ text }) {
			const [done, setDone] = React.useState(false);
			return jsx("button", {
				type: "button",
				"data-spar-icon": "",
				title: "Скопировать текст",
				"aria-label": "Скопировать текст",
				onClick: (event) => {
					event.stopPropagation();
					try {
						navigator.clipboard.writeText(text).then(
							() => {
								setDone(true);
								setTimeout(() => setDone(false), 1400);
							},
							() => {},
						);
					} catch {
						/* clipboard unavailable: nothing to do */
					}
				},
				children: done ? "✓ скопировано" : "⧉ копировать",
			});
		}

		/** A long reply folds to a few lines; the fold is a real, keyboard-reachable button. */
		function Foldable({ text, limit }) {
			const [open, setOpen] = React.useState(false);
			const long = text.length > limit;
			return jsxs("div", {
				children: [
					jsx("div", { "data-spar-clamp": long && !open ? "" : undefined, children: jsx(Body, { text }) }),
					long
						? jsx("div", {
								"data-spar-foot": "",
								children: jsx("button", {
									type: "button",
									"data-spar-toggle": "",
									"aria-expanded": open ? "true" : "false",
									onClick: () => setOpen((value) => !value),
									children: open ? "свернуть" : `показать целиком · ${text.length} ${plural(text.length, "знак", "знака", "знаков")}`,
								}),
							})
						: null,
				],
			});
		}

		/** Reply text plus the files it actually read — a claim you can check. */
		function Reply({ text, used, truncated }) {
			return jsxs("div", {
				children: [
					jsx(Foldable, { text, limit: 1400 }),
					Array.isArray(used) && used.length > 0
						? jsxs("div", {
								"data-spar-foot": "",
								children: [
									jsx("span", { children: "читал:" }),
									...used.slice(0, 12).map((entry, index) =>
										jsx("span", { "data-spar-chip": "", key: index, children: jsx("span", { children: entry }) }),
									),
									used.length > 12 ? jsx("span", { children: `+${used.length - 12}` }) : null,
								],
							})
						: null,
					truncated === true ? jsx("div", { "data-spar-foot": "", children: "ответ обрезан по лимиту токенов" }) : null,
				],
			});
		}

		/** Live preview of a turn in progress. */
		function Running({ state, smooth }) {
			const text = state?.text ?? "";
			const reasoning = typeof state?.reasoning === "string" ? state.reasoning : "";
			const steps = Array.isArray(state?.steps) ? state.steps : [];
			const activity = state?.activity ?? "";
			const stalled = state?.stalled === true;
			return jsxs("div", {
				"data-spar-stream": "",
				children: [
					jsx(Mine, { text: state?.mine }),
					jsx(Steps, { steps }),
					reasoning === ""
						? null
						: jsxs("details", {
								"data-spar-reason": "",
								children: [jsx("summary", { children: "ход мысли" }), jsx("div", { children: reasoning })],
							}),
					text === "" ? null : jsx(Body, { text: smooth }),
					text === "" && reasoning === "" && steps.length === 0 && !stalled
						? jsx("div", { "data-spar-quiet": "", children: "думает…" })
						: null,
					jsxs("div", {
						"data-spar-status": "",
						"data-stalled": stalled ? "1" : "0",
						role: "status",
						"aria-live": "polite",
						children: [
							stalled ? null : jsx("span", { "data-spar-dot": "" }),
							stalled
								? "нет ответа от реестра — ход, возможно, оборвался · проверь action:\"result\""
								: activity !== ""
									? `читает ${activity}`
									: text === ""
										? "думает…"
										: "пишет…",
						],
					}),
				],
			});
		}

		function Card({ props }) {
			const [expanded, setExpanded] = React.useState(false);
			const raw = props.block === undefined ? "" : rawText(props.block);
			const started = raw.includes("· started]");
			const running = props.phase === "preparing" || props.phase === "start";
			const live = useLiveTurn(props.callId, running || started);
			const liveKnown = live !== null && live !== undefined && live.known === true;
			// A duel runs two models under one tool call; the second has its own id.
			const isDuelLive = liveKnown && live.role === "left";
			const liveB = useLiveTurn(
				typeof props.callId === "string" && props.callId !== "" ? `${props.callId}:b` : "",
				isDuelLive,
			);
			const liveBKnown = liveB !== null && liveB !== undefined && liveB.known === true;
			const durable = useDurableTurn(props.callId, started === true && liveKnown !== true);
			const debateId = (/\[spar (d\d+)/.exec(raw) ?? [])[1] ?? "";
			const newest = useNewestFor(debateId, props.callId, started);
			const superseded =
				started === true &&
				typeof props.callId === "string" &&
				newest !== null &&
				typeof newest.callId === "string" &&
				newest.callId !== props.callId;
			const liveDone = liveKnown && live.done === true;
			const working = liveKnown && (!liveDone || (isDuelLive && liveBKnown && liveB.done !== true));
			const smooth = useSmoothText(live?.text ?? "", working);
			const smoothB = useSmoothText(liveB?.text ?? "", working);
			const tint = (route) => ({ "--spar-rail": accent(modelOf(route)), "--spar-tint": tintOf(modelOf(route)) });
			const frame = (v, children, extra = {}) =>
				jsxs("div", {
					"data-spar-card": "",
					"data-tool": "spar",
					"data-state": v.state,
					"data-kind": v.kind ?? "turn",
					style: tint(v.route ?? v.model),
					...extra,
					children,
				});

			// ---- a turn is being written ----------------------------------------
			if (working) {
				if (isDuelLive) {
					const side = (state, smoothed, label) =>
						jsxs("div", {
							"data-spar-col": "",
							children: [
								jsx(Head, {
									v: {
										name: `${label} · ${state?.role === "left" ? "за" : "против"}`,
										role: state?.role,
										model: modelOf(state?.route),
										route: state?.route,
										tag: state?.done === true ? "готово" : state?.stalled === true ? "нет ответа" : "пишет",
										tone: state?.done === true ? "" : "live",
										meta: fmtSeconds(state?.ms),
									},
								}),
								state === null || state === undefined || state.known !== true
									? jsx("div", { "data-spar-quiet": "", children: "ждёт очереди…" })
									: jsx(Running, { state: { ...state, mine: null }, smooth: smoothed }),
							],
						});
					return frame({ state: "running", kind: "duel", route: live.route }, [
						jsx("div", { "data-spar-cols": "", children: [side(live, smooth, "A"), side(liveB, smoothB, "B")] }),
					]);
				}
				const verdict = live.phase === "verdict";
				return frame({ state: "running", kind: verdict ? "verdict" : "turn", route: live.route }, [
					jsx(Head, {
						v: {
							name: stageName(live),
							role: live.role,
							phase: live.phase,
							model: modelOf(live.route),
							route: live.route,
							tag: live.stalled === true ? "нет ответа" : verdict ? "выносит приговор" : "пишет",
							tone: live.stalled === true ? "error" : verdict ? "verdict" : "live",
							meta: fmtSeconds(live.ms),
						},
					}),
					jsx(Running, { state: live, smooth }),
				]);
			}

			const failed = props.block?.isError === true;
			const info = parse(props.block);

			// ---- a phase the debate has moved past ------------------------------
			if (superseded && !expanded) {
				const activate = () => setExpanded(true);
				return jsxs("div", {
					"data-spar-card": "",
					"data-tool": "spar",
					"data-state": "past",
					role: "button",
					tabIndex: 0,
					"aria-label": `${debateId}: этап пройден, показать`,
					onClick: activate,
					onKeyDown: (event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							activate();
						}
					},
					children: jsx(Head, {
						v: { name: `${debateId} · этап пройден`, role: null, model: "", tag: stageName(newest), meta: "показать ›" },
					}),
				});
			}

			// ---- the durable record (survives reload and restart) ---------------
			if (started && durable !== null && !(live !== null && live.done === true)) {
				if (durable.pending === true) {
					const err = durable.failed;
					return frame({ state: err ? "error" : "running", route: durable.route }, [
						jsx(Head, {
							v: {
								name: "B",
								role: "right",
								model: modelOf(durable.route),
								route: durable.route,
								tag: err ? "не ответила" : "ждёт ответа",
								tone: err ? "error" : "live",
								meta: durable.id,
							},
						}),
						jsx(Mine, { text: durable.mine }),
						err
							? jsx("div", { "data-spar-body": "", children: String(err.message ?? "ход оборвался") })
							: jsx("div", { "data-spar-quiet": "", children: "ответ ещё пишется…" }),
					]);
				}
				const judge = durable.role === "judge";
				return frame({ state: "done", kind: judge ? "verdict" : "turn", route: durable.route }, [
					jsx(Head, {
						v: {
							name: judge ? "судья" : stageName({ role: durable.role }),
							role: durable.role,
							model: modelOf(durable.route),
							route: durable.route,
							tag: judge ? "приговор" : `раунд ${durable.round}`,
							tone: judge ? "verdict" : "",
							meta: `${fmtSeconds(durable.ms)} · ${durable.id}`,
						},
						children: jsx("span", { "data-spar-tools": "", children: jsx(CopyButton, { text: durable.text }) }),
					}),
					jsx(Mine, { text: durable.mine }),
					jsx(Reply, { text: durable.text, used: durable.used, truncated: durable.truncated }),
				]);
			}

			// ---- a settled registry entry ---------------------------------------
			if (started && live !== null && live.done === true) {
				const verdict = live.phase === "verdict";
				const state = live.error ? "error" : "done";
				return frame({ state, kind: verdict ? "verdict" : "turn", route: live.route }, [
					jsx(Head, {
						v: {
							name: stageName(live),
							role: live.role,
							phase: live.phase,
							model: modelOf(live.route),
							route: live.route,
							tag: live.error ? "не ответила" : verdict ? "приговор" : "возражение",
							tone: live.error ? "error" : verdict ? "verdict" : "",
							meta: `${fmtSeconds(live.ms)}${live.id === null ? "" : ` · ${live.id}`}`,
						},
						children: live.error ? null : jsx("span", { "data-spar-tools": "", children: jsx(CopyButton, { text: live.text }) }),
					}),
					jsx(Mine, { text: live.mine }),
					live.error ? jsx("div", { "data-spar-body": "", children: live.error }) : jsx(Reply, { text: live.text }),
				]);
			}

			// ---- utility results: list / show / close / models -------------------
			if (info.utility) {
				return frame({ state: failed ? "error" : "utility", route: "" }, [
					jsx(Head, { v: { name: "spar", role: null, model: "", tag: failed ? "сбой" : info.tag, tone: failed ? "error" : "", meta: "" } }),
					jsx(Foldable, { text: info.body, limit: 1800 }),
				]);
			}

			// ---- a duel result ----------------------------------------------------
			const duel = info.tag === "дуэль" ? splitDuel(info.body) : null;
			if (duel !== null) {
				return frame({ state: failed ? "error" : "done", kind: "duel", route: "" }, [
					jsx(Head, {
						v: { name: "дуэль", role: null, model: "", tag: info.debate, meta: "" },
						children: jsx("span", { "data-spar-tools": "", children: jsx(CopyButton, { text: info.body }) }),
					}),
					jsx("div", {
						"data-spar-cols": "",
						children: duel.map((side) =>
							jsxs(
								"div",
								{
									"data-spar-col": "",
									style: tint(side.model),
									key: side.side,
									children: [
										jsx(Head, {
											v: { name: `${side.side} · ${side.stance}`, role: side.side === "A" ? "left" : "right", model: side.model, route: side.model, tag: "", meta: "" },
										}),
										jsx(Foldable, { text: side.text, limit: 1100 }),
									],
								},
							),
						),
					}),
				]);
			}

			// ---- a collected turn (`result`) is only a receipt --------------------
			const receipt = info.receipt === true && failed !== true;
			const verdictCard = info.tag.startsWith("приговор");
			const head = {
				name: failed ? "сбой" : verdictCard ? "судья" : "B",
				role: verdictCard ? "judge" : "right",
				model: info.model,
				route: info.model,
				tag: failed ? "не ответила" : info.tag,
				tone: failed ? "error" : verdictCard ? "verdict" : "",
				meta: `${fmtSeconds(info.ms)}${info.debate === "" ? "" : ` · ${info.debate}`}`,
			};
			if (receipt && !expanded) {
				return frame({ state: "done", kind: verdictCard ? "verdict" : "turn", route: info.model }, [
					jsx(Head, { v: head }),
					jsxs("div", {
						"data-spar-receipt": "",
						children: [
							jsx("span", {
								children: info.pending
									? "ответ ещё не готов"
									: `ответ получен · ${info.body.length} ${plural(info.body.length, "знак", "знака", "знаков")}`,
							}),
							info.body === "" || info.pending
								? null
								: jsx("button", {
										type: "button",
										"data-spar-toggle": "",
										"aria-expanded": "false",
										onClick: () => setExpanded(true),
										children: "показать",
									}),
						],
					}),
				]);
			}
			return frame({ state: failed ? "error" : "done", kind: verdictCard ? "verdict" : "turn", route: info.model }, [
				jsx(Head, {
					v: head,
					children:
						info.body === "" ? null : jsx("span", { "data-spar-tools": "", children: jsx(CopyButton, { text: info.body }) }),
				}),
				info.body === "" ? jsx("div", { "data-spar-body": "", children: "пустой ответ" }) : jsx(Foldable, { text: info.body, limit: 1400 }),
				receipt
					? jsx("div", {
							"data-spar-foot": "",
							children: jsx("button", {
								type: "button",
								"data-spar-toggle": "",
								"aria-expanded": "true",
								onClick: () => setExpanded(false),
								children: "скрыть",
							}),
						})
					: null,
			]);
		}


		/* ------------------------------------------------------------- panel ----- */

		const PANEL_STYLE_ID = "dsh-spar-panel-style";

		const PANEL_CSS = `
.spp{--p-fg:#ededf2;--p-dim:#8d8d9c;--p-faint:#5d5d6c;--p-line:rgba(255,255,255,.09);--p-card:rgba(255,255,255,.035);
	--p-accent:#8aa4ff;--p-accent2:#5eead4;--p-gold:#e5c07b;--p-bad:#f87171;
	font:12.5px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--p-fg);
	position:fixed;right:14px;bottom:98px;z-index:60;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.spp *{box-sizing:border-box}
.spp button,.spp select,.spp input{font:inherit;color:inherit}
.spp button{background:none;border:0;cursor:pointer}
.spp :focus-visible{outline:2px solid var(--p-accent);outline-offset:2px}
@keyframes spp-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
@keyframes spp-tab{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.spp .pill{display:flex;align-items:center;gap:8px;padding:6px 13px 6px 7px;border-radius:999px;
	border:1px solid var(--p-line);background:rgba(20,20,28,.9);backdrop-filter:blur(10px);
	box-shadow:0 10px 30px rgba(0,0,0,.45);transition:transform .16s ease,border-color .16s ease}
.spp .pill:hover{transform:translateY(-1px);border-color:rgba(138,164,255,.5)}
.spp .pill b{font-size:12px;font-weight:600;letter-spacing:.02em}
.spp .mark{width:26px;height:26px;border-radius:9px;display:grid;place-items:center;font-size:13px;font-weight:700;
	background:linear-gradient(135deg,var(--p-accent),var(--p-accent2));color:#0a0a10;flex:none}
.spp .live{width:6px;height:6px;border-radius:99px;background:var(--p-faint)}
.spp .live[data-on="1"]{background:var(--p-accent2);box-shadow:0 0 8px var(--p-accent2)}

.spp .panel{width:408px;max-width:calc(100vw - 26px);border-radius:20px;overflow:hidden;
	border:1px solid var(--p-line);background:rgba(16,16,23,.96);backdrop-filter:blur(16px);
	box-shadow:0 28px 80px rgba(0,0,0,.65);animation:spp-in .24s cubic-bezier(.2,.9,.25,1) both}
.spp .inner{display:flex;flex-direction:column;max-height:min(80vh,700px)}

.spp .top{padding:14px 14px 0;display:flex;align-items:center;gap:10px}
.spp .top h1{font-size:14px;font-weight:650;margin:0;letter-spacing:.01em}
.spp .top small{display:block;font-size:10.5px;color:var(--p-dim);margin-top:1px}
.spp .x{margin-left:auto;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;color:var(--p-dim);font-size:16px;line-height:1}
.spp .x:hover{color:var(--p-fg);background:rgba(255,255,255,.07)}

/* the match: who argues against whom, before and after you touch anything */
.spp .match{margin:12px 14px 0;display:grid;grid-template-columns:1fr auto 1fr;align-items:stretch;gap:8px}
.spp .side{position:relative;min-width:0;padding:8px 10px 8px 13px;border-radius:12px;background:var(--p-card);border:1px solid var(--p-line)}
.spp .side::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--rail,#6b7280)}
.spp .side i{display:block;font-style:normal;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--p-dim)}
.spp .side b{display:block;font-size:11.5px;font-weight:600;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spp .side em{display:block;font-style:normal;font-size:10px;color:var(--p-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spp .vs{align-self:center;font-size:9.5px;color:var(--p-faint);letter-spacing:.08em}

.spp .tabs{display:flex;gap:2px;margin:12px 14px 0;padding:3px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--p-line)}
.spp .tabs button{flex:1;padding:6px 0;border-radius:9px;font-size:11.5px;color:var(--p-dim);transition:background .15s,color .15s}
.spp .tabs button:hover{color:var(--p-fg)}
.spp .tabs button[aria-selected="true"]{background:rgba(138,164,255,.17);color:var(--p-fg);box-shadow:inset 0 0 0 1px rgba(138,164,255,.4)}
.spp .tabs sup{font-size:9px;margin-left:3px;color:var(--p-faint)}

.spp .body{flex:1;min-height:0;overflow:auto;padding:12px 14px 4px;animation:spp-tab .18s ease both}
.spp .body::-webkit-scrollbar{width:6px}
.spp .body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:99px}
.spp .group{padding:11px 12px 4px;margin-bottom:10px;border-radius:14px;background:var(--p-card);border:1px solid var(--p-line)}
.spp .group > h2{margin:0 0 9px;font-size:9.5px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;color:var(--p-dim)}
.spp .row{margin-bottom:10px}
.spp .row label,.spp .row .lab{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#c3c3cf;margin-bottom:4px}
.spp .row label small,.spp .row .lab small{font-size:10px;color:var(--p-faint)}
.spp select,.spp input[type=number]{width:100%;padding:8px 10px;border-radius:10px;border:1px solid var(--p-line);
	background:rgba(0,0,0,.25);outline:none;font-size:12px;transition:border-color .15s,background .15s}
.spp select:hover,.spp input:hover{border-color:rgba(255,255,255,.18)}
.spp select:focus,.spp input:focus{border-color:rgba(138,164,255,.65);background:rgba(138,164,255,.07)}
.spp option{background:#14141c}
.spp .seg{display:flex;gap:4px}
.spp .seg button{flex:1;padding:6px 4px;border-radius:9px;border:1px solid var(--p-line);background:rgba(0,0,0,.2);
	font-size:11px;color:var(--p-dim);transition:.15s;white-space:nowrap}
.spp .seg button:hover{color:var(--p-fg);border-color:rgba(255,255,255,.2)}
.spp .seg button[data-on="1"]{color:var(--p-fg);border-color:rgba(138,164,255,.6);background:rgba(138,164,255,.16)}
.spp .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}

.spp .deb{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:9px 11px;margin-bottom:7px;border-radius:12px;
	background:var(--p-card);border:1px solid var(--p-line)}
.spp .deb b{font-variant-numeric:tabular-nums;color:var(--p-accent);font-size:11.5px}
.spp .deb em{font-style:normal;font-size:10px;color:var(--p-dim);text-align:right}
.spp .deb[data-v="1"] em{color:var(--p-gold)}
.spp .deb span{grid-column:1/-1;font-size:11.5px;color:#c3c3cf;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.spp .empty{padding:22px 0;text-align:center;font-size:11.5px;color:var(--p-dim)}

.spp .foot{display:flex;align-items:center;gap:8px;padding:11px 14px 13px;border-top:1px solid var(--p-line);background:rgba(0,0,0,.18)}
.spp .save{position:relative;padding:7px 16px;border-radius:11px;font-size:12px;font-weight:650;color:#0a0a10;
	background:linear-gradient(135deg,var(--p-accent),var(--p-accent2));transition:opacity .15s,transform .15s}
.spp .save:hover:not([disabled]){transform:translateY(-1px)}
.spp .save[disabled]{opacity:.38;cursor:default}
.spp .ghost{padding:7px 10px;border-radius:10px;font-size:11.5px;color:var(--p-dim);border:1px solid var(--p-line)}
.spp .ghost:hover{color:var(--p-fg);background:rgba(255,255,255,.06)}
.spp .note{font-size:10.5px;color:var(--p-dim);margin-left:auto;text-align:right;min-width:0}
.spp .note[data-bad="1"]{color:var(--p-bad)}
.spp .note[data-dirty="1"]{color:var(--p-gold)}
@media (prefers-reduced-motion:reduce){.spp .panel,.spp .body{animation:none}.spp .pill,.spp .save{transition:none}}
`;

		/**
		 * The "inherit" option's label. It must never promise a model that no longer
		 * exists: `antigravity/gemini-3.8-flash-tiered` was deleted from the harness
		 * and still appeared here as the value in use, which read as "saving changed
		 * my model". A dead value is named as dead.
		 */
		function inheritLabel(role, value, catalog) {
			if (typeof value !== "string" || value === "") return "не выбран — выбери " + role;
			// `self` is a legitimate judge choice, not a model missing from the catalog.
			if (value === "self") return "как в профиле · я сам (моя модель)";
			const models = catalog?.models ?? [];
			const known = models.some((entry) => entry.label === value);
			return `как в профиле · ${value}${known ? "" : " · нет в каталоге"}`;
		}

		/** One choice the panel can leave alone: empty value means "profile default". */
		function modelOptions(models, allowEmpty, emptyLabel, current) {
			const rows = [];
			if (allowEmpty) rows.push(jsx("option", { value: "", children: emptyLabel, key: "auto" }));
			// A value the catalog does not know still exists in settings.json. Without
			// its own option the browser falls back to the first one, so the panel shows
			// "как в профиле" while the dead value is what gets saved again.
			const known = models.some((entry) => entry.label === current);
			if (typeof current === "string" && current !== "" && current !== "self" && !known) {
				rows.push(jsx("option", { value: current, children: `${current} · нет в каталоге`, key: "stale" }));
			}
			for (const entry of models) {
				rows.push(
					jsx("option", {
						value: entry.label,
						children: entry.chat ? entry.label : `${entry.label} · не чат`,
						key: entry.label,
					}),
				);
			}
			return rows;
		}

		/**
		 * The panel: which models take part, what they speak, and how much room
		 * they get. Every choice lands in `settings.json` and applies to the next
		 * turn, so nothing here needs a plugin reload.
		 */
		function Panel() {
			const [open, setOpen] = React.useState(false);
			const [catalog, setCatalog] = React.useState({ providers: [], models: [] });
			const [state, setState] = React.useState(null);
			const [draft, setDraft] = React.useState({});
			const [note, setNote] = React.useState("");
			const [bad, setBad] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [tab, setTab] = React.useState("models");
			// setState after the panel closed (or unmounted) is a leak and a warning.
			const alive = React.useRef(true);
			React.useEffect(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);

			const load = () => {
				fetch("/spar-models", { cache: "no-store" })
					.then((response) => (response.ok ? response.json() : null))
					.then((value) => {
						if (!alive.current) return;
						if (value !== null) setCatalog({ providers: value.providers ?? [], models: value.models ?? [] });
						else {
							setBad(true);
							setNote("каталог моделей не отвечает");
						}
					})
					.catch(() => {
						if (!alive.current) return;
						setBad(true);
						setNote("каталог моделей не отвечает");
					});
				fetch("/spar-settings", { cache: "no-store" })
					.then((response) => (response.ok ? response.json() : null))
					.then((value) => {
						if (!alive.current) return;
						if (value === null) {
							setBad(true);
							setNote("маршрут настроек не отвечает");
							return;
						}
						setState(value);
						// The draft is what will be written, so it holds only what is already
						// saved. Anything else comes from `effective` for display only —
						// seeding the draft from it pinned every inherited value into
						// settings.json on the first save, including models that no longer
						// exist in the harness.
						setDraft({ ...(value.saved ?? {}) });
					})
					.catch(() => {
						if (!alive.current) return;
						setBad(true);
						setNote("маршрут настроек не отвечает");
					});
			};

			React.useEffect(() => {
				if (open) load();
			}, [open]);

			const set = (key, value) => {
				setNote("");
				setBad(false);
				setDraft((previous) => ({ ...previous, [key]: value }));
			};
			// Compared by sorted keys so that an untouched panel never looks edited.
			const canon = (value) => JSON.stringify(Object.entries(value ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]).sort(([a], [b]) => (a < b ? -1 : 1)));
			const dirty = state !== null && canon(draft) !== canon(state.saved);

			const save = () => {
				setBusy(true);
				setBad(false);
				setNote("сохраняю…");
				const body = {
					opponent: draft.opponent ?? "",
					judge: draft.judge ?? "",
					challenger: draft.challenger ?? "",
					language: draft.language ?? "",
					tools: typeof draft.tools === "boolean" ? draft.tools : null,
					maxToolRounds: Number(draft.maxToolRounds) || 0,
					maxReplyTokens: Number(draft.maxReplyTokens) || 0,
					judgeTokens: Number(draft.judgeTokens) || 0,
					// 0 is a real temperature (a deterministic arbiter), so emptiness is
					// what reverts, not zero.
					temperatureOpponent:
						draft.temperatureOpponent === undefined || draft.temperatureOpponent === "" ? "" : Number(draft.temperatureOpponent),
					temperatureJudge:
						draft.temperatureJudge === undefined || draft.temperatureJudge === "" ? "" : Number(draft.temperatureJudge),
				};
				fetch("/spar-settings", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				})
					.then((response) => (response.ok ? response.json() : null))
					.then((value) => {
						if (!alive.current) return;
						if (value === null) throw new Error("rejected");
						setState((previous) => ({ ...(previous ?? {}), saved: value.saved, effective: value.effective }));
						setDraft({ ...(value.saved ?? {}) });
						setNote("сохранено · применится к следующему ходу");
					})
					.catch(() => {
						if (!alive.current) return;
						setBad(true);
						setNote("не сохранилось");
					})
					.finally(() => {
						if (alive.current) setBusy(false);
					});
			};

			const models = Array.isArray(catalog.models) ? catalog.models : [];
			// `profile` is what the yaml would give a key nobody has saved — the truth
			// behind "как в профиле". `effective` is what a turn will really use right
			// now, saved values included. Confusing the two made a saved model look
			// like the profile default.
			const profile = state?.effective?.profile ?? {};
			const effective = state?.effective?.current ?? {};
			const debates = Array.isArray(state?.debates) ? state.debates : [];

			const pill = jsxs("button", {
				type: "button",
				className: "pill",
				key: "pill",
				"aria-label": open ? "Закрыть настройки спарринга" : "Открыть настройки спарринга",
				"aria-expanded": open ? "true" : "false",
				onClick: () => setOpen(!open),
				title: open ? "свернуть" : "спарринг: модели и настройки",
				children: [
					jsx("span", { className: "mark", children: "◈" }),
					jsx("b", { children: "spar" }),
					jsx("span", { className: "live", "data-on": debates.some((row) => row.closed !== true) ? "1" : "0", "aria-hidden": "true" }),
				],
			});

			if (!open) return jsx("div", { className: "spp", children: pill });

const field = (id, label, hint, control) =>
				jsxs("div", {
					className: "row",
					children: [jsxs("label", { htmlFor: id, children: [label, hint ? jsx("small", { children: hint }) : null] }), control],
				});

			// One choice among a few, with "профиль" always first: the way back to the default.
			const chips = (id, label, hint, key, values, profileValue) =>
				jsxs("div", {
					className: "row",
					children: [
						jsxs("div", { className: "lab", id, children: [label, hint ? jsx("small", { children: hint }) : null] }),
						jsx("div", {
							className: "seg",
							role: "group",
							"aria-labelledby": id,
							children: values.map((value) => {
								const on = String(draft[key] ?? "") === String(value);
								return jsx("button", {
									type: "button",
									key: String(value),
									"data-on": on ? "1" : "0",
									"aria-pressed": on ? "true" : "false",
									onClick: () => set(key, value),
									children: value === "" ? `профиль · ${profileValue ?? "—"}` : String(value),
								});
							}),
						}),
					],
				});

			const modelsTab = [
				jsxs("div", {
					className: "group",
					key: "who",
					children: [
						jsx("h2", { children: "Кто спорит" }),
						field(
							"spp-f1",
							"оппонент",
							"отвечает на ваши аргументы",
							jsx("select", {
								id: "spp-f1",
								value: draft.opponent ?? "",
								onChange: (event) => set("opponent", event.target.value),
								children: modelOptions(models, true, inheritLabel("оппонент", profile.opponent, catalog), draft.opponent ?? ""),
							}),
						),
						field(
							"spp-f3",
							"вторая сторона дуэли",
							"для режима duel",
							jsx("select", {
								id: "spp-f3",
								value: draft.challenger ?? "",
								onChange: (event) => set("challenger", event.target.value),
								children: modelOptions(models, true, inheritLabel("соперник", profile.challenger, catalog), draft.challenger ?? ""),
							}),
						),
						field(
							"spp-f2",
							"судья",
							"выносит приговор",
							jsx("select", {
								id: "spp-f2",
								value: draft.judge ?? "",
								onChange: (event) => set("judge", event.target.value),
								children: [
									jsx("option", { value: "", children: inheritLabel("судья", profile.judge, catalog), key: "auto" }),
									jsx("option", { value: "self", children: "я сам (моя модель)", key: "self" }),
									...modelOptions(models, false, "", draft.judge ?? ""),
								],
							}),
						),
					],
				}),
				jsxs("div", {
					className: "group",
					key: "lang",
					children: [
						jsx("h2", { children: "Язык" }),
						jsxs("div", {
							className: "row",
							children: [
								jsx("div", { className: "lab", id: "spp-lang", children: "язык спора" }),
								jsxs("div", {
									className: "seg",
									role: "group",
									"aria-labelledby": "spp-lang",
									children: [
										// Three states: a ru/en pair had no way back to "whatever the profile says".
										["ru", "русский", undefined],
										["en", "english", undefined],
										["", "как в профиле", `сейчас в профиле: ${profile.language ?? "—"}`],
									].map(([value, text, title]) => {
										const on = (draft.language ?? "") === value;
										return jsx("button", {
											type: "button",
											key: text,
											title,
											"data-on": on ? "1" : "0",
											"aria-pressed": on ? "true" : "false",
											onClick: () => set("language", value),
											children: text,
										});
									}),
								}),
							],
						}),
					],
				}),
			];

			const paramsTab = [
				jsxs("div", {
					className: "group",
					key: "read",
					children: [
						jsx("h2", { children: "Чтение проекта" }),
						// Three states, one of them "не решать": a plain switch could never give the value back to the profile.
						field(
							"spp-f4",
							"оппонент читает файлы",
							"",
							jsx("select", {
								id: "spp-f4",
								value: typeof draft.tools === "boolean" ? String(draft.tools) : "",
								onChange: (event) => {
									const value = event.target.value;
									set("tools", value === "" ? "" : value === "true");
								},
								children: [
									jsx("option", { value: "", children: `как в профиле · ${profile.tools === false ? "выключено" : "включено"}`, key: "auto" }),
									jsx("option", { value: "true", children: "включено", key: "on" }),
									jsx("option", { value: "false", children: "выключено", key: "off" }),
								],
							}),
						),
						field(
							"spp-f5",
							"чтений на ход",
							"0–8",
							jsx("input", {
								id: "spp-f5",
								type: "number",
								min: 0,
								max: 8,
								value: draft.maxToolRounds ?? effective.maxToolRounds ?? "",
								onChange: (event) => set("maxToolRounds", event.target.value),
							}),
						),
					],
				}),
				jsxs("div", {
					className: "group",
					key: "len",
					children: [
						jsx("h2", { children: "Длина, токены" }),
						jsxs("div", {
							className: "two",
							children: [
								field(
									"spp-f6",
									"ответ",
									"",
									jsx("input", {
										id: "spp-f6",
										type: "number",
										min: 0,
										step: 1024,
										value: draft.maxReplyTokens ?? effective.maxReplyTokens ?? "",
										onChange: (event) => set("maxReplyTokens", event.target.value),
									}),
								),
								field(
									"spp-f7",
									"приговор",
									"",
									jsx("input", {
										id: "spp-f7",
										type: "number",
										min: 0,
										step: 1024,
										value: draft.judgeTokens ?? effective.judgeTokens ?? "",
										onChange: (event) => set("judgeTokens", event.target.value),
									}),
								),
							],
						}),
					],
				}),
				jsxs("div", {
					className: "group",
					key: "temp",
					children: [
						jsx("h2", { children: "Температура" }),
						chips("spp-f8", "оппонент", "ниже — строже, выше — смелее", "temperatureOpponent", ["", 0.2, 0.5, 0.8, 1, 1.2], profile.temperatureOpponent),
						chips("spp-f9", "судья", "лучше пониже", "temperatureJudge", ["", 0, 0.15, 0.25, 0.5], profile.temperatureJudge),
					],
				}),
			];

			const debatesTab =
				debates.length === 0
					? jsx("div", { className: "empty", children: "Споров пока нет. Они появятся после первого вызова spar." })
					: debates.map((row) =>
							jsxs("div", {
								className: "deb",
								key: row.id,
								"data-v": row.verdict ? "1" : "0",
								children: [
									jsx("b", { children: row.id }),
									jsx("em", { children: row.verdict ? "⚖ приговор" : `${row.turns} ход.` }),
									jsx("span", { children: row.topic }),
								],
							}),
						);

			const tabs = [
				["models", "Модели"],
				["params", "Параметры"],
				["debates", "Споры"],
			];
			const pickedOpponent = draft.opponent || profile.opponent || "";
			const pickedJudge = draft.judge === "self" ? "self" : draft.judge || profile.judge || "";
			const sideView = (role, value) => {
				const text = value === "self" ? "я сам" : String(value || "не выбран");
				const slash = text.lastIndexOf("/");
				return jsxs("div", {
					className: "side",
					style: { "--rail": tintOf(value) },
					children: [
						jsx("i", { children: role }),
						jsx("b", { title: text, children: slash >= 0 ? text.slice(slash + 1) : text }),
						jsx("em", { children: slash >= 0 ? text.slice(0, slash) : value === "self" ? "модель, что вызвала spar" : "" }),
					],
				});
			};
			const dirtyNow = dirty;
			const shownNote = note !== "" ? note : dirtyNow ? "есть несохранённые изменения" : "";

			return jsx("div", {
				className: "spp",
				children: [jsx("div", {
					key: "panel",
					className: "panel",
					role: "dialog",
					"aria-label": "Настройки спарринга",
					children: jsxs("div", {
						className: "inner",
						children: [
							jsxs("div", {
								className: "top",
								children: [
									jsx("span", { className: "mark", children: "◈" }),
									jsxs("div", {
										children: [jsx("h1", { children: "Спарринг" }), jsx("small", { children: "модели, судья и лимиты · применяются к следующему ходу" })],
									}),
									jsx("button", { type: "button", className: "x", "aria-label": "Закрыть панель", title: "Закрыть", onClick: () => setOpen(false), children: "×" }),
								],
							}),
							jsxs("div", {
								className: "match",
								children: [sideView("оппонент", pickedOpponent), jsx("span", { className: "vs", "aria-hidden": "true", children: "·" }), sideView("судья", pickedJudge)],
							}),
							jsx("div", {
								className: "tabs",
								role: "tablist",
								children: tabs.map(([id, text]) =>
									jsxs("button", {
										type: "button",
										role: "tab",
										key: id,
										"aria-selected": tab === id ? "true" : "false",
										onClick: () => setTab(id),
										children: [text, id === "debates" && debates.length > 0 ? jsx("sup", { children: debates.length }) : null],
									}),
								),
							}),
							jsx("div", {
								className: "body",
								role: "tabpanel",
								key: tab,
								children: tab === "models" ? modelsTab : tab === "params" ? paramsTab : debatesTab,
							}),
							jsxs("div", {
								className: "foot",
								children: [
									jsx("button", { type: "button", className: "save", disabled: busy || !dirtyNow, onClick: save, children: busy ? "…" : "Сохранить" }),
									jsx("button", { type: "button", className: "ghost", onClick: load, title: "Перечитать настройки и каталог моделей", children: "Обновить" }),
									jsx("span", { className: "note", role: "status", "aria-live": "polite", "data-bad": bad ? "1" : "0", "data-dirty": !bad && note === "" && dirtyNow ? "1" : "0", children: shownNote }),
								],
							}),
						],
					}),
				}), pill],
			});
		}

		function apply(ctx) {
			// A failed view registration must not take the whole shell down: the
			// tool half keeps working either way, only the speaker card is lost.
			ctx.effect(() => {
				try {
					if (document.getElementById(STYLE_ID) === null) {
						const style = document.createElement("style");
						style.id = STYLE_ID;
						style.textContent = CSS;
						document.head.append(style);
					}
				} catch (error) {
					console.warn("spar: styles not applied", error);
				}
				return () => {
					document.getElementById(STYLE_ID)?.remove();
				};
			}, "spar: styles");

			ctx.effect(() => {
				try {
					if (document.getElementById(PANEL_STYLE_ID) === null) {
						const style = document.createElement("style");
						style.id = PANEL_STYLE_ID;
						style.textContent = PANEL_CSS;
						document.head.append(style);
					}
				} catch (error) {
					console.warn("spar: panel styles not applied", error);
				}
				return () => {
					document.getElementById(PANEL_STYLE_ID)?.remove();
				};
			}, "spar: panel styles");

			try {
				ctx.slots.inject("tool.call.toolview", () =>
					ctx.slots.register({ name: "tool.call.toolview", key: "spar" }, (props) => jsx(Card, { props })),
				);
			} catch (error) {
				console.warn("spar: tool view not registered", error);
			}

			// The settings pill lives in the shell overlay, so the choice of models
			// is in the harness instead of in a yaml file.
			try {
				ctx.slots.inject("shell.overlay", () =>
					ctx.slots.register({ name: "shell.overlay", id: "spar", order: 850 }, Panel),
				);
			} catch (error) {
				console.warn("spar: settings panel not registered", error);
			}
		}

		// `slots` must be declared here: the dynamic-package guard rejects any
		// service access the returned plugin did not inject, and ctx.slots is the
		// whole point of this half.
		return { name: "dsh-plugin-spar", inject: ["slots"], apply };
	},
});