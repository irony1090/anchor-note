---
label: partition_table
title: 파티션 테이블
anchors:
  - file: partitions.csv
created: 2026-09-28T09:30:00.000Z
updated: 2026-09-28T09:30:00.000Z
---
# 파티션 테이블

OTA 슬롯 두 개(`ota_0`, `ota_1`), `factory` 파티션은 없다. 첫 플래시는 `ota_0`에 쓴다.

앱이 1.8MB(`0x1E0000`)를 넘으면 두 슬롯을 같이 늘리고 `ota_1`의 오프셋을 다시 계산한다.

#ota
