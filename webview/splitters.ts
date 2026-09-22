// 메모 에디터 세 영역(코드 보기 / 미리보기 / 입력)의 크기 조절. 비율은 호스트가 전역으로 기억한다

import type { Layout } from "../src/editor/protocol";

export const DEFAULT_LAYOUT: Layout = { code: 1, preview: 3, input: 2 };
const MIN_PX = 40;
const HANDLE_PX = 5;

type Pane = keyof Layout;

/**
 * 영역 높이는 grid `fr` 행으로 정한다 (flex로 바꾸면 드래그 시작 때 영역이 튄다).
 * flex는 padding을 떼고 남은 공간만 가중치로 나누어 높이 비율 != 가중치 비율이 되는데, drag()는 둘이 같다고 보고 가중치를 역산한다.
 * grid 행은 padding을 칸 안에 담아 칸 높이가 정확히 가중치 비율이다 (최소 높이에 걸린 경우만 예외).
 */
export class Splitters {
  private layout: Layout = { ...DEFAULT_LAYOUT };
  private codeVisible = false;

  constructor(
    private readonly panes: Record<Pane, HTMLElement>,
    // 드래그를 끝냈을 때 (저장용)
    private readonly onCommit: (layout: Layout) => void,
  ) {
    for (const handle of document.querySelectorAll<HTMLElement>(".splitter")) {
      const [above, below] = (handle.dataset.between ?? "").split(",") as [Pane, Pane];
      handle.addEventListener("pointerdown", (event) => this.drag(event, handle, above, below));
      handle.addEventListener("dblclick", () => {
        this.apply({ ...DEFAULT_LAYOUT });
        this.onCommit(this.layout);
      });
    }
    this.apply(this.layout);
  }

  apply(layout: Layout): void {
    this.layout = { ...layout };
    const row = (pane: Pane) => `minmax(${MIN_PX}px, ${this.layout[pane]}fr)`;
    // 행 순서: 헤더, 오류, 코드, 손잡이, 미리보기, 손잡이, 입력 (CSS의 grid-row 번호와 짝)
    document.body.style.gridTemplateRows = [
      "auto",
      "auto",
      this.codeVisible ? row("code") : "0",
      this.codeVisible ? `${HANDLE_PX}px` : "0",
      row("preview"),
      `${HANDLE_PX}px`,
      row("input"),
    ].join(" ");
  }

  setCodeVisible(visible: boolean): void {
    this.codeVisible = visible;
    this.apply(this.layout);
  }

  // 두 영역의 가중치 합은 그대로 두고 픽셀 높이 비율대로 나눈다. 나머지 영역 크기는 안 바뀐다
  private drag(event: PointerEvent, handle: HTMLElement, above: Pane, below: Pane): void {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const top = this.panes[above].getBoundingClientRect().height;
    const total = top + this.panes[below].getBoundingClientRect().height;
    const weight = this.layout[above] + this.layout[below];
    handle.classList.add("dragging");

    const onMove = (move: PointerEvent) => {
      const next = Math.min(Math.max(top + move.clientY - startY, MIN_PX), total - MIN_PX);
      const upper = (weight * next) / total;
      this.apply({ ...this.layout, [above]: upper, [below]: weight - upper });
    };
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
