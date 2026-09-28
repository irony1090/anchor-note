import * as vscode from "vscode";
import { plainText } from "../core/browse";
import type { BrowseNote } from "../core/browse";
import { NOTE_EDITOR_VIEW_TYPE } from "../editor/note-editor";
import { openAnchor } from "../editor/open-anchor";
import { NOTE_HERE, OPEN_NOTE } from "../features/note-here";
import { RESCAN, currentSpots, onDidChangeSpots } from "../markers/sync";
import type { RescanOptions } from "../markers/sync";
import type { NoteStore } from "../notes/store";
import type { BrowseToHost, HostToBrowse } from "./protocol";

export const BROWSE_VIEW = "anchorNotes.browse";
// 둘러보기를 열고 검색창에 커서 (단축키 Ctrl+; B)
export const OPEN_BROWSE = "anchorNotes.openBrowse";

// 이 세션에 첫 열기 다시 찾기를 했는지 (REF-browse 2절). 뷰를 숨겼다 다시 보이면 resolve가 또 불려서 밖에 둔다
let rescanned = false;

// 사이드바 둘러보기 (R9 — C 사이드바 웹뷰). 보조 화면이라 이 뷰를 안 열어도 메모 기능은 다 돈다 (D21 에디터 주도)
export function registerBrowse(context: vscode.ExtensionContext, store: NoteStore, loaded: Promise<void>): vscode.Disposable[] {
  const provider = new BrowseViewProvider(context.extensionUri, store, loaded);
  return [vscode.window.registerWebviewViewProvider(BROWSE_VIEW, provider), vscode.commands.registerCommand(OPEN_BROWSE, () => provider.focusSearch())];
}

class BrowseViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  // 웹뷰 스크립트가 "ready"를 보냈는지. 그 전에 보낸 메시지는 사라질 수 있다
  private ready = false;
  private wantSearch = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: NoteStore,
    private readonly loaded: Promise<void>,
  ) {}

  // 뷰가 처음 뜨는 중이면 ready 때 검색창으로
  async focusSearch(): Promise<void> {
    await vscode.commands.executeCommand(`${BROWSE_VIEW}.focus`);
    if (this.view !== undefined && this.ready) {
      void this.view.webview.postMessage({ type: "focusSearch" } satisfies HostToBrowse);
    } else {
      this.wantSearch = true;
    }
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.buildHtml(view.webview);

    const post = (message: HostToBrowse) => void view.webview.postMessage(message);
    const sendNotes = () => post({ type: "notes", notes: this.notes() });
    const sendOrphans = () => {
      const spots = currentSpots();
      post({ type: "orphans", spots: spots === null ? null : spots.filter((spot) => this.store.get(spot.label) === undefined) });
    };
    const sendActive = () => post({ type: "active", label: activeNote(this.store) });

    // 다시 찾기는 노트마다 저장소 변경을 낸다. 모아서 한 번 보낸다
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sendNotes();
        sendOrphans();
      }, 100);
    };
    const subs = [
      this.store.onDidChange(soon),
      onDidChangeSpots(sendOrphans),
      vscode.window.tabGroups.onDidChangeTabs(sendActive),
      vscode.window.tabGroups.onDidChangeTabGroups(sendActive),
    ];
    view.onDidDispose(() => {
      clearTimeout(timer);
      subs.forEach((sub) => sub.dispose());
      if (this.view === view) {
        this.view = undefined;
      }
    });

    view.webview.onDidReceiveMessage(async (message: BrowseToHost) => {
      switch (message.type) {
        case "ready":
          this.ready = true;
          sendNotes();
          sendOrphans();
          sendActive();
          if (this.wantSearch) {
            this.wantSearch = false;
            post({ type: "focusSearch" });
          }
          return;
        case "openNote":
          await vscode.commands.executeCommand(OPEN_NOTE, message.label);
          return;
        case "openAnchor":
          await openAnchor(message.label, message.anchor, undefined);
          return;
        case "openFile":
          await openPath(message.path);
          return;
        case "openSpot":
          await openPath(message.spot.path, message.spot);
          return;
        case "createNote": {
          // hover [메모 만들기]와 같은 인자 (uri, line, character) — 그 마커로 노트를 만들고 연다
          const uri = rootUri(message.spot.path);
          if (uri !== null) {
            await vscode.commands.executeCommand(NOTE_HERE, uri.toString(), message.spot.line, message.spot.character);
          }
          return;
        }
        default: {
          const unhandled: never = message;
          console.error("[anchor-notes] unhandled browse message", unhandled);
        }
      }
    });

    if (!rescanned) {
      rescanned = true;
      // 저장소를 다 읽기 전에 돌면 모든 라벨이 노트 없는 마커로 잡히고 앵커도 못 고친다
      const options: RescanOptions = { viewId: BROWSE_VIEW };
      void this.loaded.then(() => vscode.commands.executeCommand(RESCAN, options));
    }
  }

  private notes(): BrowseNote[] {
    return this.store.labels().flatMap((label) => {
      const note = this.store.get(label);
      return note === undefined ? [] : [{ label, title: note.meta.title, text: plainText(note.body), tags: note.tags, anchors: note.meta.anchors }];
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "browse.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "browse.css"));
    const csp = ["default-src 'none'", `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`].join("; ");

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>둘러보기</title>
</head>
<body>
  <div id="bar">
    <input id="search" type="text" aria-label="메모 찾기" placeholder="제목·라벨·본문·#태그" spellcheck="false">
    <div id="modes" role="group" aria-label="묶는 방식">
      <button type="button" data-mode="file">파일별</button>
      <button type="button" data-mode="tag">태그별</button>
    </div>
  </div>
  <div id="list"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// 활성 탭이 메모 에디터면 그 라벨
function activeNote(store: NoteStore): string | null {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom && input.viewType === NOTE_EDITOR_VIEW_TYPE ? store.labelOf(input.uri) : null;
}

function rootUri(path: string): vscode.Uri | null {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  return root === undefined ? null : vscode.Uri.joinPath(root, path);
}

// 경로 줄 클릭 = 그 형식의 기본 에디터로 (이미지면 이미지). at이 있으면 그 자리로
async function openPath(path: string, at?: { line: number; character: number }): Promise<void> {
  const uri = rootUri(path);
  if (uri === null) {
    return;
  }
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    void vscode.window.showWarningMessage(`Anchor Notes: ${path} 파일이 없습니다.`);
    return;
  }
  if (at === undefined) {
    await vscode.commands.executeCommand("vscode.open", uri);
  } else {
    const pos = new vscode.Position(at.line, at.character);
    await vscode.window.showTextDocument(uri, { selection: new vscode.Range(pos, pos) });
  }
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
