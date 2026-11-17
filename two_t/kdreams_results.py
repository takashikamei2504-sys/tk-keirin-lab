"""Read public Kdreams result evidence for independent identity review."""
from datetime import date, timedelta
from hashlib import sha256
from html import unescape
import re
import unicodedata
from urllib.request import Request, urlopen

from .source import JST, pairs, stamp


BASE = "https://keirin.kdreams.jp"
DETAIL = re.compile(re.escape(BASE) + r"/[a-z0-9-]+/racedetail/(\d{2})(\d{8})(\d{2})00(\d{2})/\?pageType=showResult")
TABLE = r'<table\b[^>]*class="{}"[^>]*>(.*?)</table>'
RESULT_PENDING = "result pending"
HREF = re.compile(r'''href=["']([^"']+)["']''')


def read_page(url):
    request = Request(url, headers={"User-Agent": "TK-KEIRIN-LAB/1.0 (public race research)"})
    with urlopen(request, timeout=15) as response:
        if response.url != url:
            raise ValueError("unexpected Kdreams result redirect")
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise ValueError("Kdreams page too large")
    return data.decode("utf-8")


def key_for(url):
    match = DETAIL.fullmatch(url)
    if match is None:
        raise ValueError("invalid Kdreams result URL")
    venue_code, first, sequence, race_no = match.groups()
    if not 1 <= int(sequence) <= 6 or not 1 <= int(race_no) <= 12:
        raise ValueError("invalid Kdreams race identifiers")
    day = date.fromisoformat(first[:4] + "-" + first[4:6] + "-" + first[6:]) + timedelta(days=int(sequence) - 1)
    return day.strftime("%Y%m%d") + venue_code + race_no


def links_for(day):
    links = {}
    for url in set(map(unescape, HREF.findall(read_page(BASE + "/raceresult/" + day.replace("-", "/") + "/")))):
        if DETAIL.fullmatch(url):
            key = key_for(url)
            if key.startswith(day.replace("-", "")):
                links.setdefault(key, []).append(url)
    return {key: urls[0] for key, urls in links.items() if len(urls) == 1}


def clean(value):
    value = unescape(re.sub(r"<[^>]*>", "", value))
    return " ".join(unicodedata.normalize("NFKC", value).split())


def name(value):
    return "".join(clean(value).split())


def one(fragment, markup, reason):
    matches = re.findall(fragment, markup, flags=re.S)
    if len(matches) != 1:
        raise ValueError(reason)
    return matches[0]


def parse_result(html, url, card, raw_card):
    start = stamp(card["start"]).astimezone(JST)
    source_id = str(raw_card["race_id"])
    venue = card["venue"]
    if (key_for(url) != source_id or source_id[:8] != start.strftime("%Y%m%d")
            or int(source_id[-2:]) != card["race_no"]):
        raise ValueError("Kdreams result race ID mismatch")
    title = clean(one(r"<title>(.*?)</title>", html, "missing Kdreams title"))
    if (not title.startswith(venue + "競輪 ") or start.strftime("%Y年%m月%d日") not in title
            or not re.search(r"(?<!\d)" + str(card["race_no"]) + r"R(?!\w)", title)):
        raise ValueError("Kdreams result date, venue or race mismatch")
    time = clean(one(r"<dt\b[^>]*>\s*発走予定\s*</dt>\s*<dd\b[^>]*>(.*?)</dd>", html,
                     "missing Kdreams start time"))
    if time != start.strftime("%H:%M"):
        raise ValueError("Kdreams result start time mismatch")
    table = one(TABLE.format("result_table"), html, RESULT_PENDING)
    ranks, roster, backs = {}, {}, []
    statuses = {}
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", table, flags=re.S):
        cells = list(map(clean, re.findall(r"<td\b[^>]*>(.*?)</td>", row, flags=re.S)))
        if not cells:
            continue
        if len(cells) != 9 or not re.fullmatch(r"[1-9]", cells[2]):
            raise ValueError("unknown Kdreams finish row format")
        car = int(cells[2])
        if car in roster or not cells[3]:
            raise ValueError("duplicate or missing Kdreams rider")
        roster[car] = name(cells[3])
        status = cells[1]
        if status.isdecimal() and 1 <= int(status) <= len(card["cars"]):
            ranks.setdefault(int(status), []).append(car)
        else:
            statuses[car] = status
        if re.fullmatch(r"[SB /]*B[SB /]*", cells[7]):
            backs.append(car)
    expected = {int(entry["car_number"]): name(entry["rider_full_name"]) for entry in raw_card["entries"]}
    if roster != expected or set(roster) != set(card["cars"]) or len(set(roster.values())) != len(roster):
        raise ValueError("Kdreams result names do not match the entire roster")
    refund = one(TABLE.format("refund_table"), html, RESULT_PENDING)
    payouts = {}
    for pair, amount in re.findall(r"<dt>\s*([1-9]-[1-9])\s*</dt>\s*<dd>\s*([0-9,]+)円", refund):
        yen = int(amount.replace(",", ""))
        if pair not in pairs(card["cars"]) or pair in payouts or yen < 1:
            raise ValueError("invalid Kdreams exacta payout")
        payouts[pair] = yen
    if not payouts:
        raise ValueError(RESULT_PENDING)
    finish = [ranks[n][0] for n in (1, 2, 3)] if all(len(ranks.get(n, ())) == 1 for n in (1, 2, 3)) else None
    if finish and f"{finish[0]}-{finish[1]}" not in payouts:
        raise ValueError("Kdreams finish and exacta payout disagree")
    return {"race_id": card["race_id"], "source_race_id": source_id, "result_source": url,
            "result_sha256": sha256(html.encode("utf-8")).hexdigest(), "roster_check": "car_number_and_name",
            "back": backs[0] if len(backs) == 1 else None, "finish": finish, "statuses": statuses,
            "payouts": payouts, "rider_ids_verified": False}
