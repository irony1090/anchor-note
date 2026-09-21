import type * as vscode from "vscode";
import { stampOnSave } from "./notes/stamp";
import { NoteStore } from "./notes/store";
import { watchNotes } from "./notes/watcher";

export function activate(context: vscode.ExtensionContext): void {
  const store = new NoteStore();
  // watcher를 load보다 먼저 붙인다. 읽는 사이에 바뀐 파일을 놓치지 않게
  context.subscriptions.push(watchNotes(store), stampOnSave(store));
  void store.load().then(() => console.log(`[note-map] activated, ${store.labels().length} notes`));
}

export function deactivate(): void {
  // 정리할 자원은 전부 context.subscriptions에 넣는다
}
