import * as vscode from "vscode";
import { dropFileAnchor, fileAnchor, fileAnchorIndex } from "../core/anchors";
import type { NoteStore } from "../notes/store";
import { NOTE_ON_FILE, OPEN_NOTE, anchorPath, pickLabel } from "./note-here";

// 파일 앵커 정식화 (REF-file-anchor): F2(파일에 메모) · F4(첫 줄 CodeLens) · F5(탐색기 배지) · F6(파일에서 떼기)
export const DETACH_FILE = "anchorNotes.detachFile";
// 파일 앵커가 있는 파일 경로들. 탐색기·탭 우클릭 메뉴의 [떼기] 표시 조건 (package.json `resourcePath in ...`)
const FILE_NOTE_PATHS = "anchorNotes.fileNotePaths";

export function registerFileNotes(store: NoteStore): vscode.Disposable[] {
  const index = new FileNoteIndex(store);

  const noteOnFile = async (uriArg?: unknown) => {
    try {
      const uri = uriArg instanceof vscode.Uri ? uriArg : activeTabUri();
      if (uri === undefined) {
        void vscode.window.showInformationMessage("메모를 붙일 파일을 탐색기나 탭에서 고르세요");
        return;
      }
      const path = anchorPath(store, uri);
      const label = await pickLabel(store, `${basename(path)}에 붙일 메모`);
      if (label === undefined) {
        return;
      }
      if (store.get(label) === undefined) {
        await store.create(label, fileAnchor(path));
      } else {
        await store.addAnchor(label, fileAnchor(path));
      }
      await vscode.commands.executeCommand(OPEN_NOTE, label);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  // 앵커만 뺀다. 메모는 남긴다 (D14 라벨 다중 앵커 — 사람이 쓴 글을 자동으로 지우지 않음)
  const detachFile = async (uriArg?: unknown) => {
    try {
      const uri = uriArg instanceof vscode.Uri ? uriArg : activeTabUri();
      const path = uri === undefined ? undefined : relativePath(uri);
      const labels = path === undefined ? [] : index.labelsOn(path);
      if (path === undefined || labels.length === 0) {
        void vscode.window.showInformationMessage("이 파일에 붙은 메모가 없습니다");
        return;
      }
      const label = labels.length === 1 ? labels[0] : await pickFrom(store, labels, `${basename(path)}에서 뗄 메모`);
      const note = label === undefined ? undefined : store.get(label);
      const next = note === undefined ? null : dropFileAnchor(note.meta.anchors, path);
      if (label === undefined || next === null) {
        return;
      }
      await store.setAnchors(label, next);
      void vscode.window.showInformationMessage(`메모 '${label}'를 ${basename(path)}에서 떼었습니다 (메모는 남아 있습니다)`);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return [
    index,
    vscode.commands.registerCommand(NOTE_ON_FILE, noteOnFile),
    vscode.commands.registerCommand(DETACH_FILE, detachFile),
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, new FileLens(store, index)),
    vscode.window.registerFileDecorationProvider(new FileBadge(store, index)),
  ];
}

// 경로 -> 라벨 색인. 저장소가 바뀔 때마다 다시 만들고, 바뀐 경로를 알린다 (배지는 파일마다 불리므로 매번 전체 메모를 돌지 않게)
class FileNoteIndex implements vscode.Disposable {
  private index = new Map<string, string[]>();
  private readonly changed = new vscode.EventEmitter<string[]>();
  // 배지·CodeLens가 바뀌어야 할 경로들 (이전 + 지금)
  readonly onDidChange = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly store: NoteStore) {
    this.subscription = store.onDidChange(() => this.rebuild());
    this.rebuild();
  }

  labelsOn(path: string): string[] {
    return this.index.get(path) ?? [];
  }

  private rebuild(): void {
    const before = this.index;
    this.index = fileAnchorIndex(
      this.store.labels().flatMap((label) => {
        const note = this.store.get(label);
        return note === undefined ? [] : [{ label, anchors: note.meta.anchors }];
      }),
    );
    const touched = [...new Set([...before.keys(), ...this.index.keys()])].filter(
      (path) => (before.get(path) ?? []).join("\n") !== (this.index.get(path) ?? []).join("\n"),
    );
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (root !== undefined) {
      const paths = Object.fromEntries([...this.index.keys()].map((path) => [vscode.Uri.joinPath(root, path).fsPath, true]));
      void vscode.commands.executeCommand("setContext", FILE_NOTE_PATHS, paths);
    }
    if (touched.length > 0) {
      this.changed.fire(touched);
    }
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}

// F4(첫 줄 CodeLens): 파일 앵커 메모마다 1행 위에 `메모: 제목`
class FileLens implements vscode.CodeLensProvider {
  readonly onDidChangeCodeLenses: vscode.Event<void>;

  constructor(
    private readonly store: NoteStore,
    private readonly index: FileNoteIndex,
  ) {
    this.onDidChangeCodeLenses = (listener, thisArgs, disposables) => index.onDidChange(() => listener.call(thisArgs), null, disposables);
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const path = relativePath(doc.uri);
    const top = new vscode.Range(0, 0, 0, 0);
    return (path === undefined ? [] : this.index.labelsOn(path)).map(
      (label) =>
        new vscode.CodeLens(top, {
          title: `$(note) 메모: ${this.store.get(label)?.meta.title ?? label}`,
          tooltip: `이 파일에 붙은 메모 '${label}' 열기`,
          command: OPEN_NOTE,
          arguments: [label],
        }),
    );
  }
}

// F5(탐색기 배지): 이미지처럼 CodeLens가 안 뜨는 파일도 보이게. 폴더로 전파하지 않는다
class FileBadge implements vscode.FileDecorationProvider {
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri[]>;

  constructor(
    private readonly store: NoteStore,
    private readonly index: FileNoteIndex,
  ) {
    this.onDidChangeFileDecorations = (listener, thisArgs, disposables) =>
      index.onDidChange(
        (paths) => {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri;
          if (root !== undefined) {
            listener.call(thisArgs, paths.map((path) => vscode.Uri.joinPath(root, path)));
          }
        },
        null,
        disposables,
      );
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const path = relativePath(uri);
    const labels = path === undefined ? [] : this.index.labelsOn(path);
    if (labels.length === 0) {
      return undefined;
    }
    const titles = labels.map((label) => this.store.get(label)?.meta.title ?? label);
    // 배지는 2글자까지
    return new vscode.FileDecoration(labels.length === 1 ? "M" : String(Math.min(labels.length, 99)), `메모: ${titles.join(", ")}`);
  }
}

// 첫 폴더 안이면 상대경로 (D8 마크다운 저장)
function relativePath(uri: vscode.Uri): string | undefined {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined || vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.uri.toString()) {
    return undefined;
  }
  return vscode.workspace.asRelativePath(uri, false);
}

// 커맨드 팔레트에서 부를 때: 활성 탭의 파일 (텍스트·이미지 같은 커스텀 에디터 모두)
function activeTabUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

async function pickFrom(store: NoteStore, labels: string[], title: string): Promise<string | undefined> {
  const items = labels.map((label) => {
    const noteTitle = store.get(label)?.meta.title ?? label;
    return { label, description: noteTitle === label ? undefined : noteTitle };
  });
  return (await vscode.window.showQuickPick(items, { title, matchOnDescription: true }))?.label;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
