import * as vscode from "vscode";
import { NOTES_DIR } from "./store";
import type { NoteStore } from "./store";

// 첫 폴더의 `.notemap/notes/*.md`만 감시한다. 에디터·Obsidian·git으로 바뀐 노트가 모두 이 경로로 저장소에 들어온다
export function watchNotes(store: NoteStore): vscode.Disposable {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    return new vscode.Disposable(() => undefined);
  }
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, `${NOTES_DIR}/*.md`));
  return vscode.Disposable.from(
    watcher,
    watcher.onDidCreate((uri) => void store.reload(uri)),
    watcher.onDidChange((uri) => void store.reload(uri)),
    watcher.onDidDelete((uri) => store.forget(uri)),
  );
}
