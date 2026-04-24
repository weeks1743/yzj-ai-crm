import assert from 'node:assert/strict';
import test from 'node:test';
import { VolcWebSearchClient } from '../src/volc-web-search-client.js';

test('VolcWebSearchClient normalizes summary and citations', async () => {
  const client = new VolcWebSearchClient({
    baseUrl: 'https://ark.example/api/v3',
    apiKey: 'test-key',
    model: 'doubao-seed-1-6-250615',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Acme launched a new AI product.',
                  annotations: [
                    {
                      type: 'url_citation',
                      title: 'Acme Blog',
                      url: 'https://example.com/acme-blog',
                    },
                  ],
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
  });

  const result = await client.search('acme ai');
  assert.equal(result.provider, 'ark-web-search');
  assert.equal(result.query, 'acme ai');
  assert.equal(result.summary, 'Acme launched a new AI product.');
  assert.deepEqual(result.results, [
    {
      title: 'Acme Blog',
      url: 'https://example.com/acme-blog',
      snippet: 'Acme launched a new AI product.',
    },
  ]);
});
