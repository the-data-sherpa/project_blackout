import {
  policyConfigSchema,
  policyResultSchema,
  type JevResponse,
  type PolicyConfig,
  type PolicyResult,
} from "@blackout/contracts";

export const defaultPolicy: PolicyConfig = {
  version: "advisory-policy/2",
  incidentProbability: 0.8,
  classificationConfidence: 0.75,
  incidentSeverity: 2,
};

export function evaluatePolicy(
  response: JevResponse | null,
  configuration: PolicyConfig = defaultPolicy,
): PolicyResult {
  const config = policyConfigSchema.parse(configuration);
  const inputs = {
    compromiseProbability: response?.answers.compromise.noul ?? null,
    classification: response?.answers.classification.choice ?? null,
    classificationConfidence:
      response?.answers.classification.confidence ?? null,
    severity: response?.answers.severity.score ?? null,
    modelAdvisory: response?.answers.response.choice ?? null,
  };
  const rules = [
    {
      id: "probability",
      expression: `compromise probability >= ${config.incidentProbability}`,
      matched:
        inputs.compromiseProbability === null
          ? null
          : inputs.compromiseProbability >= config.incidentProbability,
    },
    {
      id: "classification",
      expression: "classification == compromise",
      matched:
        inputs.classification === null
          ? null
          : inputs.classification === "compromise",
    },
    {
      id: "confidence",
      expression: `classification confidence >= ${config.classificationConfidence}`,
      matched:
        inputs.classificationConfidence === null
          ? null
          : inputs.classificationConfidence >= config.classificationConfidence,
    },
    {
      id: "severity",
      expression: `severity >= ${config.incidentSeverity} (0–3)`,
      matched:
        inputs.severity === null
          ? null
          : inputs.severity >= config.incidentSeverity,
    },
  ];
  const reviewRule = {
    id: "review-fallback",
    group: "review",
    expression:
      "classification in [suspicious, compromise] OR model advisory in [investigate, escalate]",
    matched:
      inputs.classification === null || inputs.modelAdvisory === null
        ? null
        : inputs.classification === "suspicious" ||
          inputs.classification === "compromise" ||
          inputs.modelAdvisory !== "observe",
  };
  const outcome = rules.some((rule) => rule.matched === null)
    ? "unevaluable"
    : rules.every((rule) => rule.matched)
      ? "incident_advisory"
      : reviewRule.matched
        ? "review"
        : "observe";
  return policyResultSchema.parse({
    config,
    inputs,
    rules:
      config.version === "advisory-policy/1" ? rules : [...rules, reviewRule],
    outcome,
    advisoryOnly: true,
  });
}
