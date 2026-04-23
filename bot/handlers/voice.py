import os
import io
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


async def _transcribe(bot, file_id: str) -> str:
    file = await bot.get_file(file_id)
    buf = io.BytesIO()
    await bot.download_file(file.file_path, buf)
    buf.name = "audio.ogg"
    buf.seek(0)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
            data={"model": "whisper-large-v3"},
            files={"file": ("audio.ogg", buf, "audio/ogg")},
        )
        resp.raise_for_status()
        return resp.json().get("text", "")


@router.message(F.voice)
async def handle_voice(message: Message) -> None:
    user_id = message.from_user.id

    try:
        transcribed = await _transcribe(message.bot, message.voice.file_id)
        if not transcribed:
            await message.answer("Не удалось распознать голосовое сообщение.")
            return

        settings = await get_user_settings(user_id)
        categories = await get_user_categories(user_id)
        history = memory.get_history(user_id)

        memory.append(user_id, "user", transcribed)

        async with ChatActionSender.typing(bot=message.bot, chat_id=message.chat.id):
            reply = await run_agent(
                user_id=user_id,
                text=transcribed,
                user_timezone=settings.get("user_timezone", "UTC"),
                default_currency=settings.get("default_currency"),
                user_categories=categories,
                history=history,
            )

        memory.append(user_id, "assistant", reply)
        await send_agent_reply(message, reply)
    except Exception as e:
        logger.exception("Voice handler failed for user %s: %s", user_id, e)
        await message.answer("Не получилось обработать голосовое сообщение. Попробуй ещё раз или отправь текстом.")
