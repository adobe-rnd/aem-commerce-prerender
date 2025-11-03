# Events Handler - Simplified Version

Упрощенный обработчик событий Adobe I/O для автоматической генерации и публикации HTML страниц продуктов.

## Что делает этот action?

1. **Читает события** из Adobe I/O Events Journaling API (до 50 событий за раз)
2. **Извлекает уникальные SKU** из событий
3. **Генерирует HTML** для каждого SKU используя pdp-renderer
4. **Публикует** сгенерированный HTML в AEM используя `adminApi.previewAndPublish`
5. **Сохраняет позицию** последнего обработанного события

## Основные характеристики

- ✅ Простая архитектура без сложных очередей
- ✅ Автоматическое извлечение уникальных SKU
- ✅ Пакетная обработка событий (limit: 50)
- ✅ Интеграция с Adobe I/O Events
- ✅ Автоматическая публикация в AEM
- ✅ Сохранение состояния между запусками
- ✅ Автоматическое обновление токенов (TokenManager)

## Требования

### Переменные окружения

```bash
# Adobe I/O Events
IMS_ORG_ID=your_org_id
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
JOURNALLING_URL=your_journalling_url

# AEM Configuration
ORG=your_org
SITE=your_site
AEM_ADMIN_API_AUTH_TOKEN=your_admin_token

# Commerce API
COMMERCE_ENDPOINT=your_commerce_endpoint
COMMERCE_X_API_KEY=your_api_key
ENVIRONMENT_ID=your_environment_id
WEBSITE_CODE=your_website_code
STORE_CODE=your_store_code
STORE_VIEW_CODE=your_store_view_code
```

## Использование

### Локальный тест

```bash
# Установить зависимости
npm install

# Создать .env файл с переменными окружения
cp .env.example .env
# Отредактировать .env

# Запустить тест
node test-events-handler-simple.js
```

### Деплой в Adobe I/O Runtime

```bash
# Деплой action
aio app deploy

# Запуск action
aio runtime action invoke events-handler --result
```

## Процесс обработки

```
1. Получить токен доступа
   └─> TokenManager автоматически обновляет если истек
   
2. Получить события из журнала (limit: 50)
   └─> Использовать сохраненную позицию
   
3. Извлечь уникальные SKU
   └─> Удалить дубликаты
   
4. Для каждого SKU:
   └─> Сгенерировать HTML
   └─> Сохранить в Files storage
   
5. Публикация:
   └─> adminApi.previewAndPublish(records)
   └─> Ожидать завершения
   
6. Сохранить новую позицию
```

## Ответ action

### Успешный ответ

```json
{
  "status": "completed",
  "statistics": {
    "events_fetched": 50,
    "unique_skus": 12,
    "processed": 10,
    "failed": 2,
    "published": 10
  }
}
```

### Ответ с ошибкой

```json
{
  "status": "error",
  "error": "Error message",
  "stack": "Error stack trace"
}
```

## Отличия от предыдущей версии

| Характеристика | Старая версия | Новая версия |
|----------------|---------------|--------------|
| Размер кода | ~930 строк | ~310 строк (index.js + token-manager.js) |
| Управление токенами | Сложный TokenManager | Упрощенный TokenManager с автообновлением |
| Batch processing | Сложная логика | Простая последовательная |
| Публикация | Прямые API вызовы | adminApi.previewAndPublish |
| Observability | Интегрирована | Убрана |
| Локали | Поддержка множественных | Упрощено |
| Unpublish | Сложная логика | Убрано |

## Структура кода

### index.js
```javascript
// Основные функции:
extractUniqueSKUs(events)      // Извлечение уникальных SKU
fetchEvents(...)               // Получение событий из журнала
generateSKUHtml(sku, ...)      // Генерация HTML для SKU
main(params)                   // Главная функция action
```

### token-manager.js
```javascript
// TokenManager класс:
getAccessToken()               // Получить токен (авто-обновление)
isTokenValid(tokenData)        // Проверить валидность токена
fetchNewToken()                // Получить новый токен от Adobe IMS
```

## Логирование

Action использует Adobe I/O Core Logger:

```javascript
logger.info('Info message');
logger.error('Error message');
```

Уровень логирования настраивается через параметр `LOG_LEVEL`:
- `error` (по умолчанию)
- `warn`
- `info`
- `debug`

## Обработка ошибок

- **404/400/500 от Events API** - интерпретируются как "нет новых событий"
- **Ошибки генерации HTML** - продукт пропускается, но обработка продолжается
- **Ошибки публикации** - логируются, но не останавливают обработку
- **Критические ошибки** - возвращают статус "error"

## Дальнейшее развитие

Возможные улучшения:

- [ ] Добавить поддержку множественных локалей
- [ ] Реализовать unpublish для удаленных продуктов
- [ ] Добавить метрики и мониторинг
- [ ] Оптимизировать параллельную обработку
- [ ] Добавить retry логику для отдельных SKU

## Поддержка

Для вопросов и проблем создавайте issue в репозитории проекта.

