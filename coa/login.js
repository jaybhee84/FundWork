// Sign-in screen: email + password, registration (School IU / SDO / COA), forgot password,
// and the superadmin sign-in (click the logo 5 times). Also renders the account chip in the sidebar.
(function(root){
const D=root.CoaDemo,S=root.CoaSchedule;
const SHORT={SDO:'SDO',BNHS:'Basilan NHS',BEGANG:'Begang NHS',CONSO:'Conso'};
const ICON={eye:'<circle cx="12" cy="12" r="3"/><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/>',out:'<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',back:'<path d="M15 18l-6-6 6-6"/>'};
let el,view='signin',busy=false,clicks=[];
const st={email:'',reg:{familyName:'',firstName:'',middleName:'',email:''},code:null,adminPw:null,lastPw:null};
const ADMIN_EMAIL_KEY='fundwork.superadminEmail';
try{st.adminEmail=localStorage.getItem(ADMIN_EMAIL_KEY)||''}catch{st.adminEmail=''}
function rememberAdminEmail(email){st.adminEmail=String(email||'').trim().toLowerCase();try{localStorage.setItem(ADMIN_EMAIL_KEY,st.adminEmail)}catch{}}
const src=()=>root.CoaUI.source;
const q=s=>el.querySelector(s);
const val=s=>q(s)?.value??'';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ic=p=>`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

// Decorative gears use SVG so they stay crisp at any window size.
function gears(){
  const points=[];
  for(let i=0;i<48;i++){const a=i*Math.PI/24,r=[57,68,68,57][i%4];points.push(`${(80+r*Math.cos(a)).toFixed(2)},${(80+r*Math.sin(a)).toFixed(2)}`)}
  const outline='M'+points.join(' L')+' Z M97 80 A17 17 0 1 0 63 80 A17 17 0 1 0 97 80 Z';
  return ['left','right'].map(side=>`<div class="login-gears login-gears-${side}" aria-hidden="true">${Array.from({length:7},(_,i)=>{
    const id=`gear-${side}-${i}`;
    return `<div class="login-gear login-gear-${i}"><svg viewBox="0 0 160 170" fill="none"><defs><linearGradient id="${id}" x1="20" y1="10" x2="135" y2="150" gradientUnits="userSpaceOnUse"><stop stop-color="#f7fbff"/><stop offset=".28" stop-color="#b6cff5"/><stop offset=".52" stop-color="#729bd5"/><stop offset=".75" stop-color="#d7e8ff"/><stop offset="1" stop-color="#628bc5"/></linearGradient></defs><g class="login-gear-rotor"><path d="${outline}" fill="#486da7" fill-rule="evenodd" transform="translate(0 6)" stroke="#45699e" stroke-width="2"/><path d="${outline}" fill="url(#${id})" fill-rule="evenodd" stroke="#ecf5ff" stroke-width="1.5"/><circle cx="80" cy="80" r="39" stroke="#527cb4" stroke-width="3"/><circle cx="80" cy="79" r="36" stroke="#e4f1ff" stroke-width="2"/><circle cx="80" cy="80" r="20" stroke="#547bb0" stroke-width="4"/>${[0,1,2,3,4,5].map(n=>`<circle cx="80" cy="51" r="4" fill="#5278ad" stroke="#d7e8ff" transform="rotate(${n*60} 80 80)"/>`).join('')}</g></svg></div>`;
  }).join('')}</div>`).join('');
}
function go(v){view=v;draw()}
function fail(msg){let x=q('.login-error');if(x){x.classList.remove('ok');x.textContent=msg;x.hidden=!msg}}
async function run(btn,fn){if(busy)return;busy=true;fail('');let label=btn?.textContent;if(btn){btn.disabled=true;btn.textContent='Please wait…'}try{await fn()}catch(err){fail(String(err?.message||err).replace(/^Error invoking remote method '[^']+': (Error: )?/,''))}finally{busy=false;if(btn&&btn.isConnected){btn.disabled=false;btn.textContent=label}}}

function shell(body,{tabs=false}={}){return `<div class="login-card"><button type="button" class="login-logo" id="login-logo" aria-label="FundWork"><img src="assets/fundwork-logo-3d.png" alt="" width="48" height="48"></button><h1>FundWork</h1>${tabs?`<div class="segmented login-tabs" role="tablist"><button type="button" role="tab" data-view="signin" class="${view==='signin'?'active':''}" aria-selected="${view==='signin'}">Sign in</button><button type="button" role="tab" data-view="register" class="${view==='register'?'active':''}" aria-selected="${view==='register'}">Register</button></div>`:''}${body}</div><p class="login-foot">FundWork helps schools and division offices manage fund accounting, track report deadlines, and submit reports for COA review.</p>`}
const err='<p class="login-error" role="alert" hidden></p>';
/** Password box with an eye button to show or hide what was typed. */
const pw=(id,label,ac)=>`<label>${label}<span class="pw-wrap"><input id="${id}" type="password" autocomplete="${ac}" required><button type="button" class="pw-eye" aria-label="Show password" title="Show password">${ic(ICON.eye)}</button></span></label>`;
const backLink=(label='Back to sign in')=>`<button type="button" class="login-back" data-view="signin">${ic(ICON.back)}${label}</button>`;

function draw(){if(!el)return;let html='';
  if(view==='signin')html=shell(`<form id="login-form" novalidate><label>Email<input id="li-email" type="email" autocomplete="username" value="${e(st.email)}" required></label>${pw('li-pw','Password','current-password')}${err}<button class="primary login-submit" type="submit">Sign in</button><button type="button" class="login-link" data-view="forgot">Forgot password?</button></form>
`,{tabs:true});
  if(view==='register'){const r=st.reg;html=shell(`<form id="login-form" novalidate><p class="login-text">Only emails allowed by the Division Accountant can register. School (IU) and SDO staff use their DepEd email.</p><div class="login-names"><label>Family name<input id="rg-family" value="${e(r.familyName)}" autocomplete="family-name" required></label><label>First name<input id="rg-first" value="${e(r.firstName)}" autocomplete="given-name" required></label><label>M.I.<input id="rg-middle" value="${e(r.middleName)}" placeholder="Optional" autocomplete="additional-name"></label></div><p class="login-hint" id="rg-preview">${D.personName(r)?`Shown as ${e(D.personName(r))}`:'Shown as Family, First M.'}</p><label>Email<input id="rg-email" type="email" autocomplete="username" value="${e(r.email)}" placeholder="firstname.lastname@deped.gov.ph" required></label>${pw('rg-pw','Password','new-password')}${pw('rg-pw2','Confirm password','new-password')}<p class="login-hint">At least 8 characters, with letters and numbers.</p>${err}<button class="primary login-submit" type="submit">Register</button></form>`,{tabs:true})}
  if(view==='forgot')html=shell(`<div class="login-done"><h2>Forgot password</h2><p class="login-text">Temporary password hint: your family name with a capital first letter, followed by an underscore (_) and your capital first-name initial. Example: Bazan_J.</p></div>${backLink()}`);
  if(view==='force-change')html=shell(`<form id="login-form" novalidate><h2>Choose a new password</h2><p class="login-text">You signed in with a temporary password. Choose your own before continuing.</p>${pw('fc-pw','New password','new-password')}${pw('fc-pw2','Confirm new password','new-password')}<p class="login-hint">At least 8 characters, with letters and numbers.</p>${err}<button class="primary login-submit" type="submit">Save and continue</button></form><button type="button" class="login-back" id="fc-out">${ic(ICON.back)}Sign out</button>`);
  if(view==='registered')html=shell(`<div class="login-done"><h2>Account ready</h2><p class="login-text">${e(st.code?.name||'Your account')} can now sign in${st.code?.role?` as ${e(D.ROLES[st.code.role])}`:''}. ${st.code?.requiresConfirmation?'Confirm your email before signing in.':'Use your email and the password you just chose.'}</p><button type="button" class="primary login-submit" data-view="signin">Sign in</button></div>`);
  if(view==='admin')html=shell(`<form id="login-form" novalidate><h2>Superadmin</h2><p class="login-text">Manages shared accounts and Division Accountant access.</p>${src().kind==='supabase'?'<label>Email<input id="ad-email" type="email" autocomplete="username" required></label>':''}${pw('ad-pw','Password','current-password')}${err}<button class="primary login-submit" type="submit">Sign in</button></form>${backLink()}`);
  if(view==='admin-change')html=shell(`<form id="login-form" novalidate><h2>Set a new superadmin password</h2><p class="login-text">The default password must be changed before continuing.</p>${pw('ac-pw','New password','new-password')}${pw('ac-pw2','Confirm new password','new-password')}<p class="login-hint">At least 8 characters, with letters and numbers.</p>${err}<button class="primary login-submit" type="submit">Save and continue</button></form>${backLink('Cancel')}`);
  el.innerHTML=gears()+html;bind()}

function bind(){
  const adminEmail=q('#ad-email');if(adminEmail){adminEmail.value=st.adminEmail;adminEmail.oninput=()=>rememberAdminEmail(adminEmail.value)}
  q('#login-logo').onclick=()=>{let now=Date.now();clicks=clicks.filter(t=>now-t<2500);clicks.push(now);if(clicks.length>=5){clicks=[];go('admin')}};
  el.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{st.adminPw=null;go(b.dataset.view)});
  q('#fc-out')&&(q('#fc-out').onclick=()=>signOut());
  ['#rg-family','#rg-first','#rg-middle'].forEach(k=>q(k)&&(q(k).oninput=ev=>{capInput(ev.target);keepReg();let n=D.personName(st.reg);q('#rg-preview').textContent=n?`Shown as ${n}`:'Shown as Family, First M.'}));
  const form=q('#login-form');if(form)form.onsubmit=ev=>{ev.preventDefault();submit(form.querySelector('.login-submit'))};
  (view==='admin'&&st.adminEmail?q('#ad-pw'):(q('input:not([type=hidden])[value=""]')||q('input')))?.focus()}
function keepReg(){Object.assign(st.reg,{familyName:val('#rg-family'),firstName:val('#rg-first'),middleName:val('#rg-middle'),email:val('#rg-email')})}
/** Capitalise the first letter of every word as the person types, keeping the cursor in place. */
function capInput(i){const v=D.capitalizeTyping(i.value);if(v!==i.value){const p=i.selectionStart;i.value=v;i.setSelectionRange(p,p)}}
const same=(a,b)=>{if(val(a)!==val(b))throw Error('The passwords do not match')};

function submit(btn){run(btn,async()=>{
  if(view==='signin'){st.email=val('#li-email').trim();st.lastPw=val('#li-pw');await src().signIn(st.email,st.lastPw);return}
  if(view==='register'){keepReg();same('#rg-pw','#rg-pw2');let res=await src().register({...st.reg,password:val('#rg-pw')});st.code={name:res.member.name,role:res.member.role,requiresConfirmation:res.requiresConfirmation};st.email=st.reg.email;st.reg={familyName:'',firstName:'',middleName:'',email:''};go('registered');return}
  if(view==='force-change'){same('#fc-pw','#fc-pw2');await src().changePassword(st.lastPw,val('#fc-pw'));st.lastPw=null;return}
  if(view==='admin'&&src().kind==='supabase'){rememberAdminEmail(val('#ad-email'));await src().signIn(st.adminEmail,val('#ad-pw'));return}
  if(view==='admin'){let pw=val('#ad-pw'),r=await root.desktop.adminLogin(pw);if(r.mustChange){st.adminPw=pw;go('admin-change');return}await src().enterSuperadmin();return}
  if(view==='admin-change'){same('#ac-pw','#ac-pw2');await root.desktop.adminChange({current:st.adminPw,next:val('#ac-pw')});st.adminPw=null;await src().enterSuperadmin();return}
})}

// ---------- sidebar account chip ----------
function account(s){const a=document.querySelector('#account');if(!a)return;if(!s){a.innerHTML='';return}
  if(s.role==='superadmin'&&s.email!=='superadmin@local')rememberAdminEmail(s.email);
  const initials=(s.firstName&&s.familyName?s.firstName[0]+s.familyName[0]:s.name.split(/\s+/).map(w=>w[0]).slice(0,2).join('')).toUpperCase(),sub=s.name.includes(D.ROLES[s.role])?s.email:D.ROLES[s.role]+(s.role==='uploader'?` · ${s.offices.map(c=>SHORT[c]).join(', ')}`:'');
  const ui=root.CoaUI,viewAs=ui?.viewAs||'',picker=s.role==='superadmin'&&ui?`<label class="view-as">View as<select id="view-as">${ui.VIEW_AS.map(([k,l])=>`<option value="${k}" ${k===viewAs?'selected':''}>${e(l)}</option>`).join('')}</select></label>`:'';
  a.innerHTML=picker+`<div class="account"><button class="account-open" id="account-open" title="Account settings"><span class="avatar">${e(initials)}</span><span class="account-text"><b>${e(s.name)}</b><small>${e(sub)}</small></span></button><button class="account-out" id="sign-out" title="Sign out" aria-label="Sign out">${ic(ICON.out)}</button></div>`;
  a.querySelector('#account-open').onclick=()=>{page='Account settings';render()};
  a.querySelector('#sign-out').onclick=()=>signOut();
  a.querySelector('#view-as')&&(a.querySelector('#view-as').onchange=ev=>ui.setViewAs(ev.target.value))}
async function signOut(){try{page='Overview'}catch{}st.adminPw=null;st.lastPw=null;view='signin';await src().signOut()}

async function sync(){let s=null;try{s=await src().getSession()}catch{}const locked=!s||!!s.mustChangePassword;document.body.classList.remove('auth-pending');document.body.classList.toggle('signed-out',locked);if(s?.mustChangePassword){if(view!=='force-change'){view='force-change';draw()}}else if(!s){if(view==='force-change')view='signin';draw();setTimeout(()=>q('input')?.focus(),0)}account(locked?null:s)}

// Eye buttons on every password box in the app (sign-in screen, Account settings, dialogs).
document.addEventListener('click',ev=>{const b=ev.target.closest('.pw-eye');if(!b)return;const i=b.previousElementSibling,show=i.type==='password';i.type=show?'text':'password';b.classList.toggle('on',show);b.setAttribute('aria-label',show?'Hide password':'Show password');b.title=show?'Hide password':'Show password';i.focus()});
function init(){el=document.createElement('div');el.id='login';el.className='login';document.body.appendChild(el);src().subscribe(sync);sync()}
root.CoaLogin={signOut,sync,pw,capInput};
init();
})(globalThis);
