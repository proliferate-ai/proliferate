export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

const MAX_BATCH = 100;
const API_URL = "https://api.openai.com/v1/embeddings";

interface EmbeddingResponse {
	data: Array<{ embedding: number[]; index: number }>;
}

/**
 * Embed a batch of texts using OpenAI text-embedding-3-small.
 * Handles batching if texts exceed MAX_BATCH.
 * Retries once on rate limit (429) after 1s delay.
 */
export async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
	const results: number[][] = new Array(texts.length);

	for (let i = 0; i < texts.length; i += MAX_BATCH) {
		const batch = texts.slice(i, i + MAX_BATCH);
		const embeddings = await fetchEmbeddings(batch, apiKey);
		for (let j = 0; j < embeddings.length; j++) {
			results[i + j] = embeddings[j];
		}
	}

	return results;
}

export async function embedQuery(text: string, apiKey: string): Promise<number[]> {
	const [embedding] = await embedBatch([text], apiKey);
	return embedding;
}

async function fetchEmbeddings(
	texts: string[],
	apiKey: string,
	retried = false,
): Promise<number[][]> {
	const response = await fetch(API_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: EMBEDDING_MODEL,
			input: texts,
			dimensions: EMBEDDING_DIMENSIONS,
		}),
		signal: AbortSignal.timeout(30_000),
	});

	if (response.status === 429 && !retried) {
		await delay(1000);
		return fetchEmbeddings(texts, apiKey, true);
	}

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(
			`OpenAI embeddings API error: ${response.status} ${response.statusText} — ${body}`,
		);
	}

	const json = (await response.json()) as EmbeddingResponse;
	// Sort by index to ensure correct ordering
	const sorted = json.data.sort((a, b) => a.index - b.index);
	return sorted.map((d) => d.embedding);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
