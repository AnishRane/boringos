/**
 * Phase 1 — pi runtime JSON-stream parser unit tests.
 *
 * Drives the pure parser (`createPiStreamParser`) with a REAL
 * `pi --mode json` transcript captured from `gpt-4.1-mini`
 * (tests/fixtures/pi-mode-json.jsonl). No subprocess spawned.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPiStreamParser, parsePiModelList } from "@boringos/runtime";

const fixture = readFileSync(
  join(__dirname, "fixtures", "pi-mode-json.jsonl"),
  "utf8",
);

function runParser() {
  const parser = createPiStreamParser();
  for (const line of fixture.split("\n")) {
    if (line.trim()) parser.push(line);
  }
  return parser;
}

describe("pi runtime — JSON stream parser", () => {
  it("extracts session id, usage/cost, and final assistant text", () => {
    const { state } = runParser();
    expect(state.sessionId).toBe("019e58f3-15d3-7ded-959c-a42058056f8a");
    expect(state.lastAssistantText).toBe("hello there friend");
    expect(state.sawUsage).toBe(true);
    expect(state.inputTokens).toBe(1177);
    expect(state.outputTokens).toBe(5);
    expect(state.model).toBe("gpt-4.1-mini");
    expect(state.provider).toBe("openai");
    expect(state.costUsd).toBeCloseTo(0.0004788, 6);
  });

  it("synthesizes a {type:'result'} line carrying the final text", () => {
    const parser = runParser();
    const parsed = JSON.parse(parser.resultLine());
    expect(parsed.type).toBe("result");
    expect(parsed.result).toBe("hello there friend");
  });

  it("does not double-count usage across message_update / turn_end / agent_end", () => {
    // The fixture has exactly one assistant message; its usage must be
    // counted once, not multiplied by the repeated message echoes.
    const { state } = runParser();
    expect(state.inputTokens).toBe(1177);
    expect(state.outputTokens).toBe(5);
  });

  it("ignores non-JSON and empty lines without throwing", () => {
    const parser = createPiStreamParser();
    expect(() => {
      parser.push("not json at all");
      parser.push("");
      parser.push("   ");
    }).not.toThrow();
    expect(parser.state.sawUsage).toBe(false);
    expect(parser.state.lastAssistantText).toBe("");
  });
});

describe("pi runtime — parsePiModelList", () => {
  const table = [
    "provider  model         context  max-out  thinking  images",
    "openai    gpt-4.1-mini  1.0M     32.8K    no        yes",
    "openai    gpt-4o        128K     16.4K    no        yes",
    "",
  ].join("\n");

  it("parses the --list-models table into provider/model ids", () => {
    const models = parsePiModelList(table);
    expect(models).toContainEqual({
      id: "openai/gpt-4.1-mini",
      label: "gpt-4.1-mini (openai)",
    });
    expect(models.some((m) => m.id === "openai/gpt-4o")).toBe(true);
  });

  it("skips the header row", () => {
    const models = parsePiModelList(table);
    expect(models.find((m) => m.id === "provider/model")).toBeUndefined();
  });
});
