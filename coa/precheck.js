// Rule-based pre-checks run on a COA report file before it is submitted for review.
// Deterministic and local: no network. Loaded by the renderer (window.CoaPrecheck)
// and by Node (require('./coa/precheck')). Tests: node coa/test.js
(function(root){
const S=root.CoaSchedule||require('./schedule');
const A=root.Accounting||require('../engine');

const MAX_BYTES=50*1024*1024;
const ALLOWED_TYPES=['pdf','xlsx','xls','xlsm','csv','docx','jpg','jpeg','png'];
const READABLE_SHEETS=['xlsx','xlsm','csv'];
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
// Abbreviations are only trusted in file names ("MTB_Sep2026.xlsx"); in sheet text they are too often ordinary words.
const MONTH_ABBR={jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};

const ext=name=>{let m=/\.([a-z0-9]+)$/i.exec(name||'');return m?m[1].toLowerCase():''};
const norm=s=>' '+String(s??'').toLowerCase().replace(/[_\-.,;:\/\\()[\]#]+/g,' ').replace(/\s+/g,' ').trim()+' ';
const has=(text,word)=>new RegExp(`(?<![a-z])${word.replace(/ /g,' ')}(?![a-z])`).test(text);
function peso(c){let neg=c<0,s=String(Math.abs(c)).padStart(3,'0');return (neg?'-':'')+s.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+s.slice(-2)}
const unitName=(units,code)=>(units.find(u=>u.code===code)||{name:code}).name;

/** Offices mentioned in text, using UNIT_ALIASES. */
// Extra short names used by staff, on top of the schedule's aliases.
const EXTRA_ALIASES={BEGANG:['benhs']};
const ALIASES=Object.fromEntries(Object.entries(S.UNIT_ALIASES).map(([k,v])=>[k,[...v,...(EXTRA_ALIASES[k]||[])]]));
function officesIn(text){return Object.entries(ALIASES).filter(([,aliases])=>aliases.some(a=>has(text,a))).map(([code])=>code)}
function monthsIn(text,allowAbbr){let out=new Set();MONTHS.forEach((m,i)=>{if(has(text,m))out.add(i)});if(allowAbbr)Object.entries(MONTH_ABBR).forEach(([a,i])=>{if(has(text,a))out.add(i)});return [...out]}
function yearsIn(text){return [...new Set([...text.matchAll(/(?<!\d)(20\d\d)(?!\d)/g)].map(m=>Number(m[1])))]}
function quartersIn(text,allowShort){let out=new Set();if(allowShort)for(const m of text.matchAll(/(?<![a-z0-9])q([1-4])(?!\d)/g))out.add(Number(m[1]));[['first','1st'],['second','2nd'],['third','3rd'],['fourth','4th']].forEach((w,i)=>{if(w.some(x=>has(text,x+' quarter')))out.add(i+1)});return [...out]}
function periodMonths(period){let out=[],[y,m]=period.start.split('-').map(Number),[ey,em]=period.end.split('-').map(Number);while(y<ey||(y===ey&&m<=em)){out.push({y,m:m-1});m++;if(m>12){m=1;y++}}return out}

/** Text near the top of each sheet (titles, office, period), string cells only. */
function headerText(sheets){return (sheets||[]).map(s=>(s.rows||[]).slice(0,12).map(r=>(r||[]).filter(v=>typeof v==='string').join(' ')).join(' ')).join(' ')}

// Every school's letterhead names the Schools Division, so SDO only counts when no other office is named.
const LETTERHEAD_UNIT='SDO';
function checkOffice(text,source,item,units){let found=officesIn(text);if(found.length>1)found=found.filter(c=>c!==LETTERHEAD_UNIT);if(!found.length||found.includes(item.unit.code))return null;let names=found.map(c=>unitName(units,c)).join(', ');return {severity:'warn',code:'OFFICE_MISMATCH',title:`${source} mentions a different office`,detail:`It mentions ${names}, but this slot is ${item.unit.name}.`}}
function checkPeriod(text,source,item,allowAbbr){let out=[],p=item.period,inPeriod=periodMonths(p);
  let months=monthsIn(text,allowAbbr);if(months.length&&!months.some(m=>inPeriod.some(x=>x.m===m)))out.push({severity:'warn',code:'PERIOD_MISMATCH',title:`${source} mentions a different month`,detail:`It mentions ${months.map(m=>MONTHS[m][0].toUpperCase()+MONTHS[m].slice(1)).join(', ')}, but this slot is ${p.label}.`});
  let years=yearsIn(text),own=[...new Set(inPeriod.map(x=>x.y))];if(years.length&&!years.some(y=>own.includes(y)))out.push({severity:'warn',code:'YEAR_MISMATCH',title:`${source} mentions a different year`,detail:`It mentions ${years.join(', ')}, but this slot is ${p.label}.`});
  if(p.frequency==='QUARTERLY'){let q=quartersIn(text,allowAbbr),ownQ=Number(p.key.slice(-1));if(q.length&&!q.includes(ownQ))out.push({severity:'warn',code:'PERIOD_MISMATCH',title:`${source} mentions a different quarter`,detail:`It mentions Q${q.join(', Q')}, but this slot is ${p.label}.`})}
  return out}

/** Cell → integer centavos. Excel numbers are rounded to the centavo here, once. */
function amount(v){if(v===null||v===undefined||v==='')return 0;if(typeof v==='number'){if(!Number.isFinite(v))throw Error('not a number');return Math.round(v*100)}let s=String(v).trim();if(!s||/^[-–—]+$/.test(s))return 0;let neg=false;if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1)}if(s.startsWith('-')){neg=true;s=s.slice(1)}let c=A.cents(s);return neg?-c:c}
const cellText=v=>typeof v==='string'?v.trim():'';

/** Find the Debit/Credit header, foot the columns in centavos, and compare with any Total rows. */
function checkTrialBalance(sheet){let rows=sheet.rows||[],hr=-1,dc=-1,cc=-1;
  for(let r=0;r<Math.min(rows.length,40)&&hr<0;r++){let row=rows[r]||[],d=row.findIndex(v=>/^\s*debits?\b/i.test(cellText(v))),c=row.findIndex(v=>/^\s*credits?\b/i.test(cellText(v)));if(d>=0&&c>=0){hr=r;dc=d;cc=c}}
  if(hr<0)return null;
  let allD=0,allC=0,secD=0,secC=0,lines=0,bad=[],totals=[];
  for(let r=hr+1;r<rows.length;r++){let row=rows[r]||[],label=row.filter((v,i)=>i!==dc&&i!==cc).map(cellText).join(' ');let d,c;try{d=amount(row[dc])}catch{bad.push(r+1);d=0}try{c=amount(row[cc])}catch{bad.push(r+1);c=0}
    if(/(?<![a-z])(grand\s+|sub-?\s*)?totals?(?![a-z])/i.test(label)){if(d||c){let ok=(d===allD&&c===allC)||(d===secD&&c===secC);totals.push({row:r+1,d,c,ok,expD:allD,expC:allC})}secD=0;secC=0;continue}
    if(d||c){allD+=d;allC+=c;secD+=d;secC+=c;lines++}}
  return {sheet:sheet.name,headerRow:hr+1,lines,debit:allD,credit:allC,badRows:[...new Set(bad)],totals}}

/**
 * input: {file:{name,size,sha256}, sheets:[{name,rows}]|null, readError, item (from buildChecklist), units,
 *         existingFiles:[{sha256,name,itemKey,label}] (current files only), today}
 * returns {findings:[{severity:'block'|'warn'|'info'|'pass', code, title, detail}], blocked, checkedAt}
 */
function precheck(input){const {file,sheets,readError,item,units=S.DEFAULT_UNITS,existingFiles=[],today}=input;const f=[],x=ext(file.name);
  if(!file.size)f.push({severity:'block',code:'EMPTY',title:'File is empty',detail:'The file has 0 bytes. Export or scan it again.'});
  else if(file.size>MAX_BYTES)f.push({severity:'block',code:'TOO_LARGE',title:'File is larger than 50 MB',detail:`This file is ${(file.size/1048576).toFixed(1)} MB. Split it or reduce scan quality.`});
  if(f.length)return {findings:f,blocked:true,checkedAt:new Date().toISOString()};
  if(!ALLOWED_TYPES.includes(x))f.push({severity:'warn',code:'FILE_TYPE',title:`Unusual file type${x?` (.${x})`:''}`,detail:'Expected PDF, Excel (xlsx, xls, xlsm), CSV, Word (docx), JPG or PNG.'});
  if(file.sha256)for(const e of existingFiles.filter(e=>e.sha256===file.sha256)){f.push(e.itemKey===item.key?{severity:'warn',code:'DUPLICATE_SAME_ITEM',title:'Already attached to this report',detail:`The same file is already attached as “${e.name}”.`}:{severity:'warn',code:'DUPLICATE',title:'Same file uploaded elsewhere',detail:`Identical to “${e.name}” under ${e.label}.`})}
  const nameText=norm(file.name.replace(/\.[a-z0-9]+$/i,''));const o=checkOffice(nameText,'File name',item,units);if(o)f.push(o);f.push(...checkPeriod(nameText,'File name',item,true));
  if(sheets&&sheets.length){const h=norm(headerText(sheets)).replace(/ schools division of [a-z]+ /g,' ');const ho=checkOffice(h,'Sheet header',item,units);if(ho)f.push(ho);f.push(...checkPeriod(h,'Sheet header',item,false))}
  if(S.TRIAL_BALANCE_CODES.includes(item.report.code)){
    if(READABLE_SHEETS.includes(x)){
      if(readError)f.push({severity:'warn',code:'UNREADABLE',title:'Spreadsheet could not be read',detail:`${readError}. Totals were not checked.`});
      else{let results=(sheets||[]).map(checkTrialBalance).filter(Boolean),many=results.length>1;
        if(!results.length)f.push({severity:'warn',code:'TB_NO_HEADER',title:'No Debit/Credit columns found',detail:'Totals were not checked. Make sure the trial balance has “Debit” and “Credit” column headings.'});
        for(const t of results){const where=many?` (sheet “${t.sheet}”)`:'';
          if(!t.lines){f.push({severity:'warn',code:'TB_NO_DATA',title:`No amounts under Debit/Credit${where}`,detail:`Header found on row ${t.headerRow}, but no amounts below it.`});continue}
          if(t.debit!==t.credit)f.push({severity:'warn',code:'TB_UNBALANCED',title:`Debit and credit do not agree${where}`,detail:`Debits ${peso(t.debit)} · Credits ${peso(t.credit)} · Difference ${peso(t.debit-t.credit)} (${t.lines} lines summed).`});
          else f.push({severity:'pass',code:'TB_BALANCED',title:`Debit equals credit${where}`,detail:`${peso(t.debit)} on both sides (${t.lines} lines summed).`});
          for(const tot of t.totals.filter(t=>!t.ok))f.push({severity:'warn',code:'TB_TOTAL_MISMATCH',title:`Total row ${tot.row} does not foot${where}`,detail:`Row shows ${peso(tot.d)} / ${peso(tot.c)}; the lines above sum to ${peso(tot.expD)} / ${peso(tot.expC)}.`});
          if(t.badRows.length)f.push({severity:'warn',code:'TB_BAD_CELLS',title:`Non-numeric amounts ignored${where}`,detail:`Row${t.badRows.length>1?'s':''} ${t.badRows.slice(0,5).join(', ')}${t.badRows.length>5?` and ${t.badRows.length-5} more`:''} have text in the Debit/Credit columns.`})}}}
    else f.push({severity:'info',code:'TB_NOT_CHECKED',title:'Totals not checked',detail:x==='xls'?'Older .xls files cannot be read. Save as .xlsx to check Debit = Credit.':'Debit = Credit can only be checked in Excel or CSV files.'})}
  else if(readError&&READABLE_SHEETS.includes(x))f.push({severity:'warn',code:'UNREADABLE',title:'Spreadsheet could not be read',detail:`${readError}. Header checks were skipped.`});
  if(today&&today>item.dueDate){const n=S.daysBetween(item.dueDate,today);f.push({severity:'info',code:'LATE',title:`Uploaded ${n} day${n===1?'':'s'} after the due date`,detail:`Due ${S.formatDate(item.dueDate)}.`})}
  return {findings:f,blocked:f.some(x=>x.severity==='block'),checkedAt:new Date().toISOString()}}

const api={MAX_BYTES,ALLOWED_TYPES,READABLE_SHEETS,ext,precheck,checkTrialBalance,amount,peso,officesIn,monthsIn,yearsIn};
if(typeof module!=='undefined')module.exports=api;else root.CoaPrecheck=api;
})(globalThis);
