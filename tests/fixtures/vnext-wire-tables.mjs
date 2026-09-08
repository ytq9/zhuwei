// The strict-tool wire is three flat tables: decision, steps, results. Tests
// that hand-edit a wire find a step's result row here, or fold the tables back
// into the nested decision shape that clarification continuations still use.
export const row = (wire, step, branch) => wire.results.find(entry => entry.step === step && entry.branch === branch);
export const rowIndex = (wire, step, branch) => wire.results.findIndex(entry => entry.step === step && entry.branch === branch);
export function dropRow(wire, step, branch) {
  wire.results = wire.results.filter(entry => !(entry.step === step && entry.branch === branch));
}
export function unflattenSocial(body) {
  const { responseKind, responseText, responseMotive, responseBasis, ...rest } = body;
  const response = {};
  if (responseKind !== undefined) response.kind = responseKind;
  if (responseText !== undefined) response.text = responseText;
  if (responseMotive !== undefined) response.motive = responseMotive;
  if (responseBasis !== undefined) response.basis = responseBasis;
  return { ...rest, response };
}
// A clarification continuation is the same three tables one level down.
export function nestedDecision(wire) {
  return { ...wire.decision, steps: wire.steps ?? [], results: wire.results ?? [] };
}
export const continuationOf = nestedDecision;
