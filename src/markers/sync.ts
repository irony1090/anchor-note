import * as vscode from "vscode";
import { dropAnchors, labelsInLines, renameAnchors, rescanAnchors, sameAnchors, syncFileAnchors } from "../core/anchors";
import type { MarkerIds } from "../core/anchors";
import type { Anchor } from "../notes/frontmatter";
import type { NoteStore } from "../notes/store";
import { markerPrefix } from "./edit";
import { sourcePath, sourceFiles } from "./search";

export const RESCAN = "anchorNotes.rescan";

type Plan = (anchors: Anchor[]) => Anchor[] | null;

// 소스 파일 저장·이름 변경·삭제 -> 노트 anchors 동기화, 그리고 "Rescan Workspace" (R5 마커 스캔)
export function registerSync(store: NoteStore): vscode.Disposable[] {
  /*
   * 모든 동기화 작업은 이 체인 하나로 순서대로 돈다 (틀리면 앵커가 사라진다).
   * 각 작업은 store의 anchors를 읽고 -> writeMeta로 쓰는데, 두 작업이 겹치면 뒤 작업이 앞 작업의 쓰기 전 값을 읽어
   * 앞 작업의 변경을 덮는다(연속 저장, 폴더 이름 변경 중 저장 등).
   */
  let chain: Promise<void> = Promise.resolve();
  const run = (task: () => Promise<unknown>) => {
    chain = chain.then(async () => void (await task())).catch((error) => console.error("[anchor-notes] sync failed", error));
    return chain;
  };

  // 라벨 수집은 이벤트 시점에 한다. 큐에서 기다리는 사이 문서가 또 바뀌어도 저장된 내용 기준이 되게
  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    const path = sourcePath(doc.uri);
    if (path === null || store.labelOf(doc.uri) !== null) {
      return;
    }
    const found = labelsInLines(linesOf(doc), markerPrefix());
    void run(() => applyAll(store, (label) => (anchors) => syncFileAnchors(anchors, path, found.get(label) ?? new Set())));
  });

  const onRename = vscode.workspace.onDidRenameFiles((event) => {
    for (const { oldUri, newUri } of event.files) {
      const from = sourcePath(oldUri);
      if (from === null) {
        continue;
      }
      const to = sourcePath(newUri);
      // 첫 폴더 밖이나 노트 저장소 안으로 옮겼으면 삭제와 같다
      const plan: Plan = to === null ? (anchors) => dropAnchors(anchors, from) : (anchors) => renameAnchors(anchors, from, to);
      void run(() => applyAll(store, () => plan));
    }
  });

  const onDelete = vscode.workspace.onDidDeleteFiles((event) => {
    for (const uri of event.files) {
      const path = sourcePath(uri);
      if (path !== null) {
        void run(() => applyAll(store, () => (anchors) => dropAnchors(anchors, path)));
      }
    }
  });

  const rescan = vscode.commands.registerCommand(RESCAN, () =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Anchor Notes: 마커 다시 찾는 중", cancellable: true },
      (_progress, token) => run(() => rescanWorkspace(store, token)),
    ),
  );

  return [onSave, onRename, onDelete, rescan];
}

async function rescanWorkspace(store: NoteStore, token: vscode.CancellationToken): Promise<void> {
  const prefix = markerPrefix();
  // 라벨 -> (경로 -> 그 파일의 이 라벨 마커 id들)
  const found = new Map<string, Map<string, MarkerIds>>();
  for await (const source of sourceFiles(token)) {
    for (const [label, ids] of labelsInLines(source.lines, prefix)) {
      const paths = found.get(label) ?? new Map<string, MarkerIds>();
      paths.set(source.path, ids);
      found.set(label, paths);
    }
  }
  // 도중에 멈추면 일부만 찾은 결과로 앵커를 지우게 된다
  if (token.isCancellationRequested) {
    return;
  }

  const changed = await applyAll(store, (label) => (anchors) => {
    const next = rescanAnchors(anchors, found.get(label) ?? new Map());
    return sameAnchors(anchors, next) ? null : next;
  });
  const orphans = [...found.keys()].filter((label) => store.get(label) === undefined).length;
  void vscode.window.showInformationMessage(
    `Anchor Notes: 메모 ${changed}개의 앵커를 고쳤습니다` + (orphans > 0 ? ` · 메모 없는 라벨 ${orphans}개` : ""),
  );
}

// 노트마다 plan을 적용하고 바뀐 노트 수를 돌려준다. file 앵커를 건너뛰는 건 plan(core/anchors) 쪽이 한다
async function applyAll(store: NoteStore, planFor: (label: string) => Plan): Promise<number> {
  let changed = 0;
  for (const label of store.labels()) {
    const note = store.get(label);
    if (note === undefined) {
      continue;
    }
    const next = planFor(label)(note.meta.anchors);
    if (next === null) {
      continue;
    }
    try {
      await store.setAnchors(label, next);
      changed++;
    } catch (error) {
      // 깨진 노트 하나 때문에 나머지를 멈추지 않는다. 저장마다 창을 띄우지 않으려고 로그만 남긴다
      console.warn(`[anchor-notes] ${label} 앵커를 고치지 못함:`, error instanceof Error ? error.message : error);
    }
  }
  return changed;
}

function linesOf(doc: vscode.TextDocument): string[] {
  const lines: string[] = [];
  for (let i = 0; i < doc.lineCount; i++) {
    lines.push(doc.lineAt(i).text);
  }
  return lines;
}
