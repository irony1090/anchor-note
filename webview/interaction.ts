import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import type { D3ZoomEvent, ZoomBehavior } from "d3-zoom";
import type { Viewport } from "../src/shared/protocol";
import type { LaidOutNode, Layout } from "./layout";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

/** 이 배율 아래에서는 라벨을 숨긴다. 글자가 뭉개지면서 렌더 비용만 든다 */
const LABEL_MIN_SCALE = 0.45;

const FIT_PADDING = 24;
const VIEWPORT_SAVE_DELAY_MS = 400;

export interface InteractionHandlers {
  onViewportChange(viewport: Viewport): void;
  onSelect(nodeId: string | null): void;
  onToggle(nodeId: string): void;
}

export class MapInteraction {
  private readonly behavior: ZoomBehavior<SVGSVGElement, unknown>;
  private layout: Layout | null = null;
  private saveTimer: number | undefined;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly host: SVGGElement,
    private readonly handlers: InteractionHandlers,
  ) {
    this.behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => this.applyTransform(event));

    // d3의 기본 더블클릭 줌을 끈다. 노드 더블클릭(접기/펼치기)과 같은 이벤트를 두고 다투기 때문이다
    select(this.svg).call(this.behavior).on("dblclick.zoom", null);

    this.svg.addEventListener("click", (event) => this.onClick(event));
    this.svg.addEventListener("dblclick", (event) => this.onDoubleClick(event));
    this.svg.addEventListener("keydown", (event) => this.onKeyDown(event));
  }

  setLayout(layout: Layout): void {
    this.layout = layout;
  }

  applyViewport(viewport: Viewport): void {
    const transform = zoomIdentity.translate(viewport.x, viewport.y).scale(viewport.k);
    select(this.svg).call(this.behavior.transform, transform);
  }

  fit(): void {
    if (this.layout === null || this.layout.nodes.length === 0) {
      return;
    }
    const box = this.svg.getBoundingClientRect();
    const width = Math.max(this.layout.maxX - this.layout.minX, 1);
    const height = Math.max(this.layout.maxY - this.layout.minY, 1);
    const usableWidth = Math.max(box.width - FIT_PADDING * 2, 1);
    const usableHeight = Math.max(box.height - FIT_PADDING * 2, 1);

    const scale = clamp(Math.min(usableWidth / width, usableHeight / height), MIN_SCALE, 1);
    const x = FIT_PADDING - this.layout.minX * scale + (usableWidth - width * scale) / 2;
    const y = FIT_PADDING - this.layout.minY * scale + (usableHeight - height * scale) / 2;

    select(this.svg).call(this.behavior.transform, zoomIdentity.translate(x, y).scale(scale));
  }

  private applyTransform(event: D3ZoomEvent<SVGSVGElement, unknown>): void {
    const { x, y, k } = event.transform;
    this.host.setAttribute("transform", `translate(${x},${y}) scale(${k})`);
    this.svg.classList.toggle("low-detail", k < LABEL_MIN_SCALE);

    // 휠 한 번에 수십 번 발생하므로 저장은 멈춘 뒤에 한 번만 보낸다
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.handlers.onViewportChange({ x, y, k });
    }, VIEWPORT_SAVE_DELAY_MS);
  }

  private onClick(event: MouseEvent): void {
    const node = nodeIdFrom(event.target);
    this.handlers.onSelect(node);
    if (node !== null) {
      this.svg.focus();
    }
  }

  private onDoubleClick(event: MouseEvent): void {
    const target = closestNode(event.target);
    if (target === null) {
      this.behavior.scaleBy(select(this.svg), 1.4);
      return;
    }
    if (target.dataset.kind === "folder" && target.dataset.id !== undefined) {
      this.handlers.onToggle(target.dataset.id);
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.layout === null) {
      return;
    }
    const selected = this.svg.querySelector<SVGGElement>("g.node.selected");
    const currentId = selected?.dataset.id ?? null;

    switch (event.key) {
      case " ": {
        const current = this.findNode(currentId);
        if (current !== null && current.kind === "folder" && current.hasChildren) {
          this.handlers.onToggle(current.id);
        }
        break;
      }
      case "ArrowDown":
        this.moveSelection(currentId, 1);
        break;
      case "ArrowUp":
        this.moveSelection(currentId, -1);
        break;
      case "ArrowLeft": {
        const current = this.findNode(currentId);
        if (current === null) {
          return;
        }
        if (current.kind === "folder" && current.hasChildren && !current.collapsed) {
          this.handlers.onToggle(current.id);
        } else if (current.parentId !== null) {
          this.handlers.onSelect(current.parentId);
        }
        break;
      }
      case "ArrowRight": {
        const current = this.findNode(currentId);
        if (current === null) {
          return;
        }
        if (current.collapsed && current.hasChildren) {
          this.handlers.onToggle(current.id);
        } else {
          const child = this.layout.nodes.find((node) => node.parentId === current.id);
          if (child !== undefined) {
            this.handlers.onSelect(child.id);
          }
        }
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }

  private moveSelection(currentId: string | null, step: number): void {
    if (this.layout === null || this.layout.nodes.length === 0) {
      return;
    }
    const ordered = [...this.layout.nodes].sort((a, b) => a.y - b.y);
    const index = currentId === null ? -1 : ordered.findIndex((node) => node.id === currentId);
    const next = index < 0 ? 0 : clamp(index + step, 0, ordered.length - 1);
    this.handlers.onSelect(ordered[next]!.id);
  }

  private findNode(id: string | null): LaidOutNode | null {
    if (id === null || this.layout === null) {
      return null;
    }
    return this.layout.nodes.find((node) => node.id === id) ?? null;
  }
}

function closestNode(target: EventTarget | null): SVGGElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest<SVGGElement>("g.node");
}

function nodeIdFrom(target: EventTarget | null): string | null {
  return closestNode(target)?.dataset.id ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
