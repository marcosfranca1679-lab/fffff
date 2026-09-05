const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 600,
    title: '5DAY MC',
    backgroundColor: '#0f0f23',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // ── Permissões de microfone/câmera para WebRTC ──────────────────────────────
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const permitidas = ['media', 'microphone', 'audioCapture', 'geolocation'];
    callback(permitidas.includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const permitidas = ['media', 'microphone', 'audioCapture'];
    return permitidas.includes(permission);
  });

  // ── Carrega o site ──────────────────────────────────────────────────────────
  mainWindow.loadURL('https://fffff-autoforge.vercel.app');

  // Mostra a janela só quando terminar de carregar (sem flash branco)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Mantém o título fixo
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
  });

  // Abre links externos no navegador padrão
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('https://fffff-autoforge.vercel.app')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
