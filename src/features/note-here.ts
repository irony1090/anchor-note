import * as vscode from "vscode";
import { labelsInLines, markerAnchor } from "../core/anchors";
import { hasComment } from "../core/comment";
import { LABEL_RULE_TEXT, isValidLabel, toLabel } from "../core/label";
import { markerText, markersIn } from "../core/marker";
import type { MarkerHit } from "../core/marker";
import { NOTE_EDITOR_VIEW_TYPE } from "../editor/note-editor";
import { insertMarker, markerPrefix } from "../markers/edit";
import type { NoteStore } from "../notes/store";

export const NOTE_HERE = "anchorNotes.noteHere";
export const OPEN_NOTE = "anchorNotes.openNote";
// 등록은 features/file-notes.ts (F2 파일에 메모). file-notes가 이 파일을 import하므로 이름은 여기 둔다
export const NOTE_ON_FILE = "anchorNotes.noteOnFile";

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
        await ensureNote(store, found.label, path, found.id);
        await openNote(found.label);
        return;
      }

      if (!hasComment(doc.languageId) && (await preferFileNote())) {
        await vscode.commands.executeCommand(NOTE_ON_FILE, doc.uri);
        return;
      }
      const label = await pickLabel(store, `${line + 1}번 줄에 붙일 메모`);
      if (label === undefined) {
        return;
      }
      const id = await askId(doc, label);
      if (id === null) {
        return;
      }
      // 마커를 먼저 넣는다. 노트 생성이 실패해도 남는 건 노트 없는 마커라 hover가 [메모 만들기]로 받아준다
      const inserted = await insertMarker(doc.uri, line, label, id);
      if (inserted.bare) {
        void vscode.window.showWarningMessage(
          `주석 문법을 모르는 파일이라 마커만 넣었습니다. 직접 주석으로 감싸주세요: ${markerText(label, markerPrefix(), id)}`,
        );
      }
      await ensureNote(store, label, path, id);
      await openNote(label);
    } catch (error) {
      if (!(error instanceof Cancelled)) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
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

// 주석을 모르는 파일(JSON 등)에서 마커 대신 파일 앵커를 제안 (F3 주석 모르는 파일 제안). 파일 앵커 = true, 마커 = false, 취소 = Cancelled
async function preferFileNote(): Promise<boolean> {
  const file = { label: "$(file) 파일에 메모 붙이기", detail: "마커 없이 파일 자체에 붙인다 (- file: 앵커)" };
  const marker = { label: "$(edit) 마커만 넣기", detail: "주석 없이 마커 글자만 넣는다. 직접 주석으로 감싸야 한다" };
  const picked = await vscode.window.showQuickPick([file, marker], { title: "주석 문법을 모르는 파일입니다" });
  if (picked === undefined) {
    throw new Cancelled();
  }
  return picked === file;
}

// 사용자 취소. 오류 알림을 띄우지 않는다
class Cancelled extends Error {}

// 앵커 경로는 첫 폴더 기준 상대경로만 (D8 마크다운 저장). 그 밖의 파일과 노트 파일 자신에는 붙이지 않는다
export function anchorPath(store: NoteStore, uri: vscode.Uri): string {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined) {
    throw new Error("워크스페이스 폴더가 열려 있지 않습니다");
  }
  if (vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.uri.toString()) {
    throw new Error("워크스페이스 첫 폴더 안의 파일에만 메모를 붙일 수 있습니다");
  }
  if (store.labelOf(uri) !== null) {
    throw new Error("메모 파일에는 메모를 붙이지 않습니다");
  }
  return vscode.workspace.asRelativePath(uri, false);
}

// 없으면 만들고, 있는데 이 마커(파일, id)가 앵커에 없으면 덧붙인다 (D14 라벨 다중 앵커)
async function ensureNote(store: NoteStore, label: string, path: string, id: string | undefined): Promise<void> {
  if (store.get(label) === undefined) {
    await store.create(label, markerAnchor(path, id));
  } else {
    await store.addAnchor(label, markerAnchor(path, id));
  }
}

// 이 파일에 id 없는 같은 라벨 마커가 이미 있으면 id를 받는다 (D24 마커 id). 없으면 undefined(id 없이 넣음), 취소하면 null
async function askId(doc: vscode.TextDocument, label: string): Promise<string | undefined | null> {
  const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
  const ids = labelsInLines(lines, markerPrefix()).get(label);
  if (ids === undefined || !ids.has(undefined)) {
    return undefined;
  }
  const used = [...ids].filter((id) => id !== undefined);
  const input = await vscode.window.showInputBox({
    title: `이 파일에 ${markerText(label, markerPrefix())}가 이미 있습니다 — 새 마커의 id`,
    prompt: "id는 같은 파일·같은 라벨 안에서만 겹치지 않으면 됩니다",
    placeHolder: used.length > 0 ? `쓰인 id: ${used.join(", ")}` : "예: fix",
    validateInput: (value) => {
      const id = toLabel(value);
      if (id === "") {
        return "id를 입력하세요";
      }
      if (!isValidLabel(id)) {
        return LABEL_RULE_TEXT;
      }
      if (ids.has(id)) {
        return `이 파일에서 이미 쓰인 id입니다: ${id}`;
      }
      return /\s/.test(value.trim()) ? { message: `공백은 _로 바뀝니다: ${id}`, severity: vscode.InputBoxValidationSeverity.Info } : null;
    },
  });
  return input === undefined ? null : toLabel(input);
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
export function pickLabel(store: NoteStore, title: string): Promise<string | undefined> {
  const existing: LabelItem[] = store
    .labels()
    .sort((a, b) => a.localeCompare(b))
    .map((label) => {
      const title = store.get(label)?.meta.title ?? label;
      return { label, description: title === label ? undefined : title, value: label };
    });

  const quickPick = vscode.window.createQuickPick<LabelItem>();
  quickPick.title = title;
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
          detail: LABEL_RULE_TEXT,
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
