import json
import os
import re
from typing import Optional
from openai import AsyncOpenAI
from tools.transactions import add_transaction, get_transactions, update_transaction, delete_transaction
from tools.categories import add_category, deactivate_category, rename_category
from tools.settings import set_user_settings
from tools.fx import fx_convert
from tools.transfers import record_exchange, get_exchange_stats, get_exchanges
from tools.balances import set_balance_snapshot, get_balance_snapshots, get_currency_balances

_client: Optional[AsyncOpenAI] = None


_DB_ACTION_HINT_RE = re.compile(
    r"(запиш|добав|внес|потрат|доход|купил|купила|перев[её]л|обмен|удал|измени|исправ|сверк|баланс)",
    re.IGNORECASE,
)


def _looks_like_db_action(text: str) -> bool:
    return bool(_DB_ACTION_HINT_RE.search(text))


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=os.environ["DEEPSEEK_API_KEY"],
            base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        )
    return _client


TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "add_transaction",
            "description": "Добавить трату или доход. Используй когда пользователь сообщает о покупке, платеже или поступлении денег.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Категория из списка категорий пользователя"},
                    "title": {"type": "string", "description": "Краткое описание: что купил/оплатил"},
                    "amount": {"type": "number", "description": "Сумма числом, без знака валюты"},
                    "currency": {"type": "string", "description": "ISO-код валюты: RUB, USD, THB, USDT и т.д. UPPERCASE"},
                    "kind": {"type": "string", "enum": ["expense", "income"], "description": "expense по умолчанию"},
                    "iso_datetime": {"type": "string", "description": "Время в ISO 8601 UTC, если указано"},
                },
                "required": ["category", "title", "amount", "currency"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_transactions",
            "description": "Получить список транзакций с фильтрами и итогами по категориям/валютам.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date_from": {"type": "string", "description": "С даты YYYY-MM-DD"},
                    "date_to": {"type": "string", "description": "По дату YYYY-MM-DD"},
                    "currency": {"type": "string"},
                    "category": {"type": "string"},
                    "kind": {"type": "string", "enum": ["expense", "income", "transfer", ""]},
                    "tx_id": {"type": "string", "description": "UUID конкретной транзакции"},
                    "title": {"type": "string", "description": "Поиск по названию (ILIKE)"},
                    "amount": {"type": "string", "description": "Точная сумма"},
                    "limit": {"type": "integer", "description": "Максимум детальных записей (по умолчанию 50)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_transaction",
            "description": "Изменить поля существующей транзакции по её UUID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tx_id": {"type": "string", "description": "UUID транзакции"},
                    "amount": {"type": "number"},
                    "category": {"type": "string"},
                    "title": {"type": "string"},
                    "currency": {"type": "string"},
                    "iso_datetime": {"type": "string"},
                    "kind": {"type": "string", "enum": ["expense", "income", "transfer"]},
                },
                "required": ["tx_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_transaction",
            "description": "Удалить транзакцию по UUID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tx_id": {"type": "string", "description": "UUID транзакции"},
                },
                "required": ["tx_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_category",
            "description": "Добавить новую категорию трат или доходов.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "kind": {"type": "string", "enum": ["expense", "income"]},
                },
                "required": ["name", "kind"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rename_category",
            "description": "Переименовать существующую категорию.",
            "parameters": {
                "type": "object",
                "properties": {
                    "old_name": {"type": "string"},
                    "new_name": {"type": "string"},
                    "kind": {"type": "string", "enum": ["expense", "income"]},
                },
                "required": ["old_name", "new_name", "kind"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "deactivate_category",
            "description": "Деактивировать (скрыть) категорию.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "kind": {"type": "string", "enum": ["expense", "income"]},
                },
                "required": ["name", "kind"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_user_settings",
            "description": "Установить часовой пояс и/или валюту по умолчанию.",
            "parameters": {
                "type": "object",
                "properties": {
                    "iana_tz": {"type": "string", "description": "IANA timezone, например Asia/Bangkok"},
                    "default_currency": {"type": "string", "description": "ISO-код валюты"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fx_convert",
            "description": "Получить текущий рыночный курс и конвертированную сумму.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_currency": {"type": "string"},
                    "to_currency": {"type": "string"},
                    "amount": {"type": "number", "description": "Сумма для конвертации, по умолчанию 1"},
                },
                "required": ["from_currency", "to_currency"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "record_exchange",
            "description": (
                "Зафиксировать обмен валюты. Используй когда пользователь говорит что поменял/обменял "
                "одну валюту на другую. Автоматически запрашивает текущий рыночный курс и считает потери."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "from_currency": {"type": "string", "description": "Исходная валюта ISO"},
                    "from_amount": {"type": "number", "description": "Сколько отдал"},
                    "to_currency": {"type": "string", "description": "Целевая валюта ISO"},
                    "to_amount": {"type": "number", "description": "Сколько получил"},
                    "iso_datetime": {"type": "string", "description": "Время обмена ISO 8601 UTC, если указано"},
                    "note": {"type": "string", "description": "Примечание, например название обменника"},
                },
                "required": ["from_currency", "from_amount", "to_currency", "to_amount"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_exchange_stats",
            "description": "Статистика по обменам валюты: сколько потеряно на курсе, средний курс vs рыночный.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_currency": {"type": "string"},
                    "to_currency": {"type": "string"},
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_exchanges",
            "description": "Список конкретных обменов валюты с деталями по каждому.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_currency": {"type": "string"},
                    "to_currency": {"type": "string"},
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                    "limit": {"type": "integer", "description": "Максимум записей, по умолчанию 20"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_balance_snapshot",
            "description": "Установить текущий баланс по конкретной валюте (точка сверки/калибровка).",
            "parameters": {
                "type": "object",
                "properties": {
                    "currency": {"type": "string", "description": "ISO-код валюты, например THB, RUB, USD"},
                    "balance_amount": {"type": "number", "description": "Текущий реальный остаток по валюте"},
                    "iso_datetime": {"type": "string", "description": "Время точки сверки в ISO 8601 UTC, если указано"},
                    "note": {"type": "string", "description": "Комментарий к сверке"},
                },
                "required": ["currency", "balance_amount"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_balance_snapshots",
            "description": "История точек сверки баланса по валютам.",
            "parameters": {
                "type": "object",
                "properties": {
                    "currency": {"type": "string"},
                    "limit": {"type": "integer", "description": "Максимум записей, по умолчанию 20"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_currency_balances",
            "description": "Текущие балансы по валютам с учётом точки сверки, операций и обменов после неё.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]


def _build_system_prompt(user_timezone: str, default_currency: Optional[str], user_categories: dict) -> str:
    cats = json.dumps(user_categories, ensure_ascii=False)
    currency_hint = default_currency or "не задана"
    return f"""Ты — финансовый ассистент. Быстро и точно заносишь траты и доходы, показываешь отчёты, редактируешь записи.
Отвечай по-русски, дружелюбно и коротко.

Часовой пояс пользователя: {user_timezone}
Валюта по умолчанию: {currency_hint}
Категории пользователя: {cats}

ПРАВИЛА ВАЛЮТЫ:
- «₽», «руб», «р» → RUB
- «$», «usd» → USD
- «€», «eur» → EUR
- «฿», «бат», «thb» → THB
- «usdt», «юсдт» → USDT
- Если не указана — используй валюту по умолчанию или спроси

ПРАВИЛА КАТЕГОРИЙ:
- Бери только из списка категорий пользователя
- Если ни одна не подходит — спроси, создать ли новую

ПРАВИЛА ОБМЕНА ВАЛЮТЫ:
- Если пользователь говорит "поменял X на Y" — это record_exchange, НЕ add_transaction
- После record_exchange сообщи: сколько получил, курс обмена, рыночный курс, разница в %

ПРАВИЛА СВЕРКИ БАЛАНСА:
- Если пользователь хочет "обнулить/сверить/зафиксировать текущий баланс" по валюте — вызови set_balance_snapshot
- Если просит "покажи текущие балансы по валютам" — вызови get_currency_balances

ОБЯЗАТЕЛЬНО ВЫЗЫВАЙ ИНСТРУМЕНТ:
- Если запрос явно требует действия в БД — вызови нужный tool
- Запрещено писать "добавил/записал" без реального вызова tool

ФОРМАТ ОТВЕТА В TELEGRAM:
- Не используй заголовки вида ###, таблицы и тройные кавычки ```
- Не используй двойные **жирный**; если нужно выделение, используй кратко и простым стилем
- Пиши короткими абзацами и списками, чтобы текст корректно отображался в Telegram
"""


async def _dispatch_tool(name: str, args: dict, user_id: int) -> str:
    if name == "add_transaction":
        return await add_transaction(user_id=user_id, **args)
    if name == "get_transactions":
        return await get_transactions(user_id=user_id, **args)
    if name == "update_transaction":
        tx_id = args.pop("tx_id")
        return await update_transaction(user_id=user_id, tx_id=tx_id, **args)
    if name == "delete_transaction":
        return await delete_transaction(tx_id=args["tx_id"])
    if name == "add_category":
        return await add_category(user_id=user_id, **args)
    if name == "rename_category":
        return await rename_category(user_id=user_id, **args)
    if name == "deactivate_category":
        return await deactivate_category(user_id=user_id, **args)
    if name == "set_user_settings":
        return await set_user_settings(user_id=user_id, **args)
    if name == "fx_convert":
        return await fx_convert(**args)
    if name == "record_exchange":
        return await record_exchange(user_id=user_id, **args)
    if name == "get_exchange_stats":
        return await get_exchange_stats(user_id=user_id, **args)
    if name == "get_exchanges":
        return await get_exchanges(user_id=user_id, **args)
    if name == "set_balance_snapshot":
        return await set_balance_snapshot(user_id=user_id, **args)
    if name == "get_balance_snapshots":
        return await get_balance_snapshots(user_id=user_id, **args)
    if name == "get_currency_balances":
        return await get_currency_balances(user_id=user_id)
    return json.dumps({"error": f"unknown tool: {name}"})


async def run_agent(
    user_id: int,
    text: str,
    user_timezone: str,
    default_currency: Optional[str],
    user_categories: dict,
    history: list[dict],
) -> str:
    client = _get_client()
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

    system = _build_system_prompt(user_timezone, default_currency, user_categories)
    messages: list[dict] = [{"role": "system", "content": system}]
    messages.extend(history)
    messages.append({"role": "user", "content": text})

    log = os.environ.get("TEST_LOG") == "1"
    action_request = _looks_like_db_action(text)
    had_tool_call = False

    for _ in range(6):
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )
        msg = response.choices[0].message
        messages.append(msg.model_dump(exclude_unset=True))

        if not msg.tool_calls:
            if action_request and not had_tool_call:
                # Hard safety: never "confirm write" when no DB tool was called.
                messages.append({
                    "role": "system",
                    "content": (
                        "Похоже пользователь просит действие в БД, но ты не вызвал ни одного инструмента. "
                        "Сделай корректный tool call. Если данных не хватает — задай уточняющий вопрос и "
                        "не утверждай, что запись выполнена."
                    ),
                })
                continue
            return msg.content or ""

        had_tool_call = True
        for tc in msg.tool_calls:
            args = json.loads(tc.function.arguments)
            if log:
                print(f"  \U0001f527 {tc.function.name}({json.dumps(args, ensure_ascii=False)})")
            result = await _dispatch_tool(tc.function.name, args, user_id)
            if log:
                try:
                    parsed = json.loads(result)
                    short = json.dumps(parsed, ensure_ascii=False)[:120]
                except Exception:
                    short = result[:120]
                print(f"  \u2514\u2500 {short}")
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })

    if action_request and not had_tool_call:
        return "Не удалось безопасно записать операцию. Повтори формулировку с суммой и валютой."
    return messages[-1].get("content", "Не удалось обработать запрос.")
