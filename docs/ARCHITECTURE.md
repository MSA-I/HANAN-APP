<div dir="rtl">

# ארכיטקטורת HANAN-APP

מסמך התמצאות לסוכן/מפתח חדש. מצב נכון ל־2026-07-14: **MVP הושלם ואומת**; העיצוב הבא בתור — הדמיות AI באולם האמיתי — מאושר וממתין למימוש (ראו `docs/design/ai-visualization-design.md`).

## 1. מה האפליקציה

מתכנן אירועים דו/תלת־ממדי בעברית (RTL מלא): מסדרים את האולם בעורך 2D בסגנון CAD ורואים את התוצאה מיידית בתצוגת 3D חיה. **הייעוד העסקי** (לאחר סשן העיצוב של 2026-07-14): כלי מכירות פנימי לבעל מתחם אירועים אחד — שני אולמות + שטחי חוץ (5 תצורות), שבו מעצבים אירוע בתוך מודל האולם האמיתי ומפיקים הדמיה פוטוריאליסטית באמצעות מודל תמונה AI (GPT Image 2). הדפדפן אחראי לזהות ודיוק; ה־AI לריאליזם בלבד.

## 2. סטאק

React 19 · TypeScript strict · Vite 6 · Tailwind v4 · Konva/react-konva (2D) · three.js/@react-three/fiber/drei (3D) · Zustand 5 + Immer + zundo (מצב + undo) · IndexedDB דרך idb + zod (התמדה) · vitest.

הרצה: `npm run dev` (פורט 3000) · בדיקות: `npm test` · שערי איכות: `npm run build` (tsc+build), `npm run lint`.

## 3. עקרון־העל

**מודל סצנה אחד = מקור אמת יחיד.** `src/core` (ללא תלות ב־React/Konva/three) מחזיק את מודל הסצנה; עורך ה־2D ותצוגת ה־3D הם שני "מפרשים" של אותם נתונים. אין המרות כפולות, אין מצב משוכפל.

```
קלט משתמש ──► state/actions.ts (מסלול הכתיבה היחיד)
                    │ Zustand + Immer (+ zundo על scene בלבד)
        ┌───────────┴───────────┐
        ▼                       ▼
   editor2d/ (Konva)      viewer3d/ (three)
   מפרש את הסצנה          מפרש את אותה סצנה
        │                       ▲
        └── בזמן גרירה: עדכוני transient ישירות ל-three
            (מוטציית אובייקט, בלי רינדור React) ──┘

persistence/ ◄── autosave (debounced) ◄── store subscribe
   IndexedDB (idb), סכמה מגורסת + מיגרציות + ולידציית zod
```

## 4. מפת מודולים

| תיקייה | אחריות |
|---|---|
| `src/core/model/` | טיפוסי הסצנה (`types.ts`), factory, reconciler הושבה (כיסאות עוקבים אחרי שולחן) |
| `src/core/catalog/` | ספריית אובייקטים מונחית־דאטה: `entries/*.ts` (שולחנות, כיסאות, במה, בר...). הוספת פריט = קובץ קטלוג בלבד, בלי לגעת ברנדררים |
| `src/core/layout/` | גאומטריית הושבה, snapping, bounds |
| `src/core/space.ts` | **המקום היחיד** להמרות plan↔three ויחידות |
| `src/core/migrations/` | מיגרציות סכמת פרויקט |
| `src/state/` | store (Zustand+zundo), `actions.ts` (כל מוטציה), selectors |
| `src/editor2d/` | קנבס Konva: שכבות, גרירה, Transformer, קיצורים, `captureBus.ts` (ייצוא PNG מנותק מ־Konva) |
| `src/viewer3d/` | סצנת three: `VenueMesh` (אולם), `ObjectGroup` (אובייקטים), instancing כיסאות, `CameraRig` + presets, תאורה |
| `src/ui/` | Toolbar, LibraryPanel, InspectorPanel, StatusBar, דיאלוגים — עברית ב־`strings.ts` |
| `src/persistence/` | `indexedDbRepository` (ממשק `ProjectRepository` — התפר העתידי ל־Supabase), autosave, ייצוא/ייבוא JSON, PNG |
| `src/app/` | Dashboard (כרטיסי פרויקטים + תצוגה מקדימה חיה) ומעטפת |

## 5. מוסכמות קריטיות (אל תפר)

1. **יחידות:** המודל כולו בס"מ; סיבוב במעלות **כיוון השעון** במבט־על; חזית אובייקט = ‎-y‎ ב־rotation 0. three.js: מטרים, y-up — ההמרה רק ב־`space.ts`.
2. **כל מוטציה דרך `state/actions.ts`.** אין כתיבה ישירה ל־store מרכיבים. (זו גם נקודת האכיפה המתוכננת לחסימת גבולות אולם — ראו מסמך העיצוב §7.)
3. **מחוות undo:** `beginGesture`/`endGesture` — snapshot + pause של zundo ⇒ גרירה שלמה = רשומת undo אחת.
4. **`objectOrder`** מכיל אובייקטי־שורש בלבד; כיסאות מחוברים (attachment) מרונדרים בתוך ה־Group של השולחן בשני הרנדררים, ממוינים לפי seatIndex.
5. **עברית/RTL:** כל טקסט UI ב־`ui/strings.ts`; קיצורי מקלדת לפי `e.code` (עובדים בפריסה עברית); קוד, קומיטים ושמות קבצים — אנגלית.
6. **ביצועים ב־3D:** עדכוני גרירה עוברים במסלול transient (ללא setState); כיסאות ב־instancing; ראו `meshCache.ts`.

## 6. מלכודות ידועות (נלמדו בדם)

- **zustand:** סלקטור שמחזיר אובייקט חדש ⇒ לולאת רינדור. להשתמש ב־`useShallow`.
- **react-konva:** אירועי Konva בתוך flushSync ⇒ אזהרות. עדכונים כבדים דרך overlayStore/batching.
- **WebGL:** שני קנבסים (Konva+three) + HMR ממושך עלולים לאבד context; בצילומי 3D לעטוף ב־recover (renderer מחדש + ניסיון שני).
- **Windows:** נתיב הפרויקט מכיל עברית ורווח — תמיד נתיבים אבסולוטיים במרכאות; קבצים זמניים ל־scratchpad בלבד, לא `/tmp`.

## 7. התמדה

IndexedDB מקומי בלבד (אין שרת, אין חשבונות). `Project` עם `schemaVersion` + מיגרציות + ולידציית zod בטעינה. autosave עם debounce וחיווי בשורת הסטטוס; תמונת preview לדשבורד דרך captureBus. גיבוי/העברה: ייצוא/ייבוא JSON.

## 8. מה הלאה (מאושר, לא ממומש)

**הדמיות AI באולם האמיתי** — העיצוב המלא, ההנחות ויומן ההחלטות ב־`docs/design/ai-visualization-design.md`. תמצית: חבילות אולם סטטיות (`venue-packs/`: GLB מ־SketchUp + footprint + זוויות מצלמה מכוילות + תמונות אמת), מודול `render/` חדש עם ממשק ספק־אגנוסטי (GPT Image 2 ראשון), זרימת Generate (צילום off-screen → API → מסך השוואה → גלריה ב־IndexedDB), אכיפה קשיחה של גבולות אולם ב־actions. **לפני מימוש: שלב 0 — PoC נאמנות (Go/No-Go).**

נדחה ל־v1.1+: קירות/דלתות/עמודים בעורך, קיבוץ, פאנל שכבות, PDF ודוחות, Supabase (התפר: `ProjectRepository`), שיתוף פעולה בזמן אמת.

</div>
