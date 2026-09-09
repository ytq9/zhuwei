/** Closed player commands. Actor identity and all party rules belong to Room/Rules. */
export type PartyCommand =
  | { action: "inviteMember" | "transferLeadership"; targetCharacterId: string }
  | { action: "cancelInvitation"; pendingInputId: string }
  | { action: "leave" }
  | {
      action: "proposeMove" | "moveIndividually";
      destinationSceneId: string;
      fictionTimeCostMicros: string;
    };

export type PartyActionInput = {
  kind: "party";
  submissionId: string;
  command: PartyCommand;
  displayText?: string;
};

export function isPartyCommand(value: unknown): value is PartyCommand {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  const exact = (...keys: string[]) =>
    Object.keys(command).sort().join(",") === ["action", ...keys].sort().join(",");
  const nonEmpty = (field: unknown): field is string =>
    typeof field === "string" && field.trim().length > 0;
  switch (command.action) {
    case "inviteMember":
    case "transferLeadership":
      return exact("targetCharacterId") && nonEmpty(command.targetCharacterId);
    case "cancelInvitation":
      return exact("pendingInputId") && nonEmpty(command.pendingInputId);
    case "leave":
      return exact();
    case "proposeMove":
    case "moveIndividually":
      return exact("destinationSceneId", "fictionTimeCostMicros")
        && nonEmpty(command.destinationSceneId)
        && typeof command.fictionTimeCostMicros === "string"
        && /^[1-9][0-9]*$/u.test(command.fictionTimeCostMicros);
    default:
      return false;
  }
}
