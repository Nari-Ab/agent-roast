export interface AiAttributionResult {
  isAiAttributed: boolean;
  signatures: string[];
}

/** Explicit agent labels and known agent addresses, not substrings in human names
 * or a claim that arbitrary automation is AI. These remain attribution signals,
 * not proof of who wrote the code or an authorization boundary. */
const AGENT_IDENTITIES = [
  { name: "claude", label: /^(?:Claude(?: Code| Agent| AI)?|Anthropic Agent)(?:\s*\((?:Anthropic|v?[\d.]+)\))?$/i, email: /^(?:noreply|claude)@anthropic\.com$/i },
  { name: "cursor", label: /^(?:Cursor(?: Agent| AI)?|Anysphere Agent)$/i, email: /^(?:cursor|noreply)@(?:cursor\.com|cursor\.sh|anysphere\.co)$/i },
  { name: "copilot", label: /^(?:GitHub )?Copilot(?: Agent| AI|\[bot\])?$/i, email: /^(?:\d+\+)?copilot(?:\[bot\])?@users\.noreply\.github\.com$/i },
  { name: "aider", label: /^Aider(?:\s*\(v?[\d.]+\))?$/i, email: /^aider@(?:local|aider\.chat)$/i },
  { name: "devin", label: /^Devin(?: AI| Agent|\[bot\])?$/i, email: /^devin@(?:cognition\.ai|users\.noreply\.github\.com)$/i },
  { name: "windsurf", label: /^(?:Windsurf|Codeium)(?: Agent| AI)?$/i, email: /^(?:windsurf|codeium)@(?:windsurf\.com|codeium\.com)$/i },
  { name: "gpt", label: /^(?:ChatGPT|OpenAI Agent|GPT Agent)$/i, email: /^(?:chatgpt|gpt)@openai\.com$/i },
  { name: "antigravity", label: /^(?:Antigravity(?: Agent| AI)?|DeepMind Agent)$/i, email: /^antigravity@(?:google\.com|deepmind\.com)$/i },
  { name: "codex", label: /^Codex(?: Agent| AI)?$/i, email: /^codex@openai\.com$/i },
  { name: "gemini", label: /^Gemini(?: CLI| Agent| AI)?$/i, email: /^gemini@google\.com$/i },
  { name: "openclaw", label: /^OpenClaw(?: Agent| AI)?$/i, email: /^openclaw@(?:local|openclaw\.ai)$/i },
];

function identitySignals(name: string, email: string): string[] {
  return AGENT_IDENTITIES.filter(agent => agent.label.test(name.trim()) || agent.email.test(email.trim())).map(agent => agent.name);
}

export function detectAiAttribution(
  authorName: string,
  authorEmail: string,
  message: string
): AiAttributionResult {
  const signatures = new Set<string>();
  // Git trailers occupy the final trailer block. An example in prose or a code
  // sample earlier in the body must not turn the whole commit into AI attribution.
  const lines = message.trimEnd().split(/\r?\n/);
  let trailerStart = lines.length;
  while (trailerStart > 0 && /^[A-Za-z][A-Za-z-]*:\s*.+$/.test(lines[trailerStart - 1])) trailerStart--;
  for (const line of lines.slice(trailerStart)) {
    const trailer = /^Co-Authored-By:\s*(.+?)\s*<([^<>]+)>\s*$/i.exec(line);
    if (!trailer) continue;
    for (const name of identitySignals(trailer[1], trailer[2])) signatures.add(`trailer:${name}`);
  }
  for (const line of lines) {
    const attribution = /^\s*(?:Generated|Assisted|Created|Written) by (.+?)\.?\s*$/i.exec(line);
    if (!attribution) continue;
    for (const name of identitySignals(attribution[1], "")) signatures.add(`message:${name}`);
  }
  for (const name of identitySignals(authorName, authorEmail)) signatures.add(`author:${name}`);
  return { isAiAttributed: signatures.size > 0, signatures: [...signatures] };
}
