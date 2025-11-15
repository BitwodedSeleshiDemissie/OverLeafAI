import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { MathJax, MathJaxContext } from 'better-react-mathjax';
import './App.css';
import 'katex/dist/katex.min.css';

type Status = 'idle' | 'loading' | 'error';
type Segment = { type: 'latex' | 'text' | 'placeholder'; content: string };
type ConvertResponse = {
  segments?: Segment[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

const defaultSeed =
  '*squareroot(2x)* captures how steep the curve is, and *integral(0, pi, sin(x), dx)* measures the total area.';

function App() {
  const [input, setInput] = useState(defaultSeed);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(true);

  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  const latexCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    if (!input.trim()) {
      setSegments([]);
      setStatus('idle');
      setErrorMessage(null);
      return () => controller.abort();
    }

    const parsedSegments = extractSegments(input);
    const hasMathSegments = parsedSegments.some((segment) => segment.type === 'math');

    if (!hasMathSegments) {
      setSegments(
        parsedSegments.map<Segment>((segment) => ({
          type: 'text',
          content: segment.content,
        })),
      );
      setStatus('idle');
      setErrorMessage(null);
      return () => controller.abort();
    }

    let needsConversion = false;
    const hydratedSegments = parsedSegments.map((segment) => {
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

    setSegments(hydratedSegments);

    if (!needsConversion) {
      setStatus('idle');
      setErrorMessage(null);
      return () => controller.abort();
    }

    setStatus('loading');
    setErrorMessage(null);

    const mathSnapshot = parsedSegments
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
          const sourceInstruction = mathSnapshot[index];
          if (sourceInstruction) {
            cache.set(sourceInstruction, segment.content);
          }
        });
        latexCacheRef.current = cache;
        setStatus('idle');
      } catch (error) {
        if (!isMounted || axios.isCancel(error)) {
          return;
        }
        setStatus('error');
        setErrorMessage(
          axios.isAxiosError(error)
            ? error.response?.data?.error ?? 'Unable to convert input.'
            : 'Unable to convert input.',
        );
      }
    }, 400);

    return () => {
      isMounted = false;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [input]);

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
    window.requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
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
          <div>
            <h1>OverLeaf AI</h1>
            <p>
              Wrap math instructions between <code>*asterisks*</code> to convert them. Text outside
              those markers appears exactly as written.
            </p>
          </div>
          <div className="header-actions">
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
            <textarea
              className="prose-editor"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Use *...* around mathematical instructions and keep the prose outside."
            />
          </section>
          <section className="pane" ref={previewWrapperRef} onScroll={() => handleScroll('preview')}>
            <div className="pane-heading preview-heading">
              <div>
                <h2>LaTeX Preview</h2>
                <p>Rendered in real time via MathJax</p>
              </div>
              <StatusPill status={status} errorMessage={errorMessage} />
            </div>
            <div className="preview-surface">
              {status === 'error' && errorMessage ? (
                <p className="error-text">{errorMessage}</p>
              ) : segments.length ? (
                segments.map((segment, index) => (
                  <SegmentBlock key={`${segment.type}-${index}`} segment={segment} />
                ))
              ) : (
                <p className="placeholder">
                  Wrap math inside <code>*...*</code> to convert it. Text outside renders instantly.
                </p>
              )}
            </div>
          </section>
        </main>
      </div>
    </MathJaxContext>
  );
}

type StatusPillProps = {
  status: Status;
  errorMessage: string | null;
};

type SegmentBlockProps = {
  segment: Segment;
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

function SegmentBlock({ segment }: SegmentBlockProps) {
  if (segment.type === 'placeholder') {
    return (
      <p className="segment-block placeholder">
        Converting&nbsp;
        <span>{segment.content}</span>
      </p>
    );
  }

  if (segment.type === 'latex') {
    return (
      <div className="segment-block">
        <MathJax dynamic inline={false}>
          {`\\[ ${segment.content} \\]`}
        </MathJax>
      </div>
    );
  }

  return <p className="segment-block text">{segment.content}</p>;
}

type RawSegment = { type: 'math' | 'text'; content: string };

function extractSegments(value: string): RawSegment[] {
  const output: RawSegment[] = [];
  const regex = /\*(.*?)\*/gs;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex) {
      const outside = value.slice(lastIndex, match.index).trim();
      if (outside) {
        output.push({ type: 'text', content: outside });
      }
    }
    const inside = match[1].trim();
    if (inside) {
      output.push({ type: 'math', content: inside });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < value.length) {
    const tail = value.slice(lastIndex).trim();
    if (tail) {
      output.push({ type: 'text', content: tail });
    }
  }

  if (!output.length && value.trim()) {
    output.push({ type: 'text', content: value.trim() });
  }

  return output;
}

export default App;
