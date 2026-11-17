"""Fit and calibrate on chronological partitions, then score the untouched split."""
import argparse
from collections import Counter
from hashlib import sha256
import math
from pathlib import Path
from time import perf_counter

import torch

from .model import make, permutation_batch, permute, predict
from .source import HOLDOUT, VALIDATION, payload, split, stamp, write

SEED = 11
BATCH = 512


def usable_label(row):
    result = row["result"]
    if not result or not result["confirmed"] or not result["labels"] or not result["decided_at"]:
        return False
    day = stamp(result["decided_at"]).astimezone(stamp("2026-01-01T00:00:00+09:00").tzinfo).date()
    if row["split"] == "train":
        return day < VALIDATION
    return row["split"] == "test" or day < HOLDOUT


def raw_matrix(values):
    return torch.tensor([[math.nan if v is None else v for v in row] for row in values],
                        dtype=torch.float32)


def minmax(matrix):
    observed = torch.isfinite(matrix)
    low = torch.where(observed, matrix, torch.inf).amin(0)
    high = torch.where(observed, matrix, -torch.inf).amax(0)
    active = observed.any(0)
    return torch.where(active, low, 0), torch.where(active & (high > low), high - low, 1), active


def transform(matrix, stats):
    low, span, active = stats
    known = torch.isfinite(matrix) & active
    return torch.cat((torch.where(known, (matrix - low) / span, 0), (~known).float()), dim=-1)


def fit_scaling(train):
    return (minmax(raw_matrix([row["common"] for row in train])),
            minmax(raw_matrix([rider for row in train for rider in row["personal"]])))


def tensorize(rows, scaling, labels=True):
    n = len(rows[0]["cars"])
    common = transform(raw_matrix([r["common"] for r in rows]), scaling[0])
    personal = transform(raw_matrix([rider for r in rows for rider in r["personal"]]), scaling[1])
    relations = torch.tensor([r["relation"] for r in rows], dtype=torch.float32)
    target = torch.tensor([[r["cars"].index(i) for i in r["result"]["labels"]] for r in rows]) if labels else None
    return common, personal.view(len(rows), n, -1), relations, target


def partitions(rows, n):
    out = {part: [] for part in ("train", "validation", "test")}
    seen = set()
    for row in rows:
        if len(row["cars"]) != n:
            continue
        rid = row["race_id"]
        if rid in seen:
            raise ValueError("duplicate race")
        seen.add(rid)
        if row["split"] != split(row["date"]):
            raise ValueError("split boundary mismatch")
        if not stamp(row["feature_published_at"]) <= stamp(row["saved_at"]) < stamp(row["start"]):
            raise ValueError("future input")
        if usable_label(row) and not (row["result"]["accident"] and row["split"] != "test"):
            out[row["split"]].append(row)
    return out


def fit(model, train, dev, epochs):
    generator = torch.Generator().manual_seed(SEED)
    optimizer = torch.optim.RAdam(model.parameters(), lr=.001)
    minimum, state, best_epoch, trail = math.inf, None, 0, []
    for epoch in range(1, epochs + 1):
        model.train()
        batches = list(torch.randperm(len(train[0]), generator=generator).split(BATCH))
        if len(batches[-1]) == 1:
            # BatchNorm requires at least two races, even on the last batch.
            batches[-2:] = [torch.cat(batches[-2:])]
        for batch in batches:
            features = [t[batch] for t in train]
            order = permutation_batch(len(batch), model.n, generator)
            loss = model.loss(*permute(*features, order))
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            val = model.loss(*dev).item()
        trail.append(val)
        if val < minimum:
            minimum, best_epoch = val, epoch
            state = {key: value.detach().clone() for key, value in model.state_dict().items()}
        stagnant = epoch - best_epoch
        if stagnant == 30:
            break
        if stagnant in (10, 20):
            for group in optimizer.param_groups:
                group["lr"] *= .1
    model.load_state_dict(state)
    return best_epoch, trail


def conform(prob, temperature):
    p = prob.pow(1 / temperature)
    return p / p.sum()


def infer_rows(model, rows, scaling, repeats):
    pred = []
    for row in rows:
        c, x, r, _ = tensorize([row], scaling, labels=False)
        before = perf_counter()
        pair, b = predict(model, c, x, r, repeats=repeats, seed=SEED)
        pred.append((pair, b, perf_counter() - before))
    return pred


def calibrate(rows, output):
    # Fixed grid and validation NLL only. Positive exponent preserves pair ranking.
    grid = (.5, .75, 1., 1.25, 1.5, 2., 3., 4.)
    def loss(t):
        total = 0.
        for row, (p, _, _) in zip(rows, output, strict=True):
            i, j = (row["cars"].index(c) for c in row["result"]["labels"][1:3])
            total -= conform(p, t)[i, j].clamp_min(1e-12).log().item()
        return total / len(rows)
    return min(grid, key=loss), {str(t): loss(t) for t in grid}


def predict_record(row, pred, temp, model_sha):
    probability, b, seconds = pred
    p = conform(probability, temp)
    cars = row["cars"]
    return {"race_id": row["race_id"], "date": row["date"], "venue": row["venue"],
            "race_no": row["race_no"], "class": row["class"], "cars": cars, "start": row["start"],
            "feature_sha256": row["feature_sha256"], "input_as_of": row["saved_at"],
            "model_sha256": model_sha, "seconds": seconds, "back": dict(zip(cars, b.tolist())),
            "probabilities": {f"{a}-{b}": p[i, j].item()
                              for i, a in enumerate(cars) for j, b in enumerate(cars) if a != b}}


def main(file, directory, n, kind, max_epochs, repeats):
    torch.set_num_threads(2)
    torch.manual_seed(SEED)
    torch.use_deterministic_algorithms(True)
    rows = payload(file)
    parts = partitions(rows, n)
    counts = {key: len(items) for key, items in parts.items()}
    print(kind, n, counts, flush=True)
    if counts["train"] < 2 or counts["validation"] < 1 or counts["test"] < 1:
        raise SystemExit("insufficient chronologically eligible samples")
    scaling = fit_scaling(parts["train"])
    train, dev = (tensorize(parts[key], scaling) for key in ("train", "validation"))
    model = make(kind, n, train[0].shape[-1], train[1].shape[-1])
    best, trail = fit(model, train, dev, max_epochs)
    print(kind, n, f"best_epoch={best} epochs_run={len(trail)}", flush=True)
    temperature, grid = calibrate(parts["validation"], infer_rows(model, parts["validation"], scaling, repeats))
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{kind}-{n}.pt"
    torch.save({"version": 1, "state": model.state_dict(), "n": n, "kind": kind, "scaling": scaling,
                "common": train[0].shape[-1], "personal": train[1].shape[-1],
                "temperature": temperature, "repeats": repeats, "seed": SEED}, path)
    digest = sha256(path.read_bytes()).hexdigest()
    metadata = {"model_sha256": digest, "dataset_sha256": sha256(file.read_bytes()).hexdigest(),
                "counts_labelled": counts, "temperature": temperature, "inference_repeats": repeats,
                "calibration_grid": grid, "best_epoch": best, "validation_loss": trail,
                "train_dates": sorted({r["date"] for r in parts["train"]}),
                "validation_dates": sorted({r["date"] for r in parts["validation"]}),
                "test_dates": sorted({r["date"] for r in parts["test"]}),
                "train_classes": dict(Counter(r["class"] for r in parts["train"])),
                "torch": str(torch.__version__)}
    write(directory / f"{kind}-{n}-fit.json", metadata)
    # Predict the complete eligible snapshot set, including unlabelled and accident races.
    test = [r for r in rows if r["split"] == "test" and len(r["cars"]) == n]
    test_pred = infer_rows(model, test, scaling, repeats)
    write(directory / f"{kind}-{n}-predictions.json",
          [predict_record(row, p, temperature, digest) for row, p in zip(test, test_pred, strict=True)])
    print(kind, n, "predictions", len(test), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("n", type=int, choices=[7, 9])
    parser.add_argument("kind", choices=["transformer", "mlp"])
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--repeats", type=int, default=100)
    args = parser.parse_args()
    if args.epochs < 1 or not 1 <= args.repeats <= 100:
        parser.error("positive epochs and 1–100 repeats required")
    main(args.dataset, args.output, args.n, args.kind, args.epochs, args.repeats)
