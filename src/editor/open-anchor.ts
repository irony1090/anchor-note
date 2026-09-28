import * as vscode from "vscode";
import { markersIn } from "../core/marker";
import { markerPrefix } from "../markers/edit";
import { RESCAN } from "../markers/sync";
import type { Anchor } from "../notes/frontmatter";

// 헤더 앵커 칩 클릭 -> 원문 위치. 마커 줄은 누를 때 찾는다 (D11 코드 라벨 앵커)
export async function openAnchor(label: string, anchor: Anchor, memoColumn: vscode.ViewColumn | undefined): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (root === undefined) {
    return;
  }
  const uri = vscode.Uri.joinPath(root, anchor.path);
  // 파일 앵커는 그 형식의 기본 에디터로 (이미지면 이미지 미리보기). 텍스트로 열면 바이너리에서 실패한다 (F1 바이너리 열기)
  if (anchor.kind === "file") {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      void vscode.window.showWarningMessage(`Anchor Notes: ${anchor.path} 파일이 없습니다.`);
      return;
    }
    await vscode.commands.executeCommand("vscode.open", uri, { viewColumn: targetColumn(uri, memoColumn) });
    return;
  }
  let doc: vscode.TextDocument;
  try {
    // 열린 문서면 저장 안 한 내용 기준이다
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    void offerRescan(`${anchor.path} 파일을 열 수 없습니다.`);
    return;
  }

  const range = findMarker(doc, label, anchor.id);
  await vscode.window.showTextDocument(uri, { viewColumn: targetColumn(uri, memoColumn), selection: range ?? new vscode.Range(0, 0, 0, 0) });
  if (range === null) {
    const marker = anchor.id === undefined ? label : `${label}#${anchor.id}`;
    void offerRescan(`${anchor.path}에서 마커 ${marker}를 찾지 못해 파일 맨 위를 열었습니다.`);
  }
}

async function offerRescan(message: string): Promise<void> {
  const rescan = "다시 찾기";
  if ((await vscode.window.showWarningMessage(`Anchor Notes: ${message}`, rescan)) === rescan) {
    await vscode.commands.executeCommand(RESCAN);
  }
}

// 코드 에디터 쪽 컬럼. 그 파일이 이미 보이면(텍스트·이미지 탭 모두) 그 컬럼, 아니면 메모 에디터가 아닌 컬럼
function targetColumn(uri: vscode.Uri, memoColumn: vscode.ViewColumn | undefined): vscode.ViewColumn {
  const target = uri.toString();
  const shown = vscode.window.tabGroups.all.find((group) => {
    const input = group.activeTab?.input;
    return (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) && input.uri.toString() === target;
  });
  return shown?.viewColumn ?? (memoColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One);
}

// 이 라벨·이 id(undefined = id 없는 마커)의 첫 마커 글자 범위
function findMarker(doc: vscode.TextDocument, label: string, id: string | undefined): vscode.Range | null {
  const prefix = markerPrefix();
  for (let i = 0; i < doc.lineCount; i++) {
    const hit = markersIn(doc.lineAt(i).text, prefix).find((h) => h.label === label && h.id === id);
    if (hit !== undefined) {
      return new vscode.Range(i, hit.start, i, hit.end);
    }
  }
  return null;
}
