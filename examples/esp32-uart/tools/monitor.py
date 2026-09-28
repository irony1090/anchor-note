"""Serial log monitor for the board."""
import sys

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
# @note:uart_config#monitor
BAUD = 115200
# @note:/uart_config#monitor


def main() -> None:
    with serial.Serial(PORT, BAUD, timeout=1) as port:
        while True:
            line = port.readline()
            if line:
                print(line.decode(errors="replace"), end="")


if __name__ == "__main__":
    main()
