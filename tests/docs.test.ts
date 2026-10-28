import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { configFromText } from "../src/config.js";

describe("copyable configuration examples", () => {
  const examples = [...readFileSync("README.md", "utf8").matchAll(/```json\n([\s\S]*?)\n```/g)];
  it("includes configuration examples", () => expect(examples.length).toBeGreaterThan(0));
  it.each(examples.map((match, i) => [i + 1, match[1]] as const))("accepts README example %i without disabling the focus gate", (_, text) => {
    const config = configFromText(text, "README example");
    expect(config.failOn).toContain("test-focus");
  });
});
