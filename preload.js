const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',{...Object.fromEntries(['load','save','pick','export','backup','restore'].map(k=>[k,(arg)=>ipcRenderer.invoke(k,arg)])),
  coaRequest:arg=>ipcRenderer.invoke('coa-request',arg),
  coaAccessStore:request=>{const result=ipcRenderer.sendSync('coa-access-store',request);if(result.error)throw Error(result.error);return result.value},
  // COA Submissions
  coaReadSheets:arg=>ipcRenderer.invoke('coa-read-sheets',arg),coaDesktop:()=>ipcRenderer.invoke('coa-desktop-get'),coaSetDesktop:arg=>ipcRenderer.invoke('coa-desktop-set',arg),coaReminder:arg=>ipcRenderer.invoke('coa-reminder',arg),onCoaOpen:cb=>{ipcRenderer.on('coa-open',()=>cb())},
  // Superadmin password (checked and stored in the main process)
  adminLogin:pw=>ipcRenderer.invoke('admin-login',pw),adminChange:arg=>ipcRenderer.invoke('admin-change',arg),
  // Supabase connection settings
  backendGet:()=>ipcRenderer.invoke('backend-get'),backendSet:arg=>ipcRenderer.invoke('backend-set',arg),backendTest:arg=>ipcRenderer.invoke('backend-test',arg),backendSqlFiles:()=>ipcRenderer.invoke('backend-sql-files'),backendCopySql:name=>ipcRenderer.invoke('backend-copy-sql',name)});
