<div dir="rtl">

# שלב 0 — ערכת פרומפטים ל־PoC נאמנות

**מטרה:** לאמת שמודל תמונה AI יכול להפוך רינדור/צילום־מסך מ־SketchUp להדמיה פוטוריאליסטית של האירוע **בלי לשנות את הפריסה** — לפני שכותבים שורת קוד.

**מקורות השיטה:** מערכת התפריט של *AI Visualization Mastery* (Salmaan Mohamed) — בוחרים ערך אחד מכל ממד; התבנית המבנית של קטלוג nano-banana (פרומפט JSON מובנה); עקרונות מסמך העיצוב (`ai-visualization-design.md`).

---

## איך מריצים את הבדיקה

**קלט לכל ריצה — שתי תמונות, הסדר קובע:**
1. **תמונה 1 = הרינדור** (צילום מסך מ־SketchUp של האולם עם ריהוט האירוע) — זו *אמת הפריסה*.
2. **תמונה 2 = צילום אמת של האולם** מזווית דומה ככל האפשר — זו *אמת הזהות* (חומרים, תאורה, אווירה).

**פלטפורמות לבדיקה:** GPT Image 2 (ChatGPT) · Nano Banana Pro (Gemini) · Flux Kontext (fal/Replicate playground). אותו זוג תמונות + אותו פרומפט בכולן.

**מתודולוגיה (כלל הברזל מה־PDF): משנים משתנה אחד בכל פעם.** ריצה ראשונה עם המתכון המוכן כמו שהוא; אחר כך מחליפים רק ממד אחד (למשל שעת יום) ומשווים. כך לומדים מה כל רכיב שולט בו.

**מומלץ לבדוק 3 סצנות:** אולם פנים ערב (החשוב ביותר) · גן אירועים בשעת זהב · מבט רחב עם הרבה שולחנות (בדיקת העמידות בסצנה עמוסה).

---

## פרומפט המאסטר (שתי תמונות) — גרסה מלאה

לפלטפורמות שמקבלות טקסט חופשי ארוך (GPT Image 2, Nano Banana Pro):

```
You are given two images.

IMAGE 1 is a 3D render of an event hall with furniture layout for an event.
IMAGE 1 is the LAYOUT TRUTH: the exact camera angle, room geometry and
proportions, and the exact placement, count, size, shape, and colors of ALL
furniture and objects (tables, chairs, stage, dance floor, bar, decor).

IMAGE 2 is a real photograph of the same venue. IMAGE 2 is the IDENTITY
TRUTH: the venue's real materials, floor, walls, ceiling, windows, light
fixtures, and overall atmosphere.

TASK: Transform IMAGE 1 into a photorealistic professional event photograph
of this exact layout inside the real venue from IMAGE 2.

STRICT RULES — DO NOT VIOLATE:
- Keep the exact camera position, angle and framing of IMAGE 1.
- Keep every object from IMAGE 1 in its exact position. Do not add, remove,
  move, resize or duplicate any table, chair or object.
- Keep the exact count of tables and chairs. Keep tablecloth and chair
  colors exactly as in IMAGE 1.
- Keep the room's geometry and proportions from IMAGE 1.

WHAT TO IMPROVE (realism only):
- Replace the flat 3D materials with the venue's real materials from IMAGE 2.
- {LIGHTING_BLOCK}
- Add realistic fabric behavior: tablecloth folds and draping, chair
  upholstery texture.
- Add photorealistic reflections on the floor, glassware and cutlery detail
  on tables, subtle ambient occlusion and contact shadows.
- {ATMOSPHERE_BLOCK}

STYLE: professional event photography, {CAMERA_BLOCK}, photorealistic,
high resolution, natural color grading. No people in the scene.
```

### בלוקים להשלמה (תפריט ה־PDF — בוחרים אחד מכל שורה)

**{LIGHTING_BLOCK} — פנים, אירוע ערב (ברירת המחדל שלנו):**
> warm festive event lighting: chandeliers and warm pendant lights on, recessed ceiling downlights creating soft pools of light, very warm 2700K amber glow, intimate celebratory atmosphere, dark evening visible through windows

**{LIGHTING_BLOCK} — פנים, יום:**
> mid morning bright natural light filling the hall through the windows, warm daylight, even natural illumination, clean and airy

**{LIGHTING_BLOCK} — חוץ, שעת זהב:**
> golden hour sunset light, warm amber glow, long dramatic shadows, orange sky gradient, string lights beginning to glow

**{LIGHTING_BLOCK} — חוץ, שעה כחולה (הכי "פרימיום" לאירועים):**
> blue hour dusk, deep blue sky, warm glowing string lights and table candles dominant, festive exterior lighting, twilight atmosphere

**{ATMOSPHERE_BLOCK} — פנים:**
> subtle atmospheric depth, faint warm haze around light sources, celebratory premium ambience

**{ATMOSPHERE_BLOCK} — חוץ:**
> light atmospheric haze, soft distant horizon, real-world atmosphere, gentle evening air

**{CAMERA_BLOCK} — מבט אורח (ברירת מחדל):**
> eye level perspective at 1.6m height, wide angle 24mm lens, architectural interior photography

**{CAMERA_BLOCK} — מבט מוגבה (סצנות רחבות):**
> slightly elevated perspective at 2.2m, wide angle 24mm, plan overview feel

---

## מתכון מוכן A — אולם פנים, אירוע ערב (הבדיקה הראשונה)

```
You are given two images. IMAGE 1 is a 3D render of an event hall with the
furniture layout for a wedding event — it is the LAYOUT TRUTH: exact camera
angle, room geometry, and exact placement, count, shape and colors of all
tables, chairs, stage and dance floor. IMAGE 2 is a real photograph of the
same venue — it is the IDENTITY TRUTH: real materials, floor, ceiling,
light fixtures and atmosphere.

Transform IMAGE 1 into a photorealistic professional event photograph of
this exact layout inside the real venue from IMAGE 2.

STRICT: keep the exact camera framing of IMAGE 1; do not add, remove, move
or resize any object; keep exact table and chair counts and colors; keep
room proportions.

IMPROVE ONLY REALISM: apply the venue's real materials from IMAGE 2; warm
festive event lighting — chandeliers on, recessed downlights, very warm
2700K amber glow, dark evening outside the windows; realistic tablecloth
folds and draping; elegant table settings with glassware catching the
light; photorealistic floor reflections and soft contact shadows; subtle
warm haze around light sources.

STYLE: professional event photography, eye level 1.6m, wide angle 24mm,
photorealistic, high resolution, natural color grading. No people.
```

## מתכון מוכן B — גן אירועים, שעה כחולה

```
You are given two images. IMAGE 1 is a 3D render of an outdoor event garden
with furniture layout — the LAYOUT TRUTH: exact camera angle, terrain, and
exact placement, count, shape and colors of all tables, chairs, chuppah and
dance floor. IMAGE 2 is a real photograph of the same garden — the IDENTITY
TRUTH: real paving, planting, trees, pool and surroundings.

Transform IMAGE 1 into a photorealistic professional event photograph of
this exact layout in the real garden from IMAGE 2.

STRICT: keep the exact camera framing of IMAGE 1; do not add, remove, move
or resize any object; keep exact table and chair counts and colors.

IMPROVE ONLY REALISM: apply the real garden environment from IMAGE 2 —
paving, lawn, trees, planting; blue hour dusk lighting — deep blue sky,
warm glowing festoon string lights and table candles dominant, festive
twilight atmosphere; realistic tablecloth movement in a gentle breeze;
photorealistic reflections on glassware; light atmospheric haze and soft
evening air.

STYLE: professional event photography, eye level 1.6m, wide angle 24mm,
photorealistic, high resolution, natural color grading. No people.
```

## מתכון מוכן C — תמונה אחת בלבד (fallback)

לפלטפורמה שמקבלת תמונת קלט אחת (בלי רפרנס אולם):

```
This image is a 3D render of an event hall with a furniture layout. Turn it
into a photorealistic professional event photograph. Keep the exact camera
angle, room geometry, and the exact placement, count, shape and colors of
every table, chair and object — do not add, remove or move anything.
Improve only realism: photorealistic materials, warm festive event lighting
(chandeliers, 2700K amber glow), realistic tablecloth folds, elegant table
settings, floor reflections, soft shadows. Professional event photography,
wide angle 24mm, high resolution. No people.
```

## מתכון מוכן D — תקריב שולחן (בונוס, שלב שני)

**מתי:** רק אחרי שנוצרה הדמיה ראשית שהלקוח אהב. **הקלט הוא ההדמיה שנוצרה** (תמונה אחת — לא הרינדור ולא צילום האמת), כך שהתקריב יורש ממנה את הזהות, התאורה והסטיילינג ונשאר עקבי איתה.

```
This image is a photorealistic photograph of a wedding event at a venue.
Generate a close-up detail shot from THIS SAME EVENT: camera moves close to
the round dining table in the foreground.

KEEP CONSISTENT WITH THE ORIGINAL IMAGE: the same tablecloth color and
fabric, the same chair covers with bows, the same table settings, the same
candles and glassware, the same lighting, atmosphere and background venue
(softly blurred).

SHOT: intimate editorial interior close-up, standard 50mm lens, seated eye
level 0.9m, shallow depth of field focused on the table setting — plates,
cutlery, wine glasses, centrepiece candles; glassware catching the warm
light; realistic fabric texture and tablecloth folds.

STYLE: professional event photography, photorealistic, natural color
grading, razor-sharp focus on the table setting. No people.
```

**וריאציות מתפריט ה־PDF:** תקריב כיסא בודד (`tight frame on the chair, fabric texture detail`) · תקריב סידור פרחים (`centrepiece focus, floral arrangement detail`) · זווית נמוכה דרמטית (`very low angle 0.4m, furniture legs prominent`).

## גרסת JSON מובנית — Nano Banana Pro

(מבוסס על התבנית המבנית של קטלוג nano-banana, מס' 111)

```
{
  "task": "Transform IMAGE 1 (3D render of an event hall layout) into a photorealistic event photograph inside the real venue shown in IMAGE 2",
  "layout_truth": "IMAGE 1 defines the exact camera angle, room geometry, and the exact placement, count, size, shape and colors of all tables, chairs, stage and dance floor. Nothing may be added, removed, moved, resized or recolored",
  "identity_truth": "IMAGE 2 defines the venue's real materials: floor, walls, ceiling, windows, light fixtures and overall atmosphere",
  "lighting": "warm festive event lighting, chandeliers and recessed downlights on, very warm 2700K amber glow, dark evening visible through windows, subtle warm haze around light sources",
  "realism_details": "realistic tablecloth folds and draping, elegant table settings with glassware catching the light, photorealistic floor reflections, soft contact shadows, fabric and upholstery texture",
  "composition": "exact framing of IMAGE 1, eye level 1.6m, wide angle 24mm architectural interior photography",
  "style": "professional event photography, photorealistic, natural color grading",
  "constraints": "no people, no new objects, no layout changes",
  "quality": "ultra high resolution, razor-sharp architectural detail"
}
```

---

## צ'קליסט נאמנות (למלא אחרי כל ריצה)

| בדיקה | איך בודקים | עובר? |
|---|---|---|
| כמות שולחנות | ספירה מול הרינדור | |
| כמות כיסאות (מדגם: 2 שולחנות) | ספירה מקומית | |
| מיקומי אובייקטים | הנחת שתי התמונות זו לצד זו — אף פריט לא זז/נוסף/נעלם | |
| צבעי מפות וכיסאות | השוואת גוונים | |
| גאומטריית האולם | קירות, פתחים, פרופורציות — ללא עיוות | |
| זווית מצלמה | אותו framing בדיוק | |
| זהות האולם | הרצפה/תקרה/גופי תאורה נראים כמו בתמונת האמת | |
| ריאליזם | בדים, השתקפויות, תאורה — נראה כמו צילום | |

**קריטריון הצלחה (Go):** בזוויות מבט־עין — אפס סטיות פריסה + זהות אולם משכנעת ברוב הריצות, לפחות בפלטפורמה אחת. **No-Go:** סטיות פריסה עקביות שלא נפתרות בחידוד הפרומפט ⇒ מסלימים לגישה ב' (רב־אותות) לפי מסמך העיצוב §9.

## טבלת תוצאות (למילוי)

| # | פלטפורמה | סצנה | מתכון | סטיות פריסה | זהות אולם | ריאליזם 1–5 | הערות |
|---|---|---|---|---|---|---|---|
| 1 | GPT Image 2 | אולם ערב | A | | | | |
| 2 | Nano Banana Pro | אולם ערב | A / JSON | | | | |
| 3 | Flux Kontext | אולם ערב | A | | | | |
| 4 | הטובה מ־1–3 | גן, שעה כחולה | B | | | | |
| 5 | הטובה מ־1–3 | מבט רחב עמוס | A מוגבה | | | | |

**טיפים מה־PDF:** אם התוצאה "יפה אבל לא נאמנה" — לחזק את בלוק ה־STRICT ולהוריד עומס מבלוק הריאליזם. אם "נאמנה אבל משעממת" — להוסיף ממד אחד בלבד (אטמוספירה או תאורה), לא הכול ביחד.

---

## תוצאות בפועל

### ריצה 1 — 2026-07-14 · אולם הריזורט (מרפסת הבריכה) · שעה כחולה
**פלטפורמה:** Higgsfield · **מודל:** GPT Image 2 (המועמד המיועד ל־API באפליקציה — האימות ישיר). אפסקייל: SeedVR2 ב־ComfyCloud.

**קבצים:** `HANAN-APP-DOCS/טסטים/` — ‏SketchUp: `ריסורט גאמוס.jpg` · צילום אמת: `זווית מקורית.png` · תוצר AI: ‏`hf_20260714_...png` · אפסקייל SeedVR2 (ComfyCloud): ‏`ComfyUI-upscaled_00046_.png` (5376×3040).

**ניתוח נאמנות (נבדק ויזואלית מול הרינדור וצילום האמת):**

| בדיקה | תוצאה |
|---|---|
| זווית מצלמה | ✅ נשמרה כמעט אחת־לאחת |
| זהות אולם | ✅ מצוינת — קיר הבלוקים המחוררים, מחיצות העץ, פנסי התקרה הגאומטריים, מעקה הזהב, הבריכה וההרים הועברו מצילום האמת |
| סגנון כיסאות | ✅ כיסויים לבנים עם פפיונים — נשמר כולל פרט הפפיון מהסקצ'אפ |
| פריסת שולחנות | ✅ בקירוב טוב — אותה התפלגות כללית; ⚠️ התאמת 1:1 של כמויות ומיקומים מדויקים טרם נספרה ביסודיות; נראית תזוזה/פיזור מחדש קל באזור הימני־אחורי |
| גאומטריית המבנה | ✅ נשמרה, כולל הגזיבו הלבן והקיר הכהה מהמודל |
| תוספות מבוקשות | שרשראות אורות, נרות וכלי שולחן, uplights — כולן הוזמנו בפרומפט (blue hour), לא הזיה |
| סטיות זהות קלות | ⚠️ הריצוף הפך קרם אחיד במקום אריחי השיש האפרפרים מצילום האמת; ⚠️ נוספו עצים/אדניות ומעקה זכוכית ליד הקיר האחורי |
| ריאליזם | 5/5 — רמת הדמיה שיווקית מלאה; האפסקייל של SeedVR2 חידד בדים ונורות ומתאים להדפסה |

**מסקנת ביניים: עובר — ההנחה המרכזית של הפרויקט אומתה בזווית מבט־עין.** נותרו לבדיקה: ספירת 1:1 בסצנה עמוסה (מבחן העומס), עקביות בין פלטפורמות, וחידוד שימור הריצוף.

**חידודי פרומפט לריצה הבאה (בעקבות הסטיות):**
- להוסיף ל־STRICT: ‏`keep the exact floor tile pattern, size and color from IMAGE 2` וכן `do not add trees, plants or railings that are not in IMAGE 1 or IMAGE 2`.
- לבדיקת ספירה: `keep exactly the same number of chairs around each table as in IMAGE 1`.

### ריצה 2 — 2026-07-14 · מבחן העומס · מבט מוגבה רחב · Higgsfield · GPT Image 2

**קבצים:** SketchUp: ‏`ריסורט גאמוס - מבט על.jpg` · צילום אמת מוגבה: `מבט על מקורית.png` · תוצר: `hf_20260714_131902_...png`.

| בדיקה | תוצאה |
|---|---|
| ספירת שולחנות | ✅ ~1:1 — שני אשכולות של 3 מאחור, שני בודדים באמצע, שניים גדולים מקדימה — כולם במקומם; ⚠️ בקצה התחתון של הפריים השולחנות החתוכים אוחדו/הוזזו קלות (ארטיפקט שולי־פריים) |
| מיקומי שולחנות | ✅ ההתפלגות המרחבית נשמרה כמעט מדויק, כולל המרווחים |
| כיסאות לשולחן | ✅ בקירוב נכון (~9–10 בשולחנות הקדמיים, כמו במקור) |
| מבנה | ✅ גזיבו, בריכה, גדר זכוכית עם עמודי זהב, קיר וידאו כהה — הכול במקום |
| זהות קירות | ⚠️ הפאנלים העליונים נשארו **כהים כמו במודל הסקצ'אפ** במקום קרם כמו בצילום האמת — המודל "ציית" ל־IMAGE 1 בקטע שבו המודל והמציאות סותרים |
| זהות רצפה | ⚠️ שוב אבן חלקה במקום גריד האריחים מצילום האמת |
| ריאליזם | 5/5 — תאורת הגזיבו, השתקפויות הבריכה והנרות ברמה שיווקית |

**מסקנה: מבחן העומס עבר בקריטריון הקריטי (פריסה 1:1).** שתי סטיות הזהות (קירות, רצפה) מובילות לשתי מסקנות מבניות: (א) **המודל בסקצ'אפ חייב להיות צבוע בחומרי האמת** — פאנל שחור במודל גורר פאנל שחור בתוצאה; (ב) נדרש מנגנון QA (ראו למטה).

### תובנת תהליך: Best-of-2 + QA (הצעת המשתמש, 2026-07-14)

נצפה בפועל: בבקשה שמייצרת **שתי מועמדות**, ברוב המקרים אחת מהן נאמנה 1:1. המסקנה למוצר: לא מסתמכים על ריצה בודדת — מייצרים N=2 מועמדות במקביל, ו**מודל QA ויזואלי** (LLM ראייה) משווה כל מועמדת לרינדור המקור: ספירת שולחנות, אשכולות ומיקומים, כיסאות מדגמיים, צבעים. המועמדת שעוברת נבחרת אוטומטית; אם שתיהן נכשלות — ריצה חוזרת. חיוני במיוחד במבטי־על, שבהם חובה התאמת 1:1 של אלמנטים. המנגנון עוגן במסמך העיצוב (§6).

</div>
