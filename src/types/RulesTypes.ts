export interface RuleSet {
  version: string;
  name: string;
  description?: string | undefined;
  rules: Rule[];
  source: "json" | "pdf";
  loadedAt: Date;
}

export interface Rule {
  id: string;
  priority: number;
  scope: "world" | "control" | "person" | "all";
  condition?: string | undefined;
  instruction: string;
  enforcement: "hard" | "soft";
}

export interface RulesContext {
  ruleSets: RuleSet[];
  getRulesForScope(scope: Rule["scope"]): Rule[];
  getRuleById(id: string): Rule | undefined;
}
