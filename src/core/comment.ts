interface CommentSyntax {
  line?: string;
  block?: [string, string];
}

const C_LIKE: CommentSyntax = { line: "//", block: ["/*", "*/"] };
const HASH: CommentSyntax = { line: "#" };
const XML_LIKE: CommentSyntax = { block: ["<!--", "-->"] };

// 모르는 언어는 여기 없다 -> 마커만 넣고, 지울 때도 마커만 지운다
const COMMENTS: Record<string, CommentSyntax> = {
  typescript: C_LIKE,
  typescriptreact: C_LIKE,
  javascript: C_LIKE,
  javascriptreact: C_LIKE,
  c: C_LIKE,
  cpp: C_LIKE,
  java: C_LIKE,
  go: C_LIKE,
  rust: C_LIKE,
  kotlin: C_LIKE,
  swift: C_LIKE,
  scss: C_LIKE,
  python: HASH,
  shellscript: HASH,
  ruby: HASH,
  yaml: HASH,
  toml: HASH,
  dockerfile: HASH,
  makefile: HASH,
  sql: { line: "--", block: ["/*", "*/"] },
  lua: { line: "--" },
  ini: { line: ";" },
  clojure: { line: ";" },
  tex: { line: "%" },
  latex: { line: "%" },
  html: XML_LIKE,
  xml: XML_LIKE,
  markdown: XML_LIKE,
  css: { block: ["/*", "*/"] },
};

export interface Wrapped {
  text: string;
  // 주석 문법을 몰라 마커만 넣었는지
  bare: boolean;
}

// 줄 끝에 덧붙일 새 주석. 줄 주석이 있으면 줄 주석, 없으면 블록 주석
export function wrapMarker(languageId: string, marker: string): Wrapped {
  const syntax = COMMENTS[languageId];
  if (syntax?.line !== undefined) {
    return { text: `${syntax.line} ${marker}`, bare: false };
  }
  if (syntax?.block !== undefined) {
    return { text: `${syntax.block[0]} ${marker} ${syntax.block[1]}`, bare: false };
  }
  return { text: marker, bare: true };
}

/**
 * 줄에서 [start, end) 마커를 뺀 줄을 돌려준다 (B11 빈 주석 껍데기 잔존 수정).
 * 주석 안에 마커만 있었으면(여는 기호가 바로 앞, 닫는 기호나 줄 끝이 바로 뒤) 주석째 지운다.
 * 그 언어의 기호만 본다 — 언어를 가리지 않으면 마크다운 본문 `A -- @note:x`의 `--`를 SQL 주석으로 오인해 지운다.
 */
export function stripMarker(line: string, start: number, end: number, languageId: string): string {
  const before = line.slice(0, start).trimEnd();
  const after = line.slice(end);
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const syntax = COMMENTS[languageId];

  if (syntax?.line !== undefined && before.endsWith(syntax.line) && after.trim() === "") {
    return before.slice(0, -syntax.line.length).trimEnd();
  }
  if (syntax?.block !== undefined && before.endsWith(syntax.block[0])) {
    const rest = after.trimStart();
    if (rest.startsWith(syntax.block[1])) {
      return join(before.slice(0, -syntax.block[0].length), rest.slice(syntax.block[1].length), indent);
    }
  }
  return join(before, after, indent);
}

// 남은 앞뒤를 공백 하나로 잇는다. 앞이 비면 원래 들여쓰기를 살린다
function join(left: string, right: string, indent: string): string {
  const l = left.trimEnd();
  const r = right.trim();
  if (l === "") {
    return r === "" ? "" : `${indent}${r}`;
  }
  return r === "" ? l : `${l} ${r}`;
}
