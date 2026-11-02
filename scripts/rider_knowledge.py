"""Source-attributed research notes. Topic detection is NOT a trait score.

Keep negative, conditional and temporary statements as statements, never silently
turn them into completed actions. No whole article is persisted.
"""
import hashlib
import re

TOPICS = {
 'start': ('S取り・前受け', r'S取り|スタート取り|前受け|前を取|正攻法'),
 'resist': ('突っ張り・主導権', r'突っ張|ツッパリ|主導権|先行'),
 'withdraw': ('引き・立て直し', r'引いて|引いた|下げ|立て直|下がっ'),
 'kamashi': ('カマシ・加速', r'カマシ|かまし|カマした|かました|ダッシュ|加速'),
 'makuri': ('捲り・仕掛け時機', r'捲|まく|仕掛|ロング|早駆け'),
 'position': ('位置取り・競り', r'位置|中団|中段|飛び付|飛びつ|番手にはま|競り|競った|切り替|切替'),
 'tracking': ('追走・千切れ', r'追走|千切|ちぎれ|離れ|踏み出し|追い付|追いつ'),
 'support': ('援護・牽制', r'援護|牽制|けん制|ブロック|車間|仕事し'),
 'finish': ('差し・直線の伸び', r'差し|差せ|差す|差した|直線|伸び|追い込|追いこ|中割|内を|大外'),
 'endurance': ('持久力・末脚', r'持久|地脚|末脚|末の|踏み直|タレ|粘り|粘っ|航続'),
 'solo': ('単騎・自在・番手自力', r'単騎|一人で|自在|番手捲|番手まく|二段駆|自力に'),
 'relationship': ('師弟・信頼・連係', r'師匠|弟子|信頼|連係|連携|同門|世話にな|のおかげ|感謝'),
 'motivation': ('地元・役割・意欲', r'地元|記念|先輩|後輩|任され|任せ|責任|恩返し|気持ち|積極'),
 'condition': ('調子・疲労・回復', r'状態|調子|疲れ|疲労|回復|体調|感触|余裕|脚の感じ'),
 'return': ('落車・欠場・復帰', r'落車|欠場|復帰|怪我|けが|ケガ|故障|骨折|病気|腰痛'),
 'training': ('練習・調整', r'練習|トレーニング|合宿|調整|街道|バンク練|ウエイト'),
 'equipment': ('自転車・機材・ギア', r'自転車|フレーム|セッティング|ギヤ|ギア|車輪|ハンドル|サドル|シューズ'),
 'bank': ('バンク・風・走路適性', r'バンク|走路|向かい風|追い風|風が|強風|雨|短走路|長走路|[2345]33|400|500'),
 'schedule': ('日程・競走条件', r'初日|二日目|２日目|最終日|連戦|中[０-９0-9]+日|ナイター|ミッドナイト|[７９79]車'),
 'career': ('経歴・競技経験', r'ナショナル|自転車競技|トラック競技|競技経験|転向|養成所|デビュー|昇級|降級'),
}

def norm(text):
 return re.sub(r'[\s\u3000]', '', str(text or ''))

def topics(text):
 return [key for key, (_, pattern) in TOPICS.items() if re.search(pattern, text)]

def extract_knowledge(page, quotes, names, url, date, collected, source):
 """Verified speaker, or a single explicit named subject at sentence start.

 A 160-character quotation budget per rider/article is shared across topics.
 Metadata and topic labels do not imply that a statement is true or permanent.
 """
 candidates = []
 for q in quotes:
  if q.get('rider') in names:
   candidates.append((q['rider'], q['text'], 'self_statement', q['attribution']))
 for tag, text in page.blocks:
  if tag != 'p': continue
  for sentence in re.split(r'[。！？]', norm(text)):
   contained = [n for n in names if n in sentence]
   if len(contained) != 1: continue
   name = contained[0]
   if not re.match(re.escape(name) + r'(?:選手)?(?:は|が|「|：)', sentence): continue
   tail = sentence[len(name):]
   # Another named/surnamed actor cannot silently become this rider's action.
   if re.search(r'[一-龥々]{2,}(?:君|さん|選手)', tail): continue
   candidates.append((name, sentence, 'reported_statement', '本文の単独フルネーム主語。記者の記述・引用を含む'))
 result = []; budgets = {}; seen = set()
 for name, text, kind, attribution in candidates:
  for sentence in re.split(r'[。！？]', text):
   sentence = sentence.strip('「」 ')
   tags = topics(sentence)
   if not tags or len(sentence) < 4: continue
   fingerprint = (name, norm(sentence))
   if fingerprint in seen: continue
   seen.add(fingerprint)
   left = 160 - budgets.get(name, 0)
   if left < 12: continue
   excerpt = sentence[:min(80, left)]
   # Tags must be supported by the saved excerpt itself.
   tags = topics(excerpt)
   if not tags: continue
   budgets[name] = budgets.get(name, 0) + len(excerpt)
   ident = hashlib.sha256(f'{url}|{name}|{kind}|{excerpt}'.encode()).hexdigest()[:24]
   result.append(dict(id=ident, rider=name, topics=tags, excerpt=excerpt,
     kind=kind, attribution=attribution, url=url, source=source,
     published_at=date.isoformat(), collected_at=collected.isoformat(),
     body_verified=True, numeric=False, extractor='rider-knowledge/v1',
     scope='statement_at_publication', truncated=len(excerpt)<len(sentence),
     caution='否定・条件・意向・他者への言及を含み得る。恒常的な能力や実行済み行動と断定しない'))
 return result
