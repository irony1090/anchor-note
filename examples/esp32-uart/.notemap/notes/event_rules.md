---
label: event_rules
title: 이벤트 핸들러 규칙
anchors:
  - marker: main/uart_drv.c
  - marker: main/wifi.c
created: 2026-09-28T09:20:00.000Z
updated: 2026-09-28T09:20:00.000Z
---
# 이벤트 핸들러 규칙

이벤트 핸들러와 이벤트 태스크는 빨리 돌아와야 한다. 여기서 막히면 같은 루프의 다른 이벤트가 모두 늦어진다.

- 오래 막히는 호출(`vTaskDelay`, 블로킹 I/O)을 하지 않는다
- 무거운 일은 큐에 넣고 별도 태스크에서 처리한다
- `ESP_ERROR_CHECK`로 abort하지 않는다 — 로그만 남긴다

#esp32 #rtos
