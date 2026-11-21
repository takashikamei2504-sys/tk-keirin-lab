# 二車単前向き比較｜11月22日更新

11月22日の公開出走表68Rから64R（7車53R、9車11R）の予測を固定し、GitHubに07:35:55保存。最も早い発売締切は08:45。全64Rが締切10分前条件を満たす。男子対象外2R・必須項目不足1R・車立て不適合1R。

[本日の予測一覧](2T_DIRECT_EXACTA_PREDICTIONS_20261122.md)

11月18〜21日の234Rを復元。前回精算164Rをハッシュ照合の上で再利用し、49Rを新規精算。累積213R、未照合21R。全4日とも保存済みのGitHubコミット時刻を発売締切と比較して適格性を検査した。

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
| 2026-11-21 | 7車 | 改善候補 | 40 | 8/40（20.0%） | 11/40（27.5%） | 2.96954 |
| 2026-11-21 | 7車 | 年次MLP | 40 | 5/40（12.5%） | 11/40（27.5%） | 3.29019 |
| 2026-11-21 | 9車 | 改善候補 | 9 | 2/9（22.2%） | 2/9（22.2%） | 3.93900 |
| 2026-11-21 | 9車 | 年次MLP | 9 | 0/9（0.0%） | 0/9（0.0%） | 4.24028 |
| 累積 | 7車 | 改善候補 | 190 | 26/190（13.7%） | 54/190（28.4%） | 3.11255 |
| 累積 | 7車 | 年次MLP | 190 | 17/190（8.9%） | 43/190（22.6%） | 3.44909 |
| 累積 | 9車 | 改善候補 | 23 | 3/23（13.0%） | 7/23（30.4%） | 3.57129 |
| 累積 | 9車 | 年次MLP | 23 | 0/23（0.0%） | 1/23（4.3%） | 4.23059 |

Log Lossは低いほど良い。観測日は4日であり、日単位ブートストラップの区間が狭くても採用判断に十分な日数があるとは扱わない。市場比較・校正評価・締切前オッズとEV回収率の検証は未実施。改善候補は既存の本番画面で暫定表示中。市場・収益優位性の正式判定は保留。

未照合21Rのうち、福井4R・5Rの2Rは結果ページで中止を確認し、残る19Rは全着順が不規則。これらは事前の全着順・最終Bを必須とする照合条件に達しない。実運用回収率の評価では、結果を見た棄権・失格レースの除外は行えない。

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
| 202611214507 | netkeirin finish order is irregular |
| 202611215104 | missing netkeirin result rows |
| 202611215105 | missing netkeirin result rows |
| 202611218105 | netkeirin finish order is irregular |
| 202611218106 | netkeirin finish order is irregular |

PyTorch 2.7.1+cpu。モデル重み4種のSHA-256照合、月別入力35ファイルの固定blobハッシュ照合が通過。二車単テスト46件通過。

主要コマンドを実行した。

```sh
python -m two_t.exacta_forward freeze --ledger ../ledger-20261122 --weights ../weights --monthly ../monthly
python -m two_t.exacta_forward archive --ledger ../ledger-20261122 --date 2026-11-22 --archive data/2t-exacta-forward/2026-11-22
python -m unittest discover -s tests/two_t -q
```

過去日の復元・精算・集計はtwo_t.exacta_forwardのrestore、settle、summarizeを直接呼び出した。公開結果は4並列で先に取得し、同じparse_resultとsettleを使って照合。前回精算は予測SHA-256を照合して再利用した。本日分の保存時刻はGitHubで作成したコミットをgit fetchして確認した。
