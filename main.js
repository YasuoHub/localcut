import { app as s, protocol as C, BrowserWindow as c, session as y, Menu as f, ipcMain as b, dialog as w } from "electron";
import r from "node:path";
import P from "node:fs";
import { fileURLToPath as O } from "node:url";
const x = O(import.meta.url), d = r.dirname(x), u = !s.isPackaged;
let g = null;
function F(t) {
  const e = r.extname(t).toLowerCase(), l = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  }, a = P.readFileSync(t);
  return {
    name: r.basename(t),
    dataUrl: `data:${l[e] || "application/octet-stream"};base64,${a.toString("base64")}`
  };
}
function p(...t) {
  return u ? r.join(d, "..", ...t) : r.join(process.resourcesPath, ...t);
}
function h() {
  const t = new c({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "LocalCut Pro",
    icon: r.join(d, "icon.png"),
    webPreferences: {
      // .cjs 强制 CommonJS，因为 package.json "type": "module" 会影响 .js
      preload: u ? r.join(d, "..", "electron", "preload.cjs") : r.join(d, "preload.cjs"),
      contextIsolation: !0,
      nodeIntegration: !1,
      // sandbox: false 允许 preload 使用 ESM import（对桌面 App 风险可控，
      // 因为 preload 仅通过 contextBridge 暴露少量安全 API）
      sandbox: !1,
      webSecurity: !0,
      webAssembly: !0
    },
    show: !1,
    backgroundColor: "#1a1a2e"
  });
  return g = t, t.on("closed", () => {
    g === t && (g = null);
  }), t.once("ready-to-show", () => {
    t.show();
  }), u ? (t.loadURL("http://localhost:5173"), t.webContents.openDevTools({ mode: "detach" })) : t.loadFile(r.join(d, "renderer", "electron", "index.html")), t;
}
function v() {
  C.handle("localcut", (t) => {
    const e = new URL(t.url), l = e.hostname || e.pathname.split("/")[1], a = e.hostname ? e.pathname.slice(1) : e.pathname.split("/").slice(2).join("/");
    if (!a || a.includes("..") || r.isAbsolute(a))
      return new Response("Not Found", { status: 404 });
    let o;
    if (l === "models")
      o = u ? p("public", "models", a) : p("models", a);
    else if (l === "wasm")
      o = u ? p("node_modules", "onnxruntime-web", "dist", a) : p("wasm", a);
    else
      return new Response("Not Found", { status: 404 });
    try {
      const n = P.readFileSync(o), i = r.extname(o).toLowerCase(), m = {
        ".onnx": "application/octet-stream",
        ".wasm": "application/wasm",
        ".mjs": "application/javascript",
        ".cjs": "application/javascript",
        ".js": "application/javascript",
        ".json": "application/json"
      };
      return new Response(n, {
        status: 200,
        headers: {
          "Content-Type": m[i] || "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Resource-Policy": "cross-origin",
          "Cache-Control": "public, max-age=86400"
        }
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  });
}
function I() {
  y.defaultSession.webRequest.onHeadersReceived((t, e) => {
    e({
      responseHeaders: {
        ...t.responseHeaders,
        "Cross-Origin-Opener-Policy": ["same-origin"],
        "Cross-Origin-Embedder-Policy": ["require-corp"],
        "Cross-Origin-Resource-Policy": ["cross-origin"]
      }
    });
  });
}
function _() {
  function t(o) {
    return o ?? c.getFocusedWindow() ?? g ?? c.getAllWindows().find((n) => !n.isDestroyed()) ?? null;
  }
  function e(o, n) {
    const i = t(o);
    i == null || i.webContents.send("menu-command", n);
  }
  const l = [
    {
      label: "文件",
      submenu: [
        {
          label: "导入图片",
          accelerator: "CmdOrCtrl+O",
          click: (o, n) => {
            const i = t(n);
            i && w.showOpenDialog(i, {
              properties: ["openFile", "multiSelections"],
              filters: [
                { name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }
              ]
            }).then((m) => {
              if (!m.canceled && m.filePaths.length > 0) {
                const j = m.filePaths.map(F);
                i.webContents.send("open-files", j);
              }
            });
          }
        },
        { type: "separator" },
        {
          label: "退出",
          accelerator: "CmdOrCtrl+Q",
          click: () => s.quit()
        }
      ]
    },
    {
      label: "编辑",
      submenu: [
        {
          label: "撤销",
          accelerator: "CmdOrCtrl+Z",
          click: (o, n) => e(n, "undo")
        },
        {
          label: "重做",
          accelerator: "CmdOrCtrl+Y",
          click: (o, n) => e(n, "redo")
        },
        { type: "separator" },
        {
          label: "剪切",
          accelerator: "CmdOrCtrl+X",
          click: (o, n) => e(n, "cut")
        },
        {
          label: "复制",
          accelerator: "CmdOrCtrl+C",
          click: (o, n) => e(n, "copy")
        },
        {
          label: "粘贴",
          accelerator: "CmdOrCtrl+V",
          click: (o, n) => e(n, "paste")
        },
        {
          label: "全选",
          accelerator: "CmdOrCtrl+A",
          click: (o, n) => e(n, "select-all")
        }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "放大", accelerator: "CmdOrCtrl+=", role: "zoomIn" },
        { label: "缩小", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { label: "重置缩放", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { type: "separator" },
        { label: "开发者工具", accelerator: "F12", role: "toggleDevTools" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于 LocalCut Pro",
          click: () => {
            w.showMessageBox({
              title: "关于 LocalCut Pro",
              message: "LocalCut Pro v1.0.0",
              detail: `本地图片素材切割工作台
支持 AI 智能抠图与超分辨率
 联系方式: leox520@163.com `
            });
          }
        }
      ]
    }
  ], a = f.buildFromTemplate(l);
  f.setApplicationMenu(a);
}
function R() {
  b.handle("open-file-dialog", async (t, e) => {
    const l = c.getFocusedWindow();
    if (!l) return null;
    const a = await w.showOpenDialog(l, {
      properties: e != null && e.multi ? ["openFile", "multiSelections"] : ["openFile"],
      filters: (e == null ? void 0 : e.filters) || [
        { name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp"] }
      ]
    });
    return a.canceled ? null : a.filePaths;
  }), b.handle("save-file-dialog", async (t, e) => {
    const l = c.getFocusedWindow();
    if (!l) return null;
    const a = await w.showSaveDialog(l, {
      defaultPath: e == null ? void 0 : e.defaultPath,
      filters: (e == null ? void 0 : e.filters) || [
        { name: "ZIP 压缩包", extensions: ["zip"] },
        { name: "PNG 图片", extensions: ["png"] },
        { name: "JPEG 图片", extensions: ["jpg", "jpeg"] },
        { name: "WebP 图片", extensions: ["webp"] }
      ]
    });
    return a.canceled ? null : a.filePath;
  }), b.handle("get-user-data-path", () => s.getPath("userData"));
}
s.commandLine.appendSwitch("remote-debugging-port", "0");
s.commandLine.appendSwitch("enable-unsafe-webgpu");
s.commandLine.appendSwitch("ignore-gpu-blocklist");
C.registerSchemesAsPrivileged([
  {
    scheme: "localcut",
    privileges: {
      standard: !0,
      secure: !0,
      supportFetchAPI: !0,
      corsEnabled: !0,
      stream: !0
    }
  }
]);
s.whenReady().then(() => {
  u && console.log("GPU feature status:", s.getGPUFeatureStatus()), v(), I(), _(), R(), h(), s.on("activate", () => {
    c.getAllWindows().length === 0 && h();
  });
});
s.on("window-all-closed", () => {
  process.platform !== "darwin" && s.quit();
});
