// COA Submissions screens: Overview, Checklist and the details panel (upload, pre-check, review).
// Uses the renderer's helpers (esc, icon, heading, toast, render, page). The data source is the
// shared Supabase source in the desktop app, with an isolated demo for browser previews.
(function(root){
const S=root.CoaSchedule,P=root.CoaPrecheck,D=root.CoaDemo;
const PAGES=['COA overview','COA checklist','COA access','COA backend','Account settings'],LABELS={'COA overview':'Overview','COA checklist':'Checklist','COA access':'Allow users','COA backend':'Supabase'};
const SHORT={SDO:'SDO',BNHS:'Basilan NHS',BEGANG:'Begang NHS',CONSO:'Conso'};
const FREQ=[['','All frequencies'],['MONTHLY','Monthly'],['QUARTERLY','Quarterly'],['SEMIANNUAL','Semi-annual'],['ANNUAL','Annual']];
const STATUSES=[['','All statuses'],['open','Needs action'],['missing','Not uploaded'],['for_review','For review'],['returned','Returned'],['approved','Released to COA'],['not_applicable','Not applicable']];
const ICON={inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',list:'<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6l.01 0M4 12l.01 0M4 18l.01 0" stroke-width="2.6"/>',close:'<path d="M6 6l12 12M18 6L6 18"/>',upload:'<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>'};

// FundWork always opens on the sign-in screen: no session is restored on launch (shared office PCs).
try{localStorage.removeItem('fundwork.demoSession')}catch{}   // clears what earlier versions remembered
// No sample accounts or sample reports: the superadmin allows the real people, who then register.
const accessStore=root.desktop?.coaAccessStore;
let source=root.desktop?.coaRequest?root.CoaSupabase.createSupabaseSource(root.desktop.coaRequest):D.createDemoSource({sampleAccounts:false,seed:false,accessState:accessStore?.({action:'load'}),saveAccess:accessStore?(value)=>accessStore({action:'save',value}):undefined}),data=null,loading=null,failed=null,prefs=null,signedIn=null,account=null;
const ui={report:'',fund:'',office:'ALL',freq:'',status:'',period:'',q:'',selected:null};
// Superadmin "View as": read-only preview of what each role sees. Nothing can be uploaded or approved while previewing.
const VIEW_AS=[['','Superadmin'],['accountant','Division Accountant'],['uploader:SDO','SDO Senior Bookkeeper'],['uploader:BNHS','BNHS Senior Bookkeeper'],['uploader:BEGANG','BeNHS Senior Bookkeeper'],['coa','COA personnel']];
let viewAs='';
function previewSession(real,key){const [role,unit]=key.split(':'),all=S.DEFAULT_UNITS.map(u=>u.code);return {...real,role,offices:role==='uploader'?(unit==='SDO'?['SDO','CONSO']:[unit]):all,preview:true,previewLabel:VIEW_AS.find(v=>v[0]===key)[1]}}
let staged={key:null,files:[]},busy=false;

const $c=()=>document.querySelector('#content');
const short=code=>SHORT[code]||code;
const stamp=iso=>iso?new Date(iso).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'';
const manilaDate=iso=>S.todayManila(new Date(iso));
const size=b=>b<1024?`${b} B`:b<1048576?`${Math.round(b/1024)} KB`:`${(b/1048576).toFixed(1)} MB`;
const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
const badge=i=>`<span class="coa-status s-${i.status}">${S.STATUS_LABELS[i.status]}</span>${i.late?' <span class="coa-late" title="Approved after the due date">Late</span>':''}`;
const countdown=i=>`<span class="coa-count u-${i.urgency}">${S.countdownLabel(i)}</span>`;
const ipcMessage=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
const byKey=k=>data?.items.find(i=>i.key===k);
const memberName=email=>email==='superadmin@local'?'Superadmin':data?.members.find(m=>m.email===email)?.name||email;
/** Who uploads for an office. */
const uploaderOf=code=>code==='SDO'||code==='CONSO'?'SDO Senior Bookkeeper':code==='BNHS'?'BNHS Senior Bookkeeper':code==='BEGANG'?'BeNHS Senior Bookkeeper':'Senior Bookkeeper';
function slotLabel(key){let [r,u,p]=key.split('|');try{p=S.periodFromKey(p).label}catch{}return `${r} · ${short(u)} · ${p}`}
/** Items this person is responsible for: everything for the accountant, assigned offices for Senior Bookkeepers, nothing for COA. */
function mine(items){let s=data.session;if(s.role==='accountant'||s.role==='superadmin')return items;if(s.role==='uploader')return items.filter(i=>s.offices.includes(i.unit.code));return []}

async function load(){const who=await source.getSession();signedIn=!!who;
  if(who?.email!==account){account=who?.email||null;viewAs='';Object.assign(ui,{report:'',fund:'',office:'ALL',freq:'',status:'',period:'',q:'',selected:null});staged={key:null,files:[]}}
  if(!who){data=null;failed=null;return}
  const [realSession,config,subs,files,members]=await Promise.all([source.getSession(),source.getConfig(),source.listSubmissions(),source.listFiles(),source.listMembers()]);
  const session=realSession.role==='superadmin'&&viewAs?previewSession(realSession,viewAs):realSession;
  const today=S.todayManila();let items=S.buildChecklist({reportTypes:config.reportTypes,units:config.units,submissions:subs,today,trackingStart:config.trackingStart,horizonDays:config.horizonDays,reminderDays:config.reminderDays});
  if(session.role==='coa')items=items.filter(i=>i.status==='approved');
  const filesByKey={};files.forEach(f=>(filesByKey[f.itemKey]??=[]).push(f));
  // Only the superadmin sees the superadmin account, also in "View as" previews of other roles.
  const visibleMembers=session.role==='superadmin'?members:members.filter(m=>m.role!=='superadmin');
  data={session,realSession,config,items,files,filesByKey,members:visibleMembers,today};failed=null;if(ui.selected&&!byKey(ui.selected))ui.selected=null}
function ensureLoaded(){return loading??=load().catch(e=>{failed=e;throw e}).finally(()=>{loading=null})}
const appReady=()=>{try{return !!db}catch{return false}};
async function refresh(){let was=account;try{await ensureLoaded()}catch(e){toast('COA submissions: '+e.message)}if(appReady())render();if(data&&account!==was)remindIfDue()}
source.subscribe(()=>refresh());

// ---------- hooks used by renderer.js ----------
function navLabel(p){return LABELS[p]||p}
/** COA personnel only use COA Submissions; the books are for the Accounting staff. */
function navAllowed(p){const s=data?.session;if(!s||p==='Account settings')return true;if(s.role==='superadmin')return true;if(p==='COA backend')return false;if(p==='COA access')return D.canManageMembers(s);if(s.role==='coa')return p==='COA overview'||p==='COA checklist';return true}
/** Where each role lands after signing in. */
function homePage(){const r=data?.session.role;if(data?.session.preview)return 'COA overview';return r==='superadmin'?'COA access':r==='coa'?'COA overview':'Overview'}
function navBadge(p){if(p!=='COA checklist'||!data)return '';let n=S.reminderItems(mine(data.items),data.config.reminderDays).length;return n?`<span class="nav-badge" title="${plural(n,'report')} overdue or due within ${data.config.reminderDays} days">${n}</span>`:''}
function afterRender(p){document.body.classList.toggle('coa-page',PAGES.includes(p));if(data?.session.preview&&!PAGES.includes(p))markPreview();if(!PAGES.includes(p)||signedIn===false)return;
  if(failed&&!data){$c().innerHTML=`<div class="warning">Unable to load COA submissions: ${esc(failed.message)}</div>`;return}
  if(!data){$c().innerHTML='<p class="muted">Loading COA submissions…</p>';refresh();return}
  if(p==='COA overview')overview();else if(p==='COA checklist')checklist();else if(p==='COA access')accessPage();else if(p==='COA backend')backendPage();else accountPage();
  if(data.session.preview&&p!=='Account settings')markPreview()}
/** Preview permits navigation and exports while blocking changes to records. */
function markPreview(){const c=$c();if(!c||!data?.session.preview)return;
  if(!c.querySelector('.coa-preview-bar'))c.insertAdjacentHTML('afterbegin',`<div class="coa-preview-bar"><span>Viewing as <b>${esc(data.session.previewLabel)}</b> · read-only preview. Uploads, reviews and changes are turned off.</span><button class="coa-preview-back">Back to superadmin</button></div>`);
  c.querySelector('.coa-preview-back').onclick=()=>setViewAs('');
  const keep='[data-tab],[data-office],[data-go],[data-page],[data-download],#export-btn,#coa-close,#coa-to-list,.coa-preview-back';
  const exportButton=c.querySelector('#export-btn');
  if(exportButton){exportButton.disabled=false;exportButton.title='Export this report to Excel'}
  c.querySelectorAll('button,select[data-type],select[data-flow],input[data-cash],input[type=file]').forEach(el=>{if(!el.matches(keep)){el.disabled=true;el.title='Read-only preview'}})}
async function setViewAs(key){viewAs=VIEW_AS.some(v=>v[0]===key)?key:'';ui.selected=null;staged={key:null,files:[]};try{await load()}catch(e){toast(e.message);return}page=homePage();render();root.CoaLogin?.sync()}

// ---------- shared pieces ----------
function banner(){if(source.kind!=='demo')return '';return `<div class="coa-demo"><span>${accessStore?'<b>Accounts saved on this computer.</b> Allowed users and registrations survive restarts.':'<b>Demo data.</b> Accounts are not saved in this preview.'} Uploads and reviews remain temporary. The shared backend is not connected yet; accounts are not shared with other computers.</span></div>`}
function itemTable(items,{selectable=false,empty='No reports to show'}={}){return `<div class="table-wrap coa-table"><table><thead><tr><th>Report</th><th>Office</th><th>Period</th><th>Due</th><th>Countdown</th><th>Status</th>${selectable?'<th class="num coa-files-col">Files</th>':''}</tr></thead><tbody>${items.length?items.map(i=>{let n=(data.filesByKey[i.key]||[]).filter(f=>!f.supersededAt).length;return `<tr data-key="${esc(i.key)}" tabindex="0" class="${ui.selected===i.key&&selectable?'selected':''}"><td class="coa-report"><b>${esc(i.report.code)}</b><span>${esc(i.report.name)}</span></td><td>${esc(short(i.unit.code))}</td><td>${esc(i.period.label)}</td><td>${S.formatDate(i.dueDate)}</td><td>${countdown(i)}</td><td>${badge(i)}</td>${selectable?`<td class="num coa-files-col">${n||'<span class="muted">—</span>'}</td>`:''}</tr>`}).join(''):`<tr><td class="empty-row" colspan="${selectable?7:6}">${empty}</td></tr>`}</tbody></table></div>`}
function bindRows(container,onOpen){container.querySelectorAll('tr[data-key]').forEach(tr=>{tr.onclick=()=>onOpen(tr.dataset.key);tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(tr.dataset.key)}}})}
function openItem(key){ui.selected=key;if(page!=='COA checklist'){page='COA checklist';render()}else{drawTable();drawPanel()}}

// ---------- Overview ----------
function overview(){const {items,today,session,config}=data,m=mine(items),month=today.slice(0,7);
  if(session.role==='coa'){let rel=items.filter(i=>i.status==='approved');$c().innerHTML=heading('COA Submissions','Reports released by the Division Accountant')+banner()+`<div class="notice">You see only reports the Division Accountant has approved. Use Download on a released file to save a copy.</div><div class="stats coa-stats-2"><div class="stat"><small>Released reports</small><strong>${rel.length}</strong><span>Since ${S.formatDate(config.trackingStart)}</span></div><div class="stat"><small>Released this month</small><strong>${rel.filter(i=>i.submission?.approvedAt&&manilaDate(i.submission.approvedAt).slice(0,7)===month).length}</strong><span>${S.periodFromKey(month).label}</span></div></div>`+itemTable(rel,{empty:'Nothing has been released yet'});bindRows($c(),openItem);return}
  const over=m.filter(i=>i.urgency==='overdue'),soon=m.filter(i=>i.urgency==='today'||i.urgency==='soon'),review=m.filter(i=>i.status==='for_review'),ret=m.filter(i=>i.status==='returned'),rel=m.filter(i=>i.status==='approved'&&i.submission?.approvedAt&&manilaDate(i.submission.approvedAt).slice(0,7)===month);
  const notUp=l=>l.filter(i=>i.status==='missing'||i.status==='returned').length;
  const scope=session.role==='uploader'?`Your offices: ${session.offices.map(short).join(', ')}`:'All offices';
  const units=config.units.filter(u=>session.role!=='uploader'||session.offices.includes(u.code));
  const officeRows=units.map(u=>{let x=m.filter(i=>i.unit.code===u.code),c=f=>x.filter(f).length,o=c(i=>i.urgency==='overdue');return `<tr data-office="${u.code}" tabindex="0"><td>${esc(u.name)}</td><td class="num ${o?'bad':''}">${o}</td><td class="num">${c(i=>i.urgency==='today'||i.urgency==='soon')}</td><td class="num">${c(i=>i.status==='missing'&&i.daysLeft<=config.reminderDays)}</td><td class="num">${c(i=>i.status==='for_review')}</td><td class="num">${c(i=>i.status==='returned')}</td><td class="num">${c(i=>i.status==='approved')}</td><td class="num">${x.length}</td></tr>`}).join('');
  const due=S.reminderItems(m,config.reminderDays);
  $c().innerHTML=heading('COA Submissions',`${scope} · ${S.formatLongDate(today)}`,`<button id="coa-to-list">${icon(ICON.list)} Open checklist</button>`)+banner()+
  `<div class="stats coa-stats"><div class="stat"><small>Overdue</small><strong class="${over.length?'bad':''}">${over.length}</strong><span>${notUp(over)} not uploaded</span></div><div class="stat"><small>Due within ${config.reminderDays} days</small><strong>${soon.length}</strong><span>${notUp(soon)} not uploaded yet</span></div><div class="stat"><small>For review</small><strong>${review.length}</strong><span>Waiting for the Division Accountant</span></div><div class="stat"><small>Returned</small><strong>${ret.length}</strong><span>Waiting for a corrected upload</span></div><div class="stat"><small>Released this month</small><strong>${rel.length}</strong><span>${S.periodFromKey(month).label}</span></div></div>`+
  `<div class="panel"><div class="coa-panel-title"><h3>Overdue or due within ${config.reminderDays} days</h3><span class="muted">${plural(due.length,'report')}</span></div>${itemTable(due,{empty:`Nothing is overdue or due in the next ${config.reminderDays} days`})}</div>`+
  `<div class="panel"><div class="coa-panel-title"><h3>By office</h3><span class="muted">Tracking since ${S.formatDate(config.trackingStart)}</span></div><div class="table-wrap coa-table"><table><thead><tr><th>Office</th><th class="num">Overdue</th><th class="num">Due ≤${config.reminderDays} days</th><th class="num">Not uploaded</th><th class="num">For review</th><th class="num">Returned</th><th class="num">Released</th><th class="num">Expected</th></tr></thead><tbody>${officeRows}</tbody></table></div><p class="muted">“Not uploaded” counts reports with no file that are overdue or due within ${config.reminderDays} days.</p></div>`+
  remindersPanel();
  bindRows($c(),openItem);
  $c().querySelectorAll('tr[data-office]').forEach(tr=>{let go=()=>{Object.assign(ui,{office:tr.dataset.office,status:'open',freq:'',period:'',q:''});page='COA checklist';render()};tr.onclick=go;tr.onkeydown=e=>{if(e.key==='Enter')go()}});
  document.querySelector('#coa-to-list').onclick=()=>{page='COA checklist';render()};
  bindReminders()}

function remindersPanel(){return `<div class="panel coa-info"><h3>Desktop reminders</h3><p>Starting ${data.config.reminderDays} days before each due date, FundWork shows one Windows notification a day with the countdown, from 7:00 AM, while it is open.</p></div>`}
function bindReminders(){let t=document.querySelector('#coa-tray'),l=document.querySelector('#coa-login'),n=document.querySelector('#coa-remind-now');
  if(t)t.onchange=async()=>{await desktop.coaSetDesktop({trayOnClose:t.checked});prefs=await desktop.coaDesktop();render();toast(t.checked?'FundWork will stay in the tray when closed':'Closing the window quits FundWork')};
  if(l)l.onchange=async()=>{await desktop.coaSetDesktop({openAtLogin:l.checked});prefs=await desktop.coaDesktop();render()};
  if(n)n.onclick=async()=>{let r=await checkReminder(true);prefs=await desktop.coaDesktop();render();if(r&&!r.shown)toast(r.reason)}}

// ---------- Checklist ----------
function reportCode(r){return r.code.replace(/_(PROVIDENT|TRUST)$/,'')}
function reportTitle(r){return r.name.replace(/\s+[-\u2013\u2014]\s+(Regular|Provident|Trust) Fund$/,'')}
function filtered(){let q=ui.q.trim().toLowerCase();return data.items.filter(i=>(ui.office==='ALL'||i.unit.code===ui.office)&&(!ui.report||reportCode(i.report)===ui.report)&&(!ui.fund||(i.report.fundCode||'REGULAR')===ui.fund)&&(!ui.freq||i.report.frequency===ui.freq)&&(!ui.status||(ui.status==='open'?!i.done:i.status===ui.status))&&(!ui.period||i.period.key===ui.period)&&(!q||`${i.report.code} ${i.report.name}`.toLowerCase().includes(q)))}
function checklist(){const {items,config}=data;const periods=[...new Map(items.map(i=>[i.period.key,i.period])).values()].sort((a,b)=>b.end.localeCompare(a.end)||a.key.localeCompare(b.key));
  if(ui.period&&!periods.some(p=>p.key===ui.period))ui.period='';
  const opts=(list,v)=>list.map(([k,l])=>`<option value="${esc(k)}" ${v===k?'selected':''}>${esc(l)}</option>`).join('');
  const reports=[...new Map(config.reportTypes.map(r=>[reportCode(r),reportTitle(r)])).entries()];
  $c().innerHTML=heading('Checklist',data.session.role==='coa'?'Reports released to COA':`Every report each office must submit, tracked from ${S.formatDate(config.trackingStart)}. Select a row for details.`)+banner()+
  `<div class="toolbar coa-filters"><div class="segmented" id="coa-office" role="tablist" aria-label="Office">${[['ALL','All'],...config.units.map(u=>[u.code,short(u.code)])].map(([c,l])=>`<button role="tab" data-office="${c}" class="${ui.office===c?'active':''}" aria-selected="${ui.office===c}">${l}</button>`).join('')}</div><select id="coa-report" aria-label="Report title">${opts([['','All reports'],...reports],ui.report)}</select><select id="coa-fund" aria-label="Fund">${opts([['','All funds'],...S.FUNDS.map(f=>[f.code,f.name])],ui.fund)}</select><select id="coa-freq" aria-label="Frequency">${opts(FREQ,ui.freq)}</select><select id="coa-status" aria-label="Status">${opts(STATUSES,ui.status)}</select><select id="coa-period" aria-label="Period">${opts([['','All periods'],...periods.map(p=>[p.key,p.label])],ui.period)}</select><input id="coa-q" type="search" placeholder="Search report" value="${esc(ui.q)}"></div><div id="coa-split" class="coa-split"><div class="coa-main"><div id="coa-table"></div><p id="coa-countline" class="muted"></p></div><div id="coa-panel" class="coa-panel" tabindex="-1"></div></div>`;
  
  document.querySelectorAll('#coa-office button').forEach(b=>b.onclick=()=>{ui.office=b.dataset.office;document.querySelectorAll('#coa-office button').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',x===b)});drawTable()});
  [['#coa-report','report'],['#coa-fund','fund'],['#coa-freq','freq'],['#coa-status','status'],['#coa-period','period']].forEach(([s,k])=>document.querySelector(s).onchange=e=>{ui[k]=e.target.value;drawTable()});
  document.querySelector('#coa-q').oninput=e=>{ui.q=e.target.value;drawTable()};
  drawTable();drawPanel()}
function drawTable(){let el=document.querySelector('#coa-table');if(!el)return;let list=filtered();if(ui.selected&&!list.some(i=>i.key===ui.selected)){ui.selected=null;drawPanel()}el.innerHTML=itemTable(list,{selectable:true,empty:'No reports match these filters'});bindRows(el,openItem);
  let over=list.filter(i=>i.urgency==='overdue').length,miss=list.filter(i=>i.status==='missing').length;document.querySelector('#coa-countline').textContent=`Showing ${list.length} of ${data.items.length}${over?` · ${over} overdue`:''}${miss?` · ${miss} not uploaded`:''}`;
  el.querySelector('tr.selected')?.scrollIntoView({block:'nearest'})}

// ---------- Details panel ----------
function drawPanel(){const el=document.querySelector('#coa-panel'),split=document.querySelector('#coa-split');if(!el)return;const i=ui.selected&&byKey(ui.selected);split.classList.toggle('open',!!i);if(!i){el.innerHTML='';return}
  if(staged.key!==i.key)staged={key:i.key,files:[]};
  const s=data.session,all=data.filesByKey[i.key]||[],cur=all.filter(f=>!f.supersededAt),old=all.filter(f=>f.supersededAt);
  const uploadable=!s.preview&&D.canUpload(s,i.unit.code)&&!['approved','not_applicable'].includes(i.status),reviewer=!s.preview&&D.canReview(s),sub=i.submission;
  const facts=[['Status',badge(i)],['Due',`${S.formatLongDate(i.dueDate)}${i.done?'':` · ${countdown(i)}`}`],['Rule',esc(S.describeDueRule(i.report.dueRule))]];
  if(sub?.reviewedAt&&['approved','returned','not_applicable'].includes(i.status))facts.push([i.status==='approved'?'Approved':'Reviewed',`${esc(memberName(sub.reviewedBy))} · ${stamp(sub.reviewedAt)}`]);
  el.innerHTML=`<div class="coa-panel-head"><div><small>${esc(i.report.code)} · ${esc(i.report.category)}</small><h2>${esc(i.report.name)}</h2><p>${esc(i.unit.name)} · ${esc(i.period.label)}</p></div><button class="coa-icon-btn" id="coa-close" aria-label="Close details" title="Close (Esc)">${icon(ICON.close)}</button></div>
  <dl class="coa-facts">${facts.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl><p class="coa-desc">${esc(i.report.description)}</p>
  ${i.status==='returned'&&sub?.reviewNote?`<div class="warning"><b>Returned for revision.</b> ${esc(sub.reviewNote)}</div>`:''}${i.status==='not_applicable'&&sub?.reviewNote?`<div class="notice"><b>Not applicable.</b> ${esc(sub.reviewNote)}</div>`:''}${i.status==='approved'&&s.role!=='coa'?`<div class="success">Released to COA. COA personnel can download the current files.</div>`:''}
  <section class="coa-section"><h3>Files <span class="muted">${cur.length||''}</span></h3>${cur.length?`<ul class="coa-files">${cur.map(f=>fileItem(f,uploadable)).join('')}</ul>`:`<p class="muted">${i.status==='missing'?'Not uploaded yet.':'No current files.'}</p>`}${old.length&&s.role!=='coa'?`<details class="coa-old"><summary>${plural(old.length,'removed file')}</summary><ul class="coa-files">${old.map(f=>`<li class="coa-file removed"><div class="coa-file-main"><span class="coa-file-name">${esc(f.name)}</span><span class="muted">Removed by ${esc(memberName(f.supersededBy))} · ${stamp(f.supersededAt)}${f.supersedeReason?` · “${esc(f.supersedeReason)}”`:''}</span></div></li>`).join('')}</ul></details>`:''}${s.role==='coa'&&source.kind==='demo'?'<p class="muted">Downloads are unavailable in the demo.</p>':''}</section>
  ${uploadable?uploadSection(i):!['approved','not_applicable'].includes(i.status)&&s.role!=='coa'?`<section class="coa-section"><h3>Upload</h3><p class="muted">${s.preview?'Read-only preview. ':''}This report is uploaded by the ${esc(uploaderOf(i.unit.code))} or the Division Accountant: they sign in, open this report in the Checklist, drop the files here and choose Submit for review.</p></section>`:''}${reviewer?reviewSection(i,cur):uploadable?'<section class="coa-section"><h3>Applicability</h3><button id="coa-na">Not applicable</button></section>':''}${s.role!=='coa'?'<section class="coa-section"><h3>Activity</h3><ol class="coa-activity" id="coa-activity"><li class="muted">Loading…</li></ol></section>':''}`;
  bindPanel(i,cur);if(s.preview)markPreview();
  if(s.role!=='coa')source.listActivity(i.key).then(list=>{let a=document.querySelector('#coa-activity');if(a&&ui.selected===i.key)a.innerHTML=list.length?list.map(e=>`<li><span>${esc(e.byName)} ${activityText(e)}</span><time>${stamp(e.at)}</time></li>`).join(''):'<li class="muted">No activity yet. This report has not been uploaded.</li>'}).catch(e=>toast(e.message))}
function findingsList(pc){if(!pc)return '';let order={block:0,warn:1,pass:2,info:3},f=[...(pc.findings||[])].sort((a,b)=>order[a.severity]-order[b.severity]);if(!f.length)return '<ul class="coa-findings"><li class="f-pass"><b>Pre-check found no issues</b></li></ul>';return `<ul class="coa-findings">${f.map(x=>`<li class="f-${x.severity}"><b>${esc(x.title)}</b><span>${esc(x.detail)}</span></li>`).join('')}</ul>`}
function fileItem(f,removable){return `<li class="coa-file"><div class="coa-file-main"><span class="coa-file-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="muted">${size(f.size)} · ${esc(f.uploadedByName||memberName(f.uploadedBy))} · ${stamp(f.uploadedAt)}</span></div>${source.downloadFile?`<button class="coa-link" data-download="${esc(f.id)}">Download</button>`:''}${removable?`<button class="coa-link" data-remove="${esc(f.id)}">Remove</button>`:''}${data.session.role!=='coa'?findingsList(f.precheck):''}</li>`}
function uploadSection(i){const ready=staged.files.filter(f=>f.state==='ready'&&!f.precheck.blocked),checking=staged.files.some(f=>f.state==='checking'),blocked=staged.files.filter(f=>f.precheck?.blocked).length;
  return `<section class="coa-section"><h3>${i.status==='returned'?'Upload a corrected file':i.status==='for_review'?'Add files':'Upload'}</h3>${i.status==='returned'&&(data.filesByKey[i.key]||[]).some(f=>!f.supersededAt)?'<div class="coa-resubmit"><span class="muted">Fixed by removing a file? Send the current files back without uploading.</span><button id="coa-resubmit">Resubmit for review</button></div>':''}<div class="coa-drop" id="coa-drop" tabindex="0" role="button" aria-label="Choose files to upload">${icon(ICON.upload)}<div><b>Drop files here</b> or <span class="coa-link">choose files</span><small>PDF, Excel, CSV, Word, JPG or PNG · up to 50 MB each</small></div><input type="file" id="coa-file" multiple hidden></div>
  ${staged.files.length?`<ul class="coa-files staged">${staged.files.map(f=>`<li class="coa-file ${f.precheck?.blocked?'blocked':''}"><div class="coa-file-main"><span class="coa-file-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="muted">${size(f.size)} · ${f.state==='checking'?'Checking…':f.precheck?.blocked?'Cannot be submitted':'Pre-check done'}</span></div><button class="coa-link" data-unstage="${f.id}">Remove</button>${f.precheck?findingsList(f.precheck):''}</li>`).join('')}</ul><div class="coa-upload-actions"><span class="muted">${blocked?`${plural(blocked,'file')} cannot be submitted.`:'Review the pre-check before submitting.'}</span><button id="coa-clear">Clear</button><button class="primary" id="coa-submit" ${!ready.length||checking||busy?'disabled':''}>Submit ${ready.length>1?ready.length+' files':''} for review</button></div>`:''}</section>`}
function reviewSection(i,cur){let b=[];if(i.status==='for_review')b.push(`<button class="primary" id="coa-approve" ${cur.length?'':'disabled title="Approving requires at least one current file"'}>Approve and release to COA</button>`,'<button id="coa-return">Return for revision</button>');
  if(!['approved','not_applicable'].includes(i.status))b.push('<button id="coa-na">Not applicable</button>');if(['approved','not_applicable'].includes(i.status))b.push('<button id="coa-reopen">Reopen</button>');
  let hint=i.status==='missing'?'Approval becomes available after an upload.':i.status==='returned'?'Waiting for the Senior Bookkeeper to submit a corrected file.':i.status==='approved'?'Reopening removes COA access until you approve again.':'';
  return `<section class="coa-section"><h3>Review</h3><div class="coa-actions">${b.join('')}</div>${hint?`<p class="muted">${hint}</p>`:''}</section>`}
function activityText(e){const d=e.details||{},q=t=>t?`: “${esc(t)}”`:'';switch(e.action){case 'upload':return `uploaded ${esc(d.file)}${d.findings?` <span class="coa-warn-text">(${plural(d.findings,'pre-check warning')})</span>`:''}`;case 'resubmit':return 'resubmitted for review';case 'approve':return 'approved and released to COA';case 'return':return `returned it for revision${q(d.note)}`;case 'not_applicable':return `marked it not applicable${q(d.reason)}`;case 'reopen':return `reopened it${q(d.reason)}`;case 'remove':return `removed ${esc(d.file)}${q(d.reason)}`;default:return esc(e.action)}}

function bindPanel(i,cur){const q=s=>document.querySelector(s),slot={reportCode:i.report.code,unitCode:i.unit.code,periodKey:i.period.key};
  q('#coa-close').onclick=closePanel;
  document.querySelectorAll('[data-download]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await source.downloadFile(b.dataset.download)}catch(e){toast(e.message)}finally{b.disabled=false}});
  const act=async(fn,msg)=>{if(busy)return;busy=true;try{await fn();if(msg)toast(msg)}catch(e){toast(e.message)}finally{busy=false}};
  const drop=q('#coa-drop'),input=q('#coa-file');
  if(drop){drop.onclick=()=>input.click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}};input.onchange=()=>{addFiles(i,[...input.files]);input.value=''};
    drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');addFiles(i,[...e.dataTransfer.files])}}
  document.querySelectorAll('[data-unstage]').forEach(b=>b.onclick=()=>{staged.files=staged.files.filter(f=>String(f.id)!==b.dataset.unstage);drawPanel()});
  q('#coa-clear')&&(q('#coa-clear').onclick=()=>{staged.files=[];drawPanel()});
  q('#coa-submit')&&(q('#coa-submit').onclick=()=>{let ready=staged.files.filter(f=>f.state==='ready'&&!f.precheck.blocked);act(async()=>{await source.submitFiles({...slot,files:ready.map(f=>({name:f.name,size:f.size,type:f.type,sha256:f.sha256,precheck:f.precheck,bytes:f.bytes}))});staged={key:i.key,files:[]}},`${plural(ready.length,'file')} submitted for review`)});
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{let f=cur.find(x=>x.id===b.dataset.remove);let reason=await ask({title:`Remove ${f.name}?`,message:'The file stays in the history as removed. It will no longer be part of this submission.',label:'Reason (optional)',confirm:'Remove file'});if(reason!==null)act(()=>source.removeFile(f.id,reason),'File removed')});
  q('#coa-resubmit')&&(q('#coa-resubmit').onclick=()=>act(()=>source.resubmit(i.key),'Resubmitted for review'));
  q('#coa-approve')&&(q('#coa-approve').onclick=async()=>{if(await ask({title:'Approve and release to COA?',message:`${plural(cur.length,'file')} will become downloadable by COA, and the countdown for this report stops.`,confirm:'Approve and release'})!==null)act(()=>source.approve(i.key),'Approved and released to COA')});
  q('#coa-return')&&(q('#coa-return').onclick=async()=>{let note=await ask({title:'Return for revision',message:'The Senior Bookkeeper sees this note and can upload a corrected file.',label:'Note to the Senior Bookkeeper',required:true,confirm:'Return'});if(note!==null)act(()=>source.returnForRevision(i.key,note),'Returned for revision')});
  q('#coa-na')&&(q('#coa-na').onclick=async()=>{let r=await ask({title:'Mark not applicable',message:'This report will no longer be flagged as missing or included in reminders.',label:'Reason',required:true,confirm:'Mark not applicable'});if(r!==null)act(()=>source.setNotApplicable(slot,r),'Marked not applicable')});
  q('#coa-reopen')&&(q('#coa-reopen').onclick=async()=>{let r=await ask({title:'Reopen this report?',message:i.status==='approved'?'COA loses access to the files until you approve again.':'The report returns to the checklist and reminders.',label:'Reason',required:true,confirm:'Reopen'});if(r!==null)act(()=>source.reopen(i.key,r),'Reopened')})}
function closePanel(){ui.selected=null;drawTable();drawPanel()}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&PAGES.includes(page)&&ui.selected&&!document.querySelector('dialog[open]')&&!e.target.matches?.('input,textarea,select'))closePanel()});

async function addFiles(item,list){let seq=Date.now();const bucket=staged;
  const existing=data.files.filter(f=>!f.supersededAt).map(f=>({sha256:f.sha256,name:f.name,itemKey:f.itemKey,label:slotLabel(f.itemKey)}));
  for(const file of list){if(staged!==bucket)return;const entry={id:seq++,name:file.name,size:file.size,type:file.type,state:'checking',precheck:null,sha256:null};bucket.files.push(entry);drawPanel();
    try{let sheets=null,readError=null;
      if(file.size>0&&file.size<=P.MAX_BYTES){const buf=await file.arrayBuffer();entry.bytes=new Uint8Array(buf);entry.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buf))].map(b=>b.toString(16).padStart(2,'0')).join('');
        if(bucket.files.some(f=>f!==entry&&f.sha256===entry.sha256)){bucket.files=bucket.files.filter(f=>f!==entry);toast(`${file.name} is already in the list`);if(staged===bucket)drawPanel();continue}
        if(P.READABLE_SHEETS.includes(P.ext(file.name))){try{sheets=(await desktop.coaReadSheets({name:file.name,data:new Uint8Array(buf)})).sheets}catch(e){readError=ipcMessage(e)}}}
      entry.precheck=P.precheck({file:{name:file.name,size:file.size,sha256:entry.sha256},sheets,readError,item,units:data.config.units,existingFiles:existing,today:S.todayManila()})}
    catch(e){entry.precheck={findings:[{severity:'block',code:'READ_FAILED',title:'Could not read the file',detail:ipcMessage(e)}],blocked:true}}
    entry.state='ready';if(staged===bucket)drawPanel()}}

// ---------- confirmation / reason dialog ----------
let dialog;
function ask({title,message,label,required=false,confirm='OK'}){if(!dialog){dialog=document.createElement('dialog');dialog.className='coa-dialog';dialog.innerHTML='<form method="dialog"><h2></h2><p></p><label class="coa-field">Note<textarea rows="3"></textarea></label><p class="coa-error bad" hidden></p><footer><button value="cancel" type="submit">Cancel</button><button class="primary" value="ok" type="submit"></button></footer></form>';document.body.appendChild(dialog)}
  const form=dialog.querySelector('form'),field=dialog.querySelector('.coa-field'),ta=dialog.querySelector('textarea'),err=dialog.querySelector('.coa-error');
  dialog.querySelector('h2').textContent=title;dialog.querySelector('p').textContent=message||'';field.hidden=!label;if(label)field.firstChild.textContent=label;ta.value='';err.hidden=true;dialog.querySelector('[value=ok]').textContent=confirm;
  return new Promise(resolve=>{form.onsubmit=e=>{e.preventDefault();if(e.submitter?.value!=='ok'){dialog.close();return}if(label&&required&&!ta.value.trim()){err.textContent=`${label} is required.`;err.hidden=false;ta.focus();return}dialog.close('ok')};dialog.onclose=()=>resolve(dialog.returnValue==='ok'?ta.value.trim():null);dialog.returnValue='';dialog.showModal();(label?ta:dialog.querySelector('[value=ok]')).focus()})}

// ---------- daily desktop reminder ----------
function reminderSummary(){const r=S.reminderItems(mine(data.items),data.config.reminderDays),over=r.filter(i=>i.daysLeft<0).length,soon=r.length-over;
  const parts=[over&&`${over} overdue`,soon&&`${soon} due within ${data.config.reminderDays} days`].filter(Boolean);
  const lines=r.slice(0,3).map(i=>`${i.report.code} · ${short(i.unit.code)} · ${i.period.label}: ${S.countdownLabel(i)}`);if(r.length>3)lines.push(`and ${r.length-3} more`);
  return {count:r.length,title:`COA reports: ${parts.join(', ')||`nothing due within ${data.config.reminderDays} days`}`,body:lines.join('\n')||'All tracked reports are on schedule.'}}
async function checkReminder(force=false){if(!root.desktop?.coaReminder||!data||data.session.preview)return null;if(data.session.role==='coa'&&!force)return null;const s=reminderSummary();try{return await desktop.coaReminder({date:data.today,force,...s})}catch(e){return {shown:false,reason:ipcMessage(e)}}}

async function init(){if(root.desktop?.coaDesktop)try{prefs=await desktop.coaDesktop()}catch{}
  root.desktop?.onCoaOpen?.(()=>{Object.assign(ui,{office:'ALL',status:'open',freq:'',period:'',q:''});page='COA checklist';if(appReady())render()});
  try{await ensureLoaded()}catch{}if(appReady())render();remindIfDue();
  // Recheck every 15 minutes: the reminder fires once a day after 7:00 AM, and countdowns roll over at midnight.
  setInterval(async()=>{let before=data?.today;try{await load()}catch{return}if(data.today!==before&&appReady())render();remindIfDue()},15*60*1000)}
async function remindIfDue(){let r=await checkReminder();if(r?.shown&&root.desktop?.coaDesktop){try{prefs=await desktop.coaDesktop()}catch{}if(appReady()&&page==='COA overview')render()}}

// ---------- Access: registrations and members (Division Accountant, superadmin) ----------
const officesText=m=>m.role==='uploader'?m.offices.map(short).join(', '):'All offices';
const baseText=r=>r.base?`${D.BASES[r.base]}${r.base==='IU'&&r.unitCode?` · ${short(r.unitCode)}`:''}`:'—';
function accessPage(){const {session,members}=data,sa=session.role==='superadmin';
  const groups={all:members,waiting:members.filter(m=>!m.registered&&m.active!==false),registered:members.filter(m=>m.registered&&m.active!==false),off:members.filter(m=>m.active===false)};
  const tab=groups[ui.accessTab]?ui.accessTab:'all',list=groups[tab];
  const statusOf=m=>m.active===false?'<span class="coa-status s-not_applicable">Turned off</span>':m.registered?'<span class="coa-status s-approved">Registered</span>':'<span class="coa-status s-for_review">Waiting to register</span>';
  const rows=list.map(m=>{let locked=(m.role==='accountant'&&!sa)||m.role==='superadmin',self=m.email===session.email,lockTip=m.role==='superadmin'?'The superadmin account is changed in the database only':self?'This is you':'Only the superadmin can change a Division Accountant';return `<tr class="${m.active===false?'acc-off':''}"><td><b>${esc(m.name)}</b><div class="muted">${esc(m.email)}</div></td><td>${esc(baseText(m))}<div class="muted">${esc(m.position||'')}</div></td><td>${esc(D.ROLES[m.role])}<div class="muted">${esc(officesText(m))}</div></td><td>${statusOf(m)}</td><td class="acc-actions"><button data-edit="${esc(m.email)}" ${locked?`disabled title="${lockTip}"`:''}>Edit</button><button data-reset="${esc(m.email)}" ${locked||self||!m.registered?`disabled title="${!m.registered?'Not registered yet':lockTip}"`:''}>Reset password</button><button data-active="${esc(m.email)}" data-on="${m.active===false?1:0}" ${locked||self?`disabled title="${lockTip}"`:''}>${m.active===false?'Turn on':'Turn off'}</button></td></tr>`}).join('');
  const tabs=[['all','All'],['waiting','Waiting to register'],['registered','Registered'],['off','Turned off']];
  $c().innerHTML=heading('Allow users',sa?'Superadmin · allow emails and manage every account, including Division Accountants.':'Only emails allowed here can register in FundWork.',`<button class="primary" id="acc-add">${icon(ICONS.plus)} Allow user</button>`)+banner()+
  `<div class="segmented acc-tabs" role="tablist" aria-label="Users">${tabs.map(([k,l])=>`<button role="tab" data-tab="${k}" class="${tab===k?'active':''}" aria-selected="${tab===k}">${l} <span class="acc-count muted-count">${groups[k].length}</span></button>`).join('')}</div>`+
  `<div class="panel"><div class="table-wrap coa-table"><table><thead><tr><th>Name</th><th>Works at</th><th>Access</th><th>Status</th><th></th></tr></thead><tbody>${rows||'<tr><td class="empty-row" colspan="5">No users here</td></tr>'}</tbody></table></div><p class="muted">How it works: allow the person’s email here, then they choose Register in FundWork with that email and set their password. Forgot password? Use Reset password to give them a temporary one; FundWork asks them to choose a new password at sign-in.${sa?'':' Division Accountant accounts are allowed by the superadmin.'}</p></div>`;
  const act=async(fn,msg)=>{try{await fn();toast(msg)}catch(e){toast(e.message)}};
  $c().querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{ui.accessTab=b.dataset.tab;accessPage()});
  document.querySelector('#acc-add').onclick=()=>memberDialog(null);
  $c().querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>memberDialog(members.find(m=>m.email===b.dataset.edit)));
  $c().querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>resetPassword(members.find(m=>m.email===b.dataset.reset)));
  $c().querySelectorAll('[data-active]').forEach(b=>b.onclick=async()=>{let on=b.dataset.on==='1',m=members.find(x=>x.email===b.dataset.active);if(on||await ask({title:`Turn off access for ${m.name}?`,message:'They will no longer be able to sign in. Their uploads and history are kept.',confirm:'Turn off'})!==null)act(()=>source.setMemberActive(m.email,on),on?'Access turned on':'Access turned off')})}

/** Manual reset uses the registered name; a new password is required at sign-in. */
async function resetPassword(m){let temp;try{temp=D.resetPasswordFor(m)}catch(e){toast(e.message);return}
  if(await ask({title:`Reset the password for ${m.name}?`,message:`Their temporary password will be ${temp}. Their current password stops working, and they must choose a new password at sign-in.`,confirm:'Reset password'})===null)return;
  try{await source.resetMemberPassword(m.email,temp)}catch(e){toast(e.message);return}
  await ask({title:'Temporary password',message:`Give this to ${m.name} (${m.email}): ${temp}\n\nThey must choose a new password when they sign in.`,confirm:'Done'})}
let memberDlg;
/** Allow (or edit) a user: name, email, where they work and position. Role and offices follow from those. */
function memberDialog(m){const sa=data.session.role==='superadmin';if(!memberDlg){memberDlg=document.createElement('dialog');memberDlg.className='coa-dialog acc-dialog';document.body.appendChild(memberDlg)}
  if(sa)return roleDialog(m);
  const v={familyName:m?.familyName||'',firstName:m?.firstName||'',middleName:m?.middleName||'',email:m?.email||'',base:m?.base||'IU',unitCode:m?.unitCode||D.SCHOOL_UNITS[0],position:m?.position||''};
  const draw=()=>{const positions=D.POSITIONS[v.base];if(!positions.includes(v.position))v.position=positions[0];const a=D.accessFor(v),preview=D.personName(v);
    memberDlg.innerHTML=`<form method="dialog" novalidate><h2>${m?'Edit user':'Allow user'}</h2><div class="acc-form">
      <div class="acc-names"><label>Family name<input name="familyName" value="${esc(v.familyName)}" autocomplete="off" required></label><label>First name<input name="firstName" value="${esc(v.firstName)}" autocomplete="off" required></label><label>Middle name / initial<input name="middleName" value="${esc(v.middleName)}" placeholder="Optional" autocomplete="off"></label></div>
      <p class="acc-preview muted">${preview?`Shown as <b>${esc(preview)}</b>`:'Shown as Family, First Middle'}</p>
      <label>${v.base==='COA'?'Email':'DepEd email'}<input name="email" type="email" value="${esc(v.email)}" ${m?'readonly':''} placeholder="${v.base==='COA'?'name@example.com':'firstname.lastname@deped.gov.ph'}" required></label>
      <fieldset class="login-bases"><legend>Works at</legend>${[['IU','School (IU)','Implementing Unit'],['SDO','SDO','Division Office'],['COA','COA','Audit team']].map(([k,t,d])=>`<button type="button" role="radio" data-base="${k}" aria-checked="${v.base===k}" class="${v.base===k?'active':''}"><b>${t}</b><small>${d}</small></button>`).join('')}</fieldset>
      <div class="login-row">${v.base==='IU'?`<label>School<select name="unitCode">${D.SCHOOL_UNITS.map(c=>`<option value="${c}" ${v.unitCode===c?'selected':''}>${esc(data.config.units.find(u=>u.code===c)?.name||c)}</option>`).join('')}</select></label>`:''}<label>Position<select name="position">${positions.map(x=>`<option ${v.position===x?'selected':''} ${x==='Accountant'&&!sa?'disabled':''}>${esc(x)}${x==='Accountant'&&!sa?' (superadmin only)':''}</option>`).join('')}</select></label></div>
      <p class="login-access">Access: <b>${esc(D.ROLES[a.role])}</b>${a.role==='uploader'?` · uploads for ${esc(a.offices.map(short).join(' and '))}`:a.role==='coa'?' · sees reports released to COA':' · reviews and releases all offices'}</p>
      </div><p class="coa-error bad" hidden></p><footer><button value="cancel" type="submit">Cancel</button><button class="primary" value="ok" type="submit">${m?'Save changes':'Allow'}</button></footer></form>`;
    const f=memberDlg.querySelector('form'),err=memberDlg.querySelector('.coa-error');
    const keep=()=>{for(const k of ['familyName','firstName','middleName','email','unitCode','position'])if(f[k])v[k]=f[k].value};
    ['familyName','firstName','middleName'].forEach(k=>f[k].oninput=()=>{root.CoaLogin?.capInput(f[k]);keep();let p=D.personName(v);memberDlg.querySelector('.acc-preview').innerHTML=p?`Shown as <b>${esc(p)}</b>`:'Shown as Family, First Middle'});
    memberDlg.querySelectorAll('[data-base]').forEach(b=>b.onclick=()=>{keep();v.base=b.dataset.base;draw()});
    f.unitCode&&(f.unitCode.onchange=()=>{keep();draw()});f.position.onchange=()=>{keep();draw()};
    f.onsubmit=async ev=>{ev.preventDefault();if(ev.submitter?.value!=='ok'){memberDlg.close();return}keep();try{let saved=await source.saveMember(v);memberDlg.close();toast(m?'User updated':`${saved.name} is allowed. They can now register with ${saved.email}.`)}catch(e){err.textContent=e.message;err.hidden=false}}};
  draw();memberDlg.showModal();memberDlg.querySelector('[name=familyName]').focus()}

/** Superadmin version: email and role only. The person adds their name when they register. */
function roleDialog(m){const v={email:m?.email||'',choice:m?D.roleChoiceOf(m):'bnhs'};
  const draw=()=>{const isCoa=v.choice==='coa';
    memberDlg.innerHTML=`<form method="dialog" novalidate><h2>${m?'Change role':'Allow user'}</h2><div class="acc-form"><label>${isCoa?'Email':'DepEd email'}<input name="email" type="email" value="${esc(v.email)}" ${m?'readonly':''} placeholder="${isCoa?'name@example.com':'firstname.lastname@deped.gov.ph'}" autocomplete="off" required></label><label>Role<select name="choice">${D.ROLE_CHOICES.map(([k,l])=>`<option value="${k}" ${v.choice===k?'selected':''}>${esc(l)}</option>`).join('')}</select></label><p class="muted">${m?'Their name stays as they registered it.':'They choose Register in FundWork with this email and type their name and password.'}${isCoa?' COA personnel may use any email.':' School (IU) and SDO staff use their DepEd email.'}</p></div><p class="coa-error bad" hidden></p><footer><button value="cancel" type="submit">Cancel</button><button class="primary" value="ok" type="submit">${m?'Save':'Allow'}</button></footer></form>`;
    const f=memberDlg.querySelector('form'),err=memberDlg.querySelector('.coa-error');
    f.choice.onchange=()=>{v.email=f.email.value;v.choice=f.choice.value;draw();memberDlg.querySelector('[name=choice]').focus()};
    f.onsubmit=async ev=>{ev.preventDefault();if(ev.submitter?.value!=='ok'){memberDlg.close();return}v.email=f.email.value;v.choice=f.choice.value;const c=D.ROLE_CHOICES.find(([k])=>k===v.choice)[2];
      try{let saved=await source.saveMember({email:v.email,...c});memberDlg.close();toast(m?'Role updated':`${saved.email} is allowed as ${D.ROLE_CHOICES.find(([k])=>k===v.choice)[1]}. They can now register.`)}catch(e){err.textContent=e.message;err.hidden=false}}};
  draw();memberDlg.showModal();memberDlg.querySelector(m?'[name=choice]':'[name=email]').focus()}

// ---------- Supabase connection (superadmin) ----------
// The project URL and publishable key ship in coa/supabase.config.json; this page only checks the connection.
let backendTest=null;
async function backendPage(retest=false){$c().innerHTML='<p class="muted">Checking the Supabase connection…</p>';let b;
  try{b=await desktop.backendGet();if(!backendTest||retest)backendTest=await desktop.backendTest({url:b.url,publishableKey:b.publishableKey})}catch(e){backendTest={ok:false,message:ipcMessage(e)}}
  if(page!=='COA backend')return;const t=backendTest;
  const status=t.ok&&t.db==='ready'?`<div class="success"><b>Connected.</b> The shared database is set up.${t.emailEnabled&&t.signupEnabled?'':' Turn on email sign-up in Supabase Auth so people can register.'}${t.autoconfirm?'':' Turn off “Confirm email” in Supabase → Authentication → Sign In / Providers → Email: FundWork sends no emails.'}</div>`
    :t.ok?`<div class="warning"><b>Connected, but the database is not set up.</b> Run <code>npm run supabase -- migrate</code> on the setup computer.</div>`
    :`<div class="warning"><b>Cannot connect.</b> ${esc(t.message||'Check the internet connection.')}</div>`;
  $c().innerHTML=heading('Supabase','Shared database for COA Submissions. Books stay on each computer.',`<button id="be-retest">Check again</button>`)+status+
  `<div class="panel acc-panel"><dl class="coa-facts acc-facts"><dt>Project</dt><dd>${esc(b?.url||'—')}</dd><dt>Key</dt><dd>Publishable key built into FundWork</dd></dl><p class="muted">FundWork uses this database for shared accounts, registration, submissions and reviews.</p></div>`;
  document.querySelector('#be-retest').onclick=()=>backendPage(true)}

// ---------- Account settings (every signed-in person) ----------
function accountPage(){const s=data.realSession,sa=s.role==='superadmin';
  const facts=sa?[['Account','Superadmin'],['Scope','All functions, accounts, reports and audit history']]:[['Name',esc(s.name)],['Email',esc(s.email)],['Role',esc(D.ROLES[s.role])],['Offices',esc(officesText(s))],['Works at',esc(baseText(s))],['Position',esc(s.position||'—')]];
  $c().innerHTML=heading('Account settings',sa?'Shared superadmin account and password.':'Your profile and password.')+
  `<div class="panel acc-panel"><h3>Profile</h3><dl class="coa-facts acc-facts">${facts.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${sa?'':'<p class="muted">To change your role or offices, contact the Division Accountant.</p>'}</div>`+
  `<div class="panel acc-panel"><h3>Change password</h3><form id="pw-form" class="acc-form" novalidate>${root.CoaLogin.pw('pw-cur','Current password','current-password')}${root.CoaLogin.pw('pw-new','New password','new-password')}${root.CoaLogin.pw('pw-new2','Confirm new password','new-password')}<p class="muted">At least 8 characters, with letters and numbers.</p><p class="coa-error bad" id="pw-err" hidden></p><div class="toolbar"><button class="primary" type="submit">Change password</button></div></form></div>`+
  `<div class="panel acc-panel"><h3>Sign out</h3><p>Sign out of FundWork on this computer.</p><div class="toolbar"><button id="acc-signout">Sign out</button></div></div>`;
  const f=document.querySelector('#pw-form'),err=document.querySelector('#pw-err');
  f.onsubmit=async ev=>{ev.preventDefault();err.hidden=true;let cur=f.querySelector('#pw-cur').value,next=f.querySelector('#pw-new').value;try{if(next!==f.querySelector('#pw-new2').value)throw Error('The new passwords do not match');if(sa&&source.kind!=='supabase')await desktop.adminChange({current:cur,next});else await source.changePassword(cur,next);f.reset();toast('Password changed')}catch(e){err.textContent=ipcMessage(e);err.hidden=false}};
  document.querySelector('#acc-signout').onclick=()=>root.CoaLogin?.signOut()}

root.CoaUI={PAGES,VIEW_AS,setViewAs,get viewAs(){return viewAs},navLabel,navAllowed,homePage,navBadge,afterRender,checkReminder,init,get source(){return source}};
init();
})(globalThis);
