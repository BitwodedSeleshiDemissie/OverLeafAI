import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { MathJax, MathJaxContext } from 'better-react-mathjax';
import './App.css';
import 'katex/dist/katex.min.css';

type Status = 'idle' | 'loading' | 'error';
type Segment = { type: 'latex' | 'text' | 'placeholder'; content: string };
type ConvertResponse = { segments?: Segment[] };
type RawSegment = { type: 'math' | 'text'; content: string };
type OutlineSummary = { label: string; kind: 'heading' | 'math' | 'list' | 'text' };
type FormatToggle = { id: string; label: string };
type QuickPanel = 'table' | 'layout' | 'equation' | null;
type EquationPlacement = 'inline' | 'left' | 'center' | 'right';

const FORMAT_TOGGLES: FormatToggle[] = [
  { id: 'bold', label: 'B' },
  { id: 'italic', label: 'I' },
  { id: 'underline', label: 'U' },
  { id: 'heading1', label: 'H1' },
  { id: 'heading2', label: 'H2' },
  { id: 'bullets', label: '\u2022' },
  { id: 'numbered', label: '1.' },
  { id: 'equation', label: 'fx' },
];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

const defaultSeed =
  '*squareroot(2x)* captures how steep the curve is, and *integral(0, pi, sin(x), dx)* measures the total area.';

function App() {
  const [input, setInput] = useState(defaultSeed);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [parsedSegments, setParsedSegments] = useState<RawSegment[]>([]);
  const [showRawLatex, setShowRawLatex] = useState(false);
  const [quickPanel, setQuickPanel] = useState<QuickPanel>(null);
  const [docTitle, setDocTitle] = useState('Untitled document');
  const [showCodeDrawer, setShowCodeDrawer] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [tableColumns, setTableColumns] = useState(3);
  const [tableRows, setTableRows] = useState(4);
  const [tableHeaders, setTableHeaders] = useState('Variable, Description, Units');
  const [tableCaption, setTableCaption] = useState('Key measurements overview');
  const [layoutColumns, setLayoutColumns] = useState(2);
  const [layoutPrimary, setLayoutPrimary] = useState('Main derivation or argument text');
  const [layoutSecondary, setLayoutSecondary] = useState('Proof sketch, commentary, or diagrams');
  const [layoutMargin, setLayoutMargin] = useState('Margin notes, references, or reminders');
  const [equationPlacement, setEquationPlacement] = useState<EquationPlacement>('center');
  const [equationLabel, setEquationLabel] = useState('Eq. 1');
  const [equationAnchor, setEquationAnchor] = useState('near the result discussion so it reads naturally');

  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isSyncingRef = useRef(false);
  const latexCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    if (!input.trim()) {
      setSegments([]);
      setParsedSegments([]);
      setStatus('idle');
      setErrorMessage(null);
      return () => controller.abort();
    }

    const structured = extractSegments(input);
    setParsedSegments(structured);
    const hasMath = structured.some((segment) => segment.type === 'math');

    if (!hasMath) {
      setSegments(structured.map((segment) => ({ type: 'text', content: segment.content })));
      setStatus('idle');
      setErrorMessage(null);
      return () => controller.abort();
    }

    let needsConversion = false;
    const hydrated = structured.map((segment) => {
      if (segment.type === 'text') {
        return { type: 'text' as const, content: segment.content };
      }
      const cached = latexCacheRef.current.get(segment.content);
      if (cached) {
        return { type: 'latex' as const, content: cached };
      }
      needsConversion = true;
      return { type: 'placeholder' as const, content: segment.content };
    });

    setSegments(hydrated);

    if (!needsConversion) {
      setStatus('idle');
      setErrorMessage(null);
      return () => controller.abort();
    }

    setStatus('loading');
    setErrorMessage(null);

    const mathSnapshot = structured
      .filter((segment) => segment.type === 'math')
      .map((segment) => segment.content);

    const timeoutId = setTimeout(async () => {
      try {
        const { data } = await axios.post<ConvertResponse>(
          `${API_BASE_URL}/convert`,
          { input },
          { signal: controller.signal },
        );
        if (!isMounted) return;
        setSegments(data?.segments ?? []);
        const latexSegments = (data?.segments ?? []).filter(
          (segment): segment is Segment & { type: 'latex' } => segment.type === 'latex',
        );
        const cache = new Map(latexCacheRef.current);
        latexSegments.forEach((segment, index) => {
          const original = mathSnapshot[index];
          if (original) {
            cache.set(original, segment.content);
          }
        });
        latexCacheRef.current = cache;
        setStatus('idle');
      } catch (conversionError) {
        if (!isMounted || axios.isCancel(conversionError)) {
          return;
        }
        setStatus('error');
        setErrorMessage(
          axios.isAxiosError(conversionError)
            ? conversionError.response?.data?.error ?? 'Unable to convert input.'
            : 'Unable to convert input.',
        );
      }
    }, 350);

    return () => {
      isMounted = false;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [input]);

  const getSelectionSnapshot = () => {
    const textarea = textareaRef.current;
    const currentValue = textarea ? textarea.value : input;
    const start = textarea?.selectionStart ?? currentValue.length;
    const end = textarea?.selectionEnd ?? start;
    return { start, end, text: currentValue.slice(start, end) };
  };

  const mutateTextareaValue = (
    compute: (
      currentValue: string,
      selectionStart: number,
      selectionEnd: number,
    ) => { value: string; cursor: number },
    overrideStart?: number,
    overrideEnd?: number,
  ) => {
    const textarea = textareaRef.current;
    const currentValue = textarea ? textarea.value : input;
    const selectionStart = overrideStart ?? (textarea?.selectionStart ?? currentValue.length);
    const selectionEnd = overrideEnd ?? (textarea?.selectionEnd ?? selectionStart);
    const { value, cursor } = compute(currentValue, selectionStart, selectionEnd);
    setInput(value);
    requestAnimationFrame(() => {
      const area = textareaRef.current;
      if (!area) return;
      const clampedCursor = Math.min(Math.max(cursor, 0), value.length);
      area.focus();
      area.setSelectionRange(clampedCursor, clampedCursor);
    });
  };

  const insertTextAtSelection = (text: string) => {
    mutateTextareaValue((currentValue, start, end) => {
      const before = currentValue.slice(0, start);
      const after = currentValue.slice(end);
      return { value: `${before}${text}${after}`, cursor: start + text.length };
    });
  };

  const replaceSelectionWith = (replacement: string, start: number, end: number) => {
    mutateTextareaValue(
      (currentValue, selectionStart, selectionEnd) => {
        const before = currentValue.slice(0, selectionStart);
        const after = currentValue.slice(selectionEnd);
        return { value: `${before}${replacement}${after}`, cursor: selectionStart + replacement.length };
      },
      start,
      end,
    );
  };

  const wrapInstruction = (description: string) => `*${description.trim()}*`;

  const handleFormatToggle = (toggle: FormatToggle) => {
    const { text, start, end } = getSelectionSnapshot();
    if (text.trim()) {
      const snippet = `${wrapInstruction(text)}\n`;
      replaceSelectionWith(snippet, start, end);
      return;
    }
    insertTextAtSelection(`${wrapInstruction(toggle.label)}\n`);
  };

  const handleInsertTable = () => {
    const normalizedColumns = clampValue(tableColumns, 2, 6);
    const normalizedRows = clampValue(tableRows, 2, 12);
    const headers = tableHeaders
      .split(',')
      .map((header) => header.trim())
      .filter(Boolean)
      .join(', ');
    const headerSnippet = headers || 'custom headers of your choice';
    const caption = tableCaption.trim() || 'Key data overview';
    const instruction = `Insert a ${normalizedColumns}-column table with ${normalizedRows} rows titled "${caption}". Use headers ${headerSnippet} and place the caption beneath the table.`;
    insertTextAtSelection(`${wrapInstruction(instruction)}\n\n`);
    setQuickPanel(null);
  };

  const handleInsertLayout = () => {
    const normalizedColumns = clampValue(layoutColumns, 2, 3);
    const instruction = `Create a ${normalizedColumns}-column layout using minipage or multicolumn constructs: column one emphasises ${layoutPrimary.trim() || 'primary content'}, column two focuses on ${layoutSecondary.trim() || 'supporting commentary'}, and reserve a slim margin for ${layoutMargin.trim() || 'notes'}. Balance spacing so it feels like a polished document editor.`;
    insertTextAtSelection(`${wrapInstruction(instruction)}\n\n`);
    setQuickPanel(null);
  };

  const handleInsertEquation = () => {
    const placementDetails: Record<EquationPlacement, string> = {
      center: 'Render the equation in its own centered block using the equation environment so it feels like a primary element.',
      inline: 'Keep the equation inline with surrounding text so the baseline flows without extra vertical spacing.',
      left: 'Align the equation to the left using a flushleft block with a bit of gutter space on the right so text never overlaps.',
      right: 'Align the equation to the right using a flushright block, treating it like a margin callout that stays coherent with nearby text.',
    };
    const anchorInstruction = equationAnchor.trim()
      ? `Anchor it ${equationAnchor.trim()} and keep nearby paragraphs clear.`
      : 'Anchor it exactly where the reader expects it, without overlapping adjacent content.';
    const numberingInstruction =
      equationPlacement === 'inline'
        ? 'Leave it unnumbered to avoid breaking text flow.'
        : `Tag it as "${equationLabel.trim() || 'Eq.'}" using \\label/\\tag so cross-references stay correct.`;
    const instruction = `${placementDetails[equationPlacement]} ${anchorInstruction} ${numberingInstruction} Ensure the LaTeX stays Overleaf-safe and add a short variable note beneath if it aids clarity.`;
    insertTextAtSelection(`${wrapInstruction(instruction)}\n\n`);
    setQuickPanel(null);
  };

  const createNumberChangeHandler =
    (setter: (value: number) => void, fallback: number) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = Number(event.target.value);
      setter(Number.isFinite(parsed) ? parsed : fallback);
    };

  const handleTableColumnsChange = createNumberChangeHandler(setTableColumns, 3);
  const handleTableRowsChange = createNumberChangeHandler(setTableRows, 4);
  const handleLayoutColumnsChange = createNumberChangeHandler(setLayoutColumns, 2);

  const handleScroll = (source: 'editor' | 'preview') => {
    if (!syncEnabled || isSyncingRef.current) return;
    const sourceEl =
      source === 'editor' ? editorWrapperRef.current : previewWrapperRef.current;
    const targetEl =
      source === 'editor' ? previewWrapperRef.current : editorWrapperRef.current;
    if (!sourceEl || !targetEl) return;

    const sourceHeight = sourceEl.scrollHeight - sourceEl.clientHeight;
    const targetHeight = targetEl.scrollHeight - targetEl.clientHeight;
    if (sourceHeight <= 0 || targetHeight <= 0) return;

    const ratio = sourceEl.scrollTop / sourceHeight;
    const nextTop = ratio * targetHeight;

    isSyncingRef.current = true;
    targetEl.scrollTo({ top: nextTop });
    requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  };

  const latexDocument = useMemo(() => buildLatexDocument(docTitle, segments), [docTitle, segments]);

  const handleCopyLatex = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(latexDocument);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = latexDocument;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  const handleDownloadLatex = () => {
    try {
      const blob = new Blob([latexDocument], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(docTitle || 'document').replace(/\s+/g, '_')}.tex`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  return (
    <MathJaxContext
      version={3}
      config={{
        tex: {
          inlineMath: [
            ['$', '$'],
            ['\\(', '\\)'],
          ],
          displayMath: [
            ['$$', '$$'],
            ['\\[', '\\]'],
          ],
        },
      }}
    >
      <div className="app-shell">
        <header className="app-header">
          <div className="header-left">
            <div className="doc-title-row">
              <input
                className="doc-title-input"
                value={docTitle}
                onChange={(event) => setDocTitle(event.target.value)}
                spellCheck={false}
              />
              <span className="doc-badge">OverLeaf AI</span>
            </div>
            <p>
              Wrap math or layout instructions between <code>*asterisks*</code> to convert them. Text outside those
              markers stays as-is.
            </p>
            <FormatToggleBar toggles={FORMAT_TOGGLES} onToggle={handleFormatToggle} />
          </div>
          <div className="header-actions">
            <button type="button" className="secondary-button" onClick={() => setShowCodeDrawer(true)}>
              View LaTeX
            </button>
            <button
              type="button"
              className={`toggle ${syncEnabled ? 'enabled' : ''}`}
              onClick={() => setSyncEnabled((prev) => !prev)}
            >
              {syncEnabled ? 'Disable' : 'Enable'} Scroll Sync
            </button>
          </div>
        </header>
        <main className="workspace">
          <section className="pane" ref={editorWrapperRef} onScroll={() => handleScroll('editor')}>
            <div className="pane-heading">
              <div>
                <h2>Natural Language Editor</h2>
                <p>
                  Example: <code>*integral(0, pi, sin(x), dx)* significance explanation...</code>
                </p>
              </div>
            </div>
            <div className="editor-pane">
              <DocumentOutline segments={parsedSegments} />
              <div className="quick-insert">
                <span className="quick-label">Quick insert</span>
                <div className="quick-buttons">
                  <button
                    type="button"
                    className={`quick-button ${quickPanel === 'table' ? 'active' : ''}`}
                    onClick={() => setQuickPanel((prev) => (prev === 'table' ? null : 'table'))}
                  >
                    Table
                  </button>
                  <button
                    type="button"
                    className={`quick-button ${quickPanel === 'layout' ? 'active' : ''}`}
                    onClick={() => setQuickPanel((prev) => (prev === 'layout' ? null : 'layout'))}
                  >
                    Columns
                  </button>
                  <button
                    type="button"
                    className={`quick-button ${quickPanel === 'equation' ? 'active' : ''}`}
                    onClick={() => setQuickPanel((prev) => (prev === 'equation' ? null : 'equation'))}
                  >
                    Equation
                  </button>
                </div>
              </div>
              {quickPanel === 'table' ? (
                <div className="insert-panel">
                  <div className="insert-panel-grid">
                    <label className="insert-field">
                      <span>Columns</span>
                      <input
                        type="number"
                        min={2}
                        max={6}
                        value={tableColumns}
                        onChange={handleTableColumnsChange}
                      />
                    </label>
                    <label className="insert-field">
                      <span>Rows</span>
                      <input
                        type="number"
                        min={2}
                        max={12}
                        value={tableRows}
                        onChange={handleTableRowsChange}
                      />
                    </label>
                    <label className="insert-field wide">
                      <span>Headers</span>
                      <input
                        type="text"
                        value={tableHeaders}
                        onChange={(event) => setTableHeaders(event.target.value)}
                        placeholder="Variable, Description, Units"
                      />
                    </label>
                    <label className="insert-field wide">
                      <span>Caption</span>
                      <input
                        type="text"
                        value={tableCaption}
                        onChange={(event) => setTableCaption(event.target.value)}
                        placeholder="Key measurements overview"
                      />
                    </label>
                  </div>
                  <button type="button" className="insert-panel-action" onClick={handleInsertTable}>
                    Insert table instruction
                  </button>
                </div>
              ) : null}
              {quickPanel === 'layout' ? (
                <div className="insert-panel">
                  <div className="insert-panel-grid">
                    <label className="insert-field">
                      <span>Columns</span>
                      <input
                        type="number"
                        min={2}
                        max={3}
                        value={layoutColumns}
                        onChange={handleLayoutColumnsChange}
                      />
                    </label>
                    <label className="insert-field wide">
                      <span>Column 1 focus</span>
                      <textarea
                        rows={2}
                        value={layoutPrimary}
                        onChange={(event) => setLayoutPrimary(event.target.value)}
                      />
                    </label>
                    <label className="insert-field wide">
                      <span>Column 2 focus</span>
                      <textarea
                        rows={2}
                        value={layoutSecondary}
                        onChange={(event) => setLayoutSecondary(event.target.value)}
                      />
                    </label>
                    <label className="insert-field wide">
                      <span>Margin notes</span>
                      <textarea
                        rows={2}
                        value={layoutMargin}
                        onChange={(event) => setLayoutMargin(event.target.value)}
                      />
                    </label>
                  </div>
                  <button type="button" className="insert-panel-action" onClick={handleInsertLayout}>
                    Insert column layout instruction
                  </button>
                </div>
              ) : null}
              {quickPanel === 'equation' ? (
                <div className="insert-panel">
                  <div className="placement-pills" role="group" aria-label="Equation placement">
                    {(['center', 'inline', 'left', 'right'] as EquationPlacement[]).map((placement) => (
                      <button
                        key={placement}
                        type="button"
                        className={`placement-pill ${equationPlacement === placement ? 'active' : ''}`}
                        onClick={() => setEquationPlacement(placement)}
                      >
                        {placement === 'center'
                          ? 'Centered block'
                          : placement === 'inline'
                          ? 'Inline'
                          : placement === 'left'
                          ? 'Left aligned'
                          : 'Right aligned'}
                      </button>
                    ))}
                  </div>
                  <div className="insert-panel-grid">
                    <label className="insert-field">
                      <span>Equation tag / reference</span>
                      <input
                        type="text"
                        value={equationLabel}
                        onChange={(event) => setEquationLabel(event.target.value)}
                        placeholder="Eq. 2.1"
                      />
                    </label>
                    <label className="insert-field wide">
                      <span>Where should it sit?</span>
                      <textarea
                        rows={2}
                        value={equationAnchor}
                        onChange={(event) => setEquationAnchor(event.target.value)}
                        placeholder="e.g., beside the results paragraph or under Figure 2"
                      />
                    </label>
                  </div>
                  <button type="button" className="insert-panel-action" onClick={handleInsertEquation}>
                    Insert equation request
                  </button>
                </div>
              ) : null}
              <div className="editor-paper">
                <textarea
                  ref={textareaRef}
                  className="prose-editor"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Use *...* around conversion instructions and keep commentary outside."
                />
              </div>
            </div>
          </section>
          <section className="pane preview-pane" ref={previewWrapperRef} onScroll={() => handleScroll('preview')}>
            <div className="pane-heading preview-heading">
              <div>
                <h2>LaTeX Preview</h2>
                <p>{showRawLatex ? 'Inspect the generated LaTeX' : 'Rendered in real time via MathJax'}</p>
              </div>
              <div className="preview-controls">
                <button
                  type="button"
                  className={`toggle ${showRawLatex ? 'enabled' : ''}`}
                  onClick={() => setShowRawLatex((prev) => !prev)}
                >
                  {showRawLatex ? 'Show Rendered View' : 'Show Raw LaTeX'}
                </button>
                <StatusPill status={status} errorMessage={errorMessage} />
              </div>
            </div>
            <div className={`preview-surface ${showRawLatex ? 'code-mode' : ''}`}>
              {status === 'error' && errorMessage ? (
                <p className="error-text">{errorMessage}</p>
              ) : segments.length ? (
                segments.map((segment, index) => (
                  <SegmentBlock
                    key={`${segment.type}-${index}`}
                    segment={segment}
                    showRawLatex={showRawLatex}
                  />
                ))
              ) : (
                <p className="placeholder">
                  Wrap math inside <code>*...*</code> to convert it. Text outside renders instantly.
                </p>
              )}
            </div>
          </section>
        </main>
        <LatexDrawer
          open={showCodeDrawer}
          latex={latexDocument}
          onClose={() => setShowCodeDrawer(false)}
          onCopy={handleCopyLatex}
          onDownload={handleDownloadLatex}
          copyState={copyState}
        />
      </div>
    </MathJaxContext>
  );
}

type StatusPillProps = { status: Status; errorMessage: string | null };
type SegmentBlockProps = { segment: Segment; showRawLatex: boolean };
type FormatToggleBarProps = {
  toggles: FormatToggle[];
  onToggle: (toggle: FormatToggle) => void;
};
type DocumentOutlineProps = { segments: RawSegment[] };
type LatexDrawerProps = {
  open: boolean;
  latex: string;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
  copyState: 'idle' | 'copied' | 'error';
};

function StatusPill({ status, errorMessage }: StatusPillProps) {
  if (status === 'idle' && !errorMessage) {
    return <span className="status-pill ready">Ready</span>;
  }
  if (status === 'loading') {
    return <span className="status-pill loading">Converting...</span>;
  }
  return (
    <span className="status-pill error" title={errorMessage ?? undefined}>
      Error
    </span>
  );
}

function SegmentBlock({ segment, showRawLatex }: SegmentBlockProps) {
  if (segment.type === 'placeholder') {
    return (
      <p className="segment-block placeholder">
        Converting&nbsp;
        <span>{segment.content}</span>
      </p>
    );
  }

  if (segment.type === 'latex') {
    const structural = parseStructuralLatex(segment.content);
    if (structural && !showRawLatex) {
      if (structural.kind === 'heading' && structural.preview) {
        return <h3 className="structural-heading">{structural.preview}</h3>;
      }
      if (structural.preview) {
        return <p className="structural-preview">{structural.preview}</p>;
      }
      return null;
    }
    if (showRawLatex || structural) {
      return (
        <div className="segment-block">
          <pre className="latex-code">{segment.content}</pre>
        </div>
      );
    }
    const mathWrapper = shouldDisplayMath(segment.content) ? '\\[' : '\\(';
    return (
      <div className="segment-block">
        <MathJax dynamic inline={mathWrapper === '\\('}>
          {`${mathWrapper} ${segment.content} ${mathWrapper === '\\[' ? '\\]' : '\\)'}`}
        </MathJax>
      </div>
    );
  }

  return <p className="segment-block text">{segment.content}</p>;
}

function FormatToggleBar({ toggles, onToggle }: FormatToggleBarProps) {
  return (
    <div className="format-toggle-bar">
      {toggles.map((toggle) => (
        <button key={toggle.id} type="button" className="format-button" onClick={() => onToggle(toggle)}>
          {toggle.label}
        </button>
      ))}
    </div>
  );
}

function DocumentOutline({ segments }: DocumentOutlineProps) {
  if (!segments.length) {
    return (
      <div className="outline-chips empty">
        <span className="outline-chip text">Start typing to build the structure</span>
      </div>
    );
  }

  return (
    <div className="outline-chips">
      {segments.map((segment, index) => {
        const summary = summarizeSegmentForOutline(segment);
        return (
          <span key={`outline-${summary.kind}-${index}`} className={`outline-chip ${summary.kind}`}>
            {summary.label}
          </span>
        );
      })}
    </div>
  );
}

function LatexDrawer({ open, latex, onClose, onCopy, onDownload, copyState }: LatexDrawerProps) {
  if (!open) return null;
  return (
    <div className="latex-drawer">
      <div className="latex-drawer-panel">
        <div className="latex-drawer-header">
          <div>
            <h3>Document LaTeX</h3>
            <p>Copy or download everything the AI generated.</p>
          </div>
          <div className="latex-drawer-actions">
            <button type="button" className="secondary-button" onClick={onCopy}>
              {copyState === 'copied' ? 'Copied!' : copyState === 'error' ? 'Copy failed' : 'Copy to clipboard'}
            </button>
            <button type="button" className="secondary-button" onClick={onDownload}>
              Download .tex
            </button>
            <button type="button" className="toggle" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <textarea className="latex-export-area" value={latex} readOnly spellCheck={false} />
      </div>
    </div>
  );
}

function summarizeSegmentForOutline(segment: RawSegment): OutlineSummary {
  if (segment.type === 'math') {
    return { kind: 'math', label: `Math: ${getPreviewFromContent(segment.content)}` };
  }
  const trimmed = segment.content.trim();
  if (/heading|title|section/i.test(trimmed)) {
    return { kind: 'heading', label: `Heading: ${getPreviewFromContent(trimmed)}` };
  }
  if (/list|bullet|numbered|steps?/i.test(trimmed)) {
    return { kind: 'list', label: `List: ${getPreviewFromContent(trimmed)}` };
  }
  return { kind: 'text', label: `Text: ${getPreviewFromContent(trimmed)}` };
}

function getPreviewFromContent(value: string) {
  const condensed = value.replace(/\s+/g, ' ').trim();
  if (!condensed) return 'Details pending';
  return condensed.length > 36 ? `${condensed.slice(0, 33)}...` : condensed;
}

function parseStructuralLatex(content: string) {
  const structuralEnvs = [
    'itemize',
    'enumerate',
    'tabular',
    'tabularx',
    'table',
    'figure',
    'tikzpicture',
    'minipage',
    'multicols',
    'center',
    'flushleft',
    'flushright',
  ];
  const trimmed = content.trim();
  const matchEnv = structuralEnvs.find(
    (env) => trimmed.includes(`\\begin{${env}}`) || trimmed.includes(`\\end{${env}}`),
  );
  if (matchEnv) {
    const label =
      matchEnv === 'itemize' || matchEnv === 'enumerate'
        ? 'List'
        : matchEnv === 'center'
        ? 'Centered text'
        : matchEnv === 'flushleft' || matchEnv === 'flushright'
          ? 'Aligned text'
          : 'Layout';
    const preview = extractPlainTextFromLatex(trimmed);
    return {
      label,
      kind: label === 'List' ? 'list' : label === 'Layout' ? 'layout' : 'text',
      preview,
    };
  }
  if (/\\item\s/.test(trimmed) && !trimmed.includes('\\begin{aligned}')) {
    return {
      label: 'List',
      kind: 'list',
      preview: extractPlainTextFromLatex(trimmed),
    };
  }
  if (/\\(sub)?(sub)?section\{/.test(trimmed)) {
    return {
      label: 'Heading',
      kind: 'heading',
      preview: extractPlainTextFromLatex(trimmed),
    };
  }
  const textOnly = /\\textbf\{|\\textit\{|\\underline\{/.test(trimmed);
  if (textOnly && !/\\int|\\sum|\\frac|\\lim|\\begin{aligned}/.test(trimmed)) {
    return {
      label: 'Text block',
      kind: 'text',
      preview: extractPlainTextFromLatex(trimmed),
    };
  }
  return null;
}

function extractPlainTextFromLatex(input: string) {
  let output = input;
  output = output.replace(/\\begin\{.*?}\s*/g, '').replace(/\\end\{.*?}\s*/g, '');
  output = output.replace(/\\textbf\{([^}]*)}/g, '$1');
  output = output.replace(/\\textit\{([^}]*)}/g, '$1');
  output = output.replace(/\\underline\{([^}]*)}/g, '$1');
  output = output.replace(/\\text\{([^}]*)}/g, '$1');
  output = output.replace(/\\\[|\\\]|\$|\{|\}/g, ' ');
  output = output.replace(/\\[a-zA-Z]+/g, '');
  output = output.replace(/\s+/g, ' ').trim();
  return output.length ? output : null;
}

function extractSegments(value: string): RawSegment[] {
  const output: RawSegment[] = [];
  const regex = /\*(.*?)\*/gs;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex) {
      const outside = value.slice(lastIndex, match.index);
      if (outside.trim()) {
        output.push({ type: 'text', content: outside });
      }
    }
    const inside = match[1];
    if (inside.trim()) {
      output.push({ type: 'math', content: inside });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < value.length) {
    const tail = value.slice(lastIndex);
    if (tail.trim()) {
      output.push({ type: 'text', content: tail });
    }
  }

  if (!output.length && value.trim()) {
    output.push({ type: 'text', content: value });
  }

  return output;
}

function shouldDisplayMath(content: string) {
  const trimmed = content.trim();
  if (trimmed.includes('\n')) return true;
  if (trimmed.length > 120) return true;
  return /\\begin|\\int|\\sum|\\lim|\\boxed|\\frac|=|\\aligned|\\cases|\\displaystyle/.test(trimmed);
}

function clampValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function buildLatexDocument(title: string, segments: Segment[]) {
  const escapedTitle = escapeLatexText(title || 'Untitled document');
  const body = segments.length
    ? segments
        .map((segment) => {
          if (segment.type === 'latex') return segment.content;
          if (segment.type === 'text') return escapeLatexParagraph(segment.content);
          return `% pending conversion for: ${segment.content}`;
        })
        .join('\n\n')
    : '% Start writing to generate content.';
  return [
    '\\documentclass{article}',
    '\\usepackage{amsmath}',
    '\\usepackage{amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{array}',
    '\\usepackage{enumitem}',
    '\\usepackage{tikz}',
    '',
    `\\title{${escapedTitle}}`,
    '\\date{}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    body,
    '',
    '\\end{document}',
  ].join('\n');
}

function escapeLatexParagraph(text: string) {
  const escaped = escapeLatexText(text);
  return escaped ? `${escaped}\n` : '';
}

function escapeLatexText(text: string) {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}_])/g, '\\$1')
    .replace(/\^/g, '\\^{}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/%/g, '\\%')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#');
}

export default App;
