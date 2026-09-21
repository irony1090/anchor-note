import type { TreeNode, TreePatch, ViewState, WorkspaceTree } from "../src/shared/protocol";
import { ancestorsOf, applyPatch, buildIndex } from "../src/shared/tree";
import type { TreeIndex } from "../src/shared/tree";

/** 프리뷰 팝오버에 들어갈 내용. P3(메모 CRUD)에서 채워진다 */
export interface PreviewLine {
  label: string;
  text: string;
  indent: number;
  warn?: boolean;
}

export interface PreviewContent {
  title: string;
  lines: PreviewLine[];
  more?: number;
}

/** 카드 아래 줄에 찍는 숫자. count는 라벨 합집합 크기다 (D15 라벨 단위 집계) */
export interface NoteBadge {
  count: number;
  orphans: number;
}

export interface ExplorerHandlers {
  onNavigate(nodeId: string | null): void;
  onOpenFile(nodeId: string): void;
  /** 파일 카드 선택. 메모 패널이 여기에 붙는다 (D10 카드는 메모부터) */
  onSelectFile(node: TreeNode): void;
  /** undefined면 메모 줄을 안 그린다 (트리가 없을 때) */
  getNoteBadge(node: TreeNode): NoteBadge | undefined;
  /** null이면 팝오버를 열지 않는다 */
  getPreview(node: TreeNode): PreviewContent | null;
}

export interface ExplorerElements {
  breadcrumb: HTMLElement;
  cards: HTMLElement;
  preview: HTMLElement;
}

const PREVIEW_DELAY_MS = 350;

export class Explorer {
  private tree: WorkspaceTree | null = null;
  private index: TreeIndex = new Map();
  private view: ViewState = { cwdId: null, sortAsc: true, noteFilter: "all" };
  private selectedId: string | null = null;
  private visible: TreeNode[] = [];

  private hoverTimer: number | undefined;
  private previewFor: string | null = null;
  private previewAnchor: HTMLElement | null = null;

  constructor(
    private readonly el: ExplorerElements,
    private readonly handlers: ExplorerHandlers,
  ) {
    this.el.cards.addEventListener("click", (event) => this.onCardClick(event));
    this.el.cards.addEventListener("dblclick", (event) => this.onCardDoubleClick(event));
    this.el.cards.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.el.cards.addEventListener("scroll", () => this.closePreview());
    this.el.cards.addEventListener("mouseover", (event) => this.onHover(event));
    this.el.cards.addEventListener("mouseleave", () => this.closePreview());
    this.el.breadcrumb.addEventListener("click", (event) => this.onBreadcrumbClick(event));
    // B3: 팝오버를 띄운 채 창 크기를 바꾸면 좌표가 어긋난다. 앵커 카드를 기준으로 다시 앉힌다
    window.addEventListener("resize", () => {
      if (this.previewAnchor !== null && !this.el.preview.hidden) {
        this.positionPreview(this.previewAnchor);
      }
    });
  }

  setTree(tree: WorkspaceTree | null): void {
    this.tree = tree;
    this.index = tree === null ? new Map() : buildIndex(tree.root);
    this.ensureCwdExists();
    this.render();
  }

  applyTreePatch(patch: TreePatch): void {
    if (this.tree === null) {
      return;
    }
    this.index = applyPatch(this.tree.root, this.index, patch);
    this.tree = { ...this.tree, ...patch.stats };
    this.ensureCwdExists();
    this.render();
  }

  setView(view: ViewState): void {
    this.view = view;
    this.ensureCwdExists();
    this.render();
  }

  getView(): ViewState {
    return this.view;
  }

  getStats(): WorkspaceTree | null {
    return this.tree;
  }

  /** 지워진 폴더에 머무르지 않게 가장 가까운 살아있는 조상으로 올라간다 */
  private ensureCwdExists(): void {
    if (this.view.cwdId === null) {
      return;
    }
    if (this.index.has(this.view.cwdId)) {
      return;
    }
    this.view = { ...this.view, cwdId: null };
    this.handlers.onNavigate(null);
  }

  private cwd(): TreeNode | null {
    if (this.tree === null) {
      return null;
    }
    if (this.view.cwdId === null) {
      return this.tree.root;
    }
    return this.index.get(this.view.cwdId)?.node ?? this.tree.root;
  }

  private navigate(nodeId: string | null): void {
    this.closePreview();
    this.view = { ...this.view, cwdId: nodeId };
    this.selectedId = null;
    this.handlers.onNavigate(nodeId);
    this.render();
    this.el.cards.scrollTop = 0;
  }

  // --- 렌더 ---

  private render(): void {
    const cwd = this.cwd();
    this.renderBreadcrumb(cwd);
    this.renderCards(cwd);
  }

  private renderBreadcrumb(cwd: TreeNode | null): void {
    this.el.breadcrumb.replaceChildren();
    if (cwd === null || this.tree === null) {
      return;
    }
    const chain = ancestorsOf(this.index, cwd.id);
    chain.forEach((node, at) => {
      if (at > 0) {
        const sep = document.createElement("span");
        sep.className = "crumb-sep";
        sep.textContent = ">";
        this.el.breadcrumb.appendChild(sep);
      }
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.className = "crumb";
      crumb.textContent = node.name;
      crumb.dataset.id = node.id;
      crumb.disabled = at === chain.length - 1;
      this.el.breadcrumb.appendChild(crumb);
    });
  }

  private renderCards(cwd: TreeNode | null): void {
    this.el.cards.replaceChildren();
    this.visible = [];
    if (cwd === null) {
      return;
    }

    const asc = this.view.sortAsc;
    this.visible = [...(cwd.children ?? [])].filter((node) => this.passesFilter(node)).sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "folder" ? -1 : 1;
      }
      return asc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    });

    if (this.visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent =
        this.view.noteFilter === "all"
          ? "이 폴더에 표시할 파일이 없습니다"
          : "이 조건에 맞는 항목이 없습니다";
      this.el.cards.appendChild(empty);
      return;
    }

    for (const node of this.visible) {
      this.el.cards.appendChild(this.buildCard(node));
    }
  }

  /** 폴더는 하위 전체의 합계로 판정한다. 메모가 있는 곳으로 내려가는 길이 필터에 잘리면 안 된다 */
  private passesFilter(node: TreeNode): boolean {
    const filter = this.view.noteFilter;
    if (filter === "all") {
      return true;
    }
    const badge = this.handlers.getNoteBadge(node);
    if (badge === undefined) {
      return true;
    }
    switch (filter) {
      case "with":
        return badge.count > 0;
      case "without":
        return badge.count === 0;
      case "orphan":
        return badge.orphans > 0;
      default:
        return true;
    }
  }

  private buildCard(node: TreeNode): HTMLElement {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `card ${node.kind}${node.id === this.selectedId ? " selected" : ""}`;
    card.dataset.id = node.id;
    card.dataset.kind = node.kind;

    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = node.kind === "folder" ? "DIR" : extensionLabel(node.name);
    card.appendChild(kind);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = node.name;
    card.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "meta";
    if (node.kind === "folder") {
      const files = (node.children ?? []).filter((child) => child.kind === "file").length;
      const folders = (node.children ?? []).length - files;
      meta.textContent = [folders > 0 ? `${folders} dirs` : null, `${files} files`]
        .filter((part) => part !== null)
        .join(" · ");
    }
    card.appendChild(meta);

    const badge = this.handlers.getNoteBadge(node);
    if (badge !== undefined) {
      const notes = document.createElement("span");
      notes.className = "notes";
      notes.textContent = badge.count === 0 ? "no notes" : `${badge.count} notes`;
      card.appendChild(notes);

      if (badge.orphans > 0) {
        const orphans = document.createElement("span");
        orphans.className = "orphans";
        orphans.textContent = `${badge.orphans} orphan`;
        card.appendChild(orphans);
      }
    }

    return card;
  }

  // --- 입력 ---

  private onBreadcrumbClick(event: MouseEvent): void {
    const crumb = closest(event.target, "button.crumb");
    const id = crumb?.dataset.id;
    if (id === undefined || this.tree === null) {
      return;
    }
    this.navigate(id === this.tree.root.id ? null : id);
  }

  private onCardClick(event: MouseEvent): void {
    const card = closest(event.target, "button.card");
    const id = card?.dataset.id;
    if (id === undefined) {
      return;
    }
    if (card!.dataset.kind === "folder") {
      this.navigate(id);
      return;
    }
    this.select(id);
  }

  private onCardDoubleClick(event: MouseEvent): void {
    const card = closest(event.target, "button.card");
    if (card?.dataset.kind === "file" && card.dataset.id !== undefined) {
      this.handlers.onOpenFile(card.dataset.id);
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.visible.length === 0) {
      return;
    }
    const columns = this.columnCount();
    const at = this.selectedId === null ? -1 : this.visible.findIndex((n) => n.id === this.selectedId);

    switch (event.key) {
      case "ArrowRight":
        this.selectAt(at + 1);
        break;
      case "ArrowLeft":
        this.selectAt(at - 1);
        break;
      case "ArrowDown":
        this.selectAt(at < 0 ? 0 : at + columns);
        break;
      case "ArrowUp":
        this.selectAt(at < 0 ? 0 : at - columns);
        break;
      case "Enter": {
        const node = at < 0 ? undefined : this.visible[at];
        if (node === undefined) {
          return;
        }
        if (node.kind === "folder") {
          this.navigate(node.id);
        } else {
          this.handlers.onOpenFile(node.id);
        }
        break;
      }
      case "Backspace": {
        const cwd = this.cwd();
        const parentId = cwd === null ? null : this.index.get(cwd.id)?.parentId ?? null;
        if (cwd !== null && this.view.cwdId !== null) {
          this.navigate(parentId === this.tree?.root.id ? null : parentId);
        }
        break;
      }
      case " ": {
        // hover 없이도 프리뷰를 열 수 있어야 한다. 키보드로만 돌아다니는 경우가 있다
        const node = at < 0 ? undefined : this.visible[at];
        if (node !== undefined) {
          this.togglePreview(node);
        }
        break;
      }
      case "Escape":
        this.closePreview();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private selectAt(index: number): void {
    const clamped = Math.min(Math.max(index, 0), this.visible.length - 1);
    const node = this.visible[clamped];
    if (node !== undefined) {
      this.select(node.id);
    }
  }

  private select(id: string): void {
    this.selectedId = id;
    for (const card of this.el.cards.querySelectorAll<HTMLElement>("button.card")) {
      card.classList.toggle("selected", card.dataset.id === id);
      if (card.dataset.id === id) {
        card.scrollIntoView({ block: "nearest" });
      }
    }

    const node = this.index.get(id)?.node;
    if (node !== undefined && node.kind === "file") {
      this.handlers.onSelectFile(node);
    }
  }

  /** 패널이 닫히면 선택 표시도 지운다 */
  clearSelection(): void {
    this.selectedId = null;
    for (const card of this.el.cards.querySelectorAll<HTMLElement>("button.card")) {
      card.classList.remove("selected");
    }
  }

  /** 카드 내용은 그대로지만 메모 수가 바뀌었을 때 */
  refreshBadges(): void {
    this.render();
  }

  // --- 프리뷰 팝오버 ---

  private onHover(event: MouseEvent): void {
    const card = closest(event.target, "button.card");
    const id = card?.dataset.id;
    if (id === undefined || id === this.previewFor) {
      return;
    }
    window.clearTimeout(this.hoverTimer);
    this.hoverTimer = window.setTimeout(() => {
      const node = this.index.get(id)?.node;
      if (node !== undefined) {
        this.openPreview(node, card!);
      }
    }, PREVIEW_DELAY_MS);
  }

  private togglePreview(node: TreeNode): void {
    if (this.previewFor === node.id) {
      this.closePreview();
      return;
    }
    const card = this.el.cards.querySelector<HTMLElement>(`button.card[data-id="${cssEscape(node.id)}"]`);
    if (card !== null) {
      this.openPreview(node, card);
    }
  }

  private openPreview(node: TreeNode, anchor: HTMLElement): void {
    const content = this.handlers.getPreview(node);
    if (content === null) {
      this.closePreview();
      return;
    }

    this.previewFor = node.id;
    this.previewAnchor = anchor;
    this.el.preview.replaceChildren();

    const title = document.createElement("p");
    title.className = "preview-title";
    title.textContent = content.title;
    this.el.preview.appendChild(title);

    for (const line of content.lines) {
      const row = document.createElement("p");
      row.className = `preview-line${line.warn === true ? " warn" : ""}`;
      row.style.paddingLeft = `${line.indent * 12}px`;
      const label = document.createElement("span");
      label.className = "preview-label";
      label.textContent = line.label;
      row.appendChild(label);
      row.appendChild(document.createTextNode(line.text));
      this.el.preview.appendChild(row);
    }

    if (content.more !== undefined && content.more > 0) {
      const more = document.createElement("p");
      more.className = "preview-more";
      more.textContent = `+${content.more} more`;
      this.el.preview.appendChild(more);
    }

    this.el.preview.hidden = false;
    this.positionPreview(anchor);
  }

  private positionPreview(anchor: HTMLElement): void {
    const box = anchor.getBoundingClientRect();
    const popover = this.el.preview.getBoundingClientRect();
    const left = Math.min(box.left, window.innerWidth - popover.width - 8);
    const below = box.bottom + 4;
    const top = below + popover.height > window.innerHeight ? box.top - popover.height - 4 : below;
    this.el.preview.style.left = `${Math.max(left, 8)}px`;
    this.el.preview.style.top = `${Math.max(top, 8)}px`;
  }

  private closePreview(): void {
    window.clearTimeout(this.hoverTimer);
    this.previewFor = null;
    this.previewAnchor = null;
    this.el.preview.hidden = true;
  }

  private columnCount(): number {
    const template = getComputedStyle(this.el.cards).gridTemplateColumns;
    const columns = template.split(" ").filter((part) => part.trim() !== "").length;
    return Math.max(columns, 1);
  }
}

function closest(target: EventTarget | null, selector: string): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest<HTMLElement>(selector);
}

function extensionLabel(name: string): string {
  const at = name.lastIndexOf(".");
  if (at <= 0 || at === name.length - 1) {
    return "—";
  }
  return name.slice(at + 1).slice(0, 4).toUpperCase();
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
