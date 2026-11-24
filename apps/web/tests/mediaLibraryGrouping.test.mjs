import test from 'node:test'
import assert from 'node:assert/strict'
import { groupLibraryMedia, resolveLibrarySelection } from '../src/admin/mediaLibraryGrouping.ts'

const original = { id: 'original', checksum: 'source' }
const copy = { id: 'tv', checksum: 'converted' }
const image = { id: 'image', checksum: 'image' }
const completed = { mediaId: original.id, sourceChecksum: original.checksum, resultMediaId: copy.id, status: 'Completed' }

test('automatic replacement remains visible and selected under its original identity', () => {
  const optimized = { ...original, checksum: 'optimized' }
  const job = { ...completed, resultMediaId: original.id, replaceOriginal: true, resultChecksum: optimized.checksum }
  for (const asset of [original, optimized]) {
    const library = groupLibraryMedia([asset, image], [job])
    assert.deepEqual(library.items, [asset, image])
    assert.equal(library.originalByCopy.size, 0)
    assert.deepEqual(resolveLibrarySelection([original.id], library), [original.id])
  }
})

test('only a completed TV copy of the current original hides the original', () => {
  const media = [original, image, copy]
  const library = groupLibraryMedia(media, [completed])
  assert.deepEqual(library.items, [image, copy])
  assert.equal(library.originalByCopy.get(copy.id), original)
  assert.equal(library.mediaById.get(original.id), original)
  assert.deepEqual(media, [original, image, copy])
  for (const status of ['Queued', 'Processing', 'Failed', 'NoSaving', 'Deleted']) {
    const unfinished = groupLibraryMedia(media, [{ ...completed, status }])
    assert.deepEqual(unfinished.items, media)
    assert.equal(unfinished.originalByCopy.size, 0)
  }
})

test('missing copies and replaced originals remain accessible', () => {
  assert.deepEqual(groupLibraryMedia([original, image], [completed]).items, [original, image])
  const replacement = { ...original, checksum: 'new-video' }
  const independent = groupLibraryMedia([replacement, copy], [completed])
  assert.deepEqual(independent.items, [replacement, copy])
  assert.equal(independent.originalByCopy.size, 0)
  assert.deepEqual(groupLibraryMedia([copy], [completed]).items, [copy])
})

test('selection follows the TV version once ready, preserves order and removes duplicates', () => {
  const media = [original, image, copy]
  const pending = groupLibraryMedia(media, [{ ...completed, status: 'Processing' }])
  assert.deepEqual(resolveLibrarySelection([original.id, image.id], pending), [original.id, image.id])
  const ready = groupLibraryMedia(media, [completed])
  assert.deepEqual(resolveLibrarySelection([original.id, image.id, copy.id, 'deleted'], ready), [copy.id, image.id])
})
