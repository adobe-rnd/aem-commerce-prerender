# TokenManager - Упрощенное управление токенами Adobe I/O

## Описание

TokenManager - упрощенный менеджер для автоматического получения и обновления токенов доступа Adobe I/O Events API.

## Основные возможности

- ✅ **Автоматическое получение токенов** от Adobe IMS
- ✅ **Автоматическое обновление** при истечении срока
- ✅ **Кэширование токенов** в памяти
- ✅ **Сохранение в State** для переиспользования между вызовами
- ✅ **Буфер обновления** - токен обновляется за 5 минут до истечения

## Требуемые параметры

```javascript
{
  CLIENT_ID: 'your_client_id',          // Обязательно
  CLIENT_SECRET: 'your_client_secret',  // Обязательно
  IMS_ORG_ID: 'your_ims_org_id'        // Обязательно
}
```

## Использование

### Базовый пример

```javascript
const { TokenManager } = require('./token-manager');
const { StateManager } = require('../lib/state');

// Инициализация
const tokenManager = new TokenManager(params, stateManager, logger);

// Получить токен (автоматически обновится если истек)
const accessToken = await tokenManager.getAccessToken();

// Использовать токен
const eventsClient = await Events.init(
  params.IMS_ORG_ID,
  params.CLIENT_ID,
  accessToken
);
```

### С State Manager

```javascript
const { State } = require('@adobe/aio-sdk');
const { StateManager } = require('../lib/state');

// Инициализация State
const stateLib = await State.init();
const stateManager = new StateManager(stateLib, { logger });

// TokenManager автоматически сохранит токен в State
const tokenManager = new TokenManager(params, stateManager, logger);

// Первый вызов - получит новый токен
const token1 = await tokenManager.getAccessToken();

// Второй вызов - использует сохраненный токен
const token2 = await tokenManager.getAccessToken();
```

### Без State Manager

```javascript
// Можно использовать без State Manager
// В этом случае токен будет только в памяти
const tokenManager = new TokenManager(params, null, logger);

const accessToken = await tokenManager.getAccessToken();
```

## Методы

### `getAccessToken()`

Возвращает валидный токен доступа. Автоматически обновляет токен если:
- Токен отсутствует
- Токен истек
- До истечения токена осталось менее 5 минут

**Возвращает:** `Promise<string>` - Access token

**Пример:**
```javascript
const token = await tokenManager.getAccessToken();
// eyJhbGciOiJSUzI1NiIsIng1dCI6...
```

### `isTokenValid(tokenData)`

Проверяет валидность токена с учетом буфера обновления.

**Параметры:**
- `tokenData` (Object) - Объект токена с полем `expires_at`

**Возвращает:** `boolean`

**Пример:**
```javascript
const isValid = tokenManager.isTokenValid({
  access_token: 'token...',
  expires_at: Date.now() + 3600000
});
// true или false
```

### `fetchNewToken()`

Получает новый токен от Adobe IMS. Обычно вызывается автоматически.

**Возвращает:** `Promise<Object>` - Объект токена с метаданными

**Пример:**
```javascript
const tokenData = await tokenManager.fetchNewToken();
// {
//   access_token: 'eyJhbGci...',
//   token_type: 'bearer',
//   expires_in: 86400,
//   created_at: 1699000000000,
//   expires_at: 1699086400000
// }
```

## Логика работы

```
1. Вызов getAccessToken()
   │
   ├─> Проверка кэша в памяти
   │   └─> Если валиден → возврат токена
   │
   ├─> Проверка State storage
   │   └─> Если валиден → сохранение в кэш → возврат токена
   │
   └─> Получение нового токена от Adobe IMS
       ├─> POST запрос к https://ims-na1.adobelogin.com/ims/token/v3
       ├─> Сохранение в кэш
       ├─> Сохранение в State
       └─> Возврат токена
```

## Структура токена

TokenManager сохраняет токены в следующем формате:

```javascript
{
  access_token: 'eyJhbGciOiJSUzI1NiIsIng1dCI6...',  // Сам токен
  token_type: 'bearer',                            // Тип токена
  expires_in: 86400,                               // Время жизни (секунды)
  created_at: 1699000000000,                       // Время создания (timestamp)
  expires_at: 1699086400000                        // Время истечения (timestamp)
}
```

## Буфер обновления

TokenManager обновляет токен **за 5 минут до истечения**. Это предотвращает использование истекших токенов.

```javascript
const REFRESH_BUFFER = 5 * 60 * 1000; // 5 минут

// Токен считается валидным если:
(expires_at - now) > REFRESH_BUFFER
```

## Обработка ошибок

TokenManager выбрасывает ошибки в следующих случаях:

### Отсутствуют креденшалы

```javascript
// Error: Missing required credentials: CLIENT_ID, CLIENT_SECRET, and IMS_ORG_ID must be provided
```

### Ошибка запроса к Adobe IMS

```javascript
// Error: IMS token request failed: 401 Unauthorized - Invalid client credentials
```

### Невалидный ответ

```javascript
// Error: No access_token in IMS response
```

## Логирование

TokenManager использует переданный logger для вывода информации:

```javascript
logger.debug('Using cached access token');
logger.info('Fetching new access token...');
logger.info('New access token obtained and cached');
logger.error('Error getting access token:', error.message);
```

## State Storage

Токены сохраняются в State по ключу `adobe_io_access_token`:

```javascript
const stateKey = 'adobe_io_access_token';

// Сохранение
await stateManager.put(stateKey, JSON.stringify(tokenData));

// Получение
const storedToken = JSON.parse(await stateManager.get(stateKey));
```

## Scopes

TokenManager запрашивает следующие scopes:

```javascript
const scopes = 'adobeio_api,openid,read_organizations';
```

Эти scopes необходимы для работы с Adobe I/O Events API и Journaling.

## Время жизни токенов

- **По умолчанию**: 24 часа (86400 секунд)
- **Буфер обновления**: 5 минут
- **Фактическое использование**: ~23 часа 55 минут

## Пример полного workflow

```javascript
const { Core, Events, State } = require('@adobe/aio-sdk');
const { StateManager } = require('../lib/state');
const { TokenManager } = require('./token-manager');

async function processEvents(params) {
  const logger = Core.Logger('my-action');
  
  // 1. Инициализация State
  const stateLib = await State.init();
  const stateManager = new StateManager(stateLib, { logger });
  
  // 2. Инициализация TokenManager
  const tokenManager = new TokenManager(params, stateManager, logger);
  
  // 3. Получение токена (автоматически обновится если нужно)
  const accessToken = await tokenManager.getAccessToken();
  
  // 4. Использование токена для Events API
  const eventsClient = await Events.init(
    params.IMS_ORG_ID,
    params.CLIENT_ID,
    accessToken
  );
  
  // 5. Работа с Events API
  const journalling = await eventsClient.getEventsFromJournal(
    params.JOURNALLING_URL,
    { limit: 50 }
  );
  
  return journalling.events;
}
```

## Отличия от предыдущей версии

| Функция | Старая версия | Новая версия |
|---------|---------------|--------------|
| Размер кода | ~237 строк | 161 строка |
| Методы | 6 методов | 3 метода |
| getTokenInfo() | ✅ | ❌ (не нужен) |
| refreshToken() | ✅ | ❌ (встроено в getAccessToken) |
| setStateManager() | ✅ | ❌ (передается в конструктор) |

## Рекомендации

1. **Всегда используйте StateManager** - это позволяет переиспользовать токены между вызовами
2. **Не храните токены в коде** - используйте переменные окружения
3. **Проверяйте логи** - TokenManager логирует все операции
4. **Обрабатывайте ошибки** - используйте try-catch блоки

## Troubleshooting

### Токен не обновляется

```javascript
// Проверьте что StateManager передан правильно
const tokenManager = new TokenManager(params, stateManager, logger);
```

### Ошибка 401 Unauthorized

```javascript
// Проверьте CLIENT_ID и CLIENT_SECRET
console.log('CLIENT_ID:', params.CLIENT_ID);
console.log('CLIENT_SECRET:', params.CLIENT_SECRET ? '***' : 'NOT SET');
```

### Токен истекает слишком часто

```javascript
// Проверьте логи - возможно State не сохраняется
logger.info('Token will be refreshed in:', (tokenData.expires_at - Date.now()) / 1000 / 60, 'minutes');
```

