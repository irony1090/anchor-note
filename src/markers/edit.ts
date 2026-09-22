import * as vscode from "vscode";
import { stripMarker, wrapMarker } from "../core/comment";
import { DEFAULT_PREFIX, markerText, markersIn } from "../core/marker";

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

/**
 * 파일들에서 labels의 마커를 전부 지운다 (R7 메모 삭제). 주석에 마커만 있었으면 주석째, 그 줄이 비면 줄째 지운다 (B11 빈 주석 껍데기 잔존).
 * 위치는 검색 결과가 아니라 편집 직전 문서에서 다시 찾는다 — 검색과 편집 사이에 파일이 바뀌어도 엉뚱한 글자를 지우지 않게.
 * WorkspaceEdit 하나로 적용해 Ctrl+Z로 되돌릴 수 있다. 편집 전에 dirty였던 파일은 저장하지 않는다.
 */
export async function removeMarkers(uris: vscode.Uri[], labels: ReadonlySet<string>): Promise<number> {
  const prefix = markerPrefix();
  const edit = new vscode.WorkspaceEdit();
  const touched: Array<{ doc: vscode.TextDocument; wasDirty: boolean }> = [];
  let removed = 0;

  for (const uri of uris) {
    const doc = await vscode.workspace.openTextDocument(uri);
    let changed = false;
    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i);
      // 오른쪽부터 지워야 앞쪽 마커의 위치가 안 바뀐다
      const hits = markersIn(line.text, prefix).filter((hit) => labels.has(hit.label)).reverse();
      if (hits.length === 0) {
        continue;
      }
      const next = hits.reduce((text, hit) => stripMarker(text, hit.start, hit.end, doc.languageId), line.text);
      removed += hits.length;
      changed = true;
      if (next === "") {
        edit.delete(uri, line.rangeIncludingLineBreak);
      } else {
        edit.replace(uri, line.range, next);
      }
    }
    if (changed) {
      touched.push({ doc, wasDirty: doc.isDirty });
    }
  }

  if (touched.length === 0) {
    return 0;
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("마커를 지우지 못했습니다 (읽기 전용 파일일 수 있습니다)");
  }
  await Promise.all(touched.filter((t) => !t.wasDirty).map((t) => t.doc.save()));
  return removed;
}
