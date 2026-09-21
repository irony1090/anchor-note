import * as vscode from "vscode";
import { bodyOffset, updatedEdit } from "./frontmatter";
import type { NoteStore } from "./store";

/**
 * 노트 문서를 저장할 때 본문이 디스크와 달라졌으면 frontmatter `updated`를 지금 시각으로 바꾼다.
 * 본문으로 비교하는 이유: 저장소가 앵커만 고쳐 저장할 때(writeMeta)는 updated가 바뀌면 안 된다.
 */
export function stampOnSave(store: NoteStore): vscode.Disposable {
  return vscode.workspace.onWillSaveTextDocument((event) => {
    const doc = event.document;
    const label = store.labelOf(doc.uri);
    const note = label === null ? undefined : store.get(label);
    if (note === undefined) {
      return;
    }
    const text = doc.getText();
    const start = bodyOffset(text);
    if (start === null || text.slice(start) === note.body) {
      return;
    }
    const edit = updatedEdit(text, new Date().toISOString());
    if (edit !== null) {
      const range = new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end));
      event.waitUntil(Promise.resolve([vscode.TextEdit.replace(range, edit.text)]));
    }
  });
}
