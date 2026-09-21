import * as vscode from "vscode";
import { wrapMarker } from "../core/comment";
import { DEFAULT_PREFIX, markerText } from "../core/marker";

// 설정의 prefix. 비었거나 공백이 있으면 마커가 성립하지 않아 기본값을 쓴다
export function markerPrefix(): string {
  const prefix = vscode.workspace.getConfiguration("noteMap").get<string>("markerPrefix", DEFAULT_PREFIX);
  return prefix === "" || /\s/.test(prefix) ? DEFAULT_PREFIX : prefix;
}

export interface Inserted {
  // 삽입 후의 그 줄 전체. 앵커의 lineText가 된다
  lineText: string;
  // 주석 문법을 몰라 마커만 넣었는지
  bare: boolean;
}

/**
 * `line`(0-based) 끝에 새 주석으로 마커를 덧붙인다. 있는 주석에 합치지 않는다 — 줄 끝 `//`가 문자열 안인지는 파서 없이 모른다.
 * 편집 전에 dirty였으면 저장하지 않는다. 사용자가 저장 안 한 변경을 대신 확정하지 않으려는 것이다.
 */
export async function insertMarker(uri: vscode.Uri, line: number, label: string): Promise<Inserted> {
  const doc = await vscode.workspace.openTextDocument(uri);
  if (line < 0 || line >= doc.lineCount) {
    throw new Error(`${line + 1}번 줄이 없습니다 (${doc.lineCount}줄짜리 파일)`);
  }

  const wrapped = wrapMarker(doc.languageId, markerText(label, markerPrefix()));
  const target = doc.lineAt(line);
  const separator = target.text.trim() === "" ? "" : " ";
  const wasDirty = doc.isDirty;

  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, target.range.end, `${separator}${wrapped.text}`);
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("마커를 넣지 못했습니다 (읽기 전용 파일일 수 있습니다)");
  }
  if (!wasDirty) {
    await doc.save();
  }
  return { lineText: doc.lineAt(line).text, bare: wrapped.bare };
}
