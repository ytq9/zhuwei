import { authoredWorldFactConform } from "../v2/world-facts";
import { dynamicLocationContentConform, dynamicPassageConform } from "../v2/dynamic-location-shapes";
import { canonicalSha256 } from "./canonical";
import type { SemanticJsonRecord } from "../v2/semantic-definitions";

export type MaterializationSemanticKind = "sceneFeature" | "worldFact" | "location" | "passage";

/** Runtime policy owns the field surface; static template prose cannot widen it. */
export const VNEXT_SEMANTIC_MATERIALIZATION_FIELDS = Object.freeze({
  sceneFeature: Object.freeze(["sceneRef", "label", "description", "observableState",
    "affordances", "mechanicDefinitionRefs", "visibilityFactId"]),
  worldFact: Object.freeze(["label", "description", "worldFact"]),
  location: Object.freeze(["scopeRef", "label", "description", "geometry"]),
  passage: Object.freeze(["sceneRef", "label", "description", "observableState", "passage", "visibilityFactId"]),
});

function template(semanticKind: MaterializationSemanticKind, defaults: SemanticJsonRecord) {
  const body = Object.freeze({
    schema: "zhuwei.semantic-template/v1",
    templateRef: `template:semantic:${semanticKind}:v1`,
    revision: "1",
    semanticKind,
    sourceRef: "spec:0016:5.3",
    defaults,
  });
  return Object.freeze({ ...body, templateHash: canonicalSha256(body) });
}

/** These are creation defaults, never world instances, inventory or grants. */
export const VNEXT_SEMANTIC_TEMPLATES = Object.freeze({
  sceneFeature: template("sceneFeature", Object.freeze({
    observableState: "present", affordances: Object.freeze([]),
  })),
  worldFact: template("worldFact", Object.freeze({})),
  location: template("location", Object.freeze({})),
  passage: template("passage", Object.freeze({})),
});

export const VNEXT_SEMANTIC_TEMPLATE_CATALOG = Object.freeze({
  schema: "zhuwei.semantic-template-catalog/v1",
  templates: Object.freeze(Object.values(VNEXT_SEMANTIC_TEMPLATES)),
});
export const VNEXT_SEMANTIC_TEMPLATE_CATALOG_HASH = canonicalSha256(VNEXT_SEMANTIC_TEMPLATE_CATALOG);

type CompositionResult =
  | Readonly<{ kind: "accepted"; content: SemanticJsonRecord }>
  | Readonly<{ kind: "rejected"; code: "PROPOSAL_REFERENCE_INVALID" | "PROPOSAL_FORM_INVALID";
      issues: readonly string[] }>;

/** Exact static lookup and one complete creation-time synthesis. Historical
 * stored definitions and sparse revisions do not consult this catalog. */
export function composeSemanticTemplate(input: Readonly<{
  semanticKind: string;
  templateRef: string;
  templateHash: string;
  overrides: SemanticJsonRecord;
}>): CompositionResult {
  const selected = VNEXT_SEMANTIC_TEMPLATE_CATALOG.templates.find(entry =>
    entry.templateRef === input.templateRef && entry.templateHash === input.templateHash
      && entry.semanticKind === input.semanticKind);
  if (selected === undefined) return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID",
    issues: ["materialization:exact-static-template-required"] };
  const allowed = VNEXT_SEMANTIC_MATERIALIZATION_FIELDS[selected.semanticKind];
  if (!isRecord(input.overrides) || Object.keys(input.overrides).some(key => !allowed.includes(key))) {
    return invalidFields();
  }
  const content = { ...selected.defaults, ...input.overrides };
  if (!text(content.label, 500) || !text(content.description, 4_000)
    || (content.visibilityFactId !== undefined && !ref(content.visibilityFactId))) return invalidFields();
  if (selected.semanticKind === "sceneFeature"
    && (!ref(content.sceneRef) || !text(content.observableState, 2_000)
      || !Array.isArray(content.affordances) || content.affordances.length > 16
      || !content.affordances.every(value => text(value, 500))
      || (content.mechanicDefinitionRefs !== undefined
        && (!Array.isArray(content.mechanicDefinitionRefs) || content.mechanicDefinitionRefs.length > 64
          || !content.mechanicDefinitionRefs.every(ref))))) return invalidFields();
  if (selected.semanticKind === "worldFact" && !authoredWorldFactConform(content.worldFact)) return invalidFields();
  if (selected.semanticKind === "location" && !dynamicLocationContentConform(content)) return invalidFields();
  if (selected.semanticKind === "passage" && (!ref(content.sceneRef) || !dynamicPassageConform(content.passage)
    || !["open", "closed", "blocked"].includes(String(content.observableState)))) return invalidFields();
  const cloned = structuredClone(content);
  for (const value of Object.values(cloned)) if (Array.isArray(value)) Object.freeze(value);
  return Object.freeze({ kind: "accepted", content: Object.freeze(cloned) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}
function ref(value: unknown): value is string {
  return text(value, 300) && value.trim() === value && value.normalize("NFC") === value;
}
function invalidFields(): CompositionResult {
  return { kind: "rejected", code: "PROPOSAL_FORM_INVALID",
    issues: ["materialization:semantic-kind-fields-invalid"] };
}
