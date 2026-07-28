/**
 * Central UI string dictionary. Hebrew is the default locale.
 * All user-facing text must come from here — adding a locale later
 * means adding a dictionary, not rewriting components.
 */
export const strings = {
  appName: 'מתכנן אירועים',
  workspace: {
    loading: 'טוען פרויקט…',
    loading3d: 'מכינים את התצוגה התלת־ממדית…',
    emptyCanvasHint: 'גררו פריטים מהספרייה כדי להתחיל לתכנן',
  },
  toolbar: {
    backToDashboard: 'חזרה לפרויקטים',
    undo: 'ביטול',
    redo: 'ביצוע חוזר',
    clearAll: 'ניקוי כל האלמנטים',
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
  },
  status: {
    saved: 'נשמר',
    saving: 'שומר…',
    saveFailed: 'השמירה נכשלה — מנסים שוב',
    loadFailed: 'טעינת הפריסות נכשלה',
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
      wrongZone: 'פריט זה מותר רק סביב {zone}',
      nearWall: 'יש להניח צמוד לקיר (עד {within} ס״מ)',
      missingHost: 'יש להניח ערכת סכו״ם קודם',
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
      // laid flat on the place setting rather than standing (see the entry's own
      // description in entries/tableDecor.ts), and one per cover once PLAN-03
      // routes it through `napkin()` — so singular, and distinct from the standing one
      decorNapkinFolded: 'מפית שטוחה',
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
      ringCenter: 'עיצובי שולחן עיגול גדול',
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
      panel: 'פאנל',
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
    bake: 'קיבוע האלמנטים (פיתוח)',
    bakeConfirm: (count: number) =>
      `לקבע ${count} אלמנטים לתוך קוד המקור?\n\nהפעולה כותבת את src/core/venueFixtures.ts. האלמנטים ייטענו בכל פרויקט חדש ולא ניתן יהיה להזיז או למחוק אותם.`,
    bakeDone: (count: number) => `${count} אלמנטים נכתבו ל-venueFixtures.ts`,
    bakeFailed: 'הקיבוע נכשל',
    bakeEmpty: 'אין אלמנטים לקיבוע',
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
    hangHint: 'הנברשת נתלית על הצטלבות קורות התקרה',
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
  },
  help: {
    title: 'קיצורי מקלדת',
    close: 'סגירה',
    rows: [
      ['V / H', 'כלי בחירה / כלי יד'],
      ['Space (החזקה)', 'הזזת תצוגה זמנית'],
      ['גלגלת עכבר', 'זום אל הסמן'],
      ['Ctrl+Z / Ctrl+Y', 'ביטול / ביצוע חוזר'],
      ['Ctrl+D', 'שכפול'],
      ['Ctrl+C / X / V', 'העתקה / גזירה / הדבקה'],
      ['Delete', 'מחיקת הנבחרים'],
      ['Ctrl+A', 'בחירת הכול'],
      ['חצים', 'הזזה 10 ס״מ (Shift: מטר · Alt: ס״מ)'],
      ['R / Shift+R', 'סיבוב 90° עם/נגד כיוון השעון'],
      // The snap is 5° and it is ALWAYS on; Shift releases it, the way Alt releases
      // the grid snap on a move. Two call sites, one behaviour:
      // editor2d/SelectionTransformer.tsx:85-86 · viewer3d/ObjectGroup.tsx:134.
      ['סיבוב בגיזמו', 'צעדים של 5°'],
      ['Shift בסיבוב', 'ביטול ההצמדה — זווית חופשית'],
      ['G / Shift+G', 'הצגת רשת / הצמדה'],
      ['Alt בזמן גרירה', 'עקיפת הצמדה'],
      ['Shift+1 / Shift+2', 'התאמה לאולם / לבחירה'],
      ['Ctrl+0', 'תצוגה 100%'],
      ['דאבל־קליק על כיסא', 'בחירת כיסא בודד'],
      ['Esc', 'ביטול בחירה / יציאה'],
      ['?', 'חלונית זו'],
    ],
    title3d: 'ניווט בתלת־ממד (כמו בלומיון)',
    rows3d: [
      ['W / A / S / D / חצים', 'תנועה: קדימה / שמאלה / אחורה / ימינה'],
      ['Q / E', 'עלייה / ירידה'],
      ['Shift · Space · Shift+Space', 'מהיר · איטי מאוד · מהיר מאוד'],
      ['לחצן ימני + גרירה', 'מבט חופשי'],
      ['לחצן אמצעי + גרירה', 'הזזת המבט הצידה'],
      ['גלגלת', 'תנועה קדימה / אחורה'],
      ['O + לחצן ימני', 'סיבוב סביב המוקד'],
      ['Ctrl+H', 'יישור המבט לאופק'],
      ['דאבל־קליק ימני', 'קפיצה לנקודה'],
      ['קליק שמאלי', 'בחירת פריט'],
      ['גרירת קליק שמאלי', 'הזזת פריט על הרצפה'],
      ['Shift + קליק שמאלי', 'הוספה או הסרה מהבחירה'],
      ['Ctrl+D', 'שכפול הנבחרים'],
      ['Delete / Backspace', 'מחיקת הנבחרים'],
      ['Ctrl+Z / Ctrl+Y', 'ביטול / ביצוע מחדש'],
    ],
  },
  menu: {
    duplicate: 'שכפול',
    copy: 'העתקה',
    cut: 'גזירה',
    paste: 'הדבקה',
    pasteHere: 'הדבקה כאן',
    delete: 'מחיקה',
    rotate90: 'סיבוב 90°',
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
    /** the ring of deck the user drew around the pool — PLAN-01 adds the zone itself */
    saviv: 'סביב הבריכה',
  } as Record<string, string>,
} as const
