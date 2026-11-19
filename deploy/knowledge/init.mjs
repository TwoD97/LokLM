// Fresh CouchDB/vault provisioning only. No reset, rebuild, or existing-db writes.
// Runs inside the setup-profile container; does not print settings or credentials.
/* global process, Buffer, fetch, AbortSignal, console */
import {readFile,writeFile,access,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const settingsPath='/state/settings.json';
try {await access(settingsPath);throw new Error('Settings already exist; initialization refused');}
catch(e){if(e.code!=='ENOENT')throw e;}
const admin=process.env.COUCHDB_USER, password=process.env.COUCHDB_PASSWORD;
if(!admin||!password)throw new Error('CouchDB admin configuration is missing');
const passphrase=(await readFile('/run/secrets/vault_passphrase','utf8')).trim();
if(passphrase.length<24)throw new Error('Vault passphrase must be at least 24 characters');
const base='http://couchdb:5984/';
const headers={Authorization:'Basic '+Buffer.from(admin+':'+password).toString('base64'),'Content-Type':'application/json'};
async function request(path,method='GET',body){return fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});}
const database='loklm-knowledge';
if((await request(database)).status!==404)throw new Error('Database exists or cannot be verified absent; initialization refused');
for(const system of ['_users','_replicator','_global_changes']){const r=await request(system,'PUT');if(![201,202,412].includes(r.status))throw new Error('System database setup failed');}
const peerPassword=randomBytes(32).toString('base64url');
let r=await request('_users/org.couchdb.user:loklm-sync','PUT',{name:'loklm-sync',password:peerPassword,roles:[],type:'user'});
if(!r.ok)throw new Error('Sync user already exists or setup failed; no overwrite performed');
r=await request(database,'PUT');if(!r.ok)throw new Error('Fresh database creation failed');
r=await request(database+'/_security','PUT',{admins:{names:[admin],roles:[]},members:{names:['loklm-sync'],roles:[]}});
if(!r.ok)throw new Error('Database access policy failed');
const init=spawnSync('node',['/app/dist/index.cjs','init-settings',settingsPath],{stdio:'ignore'});
if(init.status!==0)throw new Error('Official CLI settings initialization failed');
const settings=JSON.parse(await readFile(settingsPath,'utf8'));
Object.assign(settings,{remoteType:'',couchDB_URI:'http://couchdb:5984',couchDB_USER:'loklm-sync',couchDB_PASSWORD:peerPassword,couchDB_DBNAME:database,liveSync:true,syncOnStart:false,syncOnSave:false,usePluginSync:false,encrypt:true,passphrase,isConfigured:true});
await writeFile(settingsPath,JSON.stringify(settings,null,2),{mode:0o600});
await chmod(settingsPath,0o600);
console.log('Fresh private LiveSync configuration prepared. Keep settings and the passphrase in encrypted backups.');
