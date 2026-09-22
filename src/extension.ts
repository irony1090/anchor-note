import type * as vscode from "vscode";
import { NoteEditorProvider } from "./editor/note-editor";
import { registerCompletion } from "./features/completion";
import { registerDelete } from "./features/delete";
import { registerHover } from "./features/hover";
import { registerNoteHere } from "./features/note-here";
import { registerRename } from "./features/rename";
import { registerTagSearch } from "./features/tag-search";
import { registerSync } from "./markers/sync";
import { stampOnSave } from "./notes/stamp";
import { NoteStore } from "./notes/store";
import { watchNotes } from "./notes/watcher";

export function activate(context: vscode.ExtensionContext): void {
  const store = new NoteStore();
  context.subscriptions.push(store, registerTagSearch(store), registerRename(store));
  // watcher를 load보다 먼저 붙인다. 읽는 사이에 바뀐 파일을 놓치지 않게
  const deletion = registerDelete(store);
  context.subscriptions.push(watchNotes(store, deletion.onNoteDeleted), stampOnSave(store), ...deletion.disposables);
  context.subscriptions.push(...registerNoteHere(store), registerHover(store), registerCompletion(store));
  context.subscriptions.push(NoteEditorProvider.register(context, store), ...registerSync(store));
  void store.load().then(() => console.log(`[note-map] activated, ${store.labels().length} notes`));
}

export function deactivate(): void {
  // 정리할 자원은 전부 context.subscriptions에 넣는다
}
