/** Lint and type-checker settings that decide whether Python code passes: ruff, flake8, pylint and mypy. The Python twin of the
 * tsconfig and ESLint checks in tampering.ts. It compares the lists and switches of two versions of one config file and
 * reports where a check was switched off. It is a reader for these settings, not a TOML or INI parser, and it never runs a tool. */

export type Report = (line: number, snippet: string, reason: string) => void;

interface Entry { section: string; key: string; value: string; line: number }

/** Brackets and braces still open once strings and comments are blanked: a TOML array or inline table runs until it is zero. */
function openBrackets(text: string): number {
  const bare = text.replace(/"(?:\\.|[^"\\\n])*"|'[^'\n]*'/g, '""').replace(/#.*$/gm, "");
  let depth = 0;
  for (const char of bare) {
    if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") depth--;
  }
  return depth;
}

/** Key/value pairs with the `[section]` they sit in. A value goes on over lines: until its brackets close in TOML, as
 * long as the next line is indented in INI files. */
export function configEntries(text: string, toml: boolean): Entry[] {
  const lines = text.split(/\r?\n/);
  const entries: Entry[] = [];
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:[#;].*)?$/.exec(trimmed);
    if (header) { section = header[1].replace(/["']/g, ""); continue; }
    const pair = /^("[^"]*"|'[^']*'|[\w.-]+)\s*=\s*(.*)$/.exec(trimmed);
    if (!pair) continue;
    const start = i;
    let value = pair[2];
    if (toml) {
      while (openBrackets(value) > 0 && i + 1 < lines.length) value += "\n" + lines[++i];
    } else {
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s*[#;]/.test(lines[i + 1])) value += "\n" + lines[++i].trim();
    }
    entries.push({ section, key: pair[1].replace(/["']/g, ""), value, line: start + 1 });
  }
  return entries;
}

/** The members of a list value: the quoted strings of a TOML array, or the words and codes of an INI list. */
function members(value: string): string[] {
  const quoted = [...value.matchAll(/"((?:\\.|[^"\\\n])*)"|'([^'\n]*)'/g)].map(match => (match[1] ?? match[2]).trim()).filter(Boolean);
  if (quoted.length) return quoted;
  return value.replace(/[#;].*$/gm, "").split(/[\s,]+/).map(word => word.trim()).filter(Boolean);
}

/** Does a rule selector (`ALL`, `E`, `E5`, `E501`) cover a rule code? A selector is a prefix inside one linter: `B` is bugbear and
 * does not reach `BLE001`; `C90` reaches `C901`. Names that are not codes (pylint's) match as plain prefixes. */
function covers(selector: string, code: string): boolean {
  if (selector === "ALL") return true;
  const wanted = /^([A-Za-z]+)(\d*)$/.exec(selector), actual = /^([A-Za-z]+)(\d*)$/.exec(code);
  if (!wanted || !actual) return code.startsWith(selector);
  // Ruff renamed the flake8-type-checking prefix from TCH to TC; configs in the wild still use both.
  const linter = (letters: string) => letters.toUpperCase().replace(/^TCH$/, "TC");
  return linter(wanted[1]) === linter(actual[1]) && actual[2].startsWith(wanted[2]);
}

const truthy = (value: string) => /^(?:true|1|yes|on)$/i.test(value.replace(/\s*[#;].*$/, "").trim());

function toolOf(file: string, section: string): "ruff" | "flake8" | "pylint" | "mypy" | null {
  const name = section.toLowerCase();
  if (/(?:^|\/)\.?ruff\.toml$/i.test(file) || name.startsWith("tool.ruff")) return "ruff";
  if (name === "flake8" || /(?:^|\/)\.flake8$/i.test(file)) return "flake8";
  if (/messages[ _]control/.test(name)) return "pylint";
  if (name === "mypy" || name.startsWith("mypy-") || name.startsWith("tool.mypy") || /(?:^|\/)\.?mypy\.ini$/i.test(file)) return "mypy";
  return null;
}

// Lists whose growth switches checks off.
const IGNORE_LISTS = {
  ruff: /^(?:extend-)?(?:ignore|per-file-ignores)$/,
  flake8: /^(?:extend[-_])?ignore$|^per[-_]file[-_]ignores$/,
  pylint: /^disable$/,
  mypy: /^disable_error_code$/,
};
const MYPY_SWITCHES = /^(?:strict|disallow_untyped_defs|disallow_incomplete_defs|disallow_untyped_calls|disallow_any_generics|disallow_untyped_decorators|disallow_subclassing_any|check_untyped_defs|warn_return_any|warn_unreachable|warn_redundant_casts|no_implicit_optional|strict_optional)$/;

/** Codes a per-file list ignores, without the paths: a flake8 value reads `tests/*: S101`, a ruff table `"tests/*" = ["S101"]`. */
const looksLikeCode = (word: string) => !/[/*:]/.test(word);

/** Report the places where a ruff, flake8, pylint or mypy setting got easier to pass between two versions of a config file. */
export function analyzePythonConfig(file: string, oldText: string, newText: string, report: Report): void {
  const toml = /\.toml$/i.test(file);
  const before = configEntries(oldText, toml), after = configEntries(newText, toml);
  // A tool that was not configured here before is being adopted: its first ignores are a starting point, not a loosening.
  const configured = new Set(before.map(entry => toolOf(file, entry.section)).filter(Boolean));

  // Every code a tool ignores anywhere (globally or for some files), with the line it is first written on. Paths are not
  // compared: moving `tests/*` to `src/tests/*` keeps the same checks off. A code covered by a shorter ignored prefix is not new.
  const ignored = (entries: Entry[]) => {
    const found = new Map<string, Map<string, number>>();
    for (const entry of entries) {
      const tool = toolOf(file, entry.section);
      if (!tool) continue;
      const perFile = tool === "ruff" ? /per-file-ignores$/i.test(entry.section) : false;
      if (!perFile && !IGNORE_LISTS[tool].test(entry.key)) continue;
      const bucket = found.get(tool) ?? new Map<string, number>();
      found.set(tool, bucket);
      for (const code of members(entry.value)) if (looksLikeCode(code) && !bucket.has(code)) bucket.set(code, entry.line);
    }
    return found;
  };
  const was = ignored(before);
  // Ignoring a code the tool did not check before switches nothing off: a rule enabled in the same change with its existing
  // violations listed per file ("debt register"), or a rule outside the tool's default set.
  const enforced = (tool: string, code: string) => {
    if (tool !== "ruff" && tool !== "flake8") return true;
    const chosen = (key: RegExp) => before.filter(entry => toolOf(file, entry.section) === tool && key.test(entry.key)).flatMap(entry => members(entry.value));
    const explicit = chosen(/^select$/), extra = chosen(/^extend[-_]select$/);
    const base = explicit.length ? explicit : tool === "ruff" ? ["E4", "E7", "E9", "F"] : ["E", "F", "W", "C90"];
    return [...base, ...extra].some(selected => covers(selected, code) || covers(code, selected));
  };
  for (const [tool, bucket] of ignored(after)) {
    if (!configured.has(tool as "ruff")) continue;
    const old = [...(was.get(tool)?.keys() ?? [])];
    const fresh = [...bucket].filter(([code]) => !old.some(known => covers(known, code)) && enforced(tool, code));
    if (fresh.length) report(Math.min(...fresh.map(([, line]) => line)), `${tool} ignore: ${fresh.slice(0, 4).map(([code]) => "+" + code).join(", ")}${fresh.length > 4 ? ", …" : ""}`, "Lint or type checks switched off in the configuration");
  }

  // `select` narrowed: a code the old list enforced that no entry of the new list covers (a prefix covers its codes).
  const selected = (entries: Entry[], tool: string) => entries.filter(entry => toolOf(file, entry.section) === tool && entry.key === "select").flatMap(entry => members(entry.value));
  for (const tool of ["ruff", "flake8"]) {
    const old = selected(before, tool), now = selected(after, tool);
    if (!old.length || !now.length || now.includes("ALL")) continue;
    const dropped = old.filter(code => !now.some(kept => covers(kept, code)));
    if (dropped.length) {
      const line = after.find(entry => toolOf(file, entry.section) === tool && entry.key === "select")?.line ?? 1;
      report(line, `${tool} select: ${dropped.slice(0, 4).map(code => "-" + code).join(", ")}${dropped.length > 4 ? ", …" : ""}`, "Lint rules removed from the selected set");
    }
  }

  // mypy: a strictness switch turned off, or a module whose errors are now ignored.
  const switches = new Map(before.filter(entry => toolOf(file, entry.section) === "mypy" && MYPY_SWITCHES.test(entry.key)).map(entry => [`${entry.section}|${entry.key}`, truthy(entry.value)]));
  for (const entry of after) {
    if (toolOf(file, entry.section) !== "mypy" || !MYPY_SWITCHES.test(entry.key)) continue;
    if (switches.get(`${entry.section}|${entry.key}`) === true && !truthy(entry.value)) report(entry.line, `mypy ${entry.key}: true → false`, "Type checker strictness switched off");
  }
  const ignoring = (entries: Entry[]) => entries.filter(entry => toolOf(file, entry.section) === "mypy" && entry.key === "ignore_errors" && truthy(entry.value));
  const before_ = ignoring(before), after_ = ignoring(after);
  if (configured.has("mypy") && after_.length > before_.length) {
    const known = new Set(before_.map(entry => entry.section));
    const fresh = after_.find(entry => !known.has(entry.section)) ?? after_[after_.length - 1];
    report(fresh.line, `mypy ignore_errors = true (${fresh.section})`, "Type errors ignored for a module");
  }
}
