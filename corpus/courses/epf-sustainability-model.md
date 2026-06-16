---
quote: "The EPF Sustainability Calculator models one question — will your EPF balance still be there at the age you stop working?"
attribution: "EngineerDad EPF Sustainability Calculator v1.3.2 — methodology"
permission_status: public
persona: pre_retirement_prs_focus
---

# EPF Sustainability Model

> The engine behind the EngineerDad EPF Sustainability Calculator. Documents every assumption and every formula the calculator runs, so content can explain the tool honestly instead of only quoting its output. Companion to `proof/epf-baseline-tiers.md` — that file carries the retirement-target tiers; this one carries the model that tests them.
> Source: `engineerdad-site/tools/epf-sustainability-calculator/` v1.3.2 beta (2026-03-26).

## English

### What the model answers

The calculator projects a single EPF account forward in two phases — an **accumulation phase** while the member still works, and a **drawdown phase** after retirement — and reports whether the projected balance lasts until the life-expectancy assumption. Every rate in the model is an adjustable assumption, not a forecast. The output is an illustration of *what the inputs imply*, not a prediction of any individual's outcome.

### Fixed constants (calculator v1.3.2)

These are hard-coded in the tool and not user-adjustable:

- **Employer EPF contribution** — 13% of monthly wages when the wage is below RM5,000, 12% at RM5,000 and above (EPF Act 1991, Third Schedule).
- **Belanjawanku reference floor** — RM2,380/month for a single elderly person, base year 2024 (EPF/SWRC *Belanjawanku* Expenditure Reference). The model inflates this forward to the comparison year.
- **Investment-alternative return** — 8% per year nominal, used only for the supplementary-investment illustration (see Step 5).

### Default inputs (user-adjustable)

The calculator opens with these defaults; a user can change any of them. Item G (`corpus/data/datasets/epf-sustainability-simulations.json`) is harvested at these defaults except for the axes it sweeps (age, salary, starting balance, retirement age, lifestyle tier).

| Input | v1.3.2 default | Range |
|---|---|---|
| EPF dividend rate | 5% / year | 1–10% |
| Salary growth | 3% / year | 0–10% |
| Inflation | 4% / year | 3–6% |
| Employee EPF contribution | 11% | 7–15% |
| Retirement age | 60 | 50–70 |
| Life expectancy | 80 | 65–95 |
| Desired lifestyle | 70% of current income | 50–100% |
| Post-retirement investment return | 3% / year | 3–5% |

> Note — earlier design drafts cited a 6% dividend and 3% inflation assumption. The figures above are the values actually shipped in calculator v1.3.2 and are the ones every harvested simulation uses.

### Step 1 — Contribution math

Each working year, the EPF inflow is:

`annual contribution = monthly salary × (employer rate + employee rate) × 12`

The employer rate switches between 13% and 12% on the RM5,000 wage threshold, re-checked every year as the salary grows. With the 11% employee default, total contributions run at roughly 23–24% of wages.

### Step 2 — Accumulation phase

The balance is rolled forward one year at a time, from current age to retirement age:

`balance(next) = balance(this) × (1 + dividend rate) + annual contribution`

Salary compounds at the salary-growth rate, so each year's contribution is slightly larger than the last. The dividend rate is applied as a modelling assumption — actual EPF dividends are declared annually by KWSP and vary year to year (see `corpus/data/datasets/epf-dividend-history.json`).

### Step 3 — Drawdown phase

After retirement the balance is drawn down as a **growing annuity, paid at the start of each year**, so the payout keeps pace with inflation. With `g` = inflation, `r` = post-retirement investment return, and `k = (1 + g) / (1 + r)` over `N = life expectancy − retirement age` years:

`first-year annual payout = balance at retirement × (1 − k) / (1 − kᴺ)`

The monthly EPF payout is that figure divided by 12. A separate month-by-month depletion simulation also reports the age at which the balance would reach zero if the member instead spent at their desired lifestyle level.

### Step 4 — The Belanjawanku benchmark

The model compares the projected monthly payout against the *Belanjawanku* reference floor, inflated to the retirement year:

`reference floor at retirement = RM2,380 × (1 + inflation)^(retirement year − 2024)`

If the projected payout clears that floor, the model marks the member as meeting the basic adequacy reference. The floor is a published national reference for a decent standard of living — basic needs, physical comfort, and participating in society with dignity — not an EngineerDad number.

### Step 5 — The gap and the supplementary-investment illustration

The retirement need is the desired lifestyle, inflated forward:

`monthly need = current income × lifestyle % × (1 + inflation)^(years to retirement)`

The **gap** is the monthly need minus the projected EPF payout. When a gap exists, the calculator illustrates the monthly amount that, invested at the 8% nominal assumption from today until retirement, would accumulate a fund large enough to cover that growing gap across retirement. This figure is the *mathematical implication of the gap* — it is an illustration of one way to think about the shortfall, not a recommendation to buy any product.

### Reading the result honestly

The calculator scores EPF coverage of the inflation-adjusted goal in bands: at or above 110% (comfortable surplus), 100–110% (on track), 70–100% (small gap), 45–70% (moderate gap), below 45% (major shortfall). Content should always carry the band *with* its caveat — coverage is a function of the assumptions the user entered, and a different dividend, inflation, or retirement-age input moves the band.

### Compliance discipline

- Present every rate — dividend, salary growth, inflation, the 8% investment figure — as a modelling assumption, never as a promised or assured outcome.
- Never frame PRS or unit-trust investing as lower-risk than, or certain to outperform, EPF. The comparison must stay balanced; investing carries market risk that EPF contributions do not.
- Cite KWSP and *Belanjawanku* as the source of the reference floor. The tiers and the floor are KWSP-derived, not EngineerDad claims.
- The calculator is an educational illustration. It does not produce personalised financial advice; a real plan needs a one-to-one consultation.

## Bahasa Malaysia

### Apa yang model ini jawab

Kalkulator ini mengunjurkan satu akaun EPF ke hadapan dalam dua fasa — **fasa pengumpulan** semasa ahli masih bekerja, dan **fasa pengeluaran** selepas persaraan — dan melaporkan sama ada baki yang diunjurkan bertahan sehingga andaian jangka hayat. Setiap kadar dalam model ialah andaian yang boleh dilaras, bukan ramalan. Output adalah ilustrasi *apa yang dimaksudkan oleh input*, bukan ramalan hasil mana-mana individu.

### Pemalar tetap (kalkulator v1.3.2)

Nilai ini dikodkan tetap dan tidak boleh dilaras pengguna:

- **Caruman majikan EPF** — 13% gaji bulanan apabila gaji bawah RM5,000, 12% pada RM5,000 ke atas (Akta KWSP 1991, Jadual Ketiga).
- **Paras rujukan Belanjawanku** — RM2,380/bulan untuk seorang warga emas, tahun asas 2024 (Rujukan Perbelanjaan *Belanjawanku* KWSP/SWRC). Model menyesuaikan paras ini ke hadapan mengikut inflasi.
- **Pulangan pelaburan alternatif** — 8% setahun nominal, digunakan hanya untuk ilustrasi pelaburan tambahan (lihat Langkah 5).

### Input lalai (boleh dilaras pengguna)

Kalkulator dibuka dengan nilai lalai ini; pengguna boleh menukar mana-mana. Item G (`corpus/data/datasets/epf-sustainability-simulations.json`) dituai pada nilai lalai ini kecuali paksi yang disapunya (umur, gaji, baki permulaan, umur persaraan, tahap gaya hidup).

| Input | Lalai v1.3.2 | Julat |
|---|---|---|
| Kadar dividen EPF | 5% / tahun | 1–10% |
| Pertumbuhan gaji | 3% / tahun | 0–10% |
| Inflasi | 4% / tahun | 3–6% |
| Caruman pekerja EPF | 11% | 7–15% |
| Umur persaraan | 60 | 50–70 |
| Jangka hayat | 80 | 65–95 |
| Gaya hidup diingini | 70% pendapatan semasa | 50–100% |
| Pulangan pelaburan selepas bersara | 3% / tahun | 3–5% |

### Langkah 1 — Matematik caruman

Setiap tahun bekerja, aliran masuk EPF ialah:

`caruman tahunan = gaji bulanan × (kadar majikan + kadar pekerja) × 12`

Kadar majikan bertukar antara 13% dan 12% pada ambang gaji RM5,000, disemak semula setiap tahun apabila gaji meningkat. Dengan lalai pekerja 11%, jumlah caruman adalah kira-kira 23–24% daripada gaji.

### Langkah 2 — Fasa pengumpulan

Baki digulung ke hadapan setahun demi setahun, dari umur semasa ke umur persaraan:

`baki(seterusnya) = baki(ini) × (1 + kadar dividen) + caruman tahunan`

Gaji terkompaun pada kadar pertumbuhan gaji, jadi caruman setiap tahun sedikit lebih besar daripada tahun sebelumnya. Kadar dividen digunakan sebagai andaian model — dividen EPF sebenar diisytiharkan setiap tahun oleh KWSP dan berbeza dari tahun ke tahun (lihat `corpus/data/datasets/epf-dividend-history.json`).

### Langkah 3 — Fasa pengeluaran

Selepas persaraan, baki dikeluarkan sebagai **anuiti berkembang, dibayar pada awal setiap tahun**, supaya bayaran mengikut kadar inflasi. Dengan `g` = inflasi, `r` = pulangan pelaburan selepas bersara, dan `k = (1 + g) / (1 + r)` sepanjang `N = jangka hayat − umur persaraan` tahun:

`bayaran tahunan tahun pertama = baki semasa bersara × (1 − k) / (1 − kᴺ)`

Bayaran EPF bulanan ialah angka itu dibahagi 12. Satu simulasi susut bulan demi bulan yang berasingan turut melaporkan umur di mana baki akan mencapai sifar jika ahli sebaliknya berbelanja pada tahap gaya hidup yang diingini.

### Langkah 4 — Penanda aras Belanjawanku

Model membandingkan bayaran bulanan yang diunjurkan dengan paras rujukan *Belanjawanku*, disesuaikan ke tahun persaraan:

`paras rujukan semasa bersara = RM2,380 × (1 + inflasi)^(tahun persaraan − 2024)`

Jika bayaran yang diunjurkan melepasi paras itu, model menandakan ahli sebagai memenuhi rujukan kecukupan asas. Paras ini ialah rujukan kebangsaan yang diterbitkan untuk taraf hidup yang wajar — keperluan asas, keselesaan fizikal, dan menyertai masyarakat dengan bermaruah — bukan nombor EngineerDad.

### Langkah 5 — Jurang dan ilustrasi pelaburan tambahan

Keperluan persaraan ialah gaya hidup diingini, disesuaikan ke hadapan:

`keperluan bulanan = pendapatan semasa × % gaya hidup × (1 + inflasi)^(tahun ke persaraan)`

**Jurang** ialah keperluan bulanan tolak bayaran EPF yang diunjurkan. Apabila jurang wujud, kalkulator menggambarkan jumlah bulanan yang, dilaburkan pada andaian 8% nominal dari hari ini hingga persaraan, akan mengumpul dana cukup besar untuk menampung jurang yang berkembang sepanjang persaraan. Angka ini ialah *implikasi matematik jurang itu* — satu cara untuk memikirkan kekurangan, bukan cadangan membeli mana-mana produk.

### Membaca keputusan dengan jujur

Kalkulator menilai liputan EPF terhadap matlamat terlaras inflasi dalam jalur: pada atau melebihi 110% (lebihan selesa), 100–110% (atas landasan), 70–100% (jurang kecil), 45–70% (jurang sederhana), bawah 45% (kekurangan besar). Kandungan harus sentiasa membawa jalur itu *bersama* amarannya — liputan adalah fungsi andaian yang dimasukkan pengguna, dan input dividen, inflasi, atau umur persaraan yang berbeza menggerakkan jalur.

### Disiplin pematuhan

- Persembahkan setiap kadar — dividen, pertumbuhan gaji, inflasi, angka pelaburan 8% — sebagai andaian model, tidak pernah sebagai hasil yang dijanji atau dipastikan.
- Jangan sekali-kali membingkai pelaburan PRS atau amanah saham sebagai berisiko lebih rendah daripada, atau pasti mengatasi, EPF. Perbandingan mesti kekal seimbang; pelaburan membawa risiko pasaran yang caruman EPF tidak.
- Petik KWSP dan *Belanjawanku* sebagai sumber paras rujukan. Tahap dan paras itu berasal dari KWSP, bukan dakwaan EngineerDad.
- Kalkulator ialah ilustrasi pendidikan. Ia tidak menghasilkan nasihat kewangan peribadi; rancangan sebenar memerlukan perundingan satu-dengan-satu.
