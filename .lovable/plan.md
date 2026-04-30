I found the actual issue: the PDF is not “still reading the whole book”; it processed chapters 1, 2, 3, and 5, but chapter 4 is stuck in `extracting` with 0 principles, so the item never flips to `ready`. The “5 chapters” label means the current chapter detector only found 5 usable sections in the extracted PDF text, not necessarily every printed chapter in the original book.

Plan:

1. Fix the stuck-state logic
- Treat an `extracting` chapter as stale if it has been sitting too long with no new principles.
- Automatically retry stale extracting chapters instead of letting the card spin forever.
- Add a per-chapter timestamp/error field in `book_brief` updates so the UI can tell “actively working” vs “stuck/retrying”.

2. Make chapter 4 recover safely
- Update `retry-book-chapter` so retrying one chapter does not wait for the long main function response.
- It should reset only that chapter to `pending`/`extracting`, invoke `process-knowledge` in continuation mode, and return immediately.
- This prevents the retry button from hanging and prevents the whole PDF card from staying locked in loading.

3. Fix the chained invocation reliability
- Change `scheduleContinue` to use Edge runtime background scheduling correctly so the next invocation is actually registered before the current invocation exits.
- Add a small processing lock/attempt marker inside `book_brief` so duplicate continuations don’t process the wrong chapter out of order.

4. Improve chapter detection wording
- Change the UI copy from “Reading chapter 4 of 5” to something clearer like “Processing section 4 of 5 detected sections”.
- Add helper text explaining that sections are based on the extracted PDF text and may not equal the printed book’s chapter count.

5. Add a Resume PDF button for stuck books
- For PDFs in `extracting` with no progress for a while, show “Resume processing” on the card.
- That button will invoke `process-knowledge` with `continueBook: true` for the existing item, instead of remapping the whole PDF.

6. After implementation, repair this current item
- Trigger/resume the existing “The Psychology of Persuasion” item so chapter 4 gets retried.
- Verify in the database that chapter 4 changes from `extracting` to either `done` with principles or `failed` with a visible error, and that the overall PDF becomes `ready` once no chapters are pending.