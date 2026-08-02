/**
 * Central UI string dictionary. Hebrew is the default locale.
 * All user-facing text must come from here — adding a locale later
 * means adding a dictionary, not rewriting components.
 */
export const strings = {
  appName: 'מתכנן אירועים',
  /**
   * Unit suffixes, so a value and its unit stop being welded together in a
   * dozen labels. `inspector.posX` and friends still spell theirs out inline;
   * they can move onto these when someone is editing them anyway.
   *
   * ⚠ `meters` ends in a GERESH — U+05F3 ׳ — not an ASCII apostrophe. They look
   * alike at 14px and are different characters: the ASCII one is a bidi-neutral
   * quote that flips to the wrong side of the word under dir="rtl".
   */
  units: {
    meters: 'מ׳',
    degrees: '°',
  },
  workspace: {
    loading: 'טוען פרויקט…',
    loading3d: 'מכינים את התצוגה התלת־ממדית…',
    /**
     * ⚠ UNCHANGED ON PURPOSE. It promises dragging, and dragging is being built
     * this round — so it stops being a lie rather than needing a rewrite.
     */
    emptyCanvasHint: 'גררו פריטים מהספרייה כדי להתחיל לתכנן',
    /**
     * The empty canvas today is one grey pill in the middle of the plan. These
     * turn it into the three things a first-time user needs: what they are
     * looking at, the second way in (the layout presets, which need no dragging
     * at all), and where the rest of the answers live.
     */
    emptyCanvasTitle: 'האולם ריק',
    emptyCanvasLayouts: 'או בחרו פריסת אולם מוכנה מהתפריט שמשמאל',
    emptyCanvasHelp: 'כל הקיצורים והעזרה — בכפתור ?',
    /** the drop target lights up under a dragged library tile */
    dropHere: 'שחררו כאן כדי להציב',
    /** the armed-placement chip: what is about to be placed, and the way out */
    placingChip: (name: string) => `הצבת ${name} · Esc לביטול`,
    /**
     * The 3D view arrives in two stages and the wait is long enough that a bare
     * spinner reads as a hang: first the viewer CHUNK (a dynamic import), then
     * the venue model and its textures. Naming which stage is running is the
     * difference between "slow" and "stuck".
     */
    loading3dModule: 'טוען את מנוע התלת־ממד…',
    loading3dAssets: 'טוען את האולם…',
    loading3dPercent: (n: number) => `${n}%`,
    /** shown once the wait passes the point where silence starts to worry people */
    loading3dSlow: 'הטעינה הראשונה אורכת מספר שניות',
  },
  toolbar: {
    backToDashboard: 'חזרה לפרויקטים',
    undo: 'ביטול',
    redo: 'ביצוע חוזר',
    clearAll: 'ניקוי כל האלמנטים',
    /** the two pointer tools, for a tooltip that pairs with `chordFor('selectTool')` */
    selectTool: 'כלי בחירה',
    handTool: 'כלי יד',
    help: 'עזרה וקיצורי מקלדת',
    /**
     * Clearing the plan is the one irreversible-feeling action in the toolbar,
     * so it says how much it is about to take and then asks a second time —
     * `clearAllArmed` is the label the button wears between the two presses.
     */
    clearAllWithCount: (n: number) => `ניקוי כל האלמנטים (${n})`,
    clearAllArmed: 'לחצו שוב לניקוי הכול',
    export: 'ייצוא',
    exportPng: 'תוכנית רצפה (PNG)',
    exportJson: 'קובץ פרויקט (JSON)',
    importJson: 'ייבוא מקובץ JSON…',
    grid: 'רשת',
    snap: 'הצמדה',
    labels: 'תוויות',
    view2d: '2D',
    viewSplit: 'מפוצל',
    view3d: '3D',
    kabalatPanim: 'קבלת פנים',
    hall: 'אולם',
    /**
     * The kabalat-panim toggle used to be an icon with `kabalatPanim` as its only
     * tooltip, which did not say what pressing it would do (source doc §18). These
     * two are the button's LABEL IN EACH STATE, not two names for one mode:
     * `…Off` shows while `activeZone === 'hall'` (press to go there),
     * `…On` shows while `activeZone === 'kabalatPanim'` (press to come back).
     */
    kabalatPanimOff: 'מעבר לקבלת פנים',
    kabalatPanimOn: 'חזרה לאולם',
    /** the 2D lighting-planning mode: beam grid over a dimmed plan (source doc §33) */
    lightingPlan: 'תכנון תאורה',
  },
  /**
   * The AI-render export (PLAN-08): one angle leaves as a folder holding the
   * capture, the prompt and the reference images. Owned here rather than in
   * viewer3d/strings3d.ts because that file belongs to the 3D viewer.
   */
  promptExport: {
    one: 'ייצוא הזווית הזו — צילום, פרומפט ורפרנסים',
    all: 'ייצוא כל הזוויות',
    allBusy: 'מייצא…',
    done: 'הייצוא הושלם',
    failed: 'הייצוא נכשל',
    /** shown when there is no dev server to write to and we fall back to a download */
    downloaded: 'אין שרת פיתוח — הורדו הצילום והפרומפט בלבד',
    /**
     * Title of the fixed background reference PLAN-08 adds alongside the hall
     * material shot and the product shots. Hebrew because it is shown to the user;
     * the English caption that travels INTO the prompt belongs in prompts/refs.ts.
     */
    backgroundRef: 'רפרנס רקע',
    /**
     * PLAN-05 C1's floor close-up, same job as `backgroundRef` above: a "not on
     * disk" warning otherwise reaches the user as a raw path. It matters more
     * here than for the other two — this one is a stand-in swatch that is meant
     * to be replaced by a real photograph of the hall's floor, and the day it is
     * swapped out is a day the warning can appear.
     */
    floorRef: 'רפרנס ריצוף',
  },
  status: {
    saved: 'נשמר',
    saving: 'שומר…',
    saveFailed: 'השמירה נכשלה — מנסים שוב',
    loadFailed: 'טעינת הפריסות נכשלה',
    /**
     * PLAN-09 item 15. `rotateObjectsBy` is all-or-nothing by design (`poseAllowed`,
     * actions.ts:210-216 · :1801-1811) and today refuses in complete silence, which
     * from the outside is indistinguishable from a rotation that is stuck on
     * detents — which is very likely part of what the user reported. The plan
     * changes the FEEDBACK, not the semantics; this is that feedback.
     */
    rotationRefused: (n: number) =>
      n === 1
        ? 'פריט אחד לא הסתובב — אין לו מקום חוקי בזווית הזו'
        : `${n} פריטים לא הסתובבו — אין להם מקום חוקי בזווית הזו`,
    /**
     * Same shape as the rotation refusal above, and for the same reason: a mirror
     * MOVES a table's chairs, so it can be refused even though the table's own
     * outline reflects onto itself. Without this the click reads as broken.
     */
    mirrorRefused: (n: number) =>
      n === 1
        ? 'פריט אחד לא שוקף — אין לו מקום חוקי בכיוון הזה'
        : `${n} פריטים לא שוקפו — אין להם מקום חוקי בכיוון הזה`,
    /**
     * One shared line for the three copy routes — duplicate, paste and
     * mirror-with-copy. A `unique` item may exist once (source doc §62/§43) and
     * `addObject` has always said so; the copy routes used to make a second one
     * in silence, which is the same rule disagreeing with itself in three places.
     */
    uniqueNotCopied: (n: number) =>
      n === 1
        ? 'פריט אחד לא שוכפל — הוא יכול להופיע פעם אחת בלבד'
        : `${n} פריטים לא שוכפלו — הם יכולים להופיע פעם אחת בלבד`,
    /**
     * Why a placement was refused (core/layout/collision.ts `Violation`). `{…}`
     * placeholders are filled by StatusBar: numbers from the violation itself,
     * zone names from the venue pack's own Hebrew labels.
     */
    violation: {
      collision: 'התנגשות עם פריט קיים',
      spacing: 'מרחק {actual} ס״מ — נדרש {required} ס״מ',
      outOfBounds: 'מחוץ לגבולות האולם',
      forbiddenZone: 'לא ניתן להניח באזור {zone}',
      // "באזור", not "סביב": StatusBar substitutes the zone's own label, and one of
      // them is already "סביב הבריכה" — the old wording produced "רק סביב סביב הבריכה".
      wrongZone: 'פריט זה מותר רק באזור {zone}',
      nearWall: 'יש להניח צמוד לקיר (עד {within} ס״מ)',
      /**
       * ⚠ It named the place setting outright and was shown for EVERY host. The
       * violation has carried `requires` — the host's catalog id — since it was
       * written (collision.ts), and StatusBar simply ignored it, so a floral
       * arrangement refused for want of its inner table was told to lay cutlery.
       *
       * StatusBar resolves the id through `catalog.items`, so the napkins render
       * byte-identical to before ('ערכת סכו״ם' is `decorPlaceSetting`) and
       * `ring.table` finally says 'שולחן פנימי'.
       */
      missingHost: (item: string) => `יש להניח ${item} קודם`,
      duplicate: 'כבר קיימת חופה בסצנה',
      /** two decor items on the SAME table overlapping each other (PLAN-06) */
      overlapsSibling: 'חופף לקישוט אחר על השולחן',
    },
  },
  catalog: {
    items: {
      tableRound: 'שולחן עגול',
      tableRoundLarge: 'שולחן עגול גדול',
      tableSquare: 'שולחן מרובע',
      // the venue butts these end to end; 'בודד'/'כפול' keeps the two apart in the
      // library, which would otherwise show two items both called 'שולחן אבירים'
      tableBanquet: 'שולחן אבירים בודד',
      tableKnights: 'שולחן אבירים כפול',
      tableSerpentine: 'שולחן נחש',
      chuppahDrapedWhite: 'חופת וילונות לבנה',
      chuppahDrapedBlush: 'חופת וילונות אפרסק',
      chuppahRuchedIvory: 'חופת קפלים שנהב',
      chuppahAcrylic: 'חופת אקריל שקופה',
      chuppahFrameChrome: 'חופת מסגרת כרום',
      chuppahRoundWhite: 'חופה עגולה לבנה',
      chuppahRoundBeige: 'חופה עגולה שמנת',
      chuppahArchLattice: 'שער סורגים',
      // the ninth canopy: sheer white drapes under a round rim carried entirely by a
      // crown of ivory roses and hydrangeas. That crown is what tells it apart from
      // chuppahRoundWhite, so it is what the label names — the KEY groups by form with
      // its round sisters, the LABEL names the difference.
      chuppahRoundFloral: 'חופה עם כתר פרחים',
      // the venue's six real chairs — the user's own names for them
      chairXWhite: 'לבן איקס',
      chairXWood: 'עץ איקס',
      chairGoldWhite: 'זהב ריפוד לבן',
      chairGoldBlack: 'זהב ריפוד שחור',
      chairBrown: 'חום',
      chairBlack: 'שחור',
      // its own category — a curved two-seat settee, not one of the guest chairs
      chairBridal: 'כסא כלה',
      djBooth: 'עמדת DJ',
      bar: 'בר',
      buffet: 'עמדת בופה',
      // The resort's own built-in bar, back wall and DJ stand, lifted out of the
      // venue model (PLAN-01). They sit beside the generic `bar`/`djBooth` in the
      // library, so each carries a distinguishing word for the same reason
      // 'בודד'/'כפול' keeps the two banquet tables apart above.
      barResortLeft: 'בר ריזורט שמאל',
      barResortRight: 'בר ריזורט ימין',
      barBackWall: 'קיר מאחורי הבר',
      djResort: 'עמדת DJ ריזורט',
      plant: 'צמחייה 1',
      plant2: 'צמחייה 2',
      divider: 'מחיצה',
      /**
       * The user asked for "דמות אדם" — a human figure, so a render has something
       * to give it scale, and placeable anywhere including where nothing else may
       * go (source doc §17/§29). One model exists for it: `דמות אישה.glb`, a single
       * woman. REAL-INVENTORY PRINCIPLE (BRIEF §1.1) — one catalog item is one thing
       * that exists — so the label names the model that is actually on disk rather
       * than the category it stands in for. A man's figure would need a file nobody
       * has; PLAN-02 gate 1 is exactly that question.
       */
      humanFigure: 'דמות אישה',
      // ceiling-hung — the height in each entry IS the drop from the ceiling
      lampPendant: 'מנורה תלויה',
      lampPendantCluster: 'מקבץ מנורות גיאומטרי',
      lampChandelierDiamond: 'נברשת יהלום',
      lampChandelierBasket: 'נברשת סל קריסטל',
      lampChandelierCandelabra: 'נברשת קנדלברה',
      // floor-standing despite its "chandelier" filename — see entries/decor.ts
      lampArcCrystal: 'מנורת קשת קריסטל',
      // table-top decor — the resort's real centerpiece inventory
      decorCandlestickBrass: 'פמוט פליז',
      decorVaseCeramic: 'ואזה קרמית',
      decorGobletCrystal: 'ואזות קריסטל',
      decorCandelabraCrystal: 'קנדלברה קריסטל',
      decorCandleholderCrystalA: 'מחזיקי נר קריסטל',
      decorCandleholderCrystalB: 'קנדלברת תליונים',
      decorVasesDecorative: 'סט ואזות דקורטיבי',
      decorVaseFlowersA: 'שלישיית ואזות פרח',
      decorVaseFlowersB: 'ואזת פרחים',
      // the labelKey stays `fabricFolded` — a stable id; only the label changed
      decorFabricFolded: 'מפית מקופלת',
      // ⚠ CHANGED VALUE, not a new key (round 3 item 12, PLAN-05). The user renamed
      // it: the fold is ROLLED, and 'מפית שטוחה' described the wrong thing — it read
      // as a napkin lying flat. One per cover, laid on the place setting; the KEY and
      // the catalog id `decor.napkin-folded` are deliberately unchanged, because
      // renaming either needs a migration and breaks saved projects for nothing.
      // No test asserts this string — the tests key off ids (BRIEF §1.7).
      // `entries/tableDecor.ts:138` still carries 'מפית שטוחה' in a comment; that
      // file is PLAN-05's, so it is logged as a stale comment rather than edited here.
      decorNapkinFolded: 'קיפול מפית מגולגל',
      decorCandleholdersGlass: 'מחזיקי נר זכוכית',
      decorCandelabrumGold: 'קנדלברום זהב',
      decorCandlestickGold: 'פמוט זהב',
      decorVasesGoldStriped: 'ואזות פסי זהב',
      decorCandelabrumGolden: 'קנדלברום מוזהב',
      decorTopiaryGreen: 'טופיארי ירוק',
      decorVasePampas: 'סידור פמפס',
      decorTulipsPink: 'צבעונים ורודים',
      decorBouquetRoses: 'זר ורדים',
      decorVasesRoseGold: 'ואזות רוז־גולד',
      decorVaseStriped: 'ואזה מפוספסת',
      decorVasesWhiteCeramic: 'ואזות קרמיקה לבנות',
      decorNapkinWhite: 'מפית לבנה',
      decorCandleholdersWood: 'מחזיקי נר עץ',
      decorCandlestickWood: 'פמוט עץ',
      decorPlaceSetting: 'ערכת סכו״ם',
      // The five covers that carry their own napkin (R5 PLAN-01 §5.6). The
      // 'ערכה — <fold>' pattern is what makes the `סוג הערכה` dropdown read as a
      // list of FOLDS: every option starts with the same word, so the eye lands on
      // the part that differs. They are ערכות, not מפיות — a napkin here is not a
      // separate item the user drops, it comes with the cover.
      // All five confirmed by the user against the rendered thumbnails, 2026-08-02.
      // מאוזן/מאונך came from the source filenames and were NOT self-evident — they
      // were checked against the renders and are right: מאוזן lies left-to-right
      // across the guest, מאונך lies toward and away from him.
      //
      // ⚠ No colour in any label, deliberately, even though two of the five folds
      // arrive coloured (folded is olive, tied is copper). The napkin carries its
      // own material slot, so the colour is the user's — a label naming it would
      // become a lie the moment he picks another one.
      decorPlaceSettingDiagonal: 'ערכה — מפית באלכסון',
      decorPlaceSettingHorizontal: 'ערכה — מפית במאוזן',
      decorPlaceSettingVertical: 'ערכה — מפית במאונך',
      decorPlaceSettingFolded: 'ערכה — מפית מקופלת',
      // The user's own word for it: the napkin is gathered through a RING (חבק),
      // not knotted. 'קשירה' described the gesture; this describes the object, and
      // the ring is the thing the eye actually picks out in the thumbnail.
      decorPlaceSettingTied: 'ערכה — מפית עם חבק',
      // tableDesigns — the four centrepieces the venue bought as a set (source
      // doc §41/§47). The fourth model arrived at 19:07 on 2026-07-28, after the
      // round that shipped the first three had already scanned the folder — which
      // is why BLOCKED-02-A2 reports three and is not wrong.
      designCandelabrumCrystal: 'פמוט קריסטל',
      designLampGlassRod: 'מנורת מוט זכוכית',
      designOrchidSculpture: 'פסל סחלבים',
      // the other 13-light candelabrum: all glass, and every candle stands in its
      // own tall chimney. The chimneys are what tell it apart from `…Crystal`
      // above, so they are what the label says.
      designCandelabrumHurricane: 'פמוט ארובות זכוכית',
      // ringCenter — the small round table that drops into the ⌀156 hole of the
      // large round table, and the floral piece that stands on it (source doc §39/§46).
      ringTable: 'שולחן פנימי',
      ringFloral: 'עיצוב פרחים מרכזי',
      // chuppahDecor — floor decoration set beside the chuppah (source doc §31/§35)
      chuppahDecor1: 'קישוט חופה 1',
    },
    // one key per Category (core/catalog/types.ts), in CATEGORY_ORDER
    categories: {
      tables: 'שולחנות',
      seating: 'ישיבה',
      bridalChair: 'כסא כלה',
      bars: 'בר ומזנון',
      tableware: 'סכו״ם ומפיות',
      tableDecor: 'קישוטי שולחן',
      tableDesigns: 'עיצובי שולחן',
      // `ringCenter: 'עיצובי שולחן עיגול גדול'` was here until v13. Its two items
      // list under שולחנות now — see core/catalog/types.ts.
      lighting: 'תאורה',
      decor: 'עיצוב',
      chuppah: 'חופות',
      chuppahDecor: 'עיצובי חופה',
    },
    slots: {
      cloth: 'מפה',
      legs: 'רגליים',
      upholstery: 'ריפוד',
      canopy: 'יריעה',
      frame: 'שלד',
      body: 'גוף',
      counter: 'דלפק',
      pot: 'עציץ',
      foliage: 'עלווה',
      /**
       * Round 4: the divider's curtain. It replaces `panel`, which was the
       * placeholder screen's single slot and had no other reader once the real
       * model arrived segmented into curtain + frame (entries/decor.ts).
       */
      fabric: 'בד',
      /** PLAN-02/A2: the figure's single material slot */
      figure: 'דמות',
      /**
       * PLAN-05 item 28. The place setting is being re-imported segmented, so what
       * was one material becomes several, and the metal one becomes glass. These
       * are the parts the segmentation is expected to expose. Unlike `categories`
       * above this lookup is guarded (`?? editableSlot.name`, `InspectorPanel.tsx:357`)
       * so a wrong guess degrades to the raw slot name instead of breaking — but a
       * present key is still the difference between a Hebrew label and an English one.
       */
      plate: 'צלחת',
      cutlery: 'סכו״ם',
      glass: 'זכוכית',
      glasses: 'כוסות',
      metal: 'מתכת',
      /** PLAN-05 item 14: the texture set is "צבעי מפות ומפיות" — cloths and napkins */
      napkin: 'מפית',
      /** PLAN-02/R5: the wax column the splitter separates from its holder (tools/glb-prep/split-candles.mjs) */
      candle: 'נר',
    },
  },
  library: {
    title: 'ספרייה',
    size: 'גודל תצוגה',
    search: 'חיפוש פריטים…',
    noResults: 'אין תוצאות עבור',
    clearSearch: 'ניקוי חיפוש',
    placeHint: 'גררו ללוח או לחצו להצבה',
    replaceSelected: 'החלפת הפריט הנבחר',
    replaceActive: 'בחרו פריט חלופי מהספרייה',
    replaceHint: 'החלפת הפריט הנבחר בפריט זה',
    replaceIncompatible: 'סוג ההצבה אינו תואם לפריט הנבחר',
    collapse: 'כיווץ הספרייה',
    expand: 'הרחבת הספרייה',
    /**
     * Subtitle on a tile whose entry declares `librarySubtitle: 'seats'` (PLAN-03,
     * source doc §20): the chair count instead of the footprint. `seatsSuffix` is
     * the bare noun for `${n} ${seatsSuffix}`; `seatsLabel` is the same thing
     * already assembled, which is what a caller should reach for.
     */
    seatsSuffix: 'כסאות',
    seatsLabel: (n: number) => `${n} כסאות`,
    /**
     * The quick-filter chips under the search box.
     *
     * ⚠ EACH CHIP IS BOTH THE LABEL AND THE QUERY. Clicking one types it into the
     * search box, so every word here has to read as something the user could have
     * typed — not as a category name and not as an abbreviation. That is also why
     * they are singular: the search matches by substring over normalised text
     * (ui/librarySearch.ts), so 'נר' finds 'נרות' and 'שולחן' finds 'שולחנות',
     * while the plural would find only itself.
     *
     * About a dozen, because the row wraps and a third line of chips costs more
     * screen than the filtering saves. They are the families a user actually
     * hunts for; anything rarer is what the box itself is for.
     */
    chips: [
      'שולחן',
      'כסא',
      'חופה',
      'תאורה',
      'נר',
      'פרחים',
      'ואזה',
      'מפית',
      'בר',
      'בופה',
      'צמחייה',
      'מחיצה',
      // the one chip that is an adjective rather than a thing, and it earns its
      // place: shape is how a venue manager asks for a table
      'עגול',
    ] as const,
  },
  presets: {
    tableDesign: 'עיצוב שולחן',
    hallDesign: 'פריסות תאורה',
    layouts: 'פריסות אולם',
    savedLayouts: 'פריסות אישיות',
    saveSelection: 'שמירה כפריסה',
    saveTitle: 'שמירת פריסה אישית',
    layoutName: 'שם הפריסה',
    layoutNamePlaceholder: 'לדוגמה: קבלת פנים',
    layoutOnly: 'פריסה בלבד',
    layoutOnlyHint: 'מיקום, גודל, סוג וכיסאות ללא צבעים וקישוטים',
    layoutWithDesign: 'פריסה + עיצוב',
    layoutWithDesignHint: 'כולל צבעים, חומרים וקישוטים מחוברים',
    saveLayout: 'שמירת הפריסה',
    saveHall: 'שמירת פריסת האולם',
    saveHallTitle: 'שמירת פריסת אולם',
    noTables: 'אין שולחנות באולם לשמירה',
    cancelSave: 'ביטול',
    deleteSavedLayout: 'מחיקת פריסה',
    confirmDeleteSavedLayout: (name: string) => `למחוק את הפריסה „${name}”?`,
    renameSavedLayout: 'שינוי שם',
    renamePrompt: 'שם חדש לפריסה:',
    confirmOverwrite: (name: string) => `כבר קיימת פריסה בשם „${name}”. להחליף אותה?`,
    lightingLayouts: 'פריסות תאורה אישיות',
    saveLighting: 'שמירת פריסת התאורה',
    saveLightingTitle: 'שמירת פריסת תאורה',
    noLighting: 'אין גופי תאורה בסצנה לשמירה',
    removeLightingLayout: 'הסרת פריסת התאורה',
    layoutUnavailable: 'הפריסה אינה זמינה — פריט מהקטלוג הוסר',
    unavailableBadge: 'לא זמינה',
    layoutVenueMismatch: 'הפריסה נשמרה לאולם אחר',
    savedDesigns: 'עיצובים שמורים',
    saveDesign: 'שמירת העיצוב הנוכחי',
    saveDesignTitle: 'שמירת עיצוב שולחן',
    designName: 'שם העיצוב',
    designNamePlaceholder: 'לדוגמה: זהב חגיגי',
    noDesignToSave: 'סדרו קישוטים על השולחן לפני השמירה',
    designPickHint: 'בחרו שולחן כדי להחיל עליו עיצוב',
    designLocked: 'השולחן נעול — יש לפתוח את הנעילה או את שכבת השולחנות',
    designNoTable: 'יש לבחור שולחן',
    placeSettings: 'ערכת סכו״ם',
    placeSettingsOff: 'אין ערכות על השולחן',
    placeSettingsCount: (laid: number, seats: number) => `${laid} מתוך ${seats} מקומות`,
    placeSettingsAdd: 'פריסה על כל המקומות',
    placeSettingsRemove: 'הסרת הערכות',
    placeSettingsType: 'סוג הערכה',
    /**
     * ⚠ CHANGED VALUE, not a new key. The `\n\n` was a `window.confirm`
     * artefact — the only way that dialog had to separate a question from its
     * explanation. In a real dialog the question is the TITLE and the
     * explanation is the BODY, so they are two strings now. Nothing fails at
     * compile time if a caller keeps using `bakeConfirm` alone; it just loses
     * the second paragraph, which is why this is called out here.
     */
    bakeConfirm: (count: number) => `לקבע ${count} אלמנטים לתוך קוד המקור?`,
    bakeConfirmBody:
      'הפעולה כותבת את src/core/venueFixtures.ts. האלמנטים ייטענו בכל פרויקט חדש ולא ניתן יהיה להזיז או למחוק אותם.',
    bakeDone: (count: number) => `${count} אלמנטים נכתבו ל-venueFixtures.ts`,
    bakeFailed: 'הקיבוע נכשל',
    bakeEmpty: 'אין אלמנטים לקיבוע',
    /**
     * PLAN-04/G2 — item 7. The button already exists and always did; the user could
     * not find it because he searched for "שמירת מיקום אלמנטים" and the label said
     * "קיבוע". A discovery fix, not a feature. The old `bake` label was kept for one
     * round so nothing broke mid-flight, and is gone now that the switch has landed.
     */
    bakeSaveElements: 'שמירת מיקום האלמנטים (פיתוח)',
    bakeHint: 'כותב את מיקומי האלמנטים לתוך קוד המקור — לפיתוח בלבד',
    /**
     * PLAN-04 item 22: "אם אני לוחץ על פריסות אולם צריך שייפתח תפריט… שממנו אני
     * יכול לשנות עיצובים וסוג כסאות לאותה פריסה". Clicking a card applies it on the
     * spot today (`PresetsSection.tsx:611`, and the file header states it as a rule);
     * the card now opens this panel instead, and applying is a second, explicit step.
     * `layoutApplyNow` keeps the old one-click path available.
     */
    layoutOptions: 'הגדרות הפריסה',
    layoutOptionsHint: 'בחרו עיצוב וסוג כסאות, ואז החילו את הפריסה',
    layoutDesign: 'עיצוב השולחנות',
    layoutDesignNone: 'ללא עיצוב',
    layoutChairType: 'סוג כסאות',
    /** each preset already carries a chair baked into its id (`presets.ts:65-79`) */
    layoutChairDefault: 'הכסא של הפריסה',
    layoutApply: 'החלת הפריסה',
    layoutApplyNow: 'החלה מיידית',
    layoutBack: 'חזרה לפריסות',
    frozenNotice: 'אלמנט קבוע של האולם — לא ניתן להזיז, לשנות או למחוק',
    autoFill: 'מילוי אוטומטי',
    choose: 'בחרו…',
    apply: 'החל',
    applyAll: 'החל על כל השולחנות',
    remove: 'הסרת העיצוב',
    removeLayout: 'הסרת הפריסה',
    fillHall: 'מלא אולם',
    fillHint: 'ממלא את השטח הפנוי בשולחנות מהפריסה שנבחרה — מוסיף בלבד, לא מזיז את הקיים',
    seatsSuffix: 'מקומות',
    tablesSuffix: 'שולחנות',
    /** hall design: the height its fixtures hang at, measured from the floor up (source doc §43) */
    floorDistance: 'מרחק מהרצפה',
    items: {
      presetRound12GoldWhite: 'עגול 180 · 12 · זהב לבן',
      presetRound10XWhite: 'עגול 180 · 10 · לבן איקס',
      presetRoundLarge22GoldBlack: 'עגול 380 · 22 · זהב שחור',
      // 10, not 12: the label, `seating.defaultCount` and the preset's `seatCount`
      // are one number in three places and PLAN-03 aligns the other two (source doc §48)
      presetSquare8XWood: 'מרובע 160 · 10 · עץ איקס',
      presetBanquet12Black: 'אבירים 240 · 12 · שחור',
      presetKnights22Brown: 'אבירים 480 · 22 · חום',
      presetSerpentine20XWhite: 'נחש · 20 · לבן איקס',
      designClassicGold: 'קלאסי זהב',
      designCrystal: 'קריסטל',
      designFloralPink: 'פרחוני ורוד',
      designRusticWood: 'כפרי עץ',
      hallPendants: 'מנורות תלויות',
      hallPendantClusters: 'מקבצי מנורות',
      hallChandeliersDiamond: 'נברשות יהלום',
      hallChandeliersBasket: 'נברשות סל קריסטל',
      hallChandeliersCandelabra: 'נברשות קנדלברה',
      layoutRoundsClassic: 'עגולים קלאסי (דוגמה)',
      layoutKnightsRows: 'אבירים לאורך (דוגמה)',
    },
  },
  lighting: {
    title: 'תאורה חיצונית',
    day: 'יום',
    sunset: 'שקיעה',
    night: 'לילה',
    sunAzimuth: 'כיוון השמש',
    sunElevation: 'גובה השמש',
    sunIntensity: 'עוצמת השמש',
    /**
     * PLAN-03 item 5: "להוסיף בתפריט מצד שמאל אופציה לשלוט בחדות הצל" — the left
     * menu is `InspectorPanel` (BRIEF §1.6 flips the sides under dir="rtl"), and
     * the natural home is `LightingSection`, which is where the other four sun
     * controls already live.
     *
     * ⚠ "חדות" must map to something the user actually sees: the shadow map's
     * resolution and/or the `ContactShadows` resolution. NOT `SHADOW_BIAS` — bias
     * controls acne, not sharpness, and moving it reads as a bug.
     */
    shadows: 'צללים',
    /** PLAN-05 C2 — "הצל לא עובד לטובתנו צריך לעשות כפתור שמכבה או מדליק את הצל" */
    shadowsOn: 'צללים בתצוגה',
    shadowsHint:
      'כיבוי מבהיר את התצוגה ואת הצילום שנשלח למודל התמונה. הרינדור הסופי עדיין יכלול צללים טבעיים',
    shadowSharpness: 'חדות הצל',
    shadowSharpnessHint: 'מפת צל גדולה יותר — קצוות חדים יותר, ומעט יותר עומס על כרטיס המסך',
    shadowSharpnessLow: 'רכה',
    shadowSharpnessMedium: 'בינונית',
    shadowSharpnessHigh: 'חדה',
    /** the shadow map is a GPU resource and is disposed and rebuilt when this moves */
    shadowUpdating: 'מעדכן צללים…',
  },
  inspector: {
    projectTitle: 'פרויקט ואולם',
    projectName: 'שם הפרויקט',
    eventDate: 'תאריך האירוע',
    venue: 'האולם',
    venueName: 'שם האולם',
    venueDims: 'מידות',
    wallHeightInfo: 'גובה קירות',
    summary: 'סיכום',
    layers: 'שכבות',
    layerShow: 'הצגת השכבה',
    layerHide: 'הסתרת השכבה',
    layerLock: 'נעילת השכבה',
    layerUnlock: 'ביטול נעילת השכבה',
    layerLockedNotice: 'קטגוריית הפריט נעולה בשכבות',
    transform: 'מיקום וגודל',
    posX: 'X (מ׳)',
    posY: 'Y (מ׳)',
    width: 'רוחב (מ׳)',
    depth: 'עומק (מ׳)',
    diameter: 'קוטר (מ׳)',
    height: 'גובה (מ׳)',
    rotation: 'סיבוב (°)',
    seating: 'הושבה',
    seats: 'מקומות ישיבה',
    maxSeats: 'מקסימום',
    spacing: 'מרווח כיסאות (ס״מ)',
    chairModel: 'דגם כיסא',
    /** swaps every chair around the selected table for another catalog chair (PLAN-07) */
    chairType: 'סוג הכסא',
    appearance: 'מראה',
    name: 'שם',
    lockedNotice: 'האובייקט נעול',
    unlock: 'ביטול נעילה',
    itemsSelected: 'פריטים נבחרו',
    align: 'יישור',
    distribute: 'פיזור',
    alignStart: 'יישור לימין הלוח',
    alignCenterX: 'מרכוז אופקי',
    alignEnd: 'יישור לשמאל הלוח',
    alignTop: 'יישור למעלה',
    alignCenterY: 'מרכוז אנכי',
    alignBottom: 'יישור למטה',
    distributeX: 'פיזור אופקי',
    distributeY: 'פיזור אנכי',
    deleteSelected: 'מחיקת הנבחרים',
    belongsTo: 'משתייך לשולחן',
    replaceItem: 'החלפת פריט',
    replaceItemActive: 'בחרו פריט חלופי מהספרייה',
    hanging: 'תלייה',
    hangHeight: 'גובה תלייה (מ׳)',
    // A fixture pins to the nearest BEAM and slides along it (core/layout/beams.ts
    // snapToBeam). It used to pin to a CROSSING, which on the resort truss is 36
    // points in the whole hall and is what made a chandelier feel locked — this
    // hint outlived that behaviour by one wave.
    hangHint: 'הנברשת נתלית על קורת התקרה ומחליקה לאורכה',
    /**
     * PLAN-09 items 24–25: Ctrl+A selects everything, and then this narrows it
     * down. The categorisation is the one `LayersSection` already uses — catalog
     * category — because that is the grouping the user has already learnt; PLAN-09
     * gate 1 is open on whether he meant per-table or per-layer instead.
     * ⚠ `selection` is an `Id[]` and lives OUTSIDE the undo zone (`store.ts:23, 58`).
     */
    selectionFilter: 'מסנן בחירה',
    selectionFilterHint: 'סמנו קטגוריות כדי לצמצם את הבחירה',
    selectionFilterAll: 'הכול',
    selectionFilterNone: 'ניקוי הסימון',
    selectionFilterApply: 'צמצום הבחירה',
    /** `itemsSelected` above is the bare noun; this one is the assembled sentence */
    selectedCount: (n: number) => `${n} פריטים נבחרו`,
    selectAll: 'בחירת הכול',
    /**
     * The 22 fabric swatches. LIVE since round 4 §8 — `ui/fields.tsx`'s
     * `TextureField`, rendered by `AppearanceSection` for every slot whose
     * `EditableSlot` says `texture: true` (the six tables, the three napkins, the
     * divider's curtain). They were seeded a round earlier with no reader.
     *
     * `textureNone` labels the first tile, and it is a real choice rather than a
     * reset: "no texture" is stored, and is not the same as never having picked
     * (see `AppearanceOverrides`).
     */
    texture: 'טקסטורה',
    textureNone: 'ללא טקסטורה',
    /** aria-labels for a collapsible section header — the pair `library` already has */
    expand: 'הרחבה',
    collapse: 'כיווץ',
    /**
     * `lightingFine` folds the four sun sliders away behind the three presets
     * (יום / שקיעה / לילה), which is all most people ever touch.
     * `tableStyling` is the heading over the per-table colour and decor controls.
     */
    lightingFine: 'כוונון עדין',
    tableStyling: 'עיצוב השולחן',
  },
  statusBar: {
    tables: 'שולחנות',
    chairs: 'כיסאות',
    seats: 'מקומות',
    zoomFit: 'התאמה לאולם',
    zoomIn: 'התקרבות',
    zoomOut: 'התרחקות',
  },
  viewMode: {
    d2: '2D',
    split: 'מפוצל',
    d3: '3D',
    placeholder3d: 'התצוגה התלת־ממדית תגיע בקרוב',
  },
  drill: {
    chair: 'כיסא',
    decor: 'קישוט שולחן',
    escHint: 'Esc לחזרה',
  },
  /**
   * Design-edit mode (PLAN-07): double-clicking a table isolates it so its decor
   * can be arranged. A view preference, not scene state — hence its own group
   * rather than a nesting under `inspector`.
   */
  editMode: {
    title: 'עריכת עיצוב השולחן',
    exit: 'יציאה ממצב עריכה',
    hint: 'גררו את הקישוטים למקומם · Esc ליציאה',
    /**
     * PLAN-09 item 10 — the user's own words: "ואז יהיה לי כפתור של שמור וצא".
     * ⚠ The app already autosaves (`App.tsx:44` · `startAutosave`), and today there
     * is an exit (X) and no save on purpose. So this is a LABEL and an intent on
     * `exitDesignEdit()`, not a second save path — building one would race the
     * autosave. `autosaveHint` is there so the promise the button makes is honest.
     */
    saveAndExit: 'שמור וצא',
    autosaveHint: 'השינויים נשמרים אוטומטית',
    /**
     * PLAN-09 item 11: "אסור שיהיה אפשר לערוך ערכות סכום". Today every
     * `attachment.kind === 'surface'` child is editable, which catches the place
     * setting and the napkins along with the centrepieces.
     * ⚠ The exclusion has to land in BOTH views — `ObjectNode.tsx:158-159` and
     * `ObjectGroup.tsx:497-499` — or 2D and 3D disagree.
     */
    placeSettingLocked: 'ערכת הסכו״ם אינה ניתנת להזזה',
  },
  /**
   * The in-app replacements for `window.confirm` / `window.prompt`. Each dialog
   * is a TITLE (the question) plus a CONFIRM label that names the thing it is
   * about to do — never a bare "אישור", which forces the user to re-read the
   * title to find out what they are agreeing to. `cancel` and `close` are
   * shared by all of them.
   *
   * The explanatory body of each dialog stays with its own feature — see
   * `presets.bakeConfirmBody`, `presets.confirmDeleteSavedLayout`,
   * `presets.confirmOverwrite` — because that is where the counts and names
   * that fill it come from.
   */
  dialog: {
    cancel: 'ביטול',
    // `close` was added here for symmetry with `cancel` and never had a caller:
    // the dialogs dismiss with `cancel`, and the one close BUTTON in the app —
    // the help panel's — has its own `help.close`. Removed in the same round
    // that added it, by the audit that also caught `status.clearedAll`.
    renameTitle: 'שינוי שם לפריסה',
    renameConfirm: 'שינוי השם',
    deleteLayoutTitle: 'מחיקת פריסה',
    deleteLayoutConfirm: 'מחיקה',
    overwriteTitle: 'החלפת פריסה קיימת',
    overwriteConfirm: 'החלפה',
    bakeTitle: 'קיבוע אלמנטים לקוד המקור',
    bakeConfirmAction: 'קיבוע',
  },
  /**
   * Transient toasts. Anything destructive that can be taken back says so and
   * carries `undo` as a BUTTON, which is the whole reason these exist rather
   * than a confirm dialog in front of every one of them.
   */
  notice: {
    dismiss: 'סגירת ההודעה',
    undo: 'בטל',
    cleared: (n: number) => `${n} פריטים נמחקו`,
    filled: (n: number) => `נוספו ${n} שולחנות`,
    fillNone: 'אין מקום לשולחנות נוספים',
    layoutApplied: (tables: number, seats: number) =>
      `הפריסה הוחלה — ${tables} שולחנות, ${seats} מקומות`,
    designAppliedAll: (n: number) => `העיצוב הוחל על ${n} שולחנות`,
    exportPngDone: 'תוכנית הרצפה הורדה',
    /** the capture reads the 2D canvas, which full-3D does not render */
    exportPngFailed: 'ייצוא התוכנית אפשרי מתצוגת 2D או מפוצל בלבד',
    importFailed: 'ייבוא הקובץ נכשל — הקובץ אינו קובץ פרויקט תקין',
  },
  help: {
    title: 'קיצורי מקלדת',
    close: 'סגירה',
    /** the button that opens the panel — the panel's own heading is `title` */
    open: 'קיצורי מקלדת ועזרה',
    /**
     * Section headings, one per `ShortcutGroup` in core/shortcuts.ts.
     *
     * ⚠ Each of these is rendered TWICE — once under `shortcutsFor('2d')` and
     * once under `shortcutsFor('3d')` — so none of them may name a view. That
     * is why `groupNav` is the bare 'ניווט' and not 'ניווט בתלת־ממד': the 2D
     * half's `nav` group is `spacePan` and `midDragPan`, which are plan-panning
     * gestures with no 3D in them. Each half is introduced by its own heading —
     * `viewMode.d2` / `viewMode.d3` — so the view is already named there.
     *
     * `help.title3d` ('ניווט בתלת־ממד (כמו בלומיון)') was deleted for the same
     * reason one level up: it headed a section that holds `edit` and `view`
     * rows too, so calling the whole thing "3D navigation" was false.
     */
    groupTools: 'כלים',
    groupEdit: 'עריכה',
    groupView: 'תצוגה',
    groupNav: 'ניווט',
    /**
     * The DESCRIPTION column, one entry per `Shortcut.id` in
     * `core/shortcuts.ts` — that file's `labelKey` is `help.keys.<id>`, and
     * `shortcuts.test.ts` fails if any of them stops resolving here. The
     * wording was lifted from the `rows` / `rows3d` tuple tables this group
     * replaced — deleted once `ShortcutsHelp` stopped reading them — so the
     * switch to the catalog regressed no existing row.
     *
     * The chord itself is NOT here. It lives on the catalog entry, where a test
     * can check it against the codes the handler actually listens for — which
     * is the entire reason this group replaces the tuple tables.
     */
    keys: {
      selectTool: 'כלי בחירה',
      handTool: 'כלי יד',
      /** Alt on the click that commits a placement — the tool stays armed for the next one */
      placeRepeat: 'הצבה חוזרת — הפריט נשאר דרוך',
      /**
       * Round 4's headline gesture. Added by the lead: plan D2 built the drag and
       * owns `core/shortcuts.ts`, but the catalog's test requires `help.keys.<id>`
       * to resolve HERE, and D2 did not own this file — so the one gesture the
       * round added would have been the one gesture the help table omitted, which
       * is precisely the drift `core/shortcuts.ts` exists to prevent.
       */
      dragFromLibrary: 'גרירת פריט מהספרייה אל הלוח',
      /**
       * The right mouse button is free-look in 3D and stays that way, so the
       * actions menu opens from the `⋯` button on the selection bar. This is the
       * OS-standard keyboard route to the same menu.
       */
      contextMenu3d: 'תפריט פעולות על הנבחרים',
      undoRedo: 'ביטול / ביצוע חוזר',
      redoAlt: 'ביצוע חוזר (קיצור חלופי)',
      duplicate: 'שכפול',
      clipboard: 'העתקה / גזירה / הדבקה',
      deleteSelection: 'מחיקת הנבחרים',
      selectAll: 'בחירת הכול',
      rotate90: 'סיבוב 90° עם כיוון השעון',
      rotate90ccw: 'סיבוב 90° נגד כיוון השעון',
      nudge: 'הזזה 10 ס״מ (Shift: מטר · Alt: ס״מ)',
      escape: 'ביטול בחירה / יציאה',
      selectItem: 'בחירת פריט',
      addToSelection: 'הוספה או הסרה מהבחירה',
      dragItem: 'הזזת פריט על הרצפה',
      snapBypass: 'עקיפת הצמדה',
      dragDuplicate: 'שכפול הפריט תוך כדי גרירה',
      mirror: 'שיקוף הנבחרים',
      mirrorCopy: 'שיקוף עם העתקה של הנבחרים',
      keepRatio: 'שמירה על יחס הצלעות',
      resizeFromCenter: 'שינוי גודל מהמרכז',
      /**
       * ⚠ THE ONE PLACE the gizmo's snap angle is written down. It has been
       * printed as 15°, then as 5° with the Shift polarity inverted, then as a
       * 5° snap that had already been removed. The user chose 45°;
       * `shortcuts.test.ts` asserts this string names it and names neither of
       * the dead values.
       */
      gizmoRotate: 'זווית חופשית — Shift להצמדה 45°',
      contextMenu: 'תפריט פעולות לפריט',
      designEdit: 'עריכת עיצוב השולחן',
      drillChair: 'בחירת כיסא בודד',
      toggleGrid: 'הצגת הרשת',
      toggleSnap: 'הצמדה לרשת',
      zoomIn: 'התקרבות',
      zoomOut: 'התרחקות',
      zoom100: 'תצוגה 100%',
      fitVenue: 'התאמה לאולם',
      fitSelection: 'התאמה לבחירה',
      wheelZoom: 'זום אל הסמן',
      help: 'חלונית הקיצורים והעזרה',
      spacePan: 'הזזת תצוגה זמנית',
      midDragPan: 'הזזת התצוגה',
      fly: 'תנועה: קדימה / שמאלה / אחורה / ימינה',
      flyVertical: 'עלייה / ירידה',
      flyFast: 'תנועה מהירה',
      flySlow: 'תנועה איטית מאוד',
      flyVeryFast: 'תנועה מהירה מאוד',
      /**
       * Names the discrimination, because it is the one thing about this gesture
       * a user has to know: a left drag turns the view UNLESS it started on an
       * object, in which case it moves the object.
       */
      look: 'הסתכלות סביב (על שטח ריק — גרירה על פריט מזיזה אותו)',
      panView3d: 'הזזת המבט הצידה',
      wheelFly: 'תנועה קדימה / אחורה',
      orbit: 'סיבוב סביב המוקד',
      resetPitch: 'יישור המבט לאופק',
      teleport: 'קפיצה לנקודה',
    },
  },
  menu: {
    duplicate: 'שכפול',
    copy: 'העתקה',
    cut: 'גזירה',
    paste: 'הדבקה',
    pasteHere: 'הדבקה כאן',
    delete: 'מחיקה',
    rotate90: 'סיבוב 90°',
    /** the other direction — `Shift+R` has always existed, the menu only offered one way */
    rotate90ccw: 'סיבוב 90° נגד כיוון השעון',
    /** a real reflection, which is why it is not called 'היפוך' — see Transform2D.mirrored */
    mirror: 'שיקוף',
    /** the same reflection, with the original left standing. 'שיקוף' stays the head
     *  word so the two lines read as a pair — and so it does not sort itself, visually,
     *  next to `duplicate` at the top of the menu, which is where it does NOT belong. */
    mirrorCopy: 'שיקוף עם העתקה',
    replace: 'החלפת פריט…',
    bringForward: 'הבא קדימה',
    sendBackward: 'שלח אחורה',
    bringToFront: 'הבא לחזית',
    sendToBack: 'שלח לרקע',
    lock: 'נעילה',
    unlock: 'ביטול נעילה',
    selectAll: 'בחירת הכול',
    fitVenue: 'התאמה לאולם',
    zoom100: 'תצוגה 100%',
    deleteChair: 'מחיקת כיסא',
  },
  /**
   * The 2D drawing read as an ARCHITECTURAL PLAN (PLAN-06, item 18b). These name
   * the parts of the cut and the annotations around it, and they are deliberately
   * not part of `zones` below: a zone is a rule about where things may be put, a
   * section kind is a piece of the building. The `kind` values are the ones
   * PLAN-01/A3 re-emits into `section.json` — wall | glazing | railing | opening |
   * column — which today does not classify at all (`extract-section.mjs:43-46`
   * records the explicit decision not to, and PLAN-01 reverses it).
   *
   * ⚠ Levels are NOT here. `formatElevation()` (`layout/zoneLabels.ts:168`) already
   * turns 470 into `+4.70` with the bidi isolates that keep the sign on the left,
   * and that belongs next to the value, not in a dictionary.
   */
  plan: {
    title: 'תוכנית רצפה',
    legend: 'מקרא',
    wall: 'קיר',
    /** the section kind is `glazing`; the user's word for what he sees is "חלון" */
    glazing: 'חלון',
    window: 'חלון',
    railing: 'מעקה',
    /**
     * ⚠ Deliberately NOT 'דלת'. There is no door material in `venue.glb` (only
     * 'Glass' and 'Glass Railing Color'), so a gap in the cut cannot be told from a
     * doorway — PLAN-06 gate 1. An unmarked opening is honest; a drawn door leaf is
     * a lie. `door` is seeded for the day the user paints the doors in SketchUp.
     */
    opening: 'פתח',
    door: 'דלת',
    column: 'עמוד',
    stairs: 'מדרגות',
    /** the arrow along a flight of stairs always points up, and says so */
    stairsUp: 'מעלה',
    level: 'מפלס',
    dimensions: 'מידות',
    north: 'צפון',
    scale: 'קנה מידה',
    /**
     * PLAN-08. `BeamLayer` is the only place in the whole app where beams are
     * actually drawn — in 3D they are baked geometry inside `venue.glb`, and the
     * `ceilingBeams` array is an abstract snap grid. `beamBraces` is seeded because
     * `14.PNG` shows diagonal bracing in the truss shadow that the 9+4 straight
     * beams have no representation for; whether it survives depends on PLAN-01/A2's
     * measurement.
     */
    beams: 'קורות',
    beamCrossings: 'הצטלבויות',
    beamBraces: 'חיזוקים אלכסוניים',
  },
  /**
   * Venue-zone names drawn on the plan. These used to be inline Hebrew in
   * venuePacks.ts, which that file still carries as documentation and as the
   * fallback for a pack whose `kind` has no entry here.
   *
   * `corridor` and `passage` are the same zone: PLAN-07 renames the pack's kind
   * to 'passage', and until that lands both keys have to resolve.
   */
  zones: {
    pool: 'בריכה',
    bar: 'בר',
    dancefloor: 'רחבת ריקודים',
    dj: 'עמדת DJ',
    chuppah: 'חופה',
    corridor: 'מעבר',
    passage: 'מעבר',
    kabalatPanim: 'קבלת פנים',
    /**
     * ZONE_SHVIL_HUPA — the aisle to the ceremony, painted 2026-07-29.
     *
     * ⚠ A NO-OP TODAY, and listed anyway. The zone is 140 cm wide, which leaves a
     * 108 cm tag box, and `labelFits` refuses anything under 132 cm at the drawn
     * font size (core/layout/zoneLabels.ts) — so nothing is printed and this
     * string is never read. BRIEF §1.2 is that every user-facing string lives
     * here regardless; without it, the day the aisle widens the plan silently
     * falls back to the pack's own inline Hebrew instead.
     */
    shvilHupa: 'שביל החופה',
    /** the ring of deck the user drew around the pool — PLAN-01 adds the zone itself */
    saviv: 'סביב הבריכה',
    /**
     * PLAN-01 item 20: "וגם הוספתי ZONE של ריצוף ששייך רק לקבלת פנים". There is no
     * paving marker in `extract-zones.mjs` today (8 markers, none of them this), so
     * PLAN-01/A1 both adds the marker and names the `kind`.
     *
     * ⚠ The `kind` is what this object is keyed by (`VenueLayer.tsx:153`,
     * `strings.zones[zone.kind ?? '']`), and the existing keys are not consistent
     * about language — `pool`/`bar`/`dj` are English, `saviv`/`kabalatPanim` are
     * transliterated Hebrew. Both spellings are seeded so whichever PLAN-01 picks
     * resolves; the lookup falls back to `zone.label` anyway, so the cost of the
     * spare is one dead line and the cost of guessing wrong is an unnamed zone on
     * the drawing. Same reason `corridor`/`passage` are both here.
     */
    flooring: 'ריצוף',
    ritzuf: 'ריצוף',
  } as Record<string, string>,
} as const
