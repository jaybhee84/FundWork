// Explicit integration check against the configured project; removes its test accounts.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
globalThis.CoaDemo=require('../coa/demo-source');
const {createSupabaseSource}=require('../coa/supabase-source');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'coa/supabase.config.json'),'utf8'));
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env.supabase'),'utf8').split(/\r?\n/).map(l=>/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean).map(m=>[m[1],m[2].replace(/^['"]|['"]$/g,'')]));
const suffix=Date.now(),admin=`fw-test-admin-${suffix}@example.com`,email=`fw-test-user-${suffix}@deped.gov.ph`,password=require('node:crypto').randomBytes(20).toString('hex')+'Ab1';
async function sql(query){const r=await fetch(`https://api.supabase.com/v1/projects/${new URL(cfg.url).hostname.split('.')[0]}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});if(!r.ok)throw Error('Test database setup failed: '+r.status);return r.json()}
async function request(a){const headers={apikey:cfg.publishableKey,'Content-Type':'application/json'};if(a.token)headers.Authorization='Bearer '+a.token;const r=await fetch(cfg.url+a.path,{method:a.method||'GET',headers,body:a.body===undefined?undefined:JSON.stringify(a.body)});const b=await r.json().catch(()=>null);if(!r.ok)throw Error(b?.msg||b?.message||'Request failed: '+r.status);return b}
async function main(){
  try{
    await sql(`insert into public.members(email,name,role) values ('${admin}','Integration Test','superadmin')`);
    const signup=await request({path:'/auth/v1/signup',method:'POST',body:{email:admin,password}});
    assert(signup.access_token,'Test requires the project’s existing no-email registration configuration');
    assert.equal(await request({path:'/rest/v1/rpc/can_upload',method:'POST',token:signup.access_token,body:{p_unit:'BNHS'}}),true,'Superadmin may upload for any office');
    await assert.rejects(request({path:'/rest/v1/rpc/review_submission',method:'POST',token:signup.access_token,body:{p_id:'00000000-0000-0000-0000-000000000000',p_decision:'approve',p_note:null}}),/Submission not found/,'Superadmin passes the reviewer permission check');
    const first=createSupabaseSource(request);
    await first.signIn(admin,password);
    await first.saveMember({email,base:'SDO',position:'Senior Bookkeeper'});
    const second=createSupabaseSource(request);
    await second.signIn(admin,password);
    assert.equal((await second.listMembers()).find(m=>m.email===email).registered,false);
    await second.signOut();
    const registration=await second.register({email,password,familyName:'Test',firstName:'Shared',middleName:''});
    assert.equal(registration.registered,true);
    await second.signIn(email,password);
    assert.equal((await second.getSession()).role,'uploader');
    assert(!(await second.listMembers()).some(m=>m.role==='superadmin'),'Accountant must not receive the private superadmin row');
    await assert.rejects(second.saveMember({email:`forbidden-${suffix}@deped.gov.ph`,base:'SDO',position:'Accountant'}),/Division Accountant|superadmin/);
    assert((await second.getConfig()).units.length>0);
    await second.listSubmissions();await second.listFiles();await second.listActivity();
    await first.resetMemberPassword(email,'ignored-value');
    await second.signOut();
    await second.signIn(email,'Test_S');
    assert.equal((await second.getSession()).mustChangePassword,true);
    await second.changePassword('Test_S',password+'9');
    assert.equal((await second.getSession()).mustChangePassword,false);
    await first.setMemberActive(email,false);
    await assert.rejects(second.getSession());
    console.log('Shared allowlist, independent sessions, registration, permissions and deactivation checks passed');
  }finally{
    await sql(`delete from public.activity_log where actor_email in ('${admin}','${email}') or details->>'email' in ('${admin}','${email}'); delete from auth.users where email in ('${admin}','${email}'); delete from public.members where email in ('${admin}','${email}');`);
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
