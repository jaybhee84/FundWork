const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',Object.fromEntries(['load','save','pick','export','backup','restore'].map(k=>[k,(arg)=>ipcRenderer.invoke(k,arg)])));
