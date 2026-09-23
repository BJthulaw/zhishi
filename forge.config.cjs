const path = require("node:path");
module.exports = {
  packagerConfig: {
    asar: true,
    ...(process.env.ZHISHI_ELECTRON_ZIP_DIR
      ? { electronZipDir: process.env.ZHISHI_ELECTRON_ZIP_DIR }
      : {}),
    executableName: "Zhishi",
    extraResource: [path.resolve("engine-dist/engine")],
    ignore: (file) =>
      Boolean(file) &&
      file !== "/package.json" &&
      !/^\/(desktop|dist)(\/|$)/.test(file),
  },
  makers: [
    { name: "@electron-forge/maker-zip", platforms: ["win32"] },
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "Zhishi",
        authors: "liuyun",
        description: "知拾文献阅读与笔记工作台",
        setupExe: "ZhishiSetup.exe",
        loadingGif: path.resolve("desktop/assets/installing.gif"),
      },
    },
  ],
};
