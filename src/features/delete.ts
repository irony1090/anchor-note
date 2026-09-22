import * as vscode from "vscode";
import { NOTE_EDITOR_VIEW_TYPE } from "../editor/note-editor";
import { markerPrefix, removeMarkers } from "../markers/edit";
import { findLabels } from "../markers/search";
import type { MarkerLocation } from "../markers/search";
import type { NoteStore } from "../notes/store";

export const DELETE_NOTE = "noteMap.deleteNote";

// 바깥 삭제를 모으는 시간. 여러 노트가 한꺼번에 지워지면 확인창 하나로 묻는다
const BATCH_MS = 300;
// 우리가 지운 라벨의 watcher 이벤트가 끝내 안 오면 이 시간 뒤에 잊는다
const OWN_DELETE_TTL_MS = 5000;

export interface DeleteFeature {
  disposables: vscode.Disposable[];
  // watcher가 노트 파일 삭제를 알릴 때 부른다
  onNoteDeleted(label: string): void;
}

// 메모 삭제 + 코드의 마커도 지울지 확인 (R7 메모 삭제)
export function registerDelete(store: NoteStore): DeleteFeature {
  /*
   * 명령으로 지우는 라벨은 노트 파일을 지우기 **전에** 여기 넣는다 (순서를 바꾸면 확인창이 두 번 뜬다).
   * 안 넣으면 watcher가 그 삭제를 바깥 삭제로 보고 "마커도 지울까요?"를 한 번 더 묻는다.
   */
  const deletingByUs = new Set<string>();
  // 탐색기에서 노트 파일 이름을 바꾸면 watcher에는 삭제로 보인다. 그 옛 라벨은 묻지 않는다
  const renamingAway = new Set<string>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const forgetLater = (set: Set<string>, label: string) => setTimeout(() => set.delete(label), OWN_DELETE_TTL_MS);

  const deleteNote = async (labelArg?: unknown) => {
    try {
      const label = typeof labelArg === "string" ? labelArg : (activeNoteLabel(store) ?? (await pickNote(store)));
      if (label === undefined || store.get(label) === undefined) {
        return;
      }
      const hits = (await findMarkers(new Set([label]))).get(label) ?? [];
      const files = uniqueFiles(hits);

      let withMarkers = false;
      if (hits.length > 0) {
        const both = "메모와 마커 삭제";
        const noteOnly = "메모만 삭제";
        const choice = await vscode.window.showWarningMessage(
          `메모 '${label}'를 삭제합니다. 코드의 마커 ${hits.length}곳(${files.length}개 파일)도 지울까요?`,
          { modal: true },
          both,
          noteOnly,
        );
        if (choice === undefined) {
          return;
        }
        withMarkers = choice === both;
      } else {
        const ok = "삭제";
        if ((await vscode.window.showWarningMessage(`메모 '${label}'를 삭제할까요?`, { modal: true }, ok)) !== ok) {
          return;
        }
      }

      const uri = store.uriOf(label);
      deletingByUs.add(label);
      forgetLater(deletingByUs, label);
      await store.delete(label);
      if (uri !== null) {
        await closeTabs(uri);
      }
      const removed = withMarkers ? await removeMarkers(files, new Set([label])) : 0;
      void vscode.window.showInformationMessage(
        withMarkers ? `메모 '${label}'와 마커 ${removed}곳을 지웠습니다` : `메모 '${label}'를 지웠습니다`,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  // 노트가 바깥에서(탐색기, 터미널, git) 지워졌을 때. 남은 마커가 있을 때만 묻는다
  const flush = async () => {
    // 모으는 사이 되살아난 노트(되돌리기, 브랜치 왕복)는 뺀다
    const labels = new Set([...pending].filter((label) => store.get(label) === undefined));
    pending.clear();
    if (labels.size === 0) {
      return;
    }
    try {
      const found = await findMarkers(labels);
      const hits = [...found.values()].flat();
      if (hits.length === 0) {
        return;
      }
      const names = [...found.keys()].map((label) => `'${label}'`).join(", ");
      const files = uniqueFiles(hits);
      const remove = "마커 삭제";
      const choice = await vscode.window.showWarningMessage(
        `메모 ${names}가 삭제됐습니다. 코드의 마커 ${hits.length}곳(${files.length}개 파일)도 지울까요?`,
        { modal: true },
        remove,
      );
      if (choice === remove) {
        const removed = await removeMarkers(files, new Set(found.keys()));
        void vscode.window.showInformationMessage(`마커 ${removed}곳을 지웠습니다`);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const onNoteDeleted = (label: string) => {
    if (deletingByUs.delete(label) || renamingAway.has(label)) {
      return;
    }
    pending.add(label);
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), BATCH_MS);
  };

  const onRename = vscode.workspace.onWillRenameFiles((event) => {
    for (const { oldUri } of event.files) {
      const label = store.labelOf(oldUri);
      if (label !== null) {
        renamingAway.add(label);
        forgetLater(renamingAway, label);
      }
    }
  });

  return {
    disposables: [
      vscode.commands.registerCommand(DELETE_NOTE, deleteNote),
      onRename,
      new vscode.Disposable(() => clearTimeout(timer)),
    ],
    onNoteDeleted,
  };
}

function findMarkers(labels: ReadonlySet<string>): Thenable<Map<string, MarkerLocation[]>> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Note Map: 마커 찾는 중" }, () =>
    findLabels(labels, markerPrefix()),
  );
}

function uniqueFiles(hits: MarkerLocation[]): vscode.Uri[] {
  const byKey = new Map(hits.map((hit) => [hit.uri.toString(), hit.uri] as const));
  return [...byKey.values()];
}

// 활성 탭이 노트면 그 라벨 (메모 에디터든 텍스트 에디터든)
function activeNoteLabel(store: NoteStore): string | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : undefined;
  return uri === undefined ? undefined : (store.labelOf(uri) ?? undefined);
}

async function pickNote(store: NoteStore): Promise<string | undefined> {
  const items = store
    .labels()
    .sort((a, b) => a.localeCompare(b))
    .map((label) => {
      const title = store.get(label)?.meta.title ?? label;
      return { label, description: title === label ? undefined : title };
    });
  const picked = await vscode.window.showQuickPick(items, { title: "삭제할 메모", matchOnDescription: true });
  return picked?.label;
}

// 지운 노트를 연 탭을 닫는다. 저장부터 하고 지웠으니 dirty 확인창은 안 뜬다
async function closeTabs(uri: vscode.Uri): Promise<void> {
  const target = uri.toString();
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => {
      const input = tab.input;
      if (input instanceof vscode.TabInputCustom) {
        return input.viewType === NOTE_EDITOR_VIEW_TYPE && input.uri.toString() === target;
      }
      return input instanceof vscode.TabInputText && input.uri.toString() === target;
    });
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs);
  }
}
