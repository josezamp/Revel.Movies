import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWebPage, webPageUrlError } from '../src/webpages/webPage.ts'

test('normalizes public URLs and preserves the independent page query and hash', () => {
  assert.deepEqual(parseWebPage({ url: ' https://contest.example/live?a=1#wall ' }, 'https://revel.example/player'), { url: 'https://contest.example/live?a=1#wall' })
  assert.deepEqual(parseWebPage({ url: 'http://localhost:5190/live' }, 'http://localhost:5173/player'), { url: 'http://localhost:5190/live' })
})

test('rejects malformed, credentialed, active-content, mixed-content and same-origin pages', () => {
  for (const url of ['', '/relative', 'javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/a', 'https://a:b@contest.example', 'https://revel.example/admin', 'http://contest.example', 'https://exa\nmple.com', 'https://contest.example/\\evil', 'https://contest.example/' + 'x'.repeat(2048)]) {
    assert.ok(webPageUrlError(url, 'https://revel.example/player'), url)
    assert.equal(parseWebPage({ url }, 'https://revel.example/player'), null, url)
  }
  for (const payload of [null, [], {}, { url: 3 }]) assert.equal(parseWebPage(payload, 'https://revel.example'), null)
})
