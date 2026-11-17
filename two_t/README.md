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

`python -m http.server 8000` をリポジトリ直下で起動し、 `http://localhost:8000/two_t/` を開く。締切前記録への切替、開催日・会場・レース選択、確率・EV順、1点100円の対象額、結果を表示する。確定オッズの研究画面には「確定オッズ利用・実購入再現不可」を表示する。公開後は [2T レース台帳](https://takashikamei2504-sys.github.io/tk-keirin-lab/two_t/) で、固定した過去検証と専用台帳の最新の公開記録を確認できる。

## 発走前取得と結果照合

`python -m two_t.tick --checkpoints /tmp/2t/fit --ledger /tmp/2t/forward --page-output /tmp/2t/race-records.json` は、公開出走表と時刻を確認し、発走前保存された当日カードがある場合にT−10を収集する1サイクル。保管済み予測の結果を確認し、別ファイルへ照合結果を書き出す。利用するスケジューラと永続領域の設定は独立して行う。GitHub Actionsのcronは最短5分・遅延が発生し得るため、1分の取得窓に該当しない回は欠測になる。GitHub Actionsの定期起動は既定ブランチ上の設定が有効になる。

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

### 検証用データと保留理由の出力

Actionsの実行概要で、7車・9車別の抽出件数と保留理由を確認できる。PRと手動実行の結果には、ダウンロード用の `2t-observation-audit` を7日間添付する。内容は `audit.json`（レース別の判定）、`rows.json`（適格行）、`summary.md`（件数表）、`provenance.txt`（台帳と抽出コードのコミット）。結果の確定やデータの修正があっても、`audit.json` の `as_of` と同じ台帳コミットを指定することで、同じ時点を再現できる。

```bash
python -m two_t.observation_export --ledger /path/to/ledger --day 2026-11-17 \
  --as-of 2026-11-17T23:59:00+09:00 --output /tmp/2t/observation-export
```

発走前カードのハッシュ、結果の確認時刻、両サイトの出典、全選手ID、最終バック・着順・払戻を再検証して抽出する。抽出行は `split: prospective` として記録する。固定V1の学習・最終評価に使うデータとは別の、今後の検証用データ。

### 楽天Kドリームスの締切10分前オッズ

```bash
python -m two_t.kdreams_odds --ledger /path/to/ledger --wait-seconds 210
```

発走前に保存した出走表とレース・車番・氏名を再照合し、二車単42通り／72通りの組合せを確認する。締切10分前を終点とする59秒の取得窓を適用する。取得時点の更新鮮度は5分以内。確定オッズ、全票集計への切替前のオッズ、時刻不明・欠損を除外する。全票集計への切替時刻はモーニングと確認できた開催が8:00、それ以外が9:30（JST）。

適格なオッズを出走表のハッシュ、取得時刻、提供元の更新時刻、出典URL、ページのハッシュとともに専用台帳の `quotes/` に保存する。結果の監査を通ったとき、同じ出走表に結び付くオッズだけを検証用出力の `t10` に添付する。Actionsの概要は取得前、取得窓を通過、保存済み、検証失敗を区別する。

Actionsは取得窓が近ければ最長210秒待つ。30分間隔の起動では全レースを保証できない。収益性の検証には、適格オッズと発走前予測・確定結果がそろった観測の蓄積が必要。

[楽天Kドリームスのオッズ集計条件](https://keirin.kdreams.jp/matsuyama/racedetail/7520261117010007/?pageType=showResult)

### 発売締切前の予測固定と確定結果による精算

```bash
python -m two_t.observed_forward freeze --ledger /path/to/ledger --checkpoints /path/to/models
python -m two_t.observed_forward settle --ledger /path/to/ledger
```

T−10オッズと発走前出走表が同じレース・同じハッシュで検証できた場合、固定V1と一致する `transformer-7.pt` または `transformer-9.pt` を読み込み、発売締切前に確率とEV条件（1.5以上・1点100円の仮想精算）を `forecasts/` に固定する。最終バック・着順・払戻と全員の登録番号を照合した結果を用い、`settlements/` に一度だけ記録する。締切後の予測の新規保存と、出典や時刻をさかのぼって埋める処理は行わない。

GitHub Actionsで動かす場合、タグ `2t-model-v1` のリリースに該当する学習済み `.pt` を添付する。Actionsはこのタグを自動で探す。別のタグを使う場合だけ、Actionsの変数 `LAB_2T_MODEL_RELEASE` に設定する。ダウンロードしたモデルは固定V1のリプレイに記録されているSHA-256と照合する。設定や重みが足りない場合は予測件数を増やさず、重み未配置・締切通過・精算待ちを実行概要に記録する。PR・手動実行の監査ファイルには、保存済み出走表または予測があれば独立 `forward.html` を添付する。定期実行も専用ブランチの `public/race-records.json` を更新する。公開ページはこのJSONを読み込み、取得できない場合は状況を表示して固定の過去検証を利用できる。
