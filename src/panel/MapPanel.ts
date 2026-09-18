import * as vscode from "vscode";
import { DEFAULT_VIEW } from "../shared/protocol";
import type { ExtensionToWebview, ViewState, WebviewToExtension } from "../shared/protocol";
import { TreeStore } from "../workspace/tree-store";
import { WorkspaceWatcher } from "../workspace/watcher";

const VIEW_KEY = "noteMap.view";

/** 탐색기 + (P5 메모 마인드맵) 웹뷰 패널. 워크스페이스당 하나만 띄운다 (D1 웹뷰 패널) */
export class MapPanel {
  public static readonly viewType = "noteMap.map";

  private static current: MapPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly store = new TreeStore();

  static createOrShow(extensionUri: vscode.Uri, state: vscode.Memento): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (MapPanel.current) {
      MapPanel.current.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      MapPanel.viewType,
      "Note Map",
      column,
      {
        ...MapPanel.webviewOptions(extensionUri),
        // 탭을 다른 탭으로 가렸다 돌아와도 스크롤 위치와 선택이 살아있어야 한다
        retainContextWhenHidden: true,
      },
    );

    MapPanel.current = new MapPanel(panel, extensionUri, state);
  }

  /** VSCode 재시작 후 패널 복원 경로. options를 먼저 되돌려놓아야 스크립트가 다시 실행된다 */
  static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, state: vscode.Memento): void {
    panel.webview.options = MapPanel.webviewOptions(extensionUri);
    MapPanel.current = new MapPanel(panel, extensionUri, state);
  }

  private static webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, "dist"),
        vscode.Uri.joinPath(extensionUri, "media"),
      ],
    };
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly state: vscode.Memento,
  ) {
    this.panel.webview.html = this.buildHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToExtension) => this.onMessage(message),
      null,
      this.disposables,
    );

    this.disposables.push(new WorkspaceWatcher(() => void this.onWorkspaceDirty()));
  }

  private onMessage(message: WebviewToExtension): void {
    switch (message.type) {
      case "ready":
        void this.sendInit();
        return;
      case "navigate":
        void this.updateView({ ...this.view(), cwdId: message.nodeId });
        return;
      case "setView":
        void this.updateView(message.view);
        return;
      case "openFile":
        void this.openFile(message.nodeId);
        return;
      default: {
        // 새 메시지를 protocol.ts에 추가하고 여기를 안 고치면 컴파일이 깨진다
        const unhandled: never = message;
        console.error("[note-map] unhandled message", unhandled);
      }
    }
  }

  private view(): ViewState {
    return this.state.get<ViewState>(VIEW_KEY) ?? DEFAULT_VIEW;
  }

  private async updateView(view: ViewState): Promise<void> {
    await this.state.update(VIEW_KEY, view);
  }

  private async sendInit(): Promise<void> {
    try {
      await this.store.refresh();
      this.post({
        type: "init",
        workspaceName: vscode.workspace.name ?? null,
        tree: this.store.current,
        view: this.view(),
      });
    } catch (error) {
      this.post({ type: "error", message: describe(error) });
    }
  }

  private async onWorkspaceDirty(): Promise<void> {
    try {
      const result = await this.store.refresh();
      switch (result.kind) {
        case "unchanged":
          return;
        case "replaced":
          this.post({ type: "treeReplaced", tree: result.tree });
          return;
        case "patched":
          this.post({ type: "treePatch", patch: result.patch });
          return;
        default: {
          const unhandled: never = result;
          console.error("[note-map] unhandled refresh result", unhandled);
        }
      }
    } catch (error) {
      this.post({ type: "error", message: describe(error) });
    }
  }

  /**
   * `openTextDocument`가 아니라 `vscode.open` 커맨드를 쓴다.
   * 전자는 텍스트 문서만 다뤄서 이미지·폰트·바이너리에서 예외가 난다. 후자는 VSCode가 그 파일에 맞는
   * 에디터(이미지 미리보기 등)를 골라주고, 정말 못 여는 것만 자기 안내를 띄운다.
   */
  private async openFile(nodeId: string): Promise<void> {
    const uri = vscode.Uri.parse(nodeId);
    try {
      await vscode.commands.executeCommand("vscode.open", uri, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
      } satisfies vscode.TextDocumentShowOptions);
    } catch (error) {
      this.post({ type: "error", message: `${basenameOf(uri)} 를 열 수 없습니다 — ${describe(error)}` });
    }
  }

  private post(message: ExtensionToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "style.css"));

    // CSP를 빼면 웹뷰가 아무 스크립트나 실행한다. nonce 없는 인라인 스크립트는 차단된다 (D3 CDN 금지)
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
  <title>Note Map</title>
</head>
<body>
  <header id="toolbar">
    <span id="workspace-name">Note Map</span>
    <span id="stats"></span>
    <span class="spacer"></span>
    <button id="sort-dir" type="button" title="이름순 정렬 방향">이름순 A-Z</button>
  </header>
  <nav id="breadcrumb" aria-label="현재 위치"></nav>
  <main id="cards" tabindex="0" aria-label="폴더 내용"></main>
  <div id="preview" role="dialog" aria-label="메모 미리보기" hidden></div>
  <p class="status" id="status">웹뷰 부팅 중...</p>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    MapPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }
}

function basenameOf(uri: vscode.Uri): string {
  const segments = uri.path.split("/");
  return segments[segments.length - 1] ?? uri.path;
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
