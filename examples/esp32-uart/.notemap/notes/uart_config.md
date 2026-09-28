---
label: uart_config
title: UART 설정
anchors:
  - marker: main/uart_drv.c
    block: config
    hash: f2f99e90
  - marker: tools/monitor.py
    id: monitor
    block: baud
    prefix: "BAUD = "
    suffix: ""
    hash: b58d23da
created: 2026-09-28T09:10:00.000Z
updated: 2026-09-28T09:10:00.000Z
---
# UART 설정

펌웨어와 PC 모니터 스크립트의 보드레이트가 같아야 로그가 깨지지 않는다. 값을 바꿀 때는 이 메모의 블록을 고치고 [모두 동기화]를 누른다. #esp32 #uart

```c config
const uart_config_t cfg = {
    .baud_rate = 115200,
    .data_bits = UART_DATA_8_BITS,
    .parity    = UART_PARITY_DISABLE,
    .stop_bits = UART_STOP_BITS_1,
    .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
};
```

모니터 스크립트(`tools/monitor.py`)의 보드레이트:

```text baud
115200
```

핀: TX = GPIO17, RX = GPIO18.
