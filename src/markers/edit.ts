import * as vscode from "vscode";
import { stripMarker, wrapMarker } from "../core/comment";
import { DEFAULT_PREFIX, markerText, markersIn } from "../core/marker";
import type { MarkerHit } from "../core/marker";

// 설정의 prefix. 비었거나 공백이 있으면 마커가 성립하지 않아 기본값을 쓴다
export function markerPrefix(): string {
  const prefix = vscode.workspace.getConfiguration("anchorNotes").get<string>("markerPrefix", DEFAULT_PREFIX);
  return prefix === "" || /\s/.test(prefix) ? DEFAULT_PREFIX : prefix;
}

export interface Inserted {
  // 주석 문법을 몰라 마커만 넣었는지
  bare: boolean;
}

/**
 * `line`(0-based) 끝에 새 주석으로 마커를 덧붙인다. 있는 주석에 합치지 않는다 — 줄 끝 `//`가 문자열 안인지는 파서 없이 모른다.
 * 편집 전에 dirty였으면 저장하지 않는다. 사용자가 저장 안 한 변경을 대신 확정하지 않으려는 것이다.
 */
export async function insertMarker(uri: vscode.Uri, line: number, label: string, id?: string): Promise<Inserted> {
  const doc = await vscode.workspace.openTextDocument(uri);
  if (line < 0 || line >= doc.lineCount) {
    throw new Error(`${line + 1}번 줄이 없습니다 (${doc.lineCount}줄짜리 파일)`);
  }

  const wrapped = wrapMarker(doc.languageId, markerText(label, markerPrefix(), id));
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
  return { bare: wrapped.bare };
}

// 파일들에서 labels의 마커를 전부 지운다 (R7 메모 삭제). 주석에 마커만 있었으면 주석째, 그 줄이 비면 줄째 지운다 (B11 빈 주석 껍데기 잔존)
export async function removeMarkers(uris: vscode.Uri[], labels: ReadonlySet<string>): Promise<number> {
  const edit = new vscode.WorkspaceEdit();
  const plan = await planMarkerLines(edit, uris, labels, (text, hit, languageId) =>
    stripMarker(text, hit.start, hit.end, languageId),
  );
  if (plan.count === 0) {
    return 0;
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("마커를 고치지 못했습니다 (읽기 전용 파일일 수 있습니다)");
  }
  await plan.save();
  return plan.count;
}

// from 마커의 라벨 부분만 to로 바꾸는 편집을 edit에 담는다 (라벨 이름 바꾸기, `#id`는 남긴다). 적용은 부르는 쪽이 노트 이름 변경과 한 번에
export function planRenameMarkers(edit: vscode.WorkspaceEdit, uris: vscode.Uri[], from: string, to: string): Promise<MarkerPlan> {
  const prefixLength = markerPrefix().length;
  return planMarkerLines(edit, uris, new Set([from]), (text, hit) => {
    // 닫는 마커는 라벨 앞에 `/`가 있다 (D26 범위 닫는 마커)
    const labelStart = hit.start + prefixLength + (hit.close === true ? 1 : 0);
    return `${text.slice(0, labelStart)}${to}${text.slice(labelStart + hit.label.length)}`;
  });
}

export interface MarkerPlan {
  // 고칠 마커 수
  count: number;
  // 편집을 적용한 뒤 부른다. 편집 전에 dirty가 아니던 파일만 저장한다 (사용자 파일을 대신 확정하지 않는다)
  save(): Promise<void>;
}

/**
 * labels의 마커가 있는 줄마다 editHit를 오른쪽 마커부터 적용한 편집을 edit에 담는다. 결과가 빈 줄이면 줄째 지운다.
 * 위치는 검색 결과가 아니라 지금 문서에서 다시 찾는다 — 검색과 편집 사이에 파일이 바뀌어도 엉뚱한 글자를 고치지 않게.
 */
async function planMarkerLines(
  edit: vscode.WorkspaceEdit,
  uris: vscode.Uri[],
  labels: ReadonlySet<string>,
  editHit: (text: string, hit: MarkerHit, languageId: string) => string,
): Promise<MarkerPlan> {
  const prefix = markerPrefix();
  const touched: Array<{ doc: vscode.TextDocument; wasDirty: boolean }> = [];
  let count = 0;

  for (const uri of uris) {
    const doc = await vscode.workspace.openTextDocument(uri);
    let changed = false;
    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i);
      // 오른쪽부터 고쳐야 앞쪽 마커의 위치가 안 바뀐다
      const hits = markersIn(line.text, prefix).filter((hit) => labels.has(hit.label)).reverse();
      if (hits.length === 0) {
        continue;
      }
      const next = hits.reduce((text, hit) => editHit(text, hit, doc.languageId), line.text);
      count += hits.length;
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

  return {
    count,
    save: async () => {
      await Promise.all(touched.filter((t) => !t.wasDirty).map((t) => t.doc.save()));
    },
  };
}
