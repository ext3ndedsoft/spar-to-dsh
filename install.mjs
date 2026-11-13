#!/usr/bin/env node
/**
 * spar installer: one command, safe to repeat.
 *
 *   node install.mjs                 install or update
 *   node install.mjs --uninstall     remove the plugin and its profile entry
 *   node install.mjs --dry-run       show what would happen, write nothing
 *
 * Options: --profile <name>  --dsh-home <dir>  --keep (do not overwrite changed files)
 *
 * Without a clone it works too: download this one file and run it, and it fetches the
 * sources itself (git if available, otherwise the GitHub tarball + tar).
 *
 * What it does:
 *   1. finds the DSH profile (web, or the only one that exists)
 *   2. copies plugins/spar into <profile>/plugins/spar, updating changed files
 *   3. adds the plugin to <profile>/cordis.patch.yml (backup saved once as .bak)
 *   4. syntax-checks the installed files, so a broken copy fails here, not in the GUI
 *
 * Your data is never touched: transcripts and settings live in ~/.dsh/spar.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = "ext3ndedsoft/spar-to-dsh";
const PLUGIN = "spar";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

if (flag("help") || flag("h")) {
	console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n/, "").replace(/^\/\*\*\n|^ \* ?/gm, ""));
	process.exit(0);
}

const dryRun = flag("dry-run");
const keep = flag("keep");
const uninstall = flag("uninstall");
const dshHome = path.resolve(value("dsh-home", process.env.DSH_HOME || path.join(os.homedir(), ".dsh")));

const log = (message) => console.log(`${dryRun ? "would " : ""}${message}`);
const fail = (message) => {
	console.error(`error: ${message}`);
	process.exit(1);
};

if (Number(process.versions.node.split(".")[0]) < 20) fail(`Node 20 or newer is required, found ${process.version}`);

/* ------------------------------------------------------------------ profile */

function pickProfile() {
	const wanted = value("profile", null);
	const root = path.join(dshHome, "profiles");
	if (wanted) return wanted;
	if (fs.existsSync(path.join(root, "web"))) return "web";
	const found = fs.existsSync(root)
		? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
		: [];
	if (found.length === 1) return found[0];
	fail(
		found.length
			? `several DSH profiles found (${found.join(", ")}); choose one with --profile <name>`
			: `no DSH profile under ${root}; start the DSH shell once, or pass --dsh-home / --profile`,
	);
}

const profile = pickProfile();
const profileDir = path.join(dshHome, "profiles", profile);
if (!fs.existsSync(profileDir)) fail(`DSH profile not found: ${profileDir}`);
const pluginDir = path.join(profileDir, "plugins", PLUGIN);
const patchFile = path.join(profileDir, "cordis.patch.yml");
const stateDir = path.join(dshHome, PLUGIN);

/* ------------------------------------------------------------------ sources */

let cleanup = null;

function resolveSources() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	if (fs.existsSync(path.join(here, "plugins", PLUGIN))) return here;

	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spar-src-"));
	cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
	console.log("sources not found next to the installer, downloading them");

	const clone = spawnSync("git", ["clone", "--depth", "1", `https://github.com/${REPO}.git`, tmp], { stdio: "ignore" });
	if (clone.status === 0) return tmp;

	return fetchTarball(tmp);
}

function fetchTarball(tmp) {
	// Synchronous on purpose: the installer is a straight line, not a service.
	const script = `const r=await fetch(process.argv[1]);if(!r.ok)process.exit(2);require("node:fs").writeFileSync(process.argv[2],Buffer.from(await r.arrayBuffer()))`;
	const archive = path.join(tmp, "src.tar.gz");
	const get = spawnSync(process.execPath, ["--input-type=module", "-e", script.replace('require("node:fs")', "(await import('node:fs'))"), `https://codeload.github.com/${REPO}/tar.gz/refs/heads/main`, archive], { stdio: "inherit" });
	if (get.status !== 0) fail("could not download the sources; check the network or clone the repository by hand");
	const out = path.join(tmp, "repo");
	fs.mkdirSync(out);
	const untar = spawnSync("tar", ["-xzf", archive, "-C", out, "--strip-components=1"], { stdio: "inherit" });
	if (untar.status !== 0) fail("could not unpack the archive (tar is missing); clone the repository by hand");
	return out;
}

/* ------------------------------------------------------------------ copying */

function copyTree(from, to, stats = { added: 0, updated: 0, same: 0 }) {
	if (!dryRun) fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		if (entry.name === "node_modules") continue;
		const source = path.join(from, entry.name);
		const target = path.join(to, entry.name);
		if (entry.isDirectory()) {
			copyTree(source, target, stats);
			continue;
		}
		const incoming = fs.readFileSync(source);
		if (!fs.existsSync(target)) {
			stats.added += 1;
		} else if (fs.readFileSync(target).equals(incoming)) {
			stats.same += 1;
			continue;
		} else if (keep) {
			stats.same += 1;
			continue;
		} else {
			stats.updated += 1;
		}
		if (!dryRun) fs.writeFileSync(target, incoming);
	}
	return stats;
}

/* ------------------------------------------------------------ profile patch */

const ENTRY = [`    - id: ${PLUGIN}`, `      name: "./plugins/${PLUGIN}/index.js"`];
const HEADER = `# DSH profile patch.\n# Entries below were added by ${REPO.split("/")[1]}/install.mjs.\n`;
const hasEntry = (text) => new RegExp(`^\\s*-?\\s*id:\\s*${PLUGIN}\\s*$`, "m").test(text);

function backupOnce() {
	const backup = `${patchFile}.bak`;
	if (fs.existsSync(patchFile) && !fs.existsSync(backup) && !dryRun) fs.copyFileSync(patchFile, backup);
}

function addEntry() {
	const text = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, "utf8") : "";
	if (hasEntry(text)) return log(`profile already lists "${PLUGIN}"`);
	if (dryRun) return log(`add "${PLUGIN}" to ${patchFile}`);
	backupOnce();

	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text ? text.split(/\r?\n/) : [];
	const insertAt = lines.findIndex((line) => /^\s*-?\s*insert:\s*$/.test(line));
	let next;
	if (insertAt >= 0) {
		// Extend the existing list: YAML keeps only the last `insert` key, so a second one
		// would silently drop the plugins above it.
		const keyIndent = lines[insertAt].indexOf("insert");
		let end = insertAt + 1;
		while (end < lines.length) {
			const line = lines[end];
			const indent = line.length - line.trimStart().length;
			if (line.trim() && !line.trim().startsWith("#") && indent <= keyIndent) break;
			end += 1;
		}
		while (end > insertAt + 1 && !lines[end - 1].trim()) end -= 1;
		next = [...lines.slice(0, end), ...ENTRY, ...lines.slice(end)];
	} else {
		next = [...lines, ...(lines.length && lines[lines.length - 1].trim() ? [""] : []), "- insert:", ...ENTRY];
	}
	const body = next.join(eol);
	fs.writeFileSync(patchFile, text ? body : HEADER + body);
	log(`patched ${patchFile}`);
}

function removeEntry() {
	if (!fs.existsSync(patchFile)) return;
	const text = fs.readFileSync(patchFile, "utf8");
	if (!hasEntry(text)) return log(`profile does not list "${PLUGIN}"`);
	if (dryRun) return log(`remove "${PLUGIN}" from ${patchFile}`);
	backupOnce();
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const kept = [];
	for (let i = 0; i < lines.length; i += 1) {
		if (new RegExp(`^\\s*-?\\s*id:\\s*${PLUGIN}\\s*$`).test(lines[i])) {
			if (/^\s*name:/.test(lines[i + 1] || "")) i += 1;
			continue;
		}
		kept.push(lines[i]);
	}
	// An `insert:` left with nothing under it is an invalid patch; drop it too.
	const at = kept.findIndex((line) => /^\s*-?\s*insert:\s*$/.test(line));
	if (at >= 0) {
		const rest = kept.slice(at + 1);
		const stop = rest.findIndex((line) => line.trim() && !/^\s+/.test(line));
		const block = stop >= 0 ? rest.slice(0, stop) : rest;
		if (!block.some((line) => /\bid:/.test(line))) kept.splice(at, 1);
	}
	fs.writeFileSync(patchFile, kept.join(eol));
	log(`removed "${PLUGIN}" from ${patchFile}`);
}

/* ------------------------------------------------------------------- verify */

function checkSyntax(dir) {
	const broken = [];
	for (const name of fs.readdirSync(dir)) {
		if (!/\.(m?js|cjs)$/.test(name)) continue;
		const result = spawnSync(process.execPath, ["--check", path.join(dir, name)], { encoding: "utf8" });
		if (result.status !== 0) broken.push(`${name}: ${(result.stderr || "").split("\n")[0]}`);
	}
	return broken;
}

/* --------------------------------------------------------------------- main */

try {
	if (uninstall) {
		if (fs.existsSync(pluginDir)) {
			if (!dryRun) fs.rmSync(pluginDir, { recursive: true, force: true });
			log(`removed ${pluginDir}`);
		} else {
			log(`${pluginDir} is not installed`);
		}
		removeEntry();
		console.log(`\n${dryRun ? "dry run: nothing was written" : "done."} Debates and settings in ${stateDir} were left alone.`);
		console.log("restart the DSH shell to unload the plugin");
	} else {
		const root = resolveSources();
		const source = path.join(root, "plugins", PLUGIN);
		if (!fs.existsSync(source)) fail(`plugin folder not found (${source})`);

		const stats = copyTree(source, pluginDir);
		log(`plugin: ${stats.added} added, ${stats.updated} updated, ${stats.same} unchanged -> ${pluginDir}`);
		if (!dryRun) fs.mkdirSync(stateDir, { recursive: true });
		addEntry();

		if (!dryRun) {
			const broken = checkSyntax(pluginDir);
			if (broken.length) fail(`installed files do not parse:\n  ${broken.join("\n  ")}`);
			log("syntax check passed");
		}

		console.log("");
		if (dryRun) {
			console.log("dry run: nothing was written");
		} else {
			console.log(`done. profile "${profile}", plugin ${stats.added + stats.updated ? "installed" : "already up to date"}.`);
			console.log("");
			console.log("next:");
			console.log("  1. restart the DSH shell: the spar pill appears in the bottom-right corner");
			console.log("  2. open it, add a model on the Models tab, then ask the agent to debate something");
			console.log("");
			console.log("update later: run this again.   remove: node install.mjs --uninstall");
		}
	}
} finally {
	if (cleanup) cleanup();
}