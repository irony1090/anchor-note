import * as vscode from "vscode";
import { DEFAULT_VIEW } from "../shared/protocol";
import type {
  Anchor,
  ExtensionToWebview,
  NoteKind,
  NotesPatch,
  ViewState,
  WebviewToExtension,
} from "../shared/protocol";
import { findMarker, insertMarker, markerSyntax, markerText, removeMarker } from "../editor/insert";
import { NoteStore } from "../notes/store";
import { NotesWatcher } from "../notes/watcher";
import { TreeStore } from "../workspace/tree-store";
import { WorkspaceWatcher } from "../workspace/watcher";

const VIEW_KEY = "noteMap.view";

/** 탐색기 + (P5 메모 마인드맵) 웹뷰 패널. 워크스페이스당 하나만 띄운다 (D1 웹뷰 패널) */
export class MapPanel {
  public static readonly viewType = "noteMap.map";

  private static current: MapPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly store = new TreeStore();
  private readonly notes = new NoteStore();

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
    this.disposables.push(
      new NotesWatcher({
        changed: (uri) => void this.onNoteFileChanged(uri),
        deleted: (uri) => this.postNotes(this.notes.forget(uri)),
      }),
    );
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
      case "openNote":
        this.sendBody(message.label);
        return;
      case "createNote":
        void this.createNote(message);
        return;
      case "updateNote":
        void this.updateNote(message);
        return;
      case "deleteNote":
        void this.deleteNote(message.label, message.children);
        return;
      case "revealAnchor":
        void this.revealAnchor(message.label, message.at);
        return;
      default: {
        // 새 메시지를 protocol.ts에 추가하고 여기를 안 고치면 컴파일이 깨진다
        const unhandled: never = message;
        console.error("[note-map] unhandled message", unhandled);
      }
    }
  }

  /** 필드를 추가하기 전에 저장된 상태가 그대로 남아 있다. 빠진 값은 기본값으로 채운다 */
  private view(): ViewState {
    return { ...DEFAULT_VIEW, ...this.state.get<ViewState>(VIEW_KEY) };
  }

  private async updateView(view: ViewState): Promise<void> {
    await this.state.update(VIEW_KEY, view);
  }

  private async sendInit(): Promise<void> {
    try {
      await this.store.refresh();
      await this.notes.load();
      this.post({
        type: "init",
        workspaceName: vscode.workspace.name ?? null,
        tree: this.store.current,
        view: this.view(),
        notes: this.notes.metas(),
      });
      this.reportBroken();
    } catch (error) {
      this.post({ type: "error", message: describe(error) });
    }
  }

  /** 파싱이 깨진 노트는 고치지 않는다. 있다는 사실만 알린다 (REF-notes 3절) */
  private reportBroken(): void {
    const broken = this.notes.brokenFiles();
    if (broken.length === 0) {
      return;
    }
    const detail = broken.map(({ file, reason }) => `${file} (${reason})`).join(", ");
    this.post({ type: "error", message: `읽지 못한 노트 ${broken.length}개 — ${detail}` });
  }

  private sendBody(label: string): void {
    const note = this.notes.get(label);
    if (note === undefined) {
      this.post({ type: "error", message: `없는 메모입니다: ${label}` });
      return;
    }
    this.post({ type: "noteBody", label, body: note.body });
  }

  /**
   * 메모를 만든다. 셋 중 하나다.
   * 하위 메모(parentLabel 있음)는 코드에 흔적을 남기지 않고, line이 있으면 그 줄에 마커를 써넣고,
   * 둘 다 아니면 파일 전체 메모다 (REF-notes 3·4절).
   */
  private async createNote(message: {
    targetId: string;
    line?: number;
    parentLabel?: string | null;
    label: string;
    title: string;
  }): Promise<void> {
    const uri = vscode.Uri.parse(message.targetId);
    const path = vscode.workspace.asRelativePath(uri, false);
    const parentLabel = message.parentLabel ?? null;

    try {
      let kind: NoteKind = "marker";
      let anchors: Anchor[] = [];

      if (parentLabel !== null) {
        kind = "marker"; // 하위 메모는 부모를 따라 붙는다. 마커를 달지 않는다
      } else if (message.line === undefined) {
        kind = "file";
        anchors = [{ path }];
      } else {
        const inserted = await insertMarker(uri, message.line, message.label);
        anchors = [{ path, lineText: inserted.lineText }];
        if (inserted.bare) {
          void vscode.window.showWarningMessage(
            `주석 문법을 모르는 파일이라 마커만 넣었습니다. 직접 주석으로 감싸주세요: ${markerText(message.label)}`,
          );
        }
      }

      const meta = await this.notes.create({
        label: message.label,
        title: message.title,
        kind,
        anchors,
        parentLabel,
      });
      this.postNotes({ upserted: [meta], removed: [] });
      this.post({ type: "noteBody", label: meta.label, body: "" });
    } catch (error) {
      this.post({ type: "error", message: describe(error) });
    }
  }

  private async updateNote(message: { label: string; title?: string; body?: string }): Promise<void> {
    try {
      const meta = await this.notes.update(message.label, { title: message.title, body: message.body });
      this.postNotes({ upserted: [meta], removed: [] });
    } catch (error) {
      this.post({ type: "error", message: describe(error) });
    }
  }

  /**
   * 메모를 지우면 그 메모의 앵커가 있는 **모든 소스 파일**이 고쳐진다.
   * 한 번의 삭제가 여러 파일을 건드리므로 지우기 전에 앵커 목록을 보여주고 확인을 받는다 (REF-notes 7절).
   */
  private async deleteNote(label: string, children: "promote" | "delete"): Promise<void> {
    const note = this.notes.get(label);
    if (note === undefined) {
      this.post({ type: "error", message: `없는 메모입니다: ${label}` });
      return;
    }

    // file 메모는 소스에 마커가 없다. 앵커 파일을 뒤지면 본문 속 같은 문자열을 지운다 (B10)
    const markerPaths = note.kind === "file" ? [] : note.anchors.map((anchor) => anchor.path);

    if (note.anchors.length > 0) {
      const answer = await vscode.window.showWarningMessage(
        markerPaths.length > 0
          ? `"${label}" 메모를 지우면 아래 파일의 마커도 지워집니다.`
          : `"${label}" 메모를 지웁니다. 소스 파일은 건드리지 않습니다.`,
        { modal: true, detail: markerPaths.length > 0 ? markerPaths.join("\n") : undefined },
        "지우기",
      );
      if (answer !== "지우기") {
        return;
      }
    }

    try {
      for (const path of markerPaths) {
        const uri = resolveAnchor(path);
        if (uri !== null) {
          await removeMarker(uri, label);
        }
      }
      this.postNotes(await this.notes.remove(label, children));
    } catch (error) {
      this.post({ type: "error", message: describe(error) });
    }
  }

  /**
   * 앵커 자리로 에디터를 보낸다. 저장된 좌표가 없으므로 그 파일에서 마커를 찾는다 —
   * 마커가 줄의 원본이라 파일을 읽어야만 지금 몇 번째 줄인지 알 수 있다 (D11 코드 라벨 앵커).
   */
  private async revealAnchor(label: string, at: number): Promise<void> {
    const note = this.notes.get(label);
    const anchor = note?.anchors[at];
    if (anchor === undefined) {
      this.post({ type: "error", message: `앵커를 찾을 수 없습니다: ${label}` });
      return;
    }

    const uri = resolveAnchor(anchor.path);
    if (uri === null) {
      this.post({ type: "error", message: `워크스페이스가 없어 ${anchor.path} 를 열 수 없습니다` });
      return;
    }

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      // file 메모는 마커가 없으니 파일만 연다 (B10)
      const fileNote = note?.kind === "file";
      const syntax = markerSyntax();
      const marker = markerText(label, syntax);
      let line = -1;
      for (let i = 0; i < doc.lineCount && !fileNote; i++) {
        if (findMarker(doc.lineAt(i).text, marker, syntax) !== -1) {
          line = i;
          break;
        }
      }
      const selection = line === -1 ? undefined : new vscode.Range(line, 0, line, 0);
      await vscode.window.showTextDocument(doc, { selection, viewColumn: vscode.ViewColumn.Beside });
      if (line === -1 && !fileNote) {
        this.post({ type: "error", message: `${anchor.path} 에서 마커를 찾지 못했습니다` });
      }
    } catch (error) {
      this.post({ type: "error", message: describe(error) });
    }
  }

  private async onNoteFileChanged(uri: vscode.Uri): Promise<void> {
    try {
      this.postNotes(await this.notes.reload(uri));
      this.reportBroken();
    } catch (error) {
      this.post({ type: "error", message: describe(error) });
    }
  }

  private postNotes(patch: NotesPatch | null): void {
    if (patch !== null && (patch.upserted.length > 0 || patch.removed.length > 0)) {
      this.post({ type: "notesPatch", patch });
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
    <label class="toolbar-field" for="note-filter">메모</label>
    <select id="note-filter" title="메모 유무로 카드 거르기">
      <option value="all">전체</option>
      <option value="with">메모 있음</option>
      <option value="without">메모 없음</option>
      <option value="orphan">orphan 있음</option>
    </select>
    <button id="sort-dir" type="button" title="이름순 정렬 방향">이름순 A-Z</button>
  </header>
  <nav id="breadcrumb" aria-label="현재 위치"></nav>
  <div id="split">
    <main id="cards" tabindex="0" aria-label="폴더 내용"></main>
    <aside id="note-panel" aria-label="메모" hidden></aside>
  </div>
  <div id="preview" role="dialog" aria-label="메모 미리보기" hidden></div>
  <p class="status" id="status"><span id="status-text">웹뷰 부팅 중...</span><button id="status-close" class="status-close" type="button" title="닫기" hidden>x</button></p>
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

/** 앵커의 상대경로를 첫 워크스페이스 폴더 기준으로 되돌린다 */
function resolveAnchor(path: string): vscode.Uri | null {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  return root === undefined ? null : vscode.Uri.joinPath(root, path);
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
