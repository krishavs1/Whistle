/**
 * Whistle — OpenAI helpers for seller / buyer / arbitrator (advisory only for disputes).
 * Requires OPENAI_API_KEY. Never commit keys; use .env only.
 */

require('dotenv').config();

const { z } = require('zod');

const SellerDeliverableSchema = z.object({
  content: z.unknown(),
  notes: z.string().optional(),
});

const BuyerReviewSchema = z.object({
  accepted: z.boolean(),
  reason: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  requirement_results: z
    .array(
      z.object({
        requirement: z.string(),
        met: z.boolean(),
        note: z.string().optional(),
      })
    )
    .optional(),
});

const ArbitratorAssistSchema = z.object({
  recommended_ruling: z.union([z.literal(0), z.literal(1)]),
  summary: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  reasons: z.array(z.string()).optional(),
});

/**
 * @returns {boolean}
 */
function isLlmConfigured() {
  const key = process.env.OPENAI_API_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}

/**
 * @returns {boolean}
 */
function useLlmSeller() {
  return isLlmConfigured() && process.env.USE_LLM_SELLER !== 'false';
}

/**
 * @returns {boolean}
 */
function useLlmBuyer() {
  return isLlmConfigured() && process.env.USE_LLM_BUYER !== 'false';
}

/**
 * @returns {boolean}
 */
function useLlmArbitratorAssist() {
  return isLlmConfigured() && process.env.USE_LLM_ARBITRATOR_ASSIST !== 'false';
}

/**
 * @returns {string}
 */
function getModel() {
  return process.env.OPENAI_MODEL || 'gpt-4o';
}

/**
 * @returns {import('openai').default}
 */
function getClient() {
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * @param {string} text
 * @returns {string}
 */
function extractJsonObject(text) {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    return fence[1].trim();
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

/**
 * @param {Array<{ role: string, content: string }>} messages
 * @param {number} maxTokens
 * @returns {Promise<string>}
 */
async function chatJson(messages, maxTokens) {
  const openai = getClient();
  const model = getModel();
  const completion = await openai.chat.completions.create({
    model,
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: maxTokens,
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error('OpenAI returned empty content');
  }
  return extractJsonObject(raw);
}

/**
 * @param {object} taskSpec
 * @param {string} taskId
 * @param {string} sellerAddress
 * @returns {Promise<{ content: unknown, notes?: string }>}
 */
async function generateSellerDeliverable(taskSpec, taskId, sellerAddress) {
  const system = `You are the seller agent for Whistle, an escrow task marketplace. All tasks and outputs are in English only.
Return a single JSON object with keys:
- "content" (object): structured work product that satisfies the task (use fields that fit the task, e.g. type, title, body, code, etc.).
- "notes" (optional string): brief seller notes.
Do not include markdown outside JSON. The deliverable must honestly attempt to meet every stated requirement.`;

  const user = JSON.stringify(
    {
      taskId,
      sellerAddress,
      taskSpec: {
        title: taskSpec.title,
        description: taskSpec.description,
        requirements: taskSpec.requirements,
        deliverableFormat: taskSpec.deliverableFormat,
      },
    },
    null,
    2
  );

  const jsonStr = await chatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    4096
  );

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Seller LLM JSON parse failed: ${e.message}`);
  }

  const out = SellerDeliverableSchema.safeParse(parsed);
  if (!out.success) {
    throw new Error(`Seller LLM schema mismatch: ${out.error.message}`);
  }

  return out.data;
}

/**
 * @param {object} taskSpec
 * @param {object} deliverable
 * @returns {Promise<{ accepted: boolean, reason: string, confidence?: number, requirement_results?: object[] }>}
 */
async function evaluateBuyerDeliverable(taskSpec, deliverable) {
  const system = `You are the buyer agent for Whistle. All content is English.
You must decide if the seller's deliverable satisfies the task specification.
Return JSON only with keys:
- "accepted" (boolean)
- "reason" (string, concise)
- "confidence" (number 0-1, optional)
- "requirement_results" (optional array of { "requirement": string, "met": boolean, "note": string optional })
Be fair: approve only if requirements are substantially met.`;

  const user = JSON.stringify(
    {
      taskSpec: {
        title: taskSpec.title,
        description: taskSpec.description,
        requirements: taskSpec.requirements,
        taskId: taskSpec.taskId,
      },
      deliverable,
    },
    null,
    2
  );

  const jsonStr = await chatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    2048
  );

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Buyer LLM JSON parse failed: ${e.message}`);
  }

  const out = BuyerReviewSchema.safeParse(parsed);
  if (!out.success) {
    throw new Error(`Buyer LLM schema mismatch: ${out.error.message}`);
  }

  return out.data;
}

/**
 * @param {object} evidence — same shape as ArbitratorAgent review payload
 * @returns {Promise<{ recommended_ruling: 0|1, summary: string, confidence?: number, reasons?: string[] }>}
 */
async function arbitratorAssist(evidence) {
  const system = `You are assisting a human arbitrator for Whistle escrow disputes. All content is English.
You do NOT execute transactions. You only recommend how a human might rule.
Contract values: recommended_ruling 0 = refund buyer, 1 = pay seller.
Return JSON only with keys:
- "recommended_ruling" (0 or 1)
- "summary" (string): neutral summary for the human
- "confidence" (number 0-1, optional)
- "reasons" (optional array of short strings)`;

  const payload = {
    taskId: evidence.taskId,
    onChainTask: evidence.task,
    taskSpec: evidence.taskSpec,
    deliverable: evidence.deliverable,
    buyerReputation: evidence.buyerReputation,
    sellerReputation: evidence.sellerReputation,
  };

  const user = JSON.stringify(payload, null, 2);

  const jsonStr = await chatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    2048
  );

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Arbitrator LLM JSON parse failed: ${e.message}`);
  }

  const out = ArbitratorAssistSchema.safeParse(parsed);
  if (!out.success) {
    throw new Error(`Arbitrator LLM schema mismatch: ${out.error.message}`);
  }

  return out.data;
}

module.exports = {
  isLlmConfigured,
  useLlmSeller,
  useLlmBuyer,
  useLlmArbitratorAssist,
  getModel,
  generateSellerDeliverable,
  evaluateBuyerDeliverable,
  arbitratorAssist,
};
