/**
 * 메모 패널 (W6). 탐색기 오른쪽 분할에 붙는다 (D16 우측 분할 패널).
 * 본문은 마크다운을 렌더해서 보여준다 (D17 마크다운 본문, D19 marked 렌더러).
 */

import { marked } from "marked";
import type { NoteMeta, TreeNode } from "../src/shared/protocol";
import { isOrphan } from "../src/shared/stats";
import type { NoteIndex } from "../src/shared/stats";

// 생 HTML은 렌더 단계에서 버린다. CSP가 스크립트를 막지만 마크다운 안의 태그를 살릴 이유가 없다
marked.use({ gfm: true, renderer: { html: () => "" } });

export interface CreateRequest {
  targetId: string;
  line?: number;
  parentLabel?: string | null;
  label: string;
  title: string;
}

export interface NotesPanelHandlers {
  onOpenNote(label: string): void;
  onCreate(request: CreateRequest): void;
  onUpdate(label: string, patch: { title?: string; body?: string }): void;
  onDelete(label: string, children: "promote" | "delete"): void;
  onReveal(label: string, at: number): void;
  onClose(): void;
}

interface PanelState {
  target: TreeNode | null;
  labels: Set<string>;
  index: NoteIndex;
}

export class NotesPanel {
  private state: PanelState = { target: null, labels: new Set(), index: emptyIndex() };
  private selected: string | null = null;
  private bodies = new Map<string, string>();
  /** 본문을 요청해두고 아직 못 받은 라벨. 렌더가 반복돼도 요청이 겹치지 않게 한다 */
  private requested = new Set<string>();
  private editing = false;
  private creatingUnder: string | null | undefined; // undefined = 폼 닫힘, null = 최상위 메모

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: NotesPanelHandlers,
  ) {}

  get isOpen(): boolean {
    return this.state.target !== null;
  }

  setTarget(target: TreeNode | null, index: NoteIndex, labels: Set<string>): void {
    const changed = target?.id !== this.state.target?.id;
    this.state = { target, index, labels };
    if (changed) {
      this.selected = null;
      this.editing = false;
      this.creatingUnder = undefined;
    }
    if (this.selected !== null && !index.byLabel.has(this.selected)) {
      this.selected = null;
    }
    this.render();
  }

  setBody(label: string, body: string): void {
    this.bodies.set(label, body);
    this.requested.delete(label);
    if (label === this.selected) {
      this.render();
    }
  }

  /**
   * 파일이 바뀌었으니 캐시를 버린다. 저장소가 정본이라 우리가 방금 쓴 본문도 다시 받아온다.
   * **버리는 것으로 끝내면 안 된다** — 보고 있던 메모는 그 자리에서 다시 요청해야 한다.
   * (watcher 에코까지 포함해 notesPatch는 한 번의 저장에 여러 번 올 수 있다)
   */
  invalidate(labels: string[]): void {
    for (const label of labels) {
      this.requested.delete(label);
      if (label === this.selected) {
        // 보고 있는 메모는 캐시를 지우지 않고 다시 받아온다. 지우면 새 본문이 올 때까지 화면이 비어 깜빡인다
        this.requested.add(label);
        this.handlers.onOpenNote(label);
      } else {
        this.bodies.delete(label);
      }
    }
  }

  /** 지워진 메모. 캐시만 버리고 재요청하지 않는다 — 확장에는 이미 없는 라벨이다 (B9) */
  forget(labels: string[]): void {
    for (const label of labels) {
      this.bodies.delete(label);
      this.requested.delete(label);
      if (label === this.selected) {
        this.selected = null;
        this.editing = false;
      }
      if (label === this.creatingUnder) {
        this.creatingUnder = undefined;
      }
    }
  }

  /** 본문이 없으면 한 번만 요청한다 */
  private needBody(label: string): void {
    if (this.bodies.has(label) || this.requested.has(label)) {
      return;
    }
    this.requested.add(label);
    this.handlers.onOpenNote(label);
  }

  private select(label: string): void {
    this.selected = label;
    this.editing = false;
    this.creatingUnder = undefined;
    this.needBody(label);
    this.render();
  }

  private render(): void {
    this.root.replaceChildren();
    const target = this.state.target;
    this.root.hidden = target === null;
    if (target === null) {
      return;
    }

    this.root.appendChild(this.buildHeader(target));
    this.root.appendChild(this.buildList());

    if (this.creatingUnder !== undefined) {
      this.root.appendChild(this.buildCreateForm(target, this.creatingUnder));
    }

    const note = this.selected === null ? undefined : this.state.index.byLabel.get(this.selected);
    if (note !== undefined) {
      this.root.appendChild(this.buildDetail(note));
    }
  }

  private buildHeader(target: TreeNode): HTMLElement {
    const header = document.createElement("header");
    header.className = "panel-head";

    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = target.name;
    header.appendChild(title);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "panel-add";
    add.textContent = "+ 메모";
    add.addEventListener("click", () => {
      this.creatingUnder = null;
      this.render();
    });
    header.appendChild(add);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "panel-close";
    close.title = "패널 닫기";
    close.textContent = "x";
    close.addEventListener("click", () => this.handlers.onClose());
    header.appendChild(close);

    return header;
  }

  private buildList(): HTMLElement {
    const list = document.createElement("ul");
    list.className = "note-list";

    const roots = [...this.state.labels]
      .map((label) => this.state.index.byLabel.get(label))
      .filter((note): note is NoteMeta => note !== undefined && this.isRootHere(note))
      .sort((a, b) => a.title.localeCompare(b.title));

    if (roots.length === 0) {
      const empty = document.createElement("li");
      empty.className = "note-empty";
      empty.textContent = "메모가 없습니다";
      list.appendChild(empty);
      return list;
    }

    for (const note of roots) {
      this.appendRow(list, note, 0);
    }
    return list;
  }

  /** 이 파일에 직접 걸린 메모만 목록의 뿌리다. 자손은 그 아래로 들어간다 */
  private isRootHere(note: NoteMeta): boolean {
    if (note.parentLabel === null) {
      return true;
    }
    return !this.state.labels.has(note.parentLabel);
  }

  private appendRow(list: HTMLElement, note: NoteMeta, depth: number): void {
    const row = document.createElement("li");
    row.className = `note-row${note.label === this.selected ? " selected" : ""}`;
    row.style.paddingLeft = `${depth * 12}px`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "note-link";
    button.textContent = note.title;
    button.addEventListener("click", () => this.select(note.label));
    row.appendChild(button);

    if (isOrphan(note)) {
      const warn = document.createElement("span");
      warn.className = "note-warn";
      warn.textContent = "orphan";
      row.appendChild(warn);
    } else if (note.anchors.length > 1) {
      const many = document.createElement("span");
      many.className = "note-count";
      many.textContent = `${note.anchors.length} anchors`;
      row.appendChild(many);
    }

    list.appendChild(row);

    for (const child of this.state.index.childrenOf.get(note.label) ?? []) {
      this.appendRow(list, child, depth + 1);
    }
  }

  private buildDetail(note: NoteMeta): HTMLElement {
    const detail = document.createElement("section");
    detail.className = "note-detail";

    const title = document.createElement("h2");
    title.className = "note-title";
    title.textContent = note.title;
    detail.appendChild(title);

    if (note.anchors.length === 0) {
      const none = document.createElement("p");
      none.className = "note-anchors";
      none.textContent = isOrphan(note) ? "앵커 없음 (orphan)" : "코드에 붙지 않은 메모";
      detail.appendChild(none);
    } else {
      const anchors = document.createElement("p");
      anchors.className = "note-anchors";
      note.anchors.forEach((anchor, at) => {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "anchor-link";
        link.textContent = anchor.path;
        link.addEventListener("click", () => this.handlers.onReveal(note.label, at));
        anchors.appendChild(link);
      });
      detail.appendChild(anchors);
    }

    detail.appendChild(this.editing ? this.buildEditor(note) : this.buildBody(note));
    detail.appendChild(this.buildActions(note));
    return detail;
  }

  private buildBody(note: NoteMeta): HTMLElement {
    const body = document.createElement("div");
    body.className = "note-body";
    const text = this.bodies.get(note.label);

    if (text === undefined) {
      // 어떤 경로로 캐시가 비었든 여기서 한 번은 요청이 나간다 (중복은 needBody가 막는다)
      this.needBody(note.label);
      body.textContent = "본문을 불러오는 중...";
      return body;
    }
    if (text.trim() === "") {
      body.classList.add("empty");
      body.textContent = "(빈 메모)";
      return body;
    }

    body.innerHTML = marked.parse(text) as string;
    // 웹뷰 안에서 링크를 따라가면 패널이 통째로 날아간다 (REF-panel 2절)
    body.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement) {
        event.preventDefault();
      }
    });
    return body;
  }

  private buildEditor(note: NoteMeta): HTMLElement {
    const form = document.createElement("form");
    form.className = "note-editor";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "note-title-input";
    titleInput.value = note.title;
    form.appendChild(titleInput);

    const area = document.createElement("textarea");
    area.className = "note-body-input";
    area.rows = 12;
    area.value = this.bodies.get(note.label) ?? "";
    form.appendChild(area);

    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "저장";
    form.appendChild(save);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "취소";
    cancel.addEventListener("click", () => {
      this.editing = false;
      this.render();
    });
    form.appendChild(cancel);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.bodies.set(note.label, area.value);
      this.editing = false;
      this.handlers.onUpdate(note.label, { title: titleInput.value, body: area.value });
      this.render();
    });

    return form;
  }

  private buildActions(note: NoteMeta): HTMLElement {
    const actions = document.createElement("p");
    actions.className = "note-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = this.editing ? "보기" : "편집";
    edit.addEventListener("click", () => {
      this.editing = !this.editing;
      this.render();
    });
    actions.appendChild(edit);

    const child = document.createElement("button");
    child.type = "button";
    child.textContent = "하위 메모";
    child.addEventListener("click", () => {
      this.creatingUnder = note.label;
      this.render();
    });
    actions.appendChild(child);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "삭제";
    // 확인 절차는 확장 호스트에서 띄운다. 웹뷰의 confirm()은 패널을 멈춰세운다
    remove.addEventListener("click", () => this.handlers.onDelete(note.label, "promote"));
    actions.appendChild(remove);

    return actions;
  }

  private buildCreateForm(target: TreeNode, parentLabel: string | null): HTMLElement {
    const form = document.createElement("form");
    form.className = "note-create";

    const heading = document.createElement("p");
    heading.className = "create-head";
    heading.textContent = parentLabel === null ? "새 메모" : `"${parentLabel}" 아래 새 메모`;
    form.appendChild(heading);

    const label = labeled(form, "라벨", "text");
    const title = labeled(form, "제목", "text");

    // 하위 메모는 코드에 마커를 달지 않는다 (REF-notes 3절). 줄 번호는 최상위 메모에만 묻는다
    const line = parentLabel === null ? labeled(form, "줄 번호 (비우면 파일 메모)", "number") : null;

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "만들기";
    form.appendChild(submit);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "취소";
    cancel.addEventListener("click", () => {
      this.creatingUnder = undefined;
      this.render();
    });
    form.appendChild(cancel);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const trimmed = label.value.trim();
      if (trimmed === "") {
        return;
      }
      const lineNumber = line === null || line.value.trim() === "" ? undefined : Number(line.value) - 1;
      this.creatingUnder = undefined;
      this.selected = trimmed;
      this.bodies.set(trimmed, "");
      this.handlers.onCreate({
        targetId: target.id,
        line: lineNumber,
        parentLabel,
        label: trimmed,
        title: title.value.trim() === "" ? trimmed : title.value.trim(),
      });
    });

    return form;
  }
}

function labeled(form: HTMLElement, text: string, type: string): HTMLInputElement {
  const wrap = document.createElement("label");
  wrap.className = "create-field";
  wrap.textContent = text;
  const input = document.createElement("input");
  input.type = type;
  if (type === "number") {
    input.min = "1";
  }
  wrap.appendChild(input);
  form.appendChild(wrap);
  return input;
}

function emptyIndex(): NoteIndex {
  return { byLabel: new Map(), childrenOf: new Map(), roots: [], labelsByPath: new Map() };
}
