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
