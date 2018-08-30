import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

type LayerKey = "persons" | "places" | "books" | "years" | "collation";
type ReaderTheme = "light" | "dark";

type VolumeSummary = {
  id: string;
  ordinal: number;
  title: string;
  sectionTitle?: string;
  noteCount?: number;
};

type BookManifest = {
  title: string;
  author?: string;
  volumes: VolumeSummary[];
  appendices?: AppendixSummary[];
};

type AppendixSummary = {
  id: string;
  title: string;
  byline?: string;
  path: string;
  blockCount?: number;
};

type SourceNote = {
  id: string;
  kind: "note" | "collation";
  text: string;
  html?: string;
};

type SourceBlock = {
  id: string;
  type: string;
  className?: string;
  text: string;
  html: string;
  notes?: SourceNote[];
};

type BookVolume = {
  id: string;
  ordinal?: number;
  kind?: "appendix";
  title: string;
  sectionTitle?: string;
  blocks: SourceBlock[];
};

type SearchRecord = {
  volumeId?: string;
  volume?: string;
  volume_id?: string;
  blockId?: string;
  block?: string;
  block_id?: string;
  volumeTitle?: string;
  title?: string;
  text?: string;
};

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  persons: true,
  places: true,
  books: true,
  years: true,
  collation: false,
};

const STORAGE_KEY = "tongjian-reader-preferences-v3";

const CHRONICLES = [
  { name: "周紀", start: 1, end: 5 },
  { name: "秦紀", start: 6, end: 8 },
  { name: "漢紀", start: 9, end: 68 },
  { name: "魏紀", start: 69, end: 78 },
  { name: "晉紀", start: 79, end: 118 },
  { name: "宋紀", start: 119, end: 134 },
  { name: "齊紀", start: 135, end: 144 },
  { name: "梁紀", start: 145, end: 166 },
  { name: "陳紀", start: 167, end: 176 },
  { name: "隋紀", start: 177, end: 184 },
  { name: "唐紀", start: 185, end: 265 },
  { name: "後梁紀", start: 266, end: 271 },
  { name: "後唐紀", start: 272, end: 279 },
  { name: "後晉紀", start: 280, end: 285 },
  { name: "後漢紀", start: 286, end: 289 },
  { name: "後周紀", start: 290, end: 294 },
] as const;

function chineseNumber(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (!Number.isInteger(value) || value < 0 || value > 999) return String(value);
  if (value < 10) return digits[value];

  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  const tens = Math.floor(remainder / 10);
  const ones = remainder % 10;
  let result = hundreds ? `${digits[hundreds]}百` : "";

  if (hundreds && remainder > 0 && remainder < 10) result += "零";
  if (tens) {
    if (tens > 1 || hundreds) result += digits[tens];
    result += "十";
  }
  if (ones) result += digits[ones];
  return result;
}

function chronicleFor(ordinal: number) {
  const section = CHRONICLES.find((item) => ordinal >= item.start && ordinal <= item.end);
  if (!section) return { name: "通鑑", label: "卷" + chineseNumber(ordinal) };
  return {
    name: section.name,
    label: section.name + chineseNumber(ordinal - section.start + 1),
  };
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

function TypeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19 10.6 5h2.8L19 19M7.2 14h9.6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg className={direction === "right" ? "turn-right" : ""} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 5-7 7 7 7" />
    </svg>
  );
}

function noteKindForBlock(block: SourceBlock): "hu" | "collation" {
  return block.type === "collation" || block.className === "note5" ? "collation" : "hu";
}

function ExpandedNotes({
  notes,
  isNoteOpen,
  onToggleNote,
}: {
  notes: SourceNote[];
  isNoteOpen: (id: string) => boolean;
  onToggleNote: (id: string) => void;
}) {
  const visible = notes.filter((note) => isNoteOpen(note.id));
  if (!visible.length) return null;

  return (
    <div className="expanded-notes">
      {visible.map((note) => (
        <button
          key={note.id}
          className={"expanded-note source-note-" + (note.kind === "collation" ? "collation" : "hu")}
          data-note-id={note.id}
          onClick={() => onToggleNote(note.id)}
          aria-label="收起此條註疏"
        >
          <span className="expanded-note-label">{note.kind === "collation" ? "校" : "胡註"}</span>
          {note.html ? (
            <span className="expanded-note-text" dangerouslySetInnerHTML={{ __html: note.html }} />
          ) : (
            <span className="expanded-note-text">{note.text}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function DetachedNotes({
  notes,
  className,
  isNoteOpen,
  onToggleNote,
}: {
  notes: SourceNote[];
  className: string;
  isNoteOpen: (id: string) => boolean;
  onToggleNote: (id: string) => void;
}) {
  if (!notes.length) return null;

  return (
    <div className={`detached-notes ${className}`}>
      {notes.map((note) => {
        const expanded = isNoteOpen(note.id);
        const label = note.kind === "collation" ? "校" : "胡註";
        return (
          <button
            key={note.id}
            type="button"
            className={`detached-note source-note-${note.kind === "collation" ? "collation" : "hu"} ${expanded ? "is-expanded" : "is-collapsed"}`}
            aria-expanded={expanded}
            aria-label={expanded ? `收起${label}` : `展開${label}`}
            onClick={() => onToggleNote(note.id)}
          >
            <span className="detached-note-label">{label}</span>
            {expanded &&
              (note.html ? (
                <span className="detached-note-text" dangerouslySetInnerHTML={{ __html: note.html }} />
              ) : (
                <span className="detached-note-text">{note.text}</span>
              ))}
          </button>
        );
      })}
    </div>
  );
}

const CHINESE_YEAR_DIGITS: Record<string, string> = {
  "〇": "0",
  "○": "0",
  "零": "0",
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
};

function formatCommonEraYear(html: string) {
  return html.replace(
    /([、，]\s*)(前)?([〇○零一二三四五六七八九]{1,4})(年?)(?=\s*[）)])/g,
    (
      _match,
      separator: string,
      beforeCommonEra: string | undefined,
      year: string,
      yearSuffix: string,
    ) => {
      const arabicYear = [...year].map((digit) => CHINESE_YEAR_DIGITS[digit]).join("");
      return `${separator}<span class="source-year-ce">${beforeCommonEra ?? ""}${arabicYear}${yearSuffix}</span>`;
    },
  );
}

const YEAR_METADATA_SOURCE =
  "（\\s*[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]\\s*[、，]\\s*(?:前)?[〇○零一二三四五六七八九0-9]{1,5}年?\\s*）";

function yearMetadataPattern() {
  return new RegExp(YEAR_METADATA_SOURCE, "g");
}

function plainTextFromHtml(html: string) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHistoricalText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([，。、；：])/g, "$1")
    .trim();
}

function formatCommentaryLead(block: SourceBlock, html: string) {
  const plainText = block.text.replace(/\s+/g, " ").trim();
  if (!/^.{1,30}?(?:贊曰|論曰|評曰|曰)\s*[：:]/.test(plainText)) return html;
  return html.replace(
    /^([\s\S]{1,300}?曰)\s*([：:])/,
    '<strong class="commentary-lead">$1</strong>$2',
  );
}

function yearPresentationFor(block: SourceBlock) {
  const principalHtml = block.html.split(/<span class="source-note\b/, 1)[0];
  const metadataCandidates = [
    ...(principalHtml.match(yearMetadataPattern()) ?? []),
    ...(block.notes ?? []).flatMap((note) => note.text.match(yearMetadataPattern()) ?? []),
  ];
  const metadata = normalizeHistoricalText(metadataCandidates[0] ?? "");
  const titleHtml = principalHtml.replace(yearMetadataPattern(), "").trim();
  const notes = (block.notes ?? []).flatMap((note) => {
    const text = normalizeHistoricalText(note.text.replace(yearMetadataPattern(), ""));
    const html = (note.html ?? note.text).replace(yearMetadataPattern(), "").trim();
    if (!text && !plainTextFromHtml(html)) return [];
    return [{ ...note, text, html }];
  });

  return { titleHtml, title: plainTextFromHtml(titleHtml), metadata, notes };
}

function chroniclePresentationFor(volume: BookVolume) {
  const block = volume.blocks.find((item) => item.type === "h2");
  if (!block) return null;

  const titleHtml = block.html.split(/<span class="source-note\b/, 1)[0].trim();
  const title = plainTextFromHtml(titleHtml);
  const sourceNote = block.notes?.[0];
  let range = normalizeHistoricalText(sourceNote?.text ?? "");
  let trailingNote: SourceNote | null = null;

  if (volume.id === "078" && sourceNote) {
    const suffix = "涒，音暾。";
    range = normalizeHistoricalText(range.replace(suffix, ""));
    trailingNote = { ...sourceNote, text: suffix, html: suffix };
  }

  return { block, titleHtml, title, range, trailingNote };
}

type ReadingContext = {
  kind: "chronicle" | "emperor" | "year";
  label: string;
};

function readingContextForBlock(block: SourceBlock): ReadingContext | null {
  const kind =
    block.type === "h2"
      ? "chronicle"
      : block.className === "emperor"
        ? "emperor"
        : block.type === "year"
          ? "year"
          : null;
  if (!kind) return null;

  const principalText = block.html
    .split(/<span class="source-note\b/, 1)[0]
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chronicle = principalText.match(/^(.+?紀[一二三四五六七八九十百]+)/)?.[1];
  return { kind, label: kind === "chronicle" && chronicle ? chronicle : principalText };
}

function SourceBlockView({
  block,
  notesEnabled,
  isNoteOpen,
  onToggleNote,
}: {
  block: SourceBlock;
  notesEnabled: boolean;
  isNoteOpen: (id: string) => boolean;
  onToggleNote: (id: string) => void;
}) {
  const handleNoteClick = (event: MouseEvent<HTMLElement>) => {
    const note = (event.target as HTMLElement).closest<HTMLElement>("[data-note-id]");
    if (!note || !event.currentTarget.contains(note)) return;
    event.preventDefault();
    onToggleNote(note.dataset.noteId ?? "");
  };

  const handleNoteKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const note = (event.target as HTMLElement).closest<HTMLElement>("[data-note-id]");
    if (!note || !event.currentTarget.contains(note)) return;
    event.preventDefault();
    onToggleNote(note.dataset.noteId ?? "");
  };

  if (block.type === "note" || block.type === "collation") {
    const kind = noteKindForBlock(block);
    const expanded = isNoteOpen(block.id);
    return (
      <p
        id={block.id}
        className={`source-block source-block-standalone-note source-note-${kind} ${expanded ? "is-expanded" : "is-collapsed"}`}
      >
        <span
          className="source-note"
          data-note-id={block.id}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={handleNoteClick}
          onKeyDown={handleNoteKeyDown}
        >
          <span className="source-note-marker">{kind === "collation" ? "校" : "胡註"}</span>
          <span className="source-note-text">{block.text}</span>
        </span>
      </p>
    );
  }

  if (block.type === "year") {
    const presentation = yearPresentationFor(block);
    const className = [
      "source-block",
      "source-block-year",
      block.className ? `source-class-${block.className}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <>
        <p
          id={block.id}
          className={className}
          data-reading-kind="year"
          data-reading-label={presentation.title}
        >
          <span className="year-heading-title" dangerouslySetInnerHTML={{ __html: presentation.titleHtml }} />
          <span
            className="year-heading-metadata"
            dangerouslySetInnerHTML={{ __html: formatCommonEraYear(presentation.metadata) }}
          />
        </p>
        {notesEnabled && (
          <DetachedNotes
            notes={presentation.notes}
            className="year-detached-notes"
            isNoteOpen={isNoteOpen}
            onToggleNote={onToggleNote}
          />
        )}
      </>
    );
  }

  const notesById = new Map((block.notes ?? []).map((note) => [note.id, note]));
  const sourceHtml =
    block.type === "commentary" || block.className === "comment"
      ? formatCommentaryLead(block, block.html)
      : block.html;
  const html = sourceHtml
    .replace(/[ \t]*[\r\n]+[ \t]*/g, "")
    .replace(
      /<span class="source-note source-note-(hu|collation)" data-note-id="([^"]+)">/g,
      (_match, kind: string, id: string) => {
        const isLong = (notesById.get(id)?.text.trim().length ?? 0) >= 72;
        const expanded = isNoteOpen(id);
        return (
          '<span class="source-note source-note-' +
          kind +
          " " +
          (isLong ? "is-long" : "is-short") +
          " " +
          (expanded ? "is-expanded" : "is-collapsed") +
          '" data-note-id="' +
          id +
          '" role="button" tabindex="0" aria-expanded="' +
          expanded +
          '">'
        );
      },
    )
    .replace(
      /<span class="source-note-marker">注<\/span>/g,
      '<span class="source-note-marker">胡註</span>',
    );

  const className = [
    "source-block",
    `source-block-${block.type}`,
    block.className ? `source-class-${block.className}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const readingContext = readingContextForBlock(block);

  if (block.type === "h2") {
    return (
      <>
        <h2
          id={block.id}
          className={className}
          data-reading-kind={readingContext?.kind}
          data-reading-label={readingContext?.label}
          onClick={handleNoteClick}
          onKeyDown={handleNoteKeyDown}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <ExpandedNotes notes={block.notes ?? []} isNoteOpen={isNoteOpen} onToggleNote={onToggleNote} />
      </>
    );
  }

  return (
    <>
      <p
        id={block.id}
        className={className}
        data-reading-kind={readingContext?.kind}
        data-reading-label={readingContext?.label}
        onClick={handleNoteClick}
        onKeyDown={handleNoteKeyDown}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <ExpandedNotes notes={block.notes ?? []} isNoteOpen={isNoteOpen} onToggleNote={onToggleNote} />
    </>
  );
}

const TOC_GROUPS = [
  { name: "周", start: 1, end: 5 },
  { name: "秦", start: 6, end: 8 },
  { name: "漢", start: 9, end: 68 },
  { name: "魏", start: 69, end: 78 },
  { name: "晉", start: 79, end: 118 },
  { name: "宋", start: 119, end: 134 },
  { name: "齊", start: 135, end: 144 },
  { name: "梁", start: 145, end: 166 },
  { name: "陳", start: 167, end: 176 },
  { name: "隋", start: 177, end: 184 },
  { name: "唐", start: 185, end: 265 },
  { name: "後梁", start: 266, end: 271 },
  { name: "後唐", start: 272, end: 279 },
  { name: "後晉", start: 280, end: 285 },
  { name: "後漢", start: 286, end: 289 },
  { name: "後周", start: 290, end: 294 },
] as const;

function ChronicleVolumeList({
  volumes,
  currentId,
  onSelect,
  isDrawerOpen,
}: {
  volumes: VolumeSummary[];
  currentId: string;
  onSelect: (id: string) => void;
  isDrawerOpen: boolean;
}) {
  const isFiltered = volumes.length < 294;
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(TOC_GROUPS.map((group) => group.name)),
  );

  useEffect(() => {
    if (!isDrawerOpen || !/^\d+$/.test(currentId)) return;
    const ordinal = Number.parseInt(currentId, 10);
    const currentGroup = TOC_GROUPS.find(
      (group) => ordinal >= group.start && ordinal <= group.end,
    );
    if (!currentGroup) return;
    setOpenGroups((current) => {
      if (current.has(currentGroup.name)) return current;
      const next = new Set(current);
      next.add(currentGroup.name);
      return next;
    });
  }, [currentId, isDrawerOpen]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(".toc-volume-row.is-current")?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentId, isDrawerOpen, openGroups]);

  return (
    <div className="toc-chronicles">
      {TOC_GROUPS.map((group) => {
        const groupVolumes = volumes.filter(
          (volume) => volume.ordinal >= group.start && volume.ordinal <= group.end,
        );
        if (!groupVolumes.length) return null;

        return (
          <details
            className="toc-dynasty"
            key={group.name}
            open={isFiltered || openGroups.has(group.name)}
          >
            <summary
              onClick={(event) => {
                event.preventDefault();
                if (!isFiltered) {
                  setOpenGroups((current) => {
                    const next = new Set(current);
                    if (next.has(group.name)) next.delete(group.name);
                    else next.add(group.name);
                    return next;
                  });
                }
              }}
            >
              <span className="toc-dynasty-name">{group.name}紀</span>
              <span className="toc-dynasty-range">總卷 {group.start}–{group.end}</span>
              <span className="toc-dynasty-count">{group.end - group.start + 1} 卷</span>
            </summary>
            <div className="toc-volume-rows">
              {groupVolumes.map((volume) => {
                const localOrdinal = volume.ordinal - group.start + 1;
                return (
                  <button
                    className={`toc-volume-row ${volume.id === currentId ? "is-current" : ""}`}
                    key={volume.id}
                    onClick={() => onSelect(volume.id)}
                  >
                    <span>卷第{chineseNumber(volume.ordinal)}</span>
                    <strong>{group.name}紀{chineseNumber(localOrdinal)}</strong>
                  </button>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function ReadingAppendixList({
  appendices,
  currentId,
  onSelect,
  placement,
}: {
  appendices: AppendixSummary[];
  currentId: string;
  onSelect: (id: string) => void;
  placement: "front" | "back";
}) {
  const readingAppendices = appendices.filter((appendix) => {
    const isOpeningPreface = appendix.title === "資治通鑑序";
    const isReadingAppendix =
      /新註資治通鑑序|興文署新刊資治通鑑序|資治通鑑序|進書表/.test(appendix.title);
    return isReadingAppendix && (placement === "front" ? isOpeningPreface : !isOpeningPreface);
  });

  if (!readingAppendices.length) return null;
  return (
    <section className="toc-reading-appendices">
      {readingAppendices.map((appendix) => (
        <button
          className={`toc-appendix-row ${appendix.id === currentId ? "is-current" : ""}`}
          key={appendix.id}
          onClick={() => onSelect(appendix.id)}
        >
          <span className="toc-appendix-title">{appendix.title}</span>
          {appendix.byline && <span className="toc-appendix-byline">{appendix.byline}</span>}
        </button>
      ))}
    </section>
  );
}

export default function ReaderPage() {
  const [notesEnabled, setNotesEnabled] = useState(false);
  useEffect(() => {
    setNotesEnabled(window.localStorage.getItem("tongjian-notes-enabled") === "on");
  }, []);
  const [manifest, setManifest] = useState<BookManifest | null>(null);
  const [volumeId, setVolumeId] = useState("");
  const [volume, setVolume] = useState<BookVolume | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState<SearchRecord[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [fontSize, setFontSize] = useState(19);
  const [theme, setTheme] = useState<ReaderTheme>("light");
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [notesOpenByDefault, setNotesOpenByDefault] = useState(true);
  const [noteExceptions, setNoteExceptions] = useState<Set<string>>(new Set());
  const [scrollProgress, setScrollProgress] = useState(0);
  const [readingTrail, setReadingTrail] = useState({ chronicle: "", emperor: "", year: "" });
  const pendingAnchor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as {
        fontSize?: number;
        theme?: ReaderTheme;
        layers?: Partial<Record<LayerKey, boolean>>;
        notesOpenByDefault?: boolean;
      };
      if (typeof stored.fontSize === "number") setFontSize(stored.fontSize);
      if (stored.theme === "light" || stored.theme === "dark") setTheme(stored.theme);
      if (stored.layers) setLayers((current) => ({ ...current, ...stored.layers }));
      if (typeof stored.notesOpenByDefault === "boolean") {
        setNotesOpenByDefault(stored.notesOpenByDefault);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }

    fetch(`${import.meta.env.BASE_URL}book/manifest.json`)
      .then((response) => {
        if (!response.ok) throw new Error("書目載入失敗");
        return response.json() as Promise<BookManifest>;
      })
      .then((data) => {
        if (cancelled) return;
        setManifest(data);
        const urlVolume = new URLSearchParams(window.location.search).get("juan");
        const storedVolume = localStorage.getItem("tongjian-last-volume");
        const openingPreface = data.appendices?.find((item) => item.title === "資治通鑑序");
        const initial = [urlVolume, storedVolume, openingPreface?.id, data.volumes[0]?.id].find(
          (candidate) =>
            candidate &&
            (data.volumes.some((item) => item.id === candidate) ||
              data.appendices?.some((item) => item.id === candidate)),
        );
        setVolumeId(initial ?? "");
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setError(reason.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!volumeId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setNoteExceptions(new Set());

    const appendixPath = manifest?.appendices?.find((item) => item.id === volumeId)?.path;
    fetch(
      `${import.meta.env.BASE_URL}${(
        appendixPath ?? `book/volumes/${encodeURIComponent(volumeId)}.json`
      ).replace(/^\/+/, "")}`,
    )
      .then((response) => {
        if (!response.ok) throw new Error("本卷載入失敗");
        return response.json() as Promise<BookVolume>;
      })
      .then((data) => {
        if (cancelled) return;
        setVolume(data);
        setLoading(false);
        localStorage.setItem("tongjian-last-volume", volumeId);
        const url = new URL(window.location.href);
        url.searchParams.set("juan", volumeId);
        history.replaceState(null, "", `${url.pathname}${url.search}${pendingAnchor.current ? `#${pendingAnchor.current}` : ""}`);
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setError(reason.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [manifest, volumeId]);

  useEffect(() => {
    if (!volume) return;
    const anchor = pendingAnchor.current;
    requestAnimationFrame(() => {
      if (anchor) {
        document.getElementById(anchor)?.scrollIntoView({ block: "center" });
        pendingAnchor.current = null;
      } else {
        window.scrollTo({ top: 0 });
      }
    });
  }, [volume]);

  useEffect(() => {
    document.documentElement.dataset.readerTheme = theme;
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ fontSize, theme, layers, notesOpenByDefault }),
    );
  }, [fontSize, layers, notesOpenByDefault, theme]);

  useEffect(() => {
    const onScroll = () => {
      const available = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(available > 0 ? Math.min(1, window.scrollY / available) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!searchOpen || searchIndex || searchLoading) return;
    setSearchLoading(true);
    fetch(`${import.meta.env.BASE_URL}book/search.json`)
      .then((response) => {
        if (!response.ok) throw new Error("檢索資料載入失敗");
        return response.json() as Promise<unknown>;
      })
      .then((data) => {
        const container = data as {
          records?: SearchRecord[];
          entries?: SearchRecord[];
          items?: SearchRecord[];
        };
        setSearchIndex(
          Array.isArray(data) ? (data as SearchRecord[]) : container.records ?? container.entries ?? container.items ?? [],
        );
      })
      .catch(() => setSearchIndex([]))
      .finally(() => setSearchLoading(false));
  }, [searchIndex, searchLoading, searchOpen]);

  const currentIndex = useMemo(
    () => manifest?.volumes.findIndex((item) => item.id === volumeId) ?? -1,
    [manifest, volumeId],
  );

  const openingChronicle = useMemo(
    () => (volume && volume.kind !== "appendix" ? chroniclePresentationFor(volume) : null),
    [volume],
  );

  const visibleBlocks = useMemo(
    () =>
      volume?.blocks.filter((block) =>
        volume.kind === "appendix"
          ? block.type !== "h1"
          : block.type !== "h1" &&
            block.id !== openingChronicle?.block.id &&
            block.className !== "note2" &&
            block.className !== "note3",
      ) ?? [],
    [openingChronicle, volume],
  );

  useEffect(() => {
    setReadingTrail({ chronicle: "", emperor: "", year: "" });
    if (!volume || volume.kind === "appendix") return;

    let frame = 0;
    const updateReadingTrail = () => {
      frame = 0;
      const next = { chronicle: "", emperor: "", year: "" };
      const threshold =
        (document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 56) + 8;
      const landmarks = document.querySelectorAll<HTMLElement>("[data-reading-kind]");
      for (const landmark of landmarks) {
        if (landmark.getBoundingClientRect().top > threshold) break;
        const kind = landmark.dataset.readingKind as ReadingContext["kind"] | undefined;
        const label = landmark.dataset.readingLabel ?? "";
        if (!kind || !label) continue;
        if (kind === "chronicle") {
          next.chronicle = label;
          next.emperor = "";
          next.year = "";
        } else if (kind === "emperor") {
          next.emperor = label;
          next.year = "";
        } else {
          next.year = label;
        }
      }
      setReadingTrail((current) =>
        current.chronicle === next.chronicle &&
        current.emperor === next.emperor &&
        current.year === next.year
          ? current
          : next,
      );
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateReadingTrail);
    };
    const article = document.querySelector(".reader-content");
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    if (article) resizeObserver.observe(article);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [volumeId, volume, visibleBlocks]);

  const noteIds = useMemo(() => {
    const ids = new Set<string>();
    visibleBlocks.forEach((block) => {
      if (block.type === "note" || block.type === "collation") ids.add(block.id);
      if (block.type === "year") {
        yearPresentationFor(block).notes.forEach((note) => ids.add(note.id));
      } else {
        block.notes?.forEach((note) => ids.add(note.id));
      }
    });
    if (openingChronicle?.trailingNote) ids.add(openingChronicle.trailingNote.id);
    return [...ids];
  }, [openingChronicle, visibleBlocks]);

  const isNoteOpen = useCallback(
    (id: string) => (noteExceptions.has(id) ? !notesOpenByDefault : notesOpenByDefault),
    [noteExceptions, notesOpenByDefault],
  );

  const toggleNote = useCallback((id: string) => {
    if (!id) return;
    setNoteExceptions((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAllNotes = (open: boolean) => {
    setNotesOpenByDefault(open);
    setNoteExceptions(new Set());
  };

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query || !searchIndex) return [];
    return searchIndex
      .filter((item) => (item.text ?? "").toLowerCase().includes(query))
      .slice(0, 60);
  }, [searchIndex, searchQuery]);

  const selectVolume = (id: string, anchor?: string) => {
    pendingAnchor.current = anchor ?? null;
    if (id === volumeId && anchor) {
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "center" });
      pendingAnchor.current = null;
    } else {
      setVolumeId(id);
    }
    setTocOpen(false);
    setSearchOpen(false);
  };

  const readingOrder = manifest
    ? [
        ...(manifest.appendices?.filter((item) => item.title === "資治通鑑序") ?? []),
        ...manifest.volumes,
        ...(manifest.appendices?.filter((item) => item.title !== "資治通鑑序") ?? []),
      ]
    : [];
  const currentReadingIndex = readingOrder.findIndex((item) => item.id === volumeId);

  const moveVolume = (offset: number) => {
    const next = readingOrder[currentReadingIndex + offset];
    if (next) selectVolume(next.id);
  };

  const toggleLayer = (key: LayerKey) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  };

  const articleClasses = [
    "reader-content",
    ...Object.entries(layers)
      .filter(([, enabled]) => enabled)
      .map(([key]) => `layer-${key}`),
  ].join(" ");

  const currentSummary = manifest?.volumes[currentIndex];
  const currentAppendix = manifest?.appendices?.find((item) => item.id === volumeId);
  const persistentVolumeLabel = currentAppendix?.title ??
    (currentSummary ? chronicleFor(currentSummary.ordinal).label : "載入中");
  const persistentPartLabel = currentAppendix?.byline ??
    ([
      readingTrail.emperor,
      readingTrail.year,
    ]
      .filter(Boolean)
      .join(" · "));

  return (
    <div
      className={`reader-app theme-${theme} ${notesEnabled ? "notes-on" : "notes-off"}`}
      style={{ "--reader-font-size": `${fontSize}px` } as React.CSSProperties}
    >
      <div className="reading-progress" style={{ transform: `scaleX(${scrollProgress})` }} />

      <header className="topbar">
        <div className="topbar-leading">
          <button className="icon-button" onClick={() => setTocOpen(true)} aria-label="打開目錄">
            <MenuIcon />
          </button>
          <div className="book-identity">
            <span className="book-name">{persistentVolumeLabel}</span>
            <span className="current-juan">{persistentPartLabel}</span>
          </div>
        </div>

        <div className="note-controls" aria-label="註疏顯示">
          <button
            className="note-master-toggle"
            type="button"
            role="switch"
            aria-checked={notesEnabled}
            aria-label={notesEnabled ? "關閉胡三省註" : "開啟胡三省註"}
            onClick={() =>
              setNotesEnabled((enabled) => {
                const next = !enabled;
                window.localStorage.setItem("tongjian-notes-enabled", next ? "on" : "off");
                return next;
              })
            }
          >
            <span>胡三省註</span>
            <i aria-hidden="true" />
          </button>
          {notesEnabled && (
            <div className="note-detail-controls">
              
          <button
            className={notesOpenByDefault && noteExceptions.size === 0 ? "is-active" : ""}
            onClick={() => setAllNotes(true)}
          >
                展開
          </button>
          <button
            className={!notesOpenByDefault && noteExceptions.size === 0 ? "is-active" : ""}
            onClick={() => setAllNotes(false)}
          >
                收起
          </button>
              <button
            className={`collation-button ${layers.collation ? "is-active" : ""}`}
            onClick={() =>
              setLayers((current) => ({ ...current, collation: !current.collation }))
            }
            aria-pressed={layers.collation}
            aria-label={layers.collation ? "隱藏校勘記" : "顯示校勘記"}
          >
            <span className="collation-glyph" aria-hidden="true">校</span>
            <span className="collation-label">校勘</span>
          </button>
            </div>
          )}
        </div>

        <div className="topbar-actions">
          
          <button className="icon-button" onClick={() => setSearchOpen(true)} aria-label="全文檢索">
            <SearchIcon />
          </button>
          <button
            className={`icon-button ${appearanceOpen ? "is-active" : ""}`}
            onClick={() => setAppearanceOpen((open) => !open)}
            aria-label="閱讀設定"
            aria-expanded={appearanceOpen}
          >
            <TypeIcon />
          </button>
        </div>
      </header>

      {appearanceOpen && (
        <section className="appearance-popover" aria-label="閱讀設定">
          <div className="setting-row">
            <span>字號</span>
            <div className="font-stepper">
              <button onClick={() => setFontSize((size) => Math.max(17, size - 1))} aria-label="縮小字號">
                小
              </button>
              <output>{fontSize}</output>
              <button onClick={() => setFontSize((size) => Math.min(29, size + 1))} aria-label="放大字號">
                大
              </button>
            </div>
          </div>
          <div className="setting-row theme-setting-row">
            <span>色調</span>
            <div className="theme-switcher" role="group" aria-label="閱讀色調">
              <button
                type="button"
                className={theme === "light" ? "is-active" : ""}
                aria-pressed={theme === "light"}
                onClick={() => setTheme("light")}
              >
                明
              </button>
              <button
                type="button"
                className={theme === "dark" ? "is-active" : ""}
                aria-pressed={theme === "dark"}
                onClick={() => setTheme("dark")}
              >
                暗
              </button>
            </div>
          </div>
          <div className="setting-divider" />
          <div className="layer-grid">
            {(
              [
                ["persons", "人名線"],
                ["places", "地名線"],
                ["books", "書名號"],
                ["years", "紀年標"],
              ] as [LayerKey, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={layers[key] ? "is-active" : ""}
                onClick={() => toggleLayer(key)}
                aria-pressed={layers[key]}
              >
                <span className={`layer-swatch layer-swatch-${key}`} />
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      <main className="book-page">
        {loading && <div className="loading-state">展卷中</div>}
        {error && <div className="error-state">{error}</div>}
        {!loading && !error && volume && (
          <>
            <header className="volume-heading">
              <div className="volume-seal">
                {currentAppendix ? "附錄" : chronicleFor(volume.ordinal ?? 1).label}
              </div>
              <p>
                {currentAppendix
                  ? "原 EPUB 卷前卷後文獻"
                  : "總第 " + volume.ordinal + " 卷 · 司馬光編年 · 胡三省音註"}
              </p>
              {currentAppendix ? (
                <h1>{volume.title}</h1>
              ) : (
                <>
                  <div className="volume-title-pair">
                    <h1>{volume.title.replace(/^資治通鑑/, "")}</h1>
                    <span className="volume-title-separator" aria-hidden="true" />
                    <h2
                      className="volume-chronicle-title"
                      data-reading-kind="chronicle"
                      data-reading-label={openingChronicle?.title}
                      dangerouslySetInnerHTML={{ __html: openingChronicle?.titleHtml ?? "" }}
                    />
                  </div>
                  {openingChronicle?.range && (
                    <div className="volume-chronicle-range">{openingChronicle.range}</div>
                  )}
                  {notesEnabled && openingChronicle?.trailingNote && (
                    <DetachedNotes
                      notes={[openingChronicle.trailingNote]}
                      className="chronicle-detached-notes"
                      isNoteOpen={isNoteOpen}
                      onToggleNote={toggleNote}
                    />
                  )}
                </>
              )}
              <div className="heading-rule"><span /></div>
            </header>

            <article className={articleClasses}>
              {visibleBlocks.map((block) => (
                <SourceBlockView
                  key={block.id}
                  block={block}
                  notesEnabled={notesEnabled}
                  isNoteOpen={isNoteOpen}
                  onToggleNote={toggleNote}
                />
              ))}
            </article>

            {!currentAppendix && (
              <nav className="volume-navigation" aria-label="卷次導航">
                <button disabled={currentIndex <= 0} onClick={() => moveVolume(-1)}>
                  <ChevronIcon direction="left" />
                  <span>
                    <small>上一卷</small>
                    {manifest?.volumes[currentIndex - 1]
                      ? chronicleFor(manifest.volumes[currentIndex - 1].ordinal).label
                      : "已是首卷"}
                  </span>
                </button>
                <button disabled={!manifest || currentIndex >= manifest.volumes.length - 1} onClick={() => moveVolume(1)}>
                  <span>
                    <small>下一卷</small>
                    {manifest?.volumes[currentIndex + 1]
                      ? chronicleFor(manifest.volumes[currentIndex + 1].ordinal).label
                      : "已是末卷"}
                  </span>
                  <ChevronIcon direction="right" />
                </button>
              </nav>
            )}
          </>
        )}
      </main>

      <button
        className={`drawer-scrim ${tocOpen || searchOpen ? "is-visible" : ""}`}
        onClick={() => {
          setTocOpen(false);
          setSearchOpen(false);
        }}
        aria-label="關閉側欄"
        tabIndex={tocOpen || searchOpen ? 0 : -1}
      />

      <aside className={`side-drawer toc-drawer ${tocOpen ? "is-open" : ""}`} aria-hidden={!tocOpen}>
        <div className="drawer-header">
          <div><small>全書 294 卷</small><h2>卷次目錄</h2></div>
          <button className="icon-button" onClick={() => setTocOpen(false)} aria-label="關閉目錄"><CloseIcon /></button>
        </div>
                <nav className="volume-list">
          <ReadingAppendixList
            appendices={manifest?.appendices ?? []}
            currentId={volumeId}
            onSelect={selectVolume}
            placement="front"
          />
          <ChronicleVolumeList
            volumes={manifest?.volumes ?? []}
            currentId={volumeId}
            onSelect={selectVolume}
            isDrawerOpen={tocOpen}
          />
          <ReadingAppendixList
            appendices={manifest?.appendices ?? []}
            currentId={volumeId}
            onSelect={selectVolume}
            placement="back"
          />
        </nav>
      </aside>

      <aside className={`side-drawer search-drawer ${searchOpen ? "is-open" : ""}`} aria-hidden={!searchOpen}>
        <div className="drawer-header">
          <div><small>全書檢索</small><h2>在《通鑑》中尋找</h2></div>
          <button className="icon-button" onClick={() => setSearchOpen(false)} aria-label="關閉檢索"><CloseIcon /></button>
        </div>
        <label className="drawer-search search-primary">
          <SearchIcon />
          <input
            autoFocus={searchOpen}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="輸入人名、地名或文句"
          />
        </label>
        <div className="search-results">
          {searchLoading && <p className="drawer-empty">正在載入檢索資料…</p>}
          {!searchLoading && !searchQuery.trim() && <p className="drawer-empty">可搜尋全書正文與胡三省註。</p>}
          {!searchLoading && searchQuery.trim() && searchResults.length === 0 && <p className="drawer-empty">沒有找到相符內容。</p>}
          {searchResults.map((item, index) => {
            const targetVolume = item.volumeId ?? item.volume ?? item.volume_id ?? "";
            const targetBlock = item.blockId ?? item.block ?? item.block_id;
            return (
              <button key={`${targetVolume}-${targetBlock}-${index}`} onClick={() => selectVolume(targetVolume, targetBlock)}>
                <strong>{item.volumeTitle ?? item.title ?? manifest?.volumes.find((entry) => entry.id === targetVolume)?.title ?? targetVolume}</strong>
                <span>{item.text}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
