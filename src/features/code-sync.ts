import * as vscode from "vscode";
import { sameAnchor } from "../core/anchors";
import { codeBlocks } from "../core/codeblock";
import { regionsIn } from "../core/region";
import { blockValue } from "../core/slot";
import { adoptContent, classify, findBlock, findSlot, syncText, syncedHash } from "../core/sync-state";
import type { Slot, SlotMiss, SyncState } from "../core/sync-state";
import type { BlockLinks, BlockProblem, LinkRow } from "../editor/protocol";
import { markerPrefix } from "../markers/edit";
import { runAnchorTask } from "../markers/sync";
import type { Anchor, CodeLink } from "../notes/frontmatter";
import type { NoteStore } from "../notes/store";
import { OPEN_NOTE } from "./note-here";

// 코드 연결 상태와 동기화 동작 (R11 C7 상태 계산·동기화 동작) — vault REF-code-sync-ui 1절
export const SYNC_LINK = "anchorNotes.syncLink";

export type Linked = { kind: "marker"; path: string; id?: string; link: CodeLink };

export function isLinked(anchor: Anchor): anchor is Linked {
  return anchor.kind === "marker" && anchor.link !== undefined;
}

const MISS: Record<SlotMiss | "no-file", string> = {
  "no-file": "파일이 없습니다",
  "no-region": "범위(여는·닫는 마커)가 없습니다",
  overlap: "범위가 다른 범위와 겹칩니다",
  missing: "앞뒤 문맥을 찾지 못했습니다",
  ambiguous: "앞뒤 문맥이 여러 곳에 맞습니다",
};

// 연결마다 상태 (메모 에디터 linkStatus). body·anchors는 메모 에디터에 보이는 내용 — 저장 전 편집 포함
export async function linkStatus(label: string, body: string, anchors: readonly Anchor[]): Promise<{ blocks: BlockLinks[]; problems: BlockProblem[] }> {
  const blocks = codeBlocks(body);
  const rows = new Map<string, LinkRow[]>();
  const problems = new Map<string, BlockProblem>();
  const prefix = markerPrefix();

  for (const anchor of anchors.filter(isLinked)) {
    const key = anchor.link.block ?? "";
    const block = findBlock(blocks, anchor.link.block);
    if (typeof block === "string") {
      const problem = problems.get(key) ?? { key, kind: block, anchors: [] };
      problem.anchors.push(anchor);
      problems.set(key, problem);
      continue;
    }
    const lines = await sourceLines(anchor.path);
    const slot = lines === null ? "no-file" : findSlot(lines, prefix, label, anchor.id, anchor.link);
    const row: LinkRow =
      typeof slot === "string"
        ? { anchor, state: "lost", reason: MISS[slot] }
        : { anchor, state: classify(slot.text, blockValue(block.content), anchor.link.hash) };
    rows.set(key, [...(rows.get(key) ?? []), row]);
  }
  return { blocks: [...rows].map(([key, list]) => ({ key, rows: list })), problems: [...problems.values()] };
}

// 연결된 파일 경로들. 메모 에디터가 이 파일들의 변경에 상태를 다시 계산한다
export function linkedPaths(anchors: readonly Anchor[]): Set<string> {
  return new Set(anchors.filter(isLinked).map((anchor) => anchor.path));
}

class Cancelled extends Error {}

interface Plan {
  anchor: Linked;
  doc: vscode.TextDocument;
  slot: Slot;
  content: string;
  state: SyncState;
}

// 누르는 순간의 메모·코드로 다시 계산한다. 메모 에디터가 보낸 상태는 그 사이 낡았을 수 있다
async function plan(store: NoteStore, label: string, target: Anchor): Promise<Plan> {
  const anchor = store.get(label)?.meta.anchors.find((known): known is Linked => isLinked(known) && sameAnchor(known, target));
  if (anchor === undefined) {
    throw new Error(`${label} 메모에 ${target.path} 연결이 없습니다 (그 사이 바뀌었을 수 있습니다)`);
  }
  const block = findBlock(codeBlocks(store.liveBody(label) ?? ""), anchor.link.block);
  if (typeof block === "string") {
    throw new Error(`메모에서 코드 블록 ${anchor.link.block ?? "(이름 없음)"}을 찾지 못했습니다`);
  }
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uriOf(anchor.path));
  } catch {
    throw new Error(`${anchor.path}: ${MISS["no-file"]}`);
  }
  const slot = findSlot(linesOf(doc), markerPrefix(), label, anchor.id, anchor.link);
  if (typeof slot === "string") {
    throw new Error(`${where(anchor)}: ${MISS[slot]}`);
  }
  return { anchor, doc, slot, content: block.content, state: classify(slot.text, blockValue(block.content), anchor.link.hash) };
}

/**
 * 메모 -> 코드. 모든 자리를 WorkspaceEdit 하나로 고치고(되돌리기 한 번), 편집 전에 dirty가 아니던 파일만 저장한다.
 * 그다음 hash를 적는다. 코드를 고친 뒤라 hash 쓰기가 실패해도 슬롯 = 블록이라 상태는 "동기화됨"으로 나온다.
 */
async function writeCode(store: NoteStore, label: string, plans: Plan[]): Promise<void> {
  const markers = plans.reduce((n, p) => n + p.slot.markers, 0);
  if (markers > 0) {
    const go = "지우고 반영";
    const answer = await vscode.window.showWarningMessage(`반영할 자리 안에 마커 ${markers}개가 있습니다. 반영하면 지워집니다.`, { modal: true }, go);
    if (answer !== go) {
      throw new Cancelled();
    }
  }
  const edit = new vscode.WorkspaceEdit();
  const dirty = new Map<string, boolean>();
  for (const p of plans) {
    const text = syncText(p.slot, p.anchor.link, p.content);
    if (text === "unsafe") {
      throw new Error(`${where(p.anchor)}: 메모 값에 앞뒤 문맥 글자가 들어 있어 넣으면 다음에 슬롯을 못 찾습니다`);
    }
    const eol = p.doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const { from, to } = p.slot;
    edit.replace(p.doc.uri, new vscode.Range(from.line, from.character, to.line, to.character), text.replaceAll("\n", eol));
    dirty.set(p.doc.uri.toString(), dirty.get(p.doc.uri.toString()) ?? p.doc.isDirty);
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("코드를 고치지 못했습니다 (읽기 전용 파일일 수 있습니다)");
  }
  for (const p of plans) {
    if (dirty.get(p.doc.uri.toString()) === false) {
      dirty.set(p.doc.uri.toString(), true);
      await p.doc.save();
    }
  }
  await setHashes(store, label, new Map(plans.map((p) => [p.anchor, syncedHash(p.content)])));
}

async function setHashes(store: NoteStore, label: string, hashes: Map<Linked, string>): Promise<void> {
  await runAnchorTask(async () => {
    const note = store.get(label);
    if (note === undefined) {
      return;
    }
    const next = note.meta.anchors.map((anchor) => {
      const hit = [...hashes].find(([linked]) => sameAnchor(linked, anchor));
      return hit !== undefined && isLinked(anchor) ? { ...anchor, link: { ...anchor.link, hash: hit[1] } } : anchor;
    });
    await store.setAnchors(label, next);
  });
}

// [동기화] (반영 대기) / [메모로 덮기] (코드가 바뀜, force)
export async function syncLink(store: NoteStore, label: string, anchor: Anchor, force: boolean): Promise<void> {
  const p = await plan(store, label, anchor);
  if (p.state === "changed" && !force) {
    throw new Error(`${where(p.anchor)}: 코드 쪽이 바뀌었습니다. 메모 에디터에서 [메모로 덮기] 또는 [메모에 반영]을 고르세요`);
  }
  await writeCode(store, label, [p]);
}

// [모두 동기화]: 반영 대기만. 코드가 바뀐 곳이 섞여 있으면 한 번 더 묻고, 못 찾은 곳은 건너뛴다
export async function syncBlock(store: NoteStore, label: string, key: string): Promise<void> {
  const targets = (store.get(label)?.meta.anchors ?? []).filter((anchor): anchor is Linked => isLinked(anchor) && (anchor.link.block ?? "") === key);
  const plans: Plan[] = [];
  let lost = 0;
  for (const anchor of targets) {
    try {
      plans.push(await plan(store, label, anchor));
    } catch {
      lost++;
    }
  }
  const pending = plans.filter((p) => p.state === "pending");
  const changed = plans.filter((p) => p.state === "changed");
  let chosen = pending;
  if (changed.length > 0) {
    const all = "덮기";
    const only = "반영 대기만";
    const answer = await vscode.window.showWarningMessage(
      `${changed.length}곳은 코드가 바뀌었습니다. 메모 내용으로 덮을까요?`,
      { modal: true, detail: "덮으면 그 코드 쪽 변경은 사라집니다 (되돌리기로 복구)" },
      ...(pending.length > 0 ? [all, only] : [all]),
    );
    if (answer === undefined) {
      throw new Cancelled();
    }
    chosen = answer === all ? [...pending, ...changed] : pending;
  }
  if (chosen.length === 0) {
    void vscode.window.showInformationMessage(`Anchor Notes: 반영할 곳이 없습니다${lost > 0 ? ` (못 찾은 곳 ${lost})` : ""}`);
    return;
  }
  await writeCode(store, label, chosen);
  if (lost > 0) {
    void vscode.window.showWarningMessage(`Anchor Notes: ${chosen.length}곳 반영, 코드에서 못 찾은 ${lost}곳은 건너뛰었습니다`);
  }
}

// [메모에 반영]: 코드 -> 메모 블록. 노트 본문을 고치는 유일한 곳 (store.replaceBlock)
export async function adopt(store: NoteStore, label: string, anchor: Anchor): Promise<void> {
  const p = await plan(store, label, anchor);
  const content = adoptContent(p.slot);
  await runAnchorTask(async () => {
    const note = store.get(label);
    if (note === undefined) {
      return;
    }
    const next = note.meta.anchors.map((known) =>
      isLinked(known) && sameAnchor(known, p.anchor) ? { ...known, link: { ...known.link, hash: syncedHash(content) } } : known,
    );
    await store.replaceBlock(label, p.anchor.link.block, content, next);
  });
}

// [다시 고르기]: 코드를 열고 범위를 선택해 둔다. 고르기는 "메모 코드와 연결"(C6)이 한다 — 같은 앵커면 연결을 갈아 끼운다
export async function repick(label: string, anchor: Anchor, column: vscode.ViewColumn | undefined): Promise<void> {
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uriOf(anchor.path));
  } catch {
    throw new Error(`${anchor.path}: ${MISS["no-file"]}`);
  }
  const id = anchor.kind === "marker" ? anchor.id : undefined;
  const region = regionsIn(linesOf(doc), markerPrefix()).regions.find((r) => r.label === label && r.id === id);
  const selection =
    region === undefined || region.close === region.open + 1
      ? undefined
      : new vscode.Range(region.open + 1, 0, region.close - 1, doc.lineAt(region.close - 1).text.length);
  await vscode.window.showTextDocument(doc, { viewColumn: column === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One, selection });
  void vscode.window.showInformationMessage(
    region === undefined
      ? "Anchor Notes: 범위 마커가 없습니다. 연결할 줄을 선택하고 우클릭 \"메모 코드와 연결\"을 실행하세요"
      : "Anchor Notes: 범위 안에서 바꿀 자리를 선택하고(줄 전체면 그대로) 우클릭 \"메모 코드와 연결\"을 실행하세요",
  );
}

// [블록 다시 고르기]: 메모에서 못 찾은 블록 이름(key)을 가리키던 연결을 다른 블록으로
export async function repickBlock(store: NoteStore, label: string, key: string): Promise<void> {
  const blocks = codeBlocks(store.liveBody(label) ?? "");
  const names = [...new Set(blocks.flatMap((block) => (block.name === undefined ? [] : [block.name])))].filter(
    (name) => findBlock(blocks, name) !== "duplicate",
  );
  if (names.length === 0) {
    throw new Error("메모에 이름 있는 코드 블록이 없습니다. 펜스에 이름을 붙이세요 (```c 이름)");
  }
  const picked = await vscode.window.showQuickPick(names, { title: `${key || "(이름 없음)"} 연결을 옮길 블록` });
  if (picked === undefined) {
    return;
  }
  await editLinks(store, label, (anchor) => ((anchor.link.block ?? "") === key ? { ...anchor.link, block: picked } : anchor.link));
}

// [연결 끊기]: link만 지운다. 마커는 코드에 남는다
export async function unlink(store: NoteStore, label: string, targets: readonly Anchor[]): Promise<void> {
  await editLinks(store, label, (anchor) => (targets.some((target) => sameAnchor(target, anchor)) ? undefined : anchor.link));
}

async function editLinks(store: NoteStore, label: string, change: (anchor: Linked) => CodeLink | undefined): Promise<void> {
  await runAnchorTask(async () => {
    const note = store.get(label);
    if (note === undefined) {
      return;
    }
    const next = note.meta.anchors.map((anchor): Anchor => {
      if (!isLinked(anchor)) {
        return anchor;
      }
      const link = change(anchor);
      if (link === undefined) {
        const { link: _dropped, ...rest } = anchor;
        return rest;
      }
      return { ...anchor, link };
    });
    await store.setAnchors(label, next);
  });
}

// 실패는 알림으로, 취소는 조용히
export async function reportErrors(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    if (!(error instanceof Cancelled)) {
      void vscode.window.showErrorMessage(`Anchor Notes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// 코드 쪽: 연결된 범위의 여는 마커 줄 위 CodeLens로 상태 + [동기화]
export function registerCodeSync(store: NoteStore): vscode.Disposable[] {
  const lens = new SyncLens(store);
  return [
    lens,
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, lens),
    vscode.commands.registerCommand(SYNC_LINK, (label: string, anchor: Anchor) => reportErrors(() => syncLink(store, label, anchor, false))),
  ];
}

const LENS: Record<SyncState | "lost", string> = {
  synced: "$(check) 동기화됨",
  pending: "$(circle-filled) 반영 대기",
  changed: "$(warning) 코드가 바뀜",
  lost: "$(error) 못 찾음",
};

class SyncLens implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly subscriptions: vscode.Disposable[];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly store: NoteStore) {
    // 코드 파일 변경은 VSCode가 알아서 다시 묻는다. 메모 쪽(저장 전 입력 포함) 변경만 알린다
    const soon = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.changed.fire(), 300);
    };
    this.subscriptions = [
      store.onDidChange(soon),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (store.labelOf(event.document.uri) !== null) {
          soon();
        }
      }),
    ];
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.changed.dispose();
    this.subscriptions.forEach((sub) => sub.dispose());
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (this.store.labelOf(doc.uri) !== null || vscode.workspace.getWorkspaceFolder(doc.uri) === undefined) {
      return [];
    }
    const path = vscode.workspace.asRelativePath(doc.uri, false);
    const lines = linesOf(doc);
    const prefix = markerPrefix();
    const lenses: vscode.CodeLens[] = [];
    for (const region of regionsIn(lines, prefix).regions) {
      const anchor = this.store
        .get(region.label)
        ?.meta.anchors.find((known): known is Linked => isLinked(known) && known.path === path && known.id === region.id);
      if (anchor === undefined) {
        continue;
      }
      const block = findBlock(codeBlocks(this.store.liveBody(region.label) ?? ""), anchor.link.block);
      const slot = findSlot(lines, prefix, region.label, region.id, anchor.link);
      const state = typeof block === "string" || typeof slot === "string" ? "lost" : classify(slot.text, blockValue(block.content), anchor.link.hash);
      const at = new vscode.Range(region.open, 0, region.open, 0);
      const name = `${region.label}${anchor.link.block === undefined ? "" : ` · ${anchor.link.block}`}`;
      const why = typeof block === "string" ? " (메모에 블록 없음)" : typeof slot === "string" ? ` (${MISS[slot]})` : "";
      lenses.push(new vscode.CodeLens(at, { title: `${LENS[state]}${why} — ${name}`, tooltip: "메모 열기", command: OPEN_NOTE, arguments: [region.label] }));
      if (state === "pending") {
        lenses.push(new vscode.CodeLens(at, { title: "동기화", tooltip: "메모 코드를 이 자리에 반영", command: SYNC_LINK, arguments: [region.label, anchor] }));
      }
    }
    return lenses;
  }
}

function where(anchor: Linked): string {
  return `${anchor.path}${anchor.id === undefined ? "" : `#${anchor.id}`}`;
}

function uriOf(path: string): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (root === undefined) {
    throw new Error("워크스페이스 폴더가 열려 있지 않습니다");
  }
  return vscode.Uri.joinPath(root, path);
}

// 열린 문서면 저장 안 한 내용, 아니면 디스크. 상태 계산 때문에 문서를 새로 열지 않는다
async function sourceLines(path: string): Promise<string[] | null> {
  const uri = uriOf(path);
  const doc = vscode.workspace.textDocuments.find((open) => !open.isClosed && open.uri.toString() === uri.toString());
  if (doc !== undefined) {
    return linesOf(doc);
  }
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)).split(/\r?\n/);
  } catch {
    return null;
  }
}

function linesOf(doc: vscode.TextDocument): string[] {
  return Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
}
