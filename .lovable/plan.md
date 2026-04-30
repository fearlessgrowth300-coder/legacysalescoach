I found the PDF is not fully failing — it has already extracted 71 principles — but it is stuck on the long book pipeline at chapter 4 (`status: extracting`). The likely cause is that the whole-book extraction is running as one long background edge task, which can be killed by runtime limits before it reaches the final `ready` update. The UI also only shows detailed progress for `processing`, not `mapping` / `extracting`, so it looks broken even when it partially worked.

Plan:

1. Make PDF book processing resumable instead of one long run
   - Change `process-knowledge` so it can process only one chapter per invocation.
   - After a chapter finishes, update `book_brief.chapters[index].status = done` immediately.
   - Then schedule/trigger the next chapter as a new invocation instead of relying on one background task to survive the entire book.
   - This prevents large PDFs from getting stuck halfway because of function duration limits.

2. Add stalled-chapter recovery
   - Detect chapters left as `extracting` for too long and allow the retry path to resume from that chapter.
   - Make the final status become `ready` when all chapters are done, or `partial_ready`/`error` only when there are real failed chapters.
   - Ensure chapter retry updates both the chapter and parent PDF status consistently.

3. Fix the UI so PDF progress is visible
   - Render `BookBriefCard` not only when the item is `ready`, but also while it is `mapping` or `extracting`.
   - Show chapter-by-chapter progress directly in the knowledge-base list, so the user sees “chapter 4 of 5” instead of just a generic spinner/error icon.
   - Update status icons so `mapping` and `extracting` show as active states, not as failures.

4. Improve error visibility
   - Store a short error message on the failed chapter when extraction fails.
   - Update the Knowledge Base card to show that error and a Retry button for the stuck/failed chapter.
   - Change the generic PDF error copy from “Try a different URL” to PDF-specific guidance.

5. Add safer PDF extraction fallback
   - Keep native text extraction for normal PDFs.
   - If the PDF is scanned or extracts too little text, use the existing OCR fallback, but surface a clear message if OCR is unavailable or gives no text.
   - Avoid pretending an unreadable PDF was processed successfully.

6. Re-run/resume the current stuck PDF
   - Use the existing retry mechanism to resume the current `The Psychology of Persuasion` upload from chapter 4 after the fix.
   - Verify the item reaches `ready` and the extracted principles are visible in the Brain.