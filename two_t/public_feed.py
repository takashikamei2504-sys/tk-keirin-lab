"""Read public race fixtures without loading model dependencies."""
import json
import re
from urllib.request import urlopen

from .source import BASE, query, state


def feed_url(day):
    return f"https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/{day}.json"


def day_feed(day):
    url = feed_url(day)
    with urlopen(url, timeout=15) as response:
        body = response.read(8_000_001)
    if len(body) > 8_000_000:
        raise ValueError("feed too large")
    feed = json.loads(body)
    if feed.get("date") != day:
        raise ValueError("day feed mismatch")
    return feed


def links(html):
    venues = {v["id"]: v["name"] for v in query(state(html), "FETCH_KEIRIN_VENUE_LIST")["venues"]}
    result = {}
    for src in set(re.findall(r'href="(/keirin/[^/"]+/racecard/\d{10}/\d+/\d+)"', html)):
        _, meet, _, race = src.split("/")[-4:]
        key = (venues.get(meet[-2:]), int(race))
        result.setdefault(key, []).append(BASE + src)
    return {key: paths[0] for key, paths in result.items() if len(paths) == 1}
