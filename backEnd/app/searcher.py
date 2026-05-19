# searcher.py
import os
import time

import requests
from dotenv import load_dotenv


load_dotenv()

SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")


def search_prospects(industry: str, city: str, keywords: str = "", num_results: int = 20) -> list:
    """
    Busca URLs de prospectos via Google Search.
    Si SERPAPI_KEY está configurado usa SerpAPI; si no, usa googlesearch-python (sin clave).
    Retorna lista de URLs únicas.
    """
    query = f"{industry} {city} {keywords}".strip()

    if SERPAPI_KEY:
        return _search_via_serpapi(query, num_results)
    else:
        return _search_via_googlesearch(query, num_results)


def _search_via_serpapi(query: str, num_results: int) -> list:
    params = {
        "q": query,
        "api_key": SERPAPI_KEY,
        "num": num_results,
        "hl": "es",
        "gl": "mx",
    }
    resp = requests.get("https://serpapi.com/search", params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    urls = []
    for item in data.get("organic_results", []):
        link = item.get("link")
        if link and link not in urls:
            urls.append(link)
    return urls


def _search_via_googlesearch(query: str, num_results: int) -> list:
    try:
        from googlesearch import search
    except ImportError:
        raise ImportError(
            "Instala 'googlesearch-python' con: pip install googlesearch-python\n"
            "O configura SERPAPI_KEY en tu .env para usar SerpAPI."
        )

    urls = []
    for url in search(query, num_results=num_results, lang="es", pause=2.0):
        if url not in urls:
            urls.append(url)
        time.sleep(0.5)
    return urls
