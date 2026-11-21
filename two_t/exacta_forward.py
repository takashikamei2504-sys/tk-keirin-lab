"""Freeze matched direct-exacta and annual-MLP predictions before sales close."""
import argparse
from collections import Counter, defaultdict
from datetime import date, timedelta
from hashlib import sha256
import json
import math
from pathlib import Path
import re
from time import monotonic

import torch

from . import netkeirin_results
from .annual_archive import MEN, fetch, read_races, rider_features
from .annual_extension import compare_days
from .annual_train import predict_many
from .exacta_research import CLASSES, STYLES, DirectExacta, bounded_number
from .ledger import ledger_path, store_once
from .model import make
from .observe import utc_now
from .public_feed import day_feed, feed_url
from .source import JST, encode, id_of, pairs, payload, stamp, write
from .train import tensorize

MODELS = ("direct", "mlp")
MIN_LEAD = timedelta(minutes=10)
DATA_DIR = Path(__file__).resolve().parents[1] / "docs"


def digest(value):
    return sha256(encode(value)).hexdigest()


def history_index(files):
    races, _ = read_races(files)
    histories = defaultdict(list)
    pending = {}
    current = None
    for (day, track, _), _, riders in races:
        if day != current:
            for who, item in pending.items():
                if item is not None:
                    histories[who].append(item)
            current = day
            pending.clear()
        classes = {entry[1] for entry in riders.values()}
        if not classes or not classes <= MEN:
            continue
        for who, _, rank, _ in riders.values():
            if who is not None and rank.isdecimal() and 1 <= int(rank) <= len(riders):
                pending[who] = None if who in pending else (day, track, int(rank))
    for who, item in pending.items():
        if item is not None:
            histories[who].append(item)
    return histories


def card_input(raw, day, history):
    sid = str(raw["race_id"])
    if (not re.fullmatch(day.replace("-", "") + r"\d{4}", sid)
            or int(sid[-2:]) != int(raw["race_number"])):
        raise ValueError("race identity")
    if (raw.get("is_girls") is not False or raw.get("result_top3") or raw.get("result_places")
            or raw.get("result_combos") or any((raw.get("payouts") or {}).values())):
        raise ValueError("outside men's pre-race scope")
    entry = sorted(raw["entries"], key=lambda item: int(item["car_number"]))
    cars = [int(x["car_number"]) for x in entry]
    if len(cars) not in (7, 9) or len(set(cars)) != len(cars) or not set(cars) <= set(range(1, 10)):
        raise ValueError("unsupported roster")
    ranks = {v["class_rank"] for v in entry}
    if not ranks <= MEN or any(v.get("is_absent") is not False for v in entry):
        raise ValueError("unknown class or withdrawal")
    riders = [id_of(x["rider_id"]) for x in entry]
    if len(set(riders)) != len(cars):
        raise ValueError("duplicate rider")
    tier = "S" if all(c.startswith("S") for c in ranks) else ("challenge" if "A3" in ranks else "A")
    track = sid[-4:-2]
    letters = str(raw["venue"])
    day_date = date.fromisoformat(day)
    form, public = [], []
    for car, v in zip(cars, entry, strict=True):
        name, term = "".join(v["rider_full_name"].split()), int(v["term"])
        if not name or term <= 0:
            raise ValueError("missing rider identity")
        style, cls = v["running_style"], v["class_rank"]
        race_score = bounded_number(v["competition_score"], 55, 130)
        age = bounded_number(v["age"], 18, 75)
        if style not in STYLES or race_score is None or age is None:
            raise ValueError("missing card predictor")
        form.append(rider_features(history.get((name, term)), day_date, track))
        public.append([race_score, age, car, *(float(style == s) for s in STYLES),
                       *(float(cls == c) for c in CLASSES)])
    start, close = (f"{day}T{raw[key]}:00+09:00" for key in ("start_time", "close_time"))
    if not stamp(close) < stamp(start):
        raise ValueError("invalid sales cutoff")
    return {"race_id": sid, "date": day, "race_no": int(sid[-2:]), "venue": letters,
            "cars": cars, "roster": list(zip(cars, riders, strict=True)), "start": start,
            "sales_close": close, "common": [int(track), tier == "S", tier == "challenge"],
            "history": form, "racecard": public, "tier": tier}


def load_model(weights, kind, size, pins):
    filename = f"direct-exacta-{size}.pt" if kind == "direct" else f"mlp-{size}-latent-b.pt"
    p = weights / filename
    actual = sha256(p.read_bytes()).hexdigest()
    if actual != pins[kind][size]:
        raise ValueError(f"unrecognized {kind} weight for {size} riders")
    ckpt = torch.load(p, map_location="cpu", weights_only=True)
    if (kind == "direct" and (ckpt["kind"] != "with_card" or ckpt["size"] != size)
            or kind == "mlp" and (ckpt["kind"] != "mlp" or ckpt["n"] != size)):
        raise ValueError("unexpected checkpoint variant")
    return ckpt, actual


@torch.inference_mode()
def predict(card, kind, checkpoint):
    n = len(card["cars"])
    personal = card["history"]
    if kind == "direct":
        personal = [a + b for a, b in zip(personal, card["racecard"], strict=True)]
    row = dict(card, personal=personal, relation=[[[0, 0, 0]] * n] * n)
    data = tensorize([row], checkpoint["scaling"], labels=False)
    c, x, _, _ = data
    if kind == "direct":
        model = DirectExacta(c.shape[-1], x.shape[-1])
        model.load_state_dict(checkpoint["state"])
        model.eval()
        probability = (model(c, x)[0] / checkpoint["temperature"]).softmax(0).view(n, n)
    else:
        model = make("mlp", n, c.shape[-1], x.shape[-1])
        model.load_state_dict(checkpoint["state"])
        p = predict_many(model, data, checkpoint["repeats"])[0]
        p = p.pow(1 / checkpoint["temperature"])
        probability = p / p.sum()
    return {f"{a}-{b}": round(probability[i, j].item(), 10)
            for i, a in enumerate(card["cars"]) for j, b in enumerate(card["cars"]) if i != j}


def freeze(ledger, feed, fetched, history, manifest_pin, models, clock=utc_now, predictor=predict):
    day = fetched.astimezone(JST).date().isoformat()
    published = stamp(feed["generated_at"])
    if feed["date"] != day or published > fetched:
        raise ValueError("day or feed timestamp mismatch")
    source = {"url": feed_url(day), "generated_at": feed["generated_at"], "fetched_at": fetched.isoformat(),
              "feed_sha256": digest(feed), "history_manifest_sha256": manifest_pin}
    seen = Counter(str(r.get("race_id")) for r in feed["races"])
    counts, reasons = Counter(), Counter()
    for raw in feed["races"]:
        try:
            card = card_input(raw, day, history)
            sid = card["race_id"]
            if seen[sid] != 1:
                raise ValueError("duplicate race ID")
            if ledger_path(ledger / "predictions", sid).exists():
                counts["already_frozen"] += 1
                continue
            cutoff = stamp(card["sales_close"]) - MIN_LEAD
            if clock() > cutoff:
                raise ValueError("inside ten minutes to sales close")
            installed = models[len(card["cars"])]
            p = {m: {"weight_sha256": sha, "p": predictor(card, m, ckpt)}
                 for m, (ckpt, sha) in installed.items()}
            issued = clock()
            if not fetched <= issued <= cutoff:
                raise ValueError("clock or sales cutoff moved during inference")
            pack = {"card": card, "card_sha256": digest(card), "source": source,
                    "issued_at": issued.isoformat(), "models": p}
            validate(pack)
            store_once(ledger / "predictions", sid, pack)
            counts[f"frozen_{len(card['cars'])}"] += 1
        except FileExistsError:
            counts["already_frozen"] += 1
        except (KeyError, TypeError, ValueError) as exc:
            reasons[str(exc)] += 1
    return {"date": day, "feed_races": len(feed["races"]), "counts": dict(counts), "skipped": dict(reasons),
            "source": source}


def validate(pack):
    card, source = pack["card"], pack["source"]
    if pack["card_sha256"] != digest(card) or source["url"] != feed_url(card["date"]):
        raise ValueError("stored input differs from provenance")
    t = stamp(pack["issued_at"])
    if not stamp(source["generated_at"]) <= stamp(source["fetched_at"]) <= t <= stamp(card["sales_close"]) - MIN_LEAD:
        raise ValueError("invalid stored time sequence")
    if set(pack["models"]) != set(MODELS):
        raise ValueError("missing paired prediction")
    for model in pack["models"].values():
        p = model["p"]
        if (set(p) != pairs(card["cars"]) or any(not 0 < x < 1 for x in p.values())
                or not math.isclose(sum(p.values()), 1, abs_tol=1e-6)
                or not re.fullmatch(r"[0-9a-f]{64}", model["weight_sha256"])):
            raise ValueError("invalid stored probabilities")


def settle(ledger, clock=utc_now, reader=netkeirin_results.read_result,
           parser=netkeirin_results.parse_result, budget_seconds=180):
    counts, errors = Counter(), {}
    deadline = monotonic() + budget_seconds
    for p in sorted((ledger / "predictions").glob("*.json")):
        if monotonic() >= deadline:
            counts["budget_exhausted"] += 1
            break
        key = p.stem
        try:
            pack = payload(p)
            validate(pack)
            card = pack["card"]
            key = card["race_id"]
            if p != ledger_path(ledger / "predictions", key):
                raise ValueError("stored race key differs")
            if ledger_path(ledger / "settlements", key).exists():
                counts["already_settled"] += 1
                continue
            if clock() < stamp(card["start"]):
                counts["awaiting_start"] += 1
                continue
            result = parser(reader(key), card, key)
            _, first, second, _ = result["labels"]
            exacta = f"{first}-{second}"
            metrics = {}
            for model, params in pack["models"].items():
                probability = params["p"]
                ranked = sorted(probability, key=lambda k: (-probability[k], k))
                metrics[model] = {"top1": ranked[0] == exacta, "top3": exacta in ranked[:3],
                                  "log_loss": -math.log(probability[exacta])}
            store_once(ledger / "settlements", key,
                       {"race_id": key, "size": len(card["cars"]), "date": card["date"], "observed_at": clock().isoformat(),
                        "prediction_sha256": digest(pack), "result_source": result["source"],
                        "result_sha256": result["sha256"], "exacta": exacta, "metrics": metrics})
            counts["settled"] += 1
        except FileExistsError:
            counts["already_settled"] += 1
        except (ValueError, KeyError, TypeError, OSError) as exc:
            errors[key] = str(exc)
    return {"counts": dict(counts), "unsettled": errors}


def summarize(ledger):
    predictions = Counter()
    matched = defaultdict(list)
    for p in (ledger / "predictions").glob("*.json"):
        pack = payload(p)
        validate(pack)
        card = pack["card"]
        size, key = len(card["cars"]), card["race_id"]
        if p != ledger_path(ledger / "predictions", key):
            raise ValueError("stored race key differs")
        predictions[size] += 1
        result = ledger_path(ledger / "settlements", key)
        if result.exists():
            x = payload(result)
            if x["prediction_sha256"] != digest(pack) or x["race_id"] != key:
                raise ValueError("settlement does not match the frozen prediction")
            matched[size].append(x)
    out = {}
    for size, total in sorted(predictions.items()):
        items = matched[size]
        comparison = None
        if items:
            stats = {m: {k: sum(x["metrics"][m][k] for x in items) / len(items)
                         for k in ("top1", "top3", "log_loss")} for m in MODELS}
            daily = defaultdict(list)
            for item in items:
                daily[item["date"]].append(item)
            if len(daily) >= 2:
                digest_key = digest(sorted(item["race_id"] for item in items))
                studies = {m: {"data_sha256": digest_key, "size": size, "daily": {
                    day: {"races": len(group), "log_loss": sum(x["metrics"][m]["log_loss"] for x in group) / len(group)}
                    for day, group in daily.items()}} for m in MODELS}
                comparison = compare_days(studies["direct"], studies["mlp"])
                comparison["log_loss_delta"] = comparison.pop("transformer_minus_mlp_log_loss")
        else:
            stats = None
        out[size] = {"frozen": total, "settled": len(items), "metrics": stats, "direct_minus_mlp": comparison}
    return out


def archive(ledger, day, root):
    groups = defaultdict(list)
    for p in sorted((ledger / "predictions").glob("*.json")):
        item = payload(p)
        card = item["card"]
        if card["date"] == day:
            validate(item)
            if p != ledger_path(ledger / "predictions", card["race_id"]):
                raise ValueError("stored race key differs")
            groups[card["race_id"][-4:-2]].append(item)
    manifest = {}
    for venue, items in sorted(groups.items()):
        name = f"venue-{venue}.json"
        write(root / name, items)
        manifest[name] = {"races": len(items), "sha256": digest(items)}
    if not manifest:
        raise ValueError("no predictions for the requested day")
    write(root / "manifest.json", {"date": day, "files": manifest})
    return {"date": day, "files": len(manifest), "races": sum(x["races"] for x in manifest.values())}


def restore(root, ledger):
    manifest = payload(root / "manifest.json")
    items = {}
    for name, meta in manifest["files"].items():
        if not re.fullmatch(r"venue-\d{2}\.json", name):
            raise ValueError("invalid archive member")
        group = payload(root / name)
        if len(group) != meta["races"] or digest(group) != meta["sha256"]:
            raise ValueError("archive file differs from manifest")
        for item in group:
            validate(item)
            key = item["card"]["race_id"]
            if key in items or item["card"]["date"] != manifest["date"] or name != f"venue-{key[-4:-2]}.json":
                raise ValueError("duplicate or misplaced race")
            items[key] = item
    root = ledger / "predictions"
    for key, item in items.items():
        try:
            store_once(root, key, item)
        except FileExistsError:
            if payload(ledger_path(root, key)) != item:
                raise ValueError("existing ledger record differs from archive")
    return {"date": manifest["date"], "races": len(items)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    for mode in ("freeze", "settle", "summary", "archive", "restore"):
        command = modes.add_parser(mode)
        command.add_argument("--ledger", type=Path, required=True)
        if mode == "freeze":
            command.add_argument("--weights", type=Path, required=True)
            command.add_argument("--monthly", type=Path, required=True)
        if mode == "settle":
            command.add_argument("--budget-seconds", type=int, default=180)
        if mode in ("archive", "restore"):
            command.add_argument("--archive", type=Path, required=True)
        if mode == "archive":
            command.add_argument("--date", type=date.fromisoformat, required=True)
    a = parser.parse_args()
    if a.mode == "freeze":
        torch.set_num_threads(2)
        torch.use_deterministic_algorithms(True)
        manifest_path = Path(__file__).with_name("annual_sources.json")
        manifest = payload(manifest_path)
        histories = history_index(fetch(a.monthly, manifest))
        research = payload(DATA_DIR / "2T_DIRECT_EXACTA_RESEARCH.json")
        pins = {"direct": {n: research[str(n)]["candidate_sha256"] for n in (7, 9)},
                "mlp": {n: payload(DATA_DIR / f"2T_ANNUAL_{n}_METRICS.json")["mlp"]["weights_sha256"]
                        for n in (7, 9)}}
        models = {n: {m: load_model(a.weights, m, n, pins) for m in MODELS} for n in (7, 9)}
        day = utc_now().astimezone(JST).date().isoformat()
        feed = day_feed(day)
        result = freeze(a.ledger, feed, utc_now(), histories, sha256(manifest_path.read_bytes()).hexdigest(), models)
    elif a.mode == "settle":
        if a.budget_seconds <= 0:
            parser.error("settlement budget must be positive")
        result = settle(a.ledger, budget_seconds=a.budget_seconds)
    elif a.mode == "summary":
        result = summarize(a.ledger)
    elif a.mode == "archive":
        result = archive(a.ledger, a.date.isoformat(), a.archive)
    else:
        result = restore(a.archive, a.ledger)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
