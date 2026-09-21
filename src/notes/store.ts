/**
 * 노트 정본 (W1 노트 저장소). 디스크는 `.notemap/notes/{라벨}.md` 하나가 메모 하나다 (D8 마크다운 저장).
 * 라벨이 곧 파일명이므로 라벨 유일성은 파일시스템이 절반을 강제한다 (D12 라벨 전역 유일).
 */

import * as vscode from "vscode";
import { NOTES_DIR, isValidLabel } from "../shared/protocol";
import type { Anchor, DeleteChildren, NoteKind, NoteMeta, NotesPatch } from "../shared/protocol";
import { BrokenNoteError, parseNote, serializeNote } from "./frontmatter";
import type { ParsedNote } from "./frontmatter";

const NOTES_SUBDIR = "notes";
const EXT = ".md";

export interface NoteRecord extends NoteMeta {
  body: string;
}

export interface CreateInput {
  label: string;
  title: string;
  kind: NoteKind;
  anchors: Anchor[];
  parentLabel: string | null;
  body?: string;
  tags?: string[];
}

export interface UpdateInput {
  title?: string;
  body?: string;
  tags?: string[];
  anchors?: Anchor[];
  parentLabel?: string | null;
}

/** 사용자에게 그대로 보여줄 수 있는 실패 */
export class NoteStoreError extends Error {}

export class NoteStore {
  private readonly records = new Map<string, NoteRecord>();
  /** 파싱이 깨진 파일. 건드리지 않고 이름만 들고 있는다 (REF-notes 3절 frontmatter 파손) */
  private readonly broken = new Map<string, string>();
  private extras = new Map<string, string[]>();

  /** 다중 루트는 첫 폴더만 쓴다. 메모 저장소를 루트마다 두는 문제는 P7(다듬기)로 미뤘다 */
  private get root(): vscode.Uri | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri ?? null;
  }

  get dir(): vscode.Uri | null {
    const root = this.root;
    return root === null ? null : vscode.Uri.joinPath(root, NOTES_DIR, NOTES_SUBDIR);
  }

  metas(): NoteMeta[] {
    return [...this.records.values()].map(toMeta);
  }

  get(label: string): NoteRecord | undefined {
    return this.records.get(label);
  }

  brokenFiles(): Array<{ file: string; reason: string }> {
    return [...this.broken].map(([file, reason]) => ({ file, reason }));
  }

  /** 활성화 시 한 번. 본문까지 메모리에 올린다 — 어차피 파일 하나를 통째로 읽는다 */
  async load(): Promise<void> {
    this.records.clear();
    this.broken.clear();
    this.extras.clear();

    const dir = this.dir;
    if (dir === null) {
      return;
    }

    let entries: Array<[string, vscode.FileType]>;
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return; // 폴더가 아직 없다 = 메모가 없다
    }

    for (const [name, type] of entries) {
      if (type === vscode.FileType.File && name.endsWith(EXT)) {
        await this.readFile(vscode.Uri.joinPath(dir, name));
      }
    }
  }

  /** 외부(에디터·Obsidian·git)에서 바뀐 파일 하나를 다시 읽는다. W4에서 watcher가 부른다 */
  async reload(uri: vscode.Uri): Promise<NotesPatch | null> {
    const label = labelOf(uri);
    if (label === null) {
      return null;
    }

    const before = this.records.get(label);
    await this.readFile(uri);
    const after = this.records.get(label);

    if (after === undefined) {
      return before === undefined ? null : { upserted: [], removed: [label] };
    }
    return { upserted: [toMeta(after)], removed: [] };
  }

  /** watcher가 삭제를 알렸을 때 */
  forget(uri: vscode.Uri): NotesPatch | null {
    const label = labelOf(uri);
    if (label === null || !this.records.delete(label)) {
      return null;
    }
    this.extras.delete(label);
    return { upserted: [], removed: [label] };
  }

  async create(input: CreateInput): Promise<NoteMeta> {
    const label = input.label;
    if (!isValidLabel(label)) {
      throw new NoteStoreError(`라벨로 쓸 수 없다: "${label}"`);
    }
    if (this.records.has(label) || this.broken.has(`${label}${EXT}`)) {
      throw new NoteStoreError(`이미 있는 라벨이다: "${label}"`);
    }
    if (input.parentLabel !== null && !this.records.has(input.parentLabel)) {
      throw new NoteStoreError(`부모 메모가 없다: "${input.parentLabel}"`);
    }

    const now = new Date().toISOString();
    const record: NoteRecord = {
      label,
      kind: input.kind,
      anchors: input.anchors,
      parentLabel: input.parentLabel,
      title: input.title.trim() === "" ? label : input.title.trim(),
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
      body: input.body ?? "",
    };

    this.records.set(label, record);
    await this.write(record);
    return toMeta(record);
  }

  async update(label: string, patch: UpdateInput): Promise<NoteMeta> {
    const record = this.records.get(label);
    if (record === undefined) {
      throw new NoteStoreError(`없는 메모다: "${label}"`);
    }

    if (patch.parentLabel !== undefined && patch.parentLabel !== record.parentLabel) {
      this.checkParent(label, patch.parentLabel);
      record.parentLabel = patch.parentLabel;
    }
    if (patch.title !== undefined) {
      record.title = patch.title.trim() === "" ? label : patch.title.trim();
    }
    if (patch.body !== undefined) {
      record.body = patch.body;
    }
    if (patch.tags !== undefined) {
      record.tags = patch.tags;
    }
    if (patch.anchors !== undefined) {
      record.anchors = patch.anchors;
    }

    record.updatedAt = new Date().toISOString();
    await this.write(record);
    return toMeta(record);
  }

  /**
   * 메모와 그 자식을 처리한다 (REF-notes 7절). 기본은 자식 승격.
   * 소스에 박힌 마커를 지우는 것은 W7(마커 삽입)의 짝이라 여기서는 하지 않는다.
   */
  async remove(label: string, children: DeleteChildren): Promise<NotesPatch> {
    const record = this.records.get(label);
    if (record === undefined) {
      throw new NoteStoreError(`없는 메모다: "${label}"`);
    }

    const removed: string[] = [];
    const upserted: NoteMeta[] = [];

    if (children === "delete") {
      for (const victim of [label, ...this.descendants(label)]) {
        await this.deleteFile(victim);
        removed.push(victim);
      }
    } else {
      for (const child of this.childrenOf(label)) {
        child.parentLabel = record.parentLabel;
        child.updatedAt = new Date().toISOString();
        await this.write(child);
        upserted.push(toMeta(child));
      }
      await this.deleteFile(label);
      removed.push(label);
    }

    return { upserted, removed };
  }

  private childrenOf(label: string): NoteRecord[] {
    return [...this.records.values()].filter((note) => note.parentLabel === label);
  }

  private descendants(label: string): string[] {
    const out: string[] = [];
    const queue = [label];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const child of this.childrenOf(current)) {
        out.push(child.label);
        queue.push(child.label);
      }
    }
    return out;
  }

  /** 새 부모가 자기 자신이거나 자기 자손이면 트리가 끊어진 고리가 된다 (REF-notes 7절 순환 금지) */
  private checkParent(label: string, parentLabel: string | null): void {
    if (parentLabel === null) {
      return;
    }
    if (parentLabel === label) {
      throw new NoteStoreError("자기 자신을 부모로 둘 수 없다");
    }
    if (!this.records.has(parentLabel)) {
      throw new NoteStoreError(`부모 메모가 없다: "${parentLabel}"`);
    }
    if (this.descendants(label).includes(parentLabel)) {
      throw new NoteStoreError("자기 자손을 부모로 둘 수 없다");
    }
  }

  private async readFile(uri: vscode.Uri): Promise<void> {
    const label = labelOf(uri);
    if (label === null) {
      return;
    }
    const file = `${label}${EXT}`;

    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      this.records.delete(label);
      this.broken.delete(file);
      this.extras.delete(label);
      return;
    }

    try {
      const parsed = parseNote(text, label);
      const now = new Date().toISOString();
      this.records.set(label, {
        label,
        kind: parsed.kind,
        anchors: parsed.anchors,
        parentLabel: parsed.parentLabel,
        title: parsed.title,
        tags: parsed.tags,
        createdAt: parsed.createdAt || now,
        updatedAt: parsed.updatedAt || now,
        body: parsed.body,
      });
      this.extras.set(label, parsed.extra);
      this.broken.delete(file);
    } catch (error) {
      if (!(error instanceof BrokenNoteError)) {
        throw error;
      }
      // 고치지 않는다. 사람이 쓴 파일을 추측으로 되살리지 않는다 (orphan 정책과 같은 이유)
      this.records.delete(label);
      this.extras.delete(label);
      this.broken.set(file, error.message);
    }
  }

  private async write(record: NoteRecord): Promise<void> {
    const dir = this.dir;
    if (dir === null) {
      throw new NoteStoreError("워크스페이스가 열려 있지 않다");
    }
    await vscode.workspace.fs.createDirectory(dir);

    const parsed: ParsedNote = {
      kind: record.kind,
      anchors: record.anchors,
      parentLabel: record.parentLabel,
      title: record.title,
      tags: record.tags,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      body: record.body,
      extra: this.extras.get(record.label) ?? [],
    };

    await writeText(uriFor(dir, record.label), serializeNote(record.label, parsed));
  }

  private async deleteFile(label: string): Promise<void> {
    const dir = this.dir;
    this.records.delete(label);
    this.extras.delete(label);
    if (dir === null) {
      return;
    }
    try {
      await vscode.workspace.fs.delete(uriFor(dir, label));
    } catch {
      // 이미 없으면 그만이다
    }
  }
}

function uriFor(dir: vscode.Uri, label: string): vscode.Uri {
  return vscode.Uri.joinPath(dir, `${label}${EXT}`);
}

function labelOf(uri: vscode.Uri): string | null {
  const name = uri.path.split("/").pop() ?? "";
  if (!name.endsWith(EXT)) {
    return null;
  }
  const label = name.slice(0, -EXT.length);
  return isValidLabel(label) ? label : null;
}

function toMeta(record: NoteRecord): NoteMeta {
  const { body: _body, ...meta } = record;
  return { ...meta, anchors: meta.anchors.map((anchor) => ({ ...anchor })) };
}

/**
 * 에디터에 열려 있는 파일은 `fs.writeFile`로 덮으면 사용자의 dirty 버퍼와 충돌한다.
 * 그 경우에만 WorkspaceEdit로 넣고 저장한다 (REF-architecture 8절).
 */
async function writeText(uri: vscode.Uri, text: string): Promise<void> {
  const open = vscode.workspace.textDocuments.find(
    (doc) => doc.uri.toString() === uri.toString() && !doc.isClosed,
  );

  if (open === undefined) {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const whole = new vscode.Range(open.positionAt(0), open.positionAt(open.getText().length));
  edit.replace(uri, whole, text);
  await vscode.workspace.applyEdit(edit);
  await open.save();
}
