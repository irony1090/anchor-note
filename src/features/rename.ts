import * as vscode from "vscode";
import { isValidLabel, toLabel } from "../core/label";
import { markerPrefix, planRenameMarkers } from "../markers/edit";
import type { MarkerPlan } from "../markers/edit";
import { findLabels } from "../markers/search";
import type { NoteStore } from "../notes/store";
import { activeNoteLabel, pickNote } from "./delete";
import { OPEN_NOTE, noteColumn } from "./note-here";

export const RENAME_NOTE = "anchorNotes.renameNote";

// 라벨 이름 바꾸기: 노트 파일·frontmatter·코드의 모든 마커를 한 번에 (근거는 NoteStore.rename)
export function registerRename(store: NoteStore): vscode.Disposable {
  return vscode.commands.registerCommand(RENAME_NOTE, async (labelArg?: unknown) => {
    try {
      const from = typeof labelArg === "string" ? labelArg : (activeNoteLabel(store) ?? (await pickNote(store, "이름을 바꿀 메모")));
      if (from === undefined || store.get(from) === undefined) {
        return;
      }
      const to = await askLabel(store, from);
      if (to === undefined || to === from) {
        return;
      }

      const hits = (await findLabels(new Set([from]), markerPrefix())).get(from) ?? [];
      const files = [...new Map(hits.map((hit) => [hit.uri.toString(), hit.uri] as const)).values()];
      const wasOpen = isOpen(store.uriOf(from));

      let markers: MarkerPlan | undefined;
      await store.rename(from, to, async (edit) => {
        markers = await planRenameMarkers(edit, files, from, to);
      });
      await markers?.save();
      // 열려 있던 탭은 VSCode가 새 이름으로 옮겼다. 다시 열면 옆 그룹에 하나 더 생긴다
      if (!wasOpen) {
        await vscode.commands.executeCommand(OPEN_NOTE, to);
      }
      void vscode.window.showInformationMessage(`라벨 '${from}' -> '${to}' · 마커 ${markers?.count ?? 0}곳`);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });
}

function isOpen(uri: vscode.Uri | null): boolean {
  return uri !== null && noteColumn(uri) !== undefined;
}

// 공백은 거부하지 않고 안내만 한 뒤 `_`로 바꾼다 (D22 라벨 공백 금지)
function askLabel(store: NoteStore, from: string): Thenable<string | undefined> {
  return vscode.window
    .showInputBox({
      title: `'${from}' 라벨 이름 바꾸기`,
      prompt: "노트 파일 이름과 코드의 모든 마커가 함께 바뀝니다",
      value: from,
      validateInput: (value) => {
        const label = toLabel(value);
        if (label === "" || label === from) {
          return undefined;
        }
        if (!isValidLabel(label)) {
          return '/ \\ : * ? " < > | ` 와 끝의 마침표는 쓸 수 없습니다';
        }
        if (store.get(label) !== undefined) {
          return `이미 있는 라벨입니다: ${label}`;
        }
        return /\s/.test(value.trim())
          ? { message: `공백은 _로 바뀝니다: ${label}`, severity: vscode.InputBoxValidationSeverity.Info }
          : undefined;
      },
    })
    .then((value) => (value === undefined || toLabel(value) === "" ? undefined : toLabel(value)));
}
