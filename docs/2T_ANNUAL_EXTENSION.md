# 二車単 年間学習モデルの追加評価

2026年9月1日〜11月16日を対象とし、元の学習・校正・テストに含まれないレースに、7車・9車の学習済みモデルを適用した。楽天Kドリームスの日別払戻77/77日分から、一意の二車単と三連単の1〜2着が一致する結果を抽出し、月別CSVのレースID・開催日・会場・出走車番に結び付けた。三連単の記録は上位3着の確定照合に使用した。

| 月 | 7車の追加 | 9車の追加 |
| --- | ---: | ---: |
| 2026-09 | 1,543 | 174 |
| 2026-10 | 1,325 | 142 |
| 2026-11 | 749 | 113 |
| 計 | 3,617 | 429 |

予測には既存の月別CSVから7日以上前の結果だけを使って再構成した特徴量と、年間学習で採用した重み・正規化・校正を利用した。今回取得した結果を特徴量へ追加していない。

| 車立て | モデル | Top1 | Top3 | Log Loss ↓ |
| --- | --- | ---: | ---: | ---: |
| 7車 | transformer | 8.13% | 22.78% | 3.4181 |
| 7車 | mlp | 8.49% | 23.20% | 3.4056 |
| 9車 | transformer | 0.00% | 1.40% | 4.2776 |
| 9車 | mlp | 1.63% | 6.06% | 4.2598 |

公開詳細・netkeirinとの照合は各月・車立ての最初の追加レースを対象として6/6件が一致した。範囲全体の車番別全着順、落車・欠場・失格、Bおよび発走前のカードの版を検証できていない。旧テストは全着順を確認した通常レース。今回は一意の払戻から復元した着順の評価として別集計。オッズと回収率は対象外。

[日別出典と照合ログ、月別の性能](2T_ANNUAL_EXTENSION.json)

[2026年5〜8月の追加評価と開催日単位のモデル比較](2T_ANNUAL_SUMMER_EXTENSION.md)

```sh
python -m two_t.annual_extension build --monthly /tmp/2t-monthly --baseline /tmp/2t-annual --cache /tmp/2t-results-cache --out /tmp/2t-extension
python -m two_t.annual_extension score /tmp/2t-extension/extension-7.json transformer-7-latent-b.pt transformer-7-metrics.json /tmp/2t-extension/transformer-7.json
python -m unittest discover -s tests/two_t -q
```

