"""Confirm a Kdreams result against an independent per-car racer ID and result."""
from hashlib import sha256
import re
from urllib.request import Request, urlopen

from .kdreams_results import clean, key_for, one
from .source import JST, id_of, pairs, stamp


BASE = "https://keirin.netkeiba.com"
RESULT_URL = BASE + "/race/result/?race_id="
PROFILE_ID = re.escape(BASE) + r'/db/profile/\?id=(\d{1,6})'


def read_result(source_id):
    if not re.fullmatch(r"\d{12}", source_id):
        raise ValueError("invalid netkeirin race ID")
    url = RESULT_URL + source_id
    request = Request(url, headers={"User-Agent": "TK-KEIRIN-LAB/1.0 (public race research)"})
    with urlopen(request, timeout=15) as response:
        if response.url != url:
            raise ValueError("unexpected netkeirin result redirect")
        data = response.read(2_000_001)
        encoding = response.headers.get_content_charset() or "utf-8"
    if len(data) > 2_000_000:
        raise ValueError("netkeirin page too large")
    return data.decode(encoding)


def parse_result(html, card, source_id):
    url = RESULT_URL + source_id
    start = stamp(card["start"]).astimezone(JST)
    head = re.split(r"</head\s*>", html, maxsplit=1, flags=re.I)[0]
    title = clean(one(r"<title>(.*?)</title>", head, "missing netkeirin title"))
    canonical = one(r'<link rel="canonical" href="([^"]+)"', html, "missing netkeirin canonical URL")
    race_no = str(card["race_no"])
    if (canonical != url or not source_id.startswith(card["date"].replace("-", ""))
            or int(source_id[-2:]) != card["race_no"]
            or not title.startswith(card["venue"] + "競輪 ")
            or start.strftime("%Y年%m月%d日") not in title
            or not re.search(r"(?<!\d)" + race_no + r"R(?!\w)", title)):
        raise ValueError("netkeirin race identity mismatch")
    text = clean(html)
    schedules = set(re.findall(r"発走\s*(\d{2}:\d{2})\s*締切", text))
    if schedules != {start.strftime("%H:%M")}:
        raise ValueError("netkeirin race schedule mismatch")
    if not re.search(r'<p>\s*レースが確定しました\s*</p>', html):
        raise ValueError("result pending")
    markup = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    table = one(r'<table\b[^>]*\bid="All_Result_Table"[^>]*>(.*?)</table>', markup, "missing netkeirin result rows")
    roster, ranks, backs = {}, {}, []
    for row in re.findall(r'<tr\b[^>]*class="PlayerList"[^>]*>(.*?)</tr>', table, flags=re.S):
        cells = re.findall(r"<td\b[^>]*>(.*?)</td>", row, flags=re.S)
        if len(cells) != 8 or not re.fullmatch(r"[1-9]", clean(cells[2])):
            raise ValueError("unexpected netkeirin result row")
        car = int(clean(cells[2]))
        rider = id_of(one(r'href="' + PROFILE_ID + r'"', cells[3], "netkeirin rider ID missing or ambiguous"))
        if car in roster or rider in roster.values():
            raise ValueError("duplicate netkeirin rider or car")
        roster[car] = rider
        finish = re.fullmatch(r"([1-9])着", clean(cells[0]))
        if not finish or int(finish[1]) in ranks:
            raise ValueError("netkeirin finish order is irregular")
        ranks[int(finish[1])] = car
        if re.fullmatch(r"[SB /]*B[SB /]*", clean(cells[7])):
            backs.append(car)
    expected = {int(car): id_of(rider) for car, rider in card["roster"]}
    if roster != expected or set(roster) != set(card["cars"]):
        raise ValueError("independent rider IDs do not match the complete card")
    if sorted(ranks) != list(range(1, len(roster) + 1)) or len(backs) != 1:
        raise ValueError("netkeirin top three or B cannot be confirmed")
    rows = re.findall(r'<tr\b[^>]*class="Umatan"[^>]*>(.*?)</tr>', markup, flags=re.S)
    payouts = {}
    for row in rows:
        combo = clean(one(r'<td class="Result">(.*?)</td>', row, "netkeirin exacta pair unavailable"))
        amount = clean(one(r'<td class="Payout">(.*?)</td>', row, "netkeirin payout unavailable"))
        if not re.fullmatch(r"[1-9]\s*>\s*[1-9]", combo) or not re.fullmatch(r"[\d,]+円", amount):
            raise ValueError("invalid netkeirin exacta payout")
        key = re.sub(r"\s*>\s*", "-", combo)
        yen = int(amount[:-1].replace(",", ""))
        if key in payouts or key not in pairs(card["cars"]) or yen <= 0:
            raise ValueError("invalid netkeirin exacta payout")
        payouts[key] = yen
    finish = [ranks[i] for i in (1, 2, 3)]
    if payouts.keys() != {f"{finish[0]}-{finish[1]}"}:
        raise ValueError("netkeirin finish and exacta payout disagree")
    return {"labels": [backs[0], *finish], "payouts": payouts, "roster": sorted(roster.items()),
            "source": url, "sha256": sha256(html.encode("utf-8")).hexdigest()}


def confirm(card, staged):
    source_id = staged["source_race_id"]
    if (staged["race_id"] != card["race_id"] or key_for(staged["result_source"]) != source_id
            or staged["statuses"] or staged["back"] is None or staged["finish"] is None):
        raise ValueError("Kdreams result is missing ordinary, complete labels")
    checked = parse_result(read_result(source_id), card, source_id)
    if checked["labels"] != [staged["back"], *staged["finish"]] or checked["payouts"] != staged["payouts"]:
        raise ValueError("public result providers disagree on B, finish, or exacta")
    return {"labels": checked["labels"], "payouts": checked["payouts"], "confirmed": True,
            "cancelled": False, "accident": False, "refund_cars": [], "result_source": staged["result_source"],
            "decided_at": None, "sales_close": None, "final_quote": None, "rider_ids_verified": True,
            "roster_confirmation": checked["roster"],
            "evidence": {staged["result_source"]: staged["result_sha256"],
                         checked["source"]: checked["sha256"]}}
