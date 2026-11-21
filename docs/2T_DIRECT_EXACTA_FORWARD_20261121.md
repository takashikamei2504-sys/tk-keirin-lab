# 二車単前向き比較｜11月21日更新

11月21日の公開出走表57Rから54R（7車43R、9車11R）の予測を固定し、GitHubに07:55:45保存。最も早い発売締切は09:05。全54Rが締切10分前条件を満たす。男子対象外2R・必須項目不足1R。

[本日の予測一覧](2T_DIRECT_EXACTA_PREDICTIONS_20261121.md)

11月18〜20日の180Rを復元。前回精算121Rをハッシュ照合の上で再利用し、43Rを新規精算。累積164R、未照合16R。全3日とも保存済みのGitHubコミット時刻を発売締切と比較して適格性を検査した。

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
| 2026-11-20 | 7車 | 改善候補 | 39 | 6/39（15.4%） | 13/39（33.3%） | 2.96734 |
| 2026-11-20 | 7車 | 年次MLP | 39 | 4/39（10.3%） | 8/39（20.5%） | 3.43160 |
| 2026-11-20 | 9車 | 改善候補 | 4 | 0/4（0.0%） | 2/4（50.0%） | 3.31671 |
| 2026-11-20 | 9車 | 年次MLP | 4 | 0/4（0.0%） | 1/4（25.0%） | 4.15847 |
| 累積 | 7車 | 改善候補 | 150 | 18/150（12.0%） | 43/150（28.7%） | 3.15069 |
| 累積 | 7車 | 年次MLP | 150 | 12/150（8.0%） | 32/150（21.3%） | 3.49146 |
| 累積 | 9車 | 改善候補 | 14 | 1/14（7.1%） | 5/14（35.7%） | 3.33491 |
| 累積 | 9車 | 年次MLP | 14 | 0/14（0.0%） | 1/14（7.1%） | 4.22436 |

Log Lossは低いほど良い。観測日は3日であり、日単位ブートストラップの区間が狭くても採用判断に十分な日数があるとは扱わない。市場比較・校正評価・締切前オッズとEV回収率の検証は未実施。本番採用と収益優位性は判定保留。

未照合16Rは、事前の全着順・最終Bを必須とする照合条件に達しない。実運用回収率の評価では、結果を見た棄権・失格レースの除外は行えない。

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
| 202611202209 | netkeirin finish order is irregular |
| 202611202605 | netkeirin finish order is irregular |
| 202611204204 | netkeirin finish order is irregular |
| 202611204209 | netkeirin finish order is irregular |
| 202611208104 | netkeirin finish order is irregular |
| 202611208107 | netkeirin finish order is irregular |
| 202611208108 | netkeirin finish order is irregular |
| 202611208110 | netkeirin finish order is irregular |

PyTorch 2.7.1+cpu。モデル重み4種のSHA-256照合、月別入力35ファイルの固定blobハッシュ照合が通過。二車単テスト46件通過。

主要コマンドを実行した。

```sh
python -m two_t.exacta_forward freeze --ledger ../ledger-20261121 --weights ../weights --monthly ../monthly
python -m two_t.exacta_forward archive --ledger ../ledger-20261121 --date 2026-11-21 --archive data/2t-exacta-forward/2026-11-21
python -m unittest discover -s tests/two_t -q
```

過去日の復元・精算・集計はtwo_t.exacta_forwardのrestore、settle、summarizeを直接呼び出した。公開結果は4並列で先に取得し、同じparse_resultとsettleを使って照合。前回精算は予測SHA-256を照合して再利用した。本日分の保存時刻はGitHubで作成したコミットをgit fetchして確認した。
