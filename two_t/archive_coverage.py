"""Audit older public archive revisions without importing them into model inputs."""

import argparse
from collections import Counter, defaultdict
from datetime import date, timedelta
import json
from pathlib import Path
import re
import subprocess
import unicodedata

from .source import JST, stamp, write


ENTRIES_NAME = re.compile(r"entries_(\d{8})\.json")
RESULTS_NAME = re.compile(r"results_(\d{8})\.json")


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def snapshot(repo, rev, path):
    return json.loads(git(repo, "show", f"{rev}:{path}"))


def changes(repo, rev):
    """Read only reachable public revisions. Commit timestamps are source metadata."""
    names = git(repo, "log", "--first-parent", "--reverse", "--format=@%H %cI",
                "--name-only", rev, "--", "entries_*.json", "today_entries.json").decode()
    for line in names.splitlines():
        if line.startswith("@"):
            commit, saved = line[1:].split()
            when = stamp(saved)
        elif line and (ENTRIES_NAME.fullmatch(line) or line == "today_entries.json"):
            yield commit, when, line


def norm(value):
    return "".join(unicodedata.normalize("NFKC", value).split())


def roster(rows):
    players = {r["umaban"]: norm(r["name"]) for r in rows}
    if len(players) != len(rows) or not all(players.values()):
        raise ValueError("invalid roster")
    return players


def valid_pair(value, players):
    parts = value.split("-")
    return len(parts) == 2 and all(s.isdecimal() for s in parts) and len(set(parts)) == 2 and all(
        int(s) in players for s in parts)


def assess_result(result, players):
    finishers = roster(result["finishers"])
    if any(players.get(no) != name for no, name in finishers.items()):
        return None
    exacta = [q for q in result["paybacks"] if q["type"] == "2車単"
              and type(q["payout"]) is int and q["payout"] > 0 and valid_pair(q["combination"], players)]
    back_keys = {"back", "back_leader", "is_back"}
    back = bool(back_keys & result.keys()) or any(back_keys & r.keys() for r in result["finishers"])
    return bool(exacta), back


def audit(repo, rev):
    head = git(repo, "rev-parse", rev).decode().strip()
    grouped = defaultdict(dict)
    examined = skipped = 0
    for commit, when, path in changes(repo, head):
        file_date = ENTRIES_NAME.fullmatch(path)
        if file_date and file_date[1] < when.astimezone(JST).strftime("%Y%m%d"):
            continue
        try:
            item = snapshot(repo, commit, path)
            text = item["date"]
            day = date.fromisoformat(text) if "-" in text else date(int(text[:4]), int(text[4:6]), int(text[6:8]))
        except (subprocess.CalledProcessError, ValueError, KeyError, TypeError, AttributeError):
            skipped += 1
            continue
        examined += 1
        if not -1 <= (day - when.astimezone(JST).date()).days <= 2:
            continue
        for row in item["races"]:
            riders = row["entries"]
            if len(riders) not in (7, 9):
                continue
            try:
                starts = stamp(f"{day}T{row['start_time']}:00+09:00")
                players = roster(riders)
            except (ValueError, KeyError, TypeError):
                continue
            if when >= starts or not row["race_id"].startswith(day.strftime("%Y%m%d")):
                continue
            if when <= starts - timedelta(minutes=10):
                group = day.strftime("%Y%m%d")
                grouped[group].setdefault(row["race_id"], {"players": players, "cars": len(riders),
                    "lineup_field": bool(row.get("lineup") or row.get("lines") or row.get("line_position")),
                    "sex_field": any(k in row for k in ("is_girls", "gender")),
                    "rider_ids": all(r.get("rider_id") or r.get("player_id") for r in riders)})
    names = git(repo, "ls-tree", "--name-only", head).decode().splitlines()
    available = {m[1]: s for s in names if (m := RESULTS_NAME.fullmatch(s))}
    month = defaultdict(Counter)
    totals = Counter()
    fields = defaultdict(Counter)
    for day, rows in sorted(grouped.items()):
        doc = snapshot(repo, head, available[day]) if day in available else {}
        results = {r["race_id"]: r for r in doc.get("results", [])}
        for rid, record in rows.items():
            keys = ["prestart_10min"]
            for name in ("lineup_field", "sex_field", "rider_ids"):
                if record[name]:
                    keys.append(name)
            if rid in results:
                keys.append("result_id_match")
                checked = assess_result(results[rid], record["players"])
                if checked is not None:
                    keys.append("result_visible_names_match")
                    if checked[0]:
                        keys.append("exacta_payout")
                    if checked[1]:
                        keys.append("back_field")
                    if checked[0] and checked[1] and all(record[k] for k in ("lineup_field", "sex_field", "rider_ids")):
                        keys.append("complete_v1")
            for key in keys:
                totals[key] += 1
                month[day[:4] + "-" + day[4:6]][key] += 1
                fields[str(record["cars"])][key] += 1
    for key in ("lineup_field", "sex_field", "rider_ids", "back_field", "complete_v1"):
        totals.setdefault(key, 0)
    return {"ref": head, "date_range": [min(grouped), max(grouped)] if grouped else [],
            "entry_dates": len(grouped), "revisions_examined": examined, "bad_revisions": skipped,
            "totals": dict(totals), "months": month, "cars": fields,
            "notes": ["Unique race_id; earliest roster is compared with displayed result names.",
                      "Time gate uses upstream Git commit timestamp and scheduled start, not sales close.",
                      "Missing gender is not inferred; 7/9 cohorts are candidate only until classified.",
                      "A named field is schema evidence only; a flagged complete row would require validation before import."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--ref", default="HEAD")
    args = parser.parse_args()
    write(args.out, audit(args.archive, args.ref))
