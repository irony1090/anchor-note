#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "uart_drv.h"
#include "wifi.h"

static const char *TAG = "main";

void app_main(void)
{
    // @note:boot_order
    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    uart_drv_init();
    wifi_start();

    ESP_LOGI(TAG, "boot done");
}
