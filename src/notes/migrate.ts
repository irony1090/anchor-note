import * as vscode from "vscode";
import { LEGACY_ROOT, NOTES_ROOT, exists } from "./store";
import type { NoteStore } from "./store";

// 0.1.x 저장 폴더 `.notemap/`을 `.anchornotes/`로 옮긴다 (0.2.0). 사용자 저장소를 고치는 일이라 묻고 나서 한다. 새 폴더가 이미 있으면 건드리지 않는다
export async function offerMigration(store: NoteStore): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (root === undefined) {
    return;
  }
  const legacy = vscode.Uri.joinPath(root, LEGACY_ROOT);
  const target = vscode.Uri.joinPath(root, NOTES_ROOT);
  if (!(await exists(legacy)) || (await exists(target))) {
    return;
  }
  const move = "옮기기";
  const answer = await vscode.window.showInformationMessage(
    `Anchor Notes: 메모 폴더 이름이 ${NOTES_ROOT}/ 로 바뀌었습니다. 기존 ${LEGACY_ROOT}/ 를 옮길까요? 옮기기 전에는 기존 메모가 보이지 않습니다 (닫으면 다음에 다시 묻습니다).`,
    move,
  );
  if (answer !== move) {
    return;
  }
  try {
    await vscode.workspace.fs.rename(legacy, target);
  } catch (error) {
    void vscode.window.showErrorMessage(`Anchor Notes: ${LEGACY_ROOT}/ 를 옮기지 못했습니다 — ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  await store.load();
  void vscode.window.showInformationMessage(`Anchor Notes: 메모 ${store.labels().length}개를 ${NOTES_ROOT}/ 로 옮겼습니다.`);
}
