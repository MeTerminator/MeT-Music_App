const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, ...args) => ipcRenderer.send(channel, ...args),
        on: (channel, listener) => ipcRenderer.on(channel, listener),
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
    }
});

contextBridge.exposeInMainWorld('electronAPI', {
    sendHookData: (data) => ipcRenderer.send('metmusic-hook', data),
    hideWindow: () => ipcRenderer.send('hide-window'),
    openSettings: () => ipcRenderer.send('open-settings')
});
