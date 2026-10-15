"""Public categories shared by analytics, comparisons and reports.

Keep the stored diagnosis intact: confirmed bots with human assistance belong
to Bot, while automatic acknowledgements followed by a human remain separate.
"""

BOT_HUMAN_CATEGORIES = frozenset({"hibrido", "hibrido_bot"})


def display_category(category: str | None, is_ai: bool = False) -> str | None:
    if category in BOT_HUMAN_CATEGORIES:
        return "bot"
    if category in ("bot", "menu"):
        return "bot_ia" if is_ai else "bot"
    if category == "hibrido_automatico":
        return "automatico"
    return category


def company_categories(row: dict) -> set[str]:
    """Count a company once per category, including numbers that replied."""
    def category_of(item):
        return display_category(item.get("category"), item.get("is_ai", False)) or "sin_clasificar"

    categories = {category_of(row)}
    categories.update(category_of(number) for number in row.get("numbers") or [] if number.get("hybrid_verdict"))
    return categories
