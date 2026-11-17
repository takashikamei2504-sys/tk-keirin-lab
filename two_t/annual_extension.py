"""Join dated payout evidence for races missing the archive's full results."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from hashlib import sha256
from pathlib import Path
import re
from random import Random

from .annual_archive import END as ARCHIVE_END, MEN, TEST_START, fetch, read_races, rider_features
from .kdreams_results import BASE, clean, key_for, one, read_page
from .source import payload, write

START = date(2026, 9, 1)
END = date(2026, 11, 16)


def payout_rows(html, day):
    header = clean(one(r"<title>(.*?)</title>", html, "missing payout title"))
    if not header.startswith(f"競輪 払戻金（{day.year}年{day.month:02}月{day.day:02}日）"):
        # clean() converts fullwidth parentheses in alternate page layouts.
        if not header.startswith(f"競輪 払戻金({day.year}年{day.month:02}月{day.day:02}日)"):
            raise ValueError("payout date mismatch")
    sections = re.split(r'<h3 class="daily-refund-result-list_heading">([^<]+)</h3>', html)
    maps = {2: defaultdict(list), 3: defaultdict(list)}
    for tag, area in zip(sections[1::2], sections[2::2], strict=True):
        n = {"2車単": 2, "3連単": 3}.get(tag)
        if n is None:
            continue
        for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", area, flags=re.S):
            links = re.findall(r'href="(https://keirin\.kdreams\.jp/[a-z0-9-]+/racedetail/([0-9]{16})/\?pageType=result)"', row)
            if len(links) != 1:
                continue
            url, race_id = links[0]
            slug = url.split("/")[3]
            try:
                k = key_for(url.replace("pageType=result", "pageType=showResult"))
            except ValueError:
                continue
            if k[:8] != day.strftime("%Y%m%d"):
                continue
            if "rowspan" in row.lower():
                maps[n][race_id].append(None)
                continue
            order = clean(one(r'<td class="order">(.*?)</td>', row, "missing order cell"))
            yen = clean(one(r'<td class="refund">(.*?)</td>', row, "missing refund cell")).replace(",", "")
            order_pattern = r"[1-9](?:-[1-9]){" + str(n - 1) + "}"
            if re.fullmatch(order_pattern, order) and yen.isascii() and yen.isdecimal() and int(yen) > 0:
                ranks = tuple(map(int, order.split("-")))
                if len(set(ranks)) == n:
                    maps[n][race_id].append((ranks, int(yen), slug))
            else:
                maps[n][race_id].append(None)
    return {rid: (three[0][0], two[0][1], two[0][2]) for rid, two in maps[2].items()
            if len(two) == 1 and two[0] and len(three := maps[3].get(rid, [])) == 1 and three[0]
            and two[0][0] == three[0][0][:2] and two[0][2] == three[0][2]}


def collect(cache, start=START, end=END):
    cache.mkdir(parents=True, exist_ok=True)
    days = (start + timedelta(days=i) for i in range((end - start).days + 1))

    def get(day):
        url = BASE + "/harailist/" + day.strftime("%Y/%m/%d/")
        target = cache / (day.isoformat() + ".html")
        try:
            html = target.read_text() if target.exists() else read_page(url)
            records = payout_rows(html, day)
            if not target.exists():
                target.write_text(html)
            return day, records, {"url": url, "sha256": sha256(html.encode()).hexdigest(), "matched_payouts": len(records)}
        except (OSError, ValueError) as exc:
            return day, {}, {"url": url, "failure": str(exc)}

    with ThreadPoolExecutor(max_workers=3) as pool:
        return {day: (records, evidence) for day, records, evidence in pool.map(get, days)}


def join(files, payouts, baseline):
    races, _ = read_races(files)
    history = defaultdict(list)
    known = {row["race_id"] for rows in baseline for row in rows}
    new = []
    coverage = defaultdict(Counter)
    previous_day = None
    pending = {}
    for (day, track, venue), rid, riders in races:
        if day != previous_day:
            for who, event in pending.items():
                if event is not None:
                    history[who].append(event)
            pending.clear()
            previous_day = day
        classes = {row[1] for row in riders.values()}
        if not classes or not classes <= MEN:
            continue
        keys = {car: row[0] for car, row in riders.items()}
        cars = sorted(keys)
        if day in payouts and rid not in known and len(cars) in (7, 9):
            count = coverage[day.strftime("%Y-%m"), len(cars)]
            count["additional_rosters"] += 1
            result = payouts[day][0].get(rid)
            if None in keys.values() or len(set(keys.values())) != len(cars):
                count["unresolved_rider"] += 1
            elif not result or not set(result[0]) <= set(cars) or result[2] != venue:
                count["unmatched_payout"] += 1
            else:
                tier = "S" if all(c.startswith("S") for c in classes) else ("challenge" if "A3" in classes else "A")
                personal = [rider_features(history[keys[car]], day, track) for car in cars]
                count["riders_without_history"] += sum(r[0] is None for r in personal)
                count["matched"] += 1
                new.append({"race_id": rid, "date": day.isoformat(), "split": "test", "cars": cars,
                            "tier": tier, "common": [int(track), tier == "S", tier == "challenge"],
                            "personal": personal, "targets": list(result[0]), "payout_yen": result[1]})
        # Only the pinned archived finishing ranks contribute to rider histories.
        for who, _, rank, _ in riders.values():
            if who is not None and rank.isdecimal() and 1 <= int(rank) <= len(cars):
                pending[who] = None if who in pending else (day, track, int(rank))
    return new, {f"{month} / {size}": row for (month, size), row in sorted(coverage.items())}


def evaluate(data, weights, metrics, out):
    import torch

    from .annual_train import arrays, predict_many, prepare, score
    from .model import make

    digest = sha256(weights.read_bytes()).hexdigest()
    fixed = payload(metrics)
    if digest != fixed["weights_sha256"]:
        raise ValueError("checkpoint does not match the annual study")
    checkpoint = torch.load(weights, weights_only=True)
    torch.set_num_threads(4)
    torch.use_deterministic_algorithms(True)
    rows = prepare(payload(data))["test"]
    c, x, r, targets = arrays(rows, checkpoint["scaling"])
    if checkpoint["n"] != fixed["cars"] or c.shape[0] != len(rows) or any(
        len(row["cars"]) != checkpoint["n"] for row in rows
    ):
        raise ValueError("field size or test partition mismatch")
    if checkpoint["repeats"] != fixed["repeats"] or checkpoint["temperature"] != fixed["temperature"]:
        raise ValueError("inference settings do not match the annual study")
    model = make(checkpoint["kind"], checkpoint["n"], c.shape[-1], x.shape[-1])
    model.load_state_dict(checkpoint["state"])
    predictions = predict_many(model, (c, x, r, targets), checkpoint["repeats"])
    temperature = checkpoint["temperature"]
    by_month, by_day, by_tier = defaultdict(list), defaultdict(list), defaultdict(list)
    for row, p in zip(rows, predictions, strict=True):
        item = (row, p)
        by_month[row["date"][:7]].append(item)
        by_day[row["date"]].append(item)
        by_tier[row["tier"]].append(item)

    def summarize(grouped):
        results = {}
        for key, items in grouped.items():
            r, p = zip(*items, strict=True)
            results[key] = {"races": len(items), **score(r, p, temperature)}
        return results

    write(out, {"races": len(rows), "size": checkpoint["n"], "model": checkpoint["kind"],
                "temperature": temperature, "checkpoint_sha256": digest,
                "data_sha256": sha256(data.read_bytes()).hexdigest(), "monthly": summarize(by_month),
                "daily": summarize(by_day), "tier": summarize(by_tier),
                "overall": score(rows, predictions, temperature)})


def compare_days(transformer, mlp, replicates=2000, seed=11):
    """Resample matched days, weighting each sampled day by its race count."""
    if transformer["data_sha256"] != mlp["data_sha256"] or transformer["size"] != mlp["size"]:
        raise ValueError("models must have been scored on the same race file")
    x, y = transformer["daily"], mlp["daily"]
    if not x or x.keys() != y.keys() or any(x[d]["races"] != y[d]["races"] for d in x):
        raise ValueError("daily race counts do not match")
    blocks = [(x[d]["races"], x[d]["log_loss"] - y[d]["log_loss"]) for d in sorted(x)]
    rng = Random(seed)

    def weighted(sample):
        return sum(n * loss for n, loss in sample) / sum(n for n, _ in sample)

    draws = sorted(weighted(rng.choices(blocks, k=len(blocks))) for _ in range(replicates))
    return {"day_count": len(blocks), "replicates": replicates, "seed": seed,
            "transformer_minus_mlp_log_loss": weighted(blocks),
            "interval_95": [draws[int((replicates - 1) * q)] for q in (.025, .975)]}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    mode = p.add_subparsers(dest="mode", required=True)
    build = mode.add_parser("build")
    for flag in ("--monthly", "--baseline", "--cache", "--out"):
        build.add_argument(flag, type=Path, required=True)
    build.add_argument("--start", type=date.fromisoformat, default=START)
    build.add_argument("--end", type=date.fromisoformat, default=END)
    run = mode.add_parser("score")
    for flag in ("data", "weights", "metrics", "out"):
        run.add_argument(flag, type=Path)
    comparison = mode.add_parser("compare")
    for flag in ("transformer", "mlp", "out"):
        comparison.add_argument(flag, type=Path)
    a = p.parse_args()
    if a.mode == "score":
        evaluate(a.data, a.weights, a.metrics, a.out)
        return
    if a.mode == "compare":
        write(a.out, compare_days(payload(a.transformer), payload(a.mlp)))
        return
    if not TEST_START <= a.start <= a.end <= ARCHIVE_END:
        p.error("requested dates must be within the fixed archive test period")
    days = collect(a.cache, a.start, a.end)
    baseline = [payload(a.baseline / f"annual-{n}.json") for n in (7, 9)]
    source = payload(Path(__file__).with_name("annual_sources.json"))
    rows, counts = join(fetch(a.monthly, source), days, baseline)
    for n in (7, 9):
        write(a.out / f"extension-{n}.json", [r for r in rows if len(r["cars"]) == n])
    write(a.out / "coverage.json", {"counts": counts, "daily_sources": {str(d): x[1] for d, x in days.items()}})
    print(counts)


if __name__ == "__main__":
    main()
