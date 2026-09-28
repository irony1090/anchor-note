#include "uart_drv.h"
#include "driver/uart.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

#define UART_PORT    UART_NUM_1
#define TX_PIN       17
#define RX_PIN       18
#define RX_BUF_SIZE  1024

static const char *TAG = "uart";
static QueueHandle_t uart_queue;

static void uart_event_task(void *arg);

void uart_drv_init(void)
{
    // @note:uart_config
    const uart_config_t cfg = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity    = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
    };
    // @note:/uart_config
    ESP_ERROR_CHECK(uart_driver_install(UART_PORT, RX_BUF_SIZE * 2, 0, 20, &uart_queue, 0));
    ESP_ERROR_CHECK(uart_param_config(UART_PORT, &cfg));
    ESP_ERROR_CHECK(uart_set_pin(UART_PORT, TX_PIN, RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
    xTaskCreate(uart_event_task, "uart_event", 3072, NULL, 12, NULL);
}

// @note:event_rules
static void uart_event_task(void *arg)
{
    uart_event_t event;
    for (;;) {
        if (!xQueueReceive(uart_queue, &event, portMAX_DELAY)) {
            continue;
        }
        switch (event.type) {
        case UART_FIFO_OVF:
        case UART_BUFFER_FULL:
            ESP_LOGW(TAG, "rx overflow, flushing");
            uart_flush_input(UART_PORT);
            xQueueReset(uart_queue);
            break;
        default:
            break;
        }
    }
}
