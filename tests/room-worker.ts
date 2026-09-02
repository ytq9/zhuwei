import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE } from "../app/_runtime/lib/kp/vnext/room-bridge";
import { RoomDurableObject } from "../app/_runtime/lib/room/durable-object";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/vnext-world-interaction";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime";

const VNEXT_STAGE3_RULES_RUNTIME = createVersionedRulesRuntime({
  registrations: [{
    manifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
    interpreterKind: "authoritative-v2",
  }],
  defaultManifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST.manifest,
});

export { RoomDurableObject };

/** Test-only binding. Production exports and the production Profile Registry
 * remain pinned to the current RoomDurableObject default runtime. */
export class VNextStage3RoomDurableObject extends RoomDurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(
      ctx,
      env,
      VNEXT_STAGE3_RULES_RUNTIME,
      VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE,
    );
  }
}

declare global {
  interface Env {
    VNEXT_ROOMS: DurableObjectNamespace<VNextStage3RoomDurableObject>;
  }
}

export default {
  fetch() {
    return new Response("Room Durable Object test worker");
  },
} satisfies ExportedHandler<Env>;
