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
	--spar-gold: #e5b83a;
	--spar-bad: var(--dsw-alias-state-error-primary, #f87171);
	position: relative;
	margin: 8px 0;
	padding: 12px 14px 13px 17px;
	border: 1px solid var(--spar-line);
	border-radius: 12px;
	background: var(--spar-surface);
	color: var(--spar-fg);
	overflow: hidden;
	transition: border-color .2s ease, background .2s ease;
}
/* The rail is the speaker: model family colour, gold for the judge, red for a failure. */
[data-spar-card]::before {
	content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
	background: var(--spar-mark, var(--spar-rail, #6b7280)); opacity: .9;
}
[data-spar-card][data-state="running"] { border-color: color-mix(in srgb, var(--spar-tint, #6b7280) 38%, var(--spar-line)); }
[data-spar-card][data-state="running"]::after {
	content: "";
	position: absolute; left: 3px; right: 0; top: 0; height: 1.5px;
	background: linear-gradient(90deg, transparent, var(--spar-tint, #6b7280), transparent);
	background-size: 40% 100%;
	background-repeat: no-repeat;
	animation: spar-sweep 1.6s ease-in-out infinite;
}
[data-spar-card][data-kind="verdict"] {
	--spar-mark: linear-gradient(180deg, #f2cc5a, #b8860b);
	border-color: color-mix(in srgb, var(--spar-gold) 34%, var(--spar-line));
	background: linear-gradient(180deg, color-mix(in srgb, var(--spar-gold) 6%, transparent), transparent 120px), var(--spar-surface);
}
[data-spar-card][data-state="error"] {
	--spar-mark: var(--spar-bad);
	border-color: color-mix(in srgb, var(--spar-bad) 36%, var(--spar-line));
	background: linear-gradient(180deg, color-mix(in srgb, var(--spar-bad) 6%, transparent), transparent 120px), var(--spar-surface);
}
[data-spar-card][data-kind="note"] { padding-top: 9px; padding-bottom: 10px; }
[data-spar-card][data-state="past"] { padding: 7px 12px 7px 15px; cursor: pointer; background: transparent; }
[data-spar-card][data-state="past"]::before { opacity: .45; }
[data-spar-card][data-state="past"]:hover, [data-spar-card][data-state="past"]:focus-visible { border-color: var(--spar-dim); outline: none; }

[data-spar-head] { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; font-size: 12px; min-width: 0; }
[data-spar-card][data-state="past"] [data-spar-head] { margin-bottom: 0; }
[data-spar-avatar] {
	flex: none; width: 24px; height: 24px; border-radius: 50%;
	display: inline-flex; align-items: center; justify-content: center;
	font-size: 11.5px; font-weight: 700; color: #07070a; letter-spacing: 0;
	background: var(--spar-mark, var(--spar-rail, #6b7280));
}
[data-spar-avatar] svg { width: 14px; height: 14px; display: block; flex: none; }
[data-spar-card][data-kind="verdict"] [data-spar-avatar] { background: linear-gradient(135deg, #f2cc5a, #c8921a); }
[data-spar-card][data-state="error"] [data-spar-avatar] { background: var(--spar-bad); }
[data-spar-who] { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
[data-spar-name] { font-weight: 600; font-size: 12.5px; color: var(--spar-fg); }
[data-spar-model] { font-size: 10.5px; color: var(--spar-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-spar-tag] {
	font-size: 10.5px; line-height: 1.5; padding: 1px 8px; border-radius: 999px; white-space: nowrap;
	color: var(--spar-dim); background: color-mix(in srgb, var(--spar-fg) 7%, transparent);
}
[data-spar-tag][data-tone="live"] { color: var(--spar-tint, #4c8dff); background: color-mix(in srgb, var(--spar-tint, #4c8dff) 15%, transparent); }
[data-spar-tag][data-tone="verdict"] { color: var(--spar-gold); background: color-mix(in srgb, var(--spar-gold) 15%, transparent); }
[data-spar-tag][data-tone="error"] { color: var(--spar-bad); background: color-mix(in srgb, var(--spar-bad) 15%, transparent); }
[data-spar-meta] { margin-left: auto; font-size: 11px; color: var(--spar-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-spar-tools] { display: inline-flex; gap: 2px; margin-left: 2px; }
[data-spar-icon] {
	appearance: none; border: 0; background: transparent; color: var(--spar-dim); opacity: .55;
	border-radius: 7px; padding: 3px 6px; font-size: 13px; line-height: 1; cursor: pointer; font-family: inherit;
	transition: opacity .15s, background .15s, color .15s;
}
[data-spar-card]:hover [data-spar-icon], [data-spar-icon]:focus-visible { opacity: 1; }
[data-spar-icon]:hover, [data-spar-icon]:focus-visible { color: var(--spar-fg); background: color-mix(in srgb, var(--spar-fg) 9%, transparent); outline: none; }

[data-spar-pair] { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
[data-spar-pair] > [data-spar-card] { margin: 0; }
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
	background: color-mix(in srgb, var(--spar-fg) 7%, transparent);
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
[data-spar-col] { min-width: 0; padding: 10px 12px; border-radius: 9px; background: color-mix(in srgb, var(--spar-fg) 4%, transparent) }
[data-spar-col] > [data-spar-head] { margin-bottom: 7px; }
@media (max-width: 720px) { [data-spar-cols] { grid-template-columns: minmax(0, 1fr); } }
@keyframes spar-sweep { 0% { background-position: -50% 0; } 100% { background-position: 150% 0; } }
@keyframes spar-pulse { 0%, 100% { opacity: .35; transform: scale(.85); } 50% { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
	[data-spar-card][data-state="running"]::after, [data-spar-dot], [data-spar-quiet]::before { animation: none; }
}
`;


		const HEADER = /^\[spar\s+([^\]]*)\]\s*\n?/;

		/** Model family from either `provider/model` or bare model id. */
		function brandOf(model) {
			const name = String(model ?? "").toLowerCase();
			if (name === "" || name === "self") return "";
			if (name.includes("gemini")) return "gemini";
			if (name.includes("claude") || name.includes("anthropic")) return "claude";
			if (name.includes("chatgpt") || name.includes("openai") || /(?:^|[^a-z0-9])(gpt|o[134]|oss)(?:$|[^a-z0-9])/.test(name)) return "openai";
			if (name.includes("deepseek")) return "deepseek";
			if (/(?:^|[^a-z0-9])(?:chat)?glm(?:$|[^a-z0-9])/.test(name) || name.includes("zhipu") || /(?:^|[^a-z0-9])z\.?ai(?:$|[^a-z0-9])/.test(name)) return "glm";
			if (name.includes("qwen") || /(?:^|[^a-z0-9])qwq(?:$|[^a-z0-9])/.test(name)) return "qwen";
			if (name.includes("kimi") || name.includes("moonshot")) return "kimi";
			if (name.includes("grok") || /(?:^|[^a-z0-9])xai(?:$|[^a-z0-9])/.test(name)) return "grok";
			if (name.includes("llama") || /(?:^|[^a-z0-9])meta(?:$|[^a-z0-9])/.test(name)) return "meta";
			if (name.includes("mistral") || name.includes("mixtral") || name.includes("codestral")) return "mistral";
			if (name.includes("minimax") || /(?:^|[^a-z0-9])abab\d*/.test(name)) return "minimax";
			if (name.includes("perplexity") || /(?:^|[^a-z0-9])sonar(?:$|[^a-z0-9])/.test(name)) return "perplexity";
			if (name.includes("cohere") || /(?:^|[^a-z0-9])command(?:$|[^a-z0-9])/.test(name)) return "cohere";
			return "";
		}

		const BRAND_STYLES = {
			gemini: { rail: "linear-gradient(180deg, #4c8dff, #a78bfa)", tint: "#6d8dff" },
			claude: { rail: "linear-gradient(180deg, #d97757, #e8a87c)", tint: "#e08a62" },
			openai: { rail: "linear-gradient(180deg, #10a37f, #5eead4)", tint: "#2bb894" },
			deepseek: { rail: "linear-gradient(180deg, #3b82f6, #22d3ee)", tint: "#38a6f0" },
			glm: { rail: "linear-gradient(180deg, #3859ff, #7c93ff)", tint: "#5574ff" },
			qwen: { rail: "linear-gradient(180deg, #6366f1, #a855f7)", tint: "#818cf8" },
			kimi: { rail: "linear-gradient(180deg, #8b5cf6, #c4b5fd)", tint: "#9d7bf5" },
			grok: { rail: "linear-gradient(180deg, #d4d4d8, #f4f4f5)", tint: "#e4e4e7" },
			meta: { rail: "linear-gradient(180deg, #0668e1, #38bdf8)", tint: "#2589f5" },
			mistral: { rail: "linear-gradient(180deg, #f97316, #facc15)", tint: "#fb923c" },
			minimax: { rail: "linear-gradient(180deg, #ec4899, #fb7185)", tint: "#f472b6" },
			perplexity: { rail: "linear-gradient(180deg, #1fb8cd, #5eead4)", tint: "#2dd4bf" },
			cohere: { rail: "linear-gradient(180deg, #39594d, #6ee7b7)", tint: "#4d9b7f" },
		};

		/* Official monochrome SVG marks (24x24 viewBox) sourced from @lobehub/icons. */
		const BRAND_PATHS = {
			gemini: [
				"M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z",
			],
			claude: [
				"M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z",
			],
			openai: [
				"M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z",
			],
			deepseek: [
				"M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z",
			],
			glm: [
				"M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z",
			],
			qwen: [
				"M19.713 2.825h-5.907c0-.251-.066-.503-.196-.728L12.819.728A1.46 1.46 0 0 0 11.559 0h-1.58c-.52 0-1 .275-1.26.728l-2.42 4.19a1.45 1.45 0 0 0 0 1.453l.791 1.37c.26.448.74.727 1.26.727h11.36c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-.79-1.37a1.46 1.46 0 0 0-1.26-.728zM.195 9.905l2.951 5.115a1.46 1.46 0 0 0-.531.531l-.791 1.37a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h4.84c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451L5.086 7.083a1.46 1.46 0 0 0-1.26-.728h-1.58c-.52 0-1 .276-1.26.728l-.79 1.37a1.45 1.45 0 0 0 0 1.452m15.888 13.367 2.951-5.115c.217.125.469.196.728.196h1.582c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-2.42-4.191a1.46 1.46 0 0 0-1.259-.728h-1.582c-.52 0-1 .276-1.259.728l-5.678 9.838a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h1.582c.52 0 1-.275 1.26-.728z",
			],
			kimi: [
				"M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z",
				"M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z",
			],
			grok: [
				"M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815",
			],
			meta: [
				"M6.897 4c1.915 0 3.516.932 5.43 3.376l.282-.373c.19-.246.383-.484.58-.71l.313-.35C14.588 4.788 15.792 4 17.225 4c1.273 0 2.469.557 3.491 1.516l.218.213c1.73 1.765 2.917 4.71 3.053 8.026l.011.392.002.25c0 1.501-.28 2.759-.818 3.7l-.14.23-.108.153c-.301.42-.664.758-1.086 1.009l-.265.142-.087.04a3.493 3.493 0 01-.302.118 4.117 4.117 0 01-1.33.208c-.524 0-.996-.067-1.438-.215-.614-.204-1.163-.56-1.726-1.116l-.227-.235c-.753-.812-1.534-1.976-2.493-3.586l-1.43-2.41-.544-.895-1.766 3.13-.343.592C7.597 19.156 6.227 20 4.356 20c-1.21 0-2.205-.42-2.936-1.182l-.168-.184c-.484-.573-.837-1.311-1.043-2.189l-.067-.32a8.69 8.69 0 01-.136-1.288L0 14.468c.002-.745.06-1.49.174-2.23l.1-.573c.298-1.53.828-2.958 1.536-4.157l.209-.34c1.177-1.83 2.789-3.053 4.615-3.16L6.897 4zm-.033 2.615l-.201.01c-.83.083-1.606.673-2.252 1.577l-.138.199-.01.018c-.67 1.017-1.185 2.378-1.456 3.845l-.004.022a12.591 12.591 0 00-.207 2.254l.002.188c.004.18.017.36.04.54l.043.291c.092.503.257.908.486 1.208l.117.137c.303.323.698.492 1.17.492 1.1 0 1.796-.676 3.696-3.641l2.175-3.4.454-.701-.139-.198C9.11 7.3 8.084 6.616 6.864 6.616zm10.196-.552l-.176.007c-.635.048-1.223.359-1.82.933l-.196.198c-.439.462-.887 1.064-1.367 1.807l.266.398c.18.274.362.56.55.858l.293.475 1.396 2.335.695 1.114c.583.926 1.03 1.6 1.408 2.082l.213.262c.282.326.529.54.777.673l.102.05c.227.1.457.138.718.138.176.002.35-.023.518-.073.338-.104.61-.32.813-.637l.095-.163.077-.162c.194-.459.29-1.06.29-1.785l-.006-.449c-.08-2.871-.938-5.372-2.2-6.798l-.176-.189c-.67-.683-1.444-1.074-2.27-1.074z",
			],
			mistral: [
				"M3.428 3.4h3.429v3.428h3.429v3.429h-.002 3.431V6.828h3.427V3.4h3.43v13.714H24v3.429H13.714v-3.428h-3.428v-3.429h-3.43v3.428h3.43v3.429H0v-3.429h3.428V3.4zm10.286 13.715h3.428v-3.429h-3.427v3.429z",
			],
			minimax: [
				"M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 01-.652.645.648.648 0 01-.652-.645V4.07a.785.785 0 00-.789-.78.785.785 0 00-.789.78v14.013a2.06 2.06 0 01-2.07 2.048 2.06 2.06 0 01-2.071-2.048V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v3.8a2.06 2.06 0 01-2.071 2.049A2.06 2.06 0 010 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 012.07-2.048 2.06 2.06 0 012.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z",
			],
			perplexity: [
				"M19.785 0v7.272H22.5V17.62h-2.935V24l-7.037-6.194v6.145h-1.091v-6.152L4.392 24v-6.465H1.5V7.188h2.884V0l7.053 6.494V.19h1.09v6.49L19.786 0zm-7.257 9.044v7.319l5.946 5.234V14.44l-5.946-5.397zm-1.099-.08l-5.946 5.398v7.235l5.946-5.234V8.965zm8.136 7.58h1.844V8.349H13.46l6.105 5.54v2.655zm-8.982-8.28H2.59v8.195h1.8v-2.576l6.192-5.62zM5.475 2.476v4.71h5.115l-5.115-4.71zm13.219 0l-5.115 4.71h5.115v-4.71z",
			],
			cohere: [
				"M8.128 14.099c.592 0 1.77-.033 3.398-.703 1.897-.781 5.672-2.2 8.395-3.656 1.905-1.018 2.74-2.366 2.74-4.18A4.56 4.56 0 0018.1 1H7.549A6.55 6.55 0 001 7.55c0 3.617 2.745 6.549 7.128 6.549z",
				"M9.912 18.61a4.387 4.387 0 012.705-4.052l3.323-1.38c3.361-1.394 7.06 1.076 7.06 4.715a5.104 5.104 0 01-5.105 5.104l-3.597-.001a4.386 4.386 0 01-4.386-4.387z",
				"M4.776 14.962A3.775 3.775 0 001 18.738v.489a3.776 3.776 0 007.551 0v-.49a3.775 3.775 0 00-3.775-3.775z",
			],
		};

		function brandSvg(brand, size = 14) {
			const paths = BRAND_PATHS[brand];
			if (paths === undefined) return null;
			return jsx("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				fill: "currentColor",
				fillRule: "evenodd",
				"aria-hidden": "true",
				children: paths.map((d, index) => jsx("path", { key: index, d, clipRule: "evenodd" })),
			});
		}

		/** Model families get their own rail colour, so a glance tells who is talking. */
		function accent(model) {
			return BRAND_STYLES[brandOf(model)]?.rail ?? "linear-gradient(180deg, #6b7280, #9ca3af)";
		}

		/** A flat colour for the same family, used for glows and live accents. */
		function tintOf(model) {
			return BRAND_STYLES[brandOf(model)]?.tint ?? "#8b93a1";
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
			if (match === null) return { utility: true, body: raw, model: "", route: "", role: "right", debate: "", tag: "служебное", ms: null, receipt: false, pending: false };
			const body = raw.slice(match[0].length).trim();
			const fields = match[1].split("·").map((part) => part.trim()).filter(Boolean);
			let debate = "";
			let model = "";
			let route = "";
			let role = "right";
			let ms = null;
			let tag = "возражение";
			let receipt = false;
			let pending = false;
			let failed = false;
			for (const field of fields) {
				if (/^d\d+$/.test(field)) debate = field;
				else if (field.includes("/")) {
					route = field;
					model = field.slice(field.lastIndexOf("/") + 1);
				} else if (field === "left") {
					role = "left";
					tag = "финальный ответ";
				} else if (field === "verdict") {
					role = "judge";
					tag = "приговор";
				} else if (field === "duel") tag = "дуэль";
				else if (field === "models") tag = "каталог";
				else if (field === "failed") {
					tag = "сбой";
					failed = true;
				} else if (/^r\d+$/.test(field)) {
					tag = role === "left" ? `раунд ${field.slice(1)} · финал` : `раунд ${field.slice(1)}`;
				} else if (/^result\b/.test(field)) {
					// A collected turn: its prose already lives in the turn's own card,
					// so this one is a receipt, not a second copy of the answer.
					receipt = true;
					const round = /^result\s+r(\d+)$/.exec(field);
					if (round !== null) tag = `раунд ${round[1]}`;
					else if (field === "result verdict") {
						role = "judge";
						tag = "приговор";
					} else if (field === "result pending") {
						tag = "ещё пишет";
						pending = true;
					}
				} else {
					const duration = /^([\d.]+)s$/.exec(field);
					if (duration !== null) ms = Number(duration[1]) * 1000;
				}
			}
			if (body.includes("[reply truncated at")) tag = `${tag} · обрезано`;
			// The model catalog carries a header but is still bookkeeping.
			return { utility: tag === "каталог", body, model, route, role, debate, tag, ms, receipt, pending, failed };
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
				const onVisible = () => {
					if (!stopped && !hiddenTab()) tick();
				};
				if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
					document.addEventListener("visibilitychange", onVisible);
				}
				return () => {
					stopped = true;
					clearTimeout(timer);
					if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
						document.removeEventListener("visibilitychange", onVisible);
					}
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
			const brand = v.phase === "verdict" || v.role === "judge" ? "" : brandOf(v.route || v.model);
			const icon = brand === "" ? null : brandSvg(brand, 14);
			return jsxs("div", {
				"data-spar-head": "",
				children: [
					jsx("span", {
						"data-spar-avatar": "",
						"data-brand": brand || undefined,
						"aria-hidden": "true",
						children: icon ?? monogram(v.role, v.phase),
					}),
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

		/** The caller's own argument, rendered as a full speaker card identical to the opponent's. */
		function LeftTurnCard({ text, route, id, round, final, opening }) {
			if (typeof text !== "string" || text.trim() === "") return null;
			const model = modelOf(route);
			const who = route || model;
			const tag =
				opening === true
					? "старт"
					: final === true
						? typeof round === "number" && round > 0
							? `раунд ${round} · финал`
							: "финальный ответ"
						: typeof round === "number" && round > 0
							? `раунд ${round}`
							: "аргумент";
			return jsxs("div", {
				"data-spar-card": "",
				"data-tool": "spar",
				"data-state": "done",
				"data-kind": "turn",
				style: { "--spar-rail": accent(who), "--spar-tint": tintOf(who) },
				children: [
					jsx(Head, {
						v: {
							name: opening === true ? "A начинает" : "A отвечает",
							role: "left",
							model,
							route: route ?? model,
							tag,
							tone: "",
							meta: id || "",
						},
						children: jsx("span", { "data-spar-tools": "", children: jsx(CopyButton, { text }) }),
					}),
					jsx(Reply, { text }),
				],
			});
		}

		function wrapPair(leftCard, rightCard) {
			if (leftCard === null || leftCard === undefined) return rightCard;
			return jsxs("div", { "data-spar-pair": "", children: [leftCard, rightCard] });
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
				children: done ? "✓" : "⧉",
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
					jsx(Steps, { steps }),
					reasoning === ""
						? null
						: jsxs("details", {
								"data-spar-reason": "",
								children: [jsx("summary", { children: "ход мысли" }), jsx("div", { children: reasoning })],
							}),
					text === "" ? null : jsx(Body, { text: smooth }),
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

		/** The `action` the agent asked for, when the call block carries its arguments; "" when unknown. */
		function actionOf(props) {
			try {
				const block = props.block ?? {};
				let args = (block.call ?? block).arguments ?? block.args ?? block.input;
				if (typeof args === "string") args = JSON.parse(args);
				return typeof args?.action === "string" ? args.action : "";
			} catch {
				return "";
			}
		}

		function Card({ props }) {
			const [expanded, setExpanded] = React.useState(false);
			const raw = props.block === undefined ? "" : rawText(props.block);
			const failed = props.block?.isError === true;
			const info = parse(props.block);
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
			const finishedResult = !running && !started && props.block !== undefined;
			const wantDurable =
				started === true ||
				(!running && !failed && !info.utility && !info.receipt && info.tag !== "дуэль" && info.debate !== "");
			const liveDone = liveKnown && live.done === true;
			const durable = useDurableTurn(props.callId, wantDurable && (!liveKnown || (finishedResult && !liveDone)));
			const debateId = (/\[spar (d\d+)/.exec(raw) ?? [])[1] ?? "";
			const newest = useNewestFor(debateId, props.callId, started);
			const superseded =
				started === true &&
				typeof props.callId === "string" &&
				newest !== null &&
				typeof newest.callId === "string" &&
				newest.callId !== props.callId;
			const working = !finishedResult && liveKnown && (!liveDone || (isDuelLive && liveBKnown && liveB.done !== true));
			const smooth = useSmoothText(live?.text ?? "", working);
			const smoothB = useSmoothText(liveB?.text ?? "", working);
			const tint = (route) => ({ "--spar-rail": accent(route), "--spar-tint": tintOf(route) });
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
							style: tint(state?.route),
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
				const leftCard =
					!verdict && typeof live.mine === "string" && live.mine.trim() !== ""
						? jsx(LeftTurnCard, { text: live.mine, route: live.leftRoute, id: live.id, round: live.leftRound, opening: live.opening === true })
						: null;
				const rightCard = frame({ state: "running", kind: verdict ? "verdict" : "turn", route: live.route }, [
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
				return wrapPair(leftCard, rightCard);
			}

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
			if (wantDurable && durable !== null && !(live !== null && live.done === true)) {
				if (durable.pending === true) {
					const err = durable.failed;
					const leftCard =
						typeof durable.mine === "string" && durable.mine.trim() !== ""
							? jsx(LeftTurnCard, { text: durable.mine, route: durable.leftRoute, id: durable.id, round: durable.leftRound, opening: durable.opening === true })
							: null;
					const rightCard = frame({ state: err ? "error" : "running", route: durable.route }, [
						jsx(Head, {
							v: {
								name: "B отвечает",
								role: "right",
								model: modelOf(durable.route),
								route: durable.route,
								tag: err ? "не ответила" : "ждёт ответа",
								tone: err ? "error" : "live",
								meta: durable.id,
							},
						}),
						err
							? jsx("div", { "data-spar-body": "", children: String(err.message ?? "ход оборвался") })
							: jsx("div", { "data-spar-quiet": "", children: "ответ ещё пишется…" }),
					]);
					return wrapPair(leftCard, rightCard);
				}
				if (durable.role === "left") {
					return jsx(LeftTurnCard, {
						text: durable.text,
						route: durable.route,
						id: durable.id,
						round: durable.round,
						final: durable.final === true,
					});
				}
				const judge = durable.role === "judge";
				const leftCard =
					!judge && typeof durable.mine === "string" && durable.mine.trim() !== ""
						? jsx(LeftTurnCard, { text: durable.mine, route: durable.leftRoute, id: durable.id, round: durable.leftRound, opening: durable.opening === true })
						: null;
				const rightCard = frame({ state: "done", kind: judge ? "verdict" : "turn", route: durable.route }, [
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
					jsx(Reply, { text: durable.text, used: durable.used, truncated: durable.truncated }),
				]);
				return wrapPair(leftCard, rightCard);
			}

			// ---- a settled registry entry ---------------------------------------
			if ((started || finishedResult) && live !== null && live.done === true) {
				const verdict = live.phase === "verdict";
				const state = live.error ? "error" : "done";
				const leftCard =
					!verdict && typeof live.mine === "string" && live.mine.trim() !== ""
						? jsx(LeftTurnCard, { text: live.mine, route: live.leftRoute, id: live.id, round: live.leftRound, opening: live.opening === true })
						: null;
				const rightCard = frame({ state, kind: verdict ? "verdict" : "turn", route: live.route }, [
					jsx(Head, {
						v: {
							name: stageName(live),
							role: live.role,
							phase: live.phase,
							model: modelOf(live.route),
							route: live.route,
							tag: live.error ? "не ответила" : verdict ? "приговор" : typeof live.round === "number" ? `раунд ${live.round}` : "возражение",
							tone: live.error ? "error" : verdict ? "verdict" : "",
							meta: `${fmtSeconds(live.ms)}${live.id === null ? "" : ` · ${live.id}`}`,
						},
						children: live.error ? null : jsx("span", { "data-spar-tools": "", children: jsx(CopyButton, { text: live.text }) }),
					}),
					live.error ? jsx("div", { "data-spar-body": "", children: live.error }) : jsx(Reply, { text: live.text, used: live.used, truncated: live.truncated }),
				]);
				return wrapPair(leftCard, rightCard);
			}

			// ---- utility results: list / show / close / models -------------------
			// Bookkeeping answers ("opened d65 …", list, show, close, the model
			// catalog) are for the agent, not the reader: the chat shows nothing for
			// them. Only a failure is worth a line, because nobody else will say it.
			if (info.utility) {
				if (!failed) {
					// A turn that has not reached the live registry yet still deserves a sign of
					// life; list / show / close / models never do.
					const quietActions = ["list", "show", "close", "models", "result"];
					if (running && !quietActions.includes(actionOf(props))) {
						return frame({ state: "running", kind: "note", route: "" }, [
							jsxs("div", {
								"data-spar-status": "",
								style: { marginTop: 0 },
								role: "status",
								children: [jsx("span", { "data-spar-dot": "" }), "готовлю ход…"],
							}),
						]);
					}
					return null;
				}
				return frame({ state: "error", kind: "note", route: "" }, [
					jsx(Head, { v: { name: "spar", role: null, model: "", tag: "сбой", tone: "error", meta: "" } }),
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
				name: failed ? "сбой" : verdictCard ? "судья" : info.role === "left" ? "A отвечает" : "B отвечает",
				role: verdictCard ? "judge" : info.role === "left" ? "left" : "right",
				model: info.model,
				route: info.route || info.model,
				tag: failed ? "не ответила" : info.tag,
				tone: failed ? "error" : verdictCard ? "verdict" : "",
				meta: [fmtSeconds(info.ms), info.debate].filter(Boolean).join(" · "),
			};
			if (receipt && !expanded) {
				return frame({ state: "done", kind: verdictCard ? "verdict" : "turn", route: info.route || info.model }, [
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
			const leftCard =
				!receipt && !verdictCard && !failed && info.role !== "left" && typeof live?.mine === "string" && live.mine.trim() !== ""
					? jsx(LeftTurnCard, { text: live.mine, route: live.leftRoute, id: info.debate || live.id, round: live.leftRound, opening: live.opening === true })
					: null;
			const rightCard = frame({ state: failed ? "error" : "done", kind: verdictCard ? "verdict" : "turn", route: info.route || info.model }, [
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
			return wrapPair(leftCard, rightCard);
		}


		/* ------------------------------------------------------------- panel ----- */

		const PANEL_STYLE_ID = "dsh-spar-panel-style";

		const PANEL_CSS = `
.spp{--p-fg:#f0f0f0;--p-dim:#8f8f8f;--p-faint:#5c5c5c;--p-line:rgba(255,255,255,.09);--p-card:rgba(255,255,255,.035);
	--p-accent:#f0f0f0;--p-accent2:#34d399;--p-gold:#e5b83a;--p-bad:#f87171;
	font:12.5px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--p-fg);
	position:fixed;right:14px;bottom:98px;z-index:60;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.spp *{box-sizing:border-box}
.spp button,.spp select,.spp input{font:inherit;color:inherit}
.spp button{background:none;border:0;cursor:pointer}
.spp :focus-visible{outline:2px solid var(--p-accent);outline-offset:2px}
@keyframes spp-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
@keyframes spp-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px) scale(.99)}}
@keyframes spp-tab{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.spp .pill{display:flex;align-items:center;gap:8px;padding:6px 13px 6px 7px;border-radius:999px;
	border:1px solid var(--p-line);background:rgba(10,10,10,.92);backdrop-filter:blur(10px);
	box-shadow:0 10px 30px rgba(0,0,0,.45);transition:transform .16s ease,border-color .16s ease}
.spp .pill:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.35)}
.spp .pill b{font-size:12px;font-weight:600;letter-spacing:.02em}
.spp .mark{width:26px;height:26px;border-radius:9px;display:grid;place-items:center;font-size:13px;font-weight:700;
	background:#f0f0f0;color:#000;flex:none}
.spp .live{width:6px;height:6px;border-radius:99px;background:var(--p-faint)}
.spp .live[data-on="1"]{background:var(--p-accent2);box-shadow:0 0 8px var(--p-accent2)}

.spp .panel{width:408px;max-width:calc(100vw - 26px);border-radius:20px;overflow:hidden;
	border:1px solid var(--p-line);background:rgba(8,8,8,.97);backdrop-filter:blur(16px);
	box-shadow:0 28px 80px rgba(0,0,0,.65);animation:spp-in .24s cubic-bezier(.2,.9,.25,1) both}
.spp .panel.closing{animation:spp-out .16s ease-in forwards}
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
.spp .side i{display:flex;align-items:center;justify-content:space-between;gap:6px;font-style:normal;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--p-dim)}
.spp .side i svg{color:var(--rail,var(--p-dim));flex:none}
.spp .side b{display:block;font-size:11.5px;font-weight:600;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spp .side em{display:block;font-style:normal;font-size:10px;color:var(--p-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spp .vs{align-self:center;font-size:9.5px;color:var(--p-faint);letter-spacing:.08em}

.spp .tabs{display:flex;gap:2px;margin:12px 14px 0;padding:3px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--p-line)}
.spp .tabs button{flex:1;padding:6px 0;border-radius:9px;font-size:11.5px;color:var(--p-dim);transition:background .15s,color .15s}
.spp .tabs button:hover{color:var(--p-fg)}
.spp .tabs button[aria-selected="true"]{background:rgba(255,255,255,.12);color:var(--p-fg);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
.spp .tabs sup{font-size:9px;margin-left:3px;color:var(--p-faint)}

.spp .body{flex:1;min-height:0;overflow:auto;padding:12px 14px 4px;animation:spp-tab .18s ease both}
.spp .body::-webkit-scrollbar{width:6px}
.spp .body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:99px}
.spp .group{padding:11px 12px 4px;margin-bottom:10px;border-radius:14px;background:var(--p-card);border:1px solid var(--p-line)}
.spp .group > h2{margin:0 0 9px;font-size:9.5px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;color:var(--p-dim)}
.spp .row{margin-bottom:10px}
.spp .row label,.spp .row .lab{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#c4c4c4;margin-bottom:4px}
.spp .row label small,.spp .row .lab small{font-size:10px;color:var(--p-faint)}
.spp select,.spp input[type=number]{width:100%;padding:8px 10px;border-radius:10px;border:1px solid var(--p-line);
	background:rgba(0,0,0,.25);outline:none;font-size:12px;transition:border-color .15s,background .15s}
.spp select:hover,.spp input:hover{border-color:rgba(255,255,255,.18)}
.spp select:focus,.spp input:focus{border-color:rgba(255,255,255,.4);background:rgba(255,255,255,.05)}
.spp option{background:#111}.spp option:disabled{color:#666}
.spp .seg{display:flex;gap:4px}
.spp .seg button{flex:1;padding:6px 4px;border-radius:9px;border:1px solid var(--p-line);background:rgba(0,0,0,.2);
	font-size:11px;color:var(--p-dim);transition:.15s;white-space:nowrap}
.spp .seg button:hover{color:var(--p-fg);border-color:rgba(255,255,255,.2)}
.spp .seg button[data-on="1"]{color:var(--p-fg);border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.12)}
.spp .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}

.spp .deb{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:9px 11px;margin-bottom:7px;border-radius:12px;
	background:var(--p-card);border:1px solid var(--p-line)}
.spp .deb b{font-variant-numeric:tabular-nums;color:var(--p-accent);font-size:11.5px}
.spp .deb em{font-style:normal;font-size:10px;color:var(--p-dim);text-align:right}
.spp .deb[data-v="1"] em{color:var(--p-gold)}
.spp .deb span{grid-column:1/-1;font-size:11.5px;color:#c4c4c4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.spp .empty{padding:22px 0;text-align:center;font-size:11.5px;color:var(--p-dim)}

.spp .foot{display:flex;align-items:center;gap:8px;padding:11px 14px 13px;border-top:1px solid var(--p-line);background:rgba(0,0,0,.18)}
.spp .save{position:relative;padding:7px 16px;border-radius:11px;font-size:12px;font-weight:650;color:#000;
	background:#f0f0f0;transition:opacity .15s,transform .15s}
.spp .save:hover:not([disabled]){transform:translateY(-1px)}
.spp .save[disabled]{opacity:.38;cursor:default}
.spp .ghost{padding:7px 10px;border-radius:10px;font-size:11.5px;color:var(--p-dim);border:1px solid var(--p-line)}
.spp .ghost:hover{color:var(--p-fg);background:rgba(255,255,255,.06)}
.spp .note{font-size:10.5px;color:var(--p-dim);margin-left:auto;text-align:right;min-width:0}
.spp .note[data-bad="1"]{color:var(--p-bad)}
.spp .note[data-dirty="1"]{color:var(--p-gold)}
.spp .warn{margin:10px 14px 0;padding:7px 10px;border-radius:10px;font-size:11px;line-height:1.4;color:var(--p-bad);background:rgba(248,113,113,.09);box-shadow:inset 0 0 0 1px rgba(248,113,113,.3)}
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
		function modelOptions(models, allowEmpty, emptyLabel, current, blocked = {}) {
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
				// A model taken by another role stays visible but cannot be picked, so the
				// panel never lets the judge double as a debater.
				const why = entry.label !== current ? blocked[entry.label] : undefined;
				rows.push(
					jsx("option", {
						value: entry.label,
						disabled: why !== undefined,
						children: why !== undefined ? `${entry.label} · ${why}` : entry.chat ? entry.label : `${entry.label} · не чат`,
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
			const [closing, setClosing] = React.useState(false);
			// The panel steps back before it unmounts: vanishing on click reads as a glitch.
			const requestClose = () => {
				if (closing) return;
				setClosing(true);
				setTimeout(() => {
					setClosing(false);
					setOpen(false);
				}, 150);
			};
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
					selfJudge: typeof draft.selfJudge === "boolean" ? draft.selfJudge : null,
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
						// A server that predates a setting silently drops its key; say so instead of
						// letting the choice vanish on the next open.
						if (typeof body.selfJudge === "boolean" && typeof value.saved?.selfJudge !== "boolean") {
							setBad(true);
							setNote("сервер не знает этой настройки · перезапусти DSH");
							return;
						}
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
			// Who holds which seat right now; the judge may not also be a debater.
			const pickedOpponent = draft.opponent || profile.opponent || "";
			const pickedChallenger = draft.challenger || profile.challenger || "";
			const pickedJudge = draft.judge === "self" ? "self" : draft.judge || profile.judge || "";
			const judgeLabel = pickedJudge !== "" && pickedJudge !== "self" ? pickedJudge : "";
			// The operator can allow the overlap on purpose; then nothing is blocked or flagged.
			const selfJudgeOn = typeof draft.selfJudge === "boolean" ? draft.selfJudge : profile.selfJudge === true;
			const clash = !selfJudgeOn && judgeLabel !== "" && (judgeLabel === pickedOpponent || judgeLabel === pickedChallenger);
			const debaterBlock = selfJudgeOn || judgeLabel === "" ? {} : { [judgeLabel]: "судья" };
			const judgeBlock = {};
			if (!selfJudgeOn && pickedOpponent !== "") judgeBlock[pickedOpponent] = "оппонент";
			if (!selfJudgeOn && pickedChallenger !== "") judgeBlock[pickedChallenger] = "вторая сторона";

			const pill = jsxs("button", {
				type: "button",
				className: "pill",
				key: "pill",
				"aria-label": open ? "Закрыть настройки спарринга" : "Открыть настройки спарринга",
				"aria-expanded": open ? "true" : "false",
				onClick: () => (open ? requestClose() : setOpen(true)),
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
								children: modelOptions(models, true, inheritLabel("оппонент", profile.opponent, catalog), draft.opponent ?? "", debaterBlock),
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
								children: modelOptions(models, true, inheritLabel("соперник", profile.challenger, catalog), draft.challenger ?? "", debaterBlock),
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
									...modelOptions(models, false, "", draft.judge ?? "", judgeBlock),
								],
							}),
						),
						field(
							"spp-f9",
							"судья может участвовать",
							"одна модель и в споре, и на суде",
							jsx("select", {
								id: "spp-f9",
								value: typeof draft.selfJudge === "boolean" ? String(draft.selfJudge) : "",
								onChange: (event) => {
									const value = event.target.value;
									set("selfJudge", value === "" ? "" : value === "true");
								},
								children: [
									jsx("option", { value: "", children: `как в профиле · ${profile.selfJudge === true ? "можно" : "нельзя"}`, key: "auto" }),
									jsx("option", { value: "true", children: "можно", key: "on" }),
									jsx("option", { value: "false", children: "нельзя", key: "off" }),
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
			const sideView = (role, value) => {
				const text = value === "self" ? "я сам" : String(value || "не выбран");
				const slash = text.lastIndexOf("/");
				const icon = brandSvg(brandOf(value), 12);
				return jsxs("div", {
					className: "side",
					style: { "--rail": tintOf(value) },
					children: [
						jsxs("i", { children: [role, icon] }),
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
					className: "panel" + (closing ? " closing" : ""),
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
									jsx("button", { type: "button", className: "x", "aria-label": "Закрыть панель", title: "Закрыть", onClick: requestClose, children: "×" }),
								],
							}),
							jsxs("div", {
								className: "match",
								children: [sideView("оппонент", pickedOpponent), jsx("span", { className: "vs", "aria-hidden": "true", children: "·" }), sideView("судья", pickedJudge)],
							}),
							clash
								? jsx("div", {
										className: "warn",
										role: "alert",
										children: "Судья и участник спора — одна модель. Такой спор не стартует: выберите другого судью или оппонента.",
									})
								: null,
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
