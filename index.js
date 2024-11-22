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

let accounts = [
  { account_id: 1, token: null, markets: ["USDC_USDT", "BTC_USDT"] },
  { account_id: 2, token: null, markets: ["BTC_USDT"] },
  { account_id: 3, token: null, markets: ["ETH_USDT", "USDT_BTC"] },
];

async function getWsToken(accountId) {
  try {
    const response = await axios.get(
      `${API_HOST}/api/accounts/${accountId}/getWsToken`
    );
    const token = response.data.token;
    console.log(`Токен для аккаунта ${accountId}:`, token);
    return token;
  } catch (error) {
    console.error(
      `Ошибка при получении WS токена для аккаунта ${accountId}:`,
      error.message
    );
    throw error;
  }
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

function startTracking(account) {
  const connect = async () => {
    try {
      const token = await getWsToken(account.account_id);
      account.token = token; // Сохраняем токен в аккаунт

      const ws = new WebSocket(WHITEBIT_WSS_HOST);

      ws.on("open", () => {
        console.log(`[Аккаунт ${account.account_id}] Подключено к WebSocket`);

        ws.send(
          JSON.stringify({
            id: 0,
            method: "authorize",
            params: [account.token, "public"],
          })
        );

        // Подписка на события
        subscribeToEvents(ws, account.markets);

        // Подписка на баланс
        const assets = account.markets.flatMap((market) => market.split("_"));
        const uniqueAssets = [...new Set(assets)];
        subscribeToBalance(ws, uniqueAssets);

        // Отправляем пинг каждые 25 секунд для поддержания соединения
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

  // Добавляем рынок, если его еще нет
  if (!account.markets.includes(market)) {
    account.markets.push(market);
    console.log(`Добавлен рынок ${market} для аккаунта ${accountId}`);

    // Если WebSocket еще не подключен, подключаемся
    if (!account.ws) {
      await startTracking(account); // Подключаемся к WebSocket
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

    // Отправляем сообщение отписки от событий
    if (account.ws) {
      const unsubscribeMessage = {
        id: 12,
        method: "ordersExecuted_unsubscribe", // Метод для отписки
        params: [[market]], // Указываем рынок, от которого отписываемся
      };
      account.ws.send(JSON.stringify(unsubscribeMessage));
      console.log(`Отправлено сообщение отписки для рынка ${market} аккаунта ${accountId}`);
    }

    // Если больше нет рынков
    if (account.markets.length === 0 && account.ws) {
      account.ws.close(); // Закрываем соединение
      account.ws = null;
      console.log(`Соединение закрыто для аккаунта ${accountId}`);
    }
  }

  return res.json({ success: `Рынок ${market} остановлен для аккаунта ${accountId}` });
});
// Запуск сервера API
const port = 3000;

app.use(express.json());

app.listen(port, () => {
  console.log(`Сервер работает на http://localhost:${port}`);
});

// Запускаем отслеживание для всех аккаунтов
accounts.forEach((account) => startTracking(account));

