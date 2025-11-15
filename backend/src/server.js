const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { jsonrepair } = require('jsonrepair');
require('dotenv').config();

const PORT = process.env.PORT || 4000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/convert', async (req, res) => {
  const { input } = req.body || {};

  if (!input || typeof input !== 'string') {
    return res.status(400).json({
      error: 'Request body must include an "input" string with the math expression.',
    });
  }

  try {
    const result = await convertMathToLatex(input);
    res.json(result);
  } catch (error) {
    console.error('Conversion failed', error);
    res.status(500).json({
      error: 'Failed to convert input to LaTeX. Check server logs for details.',
    });
  }
});

async function convertMathToLatex(input) {
  const segments = extractSegments(input);
  const mathSegments = segments.filter((segment) => segment.type === 'math');

  if (!mathSegments.length) {
    return {
      segments: segments
        .map((segment) =>
          segment.content
            ? { type: 'text', content: segment.content }
            : null,
        )
        .filter(Boolean),
    };
  }

  let latexList = [];

  if (hasOpenAIKey) {
    latexList = await convertWithOpenAI(mathSegments.map((segment) => segment.content));
  } else {
    latexList = mathSegments.map((segment) => basicInlineConverter(segment.content));
  }

  if (latexList.length < mathSegments.length) {
    latexList = mathSegments.map(
      (segment, index) => latexList[index] ?? basicInlineConverter(segment.content),
    );
  }

  let latexIndex = 0;
  const orderedSegments = segments
    .map((segment) => {
      if (!segment.content) return null;
      if (segment.type === 'math') {
        const converted = normalizeLatex(latexList[latexIndex++] || '');
        if (!converted) return null;
        return { type: 'latex', content: converted };
      }
      return { type: 'text', content: segment.content };
    })
    .filter(Boolean);

  return { segments: orderedSegments };
}

async function convertWithOpenAI(mathInstructions) {
  if (!mathInstructions.length) return [];

  const prompt = [
    'Convert each math instruction inside the JSON array into valid LaTeX strings (no dollar signs).',
    'Interpret natural-language descriptions of advanced math structures including, but not limited to:',
    '  • derivatives, partial derivatives, gradients, divergence, curl, and nabla notation',
    '  • line/surface/volume integrals with limits and differential elements',
    '  • sums/products, limits, logarithms, exponentials, trigonometric and hyperbolic functions',
    '  • matrices, vectors, vector bold/arrow notation, dot/cross products, tensor notation',
    '  • complex numbers, absolute values, norms, floor/ceiling, cases/piecewise definitions',
    '  • probability/expectation/variance symbols, set/logic notation, Greek letters',
    '  • tables (tabular/tabularx, multi-column alignment, captions), simple figure placeholders with \\text{Diagram: ...} or TikZ skeletons, and layout cues such as centering, alignment, spacing, or page regions.',
    '  • contextual annotations like symbol definitions or side notes (use \\scriptsize or \\footnotesize \\text{...} positioned beside or beneath the main expression). Resolve vague instructions (e.g., "put it to the right side of the page") with reasonable LaTeX constructs such as \\hfill, minipages, or aligned environments.',
    '  • styling commands like bar, hat, tilde, underline, boxed, overbrace, underbrace, text annotations, equation/align environments.',
      'Honor explicit layout requests (align systems, cases, boxed expressions, multi-line derivations) and merge multiple operations described in a single instruction.',
      'Return a JSON array of strings in the same order as the input. Do not include explanations.',
    'Example Input: ["integral of x from 0 to 1","sqrt of 2x","center the title Analysis 1 exam exactly in the middle of the page"]',
    'Example Output: ["\\\\int_{0}^{1} x \\\\, dx","\\\\sqrt{2x}","\\\\begin{center}\\\\textbf{Analysis 1 exam}\\\\end{center}"]',
    'Input:',
    JSON.stringify(mathInstructions),
    'Output JSON array:',
  ].join('\n');

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You convert structured math instructions into LaTeX arrays.',
        },
        { role: 'user', content: prompt },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    },
  );

  const parsed = extractArrayFromResponse(response.data);
  if (Array.isArray(parsed) && parsed.length) {
    return parsed.map((item) => (typeof item === 'string' ? item.trim() : ''));
  }

  throw new Error('Empty response from OpenAI');
}

function extractArrayFromResponse(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return [];
  const raw = Array.isArray(content) ? content.map((c) => c.text || c).join('\n') : content;
  const stripped = stripCodeFences(raw);
  try {
    const repaired = jsonrepair(stripped);
    const parsed = JSON.parse(repaired);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Failed to parse OpenAI JSON array:', error);
    const fallback = stripped.match(/\[([\s\S]*)\]/);
    if (fallback) {
      const parts = fallback[1]
        .split(/",\s*"/)
        .map((item) => item.replace(/^"+|"+$/g, '').trim());
      return parts;
    }
    return [];
  }
}

function stripCodeFences(text) {
  return text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function basicInlineConverter(input) {
  return input
    .replace(/squareroot\((.*?)\)/gi, '\\\\sqrt{$1}')
    .replace(
      /integral\((.*?),(.*?),(.*?),(.*?)\)/gi,
      '\\\\int_{ $1 }^{ $2 } $3 \\\\mathrm{d}$4',
    )
    .replace(/fraction\((.*?),(.*?)\)/gi, '\\\\frac{$1}{$2}')
    .trim();
}

function normalizeLatex(latex) {
  if (!latex) return '';
  const commands = ['int', 'sum', 'sqrt', 'sin', 'cos', 'tan', 'log', 'nabla', 'vec', 'cdot', 'times', 'boxed'];
  let normalized = latex;
  for (const command of commands) {
    const regex = new RegExp(`(^|[^\\\\])(${command})(?=[^a-zA-Z]|$)`, 'g');
    normalized = normalized.replace(regex, (match, prefix, cmd) => `${prefix}\\${cmd}`);
  }
  return normalized;
}

function extractSegments(input) {
  const segments = [];
  const regex = /\*(.*?)\*/gs;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      const outside = input.slice(lastIndex, match.index);
      if (outside.trim()) {
        segments.push({ type: 'text', content: outside.trim() });
      }
    }
    const inside = match[1];
    if (inside.trim()) {
      segments.push({ type: 'math', content: inside.trim() });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < input.length) {
    const tail = input.slice(lastIndex);
    if (tail.trim()) {
      segments.push({ type: 'text', content: tail.trim() });
    }
  }

  if (!segments.length && input.trim()) {
    segments.push({ type: 'text', content: input.trim() });
  }

  return segments;
}

app.listen(PORT, () => {
  console.log(`LaTeX conversion server listening on http://localhost:${PORT}`);
});
