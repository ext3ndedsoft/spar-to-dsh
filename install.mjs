#!/usr/bin/env node
/**
 * Installs the spar plugin into a DSH profile in one step.
 *
 * The manual route is "copy a folder and hand-edit a YAML file", which is fine once
 * and annoying to describe to anyone else. This does the same thing:
 *
 *   node install.mjs
 *
 * Layout it produces:
 *   ~/.dsh/profiles/web/plugins/spar/        index.js, client.js, tools.js, live.js, settings.js
 *   ~/.dsh/profiles/web/cordis.patch.yml     one `insert` entry, appended if absent
 *   ~/.dsh/spar/                             created, holds transcripts and settings.json
 *
 * Safe to run twice: existing files are kept (`--force` overwrites), and the plugin
 * entry is recognised instead of added again.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const dryRun = flag("dry-run");
const force = flag("force");
const pluginId = "spar";

const dshHome = path.resolve(value("dsh-home", process.env.DSH_HOME || path.join(os.homedir(), ".dsh")));
const profile = value("profile", "web");
const profileDir = path.join(dshHome, "profiles", profile);
const stateDir = path.join(dshHome, pluginId);

const log = (message) => console.log(`${dryRun ? "would " : ""}${message}`);
const fail = (message) => {
	console.error(`error: ${message}`);
	process.exit(1);
};

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) fail(`Node 20 or newer is required, found ${process.version}`);

const pluginSrc = path.join(repo, "plugins", pluginId);
if (!fs.existsSync(pluginSrc)) fail(`plugin folder not found (${pluginSrc})`);

if (!fs.existsSync(profileDir)) {
	fail(
		`DSH profile not found: ${profileDir}\n` +
			"       start the DSH shell once, or pass --dsh-home / --profile",
	);
}

function copyTree(from, to, { skip = [] } = {}) {
	if (dryRun) {
		log(`copy ${path.relative(repo, from) || from} -> ${to}`);
		return 0;
	}
	let copied = 0;
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		if (skip.includes(entry.name)) continue;
		const source = path.join(from, entry.name);
		const target = path.join(to, entry.name);
		if (entry.isDirectory()) {
			copied += copyTree(source, target, { skip });
			continue;
		}
		// A user's edited copy stays theirs unless --force is passed.
		if (fs.existsSync(target) && !force) continue;
		fs.copyFileSync(source, target);
		copied += 1;
	}
	return copied;
}

const target = path.join(profileDir, "plugins", pluginId);
const count = copyTree(pluginSrc, target);
log(`plugin: ${count} file(s) -> ${target}`);

if (!dryRun) {
	fs.mkdirSync(stateDir, { recursive: true });
	log(`state: ${stateDir}`);
}

/* ------------------------------------------------------------ profile patch */

const patchFile = path.join(profileDir, "cordis.patch.yml");
const ENTRY = [`    - id: ${pluginId}`, `      name: "./plugins/${pluginId}/index.js"`];

const HEADER = `# DSH profile patch.
# The entry below was appended by spar-to-dsh/install.mjs.
`;

function patchProfile() {
	if (dryRun) {
		log(`add "${pluginId}" to ${patchFile}`);
		return;
	}

	const text = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, "utf8") : "";
	if (new RegExp(`^\\s*-?\\s*id:\\s*${pluginId}\\s*$`, "m").test(text)) {
		log(`profile already lists "${pluginId}", leaving it alone`);
		return;
	}

	const lines = text ? text.split("\n") : [];
	const insertAt = lines.findIndex((line) => /^\s*-?\s*insert:\s*$/.test(line));

	let next;
	if (insertAt >= 0) {
		// Append to the existing list instead of opening a second `insert` key: YAML keeps
		// only the last one, and silently dropping plugins is worse than a bad error.
		const keyIndent = lines[insertAt].indexOf("insert");
		let end = insertAt + 1;
		while (end < lines.length) {
			const line = lines[end];
			const indent = line.length - line.trimStart().length;
			if (line.trim() && !line.trim().startsWith("#") && indent <= keyIndent) break;
			end += 1;
		}
		next = [...lines.slice(0, end), ...ENTRY, ...lines.slice(end)];
	} else {
		const block = ["- insert:", ...ENTRY];
		next = [...lines, ...(lines.length && lines[lines.length - 1].trim() ? [""] : []), ...block];
	}

	const body = next.join("\n");
	fs.writeFileSync(patchFile, text ? body : HEADER + body);
	log(`patched ${patchFile}`);
}

patchProfile();

/* ------------------------------------------------------------------- report */

console.log("");
if (dryRun) {
	console.log("dry run: nothing was written");
} else {
	console.log("done.");
	console.log(`  plugin   ${target}`);
	console.log(`  state    ${stateDir}`);
	console.log("");
	console.log("next:");
	console.log("  1. restart the DSH shell — the ◈ pill appears in the bottom-right corner");
	console.log('  2. run `node test.mjs` next to the plugin if you want the offline suite');
	console.log("  3. inside the shell, ask the agent to debate something:");
	console.log('     "spar open <topic>" — the opponent reads the project itself');
	console.log("");
	console.log("full walkthrough: docs/install.md");
}