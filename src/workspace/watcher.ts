import * as vscode from "vscode";

/** npm install이나 git checkout 한 번에 이벤트가 수천 개 쏟아진다. 멈춘 뒤에 한 번만 돌린다 */
const DEBOUNCE_MS = 500;

/**
 * 워크스페이스 파일 변경을 감지해 "트리가 더러워졌다"만 알린다.
 * 어느 파일이 어떻게 바뀌었는지는 넘기지 않는다 — 제외 설정(files.exclude/search.exclude)을 이벤트 단위로
 * 다시 판정할 방법이 없어서, 다시 스캔하고 비교하는 쪽이 정확하기 때문이다 (TreeStore가 담당).
 */
export class WorkspaceWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly onDirty: () => void) {
    // 내용 변경(change)은 트리 모양을 바꾸지 않으므로 무시한다
    const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, true, false);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => this.schedule()),
      watcher.onDidDelete(() => this.schedule()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
    );
  }

  private schedule(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.onDirty();
    }, DEBOUNCE_MS);
  }

  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
