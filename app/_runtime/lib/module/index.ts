import { BLACK_OAK_WILL } from "./black-oak-will";
import { assertModule, type ModuleDef } from "./schema";

const MODULES: Record<string, ModuleDef> = {
  [BLACK_OAK_WILL.id]: assertModule(BLACK_OAK_WILL),
};

export function assertAllModules() {
  for (const mod of Object.values(MODULES)) assertModule(mod);
  return Object.keys(MODULES).length;
}

export function getModule(id: string): ModuleDef {
  return MODULES[id] ?? BLACK_OAK_WILL;
}

export function findModule(id: string): ModuleDef | null {
  return MODULES[id] ?? null;
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
