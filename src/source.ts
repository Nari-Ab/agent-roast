/** A small linear lexer: mask literals/comments while preserving source offsets.
 * It intentionally does not parse template interpolation or infer missing diff context.
 */
export class SourceMasker {
  private blockComment = false;
  private quote = "";
  private triple = false;
  private previousLine = 0;
  private python: boolean;
  private javascript: boolean;
  private hashComments: boolean;
  private backticks: boolean;

  constructor(filename: string) {
    this.python = filename.endsWith(".py");
    this.hashComments = this.python || filename.endsWith(".rb");
    this.backticks = /\.(?:go|[cm]?[jt]sx?|vue|svelte)$/.test(filename);
    this.javascript = /\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(filename);
  }

  mask(line: string, number: number): { code: string; comments: string } {
    if (number !== this.previousLine + 1) {
      this.blockComment = false;
      this.quote = "";
      this.triple = false;
    }
    this.previousLine = number;
    const code = Array<string>(line.length).fill(" ");
    const comments = Array<string>(line.length).fill(" ");
    let i = 0;
    let prefix = "";
    while (i < line.length) {
      if (this.blockComment) {
        if (line.startsWith("*/", i)) { this.blockComment = false; i += 2; }
        else i++;
        continue;
      }
      if (this.quote) {
        if (line[i] === "\\") { i += 2; continue; }
        const delimiter = this.triple ? this.quote.repeat(3) : this.quote;
        if (line.startsWith(delimiter, i)) {
          i += delimiter.length;
          this.quote = "";
          this.triple = false;
        } else i++;
        continue;
      }
      if ((!this.python && line.startsWith("//", i)) || (this.hashComments && line[i] === "#")) {
        for (let j = i; j < line.length; j++) comments[j] = line[j];
        break;
      }
      if (!this.python && line.startsWith("/*", i)) {
        this.blockComment = true; i += 2; continue;
      }
      const char = line[i];
      if (char === '"' || char === "'" || (this.backticks && char === "`")) {
        this.quote = char;
        this.triple = this.python && line.startsWith(char.repeat(3), i);
        i += this.triple ? 3 : 1;
        prefix += " literal ";
        continue;
      }
      // A slash following an operand is division; after an operator it may start a regexp.
      if (this.javascript && char === "/" && (/(?:[=(:,[!&|?{;]|\breturn|\byield)\s*$/.test(prefix) || !prefix.trim())) {
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
          while (/[a-z]/i.test(line[j] || "") && j < line.length) j++;
          i = j; prefix += " literal "; continue;
        }
      }
      code[i] = char;
      prefix += char;
      i++;
    }
    // Single-line quoted strings do not leak into later hunks; triple strings,
    // templates and block comments do retain their state over contiguous lines.
    if (this.quote !== "`" && !this.triple) this.quote = "";
    return { code: code.join(""), comments: comments.join("") };
  }
}
