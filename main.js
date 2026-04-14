const { app, BrowserWindow, dialog, shell } = require('electron');
const { checkForUpdateOnce } = require('./lib/update-check');

// 1. Encendemos tu servidor backend original en segundo plano
require('./server.js');

let mainWindow;

function scheduleUpdateCheck() {
    setTimeout(function () {
        checkForUpdateOnce(mainWindow, app, dialog, shell).catch(function () {});
    }, 3500);
}

function createWindow() {
    // 2. Configuramos la ventana de tu nueva aplicación
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 768,
        title: "Agencia ELArbol - Panel PRO",
        autoHideMenuBar: true, // Oculta el menú feo de Windows (Archivo, Editar...)
        webPreferences: {
            nodeIntegration: true
        }
    });

    // 3. Le damos 1 segundo al servidor para que arranque y luego cargamos la interfaz
    setTimeout(() => {
        mainWindow.loadURL('http://localhost:3000');
    }, 1000);

    mainWindow.webContents.once('did-finish-load', function () {
        scheduleUpdateCheck();
    });

    // Cuando cierras la ventana, limpiamos la memoria
    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

// Cuando Electron esté listo, abre la ventana
app.whenReady().then(createWindow);

// Apaga el programa completo cuando cierres la ventana (con la "X" roja)
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});