"""Research comparison of direct ordered-pair models on annual race archives."""
import argparse
from collections import defaultdict
import csv
from hashlib import sha256
import math
from pathlib import Path

import torch
from torch import nn

from .annual_archive import fetch
from .annual_extension import compare_days
from .annual_train import arrays, predict_many, prepare, score
from .model import make
from .source import payload, write
from .train import SEED, fit_scaling

STYLES = ("逃", "両", "追")
CLASSES = ("A3", "A2", "A1", "S2", "S1", "SS")
CARD_WIDTH = 3 + len(STYLES) + len(CLASSES)
EPOCHS = 16
TEMPS = (.75, 1., 1.25, 1.5, 2.)


def bounded_number(value, lower, upper):
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) and lower <= x <= upper else None


def card_features(files, race_ids):
    features = defaultdict(dict)
    conflicts = set()
    for p in files:
        with p.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                rid = row.get("race_id")
                if rid not in race_ids:
                    continue
                car = bounded_number(row.get("banum"), 1, 9)
                if car is None or not car.is_integer():
                    continue
                style = row.get("running_style")
                cls = row.get("player_class")
                value = (bounded_number(row.get("race_score"), 55, 130),
                         bounded_number(row.get("age"), 18, 75), car,
                         *(float(style == s) if style in STYLES else None for s in STYLES),
                         *(float(cls == c) if cls in CLASSES else None for c in CLASSES))
                old = features[rid].setdefault(int(car), value)
                if old != value:
                    conflicts.add((rid, int(car)))
    for rid, car in conflicts:
        features[rid].pop(car)
    return features


def add_card(rows, features):
    return [dict(row, personal=[rider + list(features.get(row["race_id"], {}).get(car, (None,) * CARD_WIDTH))
                               for car, rider in zip(row["cars"], row["personal"], strict=True)])
            for row in rows]


class DirectExacta(nn.Module):
    def __init__(self, common_width, rider_width):
        super().__init__()
        self.rider = nn.Sequential(nn.Linear(common_width + rider_width, 64), nn.SiLU(),
                                   nn.Linear(64, 32), nn.SiLU())
        self.pair = nn.Sequential(nn.Linear(96, 48), nn.SiLU(), nn.Linear(48, 1))

    def forward(self, common, riders):
        batch, n = riders.shape[:2]
        h = self.rider(torch.cat((riders, common[:, None].expand(-1, n, -1)), -1))
        left = h[:, :, None, :].expand(-1, -1, n, -1)
        right = h[:, None, :, :].expand(-1, n, -1, -1)
        context = h.mean(1)[:, None, None, :].expand(-1, n, n, -1)
        scores = self.pair(torch.cat((left, right, context), -1)).squeeze(-1)
        return scores.masked_fill(torch.eye(n, dtype=torch.bool), -torch.inf).view(batch, -1)


def chunks(data):
    c, x, _, targets = data
    return c, x, targets[:, 0] * x.shape[1] + targets[:, 1]


@torch.inference_mode()
def logits(model, data):
    c, x, _ = chunks(data)
    return torch.cat([model(a, b) for a, b in zip(c.split(256), x.split(256), strict=True)])


def fit(model, train, validation):
    c, x, y = chunks(train)
    rng = torch.Generator().manual_seed(SEED)
    optimizer = torch.optim.AdamW(model.parameters(), lr=.002, weight_decay=.001)
    validation_y = chunks(validation)[-1]
    winner = (math.inf, 0, 1., None)
    history = []
    for epoch in range(1, EPOCHS + 1):
        for ix in torch.randperm(len(y), generator=rng).split(192):
            loss = nn.functional.cross_entropy(model(c[ix], x[ix]), y[ix])
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
        v = logits(model, validation)
        error, temperature = min((nn.functional.cross_entropy(v / t, validation_y).item(), t) for t in TEMPS)
        history.append(error)
        if error < winner[0]:
            winner = (error, epoch, temperature, {k: p.detach().clone() for k, p in model.state_dict().items()})
        if epoch - winner[1] == 4:
            break
    error, epoch, temp, state = winner
    model.load_state_dict(state)
    return {"validation_log_loss": error, "epoch": epoch, "temperature": temp, "validation_history": history}


def summarize(rows, p, temperature, digest):
    day = defaultdict(list)
    for i, row in enumerate(rows):
        day[row["date"]].append(i)
    return {"data_sha256": digest, "size": len(rows[0]["cars"]), "races": len(rows),
            "overall": score(rows, p, temperature),
            "daily": {d: {"races": len(ix), **score([rows[i] for i in ix], [p[i] for i in ix], temperature)}
                      for d, ix in day.items()}}


def main(base, weights, sources, extra, recent, output):
    torch.set_num_threads(3)
    torch.use_deterministic_algorithms(True)
    groups = prepare(payload(base))
    size = len(groups["train"][0]["cars"])
    named_input = {"original": groups["test"], "feb_apr": prepare(payload(extra))["test"],
                   "november": prepare(payload(recent))["test"]}
    ids = {name: {r["race_id"] for r in rows} for name, rows in named_input.items()}
    if any(not rows or len(ids[name]) != len(rows) or any(len(r["cars"]) != size for r in rows)
           for name, rows in named_input.items()):
        raise ValueError("empty cohort, duplicate race, or mismatched field size")
    if len(set.union(*ids.values())) != sum(map(len, ids.values())):
        raise ValueError("overlapping test cohorts")
    files = fetch(sources, payload(Path(__file__).with_name("annual_sources.json")))
    features = card_features(files, {r["race_id"] for rows in groups.values() for r in rows} | set.union(*ids.values()))
    model_id = f"mlp-{size}"
    reference_meta = payload(weights / f"{model_id}-metrics.json")
    data_sha = sha256(base.read_bytes()).hexdigest()
    if data_sha != reference_meta["dataset_sha256"]:
        raise ValueError("baseline dataset hash does not match archived model")
    reference_file = weights / f"{model_id}-latent-b.pt"
    if sha256(reference_file.read_bytes()).hexdigest() != reference_meta["weights_sha256"]:
        raise ValueError("baseline weight hash does not match archived model")
    reference = torch.load(reference_file, weights_only=True)
    scale = reference["scaling"]
    c, x, _, _ = arrays(groups["validation"], scale)
    mlp = make("mlp", size, c.shape[-1], x.shape[-1])
    mlp.load_state_dict(reference["state"])
    p = predict_many(mlp, arrays(groups["validation"], scale), reference["repeats"])
    validation = {"mlp_reference": score(groups["validation"], p, reference["temperature"])["log_loss"]}
    settings = {}
    predictors = {"mlp_reference": (mlp, scale)}
    for name in ("history", "with_card"):
        torch.manual_seed(SEED)
        augment = (lambda rows: add_card(rows, features)) if name == "with_card" else (lambda rows: rows)
        lr, vr = (augment(groups[k]) for k in ("train", "validation"))
        scale = fit_scaling(lr)
        train, valid = arrays(lr, scale), arrays(vr, scale)
        model = DirectExacta(train[0].shape[-1], train[1].shape[-1])
        settings[name] = fit(model, train, valid)
        validation[name] = settings[name]["validation_log_loss"]
        predictors[name] = (model, scale)
        print(size, name, settings[name], flush=True)
    choice = min(validation, key=validation.get)
    print(size, "January choice", choice, validation, flush=True)
    study = {"size": size, "validation": validation, "chosen_by_january_log_loss": choice, "fit": settings, "cohorts": {}}
    if choice != "mlp_reference":
        winner, scale = predictors[choice]
        checkpoint = output.with_name(f"direct-exacta-{size}.pt")
        checkpoint.parent.mkdir(parents=True, exist_ok=True)
        torch.save({"kind": choice, "size": size, "state": winner.state_dict(), "scaling": scale,
                    "temperature": settings[choice]["temperature"], "dataset_sha256": data_sha}, checkpoint)
        study["candidate_sha256"] = sha256(checkpoint.read_bytes()).hexdigest()
    features_by_set = {}
    for cohort, rows in named_input.items():
        digest = sha256("\n".join(r["race_id"] for r in rows).encode()).hexdigest()
        enriched = add_card(rows, features)
        features_by_set[cohort] = {"races": len(rows), "race_score_riders": sum(person[-CARD_WIDTH] is not None
                                  for r in enriched for person in r["personal"]), "riders": len(rows) * size}
        summaries = {}
        for name, (model, scale) in predictors.items():
            data = arrays(enriched if name == "with_card" else rows, scale)
            if name == "mlp_reference":
                probabilities = predict_many(model, data, reference["repeats"])
                temperature = reference["temperature"]
            else:
                probabilities = (logits(model, data) / settings[name]["temperature"]).softmax(-1).view(-1, size, size)
                temperature = 1.
            summaries[name] = summarize(rows, probabilities, temperature, digest)
        comparison = compare_days(summaries[choice], summaries["mlp_reference"])
        comparison["log_loss_delta"] = comparison.pop("transformer_minus_mlp_log_loss")
        study["cohorts"][cohort] = {"counts": len(rows), "metrics": {k: v["overall"] for k,v in summaries.items()},
                                   "chosen_minus_reference": comparison}
        print(size, cohort, study["cohorts"][cohort], flush=True)
    study["card_coverage"] = features_by_set
    write(output, study)


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("base", "weights", "sources", "extra", "recent", "output"):
        parser.add_argument(name, type=Path)
    main(**vars(parser.parse_args()))
