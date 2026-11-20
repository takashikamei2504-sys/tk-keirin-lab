"""Cross-check a chronological sample against Kdreams and netkeirin result pages."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import re
from urllib.error import URLError

from .annual_archive import RACE_ID, read_races
from .kdreams_results import BASE, TABLE, clean, name, one, parse_result, read_page
from .netkeirin_results import PROFILE_ID, parse_result as parse_net, read_result
from .source import payload, write


def line_groups(html, cars):
    fragments = re.findall(r'<div class="line_position(?:_inner)?">(.*?)</div>', html, flags=re.S)
    groups = []
    for fragment in fragments:
        candidate = []
        for group in re.split(r'<span class="icon_p space"[^>]*>', fragment):
            numbers = [int(x) for x in re.findall(r'<span class="p00[1-9]">([1-9])</span>', group)]
            if numbers:
                candidate.append(numbers)
        flat = [car for group in candidate for car in group]
        if sorted(flat) == cars and candidate not in groups:
            groups.append(candidate)
    return groups[0] if len(groups) == 1 else None


def check(candidate, parsed):
    day, venue_code, venue = parsed[0]
    kd_id = candidate["race_id"]
    race_no = int(RACE_ID.fullmatch(kd_id)[4])
    net_id = day.strftime("%Y%m%d") + venue_code + f"{race_no:02}"
    url = f"{BASE}/{venue}/racedetail/{kd_id}/?pageType=showResult"
    kd = read_page(url)
    heading = clean(one(r"<title>(.*?)</title>", kd, "missing Kdreams title"))
    venue_name = heading.split("競輪 ", 1)[0]
    clock = clean(one(r"<dt\b[^>]*>\s*発走予定\s*</dt>\s*<dd\b[^>]*>(.*?)</dd>", kd, "start time missing"))
    raw = {"race_id": net_id, "entries": [{"car_number": c, "rider_full_name": key[0]}
                                          for c, (key, *_) in parsed[2].items()]}
    card = {"start": f"{day.isoformat()}T{clock}:00+09:00", "date": day.isoformat(),
            "race_no": race_no, "venue": venue_name, "race_id": kd_id, "cars": candidate["cars"]}
    refund_table = one(TABLE.format("refund_table"), kd, "missing Kdreams refund table")
    ordered_cells = re.findall(r"<td>\s*単\s*</td>\s*<td>(.*?)</td>", refund_table, flags=re.S)
    if len(ordered_cells) != 3:
        raise ValueError("unexpected Kdreams refund layout")
    # The 9-car table also contains a separate 2-frame exacta dividend.
    staged = parse_result(kd.replace(refund_table, ordered_cells[1], 1), url, card, raw)
    staged["result_sha256"] = sha256(kd.encode()).hexdigest()
    finish = candidate["targets"]
    expected = {f"{finish[0]}-{finish[1]}": candidate["payout_yen"]}
    if staged["finish"] != finish or staged["payouts"] != expected or staged["back"] is None:
        raise ValueError("Kdreams results disagree with the archive or lack a unique B")

    net = read_result(net_id)
    markup = re.sub(r"<!--.*?-->", "", net, flags=re.S)
    table = one(r'<table\b[^>]*\bid="All_Result_Table"[^>]*>(.*?)</table>', markup, "result table missing")
    expected_names = {int(x["car_number"]): name(x["rider_full_name"]) for x in raw["entries"]}
    roster = []
    for row in re.findall(r'<tr\b[^>]*class="PlayerList"[^>]*>(.*?)</tr>', table, flags=re.S):
        cells = re.findall(r"<td\b[^>]*>(.*?)</td>", row, flags=re.S)
        car = int(clean(cells[2]))
        name_tag = one(r'<dt class="PlayerName">(.*?)</dt>', cells[3], "rider name missing")
        rider_id = one(r'href="' + PROFILE_ID + r'"', cells[3], "rider ID missing")
        if name(name_tag) != expected_names.get(car):
            raise ValueError("rider name and car differ between providers")
        roster.append((car, rider_id))
    checked = parse_net(net, dict(card, roster=roster), net_id)
    if checked["labels"] != [staged["back"], *finish] or checked["payouts"] != expected:
        raise ValueError("providers disagree on B, rank or payout")

    # The separately requested racecard can show the predicted lineup but has no archived timestamp.
    card_url = f"{BASE}/{venue}/racecard/{kd_id[:-2]}/"
    line_page = read_page(card_url)
    card_sets = re.findall(r'<div class="line_position_inner">(.*?)</div>', line_page, flags=re.S)
    # The detail response isolates the race, while the meeting card can show several different lineups.
    lines = line_groups(kd, candidate["cars"])
    card_title = clean(one(r"<title>(.*?)</title>", line_page, "missing archived card title"))
    return {"race_id": kd_id, "date": day.isoformat(), "back": staged["back"], "finish": finish,
            "payout_yen": expected[next(iter(expected))], "kdreams_result": url,
            "netkeirin_result": checked["source"], "sha256": [staged["result_sha256"], checked["sha256"]],
            "archived_card": card_url, "archived_card_sha256": sha256(line_page.encode()).hexdigest(),
            "archived_card_date_agrees": day.strftime("%Y年%m月%d日") in card_title,
            "archived_card_lineup_sections": len(card_sets), "retrospective_lines": lines,
            "lineup_before_start_verified": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--batch", type=int, help="Try this many unchecked races, replacing failed entries on retry")
    args = parser.parse_args()
    if args.batch is not None and not 1 <= args.batch <= 200:
        parser.error("--batch must be in 1–200")
    metadata, _ = read_races(sorted(args.cache.glob("*_keirin.csv")))
    by_id = {item[1]: item for item in metadata}
    candidates = payload(args.data)
    previous = payload(args.out) if args.out.exists() else []
    status = {item["race_id"]: item for item in previous}
    if args.batch is not None:
        # New races first so persistently unavailable cards do not block later months.
        candidates = sorted(candidates, key=lambda x: x["race_id"] in status)
        sample = [item for item in candidates if "back" not in status.get(item["race_id"], {})][:args.batch]
    else:
        monthly = {}
        for item in candidates:
            monthly.setdefault(item["date"][:7], item)
        sample = [item for item in monthly.values() if "back" not in status.get(item["race_id"], {})]
    def retrieve(chosen):
        try:
            return check(chosen, by_id[chosen["race_id"]])
        except (ValueError, KeyError, IndexError, URLError) as exc:
            return {"race_id": chosen["race_id"], "date": chosen["date"], "reason": str(exc)}

    with ThreadPoolExecutor(max_workers=3) as pool:
        for row in pool.map(retrieve, sample):
            status[row["race_id"]] = row
            write(args.out, sorted(status.values(), key=lambda x: (x["date"], x["race_id"])))
            print(row["date"][:7], "confirmed" if "back" in row else row["reason"], flush=True)


if __name__ == "__main__":
    main()
