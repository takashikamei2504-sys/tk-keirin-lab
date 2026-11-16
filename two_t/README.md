# TK KEIRIN LAB 2T TRANSFORMER

競輪の二車単42通り・72通りに対する確率推定と、100円均等のEV比較。詳細は [データ監査](../docs/2T_DATA_AUDIT.md) と [検証結果](../docs/2T_RESEARCH_REPORT.md)。

## 学習と再現

Python 3.12、PyTorch 2.7.1 CPU。既存LABの履歴を読み取り、データと重みは `/tmp/2t` 以下へ出力する。過去取得ページが更新される場合は、報告に付属の固定データセットを使用する。各車立てのTRAIN期間だけで正規化し、検証期間で温度を選択する。

```bash
python -m pip install -r two_t/requirements.txt
python -m two_t.source --out /tmp/2t/inputs
python -m two_t.train /tmp/2t/inputs/dataset.json /tmp/2t/fit 9 transformer
python -m two_t.train /tmp/2t/inputs/dataset.json /tmp/2t/fit 9 mlp
python -m two_t.train /tmp/2t/inputs/dataset.json /tmp/2t/fit 7 transformer
python -m two_t.train /tmp/2t/inputs/dataset.json /tmp/2t/fit 7 mlp
python -m two_t.evaluate /tmp/2t/inputs/dataset.json /tmp/2t/fit/transformer-9-predictions.json /tmp/2t/fit/transformer-9-eval.json
python -m unittest discover -s tests/two_t -v
```

再現時に付属の `dataset-7.json` または `dataset-9.json` を使う場合、学習・評価の入力引数を置き換える。`two_t.audit` は両方のファイルから欠損・級班・期間別件数を集計する。公開研究用の `race-records.json` は少数の実レースを表示する。全レースの研究予測は検証一式に収録される。

## 画面

`python -m http.server 8000` をリポジトリ直下で起動し、 `http://localhost:8000/two_t/` を開く。締切前記録への切替、開催日・会場・レース選択、確率・EV順、1点100円の対象額、結果を表示する。確定オッズの研究画面には「確定オッズ利用・実購入再現不可」を表示する。独立ブランチの間は既存公開URLとトップ画面に反映されない。

## 発走前取得と結果照合

`python -m two_t.tick --checkpoints /tmp/2t/fit --ledger /tmp/2t/forward --page-output /tmp/2t/race-records.json` は、公開出走表と時刻を確認し、発走前保存された当日カードがある場合にT−10を収集する1サイクル。保管済み予測の結果を確認し、別ファイルへ照合結果を書き出す。利用するスケジューラと永続領域の設定は独立して行う。GitHub Actionsのcronは最短5分・遅延が発生し得るため、1分の取得窓に該当しない回は欠測になる。現在のブランチに定期起動の設定はない。

単一レースの手動確認は `python -m two_t.forward {capture,probability,settle} --card CARD --url RACE_URL --out LEDGER`。予測時は `--checkpoint MODEL` も指定する。 `CARD` には学習入力と同じ正規形式のレース行を使う。T−5の取得は `--mode t5` で独立保管する。結果と投票締切時刻はデータ提供元の時刻を使用する。予測は固定保存後に上書きされず、購入・投票の処理は存在しない。

[GitHub Actionsのスケジュール仕様](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 過去レースの照合と学習データ追加

発走10分以上前の並びを含むコミットが確認できた場合に、照合済みのレースを学習用データへ追加できる。実測B・上位3着・二車単払戻は、照合記録とWINTICKETの確定結果が一致することを確認する。事故・返還・時刻不明・選手IDの不一致は保留とし、理由をレース単位で記録する。新規追加は既存のTRAIN期間に限り、元のデータファイルは入力として扱う。

```bash
python -m two_t.archive_join --report /tmp/2t/race-join-audit.json
```

このコマンドで [照合済み50R](../docs/2T_RACE_JOIN_20261117.json) の現在の取り込み可否を確認できる。並びの原本を確保した場合は `--public-checkout` で公開配信元のGitチェックアウトを指定し、`--ref-day FULL_SHA YYYY-MM-DD` を追加する。`--result-urls` は照合記録の数値レースIDを公開WINTICKET URLに対応させたJSON。実際に追加する場合は `--baseline INPUT.json --dataset-output OUTPUT.json` を指定する。生成したデータは上記の `two_t.train` に渡せる。
