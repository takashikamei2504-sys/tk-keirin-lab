# 二車単の確率を直接学習する予測モデルの比較

7車と9車を別々に学習した。既存の年次MLPは1〜3着の同時確率を学ぶ。今回の候補は順序付きの1着・2着を直接学び、同じ車番を両着に割り当てない。過去成績のみの候補と、同じ構成に過去の出走表CSVの競走得点、年齢、車番、脚質、級班を加えた候補を比較した。追加列は許可したものだけを使用し、対象レースの着順・結果・払戻・予想印・オッズを入力から外した。

2025年の学習データと2026年1月の校正データは従来と同じ。1月のLog Lossだけでエポックと校正温度を決め、候補を選択した。出走表項目ありを両車立ての候補として採用した。3つの再評価群間のレースID重複を確認し、従来MLPの学習データと重みのハッシュを照合した。

| 車立て・対象 | レース | 従来MLP Top1 | 候補Top1 | 従来MLP Log Loss | 候補Log Loss |
| --- | ---: | ---: | ---: | ---: | ---: |
| 7車・全着順確認済み | 7,615 | 9.34% | 16.09% | 3.3600 | 3.0492 |
| 7車・2〜4月補完 | 374 | 7.75% | 10.16% | 3.4472 | 3.3584 |
| 7車・11月1〜16日補完 | 749 | 8.28% | 15.49% | 3.4247 | 3.1350 |
| 9車・全着順確認済み | 850 | 2.12% | 13.41% | 4.2493 | 3.5529 |
| 9車・2〜4月補完 | 79 | 7.59% | 8.86% | 4.2436 | 3.8058 |
| 9車・11月1〜16日補完 | 113 | 0.00% | 16.81% | 4.2512 | 3.4148 |

## 過去成績だけで二車単を直接学んだ場合

| 車立て・全着順確認済み | 従来MLP Top1 | 過去成績のみの候補Top1 | 出走表項目ありの候補Top1 |
| --- | ---: | ---: | ---: |
| 7車 | 9.34% | 10.82% | 16.09% |
| 9車 | 2.12% | 6.59% | 13.41% |

開催日単位の対応付き再標本化による探索的な95%区間、Top3、全候補のLog Loss、競走得点の項目充足率は[結果JSON](2T_DIRECT_EXACTA_RESEARCH.json)を参照。

対象は既に参照された既存の検証群の再評価。出走表CSVの元ページが締切前に保存された時刻は未確認であり、出走表項目ありの結果は過去データでの検証。競走得点単独の改善幅は未測定。2〜4月と11月の補完には全着順・事故の有無を確認していないレースがあり、出走表上の車立てで評価した。締切前オッズ・回収率、本番相当の前向き検証は未評価。

## 再現手順

既存の年次学習データ（baseline）、固定MLPの重みと評価JSON（weights）、元の月別CSV（monthly）、2〜4月補完（backfill）を使う。

```sh
python -m two_t.annual_extension build --start 2026-11-01 --end 2026-11-16 --monthly monthly --baseline baseline --cache cache --out recent
python -m two_t.exacta_research baseline/annual-7.json weights monthly backfill/extension-7.json recent/extension-7.json accuracy/7.json
python -m two_t.exacta_research baseline/annual-9.json weights monthly backfill/extension-9.json recent/extension-9.json accuracy/9.json
python -m unittest discover -s tests/two_t -q
```

