from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import Message
from tools.settings import seed_categories

router = Router()

START_TEXT = (
    "*Привет! 👋*\n"
    "Я — твой личный _финансовый помощник_.\n"
    "Помогаю быстро записывать траты и доходы, смотреть отчёты и держать под контролем расходы. "
    "Можно говорить голосом — я всё распознаю и занесу автоматически.\n\n"
    "*Что я умею:*\n"
    "• _Записываю покупки и поступления денег_\n"
    "• _Показываю отчёты_\n"
    "• _Учитываю валюты и твой часовой пояс_\n"
    "• _Фиксирую обмены валюты и считаю потери на курсе_\n\n"
    "🌍 Чтобы всё считалось верно, *напиши*, где ты сейчас:\n"
    "\"я в Москве\", \"живу в Бангкоке\", \"часовой пояс — +7\"\n"
    "И какую валюту по умолчанию установить?\n\n"
    "*Попробуй прямо сейчас:*\n"
    "\"заплатил за кофе 250₽\" ☕️ или \"показать расходы за неделю\" 📊\n"
    "\"поменял 20000 руб на 6500 бат\" 💱"
)


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    user_id = message.from_user.id
    await seed_categories(user_id)
    await message.answer(START_TEXT, parse_mode="Markdown")
