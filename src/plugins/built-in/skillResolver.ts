import { LifeSkillsPlugin, type SkillCategory } from "./LifeSkillsPlugin.js";

const UNIVERSAL_SKILLS: SkillCategory[] = ["movement", "social", "physical"];

const SKILL_ALIASES: Record<string, SkillCategory> = {
  agricoltura: "farming",
  contadino: "farming",
  informatica: "technology",
  programmazione: "technology",
  spirituale: "spiritual",
  religione: "spiritual",
  accademico: "academic",
  studio: "academic",
  ricerca: "academic",
  cucina: "cooking",
  artigianato: "crafting",
  // English pass-through
  farming: "farming",
  technology: "technology",
  spiritual: "spiritual",
  academic: "academic",
  cooking: "cooking",
  crafting: "crafting",
};

function isSkillCategory(s: string): s is SkillCategory {
  return [
    "movement",
    "social",
    "physical",
    "farming",
    "technology",
    "spiritual",
    "academic",
    "cooking",
    "crafting",
  ].includes(s);
}

export function resolveToolNames(skills: string[]): string[] {
  const categories = new Set<SkillCategory>(UNIVERSAL_SKILLS);
  for (const s of skills) {
    if (isSkillCategory(s)) {
      categories.add(s);
      continue;
    }
    const mapped = SKILL_ALIASES[s.toLowerCase()];
    if (mapped) categories.add(mapped);
  }
  return LifeSkillsPlugin.getToolNamesForSkills([...categories]);
}
