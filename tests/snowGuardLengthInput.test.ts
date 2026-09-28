import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSnowLengthInput,
  parseSnowLengthInput,
} from "../src/components_v2/snowGuardLengthInput";

function parsedValue(input: string) {
  const result = parseSnowLengthInput(input);
  assert.equal(result.ok, true, `Expected ${JSON.stringify(input)} to be valid`);
  return result.ok ? result.value : Number.NaN;
}

test("new and zero-length segments render as an empty input", () => {
  assert.equal(formatSnowLengthInput(0), "");
  assert.deepEqual(parseSnowLengthInput(""), { ok: true, value: 0, normalized: "" });
});

test("accepts integer metres", () => {
  assert.equal(parsedValue("25"), 25);
});

test("accepts metre suffix", () => {
  assert.equal(parsedValue("25m"), 25);
});

test("accepts decimal point with metre suffix", () => {
  assert.equal(parsedValue("25.46m"), 25.46);
});

test("accepts decimal comma and optional whitespace", () => {
  assert.equal(parsedValue("25,46"), 25.46);
  assert.equal(parsedValue(" 25,46 m "), 25.46);
});

test("normalizes a committed decimal without changing its numeric value", () => {
  assert.deepEqual(parseSnowLengthInput("25.46m"), {
    ok: true,
    value: 25.46,
    normalized: "25,46",
  });
});

test("two valid segments produce the expected total", () => {
  const total = parsedValue("25") + parsedValue("10.5 m");
  assert.equal(total, 35.5);
});

test("empty input contributes zero and never NaN", () => {
  const value = parsedValue("");
  assert.equal(value, 0);
  assert.equal(Number.isNaN(value), false);
});

test("rejects invalid, negative and non-finite input", () => {
  for (const input of ["abc", "25foo", "-1", "Infinity", "NaN", "25,4,6", "25."]) {
    const result = parseSnowLengthInput(input);
    assert.equal(result.ok, false, `Expected ${JSON.stringify(input)} to be invalid`);
    if (!result.ok) assert.match(result.error, /gültige.*nicht negative Länge/i);
  }
});

test("does not parse a valid numeric prefix from arbitrary input", () => {
  assert.equal(parseSnowLengthInput("25m extra").ok, false);
  assert.equal(parseSnowLengthInput("25.46.7m").ok, false);
});
