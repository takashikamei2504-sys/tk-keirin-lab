# 二車単 2026年5〜8月の追加評価

楽天Kドリームスの日別払戻を2026年5月1日〜8月31日の123/123日分取得した。既存の学習・校正・テストと重なるレースIDを除き、前回の9〜11月と重複しない期間に限定した。出走表の会場・レースID・開催日・車番と、一意の二車単・三連単の先頭2車が一致した行を採点した。モデル4本の重みと校正は9〜11月の評価と同じ。

| 月 | 7車の追加 | 9車の追加 |
| --- | ---: | ---: |
| 2026-05 | 861 | 57 |
| 2026-06 | 1,151 | 132 |
| 2026-07 | 768 | 55 |
| 2026-08 | 607 | 75 |
| 合計 | 3,387 | 319 |

| 車立て | モデル | Top1 | Top3 | Log Loss ↓ |
| --- | --- | ---: | ---: | ---: |
| 7車 | Transformer | 9.63% | 25.83% | 3.3868 |
| 7車 | MLP | 10.19% | 26.13% | 3.3807 |
| 9車 | Transformer | 0.94% | 1.88% | 4.2779 |
| 9車 | MLP | 4.08% | 7.21% | 4.2457 |

均等配分のLog Lossは7車3.7377、9車4.2767。同じ開催日を単位として2,000回再標本化し、同一レースで採点した両モデルの差を比較した。差が正ならMLPのLog Lossが低い。区間は採点できた日付に基づく探索的な95%区間。

| 車立て | 採点日数 | Transformer − MLP | 95%区間 |
| --- | ---: | ---: | ---: |
| 7車 | 108 | +0.0060 | -0.0012〜+0.0134 |
| 9車 | 59 | +0.0322 | +0.0208〜+0.0432 |

月・車立てごとの先頭レースを公開詳細とnetkeirinで点検した。全着順を使う厳格な照合は4/8件で成立し、1〜3着と二車単払戻に限定した照合は8/8件で成立した。欠場・棄権・失格を含む事例があったため、車立ては出走表上の人数とし、全着順確認済みの従来テストとは別集計。全対象の実出走人数・事故の有無・発走前カードの版は未確認。特徴量は7日以上前の既存アーカイブの着順から作成した。今回取得した払戻は正解照合に使用した。締切前オッズおよび回収率は未評価。

[日別出典・級班別と月別の指標・照合結果](2T_ANNUAL_SUMMER_EXTENSION.json)

[2026年2〜4月の追加評価と検証レース数の内訳](2T_ANNUAL_FEB_APR_EXTENSION.md)

```sh
python -m two_t.annual_extension build --start 2026-05-01 --end 2026-08-31 --monthly monthly --baseline baseline --cache cache --out backfill
python -m two_t.annual_extension score backfill/extension-7.json transformer-7-latent-b.pt transformer-7-metrics.json backfill/transformer-7.json
python -m two_t.annual_extension score backfill/extension-7.json mlp-7-latent-b.pt mlp-7-metrics.json backfill/mlp-7.json
python -m two_t.annual_extension compare backfill/transformer-7.json backfill/mlp-7.json backfill/pair-7.json
python -m unittest discover -s tests/two_t -q
```

