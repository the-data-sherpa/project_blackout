import { z } from "zod";

export const investigationConfigSchema = z.strictObject({
  version: z.literal("investigation-policy/1"),
  trigger: z.literal("incident_advisory"),
  consecutiveDecisions: z.literal(1),
  resolution: z.literal("operator-only"),
  afterClosure: z.literal("reopen-on-next-matching-decision"),
});

export const investigationActionSchema = z.strictObject({
  commandId: z.uuid(),
  type: z.enum(["acknowledge", "close"]),
  expectedSequence: z.number().int().positive(),
});

export const investigationEventSchema = z
  .strictObject({
    runId: z.uuid(),
    sequence: z.number().int().positive(),
    runRevision: z.number().int().nonnegative(),
    simulationTimeMs: z.number().int().nonnegative(),
    recordedAt: z.iso.datetime(),
    version: z.literal("investigation-policy/1"),
    type: z.enum(["opened", "acknowledged", "closed", "reopened"]),
    actor: z.enum(["advisory-policy", "local-operator"]),
    attemptId: z.uuid().nullable(),
    snapshotId: z.string().min(1).nullable(),
    request: investigationActionSchema.nullable(),
  })
  .superRefine((event, context) => {
    const automatic = event.type === "opened" || event.type === "reopened";
    if (
      automatic
        ? event.actor !== "advisory-policy" ||
          !event.attemptId ||
          !event.snapshotId ||
          event.request !== null
        : event.actor !== "local-operator" ||
          event.attemptId !== null ||
          event.snapshotId !== null ||
          !event.request ||
          event.request.type !==
            (event.type === "closed" ? "close" : "acknowledge") ||
          event.request.expectedSequence !== event.sequence - 1
    )
      context.addIssue({
        code: "custom",
        message: "Investigation provenance must match its transition",
      });
  });

export type InvestigationConfig = z.infer<typeof investigationConfigSchema>;
export type InvestigationAction = z.infer<typeof investigationActionSchema>;
export type InvestigationEvent = z.infer<typeof investigationEventSchema>;

export function investigationStatus(history: InvestigationEvent[]) {
  const last = history.at(-1);
  if (!last) return "none";
  if (last.type === "closed") return "closed";
  if (last.type === "acknowledged") return "acknowledged";
  return "open";
}
