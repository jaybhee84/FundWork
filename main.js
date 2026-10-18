const {app,BrowserWindow,ipcMain,dialog,Notification,Tray,Menu,clipboard,safeStorage}=require('electron');
const fs=require('node:fs'); const path=require('node:path'); const ExcelJS=require('exceljs');
let win; const dbPath=()=>path.join(app.getPath('userData'),'accounts.json');
function read(){try{return JSON.parse(fs.readFileSync(dbPath(),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;return {entries:[],accounts:{},organization:'Your organization',year:Number(new Date(Date.now()+288e5).toISOString().slice(0,4))}}}
function sheetRows(s,limit=Infinity){let rows=[];s.eachRow({includeEmpty:true},row=>{if(rows.length>=limit)return;let a=[];for(let i=1;i<=s.columnCount;i++){let v=row.getCell(i).value;if(v instanceof Date)v=v.toISOString().slice(0,10);else if(v&&typeof v==='object')v=v.result??v.text??(v.richText?v.richText.map(t=>t.text).join(''):'');a.push(v??'')}rows.push(a)});return rows}
function write(data){const file=dbPath();fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file)}
app.setName('FundWork');
// Access records include credentials: protect the entire file with the OS account key.
ipcMain.on('coa-access-store',(event,request)=>{
  try{
    if(!safeStorage.isEncryptionAvailable())throw Error('Encrypted account storage is unavailable on this computer.');
    const file=path.join(app.getPath('userData'),'coa-access.bin');
    if(request?.action==='load'){
      let value=null;
      try{value=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))}catch(e){if(e.code!=='ENOENT')throw e}
      event.returnValue={value};
    }else if(request?.action==='save'){
      const value=request.value;
      if(value?.version!==1||!Array.isArray(value.members)||!Array.isArray(value.passwords))throw Error('Invalid account records');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file+'.tmp',safeStorage.encryptString(JSON.stringify(value)));
      fs.renameSync(file+'.tmp',file);
      event.returnValue={value:true};
    }else throw Error('Invalid account storage request');
  }catch(e){event.returnValue={error:e.message}}
});
const primary=app.requestSingleInstanceLock();if(!primary)app.quit();
if(process.platform==='win32')app.setAppUserModelId('com.fundwork.desktop');
app.whenReady().then(()=>{if(!primary)return;const hidden=process.argv.includes('--hidden')&&prefs().trayOnClose;win=new BrowserWindow({show:!hidden,icon:path.join(__dirname,'assets','fundwork-3d.ico'),title:'FundWork',width:1440,height:950,minWidth:1050,minHeight:700,backgroundColor:"#ffffff",webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.on('close',e=>{if(quitting||!prefs().trayOnClose)return;e.preventDefault();win.hide();ensureTray();if(!trayHint&&tray.displayBalloon){trayHint=true;tray.displayBalloon({iconType:'info',title:'FundWork is still running',content:'COA deadline reminders continue from the tray. Right-click the icon to quit.'})}});if(hidden)ensureTray();win.loadFile('index.html')});
app.on('window-all-closed',()=>app.quit());
ipcMain.handle('load',()=>read());
ipcMain.handle('save',(_,data)=>{if(!data||!Array.isArray(data.entries)||typeof data.accounts!=='object')throw Error('Invalid records');write(data);return true});
ipcMain.handle('pick',async()=>{let r=await dialog.showOpenDialog(win,{filters:[{name:'Journal exports',extensions:['xlsx','csv']}],properties:['openFile']});if(r.canceled)return null;let w=new ExcelJS.Workbook();if(path.extname(r.filePaths[0]).toLowerCase()==='.csv')await w.csv.readFile(r.filePaths[0]);else await w.xlsx.readFile(r.filePaths[0]);return {name:path.basename(r.filePaths[0]),sheets:w.worksheets.map(s=>({name:s.name,rows:sheetRows(s)}))}});
ipcMain.handle('export',async(_,payload)=>{let r=await dialog.showSaveDialog(win,{defaultPath:payload.name,filters:[{name:'Excel workbook',extensions:['xlsx']}]});if(r.canceled)return false;let w=new ExcelJS.Workbook();for(const s of payload.sheets){let ws=w.addWorksheet(s.name.slice(0,31));ws.addRows(s.rows);ws.columns.forEach(col=>col.width=24);ws.getRow(1).font={bold:true}}await w.xlsx.writeFile(r.filePath);return true});
ipcMain.handle('backup',async()=>{let r=await dialog.showSaveDialog(win,{defaultPath:'accounting-backup.json',filters:[{name:'Backup',extensions:['json']}]});if(!r.canceled)fs.writeFileSync(r.filePath,JSON.stringify(read(),null,2));return !r.canceled});
ipcMain.handle('restore',async()=>{let r=await dialog.showOpenDialog(win,{filters:[{name:'Backup',extensions:['json']}],properties:['openFile']});if(r.canceled)return null;let d=JSON.parse(fs.readFileSync(r.filePaths[0],'utf8'));if(!Array.isArray(d.entries)||!d.accounts||!Number.isInteger(d.year))throw Error('Invalid backup');let c=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Restore backup'],defaultId:0,cancelId:0,message:'Replace current records with this backup?'});if(c.response!==1)return null;fs.copyFileSync(dbPath(),dbPath()+'.before-restore');write(d);return d});

// COA Submissions: desktop side. Reads spreadsheets for pre-checks, shows the daily
// countdown notification, and keeps FundWork in the tray when the user chooses to.
let tray=null,trayHint=false,quitting=false,lastNotice=null;
const prefsPath=()=>path.join(app.getPath('userData'),'coa-desktop.json');
function prefs(){try{return {trayOnClose:false,lastReminder:null,...JSON.parse(fs.readFileSync(prefsPath(),'utf8'))}}catch{return {trayOnClose:false,lastReminder:null}}}
function setPrefs(patch){let p={...prefs(),...patch};fs.mkdirSync(path.dirname(prefsPath()),{recursive:true});fs.writeFileSync(prefsPath(),JSON.stringify(p,null,2));return p}
function showWindow(){if(!win)return;if(win.isMinimized())win.restore();win.show();win.focus()}
function ensureTray(){if(tray)return;tray=new Tray(path.join(__dirname,'assets','fundwork-3d.ico'));tray.setToolTip('FundWork');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open FundWork',click:showWindow},{type:'separator'},{label:'Quit FundWork',click:()=>{quitting=true;app.quit()}}]));tray.on('click',showWindow)}
const manilaHour=()=>(new Date().getUTCHours()+8)%24;
app.on('before-quit',()=>{quitting=true});
app.on('second-instance',showWindow);
ipcMain.handle('coa-read-sheets',async(_,arg)=>{let data=arg&&arg.data,name=String(arg&&arg.name||'');if(!(data instanceof Uint8Array))throw Error('No file data');if(data.byteLength>50*1024*1024)throw Error('File is larger than 50 MB');let w=new ExcelJS.Workbook(),buf=Buffer.from(data.buffer,data.byteOffset,data.byteLength);if(path.extname(name).toLowerCase()==='.csv')await w.csv.read(require('node:stream').Readable.from(buf));else await w.xlsx.load(buf);return {sheets:w.worksheets.map(s=>({name:s.name,rows:sheetRows(s,20000)}))}});
ipcMain.handle('coa-desktop-get',()=>{let p=prefs();return {trayOnClose:!!p.trayOnClose,openAtLogin:app.isPackaged&&app.getLoginItemSettings().openAtLogin,canOpenAtLogin:app.isPackaged,lastReminder:p.lastReminder,notifications:Notification.isSupported()}});
ipcMain.handle('coa-desktop-set',(_,arg)=>{let patch={};if(typeof arg?.trayOnClose==='boolean')patch.trayOnClose=arg.trayOnClose;if(typeof arg?.openAtLogin==='boolean'&&app.isPackaged){app.setLoginItemSettings({openAtLogin:arg.openAtLogin,args:['--hidden']});if(arg.openAtLogin)patch.trayOnClose=true}if(app.isPackaged&&patch.trayOnClose===false&&app.getLoginItemSettings().openAtLogin)app.setLoginItemSettings({openAtLogin:false,args:['--hidden']});let p=setPrefs(patch);if(!p.trayOnClose&&tray&&win?.isVisible()){tray.destroy();tray=null}return true});
// One notification per Manila day, from 7:00 AM, only when something is due within the reminder window.
ipcMain.handle('coa-reminder',(_,arg)=>{let date=String(arg?.date||''),force=arg?.force===true,count=Number(arg?.count)||0;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid date');if(!Notification.isSupported())return {shown:false,reason:'Notifications are not supported on this computer'};if(!force){if(count<=0)return {shown:false,reason:'Nothing due'};if(prefs().lastReminder===date)return {shown:false,reason:'Already shown today'};if(manilaHour()<7)return {shown:false,reason:'Before 7:00 AM'}}lastNotice=new Notification({title:String(arg.title||'COA reports').slice(0,120),body:String(arg.body||'').slice(0,400),icon:path.join(__dirname,'assets','fundwork-logo-3d.png')});lastNotice.on('click',()=>{showWindow();win?.webContents.send('coa-open')});lastNotice.show();setPrefs({lastReminder:date});return {shown:true}});

// Superadmin: opened from the sign-in screen (click the logo 5 times). Manages accounts only.
// The password is kept as a scrypt hash in userData. The default (123456) must be changed on first use.
const crypto=require('node:crypto');
const DEFAULT_ADMIN_PASSWORD='123456',ADMIN_MAX_TRIES=5,ADMIN_LOCK_MS=5*60*1000;
const adminPath=()=>path.join(app.getPath('userData'),'superadmin.json');
const hashPassword=(pw,salt)=>crypto.scryptSync(String(pw),salt,64).toString('hex');
function readAdmin(){try{return JSON.parse(fs.readFileSync(adminPath(),'utf8'))}catch{let salt=crypto.randomBytes(16).toString('hex');return {salt,hash:hashPassword(DEFAULT_ADMIN_PASSWORD,salt),isDefault:true,failed:0,lockedUntil:0}}}
function writeAdmin(a){fs.mkdirSync(path.dirname(adminPath()),{recursive:true});fs.writeFileSync(adminPath(),JSON.stringify(a,null,2))}
function checkAdmin(a,pw){let given=Buffer.from(hashPassword(pw,a.salt),'hex'),stored=Buffer.from(a.hash,'hex');return given.length===stored.length&&crypto.timingSafeEqual(given,stored)}
function adminLocked(a){let left=(a.lockedUntil||0)-Date.now();if(left>0)throw Error(`Too many incorrect attempts. Try again in ${Math.ceil(left/60000)} minute${left>60000?'s':''}.`)}
function adminAttempt(a,pw){adminLocked(a);if(checkAdmin(a,pw)){a.failed=0;a.lockedUntil=0;writeAdmin(a);return}a.failed=(a.failed||0)+1;if(a.failed>=ADMIN_MAX_TRIES){a.failed=0;a.lockedUntil=Date.now()+ADMIN_LOCK_MS;writeAdmin(a);throw Error('Too many incorrect attempts. Superadmin sign-in is locked for 5 minutes.')}writeAdmin(a);let left=ADMIN_MAX_TRIES-a.failed;throw Error(`Incorrect password. ${left} attempt${left===1?'':'s'} left.`)}
ipcMain.handle('admin-login',(_,pw)=>{let a=readAdmin();adminAttempt(a,pw);return {mustChange:!!a.isDefault}});
ipcMain.handle('admin-change',(_,arg)=>{let a=readAdmin(),next=String(arg?.next||'');adminAttempt(a,arg?.current);if(next.length<8)throw Error('Use at least 8 characters');if(next===DEFAULT_ADMIN_PASSWORD||checkAdmin(a,next))throw Error('Choose a password different from the current one');if(!/[a-z]/i.test(next)||!/\d/.test(next))throw Error('Use both letters and numbers');a.salt=crypto.randomBytes(16).toString('hex');a.hash=hashPassword(next,a.salt);a.isDefault=false;writeAdmin(a);return true});

// Supabase connection settings (superadmin). Only the project URL and the publishable key are kept here;
// secret / service_role keys are refused because anything in the app can be read on every PC.
const backendPath=()=>path.join(app.getPath('userData'),'coa-backend.json');
function backendDefaults(){try{let c=JSON.parse(fs.readFileSync(path.join(__dirname,'coa','supabase.config.json'),'utf8'));return {url:c.url||'',publishableKey:c.publishableKey||''}}catch{return {url:'',publishableKey:''}}}
function readBackend(){try{return {...backendDefaults(),...JSON.parse(fs.readFileSync(backendPath(),'utf8'))}}catch{return backendDefaults()}}
function checkBackend(url,key){url=String(url||'').trim().replace(/\/+$/,'');key=String(key||'').trim();
  if(!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url))throw Error('Use the Project URL, like https://abcdefghijklmnopqrst.supabase.co');
  if(!key)throw Error('Paste the publishable key');
  if(key.startsWith('sb_secret_'))throw Error('That is a secret key. Use the publishable key: secret keys must never be put in the app.');
  if(key.startsWith('sbp_'))throw Error('That is a personal access token. Put it in .env.supabase for npm run supabase, not in the app.');
  if(key.startsWith('eyJ')){let role;try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role}catch{throw Error('This key is not a valid Supabase key')}if(role==='service_role')throw Error('That is the service_role key. Use the anon / publishable key: service_role must never be put in the app.');if(role!=='anon')throw Error('Use the anon / publishable key')}
  else if(!key.startsWith('sb_publishable_'))throw Error('The publishable key starts with sb_publishable_ (or eyJ for the legacy anon key)');
  return {url,publishableKey:key}}
async function testBackend(url,key){let cfg=checkBackend(url,key),headers={apikey:cfg.publishableKey};if(cfg.publishableKey.startsWith('eyJ'))headers.Authorization='Bearer '+cfg.publishableKey;
  let auth;try{let r=await fetch(cfg.url+'/auth/v1/settings',{headers,signal:AbortSignal.timeout(10000)});if(r.status===401||r.status===403)return {ok:false,message:'Supabase rejected this key. Copy the publishable key again from Project Settings → API Keys.'};if(!r.ok)return {ok:false,message:`Supabase Auth answered ${r.status}.`};auth=await r.json()}catch(e){return {ok:false,message:`Cannot reach ${cfg.url}. Check the internet connection and the URL. (${e.message})`}}
  let db='unknown',dbMessage='';try{let r=await fetch(cfg.url+'/rest/v1/units?select=code&limit=1',{headers,signal:AbortSignal.timeout(10000)});let b=await r.json().catch(()=>({}));dbMessage=b.message||'';
    // Signed-out requests are refused by design (RLS and revoked anon access), which proves the table exists.
    if(r.ok||b.code==='42501'||r.status===401)db='ready';else if(b.code==='PGRST205'||b.code==='42P01'||r.status===404)db='missing'}catch(e){dbMessage=e.message}
  return {ok:true,emailEnabled:auth.external?.email!==false,signupEnabled:!auth.disable_signup,autoconfirm:!!auth.mailer_autoconfirm,db,dbMessage}}
ipcMain.handle('backend-get',()=>{let b=readBackend();return {...b,saved:fs.existsSync(backendPath())}});
// Fixed project origin; session credentials are never written to disk.
ipcMain.handle('coa-request',async(_,arg)=>{
  const cfg=checkBackend(readBackend().url,readBackend().publishableKey);
  if(!/^\/(auth\/v1\/(token\?grant_type=(password|refresh_token)|signup|logout|user)|rest\/v1\/[a-z_]+(?:\?.*)?|rest\/v1\/rpc\/[a-z_]+|storage\/v1\/object\/coa-files\/[A-Za-z0-9_./%-]+)$/.test(arg?.path||''))throw Error('Unsupported backend request');
  const headers={apikey:cfg.publishableKey,'Content-Type':arg.bytes?'application/octet-stream':'application/json'};
  if(arg.token)headers.Authorization='Bearer '+arg.token;
  const response=await fetch(cfg.url+arg.path,{method:arg.method||'GET',headers,body:arg.bytes?Buffer.from(arg.bytes):arg.body===undefined?undefined:JSON.stringify(arg.body),signal:AbortSignal.timeout(30000)});
  if(arg.download&&response.ok&&arg.path.startsWith('/storage/v1/object/coa-files/')){
    const bytes=Buffer.from(await response.arrayBuffer());
    const target=await dialog.showSaveDialog(win,{defaultPath:path.basename(String(arg.download))});
    if(target.canceled)return false;
    fs.writeFileSync(target.filePath,bytes);return true;
  }
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw Error(body?.msg||body?.message||body?.error_description||body?.error||`Backend request failed (${response.status})`);
  return body;
});
ipcMain.handle('backend-set',(_,arg)=>{let cfg=checkBackend(arg?.url,arg?.publishableKey);fs.mkdirSync(path.dirname(backendPath()),{recursive:true});fs.writeFileSync(backendPath(),JSON.stringify({...cfg,savedAt:new Date().toISOString()},null,2));return cfg});
ipcMain.handle('backend-test',(_,arg)=>testBackend(arg?.url,arg?.publishableKey));
const migrationsDir=()=>path.join(__dirname,'supabase','migrations');
ipcMain.handle('backend-sql-files',()=>fs.readdirSync(migrationsDir()).filter(f=>f.endsWith('.sql')).sort());
ipcMain.handle('backend-copy-sql',(_,name)=>{let files=fs.readdirSync(migrationsDir()).filter(f=>f.endsWith('.sql'));if(!files.includes(name))throw Error('Unknown setup step');clipboard.writeText(fs.readFileSync(path.join(migrationsDir(),name),'utf8'));return name});
