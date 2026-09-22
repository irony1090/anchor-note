import * as vscode from "vscode";
import { markersIn } from "../core/marker";
import { markerPrefix } from "../markers/edit";
import type { NoteMeta } from "../notes/frontmatter";
import type { CodeBlock } from "./protocol";

// 마커 줄 위아래로 보여줄 줄 수 / 파일 메모나 마커를 못 찾았을 때 앞에서 보여줄 줄 수
const CONTEXT_LINES = 3;
const FILE_HEAD_LINES = 15;

// anchors -> 앵커 파일마다 마커 주변 코드. 위치는 마커를 다시 찾아서 안다 (D11 코드 라벨 앵커)
export async function codeBlocks(label: string, meta: NoteMeta): Promise<CodeBlock[]> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (root === undefined) {
    return [];
  }
  const prefix = markerPrefix();
  const blocks: CodeBlock[] = [];

  for (const anchor of meta.anchors) {
    try {
      // 열린 문서면 저장 안 한 내용 기준이다
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, anchor.path));
      const focus = meta.kind === "file" ? null : findLine(doc, label, prefix);
      const start = focus === null ? 0 : Math.max(0, focus - CONTEXT_LINES);
      const end = Math.min(doc.lineCount, focus === null ? FILE_HEAD_LINES : focus + CONTEXT_LINES + 1);
      const lines: string[] = [];
      for (let i = start; i < end; i++) {
        lines.push(doc.lineAt(i).text);
      }
      const missing = meta.kind !== "file" && focus === null ? "마커를 찾지 못했습니다 (파일 앞부분)" : undefined;
      blocks.push({ path: anchor.path, start, lines, focus, missing });
    } catch (error) {
      blocks.push({ path: anchor.path, start: 0, lines: [], focus: null, missing: describe(error) });
    }
  }
  return blocks;
}

// 코드 에디터 쪽 컬럼에 연다. 그 파일이 이미 보이면 그 컬럼, 아니면 메모 에디터가 아닌 컬럼
export async function reveal(path: string, line: number, memoColumn: vscode.ViewColumn | undefined): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (root === undefined) {
    return;
  }
  const uri = vscode.Uri.joinPath(root, path);
  const visible = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
  const column = visible?.viewColumn ?? (memoColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One);
  const position = new vscode.Position(line, 0);
  await vscode.window.showTextDocument(uri, { viewColumn: column, selection: new vscode.Range(position, position) });
}

function findLine(doc: vscode.TextDocument, label: string, prefix: string): number | null {
  for (let i = 0; i < doc.lineCount; i++) {
    if (markersIn(doc.lineAt(i).text, prefix).some((hit) => hit.label === label)) {
      return i;
    }
  }
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
