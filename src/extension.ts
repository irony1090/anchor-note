import * as vscode from "vscode";
import { MapPanel } from "./panel/MapPanel";
import { NoteEditorProvider } from "./editor/note-editor";
import { registerTriggers } from "./editor/triggers";
import { NoteStore } from "./notes/store";
import { NotesWatcher } from "./notes/watcher";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("noteMap.openMap", () => {
      MapPanel.createOrShow(context.extensionUri, context.workspaceState);
    }),
  );

  // 이걸 등록해야 VSCode를 껐다 켰을 때 열려 있던 맵 탭이 빈 화면으로 돌아오지 않는다
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(MapPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
        MapPanel.revive(panel, context.extensionUri, context.workspaceState);
      },
    }),
  );

  // 에디터 주도 프로토타입: 맵을 안 열어도 메모가 돌도록 저장소를 확장 수준에 둔다 (맵은 자기 저장소를 따로 쓴다)
  const notes = new NoteStore();
  void notes.load();
  context.subscriptions.push(
    new NotesWatcher({
      changed: (uri) => void notes.reload(uri),
      deleted: (uri) => notes.forget(uri),
    }),
    NoteEditorProvider.register(context.extensionUri),
    ...registerTriggers(notes),
  );

  console.log("[note-map] activated");
}

export function deactivate(): void {
  // 정리할 자원은 전부 context.subscriptions에 들어가 있다
}
