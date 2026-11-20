# 二車単前向き比較｜11月19日更新

11月19日は公開出走表75Rから61R（7車56R、9車5R）の両モデル予測を07:57台に固定し、GitHubへ07:58:26（日本時間）に保存した。最も早い発売締切は09:05。全61RがGitHub保存時刻でも締切10分前条件を満たした。

[本日の予測一覧](2T_DIRECT_EXACTA_PREDICTIONS_20261119.md)

11月18日の保存済み68Rを復元し、保存モデルの確率と確定結果をレース単位で照合した。GitHub初回保存は06:55:42で、68R全件が締切10分前条件を満たした。

| 対象 | モデル | 照合R | Top1 | Top3 | Log Loss |
| --- | --- | ---: | ---: | ---: | ---: |
| 7車 | 改善候補 | 58 | 4/58（6.9%） | 16/58（27.6%） | 3.23511 |
| 7車 | 年次MLP | 58 | 5/58（8.6%） | 12/58（20.7%） | 3.56363 |
| 9車 | 改善候補 | 5 | 1/5（20.0%） | 2/5（40.0%） | 2.84166 |
| 9車 | 年次MLP | 5 | 0/5（0.0%） | 0/5（0.0%） | 4.21009 |

Log Lossは低いほど良い。1日分の比較で、本番採用・市場優位性・収益優位性の判断は保留。

未照合は5R。事前の照合実装は全選手ID・車番・全着順・唯一の最終B・二車単払戻の一致を必須とする。次表のレースはこの厳格な確率比較の集計外。実運用回収率を集計する際には棄権・失格レースも対象に含める必要がある。

| レースID | 未照合理由 |
| --- | --- |
| 202611182603 | netkeirin finish order is irregular |
| 202611182610 | netkeirin finish order is irregular |
| 202611187404 | netkeirin finish order is irregular |
| 202611188105 | netkeirin finish order is irregular |
| 202611188109 | netkeirin finish order is irregular |

締切10分前オッズの保存・照合、EV1.5回収率、市場比較は未実施。

実行環境はPyTorch 2.7.1+cpu。重み4種は実装内のSHA-256照合を通過。月別入力35ファイルは固定Git blob SHAで照合した。二車単テスト46件が通過。

実行した主要コマンドは次のとおり。

```sh
python -m two_t.exacta_forward freeze --ledger ../ledger --weights ../weights --monthly ../monthly
python -m two_t.exacta_forward archive --ledger ../ledger --date 2026-11-19 --archive data/2t-exacta-forward/2026-11-19
python -m two_t.exacta_forward restore --ledger ../past-ledger --archive data/2t-exacta-forward/2026-11-18
python -m two_t.exacta_forward settle --ledger ../past-ledger --budget-seconds 180
python -m two_t.exacta_forward summary --ledger ../past-ledger
python -m unittest discover -s tests/two_t -q
```

初回settleの時間予算到達後、取得済みの確定結果HTMLを同じsettle関数・同じparse_resultに渡し、残りを照合した。結果の取得エラーは未照合理由に残す。前回の精算ファイルは研究ブランチ内に存在せず、新規に追記した。
