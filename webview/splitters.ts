// 메모 에디터 영역(앵커 칩 / 미리보기 / 입력)의 크기 조절. 크기는 호스트가 전역으로 기억한다

import type { Layout } from "../src/editor/protocol";

// anchors 60px = 칩 두 줄 남짓
export const DEFAULT_LAYOUT: Layout = { anchors: 60, preview: 3, input: 2 };
const MIN_PX = 40;
const MIN_ANCHORS_PX = 26;
const HANDLE_PX = 5;

type Pane = "preview" | "input";
type Panes = Record<Pane | "anchors", HTMLElement>;

/**
 * 미리보기·입력 높이는 grid `fr` 행으로 정한다 (flex로 바꾸면 드래그 시작 때 영역이 튄다).
 * flex는 padding을 떼고 남은 공간만 가중치로 나누어 높이 비율 != 가중치 비율이 되는데, drag()는 둘이 같다고 보고 가중치를 역산한다.
 * grid 행은 padding을 칸 안에 담아 칸 높이가 정확히 가중치 비율이다 (최소 높이에 걸린 경우만 예외).
 * 앵커 칩 행은 `fit-content(최대 px)` — 칩이 적으면 내용만큼, 넘치면 최대 높이에서 스크롤. 남는 칸을 비워 두지 않는다.
 */
export class Splitters {
  private layout: Layout = { ...DEFAULT_LAYOUT };

  constructor(
    private readonly panes: Panes,
    // 드래그를 끝냈을 때 (저장용)
    private readonly onCommit: (layout: Layout) => void,
  ) {
    for (const handle of document.querySelectorAll<HTMLElement>(".splitter")) {
      const between = handle.dataset.between;
      if (between === undefined) {
        handle.addEventListener("pointerdown", (event) => this.dragAnchors(event, handle));
        handle.addEventListener("dblclick", () => this.commit({ ...this.layout, anchors: DEFAULT_LAYOUT.anchors }));
      } else {
        const [above, below] = between.split(",") as [Pane, Pane];
        handle.addEventListener("pointerdown", (event) => this.drag(event, handle, above, below));
        handle.addEventListener("dblclick", () =>
          this.commit({ ...this.layout, preview: DEFAULT_LAYOUT.preview, input: DEFAULT_LAYOUT.input }),
        );
      }
    }
    this.apply(this.layout);
  }

  // 저장된 값은 옛 형식({code, preview, input})일 수 있다. 아는 키만, 양수만 받는다
  apply(layout: Partial<Layout>): void {
    const pick = (key: keyof Layout) => {
      const value = layout[key];
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_LAYOUT[key];
    };
    this.layout = { anchors: pick("anchors"), preview: pick("preview"), input: pick("input") };
    const row = (pane: Pane) => `minmax(${MIN_PX}px, ${this.layout[pane]}fr)`;
    // 행 순서: 헤더, 오류, 앵커 칩, 손잡이, 미리보기, 손잡이, 입력 (CSS의 grid-row 번호와 짝)
    document.body.style.gridTemplateRows = [
      "auto",
      "auto",
      `fit-content(${this.layout.anchors}px)`,
      `${HANDLE_PX}px`,
      row("preview"),
      `${HANDLE_PX}px`,
      row("input"),
    ].join(" ");
  }

  private commit(layout: Layout): void {
    this.apply(layout);
    this.onCommit(this.layout);
  }

  // 두 영역의 가중치 합은 그대로 두고 픽셀 높이 비율대로 나눈다. 나머지 영역 크기는 안 바뀐다
  private drag(event: PointerEvent, handle: HTMLElement, above: Pane, below: Pane): void {
    const top = this.panes[above].getBoundingClientRect().height;
    const total = top + this.panes[below].getBoundingClientRect().height;
    const weight = this.layout[above] + this.layout[below];
    this.track(event, handle, (dy) => {
      const next = Math.min(Math.max(top + dy, MIN_PX), total - MIN_PX);
      const upper = (weight * next) / total;
      return { ...this.layout, [above]: upper, [below]: weight - upper };
    });
  }

  // 칩 영역 최대 높이. 지금 보이는 높이에서 출발한다(칩이 적으면 최대보다 낮다). 미리보기·입력은 최소 높이까지만 줄인다
  private dragAnchors(event: PointerEvent, handle: HTMLElement): void {
    const start = this.panes.anchors.getBoundingClientRect().height;
    const room = start + this.panes.preview.getBoundingClientRect().height + this.panes.input.getBoundingClientRect().height - 2 * MIN_PX;
    this.track(event, handle, (dy) => ({ ...this.layout, anchors: Math.min(Math.max(start + dy, MIN_ANCHORS_PX), room) }));
  }

  private track(event: PointerEvent, handle: HTMLElement, next: (dy: number) => Layout): void {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    handle.classList.add("dragging");

    const onMove = (move: PointerEvent) => this.apply(next(move.clientY - startY));
    const onUp = () => {
      handle.classList.remove("dragging");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      this.onCommit(this.layout);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }
}
