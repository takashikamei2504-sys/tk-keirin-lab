# 二車単改善候補の前向き比較

出走表の公開データを取得し、二車単を直接学習した研究候補と年次MLPの両方を同じレースで推論する。学習に使用した先行7日間を外す処理を前向き推論にも適用し、重み・校正を固定する。発走済み、候補外のレース、欠場が判明したカード、予測必須項目が欠けるカードは件数と理由を報告する。

## 2026年11月18日の初回記録

| 車立て | 締切前固定 | 確定結果照合 |
| --- | ---: | ---: |
| 7車 | 61 | 初回記録時0 |
| 9車 | 7 | 初回記録時0 |

06:51 JSTに固定。対象の発売締切は09:26〜23:25 JST。公開フィードの79レースのうち、対象外8、必須項目不足2、6車立て1を記録した。発行時刻・取得時刻・公開時刻・入力SHA-256・モデル重みSHA-256と、7車42通り／9車72通りの確率を保存した。予測は発売締切10分前までに固定する。両モデルの初回予測のファイルは[当日マニフェスト](../data/2t-exacta-forward/2026-11-18/manifest.json)を参照。

年次モデルの履歴は従来の固定CSVで、日付が発走7日以上前の着順だけを使用した。CSVの更新は別途必要。今回の予測では対象レースの払戻、結果、オッズ、公開フィードに含まれる既存の予想印を入力に使用しなかった。

## 採点と本番採用の判断材料

結果照合は確定済みの公開結果を取得し、レースID、日付、会場、時刻、全選手のID及び車番を確認する。照合できた同一レースで二車単Top1・Top3・Log Lossを比較する。中止・欠場・競走棄権などで厳格な全着順が得られないケースは一致判定に混ぜず、照合できなかった理由を追跡する。異なる開催日が揃い次第、7車と9車の差をそれぞれ開催日単位で集計する。

初回運用は確率精度の比較。締切10分前オッズの照合・市場比較・仮想回収率は別工程で、公式の締切前保存が確認できたものを使用する。トータルの実運用採用は、前向き成績と市場比較の実測が揃った段階で判断する。7車・9車は独立して評価する。

## 再現

```sh
python -m two_t.exacta_forward freeze --ledger ledger --weights checkpoints --monthly monthly
python -m two_t.exacta_forward archive --ledger ledger --date 2026-11-18 --archive data/2t-exacta-forward/2026-11-18
python -m two_t.exacta_forward restore --ledger restored --archive data/2t-exacta-forward/2026-11-18
python -m two_t.exacta_forward settle --ledger restored --budget-seconds 180
python -m two_t.exacta_forward summary --ledger restored
python -m unittest discover -s tests/two_t -q
```

重みは研究候補の `direct-exacta-{7,9}.pt` と年次参照の `mlp-{7,9}-latent-b.pt` を同じディレクトリに置く。年次モデルの結果および候補の比較JSONをチェックポイントのハッシュ照合に使用する。既存の予測台帳とは独立した台帳。

## 2026年11月19日の更新

[当日の予測一覧](2T_DIRECT_EXACTA_PREDICTIONS_20261119.md) と [前向き比較の更新結果](2T_DIRECT_EXACTA_FORWARD_20261119.md) を追記。11月19日61RはGitHub保存時刻でも締切10分前。11月18日は63Rを確定照合し、5Rは全着順が不規則のため未照合理由を記録した。

## 2026年11月20日の更新

[本日の予測一覧](2T_DIRECT_EXACTA_PREDICTIONS_20261120.md) と [累積比較結果](2T_DIRECT_EXACTA_FORWARD_20261120.md) を追記。51Rを07:20:56にGitHub保存し、全件が締切10分前条件を満たした。過去2日129Rのうち121Rを確定照合し、8Rは未照合理由を保存した。

## 2026年11月21日の更新

[本日の予測一覧](2T_DIRECT_EXACTA_PREDICTIONS_20261121.md) と [累積比較結果](2T_DIRECT_EXACTA_FORWARD_20261121.md) を追記。54Rを07:55:45にGitHub保存し、全件が締切10分前条件を満たした。過去3日180Rのうち164Rを確定照合し、16Rは未照合理由を保存した。

## 2026年11月22日の更新

[本日の予測一覧](2T_DIRECT_EXACTA_PREDICTIONS_20261122.md) と [累積比較結果](2T_DIRECT_EXACTA_FORWARD_20261122.md) を追記。64Rを07:35:55にGitHub保存し、全件が締切10分前条件を満たした。過去4日234Rのうち213Rを確定照合し、21Rは未照合理由を保存した。
