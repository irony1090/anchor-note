/**
 * 메모 에디터 — 노트 `.md`를 여는 커스텀 에디터. 위: 마크다운 미리보기, 아래: 본문 입력 (에디터 주도 프로토타입).
 * 원본은 TextDocument라 저장·dirty 표시는 VSCode가 한다. frontmatter는 숨기고 본문만 주고받는다.
 */

import * as vscode from "vscode";
import type { CodeBlock, EditorToHost, HostToEditor } from "../shared/editor-protocol";
import { parseNote } from "../notes/frontmatter";
import { findMarker, markerSyntax, markerText } from "./insert";

export const NOTE_EDITOR_VIEW_TYPE = "noteMap.noteEditor";

/** 앵커 줄 위아래로 몇 줄 보여줄지 / file 메모는 앞에서 몇 줄 */
const CONTEXT_LINES = 3;
const FILE_HEAD_LINES = 15;

export class NoteEditorProvider implements vscode.CustomTextEditorProvider {
  static register(extensionUri: vscode.Uri): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(NOTE_EDITOR_VIEW_TYPE, new NoteEditorProvider(extensionUri));
  }

  private constructor(private readonly extensionUri: vscode.Uri) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist"),
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };
    panel.webview.html = this.buildHtml(panel.webview);

    const post = (message: HostToEditor) => void panel.webview.postMessage(message);
    const sendDoc = () => post({ type: "doc", ...readDoc(document) });

    // 우리가 넣은 편집이 되울려 오면 입력 중인 textarea를 옛 값으로 덮는다. 자기 편집 중에는 보내지 않는다
    let ownEdits = 0;
    let queue: Promise<void> = Promise.resolve();
    const applyBody = (body: string) => {
      queue = queue.then(async () => {
        const range = bodyRange(document);
        if (range === null) {
          post({ type: "error", message: "frontmatter가 깨져 본문을 고칠 수 없습니다. 텍스트 에디터로 여세요" });
          return;
        }
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, range, body);
        ownEdits += 1;
        try {
          await vscode.workspace.applyEdit(edit);
        } finally {
          ownEdits -= 1;
        }
      });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString() && ownEdits === 0) {
        sendDoc();
      }
    });
    panel.onDidDispose(() => changeSub.dispose());

    panel.webview.onDidReceiveMessage(async (message: EditorToHost) => {
      switch (message.type) {
        case "ready":
          sendDoc();
          return;
        case "edit":
          applyBody(message.body);
          return;
        case "requestCode":
          post({ type: "code", blocks: await codeBlocks(document) });
          return;
        case "reveal":
          await reveal(message.path, message.line, panel.viewColumn);
          return;
        default: {
          const unhandled: never = message;
          console.error("[note-map] unhandled editor message", unhandled);
        }
      }
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "note-editor.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "note-editor.css"));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>메모</title>
</head>
<body>
  <header id="head">
    <span id="title"></span>
    <span id="label"></span>
    <span class="spacer"></span>
    <label class="toggle"><input type="checkbox" id="show-code"> 코드 보기</label>
  </header>
  <section id="code" hidden></section>
  <section id="preview"></section>
  <p id="error" hidden></p>
  <textarea id="input" spellcheck="false" placeholder="마크다운으로 메모를 쓰세요. 저장은 Ctrl+S"></textarea>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function labelOf(uri: vscode.Uri): string {
  const name = uri.path.split("/").pop() ?? "";
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

/** frontmatter 닫는 `---` 다음 줄부터 끝까지. parseNote와 같은 규칙으로 찾는다 */
function bodyRange(document: vscode.TextDocument): vscode.Range | null {
  if (document.lineCount === 0 || document.lineAt(0).text.trim() !== "---") {
    return null;
  }
  for (let i = 1; i < document.lineCount; i++) {
    if (document.lineAt(i).text === "---") {
      if (i + 1 >= document.lineCount) {
        return null;
      }
      const last = document.lineAt(document.lineCount - 1).range.end;
      return new vscode.Range(new vscode.Position(i + 1, 0), last);
    }
  }
  return null;
}

function readDoc(document: vscode.TextDocument): { label: string; title: string; body: string } {
  const label = labelOf(document.uri);
  const range = bodyRange(document);
  let title = label;
  try {
    title = parseNote(document.getText(), label).title;
  } catch {
    // 제목만 못 읽은 것. 본문은 아래에서 따로 자른다
  }
  return { label, title, body: range === null ? document.getText() : document.getText(range) };
}

async function codeBlocks(document: vscode.TextDocument): Promise<CodeBlock[]> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (root === undefined) {
    return [];
  }

  let note;
  try {
    note = parseNote(document.getText(), labelOf(document.uri));
  } catch (error) {
    return [{ path: "(frontmatter)", start: 0, lines: [], focus: null, missing: describe(error) }];
  }

  const syntax = markerSyntax();
  const marker = markerText(labelOf(document.uri), syntax);
  const blocks: CodeBlock[] = [];

  for (const anchor of note.anchors) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, anchor.path));
      let focus: number | null = null;
      if (note.kind !== "file") {
        for (let i = 0; i < doc.lineCount; i++) {
          if (findMarker(doc.lineAt(i).text, marker, syntax) !== -1) {
            focus = i;
            break;
          }
        }
      }
      const start = focus === null ? 0 : Math.max(0, focus - CONTEXT_LINES);
      const end = Math.min(doc.lineCount, focus === null ? FILE_HEAD_LINES : focus + CONTEXT_LINES + 1);
      const lines: string[] = [];
      for (let i = start; i < end; i++) {
        lines.push(doc.lineAt(i).text);
      }
      const missing = note.kind !== "file" && focus === null ? "마커를 찾지 못했습니다 (파일 앞부분)" : undefined;
      blocks.push({ path: anchor.path, start, lines, focus, missing });
    } catch (error) {
      blocks.push({ path: anchor.path, start: 0, lines: [], focus: null, missing: describe(error) });
    }
  }
  return blocks;
}

/** 메모 에디터가 아닌 쪽 컬럼에 연다. 그 파일이 이미 보이면 그 컬럼으로 */
async function reveal(path: string, line: number, memoColumn: vscode.ViewColumn | undefined): Promise<void> {
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
