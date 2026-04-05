export type PrivacyConsentMode = "soft_gate";

export type PrivacyDataCategory =
  | "identity"
  | "memory"
  | "social_graph"
  | "telemetry"
  | "tool_inputs";

export type PrivacyRedactionLevel = "none" | "partial" | "strict";

export type PrivacyConsentStatus = "accepted" | "rejected" | "unset";

export interface PrivacyCategoryRule {
  /** Whether explicit consent is required for this category. */
  required?: boolean | undefined;
  /** Retention period in days for category data. */
  retentionDays?: number | undefined;
  /** Redaction policy for logs/reporting outputs. */
  redactionLevel?: PrivacyRedactionLevel | undefined;
  /** Whether users can export this category in DSAR flows. */
  allowExport?: boolean | undefined;
  /** Whether sensitive tools can operate on this category. */
  allowToolUse?: boolean | undefined;
}

export interface WorldPrivacyConfig {
  /**
   * Regulatory profile identifier chosen by integrators.
   * Examples: "gdpr", "ccpa", "custom-enterprise".
   */
  regulatoryProfile: string;
  /** Policy version used for consent/audit traceability. */
  policyVersion?: string | undefined;
  /** Consent mode currently supported by the runtime. */
  consentMode: PrivacyConsentMode;
  /** Optional default rule for all categories. */
  defaults?: PrivacyCategoryRule | undefined;
  /** Category-specific rules overriding defaults. */
  categories?: Partial<Record<PrivacyDataCategory, PrivacyCategoryRule>> | undefined;
  /**
   * Optional per-world overrides, useful in multi-world deployments.
   * Keys are worldIds.
   */
  worldOverrides?: Record<
    string,
    {
      policyVersion?: string | undefined;
      defaults?: PrivacyCategoryRule | undefined;
      categories?: Partial<Record<PrivacyDataCategory, PrivacyCategoryRule>> | undefined;
    }
  > | undefined;
}

export interface TokenPriceConfig {
  /** Currency code for reporting only. */
  currency?: string | undefined;
  /** Input token price per 1K tokens. */
  inputPer1k?: number | undefined;
  /** Output token price per 1K tokens. */
  outputPer1k?: number | undefined;
}

export interface CostLatencyAlertConfig {
  maxAvgLatencyMs?: number | undefined;
  maxLifetimeTokens?: number | undefined;
  maxEstimatedCost?: number | undefined;
}

export interface ObservabilityConfig {
  /** Optional pricing model used for cost estimation in reports and APIs. */
  pricing?: TokenPriceConfig | undefined;
  /** Optional alert thresholds for cost/latency outliers. */
  alerts?: CostLatencyAlertConfig | undefined;
}
