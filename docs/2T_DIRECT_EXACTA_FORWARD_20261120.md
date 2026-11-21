# 二車単前向き比較｜11月20日更新

11月20日の公開出走表57Rから51R（7車43R、9車8R）の予測を固定し、GitHubに07:20:56保存。最も早い発売締切は09:26。全51Rが締切10分前条件を満たす。男子対象外6R。

[本日の予測一覧](2T_DIRECT_EXACTA_PREDICTIONS_20261120.md)

11月18日・19日の129Rを復元。前回精算63Rをハッシュ照合の上で再利用し、58Rを新規精算。累積121R、未照合8R。両日ともGitHub保存時刻を発売締切と比較して適格性を検査した。

| 期間 | 車立て | モデル | 照合R | Top1 | Top3 | Log Loss |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 2026-11-18 | 7車 | 改善候補 | 58 | 4/58（6.9%） | 16/58（27.6%） | 3.23511 |
| 2026-11-18 | 7車 | 年次MLP | 58 | 5/58（8.6%） | 12/58（20.7%） | 3.56363 |
| 2026-11-18 | 9車 | 改善候補 | 5 | 1/5（20.0%） | 2/5（40.0%） | 2.84166 |
| 2026-11-18 | 9車 | 年次MLP | 5 | 0/5（0.0%） | 0/5（0.0%） | 4.21009 |
| 2026-11-19 | 7車 | 改善候補 | 53 | 8/53（15.1%） | 14/53（26.4%） | 3.19323 |
| 2026-11-19 | 7車 | 年次MLP | 53 | 3/53（5.7%） | 12/53（22.6%） | 3.45655 |
| 2026-11-19 | 9車 | 改善候補 | 5 | 0/5（0.0%） | 1/5（20.0%） | 3.84271 |
| 2026-11-19 | 9車 | 年次MLP | 5 | 0/5（0.0%） | 0/5（0.0%） | 4.29133 |
| 累積 | 7車 | 改善候補 | 111 | 12/111（10.8%） | 30/111（27.0%） | 3.21511 |
| 累積 | 7車 | 年次MLP | 111 | 8/111（7.2%） | 24/111（21.6%） | 3.51250 |
| 累積 | 9車 | 改善候補 | 10 | 1/10（10.0%） | 3/10（30.0%） | 3.34218 |
| 累積 | 9車 | 年次MLP | 10 | 0/10（0.0%） | 0/10（0.0%） | 4.25071 |

Log Lossは低いほど良い。観測日は2日であり、日単位ブートストラップの区間が狭くても採用判断に十分な日数があるとは扱わない。市場比較・校正評価・締切前オッズとEV回収率の検証は未実施。本番採用と収益優位性は判定保留。

未照合8Rは、事前の全着順・最終Bを必須とする照合条件に達しない。実運用回収率の評価では、結果を見た棄権・失格レースの除外は行えない。

| レースID | 理由 |
| --- | --- |
| 202611182603 | netkeirin finish order is irregular |
| 202611182610 | netkeirin finish order is irregular |
| 202611187404 | netkeirin finish order is irregular |
| 202611188105 | netkeirin finish order is irregular |
| 202611188109 | netkeirin finish order is irregular |
| 202611192402 | netkeirin finish order is irregular |
| 202611192609 | netkeirin finish order is irregular |
| 202611194406 | netkeirin finish order is irregular |

PyTorch 2.7.1+cpu。モデル重み4種のSHA-256照合、月別入力35ファイルの固定blobハッシュ照合が通過。二車単テスト46件通過。

主要コマンドを実行した。

```sh
python -m two_t.exacta_forward freeze --ledger ../ledger-20261120 --weights ../weights --monthly ../monthly
python -m two_t.exacta_forward archive --ledger ../ledger-20261120 --date 2026-11-20 --archive data/2t-exacta-forward/2026-11-20
python -m unittest discover -s tests/two_t -q
```

過去日の復元・精算・集計はtwo_t.exacta_forwardのrestore、settle、summarizeを直接呼び出した。公開結果は4並列で先に取得し、同じparse_resultとsettleを使って照合。前回精算は予測SHA-256を照合して再利用した。GitHub公開APIが403だったため、保存時刻はGitHubで作成したコミットをgit fetchして確認した。
