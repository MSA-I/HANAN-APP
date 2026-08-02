<div dir="rtl">

# glb-prep

כלי הכנת נכסי GLB ל־HANAN-APP. מנרמל ומאופטם מודלים לפני שהם נכנסים לאפליקציה — מודלי אולם (מ־SketchUp דרך SimLab) וריהוט (מ־Tripo). חלק מ"צינור הכנת הנכסים" של מסמך העקרונות.

**עצמאי מהאפליקציה** — תלויות משלו, לא מזהם את `node_modules` של האפליקציה.

## התקנה

```bash
npm install --prefix tools/glb-prep
```

## שימוש

```bash
# מודל אולם (SimLab GLB): strip extras + אופטימיזציה כבדה
node tools/glb-prep/glb-prep.mjs in.glb out.glb --mode venue

# ריהוט Tripo: ריסקייל לממדים אמיתיים + מרכוז + נרמול
node tools/glb-prep/glb-prep.mjs chair.glb chair-ready.glb --mode prop --height 92        # כיסא, גובה 92 ס"מ
node tools/glb-prep/glb-prep.mjs round.glb round-ready.glb --mode prop --diameter 180      # שולחן עגול ⌀180
node tools/glb-prep/glb-prep.mjs rect.glb  rect-ready.glb  --mode prop --footprint 240x120 # שולחן מלבני 240×120

# batch על תיקייה שלמה
node tools/glb-prep/glb-prep.mjs ./tripo-in ./library-out --mode prop --height 92
```

## מה הוא עושה

| שלב | venue | prop |
|---|---|---|
| הסרת extras (`Camera-*`, `Ground` של SimLab) | ✓ | ✓ |
| נרמול ציר־מעלה (Y-up) | ✓ (ברירת מחדל Y; `--source-up z` לסיבוב) | ✓ |
| ריסקייל לממדים אמיתיים (ס"מ→מטר) | — | `--height` / `--diameter` / `--footprint` |
| מרכוז (בסיס ל־Y=0, מרכוז X/Z) | `--recenter` בלבד (סומך על מיקום המשתמש) | ✓ תמיד |
| dedup + prune + weld | ✓ | ✓ |
| הקטנת/דחיסת טקסטורות (webp) | ✓ (`--no-textures`/`--tex-size`) | ✓ |
| דחיסת גיאומטריה Draco | ✓ (`--no-draco`) | ✓ |
| מיזוג mesh (flatten+join) | `--merge` בלבד — ראו אזהרה | `--merge` בלבד |

## אזהרות ומגבלות (מאומת 2026-07-15 על מודל הריזורט)

- **`--merge` כבוי כברירת מחדל.** ‏flatten/join מבצעים mis-bake ל־scale מקונן (ס"מ/מטר) בייצוא של SimLab וניפחו את ה־bbox מ־13מ' ל־28מ'. הפעל רק על מודלים ללא גיאומטריה מוכפלת/scale מקונן. הקטנת draw-calls, אם תידרש, עדיף לבצע ב־three בזמן טעינה (`mergeGeometries`).
- **ציר־מעלה:** ה־GLB של SimLab הוא **Y-up** (למרות ש־SimLab מציג Z-up). לכן ברירת המחדל = בלי סיבוב. תמונת ה־inspect של SimLab מטעה לגבי הכיוון — הסתמך על ה־bbox שהכלי מדפיס.
- **SimLab לא קורא Draco** — לאימות ויזואלי ב־SimLab ייצא עם `--no-draco --no-textures`. three.js (היעד האמיתי) כן תומך ב־Draco+webp.
- הכלי מדפיס bbox לפני/אחרי (במטרים) — לאימות קנה מידה וכיוון.

## תוצאות מדידה (מודל הריזורט)

- ‏58.9MB → **3.6MB** (‏94%) עם Draco+webp, בלי merge. גיאומטריה תקינה, זקופה, כל 43 החומרים נשמרו (אומת ברנדר).
- ‏bbox: ‏84.2×33.5×13 מ' (X×Z רצפה, Y גובה), רצפה ב־Y≈0.

</div>

## סימון חלקים אחרי ההכנה — `mark-glass.mjs` / `mark-fabric.mjs` / `mark-material.mjs`

Tripo מחזיר חלקים בשם `Material_tripo_part_<n>` — אינדקסים בלי משמעות. הכלים
האלה **משנים את שם החומר**, וזה מה שמאפשר לרנדרר להתייחס לחלק מסוים:
`propModel.buildParts` מקבץ לפי שם החומר, ו-`editableSlots[].match`
ב-`core/catalog/types.ts` הוא **תחילית** של אותו שם.

```
node tools/glb-prep/mark-fabric.mjs public/props/divider-screen.glb --dry   # לקרוא את הטבלה
node tools/glb-prep/mark-fabric.mjs public/props/divider-screen.glb          # לכתוב
```

- **סדר ההרצה:** `glb-prep` → `inspect-materials` (לוודא ש-`dedup()` לא איחד חומרים)
  → `mark-*` עם `--dry` → `mark-*`.
- ⚠ **הרצה חוזרת של `glb-prep` מוחקת את השמות** — וגם את הפיצול של `split-candles.mjs`
  (ראו למטה). הסימון והפיצול תמיד אחרי ההכנה, אף פעם לפני.
- ⚠ **שמות ייחודיים עם תחילית משותפת** (`fabric-00…16`, `frame-00…07`) ולא שם אחד
  לכולם: `propModel` ממזג פרימיטיבים ששמם זהה ושומר רק את החומר הראשון, מה שהיה
  מלביש על 17 קפלים את הטקסטורה האפויה של הקפל הראשון.
- `mark-fabric` מדפיס **מרווח ביטחון** — כמה רחוק מגיע הבד החיצוני ביותר מול היכן
  שמתחיל חלק המסגרת הפנימי ביותר — ויוצא בשגיאה אם השניים לא מפרידים את הסף.
  במחיצה: בד עד 61.8 ס"מ, מסגרת מ-72.7, סף 70.1.

### `mark-material.mjs` — כשהכלל הגיאומטרי לא תופס

`mark-glass`/`mark-fabric` **מחליטים** אילו חלקים כשירים מתוך הגיאומטריה.
`mark-material` מקבל את התשובה מבחוץ, בשתי צורות:

```
node tools/glb-prep/mark-material.mjs <in.glb> --all <prefix> [--out <file>] [--dry]
node tools/glb-prep/mark-material.mjs <in.glb> --only <name1,name2,…> <prefix> [--out <file>] [--dry]
```

- **`--all`** — למודל שכולו חומר אחד מקצה לקצה. זה בדיוק כסא האקריל
  (`chair-chuppah-guest.glb`): mesh אחד, חומר אחד.
- **`--only`** — למודל שהכלל הגיאומטרי **התיישן** עליו.
  `decor-place-setting-horizontal.glb` יוצא מחדש ב-2026-08-02 עם סגמנטציה כדי
  שהמפית תהיה צביעה, והסגמנטציה הדקה **ניפצה את שתי הכוסות ל-52 חלקים** —
  האשכול של `mark-glass` מגשר דרך הרסיסים ומדווח 3 גבוהות / 0 נמוכות במקום 1 ו-1.
  הכלל נכון; הגיאומטריה זזה תחתיו.

⚠ **`--only` הוא לא רישיון להקליד אינדקסים ביד** — זה בדיוק הכשל שבגללו
`mark-glass` קיים. הרשימה חייבת לבוא ממדידה שהטבלה שלה כתובה ורפרודוקטיבית
(ל-`-horizontal`: `handoff/FOUND-01-horizontal.md` — חלק שייך לכוס אם תיבת ה-xz
שלו מוכלת בטביעת הרגל ⌀9 ס"מ של אותה כוס). מה שהדגל מוסיף הוא שהמדידה כבר לא
חייבת לגור בתוך הכלים כדי להיות שמישה.

- **`--dry` מדפיס את שתי הרשימות** — במה ייגע ובמה לא. הביקורת שמעניינת היא
  "יש ברשימה השנייה משהו שהוא בעצם זכוכית?".
- **כישלון רועש (יציאה 1) אם שם ברשימה לא נמצא בקובץ.** טעות הקלדה לא קורסת ולא
  משחיתה כלום — היא מסמנת אפס, כותבת את הקובץ, יוצאת 0, והזכוכית אטומה בשקט.
- `--all` ו-`--only` הם חלופות; שניהם יחד יוצאים 2.
- ⚠ גם כאן **`glb-prep` חוזר מוחק את השמות**. לכן שני הקבצים המשוגרים נקראים בחזרה
  בטסטים: `chuppahChair.test.ts` (`acrylic-00`) ו-`covers.test.ts`
  (`glass-*` + `napkin-00`, וגם שהמידות בקטלוג הן המידות של הקובץ עצמו).

## פיצול הנרות — `split-candles.mjs`

עשרת מודלי הנרות הם `1 mesh · 1 primitive · 1 material` עם טקסטורה אפויה אחת, ולכן
לכלי ששם משנה שמות אין במה לאחוז. הכלי הזה **חותך**: איחוד-מציאה על הקודקודים ⇒
רכיבי-קשירות, דגימת הטקסל של כל קודקוד לפי ה-UV שלו, וכל רכיב **בהיר ובלתי-רווי**
שבסיסו מעל רבע מגובה המודל הוא שעווה. הפלט הוא primitive שני עם חומר בשם `candle`,
ש-`editableSlots[].match` בקטלוג מצביע עליו.

```
node tools/glb-prep/split-candles.mjs public/props/decor-candleholders-wood.glb --measure  # טבלה מלאה
node tools/glb-prep/split-candles.mjs public/props/decor-candleholders-wood.glb --dry      # סיכום בלבד
node tools/glb-prep/split-candles.mjs public/props/decor-candleholders-wood.glb            # לכתוב
```

- **אידמפוטנטי** — ריצה שנייה מאחדת את שני ה-primitives בחזרה ומתחילה מחדש.
- **נכשל ברעש (יציאה 1)** כשהשעווה והמעמד באותו צבע. חמישה מעשרת המודלים נופלים כך,
  וזה נכון: בארבעת מודלי הקריסטל/זכוכית הנר לבן כמו הכלי, וב-`decor-candlestick-gold`
  הנר בגוון השנהב של הגביע. גם ארבעת מודלי `tableDesigns` נופלים.
- ⚠ **הכלל פועל על רכיב בודד, לא על אשכול — ההפך מ-`mark-glass.mjs`.** אשכול לפי קרבה
  מקבץ כל מודל נר ל-1–5 אשכולות שכולם משתרעים מהרצפה לראש, כלומר מאחד את הנר עם הגביע
  במקום להפריד. שני הכללים נכונים, על שני סוגי קבצים.
