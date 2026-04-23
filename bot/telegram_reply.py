import re
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import Message


_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.*)$", re.MULTILINE)
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_UNDER_BOLD_RE = re.compile(r"__(.+?)__")
_BULLET_RE = re.compile(r"^\s*-\s+", re.MULTILINE)
_CODE_FENCE_RE = re.compile(r"```+")


def _to_telegram_markdown(text: str) -> str:
    normalized = text.strip()
    if not normalized:
        return normalized

    # Telegram Markdown does not support Markdown headings.
    normalized = _HEADING_RE.sub(lambda m: f"*{m.group(1).strip()}*", normalized)
    # Convert common GFM bold markers to Telegram-compatible bold.
    normalized = _BOLD_RE.sub(r"*\1*", normalized)
    normalized = _UNDER_BOLD_RE.sub(r"*\1*", normalized)
    # Replace markdown bullets with neutral bullets.
    normalized = _BULLET_RE.sub("• ", normalized)
    # Code fences are frequently rendered as plain syntax in Telegram Markdown.
    normalized = _CODE_FENCE_RE.sub("", normalized)

    return normalized


def _strip_markdown(text: str) -> str:
    plain = text
    plain = re.sub(r"^\s{0,3}#{1,6}\s*", "", plain, flags=re.MULTILINE)
    plain = plain.replace("**", "").replace("__", "").replace("`", "")
    plain = re.sub(r"\[(.*?)\]\((.*?)\)", r"\1 (\2)", plain)
    plain = _BULLET_RE.sub("• ", plain)
    return plain.strip()


async def send_agent_reply(message: Message, reply: str) -> None:
    tg_markdown = _to_telegram_markdown(reply)
    try:
        await message.answer(tg_markdown, parse_mode="Markdown")
    except TelegramBadRequest:
        await message.answer(_strip_markdown(reply))
