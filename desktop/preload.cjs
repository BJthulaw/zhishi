const { contextBridge, ipcRenderer } = require("electron");
const names = [
  "copyText",
  "saveHighlights",
  "deleteSource",
  "confirmOCR",
  "testProvider",
  "health",
  "listTopics",
  "listSources",
  "getSource",
  "ingestText",
  "ingestURL",
  "updateMetadata",
  "updateTopics",
  "undoTopics",
  "updateSummary",
  "supplementText",
  "analyze",
  "citation",
  "listNotes",
  "saveNote",
  "search",
  "answer",
  "listAnswers",
  "listJobs",
  "cancelJob",
  "retryJob",
  "getProvider",
  "usage",
  "importFiles",
  "saveProvider",
  "clearProvider",
  "exportLibrary",
  "restoreLibrary",
  "chooseLibrary",
  "saveOriginal",
];
const api = Object.fromEntries(
  names.map((name) => [
    name,
    (payload = {}) => ipcRenderer.invoke(name, payload),
  ]),
);
api.onEngineStatus = (callback) => {
  const listener = (_event, status) => callback(status);
  ipcRenderer.on("engine-status", listener);
  return () => ipcRenderer.removeListener("engine-status", listener);
};
contextBridge.exposeInMainWorld("zhishi", api);
