/** A small linear lexer: mask literals/comments while preserving source offsets.
 * It deliberately does not parse template interpolation or infer missing diff context.
 */
export class SourceMasker {
  private blockDepth = 0;
  private quote = "";
  private rawEnd = "";
  private triple = false;
  private verbatim = false;
  private previousLine = 0;
  private tokenPrefix = "";
  private readonly parentheses: boolean[] = [];
  private readonly python: boolean;
  private readonly javascript: boolean;
  private readonly rust: boolean;
  private readonly hashComments: boolean;
  private readonly backticks: boolean;
  private readonly textBlocks: boolean;
  private readonly csharp: boolean;
  private readonly cpp: boolean;

  constructor(filename: string) {
    const name = filename.toLowerCase();
    this.python = name.endsWith(".py");
    this.rust = name.endsWith(".rs");
    this.hashComments = this.python || /\.(?:rb|php)$/.test(name);
    this.backticks = /\.(?:go|[cm]?[jt]sx?|vue|svelte)$/.test(name);
    this.javascript = /\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(name);
    this.textBlocks = /\.(?:java|kt|cs)$/.test(name);
    this.csharp = name.endsWith(".cs");
    this.cpp = /\.(?:cpp|c)$/.test(name);
  }

  mask(line: string, number: number): { code: string; comments: string; templateStarts: number[]; blockStarts: number[] } {
    if (number !== this.previousLine + 1) {
      this.blockDepth = 0;
      this.quote = "";
      this.rawEnd = "";
      this.triple = false;
      this.verbatim = false;
      this.tokenPrefix = "";
      this.parentheses.length = 0;
    }
    this.previousLine = number;
    const code = Array<string>(line.length).fill(" ");
    const comments = Array<string>(line.length).fill(" ");
    let i = 0;
    let prefix = this.tokenPrefix;
    // Regexp-vs-division needs the preceding token, not the entire line. Keeping
    // an ever-growing prefix caused quadratic work on long arithmetic lines.
    const appendPrefix = (text: string) => {
      for (const char of text) {
        if (/\s/.test(char)) {
          if (!prefix.endsWith(" ")) prefix = (prefix + " ").slice(-64);
        } else prefix = (prefix + char).slice(-64);
      }
    };
    let continued = false;
    const templateStarts: number[] = [];
    const blockStarts: number[] = [];
    while (i < line.length) {
      if (this.blockDepth) {
        if (this.rust && line.startsWith("/*", i)) {
          this.blockDepth++; i += 2;
        } else if (line.startsWith("*/", i)) {
          this.blockDepth--; i += 2;
        } else i++;
        continue;
      }
      if (this.rawEnd) {
        if (line.startsWith(this.rawEnd, i)) { i += this.rawEnd.length; this.rawEnd = ""; }
        else i++;
        continue;
      }
      if (this.quote) {
        if (this.verbatim && line.startsWith('""', i)) { i += 2; continue; }
        if (!this.verbatim && !(this.quote === "`" && !this.javascript) && line[i] === "\\") {
          if (i === line.length - 1) continued = true;
          i += 2; continue;
        }
        const delimiter = this.triple ? this.quote.repeat(3) : this.quote;
        if (line.startsWith(delimiter, i)) {
          i += delimiter.length;
          this.quote = "";
          this.triple = false;
          this.verbatim = false;
        } else i++;
        continue;
      }
      if ((!this.python && line.startsWith("//", i)) || (this.hashComments && line[i] === "#")) {
        for (let j = i; j < line.length; j++) comments[j] = line[j];
        break;
      }
      if (!this.python && line.startsWith("/*", i)) {
        blockStarts.push(i);
        this.blockDepth = 1; i += 2; continue;
      }
      if (this.rust && (i === 0 || !/[\w]/.test(line[i - 1]))) {
        const raw = /^(?:br|cr|r)(#{0,255})"/.exec(line.slice(i));
        if (raw) { this.rawEnd = '"' + raw[1]; i += raw[0].length; appendPrefix(" literal "); continue; }
      }
      if (this.cpp && (i === 0 || !/[\w]/.test(line[i - 1]))) {
        const raw = /^(?:u8|u|U|L)?R"([^\s()\\]{0,16})\(/.exec(line.slice(i));
        if (raw) { this.rawEnd = ")" + raw[1] + '"'; i += raw[0].length; appendPrefix(" literal "); continue; }
      }
      if (this.csharp && line.startsWith('@"', i)) {
        this.quote = '"'; this.verbatim = true; i += 2; appendPrefix(" literal "); continue;
      }
      const char = line[i];
      // Rust lifetimes ('a / 'static) are identifiers, not unterminated char strings.
      const lifetime = this.rust && char === "'" && /^'[A-Za-z_][A-Za-z0-9_]*(?![A-Za-z0-9_])/.exec(line.slice(i));
      if (lifetime && line[i + lifetime[0].length] !== "'") {
        for (let j = 0; j < lifetime[0].length; j++) code[i + j] = line[i + j];
        appendPrefix(lifetime[0]); i += lifetime[0].length; continue;
      }
      if (char === '"' || char === "'" || (this.backticks && char === "`")) {
        this.quote = char;
        if (this.javascript && char === "`") templateStarts.push(i);
        this.triple = (this.python || (this.textBlocks && char === '"')) && line.startsWith(char.repeat(3), i);
        i += this.triple ? 3 : 1;
        appendPrefix(" literal ");
        continue;
      }
      // A slash following an operand is division; after an operator it may start a regexp.
      if (this.javascript && char === "/" && (/(?:=>|[=(:,[!&|?{;]|\breturn|\byield|\bthrow)\s*$/.test(prefix) || !prefix.trim())) {
        let j = i + 1;
        let inClass = false;
        for (; j < line.length; j++) {
          if (line[j] === "\\") { j++; continue; }
          if (line[j] === "[") inClass = true;
          if (line[j] === "]") inClass = false;
          if (line[j] === "/" && !inClass) break;
        }
        if (j < line.length) {
          j++;
          while (j < line.length && /[a-z]/i.test(line[j])) j++;
          i = j; appendPrefix(" literal "); continue;
        }
      }
      code[i] = char;
      if (this.javascript && char === "(") {
        const control = /(?<![\w$])(?:if|while|for|with|switch|catch)\s*$/.exec(prefix);
        this.parentheses.push(Boolean(control && !/\.\s*$/.test(prefix.slice(0, control.index))));
      } else if (this.javascript && char === ")" && this.parentheses.pop()) {
        // A control header ends before a statement, where a regexp is legal.
        // A normal call/expression ')' remains an operand before division.
        prefix = "; ";
        i++;
        continue;
      }
      appendPrefix(char);
      i++;
    }
    // Ordinary literals span a newline only with an explicit continuation.
    // Raw/text blocks/templates preserve state; a diff hunk gap resets all state.
    if (this.quote !== "`" && !this.triple && !this.verbatim && !continued) this.quote = "";
    this.tokenPrefix = this.javascript ? (prefix + " ").slice(-64) : "";
    return { code: code.join(""), comments: comments.join(""), templateStarts, blockStarts };
  }
}
