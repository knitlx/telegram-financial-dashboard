import logging
import os
from typing import Any, Awaitable, Callable
from aiogram import BaseMiddleware
from aiogram.types import Message, TelegramObject, InlineKeyboardMarkup, InlineKeyboardButton

logger = logging.getLogger(__name__)


class SubscriptionMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        if not isinstance(event, Message):
            return await handler(event, data)

        channel_id = os.environ.get("REQUIRED_CHANNEL_ID", "")
        if not channel_id:
            return await handler(event, data)

        bot = data["bot"]
        user_id = event.from_user.id

        is_subscribed = False
        try:
            member = await bot.get_chat_member(chat_id=int(channel_id), user_id=user_id)
            is_subscribed = member.status in ("creator", "administrator", "member")
        except Exception as e:
            logger.warning("Subscription check failed for user %s: %s", user_id, e)

        if is_subscribed:
            return await handler(event, data)

        channel_url = os.environ.get("REQUIRED_CHANNEL_URL", "https://t.me/nochaos_with_ai")
        bot_check_url = os.environ.get("BOT_CHECK_URL", "https://t.me/Knitlx_helper_bot?start=check")
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Подписаться", url=channel_url)],
            [InlineKeyboardButton(text="✅ Я подписался — проверить", url=bot_check_url)],
        ])
        await event.answer("Чтобы пользоваться ботом, подпишись на канал", reply_markup=kb)
