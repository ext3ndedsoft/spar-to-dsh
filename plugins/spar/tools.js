/**
 * Read-only repository tools for the debaters.
 *
 * The point is that an opponent reads the project itself instead of accepting
 * the caller's paraphrase of it: the caller passes a root and a question, and
 * the model fetches the evidence. Everything here is bounded — the corpus, the
 * bytes, and the time — because a debate turn that wanders through the repo is
 * worse than one that admits it does not know.
 *
 * Nothing in this module writes, executes, or leaves the root: paths are jailed
 * to the root, secrets are denied by name, and `git` only runs a fixed
 * subcommand set through execFile (never a shell string).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

/** Paths that are never evidence: credentials, keys, and the git config. */
const DENIED = [
	/(^|[\\/])\.env(\..*)?$/i,
	/(^|[\\/])\.git[\\/]config$/i,
	/(^|[\\/])(id_rsa|id_ed25519|id_ecdsa)(\.pub)?$/i,
	/(^|[\\/])[^\\/]*\.(pem|key|p12|pfx|jks|keystore)$/i,
	/(^|[\\/])(secrets?|credentials?|tokens?)(\.[a-z0-9]+)?$/i,
	/(^|[\\/])\.ssh([\\/]|$)/i,
	/(^|[\\/])\.aws([\\/]|$)/i,
	/(^|[\\/])\.npmrc$/i,
];

/** Directories that are noise in a repository walk. */
const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"target",
	"out",
	".next",
	".nuxt",
	".venv",
	"venv",
	"__pycache__",
	".turbo",
	".cache",
	"coverage",
	"vendor",
]);

const MAX_READ_LINES = 20000;
const MAX_READ_BYTES = 256 * 1024;
const MAX_GREP_MATCHES = 140;
const MAX_GREP_BYTES = 24 * 1024;
const MAX_GLOB_RESULTS = 400;
const MAX_GIT_BYTES = 32 * 1024;
const MAX_WALK_FILES = 8000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Tools sent to the model, in the `llm` layer's schema shape. */
export const TOOL_SCHEMAS = [
	{
		name: "read",
		description:
			"Read a slice of one file from the debate's repository, or list a directory when the path is a folder. Prefer a specific range around the code you are arguing about, or pass `whole` when the claim is about the file as a whole — arguing from one slice of a long file is how a confident wrong answer happens. Returns numbered lines and the range it covered out of the total.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Repository-relative path." },
				offset: { type: "number", description: "First line, 1-based. Defaults to 1." },
				limit: { type: "number", description: `How many lines, up to ${MAX_READ_LINES}. Defaults to 200.` },
				whole: {
					type: "boolean",
					description: `Read as much of the file as the ${Math.round(MAX_READ_BYTES / 1024)} KB ceiling allows, from the top. Use it when you need the whole file, not a slice.`,
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
	{
		name: "grep",
		description:
			"Search file contents with a JavaScript regular expression. Use it to find where something is defined or whether a claim about the code is true.",
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Regular expression, case-insensitive." },
				glob: { type: "string", description: 'Optional filename filter, for example "*.rs" or "*.ts".' },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
	},
	{
		name: "glob",
		description:
			"List paths whose name matches a glob pattern (supports *, ?, **). Directories are listed too, with a trailing slash, so an intermediate folder never looks empty.",
		parameters: {
			type: "object",
			properties: { pattern: { type: "string", description: 'For example "driver/**/*.c".' } },
			required: ["pattern"],
			additionalProperties: false,
		},
	},
	{
		name: "git",
		description:
			"Read-only git: status, diff, log, ls-files. `diff` returns the change itself; pass `stat: true` when you only want the file list with line counts.",
		parameters: {
			type: "object",
			properties: {
				sub: { type: "string", enum: ["status", "diff", "log", "ls-files"], description: "Subcommand." },
				path: { type: "string", description: "Optional pathspec for diff and log." },
				stat: { type: "boolean", description: "For `diff`: return `--stat` (names and line counts) instead of the diff body." },
			},
			required: ["sub"],
			additionalProperties: false,
		},
	},
];

/** Whether a repository-relative path is allowed to be shown to a debater. */
export function isDenied(relPath) {
	return DENIED.some((pattern) => pattern.test(relPath));
}

/**
 * Resolve `candidate` inside `root`, or throw. A debater must not be able to
 * walk out of the project with `../` or an absolute path.
 *
 * @param root - absolute directory the debate is scoped to.
 * @param candidate - model-supplied path, possibly relative.
 * @returns absolute path known to live under root.
 */
export function jailPath(root, candidate) {
	const text = typeof candidate === "string" ? candidate.trim() : "";
	if (text === "") throw new Error("path is required");
	const absolute = isAbsolute(text) ? normalize(text) : resolve(root, text);
	const rel = relative(root, absolute);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes the debate root: ${text}`);
	const portable = rel.split(sep).join("/");
	if (isDenied(portable)) throw new Error(`path is denied by policy: ${text}`);
	return { absolute, relative: portable };
}

/** Glob with `**`, `*` and `?` against a slash-separated path. */
export function globToRegExp(pattern) {
	const source = String(pattern)
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		// `**/` is any (possibly empty) run of directories, a trailing `**` is
		// everything below. Getting these two wrong makes `src/**` match nothing,
		// which reads as "the folder is empty".
		.replace(/\*\*\//g, "\u0001")
		.replace(/\*\*/g, "\u0002")
		.replace(/\*/g, "[^/]*")
		.replace(/\?/g, "[^/]")
		.replace(/\u0001/g, "(?:.*/)?")
		.replace(/\u0002/g, ".*");
	return new RegExp(`^${source}$`, "i");
}

/** Walk the root breadth-first, skipping noise and denied paths. */
function* walk(root, limit = MAX_WALK_FILES, options = {}) {
	const state = options.state;
	// A walk that stops early owes the caller that fact: a truncated listing and a
	// complete one are indistinguishable to whoever reads the result, and the next
	// sentence is usually "nothing there".
	const stop = () => {
		if (state !== undefined && state !== null) state.truncated = true;
	};
	let seen = 0;
	const queue = [""];
	while (queue.length > 0 && seen < limit) {
		const relDir = queue.shift();
		let entries;
		try {
			entries = readdirSync(join(root, relDir), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name) || isDenied(`${rel}/x`)) continue;
				queue.push(rel);
				// A tree has to show its branches: without these a directory full of
				// subdirectories looks empty and a model reports "nothing there".
				if (options.dirs === true) {
					seen += 1;
					yield `${rel}/`;
					if (seen >= limit) {
						stop();
						return;
					}
				}
				continue;
			}
			if (!entry.isFile() || isDenied(rel)) continue;
			seen += 1;
			yield rel;
			if (seen >= limit) {
				stop();
				return;
			}
		}
	}
	if (seen >= limit) stop();
}

/** Read one bounded, numbered slice of a file, or list a directory. */
function readRange(root, args) {
	const { absolute, relative: rel } = jailPath(root, args.path);
	const info = statSync(absolute);
	if (info.isDirectory()) return listDir(absolute, rel);
	if (!info.isFile()) throw new Error(`${rel} is not a file`);
	if (info.size > MAX_FILE_BYTES) throw new Error(`${rel} is ${Math.round(info.size / 1024)} KB — too large to read whole; use grep`);
	const text = readFileSync(absolute, "utf8");
	// An empty file is not a one-line file: `split` gives [""] and the header then
	// claims "lines 1-1 of 1", which reads as content where there is none.
	const lines = text === "" ? [] : text.split("\n");
	// A trailing newline is not a line: "of 3" for a two-line file misleads a model
	// that is deciding whether it has seen the whole thing.
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	const offset = Math.max(1, Math.trunc(Number(args.offset) || 1));
	// `whole` exists because arguing about one slice of a 3200-line file is how a
	// debate produces confident nonsense. The size ceiling still applies, but it is
	// measured in bytes of text, not in an arbitrary number of lines.
	const limit =
		args.whole === true ? MAX_READ_LINES : Math.min(MAX_READ_LINES, Math.max(1, Math.trunc(Number(args.limit) || 200)));
	const slice = lines.slice(offset - 1, offset - 1 + limit);
	let body = "";
	let used = 0;
	let emitted = 0;
	for (let index = 0; index < slice.length; index += 1) {
		const line = slice[index];
		if (used + line.length + 1 > MAX_READ_BYTES) {
			body += `… truncated at ${MAX_READ_BYTES} bytes\n`;
			break;
		}
		used += line.length + 1;
		emitted += 1;
		body += `${offset + index}\t${line}\n`;
	}
	const total = lines.length;
	if (total === 0) return `${rel} · empty file (0 bytes)\n`;
	// The header counts what was actually written, not what was asked for: the byte
	// ceiling can cut the body, and a range that reaches past the body is a lie the
	// reader has no way to catch.
	const last = Math.min(total, offset - 1 + emitted);
	const header =
		emitted < slice.length
			? `${rel} · lines ${offset}-${last} of ${total} (stopped at the ${Math.round(MAX_READ_BYTES / 1024)} KB ceiling — ${total - last} lines remain)`
			: `${rel} · lines ${offset}-${last} of ${total}`;
	return `${header}\n${body}`;
}

/**
 * List a directory the way `ls` would: directories first, with a trailing slash,
 * so an intermediate folder never looks empty just because it holds no files.
 */
function listDir(absolute, rel) {
	let entries;
	try {
		entries = readdirSync(absolute, { withFileTypes: true });
	} catch (error) {
		throw new Error(`${rel} cannot be listed: ${error.message}`);
	}
	const kept = entries
		.filter((entry) => !isDenied(`${rel}/${entry.name}${entry.isDirectory() ? "/x" : ""}`))
		.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
		.sort((a, b) => (a.endsWith("/") === b.endsWith("/") ? a.localeCompare(b) : a.endsWith("/") ? -1 : 1));
	if (kept.length === 0) return `${rel}/ · empty`;
	const shown = kept.slice(0, MAX_GLOB_RESULTS);
	const rest = kept.length - shown.length;
	return `${rel}/ · ${kept.length} entries\n${shown.map((name) => `  ${name}`).join("\n")}${rest > 0 ? `\n… ${rest} more` : ""}`;
}

/** Regex search over the repository, bounded by matches and bytes. */
function grepRepo(root, args) {
	const pattern = typeof args.pattern === "string" ? args.pattern : "";
	if (pattern === "") throw new Error("pattern is required");
	let regex;
	try {
		regex = new RegExp(pattern, "i");
	} catch (error) {
		throw new Error(`bad regular expression: ${error.message}`);
	}
	const fileFilter = typeof args.glob === "string" && args.glob.trim() !== "" ? globToRegExp(args.glob.trim()) : undefined;
	const matches = [];
	let bytes = 0;
	let scanned = 0;
	const walkState = {};
	for (const rel of walk(root, MAX_WALK_FILES, { state: walkState })) {
		if (fileFilter !== undefined && !fileFilter.test(rel)) continue;
		let text;
		try {
			const info = statSync(join(root, rel));
			if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
			text = readFileSync(join(root, rel), "utf8");
		} catch {
			continue;
		}
		if (text.includes("\u0000")) continue;
		scanned += 1;
		const lines = text.split("\n");
		for (let index = 0; index < lines.length; index += 1) {
			if (!regex.test(lines[index])) continue;
			const line = `${rel}:${index + 1}: ${lines[index].slice(0, 300)}`;
			if (bytes + line.length > MAX_GREP_BYTES || matches.length >= MAX_GREP_MATCHES) {
				matches.push(`… stopped after ${matches.length} matches (${scanned} files scanned)`);
				return matches.join("\n");
			}
			bytes += line.length + 1;
			matches.push(line);
		}
	}
	return matches.length === 0
		? `no match for /${pattern}/ in ${scanned} files${walkState.truncated === true ? ` (the walk stopped after ${MAX_WALK_FILES} entries — this is not a complete search)` : ""}`
		: matches.join("\n");
}

/** List paths matching a glob, directories included. */
function globRepo(root, args) {
	const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
	if (pattern === "") throw new Error("pattern is required");
	const regex = globToRegExp(pattern);
	const found = [];
	const state = {};
	for (const rel of walk(root, MAX_WALK_FILES, { dirs: true, state })) {
		// Match the bare path so `src/*` also matches the directory `src/driver/`,
		// then show it with the slash that tells a model it is a folder.
		const bare = rel.endsWith("/") ? rel.slice(0, -1) : rel;
		if (regex.test(bare)) found.push(rel);
		if (found.length >= MAX_GLOB_RESULTS) {
			state.truncated = true;
			break;
		}
	}
	const notes = [];
	if (found.length >= MAX_GLOB_RESULTS) notes.push(`! stopped at ${MAX_GLOB_RESULTS} matches — more paths may match`);
	else if (state.truncated === true) notes.push(`! the walk stopped after ${MAX_WALK_FILES} entries — this list may be incomplete`);
	if (found.length === 0) {
		return `no paths match ${pattern}${state.truncated === true ? ` (the walk stopped after ${MAX_WALK_FILES} entries — this is not a complete search)` : ""}`;
	}
	return [...found, ...notes].join("\n");
}

/** Read-only git through a fixed subcommand set. */
function gitRepo(root, args) {
	const sub = typeof args.sub === "string" ? args.sub : "";
	const pathspec = typeof args.path === "string" ? args.path.trim() : "";
	const run = (argv) =>
		execFileSync("git", argv, {
			cwd: root,
			encoding: "utf8",
			timeout: 10_000,
			maxBuffer: MAX_GIT_BYTES * 4,
			stdio: ["ignore", "pipe", "pipe"],
		});
	let output;
	if (sub === "status") output = run(["status", "--short", "--branch"]);
	else if (sub === "diff")
		// `--stat` is a summary: a model that asked for the change and got file names
		// concludes "small diff" from a line count. The full diff is the default; the
		// summary is opt-in.
		output = run(["diff", ...(args.stat === true ? ["--stat"] : []), ...(pathspec === "" ? [] : ["--", pathspec])]);
	else if (sub === "log") output = run(["log", "--oneline", "-n", "20", ...(pathspec === "" ? [] : ["--", pathspec])]);
	else if (sub === "ls-files") output = run(["ls-files"]);
	else throw new Error(`unsupported git subcommand: ${sub}`);
	if (output.trim() === "") return `git ${sub}: nothing to show`;
	return output.length > MAX_GIT_BYTES ? `${output.slice(0, MAX_GIT_BYTES)}\n… truncated` : output;
}

/**
 * Execute one tool call and return the text handed back to the model.
 *
 * @param root - absolute root the debate is scoped to.
 * @param name - tool name as requested by the model.
 * @param args - parsed arguments; malformed shapes are rejected by the caller.
 * @returns the tool message body, or an error string prefixed with `error:`.
 */
export function runTool(root, name, args) {
	try {
		if (name === "read") return readRange(root, args ?? {});
		if (name === "grep") return grepRepo(root, args ?? {});
		if (name === "glob") return globRepo(root, args ?? {});
		if (name === "git") return gitRepo(root, args ?? {});
		return `error: unknown tool ${name}`;
	} catch (error) {
		return `error: ${error?.message ?? String(error)}`;
	}
}

/** Names a debater may call; anything else is refused before execution. */
export const ALLOWED_TOOL_NAMES = new Set(TOOL_SCHEMAS.map((schema) => schema.name));