require("dotenv").config();
const axios = require("axios");
const WebSocket = require("ws");
const express = require("express");
const app = express(); // Инициализация приложения после импорто

const WHITEBIT_WSS_HOST = process.env.WHITEBIT_WSS_HOST;
const API_HOST = process.env.WHITE_TRADER_HOST;

if (!WHITEBIT_WSS_HOST || !API_HOST) {
  console.error("Ошибка: Отсутствуют обязательные переменные окружения в .env");
  process.exit(1);
}

let accounts = [];

async function getWsToken(accountId) {
  try {
    const response = await axios.get(`${API_HOST}/api/accounts/${accountId}/getWsToken`);
    const token = response.data.token;
    console.log(`Токен для аккаунта ${accountId}:`, token);
    return token;
  } catch (error) {
    console.error(`Ошибка при получении WS токена для аккаунта ${accountId}:`, error.message);
    throw error; // Обработка ошибки
  }
}

function startTracking(account) {
  const connect = async () => {
    try {
      const token = await getWsToken(account.account_id); // Получаем токен
      account.token = token; // Сохраняем токен в аккаунт

      const ws = new WebSocket(WHITEBIT_WSS_HOST);

      ws.on("open", () => {
        console.log(`[Аккаунт ${account.account_id}] Подключено к WebSocket`);

        // Отправляем сообщение авторизации
        ws.send(
          JSON.stringify({
            id: 0,
            method: "authorize",
            params: [account.token, "public"], // Используем токен для авторизации
          })
        );

        // Обработка сообщений WebSocket после авторизации
        handleWebSocketMessages(ws, account);
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data);
        console.log(`[Аккаунт ${account.account_id}] Получено сообщение WebSocket:`, message);

        // Проверяем ответ на авторизацию
        if (message.method === "authorize" && message.error) {
          console.error(`[Аккаунт ${account.account_id}] Ошибка авторизации:`, message.error.message);
          return;
        }

        // Подписка на события после успешной авторизации
        if (!message.error) {
          subscribeToEvents(ws, account.markets);
          const uniqueAssets = [...new Set(account.markets.flatMap(m => m.split("_")))]; 
          subscribeToBalance(ws, uniqueAssets);
        }
      });

      ws.on("error", (error) => {
        console.error(`[Аккаунт ${account.account_id}] Ошибка WebSocket:`, error.message);
        ws.close();
      });

      ws.on("close", () => {
        console.log(`[Аккаунт ${account.account_id}] Соединение WebSocket закрыто.`);
      });
    } catch (error) {
      console.error(`[Аккаунт ${account.account_id}] Не удалось подключиться к WebSocket:`, error.message);
    }
  };

  connect();
}

function subscribeToEvents(ws, markets) {
  const subscribeMessage = {
    id: 12,
    method: "ordersExecuted_subscribe",
    params: [markets, 0],
  };
  ws.send(JSON.stringify(subscribeMessage));
  console.log(`Отправлено сообщение подписки на события для рынков: ${markets}`);
}

function subscribeToBalance(ws, assets) {
  const subscribeMessage = {
    id: 3,
    method: "balanceSpot_subscribe",
    params: assets,
  };
  ws.send(JSON.stringify(subscribeMessage));
  console.log(`Отправлено сообщение подписки на баланс для активов: ${assets}`);
}

function handleWebSocketMessages(ws, account) {
  ws.on("message", (data) => {
    const message = JSON.parse(data);
    console.log(
      `[Аккаунт ${account.account_id}] Получено сообщение WebSocket:`,
      message
    );

    if (message.method === "ordersExecuted_update") {
      console.log(
        `[Аккаунт ${account.account_id}] Событие выполненных заказов:`,
        message.params
      );
      sendPayload(account.account_id, message.params).catch((err) =>
        console.error(
          `[Аккаунт ${account.account_id}] Ошибка при отправке payload:`,
          err
        )
      );
    } else if (message.method === "balanceSpot_update") {
      console.log(
        `[Аккаунт ${account.account_id}] Обновление баланса:`,
        message.params
      );
      sendPayload(account.account_id, message.params).catch((err) =>
        console.error(
          `[Аккаунт ${account.account_id}] Ошибка при отправке payload:`,
          err
        )
      );
    }
  });

  ws.on("error", (error) => {
    console.error(
      `[Аккаунт ${account.account_id}] Ошибка WebSocket:`,
      error.message
    );
    ws.close();
  });

  ws.on("close", () => {
    console.log(`[Аккаунт ${account.account_id}] Соединение WebSocket закрыто.`);
  });
}

async function sendPayload(accountId, params) {
  try {
    await axios.post(`${API_HOST}/api/accounts/${accountId}/wsPayload`, params);
    console.log(`[Аккаунт ${accountId}] Payload успешно отправлен.`);
  } catch (error) {
    console.error(
      `[Аккаунт ${accountId}] Ошибка при отправке payload:`,
      error.message
    );
  }
}

async function startTracking(account) {
  const connect = async () => {
    try {
      const token = await getWsToken(account.account_id);
      account.token = token; // Сохраняем токен в аккаунт

      const ws = new WebSocket(WHITEBIT_WSS_HOST);

      ws.on("open", () => {
        console.log(`[Аккаунт ${account.account_id}] Подключено к WebSocket`);

        // Отправляем токен для авторизации
        ws.send(
          JSON.stringify({
            id: 0,
            method: "authorize",
            params: [account.token, "public"], // Токен передается здесь
          })
        );

        // Подписка на события
        subscribeToEvents(ws, account.markets);

        // Подписка на баланс
        const assets = account.markets.flatMap((market) => market.split("_"));
        const uniqueAssets = [...new Set(assets)];
        subscribeToBalance(ws, uniqueAssets);

        // Пинг для поддержания соединения
        const pingMessage = JSON.stringify({
          id: 1,
          method: "ping",
          params: [],
        });
        setInterval(() => {
          ws.send(pingMessage);
          console.log(`[Аккаунт ${account.account_id}] Отправлен ping`);
        }, 25000);
      });

      handleWebSocketMessages(ws, account);
    } catch (error) {
      console.error(
        `[Аккаунт ${account.account_id}] Не удалось подключиться к WebSocket:`,
        error.message
      );
    }
  };

  connect();
}

// Функция для добавления нового актива вручную через API
app.post("/addMarket/:accountId", (req, res) => {
  const { accountId } = req.params;
  const { market } = req.body;

  const account = accounts.find((acc) => acc.account_id == accountId);

  if (!account) {
    return res.status(404).json({ error: `Аккаунт с id ${accountId} не найден` });
  }

  // Проверяем, если рынок уже существует
  if (!account.markets.includes(market)) {
    account.markets.push(market); // Добавляем новый рынок
    console.log(`Добавлен рынок ${market} для аккаунта ${accountId}`);

    // Подключаемся к WebSocket и подписываемся на новый рынок
    if (account.ws) {
      const uniqueAssets = [...new Set(account.markets.flatMap(m => m.split("_")))]; // Извлекаем уникальные активы
      subscribeToEvents(account.ws, account.markets); // Подписываемся на события
      subscribeToBalance(account.ws, uniqueAssets); // Подписываемся на баланс
    }
  }

  return res.json({ success: `Рынок ${market} добавлен для аккаунта ${accountId}` });
});

// Функция для удаления активов через API
app.post("/removeMarket/:accountId", (req, res) => {
  const { accountId } = req.params;
  const { market } = req.body;

  const account = accounts.find((acc) => acc.account_id == accountId);

  if (!account) {
    return res.status(404).json({ error: `Аккаунт с id ${accountId} не найден` });
  }

  const marketIndex = account.markets.indexOf(market);
  if (marketIndex !== -1) {
    account.markets.splice(marketIndex, 1); // Убираем рынок
    console.log(`Рынок ${market} удален для аккаунта ${accountId}`);
  }

  if (account.markets.length === 0 && account.ws) {
    account.ws.close(); // Закрываем WebSocket, если больше нет рынков для отслеживания
    account.ws = null;
    console.log(`[Аккаунт ${accountId}] Остановлено отслеживание всех рынков`);
  }

  return res.json({ success: `Рынок ${market} удален для аккаунта ${accountId}` });
});

// Эндпоинт для начала отслеживания
app.get("/start/:accountId/:market", async (req, res) => {
  const { accountId, market } = req.params;

  // Проверяем, существует ли аккаунт
  let account = accounts.find(acc => acc.account_id == accountId);

  // Если аккаунта нет, создаем новый
  if (!account) {
    account = { account_id: parseInt(accountId), token: null, markets: [] };
    accounts.push(account);
    console.log(`Добавлен новый аккаунт с id ${accountId}`);
  }

  // Если токен отсутствует, получаем его
  if (!account.token) {
    try {
      // Получаем токен для этого аккаунта
      account.token = await getWsToken(account.account_id); 
      console.log(`Токен для аккаунта ${accountId}: ${account.token}`);
    } catch (error) {
      console.error(`Не удалось получить токен для аккаунта ${accountId}:`, error.message);
      return res.status(500).json({ error: 'Не удалось получить токен для WebSocket.' });
    }
  }

  // Добавляем рынок, если его еще нет
  if (!account.markets.includes(market)) {
    account.markets.push(market);
    console.log(`Добавлен рынок ${market} для аккаунта ${accountId}`);

    // Если WebSocket еще не подключен, подключаемся
    if (!account.ws) {
      try {
        // Подключаемся к WebSocket с токеном
        await startTracking(account); // Подключение с использованием токена
      } catch (error) {
        console.error(`Ошибка при запуске отслеживания для аккаунта ${accountId}:`, error.message);
        return res.status(500).json({ error: 'Не удалось запустить отслеживание.' });
      }
    } else {
      // Подписываемся на новый рынок
      subscribeToEvents(account.ws, account.markets);
      const uniqueAssets = [...new Set(account.markets.flatMap(m => m.split("_")))]; // Извлекаем уникальные активы
      subscribeToBalance(account.ws, uniqueAssets); // Подписываемся на баланс
    }
  }

  return res.json({ success: `Начато отслеживание для аккаунта ${accountId} и рынка ${market}` });
});

// Эндпоинт для остановки отслеживания
app.get("/stop/:accountId/:market", (req, res) => {
  const { accountId, market } = req.params;
  
  const account = accounts.find(acc => acc.account_id == accountId);

  if (!account) {
    return res.status(404).json({ error: `Аккаунт с id ${accountId} не найден` });
  }

  const marketIndex = account.markets.indexOf(market);
  
  if (marketIndex !== -1) {
    // Убираем рынок
    account.markets.splice(marketIndex, 1);
    console.log(`Рынок ${market} удален для аккаунта ${accountId}`);

    // Отправляем сообщение об отписке от событий
    if (account.ws) {
      const unsubscribeMessage = {
        id: 13,
        method: "ordersExecuted_unsubscribe",
        params: [], // Указываем рынок, от которого отписываемся
      };
      account.ws.send(JSON.stringify(unsubscribeMessage));
      console.log(`Отправлено сообщение отписки для рынка ${market} аккаунта ${accountId}`);
    }
  }

  // Если больше нет рынков
  if (account.markets.length === 0 && account.ws) {
    account.ws.close(); // Закрываем соединение
    account.ws = null;
    console.log(`[Аккаунт ${accountId}] Остановлено отслеживание всех рынков`);
  }

  return res.json({ success: `Рынок ${market} остановлен для аккаунта ${accountId}` });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
