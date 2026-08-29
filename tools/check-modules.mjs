import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const scanRoots = ["app", "worker", "db", "tools"];
const rulesPublicValues = new Set(["step", "project", "replay"]);
const legacyEnginePathPattern = /(?:^|\/)app\/_runtime\/lib\/rules\/engine(?:\.[cm]?[jt]s)?$/;
const secondAuthorityFileAllowlist = new Set([
  "app/_runtime/lib/kp/combat.ts",
  "app/_runtime/lib/room/durable-object.ts",
  "app/_runtime/lib/room/server.ts",
  "app/_runtime/lib/rules/index.ts",
  "app/_runtime/lib/rules/legacy-adapter.ts",
  "app/_runtime/lib/table/server.ts",
]);
const secondAuthorityExportAllowlist = new Map([
  ["app/_runtime/lib/kp/combat.ts", new Set(["rollDiceExpr"])],
  ["app/_runtime/lib/room/server.ts", new Set(["roomProjection"])],
]);
const trustedConsoleSinks = new Map([
  ["app/_runtime/lib/room/server.ts", new Set(["event"])],
  ["app/_runtime/lib/table/server.ts", new Set(["serialized"])],
]);
const structuredConsoleBuilders = new Set([
  "buildModelInvocationTelemetryEvent",
  "buildRoomTelemetryEvent",
]);
// Module-scope effects are denied by default. Any future exception must name both
// the exact repository-relative file and the exact forbidden operation.
export const moduleScopeEffectAllowlist = new Map();
const moduleScopeInvocationAllowlist = new Map([
  ["tools/check-modules.mjs", new Set(["main"])],
  ["tools/run-context-planner-role-validation.mjs", new Set(["main"])],
  ["tools/run-kp-v3-eval.mjs", new Set(["main"])],
]);

function walkSourceFiles(root, roots = scanRoots) {
  const files = [];
  const visit = (absolutePath) => {
    if (!existsSync(absolutePath)) return;
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      const entryPath = join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (sourceExtensions.has(extname(entry.name))) {
        files.push(entryPath);
      }
    }
  };
  for (const rootName of roots) visit(join(root, rootName));
  return files.sort();
}

function slashPath(root, file) {
  return relative(root, file).replaceAll("\\", "/");
}

function readSource(file) {
  return readFileSync(file, "utf8");
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function templateLiteralEnd(source, startIndex) {
  for (let index = startIndex; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "`") return index;
    if (source[index] === "$" && source[index + 1] === "{") {
      index = templateExpressionEnd(source, index + 2);
    }
  }
  return source.length - 1;
}

function templateExpressionEnd(source, startIndex) {
  let depth = 1;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      const quote = char;
      for (index += 1; index < source.length; index += 1) {
        if (source[index] === "\\") index += 1;
        else if (source[index] === quote) break;
      }
      continue;
    }
    if (char === "`") {
      index = templateLiteralEnd(source, index + 1);
      continue;
    }
    if (char === "/" && next === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) return source.length - 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index = source.indexOf("*/", index + 2);
      if (index === -1) return source.length - 1;
      index += 1;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return source.length - 1;
}

function maskCommentsAndStrings(source) {
  let output = "";
  let index = 0;
  let mode = "code";
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "code" && char === "/" && next === "/") {
      output += "  ";
      index += 2;
      mode = "line-comment";
      continue;
    }
    if (mode === "code" && char === "/" && next === "*") {
      output += "  ";
      index += 2;
      mode = "block-comment";
      continue;
    }
    if (mode === "code" && char === "/" && next !== "/" && next !== "*") {
      const prefix = source.slice(0, index).trimEnd();
      if (/(?:^|[=(,:;!&|?{}\x5b]|=>|\breturn|\bcase|\bthrow)$/.test(prefix)) {
        output += " ";
        index += 1;
        mode = "regex";
        continue;
      }
    }
    if (mode === "line-comment") {
      output += char === "\n" ? "\n" : " ";
      index += 1;
      if (char === "\n") mode = "code";
      continue;
    }
    if (mode === "block-comment") {
      output += char === "\n" ? "\n" : " ";
      if (char === "*" && next === "/") {
        output += " ";
        index += 2;
        mode = "code";
      } else {
        index += 1;
      }
      continue;
    }
    if (mode === "code" && char === "`") {
      output += " ";
      index += 1;
      while (index < source.length) {
        const templateChar = source[index];
        const templateNext = source[index + 1];
        if (templateChar === "\\") {
          output += " ";
          if (index + 1 < source.length) output += templateNext === "\n" ? "\n" : " ";
          index += 2;
          continue;
        }
        if (templateChar === "`") {
          output += " ";
          index += 1;
          break;
        }
        if (templateChar === "$" && templateNext === "{") {
          const expressionStart = index + 2;
          const expressionEnd = templateExpressionEnd(source, expressionStart);
          output += "  ";
          output += maskCommentsAndStrings(source.slice(expressionStart, expressionEnd));
          output += " ";
          index = expressionEnd + 1;
          continue;
        }
        output += templateChar === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    if (mode === "code" && (char === "\"" || char === "'")) {
      output += " ";
      index += 1;
      mode = char;
      continue;
    }
    if (mode === "\"" || mode === "'") {
      output += char === "\n" ? "\n" : " ";
      if (char === "\\") {
        if (index + 1 < source.length) {
          output += source[index + 1] === "\n" ? "\n" : " ";
          index += 2;
        } else {
          index += 1;
        }
      } else {
        index += 1;
        if (char === mode) mode = "code";
      }
      continue;
    }
    if (mode === "regex") {
      output += char === "\n" ? "\n" : " ";
      if (char === "\\") {
        if (index + 1 < source.length) {
          output += source[index + 1] === "\n" ? "\n" : " ";
          index += 2;
        } else {
          index += 1;
        }
      } else {
        index += 1;
        if (char === "/") mode = "code";
      }
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function tokenize(source) {
  const masked = maskCommentsAndStrings(source);
  const tokens = [];
  const tokenPattern = /=>|\?\.|===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|\*\*|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s]/g;
  for (const match of masked.matchAll(tokenPattern)) {
    tokens.push({ value: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

function matchingTokenIndexes(tokens) {
  const opens = { "(": ")", "[": "]", "{": "}" };
  const openForClose = Object.fromEntries(Object.entries(opens).map(([open, close]) => [close, open]));
  const stacks = { "(": [], "[": [], "{": [] };
  const matches = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (Object.hasOwn(opens, value)) {
      stacks[value].push(index);
    } else if (Object.hasOwn(openForClose, value)) {
      const openIndex = stacks[openForClose[value]].pop();
      if (openIndex !== undefined) {
        matches.set(openIndex, index);
        matches.set(index, openIndex);
      }
    }
  }
  return matches;
}

function functionBodyRanges(source) {
  const tokens = tokenize(source);
  const matches = matchingTokenIndexes(tokens);
  const ranges = [];
  const addBlockRange = (openIndex, constructIndex) => {
    const closeIndex = matches.get(openIndex);
    if (closeIndex === undefined) return;
    let followingIndex = closeIndex + 1;
    while (tokens[followingIndex]?.value === ")") followingIndex += 1;
    if (tokens[followingIndex]?.value !== "(") {
      ranges.push({ start: tokens[constructIndex].start, end: tokens[closeIndex].end, constructIndex });
    }
  };
  const bodyAfterSignature = (closeParenIndex) => {
    let angleDepth = 0;
    const hasReturnType = tokens[closeParenIndex + 1]?.value === ":";
    for (let candidate = closeParenIndex + 1; candidate < tokens.length; candidate += 1) {
      const value = tokens[candidate].value;
      if (value === "<") angleDepth += 1;
      if (value === ">" && angleDepth > 0) angleDepth -= 1;
      if (value === "{" && angleDepth > 0) {
        candidate = matches.get(candidate) ?? candidate;
        continue;
      }
      if (value === "{" && angleDepth === 0) {
        const closeIndex = matches.get(candidate);
        const nextValue = closeIndex === undefined ? undefined : tokens[closeIndex + 1]?.value;
        if (hasReturnType && ["{", "|", "&", "["].includes(nextValue)) {
          candidate = closeIndex;
          continue;
        }
        return candidate;
      }
      if ([";", "=>", "="].includes(value)) return -1;
    }
    return -1;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === "function") {
      const parametersOpen = tokens.findIndex((token, candidate) => candidate > index && token.value === "(");
      const parametersClose = matches.get(parametersOpen);
      const bodyOpen = parametersClose === undefined ? -1 : bodyAfterSignature(parametersClose);
      if (bodyOpen !== -1) addBlockRange(bodyOpen, index);
    }
    if (tokens[index].value === "=>") {
      if (tokens[index + 1]?.value === "{") {
        addBlockRange(index + 1, index);
      } else if (tokens[index + 1]) {
        let endIndex = index + 1;
        let depth = 0;
        while (endIndex + 1 < tokens.length) {
          const next = tokens[endIndex + 1].value;
          if (["(", "[", "{"].includes(next)) depth += 1;
          if ([")", "]", "}"].includes(next)) {
            if (depth === 0) break;
            depth -= 1;
          }
          if (depth === 0 && [",", ";"].includes(next)) break;
          endIndex += 1;
        }
        let followingIndex = endIndex + 1;
        while (tokens[followingIndex]?.value === ")") followingIndex += 1;
        if (tokens[followingIndex]?.value !== "(") {
          ranges.push({ start: tokens[index].start, end: tokens[endIndex].end, constructIndex: index });
        }
      }
    }
    if (tokens[index].value === "{" && tokens[index - 1]?.value === ")") {
      const openParenIndex = matches.get(index - 1);
      const methodName = tokens[openParenIndex - 1]?.value;
      if (methodName && !new Set(["if", "for", "while", "switch", "catch", "with"]).has(methodName)) {
        addBlockRange(index, openParenIndex - 1);
      }
    }
    if (tokens[index].value === ")" && tokens[index + 1]?.value === ":") {
      const openParenIndex = matches.get(index);
      const methodName = tokens[openParenIndex - 1]?.value;
      const bodyOpen = bodyAfterSignature(index);
      const receiver = tokens[openParenIndex - 2]?.value;
      if (
        methodName
        && receiver !== "."
        && receiver !== "?."
        && bodyOpen !== -1
      ) addBlockRange(bodyOpen, openParenIndex - 1);
    }
  }
  return ranges;
}

function collectExportedValueNames(source) {
  const withoutComments = stripComments(source);
  const names = new Set();
  const forbiddenForms = [];

  if (/\bexport\s+default\b/.test(withoutComments)) forbiddenForms.push("default export");
  if (/\bexport\s*=/.test(withoutComments)) forbiddenForms.push("export assignment");
  if (/\bexport\s*\*/.test(withoutComments)) forbiddenForms.push("star export");

  const declarationPattern = /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function|class|const|let|var|enum|namespace|module)\s*\*?\s*([A-Za-z_$][\w$]*)/g;
  for (const match of withoutComments.matchAll(declarationPattern)) names.add(match[2]);
  for (const match of withoutComments.matchAll(/\bexport\s+import\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    names.add(match[1]);
  }

  const variablePattern = /\bexport\s+(?:declare\s+)?(?:const|let|var)\s+/g;
  for (const match of withoutComments.matchAll(variablePattern)) {
    const declaration = withoutComments.slice(match.index + match[0].length);
    const tokens = tokenize(declaration);
    let depth = 0;
    let expectingName = true;
    for (const token of tokens) {
      if (token.value === ";" && depth === 0) break;
      if (["(", "[", "{"].includes(token.value)) depth += 1;
      if ([")", "]", "}"].includes(token.value)) depth -= 1;
      if (expectingName && depth === 0 && /^[A-Za-z_$][\w$]*$/.test(token.value)) {
        names.add(token.value);
        expectingName = false;
      }
      if (token.value === "," && depth === 0) expectingName = true;
    }
  }

  const listPattern = /\bexport\s+(type\s+)?\{([\s\S]*?)\}(?:\s+from\s+["'][^"']+["'])?\s*;?/g;
  for (const match of withoutComments.matchAll(listPattern)) {
    if (match[1]) continue;
    for (const rawItem of match[2].split(",")) {
      const item = rawItem.trim();
      if (!item || /^type\b/.test(item)) continue;
      const itemMatch = /^(?:[A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(item);
      if (!itemMatch) {
        forbiddenForms.push(`unparseable export '${item}'`);
        continue;
      }
      names.add(itemMatch[1] ?? item.split(/\s+/)[0]);
    }
  }

  return { names, forbiddenForms };
}

export function assertRulesPublicSurface(root) {
  const rulesIndexPath = join(root, "app/_runtime/lib/rules/index.ts");
  assert.ok(existsSync(rulesIndexPath), "rules public entry app/_runtime/lib/rules/index.ts must exist");
  const { names, forbiddenForms } = collectExportedValueNames(readSource(rulesIndexPath));
  assert.deepEqual(forbiddenForms, [], `rules public entry contains forbidden export forms: ${forbiddenForms.join(", ")}`);
  assert.deepEqual(
    [...names].sort(),
    [...rulesPublicValues].sort(),
    "rules public entry may value-export only step, project, and replay",
  );
}

function importSpecifiers(source) {
  const specifiers = [];
  const literalPatterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of literalPatterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/\b(?:import|require)\s*\(\s*`([\s\S]*?)`\s*\)/g)) {
    specifiers.push(match[1].includes("${") ? "<non-literal>" : match[1]);
  }
  const masked = maskCommentsAndStrings(source);
  if (/\bimport\s*\(\s*[^\s"')]/.test(masked) || /\brequire\s*\(\s*[^\s"')]/.test(masked)) {
    specifiers.push("<non-literal>");
  }
  return specifiers;
}

function resolveImportPath(root, importer, specifier) {
  if (specifier === "<non-literal>") return specifier;
  if (specifier.startsWith("@/")) return `app/_runtime/${specifier.slice(2)}`;
  if (!specifier.startsWith(".")) return specifier;
  return slashPath(root, resolve(dirname(importer), specifier));
}

export function assertImportBoundaries(root) {
  const violations = [];
  for (const file of walkSourceFiles(root)) {
    const relativePath = slashPath(root, file);
    for (const specifier of importSpecifiers(readSource(file))) {
      if (specifier === "<non-literal>") {
        violations.push(`${relativePath}: non-literal dynamic import/require`);
        continue;
      }
      const normalizedWithExtension = resolveImportPath(root, file, specifier);
      const normalized = normalizedWithExtension.replace(/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/, "");
      const importerIsRulesImplementation = relativePath.startsWith("app/_runtime/lib/rules/");
      if (legacyEnginePathPattern.test(normalizedWithExtension) && relativePath !== "app/_runtime/lib/rules/legacy-adapter.ts") {
        violations.push(`${relativePath}: legacy rules engine import '${specifier}'`);
      }
      if (
        /(?:^|\/)app\/_runtime\/lib\/rules\/(?:v2(?:\/|$)|v2-runtime$)/.test(normalized)
        && !importerIsRulesImplementation
      ) {
        violations.push(`${relativePath}: private rules v2 import '${specifier}'`);
      }
    }
  }
  assert.deepEqual(violations, [], `private rules imports are forbidden:\n${violations.join("\n")}`);
}

export function assertSingleRulesAuthority(root) {
  const violations = [];
  const suspiciousFilePattern = /(?:^|\/)(?:mechanics|mechanic-engine|projector|projection-engine|randomness|replay-engine|state-authority)(?:\.[^/]+)?$/i;
  const suspiciousExportPattern = /^(?:step|project|replay|applyEvents|foldEvents|rollDie|rollDice|.*Mechanics|.*Projector|.*StateAuthority)$/;
  for (const file of walkSourceFiles(root)) {
    const relativePath = slashPath(root, file);
    if (
      !relativePath.startsWith("app/_runtime/lib/rules/")
      && suspiciousFilePattern.test(relativePath)
      && !secondAuthorityFileAllowlist.has(relativePath)
    ) {
      violations.push(`${relativePath}: suspicious second mechanics/state authority file`);
    }
    if (relativePath.startsWith("app/_runtime/lib/rules/")) continue;
    const allowedNames = secondAuthorityExportAllowlist.get(relativePath) ?? new Set();
    const { names } = collectExportedValueNames(readSource(file));
    for (const name of names) {
      if (suspiciousExportPattern.test(name) && !allowedNames.has(name)) {
        violations.push(`${relativePath}: exported second-authority symbol '${name}'`);
      }
    }
  }
  assert.deepEqual(violations, [], `second mechanics/projection/random/replay/state authorities are forbidden:\n${violations.join("\n")}`);
}

const moduleScopeForbiddenOperations = [
  ["random", /\b(?:(?:globalThis\.)?Math\.random|(?:globalThis\.)?crypto\.(?:getRandomValues|randomUUID)|randomBytes|randomUUID)\s*\(/g],
  ["fetch", /(?<![.\w])fetch\s*\(|\b(?:[A-Za-z_$][\w$]*\.)+fetch\s*\(/g],
  ["database", /\b(?:getD1|getSql|drizzle|openDatabase|createDatabase|(?:init|initialize|connect)(?:Database|Db|D1|Sql|Storage))\s*\(|\benv\.DB\b|\b[A-Za-z_$][\w$]*\.(?:prepare|exec|batch)\s*\(|\bnew\s+(?:D1Database|Database|Client|Pool|PGlite)\s*\(/gi],
  ["timer", /\b(?:(?:globalThis|window|self)\.)?(?:setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/g],
  ["secret", /\b(?:globalThis\.)?process\.env\b|\bimport\.meta\.env\b|\benv\.[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PRIVATE)[A-Z0-9_]*\b|\benv\s*\[|\b(?:const|let|var)\s*\{[^}]*\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PRIVATE)[A-Z0-9_]*\b[^}]*\}\s*=\s*env\b/g],
  ["I/O", /\b(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|exec|execSync|execFile|execFileSync|spawn|spawnSync|getSecret|readSecret)\s*\(|\benv\.[A-Z][A-Z0-9_]*\.(?:get|getByName|put|delete|send|fetch)\s*\(/g],
];

export function assertNoModuleScopeEffects(root) {
  const violations = [];
  for (const file of walkSourceFiles(root)) {
    const relativePath = slashPath(root, file);
    const source = readSource(file);
    const masked = maskCommentsAndStrings(source);
    const functionRanges = functionBodyRanges(source);
    const allowedOperations = moduleScopeEffectAllowlist.get(relativePath) ?? new Set();
    const allowedInvocations = moduleScopeInvocationAllowlist.get(relativePath) ?? new Set();
    const effectfulRanges = new Set();
    const smallestContainingRange = (position) => functionRanges
      .filter((range) => position >= range.start && position < range.end)
      .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
    for (const [operation, pattern] of moduleScopeForbiddenOperations) {
      pattern.lastIndex = 0;
      for (const match of masked.matchAll(pattern)) {
        const containingRange = smallestContainingRange(match.index);
        if (!containingRange && !allowedOperations.has(operation)) {
          violations.push(`${relativePath}: module-scope ${operation} effect`);
        } else if (containingRange && !allowedOperations.has(operation)) {
          effectfulRanges.add(containingRange);
        }
      }
    }
    const functionName = (range) => {
      const head = source.slice(range.start, Math.min(range.end, range.start + 300));
      const declaration = /^function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(head);
      if (declaration) return declaration[1];
      const method = /^([A-Za-z_$][\w$]*)\s*(?:<[^>{}]*>)?\s*\(/.exec(head);
      if (method) return method[1];
      if (head.startsWith("=>")) {
        const tail = source.slice(Math.max(0, range.start - 500), range.start);
        return /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^;{}]*\)|[A-Za-z_$][\w$]*)\s*$/.exec(tail)?.[1];
      }
      return undefined;
    };
    const callTokens = tokenize(source);
    let effectfulNames = new Set([...effectfulRanges].map(functionName).filter(Boolean));
    let changed = true;
    while (changed && effectfulNames.size > 0) {
      changed = false;
      for (let index = 0; index < callTokens.length - 1; index += 1) {
        const token = callTokens[index];
        if (!effectfulNames.has(token.value) || callTokens[index + 1].value !== "(") continue;
        const containingRange = smallestContainingRange(token.start);
        if (!containingRange) {
          if (!allowedInvocations.has(token.value)) {
            violations.push(`${relativePath}: module-scope invocation of effectful '${token.value}'`);
          }
          continue;
        }
        const containingName = functionName(containingRange);
        if (containingName && !effectfulNames.has(containingName)) {
          effectfulRanges.add(containingRange);
          effectfulNames = new Set([...effectfulRanges].map(functionName).filter(Boolean));
          changed = true;
        }
      }
    }
  }
  assert.deepEqual(violations, [], `module-scope I/O and nondeterminism are forbidden:\n${violations.join("\n")}`);
}

export function assertStaticRagInputs(root) {
  const violations = [];
  const ragFilePattern = /(?:\/(?:rag|retrieval|static-retrieval)\/|(?:^|\/)(?:rag|rag-index|retrieval|static-retrieval|retriever|corpus-index|fts-index|knowledge-index)(?:\.[^/]+)?$)/i;
  const dynamicKnowledgePattern = /\b(?:RoomState|WorldState|Tactical(?:State|Projection|Snapshot|Context|Knowledge)|Npc(?:State|Context|Snapshot|Knowledge)|NPCKnowledge|AudienceSnapshot|ViewerReadModel|roomState|worldState|tacticalState|tacticalProjection|tacticalKnowledge|npcState|npcKnowledge|roomKnowledge|worldKnowledge|roomFacts|worldFacts)\b/g;
  for (const file of walkSourceFiles(root, ["app"])) {
    const relativePath = slashPath(root, file);
    if (!ragFilePattern.test(relativePath)) continue;
    const source = readSource(file);
    const masked = maskCommentsAndStrings(source);
    const matches = [...masked.matchAll(dynamicKnowledgePattern)].map((match) => match[0]);
    if (matches.length > 0) {
      violations.push(`${relativePath}: dynamic room/world/tactical/NPC input (${[...new Set(matches)].join(", ")})`);
    }
    for (const specifier of importSpecifiers(source)) {
      if (/(?:^|\/)(?:room|world|tactical|npc)(?:\/|\.|$)|(?:^|\/)rules\/v2(?:\/|$)/i.test(specifier)) {
        violations.push(`${relativePath}: dynamic authority import '${specifier}'`);
      }
    }
  }
  assert.deepEqual(violations, [], `production RAG indexes must accept static corpus inputs only:\n${violations.join("\n")}`);
}

function consoleArgument(source, startIndex) {
  const openIndex = source.indexOf("(", startIndex);
  if (openIndex === -1) return "";
  let depth = 0;
  let mode = "code";
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "code" && (char === "\"" || char === "'" || char === "`")) {
      mode = char;
      continue;
    }
    if (mode !== "code") {
      if (char === "\\") index += 1;
      else if (char === mode) mode = "code";
      continue;
    }
    if (char === "/" && next === "/") {
      const newlineIndex = source.indexOf("\n", index + 2);
      index = newlineIndex === -1 ? source.length : newlineIndex;
      continue;
    }
    if (char === "/" && next === "*") {
      const closeIndex = source.indexOf("*/", index + 2);
      index = closeIndex === -1 ? source.length : closeIndex + 1;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index).trim();
    }
  }
  return "";
}

function isStructuredConsoleArgument(relativePath, source, argument) {
  const tokens = tokenize(argument);
  const matches = matchingTokenIndexes(tokens);
  const exactStringifyCall = tokens[0]?.value === "JSON"
    && tokens[1]?.value === "."
    && tokens[2]?.value === "stringify"
    && tokens[3]?.value === "("
    && matches.get(3) === tokens.length - 1;
  const directBuilder = exactStringifyCall
    && structuredConsoleBuilders.has(tokens[4]?.value)
    && tokens[5]?.value === "("
    && matches.get(5) === tokens.length - 2;
  if (directBuilder) return true;
  const trustedArguments = trustedConsoleSinks.get(relativePath) ?? new Set();
  if (trustedArguments.has(argument)) {
    if (argument === "event") {
      return /build(?:ModelInvocation|Room)TelemetryEvent/.test(source);
    }
    if (argument === "serialized") {
      return /const\s+event\s*=\s*buildRoomTelemetryEvent\s*\(/.test(source)
        && /const\s+serialized\s*=\s*JSON\.stringify\s*\(\s*event\s*\)/.test(source);
    }
  }
  const stringifiedTrusted = exactStringifyCall
    && tokens.length === 6
    && trustedArguments.has(tokens[4]?.value);
  if (stringifiedTrusted) {
    return /build(?:ModelInvocation|Room)TelemetryEvent/.test(source);
  }
  return false;
}

export function assertStructuredProductionLogging(root) {
  const violations = [];
  for (const file of walkSourceFiles(root, ["app", "worker", "db"])) {
    const relativePath = slashPath(root, file);
    const source = readSource(file);
    const masked = maskCommentsAndStrings(source);
    for (const match of masked.matchAll(/\b(?:globalThis\.)?console\.(?:log|info|warn|error|debug|trace)\s*\(/g)) {
      const argument = consoleArgument(source, match.index);
      if (!isStructuredConsoleArgument(relativePath, source, argument)) {
        violations.push(`${relativePath}: raw console sink '${argument.slice(0, 80)}'`);
      }
    }
    for (const match of masked.matchAll(/\b(?:globalThis\.)?console(?:\.[A-Za-z_$][\w$]*|\s*\[)/g)) {
      const directCall = /^(?:globalThis\.)?console\.(?:log|info|warn|error|debug|trace)\s*\(/.test(
        masked.slice(match.index),
      );
      if (!directCall) violations.push(`${relativePath}: aliased/computed console sink`);
    }
  }
  assert.deepEqual(violations, [], `production console output must use a structured serializer:\n${violations.join("\n")}`);
}

function assertExactTableRulesetRouting(root) {
  const table = readSource(join(root, "app/_runtime/lib/table/server.ts"));
  const exportedSection = (name, nextName) => {
    const start = table.indexOf(`export const ${name} =`);
    const end = table.indexOf(`export const ${nextName} =`, start + 1);
    assert.notEqual(start, -1, `${name} table service entry is missing`);
    assert.notEqual(end, -1, `${nextName} table service boundary is missing`);
    return table.slice(start, end);
  };
  const cases = [
    ["fetchTable", "setRoomModel", "info.ruleset_version !== RULESET_VERSION", "const messages ="],
    ["setRoomModel", "lockCharacter", "current.ruleset_version !== RULESET_VERSION", "update rooms set kp_model"],
    ["startGame", "sendAction", "info.ruleset_version !== RULESET_VERSION", "const where:"],
    ["sendAction", "acknowledgeDelivery", "info.ruleset_version !== RULESET_VERSION", "let sheet = ensureGear"],
    ["resolveRoll", "joinCombat", "roomInfo?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["joinCombat", "extraAttack", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["extraAttack", "endTurn", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["endTurn", "leaveFight", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["leaveFight", "resolveReact", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["resolveReact", "restNow", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["restNow", "cancelRest", "rules?.ruleset_version !== RULESET_VERSION", "const pc = ("],
    ["cancelRest", "castSpell", "rules?.ruleset_version !== RULESET_VERSION", "const pc = ("],
    ["castSpell", "useFeature", "rules?.ruleset_version !== RULESET_VERSION", "const row = ("],
    ["useFeature", "useHitDie", "rules?.ruleset_version !== RULESET_VERSION", "const row = ("],
    ["useHitDie", "kickMember", "rules?.ruleset_version !== RULESET_VERSION", "const row = ("],
  ];

  for (const [name, nextName, gateText, legacyBoundaryText] of cases) {
    const section = exportedSection(name, nextName);
    const authoritative = section.indexOf("AUTHORITATIVE_RULESET_VERSION");
    const gate = section.indexOf(gateText, authoritative);
    const legacyBoundary = section.indexOf(legacyBoundaryText, authoritative);
    assert.notEqual(authoritative, -1, `${name} is missing authoritative-v2 routing`);
    assert.notEqual(legacyBoundary, -1, `${name} is missing an auditable legacy boundary`);
    assert.ok(gate > authoritative && gate < legacyBoundary, `${name} must fail closed on exact ruleset_version before legacy logic`);
    assert.match(section.slice(gate, legacyBoundary), /return\s*\{\s*ok:\s*false as const/, `${name} must explicitly reject unknown ruleset_version`);
  }
}

function assertTypedRoomProposalBoundary(root) {
  const room = readSource(join(root, "app/_runtime/lib/room/durable-object.ts"));
  const adapter = readSource(join(root, "app/_runtime/lib/room/proposal-adapter.ts"));
  const legacyProposalKinds = [
    "resolveImprovisedAction", "resolveContest", "startEncounter", "requestClarification",
    "invitePartyMember", "cancelPartyInvitation", "leavePartyGroup", "transferPartyLeadership",
    "proposePartyMove", "moveIndividually", "resolveFreeAction", "startRest",
    "resolveDynamicDanger", "materializeDynamicDanger", "resolveNpcInteraction", "shareKnowledge",
    "resolveNpcAction", "resolveMeaningfulFailure", "rejectRepeatedAttempt", "raiseEndingCandidate",
    "concludeStory", "recordEpilogueChoice",
  ];
  const reachableLegacyBranches = legacyProposalKinds.filter((kind) =>
    room.includes(`proposal.kind === "${kind}"`) || room.includes(`proposal.kind !== "${kind}"`));
  assert.deepEqual(reachableLegacyBranches, [], `authoritative-v2 Room retains compact proposal branches: ${reachableLegacyBranches.join(", ")}`);
  assert.match(adapter, /validateProposal\(draftValue\)/, "Room proposal adapter must reuse the production KpProposalDraft validator");
  assert.match(room, /isCanonicalAuthorityRecoveryInput\(recovery\.rulesInput\)/, "random continuation recovery must remain a versioned ActionPlan/pending-answer input");
}

function assertSingleViewerProjector(root) {
  const room = readSource(join(root, "app/_runtime/lib/room/durable-object.ts"));
  assert.doesNotMatch(room, /projectionHash:\s*canonicalSha256/, "Room must not generate Viewer projectionHash outside Rules project");
  assert.doesNotMatch(room, /const lifecycleBase/, "successor lifecycle observations must reuse Rules project");
}

function assertAuthoritativeOuterBoundaries(root) {
  const authoritativeOuterFiles = [
    "app/api/game/route.ts",
    "app/table/[code]/table-client.tsx",
    "app/_runtime/components/play-table.tsx",
    "app/_runtime/lib/kp/authoritative.ts",
    "app/_runtime/lib/kp/authoritative-helpers.ts",
    "app/_runtime/lib/kp/authoritative-policy.ts",
    "app/_runtime/lib/kp/authoritative-types.ts",
    "app/_runtime/lib/room/action.ts",
    "app/_runtime/lib/room/archive.ts",
    "app/_runtime/lib/room/proposal-adapter.ts",
    "app/_runtime/lib/room/server.ts",
    "app/_runtime/lib/table/authoritative.ts",
    "app/_runtime/lib/table/authoritative-client.ts",
    "app/_runtime/lib/table/client.ts",
    "worker/index.ts",
  ];
  const violations = [];

  for (const relativePath of authoritativeOuterFiles) {
    const source = stripComments(readSource(join(root, relativePath)));
    if (/Math\.random\s*\(|crypto\.getRandomValues\s*\(|\broll(?:Die|Dice|D20|DiceExpr)\s*\(/.test(source)) {
      violations.push(`${relativePath}: authoritative randomness outside Room DO`);
    }
    if (/\b(?:FROM|INTO|UPDATE|DELETE\s+FROM)\s+(?:game_states|messages|session_logs)\b/i.test(source)) {
      violations.push(`${relativePath}: legacy active-state/narration table access`);
    }
  }
  assert.deepEqual(violations, [], `authoritative outer boundaries are violated:\n${violations.join("\n")}`);
}

export function assertV3ArchitectureGuards(root = defaultRepoRoot, { repositorySpecific = true } = {}) {
  assertRulesPublicSurface(root);
  assertImportBoundaries(root);
  assertSingleRulesAuthority(root);
  assertNoModuleScopeEffects(root);
  assertStaticRagInputs(root);
  assertStructuredProductionLogging(root);
  if (repositorySpecific) {
    assertExactTableRulesetRouting(root);
    assertTypedRoomProposalBoundary(root);
    assertSingleViewerProjector(root);
    assertAuthoritativeOuterBoundaries(root);
  }
}

async function main() {
  const { assertAllModules } = await import("../app/_runtime/lib/module/index.ts");
  assertAllModules();
  assertV3ArchitectureGuards(defaultRepoRoot);
  console.log("Module registry and V3 architecture guards are valid.");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
