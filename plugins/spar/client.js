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
	border-radius: 12px;
	border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.09));
	background: var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.03));
	padding: 12px 14px 10px;
	margin: 6px 0;
	overflow: hidden;
	position: relative;
}
[data-spar-card]::before {
	content: "";
	position: absolute;
	inset: 0 auto 0 0;
	width: 2px;
	background: var(--spar-rail, linear-gradient(180deg, #4c8dff, #a78bfa));
	opacity: 0.9;
}
[data-spar-card][data-state="error"] {
	border-color: var(--dsw-alias-state-error-primary, #f87171);
}
[data-spar-card][data-state="error"]::before {
	background: var(--dsw-alias-state-error-primary, #f87171);
}
[data-spar-card][data-state="utility"] {
	background: transparent;
	padding: 8px 12px;
}
[data-spar-head] {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 8px;
	font-size: 12px;
}
[data-spar-badge] {
	width: 18px; height: 18px;
	border-radius: 6px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font-size: 11px;
	font-weight: 600;
	color: #fff;
	background: var(--spar-rail, linear-gradient(160deg, #4c8dff, #a78bfa));
	flex: none;
}
[data-spar-name] {
	color: var(--dsw-alias-label-primary, #f0f0f0);
	font-weight: 550;
	letter-spacing: 0.01em;
}
[data-spar-tag] {
	color: var(--dsw-alias-label-tertiary, #7b7b7b);
	font-size: 11px;
	padding: 1px 6px;
	border-radius: 999px;
	border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.09));
	white-space: nowrap;
}
[data-spar-meta] {
	margin-left: auto;
	color: var(--dsw-alias-label-tertiary, #7b7b7b);
	font-size: 11px;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}
[data-spar-body] {
	color: var(--dsw-alias-label-primary, #e8e8e8);
	font-size: 13.5px;
	line-height: 1.62;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
[data-spar-body] > * + * { margin-top: 8px; }
[data-spar-body] code {
	font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
	font-size: 12.5px;
	background: var(--dsw-alias-markdown-inline-code, rgba(255,255,255,0.06));
	padding: 1px 5px;
	border-radius: 5px;
}
[data-spar-body] pre {
	margin: 0;
	padding: 10px 12px;
	border-radius: 8px;
	overflow-x: auto;
	background: var(--dsw-alias-markdown-code-block, rgba(255,255,255,0.05));
	border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.07));
}
[data-spar-body] pre code {
	background: none;
	padding: 0;
	font-size: 12.5px;
	line-height: 1.5;
	white-space: pre;
}
[data-spar-foot] {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 8px;
	font-size: 11px;
	color: var(--dsw-alias-label-tertiary, #7b7b7b);
}
[data-spar-toggle] {
	appearance: none;
	background: none;
	border: 0;
	padding: 0;
	margin-left: auto;
	font: inherit;
	color: var(--dsw-alias-label-secondary, #a0a0a0);
	cursor: pointer;
}
[data-spar-toggle]:hover { color: var(--dsw-alias-label-primary, #f0f0f0); }
[data-spar-receipt] {
	display: flex;
	align-items: center;
	gap: 9px;
	font-size: 11.5px;
	color: var(--dsw-alias-label-tertiary, #8a8a8a);
}
[data-spar-receipt] [data-spar-toggle] {
	font-size: 10.5px;
	padding: 2px 9px;
	border-radius: 99px;
	border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12));
	color: var(--dsw-alias-label-secondary, #a8a8a8);
}
[data-spar-receipt] [data-spar-toggle]:hover {
	color: var(--dsw-alias-label-primary, #ececf1);
	border-color: var(--dsw-alias-border-l2, rgba(255,255,255,0.22));
}
[data-spar-stream] {
	display: flex;
	flex-direction: column;
	gap: 9px;
	min-width: 0;
}
[data-spar-steps] {
	display: flex;
	flex-direction: column;
	gap: 3px;
	padding: 8px 10px;
	border-radius: 8px;
	background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.025));
	border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.07));
}
[data-spar-step] {
	display: flex;
	align-items: baseline;
	gap: 6px;
	font-size: 11.5px;
	line-height: 1.5;
	color: var(--dsw-alias-label-tertiary, #8a8a8a);
	min-width: 0;
}
[data-spar-step-mark] { color: var(--spar-rail, #4c8dff); opacity: 0.7; flex: none; }
[data-spar-step-name] { color: var(--dsw-alias-label-secondary, #a8a8a8); flex: none; }
[data-spar-step-subject] {
	font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
	font-size: 11px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
[data-spar-reason] {
	font-size: 12px;
	line-height: 1.55;
	color: var(--dsw-alias-label-tertiary, #909090);
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	max-height: 132px;
	overflow: hidden;
	padding-left: 9px;
	border-left: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.09));
	-webkit-mask-image: linear-gradient(180deg, #000 66%, transparent);
	mask-image: linear-gradient(180deg, #000 66%, transparent);
}
[data-spar-card][data-state="past"] { opacity: 0.62; padding: 8px 12px; cursor: pointer; }
[data-spar-card][data-state="past"]:hover { opacity: 0.85; }
[data-spar-mine] {
	color: #8ea0b5;
	border-left: 2px solid #2f3a48;
	padding-left: 10px;
	margin: 0 0 8px;
	white-space: pre-wrap;
	word-break: break-word;
	display: -webkit-box;
	-webkit-line-clamp: 4;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
[data-spar-quiet] {
	font-size: 12.5px;
	color: var(--dsw-alias-label-tertiary, #8a8a8a);
}
[data-spar-status] {
	margin-top: 9px;
	display: inline-flex;
	align-items: center;
	gap: 7px;
	font-size: 11.5px;
	color: var(--dsw-alias-label-tertiary, #8a8a8a);
}
[data-spar-status][data-spar-stalled="1"] {
	color: #f0a45c;
}
[data-spar-thinking] {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	color: var(--dsw-alias-label-secondary, #a0a0a0);
	font-size: 13px;
}
[data-spar-dot] {
	width: 6px; height: 6px; border-radius: 50%;
	background: #4c8dff;
	animation: dsh-spar-pulse 1.15s ease-in-out infinite;
}
@keyframes dsh-spar-pulse {
	0%, 100% { opacity: 0.25; transform: scale(0.85); }
	50% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
	[data-spar-dot] { animation: none; opacity: 0.8; }
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
			const parts = segments(text);
			return jsx("div", {
				"data-spar-body": "",
				children: parts.map((part, index) =>
					part.kind === "code"
						? jsx("pre", {
								key: index,
								children: jsx("code", { "data-lang": part.lang || undefined, children: part.text }),
							})
						: jsx("div", { key: index, children: blocks(part.text) }),
				),
			});
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
			return { utility: false, body, model, debate, tag, ms, receipt, pending };
		}

		const LIVE_MS = 320;
		/** Consecutive empty polls before a running card admits it lost the host. */
		const STALL_AFTER = 40;
		/** Nothing is declared dead inside the first minute: a cold gateway is slow. */
		const STALL_FLOOR_MS = 60_000;

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
				const step = Math.max(1, Math.ceil((target - count) / 6));
				const handle = requestAnimationFrame(() => setCount((value) => Math.min(target, value + step)));
				return () => {
					if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
				};
			}, [count, target, streaming]);
			if (streaming !== true || count >= target) return full;
			return full.slice(0, count);
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
								schedule(LIVE_MS * 2);
							}
						})
						.catch(() => {
							if (stopped) return;
							misses += 1;
							setState((previous) => ({ ...(previous ?? {}), known: false, stalled: misses >= STALL_AFTER && Date.now() - startedAt > STALL_FLOOR_MS }));
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

		function Card({ props }) {
			const [open, setOpen] = React.useState(true);
			const [expanded, setExpanded] = React.useState(false);
			const raw = props.block === undefined ? "" : rawText(props.block);
			const started = raw.includes("· started]");
			const running = props.phase === "preparing" || props.phase === "start";
			const live = useLiveTurn(props.callId, running || started);
			// Which card is the live one for this debate? A spawn card that has been
			// overtaken by a later call is a finished phase, and printing it in full is
			// the parade of identical "вторая модель" panels. It collapses to one line;
			// the newest card carries the content.
			const debateId = (/\[spar (d\d+)/.exec(raw) ?? [])[1] ?? "";
			const [newest, setNewest] = React.useState(null);
			React.useEffect(() => {
				if (!started || debateId === "") return undefined;
				let alive = true;
				fetch(`/spar-live?debate=${encodeURIComponent(debateId)}`, { cache: "no-store" })
					.then((response) => (response.ok ? response.json() : null))
					.then((value) => {
						if (alive && value !== null && value.newest !== null && value.newest !== undefined) setNewest(value.newest);
					})
					.catch(() => {});
				return () => {
					alive = false;
				};
			}, [debateId, started]);
			const superseded =
				started === true &&
				typeof props.callId === "string" &&
				newest !== null &&
				typeof newest.callId === "string" &&
				newest.callId !== props.callId;
			// The registry knows more than the tool-call prop: it has the real text and the
			// real end. A finished turn must not be painted as running, and a turn whose
			// first poll is still in flight must not be painted as finished.
			// `known` is the field that decides everything. A missing entry used to leave
			// `{stalled:false}` in state — an object, not null — so `liveKnown` was true,
			// `liveDone` false, and every card whose call the registry did not know
			// painted itself as "пишет · думает…". That is where the ghost cards came
			// from: not a running turn, an absent one.
			const liveKnown = live !== null && live !== undefined && live.known === true;
			const liveDone = liveKnown && live.done === true;
			const working = liveKnown && !liveDone;
			const streaming = working;
			const smooth = useSmoothText(live?.text ?? "", streaming);

			// A turn is being written: paint it as it grows instead of holding a
			// spinner for the whole model round.
			if (working) {
				const text = live?.text ?? "";
				const activity = live?.activity ?? "";
				const steps = Array.isArray(live?.steps) ? live.steps : [];
				const reasoning = typeof live?.reasoning === "string" ? live.reasoning : "";
				return jsxs("div", {
					"data-spar-card": "",
					"data-state": "running",
					"data-tool": "spar",
					style: { "--spar-rail": accent(modelOf(live?.route)) },
					children: [
						jsxs("div", {
							"data-spar-head": "",
							children: [
								jsx("span", { "data-spar-badge": "", children: "◈" }),
								jsx("span", {
									"data-spar-name": "",
									children: stageName(live),
								}),
								jsx("span", {
									"data-spar-tag": "",
									"data-spar-stalled": live?.stalled === true ? "1" : "0",
									children:
										live?.stalled === true
											? "нет ответа"
											: live?.phase === "verdict"
												? "приговор"
												: "пишет",
								}),
								live === null || typeof live.ms !== "number"
									? null
									: jsx("span", { "data-spar-meta": "", children: `${(live.ms / 1000).toFixed(1)}s` }),
							],
						}),
						jsxs("div", {
							"data-spar-stream": "",
							children: [
								// The caller's own turn, above the reply. Without it the card looks
								// like a monologue and the reader cannot tell what was answered.
								live === null || typeof live.mine !== "string" || live.mine === ""
									? null
									: jsx("div", { "data-spar-mine": "", children: live.mine }),
								steps.length === 0
									? null
									: jsx("div", {
											"data-spar-steps": "",
											children: steps.map((step, index) =>
												jsxs(
													"div",
													{
														"data-spar-step": "",
														key: `${index}-${step.name}`,
														children: [
															jsx("span", { "data-spar-step-mark": "", children: "›" }),
															jsx("span", { "data-spar-step-name": "", children: step.name }),
															step.subject === ""
																? null
																: jsx("span", { "data-spar-step-subject": "", children: step.subject }),
														],
													},
												),
											),
										}),
								reasoning === ""
									? null
									: jsx("div", { "data-spar-reason": "", children: reasoning }),
								text === "" ? null : jsx(Body, { text: smooth }),
								text === "" && reasoning === "" && steps.length === 0 && live?.stalled !== true && live?.mine !== null
									? jsx("div", { "data-spar-quiet": "", children: "думает…" })
									: null,
							],
						}),
						activity === "" && text === "" && reasoning === "" && steps.length === 0 && live?.stalled !== true
							? null
							: jsxs("div", {
									"data-spar-status": "",
									"data-spar-stalled": live?.stalled === true ? "1" : "0",
									children: [
										live?.stalled === true ? null : jsx("span", { "data-spar-dot": "" }),
										live?.stalled === true
											? "нет ответа от реестра — ход, возможно, оборвался · проверь action:\"result\""
											: activity === ""
												? text === ""
													? "думает…"
													: "пишет…"
												: `читает ${activity}`,
									],
								}),
					],
				});
			}

			const failed = props.block?.isError === true;
			const info = parse(props.block);

			// A phase that the debate has moved past: one line, no prose. The turn is
			// in the record and in whatever card came next; repeating it here is what
			// made the chat look like four models talking at once.
			if (superseded && !expanded) {
				return jsxs("div", {
					"data-spar-card": "",
					"data-state": "past",
					"data-tool": "spar",
					onClick: () => setExpanded(true),
					children: [
						jsxs("div", {
							"data-spar-head": "",
							children: [
								jsx("span", { "data-spar-badge": "", children: "·" }),
								jsx("span", { "data-spar-name": "", children: `${debateId} · этап пройден` }),
								jsx("span", { "data-spar-tag": "", children: stageName(newest) }),
								jsx("span", { "data-spar-meta": "", children: "показать" }),
							],
						}),
					],
				});
			}

			// An async turn settled: the result is only an acknowledgement, so the
			// text comes from the polled state instead.
			if (started && live !== null && live.done === true) {
				const verdict = live.phase === "verdict";
				return jsxs("div", {
					"data-spar-card": "",
					"data-state": live.error ? "error" : "settled",
					"data-tool": "spar",
					style: { "--spar-rail": accent(modelOf(live.route)) },
					children: [
						jsxs("div", {
							"data-spar-head": "",
							children: [
								jsx("span", { "data-spar-badge": "", children: live.error ? "!" : "◈" }),
								jsx("span", { "data-spar-name": "", children: stageName(live) }),
								jsx("span", {
									"data-spar-tag": "",
									children: live.error ? "не ответила" : verdict ? "приговор" : "возражение",
								}),
								jsx("span", {
									"data-spar-meta": "",
									children: `${(live.ms / 1000).toFixed(1)}s${live.id === null ? "" : ` · ${live.id}`}`,
								}),
							],
						}),
						live.error
							? jsx("div", { "data-spar-body": "", children: live.error })
							: jsx(Body, { text: live.text }),
					],
				});
			}

			const style = { "--spar-rail": accent(info.model) };

			if (info.utility) {
				return jsxs("div", {
					"data-spar-card": "",
					"data-state": "utility",
					"data-tool": "spar",
					children: [
						jsxs("div", {
							"data-spar-head": "",
							children: [
								jsx("span", { "data-spar-badge": "", children: "◈" }),
								jsx("span", { "data-spar-tag": "", children: info.tag }),
							],
						}),
						jsx(Body, { text: info.body }),
					],
				});
			}

			const long = info.body.length > 420;
			const shown = open || !long ? info.body : `${info.body.slice(0, 420).trimEnd()}…`;
			// A collected turn is a receipt: the prose is already on screen in the
			// turn's own card, so printing it again is noise, not information.
			const receipt = info.receipt === true && failed !== true;
			const collapsedReceipt = receipt && !expanded;
			const toggleLabel = receipt ? (expanded ? "скрыть" : "показать") : open ? "свернуть" : "показать целиком";

			return jsxs("div", {
				"data-spar-card": "",
				"data-state": failed ? "error" : "settled",
				"data-tool": "spar",
				style,
				children: [
					jsxs("div", {
						"data-spar-head": "",
						children: [
							jsx("span", { "data-spar-badge": "", children: failed ? "!" : "◈" }),
							jsx("span", {
								"data-spar-name": "",
								children: info.tag === "приговор" ? "судья" : info.tag === "каталог" || info.tag === "список" ? "spar" : "B отвечает",
							}),
							jsx("span", { "data-spar-tag": "", children: failed ? "не ответила" : info.tag }),
							info.ms === null
								? null
								: jsx("span", {
										"data-spar-meta": "",
										children: `${(info.ms / 1000).toFixed(1)}s${info.debate === "" ? "" : ` · ${info.debate}`}`,
									}),
						],
					}),
					collapsedReceipt
						? jsxs("div", {
								"data-spar-receipt": "",
								children: [
									jsx("span", {
										children: info.pending
											? "ответ ещё не готов"
											: `ответ получен · ${info.body.length} ${
													info.body.length % 10 === 1 && info.body.length % 100 !== 11
														? "знак"
														: [2, 3, 4].includes(info.body.length % 10) && ![12, 13, 14].includes(info.body.length % 100)
															? "знака"
															: "знаков"
												}`,
									}),
									info.body === "" || info.pending
										? null
										: jsx("button", {
												type: "button",
												"data-spar-toggle": "",
												onClick: () => setExpanded(true),
												children: "показать",
											}),
								],
							})
						: info.body === ""
							? jsx("div", { "data-spar-body": "", children: "пустой ответ" })
							: jsx(Body, { text: receipt ? info.body : shown }),
					long && !receipt
						? jsxs("div", {
								"data-spar-foot": "",
								children: [
									jsx("span", { children: "спор" }),
									jsx("button", {
										type: "button",
										"data-spar-toggle": "",
										onClick: () => (receipt ? setExpanded((value) => !value) : setOpen((value) => !value)),
										children: toggleLabel,
									}),
								],
							})
						: null,
				],
			});
		}

		/* ------------------------------------------------------------- panel ----- */

		const PANEL_STYLE_ID = "dsh-spar-panel-style";

		const PANEL_CSS = `
.spp{font:12px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#ececf1;
	position:fixed;right:14px;bottom:98px;z-index:60;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.spp *{box-sizing:border-box}
.spp button,.spp select,.spp input{font:inherit;color:inherit}
.spp button{background:none;border:0;cursor:pointer}
@keyframes spp-in{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
.spp .pill{display:flex;align-items:center;gap:7px;padding:5px 11px 5px 8px;border-radius:999px;
	border:1px solid rgba(255,255,255,.14);background:linear-gradient(180deg,rgba(30,30,42,.96),rgba(16,16,22,.96));
	box-shadow:0 10px 30px rgba(0,0,0,.55);transition:transform .16s ease,box-shadow .16s ease}
.spp .pill:hover{transform:translateY(-1px);box-shadow:0 14px 36px rgba(0,0,0,.6)}
.spp .pill b{font-size:11.5px;font-weight:600;letter-spacing:.02em}
.spp .pill .dots{display:flex;gap:2px;margin-top:3px}
.spp .pill .dots i{width:3px;height:3px;border-radius:99px;background:#8b8b99}
.spp .pill .dots i.on{background:#34d399;box-shadow:0 0 6px #34d399}
.spp .panel{width:352px;max-width:calc(100vw - 26px);margin-bottom:10px;border-radius:18px;padding:1px;
	background:linear-gradient(160deg,rgba(139,92,246,.4),rgba(34,211,238,.18) 45%,transparent 72%);
	box-shadow:0 26px 70px rgba(0,0,0,.65);animation:spp-in .22s cubic-bezier(.2,.9,.25,1) both}
.spp .inner{border-radius:17px;padding:13px 13px 11px;max-height:min(76vh,660px);display:flex;flex-direction:column;
	background:radial-gradient(120% 90% at 100% 0%,rgba(139,92,246,.10),transparent 55%),
	linear-gradient(180deg,rgba(19,19,27,.99),rgba(12,12,17,.99))}
.spp .head{display:flex;align-items:center;gap:8px;margin-bottom:11px}
.spp .mark{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-size:11px;font-weight:700;
	background:linear-gradient(135deg,#8b5cf6,#22d3ee);color:#08080c}
.spp .head h1{font-size:12.5px;font-weight:600;margin:0;letter-spacing:.02em}
.spp .chip{font-size:9px;text-transform:uppercase;letter-spacing:.09em;color:#8b8b99;
	border:1px solid rgba(255,255,255,.08);border-radius:99px;padding:2px 7px}
.spp .x{margin-left:auto;width:22px;height:22px;border-radius:7px;display:grid;place-items:center;color:#8b8b99;
	border:1px solid rgba(255,255,255,.08)}
.spp .x:hover{color:#ececf1;background:rgba(255,255,255,.05)}
.spp .scroll{flex:1;min-height:0;overflow:auto;margin:0 -3px;padding:0 3px}
.spp .scroll::-webkit-scrollbar{width:6px}
.spp .scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:99px}
.spp .row{margin-bottom:9px}
.spp .row label{display:block;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#8b8b99;margin-bottom:4px}
.spp select,.spp input[type=number]{width:100%;padding:6px 8px;border-radius:9px;border:1px solid rgba(255,255,255,.1);
	background:rgba(255,255,255,.035);outline:none;font-size:11.5px}
.spp select:focus,.spp input:focus{border-color:rgba(139,92,246,.55);background:rgba(139,92,246,.08)}
.spp option{background:#14141c}
.spp .seg{display:flex;gap:4px}
.spp .seg button{flex:1;padding:5px 0;border-radius:8px;border:1px solid rgba(255,255,255,.09);
	font-size:11px;color:#8b8b99;transition:.15s}
.spp .seg button[data-on="1"]{color:#ececf1;border-color:rgba(167,139,250,.55);background:rgba(139,92,246,.18)}
.spp .sw{display:flex;align-items:center;gap:8px;justify-content:space-between;
	padding:6px 9px;border-radius:9px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.03)}
.spp .sw span{font-size:11.5px}
.spp .sw button{width:36px;height:20px;box-sizing:border-box;border-radius:99px;border:1px solid rgba(255,255,255,.14);
	background:rgba(255,255,255,.08);position:relative;padding:0;cursor:pointer;transition:background .18s,border-color .18s}
.spp .sw button i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:99px;background:#6b6b78;transition:left .18s,background .18s}
.spp .sw button[data-on="1"]{background:linear-gradient(135deg,rgba(139,92,246,.55),rgba(34,211,238,.45));
	border-color:rgba(167,139,250,.55)}
.spp .sw button[data-on="1"] i{left:18px;background:#ececf1}
.spp .two{display:flex;gap:8px}
.spp .two > div{flex:1}
.spp .foot{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:9px;
	border-top:1px solid rgba(255,255,255,.07)}
.spp .save{padding:5px 13px;border-radius:9px;font-size:11.5px;font-weight:600;
	background:linear-gradient(135deg,#8b5cf6,#22d3ee);color:#08080c}
.spp .save[disabled]{opacity:.5}
.spp .note{font-size:10.5px;color:#8b8b99;margin-left:auto}
.spp .note[data-bad="1"]{color:#f87171}
.spp .list{margin-top:11px}
.spp .list h2{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#8b8b99;margin:0 0 6px}
.spp .deb{display:flex;align-items:baseline;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:11px}
.spp .deb b{font-variant-numeric:tabular-nums;color:#c4b5fd;flex:none}
.spp .deb em{font-style:normal;color:#8b8b99;flex:none}
.spp .deb span{color:#a8a8b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spp .empty{font-size:11px;color:#8b8b99}
`;

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

			const load = () => {
				fetch("/spar-models", { cache: "no-store" })
					.then((response) => (response.ok ? response.json() : null))
					.then((value) => {
						if (value !== null) setCatalog({ providers: value.providers ?? [], models: value.models ?? [] });
					})
					.catch(() => {});
				fetch("/spar-settings", { cache: "no-store" })
					.then((response) => (response.ok ? response.json() : null))
					.then((value) => {
						if (value === null) {
							setBad(true);
							setNote("маршрут настроек не отвечает");
							return;
						}
						setState(value);
						setDraft({ ...(value.effective ?? {}), ...(value.saved ?? {}) });
					})
					.catch(() => {
						setBad(true);
						setNote("маршрут настроек не отвечает");
					});
			};

			React.useEffect(() => {
				if (open) load();
			}, [open]);

			const set = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));

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
						if (value === null) throw new Error("rejected");
						setState((previous) => ({ ...(previous ?? {}), saved: value.saved, effective: value.effective }));
						setNote("сохранено · применится к следующему ходу");
					})
					.catch(() => {
						setBad(true);
						setNote("не сохранилось");
					})
					.finally(() => setBusy(false));
			};

			const models = Array.isArray(catalog.models) ? catalog.models : [];
			const effective = state?.effective ?? {};
			const debates = Array.isArray(state?.debates) ? state.debates : [];

			if (!open) {
				return jsx("div", {
					className: "spp",
					children: jsxs("button", {
						type: "button",
						className: "pill",
						onClick: () => setOpen(true),
						title: "спарринг: модели и настройки",
						children: [
							jsx("span", { className: "mark", children: "◈" }),
							jsxs("div", {
								children: [
									jsx("b", { children: "spar" }),
									jsxs("div", {
										className: "dots",
										children: [
											jsx("i", { className: debates.some((row) => row.closed !== true) ? "on" : "" }),
											jsx("i", { className: debates.length > 2 ? "on" : "" }),
										],
									}),
								],
							}),
						],
					}),
				});
			}

			return jsx("div", {
				className: "spp",
				children: jsx("div", {
					className: "panel",
					children: jsxs("div", {
						className: "inner",
						children: [
							jsxs("div", {
								className: "head",
								children: [
									jsx("span", { className: "mark", children: "◈" }),
									jsx("h1", { children: "спарринг" }),
									jsx("span", { className: "chip", children: "spar" }),
									jsx("button", { className: "x", onClick: () => setOpen(false), children: "×" }),
								],
							}),
							jsxs("div", {
								className: "scroll",
								children: [
									jsx("div", {
										className: "row",
										children: [
											jsx("label", { children: "оппонент" }),
											jsx("select", {
												value: draft.opponent ?? "",
												onChange: (event) => set("opponent", event.target.value),
												children: modelOptions(
													models,
													true,
													`как в профиле · ${effective.opponent ?? "—"}`.replace("как в профиле · —", "не выбран — выбери модель"),
													draft.opponent ?? "",
												),
											}),
										],
									}),
									jsx("div", {
										className: "row",
										children: [
											jsx("label", { children: "судья" }),
											jsx("select", {
												value: draft.judge ?? "",
												onChange: (event) => set("judge", event.target.value),
												children: [
													jsx("option", {
														value: "",
														children: effective.judge ? `как в профиле · ${effective.judge}` : "не выбран — выбери судью",
														key: "auto",
													}),
													jsx("option", { value: "self", children: "я сам (моя модель)", key: "self" }),
													...modelOptions(models, false, "", draft.judge ?? ""),
												],
											}),
										],
									}),
									jsx("div", {
										className: "row",
										children: [
											jsx("label", { children: "вторая сторона дуэли" }),
											jsx("select", {
												value: draft.challenger ?? "",
												onChange: (event) => set("challenger", event.target.value),
												children: modelOptions(
													models,
													true,
													`как в профиле · ${effective.challenger ?? "—"}`.replace("как в профиле · —", "не выбран"),
													draft.challenger ?? "",
												),
											}),
										],
									}),
									jsxs("div", {
										className: "row",
										children: [
											jsx("label", { children: "язык спора" }),
											jsxs("div", {
												className: "seg",
												children: [
													jsx("button", {
														"data-on": (draft.language ?? effective.language) === "ru" ? "1" : "0",
														onClick: () => set("language", "ru"),
														children: "русский",
													}),
													jsx("button", {
														"data-on": (draft.language ?? effective.language) === "en" ? "1" : "0",
														onClick: () => set("language", "en"),
														children: "english",
													}),
												],
											}),
										],
									}),
									jsx("div", {
										className: "row",
										children: jsxs("div", {
											className: "sw",
											children: [
												jsx("span", { children: "читает проект" }),
												jsx("button", {
													"data-on": (draft.tools ?? effective.tools) === false ? "0" : "1",
													onClick: () => set("tools", !(draft.tools ?? effective.tools)),
													children: jsx("i", {}),
												}),
											],
										}),
									}),
									jsxs("div", {
										className: "two",
										children: [
											jsx("div", {
												className: "row",
												children: [
													jsx("label", { children: "чтений на ход" }),
													jsx("input", {
														type: "number",
														min: 0,
														max: 8,
														value: draft.maxToolRounds ?? "",
														onChange: (event) => set("maxToolRounds", event.target.value),
													}),
												],
											}),
											jsx("div", {
												className: "row",
												children: [
													jsx("label", { children: "лимит ответа" }),
													jsx("input", {
														type: "number",
														min: 0,
														step: 1024,
														value: draft.maxReplyTokens ?? "",
														onChange: (event) => set("maxReplyTokens", event.target.value),
													}),
												],
											}),
										],
									}),
									jsx("div", {
										className: "row",
										children: [
											jsx("label", { children: "лимит приговора" }),
											jsx("input", {
												type: "number",
												min: 0,
												step: 1024,
												value: draft.judgeTokens ?? "",
												onChange: (event) => set("judgeTokens", event.target.value),
											}),
										],
									}),
									jsxs("div", {
										className: "two",
										children: [
											jsx("div", {
												className: "row",
												children: [
													jsx("label", { children: "темп оппонента" }),
													jsx("select", {
														value: draft.temperatureOpponent ?? effective.temperature ?? "",
														onChange: (event) => set("temperatureOpponent", event.target.value),
														children: ["", 0.2, 0.5, 0.8, 1, 1.2].map((value) =>
															jsx(
																"option",
																{
																	key: String(value),
																	value: String(value),
																	children: value === "" ? "по профилю" : String(value),
																},
																`opt-${value}`,
															),
														),
													}),
												],
											}),
											jsx("div", {
												className: "row",
												children: [
													jsx("label", { children: "темп судьи" }),
													jsx("select", {
														value: draft.temperatureJudge ?? effective.judgeTemperature ?? "",
														onChange: (event) => set("temperatureJudge", event.target.value),
														children: ["", 0, 0.15, 0.25, 0.5].map((value) =>
															jsx(
																"option",
																{
																	key: String(value),
																	value: String(value),
																	children: value === "" ? "по профилю" : String(value),
																},
																`jopt-${value}`,
															),
														),
													}),
												],
											}),
										],
									}),
									jsxs("div", {
										className: "list",
										children: [
											jsx("h2", { children: `споры · ${debates.length}` }),
											debates.length === 0
												? jsx("div", { className: "empty", children: "пока пусто" })
												: debates.map((row) =>
														jsxs(
															"div",
															{
																className: "deb",
																key: row.id,
																children: [
																	jsx("b", { children: row.id }),
																	jsx("em", { children: row.verdict ? "приговор" : `${row.turns} ход.` }),
																	jsx("span", { children: row.topic }),
																],
															},
														),
													),
										],
									}),
								],
							}),
							jsxs("div", {
								className: "foot",
								children: [
									jsx("button", {
										className: "save",
										disabled: busy,
										onClick: save,
										children: busy ? "…" : "сохранить",
									}),
									jsx("button", {
										onClick: load,
										className: "empty",
										children: "обновить",
									}),
									jsx("span", { className: "note", "data-bad": bad ? "1" : "0", children: note }),
								],
							}),
						],
					}),
				}),
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