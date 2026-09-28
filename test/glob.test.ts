import { test } from "node:test";
import assert from "node:assert/strict";
import { excludeMatcher, expandBraces } from "../src/core/glob";

test("expandBraces: 펼침·중첩·괄호 없음·닫히지 않음", () => {
  assert.deepEqual(expandBraces("**/{dist,out}/**"), ["**/dist/**", "**/out/**"]);
  assert.deepEqual(expandBraces("{a,b{c,d}}.ts"), ["a.ts", "bc.ts", "bd.ts"]);
  assert.deepEqual(expandBraces("src/**"), ["src/**"]);
  assert.deepEqual(expandBraces("a{b"), ["a{b"]);
});

test("excludeMatcher: 기본값 — 어느 깊이의 node_modules·.git·dist든", () => {
  const excluded = excludeMatcher(["**/node_modules/**", "**/.git/**", "**/dist/**"]);
  assert.equal(excluded("node_modules/x/index.js"), true);
  assert.equal(excluded("packages/a/node_modules/b.js"), true);
  assert.equal(excluded("dist"), true);
  assert.equal(excluded("dist/extension.js"), true);
  assert.equal(excluded("src/dist.ts"), false);
  assert.equal(excluded("src/distance/a.ts"), false);
});

test("excludeMatcher: *는 경로 조각 하나, 루트 기준", () => {
  const excluded = excludeMatcher(["*.log", "build/*.map", "src/**/*.gen.ts", "tmp?"]);
  assert.equal(excluded("a.log"), true);
  assert.equal(excluded("logs/a.log"), false);
  assert.equal(excluded("build/a.map"), true);
  assert.equal(excluded("build/x/a.map"), false);
  assert.equal(excluded("src/a.gen.ts"), true);
  assert.equal(excluded("src/x/y/a.gen.ts"), true);
  assert.equal(excluded("tmp1"), true);
  assert.equal(excluded("tmp12"), false);
});

test("excludeMatcher: 정규식 특수문자는 글자 그대로", () => {
  const excluded = excludeMatcher(["a+b/(x).ts"]);
  assert.equal(excluded("a+b/(x).ts"), true);
  assert.equal(excluded("aab/x.ts"), false);
});
