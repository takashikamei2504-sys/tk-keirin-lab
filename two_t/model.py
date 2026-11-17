"""Chapter 3.3 factorization and joint-class baseline."""
from itertools import permutations, product
import math

import torch
from torch import nn
from torch.nn import functional as F


def classes(n):
    return torch.tensor([(b, *finish) for b, finish in product(range(n), permutations(range(n), 3))])


def permutation_batch(batch, n, generator):
    return torch.rand(batch, n, generator=generator).argsort(dim=1)


def permute(c, x, r, y, order):
    b = torch.arange(x.size(0))[:, None]
    rows = x[b, order]
    relation = r[b[:, :, None], order[:, :, None], order[:, None, :]]
    remapped = order.argsort(dim=1).gather(1, y) if y is not None else None
    return c, rows, relation, remapped


def positional(n, width):
    radians = torch.arange(n)[:, None] * torch.exp(-math.log(10000) * torch.arange(0, width, 2) / width)
    return torch.stack((radians.sin(), radians.cos()), dim=-1).flatten(1)


class PaperTransformer(nn.Module):
    def __init__(self, n, common, personal):
        super().__init__()
        self.n = n
        self.input_size = common + personal + n * 3
        self.source_input = nn.Linear(self.input_size, 128)
        self.target_input = nn.Linear(self.input_size, 128)
        self.encoder = nn.TransformerEncoder(
            nn.TransformerEncoderLayer(128, 1, 256, batch_first=True), 6, enable_nested_tensor=False)
        self.decoder = nn.TransformerDecoder(
            nn.TransformerDecoderLayer(128, 1, 256, batch_first=True), 4)
        self.output = nn.Linear(128, n)
        self.register_buffer("positions", positional(n, 128))

    def encode(self, c, x, r):
        tokens = torch.cat((c[:, None].expand(-1, self.n, -1), x, r.flatten(2)), 2)
        memory = self.encoder(self.source_input(tokens) + self.positions)
        return tokens, memory

    def decode(self, tokens, memory, prior):
        batch = torch.arange(tokens.shape[0], device=tokens.device)[:, None]
        length = 1 + prior.size(1)
        embedded = self.target_input(torch.cat((torch.zeros_like(tokens[:, :1]), tokens[batch, prior]), 1))
        causal = torch.ones((length, length), device=tokens.device, dtype=torch.bool).triu(1)
        logits = self.output(self.decoder(embedded + self.positions[:length], memory, tgt_mask=causal))
        # B can also finish in any position. Only previously occupied finishes are masked.
        invalid = torch.zeros_like(logits, dtype=torch.bool)
        for step in range(2, length):
            invalid[:, step].scatter_(1, prior[:, 1:step], True)
        return logits.masked_fill(invalid, -torch.inf)

    def loss(self, c, x, r, labels):
        logits = self.decode(*self.encode(c, x, r), labels[:, :3])
        return F.cross_entropy(logits.transpose(1, 2), labels)

    def distribution(self, c, x, r, full=False):
        batch, n = x.shape[:2]
        tokens, memory = self.encode(c, x, r)
        identity = torch.arange(n)
        b, first = identity.repeat_interleave(n), identity.repeat(n)
        if full:
            grid = torch.tensor([(b, i, j) for b, (i, j) in product(range(n), permutations(range(n), 2))])
            _, first, second = grid.T
        else:
            grid = torch.stack((b, first), 1)
        width = len(grid)
        prefix = grid.repeat(batch, 1)
        logits = self.decode(tokens.repeat_interleave(width, 0), memory.repeat_interleave(width, 0), prefix)
        prob = logits.softmax(-1)
        row = torch.arange(len(prob))
        joint2 = prob[row, 0, prefix[:, 0]] * prob[row, 1, prefix[:, 1]]
        if full:
            joint = joint2 * prob[row, 2, prefix[:, 2]] * prob[:, 3].sum(1)
            # Each first/second pair occurs once for each possible B.
            exacta = torch.zeros(batch, n * n)
            exacta.scatter_add_(1, (first * n + second).expand(batch, -1), joint.view(batch, width))
        else:
            exacta = (joint2[:, None] * prob[:, 2]).view(batch, n, n, n).sum(1).flatten(1)
        return exacta.view(batch, n, n), prob.view(batch, width, -1, n)[:, 0, 0]


class PaperMLP(nn.Module):
    def __init__(self, n, common, personal):
        super().__init__()
        self.n = n
        options = classes(n)
        self.register_buffer("options", options)
        lookup = torch.full((n, n, n, n), -1)
        lookup[tuple(options.T)] = torch.arange(len(options))
        self.register_buffer("lookup", lookup)
        self.layers = nn.Sequential(
            nn.Linear(common + n * personal + n * n * 3, 1024), nn.BatchNorm1d(1024), nn.ReLU(),
            nn.Linear(1024, 512), nn.BatchNorm1d(512), nn.ReLU(), nn.Linear(512, len(options)))

    def forward(self, c, x, r):
        return self.layers(torch.cat((c, x.flatten(1), r.flatten(1)), 1))

    def loss(self, c, x, r, labels):
        return F.cross_entropy(self(c, x, r), self.lookup[tuple(labels.T)])

    def distribution(self, c, x, r, full=False):
        p = self(c, x, r).softmax(1)
        b, first, second, _ = self.options.T
        two = p.new_zeros(len(x), self.n * self.n)
        back = p.new_zeros(len(x), self.n)
        two.scatter_add_(1, (first * self.n + second).expand(len(x), -1), p)
        back.scatter_add_(1, b.expand(len(x), -1), p)
        return two.view(-1, self.n, self.n), back


def make(model, n, common, personal):
    return {"transformer": PaperTransformer, "mlp": PaperMLP}[model](n, common, personal)


@torch.inference_mode()
def predict(model, c, x, r, repeats=100, seed=11):
    """Average permutation-restored output, including the B distribution."""
    if not 1 <= repeats <= 100 or c.size(0) != 1:
        raise ValueError("predict expects one race and 1–100 permutations")
    model.eval()
    n = model.n
    generator = torch.Generator().manual_seed(seed)
    order = permutation_batch(repeats, n, generator)
    probabilities, back = [], []
    for indices in order.split(16):
        count = len(indices)
        pc, px, pr, _ = permute(c.expand(count, -1), x.expand(count, -1, -1),
                               r.expand(count, -1, -1, -1), None, indices)
        two, b = model.distribution(pc, px, pr)
        inverse = indices.argsort(1)
        rows = torch.arange(count)[:, None, None]
        probabilities.append(two[rows, inverse[:, :, None], inverse[:, None, :]])
        back.append(b.gather(1, inverse))
    return torch.cat(probabilities).mean(0), torch.cat(back).mean(0)
