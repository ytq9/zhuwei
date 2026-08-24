import { BLACK_OAK_WILL } from "./black-oak-will";
import { assertModule, type ModuleDef } from "./schema";

function register(mod: ModuleDef) {
  try {
    return assertModule(mod);
  } catch (err) {
    console.error("[module]", err);
    return mod;
  }
}

const MODULES: Record<string, ModuleDef> = {
  [BLACK_OAK_WILL.id]: register(BLACK_OAK_WILL),
};

export function getModule(id: string): ModuleDef {
  return MODULES[id] ?? BLACK_OAK_WILL;
}

export function listModules() {
  return Object.values(MODULES).map((m) => ({
    id: m.id,
    title: m.title,
    level: m.level,
    duration: m.duration,
    tone: m.tone,
    players: m.players,
  }));
}

export type { ModuleDef } from "./schema";
export { WRITING_RULES, WRITING_REVISION } from "./writing";
