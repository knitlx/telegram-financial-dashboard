"""
Автотест агента. Запуск:
    cd bot && python test_agent.py
    cd bot && python test_agent.py --mode regression
    cd bot && python test_agent.py --mode full

Использует тестовый user_id=9999999, все данные удаляются в конце.
"""
import argparse
import asyncio
import json
import os
import sys
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

from agent import run_agent, _dispatch_tool, _build_system_prompt
from db import fetch, execute, get_pool
from tools.settings import get_user_settings, get_user_categories

TEST_USER_ID = 9999999
VERBOSE = os.environ.get("VERBOSE_TEST", "0") == "1"

PASS = "✅"
FAIL = "❌"
WARN = "⚠️ "


class Results:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.log = []

    def ok(self, name, detail=""):
        self.passed += 1
        msg = f"  {PASS} {name}" + (f" — {detail}" if detail else "")
        self.log.append(msg)
        print(msg)

    def fail(self, name, detail=""):
        self.failed += 1
        msg = f"  {FAIL} {name}" + (f" — {detail}" if detail else "")
        self.log.append(msg)
        print(msg)

    def warn(self, name, detail=""):
        msg = f"  {WARN}{name}" + (f" — {detail}" if detail else "")
        self.log.append(msg)
        print(msg)

    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'─'*50}")
        print(f"Итог: {self.passed}/{total} тестов прошли")
        if self.failed:
            print(f"Провалились: {self.failed}")


r = Results()

# Загружаются один раз перед тестами
_settings: dict = {}
_categories: dict = {}


def _normalize_categories(raw: object) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


async def call(text: str, history: list = None) -> tuple[str, list]:
    h = history or []
    print(f"  ➤ {text}")
    timeout_sec = int(os.environ.get("TEST_AGENT_TIMEOUT_SEC", "60"))
    reply = await asyncio.wait_for(
        run_agent(
            user_id=TEST_USER_ID,
            text=text,
            user_timezone=_settings.get("user_timezone", "UTC"),
            default_currency=_settings.get("default_currency"),
            user_categories=_categories,
            history=h,
        ),
        timeout=timeout_sec,
    )
    h = h + [{"role": "user", "content": text}, {"role": "assistant", "content": reply}]
    return reply, h


async def tool_call_json(name: str, args: dict) -> Optional[object]:
    result = await _dispatch_tool(name, dict(args), TEST_USER_ID)
    try:
        return json.loads(result)
    except Exception:
        r.fail(f"{name}: невалидный JSON", result[:120])
        return None


async def db_count(table: str, where: str = "", *args) -> int:
    q = f"SELECT COUNT(*) as n FROM {table} WHERE user_id=$1" + (f" AND {where}" if where else "")
    rows = await fetch(q, TEST_USER_ID, *args)
    return rows[0]["n"] if rows else 0


async def db_fetch_last(
    table: str,
    order: str = "created_at DESC",
    where: str = "",
    *args,
) -> Optional[dict]:
    q = f"SELECT * FROM {table} WHERE user_id=$1"
    if where:
        q += f" AND {where}"
    q += f" ORDER BY {order} LIMIT 1"
    rows = await fetch(q, TEST_USER_ID, *args)
    return rows[0] if rows else None


async def cleanup():
    await execute("DELETE FROM public.transactions WHERE user_id=$1", TEST_USER_ID)
    await execute("DELETE FROM public.fx_exchanges WHERE user_id=$1", TEST_USER_ID)
    await execute("DELETE FROM public.user_categories WHERE user_id=$1 AND is_default=false", TEST_USER_ID)
    await execute("DELETE FROM public.user_settings WHERE user_id=$1", TEST_USER_ID)
    print(f"🧹 Тестовые данные удалены (user_id={TEST_USER_ID})")


async def ensure_test_categories():
    # Фиксируем минимальный набор категорий, чтобы тесты не зависели от seed_default_categories в БД.
    base = [
        ("Еда", "expense"),
        ("Прочее", "expense"),
        ("Транспорт", "expense"),
        ("Развлечения", "expense"),
        ("Зарплата", "income"),
    ]
    for name, kind in base:
        await execute(
            """
            INSERT INTO public.user_categories (user_id, name, kind, is_default, is_active)
            VALUES ($1::bigint, $2, $3::tx_kind, false, true)
            ON CONFLICT (user_id, name, kind) DO UPDATE SET is_active = true
            """,
            TEST_USER_ID,
            name,
            kind,
        )


# ─── ТЕСТЫ ────────────────────────────────────────────────────────────────────

async def test_add_expense_simple():
    print("\n📋 Добавление расхода (простое)")
    reply, _ = await call("потратил 350 бат на еду")
    tx = await db_fetch_last("public.transactions")
    if tx and float(tx["amount"]) == 350 and tx["currency"] == "THB" and tx["kind"] == "expense":
        r.ok("add_transaction вызван", f"amount={tx['amount']} currency={tx['currency']}")
    else:
        r.fail("add_transaction", f"tx={tx}, reply={reply[:80]}")
    if tx and tx["category"].lower() in ["еда", "food"]:
        r.ok("категория определена правильно", tx["category"])
    else:
        r.fail("категория", f"got={tx['category'] if tx else 'None'}")
    print(f"  🤖 {reply[:120]}")


async def test_add_income():
    print("\n📋 Добавление дохода")
    reply, _ = await call("получил зарплату 50000 рублей")
    tx = await db_fetch_last("public.transactions")
    if tx and float(tx["amount"]) == 50000 and tx["currency"] == "RUB" and tx["kind"] == "income":
        r.ok("income добавлен", f"amount={tx['amount']} {tx['currency']}")
    else:
        r.fail("income", f"tx={tx}, reply={reply[:80]}")
    print(f"  🤖 {reply[:120]}")


async def test_currency_recognition():
    print("\n📋 Распознавание валют")
    cases = [
        ("потратил 100$ на прочее", "USD", 100),
        ("потратил 200₽ на транспорт", "RUB", 200),
        ("потратил 500 бат на прочее", "THB", 500),
    ]
    for text, expected_cur, expected_amount in cases:
        before_rows = await fetch(
            "SELECT id FROM public.transactions WHERE user_id=$1", TEST_USER_ID
        )
        before_ids = {row["id"] for row in before_rows}
        reply, _ = await call(text)
        after_rows = await fetch(
            "SELECT * FROM public.transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5",
            TEST_USER_ID,
        )
        new_txs = [row for row in after_rows if row["id"] not in before_ids]
        if new_txs:
            tx = new_txs[0]
            if VERBOSE:
                print(f"    DB: amount={tx['amount']} currency={tx['currency']} category={tx['category']}")
            if tx["currency"] == expected_cur:
                r.ok(f"'{text}' → {expected_cur}")
            else:
                r.fail(f"'{text}' → ожидали {expected_cur}", f"got={tx['currency']}")
        else:
            r.fail(f"'{text}' → транзакция не добавлена", f"reply={reply[:80]}")


async def test_ambiguous_message():
    print("\n📋 Неоднозначное сообщение (нет суммы)")
    reply, _ = await call("я что-то купил")
    if "?" in reply or any(w in reply.lower() for w in ["сколько", "сумм", "уточн", "какой"]):
        r.ok("бот уточняет при неясном запросе")
    else:
        r.fail("бот не уточняет", f"reply={reply[:100]}")
    print(f"  🤖 {reply[:120]}")


async def test_get_transactions():
    print("\n📋 Получение транзакций")
    reply, _ = await call("покажи мои расходы за сегодня")
    if any(w in reply.lower() for w in ["расход", "потратил", "трат", "бат", "rub", "thb", "нет", "0"]):
        r.ok("get_transactions вызван, ответ содержит данные")
    else:
        r.fail("get_transactions", f"reply={reply[:100]}")
    print(f"  🤖 {reply[:120]}")


async def test_update_transaction():
    print("\n📋 Редактирование транзакции")
    created = await tool_call_json(
        "add_transaction",
        {"category": "Прочее", "title": "Прочее", "amount": 100, "currency": "THB", "kind": "expense"},
    )
    if not isinstance(created, dict) or not created.get("id"):
        r.fail("подготовка транзакции", f"got={created}")
        return

    tx = await db_fetch_last("public.transactions")
    if not tx:
        r.fail("нет транзакции для теста")
        return

    reply, _ = await call(f"исправь последнюю трату, там было 150 бат")
    tx_after = await db_fetch_last("public.transactions", "created_at DESC", "id=$2", tx["id"])
    if tx_after and float(tx_after["amount"]) == 150:
        r.ok("update_transaction сработал", f"150 THB")
    else:
        # Иногда бот ищет сам через get_transactions + update
        rows = await fetch(
            "SELECT * FROM public.transactions WHERE user_id=$1 AND amount=150 ORDER BY created_at DESC LIMIT 1",
            TEST_USER_ID,
        )
        if rows:
            r.ok("update_transaction сработал (через поиск)", "150 THB")
        else:
            r.fail("update_transaction", f"reply={reply[:100]}")
    print(f"  🤖 {reply[:120]}")


async def test_delete_transaction():
    print("\n📋 Удаление транзакции")
    await call("потратил 77 бат на развлечения")
    count_before = await db_count("public.transactions")
    reply, _ = await call("удали последнюю трату")
    count_after = await db_count("public.transactions")
    if count_after < count_before:
        r.ok("delete_transaction сработал")
    else:
        r.fail("delete_transaction", f"count before={count_before} after={count_after}, reply={reply[:80]}")
    print(f"  🤖 {reply[:120]}")


async def test_add_category():
    print("\n📋 Добавление категории")
    reply, _ = await call("добавь категорию расходов 'Здоровье'")
    rows = await fetch(
        "SELECT * FROM public.user_categories WHERE user_id=$1 AND name ILIKE 'здоровье'",
        TEST_USER_ID,
    )
    if rows:
        r.ok("add_category сработал", rows[0]["name"])
    else:
        r.fail("add_category", f"reply={reply[:100]}")
    print(f"  🤖 {reply[:120]}")


async def test_fx_exchange():
    print("\n📋 Обмен валюты")
    reply, _ = await call("поменял 10000 рублей на 3800 бат в обменнике")
    rows = await fetch(
        "SELECT * FROM public.fx_exchanges WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        TEST_USER_ID,
    )
    if rows:
        ex = rows[0]
        r.ok("record_exchange сработал", f"{ex['from_amount']} {ex['from_currency']} → {ex['to_amount']} {ex['to_currency']}")
        if ex.get("rate_diff_pct") is not None:
            r.ok("рыночный курс получен, потери посчитаны", f"diff={ex['rate_diff_pct']:.1f}%")
        else:
            r.fail("рыночный курс не определён")
    else:
        r.fail("record_exchange", f"reply={reply[:100]}")
    print(f"  🤖 {reply[:120]}")


async def test_set_timezone():
    print("\n📋 Настройки пользователя")
    reply, _ = await call("мой часовой пояс Asia/Kolkata")
    rows = await fetch("SELECT * FROM public.user_settings WHERE user_id=$1", TEST_USER_ID)
    if rows and rows[0].get("user_timezone") == "Asia/Kolkata":
        r.ok("set_user_settings сработал", "Asia/Kolkata")
    else:
        r.fail("set_user_settings", f"rows={rows}, reply={reply[:80]}")
    print(f"  🤖 {reply[:120]}")


async def test_no_hallucination():
    print("\n📋 Нет галлюцинаций (бот не врёт что записал)")
    # Отправляем нечто что явно не требует tool call
    count_before = await db_count("public.transactions")
    reply, _ = await call("сколько будет 2+2?")
    count_after = await db_count("public.transactions")
    # Проверяем что ничего лишнего не добавилось (проверяем что count не изменился)
    if "4" in reply and count_after == count_before:
        r.ok("бот отвечает на не-финансовые вопросы без добавления в БД", f"count={count_after}")
    else:
        r.fail(
            "проверка на галлюцинации",
            f"reply={reply[:80]}, count_before={count_before}, count_after={count_after}",
        )
    print(f"  🤖 {reply[:120]}")


async def test_dialog_clarify_then_complete():
    print("\n📋 Диалог: уточнение → завершение операции")
    history: list = []
    count_before = await db_count("public.transactions")

    reply_1, history = await call("купил что-то", history)
    count_mid = await db_count("public.transactions")
    asks_details = ("?" in reply_1) or any(w in reply_1.lower() for w in ["сколько", "уточн", "какой", "что именно"])
    if count_mid == count_before and asks_details:
        r.ok("бот запросил уточнение и не записал лишнего", f"count={count_mid}")
    else:
        r.fail("уточнение в диалоге", f"reply={reply_1[:90]}, before={count_before}, mid={count_mid}")

    reply_2, history = await call("потратил 123 бат на еду", history)
    count_after = await db_count("public.transactions")
    tx = await db_fetch_last("public.transactions")
    if count_after == count_before + 1 and tx and float(tx["amount"]) == 123 and tx["currency"] == "THB":
        r.ok("после уточнения транзакция добавлена", f"{tx['amount']} {tx['currency']}")
    else:
        r.fail(
            "завершение диалога",
            f"reply={reply_2[:90]}, before={count_before}, after={count_after}, tx={tx}",
        )
    print(f"  🤖 {reply_1[:80]}")
    print(f"  🤖 {reply_2[:80]}")


async def test_dialog_followup_add_one_more():
    print("\n📋 Диалог: follow-up «а ещё…»")
    history: list = []
    before_rows = await fetch("SELECT id FROM public.transactions WHERE user_id=$1", TEST_USER_ID)
    before_ids = {row["id"] for row in before_rows}

    reply_1, history = await call("потратил 60 бат на еду", history)
    reply_2, history = await call("а еще 40 бат на транспорт", history)

    after_rows = await fetch(
        "SELECT id, amount, currency, category FROM public.transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",
        TEST_USER_ID,
    )
    new_rows = [row for row in after_rows if row["id"] not in before_ids]
    new_amounts_thb = {float(row["amount"]) for row in new_rows if row["currency"] == "THB"}
    if len(new_rows) >= 2 and {60.0, 40.0}.issubset(new_amounts_thb):
        r.ok("follow-up сообщение создало вторую транзакцию", "60 и 40 THB")
    else:
        r.fail(
            "follow-up в диалоге",
            f"new_rows={new_rows[:3]}, reply1={reply_1[:70]}, reply2={reply_2[:70]}",
        )
    print(f"  🤖 {reply_1[:80]}")
    print(f"  🤖 {reply_2[:80]}")


async def test_tools_get_transactions_limit_regression():
    print("\n📋 Регрессия: get_transactions(limit=...)")
    data = await tool_call_json("get_transactions", {"kind": "expense", "limit": 5})
    if isinstance(data, list):
        r.ok("get_transactions принимает limit", f"rows={len(data)}")
    else:
        r.fail("get_transactions(limit)", f"got={data}")


async def test_tools_transactions_crud():
    print("\n📋 Tools: CRUD транзакций")
    created = await tool_call_json(
        "add_transaction",
        {"category": "Прочее", "title": "Тест CRUD", "amount": 88, "currency": "THB", "kind": "expense"},
    )
    tx_id = created.get("id") if isinstance(created, dict) else None
    if tx_id:
        r.ok("tools.add_transaction", f"id={tx_id}")
    else:
        r.fail("tools.add_transaction", f"got={created}")
        return

    listed = await tool_call_json("get_transactions", {"tx_id": tx_id, "limit": 5})
    if isinstance(listed, list) and any(row.get("kind_row") == "detail" for row in listed if isinstance(row, dict)):
        r.ok("tools.get_transactions", f"tx_id={tx_id}")
    else:
        r.fail("tools.get_transactions", f"got={listed}")

    updated = await tool_call_json("update_transaction", {"tx_id": tx_id, "amount": 99})
    if isinstance(updated, dict) and updated.get("id") == tx_id:
        r.ok("tools.update_transaction", "amount=99")
    else:
        r.fail("tools.update_transaction", f"got={updated}")

    deleted = await tool_call_json("delete_transaction", {"tx_id": tx_id})
    if isinstance(deleted, dict) and "DELETE 1" in str(deleted.get("deleted", "")):
        r.ok("tools.delete_transaction")
    else:
        r.fail("tools.delete_transaction", f"got={deleted}")


async def test_tools_categories_management():
    print("\n📋 Tools: управление категориями")
    added = await tool_call_json("add_category", {"name": "ТестКат", "kind": "expense"})
    if isinstance(added, dict) and str(added.get("name", "")).lower() == "тесткат":
        r.ok("tools.add_category")
    else:
        r.fail("tools.add_category", f"got={added}")
        return

    renamed = await tool_call_json(
        "rename_category",
        {"old_name": "ТестКат", "new_name": "ТестКат2", "kind": "expense"},
    )
    if isinstance(renamed, dict) and renamed.get("renamed") is True:
        r.ok("tools.rename_category")
    else:
        r.fail("tools.rename_category", f"got={renamed}")

    deactivated = await tool_call_json("deactivate_category", {"name": "ТестКат2", "kind": "expense"})
    if isinstance(deactivated, dict) and deactivated.get("is_active") is False:
        r.ok("tools.deactivate_category")
    else:
        r.fail("tools.deactivate_category", f"got={deactivated}")


async def test_tools_settings():
    print("\n📋 Tools: настройки пользователя")
    data = await tool_call_json(
        "set_user_settings",
        {"iana_tz": "Asia/Bangkok", "default_currency": "usd"},
    )
    if isinstance(data, dict) and data.get("user_timezone") == "Asia/Bangkok" and data.get("default_currency") == "USD":
        r.ok("tools.set_user_settings", "Asia/Bangkok + USD")
    else:
        r.fail("tools.set_user_settings", f"got={data}")


async def test_tools_fx_and_exchanges():
    print("\n📋 Tools: FX конвертация и история обменов")
    conv = await tool_call_json("fx_convert", {"from_currency": "RUB", "to_currency": "THB", "amount": 1000})
    if isinstance(conv, dict) and conv.get("error"):
        r.warn("tools.fx_convert", f"пропуск из-за внешнего API: {conv.get('error')}")
    elif isinstance(conv, dict) and conv.get("result") is not None:
        r.ok("tools.fx_convert", f"result={conv.get('result')}")
    else:
        r.fail("tools.fx_convert", f"got={conv}")

    rec = await tool_call_json(
        "record_exchange",
        {"from_currency": "RUB", "from_amount": 10000, "to_currency": "THB", "to_amount": 3800, "note": "test"},
    )
    if isinstance(rec, dict) and rec.get("id"):
        r.ok("tools.record_exchange", f"id={rec.get('id')}")
    else:
        r.fail("tools.record_exchange", f"got={rec}")
        return

    exchanges = await tool_call_json("get_exchanges", {"from_currency": "RUB", "to_currency": "THB", "limit": 1})
    if isinstance(exchanges, list) and len(exchanges) <= 1:
        r.ok("tools.get_exchanges", f"rows={len(exchanges)}")
    else:
        r.fail("tools.get_exchanges", f"got={exchanges}")

    stats = await tool_call_json("get_exchange_stats", {"from_currency": "RUB", "to_currency": "THB"})
    if isinstance(stats, list) and stats:
        r.ok("tools.get_exchange_stats", f"rows={len(stats)}")
    else:
        r.fail("tools.get_exchange_stats", f"got={stats}")


def build_test_list(mode: str) -> list:
    # regression: только проблемный агентный тест + полный tool-level набор (быстрый и без лишних токенов)
    base = [
        test_update_transaction,
        test_tools_get_transactions_limit_regression,
        test_tools_transactions_crud,
        test_tools_categories_management,
        test_tools_settings,
        test_tools_fx_and_exchanges,
    ]
    if mode == "regression":
        return base

    # full: добавляет остальные agent-сценарии поверх regression-набора.
    return base + [
        test_add_expense_simple,
        test_add_income,
        test_currency_recognition,
        test_ambiguous_message,
        test_get_transactions,
        test_delete_transaction,
        test_add_category,
        test_fx_exchange,
        test_set_timezone,
        test_no_hallucination,
        test_dialog_clarify_then_complete,
        test_dialog_followup_add_one_more,
    ]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=["regression", "full"],
        default=os.environ.get("TEST_MODE", "regression"),
    )
    args = parser.parse_args()

    os.environ["TEST_LOG"] = "1"

    print("=" * 50)
    print(f"🤖 Тест агента (user_id={TEST_USER_ID})")
    print("=" * 50)

    await cleanup()

    await ensure_test_categories()

    # Загружаем реальные данные из БД — как это делает настоящий бот
    global _settings, _categories
    _settings = await get_user_settings(TEST_USER_ID)
    _categories = _normalize_categories(await get_user_categories(TEST_USER_ID))

    print(f"⚙️  Настройки: tz={_settings.get('user_timezone')} currency={_settings.get('default_currency')}")
    print(f"📂 Категории расходов: {[c['name'] if isinstance(c, dict) else c for c in (_categories.get('expense') or [])]}")
    print(f"📂 Категории доходов:  {[c['name'] if isinstance(c, dict) else c for c in (_categories.get('income') or [])]}")
    print()

    tests = build_test_list(args.mode)
    print(f"🧪 Режим тестирования: {args.mode} ({len(tests)} тестов)")

    for t in tests:
        try:
            await t()
        except Exception as e:
            r.fail(t.__name__, f"EXCEPTION: {e}")

    await cleanup()
    r.summary()

    pool = await get_pool()
    await pool.close()

    sys.exit(0 if r.failed == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
