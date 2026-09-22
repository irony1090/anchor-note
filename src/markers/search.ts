import * as vscode from "vscode";
import { markersIn } from "../core/marker";
import { NOTES_DIR } from "../notes/store";

const NOTEMAP_DIR = NOTES_DIR.split("/")[0];
const EXCLUDE = "{**/node_modules/**,**/.git/**,**/.notemap/**,**/dist/**}";
const MAX_BYTES = 1024 * 1024;
const BATCH = 50;

// 마커를 찾을 소스 파일의 상대경로 (D8 마크다운 저장). 첫 폴더 밖이거나 노트 저장소 안이면 null
export function sourcePath(uri: vscode.Uri): string | null {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined || vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.uri.toString()) {
    return null;
  }
  const path = vscode.workspace.asRelativePath(uri, false);
  return path === NOTEMAP_DIR || path.startsWith(`${NOTEMAP_DIR}/`) ? null : path;
}

export interface SourceText {
  path: string;
  uri: vscode.Uri;
  lines: string[];
}

// 첫 폴더의 소스 파일 전부. 열린 문서는 저장 안 한 내용 기준, 1MB 넘거나 NUL이 든(바이너리) 파일은 건너뛴다
export async function* sourceFiles(token?: vscode.CancellationToken): AsyncGenerator<SourceText> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined) {
    return;
  }
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/*"), EXCLUDE, undefined, token);
  const open = new Map(
    vscode.workspace.textDocuments.filter((doc) => !doc.isClosed).map((doc) => [doc.uri.toString(), doc] as const),
  );

  for (let i = 0; i < uris.length; i += BATCH) {
    if (token?.isCancellationRequested) {
      return;
    }
    const batch = await Promise.all(uris.slice(i, i + BATCH).map((uri) => readSource(uri, open.get(uri.toString()))));
    for (const source of batch) {
      if (source !== null) {
        yield source;
      }
    }
  }
}

async function readSource(uri: vscode.Uri, doc: vscode.TextDocument | undefined): Promise<SourceText | null> {
  const path = sourcePath(uri);
  if (path === null) {
    return null;
  }
  let text: string;
  if (doc !== undefined) {
    text = doc.getText();
  } else {
    try {
      if ((await vscode.workspace.fs.stat(uri)).size > MAX_BYTES) {
        return null;
      }
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return null; // 읽는 사이에 지워졌거나 권한이 없다
    }
  }
  return text.includes("\u0000") ? null : { path, uri, lines: text.split(/\r?\n/) };
}

export interface MarkerLocation {
  uri: vscode.Uri;
  path: string;
  line: number;
  start: number;
  end: number;
}

// 라벨들의 마커를 워크스페이스 전체에서 찾는다. anchors를 믿지 않는다 — 손으로 친 마커는 anchors에 없을 수 있다
export async function findLabels(labels: ReadonlySet<string>, prefix: string): Promise<Map<string, MarkerLocation[]>> {
  const found = new Map<string, MarkerLocation[]>();
  for await (const source of sourceFiles()) {
    source.lines.forEach((text, line) => {
      for (const hit of markersIn(text, prefix)) {
        if (labels.has(hit.label)) {
          const list = found.get(hit.label) ?? [];
          list.push({ uri: source.uri, path: source.path, line, start: hit.start, end: hit.end });
          found.set(hit.label, list);
        }
      }
    });
  }
  return found;
}
