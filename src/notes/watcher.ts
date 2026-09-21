import * as vscode from "vscode";
import { NOTES_DIR } from "../shared/protocol";

/**
 * `.notemap/notes/*.md` 전용 감시자. 워크스페이스 감시자(WorkspaceWatcher)와 달리
 * **어느 파일인지를 그대로 넘긴다** — 노트는 파일 하나가 메모 하나라 그 파일만 다시 읽으면 된다.
 * 에디터·Obsidian·git으로 고친 것도 이 경로로 들어온다 (REF-architecture 8절).
 */
export class NotesWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(handlers: { changed: (uri: vscode.Uri) => void; deleted: (uri: vscode.Uri) => void }) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${NOTES_DIR}/notes/*.md`);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(handlers.changed),
      watcher.onDidChange(handlers.changed),
      watcher.onDidDelete(handlers.deleted),
    );
  }

  dispose(): void {
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
