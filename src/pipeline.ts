import type { Dataset, TrainedModel, TrainJob } from './types'

const LS_DS='solanaos:datasets'
const LS_MD='solanaos:models'
const LS_JOBS='solanaos:jobs'

function load<T>(k:string, fallback:T):T{
  try{ const v=localStorage.getItem(k); return v? JSON.parse(v) as T : fallback }catch{ return fallback }
}
function save(k:string, v:any){ localStorage.setItem(k, JSON.stringify(v)) }

const defaults: Dataset[]=[
  {id:'ds1', name:'solana-docs.jsonl', rows:1240, type:'jsonl', content:`{"prompt":"What is Solana?","completion":"Solana is a high-throughput L1..."}\n{"prompt":"Explain validators","completion":"Validators vote on blocks..."}\n{"prompt":"What is Proof of History?","completion":"PoH is a clock..."}` , preview:'{"prompt":"What is Solana?","completion":"Solana is a high-throughput..."}'},
  {id:'ds2', name:'defi-glossary.jsonl', rows:880, type:'jsonl', content:`{"prompt":"What is AMM?","completion":"Automated Market Maker..."}\n{"prompt":"What is LP?","completion":"Liquidity Provider..."}` , preview:'{"prompt":"What is AMM?","completion":"Automated Market Maker..." }'},
  {id:'ds3', name:'nft-descriptions.txt', rows:560, type:'txt', content:`Pudgy Penguin #123 — rare trait ...\nMad Lads — Solana culture...`, preview:'Pudgy Penguin #123 — rare trait...'},
]

export let datasets: Dataset[] = load(LS_DS, defaults)
export let models: TrainedModel[] = load(LS_MD, [] as TrainedModel[])
export let jobs: TrainJob[] = load(LS_JOBS, [] as TrainJob[])

let listeners: (()=>void)[]=[]
export function onPipelineChange(cb:()=>void){ listeners.push(cb) }
function emit(){ listeners.forEach(c=>c()) }

export function addDataset(d:Dataset){ datasets=[d,...datasets]; save(LS_DS,datasets); emit() }
export function removeDataset(id:string){ datasets=datasets.filter(x=>x.id!==id); save(LS_DS,datasets); emit() }

export function addModel(m:TrainedModel){ models=[m,...models]; save(LS_MD,models); emit() }
export function removeModel(id:string){ models=models.filter(x=>x.id!==id); save(LS_MD,models); emit() }

export function addJob(j:TrainJob){ jobs=[j,...jobs]; save(LS_JOBS,jobs); emit() }
export function updateJob(id:string, patch:Partial<TrainJob>){ const j=jobs.find(x=>x.id===id); if(j) Object.assign(j,patch); save(LS_JOBS,jobs); emit() }

export function findDataset(id:string){ return datasets.find(d=>d.id===id) }
export function findDatasetByName(name:string){ return datasets.find(d=>d.name===name) }

// keep in sync with storage event
window.addEventListener('storage',(e)=>{
  if(e.key===LS_DS) datasets=load(LS_DS,defaults)
  if(e.key===LS_MD) models=load(LS_MD,[] as any)
})
