import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { VALID_DETECTORS } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/config.js";
const schema = JSON.parse(readFileSync("schema.json", "utf8"));
describe("packaged editor configuration schema", () => {
  it("tracks all accepted rule IDs and public policy fields", () => {
    expect(schema.properties.failOn.items.enum).toEqual([...VALID_DETECTORS]);
    expect(Object.keys(schema.properties.rules.properties).sort()).toEqual([...VALID_DETECTORS].sort());
    for (const field of Object.keys(DEFAULT_CONFIG)) expect(schema.properties).toHaveProperty(field);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.exceptions.items.required).toEqual(["fingerprint", "count", "reason", "expires"]);
  });
  it("is included in npm packaging for offline editor completion", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")); expect(pkg.files).toContain("schema.json");
  });
});
