# 二車単 7車立ての2025年年間学習

2025年1月1日〜12月31日の365日から男子7車19,925レースを採用し、TransformerとMLPを同じデータで実学習した。2026年1月を検証・校正に、2026年2月1日〜9月1日のうち結果が確認できた147日を最終テストに使用した。年の異なる学習・テスト間でデータを混ぜていない。

| 区分 | 全体 | S級 | A級 | チャレンジ |
| --- | ---: | ---: | ---: | ---: |
| 学習 | 19,925 | 4,627 | 10,835 | 4,463 |
| 検証・校正 | 1,679 | 366 | 922 | 391 |
| 最終テスト | 7,615 | 1,755 | 4,082 | 1,778 |

テスト月別の採用件数は 2月 1,588R、3月 1,559R、4月 1,584R、5月 705R、6月 281R、7月 812R、8月 1,068R、9月 18R。10月以降は適格な出走・払戻・着順が揃わなかった。対象月の全レースを網羅した結果ではない。月別の候補と除外は [取得監査](2T_ANNUAL_7_COVERAGE.json) を参照。

## 実測結果

| 2026年の未学習7,615R | 二車単Top1 | Top3 | Top5 | 1着Top1 | Log Loss ↓ | Brier ↓ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Transformer | 9.23% | 25.58% | 37.03% | 35.08% | 3.3625 | 0.95259 |
| MLP | 9.34% | 25.44% | 37.02% | 35.30% | 3.3600 | 0.95200 |
| 42通り均等 | 2.38%* | 7.14%* | 11.90%* | 14.29%* | 3.7377 | 0.97619 |

\* 均等分布で順位を無作為に決めた場合の理論値。Log LossとBrierは均等配分の値。

学習上限は両モデル12エポック、実行は各12・12エポック、採用エポックはTransformer 7、MLP 2。PyTorch 2.8.0 CPU、バッチ128、車番入替平均8回。校正温度は2026年1月のデータだけで選択し、Transformer 1.25、MLP 1.0。校正前後の数値、モデルとデータのSHA-256は [実測JSON](2T_ANNUAL_7_METRICS.json) に記録した。

### 学習件数の比較

MLPについて、学習候補19,925Rの保存順で `random.Random(11).sample(train_ids, 403)` を使い、選んだ403Rで同じ構成・学習上限から学習した。各レースの特徴量、校正データ1,679R、最終テスト7,615Rを共通にした。403R版のTop1は 5.11%、Log Lossは 3.7235。全量版は 9.34%、Log Loss 3.3600。抽出は1回で、同じエポック上限でも更新回数は異なる。V1の403Rを使った比較とは区別する。

## 発走前データの確認範囲

年次取得・過去成績の再構成と損失関数は [9車の年次研究](2T_ANNUAL_RESEARCH.md) と共通。発走前版の証跡を確保できなかった過去の並びは入力に用いず、Bの選手は1〜3着の確率を計算する際に全候補を合算した。Bの正解を使った教師あり学習、締切前オッズとの比較、回収率評価は未実施。

月ごとの先頭1レースを対象とした独立照合では、21件中21件で楽天KドリームスとnetkeirinのB・上位3着・払戻が一致した。公開ページの予想並びを抽出できたのは21件。いずれも発走前の掲載時点は未確認。 [照合ログ](2T_ANNUAL_7_CROSSCHECK.json)

## 再現コマンド

```sh
python -m two_t.annual_archive --cache /tmp/2t-monthly --out /tmp/2t-annual --size 7
python -m two_t.annual_train /tmp/2t-annual/annual-7.json /tmp/2t-annual-fit transformer --epochs 12 --repeats 8
python -m two_t.annual_train /tmp/2t-annual/annual-7.json /tmp/2t-annual-fit mlp --epochs 12 --repeats 8
python -m two_t.annual_crosscheck /tmp/2t-annual/annual-7.json --cache /tmp/2t-monthly --out /tmp/2t-annual/crosscheck-7.json
python -m unittest discover -s tests/two_t -q
```

学習済み重みは `2T_7car_2025_research_weights.zip`。本番V1には適用していない。

