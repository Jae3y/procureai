import { z } from "zod";
import { EVIDENCE_NOTE_MAX } from "@/lib/domain/evidence";

/** A note plus an optional photo, sent as base64 (the browser shrinks it first; the domain caps it at 700 KB). */
export const EvidenceBody = z.object({
  note: z.string().min(1).max(EVIDENCE_NOTE_MAX * 2),
  photo: z
    .object({ type: z.string().max(40), base64: z.string().min(1).max(1_000_000) })
    .nullish(),
});
export type EvidenceBodyT = z.output<typeof EvidenceBody>;
