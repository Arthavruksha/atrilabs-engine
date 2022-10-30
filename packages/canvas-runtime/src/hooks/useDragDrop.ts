import React, { useEffect, useState } from "react";
import { createMachine, assign, Action, interpret } from "xstate";
import type { StartDragArgs, DragComp, DragData, Location } from "../types";
import {
  lockMachineForCompDrop,
  lockMachineForDataDrop,
  lockMachineForTemplateDrop,
} from "../decorators/CanvasActivityDecorator";

type DragDropMachineContext = {
  startDragArgs: StartDragArgs | null;
};

// events
const START_DRAG_CALLED = "START_DRAG_CALLED" as "START_DRAG_CALLED";
const MOUSE_MOVE = "MOUSE_MOVE" as "MOUSE_MOVE";
const MOUSE_UP = "MOUSE_UP" as "MOUSE_UP";
const RESTART = "RESTART" as "RESTART"; // event emitted to signal that we can start over
const CANVAS_ENTERED = "CANVAS_ENTERED" as "CANVAS_ENTERED";
const CANVAS_EXITED = "CANVAS_EXITED" as "CANVAS_EXITED";

// event type
type DragDropMachineEvent =
  | {
      type: "START_DRAG_CALLED";
      args: StartDragArgs;
    }
  | { type: "MOUSE_MOVE"; loc: Location }
  | { type: "MOUSE_UP"; loc: Location }
  | { type: "RESTART" }
  | { type: "CANVAS_ENTERED" }
  | { type: "CANVAS_EXITED" };

// states
const idle = "idle";
const DRAG_START = "DRAG_START";
const OUT_OF_CANVAS = "OUT_OF_CANVAS";
const IN_CANVAS = "IN_CANVAS";
const DRAG_SUCCESS = "DRAG_SUCCESS";
const DRAG_FAILED = "DRAG_FAILED";

// actions
const onStartDragCalled: Action<
  DragDropMachineContext,
  {
    type: "START_DRAG_CALLED";
    args: StartDragArgs;
  }
> = assign({
  startDragArgs: (_context, event) => {
    return event.args;
  },
});

const resetContextAction: Action<DragDropMachineContext, any> = assign({
  startDragArgs: (_context, _event) => null,
});

const dragDropMachine = createMachine<
  DragDropMachineContext,
  DragDropMachineEvent
>({
  id: "dragDropMachine",
  context: { startDragArgs: null },
  initial: idle,
  states: {
    [idle]: {
      on: {
        [START_DRAG_CALLED]: {
          target: DRAG_START,
          actions: [onStartDragCalled],
        },
      },
    },
    [DRAG_START]: {
      on: { [MOUSE_MOVE]: { target: OUT_OF_CANVAS } },
    },
    [OUT_OF_CANVAS]: {
      on: {
        [CANVAS_ENTERED]: { target: IN_CANVAS },
        [MOUSE_UP]: { target: DRAG_FAILED },
      },
    },
    [IN_CANVAS]: {
      on: {
        [MOUSE_MOVE]: { target: IN_CANVAS },
        [MOUSE_UP]: { target: DRAG_SUCCESS },
        [CANVAS_EXITED]: { target: OUT_OF_CANVAS },
      },
    },
    [DRAG_SUCCESS]: {
      on: {
        [RESTART]: { target: idle, actions: [resetContextAction] },
      },
    },
    [DRAG_FAILED]: {
      on: {
        [RESTART]: { target: idle, actions: [resetContextAction] },
      },
    },
  },
});

const service = interpret(dragDropMachine);
service.start();

// ============ API exposed to layers ====================================
export function startDrag(dragComp: DragComp, dragData: DragData) {
  service.send({ type: START_DRAG_CALLED, args: { dragComp, dragData } });
  if (dragData.type === "component") {
    lockMachineForCompDrop(dragData.data.id);
  }
  if (dragData.type === "src") {
    // For data drop, the target is known during drag & drop only
    lockMachineForDataDrop();
  }
  if (dragData.type === "template") {
    lockMachineForTemplateDrop(dragData.data.newTemplateRootId);
  }
}

type DropSubscriber = (
  args: StartDragArgs,
  loc: Location,
  caughtBy: string
) => void;
const dropSubscribers: DropSubscriber[] = [];
export function subscribeNewDrop(cb: DropSubscriber) {
  dropSubscribers.push(cb);
  return () => {
    const index = dropSubscribers.findIndex((curr) => curr === cb);
    if (index >= 0) {
      dropSubscribers.splice(index, 1);
    }
  };
}

type DragSubscriber = (
  args: StartDragArgs,
  loc: Location,
  caughtBy: string | null
) => void;
const dragSubscribers: DragSubscriber[] = [];
export function subscribeNewDrag(cb: DragSubscriber) {
  dragSubscribers.push(cb);
  return () => {
    const index = dragSubscribers.findIndex((curr) => curr === cb);
    if (index >= 0) {
      dragSubscribers.splice(index, 1);
    }
  };
}

export function isNewDropInProgress() {
  return service.state.value !== idle;
}

// =============== hook used in Canvas component to enable drag & drop mechanism ==
export const useDragDrop = (
  containerRef: React.RefObject<HTMLElement>,
  iframeEl: HTMLIFrameElement | null
) => {
  useEffect(() => {
    const mouseMoveCb = (event: MouseEvent) => {
      service.send({ type: "MOUSE_MOVE", loc: event });
    };
    const mouseUpCb = (event: MouseEvent) => {
      service.send({ type: "MOUSE_UP", loc: event });
    };
    const mouseEnteredCb = (event: MouseEvent) => {
      console.log("mouse entered");
      service.send({ type: "CANVAS_ENTERED" });
    };
    const mouseExitedCb = (event: MouseEvent) => {
      service.send({ type: "CANVAS_EXITED" });
    };
    const mouseMoveCanvas = (event: MouseEvent) => {
      service.send({ type: "MOUSE_MOVE", loc: event });
    };
    const mouseUpCanvas = (event: MouseEvent) => {
      service.send({ type: "MOUSE_UP", loc: event });
    };
    service.onTransition((state) => {
      if (state.changed) {
        if (state.value === DRAG_START) {
          window.addEventListener("mousemove", mouseMoveCb);
          window.addEventListener("mouseup", mouseUpCb);
          if (iframeEl !== null) {
            iframeEl.contentWindow?.document.body.addEventListener(
              "mouseenter",
              mouseEnteredCb
            );
            iframeEl.contentWindow?.document.body.addEventListener(
              "mouseleave",
              mouseExitedCb
            );
            iframeEl.contentWindow?.document.body.addEventListener(
              "mousemove",
              mouseMoveCanvas
            );
            iframeEl.contentWindow?.document.body.addEventListener(
              "mouseup",
              mouseUpCanvas
            );
          }
        }
        if (state.value === idle) {
          window.removeEventListener("mousemove", mouseMoveCb);
          window.removeEventListener("mouseup", mouseUpCb);
          if (iframeEl !== null) {
            iframeEl.contentWindow?.document.body.removeEventListener(
              "mouseenter",
              mouseEnteredCb
            );
            iframeEl.contentWindow?.document.body.removeEventListener(
              "mouseleave",
              mouseExitedCb
            );
            iframeEl.contentWindow?.document.body.removeEventListener(
              "mousemove",
              mouseMoveCanvas
            );
            iframeEl.contentWindow?.document.body.removeEventListener(
              "mouseup",
              mouseUpCanvas
            );
          }
        }
      }
    });
  }, [iframeEl]);

  const [overlay, setOverlay] = useState<{
    comp: React.FC;
    props: any;
    style: React.CSSProperties;
  } | null>(null);
  useEffect(() => {
    service.onTransition((state, event) => {
      if (state.value === DRAG_SUCCESS || state.value === DRAG_FAILED) {
        service.send({ type: RESTART });
      }
    });
  }, [containerRef, setOverlay]);

  return overlay;
};
