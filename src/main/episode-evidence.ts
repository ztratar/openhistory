import type { ActivityEpisode, ActivityEvent, SemanticElement } from "@shared/contracts";

export interface EpisodeEvidenceWorkUnit {
  application?: string;
  surface?: string;
  materiality: "high" | "medium";
  claimCeiling: "navigation_only" | "literal_interaction" | "draft_or_revision" | "submitted_action" | "demonstrated_result";
  safeLeadVerbs: string[];
  demonstratedOutcomes: string[];
  submissionActions: string[];
  contentChanges: string[];
  interactions: string[];
  navigation: string[];
  documents: string[];
}

export interface EpisodeEvidencePacket {
  calibration: {
    durationSeconds: number;
    mode: "context_only" | "sparse_literal" | "standard";
    directActionCount: number;
    navigationCount: number;
    contentChangeCount: number;
  };
  workUnits: EpisodeEvidenceWorkUnit[];
  evidenceBoundaries: string[];
  ambientContext: string[];
}

interface MutableWorkUnit {
  application?: string;
  surface?: string;
  contentChanges: string[];
  interactions: string[];
  navigation: string[];
  documents: string[];
  demonstratedOutcomes: string[];
  submissionActions: string[];
  priorityScore: number;
}

export function buildEpisodeEvidencePacket(episode: ActivityEpisode): EpisodeEvidencePacket {
  const units = new Map<string, MutableWorkUnit>();
  const ambientContext: string[] = [];
  let directActionCount = 0;
  let navigationCount = 0;
  let contentChangeCount = 0;
  let observedEditedText = false;
  let observedCommitControl = false;
  let observedSubmissionAction = false;

  for (const event of episode.events) {
    const strength = evidenceStrength(event);
    if (strength === "direct_action") directActionCount += 1;
    if (strength === "navigation") navigationCount += 1;
    const contentChange = event.kind === "text_input" || event.kind === "document_changed";
    if (contentChange) contentChangeCount += 1;

    if (strength === "context") {
      const context = ambientDescription(event);
      if (context) pushUnique(ambientContext, context, 8);
      continue;
    }
    if (strength !== "direct_action" && strength !== "navigation") continue;

    const application = event.application?.localizedName ?? undefined;
    const surface = surfaceName(event);
    const durableObject = firstNonempty(event.document?.name, event.browser?.domain);
    const key = JSON.stringify([application ?? "", durableObject ?? ""]);
    const unit = units.get(key) ?? {
      ...(application ? { application } : {}),
      ...(surface ? { surface } : {}),
      contentChanges: [],
      interactions: [],
      navigation: [],
      documents: [],
      demonstratedOutcomes: [],
      submissionActions: [],
      priorityScore: 0
    };

    if (contentChange) {
      observedEditedText = true;
      if (isAddressOrSearchInput(event)) {
        const interaction = describeAddressOrSearchInput(event);
        if (interaction) pushUnique(unit.interactions, interaction, 4);
        unit.priorityScore += 2;
      } else {
        addContentChange(unit.contentChanges, event);
        unit.priorityScore += 80
          + Math.min(event.textChange?.deletedCharacterCount ?? 0, 1_000) / 5
          + Math.min(event.textChange?.resultingValue.length ?? 0, 2_000) / 20;
      }
    }
    if (event.kind === "pointer_click" || event.kind === "selection_changed") {
      const interaction = describeInteraction(event);
      if (interaction) {
        pushUnique(unit.interactions, interaction, 8);
        unit.priorityScore += 2;
        if (/\b(send|submit|save|apply|create|add|delete|remove|publish|post|update)\b/i.test(interaction)) {
          observedCommitControl = true;
        }
        if (/\b(send|submit|publish|post)\b/i.test(interaction)) {
          pushUnique(unit.submissionActions, interaction, 4);
          observedSubmissionAction = true;
          unit.priorityScore += 120;
        }
      }
    }
    if (strength === "navigation") {
      const navigation = describeNavigation(event);
      if (navigation) pushUnique(unit.navigation, navigation, 6);
      unit.priorityScore += 1;
      const outcome = describeDemonstratedOutcome(event);
      if (outcome) {
        pushUnique(unit.demonstratedOutcomes, outcome.description, 3);
        unit.priorityScore += 1_000;
      }
    }
    if (event.document) pushUnique(unit.documents, documentDescription(event), 4);
    units.set(key, unit);
  }

  const rankedWorkUnits = [...units.values()]
    .filter((unit) => unit.contentChanges.length || unit.interactions.length || unit.navigation.length || unit.documents.length)
    .map((unit): { unit: EpisodeEvidenceWorkUnit; priorityScore: number } => {
      const claimCeiling = unit.demonstratedOutcomes.length
        ? "demonstrated_result"
        : unit.submissionActions.length
        ? "submitted_action"
        : unit.contentChanges.length
        ? "draft_or_revision"
        : unit.interactions.length
          ? "literal_interaction"
          : "navigation_only";
      const { priorityScore, ...evidence } = unit;
      return { priorityScore, unit: {
        ...evidence,
        materiality: unit.contentChanges.length > 0 || unit.interactions.length >= 2 ? "high" : "medium",
        claimCeiling,
        safeLeadVerbs: claimCeiling === "demonstrated_result"
          ? demonstratedOutcomeVerbs(unit.demonstratedOutcomes)
          : claimCeiling === "submitted_action"
          ? submissionActionVerbs(unit.submissionActions)
          : claimCeiling === "draft_or_revision"
          ? ["Drafted", "Revised", "Specified", "Edited"]
          : claimCeiling === "literal_interaction"
            ? ["Clicked", "Selected", "Opened"]
            : ["Navigated", "Viewed", "Explored"]
      } };
    })
    .sort((left, right) => right.priorityScore - left.priorityScore);
  const workUnits = rankedWorkUnits.map(({ unit }) => unit);
  const durationSeconds = Math.max(0, Math.round((Date.parse(episode.endTime) - Date.parse(episode.startTime)) / 1_000));
  const mode = directActionCount === 0 && navigationCount === 0 && contentChangeCount === 0
    ? "context_only"
    : durationSeconds < 30 && contentChangeCount === 0
      ? "sparse_literal"
      : "standard";
  const evidenceBoundaries: string[] = [];
  if (observedEditedText && observedSubmissionAction) {
    evidenceBoundaries.push("Text was edited and an explicit submission control was clicked; this supports a user-initiated submission, not downstream delivery, processing, or success.");
  } else if (observedEditedText) {
    evidenceBoundaries.push("Text editing proves drafting or revision, not implementation, submission, or completion.");
  }
  if (observedCommitControl && !observedSubmissionAction) {
    evidenceBoundaries.push("A commit-like control was clicked; this proves the interaction, not downstream success or verification.");
  }
  if (!workUnits.length) {
    evidenceBoundaries.push("No direct work action or navigation was observed; do not infer intentional engagement.");
  }

  return {
    calibration: { durationSeconds, mode, directActionCount, navigationCount, contentChangeCount },
    workUnits,
    evidenceBoundaries,
    ambientContext
  };
}

export function renderEpisodeEvidenceBrief(packet: EpisodeEvidencePacket): string {
  if (!packet.workUnits.length) {
    return `Write a literal factual history entry in English. No direct user action or navigation was observed. Use "Displayed" as the lead verb. Never say created, opened, activated, viewed, or reviewed. Keep every structured field empty.\n\nVisible context only:\n${packet.ambientContext.map((value) => `- ${value}`).join("\n") || "- No identifiable surface."}`;
  }
  const workUnits = packet.workUnits.map((unit, index) => {
    const heading = [unit.surface, unit.application ? `in ${unit.application}` : undefined]
      .filter(Boolean).join(" — ") || "Unidentified work surface";
    const sections = [
      `Claim ceiling: ${claimCeilingDescription(unit.claimCeiling)}`,
      `Safe title verbs: ${unit.safeLeadVerbs.join(", ")}`,
      renderList("Explicitly demonstrated results", unit.demonstratedOutcomes),
      renderList("Explicit submission actions", unit.submissionActions),
      renderList("Drafted or revised content", unit.contentChanges),
      renderList("Literal interactions (control labels are not outcomes)", unit.interactions),
      renderList("Navigation", unit.navigation),
      renderList("Documents", unit.documents)
    ].filter(Boolean).join("\n");
    return `${index + 1}. ${heading}\n${sections}`;
  }).join("\n\n");
  const scope = packet.calibration.mode === "sparse_literal"
    ? "This was a brief interaction; describe only the literal interaction and directly identified surface."
    : `The evidence covers an activity window of about ${packet.calibration.durationSeconds} seconds.`;
  return `Write a factual work-history entry from this evidence brief. Focus on meaningful work rather than applications or event mechanics. The title's lead verb must not exceed the dominant work unit's claim ceiling; prefer one of its safe title verbs. Clicking an explicit Send, Submit, Post, or Publish control supports the corresponding user-initiated submission action, but not downstream delivery, processing, or success. Other button or link labels name controls, not completed results. Unless the evidence explicitly demonstrates a decision, outcome, blocker, or durable edited surface, keep that structured field empty.\n\n${scope}\n\nOrdered work units:\n${workUnits}\n\nEvidence boundaries:\n${packet.evidenceBoundaries.map((value) => `- ${value}`).join("\n") || "- No submitted, saved, implemented, completed, or verified result was observed."}`;
}

export function renderCompactEpisodeEvidenceBrief(packet: EpisodeEvidencePacket): string {
  if (!packet.workUnits.length) {
    return `Write a literal factual work-history entry in English. Use the title "Displayed ${compactSurface(packet.ambientContext[0] ?? "an unidentified surface")}". No user action was observed. Do not say opened, viewed, activated, created, or reviewed.\nDescription evidence:\n- ${normalizeText(packet.ambientContext[0] ?? "An unidentified surface was visible.", 300)}`;
  }
  const substantiveUnits = packet.workUnits.filter((unit) =>
    unit.demonstratedOutcomes.length > 0 || unit.submissionActions.length > 0 || unit.contentChanges.length > 0
  );
  const excludeIncidentalEvidence = substantiveUnits.length > 0;
  const selectedUnits = (excludeIncidentalEvidence ? substantiveUnits : packet.workUnits).slice(0, 3);
  const units = selectedUnits.map((unit, index) => {
    const identity = compactSurface(compactUnitIdentity(unit));
    const evidence = [
      ...unit.demonstratedOutcomes.slice(0, 2),
      ...unit.submissionActions.slice(0, 2),
      ...unit.contentChanges.slice(0, 2),
      ...(excludeIncidentalEvidence ? [] : unit.interactions.slice(0, 3)),
      ...(excludeIncidentalEvidence ? [] : unit.navigation.slice(0, 3))
    ].map((value) => `- ${normalizeText(compactEvidenceLanguage(value), 700)}`).join("\n");
    const titleLanguage = compactTitleLanguage(unit);
    const addressOrSearchQuery = unit.claimCeiling === "literal_interaction"
      && unit.interactions.some((value) => /address or search bar/i.test(value));
    const maximumSupportedState = unit.claimCeiling === "draft_or_revision"
      ? "text editing only; not submitted, saved, implemented, completed, or verified"
      : addressOrSearchQuery
        ? "an address or search query only; submission, navigation, and results are not established"
        : claimCeilingDescription(unit.claimCeiling);
    const titleGrammar = addressOrSearchQuery
      ? "\nTitle grammar: Place queried or searched before the query; place query or search after the query."
      : "";
    return `${index === 0 ? "PRIMARY" : `SECONDARY ${index}`}: ${identity}\nMaximum supported state: ${maximumSupportedState}\nUseful title language: ${titleLanguage.join(", ")}${titleGrammar}\nEvidence:\n${evidence || "- No additional detail."}`;
  }).join("\n\n");
  const selectionRule = excludeIncidentalEvidence
    ? "The brief intentionally excludes clicks and navigation because stronger edited-content or result evidence exists. Do not invent or mention any click, control, application switch, or navigation."
    : "Only literal interaction or navigation evidence was available; describe it modestly.";
  return `Write one factual work-history title and description in English. Center the PRIMARY unit. Include a secondary unit only when it is materially distinct. Use the strongest concrete nouns from the evidence; never exceed each unit's maximum supported state. ${selectionRule}\n\n${units}\n\nUse the PRIMARY unit's useful title language as vocabulary, not a required template. The title may be verb-led, object-led, or topic-led; choose the form that reads most naturally for the evidence. Do not copy instruction labels or output a schema, type, or property name. Do not use "Drafted" as a catch-all for editing or activity. Return a specific 3–10 word title and one or two concise factual sentences.`;
}

function evidenceStrength(event: ActivityEvent): "direct_action" | "navigation" | "context" | "boundary" {
  if (["screen_slept", "screen_woke", "session_locked", "session_unlocked"].includes(event.kind)) return "boundary";
  if (["selection_changed", "text_input", "document_changed", "pointer_click"].includes(event.kind)) return "direct_action";
  return ["url_changed", "document_context_changed"].includes(event.kind) ? "navigation" : "context";
}

function surfaceName(event: ActivityEvent): string | undefined {
  return firstNonempty(
    event.document?.name,
    event.browser?.title,
    event.browser?.domain,
    event.windowTitle,
    event.element?.title,
    event.element?.label
  )?.slice(0, 240);
}

function describeTextChange(event: ActivityEvent): string | undefined {
  const change = event.textChange;
  if (!change) return event.kind === "document_changed" ? "Document content changed." : undefined;
  const resulting = normalizeText(change.resultingValue, 1_200);
  if (/^describe your goal, define measurable outcomes/i.test(resulting)) return undefined;
  if (resulting && resulting.length >= 12) return `Final observed edited text: “${resulting}”`;
  const inserted = normalizeText(change.insertedText, 900);
  if (inserted && change.deletedCharacterCount > 0) {
    return `Replaced ${change.deletedCharacterCount} characters with: “${inserted}”`;
  }
  if (inserted) return `Entered or inserted: “${inserted}”`;
  if (change.deletedCharacterCount > 0) return `Deleted ${change.deletedCharacterCount} characters.`;
  return "Text content changed.";
}

function describeInteraction(event: ActivityEvent): string | undefined {
  if (event.kind === "selection_changed") {
    const selected = (event.selectedElements ?? []).map(elementDescription).filter(Boolean).slice(0, 4);
    return selected.length ? `Selected ${selected.join(", ")}.` : "Changed a selection.";
  }
  const role = normalizeRole(event.element?.role);
  if (["static text", "web area", "group"].includes(role ?? "")) return undefined;
  const element = elementDescription(event.element);
  return element ? `Clicked ${element}.` : "Clicked an unidentified control or surface.";
}

function isAddressOrSearchInput(event: ActivityEvent): boolean {
  const descriptor = [event.element?.title, event.element?.label, event.element?.identifier]
    .filter(Boolean).join(" ");
  return /address(?: and)? search|address bar|search bar|location field|omnibox/i.test(descriptor);
}

function describeAddressOrSearchInput(event: ActivityEvent): string | undefined {
  const change = event.textChange;
  if (!change) return undefined;
  const value = normalizeText(change.resultingValue || change.insertedText, 300);
  return value
    ? `Entered “${value}” in the address or search bar; submission was not observed.`
    : "Edited the address or search bar; submission was not observed.";
}

function describeNavigation(event: ActivityEvent): string | undefined {
  if (event.browser) {
    const destination = firstNonempty(event.browser.title, event.browser.domain);
    return destination ? `Navigated to “${normalizeText(destination, 240)}”.` : "Browser navigation changed.";
  }
  if (event.document) return `Changed document context to ${documentDescription(event)}.`;
  return event.windowTitle ? `Navigated to “${normalizeText(event.windowTitle, 240)}”.` : undefined;
}

function describeDemonstratedOutcome(event: ActivityEvent): { description: string } | undefined {
  const value = firstNonempty(event.browser?.title, event.windowTitle);
  if (!value) return undefined;
  const normalized = normalizeText(value.replace(/\s+-\s+Google Chrome.*$/i, ""), 300);
  if (/\bsuccessfully registered\b/i.test(normalized)) {
    return { description: `Registration success was explicitly shown: “${normalized}”.` };
  }
  if (/\b(?:successfully|completed successfully|test(?:s)? passed|build succeeded|upload complete|saved successfully)\b/i.test(normalized)) {
    return { description: `A success state was explicitly shown: “${normalized}”.` };
  }
  return undefined;
}

function documentDescription(event: ActivityEvent): string {
  const document = event.document!;
  return `“${normalizeText(document.name || document.displayPath, 240)}”`;
}

function ambientDescription(event: ActivityEvent): string | undefined {
  const application = event.application?.localizedName;
  const surface = surfaceName(event);
  if (!application && !surface) return undefined;
  return [surface ? `“${surface}” was visible` : undefined, application ? `in ${application}` : undefined]
    .filter(Boolean).join(" ");
}

function elementDescription(element: SemanticElement | undefined): string {
  if (!element) return "";
  const name = firstNonempty(element.title, element.label, element.value, element.identifier);
  const role = normalizeRole(element.role);
  if (name && role) return `${role} “${normalizeText(name, 200)}”`;
  if (name) return `“${normalizeText(name, 200)}”`;
  return role ? `a ${role}` : "";
}

function normalizeRole(value: string | undefined): string | undefined {
  return value?.replace(/^AX/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function firstNonempty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim())?.trim();
}

function normalizeText(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function compactSurface(value: string): string {
  return normalizeText(value
    .replace(/\s+-\s+Google Chrome.*$/i, "")
    .replace(/^“|”(?: was visible)?(?: in .*)?$/g, "")
    .trim(), 180);
}

function pushUnique(values: string[], value: string, maximum: number): void {
  if (values.length >= maximum || values.includes(value)) return;
  values.push(value);
}

function renderList(label: string, values: string[]): string {
  return values.length ? `${label}:\n${values.map((value) => `- ${value}`).join("\n")}` : "";
}

function addContentChange(values: string[], event: ActivityEvent): void {
  const change = describeTextChange(event);
  if (!change) return;
  if (change.startsWith("Final observed edited text:")) {
    const newPayload = quotedPayload(change);
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const existing = values[index]!;
      if (!existing.startsWith("Final observed edited text:")) {
        values.splice(index, 1);
        continue;
      }
      const existingPayload = quotedPayload(existing);
      if (existingPayload.includes(newPayload)) {
        if ((event.textChange?.deletedCharacterCount ?? 0) > 0) {
          values.splice(index, 1);
          continue;
        }
        return;
      }
      if (newPayload.includes(existingPayload)) values.splice(index, 1);
    }
  }
  if (!values.includes(change)) values.push(change);
  if (values.length > 3) {
    const newest = values.at(-1)!;
    const retained = values.slice(0, -1)
      .sort((left, right) => contentEvidenceScore(right) - contentEvidenceScore(left))
      .slice(0, 2);
    retained.push(newest);
    values.splice(0, values.length, ...retained);
  }
}

function quotedPayload(value: string): string {
  const match = value.match(/“([\s\S]*)”$/);
  return match?.[1] ?? value;
}

function contentEvidenceScore(value: string): number {
  const payload = quotedPayload(value);
  const consequential = /\b(?:agreed|decid|should|must|do not|don't|build|implement|request|credential|blocker|error|failed|fix|use|prefer|instead)\b/i.test(payload)
    ? 350
    : 0;
  return Math.min(payload.length, 1_200) + consequential;
}

function claimCeilingDescription(value: EpisodeEvidenceWorkUnit["claimCeiling"]): string {
  if (value === "demonstrated_result") {
    return "the explicitly displayed success result; do not infer additional downstream work";
  }
  if (value === "submitted_action") {
    return "the explicit user-initiated submission action; do not claim downstream delivery, processing, or success";
  }
  if (value === "draft_or_revision") {
    return "drafting or revision only; not submitted, saved, implemented, completed, or verified";
  }
  if (value === "literal_interaction") {
    return "the literal click or selection only; the labeled action's result is not established";
  }
  return "navigation or viewing only; no change or outcome is established";
}

function textChangeTitleLanguage(changes: string[]): string[] {
  if (changes.length > 0 && changes.every((change) => /^Deleted \d+ characters\.$/.test(change))) {
    return ["deleted", "removed", "edited", "deletion", "cleanup"];
  }
  if (changes.some((change) => /^Replaced \d+ characters|^Deleted \d+ characters\.$/.test(change))) {
    return ["revised", "edited", "rewrote", "refined", "revision", "rewrite"];
  }
  const text = changes.map(quotedPayload).join(" ");
  if (/\b(?:should|must|do not|don't|please|request|recommend|propose|make|change|add|remove|build|implement|fix|use|instead)\b/i.test(text)) {
    return ["specified", "outlined", "proposed", "described", "wrote", "request", "proposal", "outline", "notes"];
  }
  return ["edited", "wrote", "composed", "revised", "refined", "edits", "notes", "writing", "revision"];
}

function compactTitleLanguage(unit: EpisodeEvidenceWorkUnit): string[] {
  if (unit.claimCeiling === "draft_or_revision") return textChangeTitleLanguage(unit.contentChanges);
  if (unit.claimCeiling === "literal_interaction" && unit.interactions.some((value) => /address or search bar/i.test(value))) {
    return ["queried", "searched", "query", "search"];
  }
  return unit.safeLeadVerbs;
}

function compactEvidenceLanguage(value: string): string {
  const addressQuery = value.match(/^Entered “(.+)” in the address or search bar; submission was not observed\.$/i);
  return addressQuery
    ? `Address or search query: “${addressQuery[1]}”; submission was not observed.`
    : value;
}

function compactUnitIdentity(unit: EpisodeEvidenceWorkUnit): string {
  for (const interaction of unit.interactions) {
    const addressQuery = interaction.match(/^Entered “(.+)” in the address or search bar;/i);
    if (addressQuery) return addressQuery[1]!;
  }
  return unit.surface ?? unit.application ?? "Unidentified surface";
}

function submissionActionVerbs(actions: string[]): string[] {
  const joined = actions.join(" ");
  if (/\bsend\b/i.test(joined)) return ["Sent"];
  if (/\bsubmit\b/i.test(joined)) return ["Submitted"];
  if (/\bpublish\b/i.test(joined)) return ["Published"];
  if (/\bpost\b/i.test(joined)) return ["Posted"];
  return ["Submitted"];
}

function demonstratedOutcomeVerbs(outcomes: string[]): string[] {
  const joined = outcomes.join(" ");
  if (/registration success|successfully registered/i.test(joined)) return ["Registered"];
  if (/test(?:s)? passed/i.test(joined)) return ["Verified"];
  if (/build succeeded/i.test(joined)) return ["Built", "Verified"];
  if (/upload complete/i.test(joined)) return ["Uploaded"];
  if (/saved successfully/i.test(joined)) return ["Saved"];
  return ["Completed"];
}
