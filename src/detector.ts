export interface AiAttributionResult {
  isAiAttributed: boolean;
  signatures: string[];
}

const TRAILER_AI_PATTERNS = [
  { regex: /Co-Authored-By:.*(?:Claude|Anthropic)/i, name: "trailer:claude" },
  { regex: /Co-Authored-By:.*(?:Cursor|Anysphere)/i, name: "trailer:cursor" },
  { regex: /Co-Authored-By:.*(?:Copilot|GitHub Copilot)/i, name: "trailer:copilot" },
  { regex: /Co-Authored-By:.*(?:Aider|aider)/i, name: "trailer:aider" },
  { regex: /Co-Authored-By:.*(?:Devin|cognition)/i, name: "trailer:devin" },
  { regex: /Co-Authored-By:.*(?:Windsurf|Codeium)/i, name: "trailer:windsurf" },
  { regex: /Co-Authored-By:.*(?:ChatGPT|OpenAI|GPT)/i, name: "trailer:gpt" },
  { regex: /Co-Authored-By:.*(?:Antigravity|Deepmind|Google)/i, name: "trailer:antigravity" },
  { regex: /Co-Authored-By:.*(?:Codex)/i, name: "trailer:codex" },
  { regex: /Co-Authored-By:.*(?:Gemini)/i, name: "trailer:gemini" },
  { regex: /Co-Authored-By:.*(?:OpenClaw|Claw)/i, name: "trailer:openclaw" },
];

const MESSAGE_AI_PATTERNS = [
  { regex: /(?:Generated|Assisted|Created|Written) by Cursor/i, name: "message:cursor" },
  { regex: /(?:Generated|Assisted|Created|Written) by Claude/i, name: "message:claude" },
  { regex: /(?:Generated|Assisted|Created|Written) by Aider/i, name: "message:aider" },
  { regex: /(?:Generated|Assisted|Created|Written) by Copilot/i, name: "message:copilot" },
  { regex: /(?:Generated|Assisted|Created|Written) by Devin/i, name: "message:devin" },
  { regex: /(?:Generated|Assisted|Created|Written) by (?:Antigravity|AGY)/i, name: "message:antigravity" },
  { regex: /(?:Generated|Assisted|Created|Written) by Codex/i, name: "message:codex" },
  { regex: /(?:Generated|Assisted|Created|Written) by Gemini/i, name: "message:gemini" },
];

const AUTHOR_AI_PATTERNS = [
  { regex: /(?:claude|anthropic)/i, name: "author:claude" },
  { regex: /(?:cursor|anysphere)/i, name: "author:cursor" },
  { regex: /(?:copilot)/i, name: "author:copilot" },
  { regex: /(?:aider)/i, name: "author:aider" },
  { regex: /(?:devin)/i, name: "author:devin" },
  { regex: /(?:antigravity|deepmind)/i, name: "author:antigravity" },
  { regex: /(?:codex)/i, name: "author:codex" },
  { regex: /(?:gemini)/i, name: "author:gemini" },
  { regex: /(?:\[bot\]|bot@|automation)/i, name: "author:bot" },
];

export function detectAiAttribution(
  authorName: string,
  authorEmail: string,
  message: string
): AiAttributionResult {
  const signatures: string[] = [];

  // 1. Check trailers in commit message
  for (const { regex, name } of TRAILER_AI_PATTERNS) {
    if (regex.test(message)) {
      signatures.push(name);
    }
  }

  // 2. Check body signatures
  for (const { regex, name } of MESSAGE_AI_PATTERNS) {
    if (regex.test(message)) {
      signatures.push(name);
    }
  }

  // 3. Check author name & email
  const authorIdentity = `${authorName} <${authorEmail}>`;
  for (const { regex, name } of AUTHOR_AI_PATTERNS) {
    if (regex.test(authorIdentity)) {
      signatures.push(name);
    }
  }

  return {
    isAiAttributed: signatures.length > 0,
    signatures,
  };
}
