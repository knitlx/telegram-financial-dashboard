from aiogram import Router, F
from aiogram.types import Message
from aiogram.utils.chat_action import ChatActionSender
from agent import run_agent
from tools.settings import get_user_settings, get_user_categories
import memory
import logging
from telegram_reply import send_agent_reply

router = Router()
logger = logging.getLogger(__name__)


@router.message(F.text)
async def handle_text(message: Message) -> None:
    user_id = message.from_user.id
    text = message.text.strip()

    try:
        settings = await get_user_settings(user_id)
        categories = await get_user_categories(user_id)
        history = memory.get_history(user_id)

        memory.append(user_id, "user", text)

        async with ChatActionSender.typing(bot=message.bot, chat_id=message.chat.id):
            reply = await run_agent(
                user_id=user_id,
                text=text,
                user_timezone=settings.get("user_timezone", "UTC"),
                default_currency=settings.get("default_currency"),
                user_categories=categories,
                history=history,
            )

        memory.append(user_id, "assistant", reply)
        await send_agent_reply(message, reply)
    except Exception as e:
        logger.exception("Text handler failed for user %s: %s", user_id, e)
        await message.answer("Сейчас не получилось обработать запрос. Попробуй ещё раз через пару секунд.")
