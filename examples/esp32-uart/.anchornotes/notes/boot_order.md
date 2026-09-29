---
label: boot_order
title: 부팅 순서
anchors:
  - marker: main/main.c
created: 2026-09-28T09:00:00.000Z
updated: 2026-09-28T09:00:00.000Z
---
# 부팅 순서

NVS → 이벤트 루프 → UART → Wi-Fi 순서로 초기화한다.

- Wi-Fi가 `nvs_flash_init()`보다 먼저 오면 `esp_wifi_init()`이 `ESP_ERR_NVS_NOT_INITIALIZED`로 실패한다.
- UART는 Wi-Fi보다 먼저 연다. Wi-Fi 연결 중에 나오는 로그를 받아야 한다.

#boot #esp32
