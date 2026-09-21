/**
 * 소스 줄 끝에 마커를 써넣는다 (W7 마커 삽입, REF-notes 4절).
 * 확장이 사용자 코드를 고치는 유일한 경로다.
 */

import * as vscode from "vscode";

export interface MarkerSyntax {
  prefix: string;
  suffix: string;
}

export interface Inserted {
  /** 삽입 후의 그 줄 전체. 노트의 anchor.lineText가 된다 */
  lineText: string;
  /** 주석 기호를 못 찾아 라벨만 넣었는지 */
  bare: boolean;
}

/** 줄 주석 기호. 모르는 언어는 여기 없고, 그 경우 라벨만 넣는다 (REF-notes 4절 최소 맵) */
const LINE_COMMENT: Record<string, string> = {
  typescript: "//",
  typescriptreact: "//",
  javascript: "//",
  javascriptreact: "//",
  c: "//",
  cpp: "//",
  java: "//",
  go: "//",
  rust: "//",
  kotlin: "//",
  swift: "//",
  scss: "//",
  python: "#",
  shellscript: "#",
  ruby: "#",
  yaml: "#",
  toml: "#",
  dockerfile: "#",
  makefile: "#",
  sql: "--",
  lua: "--",
  ini: ";",
  clojure: ";",
  tex: "%",
  latex: "%",
};

/** 줄 주석이 없는 언어는 블록 주석으로 감싼다 */
const BLOCK_COMMENT: Record<string, [string, string]> = {
  html: ["<!--", "-->"],
  xml: ["<!--", "-->"],
  markdown: ["<!--", "-->"],
  css: ["/*", "*/"],
};

export function markerSyntax(): MarkerSyntax {
  const config = vscode.workspace.getConfiguration("noteMap");
  return {
    prefix: config.get<string>("markerPrefix", "@note:"),
    suffix: config.get<string>("markerSuffix", ""),
  };
}

export function markerText(label: string, syntax: MarkerSyntax = markerSyntax()): string {
  return `${syntax.prefix}${label}${syntax.suffix}`;
}

/**
 * `line`(0-based) 끝에 마커를 덧붙이고, 저장한 뒤 그 줄 전체를 돌려준다.
 *
 * 이미 있는 주석에 합치지 않고 **새 주석을 덧붙인다.** 줄 끝의 `//`가 진짜 주석인지
 * 문자열 리터럴 안인지 판정하려면 언어 파서가 필요한데, 조금 지저분한 편이 오판으로 코드를 깨뜨리는 것보다 낫다.
 */
export async function insertMarker(uri: vscode.Uri, line: number, label: string): Promise<Inserted> {
  const doc = await vscode.workspace.openTextDocument(uri);
  if (line < 0 || line >= doc.lineCount) {
    throw new Error(`${line + 1}번 줄이 없습니다 (${doc.lineCount}줄짜리 파일)`);
  }

  const marker = markerText(label);
  const comment = commentFor(doc.languageId, marker);
  const target = doc.lineAt(line);
  const separator = target.text.trim() === "" ? "" : " ";

  // 우리 편집 전에 이미 dirty였는지 기억해둔다. 사용자가 편집 중이던 파일을 대신 저장하지 않기 위해서다
  const wasDirty = doc.isDirty;

  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, target.range.end, `${separator}${comment.text}`);
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("마커를 넣지 못했습니다 (읽기 전용 파일일 수 있습니다)");
  }
  if (!wasDirty) {
    await doc.save();
  }

  return { lineText: doc.lineAt(line).text, bare: comment.bare };
}

function commentFor(languageId: string, marker: string): { text: string; bare: boolean } {
  const lineToken = LINE_COMMENT[languageId];
  if (lineToken !== undefined) {
    return { text: `${lineToken} ${marker}`, bare: false };
  }

  const block = BLOCK_COMMENT[languageId];
  if (block !== undefined) {
    return { text: `${block[0]} ${marker} ${block[1]}`, bare: false };
  }

  // 모르는 언어. 라벨은 넣되 주석으로 감싸는 건 사용자에게 맡긴다
  return { text: marker, bare: true };
}

/**
 * 줄에서 마커 위치를 찾는다. 없으면 -1.
 * suffix가 없으면 라벨 끝은 공백·줄 끝뿐이다. 경계를 안 보면 `@note:cache`가 `@note:cacheNeeded`나
 * 문서 속 `` `@note:cache` `` 인용까지 잡아서 지운다 (REF-notes 2절, B10).
 */
export function findMarker(text: string, marker: string, syntax: MarkerSyntax): number {
  for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + 1)) {
    const next = text.charAt(at + marker.length);
    if (syntax.suffix !== "" || next === "" || /\s/.test(next)) {
      return at;
    }
  }
  return -1;
}

/** 앵커 하나를 떼거나 메모를 지울 때, 그 줄에서 마커만 걷어낸다 (REF-notes 7절) */
export async function removeMarker(uri: vscode.Uri, label: string): Promise<boolean> {
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    return false;
  }

  const syntax = markerSyntax();
  const marker = markerText(label, syntax);
  const edit = new vscode.WorkspaceEdit();
  let hit = false;

  for (let i = 0; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;
    const at = findMarker(text, marker, syntax);
    if (at === -1) {
      continue;
    }
    hit = true;
    const cleaned = stripMarker(text, at, marker.length);
    edit.replace(uri, doc.lineAt(i).range, cleaned);
  }

  if (!hit) {
    return false;
  }

  const wasDirty = doc.isDirty;
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied && !wasDirty) {
    await doc.save();
  }
  return applied;
}

/**
 * 마커를 뺀 뒤 빈 껍데기 주석이 남으면 같이 지운다.
 * 코드가 있던 줄이면 코드는 그대로 두고 꼬리만 자른다.
 */
function stripMarker(text: string, at: number, length: number): string {
  const rest = `${text.slice(0, at)}${text.slice(at + length)}`;
  const trimmed = rest.trimEnd();
  const empty = /^(\s*)(\/\/|#|--|;|%)\s*$/.exec(trimmed);
  if (empty !== null) {
    return empty[1].trimEnd();
  }
  const emptyBlock = /^(\s*)(<!--|\/\*)\s*(-->|\*\/)\s*$/.exec(trimmed);
  if (emptyBlock !== null) {
    return emptyBlock[1].trimEnd();
  }
  return trimmed;
}
