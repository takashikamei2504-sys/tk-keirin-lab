# 7車二車単の期間拡張監査

## 2026-08-18〜11-01の掲載ラインと決着

11月4日以降の時系列モデル検証を補うため、その前の76日間を調査した。90日監査に使った公開日別JSONの固定リビジョン `4588ec938a2fec9e81216d3fd3423329805aa3d5` と、各日ファイルのSHA-256を照合した。重複IDは0件。男子7車で全員の掲載位置が重複なく揃い、1着・2着を一意に判定できる4,437Rを集計した。異常なライン71R、着順欠損28R、対象外1,203Rを除外。二車単払戻・着順の詳細がある場合は先頭2着と照合した。

| 期間・区分 | R | 同ライン1・2着 | 同ライン率 |
| --- | ---: | ---: | ---: |
| 8/18〜8/31 | 865 | 479 | 55.38% |
| 9月 | 1,747 | 1,008 | 57.70% |
| 10月 | 1,764 | 1,013 | 57.43% |
| 11/1 | 61 | 36 | 59.02% |
| 全体 | 4,437 | 2,536 | 57.16% |
| S級 | 1,033 | 565 | 54.70% |
| A級 | 2,319 | 1,323 | 57.05% |
| チャレンジ | 1,085 | 648 | 59.72% |
| 二車単払戻と着順が配信内で一致した分 | 937 | 546 | 58.27% |

実際の1着を固定し、残り6人の2着を均等に置いた場合、同ラインの平均確率はライン人数によって27.20%。掲載ラインが2着に残る傾向を確認した。4,437R中1,901Rは別線決着で、同ラインを固定することには向かない。掲載ラインが発走前に保存された時刻は全件について立証できず、この長期集計はモデルの学習・精度・収益率に算入していない。

勝者の所属ライン人数によって、同ライン率は大きく異なった。2人ラインは692/1,562R（44.30%）、3人ラインは1,550/2,285R（67.83%）、4人ラインは281/352R（79.83%）。単騎225Rでは定義上0%。5人ラインは13Rのみ。この分類は勝者が分かった後の集計であり、レース前に勝者を知ることはできない。

## 2026-11-03の時系列感度確認

11月2日の確定済み25Rだけで学習し、翌11月3日の未学習46Rを追加で採点。標本の少ない初期条件として、2日以上で初期学習した既存722Rと区別する。

| 候補 | 二車単 Log Loss | 上位3点 |
| --- | ---: | ---: |
| 共通入力 | 3.9583 | 34.78% |
| 同ラインかだけ追加 | 3.6258 | 34.78% |
| 前後関係まで追加 | 3.7348 | 32.61% |
| 均等 | 3.7377 | 7.14% |

## 再現

`python -m two_t.v2_archive_line_audit --source PATH_TO_PUBLIC_DAILY_DATA --manifest-bundle PATH_TO_90DAY_AUDIT.zip --first 2026-08-18 --last 2026-11-01 --out /tmp/2T_V2_ARCHIVE_LINE_AUDIT.json`

11月3日分は `python -m two_t.v2_experiment` の `one_day_warmup_sensitivity`。

## 2026-11-17の発走前保存カードを46Rへ拡張

観測台帳 `0e642f9628827ac0d191860920a07a6f76aa5574` の60枚のカードを使用。更新したのは結果の照合のみ。楽天Kドリームスとnetkeirinで結果・選手IDを照合し、21:26:57 JST時点で22Rから46Rに増えた。13Rは結果観測時間前。小松島10Rは通常の結果ラベルを揃えられず保留。締切10分前オッズが適格で結果も揃ったのは5Rから7R。研究候補は既存の学習条件を固定して発走前カードから事後再計算した。

| 予想 | 二車単 Log Loss・46R | 上位3点・46R | 締切10分前比較・7R |
| --- | ---: | ---: | ---: |
| 共通入力 | 3.0900 | 34.78% | 3.4248 |
| 同ラインだけ追加 | 2.9364 | 43.48% | 3.4079 |
| ラインの前後も追加 | 2.9685 | 45.65% | 3.2905 |
| 近走＋ライン | 2.9548 | 45.65% | 3.2968 |
| 締切10分前市場 | — | — | 3.0196 |

締切10分前の7Rではどの候補も市場のLog Lossを上回れなかった。候補自身の発走前固定実績での比較と回収率は未検証。

再計算には上記コミットの観測台帳のコピーへ `2T_V2_NOV17_RESULT_ADDITIONS.json` の追加分を適用する。既存のカード・オッズ・予測はそのまま使う。

```sh
python - PATH_TO_LEDGER_COPY <<'PY'
from pathlib import Path
import sys
from two_t.ledger import ledger_path, store_once
from two_t.source import payload

ledger = Path(sys.argv[1])
bundle = payload(Path("docs/2T_V2_NOV17_RESULT_ADDITIONS.json"))
for folder, entries in bundle["additions"].items():
    if folder not in {"review-results", "results"}:
        raise ValueError(folder)
    for filename, record in entries.items():
        target = ledger_path(ledger / folder, record["race_id"])
        if target.name != filename:
            raise ValueError(filename)
        store_once(ledger / folder, record["race_id"], record)
PY
python -m two_t.v2_experiment PATH_TO_V1_EVIDENCE.zip --ledger PATH_TO_LEDGER_COPY \
  --as-of 2026-11-17T21:26:57+09:00 --out /tmp/2T_V2_EXPERIMENT.json
```
