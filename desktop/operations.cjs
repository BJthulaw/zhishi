const operations = {
  copyText: { custom: true },
  saveHighlights: { path: "/sources/:id/highlights", method: "PATCH" },
  deleteSource: { path: "/sources/:id", method: "DELETE" },
  confirmOCR: { path: "/sources/:id/ocr/confirm", method: "POST" },
  testProvider: { path: "/provider/test", method: "POST" },
  health: { path: "/health", method: "GET" },
  listTopics: { path: "/topics", method: "GET" },
  listSources: {
    path: "/sources",
    method: "GET",
    query: [
      "query",
      "topic_ids",
      "topic_mode",
      "kind",
      "pending",
      "offset",
      "limit",
    ],
  },
  getSource: { path: "/sources/:id", method: "GET" },
  ingestText: { path: "/ingest/text", method: "POST" },
  ingestURL: { path: "/ingest/url", method: "POST" },
  updateMetadata: { path: "/sources/:id", method: "PATCH" },
  updateTopics: { path: "/sources/:id/topics", method: "PATCH" },
  undoTopics: { path: "/sources/:id/topics/undo", method: "POST" },
  updateSummary: { path: "/sources/:id/summary", method: "PATCH" },
  supplementText: { path: "/sources/:id/text", method: "POST" },
  analyze: { path: "/sources/:id/analyze", method: "POST" },
  citation: { path: "/sources/:id/citation", method: "GET" },
  listNotes: { path: "/notes", method: "GET", query: ["source_id"] },
  saveNote: { path: "/notes", method: "POST" },
  search: { path: "/search", method: "POST" },
  answer: { path: "/answers", method: "POST" },
  listAnswers: { path: "/answers", method: "GET" },
  listJobs: { path: "/jobs", method: "GET" },
  cancelJob: { path: "/jobs/:id/cancel", method: "POST" },
  retryJob: { path: "/jobs/:id/retry", method: "POST" },
  getProvider: { path: "/provider", method: "GET" },
  usage: { path: "/usage", method: "GET" },
  importFiles: { custom: true },
  saveProvider: { custom: true },
  clearProvider: { custom: true },
  exportLibrary: { custom: true },
  restoreLibrary: { custom: true },
  chooseLibrary: { custom: true },
  saveOriginal: { custom: true },
};
function validPayload(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Buffer.byteLength(JSON.stringify(value)) < 3 * 1024 * 1024
  );
}
module.exports = { operations, validPayload };
