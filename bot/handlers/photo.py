import os
import io
import base64
import httpx
import logging
from aiogram import Router, F
from aiogram.types import Message
from aiogram.utils.chat_action import ChatActionSender
from agent import run_agent
from tools.settings import get_user_settings, get_user_categories
import memory
from telegram_reply import send_agent_reply

router = Router()
logger = logging.getLogger(__name__)

ANALYZE_PROMPT = "Определи покупку или товар на изображении. Верни краткое описание покупки."


async def _analyze_image(bot, file_id: str) -> str:
    file = await bot.get_file(file_id)
    buf = io.BytesIO()
    await bot.download_file(file.file_path, buf)
    b64 = base64.b64encode(buf.getvalue()).decode()

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
                "Content-Type": "application/json",
            },
            json={
                "model": "openai/gpt-4o-mini",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": ANALYZE_PROMPT},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                        ],
                    }
                ],
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


@router.message(F.photo)
async def handle_photo(message: Message) -> None:
    user_id = message.from_user.id

    try:
        vision_text = await _analyze_image(message.bot, message.photo[-1].file_id)

        caption = (message.caption or "").strip()
        if caption:
            combined = f"{caption}\n\n[Фото]: {vision_text}"
        else:
            combined = vision_text

        settings = await get_user_settings(user_id)
        categories = await get_user_categories(user_id)
        history = memory.get_history(user_id)

        memory.append(user_id, "user", combined)

        async with ChatActionSender.typing(bot=message.bot, chat_id=message.chat.id):
            reply = await run_agent(
                user_id=user_id,
                text=combined,
                user_timezone=settings.get("user_timezone", "UTC"),
                default_currency=settings.get("default_currency"),
                user_categories=categories,
                history=history,
            )

        memory.append(user_id, "assistant", reply)
        await send_agent_reply(message, reply)
    except Exception as e:
        logger.exception("Photo handler failed for user %s: %s", user_id, e)
        await message.answer("Не получилось обработать фото. Попробуй ещё раз или отправь текстом.")
