// Shared Supabase source. Auth tokens live only for the current app session.
(function(root){
function createSupabaseSource(request){
  let auth=null,me=null,refreshing=null;
  const listeners=new Set(),emit=()=>listeners.forEach(fn=>fn());
  const map=row=>row&&Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v]));
  const member=row=>row&&({...map(row),registered:!!row.user_id});
  async function call(path,body,method){
    if(auth&&auth.expires_at*1000<Date.now()+60000){
      refreshing??=request({path:'/auth/v1/token?grant_type=refresh_token',method:'POST',body:{refresh_token:auth.refresh_token}}).then(setAuth).finally(()=>{refreshing=null});
      await refreshing;
    }
    return request({path,body,method:method||(body===undefined?'GET':'POST'),token:auth?.access_token});
  }
  function setAuth(value){auth={...value,expires_at:value.expires_at||Date.now()/1000+value.expires_in};return auth}
  const rpc=(name,body={})=>call('/rest/v1/rpc/'+name,body);
  const rows=async table=>(await call('/rest/v1/'+table+'?select=*')).map(map);
  async function profile(){const list=await call('/rest/v1/members?select=*&user_id=eq.'+encodeURIComponent(auth.user.id));if(!list[0]||!list[0].active)throw Error('Your account has no access or has been turned off. Contact the Division Accountant.');me=member(list[0]);return me}
  async function changed(){emit()}
  async function submissionId(key){const [r,u,p]=key.split('|');const list=await call(`/rest/v1/submissions?select=id&report_code=eq.${encodeURIComponent(r)}&unit_code=eq.${encodeURIComponent(u)}&period_key=eq.${encodeURIComponent(p)}`);if(!list.length)throw Error('No submission found');return list[0].id}
  const api={kind:'supabase',
    async signIn(email,password){email=String(email).trim().toLowerCase();
      try{setAuth(await request({path:'/auth/v1/token?grant_type=password',method:'POST',body:{email,password}}))}
      catch(e){if(/invalid login credentials/i.test(e.message)){let notYet=false;try{notYet=await request({path:'/rest/v1/rpc/can_register',method:'POST',body:{p_email:email}})}catch{}throw Error(notYet?'This email is allowed but not registered yet. Choose Register to set your password.':'Incorrect email or password.')}throw e}
      try{await profile()}catch(e){auth=null;me=null;throw e}emit();return me;
    },
    async register(data){
      const email=data.email.trim().toLowerCase();
      if(!data.familyName?.trim()||!data.firstName?.trim())throw Error('Enter your family name and first name');
      if(data.password.length<8||!/[a-z]/i.test(data.password)||!/\d/.test(data.password))throw Error('Use at least 8 characters with letters and numbers');
      if(!await rpc('can_register',{p_email:email}))throw Error('This email is not allowed, is turned off, or is already registered. Contact the Division Accountant.');
      const result=await request({path:'/auth/v1/signup',method:'POST',body:{email,password:data.password,data:{family_name:data.familyName,first_name:data.firstName,middle_name:data.middleName||''}}});
      // Registration never signs the person into the workspace automatically.
      if(result.access_token)await request({path:'/auth/v1/logout',method:'POST',token:result.access_token});
      return {registered:true,requiresConfirmation:!result.access_token,member:{name:root.CoaDemo.personName(data)}};
    },
    // A turned-off account drops its session so the app returns to the sign-in screen.
    async getSession(){if(!auth)return null;try{return await profile()}catch(e){auth=null;me=null;throw e}},
    async signOut(){try{if(auth)await call('/auth/v1/logout',{},'POST')}finally{auth=null;me=null;emit()}},
    async enterSuperadmin(){if(me?.role!=='superadmin')throw Error('Sign in with the shared superadmin account');return me},
    async changePassword(current,next){
      if(next===current)throw Error('Choose a different password');
      if(next.length<8||!/[a-z]/i.test(next)||!/\d/.test(next))throw Error('Use at least 8 characters with letters and numbers');
      await request({path:'/auth/v1/token?grant_type=password',method:'POST',body:{email:me.email,password:current}});
      await call('/auth/v1/user',{password:next},'PUT');await rpc('password_changed');await profile();emit();
    },
    async saveMember(d){const m=member(await rpc('save_member',{p_email:d.email,p_family_name:d.familyName||'',p_first_name:d.firstName||'',p_middle_name:d.middleName||'',p_base:d.base,p_unit_code:d.unitCode||null,p_position:d.position}));await changed();return m},
    async setMemberActive(email,active){const m=member(await rpc('set_member_active',{p_email:email,p_active:active}));await changed();return m},
    async resetMemberPassword(email,temp){await rpc('reset_member_password',{p_email:email,p_temp:temp});await changed()},
    async listMembers(){return (await call('/rest/v1/members?select=*&order=created_at')).map(member)},
    async getConfig(){const [units,reportTypes,settings]=await Promise.all([rows('units'),rows('report_types'),rows('settings')]);return {...settings[0],units:units.sort((a,b)=>a.sort-b.sort),reportTypes:reportTypes.filter(r=>r.active).sort((a,b)=>a.sort-b.sort)}},
    async listSubmissions(){return (await rows('submissions')).map(s=>({...s,key:[s.reportCode,s.unitCode,s.periodKey].join('|')}))},
    async listFiles(){const [files,subs]=await Promise.all([rows('submission_files'),api.listSubmissions()]);return files.map(f=>({...f,type:f.contentType,itemKey:subs.find(s=>s.id===f.submissionId)?.key}))},
    async downloadFile(id){const files=await call('/rest/v1/submission_files?select=*&id=eq.'+encodeURIComponent(id));if(!files[0])throw Error('File unavailable');return request({path:'/storage/v1/object/coa-files/'+files[0].storage_path,token:auth.access_token,download:files[0].name})},
    async listActivity(key){const list=await call('/rest/v1/activity_log?select=*&order=at.desc'+(key?'&item_key=eq.'+encodeURIComponent(key):''));return list.map(row=>({...map(row),by:row.actor_email,byName:row.actor_name}))},
    async submitFiles({reportCode,unitCode,periodKey,files}){
      const uploaded=[];
      for(const f of files){
        if(f.precheck?.blocked||!f.bytes)throw Error('Choose a valid file again before uploading');
        const storage_path=`${unitCode}/${periodKey}/${reportCode}/${crypto.randomUUID()}`;
        await request({path:'/storage/v1/object/coa-files/'+storage_path,method:'POST',token:(await call('/auth/v1/user'),auth.access_token),bytes:f.bytes});
        uploaded.push({storage_path,name:f.name,size:f.size,content_type:f.type,sha256:f.sha256,precheck:f.precheck});
      }
      await rpc('register_upload',{p_report:reportCode,p_unit:unitCode,p_period:periodKey,p_files:uploaded});emit();
    },
    async resubmit(key){await rpc('resubmit_submission',{p_id:await submissionId(key)});emit()},
    async approve(key){await rpc('review_submission',{p_id:await submissionId(key),p_decision:'approve',p_note:null});emit()},
    async returnForRevision(key,note){await rpc('review_submission',{p_id:await submissionId(key),p_decision:'return',p_note:note});emit()},
    async setNotApplicable(item,reason){await rpc('set_not_applicable',{p_report:item.reportCode,p_unit:item.unitCode,p_period:item.periodKey,p_reason:reason});emit()},
    async reopen(key,reason){await rpc('reopen_submission',{p_id:await submissionId(key),p_reason:reason});emit()},
    async removeFile(id,reason){await rpc('remove_file',{p_file_id:id,p_reason:reason||null});emit()},
    subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)}
  };
  return api;
}
root.CoaSupabase={createSupabaseSource};
if(typeof module!=='undefined')module.exports={createSupabaseSource};
})(globalThis);
