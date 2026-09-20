

export type PersistedRoomKpBinding = Readonly<{
  ruleset_version: string;
  module_id: string;
  host_user_id: string;
  kp_model: string;
  kp_model_profile: string;
  kp_workflow_manifest: string | null;
  kp_context_planner_profile: string | null;
}>;

export type V3RoomBindingViolation =
  | "modelProfile"
  | "workflow"
  | "planner"
  | "runtimeManifest"
  | "module";

export type V3RoomBindingValidation =
  | Readonly<{ kind: "valid" }>
  | Readonly<{ kind: "invalid"; violation: V3RoomBindingViolation }>;
