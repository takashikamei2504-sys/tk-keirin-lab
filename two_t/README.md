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

## 発走前の並びの前向き収集

```bash
python -m two_t.observe --ledger /path/to/persistent/2t-observations
```

モデル重み不要の1回実行コマンド。発走予定10分前までに実際に受信した当日公開出走表について、男子7車・9車で全員の並びを確認できたレースを `cards/` に保存する。配信元の公表時刻、取得時刻、保存時刻、元のレースデータと正規化した特徴量のハッシュを残す。後日の再実行で元の出走表を差し替えることはできない。

取得したカードについて同じ保存先で再実行すると、WINTICKETの確定後に開催日、会場、レース番号、発走予定時刻、車番と選手IDを照合し、最終バック、着順、二車単払戻を `results/` に追記する。未確定結果は次回以降に再確認する。中止・事故・返還・通常の着順ラベルを確定できない同着等は結果を記録し、完全な教師ラベル件数から除く。掲載URLを自動で確保できなかった場合は `--result-urls` に `YYYY-MM-DD:会場:レース番号` → WINTICKETの公開レースURLのJSONを指定できる。

標準出力に新規保存件数とレース単位の失敗理由を出す。保存先には再実行時も同じ永続領域を指定する。これは教師データの前向き収集で、予測・締切前オッズの取得・回収率算定は上記の予測系で扱う。固定済みV1の学習・最終評価データへの追加は自動化していない。

### GitHub Actionsでの収集

[2T lineup observations](https://github.com/takashikamei2504-sys/tk-keirin-lab/actions/workflows/two-t-observe.yml) の実行概要で、配信・出走表保存・照合件数とGitへの保存成否を確認できる。実行ログにレース別の除外理由を残す。台帳は [lab-2t-observations](https://github.com/takashikamei2504-sys/tk-keirin-lab/tree/lab-2t-observations) ブランチに追記し、次回も同じブランチから読み込む。

WINTICKETの開催一覧と確定結果ページはGitHub標準ランナーから403が返る。Actionsは `--verify-review-results` で、まず楽天Kドリームスから開催日・会場・レース番号・発走予定時刻と全員の車番・氏名を確認し、`review-results/` に保存する。次にnetkeirinの確定結果に掲載された車番・選手プロフィールIDを発走前の全選手と照合し、両サイトのB・1〜3着・二車単払戻が一致した場合に `results/` に追記する。出典URL、ページ内容のハッシュ、取得時刻を記録する。確定時刻と締切時刻は確認できる場合に限り記録する。着順異常、返還などで通常結果として確認できないものは対象外のままとする。`--review-results` を指定すると確認待ちだけを収集できる。保存した結果から固定済みV1の学習・最終評価データへの追加は行わない。

PR段階でiPhoneから1回実行する場合は、[実行リクエスト](https://github.com/takashikamei2504-sys/tk-keirin-lab/edit/lab-2t-transformer-v1/two_t/observation-request.txt) をSafariで開き、時刻を書き換えて `lab-2t-transformer-v1` にコミットする。既定ブランチへの承認済み反映後は、Actionsの「Run workflow」とJSTの7:11〜23:41の30分間隔、および翌0:11のスケジュールを利用できる。通常の自動照合は発走から3日間まで再試行する。この間隔は出走表と結果の収集用で、締切前オッズのT−10取得窓には使用しない。公開リポジトリの標準ランナーを使う。
