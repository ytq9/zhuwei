import { assertAllModules } from "../app/_runtime/lib/module/index.ts";

const count = assertAllModules();
console.log(`module:check 通过（${count} 个模组）`);
