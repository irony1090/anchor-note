import * as vscode from "vscode";
import { isValidLabel, toLabel } from "../core/label";
import { markerText, markersIn } from "../core/marker";
import type { MarkerHit } from "../core/marker";
import { NOTE_EDITOR_VIEW_TYPE } from "../editor/note-editor";
import { insertMarker, markerPrefix } from "../markers/edit";
import type { NoteStore } from "../notes/store";

export const NOTE_HERE = "anchorNotes.noteHere";
export const OPEN_NOTE = "anchorNotes.openNote";

// Ctrl+Alt+M: 줄에 마커가 있으면 그 메모를, 없으면 라벨을 받아 마커를 넣고 메모를 연다 (R3 단축키·hover)
export function registerNoteHere(store: NoteStore): vscode.Disposable[] {
  const openNote = async (label: string) => {
    const uri = store.uriOf(label);
    if (uri === null || store.get(label) === undefined) {
      void vscode.window.showErrorMessage(`없는 메모입니다: "${label}"`);
      return;
    }
    // 이미 열린 탭이 있으면 그 그룹에서 보여준다. 늘 Beside로 열면 메모 에디터에서 부를 때 옆 그룹에 하나 더 생긴다
    await vscode.commands.executeCommand("vscode.openWith", uri, NOTE_EDITOR_VIEW_TYPE, {
      viewColumn: noteColumn(uri) ?? vscode.ViewColumn.Beside,
      preview: false,
    });
  };

  // hover [메모 만들기]는 (uri, line, character)를 넘긴다. 단축키·커맨드 팔레트는 인자 없이 부른다
  const noteHere = async (uriArg?: unknown, lineArg?: unknown, charArg?: unknown) => {
    try {
      const fromHover = typeof uriArg === "string" && typeof lineArg === "number";
      const editor = vscode.window.activeTextEditor;
      const doc = fromHover ? await vscode.workspace.openTextDocument(vscode.Uri.parse(uriArg)) : editor?.document;
      if (doc === undefined) {
        return;
      }
      const path = anchorPath(store, doc.uri);
      const line = fromHover ? lineArg : (editor?.selection.active.line ?? 0);
      const character = fromHover ? (typeof charArg === "number" ? charArg : undefined) : editor?.selection.active.character;
      const text = doc.lineAt(line).text;

      const found = pickMarker(markersIn(text, markerPrefix()), character);
      if (found !== undefined) {
        await ensureNote(store, found.label, path, text);
        await openNote(found.label);
        return;
      }

      const label = await pickLabel(store, line);
      if (label === undefined) {
        return;
      }
      // 마커를 먼저 넣는다. 노트 생성이 실패해도 남는 건 노트 없는 마커라 hover가 [메모 만들기]로 받아준다
      const inserted = await insertMarker(doc.uri, line, label);
      if (inserted.bare) {
        void vscode.window.showWarningMessage(
          `주석 문법을 모르는 파일이라 마커만 넣었습니다. 직접 주석으로 감싸주세요: ${markerText(label, markerPrefix())}`,
        );
      }
      await ensureNote(store, label, path, inserted.lineText);
      await openNote(label);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return [vscode.commands.registerCommand(NOTE_HERE, noteHere), vscode.commands.registerCommand(OPEN_NOTE, openNote)];
}

// 이 노트를 메모 에디터로 연 탭이 있는 그룹
export function noteColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
  const target = uri.toString();
  return vscode.window.tabGroups.all.find((group) =>
    group.tabs.some((tab) => tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === target),
  )?.viewColumn;
}

// 앵커 경로는 첫 폴더 기준 상대경로만 (D8 마크다운 저장). 그 밖의 파일과 노트 파일 자신에는 붙이지 않는다
function anchorPath(store: NoteStore, uri: vscode.Uri): string {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined) {
    throw new Error("워크스페이스 폴더가 열려 있지 않습니다");
  }
  if (vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.uri.toString()) {
    throw new Error("워크스페이스 첫 폴더 안의 파일에만 메모를 붙일 수 있습니다");
  }
  if (store.labelOf(uri) !== null) {
    throw new Error("메모 파일에는 마커를 넣지 않습니다");
  }
  return vscode.workspace.asRelativePath(uri, false);
}

// 없으면 만들고, 있는데 이 파일이 앵커에 없으면 덧붙인다 (D14 라벨 다중 앵커)
async function ensureNote(store: NoteStore, label: string, path: string, lineText: string): Promise<void> {
  if (store.get(label) === undefined) {
    await store.create(label, { path, lineText });
  } else {
    await store.addAnchor(label, { path, lineText });
  }
}

// 커서가 마커 위면 그것, 아니면 그 줄의 첫 마커
function pickMarker(hits: MarkerHit[], character: number | undefined): MarkerHit | undefined {
  const under = character === undefined ? undefined : hits.find((hit) => character >= hit.start && character <= hit.end);
  return under ?? hits[0];
}

interface LabelItem extends vscode.QuickPickItem {
  // 고르면 쓸 라벨. 쓸 수 없는 입력이면 없다
  value?: string;
}

// 기존 라벨 목록 + 친 값은 "새 메모". 공백은 거부하지 않고 안내만 한 뒤 `_`로 바꾼다 (D22 라벨 공백 금지)
function pickLabel(store: NoteStore, line: number): Promise<string | undefined> {
  const existing: LabelItem[] = store
    .labels()
    .sort((a, b) => a.localeCompare(b))
    .map((label) => {
      const title = store.get(label)?.meta.title ?? label;
      return { label, description: title === label ? undefined : title, value: label };
    });

  const quickPick = vscode.window.createQuickPick<LabelItem>();
  quickPick.title = `${line + 1}번 줄에 붙일 메모`;
  quickPick.placeholder = "새 라벨을 입력하거나 기존 메모를 고르세요";
  quickPick.matchOnDescription = true;
  quickPick.items = existing;

  quickPick.onDidChangeValue((value) => {
    const typed = value.trim();
    const label = toLabel(typed);
    if (typed === "" || store.get(label) !== undefined) {
      quickPick.items = existing;
      return;
    }
    // 라벨 자체를 item label로 둔다. 친 값과 정확히 일치해 필터 정렬에서 맨 위로 온다
    const fresh: LabelItem = isValidLabel(label)
      ? {
          label,
          description: "$(add) 새 메모",
          detail: /\s/.test(typed) ? "공백은 _로 바뀝니다" : undefined,
          value: label,
          alwaysShow: true,
        }
      : {
          label: typed,
          description: "$(error) 라벨로 쓸 수 없음",
          detail: '/ \\ : * ? " < > | ` 와 끝의 마침표는 쓸 수 없습니다',
          alwaysShow: true,
        };
    quickPick.items = [fresh, ...existing];
  });

  return new Promise((resolve) => {
    quickPick.onDidAccept(() => {
      const value = quickPick.selectedItems[0]?.value;
      if (value !== undefined) {
        resolve(value);
        quickPick.hide();
      }
    });
    quickPick.onDidHide(() => {
      resolve(undefined);
      quickPick.dispose();
    });
    quickPick.show();
  });
}
