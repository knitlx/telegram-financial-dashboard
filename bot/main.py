import asyncio
import logging
import os
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from handlers import start, text, voice, photo
from middleware import SubscriptionMiddleware
from db import get_pool

load_dotenv()
logging.basicConfig(level=logging.INFO)


async def main() -> None:
    await get_pool()

    bot = Bot(
        token=os.environ["BOT_TOKEN"],
        default=DefaultBotProperties(parse_mode=None),
    )
    dp = Dispatcher()

    dp.message.middleware(SubscriptionMiddleware())

    dp.include_router(start.router)
    dp.include_router(photo.router)
    dp.include_router(voice.router)
    dp.include_router(text.router)

    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
