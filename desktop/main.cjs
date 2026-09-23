const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  dialog,
  safeStorage,
  clipboard,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const crypto = require("node:crypto");
const { operations, validPayload } = require("./operations.cjs");
const { installerAction } = require("./installer.cjs");
const installAction =
  process.platform === "win32"
    ? installerAction(process.argv, process.execPath)
    : null;
if (installAction) {
  if (installAction.executable) {
    const updater = spawn(installAction.executable, installAction.args, {
      windowsHide: true,
    });
    updater.once("close", () => app.quit());
    updater.once("error", () => app.quit());
    setTimeout(() => app.quit(), 10000);
  } else app.quit();
  return;
}
const ROOT = path.resolve(__dirname, "..");
if (process.env.ZHISHI_PROFILE)
  app.setPath("userData", path.resolve(process.env.ZHISHI_PROFILE));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "zhishi-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
let window,
  engine,
  port,
  quitting = false,
  engineError = "",
  library,
  provider = {};
const token = crypto.randomBytes(32).toString("hex");
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const keyPath = () => path.join(app.getPath("userData"), "credential.bin");
async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}
async function saveSettings(value) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const temp = settingsPath() + ".tmp";
  await fs.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.rename(temp, settingsPath());
}
async function request(route, method = "GET", body) {
  if (!port) throw Error("引擎未就绪：" + engineError);
  const response = await fetch(`http://127.0.0.1:${port}/api/v1${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({
    message: `本地服务返回异常（HTTP ${response.status}），请检查任务或重启应用。`,
  }));
  if (!response.ok)
    throw Error(
      result.message ||
        result.detail?.[0]?.msg ||
        `请求失败 ${response.status}`,
    );
  return result;
}
async function startEngine() {
  const saved = await readSettings();
  library =
    process.env.ZHISHI_LIBRARY ||
    saved.library ||
    path.join(app.getPath("userData"), "library");
  provider = saved.provider || {};
  try {
    if (safeStorage.isEncryptionAvailable())
      provider.key = safeStorage.decryptString(await fs.readFile(keyPath()));
  } catch {}
  const exe = app.isPackaged
    ? path.join(process.resourcesPath, "engine", "zhishi-engine.exe")
    : path.join(ROOT, ".venv", "Scripts", "python.exe");
  const args = app.isPackaged ? [] : ["-m", "app"];
  engine = spawn(exe, args, {
    cwd: app.isPackaged ? path.dirname(exe) : ROOT,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONUTF8: "1" },
  });
  engine.stderr.on("data", (chunk) => {
    engineError = (engineError + chunk.toString()).slice(-2500);
    if (process.env.ZHISHI_TEST_DEBUG) process.stderr.write(chunk);
  });
  engine.on("exit", () => {
    port = null;
    if (!quitting && window && !window.isDestroyed())
      window.webContents.send("engine-status", {
        ready: false,
        message: "本地引擎已停止，请重新打开应用。",
      });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("引擎启动超时：" + engineError)),
      30000,
    );
    let buffer = "";
    engine.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    engine.once("exit", () => {
      clearTimeout(timer);
      reject(Error("引擎启动失败：" + engineError));
    });
    engine.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const line = buffer.split("\n")[0];
      try {
        const ready = JSON.parse(line);
        if (ready.event === "ready" && ready.api_version === 1) {
          port = ready.port;
          clearTimeout(timer);
          resolve();
        }
      } catch {}
    });
    engine.stdin.write(
      JSON.stringify({
        token,
        library,
        provider: Object.keys(provider).length ? provider : undefined,
      }) + "\n",
    );
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await request("/health");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw Error("本地引擎握手失败");
}
function trusted(event) {
  return (
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url.startsWith("app://bundle/")
  );
}
function id(value) {
  if (typeof value !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value))
    throw Error("无效文献标识");
  return value;
}
async function chooseImport() {
  const selected = await dialog.showOpenDialog(window, {
    title: "收录文献",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "文献与图片",
        extensions: [
          "pdf",
          "docx",
          "xlsx",
          "txt",
          "md",
          "png",
          "jpg",
          "jpeg",
          "webp",
          "doc",
          "xls",
        ],
      },
    ],
  });
  const results = [];
  for (const file of selected.filePaths) {
    const stat = await fs.stat(file);
    if (stat.size > 100 * 1024 * 1024)
      throw Error("文件超过 100 MB：" + path.basename(file));
    const form = new FormData();
    form.set("file", new Blob([await fs.readFile(file)]), path.basename(file));
    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/ingest/file`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );
    const data = await response.json();
    if (!response.ok) throw Error(data.message || "文件收录失败");
    results.push(data);
  }
  return results;
}
async function custom(name, payload) {
  if (name === "copyText") {
    if (typeof payload.text !== "string" || payload.text.length > 100000)
      throw Error("复制内容无效");
    clipboard.writeText(payload.text);
    return { copied: true };
  }
  if (name === "importFiles") return chooseImport();
  if (name === "saveProvider") {
    const previous = await readSettings();
    if (
      provider.key &&
      !payload.key &&
      new URL(payload.base_url).hostname !== new URL(provider.base_url).hostname
    )
      throw Error(
        "更换服务平台后请重新填写对应的 API Key；不会把旧平台 Key 发送到新地址。",
      );
    const key = payload.key || provider.key || "";
    if (key && !safeStorage.isEncryptionAvailable())
      throw Error("系统凭据加密不可用，未保存 API Key");
    const result = await request("/provider", "POST", { ...payload, key });
    if (key) {
      await fs.mkdir(app.getPath("userData"), { recursive: true });
      await fs.writeFile(keyPath(), safeStorage.encryptString(key));
    }
    provider = { ...payload, key };
    const publicConfig = { ...provider };
    delete publicConfig.key;
    await saveSettings({ ...previous, provider: publicConfig });
    return result;
  }
  if (name === "clearProvider") {
    const saved = await readSettings();
    provider = {
      base_url: "https://api.openai.com/v1",
      model: "",
      key: "",
      enabled: false,
    };
    await request("/provider", "POST", provider);
    await fs.rm(keyPath(), { force: true });
    delete saved.provider;
    await saveSettings(saved);
    return { has_key: false };
  }
  if (name === "exportLibrary") {
    const save = await dialog.showSaveDialog(window, {
      title: "导出资料库备份",
      defaultPath: "知拾资料库.zip",
      filters: [{ name: "知拾备份", extensions: ["zip"] }],
    });
    if (save.canceled) return { cancelled: true };
    const backup = await request("/exports", "POST", {});
    await fs.copyFile(backup.path, save.filePath);
    return { path: save.filePath };
  }
  if (name === "restoreLibrary") {
    const chosen = await dialog.showOpenDialog(window, {
      title: "选择知拾备份",
      properties: ["openFile"],
      filters: [{ name: "备份", extensions: ["zip"] }],
    });
    if (chosen.canceled) return { cancelled: true };
    await request("/imports/validate", "POST", { path: chosen.filePaths[0] });
    const folder = await dialog.showOpenDialog(window, {
      title: "选择恢复父目录，将新建独立资料库",
      properties: ["openDirectory", "createDirectory"],
    });
    if (folder.canceled) return { cancelled: true };
    const destination = path.join(
      folder.filePaths[0],
      "知拾恢复-" + Date.now(),
    );
    await request("/imports/restore", "POST", {
      path: chosen.filePaths[0],
      destination,
    });
    const saved = await readSettings();
    await saveSettings({ ...saved, library: destination });
    return { path: destination, restart: true };
  }
  if (name === "chooseLibrary") {
    const choice = await dialog.showOpenDialog(window, {
      title: "选择独立资料库目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (choice.canceled) return { cancelled: true };
    const selected = choice.filePaths[0];
    const entries = await fs.readdir(selected);
    if (entries.length && !entries.includes("library.json"))
      throw Error("请选择空目录或已有知拾资料库");
    const saved = await readSettings();
    await saveSettings({ ...saved, library: selected });
    return { path: selected, restart: true };
  }
  if (name === "saveOriginal") {
    const source = await request("/sources/" + id(payload.id));
    const save = await dialog.showSaveDialog(window, {
      defaultPath: source.filename,
    });
    if (save.canceled) return { cancelled: true };
    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/sources/${source.id}/original`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw Error("原件不可读取");
    await fs.writeFile(
      save.filePath,
      Buffer.from(await response.arrayBuffer()),
    );
    return { path: save.filePath };
  }
  throw Error("未知操作");
}
function installBridge() {
  for (const [name, map] of Object.entries(operations)) {
    ipcMain.handle(name, async (event, payload = {}) => {
      if (!trusted(event) || !validPayload(payload))
        throw Error("拒绝不可信的桌面请求");
      if (map.custom) return custom(name, payload);
      let route = map.path;
      if (route.includes(":id")) route = route.replace(":id", id(payload.id));
      if (map.query) {
        const query = new URLSearchParams();
        for (const key of map.query)
          if (payload[key] !== undefined) query.set(key, String(payload[key]));
        route += "?" + query;
      }
      const body = { ...payload };
      if (map.path.includes(":id")) delete body.id;
      return request(
        route,
        map.method,
        map.method === "GET" ? undefined : body,
      );
    });
  }
}
async function serveProtocols() {
  protocol.handle("app", async (req) => {
    const url = new URL(req.url);
    if (url.host !== "bundle")
      return new Response("Not found", { status: 404 });
    const root = path.join(ROOT, "dist");
    const target = path.resolve(
      root,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!target.startsWith(root + path.sep))
      return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(target).href);
  });
  protocol.handle("zhishi-asset", async (req) => {
    const url = new URL(req.url);
    if (
      url.host !== "source" ||
      !/^\/[0-9A-HJKMNP-TV-Z]{26}\/(original|assets\/\d+\/image-\d+\.(png|jpg|webp|gif))$/.test(
        url.pathname,
      )
    )
      return new Response("Forbidden", { status: 403 });
    if (req.initiatorOrigin && req.initiatorOrigin !== "app://bundle")
      return new Response("Forbidden", { status: 403 });
    const headers = { Authorization: `Bearer ${token}` };
    if (req.headers.get("range")) headers.Range = req.headers.get("range");
    const result = await fetch(
      `http://127.0.0.1:${port}/api/v1/sources${url.pathname}`,
      { headers },
    );
    const outgoing = new Headers(result.headers);
    outgoing.set("Access-Control-Allow-Origin", "app://bundle");
    return new Response(result.body, {
      status: result.status,
      headers: outgoing,
    });
  });
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    try {
      await serveProtocols();
      window = new BrowserWindow({
        width: 1500,
        height: 960,
        minWidth: 1060,
        minHeight: 720,
        backgroundColor: "#ffffff",
        show: false,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.once("ready-to-show", () => window.show());
      await window.loadFile(path.join(__dirname, "startup.html"));
      await startEngine();
      installBridge();
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith("app://bundle/")) event.preventDefault();
      });
      window.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      await window.loadURL("app://bundle/index.html");
    } catch (error) {
      dialog.showErrorBox("知拾启动失败", error.message);
      app.quit();
    }
  });
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting || !engine) return;
  event.preventDefault();
  quitting = true;
  engine.stdin.write("shutdown\n");
  engine.stdin.end();
  const timer = setTimeout(() => {
    engine.kill();
    app.exit();
  }, 8000);
  engine.once("exit", () => {
    clearTimeout(timer);
    app.exit();
  });
});
