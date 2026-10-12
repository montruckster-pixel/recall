/**
 * Study-content generation. Turns extracted document text (or a study set's
 * cards) into structured flashcards, questions, summaries and terminology.
 *
 * Every generator:
 *   - instructs the model to ground itself strictly in the supplied material,
 *   - demands a strict JSON shape,
 *   - normalizes and validates the result before it is stored,
 *   - is metered against the user's monthly AI allowance by the caller.
 */
import { generateJson } from './ai.js';

const GROUNDING = `You are an expert exam-preparation content author.
Ground every item strictly in the supplied source material. Do not invent facts,
statistics, or exam questions. If the material does not support an item, omit it.
Never claim your output is an official exam question.`;

function asArray(v) { return Array.isArray(v) ? v : []; }
function clean(v, max = 2000) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Generate a full study package from source text. */
export async function generateStudyPackage({ text, title = '', subject = '', topic = '', counts = {} }) {
  const nCards = Math.min(60, Math.max(5, counts.flashcards || 24));
  const nMcq = Math.min(30, Math.max(3, counts.mcqs || 10));
  const nShort = Math.min(20, Math.max(0, counts.shortAnswers ?? 5));
  const nTerms = Math.min(30, Math.max(3, counts.terms || 12));

  const prompt = `Source material titled "${title}"${subject ? ` (subject: ${subject})` : ''}${topic ? ` (topic: ${topic})` : ''}:

<<<SOURCE
${text}
SOURCE>>>

Produce a study package as a single JSON object with this exact shape:
{
  "summary": "a 120-220 word plain-language summary of the material",
  "topics": ["3-8 short topic labels covered by the material"],
  "keyTerms": [{ "term": "...", "definition": "..." }],
  "flashcards": [{ "front": "question or term", "back": "answer or explanation", "example": "optional concrete example or empty string", "sourceRef": "short quote/section marker from the source", "topic": "one of the topics", "difficulty": 1 }],
  "mcqs": [{ "prompt": "question", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "why the correct answer is right", "misconception": "the most likely wrong belief and why it is wrong", "topic": "one of the topics", "difficulty": 1 }],
  "shortAnswers": [{ "prompt": "question", "answer": "model answer in 1-3 sentences", "rubric": ["3-5 specific points a correct answer must include"], "topic": "one of the topics", "difficulty": 1 }],
  "suggestedSessions": [{ "title": "session name", "focus": "what to study", "minutes": 25 }]
}
Requirements:
- exactly ${nTerms} keyTerms, ${nCards} flashcards, ${nMcq} mcqs${nShort ? `, ${nShort} shortAnswers` : ', and an empty shortAnswers array'}.
- difficulty is 1 (easy) to 4 (hard).
- mcqs must have exactly 4 options with plausible distractors and one correct index.
- topics must be short (2-4 words).
- Return only the JSON object.`;

  const raw = await generateJson({ system: GROUNDING, prompt, temperature: 0.4 });
  return normalizePackage(raw);
}

export function normalizePackage(raw) {
  const topics = asArray(raw?.topics).map((t) => clean(t, 60)).filter(Boolean).slice(0, 12);
  const fallbackTopic = topics[0] || 'General';

  const keyTerms = asArray(raw?.keyTerms)
    .map((t) => ({ term: clean(t?.term, 120), definition: clean(t?.definition, 600) }))
    .filter((t) => t.term && t.definition)
    .slice(0, 60);

  const flashcards = asArray(raw?.flashcards)
    .map((c) => ({
      front: clean(c?.front, 500),
      back: clean(c?.back, 1200),
      example: clean(c?.example, 500),
      sourceRef: clean(c?.sourceRef, 200),
      topic: clean(c?.topic, 60) || fallbackTopic,
      difficulty: clampDiff(c?.difficulty),
    }))
    .filter((c) => c.front && c.back)
    .slice(0, 100);

  const mcqs = asArray(raw?.mcqs)
    .map((q) => {
      const options = asArray(q?.options).map((o) => clean(o, 400)).filter(Boolean).slice(0, 6);
      let idx = Number.isInteger(q?.correctIndex) ? q.correctIndex : 0;
      if (idx < 0 || idx >= options.length) idx = 0;
      return {
        prompt: clean(q?.prompt, 600),
        options,
        correctIndex: idx,
        explanation: clean(q?.explanation, 800),
        misconception: clean(q?.misconception, 500),
        topic: clean(q?.topic, 60) || fallbackTopic,
        difficulty: clampDiff(q?.difficulty),
      };
    })
    .filter((q) => q.prompt && q.options.length >= 2)
    .slice(0, 60);

  const shortAnswers = asArray(raw?.shortAnswers)
    .map((q) => ({
      prompt: clean(q?.prompt, 600),
      answer: clean(q?.answer, 1200),
      rubric: asArray(q?.rubric).map((r) => clean(r, 300)).filter(Boolean).slice(0, 8),
      topic: clean(q?.topic, 60) || fallbackTopic,
      difficulty: clampDiff(q?.difficulty),
    }))
    .filter((q) => q.prompt && q.answer)
    .slice(0, 40);

  const suggestedSessions = asArray(raw?.suggestedSessions)
    .map((s) => ({ title: clean(s?.title, 120), focus: clean(s?.focus, 200), minutes: Math.min(120, Math.max(5, Number(s?.minutes) || 20)) }))
    .filter((s) => s.title)
    .slice(0, 8);

  return {
    summary: clean(raw?.summary, 3000),
    topics,
    keyTerms,
    flashcards,
    mcqs,
    shortAnswers,
    suggestedSessions,
  };
}

function clampDiff(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(4, Math.round(n)));
}

/** Generate additional questions from existing flashcard material. */
export async function generateQuestions({ sourceText, title = '', counts = {} }) {
  const nMcq = Math.min(30, Math.max(3, counts.mcqs || 8));
  const nTf = Math.min(20, Math.max(0, counts.trueFalse || 0));
  const nShort = Math.min(20, Math.max(0, counts.shortAnswers || 0));
  const prompt = `Source material titled "${title}":

<<<SOURCE
${sourceText}
SOURCE>>>

Create a quiz as a single JSON object:
{
  "mcqs": [{ "prompt": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "...", "misconception": "...", "topic": "...", "difficulty": 1 }],
  "trueFalse": [{ "prompt": "a statement to judge true or false", "correct": true, "explanation": "...", "topic": "...", "difficulty": 1 }],
  "shortAnswers": [{ "prompt": "...", "answer": "model answer", "rubric": ["..."], "topic": "...", "difficulty": 1 }]
}
Requirements:
- ${nMcq} mcqs, ${nTf} trueFalse, ${nShort} shortAnswers. Use empty arrays where a count is 0.
- Only use facts present in the source. Return only JSON.`;
  const raw = await generateJson({ system: GROUNDING, prompt, temperature: 0.4 });
  const pkg = normalizePackage(raw);
  const trueFalse = asArray(raw?.trueFalse).map((q) => ({
    prompt: clean(q?.prompt, 600),
    correct: Boolean(q?.correct),
    explanation: clean(q?.explanation, 800),
    topic: clean(q?.topic, 60) || pkg.topics[0] || 'General',
    difficulty: clampDiff(q?.difficulty),
  })).filter((q) => q.prompt).slice(0, 40);
  return { mcqs: pkg.mcqs, trueFalse, shortAnswers: pkg.shortAnswers };
}

/** Grade a free-text answer against a rubric. Returns a 0-1 score and feedback. */
export async function gradeShortAnswer({ prompt, modelAnswer, rubric = [], response }) {
  if (!clean(response)) {
    return { score: 0, feedback: 'No answer was provided.', missing: [] };
  }
  const rubricText = rubric.length ? rubric.map((r, i) => `${i + 1}. ${r}`).join('\n') : '(no explicit rubric — judge against the model answer)';
  const aiPrompt = `Question: ${prompt}
Model answer: ${modelAnswer}
Rubric:
${rubricText}

Student answer: ${response}

Grade the student answer. Return a single JSON object:
{ "score": 0.0, "feedback": "2-4 sentences of specific, encouraging feedback", "missing": ["rubric points the answer missed"] }
Score is 0 to 1 (0 = no credit, 1 = fully correct). Be fair: give partial credit for partially correct answers.`;
  const raw = await generateJson({ system: GROUNDING, prompt: aiPrompt, temperature: 0.1 });
  const score = Math.max(0, Math.min(1, Number(raw?.score) || 0));
  return {
    score,
    feedback: clean(raw?.feedback, 1200),
    missing: asArray(raw?.missing).map((m) => clean(m, 300)).filter(Boolean).slice(0, 8),
  };
}

/** Short narrative insight over a user's aggregate stats. */
export async function generateInsights({ stats, weakTopics, dueCount }) {
  const prompt = `You are a study coach. Using ONLY the data below, write 2-4 short, practical insights.
Data: ${JSON.stringify({ stats, weakTopics, dueCount }).slice(0, 4000)}
Return JSON: { "insights": ["...", "..."] }
Do not promise exam success. Do not invent numbers. Reference the actual figures.`;
  const raw = await generateJson({ system: GROUNDING, prompt, temperature: 0.3 });
  return asArray(raw?.insights).map((s) => clean(s, 400)).filter(Boolean).slice(0, 5);
}
