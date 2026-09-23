import * as vscode from "vscode";
import { isLabelChars } from "../core/label";
import { partialMarkerAt } from "../core/marker";
import { markerPrefix } from "../markers/edit";
import type { NoteStore } from "../notes/store";

const DOC_CHARS = 300;

// `@note:` 뒤에서 기존 라벨 자동완성 (R6 자동완성). 넣은 마커는 저장 시 R5(마커 스캔)가 anchors에 올린다
export function registerCompletion(store: NoteStore): vscode.Disposable {
  let registration = register(store);
  // 트리거 문자가 prefix 마지막 글자라 prefix가 바뀌면 다시 등록한다
  const onConfig = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("anchorNotes.markerPrefix")) {
      registration.dispose();
      registration = register(store);
    }
  });
  return new vscode.Disposable(() => {
    onConfig.dispose();
    registration.dispose();
  });
}

function register(store: NoteStore): vscode.Disposable {
  const prefix = markerPrefix();
  return vscode.languages.registerCompletionItemProvider(
    { scheme: "file" },
    {
      provideCompletionItems(doc, position) {
        // 노트 파일에는 마커를 넣지 않는다
        if (store.labelOf(doc.uri) !== null) {
          return undefined;
        }
        const line = doc.lineAt(position.line).text;
        const found = partialMarkerAt(line.slice(0, position.character), prefix);
        if (found === null) {
          return undefined;
        }
        // 커서가 라벨 중간이면 뒤쪽 남은 글자까지 바꿀 수 있게 한다 (Tab/Enter 설정에 따라 insert 또는 replace)
        const tail = /^\S*/.exec(line.slice(position.character))?.[0] ?? "";
        const tailEnd = position.character + (isLabelChars(tail) ? tail.length : 0);
        const start = new vscode.Position(position.line, found.start);
        const range = {
          inserting: new vscode.Range(start, position),
          replacing: new vscode.Range(start, new vscode.Position(position.line, tailEnd)),
        };

        return store.labels().map((label) => {
          const note = store.get(label);
          const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
          item.range = range;
          item.detail = note === undefined || note.meta.title === label ? "메모" : note.meta.title;
          const body = note?.body.trim() ?? "";
          // 신뢰하지 않는 마크다운이라 command 링크는 돌지 않는다
          item.documentation = new vscode.MarkdownString(
            body === "" ? "_(빈 메모)_" : body.length > DOC_CHARS ? `${body.slice(0, DOC_CHARS)}…` : body,
          );
          return item;
        });
      },
    },
    prefix.slice(-1),
  );
}
