/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Skill Discovery System: Inspired by OpenClaw.
 * Generates an XML payload of <available_skills> for injection into the
 * initial system prompt. This allows the AI agent to know what specialized
 * native tools (like rust-native-scanner) are available without loading
 * their full instruction sets into the context window up front.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface SkillMetadata {
	name: string;
	description: string;
	location: string;
}

export class SkillDiscoverer {
	/**
	 * Scans predefined directories for SKILL.md files.
	 */
	public static discoverSkills(workspacePath: string): SkillMetadata[] {
		const skills: SkillMetadata[] = [];
		const searchPaths = [
			join(workspacePath, ".gemini", "skills"),
			join(workspacePath, "packages", "bxc-extension", "skills"),
			join(workspacePath, "skills"),
		];

		for (const path of searchPaths) {
			if (!existsSync(path)) continue;

			try {
				const entries = readdirSync(path, { withFileTypes: true });
				for (const entry of entries) {
					if (entry.isDirectory()) {
						const skillMdPath = join(path, entry.name, "SKILL.md");
						if (existsSync(skillMdPath)) {
							const meta = this.parseSkillFrontmatter(skillMdPath);
							if (meta) {
								skills.push({ ...meta, location: skillMdPath });
							}
						}
					}
				}
			} catch (error) {
				console.error(`Failed to read skills directory ${path}:`, error);
			}
		}

		return skills;
	}

	/**
	 * Formats discovered skills into an XML block optimized for LLM context ingestion.
	 */
	public static formatSkillsForPrompt(skills: SkillMetadata[]): string {
		if (skills.length === 0) return "";

		let xml = "<available_skills>\n";
		for (const skill of skills) {
			xml += `  <skill>\n`;
			xml += `    <name>${skill.name}</name>\n`;
			xml += `    <description>${skill.description}</description>\n`;
			xml += `    <location>${skill.location}</location>\n`;
			xml += `  </skill>\n`;
		}
		xml += "</available_skills>\n";

		xml +=
			"\nTo activate a skill and read its detailed instructions, use the `activate_skill` tool and provide the name of the skill.\n";

		return xml;
	}

	/**
	 * Extremely basic frontmatter parser for SKILL.md.
	 */
	private static parseSkillFrontmatter(
		filePath: string,
	): { name: string; description: string } | null {
		try {
			const content = readFileSync(filePath, "utf-8");
			const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
			if (!frontmatterMatch) return null;

			const lines = frontmatterMatch[1].split("\n");
			let name = "unknown";
			let description = "";
			let isDesc = false;

			for (const line of lines) {
				if (line.startsWith("name:")) {
					name = line.replace("name:", "").trim();
					isDesc = false;
				} else if (line.startsWith("description:")) {
					description = line.replace("description:", "").trim();
					isDesc = true;
				} else if (isDesc && line.trim() !== "") {
					description += " " + line.trim();
				}
			}

			return { name, description };
		} catch {
			return null;
		}
	}
}
