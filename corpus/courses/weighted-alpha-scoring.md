---
quote: "Weighted alpha scores a fund on the years that matter most — three-year performance carries the rubric, not last month's headline."
attribution: "EngineerDad Monthly Fund Review — weighted-alpha screening rubric"
permission_status: public
persona: all
---

# Weighted-Alpha Scoring

> The mechanical screening rubric behind the Monthly Fund Review (MFR). Companion to `corpus/courses/mfr-framework.md` — that file explains the MFR philosophy; this file documents the exact arithmetic that turns a fund's return history into a qualified / disqualified verdict. Methodology only: no fund is named here.

## English

### The weighting

A fund's **weighted alpha** is a single number combining its benchmark-relative performance across five horizons, each contributing a fixed share:

| Horizon | Weight |
|---|---|
| Year-to-date | 5% |
| 1-year | 15% |
| 3-year | 40% |
| 5-year | 25% |
| 10-year | 15% |

For each horizon, *alpha* is the fund's annualised return minus its benchmark's return over the same window. Weighted alpha is the weighted average of those period alphas. When a fund is too young to have a 5-year or 10-year record, the weights are renormalised across only the horizons with data — a 2-year-old fund is scored on YTD, 1-year, and partial-3-year data, not penalised for years it could not have existed.

### Why 3-year dominates

The 3-year horizon carries the largest single weight by design. One year is mostly noise — a single sector rotation or currency swing can flatter or punish a fund that did nothing different. Ten years can be stale: it may reward a manager or a mandate that no longer exists. Three years is long enough to span a full cycle of the fund doing its job, short enough to still describe the fund as it is managed today. YTD and 1-year are kept in the rubric as small weights so a fund that has just fallen apart cannot hide behind an old record.

### Beat (%)

`Beat (%)` is the share of measured horizons in which the fund's return cleared its benchmark — three of three, four of five, and so on. Weighted alpha answers *by how much*; Beat (%) answers *how consistently*. A fund can post a positive weighted alpha on the strength of one explosive horizon while failing the others; Beat (%) is the cross-check that surfaces that pattern.

### Alpha Efficiency

`Alpha Efficiency` is a fund's alpha divided by a volatility factor — alpha earned per unit of the volatility taken to earn it. Two funds can post the same alpha: one through steady quarter-on-quarter outperformance, the other through violent swings that happened to land positive. The first has higher alpha efficiency. Long-horizon parents — saving for a child's education or their own retirement — generally have more use for the steady engine than the dramatic one. High alpha efficiency is "performance you could actually stay invested through."

### Drawdown from all-time high

Drawdown is how far a fund's current unit price sits below its own historical peak, paired with how many days it has been since that peak. It is a risk lens, not a screen — a fund is not disqualified for being in drawdown. What "normal" looks like depends on the asset class: an equity fund routinely spends time 10–20% below its high and recovers; a fixed-income or money-market fund that shows a deep drawdown is behaving unusually and is worth a closer read. Drawdown contextualises the alpha number — a strong alpha earned while deeply underwater tells a different story from the same alpha at a fresh high.

### Qualified status

The screen is deliberately simple: a fund with a **positive weighted alpha qualifies**; a fund with a negative weighted alpha does not. "Qualified" means the fund, on this rubric, did the job it was hired to do — beat its benchmark on a horizon-weighted basis. It is a research signal for further reading, not a buy verdict and not a ranking.

### Compliance discipline

- This is a methodology, not a recommendation engine. Describe it as "how EngineerDad reads the universe", never as "which fund to buy".
- Never name a fund in this file, and never present a qualified verdict as assured future performance — past alpha does not predict future alpha.
- Aggregate, dated read-outs of the screen live in `corpus/proof/fund-universe-stats-snapshot.md`; this file only defines the rubric.

## Bahasa Malaysia

### Pemberat

**Weighted alpha** sesebuah dana ialah satu nombor yang menggabungkan prestasi relatif-benchmark merentas lima ufuk masa, setiap satu menyumbang bahagian tetap:

| Ufuk masa | Pemberat |
|---|---|
| Tahun-hingga-kini (YTD) | 5% |
| 1-tahun | 15% |
| 3-tahun | 40% |
| 5-tahun | 25% |
| 10-tahun | 15% |

Bagi setiap ufuk, *alpha* ialah pulangan tahunan dana tolak pulangan benchmark-nya dalam tempoh yang sama. Weighted alpha ialah purata berwajaran alpha tempoh tersebut. Apabila dana terlalu muda untuk mempunyai rekod 5-tahun atau 10-tahun, pemberat dinormalkan semula merentas hanya ufuk yang ada data — dana berusia 2 tahun dinilai pada data YTD, 1-tahun, dan 3-tahun separa, bukan dihukum kerana tahun yang ia tidak mungkin wujud.

### Mengapa 3-tahun mendominasi

Ufuk 3-tahun membawa pemberat tunggal terbesar secara reka bentuk. Satu tahun kebanyakannya bunyi bising — satu putaran sektor atau ayunan mata wang boleh menyanjung atau menghukum dana yang tidak melakukan apa-apa berbeza. Sepuluh tahun boleh menjadi basi: ia mungkin memberi ganjaran kepada pengurus atau mandat yang tidak lagi wujud. Tiga tahun cukup panjang untuk merangkumi satu kitaran penuh dana melakukan tugasnya, cukup pendek untuk masih menggambarkan dana seperti yang diurus hari ini. YTD dan 1-tahun dikekalkan dalam rubrik sebagai pemberat kecil supaya dana yang baru runtuh tidak boleh bersembunyi di sebalik rekod lama.

### Beat (%)

`Beat (%)` ialah bahagian ufuk diukur di mana pulangan dana melepasi benchmark-nya — tiga daripada tiga, empat daripada lima, dan seterusnya. Weighted alpha menjawab *sebanyak mana*; Beat (%) menjawab *betapa konsisten*. Sesebuah dana boleh mencatat weighted alpha positif atas kekuatan satu ufuk meletup sambil gagal yang lain; Beat (%) ialah semakan silang yang mendedahkan corak itu.

### Alpha Efficiency

`Alpha Efficiency` ialah alpha sesebuah dana dibahagi dengan faktor volatiliti — alpha diperoleh bagi setiap unit volatiliti yang diambil untuk memperolehnya. Dua dana boleh mencatat alpha yang sama: satu melalui prestasi mengatasi suku-ke-suku yang stabil, satu lagi melalui ayunan ganas yang kebetulan mendarat positif. Yang pertama mempunyai alpha efficiency lebih tinggi. Ibu bapa berufuk panjang — menyimpan untuk pendidikan anak atau persaraan sendiri — umumnya lebih memerlukan enjin stabil berbanding yang dramatik. Alpha efficiency tinggi ialah "prestasi yang anda benar-benar boleh kekal melabur menerusinya."

### Susut nilai dari paras tertinggi

Susut nilai (drawdown) ialah sejauh mana harga unit semasa dana berada di bawah puncak sejarahnya sendiri, dipasangkan dengan berapa hari sejak puncak itu. Ia ialah kanta risiko, bukan tapisan — dana tidak hilang kelayakan kerana berada dalam susut nilai. Apa yang "normal" bergantung pada kelas aset: dana ekuiti lazimnya menghabiskan masa 10–20% di bawah paras tertingginya dan pulih; dana pendapatan tetap atau pasaran wang yang menunjukkan susut nilai mendalam berkelakuan luar biasa dan berbaloi diteliti. Susut nilai memberi konteks kepada nombor alpha.

### Status kelayakan

Tapisan ini sengaja ringkas: dana dengan **weighted alpha positif layak**; dana dengan weighted alpha negatif tidak. "Layak" bermaksud dana itu, pada rubrik ini, melakukan tugas yang ia diupah untuk lakukan — mengalahkan benchmark-nya atas dasar berwajaran ufuk. Ia ialah isyarat penyelidikan untuk bacaan lanjut, bukan keputusan beli dan bukan kedudukan ranking.

### Disiplin pematuhan

- Ini ialah metodologi, bukan enjin cadangan. Gambarkannya sebagai "bagaimana EngineerDad membaca alam semesta dana", tidak pernah sebagai "dana mana untuk dibeli".
- Jangan sekali-kali menamakan dana dalam fail ini, dan jangan persembahkan keputusan layak sebagai prestasi masa depan yang dipastikan — alpha lalu tidak meramal alpha masa depan.
- Bacaan agregat bertarikh bagi tapisan ini berada dalam `corpus/proof/fund-universe-stats-snapshot.md`; fail ini hanya mentakrifkan rubrik.
