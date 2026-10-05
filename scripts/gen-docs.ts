// Writes docs/API.md from the help content served at /api/help.
// Usage: node scripts/gen-docs.ts [base-url]
import { writeFileSync } from "node:fs";
import { TOPICS, helpIndex, helpTopic } from "../src/help.ts";

const base = process.argv[2] ?? "https://YOUR-DASHBOARD-URL";
const fence = "```";
const sections = Object.keys(TOPICS).map(
	(name) => `## ${name}\n\n${fence}text\n${helpTopic(name, base)}${fence}\n`,
);
writeFileSync(
	new URL("../docs/API.md", import.meta.url),
	`# Agent Dashboard API\n\nGenerated from src/help.ts by scripts/gen-docs.ts. Do not edit by hand.\n\n${fence}text\n${helpIndex(base)}${fence}\n\n${sections.join("\n")}`,
);
