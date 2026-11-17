# 二車単 2026年2〜4月の追加評価

楽天Kドリームスの日別払戻を89/89日分取得した。2026年2月1日〜4月30日の出走表を対象に、学習・校正・従来テストと重なるレースIDを除外し、二車単と三連単の先頭2車が一致したレースを採点した。5〜8月および9〜11月の補完とも日付が重ならない。各モデルの重みは従来と同じハッシュを確認し、校正を固定した。

| 月 | 出走表上7車 | 出走表上9車 |
| --- | ---: | ---: |
| 2026-02 | 101 | 21 |
| 2026-03 | 145 | 34 |
| 2026-04 | 128 | 24 |
| 今回の合計 | 374 | 79 |

| 車立て | モデル | Top1 | Top3 | Log Loss ↓ |
| --- | --- | ---: | ---: | ---: |
| 7車 | transformer | 5.88% | 21.12% | 3.4604 |
| 7車 | mlp | 7.75% | 19.52% | 3.4472 |
| 9車 | transformer | 1.27% | 2.53% | 4.2778 |
| 9車 | mlp | 7.59% | 11.39% | 4.2436 |

| 車立て | 採点日数 | Log Loss差（Transformer − MLP） | 開催日単位の探索的95%区間 |
| --- | ---: | ---: | ---: |
| 7車 | 87 | +0.0132 | -0.0078〜+0.0316 |
| 9車 | 41 | +0.0341 | +0.0174〜+0.0515 |

## 検証レース数の内訳

| 車立て | 従来の全着順確認済み | 2〜4月補完 | 5〜8月補完 | 9〜11月補完 | 重複除外後の合計 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 7車 | 7,615 | 374 | 3,387 | 3,617 | 14,993 |
| 9車 | 850 | 79 | 319 | 429 | 1,677 |

全着順確認済みテストと払戻補完の成績は別集計。月・車立てごとに日付順の最初と中央のレースを別媒体で点検した。全着順を含む厳格な照合は0/12件、上位3着と二車単払戻の照合は12/12件が成立した。定型着順以外の確認例は失格1車、棄権19車、欠場1車。実出走人数、事故の有無、発走前版を全件で確かめていないため、出走表上の車立てで評価した。締切前オッズと回収率は未評価。

[日別出典・級班別と月別の指標・照合結果](2T_ANNUAL_FEB_APR_EXTENSION.json)

```sh
python -m two_t.annual_extension build --start 2026-02-01 --end 2026-04-30 --monthly monthly --baseline baseline --cache cache --out backfill
python -m two_t.annual_extension score backfill/extension-7.json transformer-7-latent-b.pt transformer-7-metrics.json backfill/transformer-7.json
python -m two_t.annual_extension score backfill/extension-7.json mlp-7-latent-b.pt mlp-7-metrics.json backfill/mlp-7.json
python -m two_t.annual_extension compare backfill/transformer-7.json backfill/mlp-7.json backfill/pair-7.json
python -m unittest discover -s tests/two_t -q
```

