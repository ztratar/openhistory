import { z } from "zod";

export const HistoryLinkSchema = z.object({
  label: z.string().trim().min(1).max(160),
  url: z.string().url().max(2_000).refine((value) => new URL(value).protocol === "https:", {
    message: "History links must use HTTPS"
  })
}).strict();

export const LinkReferencesSchema = z.array(
  z.string().regex(/^link-[1-9]\d*$/).max(32)
).max(5).describe(
  "Opaque references for at most five important candidate links. Select a reference only when its exact candidate label appears verbatim in the summary; otherwise omit it."
);
