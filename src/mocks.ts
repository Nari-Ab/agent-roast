import { SourceMasker } from "./source.js";

/** A test that replaces the function it checks with a mock and then asserts on the mock's own output: `jest.mock("./price", () =>
 * ({ price: () => 42 }))` followed by `expect(price(cart)).toBe(42)`, or `monkeypatch.setattr(cart, "total", lambda: 42)` followed
 * by `assert cart.total() == 42` in the same test. The assertion cannot fail, whatever the real code does. This reads one test
 * file (text only). The replacement has to be a fake (a factory, a configured return value, a lambda) and it has to be in force
 * where the assertion is: for JavaScript a `jest.mock` or `vi.mock` at the top level of the file, which is hoisted above the
 * imports (`doMock`, and a mock made inside a hook or a `describe`, come too late for an import that was already loaded); for
 * Python the same test or `with` block. The assertion has to call the replaced function itself. A mock that keeps the real
 * implementation (`requireActual`, `wraps=`), a manual mock without a configured value, and an assertion about how a mock was
 * called are not reported. */

export interface MockedSubject {
  /** `specifier::name` for JavaScript, the dotted target for Python: what makes two reports the same one. */
  key: string;
  line: number;
  snippet: string;
  reason: string;
}

type Language = "js" | "py";
type Range = [number, number];

/** The text of the file with strings and comments blanked (offsets kept), next to the raw text. */
function views(text: string, language: Language): { raw: string; code: string; lines: string[]; starts: number[]; lineOf: (index: number) => number } {
  const masker = new SourceMasker(language === "js" ? "file.ts" : "file.py");
  const lines = text.split(/\r?\n/);
  const code = lines.map((line, index) => masker.mask(line, index + 1).code).join("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length + 1; }
  const lineOf = (index: number) => {
    let low = 0, high = starts.length - 1;
    while (low < high) { const middle = (low + high + 1) >>> 1; if (starts[middle] <= index) low = middle; else high = middle - 1; }
    return low + 1;
  };
  return { raw: lines.join("\n"), code, lines, starts, lineOf };
}

/** Index of the parenthesis that closes the one at `open`, or -1. Strings are blanked in `code`, so only real brackets count. */
function closing(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length && i - open < 20000; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

const STRING_AFTER = /^\s*(['"`])([^'"`\n]+)\1/;
const within = (range: Range | null, index: number) => !range || (index >= range[0] && index <= range[1]);
const innermost = (ranges: Range[], index: number): Range | null =>
  ranges.filter(range => index >= range[0] && index <= range[1]).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]))[0] ?? null;

/** JavaScript and TypeScript: top-level `jest.mock` and `vi.mock` against what the file imports and asserts. */
function javascript(text: string): MockedSubject[] {
  const { raw, code, lines, lineOf } = views(text, "js");
  // The bodies of tests and hooks: `const total = price(cart)` and the `expect(total)` that follows belong to one of them.
  const callbacks: Range[] = [];
  for (const match of code.matchAll(/(?<![\w$.])(?:it|test|beforeEach|beforeAll|afterEach|afterAll)(?:\s*\.\s*\w+)*\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const end = closing(code, open);
    if (end > 0) callbacks.push([open, end]);
  }

  /** True when nothing encloses `index`: not a function body, a block or a call's arguments. */
  const programLevel = (index: number) => {
    let depth = 0;
    for (let i = 0; i < index; i++) {
      const char = code[i];
      if (char === "(" || char === "{" || char === "[") depth++;
      else if (char === ")" || char === "}" || char === "]") depth--;
    }
    return depth === 0;
  };

  interface Mock { index: number; fake: boolean }
  const mocked = new Map<string, Mock>();
  for (const match of code.matchAll(/(?<![\w$.])(?:jest|vi)\s*\.\s*mock\s*\(/g)) {
    if (!programLevel(match.index)) continue;
    const open = match.index + match[0].length - 1;
    const specifier = STRING_AFTER.exec(raw.slice(open + 1))?.[2];
    if (!specifier) continue;
    const end = closing(code, open);
    const args = end > 0 ? raw.slice(open, end) : "";
    // A factory that spreads the real module keeps the real function; the others are replaced wholesale.
    if (/requireActual|importActual|importOriginal/.test(args)) continue;
    // So does a factory that is handed the real module's loader and calls it, whatever the parameter is called:
    // `vi.mock("./client", async (original) => ({ ...(await original<typeof import("./client")>()), send: vi.fn() }))`.
    const loader = /^\(\s*(['"`])[^'"`\n]+\1\s*,\s*(?:async\s+)?(?:function\s*[\w$]*\s*)?\(\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(args)?.[2];
    if (loader && new RegExp(`(?<![\\w$.])${loader.replace(/\$/g, "\\$")}\\s*(?:<[^\\n]*?>)?\\s*\\(`).test(args.slice(args.indexOf(loader) + loader.length))) continue;
    // `{ spy: true }` is vitest's automock that still calls the real function.
    const factory = /^\(\s*(['"`])[^'"`\n]+\1\s*,/.test(args) && !/,\s*\{\s*spy\s*:\s*true\b/.test(args);
    if (!mocked.has(specifier)) mocked.set(specifier, { index: match.index, fake: factory });
  }
  if (!mocked.size) return [];

  // What each local name is: [specifier, exported name]; a namespace import keeps the member for the call site.
  const bindings = new Map<string, { specifier: string; name: string; namespace: boolean }>();
  const bind = (clause: string, specifier: string) => {
    const named = /\{([^}]*)\}/.exec(clause)?.[1];
    for (const part of (named ?? "").split(",")) {
      const item = part.trim().replace(/^type\s+/, "");
      if (!item) continue;
      const [imported, local] = item.includes(" as ") ? item.split(/\s+as\s+/) : item.includes(":") ? item.split(/\s*:\s*/) : [item, item];
      if (/^[\w$]+$/.test(imported) && /^[\w$]+$/.test(local)) bindings.set(local, { specifier, name: imported, namespace: false });
    }
    const namespace = /\*\s*as\s+([\w$]+)/.exec(clause)?.[1];
    if (namespace) bindings.set(namespace, { specifier, name: "*", namespace: true });
    const standalone = /^\s*([\w$]+)\s*(?:,|$)/.exec(clause.replace(/\{[^}]*\}/, ""))?.[1];
    if (standalone && standalone !== "type" && !/^\s*\{/.test(clause)) bindings.set(standalone, { specifier, name: "default", namespace: false });
  };
  for (const match of code.matchAll(/\bimport\s+([^;'"`]*?)\bfrom\b/g)) {
    const specifier = STRING_AFTER.exec(raw.slice(match.index + match[0].length))?.[2];
    if (specifier) bind(match[1], specifier);
  }
  for (const match of code.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?require\s*\(/g)) {
    const specifier = STRING_AFTER.exec(raw.slice(match.index + match[0].length))?.[2];
    if (!specifier) continue;
    if (match[1].startsWith("{")) bind(match[1], specifier);
    else bindings.set(match[1], { specifier, name: "*", namespace: true });
  }

  const found = new Map<string, MockedSubject>();
  for (const match of code.matchAll(/(?<![\w$.])expect\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const end = closing(code, open);
    if (end < 0) continue;
    // The checked value starts with a call to something imported (`price(...)`, `await price(...)`, `lib.price(...)`), or is a
    // name the same test assigned from one.
    const checked = code.slice(open + 1, end);
    let call = /^\s*(?:await\s+)?([A-Za-z_$][\w$]*)\s*(?:\.\s*([A-Za-z_$][\w$]*)\s*)?\(/.exec(checked);
    const variable = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(checked)?.[1];
    if (!call && variable) {
      const from = innermost(callbacks, match.index)?.[0] ?? 0;
      const name = variable.replace(/\$/g, "\\$");
      const assigned = [...code.slice(from, match.index).matchAll(new RegExp(`(?<![\\w$.])${name}\\s*=(?!=)\\s*(?:await\\s+)?([A-Za-z_$][\\w$]*)\\s*(?:\\.\\s*([A-Za-z_$][\\w$]*)\\s*)?\\(`, "g"))].at(-1);
      if (assigned) call = assigned;
    }
    if (!call) continue;
    const binding = bindings.get(call[1]);
    const mock = binding && mocked.get(binding.specifier);
    if (!binding || !mock) continue;
    const name = binding.namespace ? call[2] : call[2] ? undefined : binding.name;
    if (!name) continue;
    // A manual mock or an automock only fakes a result once the test says what it returns.
    const identifier = call[1].replace(/\$/g, "\\$");
    const configured = new RegExp(`(?<![\\w$.])${identifier}\\b[^;]{0,80}?\\.\\s*mock(?:Return|Resolved|Rejected|Implementation)\\w*\\s*\\(`).test(raw);
    if (!mock.fake && !configured) continue;
    const key = `${binding.specifier}::${name}`;
    if (found.has(key)) continue;
    const line = lineOf(mock.index);
    found.set(key, {
      key, line, snippet: lines[line - 1].trim().slice(0, 120),
      reason: `assertion on the output of ${name}(), which this test replaces with a mock of "${binding.specifier}"`,
    });
  }
  return [...found.values()];
}

const DOTTED = /^[A-Za-z_][\w.]*$/;

/** Python: `patch`, `mocker.patch`, `patch.object`, `monkeypatch.setattr` against what the same test asserts. */
function python(text: string): MockedSubject[] {
  const { raw, code, lines, starts, lineOf } = views(text, "py");
  // Local names for modules: `import a.b as m` and `from a import b` make `m.fn` and `b.fn` the dotted `a.b.fn`.
  const alias = new Map<string, string>();
  for (const match of code.matchAll(/^[ \t]*import\s+([\w.]+)\s+as\s+(\w+)/gm)) alias.set(match[2], match[1]);
  for (const match of code.matchAll(/^[ \t]*from\s+([\w.]+)\s+import\s+([^\n(]+)/gm)) {
    for (const part of match[2].split(",")) {
      const [name, local] = part.trim().split(/\s+as\s+/);
      if (/^\w+$/.test(name)) alias.set(local || name, `${match[1]}.${name}`);
    }
  }
  // An alias stands for a module only when an attribute is reached through it (`m.fn`); a bare imported name is the function
  // itself, which a patch of the module attribute does not change.
  const expand = (dotted: string) => {
    const [head, ...rest] = dotted.split(".");
    return rest.length && alias.has(head) ? [alias.get(head)!, ...rest].join(".") : dotted;
  };
  /** The object of `patch.object(obj, "name")` or `monkeypatch.setattr(obj, "name", ...)` is the module or class itself. */
  const expandObject = (dotted: string) => {
    const [head, ...rest] = dotted.split(".");
    return alias.has(head) ? [alias.get(head)!, ...rest].join(".") : dotted;
  };

  // Function bodies as line ranges (0-based, inclusive), by indentation.
  const codeLines = code.split("\n");
  const indent = (line: string) => line.length - line.trimStart().length;
  const functions: { range: Range; header: number }[] = [];
  codeLines.forEach((line, i) => {
    if (!/^\s*(?:async\s+)?def\s+\w+/.test(line)) return;
    let end = i;
    for (let j = i + 1; j < codeLines.length; j++) {
      if (!codeLines[j].trim()) continue;
      if (indent(codeLines[j]) <= indent(line)) break;
      end = j;
    }
    functions.push({ range: [i, end], header: i });
  });
  const lineIndex = (offset: number) => lineOf(offset) - 1;
  /** The function a line belongs to; a decorator line belongs to the `def` below it. */
  const scopeOf = (line: number): Range | null => {
    if (/^\s*@/.test(codeLines[line] ?? "")) {
      for (let j = line; j < codeLines.length && j < line + 40; j++) {
        const owner = functions.find(fn => fn.header === j);
        if (owner) return owner.range;
      }
    }
    return innermost(functions.map(fn => fn.range), line);
  };

  /** The lines a `with` block covers, when `line` is the statement that opens one. */
  const blockOf = (line: number): Range | null => {
    if (!/^\s*with\b/.test(codeLines[line] ?? "")) return null;
    let end = line;
    for (let j = line + 1; j < codeLines.length; j++) {
      if (!codeLines[j].trim()) continue;
      if (indent(codeLines[j]) <= indent(codeLines[line])) break;
      end = j;
    }
    return [line, end];
  };

  /** The `with` statement a line belongs to when it sits in that statement's header, which may run over several lines
   * (`with a(), \\\n        b():`); null for a line anywhere else. */
  const headerLine = (line: number): number | null => {
    for (let k = line; k >= 0 && k > line - 8; k--) {
      if (!/^\s*with\b/.test(codeLines[k] ?? "")) continue;
      const head = codeLines.slice(k, line).join("\n");
      const open = (head.match(/[([{]/g) ?? []).length - (head.match(/[)\]}]/g) ?? []).length;
      return k === line || open > 0 || codeLines.slice(k, line).every(text => /\\\s*$/.test(text)) ? k : null;
    }
    return null;
  };

  // The same target is often patched in several tests; each patch is in force in its own function or block.
  const patched = new Map<string, { index: number; end: number; object: string | null; scope: Range | null }[]>();
  const patchCall = /(?<![\w.])(?:(?:mock|unittest\s*\.\s*mock)\s*\.\s*)?patch(\s*\.\s*object)?\s*\(|(?<![\w.])mocker\s*\.\s*patch(\s*\.\s*object)?\s*\(|(?<![\w.])monkeypatch\s*\.\s*setattr\s*\(/g;
  for (const match of code.matchAll(patchCall)) {
    const open = match.index + match[0].length - 1;
    const end = closing(code, open);
    if (end < 0) continue;
    const args = raw.slice(open + 1, end);
    if (/\bwraps\s*=/.test(args)) continue; // calls through to the real thing
    // A string names the target by its import path; an object and a name are read through the file's own aliases.
    const target = STRING_AFTER.exec(args);
    const parts = target ? null : /^\s*([A-Za-z_][\w.]*)\s*,\s*(['"])(\w+)\2/.exec(args);
    const key = target ? target[2] : parts ? `${expandObject(parts[1])}.${parts[3]}` : undefined;
    if (!key || !DOTTED.test(key)) continue;
    const line = lineIndex(match.index);
    // A fixture's `mocker.patch` and `monkeypatch.setattr` are in force at once. `patch(...)` is when it is a decorator, an item of a `with`
    // statement (also on a continuation line), or started; a patcher that is only assigned (`stuck = patch.object(...)`) is entered somewhere else.
    const fixture = /^(?:mocker|monkeypatch)/.test(match[0]);
    const header = headerLine(line);
    const inForce = fixture || /^\s*@/.test(codeLines[line] ?? "") || header !== null
      || /^\s*\.\s*start\s*\(/.test(code.slice(end + 1)) || /enter_context\s*\(\s*$/.test(code.slice(Math.max(0, match.index - 40), match.index));
    if (!inForce) continue;
    patched.set(key, [...(patched.get(key) ?? []), { index: match.index, end, object: parts ? parts[1] : null, scope: (header !== null ? blockOf(header) : null) ?? blockOf(line) ?? scopeOf(line) }]);
  }
  if (!patched.size) return [];

  const found = new Map<string, MockedSubject>();
  const assertion = /^[ \t]*assert\s+(?:not\s+)?([A-Za-z_][\w.]*)\s*(\()?|\bself\s*\.\s*assert\w*\s*\(\s*([A-Za-z_][\w.]*)\s*(\()?/gm;
  for (const match of code.matchAll(assertion)) {
    let callee: string | undefined = (match[1] ?? match[3]) && (match[2] ?? match[4]) ? (match[1] ?? match[3]) : undefined;
    const variable = !callee ? (match[1] ?? match[3]) : undefined;
    if (!callee && variable && /^[A-Za-z_]\w*$/.test(variable)) {
      // `total = price(cart)` earlier in the same function, then `assert total == 42`.
      const owner = scopeOf(lineIndex(match.index));
      const from = owner ? starts[owner[0]] ?? 0 : 0;
      const assigned = [...code.slice(from, match.index).matchAll(new RegExp(`^[ \\t]*${variable}\\s*=(?!=)\\s*(?:await\\s+)?([A-Za-z_][\\w.]*)\\s*\\(`, "gm"))].at(-1);
      callee = assigned?.[1];
    }
    if (!callee) continue;
    const key = expand(callee);
    if (found.has(key)) continue;
    const at = lineIndex(match.index);
    // In force only inside the function or `with` block it was made in, and only after it was made (a decorator covers its function).
    const patch = patched.get(key)?.find(item => item.scope && within(item.scope, at)
      && (at >= lineIndex(item.index) || /^\s*@/.test(codeLines[lineIndex(item.index)] ?? "")));
    if (!patch) continue;
    // Code that is handed the patched object (`launcher.install(gw, ...)`) may wrap or swap the attribute again after the patch.
    if (patch.object) {
      const handed = new RegExp(`(?<![\\w.])(?!(?:[\\w.]*\\.)?(?:patch|object|setattr)\\b)[A-Za-z_][\\w.]*\\(\\s*(?:[^()]*,\\s*)?${patch.object.replace(/[.$]/g, "\\$&")}\\s*[,)]`);
      if (handed.test(code.slice(patch.end + 1, match.index))) continue;
    }
    // The code under test may be a method of the patched object (`Op._register()` rewires `Op.forward`): another method of it called after the patch.
    if (patch.object) {
      const attribute = key.slice(key.lastIndexOf(".") + 1);
      const receiver = new RegExp(`(?<![\\w.])${patch.object.replace(/[.$]/g, "\\$&")}\\s*\\.\\s*(?!${attribute}\\b)\\w+\\s*\\(`);
      if (receiver.test(code.slice(patch.end + 1, match.index))) continue;
    }
    const line = lineOf(patch.index);
    found.set(key, {
      key, line, snippet: lines[line - 1].trim().slice(0, 120),
      reason: `assertion on the output of ${callee}(), which this test replaces with a mock`,
    });
  }
  return [...found.values()];
}

/** Assertions on a mock's own output in one version of a test file. */
export function mockedSubjects(text: string, file: string): MockedSubject[] {
  // The tests of jest, vitest and pytest's monkeypatch check what a mock returns on purpose.
  if (/mock|monkeypatch/i.test(file)) return [];
  if (/\.[cm]?[jt]sx?$/i.test(file)) return javascript(text);
  if (/\.py$/i.test(file)) return python(text);
  return [];
}
