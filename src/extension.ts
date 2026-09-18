import * as vscode from "vscode";
import { MapPanel } from "./panel/MapPanel";

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

  console.log("[note-map] activated");
}

export function deactivate(): void {
  // 정리할 자원은 전부 context.subscriptions에 들어가 있다
}
