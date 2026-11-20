"""Train the chapter 3.3 architectures with B latent on reconstructed histories."""
import argparse
from collections import Counter
from datetime import date
from hashlib import sha256
import math
from pathlib import Path
import time

import torch

from .annual_archive import partition
from .model import make, permutation_batch, permute
from .source import payload, write
from .train import SEED, calibrate, conform, fit_scaling, tensorize

BATCH = 128


def observed_log_prob(model, c, x, r, targets, kind):
    """Log P(first, second, third), summing over every possible B."""
    batch, n = x.shape[:2]
    row = torch.arange(batch)[:, None]
    backs = torch.arange(n).expand(batch, -1)
    a, b, d = (target[:, None] for target in targets.T)
    if kind == "mlp":
        indices = model.lookup[backs, a, b, d]
        return model(c, x, r).log_softmax(1)[row, indices].logsumexp(1)
    tokens, memory = model.encode(c, x, r)
    full = torch.cat((backs.reshape(-1, 1), targets.repeat_interleave(n, dim=0)), dim=1)
    logits = model.decode(tokens.repeat_interleave(n, 0), memory.repeat_interleave(n, 0), full[:, :3])
    path = logits.log_softmax(-1).gather(2, full[:, :, None]).squeeze(2).sum(1)
    return path.view(batch, n).logsumexp(1)


def prepare(rows):
    seen = set()
    output = {"train": [], "validation": [], "test": []}
    for r in rows:
        if r["race_id"] in seen or partition(date.fromisoformat(r["date"])) != r["split"]:
            raise ValueError("duplicate race or partition mismatch")
        seen.add(r["race_id"])
        if len(r["targets"]) != 3 or len(set(r["targets"])) != 3:
            raise ValueError("invalid result target")
        n = len(r["cars"])
        output[r["split"]].append(dict(r, relation=[[[0, 0, 0]] * n] * n,
                                       result={"labels": [None, *r["targets"]]}))
    return output


def arrays(rows, scaling):
    c, x, r, _ = tensorize(rows, scaling, labels=False)
    labels = torch.tensor([[row["cars"].index(car) for car in row["targets"]] for row in rows])
    return c, x, r, labels


def train(model, kind, learning, validation, max_epochs):
    rng = torch.Generator().manual_seed(SEED)
    optimizer = torch.optim.RAdam(model.parameters(), lr=.001)
    best = math.inf
    weights = None
    records = []
    for epoch in range(1, max_epochs + 1):
        model.train()
        batches = list(torch.randperm(len(learning[0]), generator=rng).split(BATCH))
        if len(batches[-1]) == 1:
            batches[-2:] = [torch.cat(batches[-2:])]
        for ids in batches:
            batch = [x[ids] for x in learning]
            batch = permute(*batch, permutation_batch(len(ids), model.n, rng))
            loss = -observed_log_prob(model, *batch, kind).mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.inference_mode():
            val = [-observed_log_prob(model, *batch, kind) for batch in zip(
                *(x.split(BATCH) for x in validation), strict=True)]
            error = torch.cat(val).mean().item()
        records.append(error)
        print(kind, "epoch", epoch, "validation rank joint NLL", round(error, 6), flush=True)
        if error < best:
            best, best_epoch = error, epoch
            weights = {k: v.detach().clone() for k, v in model.state_dict().items()}
        if epoch - best_epoch in (10, 20):
            for group in optimizer.param_groups:
                group["lr"] *= .1
        if epoch - best_epoch == 30:
            break
    model.load_state_dict(weights)
    return best_epoch, records


@torch.inference_mode()
def predict_many(model, data, repeats):
    model.eval()
    rng = torch.Generator().manual_seed(SEED)
    n = model.n
    order = permutation_batch(repeats, n, rng)
    inverse = order.argsort(1)
    all_predictions = []
    for c, x, r in zip(*(a.split(4) for a in data[:3]), strict=True):
        count = len(c)
        pc, px, pr, _ = permute(*(z.repeat_interleave(repeats, 0) for z in (c, x, r)),
                                 None, order.repeat(count, 1))
        p, _ = model.distribution(pc, px, pr)
        rows = torch.arange(len(p))[:, None, None]
        i = inverse.repeat(count, 1)
        p = p[rows, i[:, :, None], i[:, None, :]].view(count, repeats, n, n).mean(1)
        if not torch.isfinite(p).all() or (p.diagonal(dim1=1, dim2=2) != 0).any():
            raise ValueError("invalid exacta distribution")
        if not torch.allclose(p.sum((1, 2)), torch.ones(count), atol=1e-6):
            raise ValueError("non-normalized exacta distribution")
        all_predictions.extend(p.unbind(0))
    return all_predictions


def score(rows, estimate, temperature):
    totals = Counter()
    for row, p in zip(rows, estimate, strict=True):
        p = conform(p, temperature)
        car = row["cars"]
        n = len(car)
        i, j = (car.index(x) for x in row["targets"][:2])
        exacta = i * n + j
        values = p.flatten()
        ranking = values.argsort(descending=True).tolist()
        totals["log_loss"] -= math.log(values[exacta].item())
        totals["brier"] += values.square().sum().item() + 1 - 2 * values[exacta].item()
        totals["first_accuracy"] += int(p.sum(1).argmax().item() == i)
        for k in (1, 3, 5):
            totals[f"top{k}"] += int(exacta in ranking[:k])
    return {k: v / len(rows) for k, v in totals.items()}


def main(file, out, kind, epochs, repeats):
    torch.set_num_threads(4)
    torch.manual_seed(SEED)
    torch.use_deterministic_algorithms(True)
    groups = prepare(payload(file))
    if not all(groups.values()):
        raise ValueError("all chronological groups need eligible races")
    n = len(groups["train"][0]["cars"])
    scaling = fit_scaling(groups["train"])
    datasets = {k: arrays(v, scaling) for k, v in groups.items()}
    model = make(kind, n, datasets["train"][0].shape[-1], datasets["train"][1].shape[-1])
    out.mkdir(parents=True, exist_ok=True)
    before = time.perf_counter()
    best, trail = train(model, kind, datasets["train"], datasets["validation"], epochs)
    elapsed = time.perf_counter() - before
    val = predict_many(model, datasets["validation"], repeats)
    temperature, grid = calibrate(groups["validation"], [(p, None, 0) for p in val])
    weights = out / f"{kind}-{n}-latent-b.pt"
    torch.save({"variant": "retrospective-latent-b", "kind": kind, "n": n,
                "state": model.state_dict(), "scaling": scaling, "temperature": temperature,
                "repeats": repeats, "seed": SEED}, weights)
    before = time.perf_counter()
    test = predict_many(model, datasets["test"], repeats)
    test_seconds = time.perf_counter() - before
    stats = {"kind": kind, "cars": n, "counts": {k: len(v) for k, v in groups.items()},
             "dates": {k: sorted({r["date"] for r in v}) for k, v in groups.items()},
             "best_epoch": best, "epoch_limit": epochs, "validation_joint_loss": trail,
             "train_seconds": elapsed, "batch_size": BATCH, "temperature": temperature,
             "calibration_grid": grid, "test_uncalibrated": score(groups["test"], test, 1.),
             "test_calibrated": score(groups["test"], test, temperature),
             "uniform_log_loss": math.log(n * (n - 1)), "repeats": repeats,
             "test_seconds": test_seconds, "torch": str(torch.__version__),
             "weights_sha256": sha256(weights.read_bytes()).hexdigest(),
             "dataset_sha256": sha256(file.read_bytes()).hexdigest()}
    write(out / f"{kind}-{n}-metrics.json", stats)
    print(kind, "TEST", stats["counts"]["test"], stats["test_calibrated"], flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("kind", choices=("transformer", "mlp"))
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--repeats", type=int, default=8)
    args = parser.parse_args()
    if args.epochs < 1 or not 1 <= args.repeats <= 100:
        parser.error("positive epochs and 1–100 repeats required")
    main(args.data, args.out, args.kind, args.epochs, args.repeats)
