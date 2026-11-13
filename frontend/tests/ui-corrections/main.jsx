// 실제 DB에 접근하지 않는 임시 UI 검증 화면입니다.
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App'
import '../../src/index.css'
const species=[{id:1,korean_name:'범부전나비',scientific_name:'Rapala caerulea',host_plants:''}]
const survey={id:1,survey_date:'2026-11-11',place_name:'시험 장소',latitude:null,longitude:null,location_method:'unknown',purpose:'online_research',notes:'시험 자료',tags:[],photo_ids:[],created_at:'test',updated_at:'test',observations:[{id:1,species_id:1,species_name:'범부전나비',source_type:'indirect',source_note:'시험 원문',result:'observed',observation_date:null,observation_time:null,place_name:'',latitude:null,longitude:null,location_method:'unknown',stage:'adult',sex:'unknown',count:1,count_estimated:false,identification:'user_confirmed',capture_status:'not_captured',captured_count:null,notes:'시험 자료',tags:[],photo_ids:[],effective_tags:[],effective_date:'2026-11-11',effective_place:'시험 장소',effective_latitude:null,effective_longitude:null,source_weather:null,collection_accepted:true,stage_inferred:false}]}
const item={id:1,source:'naturing',source_id:'1',url:'https://example.invalid/o/1',species_id:1,korean_name:'범부전나비',scientific_name:'Rapala caerulea',observed_raw:'2018년 6월 16일 오전 7시',place_raw:'시험 장소',weather_raw:'시험 기상',latitude:null,longitude:null,review_status:'pending',last_received_at:'test',eligible:true,exempt:false,reason:'',inferred_stage:'adult',stage_manual:true,observation_id:null,source_changed:false,version:'test'}
window.fetch=async (url,options={})=>{
 if(options.method && options.method!=='GET')return new Response(JSON.stringify({detail:'시험 화면에서는 저장하지 않습니다.'}),{status:409,headers:{'Content-Type':'application/json'}})
 const path=new URL(String(url),location.origin).pathname
 let data=[]
 if(path==='/api/species')data=species
 else if(path==='/api/surveys')data=[survey]
 else if(path==='/api/record-weather')data={}
 else if(path.startsWith('/api/weather/'))data={context:{date:'2026-11-11',time:null,latitude:null,longitude:null,place:'시험 장소',kind:'daily',target_time:'20261111'},weather:null}
 else if(path==='/api/collection')data={total:1,items:[item]}
 else if(path==='/api/regions')data={regions:[],source:'시험 자료',source_url:''}
 else if(path.includes('integrations'))data={maps_ready:false,weather_ready:false,usage:[]}
 else if(path.includes('photos'))data={items:[],total:0}
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})
}
createRoot(document.getElementById('root')).render(<App />)
