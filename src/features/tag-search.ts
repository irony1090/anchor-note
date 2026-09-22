import * as vscode from "vscode";
import type { NoteStore } from "../notes/store";
import { OPEN_NOTE } from "./note-here";

export const FIND_BY_TAG = "noteMap.findByTag";

// 태그로 메모 찾기: 태그(메모 수) -> 그 태그의 메모 -> 연다 (R8 태그). 태그를 인자로 받으면 첫 단계를 건너뛴다
export function registerTagSearch(store: NoteStore): vscode.Disposable {
  return vscode.commands.registerCommand(FIND_BY_TAG, async (tagArg?: unknown) => {
    const tag = typeof tagArg === "string" ? tagArg : await pickTag(store);
    if (tag === undefined) {
      return;
    }
    const items = store
      .labelsWithTag(tag)
      .sort((a, b) => a.localeCompare(b))
      .map((label) => {
        const title = store.get(label)?.meta.title ?? label;
        return { label, description: title === label ? undefined : title };
      });
    if (items.length === 0) {
      void vscode.window.showInformationMessage(`#${tag} 태그가 붙은 저장된 메모가 없습니다`);
      return;
    }
    const picked = await vscode.window.showQuickPick(items, { title: `#${tag}`, matchOnDescription: true });
    if (picked !== undefined) {
      await vscode.commands.executeCommand(OPEN_NOTE, picked.label);
    }
  });
}

async function pickTag(store: NoteStore): Promise<string | undefined> {
  const items = [...store.tagCounts()]
    .sort(([a, n], [b, m]) => m - n || a.localeCompare(b))
    .map(([tag, count]) => ({ label: `#${tag}`, description: `메모 ${count}개`, tag }));
  if (items.length === 0) {
    void vscode.window.showInformationMessage("태그가 없습니다. 메모 본문에 #태그를 쓰면 생깁니다");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, { title: "태그로 메모 찾기" });
  return picked?.tag;
}
