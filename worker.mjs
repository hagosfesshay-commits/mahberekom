const reply = (value, status = 200) => Response.json(value, {status, headers: {'cache-control':'no-store'}});
const fail = (message,status) => reply({error:message},status);
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function localTime(){
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
}
export class Office {
  constructor(ctx){
    this.sql=ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, kind TEXT, name TEXT, email TEXT, note TEXT, day TEXT, start TEXT, end TEXT, guests INTEGER, status TEXT DEFAULT 'Ny', created INTEGER)");
  }
  async fetch(req){
    const path=new URL(req.url).pathname;
    const run=(query,...values)=>this.sql.exec(query,...values).toArray();
    if(path==='/api/calendar' && req.method==='GET'){
      return reply(run("SELECT day,start,end FROM requests WHERE kind='booking' AND status='Godkänd' AND day>=? ORDER BY day,start",localTime().slice(0,10)));
    }
    if(path==='/api/admin' && req.method==='GET') return reply(run('SELECT * FROM requests ORDER BY created DESC'));
    if(req.method!=='POST') return fail('Metoden stöds inte.',405);
    let data;
    try { data=await req.json(); } catch { return fail('Ogiltiga uppgifter.',400); }
    if(!data || typeof data!=='object') return fail('Ogiltiga uppgifter.',400);
    const conflict=(day,start,end)=>run("SELECT id FROM requests WHERE day=? AND status='Godkänd' AND start<? AND end>? LIMIT 1",day,end,start).length>0;
    if(path==='/api/admin'){
      const item=run('SELECT * FROM requests WHERE id=?',String(data.id))[0];
      if(!item) return fail('Ärendet saknas.',404);
      if(data.action==='Radera'){run('DELETE FROM requests WHERE id=?',item.id);return reply({ok:true});}
      const allowed=item.kind==='booking'?['Godkänd','Avslagen']:['Besvarad'];
      if(item.status!=='Ny'||!allowed.includes(data.action)) return fail('Uppdatera listan och försök igen.',409);
      if(data.action==='Godkänd' && conflict(item.day,item.start,item.end)) return fail('Tiden är redan bokad.',409);
      run('UPDATE requests SET status=? WHERE id=?',data.action,item.id);return reply({ok:true});
    }
    if(path!=='/api/request')return fail('Sidan saknas.',404);
    const clean=(key,max)=>typeof data[key]==='string'&&data[key].trim().length<=max?data[key].trim():'';
    const kind=clean('kind',16),name=clean('name',100),email=clean('email',200),note=clean('note',1000);
    if(!['booking','contact','member'].includes(kind)||!name||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||(kind!=='member'&&!note)) return fail('Kontrollera namn, e-post och meddelande.',400);
    const day=clean('day',10),start=clean('start',5),end=clean('end',5),guests=Number(data.guests);
    if(kind==='booking'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||!clock.test(start)||!clock.test(end)||end<=start||day+' '+start<=localTime()||!Number.isInteger(guests)||guests<1||guests>9999) return fail('Välj en framtida tid och ange antal gäster. Sluttiden måste vara senare samma dag.',400);
      if(conflict(day,start,end))return fail('Tiden är upptagen. Välj en annan tid.',409);
    }
    if(run('SELECT id FROM requests WHERE email=? COLLATE NOCASE AND created>? LIMIT 1',email,Date.now()-30000).length) return fail('Vänta en halv minut innan du skickar igen.',429);
    const id=crypto.randomUUID();
    run('INSERT INTO requests(id,kind,name,email,note,day,start,end,guests,created) VALUES(?,?,?,?,?,?,?,?,?,?)',id,kind,name,email,note,kind==='booking'?day:'',kind==='booking'?start:'',kind==='booking'?end:'',kind==='booking'?guests:0,Date.now());
    return reply({reference:id.slice(0,8)},201);
  }
}
export default {
 async fetch(req,env){
   const url=new URL(req.url);
   if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(req);
   if(!['/api/request','/api/admin','/api/calendar'].includes(url.pathname))return fail('Sidan saknas.',404);
   if(!env.ADMIN_KEY||!env.OFFICE)return fail('Formulären öppnar när föreningen har aktiverat tjänsten.',503);
   if(url.pathname==='/api/admin' && req.headers.get('Authorization')!=='Bearer '+env.ADMIN_KEY)return fail('Behörighet saknas.',401);
   if(req.method==='POST'){
     if(req.headers.get('Origin')!==url.origin||!req.headers.get('Content-Type')?.includes('application/json'))return fail('Ogiltig förfrågan.',403);
     const body=await req.text(); if(body.length>8000)return fail('Meddelandet är för långt.',413);
     req=new Request(req.url,{method:'POST',body});
   }
   return env.OFFICE.get(env.OFFICE.idFromName('hisings-backa')).fetch(req);
 }
};
