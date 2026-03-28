/**
 * Whistle AI Agent Module
 *
 * Provides GPT-powered agents for:
 *   - Seller: generates real deliverable content from a task spec
 *   - Buyer:  reviews deliverables against a structured rubric
 *   - Arbitrator: analyzes disputes with detailed rationale
 */

const OpenAI = require('openai');

let _client = null;

function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in .env');
  _client = new OpenAI({ apiKey });
  return _client;
}

// ============ Seller Agent ============

/**
 * Generate a deliverable from a task spec using GPT.
 * @param {Object} taskSpec - The task specification (title, description, requirements, etc.)
 * @param {Object} options
 * @param {boolean} options.lowEffort - If true, produce intentionally bad output (for dispute demo)
 * @returns {Object} { title, body, wordCount, model, reasoning }
 */
async function sellerGenerate(taskSpec, options = {}) {
  const client = getClient();

  const systemPrompt = options.lowEffort
    ? `You are a lazy, careless freelancer. You put in the absolute minimum effort.
Ignore most requirements. Write only 1-2 short sentences total.
Do NOT meet word count, citations, or topic coverage requirements.
Make it obviously inadequate so a reviewer would reject it.`
    : `You are a skilled freelance writer and AI agent completing a paid task.
You MUST meet every stated requirement precisely.
Write high-quality, original, well-structured content.
If a word count is specified, meet or exceed it.
If citations are required, include real or realistic academic citations in [1] format.
If specific topics must be covered, cover each one thoroughly.`;

  const userPrompt = `Task Specification:
Title: ${taskSpec.title}
Description: ${taskSpec.description}
Requirements: ${(taskSpec.requirements || []).map((r, i) => `  ${i + 1}. ${r}`).join('\n')}
Deliverable Format: ${taskSpec.deliverableFormat || 'article'}

Generate the deliverable content now. Return ONLY a JSON object with this schema:
{
  "title": "string — the deliverable title",
  "body": "string — the full article/paper content",
  "wordCount": number
}`;

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: options.lowEffort ? 1.0 : 0.7,
    max_tokens: options.lowEffort ? 200 : 2000,
  });

  const raw = JSON.parse(res.choices[0].message.content);
  const actualWordCount = (raw.body || '').split(/\s+/).filter(Boolean).length;

  return {
    title: raw.title || 'Untitled',
    body: raw.body || '',
    wordCount: actualWordCount,
    model: 'gpt-4o-mini',
    tokensUsed: res.usage?.total_tokens || 0,
  };
}

// ============ Buyer Agent ============

/**
 * Review a deliverable against the task spec using a structured rubric.
 * @param {Object} taskSpec
 * @param {Object} deliverable - { title, body }
 * @returns {Object} { approved, score, rubric, reasoning, model }
 */
async function buyerReview(taskSpec, deliverable) {
  const client = getClient();

  const systemPrompt = `You are a meticulous quality reviewer for a decentralized task marketplace.
You evaluate deliverables against task specifications using a strict rubric.
You are fair but rigorous — if requirements are not met, you flag them clearly.
Your review determines whether funds are released or a dispute is opened.`;

  const userPrompt = `TASK SPECIFICATION:
Title: ${taskSpec.title}
Description: ${taskSpec.description}
Requirements:
${(taskSpec.requirements || []).map((r, i) => `  ${i + 1}. ${r}`).join('\n')}

DELIVERABLE:
Title: ${deliverable.title}
Body (${(deliverable.body || '').split(/\s+/).filter(Boolean).length} words):
---
${(deliverable.body || '').slice(0, 3000)}
---

Evaluate the deliverable against EACH requirement. Return ONLY a JSON object:
{
  "approved": boolean,
  "overallScore": number (0-100),
  "rubric": [
    {
      "requirement": "string — the requirement text",
      "met": boolean,
      "score": number (0-100),
      "comment": "string — brief explanation"
    }
  ],
  "reasoning": "string — 2-3 sentence overall assessment explaining the decision"
}`;

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 1000,
  });

  const review = JSON.parse(res.choices[0].message.content);

  return {
    approved: review.approved ?? false,
    overallScore: review.overallScore ?? 0,
    rubric: review.rubric || [],
    reasoning: review.reasoning || 'No reasoning provided.',
    model: 'gpt-4o-mini',
    tokensUsed: res.usage?.total_tokens || 0,
  };
}

// ============ Arbitrator Agent ============

/**
 * Analyze a dispute and recommend a ruling with detailed rationale.
 * @param {Object} taskSpec
 * @param {Object} deliverable - { title, body }
 * @param {Object} context - { disputeReason, disputeOpenedBy }
 * @returns {Object} { ruling, confidence, analysis, rationale, model }
 */
async function arbitratorAnalyze(taskSpec, deliverable, context = {}) {
  const client = getClient();

  const systemPrompt = `You are an impartial arbitrator in a decentralized escrow system.
You resolve disputes between buyers and sellers by analyzing evidence objectively.
You must produce a detailed, defensible rationale — your report is stored immutably on Filecoin.

Principles:
- A seller should be paid if the deliverable substantially meets requirements, even if imperfect.
- A buyer deserves a refund if the deliverable clearly fails to meet core requirements.
- Give the benefit of the doubt to whichever party has stronger evidence.
- Be specific about which requirements were met or missed.`;

  const wordCount = (deliverable.body || '').split(/\s+/).filter(Boolean).length;

  const userPrompt = `DISPUTE CONTEXT:
Opened by: ${context.disputeOpenedBy || 'Buyer'}
Reason: ${context.disputeReason || 'Quality issue'}

TASK SPECIFICATION:
Title: ${taskSpec.title}
Description: ${taskSpec.description}
Requirements:
${(taskSpec.requirements || []).map((r, i) => `  ${i + 1}. ${r}`).join('\n')}

DELIVERABLE SUBMITTED:
Title: ${deliverable.title || 'N/A'}
Word Count: ${wordCount}
Body:
---
${(deliverable.body || '').slice(0, 4000)}
---

Analyze this dispute. Return ONLY a JSON object:
{
  "ruling": "REFUND_BUYER" or "PAY_SELLER",
  "confidence": number (0-100),
  "requirementAnalysis": [
    {
      "requirement": "string",
      "met": boolean,
      "evidence": "string — specific evidence from the deliverable"
    }
  ],
  "rationale": "string — 3-5 sentence detailed justification for the ruling, suitable for permanent record",
  "mitigatingFactors": "string — any factors that could argue for the other side"
}`;

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 1500,
  });

  const analysis = JSON.parse(res.choices[0].message.content);

  const requirementsMet = (analysis.requirementAnalysis || []).filter(r => r.met).length;
  const requirementsTotal = (analysis.requirementAnalysis || []).length;

  return {
    ruling: analysis.ruling || 'REFUND_BUYER',
    confidence: analysis.confidence ?? 50,
    requirementAnalysis: analysis.requirementAnalysis || [],
    requirementsMet,
    requirementsTotal,
    rationale: analysis.rationale || 'Insufficient evidence to make determination.',
    mitigatingFactors: analysis.mitigatingFactors || 'None identified.',
    model: 'gpt-4o-mini',
    tokensUsed: res.usage?.total_tokens || 0,
  };
}

// ============ Exports ============

module.exports = {
  sellerGenerate,
  buyerReview,
  arbitratorAnalyze,
};
