import * as vscode from "vscode";
import { DELETE_NOTE } from "../features/delete";
import { RENAME_NOTE } from "../features/rename";
import { FIND_BY_TAG } from "../features/tag-search";
import { BrokenNoteError, bodyOffset, parseNote } from "../notes/frontmatter";
import type { NoteStore } from "../notes/store";
import { codeBlocks, reveal } from "./code-preview";
import type { EditorToHost, HostToEditor, Layout } from "./protocol";

export const NOTE_EDITOR_VIEW_TYPE = "noteMap.noteEditor";
// 영역 크기 비율. 워크스페이스가 아니라 전역에 둔다 — 새로 여는 모든 메모에 같은 배치
const LAYOUT_KEY = "noteMap.editorLayout";

const BROKEN = "frontmatter가 깨져 본문을 고칠 수 없습니다. 텍스트 에디터로 여세요 (Reopen Editor With > Text Editor)";

// 노트 `.md` 전용 CustomTextEditor (R4 메모 에디터). 원본은 TextDocument라 저장·dirty 표시·되돌리기는 VSCode가 한다
export class NoteEditorProvider implements vscode.CustomTextEditorProvider {
  static register(context: vscode.ExtensionContext, store: NoteStore): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      NOTE_EDITOR_VIEW_TYPE,
      new NoteEditorProvider(context.extensionUri, context.globalState, store),
    );
  }

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalState: vscode.Memento,
    private readonly store: NoteStore,
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    panel.webview.html = this.buildHtml(panel.webview);

    const label = this.store.labelOf(document.uri) ?? fileLabel(document.uri);
    const post = (message: HostToEditor) => void panel.webview.postMessage(message);
    const sendDoc = () => {
      post({ type: "doc", ...readDoc(document, label) });
      if (bodyRange(document) === null) {
        post({ type: "error", message: BROKEN });
      }
    };

    /*
     * 자기 편집의 메아리 차단 (틀리면 빠르게 입력할 때 글자가 사라진다).
     * textarea 입력 -> WorkspaceEdit -> onDidChangeTextDocument 순서로 도는데, 되돌아온 본문은 한 박자 늦은 값이라
     * 그대로 웹뷰에 보내면 방금 친 글자를 덮는다. 그래서 편집은 promise 체인으로 순서대로 적용하고,
     * 적용 중(ownEdits > 0)에 온 변경 이벤트는 보내지 않는다. 바깥 변경(되돌리기, 텍스트 에디터, writeMeta)은 0일 때 온다.
     */
    let ownEdits = 0;
    let queue: Promise<void> = Promise.resolve();
    const applyBody = (body: string) => {
      queue = queue.then(async () => {
        const range = bodyRange(document);
        if (range === null) {
          post({ type: "error", message: BROKEN });
          return;
        }
        if (document.getText(range) === body) {
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

    const sendTags = () => post({ type: "tags", counts: [...this.store.tagCounts(label)] });

    const changeSub = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString() && ownEdits === 0) {
        sendDoc();
      }
    });
    // 다른 메모가 저장되면 태그 후보가 바뀐다
    const storeSub = this.store.onDidChange(sendTags);
    panel.onDidDispose(() => {
      changeSub.dispose();
      storeSub.dispose();
    });

    panel.webview.onDidReceiveMessage(async (message: EditorToHost) => {
      switch (message.type) {
        case "ready": {
          const layout = this.globalState.get<Layout>(LAYOUT_KEY);
          if (layout !== undefined) {
            post({ type: "layout", layout });
          }
          sendDoc();
          sendTags();
          return;
        }
        case "layout":
          await this.globalState.update(LAYOUT_KEY, message.layout);
          return;
        case "edit":
          applyBody(message.body);
          return;
        case "requestCode":
          post({ type: "code", blocks: await this.codeFor(document, label) });
          return;
        case "reveal":
          await reveal(message.path, message.line, panel.viewColumn);
          return;
        case "delete":
          await vscode.commands.executeCommand(DELETE_NOTE, label);
          return;
        case "rename":
          await vscode.commands.executeCommand(RENAME_NOTE, label);
          return;
        case "setTitle":
          try {
            await this.store.setTitle(label, message.title);
          } catch (error) {
            void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
            sendDoc(); // 입력칸에 남은 값을 원래 제목으로 되돌린다
          }
          return;
        case "findTag":
          await vscode.commands.executeCommand(FIND_BY_TAG, message.tag);
          return;
        default: {
          const unhandled: never = message;
          console.error("[note-map] unhandled editor message", unhandled);
        }
      }
    });
  }

  // 저장 안 한 frontmatter(방금 추가된 앵커 포함)를 보려고 디스크가 아니라 문서를 읽는다
  private async codeFor(document: vscode.TextDocument, label: string) {
    try {
      return await codeBlocks(label, parseNote(document.getText(), label).meta);
    } catch (error) {
      const message = error instanceof BrokenNoteError ? error.message : String(error);
      return [{ path: "(frontmatter)", start: 0, lines: [], focus: null, missing: message }];
    }
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
    <div class="head-part head-name"><span id="title" title="클릭해서 제목 편집"></span><input id="title-input" type="text" hidden><span id="label"></span></div>
    <div class="head-part" id="tags"></div>
    <div class="head-part head-actions">
      <label class="toggle"><input type="checkbox" id="show-code"> 코드 보기</label>
      <button type="button" id="rename" title="라벨 이름 바꾸기 (노트 파일과 모든 마커)">이름 변경</button>
      <button type="button" id="delete" title="메모 삭제">삭제</button>
    </div>
  </header>
  <p id="error" hidden></p>
  <section id="code" hidden></section>
  <div class="splitter" id="split-code" data-between="code,preview" title="드래그로 크기 조절 · 더블클릭으로 기본값" hidden></div>
  <section id="preview"></section>
  <div class="splitter" id="split-input" data-between="preview,input" title="드래그로 크기 조절 · 더블클릭으로 기본값"></div>
  <textarea id="input" spellcheck="false" placeholder="마크다운으로 메모를 쓰세요. #태그 · 저장은 Ctrl+S"></textarea>
  <ul id="tag-popup" role="listbox" hidden></ul>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// 저장소 폴더 밖의 `.notemap/notes/*.md`도 이 에디터로 열린다. 그때는 파일명을 라벨로 쓴다
function fileLabel(uri: vscode.Uri): string {
  const name = uri.path.split("/").pop() ?? "";
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

// 본문 경계는 파서와 같은 bodyOffset 하나로 정한다
function bodyRange(document: vscode.TextDocument): vscode.Range | null {
  const offset = bodyOffset(document.getText());
  if (offset === null) {
    return null;
  }
  return new vscode.Range(document.positionAt(offset), document.lineAt(document.lineCount - 1).range.end);
}

function readDoc(document: vscode.TextDocument, label: string): { label: string; title: string; body: string } {
  const range = bodyRange(document);
  let title = label;
  try {
    title = parseNote(document.getText(), label).meta.title;
  } catch {
    // 제목만 못 읽은 것. 본문은 range로 따로 자른다
  }
  return { label, title, body: range === null ? document.getText() : document.getText(range) };
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
