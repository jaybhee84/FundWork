// In-memory COA submissions data source used until the shared backend exists.
// The Supabase source (step 4) implements the same async interface, and its RPCs
// enforce the same rules on the server. Nothing here is saved to disk.
(function(root){
const S=root.CoaSchedule||require('./schedule');

// Role keys match the planned database; labels are what people see.
const ROLES={accountant:'Division Accountant',uploader:'Senior Bookkeeper',coa:'COA personnel',superadmin:'Superadmin'};
const MAX_ATTEMPTS=5,LOCK_MS=5*60*1000;
// Demo accounts all start with this password; registrations choose their own.
const DEMO_PASSWORD='demo1234';
// Allowed users: the Division Accountant or superadmin allows an email and says where the person works.
// IU = Implementing Unit, a school that keeps its own books. Only allowed emails can register.
const BASES={IU:'School (Implementing Unit)',SDO:'Schools Division Office',COA:'COA'};
const SCHOOL_UNITS=['BNHS','BEGANG'];
const POSITIONS={IU:['Senior Bookkeeper'],SDO:['Senior Bookkeeper','Accountant'],COA:['Auditor','Audit Team Leader','State Auditor']};
/** Role and offices that follow from where someone works. */
function accessFor({base,unitCode,position}){if(base==='IU')return {role:'uploader',offices:[unitCode]};if(base==='SDO')return position==='Accountant'?{role:'accountant',offices:[...ALL_UNITS]}:{role:'uploader',offices:['SDO','CONSO']};return {role:'coa',offices:[...ALL_UNITS]}}
// School (IU) and SDO staff sign in with their DepEd email; COA personnel use their own.
const DEPED_DOMAIN='deped.gov.ph';
const isDepEdEmail=e=>String(e||'').toLowerCase().endsWith('@'+DEPED_DOMAIN);
function requireDepEdEmail(email,who){if(!isDepEdEmail(email))throw Error(`${who} must use a DepEd email (@${DEPED_DOMAIN}). Only COA personnel may use another email.`)}
/** First letter of every word in capitals, the rest lower case (same rule as Postgres initcap):
    "dela cruz" → "Dela Cruz", "MARIA CLARA" → "Maria Clara". */
function capitalizeName(v){return String(v||'').trim().replace(/\s+/g,' ').toLowerCase().replace(/(^|[^a-zà-öø-ÿ])([a-zà-öø-ÿ])/g,(m,a,b)=>a+b.toUpperCase())}
/** Same capitalisation while typing: keeps spaces so the cursor does not jump ("maria c" → "Maria C"). */
function capitalizeTyping(v){return String(v||'').toLowerCase().replace(/(^|[^a-zà-öø-ÿ])([a-zà-öø-ÿ])/g,(m,a,b)=>a+b.toUpperCase())}
/** Family, First Middle: "Dela Cruz, Maria Clara D." A one-letter middle name gets a period. */
function personName({familyName,firstName,middleName}={}){let f=capitalizeName(familyName),g=capitalizeName(firstName),m=capitalizeName(middleName).replace(/\.$/,'');if(m.length===1)m+='.';return f&&g?`${f}, ${g}${m?' '+m:''}`:''}
function resetPasswordFor(member){const family=capitalizeName(member?.familyName),first=capitalizeName(member?.firstName);if(!family||!first)throw Error('This account needs a family name and first name before resetting its password');return family+'_'+Array.from(first)[0].toUpperCase()}
const SUPERADMIN={email:'superadmin@local',name:'Superadmin',role:'superadmin',offices:[],active:true};
const ALL_UNITS=S.DEFAULT_UNITS.map(u=>u.code);

function canUpload(member,unitCode){return !!member&&member.active!==false&&(['accountant','superadmin'].includes(member.role)||(member.role==='uploader'&&member.offices.includes(unitCode)))}
function canReview(member){return !!member&&member.active!==false&&['accountant','superadmin'].includes(member.role)}
function canManageMembers(member){return !!member&&member.active!==false&&(member.role==='accountant'||member.role==='superadmin')}

/** Interface shared by every data source. All methods are async. */
const INTERFACE=['signIn','register','changePassword','resetMemberPassword','signOut','getSession','setMemberActive','saveMember','listMembers','getConfig','listSubmissions','listFiles','listActivity','submitFiles','resubmit','approve','returnForRevision','setNotApplicable','reopen','removeFile','subscribe'];

function createDemoSource(opts={}){
  const today=opts.today||S.todayManila(),clock=opts.now||(()=>new Date().toISOString()),nowMs=opts.nowMs||(()=>Date.now());
  const [ty,tm]=today.split('-').map(Number),prev=tm===1?`${ty-1}-12`:`${ty}-${String(tm-1).padStart(2,'0')}`;
  const config={units:S.DEFAULT_UNITS,reportTypes:[...S.DEFAULT_REPORT_TYPES,...(root.CoaSpecial||require('./special')).reports],trackingStart:opts.trackingStart||'2026-01-01',reminderDays:10,horizonDays:45};
  // Sample accounts are for tests only (opts.sampleAccounts); the app starts with none.
  const members=opts.sampleAccounts===false?[]:[
    {email:'accountant@demo.local',name:'Division Accountant',role:'accountant',offices:ALL_UNITS,base:'SDO',position:'Accountant',active:true},
    {email:'sdo.bookkeeper@demo.local',name:'SDO Senior Bookkeeper',role:'uploader',offices:['SDO','CONSO'],base:'SDO',position:'Senior Bookkeeper',active:true},
    {email:'bnhs.bookkeeper@demo.local',name:'BNHS Senior Bookkeeper',role:'uploader',offices:['BNHS'],base:'IU',unitCode:'BNHS',position:'Senior Bookkeeper',active:true},
    {email:'benhs.bookkeeper@demo.local',name:'BeNHS Senior Bookkeeper',role:'uploader',offices:['BEGANG'],base:'IU',unitCode:'BEGANG',position:'Senior Bookkeeper',active:true},
    {email:'coa@demo.local',name:'COA Auditor',role:'coa',offices:ALL_UNITS,base:'COA',position:'Auditor',active:true}];
  // Passwords live only in this in-memory demo. The shared backend (Supabase Auth) stores them hashed on the server.
  const passwords=new Map(members.map(m=>[m.email,DEMO_PASSWORD])),failures=new Map();
  // Allowed but not registered yet, so the Allow users list shows both states.
  if(opts.seed!==false)members.push({email:'coa.leader@coa.gov.ph',name:'COA Audit Team Leader',role:'coa',offices:[...ALL_UNITS],base:'COA',position:'Audit Team Leader',active:true});
  if(opts.accessState){
    if(opts.accessState.version!==1||!Array.isArray(opts.accessState.members)||!Array.isArray(opts.accessState.passwords))throw Error('Invalid saved account records');
    members.splice(0,members.length,...opts.accessState.members);
    passwords.clear();for(const [email,password] of opts.accessState.passwords)passwords.set(email,password);
  }
  // Signed out unless a session is passed in (the app restores the last demo sign-in).
  let me=null,seq=0;const subs=new Map(),files=[],log=[],listeners=new Set();
  const id=p=>`${p}-${++seq}`;
  const memberOf=email=>members.find(m=>m.email===String(email||'').trim().toLowerCase());
  if(opts.session){me=memberOf(opts.session)||null}
  const requireSession=()=>{if(!me)throw Error('Sign in first');if(me.active===false){me=null;setTimeout(changed,0);throw Error('Your access has been turned off')}};
  const requireManager=()=>{requireSession();if(!canManageMembers(me))throw Error('Only the Division Accountant or the superadmin can manage access')};
  function cleanEmail(e){e=String(e||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))throw Error('Enter a valid email address');return e}
  function checkPassword(pw){pw=String(pw??'');if(pw.length<8)throw Error('Use at least 8 characters for the password');if(!/[a-z]/i.test(pw)||!/\d/.test(pw))throw Error('Use both letters and numbers in the password')}
  const report=code=>config.reportTypes.find(r=>r.code===code);
  const unit=code=>config.units.find(u=>u.code===code);
  const changed=()=>{opts.saveAccess?.({version:1,members:JSON.parse(JSON.stringify(members)),passwords:[...passwords]});listeners.forEach(fn=>{try{fn()}catch{}})};
  const copy=v=>JSON.parse(JSON.stringify(v));
  function record(key,action,details={},by=me.email,at=clock()){log.push({id:id('act'),itemKey:key,action,details,by,byName:memberOf(by)?.name||by,at})}
  function slotLabel(s){return `${s.reportCode} · ${unit(s.unitCode)?.name||s.unitCode} · ${s.periodLabel}`}
  function getRow(key){let s=subs.get(key);if(!s)throw Error('Nothing has been submitted for this report yet');return s}
  function ensureRow(item){let key=S.itemKey(item.reportCode,item.unitCode,item.periodKey);let s=subs.get(key);if(!s){if(!report(item.reportCode)||!unit(item.unitCode))throw Error('Unknown report or office');let p=S.periodFromKey(item.periodKey);const r=report(item.reportCode);if(r.requestCode&&(r.requestDate>today||!r.periods.includes(item.periodKey)||!r.appliesTo.includes(item.unitCode)))throw Error('This office or period is not part of the special request');if(p.start>today)throw Error('Future reporting periods are not available for upload');s={id:id('sub'),key,reportCode:item.reportCode,unitCode:item.unitCode,periodKey:item.periodKey,periodLabel:p.label,dueDate:S.computeDueDate(report(item.reportCode).dueRule,p),status:'missing',reviewNote:null,reviewedBy:null,reviewedAt:null,approvedAt:null,updatedAt:clock()};subs.set(key,s)}return s}
  const currentFiles=key=>files.filter(f=>f.itemKey===key&&!f.supersededAt);
  function requireReviewer(){requireSession();if(!canReview(me))throw Error('Only the Division Accountant can do this')}

  const api={
    kind:'demo',
    ROLES,
    /** Email + password sign-in. Five wrong passwords lock the account for 5 minutes. */
    async signIn(email,password){email=cleanEmail(email);let m=memberOf(email);
      if(!m)throw Error('This email is not on the allowed list. Ask the Division Accountant to allow it.');
      if(m.active===false)throw Error('Your access has been turned off. Contact the Division Accountant.');
      let f=failures.get(email)||{count:0,until:0};if(f.until>nowMs())throw Error(`Too many incorrect attempts. Try again in ${Math.ceil((f.until-nowMs())/60000)} minutes.`);
      if(!passwords.has(email))throw Error('This email is allowed but not registered yet. Choose Register to set your password.');
      if(passwords.get(email)!==String(password??'')){f.count++;if(f.count>=MAX_ATTEMPTS){failures.set(email,{count:0,until:nowMs()+LOCK_MS});throw Error('Too many incorrect attempts. This account is locked for 5 minutes.')}failures.set(email,f);throw Error(`Incorrect email or password. ${MAX_ATTEMPTS-f.count} attempt${MAX_ATTEMPTS-f.count===1?'':'s'} left.`)}
      failures.delete(email);me=m;changed();return copy(me)},
    /** Registration: only allowed emails. The person chooses a password; the role comes from the allowed entry. No email is sent. */
    async register(d){let email=cleanEmail(d?.email),m=memberOf(email);
      if(!m)throw Error('This email is not on the allowed list. Ask the Division Accountant to allow it first.');
      if(m.active===false)throw Error('Your access has been turned off. Contact the Division Accountant.');
      if(passwords.has(email))throw Error('This email is already registered. Use Sign in.');
      let familyName=capitalizeName(d?.familyName),firstName=capitalizeName(d?.firstName),middleName=capitalizeName(d?.middleName);if(!familyName)throw Error('Enter your family name');if(!firstName)throw Error('Enter your first name');
      checkPassword(d?.password);Object.assign(m,{familyName,firstName,middleName,name:personName({familyName,firstName,middleName})});passwords.set(email,String(d.password));record(null,'member_register',{email},email,clock());changed();return {registered:true,member:copy(m)}},
    /** Forgot password: the Division Accountant or superadmin sets a temporary password; it must be changed at the next sign-in. */
    async resetMemberPassword(email,temp){requireManager();let m=memberOf(email);if(!m)throw Error('Unknown user');if(m.email===me.email)throw Error('Change your own password in Account settings');if(m.role==='accountant'&&me.role!=='superadmin')throw Error('Only the superadmin can reset a Division Accountant’s password');if(!passwords.has(m.email))throw Error(`${m.name} has not registered yet`);temp=resetPasswordFor(m);passwords.set(m.email,temp);failures.delete(m.email);m.mustChangePassword=true;record(null,'password_reset',{email:m.email},me.email,clock());changed();return true},
    /** Account settings: change your own password. */
    async changePassword(current,next){requireSession();if(me.role==='superadmin')throw Error('The superadmin password is changed separately');if(passwords.get(me.email)!==String(current??''))throw Error('Your current password is incorrect');checkPassword(next);if(String(next)===String(current))throw Error('Choose a password different from the current one');passwords.set(me.email,String(next));me.mustChangePassword=false;changed();record(null,'password_change',{email:me.email},me.email,clock());return true},
    /** Demo stand-in for the superadmin session. The password is checked in the main process before this is called. */
    async enterSuperadmin(){me=SUPERADMIN;changed();return copy(me)},
    async signOut(){me=null;changed()},
    async getSession(){return me?copy(me):null},
    async setMemberActive(email,active){requireManager();let m=memberOf(email);if(!m)throw Error('Unknown user');if(m.email===me.email)throw Error('You cannot turn off your own access');if(m.role==='accountant'&&me.role!=='superadmin')throw Error('Only the superadmin can change a Division Accountant');if(m.role==='accountant'&&!active&&members.filter(x=>x.role==='accountant'&&x.active!==false).length<2)throw Error('At least one Division Accountant must keep access');m.active=!!active;record(null,active?'member_activate':'member_deactivate',{email:m.email},me.email,clock());changed();return copy(m)},
    /** Allow (or edit) a user. Where they work and their position decide the role and offices.
        IU and SDO staff need a DepEd email; allowing or changing a Division Accountant is superadmin-only. */
    async saveMember(d){requireManager();let email=cleanEmail(d?.email),familyName=capitalizeName(d?.familyName),firstName=capitalizeName(d?.firstName),middleName=capitalizeName(d?.middleName),name=personName({familyName,firstName,middleName}),base=d?.base,position=String(d?.position||'').trim(),unitCode=base==='IU'?d?.unitCode:null;
      // Names are optional when allowing (the person types them at registration); give both or neither.
      if(!!familyName!==!!firstName)throw Error(familyName?'Enter the first name':'Enter the family name');if(!BASES[base])throw Error('Choose where they work: School (IU), SDO or COA');if(base==='IU'&&!SCHOOL_UNITS.includes(unitCode))throw Error('Choose the school');if(!POSITIONS[base].includes(position))throw Error('Choose the position');
      let {role,offices}=accessFor({base,unitCode,position}),m=memberOf(email);
      if(base!=='COA'&&(!m||m.role==='coa'))requireDepEdEmail(email,base==='IU'?'School (IU) staff':'SDO staff');
      if((role==='accountant'||m?.role==='accountant')&&me.role!=='superadmin')throw Error('Only the superadmin can allow or change a Division Accountant');
      if(m&&m.role==='accountant'&&role!=='accountant'&&members.filter(x=>x.role==='accountant'&&x.active!==false).length<2)throw Error('At least one Division Accountant must keep access');
      let at=clock(),entry={role,offices,base,unitCode,position,...(familyName?{name,familyName,firstName,middleName}:m?{}:{name:email,familyName:null,firstName:null,middleName:null})};if(m){let old={role:m.role,offices:m.offices,name:m.name};Object.assign(m,entry);record(null,'member_update',{email,old,role,offices},me.email,at)}else{members.push({email,...entry,active:true});record(null,'member_add',{email,role,offices},me.email,at)}
      changed();return copy(memberOf(email))},
    /** Demo only: switch the signed-in person to try each role. */
    async switchUser(email){let m=memberOf(email);if(!m)throw Error('Unknown member');me=m;changed();return copy(me)},
    async listMembers(){requireSession();return copy(members.filter(m=>m.role!=='superadmin'||me.role==='superadmin').map(m=>({...m,registered:passwords.has(m.email)})))},
    async getConfig(){requireSession();return copy(config)},
    async listSubmissions(){requireSession();return copy([...subs.values()].filter(s=>me.role!=='coa'||s.status==='approved'))},
    async listFiles(){requireSession();let vis=new Set([...subs.values()].filter(s=>me.role!=='coa'||s.status==='approved').map(s=>s.key));return copy(files.filter(f=>vis.has(f.itemKey)&&(me.role!=='coa'||!f.supersededAt)))},
    async listActivity(key){requireSession();if(me.role==='coa')return [];return copy(log.filter(e=>!key||e.itemKey===key).reverse().sort((a,b)=>b.at.localeCompare(a.at)))},
    /** files: [{name,size,type,sha256,precheck}] — already pre-checked; blocked files are rejected. */
    async submitFiles({reportCode,unitCode,periodKey,files:incoming}){requireSession();
      if(!canUpload(me,unitCode))throw Error(me.role==='coa'?'COA auditors cannot upload':`You are not assigned to upload for ${unit(unitCode)?.name||unitCode}`);
      if(!incoming?.length)throw Error('Choose at least one file');
      if(incoming.some(f=>f.precheck?.blocked))throw Error('Remove files that failed the pre-check first');
      let key=S.itemKey(reportCode,unitCode,periodKey),existing=subs.get(key);
      if(existing?.status==='approved')throw Error('Already released to COA. Ask the Division Accountant to reopen it first');
      if(existing?.status==='not_applicable')throw Error('Marked not applicable. Ask the Division Accountant to reopen it first');
      let s=ensureRow({reportCode,unitCode,periodKey}),at=clock();
      for(const f of incoming){let rec={id:id('file'),itemKey:key,name:String(f.name),size:Number(f.size)||0,type:f.type||'',sha256:f.sha256||null,precheck:f.precheck||null,uploadedBy:me.email,uploadedByName:me.name,uploadedAt:at,supersededAt:null,supersededBy:null,supersedeReason:null};files.push(rec);record(key,'upload',{file:rec.name,findings:(rec.precheck?.findings||[]).filter(x=>x.severity==='warn').length},me.email,at)}
      let from=s.status;s.status='for_review';s.updatedAt=at;if(from==='returned')record(key,'resubmit',{},me.email,at);
      changed();return copy(s)},
    /** After a return, send the remaining current files back for review without uploading a new one. */
    async resubmit(key){requireSession();let s=getRow(key);if(!canUpload(me,s.unitCode))throw Error('You cannot submit for this office');if(s.status!=='returned')throw Error('Only returned items can be resubmitted');if(!currentFiles(key).length)throw Error('Upload a corrected file first');let at=clock();Object.assign(s,{status:'for_review',updatedAt:at});record(key,'resubmit',{files:currentFiles(key).length},me.email,at);changed();return copy(s)},
    async approve(key){requireReviewer();let s=getRow(key);if(s.status!=='for_review')throw Error('Only items waiting for review can be approved');if(!currentFiles(key).length)throw Error('Approving requires at least one current file');let at=clock();Object.assign(s,{status:'approved',reviewNote:null,reviewedBy:me.email,reviewedAt:at,approvedAt:at,updatedAt:at});record(key,'approve',{files:currentFiles(key).length},me.email,at);changed();return copy(s)},
    async returnForRevision(key,note){requireReviewer();note=String(note||'').trim();if(!note)throw Error('Returning requires a note for the uploader');let s=getRow(key);if(s.status!=='for_review')throw Error('Only items waiting for review can be returned');let at=clock();Object.assign(s,{status:'returned',reviewNote:note,reviewedBy:me.email,reviewedAt:at,updatedAt:at});record(key,'return',{note},me.email,at);changed();return copy(s)},
    async setNotApplicable(item,reason){requireSession();if(!canUpload(me,item.unitCode))throw Error('You cannot mark reports not applicable for this office');reason=String(reason||'').trim();if(!reason)throw Error('Give a reason for marking this not applicable');let s=ensureRow(item);if(s.status==='not_applicable')throw Error('Already marked not applicable');if(s.status==='approved')throw Error('Reopen the released report before marking it not applicable');let at=clock();Object.assign(s,{status:'not_applicable',reviewNote:reason,reviewedBy:me.email,reviewedAt:at,updatedAt:at});record(s.key,'not_applicable',{reason},me.email,at);changed();return copy(s)},
    async reopen(key,reason){requireReviewer();reason=String(reason||'').trim();if(!reason)throw Error('Reopening requires a reason');let s=getRow(key);if(!['approved','not_applicable'].includes(s.status))throw Error('Only released or not-applicable items can be reopened');let at=clock(),from=s.status;Object.assign(s,{status:currentFiles(key).length?'for_review':'missing',reviewNote:null,approvedAt:null,updatedAt:at});record(key,'reopen',{reason,from},me.email,at);changed();return copy(s)},
    async removeFile(fileId,reason){requireSession();let f=files.find(x=>x.id===fileId);if(!f)throw Error('File not found');if(f.supersededAt)throw Error('File was already removed');let s=getRow(f.itemKey);if(!canUpload(me,s.unitCode))throw Error('You cannot change files for this office');if(['approved','not_applicable'].includes(s.status))throw Error('Reopen the item before changing its files');let at=clock();Object.assign(f,{supersededAt:at,supersededBy:me.email,supersedeReason:String(reason||'').trim()||null});record(f.itemKey,'remove',{file:f.name,reason:f.supersedeReason},me.email,at);if(s.status==='for_review'&&!currentFiles(s.key).length)s.status='missing';s.updatedAt=at;changed();return copy(s)},
    subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)},
    slotLabel};

  if(opts.seed!==false)seed();
  function seed(){
    // A few realistic states for the previous month so every screen has something to show.
    const due=code=>S.computeDueDate(report(code).dueRule,S.periodFromKey(prev));
    const stamp=(date,hm)=>new Date(`${date}T${hm}:00+08:00`).toISOString();
    const pass={findings:[{severity:'pass',code:'TB_BALANCED',title:'Debit equals credit',detail:'48,215,330.18 on both sides (212 lines summed).'}],blocked:false};
    const plan=[
      ['MTB','SDO','sdo.bookkeeper@demo.local','approved',pass,'xlsx'],
      ['RCI','SDO','sdo.bookkeeper@demo.local','approved',{findings:[],blocked:false},'pdf'],
      ['MTB','BNHS','bnhs.bookkeeper@demo.local','for_review',{findings:[{severity:'warn',code:'TB_UNBALANCED',title:'Debit and credit do not agree',detail:'Debits 12,480,115.40 · Credits 12,479,615.40 · Difference 500.00 (164 lines summed).'}],blocked:false},'xlsx'],
      ['FAR4','BNHS','bnhs.bookkeeper@demo.local','for_review',{findings:[],blocked:false},'pdf'],
      ['RCI','BEGANG','benhs.bookkeeper@demo.local','returned',{findings:[],blocked:false},'pdf'],
      ['RADA','CONSO','accountant@demo.local','not_applicable',null,null]];
    plan.forEach(([code,u,by,status,pc,type],i)=>{let s=ensureRow({reportCode:code,unitCode:u,periodKey:prev}),d=due(code),early=n=>{let x=S.addDays(d,n);return x<today?x:today},up=stamp(early(-3),'08:1'+i);s.dueDate=d;
      if(type){let name=`${code} ${unit(u).name} ${S.periodFromKey(prev).label}.${type}`;files.push({id:id('file'),itemKey:s.key,name,size:180000+i*53211,type:'',sha256:`demo-${i}`,precheck:pc,uploadedBy:by,uploadedByName:memberOf(by).name,uploadedAt:up,supersededAt:null,supersededBy:null,supersedeReason:null});record(s.key,'upload',{file:name,findings:(pc?.findings||[]).filter(x=>x.severity==='warn').length},by,up);s.status='for_review';s.updatedAt=up}
      let rv=stamp(early(-1),'08:3'+i);
      if(status==='approved'){Object.assign(s,{status,reviewedBy:'accountant@demo.local',reviewedAt:rv,approvedAt:rv,updatedAt:rv});record(s.key,'approve',{files:1},'accountant@demo.local',rv)}
      if(status==='returned'){let note='Page 2 of the RCI is missing. Re-upload the complete signed copy.';Object.assign(s,{status,reviewNote:note,reviewedBy:'accountant@demo.local',reviewedAt:rv,updatedAt:rv});record(s.key,'return',{note},'accountant@demo.local',rv)}
      if(status==='not_applicable'){let reason='Demo: each office submits its own RADA.';Object.assign(s,{status,reviewNote:reason,reviewedBy:'accountant@demo.local',reviewedAt:rv,updatedAt:rv});record(s.key,'not_applicable',{reason},'accountant@demo.local',rv)}});
  }
  return api}

/** Roles the superadmin picks from: each one sets where the person works and their position. */
const ROLE_CHOICES=[['accountant','Division Accountant',{base:'SDO',position:'Accountant'}],['sdo','SDO Senior Bookkeeper',{base:'SDO',position:'Senior Bookkeeper'}],['bnhs','BNHS Senior Bookkeeper',{base:'IU',unitCode:'BNHS',position:'Senior Bookkeeper'}],['benhs','BeNHS Senior Bookkeeper',{base:'IU',unitCode:'BEGANG',position:'Senior Bookkeeper'}],['coa','COA personnel',{base:'COA',position:'Auditor'}]];
function roleChoiceOf(m){return (ROLE_CHOICES.find(([,,c])=>c.base===m?.base&&(c.unitCode||null)===(m?.unitCode||null)&&(m.base==='COA'||c.position===m.position))||[])[0]||''}
const api={ROLE_CHOICES,roleChoiceOf,resetPasswordFor,capitalizeName,capitalizeTyping,personName,DEMO_PASSWORD,DEPED_DOMAIN,isDepEdEmail,ROLES,BASES,SCHOOL_UNITS,POSITIONS,accessFor,INTERFACE,canUpload,canManageMembers,canReview,createDemoSource};
if(typeof module!=='undefined')module.exports=api;else root.CoaDemo=api;
})(globalThis);
